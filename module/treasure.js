/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";
import { findTable, copyOf } from "./helpers.js";
import { evaluateFormula } from "./rolls.js";
import { putCoin } from "./coin.js";
import { folderTree } from "./store-rules.js";

/**
 * The Foundry side of the Warden's Treasure window (`apps/treasure.js`): what one source gives
 * when it is drawn, the draft written onto the party, and the card that tells the table.
 *
 * Nothing here holds state. The draft lives in the window and dies with it; what was sent lives
 * in the party's Stash, which has ownership, sync and a sheet of its own; the card only informs.
 */

const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/treasure-card.hbs`;

/**
 * A drawn row lives in the window only. Closing the window drops it; the Warden rolls again.
 * @typedef {{ key: string, kind: "item", data: object, name: string, img: string, uuid: string }
 *          | { key: string, kind: "coin", amount: number }} DrawnRow
 * `uuid` is the document the row was drawn from: a pack's item, or a world item a folder or table
 * named.
 */

/**
 * A source's document — its table or its folder — or null when the uuid no longer resolves.
 * A table goes through `findTable`, so the Warden's world copy of a pack table is the one rolled,
 * as for every Warden table; a world table the Warden dropped is not in any pack and is read as is.
 */
export async function sourceDocument(source) {
  if (source.kind === "table") return (await findTable(source.uuid)) ?? (await fromUuid(source.uuid));
  if (source.kind === "folder") return fromUuid(source.uuid);
  return null;
}

/**
 * What a source is called in the window, read off its document now — never stored, so a renamed
 * or translated table shows its new name. A folder is named with what holds it, because the
 * system's bands are called "150gp" and "Common (50gp)", which say nothing on their own: its
 * parent folder, or else its pack's title.
 * @returns {string|null}  null for a source whose document is gone.
 */
export function sourceLabel(source, doc) {
  if (source.kind === "coin") return game.i18n.localize("CAIRN.Treasure.Coin");
  if (!doc) return null;
  if (source.kind === "table") return doc.name;
  const holder = doc.folder?.name ?? (doc.pack ? game.packs.get(doc.pack)?.title : null);
  return holder ? `${holder} › ${doc.name}` : doc.name;
}

/** An Item document as a draft row. A pack's item keeps its uuid as provenance (`copyOf`). */
function itemRow(doc) {
  const data = copyOf(doc);
  // On nobody's body and in no container: the Stash is one flat list.
  Object.assign(data.system, { container: "", carried: true, equipped: false });
  return { key: foundry.utils.randomID(), kind: "item", data, name: doc.tableName ?? doc.name, img: doc.img, uuid: doc.uuid };
}

const coinRow = (amount) => ({ key: foundry.utils.randomID(), kind: "coin", amount });

/** What the Stash may hold of an Item: gear that is nobody's body part, and coin. */
const treasureKind = (doc) => doc?.documentName !== "Item" ? null
  : doc.type === "coin" ? "coin"
    : doc.type === "gear" && !doc.system.bodily ? "gear" : null;

/**
 * Draw one source `count` times.
 *
 * - **table:** `roll()` per count, never `draw()`, for `rollWardenTable`'s reason — drawing marks
 *   results drawn and posts a card. A result that is a gear becomes that gear; a coin Item becomes
 *   coin, since a party holds one sack per place and a second would be refused. Anything else — a
 *   text result, an Actor, a Journal, a Feature — is skipped.
 * - **folder:** one document picked at random per count, among the gear in it and its subfolders.
 *   The same thing may come up twice; it is two rows.
 * - **coin:** the formula per count.
 * @param {import("./treasure-rules.js").TreasureSource} source
 * @returns {Promise<{ rows: DrawnRow[], skipped: number, missing: boolean }>}
 */
export async function drawSource(source) {
  const rows = [];
  let skipped = 0;
  if (source.kind === "coin") {
    for (let n = 0; n < source.count; n++) {
      const total = (await evaluateFormula(source.formula)).total;
      if (total > 0) rows.push(coinRow(Math.floor(total)));
    }
    return { rows, skipped, missing: false };
  }

  const doc = await sourceDocument(source);
  if (source.kind === "table") {
    if (!doc) return { rows, skipped, missing: true };
    for (let n = 0; n < source.count; n++) {
      const { results } = await doc.roll();
      for (const result of results) {
        const item = result.type === "document" ? await fromUuid(result.documentUuid) : null;
        const kind = treasureKind(item);
        if (kind === "gear") rows.push(itemRow(item));
        else if (kind === "coin" && item.system.value > 0) rows.push(coinRow(item.system.value));
        else skipped++;
      }
    }
    return { rows, skipped, missing: false };
  }

  if (doc?.documentName !== "Folder" || doc.type !== "Item") return { rows, skipped, missing: true };
  // As the store reads a dropped folder: a pack folder's contents are index rows, so the documents
  // are fetched by id before anybody asks them what they are.
  const pack = doc.pack ? game.packs.get(doc.pack) : null;
  const entries = folderTree(doc, pack ? pack.folders : game.folders).flatMap((f) => f.contents);
  const items = pack
    ? entries.length ? await pack.getDocuments({ _id__in: entries.map((e) => e._id) }) : []
    : entries;
  const pool = items.filter((item) => treasureKind(item) === "gear");
  if (!pool.length) return { rows, skipped, missing: false };
  for (let n = 0; n < source.count; n++) {
    const face = (await evaluateFormula(`1d${pool.length}`)).total;
    rows.push(itemRow(pool[face - 1]));
  }
  return { rows, skipped, missing: false };
}

/**
 * The draft, written onto the party in one items batch and one coin write.
 *
 * Each item row is created under an id chosen here (`keepId`), so what the document refused —
 * `CairnItem._preCreateOperation` drops from the batch what a party may not hold, and says so —
 * is told apart from what landed by id rather than by position or by name.
 * @param {Actor} party
 * @param {DrawnRow[]} rows
 * @returns {Promise<{ landed: Item[], coin: number, refused: DrawnRow[] }>}
 */
export async function sendToStash(party, rows) {
  const itemRows = rows.filter((row) => row.kind === "item");
  const ids = itemRows.map(() => foundry.utils.randomID());
  const data = itemRows.map((row, i) => ({ ...foundry.utils.deepClone(row.data), _id: ids[i] }));
  const landed = data.length ? await party.createEmbeddedDocuments("Item", data, { keepId: true }) : [];
  const landedIds = new Set(landed.map((item) => item.id));
  const refused = itemRows.filter((_row, i) => !landedIds.has(ids[i]));

  const coinRows = rows.filter((row) => row.kind === "coin");
  const total = coinRows.reduce((sum, row) => sum + row.amount, 0);
  const coinLanded = total > 0 && (await putCoin(party, total, ""));
  if (total > 0 && !coinLanded) refused.push(...coinRows);
  return { landed, coin: coinLanded ? total : 0, refused };
}

/**
 * The public card: what was found and sent to the party, and a button that opens it on its Stash.
 * It lists what landed THEN and holds no state — the Stash is the truth, and nothing is handed
 * over from here. A gear is named by its guise, as on every card everyone reads.
 */
export async function postTreasureCard(party, landed, coin) {
  const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, {
    items: landed.map((item) => item.tableName),
    coin
  });
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: game.user.name }),
    flavor: game.i18n.localize("CAIRN.Treasure.CardFlavor", { party: foundry.utils.escapeHTML(party.name) }),
    content,
    flags: { [SYSTEM_ID]: { treasureParty: party.uuid } }
  });
}

/**
 * Wire the card's button, from the `renderChatMessageHTML` hook. It opens the party on its Stash
 * for whoever may see the party, and is hidden for whoever may not — or once the party is gone.
 */
export function renderTreasureButton(message, html) {
  const btn = html.querySelector(".cairn-treasure-open");
  if (!btn) return;
  const uuid = message.getFlag(SYSTEM_ID, "treasureParty");
  const party = uuid ? fromUuidSync(uuid) : null;
  if (!party?.testUserPermission(game.user, "OBSERVER")) {
    btn.hidden = true;
    return;
  }
  btn.addEventListener("click", async () => {
    await party.sheet.render({ force: true });
    party.sheet.changeTab("stash", "primary");
  });
}

/**
 * A drawn treasure dropped on the chat log is read out loud, as an item row's scroll control
 * does. Only a drag from the Treasure window carries the mark, and only the Warden can start one:
 * an item dragged from a sheet or a pack posts nothing, so a player cannot read out gear whose
 * true nature is hidden from them, nor an item from a pack they cannot browse.
 *
 * Bound once per chat log element, from the `renderChatLog` hook on a first render: the sidebar
 * log and a popped-out one are separate elements, and a popout closed and opened again is a new one.
 */
export function bindTreasureChatDrop(html) {
  // No dragover to cancel: core cancels it on the document for every drag. The drop is caught on
  // the way down, because the message box is a <prose-mirror> that takes a document drop itself
  // and writes a link to it into the unsent message. Stopped there, the drop never reaches core's
  // own cancel on the document either, so its default is cancelled here.
  html.addEventListener("drop", async (event) => {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.[SYSTEM_ID]?.treasure || !game.user.isGM) return;
    event.preventDefault();
    event.stopPropagation();
    const item = await fromUuid(data.uuid);
    if (item?.documentName === "Item") await item.postCard();
  }, { capture: true });
}

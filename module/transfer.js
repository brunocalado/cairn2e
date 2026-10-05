/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, FLAGS } from "./constants.js";
import { applyGold, gainPlaces, putCoin } from "./coin.js";
import { BELONGINGS } from "./coin-rules.js";
import { carryLight } from "./light-sources.js";
import { bundleItems } from "./transfer-rules.js";
import { tableNameOf } from "./data/_derived.js";

/** The query that hands a barter to a client allowed to write the recipient. Registered in
 *  `module/cairn2e.js`; the name is built from `SYSTEM_ID`, never written out. */
export const BARTER_QUERY = `${SYSTEM_ID}.barter`;

const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/barter-card.hbs`;

/** What a barter may carry: gear, and — inside a container that travels — the coin in it. */
const BARTER_TYPES = new Set(["gear"]);
const BARTER_CONTENT_TYPES = new Set(["gear", "coin"]);

/**
 * Writing a move between actors. What travels is `transfer-rules.js#bundleItems`; this is the
 * receiving half, and it only ever writes to the RECEIVER. The sender deletes what this reports
 * as landed, and nothing else, so a thing refused here is still where it was.
 *
 * Nothing is re-checked: the ten, a container's capacity and one sack per place are the
 * document's (`CairnItem._preCreateOperation`), which drops what does not fit and says so. What
 * this has to know is which source each surviving write came from, and a batch cannot say —
 * the survivors come back with no index to what went in. So it is one bundle per call.
 */

/**
 * Put `bundles` on `actor`, at `into` — the body, or one of its containers.
 *
 * A container and its contents land together or not at all: the contents go in one batch
 * pointing at the new container, and if any is refused the new container goes again (taking the
 * ones that landed with it). Without that, the sender's delete of the original container would
 * destroy whatever did not arrive.
 *
 * A sack of coin lands through `putCoin` — grown into the sack already there, or made — in the
 * container named, or else at the first place the whole amount fits. No question is asked: this
 * may run on another user's client.
 *
 * `arrived` names the copy made of each landed source, so the sender can move what belongs to the
 * thing rather than to the actor — a light burning on it — before deleting the original. Contents
 * are matched by position, which holds only once every one of them has landed; a partial batch is
 * rolled back above. A sack of coin is merged into whatever sack is there, so it maps to nothing.
 * @param {Actor} actor
 * @param {{ id: string, data: object, contents: { id: string, data: object }[] }[]} bundles
 * @param {string} [into]  A container id on `actor`; the body when empty. Whether it has room is
 *   the document's to refuse.
 * @returns {Promise<{ landed: string[], arrived: Record<string, string> }>}  Source ids that now
 *   exist on `actor`, and each non-coin one's copy's uuid.
 */
export async function receiveItems(actor, bundles, into = "") {
  const landed = [];
  const arrived = {};
  for (const { id, data, contents } of bundles) {
    if (data.type === "coin") {
      const value = data.system?.value ?? 0;
      if (await (into ? putCoin(actor, value, into) : landCoin(actor, value))) landed.push(id);
      continue;
    }

    const [made] = await actor.createEmbeddedDocuments("Item", [{ ...data, system: { ...data.system, container: into } }]);
    if (!made) continue;
    let stowed = [];
    if (contents.length) {
      const inside = contents.map((c) => ({ ...c.data, system: { ...c.data.system, container: made.id } }));
      stowed = await actor.createEmbeddedDocuments("Item", inside);
      if (stowed.length < inside.length) {
        await made.delete();
        continue;
      }
    }
    landed.push(id, ...contents.map((c) => c.id));
    arrived[id] = made.uuid;
    contents.forEach((c, i) => { arrived[c.id] = stowed[i].uuid; });
  }
  return { landed, arrived };
}

/**
 * Move `item` onto `actor` — the drop of an item on a character sheet, or on a container's sheet
 * (`into`). Every drop is a document. 2e's inventory is a list of items and a second Rope is a
 * second line — there is no count for a match to raise, so nothing is looked up by name.
 *
 * A container brings what is in it, a stowed thing arrives where it is put, a sack joins the sack
 * already there, and nothing arrives in anybody's hand (`transfer-rules.js`). No capacity check
 * either: the document refuses a create that would not fit (`documents/item.js`), and says so.
 * What this has to know is what DID land, so a refused move never deletes the thing it came from.
 *
 * Off another actor it is a move: the source goes, when this user may take it — a copy from a
 * sheet they cannot modify is a copy, as core's own drop is, rather than a delete that rejects
 * after the copy was made. From a pack or the sidebar it is a copy, stamped with its own uuid as
 * `_stats.compendiumSource` when it came out of a pack, as core's import does: it is how the copy
 * is still recognised (a light source, say) once a translation module has renamed it. A copy from
 * a sidebar or another actor already carries whatever source it had.
 * @param {Actor} actor
 * @param {Item} item  Not already `actor`'s — moving within one actor is an update, not this.
 * @param {string} [into]  A container id on `actor`; the body when empty.
 * @returns {Promise<boolean>}  Whether anything landed.
 */
export async function takeItem(actor, item, into = "") {
  const source = item.parent;
  // Off another actor, part of the body stays where it is. From a pack or the sidebar it is a
  // new thing — the Werewolf's claws land on the character exactly that way.
  if (source && item.system.bodily) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Barter.Bodily", { name: item.shownName }));
    return false;
  }
  const chosen = item.toObject();
  if (item.pack) chosen._stats = { ...chosen._stats, compendiumSource: item.uuid };
  const all = source ? source.items.map((i) => i.toObject()) : [chosen];
  const { landed, arrived } = await receiveItems(actor, bundleItems([chosen], all), into);
  if (!landed.length) return false;
  // Never mutate the source's in-memory data directly — upstream did, so a rejected write left
  // the wrong value on screen. The light moves before the delete: deleting a burning original
  // first puts it out.
  if (source && source.uuid !== actor.uuid && item.isOwner) {
    await carryLight(source, arrived);
    await source.deleteEmbeddedDocuments("Item", landed);
  }
  return true;
}

/**
 * Land `amount` coin on `actor` at the first place the whole of it fits — grown into the sack
 * already there, or a new one. No question is asked: this may run on another user's client.
 * @param {Actor} actor
 * @param {number} amount
 * @returns {Promise<boolean>}  Whether it landed.
 */
export async function landCoin(actor, amount) {
  if (amount <= 0) return true;
  const [place] = gainPlaces(actor, amount);
  if (place === undefined) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CoinNoRoom", { amount }));
    return false;
  }
  return putCoin(actor, amount, place);
}

/**
 * The receiving half of a barter, on a client that may write the recipient — theirs, the
 * Warden's, or the sender's own when they own both. The payload crossed a socket, so it is
 * checked before anything is written, and nothing in it is taken on trust: it NAMES the things
 * (`itemIds` on `sourceUuid`), and they are bundled here from the source's own documents, which
 * every client holds. The asker must own the source — otherwise any player could make anything
 * appear on anyone's character. Gear only (with what is inside a container that travels), a whole
 * non-negative amount of coin. A refusal writes nothing.
 *
 * The coin is the sender's to have taken off already (`sendBarter` debits it before asking);
 * this only lands it. A player who wanted coin from nowhere could type it onto their own sheet,
 * which they own, so there is nothing for this side to guard there.
 *
 * What landed is also written on the recipient (`FLAGS.BARTER`), under the barter's id, so a
 * sender whose query timed out can still learn what it lost.
 * @param {{ id: string, sourceUuid: string, targetUuid: string, itemIds: string[], coin: number }} payload
 * @param {User} user  Who asked — core's query context, or this user when the sender owns both.
 * @returns {Promise<{ landed: string[], arrived: Record<string, string>, coin: number }|{ refused: string }>}
 */
export async function receiveBarter({ id, sourceUuid, targetUuid, itemIds, coin } = {}, user) {
  if (typeof id !== "string" || !id) return { refused: "id" };
  const actor = await fromUuid(targetUuid);
  if (actor?.documentName !== "Actor" || actor.type !== "character") return { refused: "target" };
  const source = await fromUuid(sourceUuid);
  if (source?.documentName !== "Actor" || source.type !== "character") return { refused: "source" };
  if (!user || !source.testUserPermission(user, "OWNER")) return { refused: "source" };
  if (!Array.isArray(itemIds) || new Set(itemIds).size !== itemIds.length) return { refused: "items" };
  const chosen = itemIds.map((itemId) => source.items.get(itemId));
  if (chosen.some((item) => !BARTER_TYPES.has(item?.type) || item.system.bodily)) return { refused: "items" };
  const bundles = bundleItems(chosen.map((i) => i.toObject()), source.items.map((i) => i.toObject()));
  if (bundles.some((b) => b.contents.some((c) => !BARTER_CONTENT_TYPES.has(c.data.type)))) return { refused: "items" };
  if (!Number.isInteger(coin) || coin < 0) return { refused: "coin" };

  const { landed, arrived } = await receiveItems(actor, bundles);
  const coinLanded = (await landCoin(actor, coin)) ? coin : 0;
  await actor.setFlag(SYSTEM_ID, FLAGS.BARTER, { id, landed, arrived: Object.entries(arrived), coin: coinLanded });
  return { landed, arrived, coin: coinLanded };
}

/**
 * Hand a barter to whoever may write the recipient, and answer with what landed — or null when
 * nobody who could is connected, in which case nothing was written anywhere.
 *
 * The recipient's own player first: it is their character, and the trade is between two
 * players. The active Warden when they are away. A user who has gone is skipped before anything
 * is sent; once a query is out, a failure — a timeout, above all — ends the search with
 * `{ unanswered: true }`, because that client may have written all the same, and asking the
 * next one would land the trade twice.
 * @param {Actor} target
 * @param {object} payload  As `receiveBarter`.
 * @returns {Promise<object|null>}
 */
export async function deliverBarter(target, payload) {
  if (target.isOwner) return receiveBarter(payload, game.user);
  const owners = game.users.filter((u) => !u.isGM && u.active && target.testUserPermission(u, "OWNER"));
  const gm = game.users.activeGM;
  for (const user of gm ? [...owners, gm] : owners) {
    if (!user.active) continue;
    try {
      return await user.query(BARTER_QUERY, payload, { timeout: 20000 });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | ${user.name} did not answer the barter`, err);
      return { unanswered: true };
    }
  }
  return null;
}

/**
 * Put back coin the sender was debited for and that did not land: where it fits, else set aside —
 * Belongings has no limit, so it is never lost.
 * @param {Actor} actor
 * @param {number} amount
 */
async function refundCoin(actor, amount) {
  if (amount <= 0) return;
  const [place] = gainPlaces(actor, amount);
  await putCoin(actor, amount, place ?? BELONGINGS);
}

/**
 * The sending half of a barter, on the sender's client: the Barter window's Send.
 *
 * The coin leaves the sender FIRST — the sender owns it, and a spend made while the answer is on
 * its way can then no longer leave it both kept and received — and what does not land is put
 * back. The receiver writes what lands (`deliverBarter`); the sender then loses exactly that and
 * no more, and is told what stayed. With no answer at all it reads the recipient's record of the
 * barter (`FLAGS.BARTER`) before deciding, since a slow client may have written anyway. A card
 * in chat says what went from whom to whom.
 * @param {Actor} actor    The character handing things over.
 * @param {Actor} target   The character receiving them.
 * @param {Item[]} items   Gear of `actor`'s.
 * @param {number} [coin]  Coin, by amount.
 * @returns {Promise<boolean>}  Whether anything changed hands.
 */
export async function sendBarter(actor, target, items, coin = 0) {
  const id = foundry.utils.randomID();
  // The names the card and the warnings use, by source id — read now, as the sources may be gone
  // by the time the answer comes. By the name the table reads, so a gear unknown to its holder
  // goes by its guise (`documents/item.js`).
  const bundles = bundleItems(items.map((i) => i.toObject()), actor.items.map((i) => i.toObject()));
  if (coin > 0 && !(await applyGold(actor, -coin))) return false;
  const payload = { id, sourceUuid: actor.uuid, targetUuid: target.uuid, itemIds: items.map((i) => i.id), coin };
  let result = await deliverBarter(target, payload);
  if (result?.unanswered) {
    const record = target.getFlag(SYSTEM_ID, FLAGS.BARTER);
    result = record?.id === id ? { ...record, arrived: Object.fromEntries(record.arrived) } : null;
  }
  if (!result) {
    await refundCoin(actor, coin);
    ui.notifications.warn(game.i18n.localize("CAIRN.Barter.NobodyToReceive", { name: target.name }));
    return false;
  }
  if (result.refused) {
    await refundCoin(actor, coin);
    ui.notifications.error(game.i18n.localize("CAIRN.Barter.Refused"));
    return false;
  }

  const landed = new Set(result.landed);
  const moved = bundles.filter((b) => landed.has(b.id)).map((b) => tableNameOf(b.data));
  const left = bundles.filter((b) => !landed.has(b.id)).map((b) => tableNameOf(b.data));
  await carryLight(actor, result.arrived);
  if (landed.size) await actor.deleteEmbeddedDocuments("Item", [...landed].filter((i) => actor.items.has(i)));
  await refundCoin(actor, coin - result.coin);

  if (left.length) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Barter.LeftBehind", { names: left.join(", "), name: target.name }));
  }
  if (coin && !result.coin) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Barter.CoinLeftBehind", { amount: coin, name: target.name }));
  }
  if (!moved.length && !result.coin) return false;

  const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, { items: moved, coin: result.coin });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.localize("CAIRN.Barter.Flavor", { from: foundry.utils.escapeHTML(actor.name), to: foundry.utils.escapeHTML(target.name) }),
    content
  });
  return true;
}

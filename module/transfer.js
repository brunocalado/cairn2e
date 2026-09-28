/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";
import { applyGold, gainPlaces, putCoin } from "./coin.js";
import { bundleItems } from "./transfer-rules.js";

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
 * Put `bundles` on `actor`.
 *
 * A container and its contents land together or not at all: the contents go in one batch
 * pointing at the new container, and if any is refused the new container goes again (taking the
 * ones that landed with it). Without that, the sender's delete of the original container would
 * destroy whatever did not arrive.
 *
 * A sack of coin lands through `putCoin` — grown into the sack already there, or made — at the
 * first place the whole amount fits. No question is asked: this may run on another user's client.
 * @param {Actor} actor
 * @param {{ id: string, data: object, contents: { id: string, data: object }[] }[]} bundles
 * @returns {Promise<{ landed: string[] }>}  Source ids that now exist on `actor`.
 */
export async function receiveItems(actor, bundles) {
  const landed = [];
  for (const { id, data, contents } of bundles) {
    if (data.type === "coin") {
      if (await landCoin(actor, data.system?.value ?? 0)) landed.push(id);
      continue;
    }

    const [made] = await actor.createEmbeddedDocuments("Item", [data]);
    if (!made) continue;
    if (contents.length) {
      const inside = contents.map((c) => ({ ...c.data, system: { ...c.data.system, container: made.id } }));
      const stowed = await actor.createEmbeddedDocuments("Item", inside);
      if (stowed.length < inside.length) {
        await made.delete();
        continue;
      }
    }
    landed.push(id, ...contents.map((c) => c.id));
  }
  return { landed };
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
 * checked before anything is written: a character, gear only (and coin inside a container that
 * travels), a whole non-negative amount of coin. A refusal writes nothing.
 * @param {{ targetUuid: string, bundles: object[], coin: number }} payload
 * @returns {Promise<{ landed: string[], coin: number }|{ refused: string }>}
 */
export async function receiveBarter({ targetUuid, bundles, coin } = {}) {
  const actor = await fromUuid(targetUuid);
  if (actor?.documentName !== "Actor" || actor.type !== "character") return { refused: "target" };
  if (!Array.isArray(bundles)) return { refused: "items" };
  for (const b of bundles) {
    if (!BARTER_TYPES.has(b?.data?.type)) return { refused: "items" };
    if (!Array.isArray(b.contents) || b.contents.some((c) => !BARTER_CONTENT_TYPES.has(c?.data?.type))) {
      return { refused: "items" };
    }
  }
  if (!Number.isInteger(coin) || coin < 0) return { refused: "coin" };

  const { landed } = await receiveItems(actor, bundles);
  const coinLanded = (await landCoin(actor, coin)) ? coin : 0;
  return { landed, coin: coinLanded };
}

/**
 * Hand a barter to whoever may write the recipient, and answer with what landed — or null when
 * nobody who could is connected, in which case nothing was written anywhere.
 *
 * The recipient's own player first: it is their character, and the trade is between two
 * players. The active Warden when they are away. `User#query` throws when its user has gone, so
 * each is tried in turn, as the Scars window's hand-off does (`apps/scars.js`).
 * @param {Actor} target
 * @param {{ targetUuid: string, bundles: object[], coin: number }} payload
 * @returns {Promise<object|null>}
 */
export async function deliverBarter(target, payload) {
  if (target.isOwner) return receiveBarter(payload);
  const owners = game.users.filter((u) => !u.isGM && u.active && target.testUserPermission(u, "OWNER"));
  const gm = game.users.activeGM;
  for (const user of gm ? [...owners, gm] : owners) {
    try {
      return await user.query(BARTER_QUERY, payload, { timeout: 20000 });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | could not hand the barter to ${user.name}`, err);
    }
  }
  return null;
}

/**
 * The sending half of a barter, on the sender's client: the Barter window's Send, and a gear
 * dropped on another character's token (`canvas/hand-over.js`).
 *
 * The receiver writes what lands (`deliverBarter`); the sender then loses exactly that and no
 * more, and is told what stayed. A card in chat says what went from whom to whom.
 * @param {Actor} actor    The character handing things over.
 * @param {Actor} target   The character receiving them.
 * @param {Item[]} items   Gear of `actor`'s.
 * @param {number} [coin]  Coin, by amount.
 * @returns {Promise<boolean>}  Whether anything changed hands.
 */
export async function sendBarter(actor, target, items, coin = 0) {
  const bundles = bundleItems(items.map((i) => i.toObject()), actor.items.map((i) => i.toObject()));
  const result = await deliverBarter(target, { targetUuid: target.uuid, bundles, coin });
  if (!result) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Barter.NobodyToReceive", { name: target.name }));
    return false;
  }
  if (result.refused) {
    ui.notifications.error(game.i18n.localize("CAIRN.Barter.Refused"));
    return false;
  }

  const landed = new Set(result.landed);
  const moved = bundles.filter((b) => landed.has(b.id)).map((b) => b.data.name);
  const left = bundles.filter((b) => !landed.has(b.id)).map((b) => b.data.name);
  if (landed.size) await actor.deleteEmbeddedDocuments("Item", [...landed]);
  if (result.coin) await applyGold(actor, -result.coin);

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
    flavor: game.i18n.localize("CAIRN.Barter.Flavor", { from: actor.name, to: target.name }),
    content
  });
  return true;
}

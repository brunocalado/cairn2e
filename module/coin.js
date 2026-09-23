/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";
import { BELONGINGS, placeOf, sackAt, spendPlan, gainFits } from "./coin-rules.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Writing coin. The rules are in `coin-rules.js` and have no Foundry in them; this file is the
 * side that touches documents and asks the player a question.
 *
 * Coin is Items, one sack per place (`data/item-coin.js`), so "add 30 gold" is not a field write:
 * it is finding the sack where the coin goes and growing it, or making one. The two halves of a
 * gain — choosing WHERE and writing it — are separate functions, because the store's checkout
 * must ask the question before it deletes and creates anything and write the coin after, so a
 * cancel leaves the character exactly as they were. The sheet's chip composes the two
 * (`adjustGold`).
 *
 * Every write here goes through the document, which is the net: a sack that would not fit is
 * refused by `CairnItem` (`_preCreateOperation`, `_preUpdate`) and says so, and a second sack
 * where one already sits is refused the same way. Nothing here re-checks what the document
 * checks — it only reads back whether the write landed.
 */

/**
 * Free slots at a place as the character stands now: the body's, a container's, or no limit for
 * anything set aside (a Belonging weighs nothing wherever it is). An NPC has no ten and answers
 * with no limit either.
 * @param {Actor} actor
 * @param {string} place  `""`, a container id, or `BELONGINGS`.
 * @returns {number}
 */
function freeAt(actor, place) {
  if (place === BELONGINGS) return Infinity;
  if (place === "") return actor.system.slotsFree ?? Infinity;
  const container = actor.items.get(place);
  if (!container?.system.isContainer) return 0;
  return Math.max(0, container.system.capacity - container.system.contentsSlots);
}

/**
 * Put `amount` coin in `place`: grow the sack there, or make one. The only thing outside the
 * character generator and the Kettlewright import that creates a `coin` document.
 * @param {Actor} actor
 * @param {number} amount  Positive.
 * @param {string} [place]  `""` for the body, a container id, or `BELONGINGS`.
 * @returns {Promise<boolean>}  Whether the coin landed — the document may have refused it.
 */
export async function putCoin(actor, amount, place = "") {
  if (amount <= 0) return true;
  const sack = sackAt(actor.items, place);
  if (sack) {
    const before = sack.system.value;
    await sack.update({ "system.value": before + amount });
    return sack.system.value === before + amount;
  }
  const data = { name: game.i18n.localize("CAIRN.Gold"), type: "coin", system: { value: amount } };
  if (place === BELONGINGS) data.system.carried = false;
  else if (place) data.system.container = place;
  const created = await actor.createEmbeddedDocuments("Item", [data]);
  return created.length > 0;
}

/**
 * Where `amount` more coin goes. The body, when the growth fits its free slots; otherwise the
 * player picks a container, and only a container with room for the WHOLE amount is offered —
 * coin is never split across two places by the system. Null when there is nowhere, or the
 * player closes the question.
 *
 * The `free` overrides are for a caller whose own item writes have not happened yet (the store's
 * checkout): it passes the counts as they will stand afterwards.
 * @param {Actor} actor
 * @param {number} amount  Positive.
 * @param {object} [free]
 * @param {number} [free.bodyFree]
 * @param {Record<string, number>} [free.containerFree]  By container id.
 * @returns {Promise<string|null>}
 */
export async function chooseGainPlace(actor, amount, { bodyFree, containerFree } = {}) {
  const bodySack = sackAt(actor.items, "")?.system.value ?? 0;
  if (gainFits(bodySack, amount, bodyFree ?? freeAt(actor, ""))) return "";

  const options = actor.items.filter((c) => {
    if (!c.system.isContainer) return false;
    const existing = sackAt(actor.items, c.id)?.system.value ?? 0;
    return gainFits(existing, amount, containerFree?.[c.id] ?? freeAt(actor, c.id));
  });
  if (!options.length) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CoinNoRoom", { amount }));
    return null;
  }
  // One button per container. `wait` resolves to the callback's value, or null on close.
  return DialogV2.wait({
    classes: [SYSTEM_ID],
    window: { title: game.i18n.localize("CAIRN.CoinWhere.Title") },
    content: `<p>${game.i18n.localize("CAIRN.CoinWhere.Text", { amount })}</p>`,
    buttons: options.map((c) => ({ action: c.id, label: c.name, callback: () => c.id })),
    rejectClose: false
  });
}

/**
 * Write `delta` gold. Negative follows `spendPlan` — nearest sack first, a sack emptied is
 * deleted; positive lands in `place` through `putCoin`.
 * @param {Actor} actor
 * @param {number} delta
 * @param {string} [place]  Where a gain goes; ignored for a spend.
 * @returns {Promise<boolean>}  False, with nothing written, when the spend is short or the gain
 *   did not land.
 */
export async function applyGold(actor, delta, place = "") {
  if (delta === 0) return true;
  // `chooseGainPlace` answers null for "nowhere"; a caller that passes it on gets a refusal, not
  // a sack dropped on the body.
  if (delta > 0) return typeof place === "string" ? putCoin(actor, delta, place) : false;
  const plan = spendPlan(actor.items.contents, -delta);
  if (!plan) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CoinShort", { amount: -delta, gold: actor.system.gold }));
    return false;
  }
  const updates = [];
  const deletes = [];
  for (const { sack, take } of plan) {
    if (take >= sack.system.value) deletes.push(sack.id);
    else updates.push({ _id: sack.id, "system.value": sack.system.value - take });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (deletes.length) await actor.deleteEmbeddedDocuments("Item", deletes);
  return true;
}

/**
 * The sheet's Gold chip: a typed total, turned into a difference. Choose, then apply.
 * @param {Actor} actor
 * @param {number} delta
 * @returns {Promise<boolean>}
 */
export async function adjustGold(actor, delta) {
  if (delta <= 0) return applyGold(actor, delta);
  const place = await chooseGainPlace(actor, delta);
  if (place === null) return false;
  return applyGold(actor, delta, place);
}

/**
 * "How much?" — for a sack dropped on a container, or taken out of one. Defaults to all of it.
 * @param {number} max  What the sack holds.
 * @returns {Promise<number|null>}  1…max, or null when closed or nothing was typed.
 */
export async function promptCoinAmount(max) {
  const content = `
    <div class="cairn-field">
      <label>${game.i18n.localize("CAIRN.CoinAmount.Label", { max })}</label>
      <input type="number" name="amount" value="${max}" min="1" max="${max}" step="1" autofocus>
    </div>`;
  const result = await DialogV2.prompt({
    classes: [SYSTEM_ID],
    window: { title: game.i18n.localize("CAIRN.CoinAmount.Title") },
    content,
    ok: {
      label: game.i18n.localize("CAIRN.CoinAmount.Move"),
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    },
    rejectClose: false
  });
  const amount = Math.floor(Number(result?.amount));
  if (!Number.isFinite(amount) || amount < 1) return null;
  return Math.min(amount, max);
}

/**
 * Move `amount` of a sack to `place`. The whole sack moves as a document when nothing is there to
 * merge with; otherwise the destination's sack grows and the source shrinks, or goes when
 * emptied. The destination is written FIRST — it is the write that can be refused for room — and
 * the source is only reduced once the coin has landed.
 * @param {Item} sack
 * @param {number} amount
 * @param {string} place
 * @returns {Promise<boolean>}
 */
export async function moveCoin(sack, amount, place) {
  const actor = sack.parent;
  const value = sack.system.value;
  amount = Math.min(Math.max(0, amount), value);
  if (!actor || amount <= 0) return false;
  const whole = amount >= value;
  if (whole && !sackAt(actor.items, place)) {
    const changes = place === BELONGINGS
      ? { "system.container": "", "system.carried": false }
      : { "system.container": place, "system.carried": true };
    await sack.update(changes);
    // A refused move — no room in the container (`CairnItem#_preUpdate`) — resolves all the same,
    // so whether it landed is read back off the sack, as `putCoin` does.
    return placeOf(sack) === place;
  }
  if (!(await putCoin(actor, amount, place))) return false;
  if (whole) await sack.delete();
  else await sack.update({ "system.value": value - amount });
  return true;
}

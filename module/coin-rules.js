/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { goldSlots } from "./data/_derived.js";

/**
 * The rules of coin, with no Foundry in them — `checks/coin.check.mjs` runs these under Node.
 *
 * Coin is Items (`data/item-coin.js`): one sack per PLACE, a place being the body, one container,
 * or Belongings. What these functions settle is what the maintainer decided at the table:
 *
 * - **Spending** takes from the body first, then from containers carried on the body (the
 *   Backpack), then from what hauls itself or was set aside (the mule, the sack left at camp).
 *   Nearest coin first — you pay from the purse at your belt before you unload the mule.
 * - **Gaining** lands on the body when it fits; otherwise the player is asked which container,
 *   and only a container with room for the WHOLE amount is offered. Coin is never split across
 *   two places by the system: a split is a decision the player makes with a drop.
 *
 * Everything here takes plain `{ id, type, system }` shapes, prepared or not.
 */

/** The place key of anything set aside. The body is `""` and a container is its id. */
export const BELONGINGS = "belongings";

/**
 * The source of a new sack on the body, for a character being assembled — the generator's
 * `3d6 Gold Pieces`, the Kettlewright import's `gold`. One shape, so the two agree.
 * @param {number} value
 * @param {string} name  The localized word for Gold; passed in because this file has no `game`.
 * @returns {object}
 */
export function coinItem(value, name) {
  return { name, type: "coin", system: { value } };
}

/**
 * Where an item sits: its container's id, `BELONGINGS` when set aside, `""` on the body.
 * @param {{system?: object}} item
 * @returns {string}
 */
export function placeOf(item) {
  const sys = item.system ?? {};
  if (sys.container) return sys.container;
  return sys.carried === false ? BELONGINGS : "";
}

/**
 * The one sack at `place`, or undefined.
 * @param {Iterable<{type: string, system?: object}>} items
 * @param {string} place
 */
export function sackAt(items, place) {
  for (const item of items) {
    if (item.type === "coin" && placeOf(item) === place) return item;
  }
  return undefined;
}

/**
 * Every gold piece the actor owns, wherever it sits. This is `system.gold` on a character.
 * @param {Iterable<{type: string, system?: object}>} items
 * @returns {number}
 */
export function goldTotal(items) {
  let n = 0;
  for (const item of items) {
    if (item.type === "coin") n += item.system?.value ?? 0;
  }
  return n;
}

/**
 * How far away a sack is, for the spend order: 0 on the body, 1 in a container that is itself on
 * the ten (carried, `takesSlots`), 2 anywhere else — a self-hauling container, a container set
 * aside, or Belongings. A sack in a container nobody can find is 2 as well: it is not to hand.
 * @param {{system?: object}} sack
 * @param {Iterable<{id: string, system?: object}>} items
 * @returns {number}
 */
function reach(sack, items) {
  const place = placeOf(sack);
  if (place === "") return 0;
  if (place === BELONGINGS) return 2;
  let container;
  for (const item of items) {
    if (item.id === place) {
      container = item;
      break;
    }
  }
  const sys = container?.system;
  if (!sys) return 2;
  return sys.takesSlots && sys.carried !== false ? 1 : 2;
}

/**
 * The actor's sacks, nearest first. Stable within a reach, so two mules keep the order the
 * collection gave them.
 * @param {Array<{id: string, type: string, system?: object}>} items
 * @returns {Array<{id: string, type: string, system?: object}>}
 */
export function sacksInSpendOrder(items) {
  const all = Array.from(items);
  return all
    .filter((i) => i.type === "coin")
    .map((sack, index) => ({ sack, index, reach: reach(sack, all) }))
    .sort((a, b) => a.reach - b.reach || a.index - b.index)
    .map((x) => x.sack);
}

/**
 * How to take `amount` out: one `{ sack, take }` per sack touched, walking the spend order — or
 * null when every sack together is short. A sack whose `take` is its whole value is a sack to
 * delete.
 * @param {Array<{id: string, type: string, system?: object}>} items
 * @param {number} amount  Positive.
 * @returns {Array<{sack: object, take: number}>|null}
 */
export function spendPlan(items, amount) {
  if (amount <= 0) return [];
  if (goldTotal(items) < amount) return null;
  const plan = [];
  let left = amount;
  for (const sack of sacksInSpendOrder(items)) {
    if (left <= 0) break;
    const have = sack.system?.value ?? 0;
    if (have <= 0) continue;
    const take = Math.min(have, left);
    plan.push({ sack, take });
    left -= take;
  }
  return plan;
}

/**
 * Whether `amount` more coin fits where a sack of `existing` already sits, given the free slots
 * THERE. Only the growth is charged — the sack's current weight is already counted in what is
 * used — so a body sack of 150 with one free slot takes 149 more (to 299, still 2 slots) but not
 * 150 (300 is 3).
 * @param {number} existing  What the sack at that place holds now (0 for none).
 * @param {number} amount    Positive.
 * @param {number} free      Free slots at that place.
 * @returns {boolean}
 */
export function gainFits(existing, amount, free) {
  return goldSlots(existing + amount) - goldSlots(existing) <= free;
}

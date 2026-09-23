/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MAX_SLOTS } from "./constants.js";
import { slotsForItem, sumUsedSlots } from "./data/_derived.js";
import { BELONGINGS, placeOf, sackAt, spendPlan, gainFits } from "./coin-rules.js";

/**
 * What a store is, and what a cart adds up to, with no Foundry in them — `checks/store.check.mjs`
 * runs these under Node.
 *
 * A store is a name and a list of Item uuids. It keeps no price, no stock and no copy of
 * anything: the row IS the item — its `cost` is read off the referenced document when the window
 * draws — so the Warden who wants a dearer Rope edits the Rope, once, and every store that lists
 * it follows.
 *
 * The cart's arithmetic is here too, because the number that matters at a Cairn table is not
 * the gold but the ten slots: `cartSummary` simulates the checkout on the same `sumUsedSlots`
 * the sheet and the document use, so the foot cannot promise a Chainmail the create would refuse.
 */

/**
 * A store with nothing on its shelves yet.
 *
 * Both rates are percentages of an item's own cost and belong to the store alone, set in its
 * settings dialog. `sellRatio` starts at 50, the table's usual half: the SRD prices what is bought
 * (`marketplace.md`) and says nothing about selling. `buyRatio` starts at 100, the book price.
 */
export function blankStore(name) {
  return { name, items: [], sellRatio: 50, buyRatio: 100 };
}

/**
 * A name for a store whose maker typed none. An empty field is an answer — "call it whatever" —
 * so it never blocks the making; it only has to come back with a name that is not already in the
 * picker. The numeral appears when it has to and not before, so the first unnamed store does not
 * look like one of a series.
 */
export function untitledName(base, taken) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** The settings form's write: the three values it holds, the shelves untouched. */
export function withSettings(store, { name, sellRatio, buyRatio }) {
  return { ...store, name, sellRatio, buyRatio };
}

/**
 * Add a uuid once. The same thing listed twice is one line — a second Rope is bought by quantity
 * on the cart, not found twice on the shelf.
 */
export function withItem(store, uuid) {
  if (store.items.includes(uuid)) return store;
  return { ...store, items: [...store.items, uuid] };
}

/**
 * Add many uuids at once, each still only once: a folder dropped on the shelves is one save, and
 * a thing already listed stays one line.
 */
export function withItems(store, uuids) {
  return uuids.reduce(withItem, store);
}

/**
 * A folder and every folder under it, in one list.
 *
 * Core has no one call for this. `Folder#getSubfolders` filters `game.folders`, so it answers
 * `[]` for a folder that lives in a compendium; `Folder#children` is assigned while the sidebar
 * builds its tree and is filtered by what the user may see. Both cover one case each, and a
 * store is dropped on from both sidebars — so the descent is written here, over whichever
 * collection the folder belongs to, and it is the same two lines for either.
 * @param {{id: string}} folder
 * @param {Iterable<{id: string, folder?: {id: string}}>} all  Every folder in that collection.
 */
export function folderTree(folder, all) {
  const found = [folder];
  const rest = Array.from(all);
  for (let i = 0; i < found.length; i++) {
    for (const f of rest) if (f.folder?.id === found[i].id && !found.includes(f)) found.push(f);
  }
  return found;
}

export function withoutItem(store, uuid) {
  return { ...store, items: store.items.filter((u) => u !== uuid) };
}

/**
 * Only `gear` sells: a Background or a Feature has no price, a Fatigue is nobody's to buy, and a
 * sack of coin is the payment, not the purchase. An Item embedded in an Actor is refused too —
 * its uuid dies with the actor, and the shelf references packs and the world directory only.
 */
export function sellable(item) {
  return item?.type === "gear" && !item.parent;
}

/* -------------------------------------------- */
/*  The cart                                    */
/* -------------------------------------------- */

/**
 * What a store pays for a thing: `floor(cost × ratio / 100)`, the ratio being the Warden's shown
 * setting. The SRD prices what is bought and says nothing about selling.
 */
export function sellPrice(cost, ratio) {
  return Math.floor((cost ?? 0) * ratio / 100);
}

/**
 * What a store charges for a thing: `ceil(cost × ratio / 100)`, the ratio being that store's
 * own. The store rounds in its own favour on both sides of the counter — `sellPrice` floors for
 * exactly the same reason — and at 100 the ceiling is exact, so a store nobody has priced sells
 * at the SRD.
 *
 * It is the till's number and not the thing's: the Item is untouched and the copy a character
 * buys keeps its own `cost`, so a Rope dear in a siege is sold back anywhere at what a Rope is
 * worth.
 */
export function buyPrice(cost, ratio) {
  return Math.ceil((cost ?? 0) * (ratio ?? 100) / 100);
}

/** Whether `item` is a container with something in it — sold, it would take its contents along. */
function holdsSomething(item, items) {
  if (!(item.system?.capacity > 0)) return false;
  for (const other of items) if (other.system?.container === item.id) return true;
  return false;
}

/**
 * The character's own things a store would take, grouped by where they sit: `cost > 0` and
 * nothing else — the catalogue is never consulted for a sale. A sack of coin has no cost and is
 * the payment, not the goods. A container with something in it is kept back: a deleted container
 * takes its contents with it (`documents/item.js#_preDeleteOperation`), and a player who wants
 * to sell the Backpack empties it first.
 * @param {Iterable<{id: string, type: string, system?: object}>} items
 * @returns {Array<{place: string, items: object[]}>}  Body first, containers in collection
 *   order, Belongings last.
 */
export function sellableOwn(items) {
  const all = Array.from(items);
  const groups = new Map();
  for (const item of all) {
    if (item.type === "coin" || !(item.system?.cost > 0)) continue;
    if (holdsSomething(item, all)) continue;
    const place = placeOf(item);
    if (!groups.has(place)) groups.set(place, []);
    groups.get(place).push(item);
  }
  const order = (place) => (place === "" ? 0 : place === BELONGINGS ? 2 : 1);
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([place, group]) => ({ place, items: group }));
}

/**
 * The items as they will stand after the checkout, before any coin moves: sold ids gone, each
 * bought thing on the body (`container: ""`, `carried: true`, `equipped: false`) as many times
 * as its quantity — a second Rope is a second entry, as on the sheet.
 * @param {Iterable<object>} items
 * @param {Iterable<string>} soldIds
 * @param {Array<{doc: {type: string, system: object}, qty: number}>} bought
 * @returns {object[]}
 */
export function itemsAfter(items, soldIds, bought) {
  const sold = new Set(soldIds);
  const after = Array.from(items).filter((item) => !sold.has(item.id));
  for (const { doc, qty } of bought) {
    const sys = typeof doc.system?.toObject === "function" ? doc.system.toObject() : { ...doc.system };
    for (let n = 0; n < qty; n++) {
      after.push({ id: "", type: doc.type, system: { ...sys, container: "", carried: true, equipped: false } });
    }
  }
  return after;
}

/**
 * Free slots in every container as `items` stand — what `chooseGainPlace` is handed after the
 * item writes are simulated, so a sold Tent frees the Mule's room before the question is asked.
 * @param {Iterable<{id: string, system?: object}>} items
 * @returns {Record<string, number>}
 */
export function containerFree(items) {
  const all = Array.from(items);
  const free = {};
  for (const item of all) {
    if (!(item.system?.capacity > 0)) continue;
    let used = 0;
    for (const other of all) if (other.system?.container === item.id) used += slotsForItem(other);
    free[item.id] = Math.max(0, item.system.capacity - used);
  }
  return free;
}

/** `items` with a spend plan applied: a sack shrinks or goes. */
function afterSpend(items, plan) {
  const gone = new Set();
  const less = new Map();
  for (const { sack, take } of plan) {
    if (take >= (sack.system?.value ?? 0)) gone.add(sack);
    else less.set(sack, take);
  }
  return items
    .filter((item) => !gone.has(item))
    .map((item) => (less.has(item) ? { ...item, system: { ...item.system, value: item.system.value - less.get(item) } } : item));
}

/**
 * Everything the cart's foot prints and Confirm is gated on.
 *
 * `slotsAfter` is the body as it will stand: the sold things gone, the bought ones arrived, the
 * coin spent taken from the sacks by the spend order, and a gain that fits the body added to
 * its sack. A gain that does not fit is not counted — it goes to a container the player is asked
 * about at checkout, and `needsContainer` says the question is coming.
 * @param {object} cart
 * @param {Iterable<object>} cart.items   The character's items as they stand.
 * @param {number} cart.gold             Their gold now (`goldTotal`).
 * @param {Array<{doc: object, qty: number}>} cart.buy
 * @param {object[]} cart.sell           The character's own items going.
 * @param {number} cart.ratio            The store's sell ratio, a percentage.
 * @param {number} [cart.buyRatio]       The store's buy ratio; 100, the SRD price, by default.
 * @param {number} [cart.slotsMax]
 */
export function cartSummary({ items, gold, buy, sell, ratio, buyRatio = 100, slotsMax = MAX_SLOTS }) {
  const buyTotal = buy.reduce((n, { doc, qty }) => n + buyPrice(doc.system?.cost, buyRatio) * qty, 0);
  const sellTotal = sell.reduce((n, item) => n + sellPrice(item.system?.cost, ratio), 0);
  const net = sellTotal - buyTotal;
  const goldAfter = gold + net;
  const slotsUsed = sumUsedSlots(items);
  let after = itemsAfter(items, sell.map((i) => i.id), buy);
  let short = false;
  let needsContainer = false;
  if (net < 0) {
    const plan = spendPlan(after, -net);
    if (plan) after = afterSpend(after, plan);
    else short = true;
  } else if (net > 0) {
    const body = sackAt(after, "");
    const existing = body?.system?.value ?? 0;
    if (gainFits(existing, net, slotsMax - sumUsedSlots(after))) {
      after = body
        ? after.map((item) => (item === body ? { ...body, system: { ...body.system, value: existing + net } } : item))
        : [...after, { id: "", type: "coin", system: { value: net, carried: true, container: "" } }];
    } else {
      needsContainer = true;
    }
  }
  const slotsAfter = sumUsedSlots(after);
  const fitsBody = slotsAfter <= slotsMax;
  const empty = !buy.length && !sell.length;
  return {
    buyTotal, sellTotal, net, goldAfter, slotsUsed, slotsAfter, fitsBody, short, needsContainer, empty,
    ok: !empty && fitsBody && !short,
    // The free counts as they will stand, for the container question.
    bodyFree: Math.max(0, slotsMax - slotsAfter),
    containerFree: containerFree(after)
  };
}

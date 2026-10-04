/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MAX_SLOTS, packUuid } from "./constants.js";
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
 *
 * `visitable` is whether players may walk in on their own, from their character sheet. A store the
 * Warden makes starts closed to them: it is somewhere in the fiction, and the Warden opens it when
 * the party is in its town. The system's own stores start open (`defaultStores`).
 */
export function blankStore(name) {
  return { name, items: [], sellRatio: 50, buyRatio: 100, visitable: false };
}

const weapon = (id) => packUuid("weapons", "Item", id);
const armor = (id) => packUuid("armor", "Item", id);
const gear = (id) => packUuid("gear", "Item", id);
const homebrew = (id) => packUuid("more-gear", "Item", id);
const shelf = (name, items) => ({ ...blankStore(name), items, visitable: true });

/**
 * The stores a world starts with: the setting's `default`, and what the Warden's "Restore Default
 * Stores" macro writes back. Small and themed on purpose — a shop sells one kind of thing — and
 * between them they hold every Item in the SRD's Marketplace but Ship's Passage, which is a
 * port's to sell and not a stable's, plus the Homebrew gear that fills a gap beside it; the
 * Tailor is Homebrew whole but for the SRD's Gloves, and the Tavern is Homebrew whole.
 *
 * All ten start open to visits, so a new world's players can shop from their sheets before the
 * Warden has set anything up; closing the ones not in the party's town is one switch each.
 *
 * Each name is a localization key, not a name: the store is read through `game.i18n.localize`
 * (`module/apps/store.js`), so a translation module renames these through its language file,
 * and a name the Warden typed — no key — comes back from `localize` as it was written. Shelves
 * run cheapest first, the order the window draws them in.
 */
export function defaultStores() {
  return {
    weaponsmith: shelf("CAIRN.Store.Default.Weaponsmith", [
      weapon("1QVV6Hd59hT1x4h1"), // Cudgel
      weapon("a7ny2xCcpEwZTDuM"), // Dagger
      weapon("hEOii1unpB3UBy5L"), // Sickle
      weapon("xEjdizfTpn66xhpK"), // Sling
      weapon("FR6w8pHdVrJYdftU"), // Staff
      weapon("1aObADSCj3jIkUPw"), // Axe
      weapon("7uFzZkd7iZC32dKu"), // Flail
      weapon("7UPpQmxPZ5LgNQWN"), // Mace
      weapon("hHDraN8apA23UPS9"), // Spear
      weapon("FgArC8sR078bwJEr"), // Sword
      weapon("xNFvJV971IDEj7zZ"), // Bow
      weapon("PqnBufW2R8SfCcog"), // Halberd
      weapon("WwEEaLMmjSyap9kH"), // Long Sword
      weapon("2RgcMeClMBxWr0ip"), // War Hammer
      weapon("qLSAVP83onsMvq0d")  // Crossbow
    ]),
    armorer: shelf("CAIRN.Store.Default.Armorer", [
      armor("HgY89TClg3swr6Mx"), // Helmet
      armor("ImIULTvK8p5ZoWUC"), // Shield
      armor("wdc9nLqwIN0iNkFj"), // Gambeson
      armor("WvHpP6L5AyMd6oO7"), // Brigandine
      armor("vYkrBTEXzHrxUzSk"), // Chainmail
      armor("HFI9vH2O90lK0XwE")  // Plate
    ]),
    stables: shelf("CAIRN.Store.Default.Stables", [
      gear("zx6dah3S6hfrFBC3"), // Animal Feed
      gear("tX5yhIVDnRmRHOft"), // Carriage Seat
      homebrew("FiibVRieLmgcDKkZ"), // Donkey
      homebrew("8WsMxniKtWFRDzc0"), // Saddle & Bridle
      gear("S8va0NhfI1MpGSsu"), // Cart
      gear("VJI4DiSg5Sswru2s"), // Mule
      homebrew("R8uwbEVATuGEbHXr"), // Horse, draft
      homebrew("y8TSuLCa3he2GDI0"), // Barding
      homebrew("juT6hJSSk0N8oiwV"), // Oxen
      homebrew("Gz5R0AVAjUG5DzlC"), // Camel
      gear("4UgTnLDhgKLtyK1y"), // Horse
      homebrew("6n8b28bouLbvoC3B"), // Cart, big
      gear("WicimNRxtb4MPrsM")  // Wagon
    ]),
    provisioner: shelf("CAIRN.Store.Default.Provisioner", [
      gear("sz3hlSxhxVLBvkKX"), // Chalk
      gear("yQOui5IqPJ0IHTCf"), // Rope
      homebrew("yypWKdw4aHNfxiTH"), // Tinder Box
      gear("38nboO4axGNV5vQC"), // Torch
      gear("MLu8HRRZKwQjdGBU"), // Containers
      gear("5eQEA0pByDrzJ06P"), // Cooking Gear
      gear("vwTBmANkGI22L7n2"), // Fire Oil
      gear("lAOJ4KhINKHkQFKY"), // Lantern
      gear("DEIG5kYj2mhV3hRM"), // Oil Can
      homebrew("jAjEcR1YrKhpCVmA"), // Oilskin Bag
      gear("o6vtsY4SfrFJHnol")  // Rations
    ]),
    outfitter: shelf("CAIRN.Store.Default.Outfitter", [
      gear("BgBHOBRaOlLJCh31"), // Air Bladder
      gear("C1iwGcA5I86vOI5Z"), // Pole
      homebrew("hKFH48ZkCQ0QQiih"), // Stakes & Mallet
      homebrew("KpQA9uUHYKruyfZo"), // Crowbar
      gear("5yJLuqVex4HpsIhJ"), // Expeditionary Gear
      gear("LpppO7mC1EgIRTXv"), // Fishing Rod
      gear("Ep7hnDLh5HBoEOZr"), // Outdoor Comfort
      gear("oRPrPL68rhEdLYxk"), // Dowsing Rod
      homebrew("0QSZBiZq5bTatmmj"), // Rope Ladder
      gear("x7XzCfvN7U9vRo4N"), // Spiked Boots
      gear("tGF9mBAjp5fivlyB"), // Wilderness Clothes
      gear("uAtHUVkrUHWlKi5x"), // Tent
      gear("3QIHHBWQeDmDJASp"), // Grappling Hook
      gear("B5pPWtT8ZvgBm70C"), // Spyglass
      gear("jIUcDxlW7tojBgaG")  // Compass
    ]),
    apothecary: shelf("CAIRN.Store.Default.Apothecary", [
      gear("dcg6C3sgIfUklUu7"), // Bathing Goods
      gear("LJuSzL3jPRwPcvAL"), // Common Agents
      homebrew("imAtEycOcQWwVP6X"), // Incense
      gear("riO6dGPX20svCtL0"), // Repellent
      gear("m9pA9rDapkpMFjYi"), // Antitoxin
      gear("F8yysdbnA0y5L4sA"), // Bandages
      gear("Pl1vyKGTou4BZeAC")  // Sedative
    ]),
    toolmaker: shelf("CAIRN.Store.Default.Toolmaker", [
      gear("0zOZuLW1Yw2gr9wT"), // Chisel
      gear("QYy0LFVooHDbjiTV"), // Caltrops
      gear("OTCJHK1d9Rk6QIfR"), // Chain
      gear("QDL96czD5DIDWr79"), // Common Tools
      homebrew("h3EXPHVgXZXRxCn2"), // Drill
      homebrew("P799Joyn54UqzS9a"), // Manacles
      gear("5SZWEE7UyIgdgwSE"), // Net
      gear("RFXTI1B6phAqB4hY"), // Sewing Kit
      gear("TxTE0Kqi1Pemap5K"), // Specialized Tools
      gear("oyCPkncx99bsRO5E"), // Chest
      homebrew("YIgMWNexXwxKqJMb"), // Lock
      gear("Re9jpaWAjgO528ON"), // Thieving Tools
      gear("y9WcPO45F4qWK4Rv")  // Trap
    ]),
    curiosities: shelf("CAIRN.Store.Default.Curiosities", [
      gear("qjn8EvZyXYZb1eST"), // Card Deck
      homebrew("2oU4PHgmDqqUWESi"), // Glass Marbles
      gear("8AfmfTU2E7oJ994j"), // Mirror
      gear("sIS4sBDYuDjnLPo0"), // Games
      homebrew("MDVFEbBdFbHAQPDq"), // Horn
      homebrew("xj5GoUQZGs5ns7Tl"), // Lens
      gear("7NQNLHQ66u6U31jM"), // Parchment
      gear("5YhwJSdfOq8wWj9E"), // Simple Instruments
      gear("7Wnavu7ZBS1W8hbB"), // Costume Gear
      gear("CVGcWnnLF3qFEF3J"), // Smoking Pipe
      gear("LsozBVpc307VB58Y"), // Whistle
      gear("MiIdPDU4ca9DCT1P"), // Book
      gear("nIuVR8I5HZctUgs6"), // Complex Instruments
      homebrew("t8pStHMfLvW5B1xA")  // Hourglass
    ]),
    tailor: shelf("CAIRN.Store.Default.Tailor", [
      homebrew("gsRUkDWYwojfVuel"), // Hat, straw
      homebrew("IPbov0cLCcRyGD9G"), // Eye Patch
      homebrew("PyxQELrsORDC9lGM"), // Apron, cloth
      homebrew("PHTBANGUYQvaA6Z0"), // Belt, leather
      homebrew("M9skHCnGwlzhb4zn"), // Boots, cloth
      homebrew("deXCgnSoO5ql0XFP"), // Cap
      homebrew("ECEb84hWKN8DoqGZ"), // Hat, simple
      homebrew("85UZdMdDeWNSwjoO"), // Sandals
      homebrew("DBz12FtJ7rQcOc73"), // Shirt, cloth
      homebrew("0zqeoGPExD1qrUgZ"), // Skirt, cloth
      homebrew("Fl366flR0I7dYXN7"), // Trousers
      homebrew("enXXi4WpO2LQnEj6"), // Apron, leather
      homebrew("eieMo7UUWg27BVBE"), // Boots, soft leather
      homebrew("rRdZg0UFfrxGvrei"), // Cape, short
      homebrew("3URhbFTFbMY5ZeDQ"), // Coat
      homebrew("zWHbZerSLgI6O4Hn"), // Dress
      homebrew("rMQZCGlfE8aJscaQ"), // Habit
      homebrew("onHoiYdby4VmpfHa"), // Robe
      homebrew("EvJ4wHAyVYzkzNrs"), // Tunic
      homebrew("lA8F69O7VD9hoC6G"), // Boots, hard leather
      homebrew("pXAoLI8QaL1IWsDw"), // Cape, long
      gear("kWbQCs7Zt0qwwh8F"), // Gloves
      homebrew("eg4aWyudRdye2Izr"), // Shirt, silk
      homebrew("hzpzcdcEWTtlBTa0"), // Skirt, silk
      homebrew("meTlmjzi23j0Rz27"), // Boots, reinforced
      homebrew("Y5RGgLRaIhaDEpJD"), // Bodice
      homebrew("QBPi4gjbAhtx6Fki"), // Hat, elegant
      homebrew("mp78Zf52ICWXRHFy"), // Kilt
      homebrew("DR1UTmsBr9jhsIxs"), // Tunic, silk
      homebrew("Q1qn89wCidZZUVIt"), // Doublet
      homebrew("qNlLMFkfMXkTrTDw"), // Dress, silk
      homebrew("HoBDFMOaB541FfXP"), // Ballgown, simple
      homebrew("IGqNrkBlwLnSAtUK"), // Coat, fur
      homebrew("ThaCkyMhCmC10X1u")  // Ballgown, extravagant
    ]),
    tavern: shelf("CAIRN.Store.Default.Tavern", [
      homebrew("0CmxUSfbtPFMBz5v"), // Bread
      homebrew("gJCzHcBuasyyBlau"), // Inn Meal, poor
      homebrew("3e21dtes7VRG0qH9"), // Mead
      homebrew("c93L1fsC1rF8jdcO"), // Beer
      homebrew("hR7BHskkiM7a7CIz"), // Cheese, local
      homebrew("LV60yBoT2XGZzV1r"), // Inn Meal, good
      homebrew("nsJia5RktOY3WcwK"), // Wine, poor
      homebrew("5x23b7Ip47SQC0Gq"), // Inn Meal, superb
      homebrew("ApRK0r0xGDIKrJyX"), // Moonshine
      homebrew("34aQvMqgb8HP8fvp"), // Roast Chicken
      homebrew("JRaB1j5guyzAB86d"), // Roast Goose
      homebrew("NMJaebAwQWRvS9sv"), // Rum
      homebrew("DFozNyWpcuFSc7hR"), // Wine, good
      homebrew("FLJ7z1Py8d1ebaZo")  // Brandy
    ])
  };
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

/** The settings form's write: the four values it holds, the shelves untouched. */
export function withSettings(store, { name, sellRatio, buyRatio, visitable }) {
  return { ...store, name, sellRatio, buyRatio, visitable: !!visitable };
}

/**
 * The stores a client may pick from, by id, in the setting's order. The Warden has every one. A
 * shopper has the stores open to visits, and the one the Warden put on their screen with "Open to
 * players" (`pushed`) whether it is open to visits or not — for as long as the window it opened
 * stays up.
 * @param {Record<string, {visitable?: boolean}>} stores
 * @param {{isGM: boolean, pushed?: string|null}} who
 * @returns {string[]}
 */
export function storeChoices(stores, { isGM, pushed = null }) {
  return Object.keys(stores).filter((id) => isGM || stores[id].visitable || id === pushed);
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
    // Part of the body is not for sale, whatever a Warden once priced it at. Nor is a relic its
    // holder does not know: its price is part of what is hidden, and selling something you cannot
    // name is a scene for the Warden to play, not a till.
    if (item.type === "coin" || !(item.system?.cost > 0) || item.system?.bodily || item.system?.unknown) continue;
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

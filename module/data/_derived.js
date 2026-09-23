/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { GOLD_PETTY_THRESHOLD } from "../constants.js";

/**
 * Shared derived-data maths for the actor models. Each rule here is a specific 2e statement —
 * see `srd-2e/players-guide/core-rules.md` and `character-creation.md`.
 */

/**
 * Slots one item occupies — its own `slots`, which is 0 for a *petty* thing, 2 for a *bulky* one
 * and whatever the Warden indicated for the rare thing that is neither. A `fatigue` item is always
 * exactly one slot regardless of anything (`core-rules.md`: "Each Fatigue occupies one slot").
 *
 * Nothing here counts copies. 2e's inventory is a list of items — "Most items take up one slot
 * unless otherwise indicated" (`srd-2e/players-guide/character-creation.md`) — so a second Rope
 * is a second entry, not a number on the first.
 * @param {Item} item
 * @returns {number}
 */
export function slotsForItem(item) {
  if (item.type === "fatigue") return 1;
  // A Background is a thing the character IS, not a thing they carry. It lives on the Actor as an
  // embedded Item so its name list, starting gear and d6 tables travel with them, and it must
  // never take one of the ten slots. A feature is a rule the actor has, not a thing they carry,
  // a scar is something that HAPPENED to them and a growth is what they became — records, with
// no weight and nothing to drop.
  if (item.type === "background" || item.type === "feature" || item.type === "scar"
      || item.type === "growth") return 0;
  const sys = item.system;
  // Set aside: written down, but not under direct possession — a sword dropped on the dungeon
  // floor, a crest left at the inn. It is asked first, because a thing that does not move when
  // the character moves cannot cost them a slot, whatever else is true of it.
  if (!sys.carried) return 0;
  // A sack of coin weighs by what is in it — "A bag of coins worth less than 100gp is *petty* and
  // does not occupy a slot" (`character-creation.md`), one slot per hundred above that. Computed
  // from `value` rather than read from the `slots` its model derives, because `CairnItem#_preUpdate`
  // weighs a raw candidate that has never been prepared.
  if (item.type === "coin") return goldSlots(sys.value);
  // A container that does not take slots hauls itself: a Mule walks beside you, a wagon rolls.
  // `GearData#prepareBaseData` already holds such a thing set aside, so on a prepared document
  // this is the same answer twice — but `CairnItem#_preUpdate` weighs a raw candidate that has
  // never been prepared, and there this is the only line that knows.
  if (sys.capacity > 0 && !sys.takesSlots) return 0;
  // The thing's own answer. *petty* and *bulky* are readings of this number, not inputs to it
  // (`data/_fields.js#itemBaseFields`), so there is nothing here to weigh them against.
  // Except a scroll: "They are petty" (`core-rules.md` → Scrolls) by rule, on the raw candidate
  // `CairnItem#_preUpdate` weighs as much as on the prepared model `GearData#prepareBaseData`
  // zeroes — a scroll whose source still says 1 was refused a tick on a full body.
  if (item.type === "gear" && sys.magic === "scroll") return 0;
  return sys.slots ?? 1;
}

/**
 * One level of nesting, and no more: a thing that holds things may go into a container only if
 * that container is itself on the body. Bag in mule: yes. Bag in bag in mule: no. Ordinary items
 * go anywhere. Here rather than on the document so the rule can be run from Node.
 * @param {Actor} parent  The actor whose collection both documents are in.
 * @param {{id?: string, system?: object}} doc  The item being put somewhere.
 * @param {string} containerId  `system.container` as it will stand after the write.
 * @returns {string|null}  The refusal's i18n key, or null when the move is allowed.
 */
export function nestingRefusal(parent, doc, containerId) {
  if (!containerId) return null;
  if (containerId === doc.id) return "CAIRN.Notify.ContainerInItself";
  const target = parent.items.get(containerId);
  if (!target?.system.isContainer) return "CAIRN.Notify.NotAContainer";
  if ((doc.system?.capacity ?? 0) > 0 && target.system.container) return "CAIRN.Notify.NestingTooDeep";
  return null;
}

/**
 * Total slots used by items carried ON THE BODY. A sack of coin is one of them.
 *
 * Anything inside a container is skipped. Filtering by `type` cannot do this: a sword in a mule is
 * a `weapon` exactly like a sword on the belt, and only `system.container` tells them apart. Every
 * reader of this number — the ten-slot cap, the encumbrance rule, the ledger — depends on the
 * distinction being made here and nowhere else.
 * @param {Iterable<Item>} items
 * @returns {number}
 */
export function sumUsedSlots(items) {
  let n = 0;
  for (const item of items) {
    if (item.system.container) continue;
    n += slotsForItem(item);
  }
  return n;
}

/**
 * Slots a sack of coin occupies (`data/item-coin.js`). Under 100gp it is *petty* (0 slots). At and
 * above 100gp it counts; the common Cairn reading is one slot per 100gp. RAW only fixes the
 * *petty* boundary — a Warden who wants a different weight edits this one line (alpha: §0).
 * @param {number} gold
 * @returns {number}
 */
export function goldSlots(gold) {
  const g = gold ?? 0;
  if (g < GOLD_PETTY_THRESHOLD) return 0;
  return Math.floor(g / GOLD_PETTY_THRESHOLD);
}

/**
 * Armour from **equipped** items, capped at 3 (`core-rules.md`: "cannot have more than 3
 * Armor"). Shields and helmets only count while held or worn — that is exactly `equipped`. Any
 * gear may carry an `armor` value (a +1 Armor relic as much as a Gambeson), so nothing is
 * filtered by what it is, only by whether it is worn.
 * @param {Iterable<Item>} items
 * @returns {number}
 */
export function sumEquippedArmor(items) {
  let n = 0;
  for (const item of items) {
    if (item.system?.equipped) n += (item.system.armor ?? 0);
  }
  return Math.min(n, 3);
}

/**
 * Lay an ordered list of occupancy units out over numbered inventory slots.
 *
 * Pure, and deliberately separate from the sheet: this is the arithmetic that decides what the
 * printed sheet's ten ruled lines say, and it has to stay in step with `slotsForItem` above. The
 * sheet supplies `units` in display order — each `{ payload, slots }`, where `slots` is
 * `slotsForItem(item)` for an item and `1` per coin slot — and gets back one row per numbered
 * line, including the empty ones. An item occupying more than one slot produces a first row and
 * then continuation rows, never a repeat.
 *
 * Exactly `slotsMax` rows, always. There is no overflow: the cap is enforced before anything is
 * written (`CairnItem#_preCreateOperation`, `#_preUpdate`, `CairnActor#_preUpdate`), so a
 * character cannot be carrying more than fits, and a picture of "more than fits" would only ever
 * describe a state the rules forbid.
 *
 * @param {Array<{payload: object, slots: number}>} units  Occupancy, in display order.
 * @param {number} slotsMax  The actor's capacity.
 * @returns {object[]}  One row per numbered line, `slotsMax` of them.
 */
export function layoutSlots(units, slotsMax) {
  const occupied = [];
  for (const { payload, slots } of units) {
    // `spans` travels with every row of a unit, so a sheet can draw a multi-slot item as one
    // block as tall as its reach instead of a row plus a continuation mark. `joined` marks the
    // rows that have another row of the SAME unit under them — which is where the ledger's ruled
    // line has to be left out, so the block reads as one entry rather than as two lines that
    // happen to touch. The unit's last row is not joined: the rule under it separates the block
    // from whatever is carried next, and without it the ledger loses a line it needs.
    for (let i = 0; i < slots; i++) {
      occupied.push({ ...payload, continuation: i > 0, joined: i < slots - 1, spans: slots });
    }
  }

  const rows = [];
  for (let i = 0; i < slotsMax; i++) rows.push({ n: i + 1, ...(occupied[i] ?? { empty: true }) });
  return rows;
}

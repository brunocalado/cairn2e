/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { slotsForItem, nestingRefusal } from "../data/_derived.js";
import { placeOf, sackAt } from "../coin-rules.js";
import { SYSTEM_ID, DEFAULT_ARTWORK, GEAR_ARTWORK } from "../constants.js";
import { revertScarGain } from "../scars.js";
import { revertGrowthGain } from "../growth.js";

/**
 * "Not enough room" — one message for every refused write, naming what would not fit.
 * @param {string} name  What was being put on the character.
 * @param {number} need  Slots it wanted.
 * @param {number} free  Slots there were.
 */
export function warnNoRoom(name, need, free) {
  ui.notifications.warn(game.i18n.localize("CAIRN.Notify.NoRoom", { name, need, free }));
}

/**
 * The Cairn 2e Item.
 *
 * Shape and the petty / bulky / uses rules live on the DataModels (`module/data/item-*.js`).
 * This class holds what needs the parent Actor or a world setting: whether the item can be
 * equipped (not while it sits in a `container`), the slot cap, the one-level nesting rule — and
 * the rule that a container takes its contents with it when it goes.
 *
 * The cap is enforced HERE, on the document, and nowhere else: a character can never come to
 * hold more than the actor's `slotsMax` worth of things, because every path that would put more on
 * them — a drop, a create, a Fatigue, a *petty* flag switched off, a *bulky* one switched on — is a
 * creation or an update of an embedded Item, and both are refused below before the database
 * sees them. A sheet that wanted its own check would only be repeating this one.
 *
 * The same two methods enforce a container's capacity, against a different budget: an item with
 * `system.container` set is measured against that container's free slots instead of the body's
 * ten. Contents are siblings in the actor's own collection, so without `#budgetFor` below a
 * mule's six items would be six items on the character's back.
 */
/**
 * The subtypes that may be created only through the control that grants them, and the warning a
 * refusal prints. The operation carries `{ [SYSTEM_ID]: { <type>: true } }` when it came from
 * that control (`CairnItem._preCreateOperation`).
 */
const GRANTED_ONLY = {
  scar: "CAIRN.Notify.ScarNotGiven",
  growth: "CAIRN.Notify.GrowthNotGiven"
};

export class CairnItem extends Item {
  /**
   * @override — the *Create Item* dialog offers what a Warden AUTHORS: gear, a background, a
   * feature. Three subtypes are left out.
   *
   * A Scar or a Growth would be refused on creation anyway (`_preCreateOperation`): each is made
   * through the character's own control, and an option that only ever answers with a warning is a
   * question the dialog should not ask. A Fatigue has nothing to author — no editable property at all — and the
   * sheet's own track is the one control that adds it (a Warden who needs one on a character
   * presses the circle on the Inventory tab), so the dialog would offer a second door to the same
   * room. It is only hidden, not refused: a Fatigue dropped from elsewhere is a Fatigue like any
   * other, and the ten-slot cap already answers for whether it fits.
   */
  static async createDialog(data = {}, createOptions = {}, dialogOptions = {}) {
    const hidden = new Set([CONST.BASE_DOCUMENT_TYPE, "scar", "fatigue", "growth"]);
    const types = dialogOptions.types ?? this.TYPES.filter((t) => !hidden.has(t));
    return super.createDialog(data, createOptions, { ...dialogOptions, types });
  }

  /**
   * @override — the image a new Item wears, chosen by its subtype
   * (`constants.js#DEFAULT_ARTWORK`) and, for a `gear`, by the fields that say what kind of thing
   * it is (`#GEAR_ARTWORK`).
   *
   * This is not a create hook: core makes it the `img` field's own `initial`
   * (`common/documents/item.mjs` — `initial: data => this.implementation.getDefaultArtwork(data).img`),
   * so it answers on every path that builds an Item and only when none was supplied. A subtype
   * with no entry keeps core's bag, which is the right answer for a subtype nobody has drawn yet.
   */
  static getDefaultArtwork(itemData) {
    const type = itemData?.type;
    if (type === "gear") return { img: GEAR_ARTWORK[CairnItem.#gearKind(itemData.system ?? {})] };
    return { img: DEFAULT_ARTWORK.Item[type] ?? super.getDefaultArtwork(itemData).img };
  }

  /**
   * Which of the seven kinds a gear's own fields make it — the same question the Create Item
   * prompt asks with a dropdown, asked of the data instead, so a weapon dragged from a macro or
   * an import looks like a weapon and not like a sack.
   *
   * The physical axis is read before the magical one because it is the one you can see: A Blade
   * Called Hope is a d6 sword AND a relic (`srd-2e/wardens-guide/reliquary.md`), and it is a
   * blade on the table. A container is asked first because it is neither — the model clears a
   * container's die and armour outright (`data/item-gear.js#prepareBaseData`).
   * @param {object} system  The gear's source `system` data, which may be partial.
   * @returns {string} a key of `GEAR_ARTWORK`
   */
  static #gearKind(system) {
    if ((system.capacity ?? 0) > 0) return "container";
    if (system.damage) return "weapon";
    if ((system.armor ?? 0) > 0) return "armor";
    if (system.magic && system.magic !== "none") return system.magic;
    return "gear";
  }

  /**
   * The free slots a document is measured against: the container it names, or the body's ten.
   * A pointer at a container that is not there is worth no room at all, rather than silently
   * falling back to the body.
   * @param {Actor} parent  The actor the item is (or is becoming) part of.
   * @param {string} containerId  `system.container` as it will stand after the write.
   * @returns {number}
   */
  static #budgetFor(parent, containerId) {
    if (!containerId) return parent.system.slotsFree;
    const container = parent.items.get(containerId);
    if (!container?.system.isContainer) return 0;
    return Math.max(0, container.system.capacity - container.system.contentsSlots);
  }

  /**
   * @override — a creation that would not fit is dropped from the batch.
   *
   * Batch-wise rather than per document, because ten Fatigue created in one call each see the
   * same free count in `_preCreate` and all think they fit. Here the batch is walked in order
   * with a running count, so what is created is exactly the prefix that fits, and the actor is
   * valid whichever way the call came in. A character being CREATED with items (the generator,
   * the Kettlewright import) is not a parent in any collection yet and is left alone — the
   * creators build legal characters, and their items are the only way to reach this branch.
   */
  static async _preCreateOperation(documents, operation, user) {
    if ((await super._preCreateOperation(documents, operation, user)) === false) return false;

    // A Scar is taken and a Growth is earned; neither is given. The only things that may create
    // one are the character's own controls — the Scars window and the Growth zone's add — which
    // say so on the operation. Every other path — a drag from the sidebar or a compendium, a
    // macro, the directory — is refused, and BEFORE the parent test, so a world-level one cannot
    // exist either. The reason is not tidiness. A dropped record is a copy, and its `outcome`
    // claims a change that was never applied to THIS character — so deleting it later would put
    // back a maximum they never gained (`revertScarGain`, `revertGrowthGain`). Refusing it here
    // is what keeps every one of them on a sheet honest.
    for (const doc of [...documents]) {
      const notice = GRANTED_ONLY[doc.type];
      if (!notice || operation[SYSTEM_ID]?.[doc.type] === true) continue;
      ui.notifications.warn(game.i18n.localize(notice));
      documents.splice(documents.indexOf(doc), 1);
    }
    if (!documents.length) return false;

    const parent = operation.parent;
    if (!parent || !parent.collection?.has(parent.id)) return;

    // Where a thing may go is a rule for every actor; how much fits is the character's alone.
    for (const doc of [...documents]) {
      const refusal = nestingRefusal(parent, doc, doc.system?.container ?? "");
      if (!refusal) continue;
      ui.notifications.warn(game.i18n.localize(refusal, { name: doc.name }));
      documents.splice(documents.indexOf(doc), 1);
    }
    if (!documents.length) return false;

    // One sack of coin per place — the body, each container, Belongings (`data/item-coin.js`).
    // Two sacks of 99 would weigh nothing where one of 198 weighs a slot, so a second one where
    // one already sits is refused; a writer that wants coin THERE adds to the sack that is there
    // (`module/coin.js#putCoin`). Checked within the batch too, so two sacks created together
    // cannot both land in one place.
    const taken = new Set(parent.items.filter((i) => i.type === "coin").map(placeOf));
    for (const doc of [...documents]) {
      if (doc.type !== "coin") continue;
      const place = placeOf(doc);
      if (taken.has(place)) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CoinAlreadyThere"));
        documents.splice(documents.indexOf(doc), 1);
        continue;
      }
      taken.add(place);
    }
    if (!documents.length) return false;
    if (parent.type !== "character") return;

    // One running budget per destination — the body under "", a container under its id — so a
    // batch that fills a Backpack cannot also be charged against the ten.
    const free = new Map();
    for (const doc of [...documents]) {
      const where = doc.system?.container ?? "";
      if (!free.has(where)) free.set(where, CairnItem.#budgetFor(parent, where));
      const need = slotsForItem(doc);
      if (need > free.get(where)) {
        warnNoRoom(doc.name, need, free.get(where));
        documents.splice(documents.indexOf(doc), 1);
        continue;
      }
      free.set(where, free.get(where) - need);
    }
    if (!documents.length) return false;
  }

  /**
   * @override — an update that would grow the item past what is free is refused whole.
   *
   * *petty* off, *bulky* on: each is more slots than before, and the difference is what has to
   * fit. A change that shrinks the item or leaves it the same size always passes.
   *
   * Moving between a container and the body is the one case where an unchanged size still has to
   * be measured: the whole item arrives somewhere it was not, so the budget it is charged against
   * is a different one and its full cost has to fit there.
   */
  async _preUpdate(changes, options, user) {
    if ((await super._preUpdate(changes, options, user)) === false) return false;
    // Setting a thing aside takes it out of your hands. A shield left on the floor that stayed
    // `equipped` would keep giving its Armor to the character who walked away from it
    // (`data/_derived.js#sumEquippedArmor`), and a spellbook on a shelf would still be readable.
    // Written here rather than in the sheet's handler so that a macro or an import cannot reach
    // the same state by another road.
    if (changes.system?.carried === false) changes.system.equipped = false;
    // Stowed is not held either: a shield in the pack gives no Armor and a spellbook in it cannot
    // be read (`core-rules.md` → Armor: "only while the item is held or worn"). Cleared on the
    // write so the stored value never claims what the row no longer offers to toggle, and taking
    // the thing back out does not silently re-arm it. Before the nesting refusal: a refused
    // update writes nothing at all. Gear alone has the field: a stowed sack of coin has nothing
    // to clear.
    if (this.type === "gear" && changes.system?.container) changes.system.equipped = false;
    const parent = this.parent;
    if (!parent || !changes.system) return;

    const after = { id: this.id, type: this.type, system: foundry.utils.mergeObject(this.system.toObject(), changes.system, { inplace: false }) };
    const was = this.system.container ?? "";
    const now = after.system.container ?? "";
    if (now !== was) {
      const refusal = nestingRefusal(parent, after, now);
      if (refusal) {
        ui.notifications.warn(game.i18n.localize(refusal, { name: this.name }));
        return false;
      }
    }
    // A sack moving — into a container, out of one, set aside, taken back — may not land where a
    // sack already is (the one-per-place rule of `_preCreateOperation`). The sheet's drop never
    // reaches this: it moves coin by amount through `module/coin.js#moveCoin`, which adds to the
    // sack at the destination. This is the net under a macro or a bare update.
    if (this.type === "coin") {
      const there = placeOf(after);
      if (there !== placeOf(this)) {
        const other = sackAt(parent.items, there);
        if (other && other.id !== this.id) {
          ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CoinAlreadyThere"));
          return false;
        }
      }
    }
    if (parent.type !== "character") return;

    const added = now === was ? slotsForItem(after) - slotsForItem(this) : slotsForItem(after);
    if (added <= 0) return;
    const free = CairnItem.#budgetFor(parent, now);
    if (added > free) {
      warnNoRoom(this.name, added, free);
      return false;
    }
  }

  /**
   * @override — a container takes its contents with it.
   *
   * The ids are folded into the same operation rather than deleted afterwards, so the container
   * and what it held go in one database write and there is no instant in which six items name a
   * container that is not there. Moving them back onto the body is not an option: six items
   * returning to a body with no free slot would break the "no overflow" invariant the ledger
   * rests on (`data/_derived.js#layoutSlots`).
   */
  static async _preDeleteOperation(documents, operation, user) {
    if ((await super._preDeleteOperation(documents, operation, user)) === false) return false;
    const parent = operation.parent;
    if (!parent) return;
    const doomed = new Set(documents.filter((d) => d.system.isContainer).map((d) => d.id));
    if (!doomed.size) return;
    for (const item of parent.items) {
      if (doomed.has(item.system.container) && !operation.ids.includes(item.id)) operation.ids.push(item.id);
    }
  }

  /**
   * @override — deleting a scar or a growth puts back what it did to the character's maximum.
   *
   * By the delta the record itself holds, not by replaying the ones that remain: see
   * `module/gains.js#revertUpdate`. A scar whose gain was never taken wrote nothing and puts
   * nothing back, and one whose roll lost recorded an equal pair, which reverts to itself. Most
   * growths are in the first case — the Growth chapter is mostly prose with no number in it.
   *
   * `_preDelete` rather than `_onDelete`: it runs on the requesting client alone, so the actor is
   * written once however many people have the sheet open.
   */
  async _preDelete(options, user) {
    if ((await super._preDelete(options, user)) === false) return false;
    if (this.type === "scar") await revertScarGain(this);
    if (this.type === "growth") await revertGrowthGain(this);
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    const sys = this.system;
    // Stowed in a container is not to hand: a sword in the mule's packs cannot be the sword the
    // character is holding.
    const stowed = !!sys.container;
    // Held in the hand or worn: a die, an armour value, or a spellbook (held in both hands to
    // cast). Never a container — a bag is on the body, not in hand, and has none of the
    // behaviours equipping switches on; and a mule would otherwise wear an equip hand.
    const holdable = !!sys.damage || (sys.armor ?? 0) > 0 || sys.magic === "spellbook";
    // ...and set aside is not to hand either: a sword on the dungeon floor is in nobody's grip.
    sys.isEquipable = this.type === "gear" && holdable && !sys.isContainer && !stowed && sys.carried;
    // Whether "is this under your direct possession?" is a question this thing can be asked at
    // all. A Fatigue is not a possession and can never be put down — that is the whole of the
    // deprivation rule. A stowed thing is answered for by its container. And a container that
    // hauls itself was never in anyone's hands, so it has no second state to toggle into.
    // A sack of coin can be set aside too — the treasure left at camp is the oldest Belonging
    // there is — and, being gear-shaped in no other way, is never in anyone's grip.
    sys.isStashable = (this.type === "gear" && !stowed && !(sys.isContainer && !sys.takesSlots))
      || (this.type === "coin" && !stowed);
    sys.hasUses = (sys.uses?.max ?? 0) > 0;
  }
}

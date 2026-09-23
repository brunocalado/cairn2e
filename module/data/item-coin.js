/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { containerField } from "./_fields.js";
import { goldSlots } from "./_derived.js";

const fields = foundry.data.fields;

/**
 * A sack of coin. Gold is Items, and a character's `system.gold` is the SUM of the sacks they own
 * (`actor-character.js#prepareDerivedData`), wherever each sits — on the body, in the Backpack,
 * on the mule, left at an inn.
 *
 * The SRD's one sentence on coin is about a thing, not a number: "A bag of coins worth less than
 * 100gp is *petty* and does not occupy a slot" (`srd-2e/players-guide/character-creation.md`
 * § Inventory Slots). Read literally, a bag goes wherever a bag goes, and the ten-slot rule, a
 * container's capacity and Belongings apply to it as they apply to a sword — with no coin-shaped
 * exception anywhere. That is why this is a subtype rather than a `gold` field on the character
 * (which had to be clamped to the free slots, and could never be put on a mule) and rather than
 * a `gear` with a value (which would carry a die, an armour value, a magic axis and a typed
 * `slots` that all had to be blanked).
 *
 * There is ONE sack per place — the body, each container, Belongings — enforced by the document
 * (`documents/item.js#_preCreateOperation`). Two sacks of 99 would weigh nothing where one of 198
 * weighs a slot, so the rule could otherwise be gamed by splitting; and every reader — the ledger,
 * the spend order, the drop prompt — would have to sum a list instead of reading a number.
 */
export class CoinData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Coin"];

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      // Gold pieces in this one sack. Its weight is READ off this number (`_derived.js#slotsForItem`),
      // never stored beside it: under 100 it is *petty*, and every hundred is a slot.
      value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      container: containerField(),
      // Under direct possession — a sack left at camp is a Belonging like anything else set aside.
      carried: new fields.BooleanField({ initial: true })
    };
  }

  prepareBaseData() {
    // A stowed sack is answered for by its container, exactly as a stowed gear is
    // (`item-gear.js#prepareBaseData`).
    if (this.container) this.carried = true;
    this.slots = goldSlots(this.value);
    // Read by `item-tags.hbs` like any other item's; a sack is never *bulky* — its weight is its
    // own tag, "250 gp", which says more than the word would.
    this.petty = this.slots === 0;
    this.bulky = false;
    this.isCoin = true;
  }
}

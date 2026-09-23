/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { abilitiesField, resourceField } from "./_fields.js";
import { sumUsedSlots, sumEquippedArmor } from "./_derived.js";
import { goldTotal } from "../coin-rules.js";
import { CONDITION, MAX_SLOTS } from "../constants.js";

const fields = foundry.data.fields;

/** One Background table result: the question the table asks and the answer drawn. Both are plain
 *  text — a table result is authored as HTML in its pack, but what a character keeps is the
 *  sentence it was given, and it is read, edited and printed as one
 *  (`character-generator.js#toPlainText`). */
function backgroundTableField() {
  return new fields.SchemaField({
    question: new fields.StringField({ required: true, blank: true }),
    answer: new fields.StringField({ required: true, blank: true })
  });
}

/**
 * Player Character.
 *
 * 2e creation is background-driven (`srd-2e/players-guide/character-creation.md`): roll or choose
 * a Background, take its name/gear/two d6 tables, roll 3d6 per attribute (swap any two), 1d6 HP,
 * the eight d10 traits, a d20 Bond, age 2d20+10, and — if youngest — a d20 Omen.
 *
 * The upstream `features` array (a homegrown mini-effects system) is **gone**: stat changes are
 * ActiveEffects now, and descriptive text is an item or one of the Identity fields.
 *
 * Backpack: every PC starts with a Backpack holding six slots. The character generator creates it
 * as an embedded Item of type `container`; what it holds are sibling Items pointing back at it
 * through `system.container`, and none of them counts against `slots.max` below, which is the
 * character's own ten body slots only.
 *
 * There is no `background` field. 2e creation is background-driven and a background carries a
 * name list, starting gear and two d6 tables — none of which survives being typed into a string.
 * The chosen Background is an embedded Item of type `background`, dropped onto the sheet, and it
 * occupies no slot (`_derived.js#slotsForItem`).
 */
export class CharacterData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Character"];

  static defineSchema() {
    return {
      abilities: abilitiesField(),
      hp: resourceField(0, 0),
      // No `gold` field: coin is Items (`item-coin.js`), and the total is derived below.

      // Plain text, like the Omen and the two table answers below: a drawn line is a sentence
      // the player reads and edits, never a document with markup in it.
      bond: new fields.StringField({ required: true, blank: true }),

      // An Omen is drawn only by the YOUNGEST character in a party (`srd-2e/players-guide/
      // character-creation.md`), so most characters have none and a blank Omen heading on their
      // sheet is a question the rules already answered. The flag carries that: it is what the
      // sheet and the edit form read to decide whether the section exists at all, and it is not
      // derived from the text being empty — a character who HAS an Omen and has not written it
      // down yet still has one.
      omen: new fields.SchemaField({
        enabled: new fields.BooleanField({ required: true, initial: false }),
        text: new fields.StringField({ required: true, blank: true })
      }),
      age: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      // The eight d10 trait tables.
      traits: new fields.SchemaField({
        physique: new fields.StringField({ required: true, blank: true }),
        skin: new fields.StringField({ required: true, blank: true }),
        hair: new fields.StringField({ required: true, blank: true }),
        face: new fields.StringField({ required: true, blank: true }),
        speech: new fields.StringField({ required: true, blank: true }),
        clothing: new fields.StringField({ required: true, blank: true }),
        virtue: new fields.StringField({ required: true, blank: true }),
        vice: new fields.StringField({ required: true, blank: true })
      }),

      // The two d6 tables of the Background, as rolled at creation: what each asked and what
      // it said. Two slots, not an array — every 2e Background has exactly two tables. The Items
      // and gold the result granted are already on the sheet; this is the sentence they came
      // from, and it is a sentence: plain text, so no `system.json#htmlFields` path is needed.
      backgroundTables: new fields.SchemaField({
        first: backgroundTableField(),
        second: backgroundTableField()
      }),

      // Everything 2e gives a character that this model has no field of its own for: the career
      // and day rate of a hireling a player took over (`srd-2e/players-guide/core-rules.md`
      // § Character Death), the prose written about them while they were the Warden's, and the
      // Features they carried as an NPC. Plain text like the Bond and the table answers above,
      // and for the same reason — what a character keeps is the sentence, not a document.
      description: new fields.StringField({ required: true, blank: true })
    };
  }

  /**
   * Derived values that depend on embedded items and world settings.
   *
   * Crucially, this **never writes `hp.value`**. Upstream set `this.system.hp.value = 0` when
   * encumbered or panicked, which overwrote the *stored* HP with a *derived* zero — so freeing a
   * slot left the character stuck at 0. Here the stored value is untouched and the roll/sheet code
   * reads `hp.effective` instead.
   */
  prepareDerivedData() {
    const items = this.parent.items;

    // Coin is Items (`item-coin.js`); the sum is every sack the character owns, wherever it sits
    // — on the body, in a mule, left at an inn — because "how much gold do I have" is asked of
    // the whole character, and "how much can I reach" is a question for whoever is spending it
    // (`coin-rules.js#spendPlan`). A body sack is one of the items `sumUsedSlots` weighs, so coin
    // needs no term of its own in the count any more.
    this.gold = goldTotal(items);
    this.slotsUsed = sumUsedSlots(items);
    // Ten inventory slots — a flat 2e rule, not a field: there is no per-world or per-character
    // house rule, and every write that would take an eleventh is refused before it lands
    // (`documents/item.js`, `documents/actor.js`).
    this.slotsMax = MAX_SLOTS;
    this.slotsFree = Math.max(0, this.slotsMax - this.slotsUsed);

    // Filling all slots (or Panic) reduces the PC to 0 HP for as long as the condition holds.
    this.encumbered = this.slotsUsed >= this.slotsMax;

    this.armor = sumEquippedArmor(items);
    this.armorTotal = this.armor;

    // Deprived and Panicked are not stored on this model: the ActiveEffect is the only place a
    // condition lives, so the sheet chip and the token HUD are two views of one object and cannot
    // drift. They stay readable at `system.deprived` / `system.panicked` for every existing reader.
    // Reading `statuses` here is safe because `prepareEmbeddedDocuments` fills it via
    // `applyActiveEffects("initial")` before this method runs (client-document.mjs).
    const statuses = this.parent.statuses;
    this.deprived = statuses.has(CONDITION.DEPRIVED);
    this.panicked = statuses.has(CONDITION.PANICKED);

    this.hp.effective = (this.encumbered || this.panicked) ? 0 : this.hp.value;
  }
}

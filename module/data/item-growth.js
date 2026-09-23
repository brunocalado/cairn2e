/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * A permanent change a character underwent (`srd-2e/wardens-guide/growth.md`).
 *
 * 2e files Scars under Growth — "with some notable exceptions (such as Scars), growth should
 * always stem from a character's experiences in the game world" — so a Scar is the table-driven
 * kind and this is the kind the Warden grants from what happened in play. They share a tab and
 * they share the arithmetic in `module/gains.js`; they are separate subtypes because a Scar
 * carries the row it came from and a Growth carries a checklist.
 *
 * No `itemBaseFields()`, for the same reason `ScarData` has none: a growth is not carried, so
 * *petty*, *bulky*, `equipped` and `container` would be fields nothing reads, and
 * `_derived.js#slotsForItem` returns 0 for it.
 *
 * Like a Scar, this is created only through the character sheet's own control and refused on
 * every other path (`documents/item.js#_preCreateOperation`). A growth dropped from elsewhere is
 * a copy of a record, and its `outcome` would claim a change never applied to THAT character.
 */
export class GrowthData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Growth"];

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      // What this growth gave, in words. The Growth chapter's examples are mostly this — a save no
      // longer asked, a food no longer needed, a Spellbook read under duress — and none of it is a
      // number `outcome` could hold. Plain text: one or two dictated sentences, not a document.
      gained: new fields.StringField({ required: true, blank: true }),
      // What this growth did to one maximum, if it moved a number at all — most do not, and the
      // description carries the rest. A RECORD, never the value that rules: the actor's own
      // stored maximum is what rules, and this says what to put back when the growth is deleted.
      // One change and not a list: a growth that moves two numbers is written as two growths.
      outcome: new fields.SchemaField({
        attr: new fields.StringField({
          required: true,
          blank: true,
          initial: "",
          choices: ["", "hp", "STR", "DEX", "WIL"]
        }),
        from: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 }),
        to: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0 })
      }),
      // The gain has been applied to the actor. A growth that is pure fiction stays false forever,
      // and that is not a pending state — it is a growth with no number in it.
      resolved: new fields.BooleanField({ initial: false }),
      // The Warden's checklist, from the Faction Advancement and Bond-resolution examples in the
      // Growth chapter. Ticking one is a session's work, not a rule the system enforces: nothing
      // here gates the outcome on the list being complete, because the SRD states no such rule.
      milestones: new fields.ArrayField(new fields.SchemaField({
        text: new fields.StringField({ required: true, blank: true }),
        done: new fields.BooleanField({ initial: false })
      }))
    };
  }
}

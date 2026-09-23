/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * One row of the Scars table as it happened to one character
 * (`srd-2e/players-guide/core-rules.md` → Scars).
 *
 * No `itemBaseFields()`, for the same reason `FeatureData` has none: a scar is not carried, so
 * *petty*, *bulky*, `equipped` and `container` would be fields nothing reads, and
 * `_derived.js#slotsForItem` returns 0 for it.
 *
 * `outcome` is a single change, not a list: no row of the table alters more than one attribute.
 * It is a RECORD — what rules is the actor's own stored maximum, and this says what this scar did
 * to it, so deleting the scar can put it back.
 */
export class ScarData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Scar"];

  static defineSchema() {
    return {
      // The row, which is the HP lost in the attack that caused it: "look up the result on the
      // table below based on the *amount of HP lost in the attack*".
      entry: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1, max: 12 }),
      description: new fields.HTMLField({ required: true, blank: true }),
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
      // The gain has been taken. False while the fiction has not allowed it yet ("once
      // mended", "when you get over it"); true with `outcome.from === outcome.to` when the roll
      // lost or the WIL save failed, which is a different thing from still pending.
      resolved: new fields.BooleanField({ initial: false })
    };
  }
}

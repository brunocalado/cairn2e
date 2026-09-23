/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * A named rule an actor has — the bullets under a bestiary statblock ("Boggarts have true names…",
 * "Magic: …", "Critical Damage: …"), a hireling's trade, anything that is not equipment.
 *
 * No `itemBaseFields()`: a feature is not carried, so *petty*, *bulky* and `equipped` would be
 * fields nothing reads, and `_derived.js#slotsForItem` returns 0 for it.
 */
export class FeatureData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Feature"];

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      // A Critical Damage clause — the `**Critical Damage**: …` bullet under a bestiary
      // statblock. The words are drawn by the sheet; the flag only says which features get them.
      critical: new fields.BooleanField({ initial: false })
    };
  }
}

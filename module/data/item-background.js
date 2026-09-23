/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * A Background (`srd-2e/backgrounds/*.md`) — 20 of them, each a name list, a starting-gear list,
 * and two d6 tables.
 *
 * Stored as an **Item subtype** so the character generator can read the gear list and table
 * references programmatically, and so it sits on the character sheet. The descriptive blurb is
 * `description` HTML; a Journal page can mirror it for reading.
 *
 * `startingGear` and `tables` are lists of compendium uuids, filled by dropping an Item or a
 * RollTable on the sheet. They used to be SRD text that the generator parsed on every character
 * creation, and a missed `(3 uses)` produced a wrong Item and no error anywhere. The parse now
 * happens once, at authoring time, and what it produced is a document somebody can read.
 *
 * Starting gold is its own field rather than a gear line: every background opens its list with
 * `3d6 Gold Pieces`, a formula to roll rather than a document to copy. The roll becomes one sack of
 * coin on the new character (`data/item-coin.js`, `character-generator.js#assembleActorData`).
 */
export class BackgroundData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Background"];

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      names: new fields.ArrayField(new fields.StringField({ blank: false })),
      // A dice formula, not a number: the SRD writes one, and the generator rolls it.
      startingGold: new fields.StringField({ required: true, blank: true, initial: "3d6" }),
      // Plain strings, not `DocumentUUIDField`: that field resolves a compendium uuid through
      // `game.packs` while validating, and the pack build validates every document with no
      // `game` at all. The uuid shape is asserted by `checks/compendium.check.mjs` instead.
      startingGear: new fields.ArrayField(new fields.StringField({ blank: false })),
      tables: new fields.ArrayField(new fields.StringField({ blank: false }))
    };
  }
}

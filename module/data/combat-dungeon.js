/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * A dungeon exploration, run in the combat tracker (`srd-2e/players-guide/procedures.md` →
 * Dungeon Exploration). It is a Combat so the party's tokens record their movement: core keeps a
 * token's movement history only while it is a combatant of a started combat
 * (`TokenDocument#_shouldRecordMovementHistory`), and the history is what tells the Warden who
 * moved past torchlight this turn.
 *
 * Its one field is the Dungeon Event drawn this turn, kept for the Warden's eyes in the tracker.
 * `CairnCombat#_preUpdate` empties it whenever the turn changes, so it never outlives the turn it
 * belongs to. It carries the row's marker and its words: the marker is what the tracker acts on
 * (Exhaustion's two buttons), the words are only what it prints.
 */
export class DungeonCombatData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      event: new fields.SchemaField({
        kind: new fields.StringField({ required: true, blank: true }),
        name: new fields.StringField({ required: true, blank: true }),
        text: new fields.StringField({ required: true, blank: true })
      }, { nullable: true, initial: null })
    };
  }
}

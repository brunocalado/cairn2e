/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/** The four reasons to roll a Dungeon Event (`procedures.md` → Dungeon Events), in the SRD's order. */
export const DUNGEON_TRIGGERS = ["linger", "hurry", "enter", "loud"];

/** The most turns of effort one task holds: twelve marks still fit one line of the sidebar. */
export const MAX_EFFORT = 12;

/**
 * A dungeon exploration, run in the combat tracker (`srd-2e/players-guide/procedures.md` →
 * Dungeon Exploration). It is a Combat so the party's tokens record their movement: core keeps a
 * token's movement history only while it is a combatant of a started combat
 * (`TokenDocument#_shouldRecordMovementHistory`), and the history is what tells the Warden who
 * moved past torchlight this turn.
 *
 * `triggers` are the four reasons to roll, as the Warden lit them this turn. Nothing lights one
 * but the Warden and nothing reads one to roll: "If appropriate, the Warden should roll … Keep
 * common sense in mind". They are stored rather than kept on the Warden's client so the players
 * see them too — "Players should always be made aware of the cost" (`dungeon-exploration.md`).
 *
 * `CairnCombat#_preUpdate` puts them out whenever the turn changes, so none outlives its turn.
 * The Dungeon Event drawn is not kept here: its card in the Warden's chat is the record.
 *
 * `tasks` is the ongoing work that takes several turns of effort — "some actions may take
 * multiple turns to complete" (`procedures.md` → Actions) — which several characters can share
 * in one turn. It outlives the turn on purpose. The Warden fills the turns in by hand: the count
 * organises the table, it decides nothing.
 */
export class DungeonCombatData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      triggers: new fields.SchemaField(Object.fromEntries(
        DUNGEON_TRIGGERS.map((key) => [key, new fields.BooleanField({ initial: false })])
      )),
      tasks: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ required: true, blank: false }),
        name: new fields.StringField({ required: true, blank: false }),
        effort: new fields.NumberField({ required: true, integer: true, min: 1, max: MAX_EFFORT, initial: 1 }),
        spent: new fields.NumberField({ required: true, integer: true, min: 0, max: MAX_EFFORT, initial: 0 })
      }))
    };
  }
}

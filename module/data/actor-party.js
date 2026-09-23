/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * The party — a group of Actors read as one.
 *
 * It has no body: no HP, no attributes, no armour, no conditions. Cairn 2e gives a party no
 * statistics and no rolls of its own, so inventing any here would be inventing rules. What it
 * holds is a roster, and the reason it is an Actor rather than a JournalEntry is that only an
 * Actor can put a token on a map.
 *
 * Members are referenced, never embedded: no Actor can contain an Actor. A uuid can therefore
 * outlive what it points at, and {@link PartyData#roster} is the one place that is dealt with —
 * nothing outside this file reads `members` directly.
 */
export class PartyData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Party"];

  static defineSchema() {
    return {
      // An array, not a set, because the order is the party's MARCHING ORDER: it decides who
      // meets whatever is beyond a door (`srd-2e/players-guide/procedures.md` § Dungeon Elements
      // → Doors). With the members deployed as tokens their positions say the same thing, but
      // gathered into one token there is nothing else left to say it.
      members: new fields.ArrayField(new fields.SchemaField({
        actor: new fields.DocumentUUIDField({ type: "Actor", nullable: false, blank: false }),
        // Off keeps a member on the roster and out of the group's map movements: the player who
        // did not come tonight, the hireling left at camp. It is not a removal, and the row stays.
        deployed: new fields.BooleanField({ required: true, initial: true })
      }))
    };
  }

  /* -------------------------------------------- */

  /**
   * The members whose uuid still resolves, in marching order.
   *
   * A deleted Actor leaves its uuid behind on every party that listed it. Resolving and dropping
   * the misses here means no sheet, template or caller ever has to render a hole — and because
   * this is a getter over live documents rather than stored data, nothing has to be written back
   * when an Actor disappears.
   * @type {Array<{actor: Actor, deployed: boolean}>}
   */
  get roster() {
    return this.members
      .map((m) => ({ actor: fromUuidSync(m.actor), deployed: m.deployed }))
      .filter((m) => !!m.actor);
  }

  /* -------------------------------------------- */

  /** @override — tell each member which parties list it, so a change on their sheet can find
   *  the group sheets that draw them (`CairnActor#renderParties`). */
  prepareBaseData() {
    super.prepareBaseData();

    // World Actors only. A compendium copy and an unsaved draft both resolve members whose
    // sheets they could never usefully redraw, and registering them would pin this party in
    // every one of those members' sets for as long as the copy lives.
    if (game.actors?.get(this.parent.id) !== this.parent) return;
    for (const { actor } of this.roster) actor.parties?.add(this.parent);
  }
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * One faction of a region (`srd-2e/wardens-guide/setting-seeds.md` § Factions): what it is, what
 * it wants, who acts for it, and what is in the way.
 *
 * A page rather than an Actor because a faction has no body and never takes a token — the same
 * test `actor-party.js` records for the party, answered the other way. A journal of factions is
 * then one journal whose pages are revealed one at a time, which is what a `JournalEntryPage`'s
 * own `ownership` (initial `INHERIT`) already does.
 *
 * ## Nothing here is a `choices` list, and that is deliberate
 *
 * `page-route.js` constrains `path` / `distance` / `terrain` because those three are read by
 * `watchesNeeded()` — a value off the list would break a calculation. No field below feeds
 * anything: a type, a trait and an advantage are PROMPTS, printed back to the Warden. Constraining
 * them would mean a homebrew faction fails validation and refuses to save, which is the opposite
 * of what the SRD tables are for. NOTHING here is constrained, `goals` included: a goal is done or
 * it is not, which is a boolean and not a list of permitted words.
 *
 * Every list is open for the same reason. The SRD rolls 1–4 advantages and pairs exactly two
 * traits, but it also says obstacles accumulate — "Additional obstacles can arise through faction
 * Actions … or through developments in the fiction" — so a fixed arity would be wrong within one
 * session of play.
 */
export class FactionData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Faction"];

  static defineSchema() {
    return {
      type: new fields.StringField({ required: true, blank: true }),
      traits: new fields.ArrayField(new fields.StringField({ required: true, blank: true })),

      // `note` is the SRD example's own shape: "**Apparatus**: A _Map of the Dead_" — the
      // advantage, then what it is in this campaign. `item` is optional and points at the Relic
      // when one exists as a real document.
      advantages: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true }),
        note: new fields.StringField({ required: true, blank: true }),
        item: new fields.DocumentUUIDField({ type: "Item", required: true, blank: true, initial: "" })
      })),

      // The ARRAY ORDER is the chain of command. "the faction most at risk makes a WIL save, using
      // the score of its highest-ranking agent" — so index 0 is who saves, and reordering the list
      // is how a Warden says someone was promoted. Same convention as `PartyData#members`, where
      // the order is the marching order.
      agents: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: true }),
        role: new fields.StringField({ required: true, blank: true }),
        wil: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 10, min: 0, max: 20 }),
        motivation: new fields.StringField({ required: true, blank: true }),
        actor: new fields.DocumentUUIDField({ type: "Actor", required: true, blank: true, initial: "" })
      })),

      agenda: new fields.SchemaField({
        objective: new fields.StringField({ required: true, blank: true }),
        // "Agendas are defined by a series of 3-5 goals that build toward a clear objective." The
        // 3–5 is guidance the Warden follows, not arity the model enforces: a faction is written
        // one goal at a time, and refusing to save the first one would be absurd.
        // Done, or not done. The SRD prints exactly one marked checklist — the Downtime
        // MILESTONES of `srd-2e/wardens-guide/growth.md`, `- [ ] Complete one mission…` — and it
        // is binary. The Faction Actions table only ever ACHIEVES a goal (faces 4, 5 and 6 read
        // "a goal is achieved"; the bad faces introduce an Obstacle and take an Advantage, and
        // none of them fails a goal). A third "failed" state rests on one parenthesis —
        // "building on the previous successes (or failures) of earlier goals" — that no rule ever
        // produces, so it would be a mark only ever set by hand.
        goals: new fields.ArrayField(new fields.SchemaField({
          text: new fields.StringField({ required: true, blank: true }),
          done: new fields.BooleanField({ required: true, initial: false })
        }))
      }),

      obstacles: new fields.ArrayField(new fields.SchemaField({
        text: new fields.StringField({ required: true, blank: true }),
        resolved: new fields.BooleanField({ required: true, initial: false })
      })),

      description: new fields.HTMLField({ required: true, blank: true })
    };
  }


  /* -------------------------------------------- */

  /**
   * The agents in rank order, each with its Actor resolved and its WIL read off that Actor when
   * there is one.
   *
   * WIL is stored on the row AND readable from a linked Actor, and those two can disagree the
   * moment the NPC takes damage. The linked Actor wins, because it is the one a Warden updates in
   * play; the stored number is what an agent with no sheet is worth. Deriving it here means no
   * template and no roll ever has to know which case it is looking at.
   *
   * Unlike `PartyData#roster` a row whose uuid no longer resolves is KEPT: an agent without an
   * Actor is the normal case here, not a hole, so losing the NPC must not lose the name, the role
   * and the motivation written beside it.
   * @type {Array<{name: string, role: string, wil: number, motivation: string, actor: Actor|null}>}
   */
  get roster() {
    return this.agents.map((agent) => {
      const actor = agent.actor ? fromUuidSync(agent.actor) : null;
      return { ...agent, actor, wil: actor?.system?.abilities?.WIL?.value ?? agent.wil };
    });
  }

  /**
   * Who saves when this faction is opposed, or `null` when it has no agents at all.
   * @type {{name: string, wil: number}|null}
   */
  get highestAgent() {
    return this.roster[0] ?? null;
  }
}

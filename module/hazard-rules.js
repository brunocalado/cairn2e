/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The Warden's hazard rulings — falls, drowning, crushing, exposure — with no Foundry in them, so
 * `checks/hazards.check.mjs` runs them under Node.
 *
 * Not Cairn 2e: the SRD has no rule for any of them, only "damage outside of combat goes to an
 * Attribute, typically STR" (core-rules.md → Attribute Loss) and traps priced in STR dice
 * (procedures.md → Traps). They are the maintainer's own, kept on purpose. One ladder for all
 * four, so a step name is the same die on every hazard; only the examples differ.
 */
export const HAZARD_STEPS = Object.freeze([
  { id: "light", die: "d4" },
  { id: "serious", die: "d6" },
  { id: "severe", die: "d8" },
  { id: "extreme", die: "d10" },
  { id: "fatal", die: null }   // death, no roll
]);

export const HAZARDS = Object.freeze(["fall", "drowning", "crushing", "exposure"]);

/**
 * Every hazard offers all three saves: the attribute follows what the character does, not the
 * hazard (core-rules.md → Attributes) — a fall is DEX to catch a ledge and STR to hold a rope.
 * Each hazard's `Save` string suggests the usual ones; the Warden decides whether any applies.
 */
export const HAZARD_SAVES = Object.freeze(["STR", "DEX", "WIL"]);

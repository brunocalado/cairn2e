/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * When Morale comes due (`core-rules.md` → Morale):
 *
 * > Enemies must pass a WIL save to avoid fleeing when they take their first casualty and again
 * > when they lose half their number. Some groups may use their leader's WIL in place of their
 * > own. Lone foes must save when they're reduced to 0 HP. Morale does not affect PCs.
 *
 * The arithmetic is pulled out here, away from the Combat document, so it is checkable without a
 * scene, a token or a database write (`checks/combat-tracker.check.mjs`) — the same reason
 * `computeDamage` lives in `damage.js`.
 *
 * **The baseline is the opening roster, not the current one.** The SRD does not say what "half
 * their number" is half *of*, and measuring it against a roster that reinforcements keep growing
 * would re-arm a trigger that has already fired. It is recorded once when the combat starts.
 *
 * Nothing here decides *who* saves, or rolls anything. Two monsters in the bestiary break this
 * rule in prose the system cannot read — Bandits save on their leader's WIL and rout outright if
 * the leader dies, Hobgoblins pass automatically while a commander is present — so the trigger
 * raises a prompt and the Warden rules on it.
 *
 * @param {object} p
 * @param {number} p.baseline            opponents present when the combat started
 * @param {number} p.down                opponents currently defeated
 * @param {boolean} p.firstCasualtyDone  the first-casualty save has already been made
 * @param {boolean} p.halfDone           the half-strength save has already been made
 * @returns {"firstCasualty"|"half"|null}
 */
export function moraleDue({ baseline, down, firstCasualtyDone, halfDone }) {
  if (!baseline || !down) return null;

  // A lone foe has no "first casualty" short of itself, so its one save is the one it makes at 0
  // HP — which is the same moment it counts as down. It never owes a half-strength save.
  if (baseline === 1) return firstCasualtyDone ? null : "firstCasualty";

  // Half rounds up: three of five is half their number gone, and 2.5 is not a number of monsters.
  if (down >= Math.ceil(baseline / 2) && !halfDone) return "half";
  if (!firstCasualtyDone) return "firstCasualty";
  return null;
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Which Morale triggers a change in casualties crossed (`core-rules.md` → Morale):
 *
 * > Enemies must pass a WIL save to avoid fleeing when they take their first casualty and again
 * > when they lose half their number. Some groups may use their leader's WIL in place of their
 * > own. Lone foes must save when they're reduced to 0 HP. Morale does not affect PCs.
 *
 * The arithmetic is pulled out here, away from the Combat document, so it is checkable without a
 * scene, a token or a database write (`checks/morale.check.mjs`) — the same reason
 * `computeDamage` lives in `damage.js`.
 *
 * **The baseline is the opening roster, not the current one.** The SRD does not say what "half
 * their number" is half *of*, and measuring it against a roster that reinforcements keep growing
 * would re-arm a trigger that has already fired. It is recorded once when the combat starts.
 *
 * What comes back is a reminder for the Warden, never a decision: nothing here says *who* saves,
 * and nothing rolls. Two monsters in the bestiary break this rule in prose the system cannot read
 * — Bandits save on their leader's WIL and rout outright if the leader dies, Hobgoblins pass
 * automatically while a commander is present — and a Warden may call for Morale for reasons no
 * count sees at all. Both triggers come back together when one casualty crosses both (two
 * opponents and one falls), so the Warden is told once about the one moment.
 *
 * @param {object} p
 * @param {number} p.baseline   opponents present when the combat started
 * @param {number} p.before     opponents down when the last reminder was sent (0 before any)
 * @param {number} p.after      opponents down now
 * @param {{firstCasualty?: boolean, half?: boolean, lone?: boolean}} p.reminded  already sent
 * @returns {Array<"firstCasualty"|"half"|"lone">}
 */
export function moraleTriggers({ baseline, before, after, reminded }) {
  const out = [];
  if (!baseline || after <= before) return out;

  // A lone foe has no "first casualty" short of itself, so its one save is the one it makes at 0
  // HP — which is the same moment it counts as down. It never owes a half-strength save.
  if (baseline === 1) return reminded.lone ? out : ["lone"];

  if (!reminded.firstCasualty && before === 0) out.push("firstCasualty");
  // Half rounds up: three of five is half their number gone, and 2.5 is not a number of monsters.
  const half = Math.ceil(baseline / 2);
  if (!reminded.half && before < half && after >= half) out.push("half");
  return out;
}

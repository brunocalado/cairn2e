/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { CONDITION } from "./constants.js";
import { gainUpdate, revertUpdate, attrPath, attrResource } from "./gains.js";

/**
 * The twelve rows of the Scars table (`srd-2e/players-guide/core-rules.md` → Scars Table), as the
 * mechanics behind the prose. The prose itself is the `Scars` RollTable in
 * `packs/_source/tables/scars.json` — including each row's title, which is the words before its
 * first colon — and `checks/rules-scars.check.mjs` ties every descriptor here to its row there.
 *
 * `mode` is how a rolled total meets the maximum it targets:
 *   "higher"  the total replaces the maximum when it beats it   ("if the total is higher…")
 *   "add"     the total is added to the maximum                 ("add that amount to your max HP")
 *   "set"     the total becomes the maximum, even if it is lower ("Take the new result as…")
 *
 * `deferred` marks a row whose gain waits on the fiction — "once mended", "when you get
 * over it", "after recovery". Nothing fires it; the player asks for it when their table agrees.
 *
 * `location` is the d6 that names where it landed, in face order. `choose` is the same die
 * picking which attribute grows. `save` is a save that gates the gain entirely.
 */
export const SCAR_ENTRIES = [
  { entry: 1, location: ["Neck", "Hands", "Eye", "Chest", "Legs", "Ear"], formula: "1d6", attr: "hp", mode: "higher" },
  { entry: 2, formula: "1d6", attr: "hp", mode: "higher" },
  { entry: 3, formula: "1d6", attr: "hp", mode: "add", condition: CONDITION.DEPRIVED },
  { entry: 4, location: ["Leg", "Leg", "Arm", "Arm", "Rib", "Skull"], formula: "2d6", attr: "hp", mode: "higher", deferred: true },
  { entry: 5, formula: "2d6", attr: "hp", mode: "higher", deferred: true },
  // The d6 picks which attribute grows, so there is no fixed `attr` — the choice is written onto
  // the scar's own `outcome.attr`.
  //
  // This row is the ONE place the system does not follow the letter of the SRD. Its text reads
  // "if the total is higher than your *current* attribute", where the other eleven compare
  // against a maximum. Comparing against the current value while writing the maximum LOWERS the
  // ceiling of a wounded character — a gain that punishes being hurt — so it compares
  // against the maximum like the rest (maintainer's decision).
  { entry: 6, choose: ["STR", "STR", "DEX", "DEX", "WIL", "WIL"], formula: "3d6", mode: "higher" },
  { entry: 7, formula: "3d6", attr: "DEX", mode: "higher", deferred: true },
  { entry: 8, save: "WIL", formula: "1d4", attr: "WIL", mode: "add" },
  { entry: 9, formula: "3d6", attr: "WIL", mode: "higher" },
  // "An appendage is torn off, crippled, or useless. (The Warden will tell you which.)" — a word,
  // not a die, so no `location`: it is typed into the scar's name.
  { entry: 10, save: "WIL", formula: "1d6", attr: "WIL", mode: "add" },
  { entry: 11, formula: "2d6", attr: "hp", mode: "set", condition: CONDITION.DEPRIVED, deferred: true },
  // The condition IS the state: nothing on the scar repeats it, and the next Critical Damage save
  // clears it whichever way it goes ("your NEXT save").
  { entry: 12, formula: "3d6", attr: "hp", mode: "higher", deferred: true, condition: CONDITION.DOOMED }
];

/**
 * How much HP was lost to a hit that lands a character on exactly 0 — or `null` when this update
 * is not a Scar (`srd-2e/players-guide/core-rules.md`: "If an attack would take a PC's HP exactly
 * to 0, refer to the Scars table").
 *
 * A hit that also spills onto STR is Critical Damage instead. An NPC takes neither, and the
 * hireling the Warden rolls is an `npc` Actor with `role: "hireling"` (`npc-generator.js`), so
 * `isCharacter` already excludes it. `hasPlayerOwner` is the second gate, and it is there for the
 * other kind of hireling: `core-rules.md` § Hirelings also allows one built exactly like a PC —
 * background, name, background tables, gold, attributes, HP, age — and one of those sitting in the
 * Warden's folder is still not a PC. "Only PCs gain Scars" (`srd-2e/wardens-guide/combat.md`);
 * what makes it one is a player owning it.
 *
 * `strFrom`/`strTo` are compared as VALUES, not by the key's presence in the update: the damage
 * path writes STR on every hit, changed or not.
 *
 * Ownership is enough of a gate because it is also the one Foundry plays by: a player who can
 * open the sheet or move the token already owns the character. So a `character` nobody owns is
 * one nobody can play — a PC still in the Warden's folder, or one whose player left — and the
 * only hits it can take are the Warden's, which earn no automatic Scar on purpose. The Scars tab's
 * Add is not gated, so a Scar the Warden wants on it is one click away.
 */
export function scarHpLost({ isCharacter, hasPlayerOwner, hpFrom, hpTo, strFrom, strTo }) {
  if (!isCharacter || !hasPlayerOwner) return null;
  if (hpTo !== 0 || hpFrom === 0) return null;
  if (strTo !== strFrom) return null;
  return hpFrom;
}

/** The descriptor for one row, by its number (1–12). */
export function scarEntry(entry) {
  return SCAR_ENTRIES[entry - 1];
}

/**
 * The maximum a Scar or a Growth moved, in words: "Max Hit Protection", or "Max WIL". Both kinds
 * record the same `outcome` shape, and the label names a resource on the ACTOR, so one string in
 * one place serves the sheet, the item sheet, the delete question and the chat card.
 * @param {{ attr: string }} outcome
 * @returns {string}
 */
export function outcomeLabel({ attr }) {
  return attr === "hp"
    ? game.i18n.localize("CAIRN.Scar.MaxHp")
    : game.i18n.localize("CAIRN.Scar.MaxAbility", { key: game.i18n.localize(attr || "STR") });
}

/**
 * "Max WIL 5 → 11", or "" when nothing is resolved yet or the roll moved nothing — a taken scar
 * whose gain lost recorded an equal pair, and there is no arrow to print.
 * @param {{ resolved: boolean, outcome: { attr: string, from: number, to: number } }} system
 * @returns {string}
 */
export function outcomeText(system) {
  const { attr, from, to } = system.outcome;
  return system.resolved && attr && from !== to ? `${outcomeLabel(system.outcome)} ${from} \u2192 ${to}` : "";
}

/**
 * Apply a scar's gain: write the maximum on the actor, and record on the scar what it did.
 *
 * The maximum is written DIRECTLY rather than through an ActiveEffect. The gain is permanent —
 * nothing expires it and nothing suppresses it — and the SRD's wording is assignment, not a
 * modifier: an effect that added would make "if the total is higher than your max" compare
 * against an already-modified number, which would put application order inside the rule.
 * @param {Actor} actor
 * @param {Item} scar
 * @param {number} total  the rolled gain
 */
export async function applyScarGain(actor, scar, total) {
  const spec = scarEntry(scar.system.entry);
  const attr = scar.system.outcome.attr;
  const res = attrResource(actor, attr);
  const path = attrPath(attr);
  const { from, to, value } = gainUpdate({ mode: spec.mode, total, max: res.max, value: res.value });
  await actor.update({ [`${path}.max`]: to, [`${path}.value`]: value });
  await scar.update({ "system.outcome.from": from, "system.outcome.to": to, "system.resolved": true });
  return { from, to };
}

/**
 * Put back what a scar did, when it is deleted. A scar that never resolved wrote nothing and puts
 * nothing back.
 * @param {Item} scar
 */
export async function revertScarGain(scar) {
  const actor = scar.parent;
  const { attr, from, to } = scar.system.outcome;
  if (!actor) return null;
  // Doomed belongs to row 12 alone, so deleting that scar takes the mark with it. Deprived does
  // not work that way and is left alone: a character can be Deprived for a dozen reasons that
  // have nothing to do with a scar, and it comes off with a night's rest.
  if (scar.system.entry === 12 && actor.statuses?.has(CONDITION.DOOMED)) {
    await actor.toggleStatusEffect(CONDITION.DOOMED, { active: false });
  }
  if (!scar.system.resolved || !attr || from === to) return null;
  const res = attrResource(actor, attr);
  const path = attrPath(attr);
  const next = revertUpdate({ from, to, max: res.max, value: res.value });
  await actor.update({ [`${path}.max`]: next.max, [`${path}.value`]: next.value });
  return next;
}

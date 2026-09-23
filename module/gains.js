/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * How a character's maximum moves, and how it moves back.
 *
 * Two things raise a maximum in 2e and they share one rule: a Scar's die
 * (`srd-2e/players-guide/core-rules.md` → Scars) and a Growth the Warden grants
 * (`srd-2e/wardens-guide/growth.md`). Neither owns the arithmetic, so it lives here —
 * a dependency-free leaf, like `constants.js`, that both sides import.
 *
 * Everything in this file is pure: no document, no die, no `game`. That is what lets
 * `checks/rules-scars.check.mjs` and `checks/rules-growth.check.mjs` state the rule as
 * arithmetic and check it under plain Node.
 */

/**
 * What a maximum becomes when a gain of `total` meets it.
 * @param {"higher"|"add"|"set"} mode
 */
export function gainResult(mode, total, current) {
  if (mode === "add") return current + total;
  if (mode === "set") return total;
  return total > current ? total : current;
}

/**
 * The `{value, max}` pair a gain leaves behind.
 *
 * The value is pulled down to the new maximum because a `set` can LOWER it — Scars entry 11 is
 * "Take the new result as your max HP", an assignment, and 2d6 can come in under what the
 * character had. Nothing else in the system clamps a stored value to its maximum (the sheet's
 * steppers do, but only the steppers), and a character sitting at 7 of a maximum of 5 reads as a
 * bug the first time they rest.
 */
export function gainUpdate({ mode, total, max, value }) {
  const to = gainResult(mode, total, max);
  return { from: max, to, value: Math.min(value, to) };
}

/**
 * The `{value, max}` pair that undoes a gain, by the delta it recorded.
 *
 * By the stored delta, and not by replaying whatever records remain: a replay needs a base value
 * nothing stores, and it would overwrite a maximum corrected by hand in the edit window — which
 * is the one place a maximum is edited.
 */
export function revertUpdate({ from, to, max, value }) {
  const next = max - (to - from);
  return { max: next, value: Math.min(value, next) };
}

/** Where on an actor an outcome's attribute lives. `hp` is the character's own pair; the other
 *  three are attributes. */
export function attrPath(attr) {
  return attr === "hp" ? "system.hp" : `system.abilities.${attr}`;
}

/** The `{value, max}` pair an outcome's attribute currently holds on this actor. */
export function attrResource(actor, attr) {
  return attr === "hp" ? actor.system.hp : actor.system.abilities[attr];
}

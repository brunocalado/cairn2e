/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The steppers on an actor sheet's header: a tap moves the printed number at once and the actor
 * is written a moment later; a hold repeats; a close flushes whatever is still waiting. Functions
 * over an application rather than members of one, so the subsystem is not held inside the base
 * sheet by `#`-private names.
 */

/**
 * Stepper writes waiting to go out, by field path. A tap on `+` moves the number on the sheet
 * at once and the actor is written a moment later with wherever it ended up — so ten quick
 * taps are one update with `+10`, not ten updates racing each other, and a hold that repeats
 * every 90ms never queues ninety writes. `_preClose` flushes whatever is still waiting.
 * Keyed by application, so each open sheet has its own and none outlives its window.
 * @type {WeakMap<foundry.applications.api.ApplicationV2, Map<string, {value: number, timer: number}>>}
 */
const PENDING = new WeakMap();

/** The pending writes of one application. */
function pendingOf(app) {
  let pending = PENDING.get(app);
  if (!pending) PENDING.set(app, (pending = new Map()));
  return pending;
}

/**
 * A digit field's value as a number, with `0` a number like any other.
 *
 * Written out rather than `Number(field.value) || 0` because that idiom is one edit away from
 * reading a legitimate zero as "nothing there" — `"" || 0` and `"0" || 0` happen to both come
 * out as 0, but the first is a default and the second is a value, and a stepper that cannot
 * tell them apart cannot step off zero. `null`, `undefined` and an empty field are 0; anything
 * that parses is itself.
 * @param {HTMLInputElement} field
 * @returns {number}
 */
export function fieldNumber(field) {
  const raw = field.value;
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A printed current value as a number.
 *
 * Its counterpart for a field is `fieldNumber`, and the pair exists because the sheet now reads
 * the same number from two different kinds of element: the span that is there almost all the
 * time, and the field a click puts over it for as long as someone is typing into it.
 * @param {HTMLElement} cell  a `.cairn-stat-current`
 * @returns {number}
 */
function cellNumber(cell) {
  const n = Number(cell.textContent.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Size a digit field to exactly the text it holds.
 *
 * Gold sits centred in a drawn box, so any width the field reserves beyond its digits is slack on
 * one side of the pair and pushes the visible text off the box's centre. `field-sizing: content`
 * gets close but not close enough: Chrome sizes the field at roughly one `ch` per character,
 * which is wider than the digits actually advance.
 *
 * The measurement is the BROWSER's, taken by collapsing the field and reading back the width its
 * own content overflows to. A canvas `measureText` was tried first and is wrong here: `ctx.font`
 * carries no `font-variant-numeric`, so it measures proportional figures while the field is set
 * in the tabular ones every input in this system gets (Primitive 3). It under-reported a
 * three-digit purse by six pixels, and the last digit was clipped off inside the box.
 * @param {HTMLInputElement} field
 */
export function fitToText(field) {
  const shown = field.value;
  if (!shown) field.value = "0";
  field.style.width = "0";
  // One pixel for the caret, so it has somewhere to sit past the last digit.
  const width = field.scrollWidth + 1;
  if (!shown) field.value = "";
  field.style.width = `${width}px`;
}

/** The printed current value for one document path. */
function statCell(app, path) {
  return app.element.querySelector(`.cairn-stat-current[data-field="${path}"]`);
}

/**
 * Fade the stepper that can go no further. The glyph stays in the row — the space it takes is
 * reserved whether it can be pressed or not, so reaching a limit moves nothing.
 */
function markStepLimits(app, cell) {
  const value = cellNumber(cell);
  const max = Number(cell.dataset.max);
  for (const step of app.element.querySelectorAll(`.cairn-step[data-field="${cell.dataset.field}"]`)) {
    const delta = Number(step.dataset.step);
    const limit = delta < 0 ? value <= 0 : value >= max;
    step.classList.toggle("is-limit", limit);
    step.setAttribute("aria-disabled", String(limit));
  }
}

/**
 * Show a current value and queue the write. The number on the sheet changes immediately; the
 * actor is written 250ms after the last change, so a burst of taps, a hold, or a typed value
 * landing on top of them is one update.
 * @param {HTMLElement} cell  the `.cairn-stat-current` to set
 * @param {number} value
 */
function setStat(app, cell, value) {
  cell.textContent = String(value);
  markStepLimits(app, cell);

  const pending = pendingOf(app);
  const path = cell.dataset.field;
  const waiting = pending.get(path);
  if (waiting) clearTimeout(waiting.timer);
  pending.set(path, {
    value,
    timer: setTimeout(() => flushStep(app, path), 250)
  });
}

/**
 * Move one current value by the stepper's `data-step`, clamped to `[0, max]`.
 * @param {ApplicationV2} app
 * @param {HTMLElement} step  The `.cairn-step` pressed; its `data-field` names the value.
 */
export function stepStat(app, step) {
  const cell = statCell(app, step.dataset.field);
  // Nothing to step while the reader is typing into this one: the field over it owns the value
  // until it commits, and a stepper that wrote underneath it would be overwritten on blur.
  if (!cell || cell.querySelector("input")) return;
  const max = Number(cell.dataset.max);
  // The value a step starts from is the one still WAITING to be written, if there is one —
  // never the printed number. A write takes a moment to land, and when it does the header
  // re-renders from the actor, whose number may be a step or two behind what the reader has
  // already tapped to; a tap that read the sheet at that moment stepped from the stale number
  // and looked like nothing had happened. At 0 that is "the plus does nothing".
  const current = pendingOf(app).get(cell.dataset.field)?.value ?? cellNumber(cell);
  const next = Math.max(0, Math.min(current + Number(step.dataset.step), Number.isFinite(max) ? max : Infinity));
  if (next === current) return;
  setStat(app, cell, next);
}

/**
 * Write one queued stepper value. The entry stays in the map until the write has LANDED, so a
 * render in the meantime still knows the number to show and a tap in the meantime still steps
 * from it; a tap that arrives mid-flight replaces the entry, and the flush that finds the
 * entry changed underneath it leaves the newer one for its own timer.
 */
async function flushStep(app, path) {
  const pending = pendingOf(app);
  const waiting = pending.get(path);
  if (!waiting) return;
  await app.actor.update({ [path]: waiting.value });
  if (pending.get(path) === waiting) pending.delete(path);
}

/**
 * Wire the steppers inside `root`, a part the sheet just rendered.
 * @param {ApplicationV2} app
 * @param {HTMLElement} root
 */
export function bindSteppers(app, root) {
  // The current values are printed labels: nothing is wired on them at all, and there is
  // nothing to wire — no click, no key, no focus. Each one is still READ here, because which
  // of its two steppers has run out of range is decided from the number printed in it.
  for (const cell of root.querySelectorAll(".cairn-stat-current[data-field]")) {
    markStepLimits(app, cell);
  }

  // A re-render that lands while a stepper write is still waiting draws the actor's number,
  // which is behind the one the reader has tapped to. Put the pending number back on the
  // fresh field, so the sheet never shows a value the write is about to overtake.
  for (const [path, waiting] of pendingOf(app)) {
    const cell = root.querySelector(`.cairn-stat-current[data-field="${path}"]`);
    if (!cell) continue;
    cell.textContent = String(waiting.value);
    markStepLimits(app, cell);
  }

  // Hold-to-repeat on the steppers. A press that lasts 400ms starts stepping every 90ms until
  // it is released or leaves the glyph; the sheet's click handler (`statStep`) is then told to
  // stand down for the click that ends the press, or a hold of eleven steps would land twelve.
  // Everything the handler needs is the same `data-field` / `data-step` a click uses.
  for (const step of root.querySelectorAll(".cairn-step")) {
    let delay = 0;
    let repeat = 0;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
      delay = repeat = 0;
    };
    step.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      stop();
      step.dataset.held = "";
      delay = setTimeout(() => {
        step.dataset.held = "yes";
        stepStat(app, step);
        repeat = setInterval(() => stepStat(app, step), 90);
      }, 400);
    });
    for (const end of ["pointerup", "pointerleave", "pointercancel"]) step.addEventListener(end, stop);
  }
}

/** Write everything still waiting, now — the sheet is closing. */
export async function flushSteps(app) {
  const pending = pendingOf(app);
  for (const [path, waiting] of pending) {
    clearTimeout(waiting.timer);
    await app.actor.update({ [path]: waiting.value });
    if (pending.get(path) === waiting) pending.delete(path);
  }
}

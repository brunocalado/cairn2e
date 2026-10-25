/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The steppers on an actor sheet's header: a tap moves the printed number at once and the actor
 * is written a moment later; a hold repeats and stops when it is released; a close flushes whatever is still waiting. Functions
 * over an application rather than members of one, so the subsystem is not held inside the base
 * sheet by `#`-private names.
 */

/**
 * Stepper writes waiting to go out, by field path. A tap on `+` moves the number on the sheet
 * at once and the actor is written a moment later with wherever it ended up — so ten quick
 * taps are one update with `+10`, not ten updates racing each other, and a hold that repeats
 * every 90ms never queues ninety writes. `_preClose` flushes whatever is still waiting.
 * Keyed by application, so each open sheet has its own and none outlives its window.
 *
 * What waits is the CHANGE the reader made, not the number they saw. The write is a value, and
 * one worked out at the tap would put back whatever the actor held then: a hit the Warden lands
 * inside the wait would be overwritten, as if it had never been struck. Worked out at the flush,
 * against the actor as it is by then, both the hit and the taps count.
 * @type {WeakMap<foundry.applications.api.ApplicationV2, Map<string, {delta: number, timer: number}>>}
 */
const PENDING = new WeakMap();

/**
 * The value each stepper write still on its way to the server sent, by field path. It is the base
 * a tap steps from until the write lands, so the echo is not added to the delta a second time.
 * @type {WeakMap<foundry.applications.api.ApplicationV2, Map<string, number>>}
 */
const IN_FLIGHT = new WeakMap();

/** The pending writes of one application. */
function pendingOf(app) {
  let pending = PENDING.get(app);
  if (!pending) PENDING.set(app, (pending = new Map()));
  return pending;
}

/** The writes of one application still on their way to the server. */
function inFlightOf(app) {
  let flight = IN_FLIGHT.get(app);
  if (!flight) IN_FLIGHT.set(app, (flight = new Map()));
  return flight;
}

/** The number the actor holds for `path`, or the one a write still out will leave it at. */
function baseOf(app, path) {
  return inFlightOf(app).get(path) ?? foundry.utils.getProperty(app.actor, path);
}

/** `path`'s maximum, read off the actor, so a Scar that moved it mid-burst is honoured. */
function maxOf(app, path) {
  const max = foundry.utils.getProperty(app.actor, path.replace(/\.value$/, ".max"));
  return Number.isFinite(max) ? max : Infinity;
}

/** What the sheet shows for `path`: the base plus the waiting change, clamped to `[0, max]`. */
function shownOf(app, path) {
  const delta = pendingOf(app).get(path)?.delta ?? 0;
  return Math.max(0, Math.min(baseOf(app, path) + delta, maxOf(app, path)));
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
 * Move one current value by `delta`, clamped to `[0, max]`. The number on the sheet changes
 * immediately; the actor is written 250ms after the last change, so a burst of taps or a hold is
 * one update.
 * @param {ApplicationV2} app
 * @param {string} field  the document path the stepper writes
 * @param {number} delta
 */
export function stepStat(app, field, delta) {
  const cell = statCell(app, field);
  if (!cell) return;
  // Stepped from what the sheet shows, which is the actor's number plus the change still waiting
  // — never the printed text alone. A write takes a moment to land, and the re-render it causes
  // draws the actor, which may be a step or two behind what the reader has already tapped to; a
  // tap that read the sheet then stepped from the stale number and looked like nothing happened.
  const current = shownOf(app, field);
  const next = Math.max(0, Math.min(current + delta, maxOf(app, field)));
  if (next === current) return;
  const pending = pendingOf(app);
  const waiting = pending.get(field);
  if (waiting) clearTimeout(waiting.timer);
  // Kept as the distance from the base, so a hit that moves the base keeps the reader's taps.
  // Taken from the base afresh rather than added to the old distance, which a clamp may have
  // left past the limit: a `+` that did not move what the sheet shows would read as dead.
  pending.set(field, {
    delta: next - baseOf(app, field),
    timer: setTimeout(() => flushStep(app, field), 250)
  });
  cell.textContent = String(next);
  markStepLimits(app, cell);
}

/**
 * Write one queued stepper change, as the value it comes to NOW, against whatever has landed on
 * the actor while it waited. Until the write returns, that value is the base the next tap steps
 * from (`IN_FLIGHT`), so the echo of this write is not counted a second time.
 */
async function flushStep(app, path) {
  const pending = pendingOf(app);
  const waiting = pending.get(path);
  if (!waiting) return;
  clearTimeout(waiting.timer);
  const value = shownOf(app, path);
  pending.delete(path);
  const flight = inFlightOf(app);
  flight.set(path, value);
  try {
    await app.actor.update({ [path]: value });
  } finally {
    // A later flush of the same field owns the entry now; leave it for that one.
    if (flight.get(path) === value) flight.delete(path);
  }
}

/**
 * Mark the steppers inside `root`, a part the sheet just rendered: their limits, and a value
 * still waiting to be written. The press itself is `bindHold`'s, bound once per opening.
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

  // A re-render that lands while a stepper write is waiting or still out draws the actor's
  // number alone. Draw the actor's number plus the reader's change instead, so the sheet never
  // shows a value the write is about to overtake — and a hit that caused the render still shows.
  for (const path of new Set([...pendingOf(app).keys(), ...inFlightOf(app).keys()])) {
    const cell = root.querySelector(`.cairn-stat-current[data-field="${path}"]`);
    if (!cell) continue;
    cell.textContent = String(shownOf(app, path));
    markStepLimits(app, cell);
  }
}

/**
 * The press being held on one sheet, if any — WHAT is held, never which element, because the
 * element can be replaced under the finger. Keyed by application like `PENDING`.
 * @type {WeakMap<foundry.applications.api.ApplicationV2, {field: string, delta: number, delay: number, repeat: number}>}
 */
const HELD = new WeakMap();

/** End the press held on `app`, if there is one. */
export function stopHold(app) {
  const held = HELD.get(app);
  if (!held) return;
  clearTimeout(held.delay);
  clearInterval(held.repeat);
  HELD.delete(app);
}

/**
 * Wire the steppers of one opening of `app`: a press steps once at once, as a native spin
 * button does, and a press that lasts 400ms repeats every 90ms until it is released.
 *
 * Bound once, on the window root, because every Actor update re-renders the header part and core
 * replaces its element (`_replaceHTML`). A hold tied to one `.cairn-step` outlived it: the release
 * reached the new element, the old one never stopped, and the repeat ran on its own — driving
 * the value to its limit and pinning it there against every tap the other way. The release is
 * heard on `window`, which receives it whatever was redrawn under the finger. The step is on
 * `pointerdown` and not `click` for the same reason: a click needs its press and release on one
 * element, and a tap that straddled a render was lost.
 * @param {ApplicationV2} app
 * @param {AbortSignal} signal  aborted when the sheet closes
 */
export function bindHold(app, signal) {
  app.element.addEventListener("pointerdown", (event) => {
    const step = event.target.closest(".cairn-step");
    if (!step || event.button !== 0) return;
    stopHold(app);
    const held = { field: step.dataset.field, delta: Number(step.dataset.step), delay: 0, repeat: 0 };
    HELD.set(app, held);
    stepStat(app, held.field, held.delta);
    held.delay = setTimeout(() => {
      held.repeat = setInterval(() => stepStat(app, held.field, held.delta), 90);
    }, 400);
  }, { signal });
  for (const type of ["pointerup", "pointercancel", "blur"]) {
    window.addEventListener(type, () => stopHold(app), { signal });
  }
}

/** Write everything still waiting, now — the sheet is closing. */
export async function flushSteps(app) {
  for (const path of [...pendingOf(app).keys()]) await flushStep(app, path);
}

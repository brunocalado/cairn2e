/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The watch, read off Foundry's world time — "A day is divided into three watches, called
 * _morning_, _afternoon_, and _night_", "three eight-hour segments per day"
 * (`srd-2e/players-guide/procedures.md` → Wilderness Exploration). Pure: no Foundry global is
 * touched, so `checks/clock-rules.check.mjs` asserts it under plain Node;
 * `module/apps/watch-clock.js` is where it meets `game.time`.
 *
 * World time is the one clock, because core keeps it and every calendar module reads and writes
 * it: a Warden's calendar and this watch can then never disagree. A watch is a third of the
 * calendar's day, whatever length that day has, and the first one starts a quarter of the way in
 * (06:00 on a 24-hour day). The SRD names no hour; starting at midnight would set a calendar to
 * 00:00 each time the Warden moved to Morning, and every time-of-day lighting module with it.
 */

import { WATCHES } from "./journey-rules.js";

/**
 * Seconds in a day and in one watch, and where the first watch begins, for a calendar's day.
 * @param {{hoursPerDay: number, minutesPerHour: number, secondsPerMinute: number}} days
 * @returns {{day: number, watch: number, offset: number}}
 */
export function watchGeometry({ hoursPerDay, minutesPerHour, secondsPerMinute }) {
  const day = hoursPerDay * minutesPerHour * secondsPerMinute;
  return { day, watch: day / WATCHES.length, offset: day / 4 };
}

/** `n mod m` that stays in [0, m) for a negative `n` — world time may be set before its epoch. */
const mod = (n, m) => ((n % m) + m) % m;

/**
 * The watch a moment falls in: an index of {@link WATCHES}. Night runs past midnight into the next
 * calendar day.
 * @param {number} worldTime  seconds
 * @param {{day: number, watch: number, offset: number}} g
 * @returns {number}
 */
export function watchAt(worldTime, g) {
  return Math.floor(mod(worldTime - g.offset, g.day) / g.watch);
}

/**
 * The moment the next watch begins. Not "eight hours on": world time is rarely on a boundary —
 * a combat round or a calendar module moves it by any amount — and 10:30 plus eight hours is
 * still the afternoon.
 * @param {number} worldTime
 * @param {{day: number, watch: number, offset: number}} g
 * @returns {number}
 */
export function nextWatchStart(worldTime, g) {
  return worldTime - mod(worldTime - g.offset, g.watch) + g.watch;
}

/**
 * One step back: to the start of this watch when part-way into it, otherwise to the start of the
 * one before. From a boundary, back undoes a step forward exactly.
 * @param {number} worldTime
 * @param {{day: number, watch: number, offset: number}} g
 * @returns {number}
 */
export function previousWatchStart(worldTime, g) {
  const since = mod(worldTime - g.offset, g.watch);
  return worldTime - (since > 0 ? since : g.watch);
}

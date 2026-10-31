/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The Vald calendar's arithmetic (`srd-2e/wardens-guide/vald.md` → The Vald Calendar). Pure: no
 * Foundry global is touched, so `checks/calendar-rules.check.mjs` asserts it under plain Node;
 * `module/calendar.js` is where it meets `game.time`.
 *
 * Days are counted from year 0, which is itself a Reclamation year: a decade is one 294-day year
 * and then nine of 288.
 *
 * The watch is read off the same clock — "A day is divided into three watches, called _morning_,
 * _afternoon_, and _night_", "three eight-hour segments per day" (`srd-2e/players-guide/
 * procedures.md` → Wilderness Exploration). World time is the one clock, because core keeps it
 * and every calendar module reads and writes it, so a calendar and the watch can never disagree.
 * A watch is a third of the calendar's day, whatever length that day has, and the first one starts
 * a quarter of the way in (06:00 on a 24-hour day). The SRD names no hour; starting at midnight
 * would set the clock to 00:00 each time the Warden moved to Morning, and every time-of-day
 * lighting module with it.
 */

import { SYSTEM_ID } from "./constants.js";
import { WATCHES } from "./journey-rules.js";

/** "There are 24 hours in a day and 6 days in a week. Each month has 24 days (4 weeks), with
 *  12 months in a year." */
export const MONTH_DAYS = 24;
export const YEAR_DAYS = 12 * MONTH_DAYS;
/** The month index core gives the leap week: a thirteenth month with no days in an ordinary year. */
export const RECLAMATION = 12;
export const RECLAMATION_DAYS = 6;
/** "The current year is 7728." — the only year the SRD names. */
export const START_YEAR = 7728;

const keys = (group, names) => names.map((key) => `CAIRN.Calendar.${group}.${key}`);

/**
 * Everything about the calendar a module may change with `game.cairn2e.defineCalendar`: its
 * names, the year a new world starts in, and the packs a new world's events come from. Names are
 * i18n keys here, and a module may pass literal strings instead — `localize` hands back a string
 * it has no key for unchanged. The structure (month and week length, the Reclamation, the leap
 * rule, the seasons) is not in it: the constants above, the notes, the harvest and the weather
 * tables all read it, so it stays Vald's.
 */
export const VALD_DEFINITION = Object.freeze({
  name: "CAIRN.Calendar.Name",
  months: ["Mourning", "Silence", "Veil", "Sunrise", "Bright", "Ashfall", "Flood", "Highwater", "Rise", "Quell", "Bane", "Sunset"]
    .map((key) => ({ name: `CAIRN.Calendar.Month.${key}`, abbreviation: `CAIRN.Calendar.MonthAbbr.${key}` })),
  reclamation: { name: "CAIRN.Calendar.Month.Reclamation", abbreviation: "CAIRN.Calendar.MonthAbbr.Reclamation" },
  weekdays: keys("Weekday", ["Market", "Garden", "Song", "Tithe", "Bathing", "Resting"]),
  reclamationDays: keys("ReclamationDay", ["Recognize", "Remember", "Reward", "Rejoice", "Relinquish", "Renew"]),
  seasons: keys("Season", ["Dead", "Dry", "Wet", "Harvest"]),
  startYear: START_YEAR,
  events: [`${SYSTEM_ID}.vald-calendar`]
});

/**
 * A calendar definition laid over a base: every key left out keeps the base's value, and every key
 * given is taken whole — an array is never merged index by index. A month or the Reclamation with
 * no abbreviation is abbreviated by its name. Throws on anything that does not fit, so a module
 * author's mistake surfaces at load, in their console, and never as a half-renamed calendar.
 * @param {typeof VALD_DEFINITION} base
 * @param {object} [definition]
 * @returns {typeof VALD_DEFINITION}
 */
export function resolveCalendarDefinition(base, definition = {}) {
  const fail = (what) => { throw new Error(`Calendar definition: ${what}`); };
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) fail("must be an object");
  const isName = (s) => typeof s === "string" && s.trim() !== "";
  const nameList = (key, length) => {
    const list = definition[key];
    if (!Array.isArray(list) || list.length !== length || !list.every(isName)) fail(`${key} must be ${length} non-empty strings`);
    return [...list];
  };
  const month = (key, m) => {
    if (!m || typeof m !== "object" || !isName(m.name)) fail(`${key} needs a non-empty name`);
    if (Object.keys(m).some((k) => k !== "name" && k !== "abbreviation")) fail(`${key} takes only name and abbreviation`);
    if (m.abbreviation !== undefined && !isName(m.abbreviation)) fail(`${key}'s abbreviation must be a non-empty string`);
    return { name: m.name, abbreviation: m.abbreviation ?? m.name };
  };
  const read = {
    name: () => isName(definition.name) ? definition.name : fail("name must be a non-empty string"),
    months: () => {
      const list = definition.months;
      if (!Array.isArray(list) || list.length !== base.months.length) fail(`months must be ${base.months.length} months`);
      return list.map((m, i) => month(`month ${i + 1}`, m));
    },
    reclamation: () => month("reclamation", definition.reclamation),
    weekdays: () => nameList("weekdays", base.weekdays.length),
    reclamationDays: () => nameList("reclamationDays", base.reclamationDays.length),
    seasons: () => nameList("seasons", base.seasons.length),
    startYear: () => (Number.isInteger(definition.startYear) && definition.startYear >= 0)
      ? definition.startYear : fail("startYear must be an integer of 0 or more"),
    events: () => (Array.isArray(definition.events) && definition.events.every(isName))
      ? [...definition.events] : fail("events must be an array of pack ids")
  };
  const unknown = Object.keys(definition).filter((k) => !(k in read));
  if (unknown.length) fail(`unknown key ${unknown.join(", ")}`);
  const resolved = { ...base };
  for (const key of Object.keys(definition)) resolved[key] = read[key]();
  return resolved;
}

/**
 * Day of year (1-based) each season begins: midnight on 1 Mourning, 1 Sunrise, 1 Flood, 1 Quell —
 * Dead, Dry, Wet, Harvest. The SRD starts Dead, Dry and Wet on the 4th and Harvest on the 1st,
 * which cannot all be the "72 days" it states; here every season is three whole months, so none
 * crosses New Year and the Reclamation falls between two seasons rather than inside one. A table
 * decision, not the SRD's.
 */
export const SEASON_STARTS = [1, 73, 145, 217];
export const SEASON_DAYS = 72;

const DECADE_DAYS = 10 * YEAR_DAYS + RECLAMATION_DAYS;

const mod = (n, m) => ((n % m) + m) % m;

/** "Every 10 years" — read as the calendar's decade: years ending in 0. */
export const isReclamationYear = (year) => mod(year, 10) === 0;

/** Reclamation years in [0, year). */
export const reclamationsBefore = (year) => Math.floor((year + 9) / 10);

/** Days from the epoch to 1 Mourning of `year`. */
export const daysBeforeYear = (year) => year * YEAR_DAYS + RECLAMATION_DAYS * reclamationsBefore(year);

/**
 * Days since the epoch → the year, the 0-based day of that year, and whether it has a Reclamation.
 * @param {number} days
 * @returns {{year: number, dayOfYear: number, leap: boolean}}
 */
export function yearOfDay(days) {
  const decade = Math.floor(days / DECADE_DAYS);
  let rest = days - decade * DECADE_DAYS;
  const first = YEAR_DAYS + RECLAMATION_DAYS;
  if (rest < first) return { year: decade * 10, dayOfYear: rest, leap: true };
  rest -= first;
  const ordinary = Math.floor(rest / YEAR_DAYS);
  return { year: decade * 10 + 1 + ordinary, dayOfYear: rest - ordinary * YEAR_DAYS, leap: false };
}

/**
 * A season index of {@link SEASON_STARTS}, or `null` on a Reclamation day — the week belongs to no
 * month and to no season.
 * @param {number} month       0-based month index; {@link RECLAMATION} for the leap week
 * @param {number} dayOfMonth  0-based
 * @returns {number|null}
 */
export function seasonOf(month, dayOfMonth) {
  if (month === RECLAMATION) return null;
  const dayOfYear = month * MONTH_DAYS + dayOfMonth + 1;
  return SEASON_STARTS.findLastIndex((start) => start <= dayOfYear);
}

/**
 * Seconds in a day and in one watch, and where the first watch begins, for a calendar's day.
 * @param {{hoursPerDay: number, minutesPerHour: number, secondsPerMinute: number}} days
 * @returns {{day: number, watch: number, offset: number}}
 */
export function watchGeometry({ hoursPerDay, minutesPerHour, secondsPerMinute }) {
  const day = hoursPerDay * minutesPerHour * secondsPerMinute;
  return { day, watch: day / WATCHES.length, offset: day / 4 };
}

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
 * Where a click on watch `index` goes: back to the start of the watch it is now, or on to the
 * next time another watch begins. Forward is what a session mostly does; anything further back
 * than the lit watch's start is the clock's −1 h.
 * @param {number} worldTime
 * @param {number} index  an index of {@link WATCHES}
 * @param {{day: number, watch: number, offset: number}} g
 * @returns {number}
 */
export function watchStartFor(worldTime, index, g) {
  const start = worldTime - mod(worldTime - g.offset, g.watch);
  return start + mod(index - watchAt(worldTime, g), WATCHES.length) * g.watch;
}

/**
 * Twilight on an English equinox day, as fractions of the calendar's day: full dark until 04:00,
 * daylight from 06:30 to 17:30, full dark again from 20:00. The SRD names no sunrise; this is a
 * table decision. Fractions rather than hours, as the watches are, so a calendar module's longer
 * day stretches the curve with it.
 */
export const TWILIGHT = Object.freeze({ dawn: [4 / 24, 6.5 / 24], dusk: [17.5 / 24, 20 / 24] });

/**
 * A scene's darkness level at a moment, 0 to 1: linear through each twilight, in steps of 0.05 so
 * a minute's nudge lands on the same step and writes nothing.
 * @param {number} worldTime  seconds
 * @param {{day: number}} g   {@link watchGeometry}'s
 * @returns {number}
 */
export function darknessAt(worldTime, { day }) {
  const t = mod(worldTime, day) / day;
  const ramp = ([a, b]) => (t - a) / (b - a);
  let level;
  if ((t < TWILIGHT.dawn[0]) || (t >= TWILIGHT.dusk[1])) level = 1;
  else if (t < TWILIGHT.dawn[1]) level = 1 - ramp(TWILIGHT.dawn);
  else if (t < TWILIGHT.dusk[0]) level = 0;
  else level = ramp(TWILIGHT.dusk);
  return Math.round(level * 20) / 20;
}

/** Days from the epoch to a day: `month` an index of the calendar's months (12 the Reclamation),
 *  `day` 0-based. */
export const absoluteDay = (year, month, day) => daysBeforeYear(year) + month * MONTH_DAYS + day;

/**
 * Does a calendar note cover a day? The note's date is written as the SRD prints one — month and
 * day ordinals, month 13 for the Reclamation — and `year` is `null` for a note that comes back
 * every year. A note runs on through the days after it, past 24 Sunset into the next year, so an
 * annual note is tried in the day's year and in the year before: one that started last year and
 * runs past New Year still shows. Month 13 exists only in a Reclamation year.
 * @param {{year: number|null, month: number, day: number, days: number}} note
 * @param {number} absolute  days since the epoch
 * @returns {boolean}
 */
export function noteCovers(note, absolute) {
  return noteOccurrence(note, absolute) !== null;
}

/**
 * The year the occurrence of a note that covers a day begins in, or `null` when none covers it —
 * what a note's chat card is captioned with: Storm Dance read on 21 Rise is "19 Rise".
 * @param {{year: number|null, month: number, day: number, days: number}} note
 * @param {number} absolute  days since the epoch
 * @returns {number|null}
 */
export function noteOccurrence({ year, month, day, days }, absolute) {
  const here = yearOfDay(absolute).year;
  const years = year === null ? [here, here - 1] : [year];
  return years.find((y) => {
    if (month === RECLAMATION + 1 && !isReclamationYear(y)) return false;
    const start = absoluteDay(y, month - 1, day - 1);
    return absolute >= start && absolute < start + days;
  }) ?? null;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/**
 * A note's page from the text typed in the calendar's form: escaped, one `<p>` per paragraph (a
 * blank line between two), a `<br>` per line inside one. A note takes no formatting, as no other
 * text in the system's windows does; the page is still HTML so core's journal sheet shows it.
 * @param {string} text
 * @returns {string}
 */
export function noteHTML(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/[&<>"']/g, (c) => ESCAPES[c]).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * The form's text from a page: paragraphs to blank lines, line breaks to newlines, every other tag
 * dropped. Formatting added through core's journal sheet does not survive the next save from the
 * calendar; that is the rule.
 * @param {string} html
 * @returns {string}
 */
export function noteText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (m, e) => {
      if (e in ENTITIES) return ENTITIES[e];
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return m;
    })
    .trim();
}

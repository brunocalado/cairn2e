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
 */

/** "There are 24 hours in a day and 6 days in a week. Each month has 24 days (4 weeks), with
 *  12 months in a year." */
export const MONTH_DAYS = 24;
export const WEEK_DAYS = 6;
export const YEAR_DAYS = 12 * MONTH_DAYS;
/** The month index core gives the leap week: a thirteenth month with no days in an ordinary year. */
export const RECLAMATION = 12;
export const RECLAMATION_DAYS = 6;
/** "The current year is 7728." — the only year the SRD names. */
export const START_YEAR = 7728;

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

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";
import { isReclamationYear, reclamationsBefore, daysBeforeYear, yearOfDay, seasonOf, START_YEAR } from "./calendar-rules.js";

const month = (key, ordinal, days = 24, leapDays) => ({
  name: `CAIRN.Calendar.Month.${key}`, ordinal, days, ...(leapDays ? { leapDays } : {})
});

/**
 * The Vald calendar as core's `CalendarData` config. The Reclamation is a thirteenth month with no
 * days in an ordinary year and six in a leap year: core sums `leapDays ?? days` into
 * `daysPerLeapYear`, and its month loop never reaches a month of 0 days.
 *
 * `yearZero` is 0 and the stored year is the year shown: core reads `yearZero` nowhere, and 7728
 * years of seconds are far inside a double's exact range.
 */
export const VALD_CALENDAR = {
  name: "CAIRN.Calendar.Name",
  years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 10 } },
  months: {
    values: [
      month("Mourning", 1), month("Silence", 2), month("Veil", 3), month("Sunrise", 4),
      month("Bright", 5), month("Ashfall", 6), month("Flood", 7), month("Highwater", 8),
      month("Rise", 9), month("Quell", 10), month("Bane", 11), month("Sunset", 12),
      month("Reclamation", 13, 0, 6)
    ]
  },
  days: {
    values: ["Market", "Garden", "Song", "Tithe", "Bathing", "Resting"].map((key, i) => ({
      name: `CAIRN.Calendar.Weekday.${key}`, ordinal: i + 1
    })),
    daysPerYear: 288, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60
  },
  // Read by anything that reads the config; `CairnCalendar` computes the season itself.
  seasons: {
    values: [
      { name: "CAIRN.Calendar.Season.Dead", monthStart: 1, monthEnd: 3 },
      { name: "CAIRN.Calendar.Season.Dry", monthStart: 4, monthEnd: 6 },
      { name: "CAIRN.Calendar.Season.Wet", monthStart: 7, monthEnd: 9 },
      { name: "CAIRN.Calendar.Season.Harvest", monthStart: 10, monthEnd: 12 }
    ]
  }
};

/**
 * Core's leap-year arithmetic, replaced. `CalendarData#isLeapYear` makes `leapStart` a leap year
 * while `_decomposeTimeYears` starts its cycle a year earlier, so a time and the date it shows can
 * disagree around a leap; here all three read one pure function and agree by construction.
 * `componentsToTime` goes through `countLeapYears` and needs no override.
 */
export class CairnCalendar extends foundry.data.CalendarData {
  /** @override */
  isLeapYear(year) {
    return isReclamationYear(year);
  }

  /** @override */
  countLeapYears(year) {
    return reclamationsBefore(year);
  }

  /** @override */
  _decomposeTimeYears(time) {
    const { secondsPerMinute, minutesPerHour, hoursPerDay } = this.days;
    const perDay = secondsPerMinute * minutesPerHour * hoursPerDay;
    const { year, leap } = yearOfDay(Math.floor(time / perDay));
    return { year, second: time - daysBeforeYear(year) * perDay, leapYear: leap };
  }

  /**
   * Core's season loop finds no season for the Reclamation (ordinal 13 against month ranges 1–12)
   * and leaves an index one past the list; the leap week belongs to no season, so it is `null`.
   * @override
   */
  timeToComponents(time = 0) {
    const components = super.timeToComponents(time);
    components.season = seasonOf(components.month, components.dayOfMonth);
    return components;
  }
}

/**
 * Make the Vald calendar the world calendar. Called from `init`: core builds `game.time`, and the
 * calendar with it, only after `init` returns, so the config and the class are all it takes.
 */
export function registerCalendar() {
  CONFIG.time.worldCalendarConfig = VALD_CALENDAR;
  CONFIG.time.worldCalendarClass = CairnCalendar;
}

/**
 * Set a world's clock to 1 Mourning 7728, 06:00 — the first watch of the SRD's "current year" —
 * once, on the first launch under this calendar. Whatever time the world held before is
 * overwritten, not converted. Shaped like `installWorldMacros`: the active GM alone, the setting
 * written before anything else so a failure is not retried on every launch.
 */
export async function installCalendar() {
  if (!game.user.isActiveGM) return;
  if (game.settings.get(SYSTEM_ID, SETTINGS.CALENDAR_INSTALLED)) return;
  if (!(game.time.calendar instanceof CairnCalendar)) return;
  try {
    await game.settings.set(SYSTEM_ID, SETTINGS.CALENDAR_INSTALLED, true);
    await game.time.set(game.time.calendar.componentsToTime({ year: START_YEAR, day: 0, hour: 6 }));
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not set the Vald calendar's start date`, err);
  }
}

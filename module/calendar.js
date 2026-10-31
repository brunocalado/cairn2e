/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS, FLAGS } from "./constants.js";
import {
  isReclamationYear, reclamationsBefore, daysBeforeYear, yearOfDay, seasonOf, MONTH_DAYS, YEAR_DAYS, RECLAMATION,
  RECLAMATION_DAYS, VALD_DEFINITION, resolveCalendarDefinition, watchGeometry, watchAt, nextWatchStart, darknessAt
} from "./calendar-rules.js";

/** The calendar's names, first year and event packs: Vald's, until a module defines its own. */
let definition = VALD_DEFINITION;

/** The Reclamation's six days, by name — drawn in place of the weekdays during the leap week. */
export const reclamationDayNames = () => definition.reclamationDays;

/** The packs a new world's calendar events are imported from, in order. */
export const calendarEventPacks = () => definition.events;

/**
 * The calendar as core's `CalendarData` config, named by a definition. The Reclamation is a
 * thirteenth month with no days in an ordinary year and six in a leap year: core sums
 * `leapDays ?? days` into `daysPerLeapYear`, and its month loop never reaches a month of 0 days.
 *
 * `yearZero` is 0 and the stored year is the year shown: core reads `yearZero` nowhere, and 7728
 * years of seconds are far inside a double's exact range.
 */
function calendarConfig({ name, months, reclamation, weekdays, seasons }) {
  return {
    name,
    years: { yearZero: 0, firstWeekday: 0, leapYear: { leapStart: 0, leapInterval: 10 } },
    months: {
      values: [
        ...months.map((m, i) => ({ ...m, ordinal: i + 1, days: MONTH_DAYS })),
        { ...reclamation, ordinal: RECLAMATION + 1, days: 0, leapDays: RECLAMATION_DAYS }
      ]
    },
    days: {
      values: weekdays.map((weekday, i) => ({ name: weekday, ordinal: i + 1 })),
      daysPerYear: YEAR_DAYS, hoursPerDay: 24, minutesPerHour: 60, secondsPerMinute: 60
    },
    // Read by anything that reads the config; `CairnCalendar` computes the season itself.
    seasons: {
      values: seasons.map((season, i) => ({ name: season, monthStart: 3 * i + 1, monthEnd: 3 * i + 3 }))
    }
  };
}

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
  CONFIG.time.worldCalendarConfig = calendarConfig(definition);
  CONFIG.time.worldCalendarClass = CairnCalendar;
}

/**
 * Rename the calendar, choose the year a new world starts in, or the packs a new world's events
 * come from — for a module, from its `init` hook (or `i18nInit` for a `library: true` module,
 * whose scripts load before the system's, so `game.cairn2e` does not exist yet during its `init`).
 * Core builds the calendar from `CONFIG.time` once `init` and `i18nInit` are over; a call after
 * that throws and changes nothing.
 *
 * Every key is optional and a key left out keeps Vald's value; a key given is taken whole. Names
 * are literal strings or i18n keys. `startYear` applies only to a world's first launch, and
 * `events` (pack ids, replacing `cairn2e.vald-calendar`) only to the events imported then and by
 * the Warden's import button. A later call replaces an earlier one; it is never merged with it.
 * Nothing is stored: the definition is read on every load, so an updated or disabled module
 * changes the names on the next reload, and the notes, which hold numbers, keep their days.
 * @param {{name?: string, months?: {name: string, abbreviation?: string}[],
 *   reclamation?: {name: string, abbreviation?: string}, weekdays?: string[],
 *   reclamationDays?: string[], seasons?: string[], startYear?: number, events?: string[]}} given
 *   12 months, 6 weekdays, 6 Reclamation days, 4 seasons in Dead, Dry, Wet, Harvest order
 */
export function defineCalendar(given) {
  if (game.time) throw new Error(`${SYSTEM_ID} | defineCalendar is called from init or i18nInit, before the world calendar is built`);
  definition = resolveCalendarDefinition(VALD_DEFINITION, given);
  if (CONFIG.time.worldCalendarClass === CairnCalendar) CONFIG.time.worldCalendarConfig = calendarConfig(definition);
}

/**
 * Set a world's clock to 1 Mourning 7728, 06:00 — the first watch of the SRD's "current year", or
 * the first year a module defined — once, on the first launch under this calendar. Whatever time the world held before is
 * overwritten, not converted. Shaped like `installWorldMacros`: the active GM alone, the setting
 * written before anything else so a failure is not retried on every launch.
 */
export async function installCalendar() {
  if (!game.user.isActiveGM) return;
  if (game.settings.get(SYSTEM_ID, SETTINGS.CALENDAR_INSTALLED)) return;
  if (!(game.time.calendar instanceof CairnCalendar)) return;
  try {
    await game.settings.set(SYSTEM_ID, SETTINGS.CALENDAR_INSTALLED, true);
    await game.time.set(game.time.calendar.componentsToTime({ year: definition.startYear, day: 0, hour: 6 }));
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not set the Vald calendar's start date`, err);
  }
}

/**
 * A day's name: "7 Silence 7728", or "Rejoice 7730" on a Reclamation day, which belongs to no
 * month. `month` is an index of the calendar's months (12 the Reclamation), `day` 0-based. A
 * `null` year names the day of every year — "19 Rise" — as an annual note's is.
 */
export function formatDate(year, month, day) {
  const annual = year === null;
  if (month === RECLAMATION) {
    const name = game.i18n.localize(definition.reclamationDays[day]);
    return annual ? name : game.i18n.localize("CAIRN.Calendar.ReclamationDate", { day: name, year });
  }
  const name = game.i18n.localize(game.time.calendar.months.values[month].name);
  return game.i18n.localize(annual ? "CAIRN.Calendar.AnnualDate" : "CAIRN.Calendar.Date", { day: day + 1, month: name, year });
}

/** The watch geometry of the world's calendar — its day need not be 24 hours, so a calendar
 *  module's config works here too. */
export function geometry() {
  return watchGeometry(game.time.calendar.days);
}

/** The watch it is now: an index of `WATCHES` (`journey-rules.js`). */
export function currentWatch() {
  return watchAt(game.time.worldTime, geometry());
}

/** Move the world to the start of the next watch. Writes `core.time`, so the Warden's. */
export function advanceWatch() {
  return game.time.set(nextWatchStart(game.time.worldTime, geometry()));
}

/**
 * Set the active scene's darkness from the clock, if it follows the clock. Called on
 * `updateWorldTime` and not from `CairnCalendar`, so it still runs under a calendar module. The
 * active GM alone writes it: the hook fires on every client, and a player may not update a scene.
 * A locked scene is left alone, since core drops a level written without its lock.
 */
export function syncSceneDarkness() {
  const scene = game.scenes.active;
  if (!game.user.isActiveGM || !scene) return;
  if (!game.settings.get(SYSTEM_ID, SETTINGS.CLOCK_DARKNESS)) return;
  if (!scene.getFlag(SYSTEM_ID, FLAGS.FOLLOWS_CLOCK) || scene.environment.darknessLock) return;
  const level = darknessAt(game.time.worldTime, geometry());
  if (level === scene.environment.darknessLevel) return;
  return scene.update({ "environment.darknessLevel": level }, { animateDarkness: true });
}

/* -------------------------------------------- */

/** The read-only date and time under the chat box's Format menu: one element, moved with the box. */
let chatClock;

/**
 * Put the clock between the chat box's Format menu and its text, from `renderChatInput`. The box
 * is one `<prose-mirror>` that core moves between the sidebar, the popout and the notifications
 * area, and every move empties it (`replaceChildren` on connect) and builds the editor again
 * asynchronously — the menu does not exist yet when the hook fires. So the clock goes in on the
 * element's own `open` event, which core dispatches once the editor and its menu are built; the
 * listener is added once, because the element outlives every move.
 * @param {HTMLElement} input   `#chat-message`
 */
export function mountChatClock(input) {
  if (!input || !(game.time.calendar instanceof CairnCalendar)) return;
  if (!chatClock) {
    chatClock = document.createElement("div");
    chatClock.className = `${SYSTEM_ID} cairn-chat-clock`;
    chatClock.append(document.createElement("span"), document.createElement("span"));
    input.addEventListener("open", () => placeChatClock(input));
  }
  placeChatClock(input);
}

function placeChatClock(input) {
  const menu = input.querySelector(":scope > .menu-container");
  if (!menu) return;
  refreshChatClock();
  menu.after(chatClock);
}

/** Redraw the chat clock from the world time. Called on `updateWorldTime`. */
export function refreshChatClock() {
  if (!chatClock) return;
  const now = game.time.components;
  const pad = (n) => String(n).padStart(2, "0");
  const [date, time] = chatClock.children;
  date.textContent = formatDate(now.year, now.month, now.dayOfMonth);
  time.textContent = `${pad(now.hour)}:${pad(now.minute)}`;
}

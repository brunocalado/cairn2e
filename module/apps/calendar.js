/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "../constants.js";
import { WATCHES } from "../journey-rules.js";
import {
  MONTH_DAYS, RECLAMATION, RECLAMATION_DAYS, SEASON_STARTS, SEASON_DAYS, YEAR_DAYS,
  isReclamationYear, seasonOf, watchStartFor
} from "../calendar-rules.js";
import { RECLAMATION_DAY_NAMES, geometry, currentWatch, formatDate } from "../calendar.js";
import { noteOf, notesOn, isPublic } from "../calendar-notes.js";
import { noteText, noteOccurrence, absoluteDay } from "../calendar-rules.js";
import { postCalendarNoteCard } from "../rolls.js";
import { CairnCalendarNote } from "./calendar-note.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { CairnJourneyTracker } from "./journey-tracker.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/calendar`;

/** The Warden's quick shifts, in minutes, either side of the clock. */
const SHIFTS_BACK = [-60, -30, -15];
const SHIFTS_ON = [15, 30, 60];

const pad = (n) => String(n).padStart(2, "0");

/**
 * The Vald calendar window — one per client, read by everyone, and the Warden's hand on the
 * world clock. It holds nothing but what it is LOOKING at (`#view`); the date, the watch and the
 * time are read off `game.time` on every render, and `updateWorldTime` redraws every open window
 * (`module/cairn2e.js`), so the Warden's change is what every client shows a moment later.
 *
 * During a journey none of the Warden's time controls moves time: the journey is the procedure
 * that spends it (a Ration, an event, the day's weather), and an hour skipped across a watch
 * boundary would move its clock without resolving the watch. A click on the dial opens the
 * journey instead.
 *
 * Opening it: the Notes group of the scene controls (everyone), the Warden's sidebar tab, or the
 * Warden's "Show to players", a socket broadcast every other client answers by opening its own
 * window on the Warden's month and day.
 */
export class CairnCalendarApp extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — the day part's notes scroll, and their rules move with them. */
  static INK_SCROLLERS = [".cairn-calendar-notes"];

  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-calendar`,
    classes: [SYSTEM_ID, "cairn-calendar"],
    window: { title: "CAIRN.Calendar.Title", icon: "fa-solid fa-calendar-days" },
    position: { width: 640, height: "auto" },
    actions: {
      viewYear: CairnCalendarApp.#onViewYear,
      viewMonth: CairnCalendarApp.#onViewMonth,
      pickDay: CairnCalendarApp.#onPickDay,
      viewToday: CairnCalendarApp.#onViewToday,
      pickWatch: CairnCalendarApp.#onPickWatch,
      shiftTime: CairnCalendarApp.#onShiftTime,
      showToPlayers: CairnCalendarApp.#onShowToPlayers,
      postNote: CairnCalendarApp.#onPostNote,
      editNote: CairnCalendarApp.#onEditNote,
      deleteNote: CairnCalendarApp.#onDeleteNote
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    year: { template: `${TEMPLATES}/year.hbs` },
    month: { template: `${TEMPLATES}/month.hbs` },
    day: { template: `${TEMPLATES}/day.hbs`, scrollable: [".cairn-calendar-notes"] }
  };

  /** The one window this client has. */
  static #instance = null;

  /** What the window is looking at: `{ year, month, day }`, month an index of the calendar's
   *  months (12 the Reclamation) and day 0-based. Today, until someone browses. */
  #view = null;

  /**
   * Open the window, or bring the open one forward. `view` moves it to that day — the Warden's
   * Show to players, which arrives over the socket and is checked like any payload. A window
   * opened fresh with no view looks at today.
   * @param {{year: number, month: number, day: number}} [view]
   */
  static open(view) {
    const app = (CairnCalendarApp.#instance ??= new CairnCalendarApp());
    if (view) app.#view = CairnCalendarApp.#clamp(view);
    else if (!app.rendered) app.#view = null;
    return app.render({ force: true });
  }

  /** Redraw the open window: the time moved, a journey began or ended, or a note changed. */
  static refresh() {
    const app = CairnCalendarApp.#instance;
    if (app?.rendered) app.render();
  }

  /**
   * Redraw every open calendar when a note changes on any client — the Warden's edit, a note
   * switched to Everyone, a page rewritten in core's journal sheet. Registered once, at `ready`.
   * Debounced: saving a note writes its entry and its page, two hooks for one change.
   */
  static watchNotes() {
    const redraw = foundry.utils.debounce(() => CairnCalendarApp.refresh(), 50);
    const isNote = (entry, changes) => !!noteOf(entry) || !!changes?.flags?.[SYSTEM_ID];
    for (const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) {
      Hooks.on(hook, (entry, changes) => { if (isNote(entry, changes)) redraw(); });
    }
    for (const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage"]) {
      Hooks.on(hook, (page) => { if (noteOf(page.parent)) redraw(); });
    }
  }

  /** Today, as a view. */
  static #today() {
    const now = game.time.components;
    return { year: now.year, month: now.month, day: now.dayOfMonth };
  }

  /** A view brought inside the calendar: a year from 0, a month that exists that year, a day that
   *  exists in that month. Anything not a number reads as today's. */
  static #clamp({ year, month, day } = {}) {
    const today = CairnCalendarApp.#today();
    const int = (v, fallback) => (Number.isInteger(v) ? v : fallback);
    const y = Math.max(0, int(year, today.year));
    const lastMonth = isReclamationYear(y) ? RECLAMATION : RECLAMATION - 1;
    const m = Math.clamp(int(month, today.month), 0, lastMonth);
    const length = m === RECLAMATION ? RECLAMATION_DAYS : MONTH_DAYS;
    return { year: y, month: m, day: Math.clamp(int(day, 0), 0, length - 1) };
  }

  /** A journey is underway: the Warden's time controls step aside for it. */
  static get #journeying() {
    return !!game.settings.get(SYSTEM_ID, SETTINGS.JOURNEY);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const cal = game.time.calendar;
    const now = game.time.components;
    const view = (this.#view ??= CairnCalendarApp.#today());
    const isGM = game.user.isGM;
    const journeying = CairnCalendarApp.#journeying;
    const t = (key, data) => game.i18n.localize(key, data);

    // Header and dial.
    const g = geometry();
    const lit = currentWatch();
    const secondsPerHour = cal.days.minutesPerHour * cal.days.secondsPerMinute;
    const clock = (seconds) => {
      const h = Math.floor(seconds / secondsPerHour);
      return `${pad(h % cal.days.hoursPerDay)}:${pad(Math.floor((seconds - h * secondsPerHour) / cal.days.secondsPerMinute))}`;
    };
    const into = ((game.time.worldTime - g.offset) % g.day + g.day) % g.day;
    context.today = { date: formatDate(now.year, now.month, now.dayOfMonth), sub: this.#subOf(now.year, now.month, now.dayOfMonth) };
    context.time = `${pad(now.hour)}:${pad(now.minute)}`;
    context.isGM = isGM;
    context.journeying = journeying;
    context.journeyHint = t("CAIRN.Calendar.JourneyHint");
    context.needle = (into / g.day * 100).toFixed(3);
    context.watches = WATCHES.map((key, index) => {
      const watch = t(`CAIRN.Watches.${key}`);
      const start = clock(g.offset + index * g.watch);
      let hint = watch;
      if (isGM) hint = journeying ? t("CAIRN.Calendar.WatchJourney", { watch })
        : t(index === lit ? "CAIRN.Calendar.WatchBack" : "CAIRN.Calendar.WatchOn", { watch, time: start });
      return { key, index, watch, lit: index === lit, hint };
    });
    context.ticks = [0, 1, 2, 0].map((i, n) => ({ label: clock(g.offset + i * g.watch), at: n }));
    const shift = (minutes) => {
      const n = Math.abs(minutes);
      const hours = n % cal.days.minutesPerHour === 0;
      return {
        minutes,
        label: t(hours ? "CAIRN.Calendar.ShiftHours" : "CAIRN.Calendar.ShiftMinutes",
          { sign: minutes < 0 ? "−" : "+", n: hours ? n / cal.days.minutesPerHour : n }),
        hint: t(minutes < 0 ? "CAIRN.Calendar.ShiftBack" : "CAIRN.Calendar.ShiftOn", { n })
      };
    };
    context.shiftsBack = SHIFTS_BACK.map(shift);
    context.shiftsOn = SHIFTS_ON.map(shift);

    // The year strip: one column a day, and a month-wide Reclamation block after Sunset in a year
    // that has one. Seasons are three whole months, so each banner spans exactly three.
    const leap = isReclamationYear(view.year);
    context.view = view;
    context.columns = YEAR_DAYS + (leap ? MONTH_DAYS : 0);
    context.seasons = cal.seasons.values.map((s, i) => ({ name: t(s.name), from: SEASON_STARTS[i], span: SEASON_DAYS }));
    context.months = cal.months.values.slice(0, leap ? RECLAMATION + 1 : RECLAMATION).map((m, index) => ({
      index,
      abbr: t(m.abbreviation),
      name: t(m.name),
      from: index * MONTH_DAYS + 1,
      viewed: index === view.month,
      today: view.year === now.year && index === now.month,
      reclamation: index === RECLAMATION
    }));

    // The month grid. Every year length is a multiple of six, so every month and the Reclamation
    // begin on the week's first day and the grid needs no leading blanks.
    const reclamation = view.month === RECLAMATION;
    const month = cal.months.values[view.month];
    context.reclamation = reclamation;
    context.monthName = t(month.name);
    context.monthSub = reclamation ? t("CAIRN.Calendar.ReclamationCaption")
      : t("CAIRN.Calendar.MonthOf", { n: view.month + 1, of: RECLAMATION });
    context.heads = reclamation ? RECLAMATION_DAY_NAMES.map((k) => t(k)) : cal.days.values.map((d) => t(d.name));
    const length = reclamation ? RECLAMATION_DAYS : MONTH_DAYS;
    context.days = Array.from({ length }, (_, day) => {
      const dayOfYear = view.month * MONTH_DAYS + day + 1;
      const season = reclamation ? -1 : SEASON_STARTS.indexOf(dayOfYear);
      // A filled mark for a note everyone reads, a hollow one for the Warden's own.
      const notes = notesOn(view.year, view.month, day);
      return {
        day,
        number: day + 1,
        label: formatDate(view.year, view.month, day),
        publicNote: notes.some(({ entry }) => isPublic(entry)),
        wardenNote: notes.some(({ entry }) => !isPublic(entry)),
        today: view.year === now.year && view.month === now.month && day === now.dayOfMonth,
        selected: day === view.day,
        seasonStart: season >= 0 ? t(cal.seasons.values[season].name) : ""
      };
    });

    // The selected day, and the notes on it this user may read.
    context.detail = { date: formatDate(view.year, view.month, view.day), sub: this.#subOf(view.year, view.month, view.day) };
    context.notes = notesOn(view.year, view.month, view.day).map(({ entry, note }) => ({
      id: entry.id,
      title: entry.name,
      text: noteText(entry.pages.find((p) => p.type === "text")?.text.content),
      annual: note.year === null,
      wardenOnly: !isPublic(entry)
    }));
    return context;
  }

  /** "Market Day · Dead season, day 31 of 72", or "Reclamation, day 4 of 6". */
  #subOf(year, month, day) {
    const cal = game.time.calendar;
    if (month === RECLAMATION) return game.i18n.localize("CAIRN.Calendar.ReclamationSub", { day: day + 1, days: RECLAMATION_DAYS });
    const time = cal.componentsToTime({ year, day: month * MONTH_DAYS + day });
    const weekday = game.i18n.localize(cal.days.values[cal.timeToComponents(time).dayOfWeek].name);
    const season = seasonOf(month, day);
    return game.i18n.localize("CAIRN.Calendar.DaySub", {
      weekday,
      season: game.i18n.localize(cal.seasons.values[season].name),
      day: month * MONTH_DAYS + day + 2 - SEASON_STARTS[season],
      days: SEASON_DAYS
    });
  }

  /** @override — the two fields answer a change, not a click. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId === "header") htmlElement.querySelector("input[name='time']")?.addEventListener("change", (event) => this.#onSetTime(event));
    if (partId === "year") htmlElement.querySelector("input[name='year']")?.addEventListener("change", (event) => {
      this.#view = CairnCalendarApp.#clamp({ ...this.#view, year: Number.parseInt(event.target.value, 10) });
      this.render();
    });
  }

  /** @override — the day menu is bound once: the element outlives every re-render, and core's
   *  menu delegates from it to whichever day is under the pointer. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    if (!game.user.isGM) return;
    new foundry.applications.ux.ContextMenu.implementation(this.element, "[data-day]", [
      {
        label: "CAIRN.Calendar.AddNote",
        icon: '<i class="fa-solid fa-plus"></i>',
        onClick: (event, target) => {
          const { year, month } = this.#view;
          CairnCalendarNote.open({ date: { year, month, day: Number(target.dataset.day) } });
        }
      },
      {
        label: "CAIRN.Calendar.MakeToday",
        icon: '<i class="fa-solid fa-calendar-check"></i>',
        visible: (target) => !CairnCalendarApp.#journeying && !this.#isToday(target),
        onClick: (event, target) => this.#makeToday(target)
      }
    ], { jQuery: false, fixed: true });
  }

  /** Is the day under the menu today? */
  #isToday(target) {
    const now = game.time.components;
    const { year, month } = this.#view;
    return year === now.year && month === now.month && Number(target.dataset.day) === now.dayOfMonth;
  }

  /** The Warden's *Make this today*: that day, at the time of day it is now. */
  #makeToday(target) {
    if (!game.user.isGM || CairnCalendarApp.#journeying) return;
    const now = game.time.components;
    const { year, month } = this.#view;
    const day = month * MONTH_DAYS + Number(target.dataset.day);
    return game.time.set(game.time.calendar.componentsToTime({ year, day, hour: now.hour, minute: now.minute, second: now.second }));
  }

  /** The Warden types the time: today, at that hour and minute. A time the day does not have puts
   *  the field back. */
  #onSetTime(event) {
    if (!game.user.isGM || CairnCalendarApp.#journeying) return this.render();
    const { hoursPerDay, minutesPerHour } = game.time.calendar.days;
    const match = /^\s*(\d{1,2})\s*[:.h]?\s*(\d{2})\s*$/.exec(event.target.value);
    const hour = Number(match?.[1]);
    const minute = Number(match?.[2]);
    if (!match || hour >= hoursPerDay || minute >= minutesPerHour) return this.render();
    const now = game.time.components;
    return game.time.set(game.time.calendar.componentsToTime({ year: now.year, day: now.day, hour, minute }));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {CairnCalendarApp} */
  static #onViewYear(event, target) {
    this.#view = CairnCalendarApp.#clamp({ ...this.#view, year: this.#view.year + Number(target.dataset.delta) });
    this.render();
  }

  /** A month on the strip, or one step either way from the grid's arrows — through the
   *  Reclamation in a year that has one, and over New Year. @this {CairnCalendarApp} */
  static #onViewMonth(event, target) {
    let { year, month, day } = this.#view;
    if (target.dataset.month !== undefined) month = Number(target.dataset.month);
    else {
      const last = () => (isReclamationYear(year) ? RECLAMATION : RECLAMATION - 1);
      month += Number(target.dataset.delta);
      if (month > last()) { year += 1; month = 0; }
      else if (month < 0) { year -= 1; month = last(); }
    }
    this.#view = CairnCalendarApp.#clamp({ year, month, day });
    this.render();
  }

  /** @this {CairnCalendarApp} */
  static #onPickDay(event, target) {
    this.#view = { ...this.#view, day: Number(target.dataset.day) };
    this.render();
  }

  /** @this {CairnCalendarApp} */
  static #onViewToday() {
    this.#view = CairnCalendarApp.#today();
    this.render();
  }

  /** The Warden's dial: on to the next start of another watch, or back to the start of the lit
   *  one. During a journey it opens the journey and moves nothing. */
  static #onPickWatch(event, target) {
    if (!game.user.isGM) return;
    if (CairnCalendarApp.#journeying) return CairnJourneyTracker.open();
    return game.time.set(watchStartFor(game.time.worldTime, Number(target.dataset.watch), geometry()));
  }

  static #onShiftTime(event, target) {
    if (!game.user.isGM || CairnCalendarApp.#journeying) return;
    return game.time.advance(Number(target.dataset.minutes) * game.time.calendar.days.secondsPerMinute);
  }

  /** The note a row stands for, or null if it is gone. */
  static #noteEntry(target) {
    const entry = game.journal.get(target.closest("[data-note-id]")?.dataset.noteId);
    return noteOf(entry) ? entry : null;
  }

  /** Anyone who can read a note can post it; the card's caption is the day this occurrence of it
   *  began. @this {CairnCalendarApp} */
  static #onPostNote(event, target) {
    const entry = CairnCalendarApp.#noteEntry(target);
    if (!entry) return;
    const note = noteOf(entry);
    const { year, month, day } = this.#view;
    const start = noteOccurrence(note, absoluteDay(year, month, day)) ?? year;
    return postCalendarNoteCard(entry, { date: formatDate(start, note.month - 1, note.day - 1) });
  }

  static #onEditNote(event, target) {
    if (!game.user.isGM) return;
    const entry = CairnCalendarApp.#noteEntry(target);
    if (entry) CairnCalendarNote.open({ entry });
  }

  static #onDeleteNote(event, target) {
    if (!game.user.isGM) return;
    const entry = CairnCalendarApp.#noteEntry(target);
    if (entry) return CairnCalendarNote.confirmDelete(entry);
  }

  /** Every other connected client opens its window on the day the Warden is looking at.
   *  @this {CairnCalendarApp} */
  static #onShowToPlayers() {
    if (!game.user.isGM) return;
    game.socket.emit(`system.${SYSTEM_ID}`, { type: "openCalendar", view: { ...this.#view } });
    ui.notifications.info(game.i18n.localize("CAIRN.Calendar.Shown"));
  }
}

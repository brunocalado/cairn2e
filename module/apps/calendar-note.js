/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { MONTH_DAYS, RECLAMATION, RECLAMATION_DAYS, isReclamationYear, noteText } from "../calendar-rules.js";
import { noteOf, isPublic, saveNote } from "../calendar-notes.js";
import { formatDate } from "../calendar.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/calendar-note`;

/**
 * One calendar note's form, the Warden's alone: opened from *Add a note* on a day's right-click
 * menu, or from a note's edit control in the calendar. A window per note, so two can be open at
 * once; saving writes the entry and its page together (`calendar-notes.js#saveNote`) and every
 * calendar redraws from the journal hooks. The text is plain: what was typed goes into the page as
 * paragraphs, and comes back out of it as text.
 */
export class CairnCalendarNote extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — nothing here scrolls. */
  static INK_SCROLLERS = [];

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-calendar-note-form"],
    tag: "form",
    position: { width: 480, height: "auto" },
    window: { icon: "fa-solid fa-pen-to-square" },
    form: { handler: CairnCalendarNote.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: { deleteNote: CairnCalendarNote.#onDelete }
  };

  static PARTS = {
    form: { template: `${TEMPLATES}/form.hbs` },
    foot: { template: `${TEMPLATES}/foot.hbs` }
  };

  /**
   * Open the form for a note, or bring its open one forward.
   * @param {{entry?: JournalEntry, date?: {year: number, month: number, day: number}}} options
   *   `entry` to edit one; `date` (month an index, 12 the Reclamation, day 0-based) for a new one
   */
  static open({ entry, date } = {}) {
    if (!game.user.isGM) return;
    const id = `${SYSTEM_ID}-calendar-note-${entry?.id ?? "new"}`;
    const app = foundry.applications.instances.get(id) ?? new CairnCalendarNote({ id, entry, date });
    return app.render({ force: true });
  }

  /** Delete a note, after asking; its form closes with it. */
  static async confirmDelete(entry) {
    const yes = await DialogV2.confirm({
      classes: [SYSTEM_ID],
      window: { title: "CAIRN.Calendar.DeleteNote" },
      content: `<p>${game.i18n.localize("CAIRN.Calendar.DeleteConfirm", { name: foundry.utils.escapeHTML(entry.name) })}</p>`
    });
    if (!yes) return false;
    await foundry.applications.instances.get(`${SYSTEM_ID}-calendar-note-${entry.id}`)?.close();
    await entry.delete();
    return true;
  }

  /** @param {{entry?: JournalEntry, date?: object}} options */
  constructor({ entry = null, date = null, ...options } = {}) {
    super(options);
    this.entry = entry;
    this.date = date;
  }

  /** The note being edited, or the one a new note starts as: one day, on the day clicked. */
  get #note() {
    if (this.entry) return noteOf(this.entry);
    const { year, month, day } = this.date ?? { year: game.time.components.year, month: 0, day: 0 };
    return { year, month: month + 1, day: day + 1, days: 1 };
  }

  /** @override */
  get title() {
    const { year, month, day } = this.#note;
    const date = formatDate(year, month - 1, day - 1);
    return game.i18n.localize("CAIRN.Calendar.NoteWindow", { date });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const note = this.#note;
    const page = this.entry?.pages.find((p) => p.type === "text");
    context.appId = this.id;
    context.note = note;
    context.title = this.entry?.name ?? "";
    context.text = noteText(page?.text.content);
    context.annual = note.year === null;
    context.year = note.year ?? this.date?.year ?? game.time.components.year;
    context.everyone = this.entry ? isPublic(this.entry) : false;
    context.canDelete = !!this.entry;
    context.months = game.time.calendar.months.values.map((m) => ({
      ordinal: m.ordinal, name: game.i18n.localize(m.name), selected: m.ordinal === note.month
    }));
    return context;
  }

  /** @override — the Year field goes while Every year is on: an annual note has none. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "form") return;
    const year = htmlElement.querySelector(".cairn-calendar-note-year");
    htmlElement.querySelector("input[name='annual']")?.addEventListener("change", (event) => {
      year.hidden = event.target.checked;
    });
  }

  /**
   * Save. The form is the boundary, so every number is checked here: a day the month has, a length
   * of at least one day, and a once-only Reclamation note only in a year that has one.
   * @this {CairnCalendarNote}
   */
  static async #onSubmit(event, form, formData) {
    if (!game.user.isGM) return;
    const data = formData.object;
    const month = Number(data.month);
    const day = Number(data.day);
    const days = Number(data.days);
    const year = data.annual ? null : Number(data.year);
    const length = month === RECLAMATION + 1 ? RECLAMATION_DAYS : MONTH_DAYS;
    const int = Number.isInteger;
    let problem = null;
    if (!int(month) || month < 1 || month > RECLAMATION + 1 || !int(day) || day < 1 || day > length) problem = "CAIRN.Calendar.BadDay";
    else if (!int(days) || days < 1) problem = "CAIRN.Calendar.BadLength";
    else if (year !== null && (!int(year) || year < 0)) problem = "CAIRN.Calendar.BadYear";
    else if (year !== null && month === RECLAMATION + 1 && !isReclamationYear(year)) problem = "CAIRN.Calendar.NoReclamation";
    if (problem) return ui.notifications.warn(game.i18n.localize(problem));
    await saveNote({
      entry: this.entry, title: String(data.title ?? ""), text: String(data.text ?? ""),
      note: { year, month, day, days }, everyone: !!data.everyone
    });
    return this.close();
  }

  /** @this {CairnCalendarNote} */
  static async #onDelete() {
    if (this.entry) await CairnCalendarNote.confirmDelete(this.entry);
  }
}

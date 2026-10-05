/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS, FLAGS } from "./constants.js";
import { MONTH_DAYS, RECLAMATION, RECLAMATION_DAYS, absoluteDay, noteCovers, noteHTML } from "./calendar-rules.js";

/**
 * Calendar notes. A note is a JournalEntry with one text page, its date in
 * `flags.cairn2e.calendarNote`; who may read it is the entry's own ownership — Observer for
 * everyone, None for the Warden alone — so core's journal sidebar and the calendar agree on it.
 * One entry per note and not one per day: a note that comes back every year belongs to no single
 * year's day. Notes and their folder are found by flag, never by name, which is whatever the
 * language or the Warden made it.
 */

const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;

/**
 * A note's date off its entry, or `null` when the entry is not a note. The flag has one shape;
 * an entry whose flag does not fit it is not a note, and nothing guesses at another.
 * @param {JournalEntry} entry
 * @returns {{year: number|null, month: number, day: number, days: number}|null}
 */
export function noteOf(entry) {
  const note = entry?.getFlag(SYSTEM_ID, FLAGS.CALENDAR_NOTE);
  if (!note || typeof note !== "object") return null;
  const { year, month, day, days } = note;
  const int = Number.isInteger;
  if (!(year === null || (int(year) && year >= 0))) return null;
  if (!int(month) || month < 1 || month > RECLAMATION + 1) return null;
  if (!int(day) || day < 1 || day > (month === RECLAMATION + 1 ? RECLAMATION_DAYS : MONTH_DAYS)) return null;
  if (!int(days) || days < 1) return null;
  return { year, month, day, days };
}

/** Everyone may read it: the switch in the note form, said as the entry's default ownership. */
export const isPublic = (entry) => (entry.ownership.default ?? LEVELS.NONE) >= LEVELS.OBSERVER;

/**
 * Every note this user may read: one walk of the journal, for a caller that asks about many days
 * at once — the calendar's month grid asks about 25, and walked the journal 25 times.
 * @returns {{entry: JournalEntry, note: object}[]}
 */
export function readableNotes() {
  const found = [];
  for (const entry of game.journal) {
    const note = noteOf(entry);
    if (note && entry.testUserPermission(game.user, "OBSERVER")) found.push({ entry, note });
  }
  return found;
}

/**
 * The notes covering a day that this user may read, in the order of their dates.
 * @param {number} year
 * @param {number} month  an index of the calendar's months, 12 the Reclamation
 * @param {number} day    0-based
 * @param {{entry: JournalEntry, note: object}[]} [notes]  `readableNotes()`, walked once by a
 *   caller that asks about many days
 * @returns {{entry: JournalEntry, note: object}[]}
 */
export function notesOn(year, month, day, notes = readableNotes()) {
  const at = absoluteDay(year, month, day);
  return notes.filter(({ note }) => noteCovers(note, at))
    .sort((a, b) => (a.note.month - b.note.month) || (a.note.day - b.note.day) || a.entry.name.localeCompare(b.entry.name));
}

/** The folder new notes go in, or `undefined` if the Warden deleted it. */
function noteFolder() {
  return game.folders.find((f) => f.type === "JournalEntry" && f.getFlag(SYSTEM_ID, FLAGS.CALENDAR_FOLDER));
}

/** The folder, made again if the Warden deleted it. */
async function ensureFolder() {
  return noteFolder() ?? foundry.documents.Folder.implementation.create({
    name: game.i18n.localize("CAIRN.Calendar.Folder"),
    type: "JournalEntry",
    flags: { [SYSTEM_ID]: { [FLAGS.CALENDAR_FOLDER]: true } }
  });
}

/**
 * Import the SRD's dated events from `cairn2e.vald-calendar` into a new world's note folder, once,
 * visible to everyone. Shaped like `installWorldMacros`: the active GM alone, the setting written
 * before anything is created, so a Warden who deletes the folder is not handed it back. A pack
 * changed later does not reach a world that already imported it; to take the new events, delete
 * the folder and clear `calendar-events-installed`.
 */
export async function installCalendarEvents() {
  if (!game.user.isActiveGM) return;
  if (game.settings.get(SYSTEM_ID, SETTINGS.CALENDAR_EVENTS_INSTALLED)) return;
  try {
    await game.settings.set(SYSTEM_ID, SETTINGS.CALENDAR_EVENTS_INSTALLED, true);
    const pack = game.packs.get(`${SYSTEM_ID}.vald-calendar`);
    const folder = await ensureFolder();
    const data = (await pack.getDocuments()).map((doc) => {
      const entry = game.journal.fromCompendium(doc);
      entry.folder = folder.id;
      entry.ownership = { default: LEVELS.OBSERVER };
      return entry;
    });
    await foundry.documents.JournalEntry.implementation.createDocuments(data);
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not import the Vald calendar's events`, err);
  }
}

/**
 * Create a note, or rewrite one: the entry and its one text page together. The page is HTML the
 * system writes from the plain text (`noteHTML`), so core's journal sheet still shows it.
 * @param {object} data
 * @param {JournalEntry} [data.entry]  the note being edited; none for a new one
 * @param {string} data.title
 * @param {string} data.text
 * @param {{year: number|null, month: number, day: number, days: number}} data.note
 * @param {boolean} data.everyone
 * @param {boolean} [data.weather]  a new note is the day's weather (`FLAGS.WEATHER`)
 */
export async function saveNote({ entry, title, text, note, everyone, weather = false }) {
  const name = title.trim() || game.i18n.localize("CAIRN.Calendar.Untitled");
  const content = noteHTML(text);
  const format = CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML;
  const ownership = { default: everyone ? LEVELS.OBSERVER : LEVELS.NONE };
  const flag = `flags.${SYSTEM_ID}.${FLAGS.CALENDAR_NOTE}`;
  if (!entry) {
    const folder = await ensureFolder();
    return foundry.documents.JournalEntry.implementation.create({
      name, folder: folder.id, ownership, [flag]: note,
      ...(weather && { [`flags.${SYSTEM_ID}.${FLAGS.WEATHER}`]: true }),
      pages: [{ name, type: "text", text: { format, content } }]
    });
  }
  const page = entry.pages.find((p) => p.type === "text");
  const pageOp = page
    ? { action: "update", documentName: "JournalEntryPage", parent: entry, updates: [{ _id: page.id, name, text: { format, content } }] }
    : { action: "create", documentName: "JournalEntryPage", parent: entry, data: [{ name, type: "text", text: { format, content } }] };
  return foundry.documents.modifyBatch([
    { action: "update", documentName: "JournalEntry", updates: [{ _id: entry.id, name, ownership, [flag]: note }] },
    pageOp
  ]);
}

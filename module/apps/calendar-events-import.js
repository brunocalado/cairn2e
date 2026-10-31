/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { CairnCalendar, calendarEventPacks } from "../calendar.js";
import { importMissingEvents } from "../calendar-notes.js";

const { DialogV2 } = foundry.applications.api;

/**
 * The settings' Import Calendar Events button: asks, then brings in the calendar events this world
 * has no copy of (`importMissingEvents`). A `DialogV2` subclass because a settings menu is opened
 * with `new menu.type()` and no arguments, so the buttons sit in `DEFAULT_OPTIONS`; the window
 * title is a key core localizes, and the text is localized per instance, since `DEFAULT_OPTIONS`
 * is read before the translations load.
 */
export class CairnCalendarEventsImport extends DialogV2 {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID],
    window: { title: "CAIRN.Settings.CalendarEvents.Name", icon: "fa-solid fa-calendar-plus" },
    buttons: [
      {
        action: "import", label: "CAIRN.Settings.CalendarEvents.Label", icon: "fa-solid fa-calendar-plus",
        default: true, callback: () => CairnCalendarEventsImport.#import()
      },
      { action: "cancel", label: "COMMON.Cancel", icon: "fa-solid fa-xmark" }
    ]
  };

  /**
   * Under a module's own world calendar there is nothing to import into: Vald's dates mean nothing
   * there, and no window shows the notes. The menu is registered before the world calendar
   * exists, so it cannot be hidden; it refuses instead, as the calendar window does.
   * @override
   */
  async render(options, _options) {
    if (!(game.time.calendar instanceof CairnCalendar)) {
      ui.notifications.warn("CAIRN.Calendar.OtherCalendar", { localize: true });
      return this;
    }
    return super.render(options, _options);
  }

  /** @override */
  _initializeApplicationOptions(options) {
    options.content = `<p>${game.i18n.localize("CAIRN.Settings.CalendarEvents.Confirm")}</p>`;
    return super._initializeApplicationOptions(options);
  }

  static async #import() {
    const count = await importMissingEvents(calendarEventPacks());
    if (count) ui.notifications.info(game.i18n.localize("CAIRN.Calendar.EventsImported", { count }));
    else ui.notifications.info(game.i18n.localize("CAIRN.Calendar.NoEventsMissing"));
  }
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";

/** Every single-choice `<select>` the system draws: its windows and dialogs all carry the scope class. */
const SELECTS = `.${SYSTEM_ID} select:not([multiple], :disabled)`;

/**
 * A `<select>` in the system's windows opens core's ContextMenu instead of its own list. Chrome
 * paints an open `<select>`'s list itself and keeps the operating system's blue highlight whatever
 * the stylesheet says; the menu is HTML, drawn in ink on paper in every browser
 * (`css/src/controls.css`). The `<select>` stays the field: a choice writes its value and fires
 * `change`, so the form, `submitOnChange` and every listener read it as before.
 *
 * Only the pointer is taken. A keyboard still opens the browser's own list, because core's menu
 * cannot be walked with the arrow keys and the native list can.
 */
export function registerSelectMenus() {
  // Mousedown is where the browser opens its list, so that is the event refused; the menu opens
  // on the click that follows, which core's menu stops before its own document listener closes it.
  document.body.addEventListener("mousedown", (event) => {
    if (event.button === 0 && event.target.closest(SELECTS)) event.preventDefault();
  });
  /** The menu is at least as wide as the field it opens from, as a list dropping from it is. */
  class SelectMenu extends foundry.applications.ux.ContextMenu.implementation {
    /** @override — before core measures the menu, so its clamp to the viewport counts the width. */
    _setPosition(menu, target, options) {
      menu.style.minWidth = `${target.offsetWidth}px`;
      return super._setPosition(menu, target, options);
    }
  }
  const entries = [];
  new SelectMenu(document.body, SELECTS, entries, {
    eventName: "click",
    jQuery: false,
    fixed: true,
    relative: "target",
    classes: [SYSTEM_ID, "cairn-menu"],
    // Rebuilt on every opening, from the options the `<select>` holds now.
    onOpen: (select) => {
      select.focus();
      entries.splice(0, Infinity, ...[...select.options].filter((option) => !option.disabled && !option.hidden)
        .map((option) => ({
          label: option.text,
          classes: option.selected ? "cairn-menu-chosen" : "",
          onClick: () => {
            if (select.value === option.value) return;
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        })));
    }
  });
}

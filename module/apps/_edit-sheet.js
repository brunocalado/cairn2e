/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { SYSTEM_ID } from "../constants.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

/**
 * The form behind a sheet's quill: a snapshot, written on Save, forgotten on Cancel.
 *
 * What the two edit windows share and nothing else — nothing here reads the document's type. Each
 * subclass keeps its own parts, tabs, context, listeners and form processing.
 */
export class CairnEditSheet extends CairnInkMixin(HandlebarsApplicationMixin(DocumentSheetV2)) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-edit"],
    tag: "form",
    // Sized to the tallest tab of either form (the character's Traits: eight rows, measured at
    // 278px with the chrome around it) with a little air, so switching tabs never resizes the
    // window and no tab has to scroll. Not resizable: there is nothing a taller window would show.
    position: { width: 480, height: 436 },
    window: { icon: "fa-solid fa-pen", resizable: false },
    // None of the three belong on a form whose only job is to write fields: the sheet picker and
    // the ownership dialog are the SHEET's business, and Import replaces the document wholesale
    // from a file, which is not an edit.
    sheetConfig: false,
    ownershipConfig: false,
    canImport: false,
    form: { closeOnSubmit: true, submitOnChange: false },
    actions: {
      cancel: CairnEditSheet.#onCancel
    }
  };

  /** @override — the rules and text boxes are drawn, and nothing drawn follows a scroller. */
  static INK_SCROLLERS = [];

  /** The tab every opening starts on. */
  static HOME_TAB = "general";

  /**
   * @override — `DocumentSheetV2` titles itself "<type>: <name>" from the document's type label,
   * which is what the sheet behind this window already says. This one says what it does instead,
   * and still names whose actor it is editing.
   */
  get title() {
    return game.i18n.localize("CAIRN.Edit.Title", { name: this.document.name });
  }

  /**
   * @override — a write to the document never redraws an open form; only the quill does.
   *
   * `DocumentSheetV2` sits in `document.apps`, so every `updateActor` and every embedded Item
   * change re-rendered the form from the document — a player's stepper, a damage card's Apply,
   * another client's edit — and threw away every field typed but not yet saved. The quill renders
   * with `force: true` and still redraws: that one the reader asked for.
   */
  _canRender(options) {
    if (this.rendered && !options.force) return false;
    return super._canRender(options);
  }

  /**
   * @override — every opening starts on the home tab.
   *
   * The sheet keeps one instance of this window and re-renders it, so `tabGroups` would
   * otherwise carry the tab it was closed on into the next opening. Within one opening the
   * choice sticks, which is what `tabGroups` is for. It has to be reset HERE and not in
   * `_preFirstRender`: core prepares the context — and with it which tab is `active` — before
   * that hook runs, so a reset there leaves the nav lit on one tab and the group pointing at
   * another.
   */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (options.isFirstRender) this.tabGroups.primary = this.constructor.HOME_TAB;
  }

  /** @override — each tab panel is told which tab it is, so it can carry `active`. */
  async _preparePartContext(partId, context, options) {
    const ctx = await super._preparePartContext(partId, context, options);
    if (partId in ctx.tabs) ctx.tab = ctx.tabs[partId];
    return ctx;
  }

  static #onCancel() {
    this.close();
  }
}

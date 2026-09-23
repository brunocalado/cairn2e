/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import * as journey from "../journey.js";
import { watchesNeeded } from "../journey-rules.js";
import { beginFromPage, ROUTE_TYPE } from "../pointcrawl.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/journal`;

/**
 * The sheet of a `route` page: one path of a pointcrawl, in its journal.
 *
 * Two faces, as every journal page has. In **edit** it is the journey window's own route form —
 * the same four runs of buttons, through the same partial and the same `routeChoices`
 * (`module/journey.js`) — over two `<select>`s naming the points it runs between, which are
 * sibling pages of this journal. In **view** it is one ruled line: the two points, the route,
 * its total in watches, the description, and the Warden's way in — *Begin the journey*, which
 * opens the window already set to this route.
 */
export class CairnRoutePageSheet extends CairnInkMixin(JournalEntryPageHandlebarsSheet) {
  /** @override — nothing drawn here follows a scroller. */
  static INK_SCROLLERS = [];

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-route"],
    window: { icon: "fas fa-route" },
    // `submitOnChange` stays core's — a segmented control writes as it is pressed — but the Save
    // button is the end of editing and the window goes with it (`#onSubmitForm`).
    form: { submitOnChange: true },
    actions: {
      beginJourney: CairnRoutePageSheet.#onBegin
    }
  };

  /** @override — core's header is replaced, not inherited: see `route-header.hbs`. */
  static EDIT_PARTS = {
    header: { template: `${TEMPLATES}/route-header.hbs` },
    content: { template: `${TEMPLATES}/route-edit.hbs`, classes: ["standard-form"] },
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: { template: `${TEMPLATES}/route-view.hbs`, root: true }
  };

  /** @override */
  async _prepareContentContext(context, options) {
    await super._prepareContentContext(context, options);
    const { system } = this.page;
    Object.assign(context, journey.routeChoices(system));
    context.system = system;
    context.watches = watchesNeeded(system);
    // The journey is the Warden's to begin; a player reads the page.
    context.canBegin = game.user.isGM;
    context.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      system.description, { relativeTo: this.page }
    );
  }

  /**
   * The Save button closes the form; a submit raised by a field change does not.
   *
   * `submitOnChange` routes both through here, and `event.type` is what tells them apart — only a
   * real press is a `submit`. Without this the window sat open over the map after the Warden had
   * finished with it, which is the one thing a Save button is supposed to settle.
   * @inheritDoc
   */
  async _onSubmitForm(formConfig, event) {
    await super._onSubmitForm(formConfig, event);
    if (event?.type === "submit") await this.close();
  }

  /** @this {CairnRoutePageSheet} */
  static #onBegin() {
    beginFromPage(this.page);
  }
}

/** The subtype this sheet is registered for. */
export { ROUTE_TYPE };

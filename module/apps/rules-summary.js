/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/rules-summary`;

/**
 * The rules summary — the mechanics a player needs at the table, on one landscape page.
 *
 * Consolidated from the published Rules Summary and the Warden Screen's rules column, and worded
 * from `srd-2e/` wherever the two disagree with it. What is the Warden's — the procedures, the
 * event tables, the NPC tables, the Marketplace — is left out on purpose: this is the page a
 * player keeps open, not the screen.
 *
 * One window per client. It is opened from the Warden's sidebar tab, from a character's Actions
 * menu, from the supplied macro, or by the Warden's "Show to everyone", a socket broadcast every
 * other client answers by opening its own (`module/cairn2e.js`).
 */
export class CairnRulesSummary extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — the columns scroll as one when the window is shorter than the page, and the
   *  rules under the headings move with them. */
  static INK_SCROLLERS = [".cairn-rules-body"];

  static DEFAULT_OPTIONS = {
    id: "cairn2e-rules-summary",
    classes: [SYSTEM_ID, "cairn-rules"],
    position: { width: 1240, height: 830 },
    window: { title: "CAIRN.RulesRef.Title", icon: "fa-solid fa-book-open", resizable: true },
    actions: {
      shareRules: CairnRulesSummary.#onShare
    }
  };

  static PARTS = {
    summary: { template: `${TEMPLATES}/summary.hbs`, scrollable: [".cairn-rules-body"] },
    foot: { template: `${TEMPLATES}/foot.hbs` }
  };

  /** The one window this client has. */
  static #instance = null;

  /** Open the window, or bring the open one forward. */
  static open() {
    CairnRulesSummary.#instance ??= new CairnRulesSummary();
    return CairnRulesSummary.#instance.render({ force: true });
  }

  /** @override — the foot is the Warden's share button, and a player has nothing to share. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (!game.user.isGM) delete parts.foot;
    return parts;
  }

  /** The Warden asks every connected client to open its own window. */
  static #onShare() {
    if (!game.user.isGM) return;
    game.socket.emit(`system.${SYSTEM_ID}`, { type: "openRules" });
    ui.notifications.info(game.i18n.localize("CAIRN.RulesRef.Shared"));
  }
}

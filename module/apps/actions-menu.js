/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "../constants.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { CairnWhisper } from "./whisper.js";
import { CairnBarter } from "./barter.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/actions`;

/**
 * The macros the Warden put in the menu, resolved against the live documents: the name and the
 * image are the macro's own now, not what they were when it was added. A uuid that no longer
 * resolves comes back with `macro: null` — the Warden's window flags it, the menu drops it.
 * @returns {Promise<{ uuid: string, macro: Macro|null }[]>}
 */
export async function actionMacros() {
  const uuids = game.settings.get(SYSTEM_ID, SETTINGS.ACTION_MACROS) ?? [];
  const rows = [];
  for (const uuid of uuids) {
    let macro = null;
    // A compendium that was disabled or deleted makes `fromUuid` throw rather than answer null.
    try {
      macro = await fromUuid(uuid);
    } catch {
      macro = null;
    }
    rows.push({ uuid, macro: macro?.documentName === "Macro" ? macro : null });
  }
  return rows;
}

/**
 * Actions — the character's table tools, opened from the button left of the sheet's ellipsis:
 * Barter and Whisper.
 *
 * Table tooling, not a 2e rule: nothing in the SRD asks for it. It lists the system's own tools
 * first and then whatever macros the Warden curated (`SETTINGS.ACTION_MACROS`), each run with this
 * character as its `actor`. A macro the user may not run is left out rather than shown and
 * refused: a row that only ever produces a warning is not a tool.
 *
 * It stays open after a click, so several things can be done in a row; each tool opens a window
 * of its own.
 */
export class CairnActionsMenu extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-actions"],
    position: { width: 260, height: "auto" },
    window: { icon: "fa-solid fa-bolt", resizable: false },
    actions: {
      openBarter: CairnActionsMenu.#onOpenBarter,
      openWhisper: CairnActionsMenu.#onOpenWhisper,
      runMacro: CairnActionsMenu.#onRunMacro
    }
  };

  // Two parts: the tools are fixed and the macros are the Warden's, and a change to the list
  // redraws only the list.
  static PARTS = {
    tools: { template: `${TEMPLATES}/tools.hbs` },
    macros: { template: `${TEMPLATES}/macros.hbs` }
  };

  /** Every open menu, so the Warden's edit to the list reaches them (`module/settings.js`). */
  static #open = new Set();

  /** Redraw the macro list of every open menu. */
  static refresh() {
    for (const app of CairnActionsMenu.#open) app.render({ parts: ["macros"] });
  }

  /** @param {{ actor: Actor }} options */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  /** The tools a character opens, held one per menu so a second click raises the first. */
  #whisper = null;
  #barter = null;

  get title() {
    return `${game.i18n.localize("CAIRN.Actions.Title")}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.macros = (await actionMacros())
      .filter(({ macro }) => macro?.canExecute)
      .map(({ uuid, macro }) => ({ uuid, name: macro.name, img: macro.img }));
    return context;
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    CairnActionsMenu.#open.add(this);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    CairnActionsMenu.#open.delete(this);
  }

  static async #onOpenBarter() {
    this.#barter ??= new CairnBarter({ actor: this.actor });
    await this.#barter.render({ force: true });
  }

  static async #onOpenWhisper() {
    this.#whisper ??= new CairnWhisper({ actor: this.actor });
    await this.#whisper.render({ force: true });
  }

  static async #onRunMacro(event, target) {
    const macro = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    if (!macro) return ui.notifications.warn(game.i18n.localize("CAIRN.Actions.MacroMissing"));
    return macro.execute({ actor: this.actor, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
  }
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "../constants.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { actionMacros } from "./actions-menu.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/action-macros`;

/**
 * The Warden's list of macros for every character's Actions menu, opened from Settings. A Macro
 * dropped from the directory or a compendium joins the end; a row's × takes it off. Every change
 * is written at once — there is no Save, the way the store's shelves have none.
 *
 * A macro that no longer resolves stays on the list, flagged, until the Warden removes it: the
 * players' menus drop it silently, so this window is the only place anyone learns it is gone.
 */
export class CairnActionMacros extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static INK_SCROLLERS = [".cairn-macros-list"];

  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-action-macros`,
    classes: [SYSTEM_ID, "cairn-action-macros"],
    position: { width: 400, height: "auto" },
    window: { title: "CAIRN.Settings.ActionMacros.Name", icon: "fa-solid fa-bolt", resizable: false },
    actions: {
      macroRemove: CairnActionMacros.#onRemove
    }
  };

  static PARTS = {
    list: { template: `${TEMPLATES}/list.hbs`, scrollable: [".cairn-macros-list"] },
    foot: { template: `${TEMPLATES}/foot.hbs` }
  };

  /** The drag and drop, built once and re-bound on every render. */
  #dd = null;

  get #dragDrop() {
    return this.#dd ??= new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".cairn-macros-list",
      permissions: { drop: () => game.user.isGM },
      callbacks: { drop: this.#onDrop.bind(this) }
    });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.rows = (await actionMacros()).map(({ uuid, macro }) => ({
      uuid,
      name: macro?.name ?? uuid,
      img: macro?.img ?? "icons/svg/dice-target.svg",
      missing: !macro
    }));
    return context;
  }

  /** @override — a plain ApplicationV2 has no drag-drop of its own. */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#dragDrop.bind(this.element);
  }

  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Macro") {
      ui.notifications.warn(game.i18n.localize("CAIRN.Settings.ActionMacros.OnlyMacros"));
      return;
    }
    const macro = await foundry.documents.Macro.implementation.fromDropData(data);
    if (!macro) return;
    const list = game.settings.get(SYSTEM_ID, SETTINGS.ACTION_MACROS) ?? [];
    if (list.includes(macro.uuid)) {
      ui.notifications.info(game.i18n.localize("CAIRN.Settings.ActionMacros.Already", { name: macro.name }));
      return;
    }
    await game.settings.set(SYSTEM_ID, SETTINGS.ACTION_MACROS, [...list, macro.uuid]);
    this.render({ parts: ["list"] });
  }

  static async #onRemove(event, target) {
    const uuid = target.closest("[data-uuid]").dataset.uuid;
    const list = game.settings.get(SYSTEM_ID, SETTINGS.ACTION_MACROS) ?? [];
    await game.settings.set(SYSTEM_ID, SETTINGS.ACTION_MACROS, list.filter((u) => u !== uuid));
    this.render({ parts: ["list"] });
  }
}

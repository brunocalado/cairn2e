/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { HAZARDS, HAZARD_STEPS, HAZARD_SAVES } from "../hazard-rules.js";
import { rollAttributeDamage, rollSave } from "../rolls.js";
import { enricherActor } from "../enrichers.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/hazards`;
const SAVE_CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/hazard-save-card.hbs`;

/**
 * The Warden's hazards — one hazard at a time, its ladder of dice, and the saves that may avoid
 * it. Every word in it is for the Warden; the players meet only the cards. A die is
 * `rollAttributeDamage` against STR, exactly what a `[[/damage d8 STR]]` chip does, so it lands on
 * the trap card with its Apply and Apply-without-armour. A save is a card with a button, posted
 * for the table: whoever is caught clicks it and rolls their own, as a `[[/save]]` chip would. It
 * adds no damage logic of its own.
 *
 * The rulings are house rules, not Cairn 2e (`hazard-rules.js`). Which hazard is shown is this
 * window's alone and is forgotten on close.
 */
export class CairnHazards extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-hazards`,
    classes: [SYSTEM_ID, "cairn-hazards"],
    position: { width: 420, height: "auto" },
    window: { title: "CAIRN.Hazards.Title", icon: "fa-solid fa-person-falling", resizable: false },
    actions: {
      rollStep: CairnHazards.#onRollStep,
      askSave: CairnHazards.#onAskSave
    }
  };

  static PARTS = {
    pick: { template: `${TEMPLATES}/pick.hbs` },
    hazard: { template: `${TEMPLATES}/hazard.hbs` }
  };

  /** The one window this client has. */
  static #instance = null;

  /** Open the window, or bring the open one forward. The Warden's alone, as Treasure is. */
  static open() {
    if (!game.user.isGM) return null;
    CairnHazards.#instance ??= new CairnHazards();
    return CairnHazards.#instance.render({ force: true });
  }

  /** The hazard on show. */
  #hazard = HAZARDS[0];

  /** @inheritDoc — the one instance outlives a close, so a reopen starts on the first hazard. */
  _onClose(options) {
    super._onClose(options);
    this.#hazard = HAZARDS[0];
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const key = `CAIRN.Hazards.${this.#hazard.capitalize()}`;
    context.hazards = HAZARDS.map((id) => ({
      id,
      name: game.i18n.localize(`CAIRN.Hazards.${id.capitalize()}.Name`),
      checked: id === this.#hazard
    }));
    context.summary = game.i18n.localize(`${key}.Summary`);
    context.repeats = game.i18n.localize(`${key}.Repeats`);
    context.steps = HAZARD_STEPS.map(({ id, die }) => {
      const step = id.capitalize();
      return {
        id,
        die,
        label: game.i18n.localize(`CAIRN.Hazards.Step.${step}`),
        // Fatal is the same sentence on every hazard: it is when, not how far.
        example: game.i18n.localize(die ? `${key}.${step}` : "CAIRN.Hazards.FatalNote")
      };
    });
    context.saves = HAZARD_SAVES.map((attr) => {
      const name = game.i18n.localize(attr);
      return {
        key: attr,
        label: game.i18n.localize("CAIRN.Save", { key: name }),
        // The help mark's tooltip: core localizes `data-tooltip` itself, so this is the key.
        tip: `${key}.Saves.${attr}`,
        help: game.i18n.localize("CAIRN.Hazards.SaveHelp", { key: name })
      };
    });
    return context;
  }

  /**
   * @override — a radio's `change` is not a click, so it is no `actions` entry. Bound per part,
   * on the element just rendered, so a re-render never stacks a second listener. Only the hazard
   * below is redrawn: the group the Warden is choosing in keeps its focus.
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "pick") return;
    htmlElement.addEventListener("change", (event) => {
      this.#hazard = event.target.value;
      this.render({ parts: ["hazard"] });
    });
  }

  /**
   * One die of STR damage, rolled against the targets. With none it still posts, as a
   * `[[/damage]]` chip does: the card simply has no Apply.
   * @this {CairnHazards}
   */
  static async #onRollStep(event, target) {
    const step = HAZARD_STEPS.find((s) => s.id === target.dataset.step);
    if (!step?.die) return;
    const flavor = foundry.utils.escapeHTML(game.i18n.localize("CAIRN.Hazards.Flavor", {
      hazard: game.i18n.localize(`CAIRN.Hazards.${this.#hazard.capitalize()}.Name`),
      step: game.i18n.localize(`CAIRN.Hazards.Step.${step.id.capitalize()}`)
    }));
    await rollAttributeDamage(`1${step.die}`, "STR", flavor);
  }

  /**
   * Ask the table for the save: a card whose button anyone may press. Nothing is rolled here —
   * the Warden does not know who is caught until the players say, and each rolls their own.
   * @this {CairnHazards}
   */
  static async #onAskSave(event, target) {
    const key = target.dataset.key;
    if (!HAZARD_SAVES.includes(key)) return;
    const content = await foundry.applications.handlebars.renderTemplate(SAVE_CARD_TPL, {
      key,
      label: game.i18n.localize("CAIRN.Save", { key: game.i18n.localize(key) })
    });
    await ChatMessage.implementation.create({
      speaker: ChatMessage.getSpeaker(),
      flavor: foundry.utils.escapeHTML(game.i18n.localize(`CAIRN.Hazards.${this.#hazard.capitalize()}.Name`)),
      content
    });
  }
}

/**
 * The save card's button (`#onAskSave` posts it), on every client: it rolls for whoever clicks,
 * by the `[[/save]]` chip's rule — the selected token, else the clicker's own character. It stays
 * after a roll, because more than one character may be caught.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function renderHazardSaveButton(message, html) {
  const button = html.querySelector(".roll-hazard-save");
  if (!button || !HAZARD_SAVES.includes(button.dataset.key)) return;
  button.addEventListener("click", () => {
    const actor = enricherActor();
    if (!actor?.system.abilities) return ui.notifications.warn(game.i18n.localize("CAIRN.Enrich.NoActor"));
    return rollSave(actor, button.dataset.key);
  });
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { HAZARDS, HAZARD_STEPS, HAZARD_SAVES } from "../hazard-rules.js";
import { rollAttributeDamage, rollSave } from "../rolls.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/hazards`;

/**
 * The Warden's hazards — one hazard at a time, its ladder of dice, and the saves that may avoid
 * it. A picker in front of two functions that already exist: a die is `rollAttributeDamage`
 * against STR, exactly what a `[[/damage d8 STR]]` chip does, so it lands on the trap card with
 * its Apply and Apply-without-armour; a save is `rollSave` for each targeted token. It adds no
 * damage logic of its own.
 *
 * The rulings are house rules, not Cairn 2e (`hazard-rules.js`), and the window says so in its
 * foot. Which hazard is shown is this window's alone and is forgotten on close.
 */
export class CairnHazards extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-hazards`,
    classes: [SYSTEM_ID, "cairn-hazards"],
    position: { width: 420, height: "auto" },
    window: { title: "CAIRN.Hazards.Title", icon: "fa-solid fa-person-falling", resizable: false },
    actions: {
      rollStep: CairnHazards.#onRollStep,
      rollSave: CairnHazards.#onRollSave
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
    context.saveHint = game.i18n.localize(`${key}.Save`);
    context.saves = HAZARD_SAVES.map((attr) => ({
      key: attr,
      label: game.i18n.localize("CAIRN.Hazards.SaveButton", { key: game.i18n.localize(attr) })
    }));
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
   * The chosen save for every targeted token. Not the Warden's controlled token, as a `[[/save]]`
   * chip would roll: the dice beside it roll against targets, and one window aiming its two kinds
   * of roll at different tokens would be a trap of its own.
   * @this {CairnHazards}
   */
  static async #onRollSave(event, target) {
    const key = target.dataset.key;
    if (!HAZARD_SAVES.includes(key)) return;
    // A party token has no attributes to save with.
    const actors = Array.from(game.user.targets, (t) => t.actor).filter((a) => a?.system.abilities?.[key]);
    if (!actors.length) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Hazards.NoTarget"));
      return;
    }
    for (const actor of actors) await rollSave(actor, key);
  }
}

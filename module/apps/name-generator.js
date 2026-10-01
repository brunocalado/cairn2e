/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { NAME_KINDS, rollName, rerollPart, swapTerrain, shownParts, composeName, terrainKeys } from "../name-generator.js";
import { postNameCard } from "../rolls.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/name-generator`;

/** How many names the Recent list keeps. It is scratch paper, not a record. */
const HISTORY = 8;

/**
 * The Warden's Name Generator: the five Naming Procedures of the SRD, one tab each, the name
 * rolled shown with every part and its die, and a click on a part rolls that part alone. Opened
 * from the Warden section of the Cairn 2e tab. One window per client; what it holds — the names
 * on each tab, the Recent list — is window state and closes with it.
 */
export class CairnNameGenerator extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — the Recent list scrolls, and its rules move with it. */
  static INK_SCROLLERS = [".cairn-name-history"];

  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-name-generator`,
    classes: [SYSTEM_ID, "cairn-name-gen"],
    window: { title: "CAIRN.NameGen.Title", icon: "fa-solid fa-signature" },
    position: { width: 520, height: "auto" },
    actions: {
      pickKind: CairnNameGenerator.#onPickKind,
      roll: CairnNameGenerator.#onRoll,
      rerollPart: CairnNameGenerator.#onRerollPart,
      swapTerrain: CairnNameGenerator.#onSwapTerrain,
      toggleArticle: CairnNameGenerator.#onToggleArticle,
      copy: CairnNameGenerator.#onCopy,
      whisper: CairnNameGenerator.#onWhisper,
      pickHistory: CairnNameGenerator.#onPickHistory
    }
  };

  // Separate parts so a tab change or a reroll never rebuilds the Recent list.
  static PARTS = {
    tabs: { template: `${TEMPLATES}/tabs.hbs` },
    name: { template: `${TEMPLATES}/name.hbs` },
    history: { template: `${TEMPLATES}/history.hbs`, scrollable: [".cairn-name-history"] },
    footer: { template: `${TEMPLATES}/footer.hbs` }
  };

  /** The one window this client has. */
  static #instance = null;

  /** Open the window, or bring the open one forward. The Warden's. */
  static open() {
    if (!game.user.isGM) return;
    CairnNameGenerator.#instance ??= new CairnNameGenerator();
    return CairnNameGenerator.#instance.render({ force: true });
  }

  #kind = "place";
  /** The name on each tab, rolled the first time the tab is shown. */
  #names = {};
  #article = true;
  #poi = "";
  #terrain = "forest";
  #dominant = "";
  #history = [];

  get #name() {
    return this.#names[this.#kind];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const t = (key, data) => game.i18n.localize(key, data);
    const kind = this.#kind;
    this.#names[kind] ??= await rollName(kind, { terrain: this.#terrain, poi: this.#poi });
    const name = this.#name;
    const text = composeName(name, { article: this.#article });

    context.tabs = NAME_KINDS.map((k) => ({ kind: k, label: t(`CAIRN.NameGen.Kind.${k}`), active: k === kind }));
    context.kind = kind;
    context.hint = t(`CAIRN.NameGen.Hint.${kind}`);
    context.text = text;
    context.poi = this.#poi;
    const terrains = (await terrainKeys()).map((key) => ({ key, label: t(`CAIRN.NameGen.Terrain.${key}`) }));
    context.terrains = terrains.map((o) => ({ ...o, selected: o.key === this.#terrain }));
    context.dominants = terrains.map((o) => ({ ...o, selected: o.key === this.#dominant }));
    context.setup = { place: kind === "place", terrain: kind === "terrain", realm: kind === "realm" };
    context.parts = shownParts(name).map((part) => {
      const typed = part.key === "slot" && kind === "place";
      return {
        key: part.key,
        label: t(`CAIRN.NameGen.Part.${part.key === "slot" ? kind : part.key}`),
        text: part.text,
        die: part.swapped ? t("CAIRN.NameGen.Swapped") : part.total ?? t(typed ? "CAIRN.NameGen.Typed" : "CAIRN.NameGen.Picked"),
        canReroll: !typed,
        canSwap: kind === "realm" && !!this.#dominant && ["adjective", "noun"].includes(part.key)
      };
    });
    context.hasArticle = kind !== "forest";
    context.article = this.#article;
    context.history = this.#history.map((h, index) => ({ index, text: h.text, kind: t(`CAIRN.NameGen.Kind.${h.kind}`) }));
    return context;
  }

  /** @override — the setup fields answer a change, not a click. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "name") return;
    htmlElement.querySelector("input[name='poi']")?.addEventListener("change", async (event) => {
      this.#poi = event.target.value.trim();
      await rerollPart(this.#name, "slot");
      this.#remember();
      this.render({ parts: ["name", "history"] });
    });
    htmlElement.querySelector("select[name='terrain']")?.addEventListener("change", async (event) => {
      this.#terrain = event.target.value;
      this.#name.terrain = this.#terrain;
      await rerollPart(this.#name, "slot");
      this.#remember();
      this.render({ parts: ["name", "history"] });
    });
    htmlElement.querySelector("select[name='dominant']")?.addEventListener("change", (event) => {
      this.#dominant = event.target.value;
      this.render({ parts: ["name"] });
    });
  }

  /** Keep the name on show in Recent, unless it is the one already on top. */
  #remember() {
    const name = this.#name;
    const text = composeName(name, { article: this.#article });
    if (!text || this.#history[0]?.text === text) return;
    this.#history.unshift({ kind: this.#kind, text, name: foundry.utils.deepClone(name), article: this.#article });
    this.#history.length = Math.min(this.#history.length, HISTORY);
  }

  /** The name a Copy or a Whisper takes. */
  get #text() {
    return composeName(this.#name, { article: this.#article });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {CairnNameGenerator} */
  static #onPickKind(event, target) {
    if (!NAME_KINDS.includes(target.dataset.kind)) return;
    this.#kind = target.dataset.kind;
    this.render({ parts: ["tabs", "name", "footer"] });
  }

  /** @this {CairnNameGenerator} */
  static async #onRoll() {
    this.#names[this.#kind] = await rollName(this.#kind, { terrain: this.#terrain, poi: this.#poi });
    if (!this.#text) ui.notifications.warn(game.i18n.localize("CAIRN.NameGen.NoTable"));
    this.#remember();
    this.render({ parts: ["name", "history"] });
  }

  /** @this {CairnNameGenerator} */
  static async #onRerollPart(event, target) {
    await rerollPart(this.#name, target.closest("[data-part]").dataset.part);
    this.#remember();
    this.render({ parts: ["name", "history"] });
  }

  /** @this {CairnNameGenerator} */
  static async #onSwapTerrain(event, target) {
    if (!this.#dominant) return;
    await swapTerrain(this.#name, target.closest("[data-part]").dataset.part, this.#dominant);
    this.#remember();
    this.render({ parts: ["name", "history"] });
  }

  /** The article switch recomposes the name; nothing is rolled again. @this {CairnNameGenerator} */
  static #onToggleArticle(event, target) {
    this.#article = target.checked;
    this.render({ parts: ["name", "footer"] });
  }

  /** @this {CairnNameGenerator} */
  static async #onCopy() {
    const text = this.#text;
    if (!text) return;
    await game.clipboard.copyPlainText(text);
    ui.notifications.info(game.i18n.localize("CAIRN.NameGen.Copied", { name: text }));
  }

  /** A name is the Warden's prep: it goes to the Wardens alone. @this {CairnNameGenerator} */
  static async #onWhisper() {
    const text = this.#text;
    if (!text) return;
    const formula = this.#name.parts.formula?.text ?? "";
    return postNameCard({ name: text, formula });
  }

  /** Bring a name from Recent back onto its tab. @this {CairnNameGenerator} */
  static #onPickHistory(event, target) {
    const entry = this.#history[Number(target.closest("[data-index]").dataset.index)];
    if (!entry) return;
    this.#kind = entry.kind;
    this.#names[entry.kind] = foundry.utils.deepClone(entry.name);
    this.#article = entry.article;
    this.render({ parts: ["tabs", "name", "footer"] });
  }
}

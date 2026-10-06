/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "../constants.js";
import { withSource, withoutSource, withSourceSettings, drawPlan, MAX_COUNT } from "../treasure-rules.js";
import { sourceDocument, sourceLabel, drawSource, sendToStash, postTreasureCard } from "../treasure.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/treasure`;

/**
 * The Warden's Treasure window: the sources they offer, ticked and counted; what a Roll drew; and
 * Send, which writes what is left onto the active party's Stash and posts a card saying so.
 *
 * Two kinds of state, kept apart on purpose. The SOURCES are the world setting
 * `SETTINGS.TREASURE_SOURCES`, written on every edit like the stores — no Save button, nothing to
 * lose — and redrawn by its `onChange`. The DRAFT is this window's alone: Roll appends to it,
 * because the Warden's flow is "strike what you do not like and roll again" and replacing would
 * throw away the rows that were kept; × strikes a row, Clear empties it, and closing the window
 * drops it, which is accepted — they roll again.
 *
 * With no active party there is nowhere to send, so neither Roll nor Send is offered: the foot
 * says why and makes one. The first party becomes the active one by itself
 * (`CairnActor#_onCreate`), and the setting's `onChange` redraws this window.
 */
export class CairnTreasure extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — both lists scroll, and their rules move with them. */
  static INK_SCROLLERS = [".cairn-treasure-sources", ".cairn-treasure-drawn"];

  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-treasure`,
    classes: [SYSTEM_ID, "cairn-treasure"],
    position: { width: 800, height: "auto" },
    window: { icon: "fa-solid fa-gem", title: "CAIRN.Treasure.Title", resizable: true },
    actions: {
      sourceToggle: CairnTreasure.#onSourceToggle,
      sourceRemove: CairnTreasure.#onSourceRemove,
      treasureRoll: CairnTreasure.#onRoll,
      drawnOpen: CairnTreasure.#onDrawnOpen,
      drawnRemove: CairnTreasure.#onDrawnRemove,
      drawnClear: CairnTreasure.#onDrawnClear,
      treasureSend: CairnTreasure.#onSend,
      partyCreate: CairnTreasure.#onPartyCreate
    }
  };

  static PARTS = {
    sources: { template: `${TEMPLATES}/sources.hbs`, scrollable: [".cairn-treasure-sources"] },
    drawn: { template: `${TEMPLATES}/drawn.hbs`, scrollable: [".cairn-treasure-drawn"] },
    foot: { template: `${TEMPLATES}/foot.hbs` }
  };

  /** The one window this client has. */
  static #instance = null;

  /** @type {import("../treasure.js").DrawnRow[]} the draft */
  #drawn = [];

  /** A roll or a send is out: both buttons are dead until it answers, so nothing lands twice. */
  #busy = false;

  /** The drag and drop, built once and re-bound on every render. */
  #dd = null;

  /**
   * The list as this window last edited it, while a write of it is still out. Core's world-setting
   * write reads the stored document, which only moves when the server answers, and the first ever
   * write is a create. So two edits in flight at once (two quick ticks, a count typed and then a
   * switch clicked) were both built on the old list, and the second erased the first — or, on a
   * world that had never written the setting, made a second document for the same key, and which
   * of the two a reload read back was chance.
   */
  #pending = null;

  /** Writes go out one at a time: the next waits for the last. */
  #writes = Promise.resolve();

  /** Open the window, or bring the open one forward. The Warden's: a macro can call it too. */
  static open() {
    if (!game.user.isGM) return null;
    CairnTreasure.#instance ??= new CairnTreasure();
    return CairnTreasure.#instance.render({ force: true });
  }

  /** Redraw the open window — the sources or the active party changed. A closed one stays closed. */
  static refresh() {
    const app = CairnTreasure.#instance;
    if (app?.rendered) app.render();
  }

  get #sources() {
    return this.#pending ?? game.settings.get(SYSTEM_ID, SETTINGS.TREASURE_SOURCES);
  }

  /**
   * Write the list back. The setting's `onChange` is what redraws. Neither the pending list nor the
   * chain is cleared on close: a write still out when the window closes has to land.
   */
  #save(list) {
    this.#pending = list;
    const write = this.#writes.then(() => game.settings.set(SYSTEM_ID, SETTINGS.TREASURE_SOURCES, list));
    // Settled either way, so one failed write does not stall every later one. The pending list is
    // dropped only if no newer edit replaced it meanwhile.
    this.#writes = write.catch(() => {}).then(() => { if (this.#pending === list) this.#pending = null; });
    return write;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sources = this.#sources;
    const docs = await Promise.all(sources.map((s) => sourceDocument(s)));
    context.sources = sources.map((s, i) => {
      const label = sourceLabel(s, docs[i]);
      return {
        id: s.id,
        on: s.on,
        count: s.count,
        isCoin: s.kind === "coin",
        formula: s.formula,
        // A source whose document is gone keeps its row, named by its id, so the Warden sees it
        // and takes it off: it draws nothing.
        label: label ?? s.id,
        missing: label === null,
        icon: s.kind === "coin" ? "fa-coins" : s.kind === "table" ? "fa-table-list" : "fa-folder"
      };
    });
    context.maxCount = MAX_COUNT;
    const gp = game.i18n.localize("CAIRN.GoldAbbrev");
    context.drawn = this.#drawn.map((row) => row.kind === "coin"
      ? { key: row.key, coin: true, name: `${row.amount} ${gp}` }
      : { key: row.key, name: row.name, img: row.img, uuid: row.uuid });
    const party = game.cairn2e.party;
    context.party = party && { name: party.name };
    context.canRoll = !!party && !this.#busy && sources.some((s) => s.on);
    context.canSend = !!party && !this.#busy && this.#drawn.length > 0;
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // A plain ApplicationV2 has no drag-drop of its own, so the window binds its own instance.
    this.#dragDrop.bind(this.element);
  }

  /** @override — a count and a formula answer a change, not a click. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "sources") return;
    for (const input of htmlElement.querySelectorAll("input[name=count]")) {
      input.addEventListener("change", () => {
        const id = input.closest("[data-source-id]").dataset.sourceId;
        this.#save(withSourceSettings(this.#sources, id, { count: input.value }));
      });
    }
    const formula = htmlElement.querySelector("input[name=formula]");
    formula?.addEventListener("input", () => formula.setCustomValidity(""));
    formula?.addEventListener("change", () => {
      const value = formula.value.trim();
      // An invalid formula is not written: the field says so, and keeps what was typed to mend.
      if (!foundry.dice.Roll.validate(value)) {
        formula.setCustomValidity(game.i18n.localize("CAIRN.Treasure.FormulaInvalid", { formula: value }));
        formula.reportValidity();
        return;
      }
      this.#save(withSourceSettings(this.#sources, "coin", { formula: value }));
    });
  }

  /** @override — the draft does not outlive the window. */
  _onClose(options) {
    super._onClose(options);
    this.#drawn = [];
    this.#busy = false;
  }

  /**
   * The sources list takes a RollTable or an Item folder, from the world or a pack; a drawn item's
   * grip drags it out.
   */
  get #dragDrop() {
    return this.#dd ??= new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".cairn-treasure-grip",
      dropSelector: ".cairn-treasure-sources-zone",
      permissions: { dragstart: () => game.user.isGM, drop: () => game.user.isGM },
      callbacks: { dragstart: this.#onDragStart.bind(this), drop: this.#onDrop.bind(this) }
    });
  }

  /**
   * A drawn item leaves as the document it was drawn from: an actor sheet takes it as any drop
   * from a pack or the sidebar, and the chat log knows it by the mark. The row stays in the draft
   * whatever happens to the drop — this window cannot tell whether the target took it (a
   * character with no room refuses), so the Warden strikes it once it is given.
   */
  #onDragStart(event) {
    const uuid = event.currentTarget.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid, [SYSTEM_ID]: { treasure: true } }));
  }

  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    // A drawn item let go over this window again: nothing to offer, and nothing to warn about.
    if (data?.[SYSTEM_ID]?.treasure) return;
    let source = null;
    if (data?.type === "RollTable") {
      const table = await foundry.documents.RollTable.implementation.fromDropData(data);
      if (table) source = { id: table.uuid, kind: "table", uuid: table.uuid, on: true, count: 1 };
    } else if (data?.type === "Folder") {
      const folder = await foundry.documents.Folder.implementation.fromDropData(data);
      if (folder?.type === "Item") source = { id: folder.uuid, kind: "folder", uuid: folder.uuid, on: true, count: 1 };
    }
    if (!source) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Treasure.NotASource"));
      return;
    }
    const list = this.#sources;
    const next = withSource(list, source);
    if (next === list) {
      ui.notifications.info(game.i18n.localize("CAIRN.Treasure.AlreadyListed"));
      return;
    }
    await this.#save(next);
  }

  /** Run `work` with both buttons dead, and redraw what it changed. */
  async #whileBusy(work) {
    if (this.#busy) return;
    this.#busy = true;
    await this.render({ parts: ["foot"] });
    try {
      await work();
    } finally {
      this.#busy = false;
      if (this.rendered) this.render({ parts: ["drawn", "foot"] });
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** The switch on a source row. @this {CairnTreasure} */
  static #onSourceToggle(event, target) {
    const id = target.closest("[data-source-id]")?.dataset.sourceId;
    if (id) this.#save(withSourceSettings(this.#sources, id, { on: target.checked }));
  }

  /** The × on a source row: off the list, not out of the world. @this {CairnTreasure} */
  static #onSourceRemove(event, target) {
    const id = target.closest("[data-source-id]")?.dataset.sourceId;
    if (id) this.#save(withoutSource(this.#sources, id));
  }

  /**
   * Draw every ticked source and append what came up to the draft. What a table gave that the
   * Stash cannot hold is counted and told once for the whole roll, not once per result.
   * @this {CairnTreasure}
   */
  static async #onRoll() {
    if (!game.cairn2e.party) return this.render();
    await this.#whileBusy(async () => {
      let skipped = 0;
      for (const source of drawPlan(this.#sources)) {
        const drawn = await drawSource(source);
        if (drawn.missing) ui.notifications.warn(game.i18n.localize("CAIRN.Treasure.SourceMissing", { source: source.id }));
        skipped += drawn.skipped;
        this.#drawn.push(...drawn.rows);
      }
      if (skipped) ui.notifications.info(game.i18n.localize("CAIRN.Treasure.NotAnItem", { count: skipped }));
    });
  }

  /**
   * A drawn row's icon or name opens the thing it was drawn from: read-only while its pack is
   * locked. A world item opens its own sheet, which the Warden can edit — that edits the world
   * item, not the drawn copy, which was taken when the row was rolled.
   */
  static async #onDrawnOpen(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const doc = uuid ? await fromUuid(uuid) : null;
    doc?.sheet.render({ force: true });
  }

  /** @this {CairnTreasure} */
  static #onDrawnRemove(event, target) {
    const key = target.closest("[data-key]")?.dataset.key;
    this.#drawn = this.#drawn.filter((row) => row.key !== key);
    this.render({ parts: ["drawn", "foot"] });
  }

  /** @this {CairnTreasure} */
  static #onDrawnClear() {
    this.#drawn = [];
    this.render({ parts: ["drawn", "foot"] });
  }

  /**
   * Send the draft to the party that is active NOW — re-read on the click, so a party deleted
   * while the draft was open gives the notice and keeps the draft. What the Stash refused stays
   * in the draft, so the Warden sees what did not go; the card lists only what landed.
   * @this {CairnTreasure}
   */
  static async #onSend() {
    const party = game.cairn2e.party;
    if (!party) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Party.NoActiveParty"));
      return this.render();
    }
    if (!this.#drawn.length) return;
    await this.#whileBusy(async () => {
      const { landed, coin, refused } = await sendToStash(party, this.#drawn);
      this.#drawn = refused;
      if (refused.length) ui.notifications.warn(game.i18n.localize("CAIRN.Treasure.Refused", { count: refused.length }));
      if (landed.length || coin) await postTreasureCard(party, landed, coin);
    });
  }

  /**
   * A party, made here so the Warden need not leave the window. `Actor.implementation`, never the
   * bare global, so `CairnActor#_onCreate` runs and makes the first party the active one.
   * @this {CairnTreasure}
   */
  static async #onPartyCreate() {
    if (!game.user.isGM) return;
    await Actor.implementation.create({ name: game.i18n.localize("CAIRN.Party.NewName"), type: "party" });
  }
}

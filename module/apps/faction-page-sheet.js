/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { rollWardenTable, stripTags } from "../helpers.js";
import { rollFactionAction, rollFactionSave } from "../rolls.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { JournalEntryPageHandlebarsSheet } = foundry.applications.sheets.journal;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/journal`;

/** The subtype this sheet is registered for, as `system.json#documentTypes` declares it. */
export const FACTION_TYPE = "faction";

/**
 * The sheet of a `faction` page: one standing power in a region, in its journal.
 *
 * Two faces, as every journal page has. In **edit** it is five open lists and two rolled fields,
 * each list indexed into the form so a plain submit reaches the `ArrayField` (see
 * `faction-edit.hbs`). In **view** it is the faction as the SRD's own example prints one, with the
 * Warden's two rolls at the foot.
 *
 * ## What is rolled here, and why it is not the generator
 *
 * *Generate Faction* in the sidebar rolls all eight tables at once, for a faction that does not
 * exist yet. This sheet rolls ONE field, for a faction that does — the Warden who needs a new
 * obstacle in the middle of a session because the d6 came up 1 is not going to open the generator
 * for it. Both go through `helpers.js#rollWardenTable`, so a world table of the same name wins
 * over the compendium copy in both.
 *
 * ## Drag and drop
 *
 * Core builds no `DragDrop` for a journal page sheet — `ActorSheetV2` and `ItemSheetV2` each build
 * their own in a `_dragDrop` getter and bind it in `_onRender`, and this does the same in a private
 * one (the `_` name is core's, on those two classes, and a journal page overrides nothing). It is NOT
 * declared as a `dragDrop` option: v14 core reads none, and `checks/drag-drop.check.mjs` fails any
 * sheet in `module/apps/` that declares one.
 *
 * An Actor dropped on the form becomes an agent, an Item becomes an advantage, and an agent row
 * dragged onto another is a change of rank — the array's order is the chain of command, and the
 * highest-ranking agent is who saves when the faction is opposed.
 */
export class CairnFactionPageSheet extends CairnInkMixin(JournalEntryPageHandlebarsSheet) {
  /**
   * @override — the SCROLLER is the form inside `.window-content`, not the box the canvas lives
   * in, and the marks are placed from viewport positions: without its scroll listener the rules
   * stayed where the rows were and were drawn across the text (reported 2026-09-22).
   */
  static INK_SCROLLERS = [".cairn-faction-form"];

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-faction"],
    window: { icon: "fas fa-sitemap" },
    // `submitOnChange` stays core's, and the Save button is the end of editing — the window goes
    // with it (`_onSubmitForm`), exactly as the route page settled it.
    form: { submitOnChange: true },
    actions: {
      rollField: CairnFactionPageSheet.#onRollField,
      rollRow: CairnFactionPageSheet.#onRollRow,
      traitRoll: CairnFactionPageSheet.#onTraitRoll,
      traitAdd: CairnFactionPageSheet.#onTraitAdd,
      traitRemove: CairnFactionPageSheet.#onTraitRemove,
      advantageAdd: CairnFactionPageSheet.#onAdvantageAdd,
      advantageRemove: CairnFactionPageSheet.#onAdvantageRemove,
      agentAdd: CairnFactionPageSheet.#onAgentAdd,
      agentRemove: CairnFactionPageSheet.#onAgentRemove,
      goalAdd: CairnFactionPageSheet.#onGoalAdd,
      goalRemove: CairnFactionPageSheet.#onGoalRemove,
      obstacleAdd: CairnFactionPageSheet.#onObstacleAdd,
      obstacleRemove: CairnFactionPageSheet.#onObstacleRemove,
      openLink: CairnFactionPageSheet.#onOpenLink,
      factionAction: CairnFactionPageSheet.#onFactionAction,
      agentSave: CairnFactionPageSheet.#onAgentSave
    }
  };

  /** @override — core's header is replaced, not inherited: see `faction-header.hbs`. */
  static EDIT_PARTS = {
    header: { template: `${TEMPLATES}/faction-header.hbs` },
    // `scrollable` names the element that actually scrolls — the form section itself, which
    // `[""]` resolves to. It is not only for the scrollbar: every add, remove and roll on this
    // form is a document update and therefore a re-render, and without this the Warden is thrown
    // back to the top of a long faction each time.
    content: {
      template: `${TEMPLATES}/faction-edit.hbs`,
      classes: ["standard-form", "cairn-faction-form"],
      scrollable: [""]
    },
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: { template: `${TEMPLATES}/faction-view.hbs`, root: true }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContentContext(context, options) {
    await super._prepareContentContext(context, options);
    const { system } = this.page;
    context.system = system;

    // The one line under the name: what the faction is, then how it behaves. Tags, because each
    // one is a word off its own table and none of them qualifies another.
    context.identity = [system.type, ...system.traits].filter(Boolean);

    context.advantages = system.advantages.map((a) => ({ ...a, linked: a.item ? fromUuidSync(a.item) : null }));

    // `roster` derives WIL off a linked Actor; `rank` is the printed place in the chain of
    // command, which is the array's own order.
    context.agents = system.roster.map((agent, i) => ({
      ...agent, rank: i + 1, linked: agent.actor, isHighest: i === 0
    }));
    context.highest = context.agents[0] ?? null;

    context.goals = system.agenda.goals.map((g, i) => ({ ...g, number: i + 1 }));
    context.hasAgenda = !!system.agenda.objective || context.goals.length > 0;

    // A resolved obstacle stays on the edit form — it is a record of what the faction got past —
    // and leaves the reading, which is about what still stands in the way.
    context.openObstacles = system.obstacles.filter((o) => !o.resolved);

    context.isWarden = game.user.isGM;
    context.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      system.description, { relativeTo: this.page }
    );
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /**
   * The Save button closes the form; a submit raised by a field change does not. `submitOnChange`
   * routes both through here and `event.type` is what tells them apart — the route page's own
   * finding, and the same reason applies to a form this long.
   * @inheritDoc
   */
  async _onSubmitForm(formConfig, event) {
    await super._onSubmitForm(formConfig, event);
    if (event?.type === "submit") await this.close();
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#dragDropHandler.bind(this.element);
  }

  /* -------------------------------------------- */
  /*  Drag and drop                               */
  /* -------------------------------------------- */

  /**
   * Built here rather than declared as a `dragDrop` option, because v14 core reads none — the
   * option is dead configuration that reads like the working kind, and a check refuses it.
   * `dropSelector` is null, so the sheet's own element is the drop target.
   * @type {DragDrop}
   */
  get #dragDropHandler() {
    return this.#dragDrop ??= new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".draggable",
      permissions: { dragstart: () => this.isEditable, drop: () => this.isEditable },
      callbacks: { dragstart: this.#onDragStart.bind(this), drop: this.#onDrop.bind(this) }
    });
  }

  /** @type {DragDrop|null} */
  #dragDrop = null;

  /**
   * An agent row carries its own index, and nothing else: it is not a document, so there is no
   * uuid to put on the transfer and no sheet anywhere else that could receive it. The payload is
   * namespaced under `SYSTEM_ID` for the same reason the party's is — so a drop elsewhere reads it
   * as nothing rather than as a malformed document reference.
   */
  #onDragStart(event) {
    const index = CairnFactionPageSheet.#rowIndex(event.currentTarget);
    if (!Number.isInteger(index)) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ [SYSTEM_ID]: { fromIndex: index } }));
  }

  /** An Actor joins the agents, an Item joins the advantages, and a row of our own changes rank. */
  async #onDrop(event) {
    if (!this.isEditable) return null;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);

    const fromIndex = data?.[SYSTEM_ID]?.fromIndex;
    if (Number.isInteger(fromIndex)) return this.#reorderAgent(fromIndex, event);

    const documentClass = foundry.utils.getDocumentClass(data?.type);
    if (!documentClass) return null;
    const document = await documentClass.fromDropData(data);
    if (document?.documentName === "Actor") return this.#addAgent(document);
    if (document?.documentName === "Item") return this.#addAdvantage(document);
    return null;
  }

  /**
   * A dropped Actor becomes an agent: its name, its uuid, and its WIL — which from then on is read
   * off the Actor rather than stored, so the two cannot drift (`FactionData#roster`). Already an
   * agent → say so and change nothing, because a faction with the same person twice in its chain
   * of command has no reading.
   */
  async #addAgent(actor) {
    const agents = this.page.system.agents;
    if (agents.some((a) => a.actor === actor.uuid)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Faction.AlreadyAnAgent", { name: actor.name }));
      return null;
    }
    await this.#write("agents", [...agents, {
      name: actor.name,
      role: "",
      wil: actor.system?.abilities?.WIL?.value ?? 10,
      motivation: "",
      actor: actor.uuid
    }]);
    return actor;
  }

  /** A dropped Item becomes an advantage that names it — the SRD example's *Apparatus*. */
  async #addAdvantage(item) {
    const advantages = this.page.system.advantages;
    if (advantages.some((a) => a.item === item.uuid)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Faction.AlreadyAnAdvantage", { name: item.name }));
      return null;
    }
    await this.#write("advantages", [...advantages, { name: item.name, note: "", item: item.uuid }]);
    return item;
  }

  /** Promotion and demotion: the array's order is the chain of command. */
  async #reorderAgent(fromIndex, event) {
    const agents = this.page.system.agents;
    const row = event.target.closest?.("[data-index]");
    const to = row ? Number(row.dataset.index) : agents.length - 1;
    if (!Number.isInteger(to) || to === fromIndex) return null;

    const next = [...agents];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(to, 0, moved);
    await this.#write("agents", next);
    return null;
  }

  /* -------------------------------------------- */
  /*  List helpers                                */
  /* -------------------------------------------- */

  /** The index of the row a list control was clicked on. */
  static #rowIndex(target) {
    return Number(target.closest("[data-index]")?.dataset.index);
  }

  /** The array at a `system.*` path, always an array. */
  #list(path) {
    return foundry.utils.getProperty(this.page.system, path) ?? [];
  }

  /** Write one `system.*` array back whole. */
  async #write(path, list) {
    return this.page.update({ [`system.${path}`]: list });
  }

  /**
   * Drop one entry from an array.
   *
   * The whole array is rewritten rather than the one index cleared, because the form's inputs are
   * addressed by position (`system.agents.3.name`): leaving a hole would make the next submit
   * write a sparse array and `ArrayField` would keep the gap.
   */
  async #removeAt(path, index) {
    const list = this.#list(path);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    await this.#write(path, list.toSpliced(index, 1));
  }

  /** Append one entry to an array. */
  async #appendTo(path, entry) {
    await this.#write(path, [...this.#list(path), entry]);
  }

  /**
   * Roll one Warden table and return its text, or `null` after warning that it is missing.
   * A missing table is a world whose Warden deleted it, not an error worth a stack trace.
   */
  static async #rollText(name) {
    const result = await rollWardenTable(name);
    if (!result) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Faction.NoTable", { name }));
      return null;
    }
    return stripTags(result.text);
  }

  /* -------------------------------------------- */
  /*  Rolling                                     */
  /* -------------------------------------------- */

  /** A die beside a plain field: roll its table, write the result into that field. */
  static async #onRollField(event, target) {
    const text = await CairnFactionPageSheet.#rollText(target.dataset.table);
    if (text === null) return;
    await this.page.update({ [target.dataset.target]: text });
  }

  /** A die on a list row: roll that row's table into one key of that row. */
  static async #onRollRow(event, target) {
    const { list: path, key, table } = target.dataset;
    const index = CairnFactionPageSheet.#rowIndex(target);
    const text = await CairnFactionPageSheet.#rollText(table);
    if (text === null || !Number.isInteger(index)) return;

    const list = this.#list(path);
    if (index >= list.length) return;
    await this.#write(path, list.map((row, i) => (i === index ? { ...row, [key]: text } : row)));
  }

  /**
   * Traits are rolled as a PAIR. "Roll 1d20 for each column and combine the results" — the trait
   * table is two columns, and one of them alone is half an answer.
   */
  static async #onTraitRoll() {
    const first = await CairnFactionPageSheet.#rollText("Faction Trait 1");
    if (first === null) return;
    const second = await CairnFactionPageSheet.#rollText("Faction Trait 2");
    await this.#write("traits", [...this.#list("traits"), first, second].filter(Boolean));
  }

  /* -------------------------------------------- */
  /*  Rows                                        */
  /* -------------------------------------------- */

  /** Each row is added blank: the row IS the prompt to fill it. */
  static async #onTraitAdd() {
    await this.#appendTo("traits", "");
  }

  static async #onTraitRemove(event, target) {
    await this.#removeAt("traits", CairnFactionPageSheet.#rowIndex(target));
  }

  static async #onAdvantageAdd() {
    await this.#appendTo("advantages", { name: "", note: "", item: "" });
  }

  static async #onAdvantageRemove(event, target) {
    await this.#removeAt("advantages", CairnFactionPageSheet.#rowIndex(target));
  }

  static async #onAgentAdd() {
    await this.#appendTo("agents", { name: "", role: "", wil: 10, motivation: "", actor: "" });
  }

  static async #onAgentRemove(event, target) {
    await this.#removeAt("agents", CairnFactionPageSheet.#rowIndex(target));
  }

  static async #onGoalAdd() {
    await this.#appendTo("agenda.goals", { text: "", done: false });
  }

  static async #onGoalRemove(event, target) {
    await this.#removeAt("agenda.goals", CairnFactionPageSheet.#rowIndex(target));
  }

  static async #onObstacleAdd() {
    await this.#appendTo("obstacles", { text: "", resolved: false });
  }

  static async #onObstacleRemove(event, target) {
    await this.#removeAt("obstacles", CairnFactionPageSheet.#rowIndex(target));
  }

  /** Open the document an agent or an advantage names. The row is a way in, not a replacement. */
  static #onOpenLink(event, target) {
    const row = target.closest("[data-index]");
    const index = Number(row?.dataset.index);
    const inAgents = !!target.closest(".cairn-faction-agents");
    const entry = inAgents ? this.page.system.agents[index] : this.page.system.advantages[index];
    const uuid = inAgents ? entry?.actor : entry?.item;
    if (uuid) fromUuidSync(uuid)?.sheet?.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  The two rolls a faction has                 */
  /* -------------------------------------------- */

  /** @this {CairnFactionPageSheet} */
  static async #onFactionAction() {
    await rollFactionAction(this.page.name);
  }

  /** @this {CairnFactionPageSheet} */
  static async #onAgentSave() {
    const highest = this.page.system.highestAgent;
    if (!highest) return;
    await rollFactionSave(highest.name, highest.wil);
  }
}

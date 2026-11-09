/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, TABLES } from "../constants.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/quick-rules`;
const RULE_CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/rule-card.hbs`;

/** The list's groups, in the order they are drawn. */
const GROUPS = ["core", "character", "combat", "magic", "dungeon", "wilderness", "hazards"];

/**
 * A play rule as the Player's Guide words it. `text` is one or more en.json keys, each an HTML
 * string this system writes (so drawn raw); `embed` is a document uuid rendered under the text.
 * `gm` hides the entry from players: hiding, not secrecy — the text is in the client either way.
 */
export const ENTRIES = [
  { id: "saves", group: "core",
    title: "CAIRN.QuickRules.Entry.Saves.Title", text: ["CAIRN.QuickRules.Entry.Saves.Text"] },
  { id: "criticalDamage", group: "combat",
    title: "CAIRN.QuickRules.Entry.CriticalDamage.Title", text: ["CAIRN.QuickRules.Entry.CriticalDamage.Text"] },
  { id: "scars", group: "combat", embed: TABLES.SCARS,
    title: "CAIRN.QuickRules.Entry.Scars.Title", text: ["CAIRN.QuickRules.Entry.Scars.Text"] },
  // The maintainer's own rulings (the Hazards window), reusing that window's strings. The
  // Warden's, as the window is.
  { id: "fall", group: "hazards", gm: true,
    title: "CAIRN.Hazards.Fall.Name", text: ["CAIRN.Hazards.Fall.Summary", "CAIRN.Hazards.Fall.Repeats"] },
  { id: "drowning", group: "hazards", gm: true,
    title: "CAIRN.Hazards.Drowning.Name", text: ["CAIRN.Hazards.Drowning.Summary", "CAIRN.Hazards.Drowning.Repeats"] },
  { id: "crushing", group: "hazards", gm: true,
    title: "CAIRN.Hazards.Crushing.Name", text: ["CAIRN.Hazards.Crushing.Summary", "CAIRN.Hazards.Crushing.Repeats"] },
  { id: "exposure", group: "hazards", gm: true,
    title: "CAIRN.Hazards.Exposure.Name", text: ["CAIRN.Hazards.Exposure.Summary", "CAIRN.Hazards.Exposure.Repeats"] }
];

/**
 * The packs a table looks things up in. Not `backgrounds` and not `background-gear`: those are
 * the backgrounds' starting kits, whose rows repeat the Marketplace's (Gold nine times). Spellbook
 * and scroll rows share their spell's name and picture, so the glyph is what tells them apart.
 * `homebrew` mirrors the manifest's Homebrew pack folder.
 */
export const ITEM_SOURCES = [
  { pack: "gear", glyph: "fa-toolbox" },
  { pack: "weapons", glyph: "fa-khanda" },
  { pack: "armor", glyph: "fa-shield-halved" },
  { pack: "spellbooks", glyph: "fa-book" },
  { pack: "scrolls", glyph: "fa-scroll" },
  { pack: "relics", glyph: "fa-gem" },
  { pack: "more-gear", glyph: "fa-toolbox", homebrew: true },
  { pack: "more-spellbooks", glyph: "fa-book", homebrew: true },
  { pack: "more-scrolls", glyph: "fa-scroll", homebrew: true },
  { pack: "potions", glyph: "fa-flask", homebrew: true },
  { pack: "materials", glyph: "fa-cubes", homebrew: true }
];

/** A shorter query lists the rules, grouped: one letter matches nearly everything. */
const MIN_QUERY = 2;

/** 885 items match "e"; past this many rows a list stops being something anyone reads. */
const ITEM_LIMIT = 50;

/**
 * Markup to the words in it. A `<template>`'s content is inert, so an `<img>` in a description
 * is never fetched just to be searched.
 */
function plainText(html) {
  const template = document.createElement("template");
  template.innerHTML = html ?? "";
  return template.content.textContent;
}

/** Searchable rules, built once per client the first time the window renders. */
let ruleIndex = null;

function rules() {
  ruleIndex ??= ENTRIES.map((entry) => {
    const title = game.i18n.localize(entry.title);
    const text = entry.text.map((key) => plainText(game.i18n.localize(key))).join(" ");
    return { ...entry, label: title, titleKey: title.toLowerCase(), textKey: `${title} ${text}`.toLowerCase() };
  });
  return ruleIndex;
}

/** The items of every source pack this user may see, loaded once per client, all at once. */
let itemIndex = null;

function items() {
  itemIndex ??= Promise.all(ITEM_SOURCES.map(async (source) => {
    const pack = game.packs.get(`${SYSTEM_ID}.${source.pack}`);
    // A pack hidden from this user stays hidden here too.
    if (!pack?.visible) return [];
    const index = await pack.getIndex({ fields: ["system.description"] });
    return index.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      img: entry.img,
      glyph: source.glyph,
      homebrew: !!source.homebrew,
      titleKey: entry.name.toLowerCase(),
      textKey: plainText(entry.system?.description).toLowerCase()
    }));
  })).then((lists) => lists.flat());
  return itemIndex;
}

/** Name matches first, then text-only matches, each alphabetical. */
function ranked(rows, query) {
  const byName = (a, b) => a.titleKey.localeCompare(b.titleKey);
  const named = rows.filter((row) => row.titleKey.includes(query)).sort(byName);
  const texted = rows.filter((row) => !row.titleKey.includes(query) && row.textKey.includes(query)).sort(byName);
  return [...named, ...texted];
}

/**
 * Quick Rules — a play rule or an item, found by typing. A rule is drawn in the Player's Guide's
 * own words, an item as its card; either goes to chat, and an item row drags onto a sheet.
 *
 * Rules are this system's own `en.json` strings rather than the `players-guide` journal: the
 * journal is the whole book, creation tables and Marketplace included, and core's compendium
 * search matches document names only. Items come live from the system's packs, so a rebuilt pack
 * is never out of step with the window.
 *
 * One window per client, opened from a character's Actions menu, the Warden's sidebar, or the
 * supplied macro.
 */
export class CairnQuickRules extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — the list and the entry scroll on their own, and their drawn rules with them. */
  static INK_SCROLLERS = [".cairn-quick-list", ".cairn-quick-entry"];

  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-quick-rules`,
    classes: [SYSTEM_ID, "cairn-quick-rules"],
    position: { width: 760, height: 560 },
    window: { title: "CAIRN.QuickRules.Title", icon: "fa-solid fa-magnifying-glass", resizable: true },
    actions: {
      showEntry: CairnQuickRules.#onShowEntry,
      sendToChat: CairnQuickRules.#onSendToChat
    }
  };

  // Three parts so typing re-renders only the list: the field keeps its focus and caret.
  static PARTS = {
    search: { template: `${TEMPLATES}/search.hbs` },
    list: { template: `${TEMPLATES}/list.hbs`, scrollable: [".cairn-quick-list"] },
    entry: { template: `${TEMPLATES}/entry.hbs`, scrollable: [".cairn-quick-entry"] }
  };

  /** The one window this client has. */
  static #instance = null;

  /** Open the window, or bring the open one forward. Anyone may. */
  static open() {
    CairnQuickRules.#instance ??= new CairnQuickRules();
    return CairnQuickRules.#instance.render({ force: true });
  }

  /** What is in the field, as typed. */
  #input = "";

  /** The trimmed, lower-cased search. */
  #query = "";

  /** @type {{kind: "rule", id: string}|{kind: "item", uuid: string}|null} */
  #selected = null;

  #dd = null;

  get #dragDrop() {
    return this.#dd ??= new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".draggable",
      callbacks: { dragstart: this.#onDragStart.bind(this) }
    });
  }

  /** The rules this user may see. */
  #rules() {
    return rules().filter((rule) => !rule.gm || game.user.isGM);
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "search") context.query = this.#input;
    else if (partId === "list") Object.assign(context, await this.#listContext());
    else if (partId === "entry") Object.assign(context, await this.#entryContext());
    return context;
  }

  async #listContext() {
    const selected = this.#selected;
    const ruleRow = (rule) => ({ id: rule.id, label: rule.label, active: selected?.kind === "rule" && selected.id === rule.id });
    if (this.#query.length < MIN_QUERY) {
      const visible = this.#rules();
      const groups = GROUPS.map((group) => ({
        label: game.i18n.localize(`CAIRN.QuickRules.Group.${group.capitalize()}`),
        rules: visible.filter((rule) => rule.group === group).map(ruleRow)
      })).filter((group) => group.rules.length);
      return { grouped: true, groups };
    }
    const matches = ranked(await items(), this.#query);
    // The rules and the items are one list to the eye: a rule is ruled under unless it is last.
    const found = ranked(this.#rules(), this.#query).map((rule, i, all) => ({
      ...ruleRow(rule), rule: i < all.length - 1 || matches.length > 0
    }));
    const shown = matches.slice(0, ITEM_LIMIT).map((item) => ({
      ...item, active: selected?.kind === "item" && selected.uuid === item.uuid
    }));
    const more = matches.length - shown.length;
    return {
      grouped: false,
      rules: found,
      items: shown,
      more: more > 0 ? game.i18n.localize("CAIRN.QuickRules.More", { count: more }) : "",
      empty: !found.length && !shown.length
    };
  }

  async #entryContext() {
    const selected = this.#selected;
    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html);
    if (selected?.kind === "item") return { item: true, body: await enrich(`@Embed[${selected.uuid}]`) };
    const rule = selected?.kind === "rule" && this.#rules().find((r) => r.id === selected.id);
    if (!rule) return { pick: true };
    return {
      rule: true,
      title: rule.label,
      body: await this.#ruleBody(rule)
    };
  }

  /** A rule's text, then its embed. The text keys are this system's own HTML, so drawn raw. */
  async #ruleBody(rule) {
    const text = rule.text.map((key) => game.i18n.localize(key));
    if (rule.embed) {
      text.push(await foundry.applications.ux.TextEditor.implementation.enrichHTML(`@Embed[${rule.embed}]`));
    }
    return text.join("");
  }

  /**
   * @override — the field's `input` is not a click, so it is no `actions` entry. Bound per part,
   * on the element just rendered, so a re-render never stacks a second listener.
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId === "search") {
      const field = htmlElement.querySelector("input[name=query]");
      field.addEventListener("input", () => this.#onInput(field.value));
    }
    if (partId === "entry") this.#highlight(htmlElement);
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // A plain ApplicationV2 has no drag-drop of its own, so the window binds its own instance.
    this.#dragDrop.bind(this.element);
    if (options.parts.includes("search")) this.element.querySelector("input[name=query]")?.focus();
  }

  /** Typing redraws the list alone, a beat after the last key. */
  #onInput = foundry.utils.debounce((value) => {
    this.#input = value;
    this.#query = value.trim().toLowerCase();
    this.render({ parts: ["list"] });
    // The entry on show keeps its place; only what is marked in it follows the new query.
    const entry = this.element?.querySelector(".cairn-quick-entry");
    if (entry) this.#highlight(entry);
  }, 150);

  /**
   * Mark every match of the query in the entry. Text nodes are split and wrapped, never rebuilt
   * from a string, so the query is never parsed as markup. The previous marks go first.
   * @param {HTMLElement} root
   */
  #highlight(root) {
    const body = root.querySelector(".cairn-quick-body");
    if (!body) return;
    for (const mark of body.querySelectorAll("mark.cairn-quick-mark")) mark.replaceWith(...mark.childNodes);
    body.normalize();
    const query = this.#query;
    if (query.length < MIN_QUERY) return;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let node of nodes) {
      let at = node.data.toLowerCase().indexOf(query);
      while (at >= 0) {
        const hit = node.splitText(at);
        node = hit.splitText(query.length);
        const mark = document.createElement("mark");
        mark.className = "cairn-quick-mark";
        hit.replaceWith(mark);
        mark.append(hit);
        at = node.data.toLowerCase().indexOf(query);
      }
    }
  }

  /** An item row on its way to a sheet: the pack document's uuid, as core's own rows carry. */
  #onDragStart(event) {
    const { uuid } = event.currentTarget.dataset;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
  }

  /**
   * A row: a rule by its id, an item by its uuid.
   * @this {CairnQuickRules}
   */
  static #onShowEntry(event, target) {
    const { entryId, uuid } = target.dataset;
    this.#selected = uuid ? { kind: "item", uuid } : { kind: "rule", id: entryId };
    this.render({ parts: ["list", "entry"] });
  }

  /**
   * The entry on show, for the table: a rule as its own card, an item as the card it posts
   * everywhere else.
   * @this {CairnQuickRules}
   */
  static async #onSendToChat() {
    const selected = this.#selected;
    if (selected?.kind === "item") {
      const item = await fromUuid(selected.uuid);
      return item?.postCard();
    }
    const rule = selected?.kind === "rule" && this.#rules().find((r) => r.id === selected.id);
    if (!rule) return;
    const content = await foundry.applications.handlebars.renderTemplate(RULE_CARD_TPL, {
      body: await this.#ruleBody(rule)
    });
    return ChatMessage.implementation.create({
      speaker: ChatMessage.getSpeaker(),
      flavor: foundry.utils.escapeHTML(rule.label),
      content
    });
  }
}

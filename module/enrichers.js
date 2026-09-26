/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, TOOLTIP_CLASS } from "./constants.js";
import { CONDITIONS } from "./conditions.js";
import { rollSave, drawNamedTable, tableUuidOf } from "./rolls.js";

/**
 * What the Warden writes, made live.
 *
 * Four patterns, resolved wherever Foundry enriches text: a journal page, an item or NPC
 * description, a chat card. Two of them are commands that do something when clicked
 * (`[[/save WIL]]`, `[[/table Reactions]]`) and two are references that carry their meaning on
 * hover (`@Condition[deprived]`, `@Rule[panic]`). That split follows core's own spelling — `[[/…]]`
 * is an inline command, `@X[…]` is a reference — so the syntax is guessable from `[[/r]]` and
 * `@UUID[…]` rather than being this system's invention.
 *
 * Two things about the v14 contract are worth knowing before editing a pattern here:
 *
 * - **Every pattern must be global.** Core iterates matches with `matchAll`
 *   (`client/applications/ux/text-editor.mjs#_applyCustomEnrichers`); a non-global pattern
 *   silently matches once and then loops. `checks/enrichers.check.mjs` asserts the flag.
 * - **`onRender` is handed the WRAPPER, not the element the enricher returned.** When an entry
 *   carries both an `id` and an `onRender`, core wraps whatever came back in an
 *   `HTMLEnrichedContentElement` and stamps the id on that
 *   (`client/applications/ux/text-editor.mjs#_applyCustomEnrichers`). So the chip is a CHILD of
 *   what the handler receives, and reading `element.dataset` there finds nothing. Every handler
 *   goes through {@link chipOf}. Building the wrapper by hand is the other way out of this, and
 *   it is what Crucible does; keeping a plain `<span>` and resolving it costs one function and
 *   leaves the element a span, which is what the CSS and the focus ring want.
 *   Cost a live-client round trip on 2026-09-20 — both commands threw on an undefined dataset.
 *
 * Returning a `Text` node instead of an element is how an unknown id is refused: the original
 * source text stays on the page, which is the honest outcome — a typo should look like a typo,
 * not vanish.
 */

/**
 * The rules a chip can carry, and the two keys each one's text lives under.
 *
 * Eight, not the whole SRD: these are the rules this system *already names* somewhere — in a
 * condition, a roll branch, or a sheet control — so a reference to one is a reference to
 * machinery that exists. The text is quoted from `srd-2e/` (CC BY-SA 4.0, credited in
 * `docs/CREDITS.md`) and lives in `lang/en.json` with the rest of this system's prose.
 *
 * Kept here rather than in `module/constants.js`: it has exactly one consumer, and constants.js
 * is meant to stay the dependency-free leaf every other module can import (CLAUDE.md §4).
 *
 * The ids are kebab-case so they survive a `data-` attribute and a URL unchanged.
 */
const RULES = {
  panic: { label: "CAIRN.Rule.Panic.Label", text: "CAIRN.Rule.Panic.Text" },
  impaired: { label: "CAIRN.Rule.Impaired.Label", text: "CAIRN.Rule.Impaired.Text" },
  enhanced: { label: "CAIRN.Rule.Enhanced.Label", text: "CAIRN.Rule.Enhanced.Text" },
  deprived: { label: "CAIRN.Rule.Deprived.Label", text: "CAIRN.Rule.Deprived.Text" },
  fatigue: { label: "CAIRN.Rule.Fatigue.Label", text: "CAIRN.Rule.Fatigue.Text" },
  detachment: { label: "CAIRN.Rule.Detachment.Label", text: "CAIRN.Rule.Detachment.Text" },
  morale: { label: "CAIRN.Rule.Morale.Label", text: "CAIRN.Rule.Morale.Text" },
  "critical-damage": { label: "CAIRN.Rule.Critical.Label", text: "CAIRN.Rule.Critical.Text" }
};

/**
 * The rule a condition explains itself with, where the SRD defines one.
 *
 * Four of the ten conditions ARE rules under a different name, so `@Condition[deprived]` can
 * borrow `@Rule[deprived]`'s sentence instead of this system carrying a second copy of it. The
 * other six — Dead, Paralyzed, Delirious, Doomed, Encumbered, Fleeing — are states the roster
 * names and the SRD does not write a paragraph about, so their chip is the name alone. That is
 * not an omission to fill in later: inventing explanatory prose the SRD does not have would be
 * inventing rules (CLAUDE.md §1).
 */
const CONDITION_RULES = {
  deprived: "deprived",
  panicked: "panic",
  fatigued: "fatigue",
  "critical-damage": "critical-damage"
};

/* -------------------------------------------- */

/**
 * The actor a clicked chip acts on: whoever is selected, else the user's own character.
 *
 * A chip is read by everyone at the table and clicked by one of them, so it cannot carry an
 * actor of its own — the page it sits on does not know who is reading it. Selection first
 * because that is what a Warden running four NPCs means by "this one"; the assigned character
 * second because that is what a player with nothing selected means.
 * @returns {Actor|null}
 */
function enricherActor() {
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length) return controlled[0].actor ?? null;
  return game.user.character ?? null;
}

/**
 * The chip inside whatever core handed the `onRender` callback.
 *
 * Core wraps an enricher's return value in an `HTMLEnrichedContentElement`, so the handler's
 * argument is that wrapper and the chip is its child. Written to accept either, so the day core
 * stops wrapping — or an entry drops its `onRender` and is rendered bare — this still resolves.
 * @param {HTMLElement} element
 * @returns {HTMLElement|null}
 */
function chipOf(element) {
  return element?.matches?.(".cairn-enriched") ? element : element?.querySelector?.(".cairn-enriched") ?? null;
}

/**
 * Wire a chip that does something: pointer, keyboard, and the role that says so.
 *
 * A chip is a `<span>` and not a `<button>` because it sits mid-sentence and a button brings
 * core's control styling, its metrics and its focus ring with it. That trade means the three
 * things a button would have given for free are owed here by hand.
 * @param {HTMLElement} element
 * @param {() => unknown} activate
 */
function onActivate(element, activate) {
  element.addEventListener("click", activate);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();   // Space would scroll the journal out from under the reader.
    activate();
  });
}

/** The shared chip element: this system's scope, its tooltip, and nothing else decided here. */
function chip(kind, label, tooltip) {
  const span = document.createElement("span");
  // The scope class goes on the chip ITSELF, not on an ancestor. A chip lands in core's journal
  // window, which has no `.cairn2e` anywhere above it, so the stylesheet can only reach it
  // by matching the element — hence the compound `.cairn2e.cairn-enriched` selector in the
  // stylesheet rather than a descendant one.
  span.className = `${SYSTEM_ID} cairn-enriched cairn-enriched-${kind}`;
  span.textContent = label;
  // The two that act are controls, and a reader who does not use a pointer has to reach them.
  if (kind === "save" || kind === "table") {
    span.tabIndex = 0;
    span.setAttribute("role", "button");
  }
  if (tooltip) {
    span.dataset.tooltip = tooltip;
    // Same reasoning, for the tooltip: `TooltipManager#activate` resolves the class with
    // `element.closest("[data-tooltip-class]")`, and `closest` matches the element itself — so a
    // chip carries this system's paper tooltip into a window this system did not draw.
    span.dataset.tooltipClass = TOOLTIP_CLASS;
  }
  return span;
}

/* -------------------------------------------- */
/*  Commands                                    */
/* -------------------------------------------- */

/** `[[/save WIL]]`, `[[/save STR]]{Resist the cold}` — a control that rolls that save. */
function enrichSave([, key, label]) {
  const text = label ?? game.i18n.localize("CAIRN.Save", { key: game.i18n.localize(key) });
  const span = chip("save", text, game.i18n.localize("CAIRN.Enrich.SaveHint"));
  span.dataset.key = key;
  return span;
}

function renderSave(element) {
  const chipEl = chipOf(element);
  if (!chipEl) return;
  onActivate(element, () => {
    const actor = enricherActor();
    if (!actor) return ui.notifications.warn(game.i18n.localize("CAIRN.Enrich.NoActor"));
    return rollSave(actor, chipEl.dataset.key);
  });
}

/* -------------------------------------------- */

/**
 * `[[/table Reactions]]` or `[[/table Compendium.cairn2e.tables.RollTable.…]]` — draws it, world
 * copy first, through the one roll door (`rolls.js#drawNamedTable`).
 */
function enrichTable([, ref, label]) {
  const span = chip("table", label ?? tableLabel(ref), game.i18n.localize("CAIRN.Enrich.TableHint"));
  span.dataset.table = ref;
  return span;
}

/**
 * What a chip written without a `{label}` prints: a name as it was typed, and a uuid as the name
 * of the table it points at — read synchronously off the pack's index or the world collection,
 * so a translation module's name is the one shown. A uuid pointing at nothing prints a plain
 * "Table" rather than forty characters of address.
 */
function tableLabel(ref) {
  const address = tableUuidOf(ref);
  if (!address) return ref;
  const entry = address.uuid.startsWith("Compendium.")
    ? address.collection.index?.get(address.id)
    : address.collection.get(address.id);
  return entry?.name ?? game.i18n.localize("CAIRN.Enrich.Table");
}

function renderTable(element) {
  const chipEl = chipOf(element);
  if (!chipEl) return;
  onActivate(element, () => drawNamedTable(chipEl.dataset.table));
}

/* -------------------------------------------- */
/*  References                                  */
/* -------------------------------------------- */

/** `@Condition[deprived]` — the roster's own name, with the SRD sentence where there is one. */
function enrichCondition([match, id, label]) {
  const condition = CONDITIONS.find((c) => c.id === id);
  if (!condition) return new Text(match);
  const rule = RULES[CONDITION_RULES[id]];
  return chip(
    "condition",
    label ?? game.i18n.localize(condition.name),
    rule ? game.i18n.localize(rule.text) : ""
  );
}

/** `@Rule[panic]`, `@Rule[impaired]{roll d4}` — the rule's name, with its sentence on hover. */
function enrichRule([match, id, label]) {
  const rule = RULES[id];
  if (!rule) return new Text(match);
  return chip("rule", label ?? game.i18n.localize(rule.label), game.i18n.localize(rule.text));
}

/* -------------------------------------------- */

/**
 * Register the four patterns. Called once from `init` (`module/cairn2e.js`).
 *
 * `onRender` is given only to the two that are clickable; core requires an `id` alongside it,
 * and uses the pair to wrap and re-find the element after the enriched HTML reaches the DOM.
 */
export function registerEnrichers() {
  CONFIG.TextEditor.enrichers.push(
    {
      id: "cairnSave",
      pattern: /\[\[\/save (STR|DEX|WIL)\]\](?:\{([^}]+)\})?/g,
      enricher: enrichSave,
      onRender: renderSave
    },
    {
      id: "cairnTable",
      pattern: /\[\[\/table ([^\]{}]+)\]\](?:\{([^}]+)\})?/g,
      enricher: enrichTable,
      onRender: renderTable
    },
    {
      id: "cairnCondition",
      pattern: /@Condition\[([\w-]+)\](?:\{([^}]+)\})?/g,
      enricher: enrichCondition
    },
    {
      id: "cairnRule",
      pattern: /@Rule\[([\w-]+)\](?:\{([^}]+)\})?/g,
      enricher: enrichRule
    }
  );
}

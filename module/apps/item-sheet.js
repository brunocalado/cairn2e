/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { enrich } from "../helpers.js";
import { CairnSheetMixin, keptEditorParts } from "./_sheet-mixin.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/item`;
const SHARED = `systems/${SYSTEM_ID}/templates/parts`;

/**
 * The tabs each item subtype shows, in rail order; a subtype not listed here shows Description
 * alone. A `details` tab means the subtype's options are a tab of their own rather than a block
 * fixed above the rail, and it comes first: the numbers are what the sheet is opened to change,
 * and the prose is what is read once.
 */
const SUBTYPE_TABS = {
  // `gear` is not listed: its tabs follow its fields (`CairnGearSheet#tabIds`) — Recharge when it
  // is a relic, Contents when it holds things.
  background: ["details", "description"],
  // A sack's Details is its one number; what it is a sack OF is written on the other tab.
  coin: ["details", "description"],
  // A Fatigue has no editable property at all — the rule it embodies is printed under its name
  // and the rest of the window is for whatever the table wants to write on it.
  fatigue: ["description"],
  // A scar's Details is a printout: the row it came from and what it did to a maximum. Neither is
  // editable here — the maxima are edited in the character's edit window, and two editable copies
  // of one number drift.
  scar: ["details", "description"],
  // A growth's Details is the milestone checklist; what it gave — the words, and the one
  // maximum it moved, printed read-only for the reason a scar's is — is on its Description tab.
  growth: ["details", "description"]
};

/**
 * How tall an item sheet stands.
 *
 * Every converted subtype is the same height, and it is not the tallest thing they contain: it is
 * what the Description tab needs to be a field rather than a slot (measured on the armour sheet,
 * whose three ruled rows end flush with the frame). A subtype with two rows carries a little
 * slack under them rather than a description nobody can write in, and the window is resizable.
 *
 * Three kinds ask for more — a gear, a Background and a growth — and each one's own class says
 * what for, in its `DEFAULT_OPTIONS`.
 */
const SHEET_HEIGHT = 340;

/**
 * The one line that says what a subtype IS, printed under its name in the header.
 *
 * It used to sit inside the properties block as a ruled note, which put a paragraph of rules text
 * where the first field belongs and left the window's top half saying nothing. Under the name is
 * where a caption goes.
 */
const SUBTYPE_HINT = {
  fatigue: "CAIRN.FatigueHint",
  background: "CAIRN.BackgroundHint"
};

/** The parts every item draws; every other part is a tab, drawn while the item shows that tab. */
const FIXED_PARTS = ["header", "nav"];

/** The index of the row a list control was clicked on. */
export function rowIndex(target) {
  return Number(target.closest("[data-index]")?.dataset.index);
}

/**
 * Drop one entry from an array field.
 *
 * The whole array is rewritten rather than the one index cleared, because the template's
 * inputs are addressed by position (`system.names.3`): leaving a hole would make the next
 * submit write a sparse array, and `ArrayField` would keep the gap.
 * @param {Item} item
 * @param {string} path   the `system.*` array to rewrite
 * @param {number} index
 */
export async function removeAt(item, path, index) {
  const list = [...(foundry.utils.getProperty(item, path) ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
  list.splice(index, 1);
  await item.update({ [path]: list });
}

/**
 * What every item sheet shares: the frame, the size, the tab rail, the description, the render
 * narrowing and the digit fields. It is the sheet of a coin, a Fatigue and a feature, which have
 * no behaviour of their own; a gear (`CairnGearSheet`), a Background (`CairnBackgroundSheet`), a
 * growth (`CairnGrowthSheet`) and a scar (`CairnScarSheet`) each extend it in a file of their own.
 * The Details tab's template is chosen per document type in `_configureRenderParts`, which also
 * drops the tab parts this item has no tab for.
 */
export class CairnItemSheet extends CairnInkMixin(CairnSheetMixin(HandlebarsApplicationMixin(ItemSheetV2))) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "item"],
    position: { width: 480, height: SHEET_HEIGHT },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false }
  };

  // Header and nav are shared with every other sheet in the system; `details` swaps template
  // per subtype and the tab parts are filtered down to the ones this item shows.
  // No part is `root: true` — that would force the whole set to render.
  static PARTS = {
    header: { template: `${SHARED}/item-header.hbs` },
    nav: { template: `${SHARED}/sheet-nav.hbs` },
    details: { template: `${TEMPLATES}/gear-details.hbs`, scrollable: [""] },
    description: { template: `${TEMPLATES}/tab-description.hbs`, scrollable: [""] }
  };

  /** Item fields whose only display is inside an editor, and their parts (see
   *  `CairnSheetMixin.EDITOR_FIELDS`). */
  static EDITOR_FIELDS = { "system.description": "description" };

  // The group must be declared so `changeTab` accepts it; `_getTabsConfig` narrows the list to the
  // item's own tabs at render time.
  static TABS = {
    primary: {
      initial: "description",
      tabs: [
        { id: "details", label: "CAIRN.Details" },
        { id: "description", label: "CAIRN.Description" }
      ]
    }
  };

  /**
   * @override — the tab a sheet opens on is this subtype's FIRST tab, not one value shared by
   * every subtype.
   *
   * Core seeds this field from `TABS.primary.initial` as a class field
   * (`api/application.mjs:287`), which runs before the sheet knows what document it is for — so a
   * static `initial` cannot say "Details on an armour, Description on everything else". Seeded
   * null instead, `_prepareTabs`'s own `??=` (`:706`) takes the `initial` that `_getTabsConfig`
   * returns below, which IS per-subtype.
   * @type {Record<string, string|null>}
   */
  tabGroups = { primary: null };

  /** Tab ids this document actually shows, in rail order. A subclass whose tabs follow its
   *  fields overrides it. */
  get tabIds() {
    return SUBTYPE_TABS[this.document.type] ?? ["description"];
  }

  /** @override — v14's documented hook for a dynamic tab set (`api/application.mjs:723`).
   *  `_prepareTabs` consumes the return value and does the `active` / `cssClass` bookkeeping. */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (group !== "primary" || !config) return config;
    const ids = this.tabIds;
    // Mapped over the subtype's own ids rather than filtered, so the rail is in the order the
    // subtype declares and not the order the static list happens to be written in. `initial` is
    // the first of them — core only reads it for a group it has not opened yet
    // (`api/application.mjs:706`), so a reader's own choice of tab still survives a re-render.
    const byId = new Map(config.tabs.map((t) => [t.id, t]));
    const tabs = ids.map((id) => byId.get(id)).filter(Boolean);
    return { ...config, initial: ids[0], tabs };
  }

  /** @override — per-subtype properties block, and only the tab parts this item has. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const ids = this.tabIds;
    if (ids.includes("details")) parts.details.template = `${TEMPLATES}/${this.document.type}-details.hbs`;
    for (const id of Object.keys(parts)) {
      if (!FIXED_PARTS.includes(id) && !ids.includes(id)) delete parts[id];
    }
    return parts;
  }

  /** @override — narrow what a document change rebuilds. Same reasoning as the actor sheets: an
   *  item's own update never has to rebuild the editor that just saved it. */
  _configureRenderOptions(options) {
    const explicit = Array.isArray(options.parts);
    super._configureRenderOptions(options);
    if (explicit || options.isFirstRender || !options.renderContext) return;
    // Hiding or revealing swaps what every editor holds for a user who is not the Warden — the
    // guise's text for the real one, or back — so that one change rebuilds them all.
    if (foundry.utils.hasProperty(options.renderData ?? {}, "system.unknown")) return;
    // ...otherwise every editor on screen and current is left alone (`_sheet-mixin.js#keptEditorParts`).
    // TODO: the growth's Description part also prints the outcome line (`Max WIL 5 → 11`), so a
    // gain recorded from the character sheet while this sheet is open on that tab leaves the line
    // stale until the tab or the sheet is reopened. Either split the gained block into a part of
    // its own, or repaint that one line by hand here.
    const kept = keptEditorParts(this, options.renderData);
    options.parts = options.parts.filter((id) => !kept.includes(id));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    context.item = item;
    context.system = item.system;
    context.editable = this.isEditable;
    context.hint = SUBTYPE_HINT[item.type] ?? "";
    // The feature's one property sits in the header's caption row (`parts/item-header.hbs`):
    // the feature has no Details tab, and a tab for a single toggle would put it a click away.
    context.isFeature = item.type === "feature";
    // The editor's own value, and what a reader who cannot edit sees instead of an editor: the
    // description as it reads, links live (`tab-description.hbs`); a gear adds the same pair for
    // its recharge and its guise.
    // The guise to a user the gear is hidden from — and the editor's `value` carries it too, or the
    // real description would sit in the DOM of a disabled editor.
    context.hidden = item.isHiddenFromMe;
    context.displayName = item.shownName;
    context.displayImg = item.shownImg;
    context.descriptionValue = item.shownDescription;
    context.descriptionHTML = await enrich(item.shownDescription, item);
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // A gear's tab set follows its fields (`CairnGearSheet#tabIds`), and core only ever appends a
    // part that is new to a render and leaves one that is gone in place
    // (`api/handlebars-application.mjs`, "Append or replace"): a capacity set back to 0 would
    // otherwise leave a Contents section in the DOM with no tab pointing at it. Pruned here, where
    // the current set is known.
    const ids = this.tabIds;
    for (const part of this.element.querySelectorAll("[data-application-part]")) {
      const id = part.dataset.applicationPart;
      if (!FIXED_PARTS.includes(id) && !ids.includes(id)) part.remove();
    }
    // A tab that just went — the Guise, on a Reveal — leaves nothing active; core keeps the id it
    // last opened (`api/application.mjs#_prepareTabs`), so the sheet is moved to its first tab.
    // `changeTab` and not `tabGroups`: a part this render skipped (`_configureRenderOptions`) still
    // wears the `active` class it was drawn with.
    if (!ids.includes(this.tabGroups.primary)) this.changeTab(ids[0], "primary", { force: true });
  }

  /** @override */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    // A digit field holds digits, and nothing else reaches the DataModel. `type="number"` was
    // not enough: a minus sign, an `e` and a decimal point all type into one, and the model
    // answers a negative number with a validation error after the fact. Stripped as it is
    // typed, and clamped to the field's own floor when it is left — a field emptied and
    // abandoned comes back as its minimum rather than as a failed save.
    for (const field of htmlElement.querySelectorAll("input.cairn-prop-number")) {
      const min = Number(field.getAttribute("min")) || 0;
      field.addEventListener("input", () => {
        const digits = field.value.replace(/\D+/g, "");
        if (field.value !== digits) field.value = digits;
      });
      field.addEventListener("change", () => {
        field.value = String(Math.max(min, Number(field.value) || 0));
      });
    }
  }
}

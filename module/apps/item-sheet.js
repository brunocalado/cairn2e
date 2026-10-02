/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { GRANT_DRAG_KEY } from "../grants.js";
import { moveCoin, promptCoinAmount } from "../coin.js";
import { nestingRefusal } from "../data/_derived.js";
import { outcomeLabel } from "../scars.js";
import { enrich } from "../helpers.js";
import { CairnSheetMixin } from "./_sheet-mixin.js";
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
  // `gear` is not listed: its tabs follow its fields (`#tabIds`) — Recharge when it is a relic,
  // Contents when it holds things.
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
 * Two subtypes ask for more, and `TALLER` says what for.
 */
const SHEET_HEIGHT = 340;

/** The largest slot cost the buttons run to, so the row is one contiguous scale. The heaviest
 *  thing the SRD prints is four — the Candelabra of `srd-2e/wardens-guide/dungeon-seeds.md` — and
 *  the run goes one past it, so a Warden's own heavier item is a click rather than a special case.
 *  A document above even that still appends its own button. */
const SLOT_BUTTONS = 5;

/** The subtypes that need more, and what they need it for: a gear's Details is up to seven ruled
 *  rows in the common cases (a weapon, a container: the axis, its rider, the three every
 *  gear has and the Add row), and the Background's three lists are the tallest thing an item
 *  sheet draws. A gear that has every axis set stands nine rows and scrolls; that is the rare
 *  thing, and the window is resizable.
 *  TODO: with ten names, the Starting Gear and Tables zones sit entirely below the fold at 480,
 *  so reaching them means scrolling past the whole name list. Either the window grows past the
 *  other item sheets, or the Names zone folds — the maintainer's call.
 *  A growth's Description tab holds two text boxes, the story and what was gained, and two in
 *  340px leave each under a paragraph tall. */
const TALLER = { gear: 480, background: 480, growth: 480 };

/**
 * The axes a gear's Details tab draws only when they say something. A Torch has no die, no
 * armour, no magic, no charges and holds nothing, and five rows of "none" under it were the whole
 * sheet; so each row is drawn when its field has a value. `set` is the field's own "not blank",
 * and it is the ONLY question — an axis is on the tab exactly when the document says it has a
 * value, so there is no sheet-local "asked for but still empty" state to keep in step with it.
 *
 * `open` is what the Add row commits: the axis's first option, written straight to the document.
 * That is what makes the first button of a segmented control come up selected and the number
 * fields come up holding a number somebody would keep — a row that merely LOOKED filled would be
 * claiming a value the document does not hold, and closing the sheet would lose the claim.
 *
 * `offer` is the second question, and the container / bodily pair asks it: a container holds
 * things, so it is not a weapon, not armour and not part of anybody's body
 * (`data/item-gear.js#prepareBaseData` clears all three), and part of a body holds nothing.
 * Without this the Add row would keep offering rows whose value the next save wipes.
 *
 * Grants is the one axis with no first value to commit: what it holds is whatever gets dropped on
 * it, and nothing can be written before the drop. So it has no `open`, and clicking it opens the
 * row — its drop zone — on this sheet alone (`#grantsOpen`) until the window closes or a drop
 * gives it a value of its own.
 */
const AXES = [
  { id: "damage", label: "CAIRN.Damage", set: (sys) => !!sys.damage,
    open: { "system.damage": "d4" }, offer: (sys) => !sys.isContainer },
  { id: "armor", label: "CAIRN.Armor", set: (sys) => sys.armor > 0,
    open: { "system.armor": 1 }, offer: (sys) => !sys.isContainer },
  { id: "magic", label: "CAIRN.Magic", set: (sys) => sys.magic !== "none",
    open: { "system.magic": "spellbook" } },
  { id: "uses", label: "CAIRN.Uses", set: (sys) => sys.uses.max > 0,
    open: { "system.uses.value": 1, "system.uses.max": 1 } },
  { id: "capacity", label: "CAIRN.Capacity", set: (sys) => sys.capacity > 0,
    open: { "system.capacity": 1 }, offer: (sys) => !sys.bodily },
  // Not on a container (a bag is not a limb) and not on a thing stowed in one: the document
  // would refuse the pointer it already has, and the row would claim a state it cannot hold.
  { id: "bodily", label: "CAIRN.Body", set: (sys) => sys.bodily,
    open: { "system.bodily": true }, offer: (sys) => !sys.isContainer && !sys.container },
  { id: "grants", label: "CAIRN.Grants.Label", set: (sys) => sys.grants.length > 0 }
];

/** What a Grants zone takes: any Actor but a party, and gear. A party is a roster of other
 *  actors, not something an item can come with. */
function grantable(document) {
  if (document?.documentName === "Actor") return document.type !== "party";
  return document?.documentName === "Item" && document.type === "gear";
}

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

/** A gear's caption follows its magic kind: what using it costs is the one line worth a caption;
 *  the die and the armour are rows. */
const MAGIC_HINT = {
  spellbook: "CAIRN.SpellbookHint",
  scroll: "CAIRN.ScrollHint",
  relic: "CAIRN.RelicHint"
};

/** The tab parts that are only drawn for the subtypes that declare them. */
const OPTIONAL_PARTS = ["details", "recharge", "contents"];

/**
 * One sheet class for every Item subtype. The properties block is chosen per document type in
 * `_configureRenderParts`, which also drops the tab parts this subtype has no tab for; upstream's
 * `get template()` switch is gone with the v1 framework.
 */
export class CairnItemSheet extends CairnInkMixin(CairnSheetMixin(HandlebarsApplicationMixin(ItemSheetV2))) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "item"],
    position: { width: 480, height: 480 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      axisAdd: CairnItemSheet.#onAxisAdd,
      contentRemove: CairnItemSheet.#onContentRemove,
      nameAdd: CairnItemSheet.#onNameAdd,
      nameRemove: CairnItemSheet.#onNameRemove,
      tableRemove: CairnItemSheet.#onTableRemove,
      gearRemove: CairnItemSheet.#onGearRemove,
      revealRelic: CairnItemSheet.#onRevealRelic,
      grantOpen: CairnItemSheet.#onGrantOpen,
      grantRemove: CairnItemSheet.#onGrantRemove,
      milestoneAdd: CairnItemSheet.#onMilestoneAdd,
      milestoneRemove: CairnItemSheet.#onMilestoneRemove
    }
  };

  // Header and nav are shared with every other sheet in the system; `properties` swaps template
  // per subtype and the three tab parts are filtered down to the ones this subtype declares.
  // No part is `root: true` — that would force the whole set to render.
  static PARTS = {
    header: { template: `${SHARED}/item-header.hbs` },
    nav: { template: `${SHARED}/sheet-nav.hbs` },
    details: { template: `${TEMPLATES}/gear-details.hbs`, scrollable: [""] },
    description: { template: `${TEMPLATES}/tab-description.hbs`, scrollable: [""] },
    recharge: { template: `${TEMPLATES}/tab-recharge.hbs`, scrollable: [""] },
    contents: { template: `${TEMPLATES}/tab-contents.hbs`, scrollable: [""] }
  };

  /** Item fields whose only display is inside an editor (see `CairnActorSheet.EDITOR_FIELDS`). */
  static EDITOR_FIELDS = ["system.description", "system.recharge", "system.guiseDescription"];

  // The group must be declared so `changeTab` accepts it; `_getTabsConfig` narrows the list to the
  // subtype's own tabs at render time.
  static TABS = {
    primary: {
      initial: "description",
      tabs: [
        { id: "details", label: "CAIRN.Details" },
        { id: "description", label: "CAIRN.Description" },
        { id: "recharge", label: "CAIRN.Recharge" },
        { id: "contents", label: "CAIRN.Contents" }
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

  /** @override — the window is sized per subtype, and the type is only known once the sheet has
   *  a document (`api/document-sheet.mjs:134` is where core puts it on the options). */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    const type = options.document.type;
    options.position = { ...options.position, height: TALLER[type] ?? SHEET_HEIGHT };
    return options;
  }

  /**
   * @override — a relic unknown to this user is read, never written: its sheet holds the guise,
   * and a field left editable would be a field that writes the real data behind it. The
   * document's own guard refuses the write as well (`documents/item.js#_preUpdate`).
   */
  get isEditable() {
    return super.isEditable && !this.item.isHiddenFromMe;
  }

  /** @override — the title bar names the guise to a user the relic is hidden from. */
  get title() {
    return this.item.isHiddenFromMe ? this.item.shownName : super.title;
  }

  /**
   * @override — the Warden's Reveal, while the relic is unknown. It clears the one boolean and
   * tells the table what the thing turned out to be.
   */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    if (game.user.isGM && this.item.type === "gear" && this.item.system.unknown) {
      controls.push({ action: "revealRelic", icon: "fa-solid fa-eye", label: "CAIRN.Relic.Reveal" });
    }
    return controls;
  }

  /** Tab ids this document actually shows, in rail order. */
  get #tabIds() {
    const type = this.document.type;
    if (type !== "gear") return SUBTYPE_TABS[type] ?? ["description"];
    const sys = this.document.system;
    return [
      "details",
      "description",
      // A hidden relic's Recharge is part of what it hides.
      ...(sys.magic === "relic" && !this.item.isHiddenFromMe ? ["recharge"] : []),
      ...(sys.isContainer ? ["contents"] : [])
    ];
  }

  /** @override — v14's documented hook for a dynamic tab set (`api/application.mjs:723`).
   *  `_prepareTabs` consumes the return value and does the `active` / `cssClass` bookkeeping. */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (group !== "primary" || !config) return config;
    const ids = this.#tabIds;
    // Mapped over the subtype's own ids rather than filtered, so the rail is in the order the
    // subtype declares and not the order the static list happens to be written in. `initial` is
    // the first of them — core only reads it for a group it has not opened yet
    // (`api/application.mjs:706`), so a reader's own choice of tab still survives a re-render.
    const byId = new Map(config.tabs.map((t) => [t.id, t]));
    const tabs = ids.map((id) => byId.get(id)).filter(Boolean);
    return { ...config, initial: ids[0], tabs };
  }

  /** @override — per-subtype properties block, and only the tab parts this subtype has. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const ids = this.#tabIds;
    if (ids.includes("details")) parts.details.template = `${TEMPLATES}/${this.document.type}-details.hbs`;
    for (const id of ["description", ...OPTIONAL_PARTS]) {
      if (!ids.includes(id)) delete parts[id];
    }
    return parts;
  }

  /** @override — narrow what a document change rebuilds. Same reasoning as the actor sheets: an
   *  item's own update never has to rebuild the editor that just saved it. */
  _configureRenderOptions(options) {
    const explicit = Array.isArray(options.parts);
    super._configureRenderOptions(options);
    if (explicit || options.isFirstRender || !options.renderContext) return;
    // ...but an editor with no element on screen has nothing to keep, and skipping it here means
    // it is never built at all. The Recharge tab exists only while `magic` is `relic`, and that
    // transition IS a document update — so without the second clause the one render that would
    // have created the part is the one that drops it, leaving a tab in the rail pointing at
    // nothing until the sheet is closed and reopened.
    //
    // The test is the DOM and not `this.parts`, which is core's record of every part it has ever
    // rendered (`api/handlebars-application.mjs`) and keeps a detached element for one this sheet
    // has since pruned in `_onRender` — so a relic turned back into a spellbook and into a relic
    // again would be filtered out on that second pass and never rebuilt.
    // TODO: the growth's Description part also prints the outcome line (`Max WIL 5 → 11`), so a
    // gain recorded from the character sheet while this sheet is open on that tab leaves the line
    // stale until the tab or the sheet is reopened. Either split the gained block into a part of
    // its own, or repaint that one line by hand here.
    const editors = ["description", "recharge"];
    const onScreen = new Set([...(this.element?.querySelectorAll("[data-application-part]") ?? [])]
      .map((part) => part.dataset.applicationPart));
    options.parts = options.parts.filter((id) => !editors.includes(id) || !onScreen.has(id));
  }

  /** @override */
  _canRender(options) {
    const { renderContext, renderData } = options;
    if (renderContext === "updateItem" && renderData) {
      const touched = Object.keys(foundry.utils.flattenObject(renderData))
        .filter((k) => !k.startsWith("_") && !this.constructor.EDITOR_FIELDS.includes(k));
      if (!touched.length) return false;
    }
    return super._canRender(options);
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
    // description as it reads, links live (`tab-description.hbs`), and the same pair for the
    // recharge and the guise below.
    // The guise to a user the relic is hidden from — and the editor's `value` carries it too, or the
    // real description would sit in the DOM of a disabled editor.
    context.hidden = item.isHiddenFromMe;
    context.displayName = item.shownName;
    context.descriptionValue = item.shownDescription;
    context.descriptionHTML = await enrich(item.shownDescription, item);
    if (item.system.magic === "relic" && !context.hidden) context.rechargeHTML = await enrich(item.system.recharge, item);
    // The Warden's zone on a relic's Details: whether its holder knows it, and the guise if not.
    context.wardenRelic = game.user.isGM && item.type === "gear" && item.system.magic === "relic";
    if (context.wardenRelic && item.system.unknown) context.guiseHTML = await enrich(item.system.guiseDescription, item);

    // A scar's Details is a printout of `system.outcome`. The label of the row it changed is
    // built here rather than in the template: "hp" is the character's Hit Protection maximum and
    // the other three are attribute keys that are their own words.
    if (item.type === "scar") {
      const { attr, from, to } = item.system.outcome;
      context.scar = {
        entry: item.system.entry,
        hasOutcome: item.system.resolved && !!attr,
        outcomeLabel: outcomeLabel(item.system.outcome),
        from,
        to,
        stateLabel: item.system.resolved ? "CAIRN.Scar.Resolved" : "CAIRN.Scar.Pending"
      };
    }

    // A growth prints the maximum it moved on its Description tab, the same printout as a scar's
    // Details, and it reuses the scar's two maximum labels: they name a resource on the ACTOR, not a property of a scar, and one English string
    // in one place cannot drift from itself.
    if (item.type === "growth") {
      const { attr, from, to } = item.system.outcome;
      context.growth = {
        hasOutcome: item.system.resolved && !!attr && from !== to,
        outcomeLabel: outcomeLabel(item.system.outcome),
        from,
        to
      };
    }

    // The three selectors' buttons, read off the field's own `choices` / bounds so the row of
    // buttons and what a save will accept cannot drift apart (`module/data/item-gear.js`).
    //
    // The clearing option goes LAST in each run. Once an axis is only ever added with a value
    // (`AXES#open`), its blank is not one answer among several — it is the control that takes the
    // row away again, and it wears the word for it. A leading `—` or `0` reads as a value in a
    // list of values, which is what put the remove control first and unlabelled.
    if (item.type === "gear") {
      const schema = item.system.schema;
      // A blank die is the model's own "not a weapon".
      context.damageChoices = [...Object.keys(schema.getField("damage").choices), ""];
      // Armour is 0-3 and nothing else; zero is "not armour", so it goes last and wears the word.
      const { min, max } = schema.getField("armor");
      context.armorChoices = Array.fromRange(max - min + 1, min)
        .filter((value) => value !== 0)
        .concat(0)
        .map((value) => ({
          value,
          label: value === 0 ? game.i18n.localize("CAIRN.None") : String(value)
        }));

      // What it costs of the ten, as one contiguous run of buttons — never a gapped one, which
      // would leave an item costing three with nowhere to click. Two of the values carry 2e's own
      // word for them: *petty* IS zero and *bulky* IS two (`data/_fields.js#itemBaseFields`), so
      // the word sits on the number and teaches the rule where the choice is made. A document
      // that arrives above the run appends its own button rather than being rounded down to the
      // nearest one.
      //
      // "Scrolls … are petty" (`srd-2e/players-guide/core-rules.md`), and
      // `GearData#prepareBaseData` enforces it on every save. So on a Scroll the other costs are
      // not choices at all and are drawn unavailable. Without that they took the click, wrote a
      // number the prepared data masked straight back to 0, and left the row snapping to Petty
      // with nothing in the console to explain it — and the masked number then reappeared the
      // moment the item stopped being a Scroll.
      const pettyByRule = item.system.magic === "scroll";
      const SLOT_WORDS = { 0: "CAIRN.Petty", 2: "CAIRN.Bulky" };
      const slots = item.system.slots;
      context.pettyByRule = pettyByRule;
      context.slotChoices = Array.fromRange(SLOT_BUTTONS + 1)
        .concat(slots > SLOT_BUTTONS ? [slots] : [])
        .map((value) => ({
          value,
          label: SLOT_WORDS[value] ? game.i18n.localize(SLOT_WORDS[value]) : String(value),
          disabled: pettyByRule && value !== 0
        }));
      // `none` is one of the field's own four choices; only its position moves.
      const magicKinds = Object.keys(schema.getField("magic").choices);
      context.magicChoices = [...magicKinds.filter((kind) => kind !== "none"), "none"];
      context.hint = MAGIC_HINT[item.system.magic] ?? "";

      // Which axis rows are drawn, and which the Add row still offers. An axis is drawn exactly
      // when it has a value, so clicking its None button — or typing a 0 into Capacity or Max
      // uses — puts the row straight back on the Add row rather than leaving a "none" to tidy.
      context.axes = {};
      context.addable = [];
      for (const axis of AXES) {
        const set = axis.set(item.system) || (axis.id === "grants" && this.#grantsOpen);
        context.axes[axis.id] = set;
        if (!set && (axis.offer?.(item.system) ?? true)) {
          context.addable.push({ id: axis.id, label: axis.label });
        }
      }
    }

    // A Background's tables and gear are stored as uuids and shown as names. A uuid that resolves
    // to nothing is reported rather than dropped: the row is how anyone finds out the document went.
    if (item.type === "background") {
      const resolve = (uuids) => Promise.all(
        (uuids ?? []).map(async (uuid) => {
          const doc = await fromUuid(uuid).catch(() => null);
          return { uuid, ok: !!doc, name: doc?.name ?? "" };
        })
      );
      context.tables = await resolve(item.system.tables);
      context.startingGear = await resolve(item.system.startingGear);
    }

    // What the item comes with, as rows: the document's own name and picture, and for an actor the
    // numbers the SRD prints beside a companion ("8 HP, 3 STR, 11 DEX, 13 WIL"), read off the
    // actor rather than written in the prose. A uuid that resolves to nothing keeps its row, as a
    // Background's does.
    if (item.system.grants) {
      context.grants = await Promise.all(item.system.grants.map(async (uuid) => {
        const doc = await fromUuid(uuid).catch(() => null);
        const row = { uuid, ok: !!doc, name: doc?.name ?? "", img: doc?.img ?? "" };
        if (doc?.documentName === "Actor" && doc.system.abilities) {
          const { hp, abilities } = doc.system;
          row.stats = game.i18n.localize("CAIRN.Grants.Stats", {
            hp: hp.max, str: abilities.STR.max, dex: abilities.DEX.max, wil: abilities.WIL.max
          });
        }
        return row;
      }));
    }

    // A container's contents are siblings in the actor's collection, resolved by the DataModel.
    if (item.system.isContainer) {
      context.contents = item.system.contents.map((held) => ({
        id: held.id,
        name: held.shownName,
        hidden: held.isHiddenFromMe,
        system: held.system
      }));
    }

    return context;
  }

  /**
   * The Warden reveals an unknown relic: the boolean goes, and a card tells the table what the
   * guise turned out to be, with the real description as its body. The card is posted before the
   * update so its caption can still name the guise the table knew it by.
   * @this {CairnItemSheet}
   */
  static async #onRevealRelic() {
    const item = this.item;
    if (!game.user.isGM || !item.system.unknown) return;
    const content = await foundry.applications.handlebars.renderTemplate(`systems/${SYSTEM_ID}/templates/chat/item-card.hbs`, {
      description: await enrich(item.system.description, item)
    });
    const flavor = game.i18n.localize("CAIRN.Relic.Revealed", {
      guise: foundry.utils.escapeHTML(item.tableName), name: foundry.utils.escapeHTML(item.name)
    });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: item.parent }), flavor, content });
    await item.update({ "system.unknown": false });
  }

  /* -------------------------------------------- */
  /*  The Add row                                 */
  /* -------------------------------------------- */

  /** Open one more axis, on its first value (`AXES#open`). The row IS the value, so there is
   *  nothing left to save afterwards and nothing to remember that the document cannot answer. */
  static async #onAxisAdd(event, target) {
    const axis = AXES.find((a) => a.id === target.dataset.axis);
    if (!axis) return;
    if (!axis.open) {
      this.#grantsOpen = true;
      return this.render({ parts: ["details"] });
    }
    await this.document.update(axis.open);
  }

  /** The Grants row was opened from the Add row and has nothing in it yet (`AXES`). */
  #grantsOpen = false;

  /* -------------------------------------------- */
  /*  Grants                                      */
  /* -------------------------------------------- */

  /**
   * A document dropped on the Grants zone. Anyone who may edit the item may link to it, and what
   * is linked is the uuid: the actor or gear itself is never copied onto the item.
   * @param {Document} document
   * @returns {Promise<Document|null>}
   */
  async #onDropGrant(document) {
    if (!this.isEditable) return null;
    if (!grantable(document) || document.uuid === this.document.uuid) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Grants.Refused"));
      return null;
    }
    const list = this.document.system.grants;
    // Listed once: a second drop of the same one is a slip, not a second companion.
    if (list.includes(document.uuid)) return null;
    await this.document.update({ "system.grants": [...list, document.uuid] });
    return document;
  }

  /** Open what the row names. */
  static async #onGrantOpen(event, target) {
    const doc = await fromUuid(target.closest("[data-grant-uuid]")?.dataset.grantUuid).catch(() => null);
    doc?.sheet.render({ force: true });
  }

  static async #onGrantRemove(event, target) {
    await CairnItemSheet.#removeAt(this.document, "system.grants", CairnItemSheet.#rowIndex(target));
  }

  /* -------------------------------------------- */
  /*  Container contents                          */
  /* -------------------------------------------- */

  /**
   * Hook ids registered while a container sheet is open, so the contents list follows the actor's
   * collection. The sheet's own document does not change when a sibling moves in or out — the
   * pointer is on the sibling — so nothing else would redraw this tab.
   * @type {Array<[string, number]>}
   */
  #itemHooks = [];

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // A gear with no parent Actor holds nothing and nothing can reach it, so there is nothing
    // for a hook to watch. Any gear with one is watched, not only a container: the capacity is
    // a field on this sheet, so a sword can become a bag while the window is open.
    const actor = this.document.parent;
    if (this.document.type !== "gear" || !actor) return;
    const refresh = (item) => {
      if (item.parent?.id === actor.id && this.document.system.isContainer) this.render({ parts: ["contents"] });
    };
    for (const hook of ["createItem", "updateItem", "deleteItem"]) {
      this.#itemHooks.push([hook, Hooks.on(hook, refresh)]);
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#grantsOpen = false;
    for (const [hook, id] of this.#itemHooks) Hooks.off(hook, id);
    this.#itemHooks = [];
  }

  /**
   * @override — a row in a container's Contents is a sibling Item, so it is what the drag carries.
   *
   * Core's own item-sheet handler knows only how to drag an ActiveEffect off a sheet
   * (`sheets/item-sheet.mjs`), so without this the row starts a drag with an empty `dataTransfer`
   * and every drop target refuses it in silence — which is what a row does when nothing has told
   * `DragDrop` about it at all.
   */
  async _onDragStart(event) {
    // A Grants row carries the document it names, so it lands on a character sheet or a scene as
    // if it had been dragged out of its own compendium. Built from the uuid alone: `dataTransfer`
    // takes data only while `dragstart` is being dispatched, so nothing here may wait on a lookup.
    // An Actor also names the item it came from, which is what lets a player put it on the scene
    // through the Warden (`module/grants.js`).
    const grant = event.currentTarget.dataset.grantUuid;
    if (grant) {
      const type = foundry.utils.parseUuid(grant)?.type;
      if (!type) return;
      const data = { type, uuid: grant };
      if (type === "Actor") data[SYSTEM_ID] = { [GRANT_DRAG_KEY]: this.document.uuid };
      event.dataTransfer.setData("text/plain", JSON.stringify(data));
      return;
    }
    const id = event.currentTarget.dataset.itemId;
    const held = id ? this.document.parent?.items.get(id) : null;
    if (!held) return super._onDragStart(event);
    event.dataTransfer.setData("text/plain", JSON.stringify(held.toDragData()));
  }

  /**
   * @override — an Item dropped on a container sheet goes into the container.
   *
   * The pointer lives on the child, so "put this in the Backpack" is one update of the dropped
   * item. A container with no parent Actor can hold nothing: its contents would have to be
   * siblings in a collection it does not have.
   */
  async _onDropDocument(event, document) {
    if (event.target.closest?.(".cairn-grants-drop")) return this.#onDropGrant(document);
    if (this.document.type === "background") return this.#onDropBackground(document);
    if (document?.documentName !== "Item" || !this.document.system.isContainer) {
      return super._onDropDocument(event, document);
    }
    if (!this.isEditable || !this.document.isOwner) return null;

    const actor = this.document.parent;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.ContainerNeedsOwner"));
      return null;
    }
    // Nothing goes inside itself; one level of nesting is the document's rule to refuse
    // (`documents/item.js#nestingRefusal`), and it warns.
    if (document.id === this.document.id) return null;
    // A Fatigue has no pointer to write, so core would strip it before the document could refuse:
    // the move would do nothing and the copy would land on the body. Asked here instead.
    const refusal = nestingRefusal(actor, document, this.document.id);
    if (refusal) {
      ui.notifications.warn(game.i18n.localize(refusal, { name: document.name }));
      return null;
    }

    // Already this actor's: move it. From anywhere else: copy it in, and let the document's
    // capacity check refuse it if the container is full.
    if (document.parent?.id === actor.id) {
      await document.update({ "system.container": this.document.id });
      return document;
    }
    const data = foundry.utils.mergeObject(document.toObject(), {
      "system.container": this.document.id
    });
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    return created ?? null;
  }

  /** Take one item out of the container and back onto the body — where the ten apply again. A
   *  sack of coin asks how much comes out, as it asked how much went in (`actor-sheet.js#_onDropItem`). */
  static async #onContentRemove(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const held = this.document.parent?.items.get(id);
    if (!held) return;
    if (held.type === "coin") {
      const amount = await promptCoinAmount(held.system.value);
      if (amount) await moveCoin(held, amount, "");
      return;
    }
    await held.update({ "system.container": "" });
  }

  /* -------------------------------------------- */
  /*  Background lists                            */
  /* -------------------------------------------- */

  /**
   * A document dropped on a Background sheet. Its type says which list it joins: a RollTable is
   * one of the two d6 tables, an Item is starting gear. Nothing else is taken, so dropping an
   * Actor or a Journal here does nothing rather than something surprising.
   * @param {Document} document
   * @returns {Promise<Document|null>}
   */
  async #onDropBackground(document) {
    if (!this.isEditable) return null;
    let path;
    if (document?.documentName === "RollTable") path = "system.tables";
    // A background is not gear, and a background cannot hand out another one.
    else if (document?.documentName === "Item" && document.type !== "background") path = "system.startingGear";
    else return null;

    const list = foundry.utils.getProperty(this.document, path) ?? [];
    // A document is listed once: a second drop of the same one is a slip, not a second copy.
    if (list.includes(document.uuid)) return null;
    await this.document.update({ [path]: [...list, document.uuid] });
    return document;
  }

  /** Append an empty name row. It is blank on purpose — the row IS the prompt to type one. */
  static async #onNameAdd() {
    await this.document.update({ "system.names": [...this.document.system.names, ""] });
  }

  /** The index of the row a list control was clicked on. */
  static #rowIndex(target) {
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
  static async #removeAt(item, path, index) {
    const list = [...(foundry.utils.getProperty(item, path) ?? [])];
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    await item.update({ [path]: list });
  }

  static async #onNameRemove(event, target) {
    await CairnItemSheet.#removeAt(this.document, "system.names", CairnItemSheet.#rowIndex(target));
  }

  static async #onTableRemove(event, target) {
    await CairnItemSheet.#removeAt(this.document, "system.tables", CairnItemSheet.#rowIndex(target));
  }

  static async #onGearRemove(event, target) {
    await CairnItemSheet.#removeAt(this.document, "system.startingGear", CairnItemSheet.#rowIndex(target));
  }

  /** Append an empty, unticked milestone. Blank on purpose — the row IS the prompt to type one. */
  static async #onMilestoneAdd() {
    const list = [...this.document.system.milestones, { text: "", done: false }];
    await this.document.update({ "system.milestones": list });
  }

  static async #onMilestoneRemove(event, target) {
    await CairnItemSheet.#removeAt(this.document, "system.milestones", CairnItemSheet.#rowIndex(target));
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);

    // A gear's tab set follows its fields (`#tabIds`), and core only ever appends a part that is
    // new to a render and leaves one that is gone in place (`api/handlebars-application.mjs`,
    // "Append or replace"): a capacity set back to 0 would otherwise leave a Contents section in
    // the DOM with no tab pointing at it. Pruned here, where the current set is known.
    const ids = this.#tabIds;
    for (const part of this.element.querySelectorAll("[data-application-part]")) {
      const id = part.dataset.applicationPart;
      if (OPTIONAL_PARTS.includes(id) && !ids.includes(id)) part.remove();
    }
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

    // The Grants zone says it will take the drop while one is over it. `:hover` does not follow a
    // drag in Chromium, so the state is a class; `dragleave` fires when the pointer crosses into
    // a child too, hence the `relatedTarget` test.
    for (const zone of htmlElement.querySelectorAll(".cairn-grants-drop")) {
      const over = (on) => zone.classList.toggle("dragover", on);
      zone.addEventListener("dragover", () => over(true));
      zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget)) over(false); });
      zone.addEventListener("drop", () => over(false));
    }
  }
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { moveCoin, promptCoinAmount } from "../coin.js";
import { takeItem } from "../transfer.js";
import { nestingRefusal } from "../data/_derived.js";
import { enrich } from "../helpers.js";
import { CairnItemSheet } from "./item-sheet.js";
import { bindGrantZones, dropGrant, grantDrag, grantRows, onGrantOpen, onGrantRemove } from "./_item-grants.js";

const TEMPLATES = `systems/${SYSTEM_ID}/templates/item`;

/** The largest slot cost the buttons run to, so the row is one contiguous scale. It is the ten
 *  inventory slots: nothing heavier can be carried at all, and an item that grows — Bond 15's
 *  Stone Heart gains a slot a month — reaches any weight a character could still hold with a
 *  click. A document above even that still appends its own button. */
const SLOT_BUTTONS = 10;

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

/** A gear's caption follows its magic kind: what using it costs is the one line worth a caption;
 *  the die and the armour are rows. */
const MAGIC_HINT = {
  spellbook: "CAIRN.SpellbookHint",
  scroll: "CAIRN.ScrollHint",
  relic: "CAIRN.RelicHint"
};

/**
 * The sheet of a gear: the one kind of item with behaviours of its own — the axes and the slot
 * run on its Details tab, the Warden's eye and the guise it brings, a relic's Recharge, a
 * container's contents, and what it grants.
 */
export class CairnGearSheet extends CairnItemSheet {
  static DEFAULT_OPTIONS = {
    // A gear's Details is up to seven ruled rows in the common cases (a weapon, a container: the
    // axis, its rider, the three every gear has and the Add row). A gear that has every axis set
    // stands nine rows and scrolls; that is the rare thing, and the window is resizable.
    position: { height: 480 },
    actions: {
      axisAdd: CairnGearSheet.#onAxisAdd,
      contentRemove: CairnGearSheet.#onContentRemove,
      toggleUnknown: CairnGearSheet.#onToggleUnknown,
      // The growth sheet maps the same two, and core calls each with the sheet as `this`.
      grantOpen: onGrantOpen,
      grantRemove: onGrantRemove
    }
  };

  // Core does not merge `PARTS` from a parent the way it merges `DEFAULT_OPTIONS`, so the base's
  // four are spread in first.
  static PARTS = {
    ...super.PARTS,
    recharge: { template: `${TEMPLATES}/tab-recharge.hbs`, scrollable: [""] },
    contents: { template: `${TEMPLATES}/tab-contents.hbs`, scrollable: [""] },
    guise: { template: `${TEMPLATES}/tab-guise.hbs`, scrollable: [""] }
  };

  static EDITOR_FIELDS = { ...super.EDITOR_FIELDS, "system.recharge": "recharge", "system.guiseDescription": "guise" };

  static TABS = {
    primary: {
      ...super.TABS.primary,
      tabs: [
        ...super.TABS.primary.tabs,
        { id: "recharge", label: "CAIRN.Recharge" },
        { id: "contents", label: "CAIRN.Contents" },
        { id: "guise", label: "CAIRN.Unknown.Tab" }
      ]
    }
  };

  /** A hide asked for the Guise tab it brings, to be opened once the render has drawn it. */
  #openGuise = false;

  /**
   * @override — a gear unknown to this user is read, never written: its sheet holds the guise,
   * and a field left editable would be a field that writes the real data behind it. The
   * document's own guard refuses the write as well (`documents/item.js#_preUpdate`).
   */
  get isEditable() {
    return super.isEditable && !this.item.isHiddenFromMe;
  }

  /** @override — the title bar names the guise to a user the gear is hidden from. */
  get title() {
    return this.item.isHiddenFromMe ? this.item.shownName : super.title;
  }

  /**
   * @override — the Warden's eye on a gear's title bar: hide it from its holder, or reveal it.
   * A frame button rather than an entry in the ⋮ menu because it is a state to read at a glance,
   * not only a command. Core draws the frame once (`api/application.mjs#_renderFrame`), so the
   * icon is brought up to date on every render by `#syncUnknownButton`.
   */
  _getFrameButtons(options) {
    const buttons = super._getFrameButtons(options);
    if (game.user.isGM && this.isEditable) {
      buttons.unshift({ action: "toggleUnknown", ...this.#unknownButton() });
    }
    return buttons;
  }

  /** The eye's icon and label for the gear's current state. */
  #unknownButton() {
    const unknown = this.item.system.unknown;
    return {
      icon: unknown ? "fa-solid fa-eye" : "fa-solid fa-eye-slash",
      label: unknown ? "CAIRN.Unknown.Reveal" : "CAIRN.Unknown.Hide"
    };
  }

  /** Repaint the frame's eye: the frame outlives the render that drew it. */
  #syncUnknownButton() {
    const button = this.window.header?.querySelector('[data-action="toggleUnknown"]');
    if (!button) return;
    const { icon, label } = this.#unknownButton();
    button.classList.remove("fa-eye", "fa-eye-slash");
    button.classList.add(...icon.split(" "));
    button.setAttribute("aria-label", game.i18n.localize(label));
  }

  /** @override — a gear's tabs follow its fields. */
  get tabIds() {
    const sys = this.document.system;
    return [
      "details",
      "description",
      // A hidden relic's Recharge is part of what it hides.
      ...(sys.magic === "relic" && !this.item.isHiddenFromMe ? ["recharge"] : []),
      ...(sys.isContainer ? ["contents"] : []),
      // The Warden's own tab, while the holder does not know what this is: what they see instead.
      ...(sys.unknown && game.user.isGM ? ["guise"] : [])
    ];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    if (item.system.magic === "relic" && !context.hidden) context.rechargeHTML = await enrich(item.system.recharge, item);
    // The Warden's Guise tab, while the holder does not know what this is.
    if (game.user.isGM && item.system.unknown) {
      context.guiseHTML = await enrich(item.system.guiseDescription, item);
    }

    // The three selectors' buttons, read off the field's own `choices` / bounds so the row of
    // buttons and what a save will accept cannot drift apart (`module/data/item-gear.js`).
    //
    // The clearing option goes LAST in each run. Once an axis is only ever added with a value
    // (`AXES#open`), its blank is not one answer among several — it is the control that takes the
    // row away again, and it wears the word for it. A leading `—` or `0` reads as a value in a
    // list of values, which is what put the remove control first and unlabelled.
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
    // Not to a viewer the scroll is hidden from: the row's tooltip would name what it is, and
    // their sheet is read-only, so there is no click left to refuse.
    const pettyByRule = item.system.magic === "scroll" && !context.hidden;
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
    // The caption names the magic kind, which is part of what a guise hides.
    context.hint = context.hidden ? "" : MAGIC_HINT[item.system.magic] ?? "";

    // Which axis rows are drawn, and which the Add row still offers. An axis is drawn exactly
    // when it has a value, so clicking its None button — or typing a 0 into Capacity or Max
    // uses — puts the row straight back on the Add row rather than leaving a "none" to tidy.
    context.axes = {};
    context.addable = [];
    const offer = this.isEditable;
    for (const axis of AXES) {
      const set = axis.set(item.system) || (axis.id === "grants" && this.#grantsOpen);
      context.axes[axis.id] = set;
      if (offer && !set && (axis.offer?.(item.system) ?? true)) {
        context.addable.push({ id: axis.id, label: axis.label });
      }
    }

    context.grants = await grantRows(item);

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
   * The Warden's eye. Hiding sets the one boolean and opens the Guise tab it brings, to be filled
   * in. Revealing clears it, and a card tells the table what the guise turned out to be, with the
   * real description as its body. The card is posted before the update so its caption can still
   * name the guise the table knew it by.
   * @this {CairnGearSheet}
   */
  static async #onToggleUnknown() {
    const item = this.item;
    if (!game.user.isGM) return;
    if (!item.system.unknown) {
      this.#openGuise = true;
      await item.update({ "system.unknown": true });
      return;
    }
    const flavor = game.i18n.localize("CAIRN.Unknown.Revealed", {
      guise: foundry.utils.escapeHTML(item.tableName), name: foundry.utils.escapeHTML(item.name)
    });
    await item.postCard({ text: item.system.description, flavor });
    await item.update({ "system.unknown": false });
  }

  /* -------------------------------------------- */
  /*  The Add row                                 */
  /* -------------------------------------------- */

  /** Open one more axis, on its first value (`AXES#open`). The row IS the value, so there is
   *  nothing left to save afterwards and nothing to remember that the document cannot answer. */
  static async #onAxisAdd(event, target) {
    // A sheet its viewer cannot edit draws none of these controls; a stale element still
    // reaches the handler, so each list and axis write refuses here too.
    if (!this.isEditable) return;
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
    if (!actor) return;
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
   * A Grants row carries the document it names (`_item-grants.js#grantDrag`).
   *
   * Core's own item-sheet handler knows only how to drag an ActiveEffect off a sheet
   * (`sheets/item-sheet.mjs`), so without this the row starts a drag with an empty `dataTransfer`
   * and every drop target refuses it in silence — which is what a row does when nothing has told
   * `DragDrop` about it at all.
   */
  async _onDragStart(event) {
    if (grantDrag(this, event)) return;
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
    if (event.target.closest?.(".cairn-grants-drop")) return dropGrant(this, document);
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

    // Already this actor's: stow it. From anywhere else it is the character sheet's drop, landing
    // in here instead of on the body — off another actor a move, from a pack or the sidebar a
    // copy (`transfer.js#takeItem`); the document's capacity check refuses it if this is full.
    if (document.parent?.uuid === actor.uuid) {
      await document.update({ "system.container": this.document.id });
      return document;
    }
    await takeItem(actor, document, this.document.id);
    return null;
  }

  /** Take one item out of the container and back onto the body — where the ten apply again. A
   *  sack of coin asks how much comes out, as it asked how much went in (`actor-sheet.js#_onDropItem`). */
  static async #onContentRemove(event, target) {
    if (!this.isEditable) return;
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

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // The Guise tab a hide brought, opened once this render has drawn it. `changeTab` for the
    // reason the base gives for the vanished tab.
    if (this.#openGuise && this.tabIds.includes("guise")) {
      this.changeTab("guise", "primary", { force: true });
      this.#openGuise = false;
    }
    this.#syncUnknownButton();
    this.#syncGuiseFields();
  }

  /**
   * Repaint the Guise tab's name and picture. The tab is one part with the guise's editor, so a
   * document update leaves it out (`_configureRenderOptions`) and the two would otherwise keep
   * their old values — a guise named by code, or by a second Warden with the same sheet open.
   * By hand rather than by rebuilding the part, which would rebuild the editor and drop any text
   * typed in it and not yet saved. A name field being typed in is left to its typist.
   */
  #syncGuiseFields() {
    const part = this.element.querySelector('[data-application-part="guise"]');
    if (!part) return;
    const name = part.querySelector('input[name="system.guiseName"]');
    if (name && (name !== document.activeElement)) name.value = this.item.system.guiseName;
    const img = part.querySelector("img.cairn-guise-img");
    if (img) img.src = this.item.system.guiseImg;
  }

  /** @override */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    bindGrantZones(htmlElement);
  }
}

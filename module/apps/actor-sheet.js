/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { rollDamage, rollSave } from "../rolls.js";
import { slotsForItem, layoutSlots } from "../data/_derived.js";
import { adjustGold, moveCoin, promptCoinAmount } from "../coin.js";
import { enrich } from "../helpers.js";
import { lightSpell } from "../light-sources.js";
import { bundleItems } from "../transfer-rules.js";
import { receiveItems } from "../transfer.js";
import { CairnSheetMixin } from "./_sheet-mixin.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { createItemFromPrompt } from "./_item-prompt.js";
import { bindSteppers, stepStat, flushSteps, fieldNumber, fitToText } from "./_steppers.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const TEMPLATES = `systems/${SYSTEM_ID}/templates`;

/**
 * An item's name as a chat message's caption. The message template draws `flavor` raw — exactly as
 * core's own does — and a player names their own items, so it is escaped here.
 */
function postedName(item) {
  return foundry.utils.escapeHTML(item.name);
}

/**
 * Shared behaviour for the three Cairn actor sheets. Not registered directly.
 *
 * Upstream shipped one 695-line `CairnActorSheet` that switched template on `actor.type`; the
 * two actor types share almost nothing, so this base holds only the genuinely common inventory
 * actions and each concrete class (`CairnCharacterSheet`, `CairnNpcSheet`) adds the rest.
 */
export class CairnActorSheet extends CairnInkMixin(CairnSheetMixin(HandlebarsApplicationMixin(ActorSheetV2))) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor"],
    position: { width: 600, height: 750 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      itemCreate: CairnActorSheet.#onItemCreate,
      itemEdit: CairnActorSheet.#onItemEdit,
      itemDelete: CairnActorSheet.#onItemDelete,
      itemEquipToggle: CairnActorSheet.#onItemEquipToggle,
      itemUseIncrement: CairnActorSheet.#onItemUseIncrement,
      itemUseDecrement: CairnActorSheet.#onItemUseDecrement,
      itemPost: CairnActorSheet.#onItemPost,
      itemConsume: CairnActorSheet.#onItemConsume,
      spellCast: CairnActorSheet.#onSpellCast,
      setAsideToggle: CairnActorSheet.#onSetAsideToggle,
      rollDamage: CairnActorSheet.#onRollDamage,
      rollSave: CairnActorSheet.#onRollSave,
      openEdit: CairnActorSheet.#onOpenEdit,
      statStep: CairnActorSheet.#onStatStep
    }
    // No `dragDrop` option: v14 core reads none. Both `ActorSheetV2` and `ItemSheetV2` build their
    // own `DragDrop` with `dragSelector: ".draggable"` hard-coded and bind it to the whole sheet
    // in `_onRender`, so a row opts in by carrying that class and the drop target is the window.
  };

  /* -------------------------------------------- */
  /*  Render scope                               */
  /* -------------------------------------------- */

  /**
   * The edit window behind the quill — each concrete sheet names its own (`CairnCharacterEdit`,
   * `CairnNpcEdit`) and the i18n key its frame button carries.
   * @type {typeof foundry.applications.api.DocumentSheetV2|null}
   */
  static EDIT_APP = null;
  static EDIT_LABEL = "";

  /**
   * The edit window, held open at one instance per sheet so the quill re-focuses the window that
   * is already up rather than stacking a second copy of the same form over it.
   * @type {foundry.applications.api.DocumentSheetV2|null}
   */
  #editor = null;

  /**
   * Document paths whose only display on this sheet is inside a ProseMirror editor. The editor
   * already shows the value the user just saved, so an update that touches nothing else must not
   * rebuild the sheet around it. Each concrete sheet lists its own.
   * @type {string[]}
   */
  static EDITOR_FIELDS = [];

  /**
   * Which parts a document change actually invalidates.
   *
   * `renderContext` is `"{operation}{collection}"` for an embedded change and
   * `"{operation}{DocumentName}"` for the Actor's own — and the embedded half is the *collection*
   * name, lower-case and plural: core's own `scene-config.mjs:128` matches
   * `["createlevels", "updatelevels", "deletelevels"]`. So an Item change arrives as
   * `"updateitems"`, not `"updateItem"`.
   *
   * Returning `null` means "the default set", which is everything except the editor-only tabs:
   * rebuilding a ProseMirror instance costs the user its scroll position and any selection, and
   * its content cannot have changed except through its own field, which `_canRender` filters out.
   * @param {string} [renderContext]
   * @returns {string[]|null}
   */
  partsForRenderContext(renderContext) {
    const subject = String(renderContext ?? "").replace(/^(create|update|delete)/, "").toLowerCase();
    // `growth` is in the list because a Scar and a Growth are both Items: taking one, rolling
    // the gain it owed, or writing a new growth is an Item create or update, and a tab left
    // out of this list simply never redraws.
    if (subject === "items") return ["header", "items", "petty", "belongings", "growth"];
    return null;
  }

  /** Parts never rendered by a document change unless the change is their own field. */
  #editorParts() {
    return ["description"];
  }

  /** @override — narrow the set of parts a document change rebuilds. */
  _configureRenderOptions(options) {
    // A caller that asked for specific parts means it; only an unqualified render is narrowed.
    const explicit = Array.isArray(options.parts);
    super._configureRenderOptions(options);
    if (explicit || options.isFirstRender || !options.renderContext) return;

    const available = new Set(options.parts);
    const wanted = this.partsForRenderContext(options.renderContext)
      ?? options.parts.filter((id) => !this.#editorParts().includes(id));
    options.parts = wanted.filter((id) => available.has(id));
  }

  /** @override — skip a render that cannot change anything the sheet draws. Same shape as core's
   *  own `DocumentDirectory#_canRender` (`sidebar/document-directory.mjs:188`). */
  _canRender(options) {
    const { renderContext, renderData } = options;
    if (renderContext === `update${this.document.documentName}` && renderData) {
      const editorFields = this.constructor.EDITOR_FIELDS;
      const touched = Object.keys(foundry.utils.flattenObject(renderData))
        .filter((k) => !k.startsWith("_") && !editorFields.includes(k));
      if (!touched.length) return false;
    }
    return super._canRender(options);
  }

  /* -------------------------------------------- */
  /*  Part listeners                              */
  /* -------------------------------------------- */

  /**
   * @override — each query is scoped to the part just rendered, so a part that survives a
   * partial render keeps exactly the listeners it was born with.
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    // The Gold chip shows a DERIVED total — the sum of the character's coin sacks
    // (`data/item-coin.js`) — so it has no `name` and the form never submits it. What is typed is
    // read as a difference and moved as coin (`coin.js#adjustGold`): a smaller number spends from
    // the nearest sack, a larger one lands on the body or asks which container. When the move is
    // refused or cancelled the field is put back to what the character has, because a chip
    // showing a purse nobody holds is the bug the old clamp existed to prevent.
    for (const field of htmlElement.querySelectorAll("input.cairn-gold-input")) {
      field.addEventListener("change", async () => {
        const delta = fieldNumber(field) - this.actor.system.gold;
        const moved = delta !== 0 && await adjustGold(this.actor, delta);
        if (!moved) {
          field.value = String(this.actor.system.gold);
          fitToText(field);
        }
      });
    }

    // Gold is a text field so `maxlength` applies; keep it to digits as it is typed. Without this
    // a stray letter reaches the DataModel and the submit fails with "must be a number" — a
    // validation error is the wrong way to tell someone they mistyped. It is sized to exactly its
    // digits, so the chip keeps its shape whether the field is being typed into or not.
    for (const field of htmlElement.querySelectorAll("input.cairn-digits")) {
      const max = Number(field.getAttribute("maxlength")) || 3;
      const fit = () => fitToText(field);
      field.addEventListener("input", () => {
        const digits = field.value.replace(/\D+/g, "").slice(0, max);
        if (field.value !== digits) field.value = digits;
        fit();
      });
      fit();
      // Again once Lora has landed. The first render measures against the fallback face, whose
      // digits are narrower — a three-digit purse came out sized for two and the last one was
      // clipped off inside the box. Same reason `scheduleInk` waits on the same promise.
      document.fonts?.ready?.then(fit);
    }

    // Right-click on the portrait opens it in core's `ImagePopout`, the window whose header
    // carries "Show to Players" — the same one core's own `showPortraitArtwork` header control
    // opens (`sheets/actor-sheet.mjs:172`). A left-click keeps core's `editImage`. The party
    // sheet is left out: its picture is a banner for a group, not a face to show the table.
    if (this.actor.type !== "party") {
      for (const img of htmlElement.querySelectorAll("img.portrait")) {
        img.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const { img: src, name, uuid } = this.actor;
          new foundry.applications.apps.ImagePopout({ src, uuid, window: { title: name } })
            .render({ force: true });
        });
      }
    }

    // A roll link is focusable (`tabindex="0"` in the template) so the keyboard can reach it,
    // and Enter or Space rolls it — an `<a>` without `href` fires no click on its own.
    for (const link of htmlElement.querySelectorAll('.cairn-cap.is-rollable a[data-action="rollSave"]')) {
      link.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        link.click();
      });
    }

    // The steppers: limits read off the printed numbers, a pending value put back, hold-to-repeat.
    bindSteppers(this, htmlElement);
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;
    context.system = this.actor.system;
    context.editable = this.isEditable;
    context.inventory = await this.prepareItems();
    // `context.tabs` is not set here: ApplicationV2#_prepareContext prepares it automatically for
    // an application with exactly one tab group (api/application.mjs:690).
    return context;
  }

  /**
   * The inventory as the printed sheet draws it: `slotsMax` numbered lines, not a list of the
   * items that happen to exist. This is what removes the dead space — an empty slot is a ruled
   * line, which is information, rather than a blank rectangle.
   *
   * Occupancy comes straight from `slotsForItem` (`module/data/_derived.js`), the same function
   * the encumbrance rule uses, so the sheet cannot disagree with the rule: *petty* is 0 and lands
   * in its own block below the ten, *bulky* is 2, and a Fatigue is always exactly 1. A row past the first that one item occupies is a continuation, not a repeat.
   *
   * Two kinds of item are not in the ledger at all: anything set aside — a sword on the dungeon
   * floor, a mule, a cart at camp (`slotsForItem`) — and anything stowed inside a container,
   * which is a sibling in the same collection and tells itself apart only by `system.container`.
   * Neither is on the ten: a set-aside thing is a Belonging, and a stowed one belongs to the
   * container that holds it. Filtering by `type` cannot do this — a sword in
   * the mule is `gear` exactly like the one on the belt.
   *
   * `carried` is the fourth view of the same items, for a sheet that draws no ledger at all: one
   * flat list, zero-slot items included, containers and their contents included too — on an NPC
   * a container someone dropped on a hireling is one more row, not a hidden one. An NPC is bound
   * by no slot rule, so nothing it owns is ever set aside out of that list.
   *
   * @returns {Promise<{rows: object[], petty: object[], carried: object[], belongings: object[]}>}
   */
  async prepareItems() {
    const items = this.actor.items.contents.slice().sort((a, b) => {
      const af = a.type === "fatigue";
      const bf = b.type === "fatigue";
      if (af !== bf) return af ? 1 : -1;
      if (!!a.system.equipped !== !!b.system.equipped) return a.system.equipped ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const units = [];
    const petty = [];
    // A sheet with no ten-slot ledger draws this instead: every carried item in one list, zero-slot
    // ones included. An NPC is bound by no slot rule — `CairnItem._preCreateOperation` refuses
    // nothing on one — so nothing it owns may be filtered out of its own sheet.
    const carried = [];
    // Belongings: everything the character has written down that is not under direct possession —
    // a sword left on the dungeon floor, a crest at the inn, and every mule and cart, which are
    // never direct possession at all (`data/item-gear.js#prepareBaseData`). One question, one
    // list: a row is here exactly when it is not in the ten and not in a pocket.
    const belongings = [];
    for (const item of items) {
      // The Background is drawn in the header, not carried, a feature is a rule the actor has, a
      // scar is something that happened to them and a growth is what they became. Each occupies
      // no slot, which would otherwise drop it into the *petty* bucket and list it as a thing in
      // a pocket.
      if (item.type === "background" || item.type === "feature" || item.type === "scar"
          || item.type === "growth") continue;
      const view = await this.#itemView(item);
      carried.push(view);
      // Stowed: it is the container's, and the container's own sheet says what is in it.
      if (item.system.container) continue;
      if (item.system.carried === false) {
        belongings.push(view);
        continue;
      }
      const count = slotsForItem(item);
      if (count === 0) {
        petty.push(view);
        continue;
      }
      units.push({ payload: { item: view }, slots: count });
    }

    return { rows: layoutSlots(units, this.actor.system.slotsMax ?? 0), petty, carried, belongings };
  }

  /** The per-item display model one slot row renders. */
  async #itemView(item) {
    const uses = item.system.uses ?? { value: 0, max: 0 };
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      img: item.img,
      system: item.system,
      isFatigue: item.type === "fatigue",
      isUsedUp: uses.max > 0 && uses.value <= 0,
      showUses: uses.max > 0,
      // "They disappear after one use" (`srd-2e/players-guide/core-rules.md` → Scrolls). A scroll
      // is the one carried thing whose use is its end, so it is the one kind that carries this
      // control — gear spends charges and stays, a relic recharges.
      canConsume: item.system.magic === "scroll",
      // "Anyone can cast a spell by holding a Spellbook in both hands and reading its contents
      // aloud" (`srd-2e/players-guide/core-rules.md` → Casting Spells). Held is equipped; a
      // stowed book is not equipable at all (`documents/item.js`).
      canCast: item.system.magic === "spellbook" && !!item.system.equipped,
      usesDisplay: Array.from({ length: uses.max }, (_, i) => i < uses.value),
      // Whether the scroll control has anything to post. Tags are stripped before the test
      // because an item whose description was written and then cleared in ProseMirror stores
      // `<p></p>`, which is truthy and would leave an enabled control that posts a blank card.
      hasDescription: !!String(item.system.description ?? "").replace(/<[^>]*>/g, "").trim()
    };
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /** The Item document a control row refers to. */
  #rowItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  /* -------------------------------------------- */
  /*  Inventory actions                           */
  /* -------------------------------------------- */

  /** The inventory's add control: the shared prompt, asking whether the new thing is *petty*. */
  static async #onItemCreate() {
    await createItemFromPrompt(this.actor, { petty: false, askPetty: true });
  }

  static #onItemEdit(event, target) {
    const item = this.#rowItem(target);
    item?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    return this.actor.deleteOwnedItem(target.closest("[data-item-id]").dataset.itemId);
  }

  static async #onItemEquipToggle(event, target) {
    const item = this.#rowItem(target);
    if (item) await item.update({ "system.equipped": !item.system.equipped });
  }

  /**
   * Set aside, or taken back — whether the thing is under direct possession. Set aside it leaves
   * the ten at once (`_derived.js#slotsForItem`) and drops out of the character's hands
   * (`documents/item.js#_preUpdate`); taken back it needs the room, which the document refuses
   * when the ten are full, and says so.
   */
  static async #onSetAsideToggle(event, target) {
    const item = this.#rowItem(target);
    if (item?.system.isStashable) await item.update({ "system.carried": !item.system.carried });
  }

  // A consumable's charges — what a Torch or a relic has left. Upstream called these "quantity",
  // which is what the field they belong to is not: nothing in this system counts copies.
  static async #onItemUseIncrement(event, target) {
    const item = this.#rowItem(target);
    if (!item) return;
    await item.update({ "system.uses.value": Math.min(item.system.uses.value + 1, item.system.uses.max) });
  }

  // Spend a charge. The last one spent leaves the item at zero and on the sheet: a Torch that has
  // burned its three is still a Torch, and what a spent thing does next is the table's to say.
  static async #onItemUseDecrement(event, target) {
    const item = this.#rowItem(target);
    if (!item) return;
    await item.update({ "system.uses.value": Math.max(item.system.uses.value - 1, 0) });
  }

  /**
   * Post an item's name and description to chat.
   *
   * This is where the inventory row's inline description went. A `<details>` in the ledger moved
   * the ten numbered lines every time one opened, and showing the table what a thing does is what
   * the description was being opened for anyway. Enriched here rather than in `#itemView`: it is
   * wanted once, on a click, not for every row on every render.
   */
  static async #onItemPost(event, target) {
    const item = this.#rowItem(target);
    if (!item) return;
    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/chat/item-card.hbs`, {
      description: await enrich(item.system.description, this.actor)
    });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: postedName(item), content });
  }

  /**
   * Read a scroll aloud: its spell goes to chat and the scroll is gone.
   *
   * The confirmation is the same one a delete gets (`documents/actor.js#deleteOwnedItem`), and for
   * the same reason: this destroys a carried item and there is no undo. What goes to chat is the
   * description, because that is what is written on a scroll.
   */
  static async #onItemConsume(event, target) {
    const item = this.#rowItem(target);
    if (item?.system.magic !== "scroll") return;
    const proceed = await foundry.applications.api.DialogV2.confirm({
      classes: [SYSTEM_ID],
      // A name is the player's own text and DialogV2 parses `content` as HTML.
      content: `${game.i18n.localize("CAIRN.Notify.ConfirmConsume")} ${foundry.utils.escapeHTML(item.name)}?`,
      rejectClose: false,
      modal: true
    });
    if (!proceed) return;
    const written = item.system.description;
    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/chat/item-card.hbs`, {
      description: await enrich(written, this.actor)
    });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: postedName(item), content });
    await item.delete();
  }

  /**
   * Cast: the spell goes to chat, then a Fatigue goes on the ten (core-rules.md → Casting
   * Spells). The card is posted before the Fatigue and is not withdrawn when the Fatigue is
   * refused: a full inventory means "drop an item", which `warnNoRoom` already says, not "the
   * spell did not happen".
   */
  static async #onSpellCast(event, target) {
    const item = this.#rowItem(target);
    if (item?.system.magic !== "spellbook" || !item.system.equipped) return;
    // "If the PC is deprived or in danger … the Warden may require a PC to make a WIL save"
    // (core-rules.md → Casting Spells). Deprived is the one case the sheet can see; "in danger"
    // is the Warden's. May, not must: the save is offered, and the cast goes ahead whichever way
    // it falls — what a failure costs is the Warden's to say, not this handler's.
    if (this.actor.system.deprived) {
      const choice = await foundry.applications.api.DialogV2.wait({
        classes: [SYSTEM_ID],
        window: { title: game.i18n.localize("CAIRN.CastDeprivedTitle") },
        content: `<p>${game.i18n.localize("CAIRN.CastDeprivedHint")}</p>`,
        buttons: [
          { action: "save", label: "CAIRN.CastDeprivedSave", icon: "fa-solid fa-dice-d20", default: true },
          { action: "cast", label: "CAIRN.CastDeprivedSkip", icon: "fa-solid fa-wand-sparkles" }
        ],
        rejectClose: false,
        modal: true
      });
      if (choice === null) return;
      if (choice === "save") await rollSave(this.actor, "WIL");
    }
    const content = await foundry.applications.handlebars.renderTemplate(`${TEMPLATES}/chat/item-card.hbs`, {
      description: await enrich(item.system.description, this.actor),
      note: game.i18n.localize("CAIRN.CastFatigue")
    });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor: postedName(item), content });
    await this.actor.addFatigue();
    await lightSpell(this.actor, item);
  }

  /* -------------------------------------------- */
  /*  Rolls — building/posting lives in rolls.js  */
  /* -------------------------------------------- */

  static async #onRollDamage(event, target) {
    const item = this.#rowItem(target);
    if (!item?.system.damage) return;
    // Shift: the plain swing, no dialog — the common case should cost one click.
    await rollDamage(this.actor, item, { skipDialog: event.shiftKey });
  }

  static async #onRollSave(event, target) {
    await rollSave(this.actor, target.dataset.ability);
  }

  /**
   * @override — the quill that opens the edit window.
   *
   * A frame button and not a header control: it is reached for often enough that burying it in
   * the ellipsis menu would cost two clicks each way. Core inserts frame buttons immediately
   * before the close button (`api/application.mjs:881`), so it lands between the ellipsis and the
   * ✕ — core's frame-button slot is to the right of the ellipsis. The NPC sheet's Promote shows
   * how a button is put to the LEFT of it: built in `_renderFrame` and inserted before the
   * controls toggle, without reordering core's own header DOM.
   */
  _getFrameButtons(options) {
    const buttons = super._getFrameButtons(options);
    if (!this.isEditable || !this.constructor.EDIT_APP) return buttons;
    buttons.push({
      action: "openEdit",
      icon: "fa-solid fa-pen",
      label: this.constructor.EDIT_LABEL
    });
    return buttons;
  }

  /**
   * The quill in the window header: open the edit window.
   *
   * The character sheet used to swap its printed numbers for input boxes in place, and an input
   * is taller than the text it replaced — so the five stat blocks grew, everything below them
   * moved, and the number being aimed at was no longer where it had been. A sheet has no mode
   * now: it is the printed page, always the same shape, and the fields live in their own window.
   */
  static async #onOpenEdit() {
    this.#editor ??= new this.constructor.EDIT_APP({ document: this.actor });
    await this.#editor.render({ force: true });
  }

  /* -------------------------------------------- */
  /*  Steppers                                    */
  /* -------------------------------------------- */

  /** A tap on a stepper. A tap that ended a hold has already been counted by the repeat. */
  static #onStatStep(event, target) {
    if (target.dataset.held === "yes") {
      delete target.dataset.held;
      return;
    }
    stepStat(this, target);
  }

  /** @override — a stepper write still waiting when the sheet closes goes out now. */
  async _preClose(options) {
    await super._preClose(options);
    await flushSteps(this);
  }

  /* -------------------------------------------- */
  /*  Drag & drop                                 */
  /* -------------------------------------------- */

  /** @override — a drop from elsewhere creates a document here and deletes the one it came from. */
  async _onDropItem(event, item) {
    if (!this.isEditable) return;

    // Same actor: onto a container's row, stow it there — capacity, "not a container" and
    // one-level nesting are the document's to refuse (`documents/item.js#_preUpdate`), and it
    // warns; a refused update resolves to nothing and the row stays where it was.
    if (item.parent?.uuid === this.actor.uuid) {
      const row = this.actor.items.get(event.target.closest("[data-item-id]")?.dataset.itemId);
      // A sack of coin onto a container asks how much goes in — the one drop that can split what
      // it moves, because coin is the one thing a player halves. The rest of the sack stays; a
      // sack already in the container grows (`coin.js#moveCoin`).
      if (item.type === "coin" && row?.system.isContainer) {
        const amount = await promptCoinAmount(item.system.value);
        if (amount) await moveCoin(item, amount, row.id);
        return;
      }
      if (row?.system.isContainer && row.id !== item.id) return item.update({ "system.container": row.id });
      // Dragged out of a container and onto the body, where the ten apply again. Any drop that is
      // not onto a container row says "carry this yourself"; without it the drop read as a sort
      // and the thing stayed stowed, with nothing on screen to say why.
      if (item.system.container) return item.update({ "system.container": "" });
      // Anywhere else is a sort, which the ledger draws by equipped-then-name anyway.
      return super._onSortItem(event, item);
    }

    // Every drop is a document. 2e's inventory is a list of items and a second Rope is a second
    // line — there is no count for a match to raise, so nothing is looked up by name here.
    //
    // A container brings what is in it, a stowed thing arrives on the body, a sack joins the sack
    // already here, and nothing arrives in anybody's hand (`transfer-rules.js`). No capacity check
    // either: the document refuses a create that would not fit (`documents/item.js`), and says
    // so. What this has to know is what DID land, so a refused move never deletes the thing it
    // came from.
    //
    // A document straight out of a pack is stamped with its own uuid as `_stats.compendiumSource`,
    // as core's import does: it is how the copy is still recognised (a light source, say) once a
    // translation module has renamed it. A copy from a sidebar or another actor already carries
    // whatever source it had.
    const source = item.parent;
    const chosen = item.toObject();
    if (item.pack) chosen._stats = { ...chosen._stats, compendiumSource: item.uuid };
    const all = source ? source.items.map((i) => i.toObject()) : [chosen];
    const { landed } = await receiveItems(this.actor, bundleItems([chosen], all));
    if (!landed.length) return;

    // The source goes, when this user may take it: a copy from a sheet they cannot modify is a
    // copy, as core's own drop is, rather than a delete that rejects after the copy was made.
    // Never mutate its in-memory data directly — upstream did, so a rejected write left the
    // wrong value on screen.
    if (source && source.uuid !== this.actor.uuid && item.isOwner) {
      await source.deleteEmbeddedDocuments("Item", landed);
    }
  }
}

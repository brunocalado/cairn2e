/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, FLAGS } from "../constants.js";
import { regenerateActor, traitRows, toPlainText, toPlainLines } from "../character-generator.js";
import { rollDieOfFate } from "../rolls.js";
import { promptGrowthGain } from "../growth.js";
import { enrich, copyOf, abilityRows } from "../helpers.js";
import { outcomeText } from "../scars.js";
import { CairnActorSheet } from "./actor-sheet.js";
import { createItemFromPrompt } from "./_item-prompt.js";
import { CairnScars } from "./scars.js";
import { CairnCharacterEdit } from "./character-edit.js";
import { CairnCharacterCreator } from "./character-creator.js";
import { CairnActionsMenu } from "./actions-menu.js";

const { DialogV2 } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates`;

export class CairnCharacterSheet extends CairnActorSheet {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "character"],
    // A fixed page. The layout is a printed sheet with ten ruled slots and a drawn frame around
    // every block; there is no width at which it wants to reflow, and a dragged corner only ever
    // made the ink redraw into a shape nobody asked for.
    //
    // The HEIGHT is the content's. It was 620px, which is not a measurement of anything: the
    // inventory tab's ledger ends around 60px short of it, and the sheet closed on a strip of
    // bare paper under the last slot. With `auto` the window ends where the ledger does, and the
    // tabs that are shorter or taller than it size to themselves too — which is why the ink layer
    // watches the content box for a resize (`_ink-mixin.js`), rather than trusting that a render is
    // the only thing that can change its height.
    position: { width: 600, height: "auto" },
    window: { resizable: false },
    actions: {
      rest: CairnCharacterSheet.#onRest,
      restoreAbilities: CairnCharacterSheet.#onRestoreAbilities,
      dieOfFate: CairnCharacterSheet.#onDieOfFate,
      fatigueToggle: CairnCharacterSheet.#onFatigueToggle,
      conditionToggle: CairnCharacterSheet.#onConditionToggle,
      openBackground: CairnCharacterSheet.#onOpenBackground,
      pettyCreate: CairnCharacterSheet.#onPettyCreate,
      belongingCreate: CairnCharacterSheet.#onBelongingCreate,
      regenerate: CairnCharacterSheet.#onRegenerate,
      openCreator: CairnCharacterSheet.#onOpenCreator,
      openActions: CairnCharacterSheet.#onOpenActions,
      resetCreatorRolls: CairnCharacterSheet.#onResetCreatorRolls,
      scarCreate: CairnCharacterSheet.#onScarCreate,
      scarResolve: CairnCharacterSheet.#onScarResolve,
      growthCreate: CairnCharacterSheet.#onGrowthCreate,
      growthApply: CairnCharacterSheet.#onGrowthApply
    }
  };

  static EDIT_APP = CairnCharacterEdit;
  static EDIT_LABEL = "CAIRN.EditCharacter";

  /**
   * The creator opened for this actor, held at one instance per sheet so the menu entry
   * re-focuses the window that is already up rather than stacking a second copy.
   * @type {CairnCharacterCreator|null}
   */
  #creator = null;

  /** The Actions menu opened from this sheet's title bar, one per sheet like the creator. */
  #actions = null;

  // One part per region, never one `body`. Parts are appended into `.window-content` in
  // declaration order, and only the parts named in a render are rebuilt. Each tab body is its own
  // part whose root IS the `.tab` section, so `scrollable: [""]` names the element that actually
  // scrolls. No part declares `root: true` — a root part forces the whole set to render
  // (api/handlebars-application.mjs:76) and would undo this.
  static PARTS = {
    header: { template: `${TEMPLATES}/parts/character-header.hbs` },
    nav: { template: `${TEMPLATES}/parts/actor-tabs.hbs` },
    items: { template: `${TEMPLATES}/actor/character-items.hbs`, scrollable: [""] },
    petty: { template: `${TEMPLATES}/actor/character-petty.hbs`, scrollable: [""] },
    belongings: { template: `${TEMPLATES}/actor/character-belongings.hbs`, scrollable: [""] },
    identity: { template: `${TEMPLATES}/actor/character-identity.hbs`, scrollable: [""] },
    growth: { template: `${TEMPLATES}/actor/character-growth.hbs`, scrollable: [""] }
  };

  // Deliberately empty. Bond and Omen used to be drawn as ProseMirror editors on the Identity tab,
  // and listing them here stopped a save from rebuilding an editor that already showed the value.
  // They are read-only text now and they are edited in the edit window instead — so a change to
  // either has to redraw the tab, or the sheet keeps showing what the character used to be.
  static EDITOR_FIELDS = [];

  // Five views of two questions: what this character carries, and who they are. The old set had
  // an Effects tab the system never put anything in — no pack document ships an effect and
  // nothing here creates one — plus Description and Notes, which were two free-text boxes on a
  // sheet whose whole point is that everything on it is a rule.
  static TABS = {
    primary: {
      initial: "items",
      tabs: [
        // 2e calls the ten slots the character's inventory. What is not on them is not one
        // thing but two, and they were a single tab named for neither: *petty* items are ON the
        // character and cost no slot, while a Belonging is not under direct possession at all.
        // A name covering both had to be vague enough to lie about one of them — which is what
        // "Storage" did to *petty*, a thing in a pocket. One tab each, and each says what it
        // holds. Every tab here is one page tall (`--cairn-tab-max-h`), so splitting costs no
        // height: a zone added under the ten would have scrolled the ledger instead.
        { id: "items", label: "CAIRN.Inventory" },
        { id: "petty", label: "CAIRN.Petty" },
        { id: "belongings", label: "CAIRN.Belongings" },
        { id: "identity", label: "CAIRN.Identity" },
        // What the character became, beside where they came from. Scars and Growth share it
        // because 2e files the first under the second — "with some notable exceptions (such as
        // Scars), growth should always stem from a character's experiences in the game world".
        // Always drawn, even empty: a tab that appears the first time a character is hurt moves
        // the whole strip mid-game.
        { id: "growth", label: "CAIRN.Growth.Title" }
      ]
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;

    const background = this.actor.items.find((i) => i.type === "background");
    context.backgroundItem = background && {
      // A homebrew background can be named anything. The slot sits on one line beside the age, so
      // the name is clipped and the whole of it goes to the tooltip.
      name: background.name.length > 25 ? `${background.name.slice(0, 24).trimEnd()}\u2026` : background.name,
      fullName: background.name
    };

    context.abilities = abilityRows(system);
    context.traits = traitRows(system.traits);

    // The Bond and the Omen print as plain text, like the table answers below them: they are
    // drawn lines a player reads, and `toPlainText` keeps one that arrived as markup — an import,
    // a paste — from printing as tags.
    context.bond = toPlainText(system.bond);
    context.omenText = toPlainText(system.omen.text);
    // Whatever 2e gives this character that the model has no field for — a promoted hireling's
    // career, the prose they arrived with. Absent when blank: an empty heading is a question the
    // sheet cannot answer. `toPlainLines`, not `toPlainText`, because this one is a block: the
    // lines it was joined out of have to survive printing.
    context.description = toPlainLines(system.description);
    // The two Background table results, in the order they were rolled. A character made before
    // the tables were kept, or by hand, has two blank slots and no Background zone at all.
    context.backgroundTables = [];
    for (const slot of [system.backgroundTables.first, system.backgroundTables.second]) {
      if (!slot.question && !slot.answer) continue;
      context.backgroundTables.push({ question: slot.question, answer: toPlainText(slot.answer) });
    }
    // The Omen section exists only for a character who has one — the youngest of the party
    // (`srd-2e/players-guide/character-creation.md`). The toggle lives in the edit window.
    context.hasOmen = system.omen.enabled;

    // The Fatigue track down the right of the inventory: one circle per slot. A circle over a
    // carried thing is inert — 2e says a PC with no free slot must drop an item before Fatigue
    // can be added (`srd-2e/players-guide/core-rules.md`), so with ten slots full there is
    // deliberately nothing here to click.
    const rows = context.inventory.rows;
    for (const [i, row] of rows.entries()) {
      const marked = !!row.item?.isFatigue;
      row.fatigue = { marked, inert: !marked && !row.empty };
      row.last = i === rows.length - 1;
    }

    // Every Scar taken, in the order they happened. `outcome` is the printed record of what each
    // one did to a maximum — never a field: the maxima are edited in the edit window and two
    // editable copies of one number drift.
    context.scars = [];
    for (const item of this.actor.items) {
      if (item.type !== "scar") continue;
      context.scars.push({
        id: item.id,
        name: item.name,
        pending: !item.system.resolved,
        outcome: outcomeText(item.system),
        description: await enrich(item.system.description, this.actor)
      });
    }

    // Every Growth the character underwent, in the order it happened. `outcome` is the printed
    // record of what each one did to a maximum, never a field, for the same reason a scar's is
    // not: the maxima are edited in the edit window and two editable copies of one number drift.
    context.growth = [];
    for (const item of this.actor.items) {
      if (item.type !== "growth") continue;
      const milestones = item.system.milestones;
      context.growth.push({
        id: item.id,
        name: item.name,
        // The opposite polarity to a scar's `pending`. A scar that is not resolved OWES a roll;
        // a growth that is not resolved has simply never had a number, and most never will. The
        // control is an offer, not a debt, so nothing on the row may nag about it.
        resolved: item.system.resolved,
        outcome: outcomeText(item.system),
        // Progress, only where there is a list to have progress through. A growth with no
        // milestones is not "0/0" — it is a growth that was never a checklist.
        progress: milestones.length
          ? `${milestones.filter((m) => m.done).length}/${milestones.length}`
          : "",
        description: await enrich(item.system.description, this.actor)
      });
      const row = context.growth.at(-1);
      row.tags = !!(row.outcome || row.progress);
    }

    // The strip is shared with the NPC sheet; only a character has a purse.
    context.showGold = true;
    return context;
  }

  /** @override — the creator for anyone who owns the character, then "Regenerate" for the
   *  Warden. */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    // Anyone who owns the character may generate it — the player it was handed to included.
    // Not Warden-only like the random re-roll below, which is a Warden's tool for hirelings;
    // this is the procedure a player follows.
    controls.push({
      action: "openCreator",
      icon: "fa-solid fa-hat-wizard",
      label: "CAIRN.CharacterCreator.Open",
      ownership: "OWNER"
    });
    // A player's once-only rolls are locked on the actor; the Warden lifts the lock from here.
    // Only while there is one to lift — an entry that does nothing is noise in the menu.
    if (game.user.isGM && this.actor.getFlag(SYSTEM_ID, FLAGS.CREATOR_ROLLS) !== undefined) {
      controls.push({
        action: "resetCreatorRolls",
        icon: "fa-solid fa-rotate-left",
        label: "CAIRN.CharacterCreator.ResetRolls"
      });
    }
    // The random re-roll replaces the whole character behind one confirm: the Warden's, by
    // role, and never a player's — the same gate the NPC sheet puts on its re-roll. It used to
    // sit behind a world setting, which showed it to nobody by default and to owners once on.
    if (game.user.isGM) {
      controls.push({
        action: "regenerate",
        icon: "fas fa-skull",
        label: "CAIRN.RegenerateCharacter"
      });
    }
    return controls;
  }

  /* -------------------------------------------- */

  static async #onRest() {
    await this.actor.rest();
  }

  static async #onRestoreAbilities() {
    await this.actor.restoreAbilities();
  }

  static async #onDieOfFate() {
    await rollDieOfFate(this.actor);
  }

  /**
   * @override — a dropped Background replaces the one the character has.
   *
   * It is not inventory: a character is one background, so a second drop is a change of mind and
   * not a second item. Everything else falls through to the normal item drop.
   */
  async _onDropItem(event, item) {
    if (!this.isEditable) return;
    if (item.type !== "background") return super._onDropItem(event, item);

    const existing = this.actor.items.filter((i) => i.type === "background").map((i) => i.id);
    if (existing.length) await this.actor.deleteEmbeddedDocuments("Item", existing);
    const source = copyOf(item);
    await this.actor.createEmbeddedDocuments("Item", [source]);
  }

  static #onOpenBackground() {
    this.actor.items.find((i) => i.type === "background")?.sheet.render(true);
  }

  /**
   * One circle in the Fatigue track. A marked circle removes that Fatigue; a free one adds a new
   * one. The circles over carried items are rendered inert, so this never has to guard them.
   *
   * It adds a Fatigue rather than placing one AT that slot, and the difference is visible: slots
   * are derived, not stored — `prepareItems` packs items in a fixed order (Fatigue last) from
   * slot 1, so a new Fatigue always lands in the first free slot rather than the circle clicked.
   * Honouring the click would mean a stored position per item and gaps in the ledger, to model
   * something 2e does not have: the rule counts Fatigue, it does not place it.
   */
  /**
   * Toggle one of the two hand-set conditions from the header chip. This writes the ActiveEffect,
   * which is the only place the condition lives — so the token HUD entry lights with it, and a
   * toggle from the HUD lights the chip. There is nothing to keep in step.
   */
  static async #onConditionToggle(event, target) {
    await this.actor.toggleStatusEffect(target.dataset.condition);
  }

  static async #onFatigueToggle(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (id) {
      const item = this.actor.items.get(id);
      if (item?.type === "fatigue") await item.delete();
      return;
    }
    await this.actor.addFatigue();
  }

  /** The Petty Items heading's add control: the item prompt, everything it makes *petty*. */
  static async #onPettyCreate() {
    await createItemFromPrompt(this.actor, { petty: true });
  }

  /** The Scars tab's add control: the Scars window with no hit behind it, for a Warden handing
   *  one out or a character written up after the fact. */
  static async #onScarCreate() {
    return CairnScars.open(this.actor);
  }

  /**
   * The Growth zone's add control. The flag is what `CairnItem._preCreateOperation` looks for:
   * this is the one place a growth may be created, and one that arrives any other way is refused.
   * Created named and opened at once — a growth has one field the sheet already edits, so a
   * prompt would be a second window asking for what the first one asks for.
   */
  static async #onGrowthCreate() {
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("CAIRN.Growth.NewName"),
      type: "growth"
    }], { [SYSTEM_ID]: { growth: true } });
    return item?.sheet.render({ force: true });
  }

  /** The growth row's apply control: what this growth changed (`growth.js#promptGrowthGain`). */
  static async #onGrowthApply(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (!item || item.system.resolved) return;
    return promptGrowthGain(this.actor, item);
  }


  /** The die on a pending row: the gain that was waiting on the fiction. Same path the
   *  window takes when a row grows at once, so the save-then-grow rule is stated once. */
  static async #onScarResolve(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]").dataset.itemId);
    if (!item || item.system.resolved) return;
    return CairnScars.resolve(this.actor, item);
  }

  /** The Belongings heading's add control: the shared prompt, for a thing not carried. */
  static async #onBelongingCreate() {
    await createItemFromPrompt(this.actor, { carried: false });
  }

  /**
   * @override — Actions sits in the title bar, LEFT of the ellipsis, as a labelled button: the
   * NPC sheet's Promote, built the same way (`npc-sheet.js#_renderFrame`), because a frame button
   * would land right of the ellipsis with its word hidden in an `aria-label`. It is the owner's —
   * the player the character belongs to, and the Warden — and never an observer's: every tool in
   * the menu speaks or acts as the character.
   */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    if (!this.actor.isOwner) return frame;
    const button = frame.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "header-control cairn-frame-label";
    button.dataset.action = "openActions";
    button.dataset.tooltip = game.i18n.localize("CAIRN.Actions.Tooltip");
    button.textContent = game.i18n.localize("CAIRN.Actions.Title");
    frame.querySelector('button[data-action="toggleControls"]').insertAdjacentElement("beforebegin", button);
    return frame;
  }

  static async #onOpenActions() {
    this.#actions ??= new CairnActionsMenu({ actor: this.actor });
    await this.#actions.render({ force: true });
  }

  static async #onOpenCreator() {
    this.#creator ??= new CairnCharacterCreator({ actor: this.actor });
    await this.#creator.render({ force: true });
  }

  static async #onResetCreatorRolls() {
    await this.actor.unsetFlag(SYSTEM_ID, FLAGS.CREATOR_ROLLS);
    ui.notifications.info(game.i18n.localize("CAIRN.Notify.CreatorRollsReset", { name: this.actor.name }));
  }

  static async #onRegenerate() {
    const confirmed = await DialogV2.confirm({
      classes: [SYSTEM_ID],
      window: { title: game.i18n.localize("CAIRN.CharacterRegeneratorTitle") },
      content: `<p>${game.i18n.localize("CAIRN.CharacterRegeneratorConfirm")}</p>`,
      rejectClose: false
    });
    if (confirmed) await regenerateActor(this.actor);
  }
}

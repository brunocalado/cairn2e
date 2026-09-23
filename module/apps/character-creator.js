/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, FLAGS } from "../constants.js";
import {
  TRAIT_KEYS, ATTR_KEYS, traitRows,
  getBackgrounds, drawBackground, drawBackgroundTable,
  rollAttributeSet, rollHitProtection, rollAge,
  rollTrait, rollAllTraits, drawBond, drawOmen, drawName,
  draftFromBackground, createCharacterFromDraft, applyDraftToActor
} from "../character-generator.js";
import { stripTags } from "../helpers.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CREATOR = `systems/${SYSTEM_ID}/templates/apps/creator`;

/** Enrich authored compendium HTML (the background blurb, bond/omen text) for display. */
function enrich(html) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { secrets: false });
}

/**
 * The 2e character-creation flow as a wizard — one tab per numbered step of
 * `srd-2e/players-guide/character-creation.md`: roll or choose a Background, pick a name, roll
 * attributes (with the one permitted swap) and HP, roll the two Background tables, then the
 * eight traits, a Bond, age, and — if youngest — an Omen. The seventh tab is the Review: it
 * prints the draft as it stands and, under a Status heading, says what is still needed or that
 * everything blank will be rolled on create; the one "Create Character" button is the footer's
 * right-hand button on that tab, where Next was. Tabs 2–7 are inert until a Background is chosen,
 * because the Background is what decides the name list, the gear and the tables.
 *
 * Two modes, told apart by `game.user.isGM` and never chosen. The Warden re-rolls anything as
 * often as needed. A player rolls Attributes once, HP once and swaps once — the three results
 * are written to the actor's flags the moment they land (`FLAGS.CREATOR_ROLLS`), so closing and
 * reopening the window is not a re-roll; applying the character clears them, and the Warden can
 * clear them from the sheet's header menu. The lock belongs to the character, not the player:
 * it follows the actor if it changes hands, and the Warden can see it where the actor is.
 * Everything else (Background, name, tables, traits, Bond, age, Omen) stays re-rollable.
 *
 * Opened from the sidebar it creates a new Actor. Opened from a character sheet's header menu
 * it is given that `actor` and writes the draft into it instead — name, attributes, HP, gold,
 * origin and every Item except containers and their contents — the way the random Regenerate
 * does, so a player handed a blank character can make it theirs.
 *
 * All rolling and item-building lives in `module/character-generator.js`; this class holds the
 * draft state and the DOM.
 */
export class CairnCharacterCreator extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    // One window per instance: the sidebar's and one per actor can be open side by side.
    id: "cairn2e-character-creator-{id}",
    classes: [SYSTEM_ID, "character-creator"],
    /** The Actor the draft is written into; `null` creates a new one. */
    actor: null,
    tag: "form",
    position: { width: 640, height: 720 },
    window: { title: "CAIRN.CharacterCreator.Title", icon: "fas fa-skull", resizable: true },
    form: { handler: CairnCharacterCreator.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    actions: {
      pickBackground: CairnCharacterCreator.#onPickBackground,
      changeBackground: CairnCharacterCreator.#onChangeBackground,
      rollBackground: CairnCharacterCreator.#onRollBackground,
      setName: CairnCharacterCreator.#onSetName,
      rollName: CairnCharacterCreator.#onRollName,
      rollAttributes: CairnCharacterCreator.#onRollAttributes,
      swapPick: CairnCharacterCreator.#onSwapPick,
      swapAttributes: CairnCharacterCreator.#onSwapAttributes,
      rollHp: CairnCharacterCreator.#onRollHp,
      rollTable: CairnCharacterCreator.#onRollTable,
      rollTrait: CairnCharacterCreator.#onRollTrait,
      rollAllTraits: CairnCharacterCreator.#onRollAllTraits,
      rollBond: CairnCharacterCreator.#onRollBond,
      rollAge: CairnCharacterCreator.#onRollAge,
      rollOmen: CairnCharacterCreator.#onRollOmen,
      stepBack: CairnCharacterCreator.#onStepBack,
      stepNext: CairnCharacterCreator.#onStepNext
    }
  };

  // One part per step of the procedure, so rolling a trait rebuilds the trait grid and nothing
  // else. Every step panel is its own scroller (`scrollable`), so a partial render of one step
  // keeps its scroll position and no other panel can move.
  static PARTS = {
    nav: { template: `${CREATOR}/nav.hbs` },
    background: { template: `${CREATOR}/background.hbs`, scrollable: [""] },
    name: { template: `${CREATOR}/name.hbs`, scrollable: [""] },
    attributes: { template: `${CREATOR}/attributes.hbs`, scrollable: [""] },
    tables: { template: `${CREATOR}/tables.hbs`, scrollable: [""] },
    traits: { template: `${CREATOR}/traits.hbs`, scrollable: [""] },
    bond: { template: `${CREATOR}/bond.hbs`, scrollable: [""] },
    review: { template: `${CREATOR}/review.hbs`, scrollable: [""] },
    footer: { template: `${CREATOR}/footer.hbs` }
  };

  /** The seven steps in order — the tab ids, the Back/Next walk, and the Review's block order. */
  static STEPS = ["background", "name", "attributes", "tables", "traits", "bond", "review"];

  static TABS = {
    primary: {
      initial: "background",
      tabs: [
        { id: "background", label: "CAIRN.CharacterCreator.Tab.Background" },
        { id: "name", label: "CAIRN.CharacterCreator.Tab.Name" },
        { id: "attributes", label: "CAIRN.CharacterCreator.Tab.Attributes" },
        { id: "tables", label: "CAIRN.CharacterCreator.Tab.Tables" },
        { id: "traits", label: "CAIRN.CharacterCreator.Tab.Traits" },
        { id: "bond", label: "CAIRN.CharacterCreator.Tab.Bond" },
        { id: "review", label: "CAIRN.CharacterCreator.Tab.Review" }
      ]
    }
  };

  /** Working draft — see `character-generator.js#draftFromBackground` for the shape. */
  #draft = draftFromBackground(null);

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /**
   * A player rolls once; the Warden as often as needed. Read live, never cached across users.
   * Only a window opened for an actor can lock: from the sidebar there is no actor to carry the
   * lock until Create, and that button is only shown to the Warden and to a player the Warden
   * has deliberately allowed to create actors.
   */
  get #once() {
    return !game.user.isGM && !!this.options.actor;
  }

  /** @override — a player's earlier rolls come back before the first render. */
  async _preFirstRender(context, options) {
    await super._preFirstRender(context, options);
    if (!this.#once) return;
    const saved = this.options.actor.getFlag(SYSTEM_ID, FLAGS.CREATOR_ROLLS);
    if (saved) Object.assign(this.#draft, { attrs: saved.attrs, swapped: saved.swapped, hp: saved.hp });
  }

  /** Persist the three once-only results on the actor. A no-op for the Warden. */
  async #saveRolls() {
    if (!this.#once) return;
    const { attrs, swapped, hp } = this.#draft;
    await this.options.actor.setFlag(SYSTEM_ID, FLAGS.CREATOR_ROLLS, { attrs, swapped, hp });
  }

  /** The lock goes with the apply, whoever applies: a Warden generating the character over a
   *  player's locked rolls is the reset. */
  async #clearRolls() {
    const actor = this.options.actor;
    if (actor?.getFlag(SYSTEM_ID, FLAGS.CREATOR_ROLLS) === undefined) return;
    await actor.unsetFlag(SYSTEM_ID, FLAGS.CREATOR_ROLLS);
  }

  /** @override — names whose character is being generated, when there is one. */
  get title() {
    const actor = this.options.actor;
    return actor
      ? game.i18n.localize("CAIRN.CharacterCreator.TitleFor", { name: actor.name })
      : game.i18n.localize("CAIRN.CharacterCreator.Title");
  }

  /**
   * @override — every opening starts on the Background tab. Reset here and not in
   * `_preFirstRender`: core prepares the context — and with it which tab is `active` — before
   * that hook runs, so a reset there leaves the nav lit on one tab and the group on another.
   */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    if (options.isFirstRender) this.tabGroups.primary = "background";
  }

  /**
   * @override — the gate and the Review. Steps 2–7 are inert until a Background is chosen. Core's
   * `changeTab` only toggles classes and never renders, so the Review panel is rebuilt here, on
   * arrival, from the draft as it stands — and the footer with every change of tab: which of
   * Back / Next / Create it shows, and whether Create is allowed, are context, not something
   * toggled by hand.
   */
  changeTab(tab, group, options) {
    if (tab !== "background" && !this.#draft.backgroundUuid) return;
    super.changeTab(tab, group, options);
    this.render({ parts: tab === "review" ? ["review", "footer"] : ["footer"] });
  }

  /**
   * @override — the window is held open at one instance by whoever opened it (the sidebar, a
   * sheet), so the draft is emptied here: every opening starts from nothing, as it did when each
   * opening was a new instance.
   */
  _onClose(options) {
    super._onClose(options);
    this.#draft = draftFromBackground(null);
  }

  /** @override — each panel is told which tab it is, so it can carry `active`. */
  async _preparePartContext(partId, context, options) {
    const ctx = await super._preparePartContext(partId, context, options);
    if (partId in ctx.tabs) ctx.tab = ctx.tabs[partId];
    return ctx;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const d = this.#draft;
    const backgrounds = await getBackgrounds();
    const steps = this.constructor.STEPS;

    context.draft = d;
    context.once = this.#once;
    context.attrsLocked = this.#once && !!d.attrs;
    context.hpLocked = this.#once && !!d.hp;
    context.target = this.options.actor ? { name: this.options.actor.name } : null;
    context.isFirstStep = this.tabGroups.primary === steps[0];
    context.isLastStep = this.tabGroups.primary === steps[steps.length - 1];
    context.attrKeys = ATTR_KEYS;
    context.traitRows = traitRows(d.traits);
    context.hasBackground = !!d.backgroundUuid;
    for (const tab of Object.values(context.tabs)) tab.locked = tab.id !== "background" && !context.hasBackground;
    // The list prints each Background's blurb as one line of plain text beside its name — every
    // blurb is a single short paragraph, so the blurb IS the brief description.
    context.backgrounds = backgrounds.map((b) => ({
      uuid: b.uuid,
      name: b.name,
      blurb: stripTags(b.system.description).trim(),
      selected: b.uuid === d.backgroundUuid
    }));
    // The background's `description` is its blurb — the names, gear and tables are fields of
    // their own, rendered below.
    context.blurb = d.description ? await enrich(d.description) : "";
    // Starting gear is a list of uuids on the Background; the preview shows the documents' names.
    // Gold leads the list the way the SRD prints it, from the formula the Background carries.
    context.startingGear = await Promise.all(
      d.startingGear.map(async (uuid) => {
        const doc = await fromUuid(uuid).catch(() => null);
        return { ok: !!doc, name: doc?.name ?? uuid };
      })
    );
    context.startingGold = d.startingGold;
    context.names = d.names;
    context.attrs = d.attrs;
    // The boxes are the swap picker: each carries its own picked state.
    context.attrBoxes = ATTR_KEYS.map((key) => ({
      key,
      value: d.attrs?.[key],
      picked: d.swapPicks.includes(key)
    }));
    context.canSwap = !!d.attrs && !d.swapped && d.swapPicks.length === 2;
    context.swapDone = !!d.attrs && d.swapped;
    context.traitsComplete = TRAIT_KEYS.every((key) => !!d.traits[key]);
    context.tables = await this.#tableContext();
    // Both are drawn plain (`character-generator.js#drawBond`), and both print plain.
    context.bondText = d.bond ?? "";
    context.omenText = d.omen ?? "";

    // The footer's Create button and the Review's Status line come from the same four conditions
    // `#onSubmit` checks, so the button and the line can never disagree about what is missing.
    const missing = [];
    if (!d.backgroundUuid) missing.push(game.i18n.localize("CAIRN.Background"));
    if (!d.name?.trim()) missing.push(game.i18n.localize("CAIRN.Name"));
    if (!d.attrs) missing.push(game.i18n.localize("CAIRN.CharacterCreator.Attributes"));
    if (!d.hp) missing.push(game.i18n.localize("CAIRN.HitProtection"));
    context.canCreate = missing.length === 0;
    context.createReason = missing.length
      ? game.i18n.localize("CAIRN.CharacterCreator.StillNeeded", { missing: missing.join(", ") })
      : "";

    return context;
  }

  /** One row per Background d6 table: its name, its formula, and the current draw (if any). */
  async #tableContext() {
    const out = [];
    for (let i = 0; i < this.#draft.tables.length; i++) {
      const table = await fromUuid(this.#draft.tables[i]);
      const result = this.#draft.tableResults[i];
      out.push({
        index: i,
        name: table?.name ?? `Table ${i + 1}`,
        formula: table?.formula ?? "1d6",
        rolled: !!result?.text,
        total: result?.total ?? null,
        // The drawn answer as a sentence, not as markup: it is the same text the character will
        // keep and print on its Identity tab, and it reads the same in all three places.
        text: result?.text ?? ""
      });
    }
    return out;
  }

  /* -------------------------------------------- */
  /*  Non-action listeners                        */
  /* -------------------------------------------- */

  /** @override — the fields with no `data-action`, bound on the part that was just rendered: a
   *  Roll Name re-renders `name` alone, and the `bond` part it leaves in place keeps the one
   *  `youngest` listener it was born with. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    htmlElement.querySelector('[name="charname"]')?.addEventListener("change", (event) => {
      this.#draft.name = event.target.value;
    });

    for (const input of htmlElement.querySelectorAll("[data-trait-input]")) {
      input.addEventListener("change", (event) => {
        this.#draft.traits[event.target.dataset.traitInput] = event.target.value;
      });
    }

    htmlElement.querySelector('[name="age"]')?.addEventListener("change", (event) => {
      const n = Number(event.target.value);
      this.#draft.age = Number.isFinite(n) ? n : this.#draft.age;
    });

    htmlElement.querySelector('[name="youngest"]')?.addEventListener("change", (event) => {
      this.#draft.youngest = event.target.checked;
      this.render({ parts: ["bond"] });
    });
  }

  /* -------------------------------------------- */
  /*  Background                                  */
  /* -------------------------------------------- */

  /** What survives a change of Background: the name, and the rolled numbers — the SRD rolls
   *  Attributes and HP after the Background but independently of it, and a player's are locked. */
  #kept() {
    const d = this.#draft;
    return { name: d.name, attrs: d.attrs, swapped: d.swapped, swapPicks: [], hp: d.hp };
  }

  #setBackground(background) {
    if (!background) return;
    this.#draft = Object.assign(draftFromBackground(background), this.#kept());
    // A new Background changes every step below it, so this is the one action that renders the
    // whole form. The next step is the name, and the wizard moves there.
    this.render().then(() => this.changeTab("name", "primary"));
  }

  static async #onPickBackground(event, target) {
    this.#setBackground(await fromUuid(target.dataset.uuid));
  }

  static async #onRollBackground() {
    const { background } = await drawBackground();
    this.#setBackground(background);
  }

  /** Return to the list of twenty. Everything a Background determined is discarded with it;
   *  `#kept` survives, as it does when picking a different Background outright. */
  static #onChangeBackground() {
    this.#draft = Object.assign(draftFromBackground(null), this.#kept());
    this.render();
  }

  static #onSetName(event, target) {
    this.#draft.name = target.dataset.name;
    this.render({ parts: ["name"] });
  }

  static #onRollName() {
    this.#draft.name = drawName(this.#draft);
    this.render({ parts: ["name"] });
  }

  /* -------------------------------------------- */
  /*  Back / Next                                 */
  /* -------------------------------------------- */

  static #onStepBack() {
    const steps = this.constructor.STEPS;
    const i = steps.indexOf(this.tabGroups.primary);
    if (i > 0) this.changeTab(steps[i - 1], "primary");
  }

  static #onStepNext() {
    const steps = this.constructor.STEPS;
    const i = steps.indexOf(this.tabGroups.primary);
    if (i >= 0 && i < steps.length - 1) this.changeTab(steps[i + 1], "primary");
  }

  /* -------------------------------------------- */
  /*  Attributes & HP                             */
  /* -------------------------------------------- */

  // Each once-only button is disabled in the template from the same state its handler refuses
  // on, because a disabled attribute is not a permission.

  static async #onRollAttributes() {
    if (this.#once && this.#draft.attrs) return;
    this.#draft.attrs = await rollAttributeSet();
    this.#draft.swapped = false;
    this.#draft.swapPicks = [];
    await this.#saveRolls();
    this.render({ parts: ["attributes", "review"] });
  }

  /** Pick (or unpick) a box for the swap. Two at most; the swap itself waits for the button. */
  static #onSwapPick(event, target) {
    const d = this.#draft;
    if (!d.attrs || d.swapped) return;
    const key = target.dataset.attr;
    const i = d.swapPicks.indexOf(key);
    if (i >= 0) d.swapPicks.splice(i, 1);
    else if (d.swapPicks.length < 2) d.swapPicks.push(key);
    this.render({ parts: ["attributes"] });
  }

  /** The one swap the rules allow ("You may then swap any two of the results"). */
  static async #onSwapAttributes() {
    const d = this.#draft;
    if (!d.attrs || d.swapped || d.swapPicks.length !== 2) return;
    const [a, b] = d.swapPicks;
    [d.attrs[a], d.attrs[b]] = [d.attrs[b], d.attrs[a]];
    d.swapped = true;
    d.swapPicks = [];
    await this.#saveRolls();
    this.render({ parts: ["attributes", "review"] });
  }

  static async #onRollHp() {
    if (this.#once && this.#draft.hp) return;
    this.#draft.hp = await rollHitProtection();
    await this.#saveRolls();
    this.render({ parts: ["attributes", "review"] });
  }

  /* -------------------------------------------- */
  /*  Tables, traits, bond, age, omen            */
  /* -------------------------------------------- */

  static async #onRollTable(event, target) {
    const index = Number(target.dataset.index);
    const uuid = this.#draft.tables[index];
    if (!uuid) return;
    this.#draft.tableResults[index] = await drawBackgroundTable(uuid);
    this.render({ parts: ["tables"] });
  }

  static async #onRollTrait(event, target) {
    const key = target.dataset.trait;
    this.#draft.traits[key] = await rollTrait(key);
    this.render({ parts: ["traits"] });
  }

  static async #onRollAllTraits() {
    this.#draft.traits = await rollAllTraits();
    this.render({ parts: ["traits"] });
  }

  static async #onRollBond() {
    this.#draft.bond = await drawBond();
    this.render({ parts: ["bond"] });
  }

  static async #onRollAge() {
    this.#draft.age = await rollAge();
    this.render({ parts: ["bond"] });
  }

  static async #onRollOmen() {
    this.#draft.omen = await drawOmen();
    this.render({ parts: ["bond"] });
  }

  /* -------------------------------------------- */
  /*  Submit                                      */
  /* -------------------------------------------- */

  static async #onSubmit() {
    const d = this.#draft;
    if (!d.backgroundUuid || !d.attrs || !d.hp || !d.name?.trim()) {
      ui.notifications.warn(game.i18n.localize("CAIRN.CharacterCreator.MissingFields"));
      return;
    }

    // Fill anything the Warden did not roll by hand — a character is never left half-made.
    if (Object.values(d.traits).filter(Boolean).length < TRAIT_KEYS.length) {
      d.traits = { ...(await rollAllTraits()), ...d.traits };
    }
    if (!d.bond) d.bond = await drawBond();
    if (!d.age) d.age = await rollAge();
    if (d.youngest && !d.omen) d.omen = await drawOmen();
    for (let i = 0; i < d.tables.length; i++) {
      if (!d.tableResults[i]?.text) d.tableResults[i] = await drawBackgroundTable(d.tables[i]);
    }

    const actor = this.options.actor
      ? await applyDraftToActor(this.options.actor, d)
      : await createCharacterFromDraft(d);
    if (actor) {
      await this.#clearRolls();
      actor.sheet.render(true);
      await this.close();
    }
  }
}

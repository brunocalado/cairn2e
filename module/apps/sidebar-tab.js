/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { CairnCharacterCreator } from "./character-creator.js";
import { generateNpc, generateHireling } from "../npc-generator.js";
import { generateMonster } from "../monster-generator.js";
import { generateFaction } from "../faction-generator.js";
import { CairnJourneyTracker } from "./journey-tracker.js";
import { CairnStore } from "./store.js";
import { importKettlewrightCharacter } from "../kettlewright-import.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { AbstractSidebarTab } = foundry.applications.sidebar;

/**
 * The system's own sidebar tab — every system-specific tool in one place, instead of a row of
 * buttons bolted onto the Actors directory header where they crowd out the actor list.
 *
 * `AbstractSidebarTab` wires the popout behaviour and the `id` / `data-tab` plumbing; the tab is
 * made visible by registering it in `CONFIG.ui` and `Sidebar.TABS` (module/cairn2e.js). The DOM id
 * is the tab name, so it is `SYSTEM_ID` like every other system-owned identifier (CLAUDE.md §4).
 */
export class CairnSidebarTab extends HandlebarsApplicationMixin(AbstractSidebarTab) {
  /** @override */
  static tabName = SYSTEM_ID;

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID],
    window: { title: "CAIRN.Sidebar.Title" },
    actions: {
      openCharacterCreator: CairnSidebarTab.#onOpenCharacterCreator,
      importKettlewright: CairnSidebarTab.#onImportKettlewright,
      generateNpc: CairnSidebarTab.#onGenerateNpc,
      generateHireling: CairnSidebarTab.#onGenerateHireling,
      generateMonster: CairnSidebarTab.#onGenerateMonster,
      generateFaction: CairnSidebarTab.#onGenerateFaction,
      openJourney: CairnSidebarTab.#onOpenJourney,
      openStore: CairnSidebarTab.#onOpenStore
    }
  };

  /** @override */
  static PARTS = {
    tools: {
      template: `systems/${SYSTEM_ID}/templates/apps/sidebar-tab.hbs`,
      root: true
    }
  };

  /**
   * A player who can create neither Actors nor anything Warden-only has an empty tab; hide it
   * rather than show an empty panel. Returning false also hides the nav button — `Sidebar` asks
   * every tab this before rendering it.
   * @override
   */
  _canRender() {
    if (!game.user.isGM && !game.user.can("ACTOR_CREATE")) return false;
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // The two gates the tools themselves enforce: character tools need actor creation, the
    // Warden tools are the Warden's.
    context.canCreateActor = game.user.can("ACTOR_CREATE");
    context.isGM = game.user.isGM;
    return context;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** The creator, one instance: a second click re-focuses the window that is already up. */
  #creator = null;

  /** @this {CairnSidebarTab} */
  static #onOpenCharacterCreator() {
    this.#creator ??= new CairnCharacterCreator();
    this.#creator.render({ force: true });
  }

  /** @this {CairnSidebarTab} */
  static #onImportKettlewright() {
    importKettlewrightCharacter();
  }

  /** @this {CairnSidebarTab} */
  static #onGenerateNpc() {
    generateNpc();
  }

  /** @this {CairnSidebarTab} */
  static #onGenerateHireling() {
    generateHireling();
  }

  /** @this {CairnSidebarTab} */
  static #onGenerateMonster() {
    generateMonster();
  }

  /** @this {CairnSidebarTab} */
  static #onGenerateFaction() {
    generateFaction();
  }

  /** @this {CairnSidebarTab} */
  static #onOpenJourney() {
    CairnJourneyTracker.open();
  }

  /** @this {CairnSidebarTab} */
  static #onOpenStore() {
    CairnStore.open();
  }
}

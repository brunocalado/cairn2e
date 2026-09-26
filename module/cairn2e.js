/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

// Import Modules
import { SYSTEM_ID, SETTINGS, CONDITION, TOOLTIP_CLASS } from "./constants.js";
import { CairnActor } from "./documents/actor.js";
import { CairnCharacterSheet } from "./apps/character-sheet.js";
import { CairnNpcSheet } from "./apps/npc-sheet.js";
import { CairnPartySheet } from "./apps/party-sheet.js";
import { CairnItem } from "./documents/item.js";
import { CairnItemSheet } from "./apps/item-sheet.js";
import * as characterGenerator from "./character-generator.js";
import * as npcGenerator from "./npc-generator.js";
import * as monsterGenerator from "./monster-generator.js";
import * as factionGenerator from "./faction-generator.js";
import { renderEncounterButton } from "./encounters.js";
import * as journey from "./journey.js";
import { CairnJourneyTracker } from "./apps/journey-tracker.js";
import { CairnStore } from "./apps/store.js";
import * as kettlewrightImport from "./kettlewright-import.js";
import { CairnCharacterCreator } from "./apps/character-creator.js";
import { CairnGamePause } from "./apps/game-pause.js";
import { CairnSidebarTab } from "./apps/sidebar-tab.js";
import { CairnRoutePageSheet } from "./apps/route-page-sheet.js";
import { CairnFactionPageSheet, FACTION_TYPE } from "./apps/faction-page-sheet.js";
import { registerPointcrawlHooks, ROUTE_TYPE } from "./pointcrawl.js";
import { CairnScars, SCAR_QUERY } from "./apps/scars.js";
import { BARTER_QUERY, receiveBarter } from "./transfer.js";
import { CairnCombat } from "./documents/combat.js";
import { CairnCombatant } from "./documents/combatant.js";
import { CairnCombatTracker } from "./apps/combat-tracker.js";
import { CairnToken } from "./canvas/token.js";
import { CONDITIONS } from "./conditions.js";
import { createCairnMacro, rollItemMacro, macroApi } from "./macros.js";
import { Damage } from "./combat/damage.js";
import { registerSettings } from "./settings.js";
import { registerEnrichers } from "./enrichers.js";
import { addChatMessageContextOptions } from "./chat.js";
import { registerDiceSoNice } from "./dice-so-nice.js";
import { registerLightSources } from "./light-sources.js";
import { installWelcomeWorld } from "./welcome.js";
import { installTokenDefaults } from "./token-defaults.js";
import { scanBestiaryArt, injectBestiaryArt } from "./bestiary-art.js";
import { installTokenHudLabels, CairnTokenHUD } from "./token-hud.js";
import * as models from "./data/_module.js";
import * as rolls from "./rolls.js";

// The token HUD's status palette shows each condition's name beside its icon. Registered at import
// rather than inside `init`, because it only listens for a render.
installTokenHudLabels();

Hooks.once("init", async function () {
  // Tooltips fire at 500ms in core (`client/helpers/interaction/tooltip-manager.mjs:52`), which on
  // a sheet this dense means a panel opens under the pointer on the way to somewhere else. The
  // delay is read at activation time off `this.constructor`, so raising the static is enough.
  //
  // This is CLIENT-WIDE, not sheet-scoped: there is no per-application delay in v14, and the
  // manager is a singleton. It is one line to revert if it ever gets in the way of a module.
  foundry.helpers.interaction.TooltipManager.TOOLTIP_ACTIVATION_MS = 900;

  // Public API for hotbar macros and third-party modules. Named for SYSTEM_ID (CLAUDE.md §4) —
  // upstream's `game.cairn` is gone, so user macros written against it break, which is §0 working
  // as intended. Keep this surface small: every entry is a promise. Documented in README.md.
  game.cairn2e = {
    CairnActor,
    CairnItem,
    // Opens the interactive, background-driven character creator.
    CairnCharacterCreator,
    // Headless character / hireling generation (`createCharacter`, `regenerateActor`, the small
    // rollers) — a Warden building six hirelings does not want the wizard six times.
    characterGenerator,
    // Called by the weapon-damage macros `createCairnMacro` writes to the hotbar.
    rollItemMacro,
    // The world's active party Actor, or `null`. Three callers want it — the P key, and both
    // halves of the directory's "Make active" entry — so it is derived once, here, rather than
    // each of them re-reading the setting and re-testing the subtype.
    get party() {
      const actor = game.actors.get(game.settings.get(SYSTEM_ID, SETTINGS.ACTIVE_PARTY));
      return actor?.type === "party" ? actor : null;
    },
    // Warden-only NPC / hireling generation (`generateNpc`, `generateHireling`, `regenerateNpc`) —
    // the sidebar tab's buttons call these; a macro can too.
    npcGenerator,
    // Warden-only monster generation (`generateMonster`, `regenerateMonster`) — the SRD
    // "Creating Monsters" procedure behind one sidebar-tab button.
    monsterGenerator,
    // Warden-only faction generation (`generateFaction`) — the SRD "Setting Seeds → Factions"
    // tables composed into a private JournalEntry dossier.
    factionGenerator,
    // The Wilderness Exploration journey (`current`, `apply`, `party`) and its window (`open`) —
    // the sidebar-tab button opens the window; a macro can drive the state directly.
    journey: { ...journey, open: CairnJourneyTracker.open },
    // Warden-only, one-way Kettlewright `.json` → `character` Actor importer (`importKettlewrightCharacter`)
    // behind the sidebar-tab button.
    kettlewrightImport,
    // The single entry point for rolls (module/rolls.js) — so a GM can roll the Die of Fate, a
    // Reaction or Morale from the console or a macro with no character sheet open.
    rolls,
    // Taking a Scar: `game.cairn2e.scars.open(actor, { hpLost })`. The sheet, the Scars tab and
    // the chat card all come in through this one door, and so can a macro.
    scars: { open: CairnScars.open, resolve: CairnScars.resolve },
    // The supplied macros' one-liners — `rest`, `restoreAbilities`, `save(key)`, `morale`,
    // `reaction`, `dieOfFate` — each acting on the selected token or the user's character.
    ...macroApi,
  };
  // The same object as a bare global, so a macro is one line: `cairn2e.rest()`.
  globalThis[SYSTEM_ID] = game.cairn2e;

  // The Scars window belongs to the character's own player, and the client that applied the
  // damage is usually the Warden's. A query addresses one user and comes back as a promise;
  // `User#query` throws when that user is not connected, which the chat card already covers.
  CONFIG.queries[SCAR_QUERY] = async ({ actorUuid, hpLost }) => {
    const actor = await fromUuid(actorUuid);
    if (!actor) return false;
    await CairnScars.open(actor, { hpLost });
    return true;
  };

  // A player's click on the journey window — their character's action, the party's rolls — runs on
  // the Warden's client, where the setting can be written. `journey.apply` re-checks who asked.
  CONFIG.queries[journey.JOURNEY_QUERY] = async ({ type, ...data }, { user }) => journey.apply(type, data, user);

  // A barter writes the recipient's character, which the sender may not: the recipient's client,
  // or the Warden's, makes the write. `receiveBarter` checks the payload before it does.
  CONFIG.queries[BARTER_QUERY] = async (payload) => receiveBarter(payload);

  // The token HUD, for the one control core has no room for: a party token sets its members
  // down and gathers them back in. Read once, when the HUD container is constructed
  // (`client/applications/hud/container.mjs`), so it has to be decided here and not later.
  CONFIG.Token.hudClass = CairnTokenHUD;

  // Define custom Entity classes
  CONFIG.Actor.documentClass = CairnActor;
  CONFIG.Item.documentClass = CairnItem;

  // Register the 2e data models. Subtype ids match `documentTypes` in system.json.
  CONFIG.Actor.dataModels = models.ACTOR_MODELS;
  CONFIG.Item.dataModels = models.ITEM_MODELS;
  // A pointcrawl's paths are journal pages: one journal holds the points and the routes between
  // them (`module/pointcrawl.js`). `JournalEntryPage` has `hasTypeData`, so the subtype is
  // declared in `system.json#documentTypes` like an Actor's or an Item's.
  CONFIG.JournalEntryPage.dataModels = models.PAGE_MODELS;

  // Replace core's forty-odd generic statuses with the 2e roster. Mutated in place rather than
  // assigned: `CONFIG.statusEffects` is a Proxy over an array that also keys every entry by its id
  // (config.mjs), and the only thing that makes `CONFIG.statusEffects = [...]` work is an accessor
  // core marks @deprecated since v14 (client.mjs). Setting `length` and pushing goes through the
  // Proxy's own traps, which clear the stale id keys and rebuild them — so
  // `CONFIG.statusEffects.deprived` still resolves afterwards, with nothing deprecated in the path.
  //
  // `CONFIG.specialStatusEffects` is left exactly as core ships it: DEFEATED is "dead", which the
  // roster keeps, and its other entries name ids nothing defines any more — a harmless miss, since
  // `hasStatusEffect` on an unknown id is simply false.
  CONFIG.statusEffects.length = 0;
  for (const condition of CONDITIONS) CONFIG.statusEffects.push(condition);

  // Every message in the log is drawn by this system's template rather than core's parchment one:
  // the message element IS the card, its `flavor` is the card's caption, and an OOC message does
  // not take the author's colour (core sets that as an inline `style`, which no stylesheet can
  // outrank). A card this system posts is therefore a body, not a framed box inside a frame.
  CONFIG.ChatMessage.template = `systems/${SYSTEM_ID}/templates/chat/message.hbs`;

  // The system's Roll, first in the list: `Roll.create` and the chat box's `/r` resolve through
  // `CONFIG.Dice.rolls[0]`, so every roll made at this table draws the system's ruled line rather
  // than core's grey bars. Core's own class stays behind it because `Roll.fromData` resolves a
  // stored roll by class name — a roll another package posted still reconstructs.
  CONFIG.Dice.rolls = [rolls.CairnRoll, ...CONFIG.Dice.rolls];

  // A drawn table is a card like any other message: core's own draw template set its rows at icon
  // size, which made a Wilderness Encounter the tallest thing in the log, and left the Warden's
  // "Add to scene" control nested inside markup this system did not draw.
  CONFIG.RollTable.resultTemplate = `systems/${SYSTEM_ID}/templates/chat/table-draw.hbs`;

  // Combat. 2e's round is side-based and has no initiative roll at all (`core-rules.md`), so
  // there is no `CONFIG.Combat.initiative` formula to set: `CairnCombat.rollInitiative` writes
  // nothing and the tracker below groups the combatants into two sides instead of sorting them.
  CONFIG.Combat.documentClass = CairnCombat;
  CONFIG.Combatant.documentClass = CairnCombatant;
  CONFIG.ui.combat = CairnCombatTracker;

  // The canvas turn ring. Core lights it for the one token at `combat.combatant`, which this
  // system has no answer for; CairnToken lights every token of the side that is acting instead.
  CONFIG.Token.objectClass = CairnToken;

  // Register sheet application classes — per Actor type, since the two sheets share almost no
  // controls. The core fallback sheets stay registered as non-default alternatives.
  foundry.documents.collections.Actors.registerSheet(SYSTEM_ID, CairnCharacterSheet, {
    types: ["character"],
    makeDefault: true
  });
  foundry.documents.collections.Actors.registerSheet(SYSTEM_ID, CairnNpcSheet, {
    types: ["npc"],
    makeDefault: true
  });
  foundry.documents.collections.Actors.registerSheet(SYSTEM_ID, CairnPartySheet, {
    types: ["party"],
    makeDefault: true
  });
  foundry.documents.collections.Items.registerSheet(SYSTEM_ID, CairnItemSheet, { makeDefault: true });
  // A journal page has no collection-level registrar; core registers its own page sheets through
  // `DocumentSheetConfig` and so does this one.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.JournalEntryPage, SYSTEM_ID, CairnRoutePageSheet,
    { types: [ROUTE_TYPE], makeDefault: true, label: "CAIRN.Route.SheetLabel" }
  );
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.JournalEntryPage, SYSTEM_ID, CairnFactionPageSheet,
    { types: [FACTION_TYPE], makeDefault: true, label: "CAIRN.Faction.SheetLabel" }
  );

  registerSidebarTab();
  registerSettings();
  // Makes `[[/save WIL]]`, `@Condition[…]`, `@Rule[…]` and `[[/table …]]` resolve wherever
  // Foundry enriches text — including core's own journal sheets, which this system never draws.
  registerEnrichers();
  // A Warden's double-click on a map pin linked to a route opens the journey form, not the page.
  registerPointcrawlHooks();

  // Right-clicking a message in the log offers this system's own entries. Registered in `init`
  // beside the rest; the hook itself fires every time a context menu is built, and the entry
  // decides for itself whether it belongs on the message under the pointer.
  Hooks.on("getChatMessageContextOptions", addChatMessageContextOptions);
  registerKeybindings();
  registerDiceSoNice();
  registerLightSources();
  configureHandleBar();
});

/**
 * The one key this system claims: **P** opens the active party.
 *
 * Registered here because `ClientKeybindings#register` throws after `init`
 * (`client/helpers/interaction/client-keybindings.mjs`). `KeyP` is free in core — its own
 * defaults use A, C, D, E, F, Q, R, S, T, U, V, W, X and Z, and not P — and it is `editable`, so
 * a table that disagrees rebinds it under Configure Controls.
 *
 * Not `restricted`: the group is the players' as much as the Warden's, and a player checking how
 * everyone is doing is the common press. Whether the sheet then opens is Foundry's ownership
 * question, and a party is created owned by everyone (`documents/actor.js`).
 */
function registerKeybindings() {
  game.keybindings.register(SYSTEM_ID, "openParty", {
    name: "CAIRN.Party.OpenKey",
    hint: "CAIRN.Party.OpenKeyHint",
    editable: [{ key: "KeyP" }],
    restricted: false,
    onDown: () => {
      const party = game.cairn2e.party;
      if (!party) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Party.NoActiveParty"));
        return true;
      }
      party.sheet.render({ force: true });
      return true;
    }
  });
}

/**
 * Which party the P key opens, chosen from the Actors directory.
 *
 * A hook rather than a subclass of `ActorDirectory`: core builds this menu through
 * `getActorContextOptions` (the name is `get${documentName}ContextOptions`,
 * `client/applications/sidebar/document-directory.mjs`), so six lines here replace a class that
 * would have to keep step with core's own entries.
 *
 * Offered only on a party that is not already the active one, and only to a Warden — the setting
 * is world-scoped and a player cannot write it.
 */
Hooks.on("getActorContextOptions", (directory, options) => {
  options.push({
    label: "CAIRN.Party.MakeActive",
    icon: '<i class="fa-solid fa-people-group" inert></i>',
    visible: (li) => {
      const actor = game.actors.get(li.dataset.entryId);
      return game.user.isGM && actor?.type === "party" && actor !== game.cairn2e.party;
    },
    callback: (li) => game.settings.set(SYSTEM_ID, SETTINGS.ACTIVE_PARTY, li.dataset.entryId)
  });
});

/**
 * Register the system's sidebar tab. Two halves, both required: `CONFIG.ui` is what `Game`
 * instantiates into `ui.<tabName>`, and `Sidebar.TABS` is what draws the nav button and the stub
 * the tab renders itself into. The entry is spliced in directly under `chat` — the system's tools
 * are reached often enough to sit at the top of the rail rather than buried above the gear.
 */
function registerSidebarTab() {
  const { Sidebar } = foundry.applications.sidebar;
  CONFIG.ui[CairnSidebarTab.tabName] = CairnSidebarTab;
  // The same mechanism, one entry over: `ui.pause` becomes the banner with the Cairn logo on it.
  CONFIG.ui.pause = CairnGamePause;

  // `icon` is interpolated straight into the nav button's `class` (core's templates/sidebar/tabs.hbs),
  // which is the only way to mark that button as ours: it is core's markup, rendered outside this
  // tab's own element, so `css/src/sidebar-tab.css` can reach it no other way. It is the scope class ALONE,
  // no Font Awesome glyph: the stylesheet draws the wordmark's candle flame on the button instead.
  const descriptor = { tooltip: "CAIRN.Sidebar.Title", icon: SYSTEM_ID };

  const entries = Object.entries(Sidebar.TABS);
  const afterChat = entries.findIndex(([key]) => key === "chat");
  const at = afterChat < 0 ? entries.length : afterChat + 1;
  entries.splice(at, 0, [CairnSidebarTab.tabName, descriptor]);
  Sidebar.TABS = Object.fromEntries(entries);
}

Hooks.once("i18nInit", () => {
  // Localize DataModel field labels. Must be here, not `init` — localization data is not loaded
  // yet at `init` and labels come out as raw keys. Keys live in lang/en.json.
  for (const model of [
    ...Object.values(models.ACTOR_MODELS), ...Object.values(models.ITEM_MODELS),
    ...Object.values(models.PAGE_MODELS)
  ]) {
    foundry.helpers.Localization.localizeDataModel(model);
  }
});

Hooks.once("ready", () => {
  // A brand-new world gets the Welcome scene and the Playlist that plays over it, once. Not
  // awaited: nothing below depends on it, and the hook should not hold the client on a fetch.
  installWelcomeWorld();

  // The same, for what a token shows — name, bars, rotation, and the combat turn marker — seeded
  // into core's own settings so the Warden can edit it there rather than discover it hardcoded
  // (module/token-defaults.js).
  installTokenDefaults();

  // The Warden's bestiary art (module/bestiary-art.js): every client lays the last published scan
  // over the pack at once, so a player does not wait on the Warden; then the active GM rescans the
  // folder and republishes only if it changed. Here and not at `setup` because browsing needs the
  // logged-in user and `game.packs` must be indexed. Not awaited, like the two installs above.
  injectBestiaryArt(game.settings.get(SYSTEM_ID, SETTINGS.BESTIARY_ART_MAP));
  scanBestiaryArt();

  // The Warden's "Show to everyone": one broadcast, and every OTHER client opens its own journey
  // window (the emitter never receives its own broadcast; the Warden's is already open).
  game.socket.on(`system.${SYSTEM_ID}`, (data) => {
    if (data?.type === "openJourney") CairnJourneyTracker.open();
    if (data?.type === "openStore") CairnStore.open(data.storeId);
  });

  // The journey window reads each character's Rations, Fatigue and Deprived off the Actor, so it
  // has to follow the sheets and not only its own setting.
  CairnJourneyTracker.watchParty();

  // Only an Item is this system's: a weapon becomes a `rollItemMacro`. Everything else — a Macro
  // from the pack, a RollTable, a journal — is left to core's own `#onDragDrop` branches, which run
  // only when this hook returns nothing. The `false` must be synchronous: a Promise is not `false`.
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (data?.type !== "Item") return;
    createCairnMacro(data, slot);
    return false;
  });

  // Keep the five derived conditions on a PC's token in step with its slots and attributes.
  //
  // One writer only: every connected client sees these hooks, and a status toggle is a document
  // write, so without the gate N clients race the same create/delete. `activeGM` is core's own
  // answer to "exactly one user should act" (users.mjs), and a world with no GM online simply does
  // not sync — the markers catch up when one connects.
  //
  // Registered at `ready` rather than `init` so no sync runs against a half-built world. There is
  // no loop risk: `toggleStatusEffect` writes an ActiveEffect, which fires no `updateActor`.
  //
  // Deferred OUT of the hook that triggered it, which is the part that matters — measured in a
  // live client, 2026-09-15. A `createItem` hook fires from inside the creation's own workflow,
  // and writing another document from there gets one of them back twice: a single `addFatigue()`
  // left the actor carrying TWO "Fatigued" effects, the second of which the server had never
  // stored. The phantom lives only in that client's collection, so it survives until a reload —
  // and the next sync that wants the condition OFF hands its id to
  // `deleteEmbeddedDocuments`, which refuses the whole batch with `ActiveEffect "…" does not
  // exist!`. That error was the visible end of it; the duplicate was the cause. Running the same
  // sync 60ms later produced exactly one effect and no error.
  //
  // The debounce also collapses a burst: ten items created in one call fire `createItem` ten
  // times and settle into ONE sync, against data that has stopped moving.
  //
  // Serialised per actor on top of that, so two bursts that overlap still run one after the
  // other: syncs racing each other all read the same stale `statuses`, all decide the same effect
  // needs writing, and the losers fail the same way.
  const syncQueues = new Map();
  const runSync = (actor, owed) => {
    const queued = (syncQueues.get(actor.id) ?? Promise.resolve())
      .then(() => actor.syncDerivedConditions(owed))
      .catch((err) => console.error(`${SYSTEM_ID} | condition sync failed`, err))
      .finally(() => {
        if (syncQueues.get(actor.id) === queued) syncQueues.delete(actor.id);
      });
    syncQueues.set(actor.id, queued);
  };

  // Ids, not actors: this map outlives every burst and holding documents in it would keep deleted
  // ones alive. An actor that is gone by the time the flush runs simply is not found.
  //
  // The value is the set of conditions that burst actually put in question, because a sync now
  // reconciles ONLY those. Forcing all five on every write is what made a Warden's manual toggle
  // impossible: it was erased by whatever wrote to the actor next. The SRD needs that toggle —
  // `bestiary.md`'s Mind Blast paralyses a target whose DEX never moves, and a PC who is left
  // untreated after Critical Damage dies with STR above 0 (`core-rules.md`).
  const pendingSync = new Map();
  const flushSync = foundry.utils.debounce(() => {
    const batch = [...pendingSync];
    pendingSync.clear();
    for (const [id, owed] of batch) {
      const actor = game.actors.get(id);
      if (actor?.syncDerivedConditions) runSync(actor, owed);
    }
  }, 60);
  const syncConditions = (actor, ids) => {
    if (!actor?.id || !actor.syncDerivedConditions || !game.users.activeGM?.isSelf) return;
    const owed = pendingSync.get(actor.id) ?? new Set();
    for (const id of ids) owed.add(id);
    pendingSync.set(actor.id, owed);
    flushSync();
  };

  Hooks.on("updateActor", (actor, changed) => {
    const ids = new Set();
    const abilities = changed.system?.abilities;
    if (abilities?.STR?.value !== undefined) ids.add(CONDITION.DEAD);
    if (abilities?.DEX?.value !== undefined) ids.add(CONDITION.PARALYZED);
    if (abilities?.WIL?.value !== undefined) ids.add(CONDITION.DELIRIOUS);
    if (ids.size) syncConditions(actor, ids);
  });
  // An item coming or going can only move these two: the Fatigue itself, and the slot total.
  // Coin is an Item too (`data/item-coin.js`), so a purse that grows into the tenth slot arrives
  // here and not through the actor hook above.
  const ITEM_DERIVED = [CONDITION.FATIGUED, CONDITION.ENCUMBERED];
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, (item) => syncConditions(item.parent, ITEM_DERIVED));
  }
});

// Every ApplicationV2, because the render hook is called for each class in the inheritance chain
// and `ApplicationV2` is in all of them. The scope class is the test: it is on the root of every
// window this system opens, and on nothing core opens.
Hooks.on("renderApplicationV2", (app, element) => {
  if (element.classList.contains(SYSTEM_ID)) element.dataset.tooltipClass = TOOLTIP_CLASS;
});

Hooks.on("renderChatMessageHTML", async (message, html) => {
  // Every message in the log is drawn by this system's template, so the whole log is ours to
  // stamp — the message element already carries the scope class (see `CONFIG.ChatMessage.template`
  // in `init`), and this is what carries it through to a tooltip raised from inside a card.
  html.dataset.tooltipClass = TOOLTIP_CLASS;

  // The message element already carries the scope and the frame — `CONFIG.ChatMessage.template`
  // is this system's (see `init`), so there is nothing here to select or dress. What is left is
  // the wiring for the controls a card's body draws.

  // Critical Damage's STR save button (module/combat/damage.js posts it).
  const token = canvas?.scene?.tokens?.get(message.speaker?.token);
  const strSaveBtn = html.querySelector(".roll-str-save");
  if (strSaveBtn) {
    // A token whose Actor was deleted has `actor === null`; a throw here would leave every other
    // button on the card unwired.
    const canRoll = token?.actor && (token.actor.testUserPermission(game.user, "OWNER") || game.user.isGM);
    if (canRoll) {
      strSaveBtn.addEventListener("click", async () => {
        strSaveBtn.setAttribute("disabled", "disabled");
        await rolls.rollCriticalDamageSave(token.actor, token);
      });
    } else {
      // `hidden`, not a display value set from JS: core's `[hidden] { display: none !important }`
      // wins over this system's cascade layer, and a design value never belongs in a handler.
      strSaveBtn.hidden = true;
    }
  }

  // The Scars card's button (module/apps/scars.js posts it). The window opens by itself on the
  // owner's client when the hit lands; this is the way back in after it has been closed, or after
  // the player who owes the roll has logged in again. The actor comes from the message's own flag,
  // not from the speaker's token: a Scar can be rolled a session later, when that token is gone.
  const scarBtn = html.querySelector(".open-scars");
  if (scarBtn) {
    const scarActor = fromUuidSync(message.getFlag(SYSTEM_ID, "scarActor") ?? "");
    const hpLost = message.getFlag(SYSTEM_ID, "scarHpLost") ?? 1;
    if (scarActor && (scarActor.testUserPermission(game.user, "OWNER") || game.user.isGM)) {
      scarBtn.addEventListener("click", () => CairnScars.open(scarActor, { hpLost }));
    } else {
      scarBtn.hidden = true;
    }
  }

  // The journey's start card carries the way back into the tracker for a player who closed it.
  const journeyBtn = html.querySelector(".open-journey");
  if (journeyBtn) journeyBtn.addEventListener("click", () => CairnJourneyTracker.open());

  // "Apply damage" button on a damage-roll card (module/rolls.js posts it). GM-only.
  const applyBtn = html.querySelector(".apply-dmg");
  if (applyBtn) {
    if (game.user.isGM) {
      applyBtn.addEventListener("click", (event) => Damage.onClickChatMessageApplyButton(event, html, message));
    } else {
      applyBtn.hidden = true;
    }
  }

  // "Add to scene" button on an encounter-style RollTable draw card. GM-only; grows the
  // control only when the drawn rows parse as an encounter.
  await renderEncounterButton(message, html);
});

const configureHandleBar = () => {
  // Partials referenced by full path from the sheet templates. The per-part sheet templates
  // themselves are registered by the ApplicationV2 PARTS mechanism, not here.
  foundry.applications.handlebars.loadTemplates([
    `systems/${SYSTEM_ID}/templates/parts/slot-list.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/item-tags.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/item-uses.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/item-controls.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/attribute-row.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/toggle.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/slot-row.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/plain-list.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/party-row.hbs`,
    `systems/${SYSTEM_ID}/templates/parts/route-pick.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/encounter-card.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/journey-card.hbs`,
    `systems/${SYSTEM_ID}/templates/chat/roll-card.hbs`,
  ]);

  // No custom Handlebars helpers: upstream's nine were either presentation logic that now lives
  // in `_prepareContext` (`boldIf`, `markItemUsed`, `ifPrint`, `hidden`), dead (`isFatigue`,
  // `isNotNull`), or already provided by Foundry core (`not`, `eq`, `gt`, `select`, `checked`,
  // `disabled`, `editor`).
};

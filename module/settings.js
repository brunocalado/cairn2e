/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";
import { CairnJourneyTracker } from "./apps/journey-tracker.js";
import { CairnStore } from "./apps/store.js";
import { scanBestiaryArt, injectBestiaryArt } from "./bestiary-art.js";

/**
 * Register world settings.
 *
 * Deleted from upstream (each configured away a 2e rule):
 * - `use-panic` — Panic is core 2e, not optional (`procedures.md`).
 * - `use-gold-threshold` / `show-gold-not-cost` — a bag of coins < 100gp is *petty*, flat rule.
 * - `show-features-section` — the homegrown "features" mini-effects system is gone (Active Effects).
 * - `use-cairn-dice-notation` — two weapons / several attackers roll all dice and keep the highest
 *   (`core-rules.md`); that is the rule, not an option. `rolls.js#damageFormula` always applies it.
 * - `show-generate-header` — "Regenerate" is the Warden's by role (`game.user.isGM` in the
 *   character sheet's header controls), not a switch that, once on, showed it to players too.
 */
export const registerSettings = () => {
  // Hidden: not a rule toggle, the journey underway (module/journey.js). `onChange` runs on every
  // client core broadcasts the write to, the originator included, so this one line is what makes
  // the tracker live: whatever the Warden's client wrote, every open window redraws from it.
  game.settings.register(SYSTEM_ID, SETTINGS.JOURNEY, {
    scope: "world",
    config: false,
    type: Object,
    default: null,
    onChange: () => CairnJourneyTracker.refresh()
  });

  // Hidden: the record of the one-time world install (module/welcome.js), not a rule toggle.
  // World scope, because the scene it guards is the world's and not one client's.
  game.settings.register(SYSTEM_ID, SETTINGS.WELCOME_INSTALLED, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // Hidden: the record of the other one-time world install (module/token-defaults.js). What it
  // seeds lives in a CORE setting the Warden edits from Settings → Prototype Token Overrides;
  // this only remembers that we already had our say.
  game.settings.register(SYSTEM_ID, SETTINGS.TOKEN_DEFAULTS_INSTALLED, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // Hidden: which party the P key opens, in a world that may hold more than one. World scope,
  // because a group is the table's and not one client's — two players pressing P look at the
  // same sheet, which is the point of having the key at all.
  game.settings.register(SYSTEM_ID, SETTINGS.ACTIVE_PARTY, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // The Warden's own monster art (module/bestiary-art.js). Flipped mid-session it should not
  // wait for a reload: `scanBestiaryArt` guards on `isActiveGM` itself and publishes `null` when
  // the switch is off, which is what clears the art on every client.
  game.settings.register(SYSTEM_ID, SETTINGS.BESTIARY_ART, {
    name: "CAIRN.Settings.BestiaryArt.Name",
    hint: "CAIRN.Settings.BestiaryArt.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => scanBestiaryArt()
  });

  // A String with `filePicker: "folder"`, which core's Settings window draws as a folder picker;
  // a FilePathField refuses a folder.
  game.settings.register(SYSTEM_ID, SETTINGS.BESTIARY_ART_PATH, {
    name: "CAIRN.Settings.BestiaryArtPath.Name",
    hint: "CAIRN.Settings.BestiaryArtPath.Hint",
    scope: "world",
    config: true,
    type: String,
    default: `${SYSTEM_ID}-assets`,
    filePicker: "folder",
    onChange: () => scanBestiaryArt()
  });

  // Hidden: the scan's result, not a rule toggle. `onChange` runs on every client core broadcasts
  // the write to, the originator included — the same property `JOURNEY` above leans on — so this
  // one line is what puts the Warden's folder on the players' screens.
  game.settings.register(SYSTEM_ID, SETTINGS.BESTIARY_ART_MAP, {
    scope: "world",
    config: false,
    type: Object,
    default: null,
    onChange: (map) => injectBestiaryArt(map)
  });

  // Hidden: the Warden's saved stores (module/apps/store.js), not a rule toggle. Written on every
  // edit — there is no Save button and no draft to lose — and `onChange` is what puts a Warden's
  // mid-session edit on a player's open window, the way JOURNEY does above.
  game.settings.register(SYSTEM_ID, SETTINGS.STORES, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => CairnStore.refresh()
  });
};

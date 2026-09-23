/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";

/**
 * What a Cairn token shows, expressed as core's own Prototype Token Overrides.
 *
 * `base` applies to every Actor subtype and a named subtype overrides it, so the two entries read
 * as "this, except for a PC". Written into the CORE setting rather than into `CairnActor.create`
 * because core applies these in `PrototypeToken._initializeSource` and **overwrites** whatever the
 * source already held: anything the system hardcoded at creation would lose to this setting
 * anyway, silently, from a place the Warden cannot see. Here it is one value, in the window that
 * edits it — Settings → Prototype Token Overrides.
 *
 * `base.displayName` looks redundant at `NONE`, which is already core's default. It is not:
 * `applyOverrides` iterates the paths present in `base` and consults the subtype only for those,
 * so a path missing from `base` can never be overridden per subtype. Every path this system
 * decides has to appear here for the `character` entry below to be reachable at all.
 *
 * The three decisions:
 * - **Name** — a PC's is public (`HOVER`), and so is a party's: a group token is a boneless
 *   silhouette on the map and the name is the only thing that says which band it is. Anything
 *   else keeps core's silence.
 * - **Bars** — a PC's HP is public at the table (`HOVER`), a monster's is the Warden's
 *   (`OWNER_HOVER`). See `system.json`'s `primaryTokenAttribute` for which bar is which.
 * - **Artwork rotation** — locked for everything. Cairn art is drawn upright; a token that spins
 *   to face its movement reads as broken, not as facing.
 */
function overrides() {
  const MODES = CONST.TOKEN_DISPLAY_MODES;
  return {
    base: {
      lockRotation: true,
      displayName: MODES.NONE,
      displayBars: MODES.OWNER_HOVER
    },
    character: {
      displayName: MODES.HOVER,
      displayBars: MODES.HOVER
    },
    // No bars: `system.json`'s `primaryTokenAttribute` is `hp`, and a party has none — the bar
    // would be an empty rail under a token that cannot be hurt. The name alone.
    party: {
      displayName: MODES.HOVER,
      displayBars: MODES.NONE
    }
  };
}

/**
 * Seed a brand-new world's Prototype Token Overrides and its combat turn marker, once.
 *
 * The turn marker is the system's own art, written into core's `combatTrackerConfig` so it shows
 * in Combat Tracker Settings → Media Source as a value the Warden can replace or clear. It is
 * stored rather than set as `CONFIG.Combat.fallbackTurnMarker` on purpose: the fallback only
 * fills a blank field, invisibly, and a default the Warden cannot see is one they cannot change.
 * The rest of that setting is left at core's values (`mergeObject` over the current object), so
 * the animation and the disposition tint stay whatever core ships.
 *
 * "Once" is a world setting, not a comparison against the current value: a Warden who set these
 * back to core's defaults chose that, and re-seeding on the next launch would be the system
 * arguing with them. Flip `token-defaults-installed` back in the console to make it try again.
 *
 * Runs on the active GM alone — every client reaches `ready`, only a GM may write a world
 * setting, and two GMs online would otherwise race the same write.
 */
export async function installTokenDefaults() {
  if (!game.user.isActiveGM) return;
  if (game.settings.get(SYSTEM_ID, SETTINGS.TOKEN_DEFAULTS_INSTALLED)) return;

  try {
    await game.settings.set(SYSTEM_ID, SETTINGS.TOKEN_DEFAULTS_INSTALLED, true);
    await game.settings.set("core", "prototypeTokenOverrides", overrides());
    const combat = foundry.data.CombatConfiguration.CONFIG_SETTING;
    await game.settings.set("core", combat, foundry.utils.mergeObject(
      game.settings.get("core", combat),
      { turnMarker: { src: `systems/${SYSTEM_ID}/assets/turn-maker.webp` } },
      { inplace: false }
    ));
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not seed the token defaults`, err);
  }
}

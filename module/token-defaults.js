/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";

/**
 * What a new Actor's prototype token starts as, by subtype, as flat `prototypeToken` paths.
 *
 * Defaults, never rules: `CairnActor#_preCreate` writes them once, when the Actor is made, and
 * from then on every value is the Warden's to change in the token's own window. They are NOT
 * core's Prototype Token Overrides setting on purpose — core reapplies that setting in
 * `PrototypeToken._initializeSource` every time a token is read, so a field it names is locked
 * behind a warning in every prototype window and a change there never sticks. That setting also
 * cannot hold `sight.range` at all.
 *
 * - **Name** — a PC's is public (`HOVER`), and so is a party's: a group token is a boneless
 *   silhouette on the map and the name is the only thing that says which band it is. An NPC's
 *   shows to its owner on hover.
 * - **Bars** — a PC's HP is public at the table (`HOVER`), a monster's is the Warden's
 *   (`OWNER_HOVER`). A party has no HP, so no bar. See `system.json`'s `primaryTokenAttribute`.
 * - **Artwork rotation** — locked for everything. Cairn art is drawn upright; a token that spins
 *   to face its movement reads as broken, not as facing.
 * - **A PC or a party** is linked, friendly and sees. A PC sees 5 grid units without any light.
 *   Sight is `sight.enabled`: v14 has no `vision` field, and a key by that name is dropped in
 *   silence, leaving the PC blind.
 *
 * A function, not a constant, because `CONST` is not there when a pure-Node check imports this.
 * @param {string} type  the Actor subtype
 * @returns {Record<string, *>}
 */
export function tokenDefaults(type) {
  const MODES = CONST.TOKEN_DISPLAY_MODES;
  const own = {
    character: {
      displayName: MODES.HOVER,
      displayBars: MODES.HOVER,
      actorLink: true,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      "sight.enabled": true,
      "sight.range": 5
    },
    npc: {
      displayName: MODES.OWNER_HOVER,
      displayBars: MODES.OWNER_HOVER
    },
    party: {
      displayName: MODES.HOVER,
      displayBars: MODES.NONE,
      actorLink: true,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      "sight.enabled": true
    }
  };
  return { lockRotation: true, ...own[type] };
}

/**
 * Seed a brand-new world's combat turn marker, once.
 *
 * The turn marker is the system's own art, written into core's `combatTrackerConfig` so it shows
 * in Combat Tracker Settings → Media Source as a value the Warden can replace or clear. It is
 * stored rather than set as `CONFIG.Combat.fallbackTurnMarker` on purpose: the fallback only
 * fills a blank field, invisibly, and a default the Warden cannot see is one they cannot change.
 * The rest of that setting is left at core's values (`mergeObject` over the current object), so
 * the animation and the disposition tint stay whatever core ships.
 *
 * "Once" is a world setting, not a comparison against the current value: a Warden who set it
 * back to core's default chose that, and re-seeding on the next launch would be the system
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
    const combat = foundry.data.CombatConfiguration.CONFIG_SETTING;
    await game.settings.set("core", combat, foundry.utils.mergeObject(
      game.settings.get("core", combat),
      { turnMarker: { src: `systems/${SYSTEM_ID}/assets/turn-maker.webp` } },
      { inplace: false }
    ));
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not seed the turn marker`, err);
  }
}

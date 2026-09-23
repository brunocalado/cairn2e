/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";

/** The one foreign id this file talks to. */
const MODULE = "light-sources";

// Every value in these shapes is a default the Warden retunes in the module's own light editor,
// which is what its GM customization exists for. The rule is 40ft, and "beyond that only a dim
// outline of objects" (procedures.md § Light): 60 is that outline, and the bright 30 is the
// maintainer's call for how it reads on the map.
//
// v14's animation labels are crossed with their ids: `flame` is the one core's picker calls
// "Torch", and `torch` is the one it calls "Flickering Light" (`LIGHT.ANIMATION.*`).
const TORCH = {
  dim: 60, bright: 30, angle: 360, color: "#ff8800", alpha: 0.15,
  animation: { type: "flame", speed: 1, intensity: 1, reverse: false }
};
const LANTERN = { ...TORCH, alpha: 0.1, animation: { ...TORCH.animation, type: "torch" } };
// "dim" is the Candle Helmet's own word (fungal-forager.md).
const CANDLE = { ...TORCH, dim: 20, bright: 0 };
// Darkness draws from a separate animation set (the module's doc § negative). 20ft is the only
// darkness radius the SRD prints (dungeon-seeds.md).
const GLOOM = {
  dim: 20, bright: 20, angle: 360, color: null, alpha: 0.5, negative: true,
  animation: { type: "magicalGloom", speed: 3, intensity: 3, reverse: false }
};
// "A floating light" (spellbooks.md #44): the torch's radii and movement, in a paler colour and
// barely tinted.
const GLOW = { ...TORCH, color: "#f4f0e0", alpha: 0.05 };

const uuid = (pack, id) => `Compendium.${SYSTEM_ID}.${pack}.Item.${id}`;

/**
 * Every light source the system ships, keyed by the compendium document it registers. `name` is
 * that document's name, kept beside the uuid so the cast path (`lightSpell`) can find an entry
 * off a carried copy — which has no sourceId flag when the creator made it, because
 * `character-generator.js` copies `toObject()` without `_stats` or flags.
 * `checks/light-sources.check.mjs` holds name and uuid in step with the pack source.
 */
export const LIGHT_SOURCES = [
  { name: "Torch", uuid: uuid("gear", "38nboO4axGNV5vQC"), consume: true, light: TORCH },
  { name: "Lantern", uuid: uuid("gear", "lAOJ4KhINKHkQFKY"), consume: true, light: LANTERN },
  { name: "Candle Helmet", uuid: uuid("background-gear", "eFWBZIBDrdwE0I7x"), consume: true, light: CANDLE },
  { name: "Lightsucker Candle", uuid: uuid("relics", "CuRKq09QbCykPLcb"), consume: true, light: GLOOM },
  // Its cost is the Fatigue the cast already charged (core-rules.md § Casting Spells), which is
  // not a quantity: nothing is consumed, and the palette never offers it — only the cast lights it.
  { name: "Illuminate", uuid: uuid("spellbooks", "LPjbm6vE1WgTsqQi"), consume: false, coverable: true, hudHidden: true, light: GLOW }
];

/**
 * The module's API, or null. Its `ready` and ours are not ordered against each other, so the
 * object may not exist yet when ours runs (the module's doc, its race note): poll briefly.
 */
async function api(retries = 20, delayMs = 250) {
  for (let i = 0; i < retries; i++) {
    const found = game.modules.get(MODULE)?.api;
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/**
 * Hand the module the five sources, every session. Both calls write world settings, which only a
 * GM may — the module guards neither — so one client does it and the module dedupes by uuid. A
 * source the Warden has edited is frozen on the module's side and this never overwrites it.
 *
 * A source with one pattern never shows the pattern's name, so it is left empty rather than
 * given an English literal.
 */
export const registerLightSources = () => {
  Hooks.once("ready", async () => {
    if (!game.modules.get(MODULE)?.active || !game.user.isActiveGM) return;
    const ls = await api();
    if (!ls) {
      console.warn(`${SYSTEM_ID} | ${MODULE} is active but its API never became available`);
      return;
    }
    await ls.registerCompatibility({ itemTypes: ["gear"], quantityPath: "system.uses.value" });
    await ls.registerSources(
      LIGHT_SOURCES.map(({ name, light, ...usage }) => ({ ...usage, durationMinutes: 0, patterns: [{ name: "", light }] })),
      { managedBy: SYSTEM_ID }
    );
  });
};

/**
 * Light the source a just-cast spellbook is registered as, if any. Everything that makes the cast
 * a cast — the two hands, the Deprived save, the card, the Fatigue — has already run in the sheet;
 * this is only the flame. Silent when the module is absent or the book is no light. Found by name
 * because the carried copy's own uuid is `Actor.….Item.…`, never the compendium key the source is
 * registered under.
 */
export async function lightSpell(actor, item) {
  const entry = LIGHT_SOURCES.find((s) => s.name === item.name);
  if (!entry || !game.modules.get(MODULE)?.active) return;
  const ls = await api();
  if (ls) await ls.activate(actor, entry.uuid);
}

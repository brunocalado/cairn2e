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
 * Every light source the system ships, keyed by the compendium document it registers. A carried
 * copy is matched to its entry by `_stats.compendiumSource`, which every copy the system makes
 * keeps (`helpers.js#copyOf`) — never by name, because a translation module renames the document
 * and the copy with it. `checks/light-sources.check.mjs` holds each uuid to the pack source.
 *
 * A use in Cairn is one lighting of one object — "A torch can be lit 3 times before permanently
 * degrading" (procedures.md § Light) — never one torch out of a stack. So the four that spend are
 * "charge": the lit item is the flame, it goes where the item goes, and it goes out when the item
 * leaves any other way.
 */
export const LIGHT_SOURCES = [
  { uuid: uuid("gear", "38nboO4axGNV5vQC"), consume: "charge", light: TORCH },
  { uuid: uuid("gear", "lAOJ4KhINKHkQFKY"), consume: "charge", light: LANTERN },
  { uuid: uuid("background-gear", "eFWBZIBDrdwE0I7x"), consume: "charge", light: CANDLE },
  { uuid: uuid("relics", "CuRKq09QbCykPLcb"), consume: "charge", light: GLOOM },
  // Its cost is the Fatigue the cast already charged (core-rules.md § Casting Spells), which is
  // not a charge: nothing is spent, and the palette never offers it — only the cast lights it.
  { uuid: uuid("spellbooks", "LPjbm6vE1WgTsqQi"), consume: "none", coverable: true, hudHidden: true, light: GLOW }
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
 * Hand the module the five sources, on every client, every session. The module keeps registered
 * sources in memory on each client and writes nothing to the world, so a client that never
 * registers them never shows them in its Token HUD. `registerCompatibility` seeds world settings,
 * but only on a GM's client and only where nobody has set them yet; on a player's it does nothing.
 *
 * A source is keyed by its item uuid, and registering it again replaces it on this client. What
 * the Warden edits in the module's window is stored as the Warden's own copy and wins over these
 * defaults; a source the Warden removes stays removed until restored.
 *
 * Each source has one pattern, keyed by an id that is never shown and never translated. A
 * single-pattern source shows no label, so the pattern has no name rather than an English literal.
 */
export const registerLightSources = () => {
  Hooks.once("ready", async () => {
    if (!game.modules.get(MODULE)?.active) return;
    const ls = await api();
    if (!ls) {
      console.warn(`${SYSTEM_ID} | ${MODULE} is active but its API never became available`);
      return;
    }
    await ls.registerCompatibility({ itemTypes: ["gear"], chargesPath: "system.uses.value" });
    await ls.registerSources(
      LIGHT_SOURCES.map(({ light, ...usage }) => ({ ...usage, durationMinutes: 0, patterns: [{ id: "lit", light }] })),
      { managedBy: SYSTEM_ID }
    );
  });
};

/**
 * Light the source a just-cast spellbook is registered as, if any. Everything that makes the cast
 * a cast — the two hands, the Deprived save, the card, the Fatigue — has already run in the sheet;
 * this is only the flame. Silent when the module is absent or the book is no light. Found by the
 * copy's `_stats.compendiumSource`: its own uuid is `Actor.….Item.…`, never the compendium key the
 * source is registered under, and its name is whatever a translation made of it.
 */
export async function lightSpell(actor, item) {
  const entry = LIGHT_SOURCES.find((s) => s.uuid === item._stats?.compendiumSource);
  if (!entry || !game.modules.get(MODULE)?.active) return;
  const ls = await api();
  if (ls) await ls.activate(actor, entry.uuid);
}

/**
 * Move the light burning on something that just changed hands onto its copy, so a lit torch given
 * to another character arrives lit and the giver goes dark. Called after the copies exist and
 * before the originals are deleted: deleting a burning original first puts its light out, and
 * there would be nothing left to move. Called by the giver, because the module's GM side moves a
 * light only off an actor the requester owns.
 *
 * Only the four lights that are objects travel. Illuminate is "a floating light [that] moves as
 * you command" — the caster's, not the book's — so its book leaves without it, and the removal
 * puts it out as any removal does.
 * @param {Actor} giver
 * @param {Record<string, string>} arrived  Each landed source id → the uuid of the copy made of it.
 */
export async function carryLight(giver, arrived) {
  if (!game.modules.get(MODULE)?.active) return;
  const ls = await api();
  const burning = ls?.getActive(giver)?.itemId;
  const from = burning && arrived[burning] ? giver.items.get(burning) : null;
  const entry = LIGHT_SOURCES.find((s) => s.uuid === from?._stats?.compendiumSource);
  if (entry?.consume !== "charge") return;
  const to = await foundry.utils.fromUuid(arrived[burning]);
  const { lit } = await ls.handOverLight(from, to);
  if (!lit) ui.notifications.warn(game.i18n.localize("CAIRN.Barter.LightOut", { item: from.name, name: to.parent.name }));
}

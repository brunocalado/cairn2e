/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";

/**
 * Hand Automated Animations the system's entries, once AA is ready to take them.
 *
 * `aa.initialize` is the last thing AA's own `ready` does, after it registers the Automatic
 * Recognition settings and migrates them; the system's `ready` runs before AA's, when reading
 * those settings would throw. The hook never fires without the module, so this is a no-op in a
 * world that lacks it — no module-presence probe needed.
 */
export const registerAutomatedAnimations = () => {
  Hooks.once("aa.initialize", deliverAnimations);
};

/**
 * AA's own label key: its merge and its search both compare labels with the whitespace removed
 * and the case folded, so "Long Sword" and "longsword" are one entry to it.
 * @param {string} label
 * @returns {string}
 */
const rinse = (label) => label.replace(/\s+/g, "").toLowerCase();

/**
 * Add every entry of the system's menu that this world has never been given.
 *
 * AA's `mergeMenus` adds an entry only when its menu holds no entry of the same rinsed label, and
 * never changes or removes one — read in AA 7.1.3's `AAAutorecManager.mergeMenus`. That keeps a
 * Warden's edit, but not a deletion: merged again, a deleted entry comes back. So the system
 * remembers what it delivered and never offers it twice, and a later version adds only its new
 * entries. A label the Warden already had counts as delivered, and theirs is the one that stays.
 *
 * AA announces each menu it merges, so only the menus with something new are named.
 *
 * A translation adds its own names through the `cairn2e.animationLabels` hook
 * (`docs/translating.md`), called here so that everything arrives in ONE merge: AA writes its
 * settings without awaiting them, and a second merge started before the first had landed would
 * read the old menu and write it back without the first one's entries.
 *
 * Runs on the active GM alone — only a GM may write a world setting, and two GMs online would
 * otherwise race the same write.
 */
export async function deliverAnimations() {
  if (!game.user.isActiveGM) return;
  if (!game.modules.get("autoanimations")?.active) return;
  if (!game.settings.get(SYSTEM_ID, SETTINGS.ANIMATIONS)) return;

  try {
    // Loaded only here: a world without AA never fetches the menu.
    const { animationMenu, AUTOREC_VERSION } = await import("./automated-animations-menu.js");
    const aliases = {};
    Hooks.callAll(`${SYSTEM_ID}.animationLabels`, aliases);

    const delivered = new Set(game.settings.get(SYSTEM_ID, SETTINGS.ANIMATIONS_DELIVERED));
    const menu = { version: AUTOREC_VERSION };
    const menus = {};
    const fresh = [];
    for (const entry of animationMenu(aliases)) {
      const key = `${entry.menu}:${rinse(entry.label)}`;
      if (delivered.has(key)) continue;
      (menu[entry.menu] ??= []).push(entry);
      menus[entry.menu] = true;
      fresh.push(key);
    }
    if (!fresh.length) return;

    await AutomatedAnimations.AutorecManager.mergeMenus(menu, menus);
    await game.settings.set(SYSTEM_ID, SETTINGS.ANIMATIONS_DELIVERED, [...delivered, ...fresh]);
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not add the Automated Animations entries`, err);
  }
}

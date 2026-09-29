/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS, MACROS } from "./constants.js";

/**
 * A new player's first hotbar page: the three saves up front, the Die of Fate beside them, and the
 * two rest macros at the far end, where they are not pressed by accident. Slot 10 is the one the
 * hotbar labels "0". These are also the macros a player may see and run; the rest of the pack
 * (Morale, Reactions) is the Warden's.
 */
const PLAYER_HOTBAR = {
  1: MACROS.STR,
  2: MACROS.DEX,
  3: MACROS.WIL,
  4: MACROS.DIE_OF_FATE,
  9: MACROS.REST,
  10: MACROS.RESTORE_ABILITIES
};

/**
 * Import every macro of `cairn2e.macros` into a "Cairn 2e" folder of a brand-new world, once.
 *
 * Players need world copies: a hotbar slot holds a world Macro id, never a compendium uuid. The
 * player macros are imported at Observer, which is enough to run them (`Macro#canUserExecute`
 * asks for Limited) and not enough to edit them; the Warden's stay private.
 *
 * "Once" is a world setting written before anything is created, like the Welcome scene's
 * (`module/welcome.js`): a Warden who deletes the folder is not asking for it back. Flip
 * `macros-installed` back in the console to make it try again. Runs on the active GM alone.
 */
export async function installWorldMacros() {
  if (!game.user.isActiveGM) return;
  if (game.settings.get(SYSTEM_ID, SETTINGS.MACROS_INSTALLED)) return;

  try {
    await game.settings.set(SYSTEM_ID, SETTINGS.MACROS_INSTALLED, true);

    const pack = game.packs.get(`${SYSTEM_ID}.macros`);
    const folder = await Folder.create({
      name: game.i18n.localize("CAIRN.MacroFolder"),
      type: "Macro"
    });
    const player = new Set(Object.values(PLAYER_HOTBAR));
    const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const data = (await pack.getDocuments()).map(doc => {
      const macro = game.macros.fromCompendium(doc);
      macro.folder = folder.id;
      if (player.has(doc.uuid)) macro.ownership.default = OBSERVER;
      return macro;
    });
    await Macro.createDocuments(data);
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not import the system macros`, err);
  }
}

/**
 * Fill a newly created player's hotbar with the world copies of the player macros.
 *
 * Every client sees `createUser`; only the active GM writes, and a GM seat keeps an empty bar —
 * the Warden rolls Morale and Reactions, not saves. A macro the Warden deleted leaves its slot
 * empty rather than failing the rest.
 * @param {User} user
 */
export async function seedPlayerHotbar(user) {
  if (!game.user.isActiveGM || user.isGM) return;
  const hotbar = {};
  for (const [slot, uuid] of Object.entries(PLAYER_HOTBAR)) {
    const macro = game.macros.find(m => m._stats.compendiumSource === uuid);
    if (macro) hotbar[slot] = macro.id;
  }
  if (!foundry.utils.isEmpty(hotbar)) await user.update({ hotbar });
}

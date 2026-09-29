/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS, FLAGS, MACROS } from "./constants.js";

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
 * Put the player macros on this player's hotbar, the first time they log in.
 *
 * The player's own client writes it, not a GM listening for `createUser`: a user made in User
 * Management (`/players`) is created where no system code runs, and the GM who made it is not
 * in the world to hear it. A player may update their own User, so this covers every way a seat
 * is added. Only empty slots are filled, and only once (`FLAGS.HOTBAR_SEEDED`). If the Warden has
 * not launched the world yet there is nothing to place, so the flag waits for a login that finds
 * the macros.
 */
export async function seedPlayerHotbar() {
  const user = game.user;
  if (user.isGM || user.getFlag(SYSTEM_ID, FLAGS.HOTBAR_SEEDED)) return;
  const hotbar = {};
  for (const [slot, uuid] of Object.entries(PLAYER_HOTBAR)) {
    if (user.hotbar[slot]) continue;
    const macro = game.macros.find(m => m._stats.compendiumSource === uuid);
    if (macro) hotbar[slot] = macro.id;
  }
  if (foundry.utils.isEmpty(hotbar)) return;
  await user.update({ hotbar, [`flags.${SYSTEM_ID}.${FLAGS.HOTBAR_SEEDED}`]: true });
}

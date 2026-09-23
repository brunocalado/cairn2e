/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";

/**
 * The d20 model Dice So Nice rolls for this system. A `modelFile` preset replaces the
 * labels/bump-map pipeline entirely: the `.glb` carries its own geometry, materials and emissive
 * textures, so a player's font and colour choices do not apply to it — everything visible is in
 * the file (`assets/README.md` § Cairn d20).
 */
export const D20_MODEL = `systems/${SYSTEM_ID}/assets/dice/cairn-d20.glb`;

/**
 * Register the Cairn d20 with Dice So Nice, when the module is present.
 *
 * `diceSoNiceReady` never fires without the module, so this is a no-op in a world that lacks it —
 * no module-presence probe needed. Registered as `"preferred"`: every user who has never
 * saved a Dice So Nice appearance of their own rolls this d20, and the moment they pick anything
 * else under *Dice Presets* their choice wins (DsN checks the `dice-so-nice.appearance` user flag
 * before falling back to the preferred system). Only the d20 is overridden; every other die type
 * falls through to the standard Dice So Nice models.
 */
export const registerDiceSoNice = () => {
  Hooks.once("diceSoNiceReady", (dice3d) => {
    dice3d.addSystem(
      {
        id: SYSTEM_ID,
        name: game.i18n.localize("CAIRN.Dice.Preset"),
        group: game.i18n.localize("CAIRN.Dice.Group")
      },
      "preferred"
    );
    dice3d.addDicePreset({ type: "d20", modelFile: D20_MODEL, system: SYSTEM_ID });
  });
};

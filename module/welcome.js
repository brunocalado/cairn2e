/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";

/** The Scene the system ships, as data. Cleaned of the `thumb`/`_stats` of the world it came from
 *  — re-export over it from a client and strip those two again. */
const SCENE_DATA = `systems/${SYSTEM_ID}/scenes/welcome.json`;

/** The track the welcome Playlist holds. Credited in docs/CREDITS.md. */
const MUSIC = `systems/${SYSTEM_ID}/assets/welcome.ogg`;

/**
 * Give a brand-new world the Welcome scene, the Playlist it plays, and a Warden, once.
 *
 * "Once" is a world setting rather than `game.scenes.size === 0`: a Warden who deletes the scene
 * is not asking for it back on the next launch, and an emptied world is not the same thing as a
 * new one. The setting is written BEFORE anything is created, so a failure halfway leaves one
 * orphaned document to delete rather than a new pair on every launch — flip
 * `welcome-installed` back in the console to make it try again.
 *
 * Runs on the active GM alone. Every connected client reaches `ready`, only a GM may create a
 * Scene at all, and two GMs online would otherwise race the same pair of documents.
 */
export async function installWelcomeWorld() {
  if (!game.user.isActiveGM) return;
  if (game.settings.get(SYSTEM_ID, SETTINGS.WELCOME_INSTALLED)) return;

  try {
    await game.settings.set(SYSTEM_ID, SETTINGS.WELCOME_INSTALLED, true);

    // The server names the world's first GM "Gamemaster" (or "Gamemaster1" if that was taken).
    // Cairn calls that seat the Warden. Only the server's own default is renamed: a GM who has
    // already chosen a name keeps it.
    if (/^Gamemaster\d*$/.test(game.user.name)) {
      await game.user.update({ name: game.i18n.localize("CAIRN.WardenUserName") });
    }

    // The Playlist first: the Scene's `playlist` is a ForeignDocumentField, so it needs an id that
    // already exists. One sound, repeating — a title theme that stops after three minutes reads
    // as a bug, and `Playlist#playAll` (what core calls when the scene activates) does not loop.
    const name = game.i18n.localize("CAIRN.WelcomePlaylist");
    const playlist = await Playlist.create({
      name,
      sounds: [{ name, path: MUSIC, repeat: true }]
    });

    const data = await foundry.utils.fetchJsonWithTimeout(SCENE_DATA);
    // `playlist` alone, no `playlistSound`: core's `PlaylistCollection#_onChangeScene` starts the
    // whole playlist when the scene is activated, and names a single sound only to pin one.
    const scene = await Scene.create({ ...data, playlist: playlist.id });
    await scene.activate();
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not install the Welcome scene`, err);
  }
}

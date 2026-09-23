/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "./constants.js";

/**
 * The Warden's own bestiary art, laid over `cairn2e.bestiary` without writing the pack.
 *
 * Core's Compendium Art (`client/helpers/media/compendium-art.mjs`) is a `Map` of
 * `uuid → { img, token }` that `Actor#_initializeSource` consults through `applyArt` for every
 * document built from a pack — a canvas drop, an encounter import — writing `img` onto the source
 * and a string `token` onto `prototypeToken.texture.src`. The pack's database is never touched and
 * stays locked, and removing the entry undoes it. That reversibility is why the art goes through
 * this layer rather than into the LevelDB.
 *
 * Core fills the map from a manifest flag fetched before `setup`, which is too early for a folder
 * a client browses. So the Warden's client scans the folder at `ready` (and whenever a setting
 * flips), publishes the match as a hidden world setting, and every client — the players cannot
 * browse `Data/` themselves — injects what was published into the map.
 */

const BESTIARY_PACK_ID = `${SYSTEM_ID}.bestiary`;

/** "Blink Dog", "Blink-Dog", "blink_dog" and "BLINK  DOG" are one name. */
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A browse result is a URL path, so the basename is decoded before it is compared. */
const fileSlug = (path) => slug(decodeURIComponent(path.split("/").pop()).replace(/\.[^.]*$/, ""));

/**
 * Match files to bestiary Actors by name. Pure — no `foundry.*`, no `game` — so
 * `checks/bestiary-art.check.mjs` can drive it.
 *
 * One file per monster and no wildcard: `Blink-Dog.webp`, `blink dog.png` and `Blink_Dog.webp`
 * all name "Blink Dog"; `Blink-Dog-2.webp` names nothing. A browse result is a URL path, so the
 * basename is percent-decoded before it is compared (`Giant%20Scorpion.webp`), and the raw path
 * is what gets stored. A second file for the same monster is a `console.warn` and the first in
 * browse order wins — the no-wildcard rule made visible rather than silent.
 *
 * @param {Iterable<{ _id: string, name: string }>} index
 * @param {{ portraits?: string[], tokens?: string[] }} files   browse results, full paths
 * @returns {Record<string, { img?: string, token?: string }>}  by Actor id; a monster with no
 *   file in either folder has no entry
 */
export function planBestiaryArt(index, files) {
  const byName = new Map();
  for (const { _id, name } of index) byName.set(slug(name), { _id, name });
  const map = {};
  for (const [folder, key] of [["portraits", "img"], ["tokens", "token"]]) {
    for (const path of files[folder] ?? []) {
      const actor = byName.get(fileSlug(path));
      if (!actor) continue;
      const art = (map[actor._id] ??= {});
      if (art[key]) {
        console.warn(`${SYSTEM_ID} | bestiary art: "${path}" is a second ${folder} file for "${actor.name}" and is ignored`);
        continue;
      }
      art[key] = path;
    }
  }
  return map;
}

/**
 * Warden's half: browse the folder, match, and publish the answer as the hidden world setting —
 * or `null` when the switch is off. Active GM only; a write that changes nothing is skipped so a
 * quiet world load stays quiet.
 */
export async function scanBestiaryArt() {
  if (!game.user.isActiveGM) return;
  const pack = game.packs.get(BESTIARY_PACK_ID);
  if (!pack) return;
  let map = null;
  if (game.settings.get(SYSTEM_ID, SETTINGS.BESTIARY_ART)) {
    const root = game.settings.get(SYSTEM_ID, SETTINGS.BESTIARY_ART_PATH).replace(/\/+$/, "");
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation
      ?? foundry.applications.apps.FilePicker;
    const extensions = Object.keys(CONST.IMAGE_FILE_EXTENSIONS).map((e) => `.${e}`);
    const browse = async (sub) => {
      try {
        return (await FilePickerClass.browse("data", `${root}/${sub}`, { extensions })).files;
      } catch {
        return []; // no such folder is "nothing to lay over", not an error
      }
    };
    const files = { portraits: await browse("portraits"), tokens: await browse("tokens") };
    map = planBestiaryArt(pack.index, files);
  }
  const current = game.settings.get(SYSTEM_ID, SETTINGS.BESTIARY_ART_MAP);
  if (foundry.utils.equals(current ?? {}, map ?? {})) return;
  await game.settings.set(SYSTEM_ID, SETTINGS.BESTIARY_ART_MAP, map);
}

/**
 * The `img` each index entry carried before this module first overwrote it, by Actor id — the
 * database's own picture, or a lower-priority module's manifest art. Switching off puts it back.
 * Held here rather than re-read from the server because `CompendiumCollection#getIndex` returns
 * its cached index once the core fields are indexed, which they are from construction: a second
 * call never re-fetches and its "Restore compendium art" loop never re-runs.
 */
const underneath = new Map();

/**
 * Every client's half: lay `map` over `cairn2e.bestiary` through core's Compendium Art map, and
 * onto the pack's index so the compendium window shows it now rather than on the next reload.
 * `null` clears both and the index entries get back what they carried.
 *
 * Two core sites are what this relies on: `Actor#_initializeSource` calls `applyArt` for a
 * document built from the pack, which is the canvas drop and the encounter import; and the
 * compendium window renders from `pack.index`, whose entries core's own manifest route mutates
 * exactly this way (`#parseArtMapping` in `compendium-art.mjs` writes `entry.img`).
 */
export function injectBestiaryArt(map) {
  const pack = game.packs.get(BESTIARY_PACK_ID);
  if (!pack) return;
  for (const entry of pack.index) {
    const uuid = pack.getUuid(entry._id);
    const art = map?.[entry._id];
    if (art) game.compendiumArt.set(uuid, art);
    else game.compendiumArt.delete(uuid);
    if (!underneath.has(entry._id)) underneath.set(entry._id, entry.img);
    entry.img = art?.img ?? underneath.get(entry._id);
  }
  pack.render(false);
}

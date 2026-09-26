/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { WARDEN_PACK_ID } from "./constants.js";

/**
 * Enrich authored HTML for display, with secrets shown to whoever owns the document it belongs to.
 * @param {string} html
 * @param {ClientDocument} [relativeTo]
 * @returns {Promise<string>}
 */
export function enrich(html, relativeTo) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", {
    relativeTo,
    secrets: relativeTo?.isOwner ?? false
  });
}

/**
 * The pack with its documents in the collection, fetched only when the collection is not already
 * complete. `CompendiumCollection#getDocuments` never reads the collection first — it downloads
 * the whole pack every call — and every generator in the system used to call it once per roll,
 * so one NPC was ~16 serial downloads of the same packs. Foundry empties a CompendiumCollection
 * five minutes after its last access and keeps only the documents whose sheet is open, so "has
 * documents" is not "has all of them": the index is built at boot and never flushed, and the
 * collection is whole when it is the index's size.
 * @param {string} packId
 * @returns {Promise<CompendiumCollection|null>}
 */
export const loadPack = async (packId) => {
  const pack = game.packs.get(packId);
  if (!pack) return null;
  if (pack.size !== pack.index.size) await pack.getDocuments();
  return pack;
};

/**
 * The document a compendium uuid names, read out of its pack's collection through
 * {@link loadPack} — so a pack is still fetched once per session, not once per lookup, which is
 * what `fromUuid` would do for a document the collection has not cached yet. `null` when the uuid
 * names no pack or no document in it.
 * @param {string} uuid  `Compendium.<system>.<pack>.<Type>.<id>`
 * @returns {Promise<ClientDocument|null>}
 */
export async function fromPack(uuid) {
  const { collection, id } = foundry.utils.parseUuid(uuid) ?? {};
  if (!collection?.collection) return null;
  return (await loadPack(collection.collection))?.get(id) ?? null;
}

/**
 * A RollTable by name, world copy first, then the packs in order — the standing convention every
 * table draw in the system obeys, because a world table whose name matches exactly is how a
 * Warden's edits survive a system update.
 * @param {string} name
 * @param {string[]} [packIds]
 * @returns {Promise<RollTable|null>}
 */
export async function findTable(name, packIds = [WARDEN_PACK_ID]) {
  let table = game.tables?.getName?.(name) ?? null;
  for (const packId of packIds) {
    if (table) break;
    table = (await loadPack(packId))?.getName(name) ?? null;
  }
  return table;
}

/**
 * Roll one Warden table by name, **world first**: a world RollTable whose name matches exactly
 * wins over the `cairn2e.warden` compendium copy, so a Warden's edits survive a system update
 * — every generator in the system draws this way. Uses `RollTable#roll()`, never `draw()` —
 * drawing dirties the table's `drawn` state and posts a card; the generators just want a value.
 * @param {string} name
 * @returns {Promise<{ total: number|null, text: string, results: object[] } | null>}
 */
export const rollWardenTable = async (name) => {
  const table = await findTable(name);
  if (!table) return null;
  const { roll, results } = await table.roll();
  return {
    total: roll?.total ?? null,
    text: String(results?.[0]?.description ?? "").trim(),
    results: results ?? []
  };
};

/** Roll one Warden table and return its plain-text result ("" if the table is missing). */
export const rollWardenText = async (name) => stripTags((await rollWardenTable(name))?.text);

/** Authored HTML as one run of plain text, trimmed. */
export const stripTags = (html) => String(html ?? "").replace(/<[^>]+>/g, "").trim();

/**
 * An actor's three attributes as the rows a sheet or a form draws. The ability keys ARE their
 * labels — `en.json` defines "STR", "DEX" and "WIL" at the root.
 * @param {object} system  an actor's system
 * @returns {{ key: string, value: number, max: number }[]}
 */
export const abilityRows = (system) =>
  Object.entries(system.abilities).map(([key, { value, max }]) => ({ key, value, max }));

/** One element of a list, at random. */
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * A document's data, ready to be created somewhere else — out of a compendium, a sidebar or
 * another actor onto an actor. The id goes (core would refuse a clash), and so do the folder, the
 * ownership and the sort of the collection it came from.
 *
 * One piece of provenance is kept: `_stats.compendiumSource`. It is how a carried Torch still
 * knows it is the pack's Torch after a translation module renames it, which a name cannot do. A
 * document straight out of a pack is its own source; a copy of a copy keeps the original's.
 * @param {ClientDocument} doc
 * @returns {object}
 */
export function copyOf(doc) {
  const obj = doc.toObject();
  const source = doc.pack ? doc.uuid : (doc._stats?.compendiumSource ?? null);
  for (const key of ["_id", "_stats", "folder", "ownership", "sort"]) delete obj[key];
  if (source) obj._stats = { compendiumSource: source };
  return obj;
}

/**
 * Resolve the actor and item a drop refers to. v14 drop data always carries a `uuid` — the old
 * V9/V10 `sceneId`/`actorId`/`data._id` branches are gone (alpha: no back-compat).
 * @param {Object} dropData
 * @return {Promise<{actor: Actor, item: Item}>}
 */
export const getInfoFromDropData = async (dropData) => {
  const item = dropData.uuid ? await fromUuid(dropData.uuid) : null;
  return { actor: item?.actor ?? null, item };
};

/* -------------------------------------------- */
/*  Compendium helpers                          */
/*  Consumed by the character generator.       */
/* -------------------------------------------- */

/**
 * @param {String} compendiumName
 * @param {String} itemName
 * @returns {Promise.<Item|RollTable|undefined>}
 */
export const findCompendiumItem = async (compendiumName, itemName) => {
  const pack = await loadPack(compendiumName);
  if (!pack) {
    console.warn(`findCompendiumItem: no compendium "${compendiumName}"`);
    return undefined;
  }
  const item = pack.getName(itemName);
  if (!item) console.warn(`findCompendiumItem: no "${itemName}" in "${compendiumName}"`);
  return item;
};

/**
 * @param {String} compendiumName
 * @param {String} tableName
 * @param {Object} options
 * @returns {Promise.<RollTableDraw>}
 */
export const drawTable = async (compendiumName, tableName, options = {}) => {
  const table = await findCompendiumItem(compendiumName, tableName);
  return table.draw({ displayChat: false, ...options });
};

/**
 * @param {String} compendium
 * @param {String} table
 * @returns {Promise.<String>}
 */
export const drawTableText = async (compendium, table) =>
  (await drawTable(compendium, table)).results[0].description;

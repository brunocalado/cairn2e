/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

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
 * A Warden table, world copy first: the Warden's own copy is the world RollTable IMPORTED from
 * ours — core stamps `_stats.compendiumSource` on import — and it wins over the pack's, whatever
 * it is called, so a Warden's edits survive a system update. Never by name: a name is what a
 * translation module changes, on our table and on the Warden's copy alike. A Warden who imported
 * the same table twice gets the first copy, as `getName` used to give the first of two names.
 * @param {string} uuid  the pack table's uuid, a {@link TABLES} member
 * @returns {Promise<RollTable|null>}
 */
export async function findTable(uuid) {
  return game.tables?.find((t) => t._stats.compendiumSource === uuid) ?? fromPack(uuid);
}

/**
 * Roll one Warden table, **world copy first** ({@link findTable}) — every generator in the system
 * draws this way. Uses `RollTable#roll()`, never `draw()` — drawing dirties the table's `drawn`
 * state and posts a card; the generators just want a value.
 * @param {string} uuid  a {@link TABLES} member
 * @returns {Promise<{ total: number|null, text: string, results: object[] } | null>}
 */
export const rollWardenTable = async (uuid) => {
  const table = await findTable(uuid);
  if (!table) return null;
  const { roll, results } = await table.roll();
  return {
    total: roll?.total ?? null,
    text: String(results?.[0]?.description ?? "").trim(),
    results: results ?? []
  };
};

/** Roll one Warden table and return its plain-text result ("" if the table is missing). */
export const rollWardenText = async (uuid) => stripTags((await rollWardenTable(uuid))?.text);

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
 * Draw a pack table silently — the character's own tables, which are read from the pack alone.
 * @param {string} uuid  a {@link TABLES} or {@link TRAIT_TABLES} member
 * @param {Object} options
 * @returns {Promise.<RollTableDraw>}
 */
export const drawTable = async (uuid, options = {}) => {
  const table = await fromPack(uuid);
  return table.draw({ displayChat: false, ...options });
};

/**
 * @param {string} uuid  a {@link TABLES} or {@link TRAIT_TABLES} member
 * @returns {Promise.<String>}
 */
export const drawTableText = async (uuid) => (await drawTable(uuid)).results[0].description;

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { EDIT_LIMITS } from "./constants.js";

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
 * A pack's documents with the world's laid over them, by the rule {@link findTable} follows: a
 * world document imported from one of them is the Warden's edit of it and stands in its place;
 * every other world document is added. By provenance, never by name.
 * @param {{uuid: string}[]} shipped
 * @param {{_stats?: {compendiumSource?: string|null}}[]} world
 * @returns {object[]}  unsorted
 */
export function withWorldCopies(shipped, world) {
  const replaced = new Set(world.map((d) => d._stats?.compendiumSource).filter(Boolean));
  return [...shipped.filter((d) => !replaced.has(d.uuid)), ...world];
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

/** A number as a field of `digits` digits stores it: whole, and between 0 and what they can say. */
export function clampDigits(value, digits) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 10 ** digits - 1) : 0;
}

/** A maximum as a form stores it: whole, and between 0 and 99 (`EDIT_LIMITS.statDigits`). */
export const clampStat = (value) => clampDigits(value, EDIT_LIMITS.statDigits);

/**
 * Hold a text field to digits, at most `digits` of them, as they are typed and as they are pasted.
 *
 * A number field is a TEXT input with `maxlength` and `inputmode="numeric"`, not `type="number"`:
 * `maxlength` does not apply to a number input, which also lets `e`, `-` and `.` through to arrive
 * as NaN and fail the DataModel's own check. The field simply does not take the character.
 *
 * The field keeps what it already has when nothing needs cutting, so the caret does not jump on
 * every keystroke — assigning `value` at all would move it to the end of the line.
 */
export function digitsOnly(input, digits) {
  input?.addEventListener("input", () => {
    const clean = input.value.replace(/\D+/g, "").slice(0, digits);
    if (input.value !== clean) input.value = clean;
  });
}

/**
 * Why the HP an attribute row prints is 0 when the stored HP is not: Encumbered or Panic holds an
 * actor at 0 while it lasts (`character-creation.md`, `procedures.md`), and the stored value is
 * kept for when it ends (`data/actor-character.js`). An NPC is never Panicked here, so only
 * Encumbered reaches one.
 * @param {object} system  an actor's system
 * @returns {{ tooltip: string }|null}  null while the row prints the stored HP
 */
export function hpZero(system) {
  if (system.hp.value === 0) return null;
  const by = [system.panicked && "Panicked", system.encumbered && "Encumbered"].filter(Boolean);
  if (!by.length) return null;
  return { tooltip: game.i18n.localize(`CAIRN.HpZero.${by.length > 1 ? "Both" : by[0]}`, { hp: system.hp.value }) };
}

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
 * The prose of one draw. A table whose faces also grant documents (the Bonds) draws them beside
 * the `text` result, on the same range, so the prose is looked for rather than assumed first.
 * @param {string} uuid  a {@link TABLES} or {@link TRAIT_TABLES} member
 * @returns {Promise.<String>}
 */
export const drawTableText = async (uuid) =>
  (await drawTable(uuid)).results.find((r) => r.type === "text")?.description ?? "";

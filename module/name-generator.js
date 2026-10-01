/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, TABLES, NAME_TERRAIN_SEE } from "./constants.js";
import { findTable, rollWardenTable, pick, stripTags } from "./helpers.js";

/**
 * The Naming Procedures (`srd-2e/wardens-guide/naming-procedures.md`): a name for a place, a
 * region of a terrain, a faction, a realm or a forest. No UI here — the window
 * (`apps/name-generator.js`) and the Faction generator both call it.
 *
 * Every word comes from a RollTable in `cairn2e.warden`, rolled world copy first
 * (`helpers.js#rollWardenTable`), so a Warden's imported copy wins and a translation module
 * translates the words like any other table. Word ORDER is not in the tables: a formula row is
 * found by `flags.cairn2e.formula` and assembled with `CAIRN.NameGen.Formula.<n>` (or `<n>Bare`,
 * without the optional articles), so a translation owns its order and its articles. Which parts a
 * formula uses is read off that same string's placeholders.
 *
 * A name is a plain object, so the window can keep it, reroll one part of it and recompose it:
 * `{ kind, formula, poi, terrain, parts: { formula?, adjective?, noun?, slot? } }`, each part
 * `{ total, text, swapped? }` — `total` the die's face, or `null` for a part that was picked or
 * typed rather than rolled.
 */

/** The five kinds, in the window's tab order. */
export const NAME_KINDS = ["place", "terrain", "faction", "realm", "forest"];

/** Per kind: the formula table and where the slot comes from. */
const KINDS = {
  place: { formula: TABLES.NAME_FORMULA, slot: "poi" },
  terrain: { formula: TABLES.NAME_FORMULA, slot: "terrain" },
  faction: { formula: TABLES.FACTION_NAME_FORMULA, slot: TABLES.GROUP_TYPE },
  realm: { formula: TABLES.RULER_NAME_FORMULA, slot: TABLES.RULER_TYPE },
  forest: { formula: null, slot: null }
};

/** The terrain a key stands for — Jungle rolls the Forest's synonyms, and so on. */
export const terrainTarget = (key) => NAME_TERRAIN_SEE[key] ?? key;

/**
 * The terrains the generator offers, as `CAIRN.NameGen.Terrain.<key>` keys: every terrain the
 * Terrain Synonym table carries a result for, plus the three "See …" rows.
 * @returns {Promise<string[]>}
 */
export async function terrainKeys() {
  const table = await findTable(TABLES.TERRAIN_SYNONYM);
  const keys = new Set(table?.results.map((r) => r.flags?.[SYSTEM_ID]?.terrain).filter(Boolean) ?? []);
  for (const key of Object.keys(NAME_TERRAIN_SEE)) keys.add(key);
  return [...keys];
}

/** A random synonym of a terrain, picked rather than rolled: the SRD gives the table no die. */
async function synonym(terrain) {
  const table = await findTable(TABLES.TERRAIN_SYNONYM);
  const target = terrainTarget(terrain);
  const rows = table?.results.filter((r) => r.flags?.[SYSTEM_ID]?.terrain === target) ?? [];
  if (!rows.length) return { total: null, text: "" };
  return { total: null, text: stripTags(pick(rows).description) };
}

/** One rolled word. */
async function rolled(uuid) {
  const r = await rollWardenTable(uuid);
  return { total: r?.total ?? null, text: stripTags(r?.text) };
}

/** The placeholders a formula string uses: which parts this name needs. */
function partsUsed(name) {
  if (name.kind === "forest") return ["adjective", "noun"];
  const raw = game.i18n.localize(`CAIRN.NameGen.Formula.${name.formula}`);
  return ["adjective", "noun", "slot"].filter((key) => raw.includes(`{${key}}`));
}

/**
 * Roll one part of a name again, in place — the window's per-part reroll, and how a whole name is
 * built. A formula reroll keeps the words that are still used.
 * @param {object} name
 * @param {"formula"|"adjective"|"noun"|"slot"} key
 */
export async function rerollPart(name, key) {
  const kind = KINDS[name.kind];
  const forest = name.kind === "forest";
  if (key === "formula") {
    const r = await rollWardenTable(kind.formula);
    const row = r?.results?.[0];
    name.formula = row?.flags?.[SYSTEM_ID]?.formula ?? 1;
    name.parts.formula = { total: r?.total ?? null, text: stripTags(row?.description) };
  } else if (key === "adjective") {
    name.parts.adjective = await rolled(forest ? TABLES.FOREST_ADJECTIVE : TABLES.NAME_ADJECTIVE);
  } else if (key === "noun") {
    name.parts.noun = await rolled(forest ? TABLES.FOREST_NOUN : TABLES.NAME_NOUN);
  } else if (key === "slot") {
    if (kind.slot === "poi") name.parts.slot = { total: null, text: name.poi };
    else if (kind.slot === "terrain") name.parts.slot = await synonym(name.terrain);
    else name.parts.slot = await rolled(kind.slot);
  }
  return name;
}

/**
 * Roll a whole name.
 * @param {string} kind  one of {@link NAME_KINDS}
 * @param {{terrain?: string, poi?: string}} [options]  the terrain a Terrain name is of; the kind
 *   of place a Place name is (typed by the Warden, not rolled)
 */
export async function rollName(kind, { terrain = "forest", poi = "" } = {}) {
  const name = { kind, formula: null, poi, terrain, parts: {} };
  if (kind !== "forest") await rerollPart(name, "formula");
  for (const key of ["adjective", "noun", ...(kind === "forest" ? [] : ["slot"])]) await rerollPart(name, key);
  return name;
}

/**
 * The SRD's Realm option, "replace any value with the dominant terrain synonym": an adjective or
 * a noun becomes a synonym of that terrain.
 * @param {object} name
 * @param {"adjective"|"noun"} key
 * @param {string} terrain
 */
export async function swapTerrain(name, key, terrain) {
  name.parts[key] = { ...(await synonym(terrain)), swapped: true };
  return name;
}

/** The parts a name shows, in a fixed order, each with its key. */
export function shownParts(name) {
  const used = partsUsed(name);
  return [...(name.kind === "forest" ? [] : ["formula"]), ...used].map((key) => ({ key, ...name.parts[key] }));
}

/**
 * The name as text. `article` false drops the optional "(The)" and "of (the)" — the `Bare`
 * string of the same formula. A Forest name has no formula and no article.
 * @param {object} name
 * @param {{article?: boolean}} [options]
 */
export function composeName(name, { article = true } = {}) {
  const words = { adjective: name.parts.adjective?.text ?? "", noun: name.parts.noun?.text ?? "", slot: name.parts.slot?.text ?? "" };
  const text = name.kind === "forest"
    ? game.i18n.localize("CAIRN.NameGen.Forest", words)
    : game.i18n.localize(`CAIRN.NameGen.Formula.${name.formula}${article ? "" : "Bare"}`, words);
  return text.replace(/\s+/g, " ").trim();
}

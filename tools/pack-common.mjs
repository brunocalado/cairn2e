/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Shared plumbing for the compendium pipeline (`build-packs.mjs`, `extract-packs.mjs`).
 *
 * These scripts live outside `module/` and are never loaded by Foundry — they run under plain
 * Node during development. They still carry the GPL-3 header (CLAUDE.md §6) but are not covered
 * by the `module/`-only lint task.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Repo root — this file is `<root>/tools/pack-common.mjs`. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** Versioned, hand-edited source of every compendium document. */
export const SOURCE_ROOT = path.join(REPO_ROOT, "packs", "_source");

/** Build output — the LevelDB directories Foundry actually loads. Gitignored. */
export const PACK_ROOT = path.join(REPO_ROOT, "packs");

/** Raised for an expected, user-actionable failure — printed without a stack trace. */
export class PackError extends Error {}

/* -------------------------------------------- */
/*  Argument parsing                            */
/* -------------------------------------------- */

/**
 * Minimal flag parser. Positional args and repeated `--pack <name>` both collect pack names;
 * `--src` / `--dest` take a value; anything else `--foo` becomes a boolean flag.
 * @param {string[]} argv  `process.argv.slice(2)`
 * @returns {{ packs: string[], flags: Set<string>, src?: string, dest?: string }}
 */
export function parseArgs(argv) {
  const out = { packs: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pack") out.packs.push(argv[++i]);
    else if (a === "--src") out.src = argv[++i];
    else if (a === "--dest") out.dest = argv[++i];
    else if (a.startsWith("--")) out.flags.add(a.slice(2));
    else out.packs.push(a);
  }
  return out;
}

/* -------------------------------------------- */
/*  Filesystem helpers                          */
/* -------------------------------------------- */

/** Sub-directory names of `dir`, sorted. `[]` if `dir` is absent. `_source` is never returned. */
export function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "_source")
    .map((e) => e.name)
    .sort();
}

/** True if `dir` looks like a populated LevelDB pack (has a CURRENT manifest). */
export function isLevelDB(dir) {
  return fs.existsSync(path.join(dir, "CURRENT"));
}

/** All `*.json` / `*.yml` files under `dir`, recursively, sorted. */
export function listSourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(json|ya?ml)$/i.test(e.name)) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * Kebab-case a document name for use as a filename: strip accents and apostrophes, collapse every
 * other run of non-alphanumerics to a single dash, lowercase.
 * @param {string} str
 * @returns {string}
 */
export function kebabCase(str) {
  const s = String(str ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return s || "document";
}

/** Whether an extracted document is a Folder rather than one of the pack's own documents. */
export const isFolderDoc = (doc) => String(doc?._key ?? "").startsWith("!folders");

/**
 * The filename each document already has in a committed source directory, by `_id`.
 * @param {string} dir  `packs/_source/<name>/`
 * @returns {Map<string, string>}
 */
export function committedNames(dir) {
  const names = new Map();
  if (!fs.existsSync(dir)) return names;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const id = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))._id;
      if (id) names.set(id, file);
    } catch {
      // Not a document; the build reports a bad file, the extract only skips it.
    }
  }
  return names;
}

/**
 * The source filename for one extracted document: flat, in the layout `packs/_source/` is
 * committed in. A document the committed tree already has keeps its file, whatever it is called
 * now — a filename can be an id seed (`_folder-valuables-common.json` is where the Common band's
 * `_id` comes from), and an extract that renamed it would leave the old file beside the new one
 * for the next build to pack twice. A new document is kebab-cased, a Folder `_folder-<slug>.json`.
 * The CLI's own fallback put a Folder at `<Folder Name>/_Folder.json` with its documents inside.
 * @param {object} doc
 * @param {Set<string>} seen  names already given in this pack, so a clash gets `-2`, `-3`
 * @param {Map<string, string>} [committed]  `committedNames` of the pack's source directory
 * @returns {string}
 */
export function sourceFileName(doc, seen, committed = new Map()) {
  const kept = committed.get(doc._id);
  if (kept && !seen.has(kept)) {
    seen.add(kept);
    return kept;
  }
  const base = `${isFolderDoc(doc) ? "_folder-" : ""}${kebabCase(doc.name || doc._id)}`;
  let rel = `${base}.json`;
  for (let n = 2; seen.has(rel); n++) rel = `${base}-${n}.json`;
  seen.add(rel);
  return rel;
}

/* -------------------------------------------- */
/*  Noise stripping (extract)                   */
/* -------------------------------------------- */

/**
 * Remove per-install noise from an extracted document so the source file is stable and reviewable
 *:
 *
 * - `_stats` — stale `coreVersion: "12.327"` / `systemId` metadata, at every nesting level.
 * - `ownership` — flattened to `{ default: 0 }` (the dumps carry a years-old user id with owner
 *   rights). Not on a Folder: the committed Folder files carry none.
 *
 * `_id`, `_key` and `folder` are deliberately kept — stable ids make cross-pack references
 * (a RollTable result pointing at a compendium Item) survive a rebuild.
 * @param {object} doc  mutated in place
 * @returns {object} the same doc
 */
export function stripDocNoise(doc) {
  deleteDeep(doc, "_stats");
  if (!isFolderDoc(doc)) doc.ownership = { default: 0 };
  return doc;
}

function deleteDeep(node, key) {
  if (Array.isArray(node)) {
    for (const n of node) deleteDeep(n, key);
  } else if (node && typeof node === "object") {
    delete node[key];
    for (const v of Object.values(node)) deleteDeep(v, key);
  }
}

/* -------------------------------------------- */
/*  DataModel validation (build)               */
/* -------------------------------------------- */

let _foundryLoaded = false;
let _models = null;

/**
 * Populate `globalThis.foundry` by importing Foundry's server-side common library, so the
 * system's `TypeDataModel` subclasses can be constructed outside a running client.
 *
 * The install is located via `FOUNDRY_PATH` (or `FOUNDRY_VTT_PATH`), then a short list of guesses
 * relative to the repo. This depends on Foundry's internal `common/` ESM layout, which is stable
 * within a generation and is exactly the code that will validate these packs at world load.
 */
async function loadFoundry() {
  if (_foundryLoaded) return;
  const entry = resolveFoundryCommon();
  await import(pathToFileURL(entry).href);
  _foundryLoaded = true;
}

/**
 * Populate `globalThis.foundry` (fields, `TypeDataModel`, `DataModel`) from the local install, so
 * `module/data/**` and other files that touch `foundry.*` at import time can be loaded under plain
 * Node — the compendium pipeline and the offline check suite (`checks/`) both need this.
 * @returns {Promise<void>}
 */
export async function ensureFoundry() {
  await loadFoundry();
}

/** Where a Foundry install might be: `FOUNDRY_PATH` first, then the usual spots beside the repo. */
function foundryBases() {
  const bases = [];
  const env = process.env.FOUNDRY_PATH || process.env.FOUNDRY_VTT_PATH;
  if (env) bases.push(env);
  bases.push(
    path.join(REPO_ROOT, "../../../../fvtt14"),
    path.join(REPO_ROOT, "../../../../FoundryVTT"),
    path.join(REPO_ROOT, "../../../fvtt14"),
    path.join(REPO_ROOT, "../../../FoundryVTT")
  );
  return bases;
}

/**
 * The install's `public/` directory — where core's own `icons/**` live. Needed by the checks that
 * assert a core asset path this system names actually resolves to a file; a typo there is silent
 * in a client, which just draws nothing.
 * @returns {string} absolute path to `public/`
 */
export function resolveFoundryPublic() {
  const bases = foundryBases();
  for (const base of bases) {
    for (const rel of ["public", "resources/app/public"]) {
      const p = path.resolve(base, rel, "icons");
      if (fs.existsSync(p)) return path.dirname(p);
    }
  }
  throw new PackError(
    "Cannot locate the Foundry VTT `public/` directory, needed to verify core icon paths.\n"
    + "Set FOUNDRY_PATH to your Foundry install directory.\n"
    + `Tried: ${bases.join(", ")}`
  );
}

function resolveFoundryCommon() {
  const bases = foundryBases();
  for (const base of bases) {
    for (const rel of ["common/server.mjs", "resources/app/common/server.mjs", "server.mjs"]) {
      const p = path.resolve(base, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new PackError(
    "Cannot locate the Foundry VTT common library, needed to validate pack documents against the "
    + "DataModels.\nSet FOUNDRY_PATH to your Foundry install directory:\n"
    + "  FOUNDRY_PATH=/path/to/FoundryVTT npm run packs\n"
    + `Tried: ${bases.join(", ")}`
  );
}

/** `{ Actor: ACTOR_MODELS, Item: ITEM_MODELS }`, loaded once. */
async function getModels() {
  if (_models) return _models;
  await loadFoundry();
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, "module/data/_module.js")).href);
  _models = { Actor: mod.ACTOR_MODELS, Item: mod.ITEM_MODELS };
  return _models;
}

/** Document collection (from `_key`) → canonical document name. Others have no `system` model. */
const COLLECTION_DOC = { actors: "Actor", items: "Item" };

/**
 * Validate one primary document — and any embedded items — against the system's DataModels.
 * Throws {@link PackError} on the first failure.
 *
 * Note for authors: Foundry's field cleaning *silently normalises* out-of-range numbers (a
 * negative cost becomes 0, `quantity: 0` becomes 1, a non-integer is rounded) and drops unknown
 * keys. What this catches is structural: wrong JSON types, an unknown subtype (`type: "item"`),
 * a `choices` violation (`damage: "1d8"`), and joint constraints (`petty` + `bulky`).
 * @param {object} doc
 * @param {string} label  `pack/file` for error messages
 */
export async function validateDocument(doc, label) {
  const models = await getModels();
  const collection = String(doc._key ?? "").split("!")[1];
  const docName = COLLECTION_DOC[collection];
  if (!docName) return; // RollTable, JournalEntry, Macro, Folder, … — nothing to validate

  validateModel(doc, models[docName], label);
  if (docName === "Actor") {
    for (const item of doc.items ?? []) {
      validateModel(item, models.Item, `${label} → embedded "${item.name ?? item._id}"`);
    }
  }
}

function validateModel(doc, map, label) {
  const Model = map[doc.type];
  if (!Model) {
    throw new PackError(`${label}: unknown subtype "${doc.type}" (valid: ${Object.keys(map).join(", ")})`);
  }
  try {
    new Model(doc.system ?? {}, { parent: null });
  } catch (err) {
    throw new PackError(`${label} [${doc.type}]: ${err.message}`);
  }
}

/* -------------------------------------------- */
/*  Lock check (build)                          */
/* -------------------------------------------- */

/**
 * Refuse to overwrite a pack that a running world holds open. A LevelDB directory always contains
 * a `LOCK` file, so its presence proves nothing; the real test is whether the DB can be opened.
 * @param {string} dir  the target `packs/<name>/`
 */
export async function assertUnlocked(dir) {
  if (!isLevelDB(dir)) return;
  const { ClassicLevel } = await import("classic-level");
  const db = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "json", createIfMissing: false });
  try {
    await db.open();
    await db.close();
  } catch {
    throw new PackError(`"${path.basename(dir)}" is locked — close the world that has it open and retry.`);
  }
}

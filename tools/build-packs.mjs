/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Build compendium packs from source.  `npm run packs`
 *
 *   packs/_source/<name>/*.json   →   packs/<name>/   (LevelDB)
 *
 * Every document's `system` payload is validated against its DataModel *before* anything
 * is written — a source document that would not load in Foundry is a build failure here, not a
 * silent runtime surprise. This validation is the reason the script exists; disable it only for a
 * quick local rebuild with `--no-validate`. The same pass fills in the `_id` / `_key` of any
 * embedded Item authored without them and writes the source file back.
 *
 * Usage:
 *   node tools/build-packs.mjs                 build every pack under packs/_source/
 *   node tools/build-packs.mjs utils weapons   build only the named packs
 *   node tools/build-packs.mjs --no-validate   skip DataModel validation (and the embedded-id fill-in)
 *   node tools/build-packs.mjs --src DIR --dest DIR   override the source / output roots
 *   node tools/build-packs.mjs --verbose       log every packed document
 */

import fs from "node:fs";
import path from "node:path";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import {
  PACK_ROOT, SOURCE_ROOT, PackError,
  parseArgs, listDirs, listSourceFiles, assertUnlocked, validateDocument, ensureFoundry, isFolderDoc
} from "./pack-common.mjs";

const args = parseArgs(process.argv.slice(2));
const srcRoot = args.src ? path.resolve(args.src) : SOURCE_ROOT;
const destRoot = args.dest ? path.resolve(args.dest) : PACK_ROOT;
const validate = !args.flags.has("no-validate");
const verbose = args.flags.has("verbose");

const packs = args.packs.length ? args.packs : listDirs(srcRoot);
if (!packs.length) {
  console.log(`No pack sources under ${prettyPath(srcRoot)}/ — nothing to build.`);
  process.exit(0);
}

let built = 0;
const failed = [];

for (const name of packs) {
  const src = path.join(srcRoot, name);
  const dest = path.join(destRoot, name);
  try {
    if (!fs.existsSync(src)) throw new PackError(`no source directory at ${prettyPath(src)}`);
    await assertUnlocked(dest);
    if (validate) await validateSource(name, src);

    await compilePack(src, dest, { recursive: true, log: verbose });
    built++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failed.push(name);
    console.error(`✗ ${name}: ${err instanceof PackError ? err.message : (err.stack ?? err.message)}`);
  }
}

console.log(`\n${built} pack${built === 1 ? "" : "s"} built${failed.length ? `, ${failed.length} failed: ${failed.join(", ")}` : ""}.`);
process.exit(failed.length ? 1 : 0);

/** Repo-relative path when the target is inside the repo, absolute otherwise. */
function prettyPath(p) {
  const rel = path.relative(process.cwd(), p);
  return rel.startsWith("..") ? p : rel;
}

/**
 * Parse and validate every source file in one pack before it is compiled, so a bad document never
 * leaves a half-written LevelDB behind.
 * @param {string} name  pack name, for messages
 * @param {string} dir   `packs/_source/<name>/`
 */
async function validateSource(name, dir) {
  // Source is JSON only. `compilePack` is called without `yaml: true`, so a stray
  // .yml would be silently ignored by the build — flag it here rather than let it look packed.
  const all = listSourceFiles(dir);
  const stray = all.find((f) => /\.ya?ml$/i.test(f));
  if (stray) throw new PackError(`${name}/${path.relative(dir, stray)}: YAML source is not supported — use JSON`);
  const files = all.filter((f) => f.toLowerCase().endsWith(".json"));
  if (!files.length) throw new PackError(`source directory is empty`);

  for (const file of files) {
    const rel = `${name}/${path.relative(dir, file)}`;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      throw new PackError(`${rel}: invalid JSON — ${err.message}`);
    }
    // The id guard comes first, Folder files included: a `_folder-*.json` with no `_key` is the
    // same silent `compilePack` skip as any other document without one.
    if (!doc._id) throw new PackError(`${rel}: missing "_id"`);
    if (!doc._key) {
      throw new PackError(`${rel}: missing "_key" (compilePack would silently skip this file). `
        + `Add e.g. "_key": "!items!${doc._id}"`);
    }
    if (isFolderDoc(doc)) continue; // a Folder has no system payload to validate
    // An embedded Item may be authored without ids — a bestiary feature is three lines of JSON,
    // and its id is nothing a person should type. The build assigns both ONCE, with the client's
    // own generator, and writes them back, so the next build (and `packs:extract`) sees the same
    // stable ids as any hand-written one. A top-level document is still refused above: there,
    // a missing `_key` is what makes `compilePack` skip the whole file silently. The `_key` is
    // derived rather than trusted, because a wrong one is the same silent skip as a missing one.
    await ensureFoundry();
    let assigned = 0;
    for (const item of doc.items ?? []) {
      if (!item._id) { item._id = foundry.utils.randomID(16); assigned++; }
      const key = `!actors.items!${doc._id}.${item._id}`;
      if (item._key !== key) { item._key = key; assigned++; }
    }
    if (assigned) fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    await validateDocument(doc, rel);
  }
}

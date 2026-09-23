/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Build the one stylesheet Foundry loads, `css/cairn2e.min.css`, from the sources in `css/src/`.
 *
 *   npm run css                                build once, with a source map
 *   npm run css:watch                          rebuild on every save; Foundry hot-reloads it
 *   node tools/build-css.mjs --no-sourcemap    the release build (`.github/workflows/release.yml`)
 *
 * The sources are the editable form and the only one: the built file is gitignored, like the
 * packs, and the release workflow builds it before zipping. Each source is one nested
 * `.cairn2e { … }` block, and {@link CSS_SOURCES} is the order they are joined in — the cascade
 * order, so a file moved in the list can change which rule wins.
 *
 * `url()`s in the sources are written relative to `css/`, where the built file lives, not to
 * `css/src/`: the build leaves them exactly as written (`external`), so `../fonts/…` and
 * `../assets/…` resolve from the output.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
export const SRC_DIR = path.join(ROOT, "css", "src");
export const OUT_FILE = path.join(ROOT, "css", "cairn2e.min.css");

/** Every source, in cascade order. A file in `css/src/` missing from this list is never built. */
export const CSS_SOURCES = [
  "base.css",
  "controls.css",
  "chat.css",
  "tooltip-chips-embeds.css",
  "window.css",
  "character-sheet.css",
  "inventory.css",
  "npc-sheet.css",
  "party-sheet.css",
  "item-sheet.css",
  "character-creator.css",
  "character-edit.css",
  "scars.css",
  "journey.css",
  "store.css",
  "dialogs.css",
  "journal-pages.css",
  "table-draw.css",
  "combat-tracker.css",
  "sidebar-tab.css",
  "token-hud.css"
];

/** The sources joined in build order, as text — what the checks read instead of the built file. */
export function joinedSources() {
  return CSS_SOURCES.map((name) => fs.readFileSync(path.join(SRC_DIR, name), "utf8")).join("\n");
}

/** The license header, once, at the top of the built file: each source's own copy is dropped. */
function licenseHeader() {
  const first = fs.readFileSync(path.join(SRC_DIR, CSS_SOURCES[0]), "utf8");
  return first.slice(0, first.indexOf(" */") + 3);
}

/** esbuild's options for one build of the stylesheet into `outfile`. */
function options({ outfile = OUT_FILE, sourcemap = true } = {}) {
  return {
    stdin: {
      contents: CSS_SOURCES.map((name) => `@import "./${name}";`).join("\n"),
      resolveDir: SRC_DIR,
      sourcefile: "cairn2e.css",
      loader: "css"
    },
    bundle: true,
    minify: true,
    // The source map points each rule back at its source file, so the browser's inspector names
    // `store.css` rather than column 40,000 of one line.
    sourcemap,
    legalComments: "none",
    banner: { css: licenseHeader() },
    external: ["../fonts/*", "../assets/*"],
    outfile,
    logLevel: "warning"
  };
}

/**
 * Build the stylesheet once. `outfile` is for `checks/css-build.check.mjs`, which builds into a
 * temporary folder so a check run never rewrites the file a live client is loading.
 * @param {{outfile?: string, sourcemap?: boolean}} [opts]
 */
export async function buildStylesheet(opts) {
  const esbuild = await import("esbuild");
  await esbuild.build(options(opts));
}

async function main() {
  const sourcemap = !process.argv.includes("--no-sourcemap");
  if (process.argv.includes("--watch")) {
    const esbuild = await import("esbuild");
    const ctx = await esbuild.context(options({ sourcemap }));
    await ctx.watch();
    console.log(`watching css/src/ → ${path.relative(ROOT, OUT_FILE)}`);
    return;
  }
  await buildStylesheet({ sourcemap });
  console.log(`✓ ${path.relative(ROOT, OUT_FILE)} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB)`);
}

if (process.argv[1] === import.meta.filename) await main();

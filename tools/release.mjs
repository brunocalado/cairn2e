/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Cut a release.  `npm run release -- 0.2.0`
 *
 * Commits and ordinary pushes never publish anything: the release workflow runs only when a
 * `v*` tag reaches GitHub. This script is the one step that sends one, after the commits that
 * make up the release are already on `main`:
 *
 *   1. the `## [Unreleased]` section of CHANGELOG.md becomes `## [0.2.0] - <today>`, and a fresh
 *      empty `## [Unreleased]` goes above it;
 *   2. that change is committed and tagged `v0.2.0`;
 *   3. `main` and the tag are pushed together — the workflow builds the zip from there.
 *
 * It refuses to run off `main`, with uncommitted changes, for a tag that already exists, or when
 * the Unreleased section is empty: an empty section would publish a release with no notes.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");
const UNRELEASED = "## [Unreleased]";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const fail = (message) => { console.error(`✗ ${message}`); process.exit(1); };

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail("usage: npm run release -- <major.minor.patch>");
const tag = `v${version}`;

if (git("branch", "--show-current") !== "main") fail("releases are cut from main");
if (git("status", "--porcelain")) fail("commit or stash your changes first");
if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`);

const text = fs.readFileSync(CHANGELOG, "utf8");
const start = text.indexOf(UNRELEASED);
if (start < 0) fail(`CHANGELOG.md has no "${UNRELEASED}" heading`);
const bodyStart = start + UNRELEASED.length;
const next = text.indexOf("\n## [", bodyStart);
const body = text.slice(bodyStart, next < 0 ? undefined : next);
if (!body.trim()) fail(`nothing under "${UNRELEASED}" in CHANGELOG.md — write the release notes first`);

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(CHANGELOG, `${text.slice(0, start)}${UNRELEASED}\n\n## [${version}] - ${today}${text.slice(bodyStart)}`);

git("add", "CHANGELOG.md");
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", `Release ${tag}`);
console.log(`✓ committed and tagged ${tag}`);

execFileSync("git", ["push", "--atomic", "origin", "main", tag], { cwd: ROOT, stdio: "inherit" });
console.log(`✓ pushed — the release workflow is building ${tag} on GitHub`);

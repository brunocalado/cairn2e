/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Warden-only one-click faction generation.
 *
 * Rolls the SRD **Setting Seeds → Factions** tables
 * (`srd-2e/wardens-guide/setting-seeds.md`) and writes the results into a `faction` page
 * (`module/data/page-faction.js`):
 *
 *   | Field      | Table(s)                                                            |
 *   |------------|---------------------------------------------------------------------|
 *   | type       | `Faction Type`                                                      |
 *   | traits     | `Faction Trait 1` + `Faction Trait 2`                               |
 *   | advantages | `Faction Advantage Count` (1–4), then that many *distinct* rolls on  |
 *   |            | `Faction Advantage` (reroll repeats) — the SRD "# of Advantages"     |
 *   |            | procedure                                                           |
 *   | agents     | one agent whose role is `Faction Agent`                             |
 *   | agenda     | `Faction Agenda`, as the objective                                  |
 *   | obstacles  | `Faction Obstacle`                                                  |
 *
 * A faction is **campaign machinery, not a creature** — so unlike the NPC / monster generators the
 * result is a journal page and not an Actor, and it does not scroll away in chat. Every faction is
 * a page of ONE `Factions` journal rather than a journal of its own: a page carries its own
 * `ownership` (initial `INHERIT`), so a region's factions are revealed one at a time from inside
 * the entry that holds them all.
 *
 * Nothing here writes ownership. A page created by a GM is as visible as Foundry makes it, and
 * changing that is the GM's to do with core's own controls — a generator that quietly made its
 * output different from every other page the same journal holds would be one more rule to learn.
 *
 * There is no confirmation dialog: creating a page destroys nothing, and every click makes a
 * brand-new one that opens on creation.
 *
 * ## Table resolution — world first
 *
 * Every roll goes through `helpers.js#rollWardenTable`: a world RollTable whose name matches
 * exactly wins over the `cairn2e.warden` compendium copy, so a Warden's edited tables survive a
 * system update. It uses `RollTable#roll()`, never `draw()`. A missing / empty table leaves that
 * one field blank — a partial faction the Warden can finish by hand, never an error.
 *
 * ## Naming
 *
 * The page is drafted `The {Trait 1} {Type}` (*The Enigmatic Cultists*), meant to be renamed by
 * the Warden. Rolled content is authored content, not display-translated (`cairn2e` is en-only).
 */

import { rollWardenText } from "./helpers.js";

/** The journal generated factions are filed in. A stable identifier — not localized, so the
 *  "does it already exist?" lookup keeps working whatever the session language. */
const JOURNAL_NAME = "Factions";

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */


/**
 * Roll `count` **distinct** results on `Faction Advantage`, rerolling repeats (the SRD procedure).
 * Bails out if the table is missing (→ `[]`) or cannot yield enough distinct rows (a hand-edited
 * world table with too few entries) — the guard caps attempts so a small table can't spin forever.
 * @param {number} count
 * @returns {Promise<string[]>}
 */
async function rollAdvantages(count) {
  const out = [];
  const maxAttempts = count * 20;
  for (let attempt = 0; out.length < count && attempt < maxAttempts; attempt++) {
    const value = await rollWardenText("Faction Advantage");
    if (!value) break; // table missing — leave the field short, don't loop
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Roll one complete faction. Returns the page name and the `system` payload — the caller creates
 * the document.
 * @returns {Promise<{ name: string, system: object }>}
 */
async function buildFaction() {
  const type = await rollWardenText("Faction Type");
  const agent = await rollWardenText("Faction Agent");
  const trait1 = await rollWardenText("Faction Trait 1");
  const trait2 = await rollWardenText("Faction Trait 2");

  // The SRD "# of Advantages" column yields 1–4; clamp defensively (a hand-edited world table
  // could hold anything) and fall back to 1 if the count table is missing entirely.
  const countText = await rollWardenText("Faction Advantage Count");
  const count = Math.min(4, Math.max(1, parseInt(countText, 10) || 1));
  const advantages = await rollAdvantages(count);

  const agenda = await rollWardenText("Faction Agenda");
  const obstacle = await rollWardenText("Faction Obstacle");

  const label = [trait1, type].filter(Boolean).join(" ");
  const name = label
    ? `${game.i18n.localize("CAIRN.FactionGen.DraftNamePrefix")} ${label}`
    : game.i18n.localize("CAIRN.FactionGen.DefaultName");

  return {
    name,
    system: {
      type,
      traits: [trait1, trait2].filter(Boolean),
      advantages: advantages.map((advantage) => ({ name: advantage, note: "", item: "" })),
      // One agent, unnamed: the table rolls what an agent IS, and the SRD's own example gives the
      // person a name the Warden invents. The blank name is the prompt to invent it.
      agents: agent ? [{ name: "", role: agent, wil: 10, motivation: "", actor: "" }] : [],
      // No goals. The agenda table rolls the OBJECTIVE — "3-5 goals that build toward a clear
      // objective" is the Warden's writing, and three empty rows would be three prompts pretending
      // to be content.
      agenda: { objective: agenda, goals: [] },
      obstacles: obstacle ? [{ text: obstacle, resolved: false }] : []
    }
  };
}

/* -------------------------------------------- */
/*  Public entry point                          */
/* -------------------------------------------- */

/** Find the `Factions` journal, creating it if absent. */
async function ensureFactionsJournal() {
  const existing = game.journal.getName(JOURNAL_NAME);
  if (existing) return existing;
  const JournalEntryClass = foundry.utils.getDocumentClass("JournalEntry");
  return JournalEntryClass.create({ name: JOURNAL_NAME });
}

/**
 * Roll a faction and file it as a page of the `Factions` journal. No confirmation dialog —
 * creating a page destroys nothing; every call makes a new one and opens it.
 * @returns {Promise<JournalEntryPage|null>}
 */
export async function generateFaction() {
  if (!game.user.can("JOURNAL_CREATE")) {
    ui.notifications.warn(game.i18n.localize("CAIRN.FactionGen.NoPermission"));
    return null;
  }

  const { name, system } = await buildFaction();
  const journal = await ensureFactionsJournal();
  if (!journal) return null;
  // Creating a journal is not owning the one that already exists: a trusted player may have the
  // first and not the second, and the page write would reject after the rolls were made.
  if (!journal.isOwner) {
    ui.notifications.warn(game.i18n.localize("CAIRN.FactionGen.NoPermission"));
    return null;
  }

  const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [
    { name, type: "faction", system }
  ]);

  if (page) page.sheet.render({ force: true });
  return page;
}

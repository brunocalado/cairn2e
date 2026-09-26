/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * One-way, GM-only **Kettlewright** importer.
 *
 * Kettlewright (`kettlewright.com`, Yochai Gal's official Cairn companion app) can export a
 * character as a flat `.json`. This turns one such file into a brand-new `cairn2e` `character`
 * Actor. It is **best-effort and lossy by design** — Kettlewright has no import route of its own,
 * so there is no round-trip to preserve, and this importer never writes back.
 *
 * ## 2e characters only
 *
 * Kettlewright also holds first-edition sheets. Those are out of scope: a file that does not look
 * like a 2e character (no 2e background-name match, no recognisable 2e trait words) still imports
 * whatever maps cleanly — abilities, HP, gold, notes — and the summary dialog says what was left
 * as free text. No first-edition handling is added, even "to be helpful".
 *
 * ## What it does not do
 *
 * - It never routes through `character-generator.js#assembleActorData` — that function force-resets
 *   `omen` from its own draft assumptions, which would wipe the imported values.
 *   The `Actor.create` payload is built directly here.
 * - It never merges into an existing Actor — every import is a new one.
 * - It never throws on a malformed or non-2e file: parse failure and every missing field degrade
 *   to a default, and the gaps are reported in the summary dialog.
 *
 * The gear-line parser (`parseGearLine`) and the compendium resolver (`resolveItem`) are reused
 * from the character generator — see `module/character-generator.js`.
 */

import { CairnActor } from "./documents/actor.js";
import { SYSTEM_ID, PACKS, CONDITION, DEFAULT_ARTWORK } from "./constants.js";
import { coinItem } from "./coin-rules.js";
import { stripTags, copyOf } from "./helpers.js";
import { parseGearLine, resolveItem, getBackgrounds, toPlainText } from "./character-generator.js";

const { DialogV2 } = foundry.applications.api;

/** Fallback portrait when the export has no portable absolute image URL. */


/** Art for a container Item the importer creates. Matches the character creator's Backpack. */
const CONTAINER_IMG = "icons/containers/bags/pack-simple-leather-tan.webp";

/** The three Marketplace lists an `items[]` line can match, by name. */
const MARKET_PACKS = [PACKS.WEAPONS, PACKS.ARMOR, PACKS.GEAR];

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/** A finite number, or the fallback. Tolerates strings ("12"), `null`, `undefined`, `NaN`. */
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Wrap plain text in a `<p>`; pass through text that already looks like HTML. */
function toHtml(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  return /^\s*</.test(raw) ? raw : `<p>${esc(raw)}</p>`;
}

/** First array found on the object under any of the given keys (Kettlewright field names drift). */
function firstArray(obj, keys) {
  for (const key of keys) {
    if (Array.isArray(obj?.[key])) return obj[key];
  }
  return [];
}

/* -------------------------------------------- */
/*  Trait sentence parser                       */
/* -------------------------------------------- */

/**
 * Build the trait vocabulary from the `cairn2e.character-traits` pack — the same eight d10 tables
 * the character creator rolls on. Returns `{ physique: Set<lowercased word>, skin: Set, ... }`.
 * A missing pack yields an empty map: every trait then stays blank, which is a fine best-effort
 * result for a non-2e file.
 */
async function traitVocabulary() {
  const vocab = {};
  const pack = game.packs.get(PACKS.TRAITS);
  if (!pack) return vocab;
  const tables = await pack.getDocuments();
  for (const table of tables) {
    const key = String(table.name ?? "").toLowerCase();
    if (!key) continue;
    const words = new Set();
    for (const result of table.results ?? []) {
      const word = stripTags(result.description ?? "").toLowerCase();
      if (word) words.add(word);
    }
    if (words.size) vocab[key] = words;
  }
  return vocab;
}

/**
 * Best-effort parse of Kettlewright's one-sentence `traits` blob into `system.traits.*` and an age.
 * Kettlewright writes free text ("Athletic, weathered skin, curly hair… Aged 34"), not a table
 * draw, so this only recognises words that appear verbatim in a 2e trait table; anything else is
 * left for the biography. The first recognised word wins each slot.
 * @param {string} text
 * @param {Record<string, Set<string>>} vocab
 * @returns {{ traits: Record<string, string>, age: number, matched: number }}
 */
function parseTraitSentence(text, vocab) {
  const traits = {
    physique: "", skin: "", hair: "", face: "",
    speech: "", clothing: "", virtue: "", vice: ""
  };
  const plain = stripTags(text);
  const tokens = plain.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];

  let matched = 0;
  for (const token of tokens) {
    for (const key of Object.keys(traits)) {
      if (traits[key] || !vocab[key]?.has(token)) continue;
      // Store the SRD casing (title case) rather than the sentence's casing. A word that appears
      // in two tables (e.g. "Oily" is both Skin and Hair) claims only the first empty slot.
      traits[key] = token.charAt(0).toUpperCase() + token.slice(1);
      matched++;
      break;
    }
  }

  // Age: "aged 34", "34 years old", "age: 34", "34 winters".
  const ageMatch =
    plain.match(/\bage[d]?\b[^0-9]{0,8}(\d{1,3})/i) ||
    plain.match(/\b(\d{1,3})\s*(?:years?(?:\s*old)?|winters?)\b/i);
  const age = ageMatch ? num(ageMatch[1], 0) : 0;

  return { traits, age, matched };
}

/* -------------------------------------------- */
/*  Item resolution                             */
/* -------------------------------------------- */

/**
 * Turn one Kettlewright `items[]` entry into Item creation data, plus how many of it there are.
 *
 * Kettlewright counts copies on one entry; this system does not — 2e's inventory is a list of
 * items, so three ropes are three documents. The count comes back as `count` and the caller makes
 * that many payloads out of the one shape.
 *
 * 1. Exact name match against `cairn2e.weapons` → `.armor` → `.gear` — a marketplace line is used
 *    verbatim, with the entry's own uses / description overlaid.
 * 2. No match → a bespoke Item: a synthetic gear line (`Name (_petty_, 3 uses)`) is run through
 *    `parseGearLine` + `resolveItem` so `(_petty_)` / `(_bulky_)` / `(dN)` / `(N uses)` in the
 *    name or tags are parsed the same way starting gear is, and the entry's own text is kept as
 *    the description.
 *
 * @param {object} entry            a Kettlewright item
 * @param {Array} packDocs          `[weaponDocs, armorDocs, gearDocs]`, pre-fetched
 * @returns {Promise<{ data: object, resolved: boolean, count: number }>}
 */
async function resolveKettlewrightItem(entry, packDocs) {
  const name = String(entry?.name ?? "").trim() || game.i18n.localize("CAIRN.KWImport.DefaultItemName");
  const tags = firstArray(entry, ["tags", "labels"]).map((t) => String(t).toLowerCase());
  const descText = String(entry?.description ?? entry?.notes ?? "");
  const quantity = Math.max(1, num(entry?.quantity ?? entry?.amount, 1));
  const uses = num(entry?.charges ?? entry?.uses, null);
  const maxUses = num(entry?.max_charges ?? entry?.maxCharges ?? entry?.max_uses, uses);

  // 1. Marketplace match by name.
  for (let i = 0; i < MARKET_PACKS.length; i++) {
    const docs = packDocs[i] ?? [];
    const hit = docs.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (!hit) continue;
    const data = copyOf(hit);
    data.system = data.system ?? {};
    // A tag on the entry overrides what the Marketplace document costs; *petty* wins both.
    if (tags.includes("petty")) data.system.slots = 0;
    else if (tags.includes("bulky")) data.system.slots = 2;
    if (uses !== null) data.system.uses = { value: uses, max: maxUses ?? uses };
    if (descText.trim()) {
      data.system.description = `${data.system.description ?? ""}<hr>${toHtml(descText)}`.replace(/^<hr>/, "");
    }
    return { data, resolved: true, count: quantity };
  }

  // 2. Bespoke — synthesise a starting-gear line and reuse the character generator's parser.
  const quals = [];
  if (tags.includes("petty")) quals.push("_petty_");
  if (tags.includes("bulky")) quals.push("_bulky_");
  if (tags.includes("blast")) quals.push("_blast_");
  const dieTag = tags.map((t) => t.match(/^d(4|6|8|10|12)$/)?.[0]).find(Boolean);
  if (dieTag) quals.push(dieTag);
  if (uses !== null) quals.push(`${maxUses ?? uses} uses`);
  const line = quals.length ? `${name} (${quals.join(", ")})` : name;

  const parsed = parseGearLine(line);
  const base =
    parsed.kind === "item"
      ? parsed.data
      : { name, type: "gear", system: { description: "" } };

  const data = await resolveItem(base);
  data.system = data.system ?? {};
  if (descText.trim()) data.system.description = toHtml(descText);
  if (uses !== null && data.system.uses === undefined) {
    data.system.uses = { value: uses, max: maxUses ?? uses };
  }
  // Step 1 already tried an exact-name match against all three marketplace packs, so anything that
  // reaches here is bespoke — `resolveItem`'s only extra reach is the parser's cleaned-name `_link`
  // hint, a rare edge the summary can safely count as bespoke.
  return { data, resolved: false, count: quantity };
}

/* -------------------------------------------- */
/*  Payload assembly                            */
/* -------------------------------------------- */

/**
 * Build the `Actor.create` payload for the character plus its containers, and a summary of what
 * mapped and what did not. Pure — creates no documents. Never throws: every field access is
 * defaulted.
 *
 * Kettlewright's export is already this system's shape: one flat item list, each entry naming the
 * container it sits in through `location`. Each raw container becomes one `container` Item and
 * each entry's `location` becomes that item's `system.container` — which the caller can only fill
 * in once the container Item exists and has an id, so the contents ride along here as
 * `containers[i].items` and are written in a second pass.
 *
 * Exported so a Warden can script a bulk import (`game.cairn2e.kettlewrightImport.buildImportData`)
 * and so the check suite can exercise the mapping without a file picker.
 *
 * @param {object} kw  the parsed Kettlewright export (any shape — treated as untrusted)
 * @returns {Promise<{ actorData: object, containers: object[], statuses: string[], summary: object }>}
 */
export async function buildImportData(kw) {
  const src = kw && typeof kw === "object" ? kw : {};
  const summary = {
    name: "",
    resolved: 0,
    bespoke: 0,
    containers: 0,
    dropped: [],
    backgroundUnmatched: null,
    non2e: false
  };

  const name = String(src.name ?? "").trim() || game.i18n.localize("CAIRN.KWImport.DefaultName");
  summary.name = name;

  /* Abilities — `num(v, 10)` fallback per the mapping table. Kettlewright's key for the ceiling
     has been both `<attr>_max` and `max_<attr>` across versions; the short `str` form is accepted
     too. */
  const ability = (base) => {
    const short = base.slice(0, 3);
    const value = num(src[base] ?? src[short], 10);
    const max = num(src[`${base}_max`] ?? src[`max_${base}`] ?? src[`${short}_max`], value);
    return { value, max };
  };
  const abilities = {
    STR: ability("strength"),
    DEX: ability("dexterity"),
    WIL: ability("willpower")
  };

  const hpValue = num(src.hp, 0);
  const hp = { value: hpValue, max: num(src.hp_max ?? src.max_hp ?? src.maxHp, hpValue) };

  /* Background — the matching 2e compendium Item comes across whole, because that is where the
     name list, the starting gear and the two d6 tables live. A name that matches nothing is
     reported rather than kept: a bare string is not a background the system can use. */
  const rawBackground = String(src.background ?? src.custom_background ?? "").trim();
  let backgroundItem = null;
  let backgroundMatched = false;
  if (rawBackground) {
    const backgrounds = await getBackgrounds().catch(() => []);
    const hit = backgrounds.find((b) => b.name.toLowerCase() === rawBackground.toLowerCase());
    if (hit) {
      backgroundItem = copyOf(hit);
      backgroundMatched = true;
    } else {
      summary.backgroundUnmatched = rawBackground;
    }
  }

  /* Traits + age from the free-text sentence — but a dedicated `age` field wins when present. */
  const vocab = await traitVocabulary().catch(() => ({}));
  const parsedTraits = parseTraitSentence(src.traits, vocab);
  const { traits, matched } = parsedTraits;
  const age = Math.max(0, num(src.age, 0)) || parsedTraits.age;

  // A file with neither a recognised 2e background nor a single recognised 2e trait word is very
  // likely a first-edition character. Import what mapped; flag it in the summary.
  summary.non2e = !backgroundMatched && matched === 0;

  /* The character sheet has no free-text field any more: `system.biography` and `system.notes`
     are gone from the schema, and everything the sheet shows is a rule. A Kettlewright file's
     description, its raw traits sentence, its scars blob and its notes therefore have nowhere to
     land. They are NOT dropped silently — the summary says so, which is the promise this importer
     has always made about the file it was handed. */
  summary.freeText = ["description", "traits", "scars", "notes"]
    .filter((k) => String(src[k] ?? "").trim()).length > 0;

  /* Portrait — only a portable absolute URL survives; a Kettlewright stock `portraitN.webp` name
     has no source outside their app. */
  const imageUrl = String(src.image_url ?? src.image ?? "").trim();
  const img = /^https?:\/\//i.test(imageUrl) ? imageUrl : DEFAULT_ARTWORK.Actor.character;

  /* Items — pre-fetch the three marketplace packs once. */
  const packDocs = [];
  for (const packId of MARKET_PACKS) {
    const pack = game.packs.get(packId);
    packDocs.push(pack ? await pack.getDocuments().catch(() => []) : []);
  }

  const rawContainers = firstArray(src, ["containers"]);
  const rawItems = firstArray(src, ["items"]);

  // Route each flat item to its container (by id or name) or to the character.
  const containerKey = new Map();
  rawContainers.forEach((c, i) => {
    for (const k of [c?.id, c?.name].filter(Boolean)) containerKey.set(String(k).toLowerCase(), i);
  });
  const buckets = rawContainers.map(() => []);
  const mainItems = [];
  for (const entry of rawItems) {
    const loc = String(entry?.location ?? entry?.container ?? "").toLowerCase();
    const idx = containerKey.get(loc);
    if (idx !== undefined) buckets[idx].push(entry);
    else mainItems.push(entry);
  }
  rawContainers.forEach((c, i) => {
    for (const entry of firstArray(c, ["items"])) buckets[i].push(entry);
  });

  const convert = async (entries) => {
    const out = [];
    for (const entry of entries) {
      try {
        const { data, resolved, count } = await resolveKettlewrightItem(entry, packDocs);
        if (resolved) summary.resolved++;
        else summary.bespoke++;
        // One entry of three is three documents here. Each is its own clone: they are separate
        // things from the moment they land, and a shared object would have them share an id
        // once Foundry stamps one on.
        for (let n = 0; n < count; n++) out.push(foundry.utils.deepClone(data));
      } catch (err) {
        console.error("cairn2e | Kettlewright import: could not convert item", entry, err);
        summary.dropped.push(String(entry?.name ?? game.i18n.localize("CAIRN.KWImport.DefaultItemName")));
      }
    }
    return out;
  };

  const actorItems = await convert(mainItems);
  const containers = [];
  for (let i = 0; i < rawContainers.length; i++) {
    const c = rawContainers[i];
    containers.push({
      type: "gear",
      name: String(c?.name ?? "").trim() || game.i18n.localize("CAIRN.KWImport.ContainerDefaultName"),
      img: CONTAINER_IMG,
      system: {
        capacity: Math.max(1, num(c?.slots ?? c?.capacity, 1)),
        // Kettlewright's containers are bags the character wears, so the character hauls them —
        // without this they would read as beasts that haul themselves and land among Belongings
        // as things the character walked away from. *petty* on the same grounds as the starting
        // Backpack (`character-generator.js#backpackData`): the bag's own slots are its own, and
        // Kettlewright has already counted what is inside it against them.
        takesSlots: true,
        slots: 0,
        description: toHtml(c?.description)
      },
      // Not part of the container document: the contents are siblings on the character, and the
      // caller writes them once this container has an id to point at.
      items: await convert(buckets[i])
    });
  }
  summary.containers = containers.length;

  const actorData = {
    name,
    type: "character",
    img,
    system: {
      abilities,
      hp,
      // The Bond and the Omen are plain text on a character, so an import that arrives as markup
      // is flattened rather than stored as it came.
      bond: toPlainText(src.bonds ?? src.bond),
      // Kettlewright has no "youngest" flag, so the text is the only evidence: an import that
      // carries one gets the section, an import that does not is left without it.
      omen: (() => {
        const text = toPlainText(src.omens ?? src.omen);
        return { enabled: !!text, text };
      })(),
      age,
      traits
    },
    items: backgroundItem ? [backgroundItem, ...actorItems] : actorItems
  };
  // Coin is an Item (`data/item-coin.js`): Kettlewright's one number becomes one sack on the body.
  const gold = Math.max(0, num(src.gold, 0));
  if (gold > 0) actorData.items.push(coinItem(gold, game.i18n.localize("CAIRN.Gold")));

  // Deprived and Panicked are ActiveEffects, not schema fields, so they cannot ride along in
  // `system`. They are returned as status ids and applied after the Actor exists — this function
  // stays pure, and the caller sets them the same way the sheet chip and the token HUD do.
  const statuses = [];
  if (src.deprived) statuses.push(CONDITION.DEPRIVED);
  if (src.panicked) statuses.push(CONDITION.PANICKED);

  return { actorData, containers, statuses, summary };
}

/* -------------------------------------------- */
/*  Summary dialog                              */
/* -------------------------------------------- */

/** Show the post-import report: what resolved, what was bespoke, what was dropped. */
async function showSummary(summary) {
  const t = (key, data) => game.i18n.localize(key, data);
  const lines = [];

  if (summary.non2e) lines.push(`<li class="warning">${esc(game.i18n.localize("CAIRN.KWImport.SummaryNon2e"))}</li>`);
  lines.push(`<li>${esc(t("CAIRN.KWImport.SummaryResolved", { count: summary.resolved }))}</li>`);
  lines.push(`<li>${esc(t("CAIRN.KWImport.SummaryBespoke", { count: summary.bespoke }))}</li>`);
  lines.push(`<li>${esc(t("CAIRN.KWImport.SummaryContainers", { count: summary.containers }))}</li>`);
  if (summary.freeText) {
    lines.push(`<li class="warning">${esc(game.i18n.localize("CAIRN.KWImport.SummaryFreeText"))}</li>`);
  }
  if (summary.backgroundUnmatched) {
    lines.push(`<li>${esc(t("CAIRN.KWImport.SummaryBackgroundUnmatched", { name: summary.backgroundUnmatched }))}</li>`);
  }
  if (summary.dropped.length) {
    lines.push(
      `<li>${esc(t("CAIRN.KWImport.SummaryDropped", { count: summary.dropped.length }))}<ul>` +
        summary.dropped.map((d) => `<li>${esc(d)}</li>`).join("") +
        `</ul></li>`
    );
  } else {
    lines.push(`<li>${esc(game.i18n.localize("CAIRN.KWImport.SummaryClean"))}</li>`);
  }

  await DialogV2.prompt({
    classes: [SYSTEM_ID, "cairn-kw-summary"],
    window: { title: game.i18n.localize("CAIRN.KWImport.SummaryTitle", { name: summary.name }) },
    content: `<ul>${lines.join("")}</ul>`,
    ok: { label: game.i18n.localize("CAIRN.KWImport.Close") },
    rejectClose: false
  });
}

/* -------------------------------------------- */
/*  Public entry point                          */
/* -------------------------------------------- */

/**
 * Prompt for a Kettlewright `.json`, then create a new `character` Actor from it and report what
 * mapped. GM-only. Never throws — a malformed or non-2e file imports what it can and the summary
 * names the gaps.
 * @returns {Promise<CairnActor|null>}
 */
export async function importKettlewrightCharacter() {
  if (!game.user.can("ACTOR_CREATE")) {
    ui.notifications.warn(game.i18n.localize("CAIRN.KWImport.NoPermission"));
    return null;
  }

  const content =
    `<p class="hint">${esc(game.i18n.localize("CAIRN.KWImport.Hint"))}</p>` +
    `<div class="cairn-field"><label for="cairn-kw-file">${esc(game.i18n.localize("CAIRN.KWImport.SourceLabel"))}</label>` +
    `<input id="cairn-kw-file" type="file" name="data" accept=".json"></div>`;

  // The callback returns the picked `File` object (or `null`); the text is read outside the dialog
  // so a "no file" click can be told apart from a genuine result — `DialogV2` turns a `null`
  // callback return into the button's action string, which a `File` check filters cleanly.
  const picked = await DialogV2.wait({
    classes: [SYSTEM_ID, "cairn-kw-import"],
    window: { title: game.i18n.localize("CAIRN.KWImport.DialogTitle"), icon: "fas fa-file-import" },
    position: { width: 460 },
    content,
    buttons: [
      {
        action: "import",
        default: true,
        icon: "fas fa-file-import",
        label: game.i18n.localize("CAIRN.KWImport.Import"),
        callback: (event, button) => {
          const file = button.form?.elements?.data?.files?.[0] ?? null;
          if (!file) ui.notifications.warn(game.i18n.localize("CAIRN.KWImport.NoFile"));
          return file;
        }
      },
      { action: "cancel", icon: "fas fa-xmark", label: game.i18n.localize("CAIRN.KWImport.Cancel") }
    ],
    rejectClose: false
  });

  if (!(picked instanceof File)) return null;

  // From here nothing is allowed to throw: a bad file must degrade to a report, not an error.
  let parsed;
  try {
    parsed = JSON.parse(await foundry.utils.readTextFromFile(picked));
  } catch (err) {
    console.error("cairn2e | Kettlewright import: file is not valid JSON", err);
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.BadJson"));
    return null;
  }

  try {
    const { actorData, containers, statuses, summary } = await buildImportData(parsed);

    const actor = await CairnActor.create(actorData);
    if (!actor) {
      ui.notifications.error(game.i18n.localize("CAIRN.KWImport.Failed"));
      return null;
    }

    for (const statusId of statuses) await actor.toggleStatusEffect(statusId, { active: true });

    // Containers first, so each one has an id; then every contained item in one batch, each
    // pointing at the container it belongs to.
    if (containers.length) {
      const created = await actor.createEmbeddedDocuments(
        "Item",
        containers.map(({ items, ...container }) => container)
      );
      const held = [];
      for (const [i, container] of created.entries()) {
        for (const item of containers[i].items) {
          held.push(foundry.utils.mergeObject(item, { "system.container": container.id }));
        }
      }
      if (held.length) await actor.createEmbeddedDocuments("Item", held);
    }

    actor.sheet.render(true);
    await showSummary(summary);
    return actor;
  } catch (err) {
    console.error("cairn2e | Kettlewright import: unexpected failure", err);
    ui.notifications.error(game.i18n.localize("CAIRN.KWImport.Failed"));
    return null;
  }
}

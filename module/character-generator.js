/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The 2e background-driven character generator.
 *
 * This is not a port of the 1e generator — 2e builds a character from a Background, not from a
 * chain of 1e starting-equipment tables. The old `config.js` wiring and the 1e biography template
 * (which interpolated trait tables that 2e does not have) are gone.
 *
 * Two entry points:
 *
 * - {@link CairnCharacterCreator} (`module/apps/character-creator.js`) drives the interactive flow
 *   and calls the small rollers here, then {@link createCharacterFromDraft} for a new Actor or
 *   {@link applyDraftToActor} for the one it was opened from.
 * - {@link createCharacter} / {@link regenerateActor} are the headless "roll everything" path —
 *   `core-rules.md` describes hireling creation as exactly that, and a Warden making six of them
 *   does not want a wizard six times.
 *
 * Starting gear is a list of compendium uuids on the Background and is embedded as-is. The d6
 * table results are still prose, and a result that names an item is turned into a real embedded
 * Item on the fly (the maintainer's decision): the clause is parsed for `(_petty_)` / `(_bulky_)`
 * / `(dN)` / `(N uses)` / `(N Armor)` only, its full prose is kept as the item description, and a
 * Marketplace compendium entry is used verbatim where a clause just names one. Results that grant
 * only an ability (no bold item name) become a *petty* Item instead.
 */

import { CairnActor } from "./documents/actor.js";
import { PACKS, BACKGROUND_SELECTOR_TABLE, GEAR_ARTWORK } from "./constants.js";
import { drawTable, drawTableText, loadPack, pick, stripTags, detachSource } from "./helpers.js";
import { CairnRoll } from "./rolls.js";
import { coinItem } from "./coin-rules.js";

/* -------------------------------------------- */
/*  Constants                                   */
/* -------------------------------------------- */

/** The eight d10 trait tables, in `character-creation.md` order. Keys match `CharacterData.traits`. */
export const TRAIT_KEYS = ["physique", "skin", "hair", "face", "speech", "clothing", "virtue", "vice"];

/**
 * The eight traits as the rows the sheet, the edit window and the creator draw.
 * @param {Record<string, string>} [traits]
 * @returns {{ key: string, label: string, value: string }[]}
 */
export const traitRows = (traits) => TRAIT_KEYS.map((key) => ({
  key,
  label: `CAIRN.Trait.${key.charAt(0).toUpperCase()}${key.slice(1)}`,
  value: traits?.[key] ?? ""
}));

/** The three attributes, rolled in this order (3d6 each) before the optional single swap. */
export const ATTR_KEYS = ["STR", "DEX", "WIL"];

const BLANK_TRAITS = Object.fromEntries(TRAIT_KEYS.map((k) => [k, ""]));

/** Which Marketplace pack a resolved kind is looked up in. */
const MARKET_PACK = {
  gear: PACKS.GEAR,
  weapon: PACKS.WEAPONS,
  armor: PACKS.ARMOR
};

const GOLD_LINE = /^(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+Gold Pieces\.?$/i;

/* -------------------------------------------- */
/*  Dice                                        */
/* -------------------------------------------- */

/** Evaluate a plain formula and return its total. Never routed through the Cairn `d8+d8` shim —
 *  `2d20 + 10` must stay a sum, not become `{2d20,10}kh`. */
async function rollTotal(formula) {
  return (await new CairnRoll(formula).evaluate()).total;
}

/** 3d6 for each attribute, in STR/DEX/WIL order. The swap is the caller's to apply. */
export async function rollAttributeSet() {
  const out = {};
  for (const key of ATTR_KEYS) out[key] = await rollTotal("3d6");
  return out;
}

/** 1d6 starting Hit Protection. */
export async function rollHitProtection() {
  return rollTotal("1d6");
}

/** Age: 2d20+10. */
export async function rollAge() {
  return rollTotal("2d20 + 10");
}

/* -------------------------------------------- */
/*  Compendium draws                            */
/* -------------------------------------------- */

/** Every Background Item, sorted by name (the `character-creation.md` d20 list is alphabetical). */
export async function getBackgrounds() {
  const pack = await loadPack(PACKS.BACKGROUNDS);
  if (!pack) return [];
  return pack.contents.filter((d) => d.type === "background").sort((a, b) => a.name.localeCompare(b.name));
}

/** Roll the d20 Backgrounds selector table and resolve the Background Item it points at. */
export async function drawBackground() {
  const draw = await drawTable(PACKS.BACKGROUND_TABLES, BACKGROUND_SELECTOR_TABLE);
  const uuid = draw.results[0]?.documentUuid;
  const background = uuid ? await fromUuid(uuid) : null;
  return { background, roll: draw.roll?.total ?? null };
}

/** Draw one d6 Background table (referenced by its full compendium uuid).
 *
 *  Two forms of the same result: `html` as authored, which is what `parseTableResult` reads the
 *  granted items and gold out of, and `text` as a sentence, which is what the character keeps
 *  and every surface shows. Nothing the player sees is markup. */
export async function drawBackgroundTable(uuid) {
  const table = await fromUuid(uuid);
  if (!table) return null;
  const draw = await table.draw({ displayChat: false });
  const html = draw.results[0]?.description ?? "";
  return { name: table.name, total: draw.roll?.total ?? null, html, text: toPlainText(html) };
}

/** Draw one d10 trait table; returns the plain trait word. */
export async function rollTrait(key) {
  const name = key.charAt(0).toUpperCase() + key.slice(1);
  const text = await drawTableText(PACKS.TRAITS, name);
  return stripTags(text).trim();
}

/** Roll all eight trait tables. */
export async function rollAllTraits() {
  const out = {};
  for (const key of TRAIT_KEYS) out[key] = await rollTrait(key);
  return out;
}

/** Draw a Bond (d20) — plain text, like every other drawn line a character keeps. */
export async function drawBond() {
  return toPlainText(await drawTableText(PACKS.BONDS, "Bonds"));
}

/** Draw an Omen (d20) — plain text, like the Bond above it. */
export async function drawOmen() {
  return toPlainText(await drawTableText(PACKS.OMENS, "Omens"));
}

/** One name off the draft's Background list; the Background's own name when the list is empty.
 *  Not a `Roll`: the SRD says "choose a name from the available list", so a 3D die for a list
 *  pick would be theatre. */
export function drawName(draft) {
  const names = draft.names;
  return names.length ? pick(names) : draft.backgroundName;
}

/* -------------------------------------------- */
/*  Text helpers                                */
/* -------------------------------------------- */

/**
 * Authored HTML as a sentence — tags gone, the entities they need decoded, whitespace collapsed.
 * `stripTags` leaves `&gt;` reading as `&gt;` and fuses two paragraphs into one word; both show
 * up in a Background table result, which is text a player reads.
 */
export function toPlainText(html) {
  return String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    // A tag becomes a space, so `<em>specialty</em>.` would otherwise end "specialty ." — the
    // space a closing tag left in front of its own punctuation.
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .replace(/([[(])\s+/g, "$1")
    .trim();
}

/**
 * The same job for a field that is a block rather than a sentence: tags and entities go and runs
 * of spaces collapse, but **line breaks survive**. A character's description is several things
 * joined — a career, the prose written about them, the Features they used to carry — and
 * collapsing it the way a Bond is collapsed would fuse all of them into one paragraph.
 *
 * A block tag becomes a break rather than a space, because the likeliest paste into that field is
 * authored HTML: the description an NPC had before someone was promoted out of it. Runs of blank
 * lines are capped at one, so a paste cannot stretch the tab it prints on.
 */
export function toPlainLines(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .replace(/([[(])\s+/g, "$1")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Convert the SRD's inline markdown (`_em_`, `**strong**`) to HTML, escaping the rest. */
function mdToHtml(str) {
  return escapeHtml(str)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

/* -------------------------------------------- */
/*  Item parsing                                */
/* -------------------------------------------- */

/** `d6+d6` → `d6`; anything outside `GearData`'s d4–d12 damage choices → `d6`. */
function normalizeDie(die) {
  const first = String(die).match(/d\d+/)?.[0] ?? "d6";
  return ["d4", "d6", "d8", "d10", "d12"].includes(first) ? first : "d6";
}

/**
 * Bold phrases the SRD emphasises that are never the name of a granted Item. A bold immediately
 * followed by the word "table" or "step" is filtered separately.
 */
const NON_ITEM_BOLD = new Set([
  "bonds", "attributes", "hp", "critical damage", "recharge", "fatigue", "marketplace",
  "easy", "tough", "perilous", "one step", "enhanced", "impaired", "deprived"
]);

/** SRD verbs that introduce a "you receive this" clause in a table result. */
const GRANT_VERB = /\b(?:Take|Carry|Start with|Starting with|You carry|You keep|You start with)\b/;

/**
 * Read mechanical qualifiers from a text fragment — `(d6)`, `(1 Armor)`, `(6 uses)`,
 * `(d12, _blast_, _bulky_)` — plus, when `loose`, bare forms the SRD writes without parentheses
 * (`d6 damage`, `3 uses`, `+1 Armor`). `loose` scanning is skipped when the fragment carries a
 * statblock (`HP`, `STR,`), where a die is a monster's attack, not the item's.
 * @param {string} fragment
 * @param {{ loose?: boolean }} [opts]
 * @returns {{ damage?: string, armor?: number, petty: boolean, bulky: boolean, blast: boolean, uses?: number }}
 */
function scanQualifiers(fragment, { loose = false } = {}) {
  const text = stripTags(fragment).replace(/_/g, "");
  const flags = { petty: false, bulky: false, blast: false };

  const parenBody = text.match(/\(([^)]*)\)/)?.[1] ?? "";
  for (const rawToken of parenBody.split(",")) {
    const token = rawToken.trim().toLowerCase();
    if (!token) continue;
    const armorM = token.match(/^\+?(\d+)\s*armor\b/);
    if (armorM) { flags.armor = Number(armorM[1]); continue; }
    const dieM = token.match(/^\+?(\d*d\d+(?:\s*\+\s*\d*d?\d+)?)/);
    if (dieM) { flags.damage = normalizeDie(dieM[1]); continue; }
    const usesM = token.match(/(\d+)\s*(?:uses?|charges?)\b/);
    if (usesM) { flags.uses = Number(usesM[1]); continue; }
    if (token === "petty") flags.petty = true;
    else if (token === "bulky") flags.bulky = true;
    else if (token === "blast") flags.blast = true;
  }

  if (flags.uses === undefined) {
    const bare = text.match(/(\d+)\s*(?:uses?|charges?)\b/i);
    if (bare) flags.uses = Number(bare[1]);
  }
  if (/\bpetty\b/i.test(text)) flags.petty = true;
  if (/\bbulky\b/i.test(text)) flags.bulky = true;
  if (/\bblast\b/i.test(text)) flags.blast = true;

  const hasStatblock = /\bHP\b/.test(text) || /\bSTR,/.test(text);
  if (loose && !hasStatblock) {
    if (!flags.damage) {
      const bareDie = text.match(/\bd(4|6|8|10|12)\b/);
      if (bareDie) flags.damage = `d${bareDie[1]}`;
    }
    if (flags.armor === undefined) {
      const bareArmor = text.match(/\+?(\d+)\s*Armor\b/);
      if (bareArmor) flags.armor = Number(bareArmor[1]);
    }
  }
  return flags;
}

/**
 * Assemble Item creation data for one item.
 * @param {string} name
 * @param {ReturnType<typeof scanQualifiers>} q
 * @param {string} descHtml  stored verbatim as the item description
 * @returns {object}  Item data, with a private `_link` hint when a Marketplace lookup should be tried
 */
function makeItem(name, q, descHtml) {
  let clean = String(name).replace(/^(?:the|a|an|one|some|two)\s+/i, "").replace(/[.,;:]+$/, "").trim();
  // Title-case a name the SRD left mid-sentence lowercase ("smelting hammer" → "Smelting Hammer").
  if (/^[a-z]/.test(clean) && clean === clean.toLowerCase()) {
    clean = clean.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }

  // The kind is read off the qualifiers and written as FIELDS on one `gear` document: an armour
  // value, a die, or a magic kind.
  let kind = "gear";
  if (q.armor !== undefined) kind = "armor";
  else if (q.damage) kind = "weapon";
  else if (/^spellbooks?$/i.test(clean)) kind = "spellbook";
  else if (/^scrolls?$/i.test(clean)) kind = "scroll";

  const system = { description: descHtml };
  // The qualifiers name two of the values `slots` can take; *petty* wins a line that says both,
  // as it did when these were two flags.
  if (q.petty) system.slots = 0;
  else if (q.bulky) system.slots = 2;
  if (q.uses) system.uses = { value: q.uses, max: q.uses };

  if (kind === "weapon") {
    system.damage = q.damage ?? "d6";
    if (q.blast) system.blast = true;
  } else if (kind === "armor") {
    system.armor = Math.min(Math.max(q.armor, 0), 3);
    system.equipped = true;
  } else if (kind === "spellbook" || kind === "scroll") {
    system.magic = kind;
  }

  // Art by the KIND the line reads as, from the same table the Create Item prompt uses.
  const data = { name: clean, type: "gear", img: GEAR_ARTWORK[kind] ?? GEAR_ARTWORK.gear, system };
  if (MARKET_PACK[kind]) data._link = MARKET_PACK[kind];
  return data;
}

/**
 * Parse one free-text gear line — `Name (d6, _bulky_, 3 uses)` — into Item data.
 *
 * Background starting gear no longer passes through here: it is authored as compendium uuids
 * and embedded verbatim by `assembleActorData`. The one input that is still text is a
 * Kettlewright export (`module/kettlewright-import.js`), where an item's qualifiers arrive as
 * tags and are re-spelled as a line so this one grammar covers them.
 * @param {string} line
 * @returns {{ kind: "gold", formula: string } | { kind: "item", data: object } | { kind: "none" }}
 */
export function parseGearLine(line) {
  const raw = String(line ?? "").trim();
  const goldM = raw.match(GOLD_LINE);
  if (goldM) return { kind: "gold", formula: goldM[1].replace(/\s+/g, "") };

  const plain = stripTags(raw).replace(/_/g, "").trim();
  if (!plain) return { kind: "none" };

  const parenStart = plain.indexOf("(");
  const name = (parenStart >= 0 ? plain.slice(0, parenStart) : plain).trim();
  if (!name) return { kind: "none" };

  const q = scanQualifiers(plain); // strict: starting-gear lines always parenthesise their qualifiers
  const data = makeItem(name, q, `<p>${mdToHtml(raw)}</p>`);
  return { kind: "item", data };
}

/**
 * Parse one d6 Background-table result into zero or more Items plus, when no Item is granted, the
 * ability text, which the caller turns into a petty Item.
 *
 * The SRD writes these three ways: `Take a **Item** (quals)` / a leading `A/The **Item** …` /
 * a `**Label**.` or `**Label**:` clause that grants only an ability. Multiple `Take a **X** and a
 * **Y**` items in one clause are all captured. An explicit coin grant (`Take an extra 30gp`) is
 * returned as `gold`.
 * @param {string} html
 * @returns {{ items: object[], gold: number, abilityHtml: string|null }}
 */
export function parseTableResult(html) {
  const src = String(html ?? "");
  const plain = stripTags(src).replace(/_/g, "");
  if (!plain.trim()) return { items: [], gold: 0, abilityHtml: null };

  const goldM = plain.match(/\b(?:Take|carry)\b[^.]*?\b(?:extra |another )?(\d+)\s*gp\b/i);
  const gold = goldM ? Number(goldM[1]) : 0;

  const firstBold = src.match(/<strong>([^<]*)<\/strong>/i);
  const afterFirstBold = firstBold ? stripTags(src.slice(firstBold.index + firstBold[0].length)) : "";
  const labelled = !!firstBold && /^\s*[.:]/.test(afterFirstBold);
  const startsWithBold = /^\s*(?:<p>)?\s*<strong>/i.test(src);

  const items = [];
  const seen = new Set();
  const add = (name, q) => {
    const key = name.trim().toLowerCase();
    // Skip non-items: the stoplist, a bold amount ("+d4 HP", "30gp", "an extra 20gp"), duplicates.
    if (!key || NON_ITEM_BOLD.has(key) || seen.has(key)) return;
    if (/\bhp\b/i.test(key) || /\d+\s*gp\b/i.test(key) || /^\+?\d/.test(key)) return;
    seen.add(key);
    items.push(makeItem(name, q, src));
  };

  // (a) Leading "A / The <strong>Item</strong> …" — the phrasing of the "what did you take" tables.
  const lead = src.match(/^\s*(?:<p>\s*)?(?:A|An|The|One|Both|Two|Your)\s+<strong>([^<]+)<\/strong>(.{0,4})/i);
  if (lead) {
    const nextChar = stripTags(lead[2]).trim()[0] ?? "";
    if (/^[A-Z]/.test(lead[1].trim()) || ".,([".includes(nextChar)) {
      add(lead[1].trim(), scanQualifiers(plain.split(/\.\s/)[0], { loose: true }));
    }
  }

  // (b) A "Take / Carry / …" clause, up to the first sentence break outside parentheses.
  const grantIdx = src.search(GRANT_VERB);
  if (grantIdx >= 0) {
    let clause = src.slice(grantIdx);
    let depth = 0;
    for (let i = 0; i < clause.length - 1; i++) {
      const c = clause[i];
      if (c === "(") depth++;
      else if (c === ")") depth = Math.max(0, depth - 1);
      else if (c === "." && depth === 0 && /[\s<]/.test(clause[i + 1])) { clause = clause.slice(0, i); break; }
    }
    const boldRe = /<strong>([^<]+)<\/strong>/gi;
    let m;
    while ((m = boldRe.exec(clause))) {
      const tail = stripTags(clause.slice(m.index + m[0].length));
      if (/^\s*(?:table\b|step\b)/i.test(tail)) continue;
      const frag = tail.split(/,\s+(?:an? |the |and )|\band\b/i)[0];
      add(m[1].trim(), scanQualifiers(`${m[1]} ${frag}`));
    }
  }

  // (c) "**Item** — free-standing description" (the marvels / tools / potions tables).
  if (!items.length && startsWithBold && !labelled && firstBold) {
    add(firstBold[1].trim(), scanQualifiers(plain, { loose: true }));
  }

  // (d) "**Item**. …N uses." — some tables label a consumable like an ability but it plainly is
  //     one (Fungal Forager's fungi). Only promote when an explicit use count settles it.
  if (!items.length && labelled && firstBold && plain.length < 240 && /\b\d+\s*uses?\b/i.test(plain)) {
    add(firstBold[1].trim(), scanQualifiers(plain, { loose: true }));
  }

  // Companions and mounts: a statblock in the blurb is not the item's own die.
  const isCompanion = /\+\d+\s*slots?\b/i.test(plain) || /\b\d+\s*HP\b/.test(plain);
  for (const it of items) {
    if (isCompanion && it.system.damage) {
      delete it.system.damage;
      delete it.system.blast;
      delete it._link;
      it.img = GEAR_ARTWORK.gear;
    }
  }

  return { items, gold, abilityHtml: items.length ? null : (plain.trim() ? src : null) };
}

/* -------------------------------------------- */
/*  Item resolution                             */
/* -------------------------------------------- */

/**
 * Turn parsed Item data into final creation data: use a Marketplace compendium entry verbatim when
 * one matches by name and type, otherwise keep the bespoke object. Parsed qualifiers
 * (slots/uses/equipped) are overlaid on a Marketplace hit so `Twin Daggers (_bulky_)` stays
 * bulky even when it resolves to the pack's `Dagger`.
 *
 * Exported for the Kettlewright importer, which reuses this and {@link parseGearLine}
 * rather than duplicating the parse-then-resolve pipeline.
 */
export async function resolveItem(data) {
  if (data._link) {
    const hit = (await loadPack(data._link))?.find(
      (d) => d.type === data.type && d.name.toLowerCase() === data.name.toLowerCase()
    );
    if (hit) {
      const obj = detachSource(hit.toObject());
      if (data.system.slots !== undefined) obj.system.slots = data.system.slots;
      if (data.system.equipped) obj.system.equipped = true;
      if (data.system.uses) obj.system.uses = data.system.uses;
      return obj;
    }
  }
  const clean = foundry.utils.deepClone(data);
  delete clean._link;
  return clean;
}

/* -------------------------------------------- */
/*  Assembly                                    */
/* -------------------------------------------- */

/** A blank draft seeded from a chosen Background Item. */
export function draftFromBackground(background) {
  return {
    backgroundUuid: background?.uuid ?? null,
    backgroundName: background?.name ?? "",
    description: background?.system.description ?? "",
    names: background?.system.names ?? [],
    startingGold: background?.system.startingGold ?? "",
    startingGear: background?.system.startingGear ?? [],
    tables: background?.system.tables ?? [],
    name: "",
    attrs: null,
    swapped: false,
    // The two boxes picked for the swap — view state, but on the draft so a partial render of
    // the Attributes step can read it. Never written to the actor.
    swapPicks: [],
    hp: null,
    age: null,
    youngest: false,
    traits: {},
    bond: "",
    omen: "",
    tableResults: []
  };
}

/**
 * A background-table result that grants an ability rather than a thing.
 *
 * It is still something the character HAS, so it becomes a *petty* gear Item — petty because an
 * ability occupies no slot — and lands on the sheet's Petty tab. It used to be appended to
 * `system.biography`; that field is gone, and dropping the text instead would have made the
 * creator quietly produce an incomplete character.
 *
 * Naming it is the fiddly part. A few results open with a bolded label (`**Beast Friend.** You
 * can …`) and that is the name; most do not — "Your family has a long tradition of serving, and
 * you were trained from an early age" is typical — so the fallback is the result's own first
 * sentence, clipped. Falling back to the background's name instead would give every ability from
 * the same background the same name, which is no name at all.
 * @param {string} html  The whole table result, as authored.
 * @param {string} backgroundName
 * @returns {object}  `Item.create` data.
 */
function abilityItem(html, backgroundName) {
  const raw = String(html);
  const label = raw.match(/<strong>([^<]+)<\/strong>/i)?.[1]?.replace(/[.:\s]+$/, "").trim();
  const plain = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const sentence = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
  const clipped = sentence.length > 48 ? `${sentence.slice(0, 47).trimEnd()}\u2026` : sentence;
  return {
    name: label || clipped || backgroundName || game.i18n.localize("CAIRN.CharacterCreator.DefaultName"),
    type: "gear",
    img: "icons/svg/book.svg",
    system: { description: raw, slots: 0 }
  };
}

/** A draft table draw as the character's stored slot; a blank slot when nothing was drawn. */
function tableSlot(result) {
  return { question: result?.name ?? "", answer: result?.text ?? "" };
}

/**
 * Turn a finished draft into `Actor.create` data — attributes, HP, bond, omen, age, traits, and
 * the embedded Items: the Background itself, the starting gear, the sack of starting gold and
 * the two table results.
 * @param {object} draft
 * @returns {Promise<object>}
 */
export async function assembleActorData(draft) {
  const items = [];
  let gold = 0;

  // The Background travels WITH the character, as an embedded Item: it carries the name list, the
  // starting gear and the two d6 tables, and none of that survives being reduced to a string. It
  // occupies no slot (`_derived.js#slotsForItem`).
  if (draft.backgroundUuid) {
    const background = await fromUuid(draft.backgroundUuid);
    if (background) {
      const source = detachSource(background.toObject());
      items.push(source);
    }
  }

  if (draft.startingGold) gold += await rollTotal(draft.startingGold);

  // Starting gear is a list of compendium uuids, authored on the Background. Each one is
  // embedded as a detached copy, the same way the Background itself is above, so the character
  // never reads the pack again once made.
  for (const uuid of draft.startingGear ?? []) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) {
      // A background pointing at a document that was deleted or moved. Said out loud rather
      // than skipped in silence — a character short one item is otherwise indistinguishable
      // from a background that never listed it.
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MissingStartingGear", { uuid }));
      continue;
    }
    const source = detachSource(doc.toObject());
    // Armour is worn from the first scene. A pack document ships unequipped, and unequipped
    // armour counts for nothing (`_derived.js#sumEquippedArmor`) — a Fieldwarden created with
    // its Brigandine in the pack would start at 0 Armor.
    if (source.system.armor > 0) source.system.equipped = true;
    items.push(source);
  }

  for (const result of draft.tableResults ?? []) {
    if (!result?.html) continue;
    const parsed = parseTableResult(result.html);
    for (const data of parsed.items) items.push(await resolveItem(data));
    gold += parsed.gold;
    if (parsed.abilityHtml) items.push(abilityItem(parsed.abilityHtml, draft.backgroundName));
  }

  // Coin is an Item (`data/item-coin.js`): the `3d6 Gold Pieces` every background opens with, and
  // whatever a table result added, are one sack on the body in the same batch as the gear.
  if (gold > 0) items.push(coinItem(gold, game.i18n.localize("CAIRN.Gold")));

  const attrs = draft.attrs ?? { STR: 10, DEX: 10, WIL: 10 };
  const hp = draft.hp ?? 0;

  return {
    name: draft.name?.trim() || draft.backgroundName || game.i18n.localize("CAIRN.CharacterCreator.DefaultName"),
    type: "character",
    system: {
      abilities: {
        STR: { value: attrs.STR, max: attrs.STR },
        DEX: { value: attrs.DEX, max: attrs.DEX },
        WIL: { value: attrs.WIL, max: attrs.WIL }
      },
      hp: { value: hp, max: hp },
      bond: draft.bond ?? "",
      // Only the youngest character draws one, so the flag follows `youngest` rather than the
      // text: a youngest character with a blank Omen still has an Omen section to fill in.
      omen: { enabled: !!draft.youngest, text: draft.youngest ? (draft.omen ?? "") : "" },
      age: draft.age ?? 0,
      traits: { ...BLANK_TRAITS, ...draft.traits },
      backgroundTables: {
        first: tableSlot(draft.tableResults?.[0]),
        second: tableSlot(draft.tableResults?.[1])
      }
    },
    items
  };
}

/**
 * The 2e starting **Backpack** — a 6-slot container `gear` embedded in the character ("Each PC
 * starts with a Backpack that can hold up to six slots of items or Fatigue",
 * `srd-2e/players-guide/character-creation.md`). The PC's ten body slots are a flat rule;
 * the Backpack's six are its own — so it takes slots (the character hauls it) and costs none of
 * the ten (`slots: 0`, which is *petty*), which is how `_derived.js#slotsForItem` keeps it off
 * the ledger. Confirmed by the maintainer (2026-09-22) against character-creation.md § Inventory:
 * the six ride on top of the ten. Do not re-read the "total of ten" sentence as including the pack.
 * @returns {object}  `Item.create` data.
 */
export function backpackData() {
  return {
    type: "gear",
    name: game.i18n.localize("CAIRN.Backpack"),
    img: "icons/containers/bags/pack-simple-leather-tan.webp",
    system: { capacity: 6, takesSlots: true, slots: 0 }
  };
}

/**
 * Create the PC Actor from a draft, then give it its Backpack.
 * @param {object} draft
 * @returns {Promise<CairnActor|null>}
 */
export async function createCharacterFromDraft(draft) {
  const actor = await CairnActor.create(await assembleActorData(draft));
  if (!actor) return null;
  await actor.createEmbeddedDocuments("Item", [backpackData()]);
  return actor;
}

/**
 * Write a draft into an existing Actor: wipe its Items, overwrite name + system, rebuild Items.
 *
 * Containers and what they hold survive: a new character written into the same Actor keeps the
 * Backpack and the mule the old one was carrying, exactly as they did when a container was a
 * separate document. Contents are kept by keeping the containers — a contained item whose
 * container went would be stranded in the collection pointing at nothing. A character with no
 * container at all gets the Backpack: a blank actor made from the directory has none.
 * @param {CairnActor} actor
 * @param {object} draft
 * @returns {Promise<CairnActor>}
 */
export async function applyDraftToActor(actor, draft) {
  const data = await assembleActorData(draft);
  const kept = new Set(actor.items.filter((i) => i.system.isContainer).map((i) => i.id));
  const doomed = actor.items
    .filter((i) => !kept.has(i.id) && !kept.has(i.system.container))
    .map((i) => i.id);
  await actor.deleteEmbeddedDocuments("Item", doomed, { render: false });
  await actor.update({ name: data.name, system: data.system });
  if (!kept.size) data.items.push(backpackData());
  if (data.items.length) await actor.createEmbeddedDocuments("Item", data.items);
  // One write per scene, not one per token.
  const byScene = new Map();
  for (const token of actor.getActiveTokens()) {
    const scene = token.document.parent;
    byScene.set(scene, [...(byScene.get(scene) ?? []), { _id: token.id, name: actor.name }]);
  }
  for (const [scene, updates] of byScene) await scene.updateEmbeddedDocuments("Token", updates);
  return actor;
}

/* -------------------------------------------- */
/*  Headless path (hirelings, Regenerate)       */
/* -------------------------------------------- */

/** Roll a complete draft with no choices — random background, random name, no swap, no Omen. */
export async function randomDraft() {
  const { background } = await drawBackground();
  const draft = draftFromBackground(background);
  draft.name = drawName(draft);
  draft.attrs = await rollAttributeSet();
  draft.hp = await rollHitProtection();
  draft.age = await rollAge();
  draft.traits = await rollAllTraits();
  draft.bond = await drawBond();
  for (const uuid of draft.tables) draft.tableResults.push(await drawBackgroundTable(uuid));
  return draft;
}

/**
 * Headless "roll everything" — used for hirelings and by the directory macro fallback.
 * @returns {Promise<CairnActor|null>}
 */
export async function createCharacter() {
  return createCharacterFromDraft(await randomDraft());
}

/**
 * Re-roll an existing Actor in place with no choices — see {@link applyDraftToActor}.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export async function regenerateActor(actor) {
  return applyDraftToActor(actor, await randomDraft());
}

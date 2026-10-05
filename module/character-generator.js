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
 * Starting gear is a list of compendium uuids on the Background and is embedded as-is. What a d6
 * table result grants is authored the same way: `document` results sharing the prose result's
 * range, one per granted Item — a Marketplace line, a `background-gear` document, a sack of coin,
 * or a growth (an ability, a vow, a change to the sheet; {@link resolveGrowth}). Nothing is read
 * out of the prose, because the prose is what a translation module translates: a grammar parsed
 * in English would grant nothing in any other language, and it was not reliable in English either.
 *
 * The one text grammar left is {@link parseGearLine}, and it serves the Kettlewright importer alone
 * (`module/kettlewright-import.js`), whose exports are English by decision.
 */

import { CairnActor } from "./documents/actor.js";
import { SYSTEM_ID, FLAGS, PACKS, TABLES, TRAIT_TABLES, GEAR_ARTWORK } from "./constants.js";
import { drawTable, drawTableText, loadPack, pick, stripTags, copyOf, withWorldCopies } from "./helpers.js";
import { evaluateFormula } from "./rolls.js";
import { gainUpdate } from "./gains.js";
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

/** A silent total for the generator's own rolls — attributes, HP, age, starting gold, a granted
 *  growth's gain. No card: the character is the result. */
async function rollTotal(formula) {
  return (await evaluateFormula(formula)).total;
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

/**
 * The world's Backgrounds this user may be offered. A world Item is owned by its maker alone until
 * it is shared, so a Background the Warden is still writing is not offered to a player.
 * @returns {Item[]}
 */
function worldBackgrounds() {
  return game.items.filter((i) => i.type === "background" && i.testUserPermission(game.user, "OBSERVER"));
}

/** Every Background a creator offers, sorted by name: the pack's twenty, with a Warden's imported
 *  copy standing in for its original, and every Background made in the world. */
export async function getBackgrounds() {
  const pack = await loadPack(PACKS.BACKGROUNDS);
  const shipped = pack?.contents.filter((d) => d.type === "background") ?? [];
  return withWorldCopies(shipped, worldBackgrounds()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Is this one of the SRD's twenty — the pack's own, or a Warden's imported copy of one? These are
 * what the d20 rolls; a Background made in the world is chosen, never rolled.
 * @param {Item} background
 * @returns {boolean}
 */
export function isSrdBackground(background) {
  const from = background.pack ? background.uuid : background._stats?.compendiumSource;
  return !!from?.startsWith(`Compendium.${PACKS.BACKGROUNDS}.`);
}

/** Roll the d20 Backgrounds selector table and resolve the Background Item it points at — the
 *  Warden's imported copy of it when this user may see one. The d20 is the SRD's twenty; a
 *  Background made in the world is picked, not rolled. */
export async function drawBackground() {
  const draw = await drawTable(TABLES.BACKGROUNDS);
  const uuid = draw.results[0]?.documentUuid;
  const copy = uuid && worldBackgrounds().find((i) => i._stats.compendiumSource === uuid);
  const background = copy || (uuid ? await fromUuid(uuid) : null);
  return { background, roll: draw.roll?.total ?? null };
}

/** A draw that grants: the one `text` result is the prose, as `html` and as `text` — a sentence
 *  that is what the character keeps and every surface shows (nothing the player sees is markup) —
 *  and the `document` results that share its range are what it grants: their uuids are `grants`. */
function proseAndGrants(draw) {
  const html = draw.results.find((r) => r.type === "text")?.description ?? "";
  const grants = draw.results.filter((r) => r.type === "document").map((r) => r.documentUuid);
  return { html, text: toPlainText(html), grants };
}

/** Draw one d6 Background table (referenced by its full compendium uuid). */
export async function drawBackgroundTable(uuid) {
  const table = await fromUuid(uuid);
  if (!table) return null;
  const draw = await table.draw({ displayChat: false });
  return { name: table.name, total: draw.roll?.total ?? null, ...proseAndGrants(draw) };
}

/** Draw one d10 trait table; returns the plain trait word. */
export async function rollTrait(key) {
  const text = await drawTableText(TRAIT_TABLES[key]);
  return stripTags(text).trim();
}

/** Roll all eight trait tables. */
export async function rollAllTraits() {
  const out = {};
  for (const key of TRAIT_KEYS) out[key] = await rollTrait(key);
  return out;
}

/** Draw a Bond (d20) — plain text, like every other drawn line a character keeps, and the uuids
 *  of what it hands over (the Strange Compass and 20gp), authored as a Background face's are. */
export async function drawBond() {
  const { text, grants } = proseAndGrants(await drawTable(TABLES.BONDS));
  return { text, grants };
}

/** Draw an Omen (d20) — plain text, like the Bond above it. */
export async function drawOmen() {
  return toPlainText(await drawTableText(TABLES.OMENS));
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
 * Read mechanical qualifiers from a gear line — `(d6)`, `(1 Armor)`, `(6 uses)`,
 * `(d12, _blast_, _bulky_)`.
 * @param {string} fragment
 * @returns {{ damage?: string, armor?: number, petty: boolean, bulky: boolean, blast: boolean, uses?: number }}
 */
function scanQualifiers(fragment) {
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

  const q = scanQualifiers(plain);
  const data = makeItem(name, q, `<p>${mdToHtml(raw)}</p>`);
  return { kind: "item", data };
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
    const obj = copyOf(hit);
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
    // What the drawn Bond hands over, as uuids. They belong to the draw, not to the words: a
    // Bond reworded or cleared keeps them, and the player strikes one off by hand.
    bondGrants: [],
    omen: "",
    tableResults: []
  };
}

/** A draft table draw as the character's stored slot; a blank slot when nothing was drawn. */
function tableSlot(result) {
  return { question: result?.name ?? "", answer: result?.text ?? "" };
}

/**
 * Turn a finished draft into `Actor.create` data — attributes, HP, bond, omen, age, traits, and
 * the embedded Items: the Background itself, the starting gear, the sack of starting gold, and
 * what the two table results and the Bond grant.
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
    const source = copyOf(background);
    items.push(source);
    }
  }

  if (draft.startingGold) gold += await rollTotal(draft.startingGold);

  // Starting gear, and what each d6 table result grants, are lists of compendium uuids authored
  // on the Background and on the table. Each one is embedded as a detached copy, the same way the
  // Background itself is above, so the character never reads the pack again once made.
  const growths = [];
  const embed = async (uuids) => {
    for (const uuid of uuids ?? []) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) {
      // A background pointing at a document that was deleted or moved. Said out loud rather
      // than skipped in silence — a character short one item is otherwise indistinguishable
      // from a background that never listed it.
      ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MissingStartingGear", { uuid }));
      continue;
    }
    // A granted sack of coin joins the one sack below rather than arriving as a second.
    if (doc.type === "coin") {
      gold += doc.system.value;
      continue;
    }
    // A granted growth is made true on the character once its numbers exist (below).
    if (doc.type === "growth") {
      growths.push(copyOf(doc));
      continue;
    }
    const source = copyOf(doc);
    // Armour is worn from the first scene. A pack document ships unequipped, and unequipped
    // armour counts for nothing (`_derived.js#sumEquippedArmor`) — a Fieldwarden created with
    // its Brigandine in the pack would start at 0 Armor.
    if (source.system.armor > 0) source.system.equipped = true;
    items.push(source);
    }
  };
  await embed(draft.startingGear);
  for (const result of draft.tableResults ?? []) await embed(result?.grants);
  await embed(draft.bondGrants);

  const attrs = draft.attrs ?? { STR: 10, DEX: 10, WIL: 10 };
  const hp = draft.hp ?? 0;

  const system = {
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
  };
  // Last, because a growth moves a number the lines above have just set. A growth that draws a
  // second Bond hands over what that Bond names, through the same `embed` as everything above.
  for (const growth of growths) items.push(await resolveGrowth(growth, system, embed));

  // Coin is an Item (`data/item-coin.js`): the `3d6 Gold Pieces` every background opens with, and
  // whatever a table result or a Bond added, are one sack on the body in the same batch as the
  // gear. After the growths, because a second Bond can add coin too.
  if (gold > 0) items.push(coinItem(gold, game.i18n.localize("CAIRN.Gold")));

  return {
    name: draft.name?.trim() || draft.backgroundName || game.i18n.localize("CAIRN.CharacterCreator.DefaultName"),
    type: "character",
    system,
    items
  };
}

/**
 * Make a growth a Background table grants true on the character being built, and record it.
 *
 * A growth is what the character underwent; a Background's d6 is what they underwent before play
 * (`srd-2e/wardens-guide/growth.md` files the table-driven kind, Scars, under Growth too). So a
 * face that changes the sheet itself grants a `growth` document, and this is where it lands:
 *
 * - `outcome.formula` rolls and adds to `outcome.attr`'s maximum — "Start with +d4 HP". The
 *   value rises with it: this is the Hit Protection the character starts play with, not a
 *   maximum waiting to be healed up to. `from` / `to` are written, so deleting the growth puts
 *   the number back (`CairnActor#revertGain`).
 * - `table` draws that table once and keeps the line as `gained` — "roll a second time on the
 *   Bonds table" — and what the drawn face grants goes through `embed`, so a second Bond brings
 *   its Strange Compass as the first one does.
 * - Neither: the gain is the growth's own prose — an ability, a vow, a companion.
 *
 * Every one of them is `resolved`: nothing about it is still owed.
 * @param {object} data    the growth's creation data (`copyOf`)
 * @param {object} system  the character's `system` as assembled so far; mutated
 * @param {(uuids: string[]) => Promise<void>} embed  `assembleActorData`'s, for a drawn face's grants
 * @returns {Promise<object>}  `data`, resolved
 */
async function resolveGrowth(data, system, embed) {
  const { attr, formula } = data.system.outcome ?? {};
  if (attr && formula) {
    const res = attr === "hp" ? system.hp : system.abilities[attr];
    const { from, to } = gainUpdate({ mode: "add", total: await rollTotal(formula), max: res.max, value: res.value });
    res.value += to - from;
    res.max = to;
    Object.assign(data.system.outcome, { from, to });
  }
  if (data.system.table) {
    const { text, grants } = proseAndGrants(await drawTable(data.system.table));
    data.system.gained = text;
    await embed(grants);
  }
  data.system.resolved = true;
  return data;
}

/**
 * Create the PC Actor from a draft.
 *
 * No Backpack is added. "Each PC starts with a Backpack" (`character-creation.md` § Inventory) is
 * how the character carries their ten slots, not six more on top of them — Cairn's author,
 * asked directly (2026-09-27). A container Item for it would either hand out slots the rule
 * does not give or be a row that means nothing.
 * @param {object} draft
 * @returns {Promise<CairnActor|null>}
 */
export async function createCharacterFromDraft(draft) {
  return (await CairnActor.create(await assembleActorData(draft))) ?? null;
}

/**
 * Write a draft into an existing Actor: wipe its Items, overwrite name + system, rebuild Items.
 *
 * Containers and what they hold survive: a new character written into the same Actor keeps the
 * sack and the mule the old one was carrying, exactly as they did when a container was a
 * separate document. Contents are kept by keeping the containers — a contained item whose
 * container went would be stranded in the collection pointing at nothing. So do the character's
 * fists (`FLAGS.UNARMED`): a new character in the same body has the same hands, and whatever the
 * player made of them is theirs.
 * @param {CairnActor} actor
 * @param {object} draft
 * @returns {Promise<CairnActor>}
 */
export async function applyDraftToActor(actor, draft) {
  const data = await assembleActorData(draft);
  const kept = new Set(actor.items
    .filter((i) => i.system.isContainer || i.getFlag(SYSTEM_ID, FLAGS.UNARMED))
    .map((i) => i.id));
  const doomed = actor.items
    .filter((i) => !kept.has(i.id) && !kept.has(i.system.container))
    .map((i) => i.id);
  await actor.deleteEmbeddedDocuments("Item", doomed, { render: false });
  await actor.update({ name: data.name, system: data.system });
  // The generator is one of the controls that may give a growth (`documents/item.js`): the ones
  // it creates are the Background's, resolved against THIS character a moment ago.
  if (data.items.length) await actor.createEmbeddedDocuments("Item", data.items, { [SYSTEM_ID]: { growth: true } });
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
  ({ text: draft.bond, grants: draft.bondGrants } = await drawBond());
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

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Warden-only one-click NPC / hireling generators.
 *
 * The 2e SRD gives NPCs **no stats and no gear** — a generated NPC is name + rolled 3d6 attributes
 * + 1d6 HP + rolled traits + a Background *word* (`wardens-guide/npc-tables.md`), and that
 * alone is a complete NPC. A hireling is the same with a **Career** and day rate off the
 * Marketplace list instead of a Background word.
 *
 * Gear is a thin convenience layer, built **only** from official Marketplace pack items
 * (`cairn2e.gear` / `.weapons` / `.armor`): Rations + a Torch + one random weapon and armor line so
 * the Armor score is real. Every generator-granted Item is flagged `flags.cairn2e.generated` so a
 * re-roll can replace exactly those and keep anything the Warden added by hand.
 *
 * Warden tables are rolled through `helpers.js#rollWardenTable` (world-first, `roll()` not
 * `draw()`); the PC appearance tables are reused from `character-generator.js`.
 */

import { CairnActor } from "./documents/actor.js";
import { SYSTEM_ID, PACKS, GEAR, TABLES } from "./constants.js";
import { loadPack, fromPack, pick, rollWardenText, copyOf } from "./helpers.js";
import { rollAttributeSet, rollHitProtection, rollTrait } from "./character-generator.js";

const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Constants                                   */
/* -------------------------------------------- */

/** The six appearance slots an NPC shares with a PC — rolled off `cairn2e.character-traits` (d10). */
export const APPEARANCE_TRAIT_KEYS = ["physique", "skin", "hair", "face", "speech", "clothing"];

/**
 * The six appearance traits as label/value rows, for the sheet's read-only Details tab and the
 * edit window's inputs alike — one map, so the two surfaces cannot list them differently.
 * @param {object} system  An NPC's `system` data.
 * @returns {{ key: string, label: string, value: string }[]}
 */
export function appearanceTraitRows(system) {
  return APPEARANCE_TRAIT_KEYS.map((key) => ({
    key,
    label: `CAIRN.Trait.${key.charAt(0).toUpperCase()}${key.slice(1)}`,
    value: system.traits?.[key] ?? ""
  }));
}

/** The fields the edit window's dice fill, by key. `career` fills two: the Marketplace fixes the rate to the role. */
export const NPC_DETAIL_KEYS = ["background", "quirk", "goal", "virtue", "vice", ...APPEARANCE_TRAIT_KEYS, "career"];

/** The 12 hireling careers and their gold/day rates — `players-guide/marketplace.md` → Hirelings.
 *  This object is the source of truth `checks/npc-generator.check.mjs` guards against the SRD. */
export const HIRELING_CAREERS = {
  "Alchemist": 30,
  "Animal Handler": 5,
  "Blacksmith": 15,
  "Bodyguard": 10,
  "Local Guide": 5,
  "Lockpick": 10,
  "Navigator": 10,
  "Sailor": 5,
  "Scholar": 20,
  "Tracker": 5,
  "Trapper": 5,
  "Veteran Bodyguard": 20
};

/**
 * Core-icon portrait per NPC Background word. No portrait-picker gallery — that is a later plan,
 * and air-bladder's galleries are CC art this system does not adopt. Every path is a
 * verified Foundry core `icons/**` file.
 */
const BACKGROUND_PORTRAITS = {
  "Academic": "icons/skills/trades/academics-book-study-purple.webp",
  "Assassin": "icons/skills/melee/blade-tip-chipped-blood-red.webp",
  "Blacksmith": "icons/skills/trades/smithing-anvil-silver-red.webp",
  "Farmer": "icons/skills/trades/farming-sickle-harvest-wheat.webp",
  "General": "icons/environment/people/cavalry.webp",
  "Gravedigger": "icons/tools/hand/shovel-spade-steel-grey.webp",
  "Guard": "icons/environment/people/infantry.webp",
  "Healer": "icons/magic/holy/prayer-hands-glowing-yellow.webp",
  "Jailer": "icons/tools/hand/lockpicks-steel-grey.webp",
  "Laborer": "icons/tools/hand/hammer-and-nail.webp",
  "Lord": "icons/skills/social/diplomacy-handshake.webp",
  "Merchant": "icons/skills/trades/academics-merchant-scribe.webp",
  "Monk": "icons/magic/holy/meditation-chi-focus-blue.webp",
  "Mystic": "icons/skills/trades/academics-astronomy-navigation-blue.webp",
  "Outlander": "icons/skills/trades/woodcutting-logging-axe-stump.webp",
  "Peddler": "icons/environment/people/commoner.webp",
  "Politician": "icons/skills/social/diplomacy-writing-letter.webp",
  "Spy": "icons/skills/social/intimidation-impressing.webp",
  "Thief": "icons/tools/hand/lockpicks-steel-grey.webp",
  "Thug": "icons/skills/melee/hand-grip-sword-red.webp"
};

/** Core-icon portrait per hireling Career. */
const CAREER_PORTRAITS = {
  "Alchemist": "icons/tools/laboratory/alembic-glass-ball-blue.webp",
  "Animal Handler": "icons/environment/people/commoner.webp",
  "Blacksmith": "icons/skills/trades/smithing-anvil-silver-red.webp",
  "Bodyguard": "icons/environment/people/infantry.webp",
  "Local Guide": "icons/tools/navigation/map-marked-blue.webp",
  "Lockpick": "icons/tools/hand/lockpicks-steel-grey.webp",
  "Navigator": "icons/skills/trades/academics-astronomy-navigation-blue.webp",
  "Sailor": "icons/environment/people/commoner.webp",
  "Scholar": "icons/sundries/books/book-embossed-blue.webp",
  "Tracker": "icons/skills/trades/mining-pickaxe-yellow-blue.webp",
  "Trapper": "icons/environment/traps/cage-simple-wood.webp",
  "Veteran Bodyguard": "icons/environment/people/infantry-armored.webp"
};

const FALLBACK_PORTRAIT = "icons/environment/people/commoner.webp";

/**
 * A tiny career → extra Marketplace item lookup. Deliberately short and obvious: it is not to
 * grow into a content table. By uuid ({@link GEAR}), never by name, so a translated `cairn2e.gear`
 * still kits the hireling. Rations + Torch + a weapon + armor line are added to every NPC
 * already; these are the one or two items that make a career read at a glance.
 */
const CAREER_KIT = {
  "Alchemist": [GEAR.ANTITOXIN],
  "Animal Handler": [GEAR.ANIMAL_FEED],
  "Local Guide": [GEAR.ROPE],
  "Lockpick": [GEAR.THIEVING_TOOLS],
  "Navigator": [GEAR.COMPASS],
  "Sailor": [GEAR.ROPE],
  "Scholar": [GEAR.BOOK],
  "Tracker": [GEAR.REPELLENT],
  "Trapper": [GEAR.TRAP]
};

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/** Pick a random hireling career and its rate. */
function pickCareer() {
  const career = pick(Object.keys(HIRELING_CAREERS));
  return { career, dayRate: HIRELING_CAREERS[career] };
}

/* -------------------------------------------- */
/*  Marketplace gear                            */
/* -------------------------------------------- */

/** A pack document as a generated copy for an actor: {@link copyOf}, flagged `generated` so a
 *  re-roll replaces exactly these, and worn when asked. */
function detachItem(doc, { equipped = false } = {}) {
  const obj = copyOf(doc);
  if (equipped) obj.system = { ...obj.system, equipped: true };
  obj.flags = foundry.utils.mergeObject(obj.flags ?? {}, { [SYSTEM_ID]: { generated: true } });
  return obj;
}

/** One Marketplace item by uuid, or `null`. */
async function kitItem(uuid, opts) {
  const doc = await fromPack(uuid);
  return doc ? detachItem(doc, opts) : null;
}

/** A random document from a Marketplace pack (one of the weapons, one of the six armor lines). */
async function randomMarketItem(packId, opts) {
  const pack = await loadPack(packId);
  if (!pack?.size) return null;
  return detachItem(pick(pack.contents), opts);
}

/**
 * The convenience kit: Rations (3) + Torch (3) + one random weapon and one random armor line (both
 * equipped, so `armorTotal` derives), plus a hireling's one-line career kit. Any pack that fails to
 * resolve is simply skipped — a gearless NPC is still a complete NPC.
 */
async function buildKit(role, career) {
  const items = [];
  const push = (it) => { if (it) items.push(it); };

  push(await kitItem(GEAR.RATIONS));
  push(await kitItem(GEAR.TORCH));
  push(await randomMarketItem(PACKS.WEAPONS, { equipped: true }));
  push(await randomMarketItem(PACKS.ARMOR, { equipped: true }));

  if (role === "hireling") {
    for (const uuid of CAREER_KIT[career] ?? []) push(await kitItem(uuid));
  }
  return items;
}

/* -------------------------------------------- */
/*  Assembly                                    */
/* -------------------------------------------- */

/**
 * Roll one complete NPC or hireling. Returns `Actor.create` fragments — the caller (or the
 * re-roll) decides what to keep.
 * @param {"npc" | "hireling"} role
 * @returns {Promise<{ name: string, img: string, system: object, items: object[] }>}
 */
async function buildNpcData(role) {
  const isHireling = role === "hireling";

  const name = (await rollWardenText(TABLES.NPC_NAME)) || game.i18n.localize("CAIRN.Npc.DefaultName");
  const background = isHireling ? "" : await rollWardenText(TABLES.NPC_BACKGROUND);
  const { career, dayRate } = isHireling ? pickCareer() : { career: "", dayRate: 0 };

  const traits = { quirk: "", goal: "", virtue: "", vice: "" };
  for (const key of APPEARANCE_TRAIT_KEYS) traits[key] = await rollTrait(key);
  traits.quirk = await rollWardenText(TABLES.NPC_QUIRK);
  traits.goal = await rollWardenText(TABLES.NPC_GOAL);
  traits.virtue = await rollWardenText(TABLES.NPC_VIRTUE);
  traits.vice = await rollWardenText(TABLES.NPC_VICE);

  const attrs = await rollAttributeSet();
  const hp = await rollHitProtection();
  const items = await buildKit(role, career);

  const system = {
    role,
    background,
    career,
    dayRate,
    abilities: {
      STR: { value: attrs.STR, max: attrs.STR },
      DEX: { value: attrs.DEX, max: attrs.DEX },
      WIL: { value: attrs.WIL, max: attrs.WIL }
    },
    hp: { value: hp, max: hp },
    armor: 0,
    morale: null,
    slots: { max: 10 },
    traits
  };

  const img = isHireling
    ? (CAREER_PORTRAITS[career] ?? FALLBACK_PORTRAIT)
    : (BACKGROUND_PORTRAITS[background] ?? FALLBACK_PORTRAIT);

  return { name, img, system, items };
}

/** The Actor creation data for one built person, filed into `folder`. */
function npcActorData({ name, img, system, items }, folder = null) {
  return {
    name,
    type: "npc",
    img,
    folder,
    system,
    items,
    // Players see name + portrait + Description only. Randomization stays off on the sheet, so a
    // sheet shown to a player carries no dice.
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED },
    prototypeToken: { texture: { src: img }, disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL, actorLink: false }
  };
}

async function createNpcActor(built) {
  const actor = await CairnActor.create(npcActorData(built));
  actor?.sheet.render(true);
  return actor;
}

/* -------------------------------------------- */
/*  Public entry points                         */
/* -------------------------------------------- */

/** Someone the party *meets*, with their sheet open. */
export async function generateNpc() {
  return createNpcActor(await buildNpcData("npc"));
}

/**
 * `count` people the party meets, filed into `folder` and created in ONE write — an encounter
 * of three random NPCs was three creates, three directory renders and three broadcasts.
 * @param {number} count
 * @param {{ folder?: string|null }} [opts]
 * @returns {Promise<CairnActor[]>}
 */
export async function generateNpcs(count, { folder = null } = {}) {
  const data = [];
  for (let i = 0; i < count; i++) data.push(npcActorData(await buildNpcData("npc"), folder));
  return data.length ? CairnActor.createDocuments(data) : [];
}

/** Someone the party *pays*. */
export async function generateHireling() {
  return createNpcActor(await buildNpcData("hireling"));
}

/**
 * Re-roll an existing NPC in place. Replaces stats / traits / Background-or-Career and the gear it
 * granted; **keeps** name, portrait, token, description, `role` and anything the Warden added by
 * hand. Asks first. The new stat block arrives at full HP.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export async function regenerateNpc(actor) {
  const confirmed = await DialogV2.confirm({
    classes: [SYSTEM_ID],
    window: { title: game.i18n.localize("CAIRN.RerollNpc") },
    content: `<p>${game.i18n.localize("CAIRN.RerollNpcConfirm")}</p>`,
    rejectClose: false
  });
  if (!confirmed) return actor;

  const role = actor.system.role === "hireling" ? "hireling" : "npc";
  const { system, items } = await buildNpcData(role);

  const staleIds = actor.items.filter((i) => i.getFlag(SYSTEM_ID, "generated")).map((i) => i.id);
  if (staleIds.length) await actor.deleteEmbeddedDocuments("Item", staleIds);

  // Keep the actor's own role — only the rolled block is replaced.
  await actor.update({ system: { ...system, role: actor.system.role } });
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
  return actor;
}

/**
 * Roll one Details field and return what it writes, keyed by form name — the edit window's
 * dice fill inputs with this and let Save do the write. Nothing here touches the actor: a roll
 * is discarded by Cancel like a keystroke is. The name is not among the keys — the window has
 * no name input (`npc-header.hbs` says why the header's is the only one), and the header's
 * *Re-roll NPC* still rolls it.
 * @param {string} key  One of `NPC_DETAIL_KEYS`.
 * @returns {Promise<Record<string, string|number>>}
 */
export async function rollNpcDetail(key) {
  switch (key) {
    case "background": return { "system.background": await rollWardenText(TABLES.NPC_BACKGROUND) };
    case "quirk":      return { "system.traits.quirk": await rollWardenText(TABLES.NPC_QUIRK) };
    case "goal":       return { "system.traits.goal": await rollWardenText(TABLES.NPC_GOAL) };
    case "virtue":     return { "system.traits.virtue": await rollWardenText(TABLES.NPC_VIRTUE) };
    case "vice":       return { "system.traits.vice": await rollWardenText(TABLES.NPC_VICE) };
    case "career": {
      const { career, dayRate } = pickCareer();
      return { "system.career": career, "system.dayRate": dayRate };
    }
    default:
      return { [`system.traits.${key}`]: await rollTrait(key) };
  }
}

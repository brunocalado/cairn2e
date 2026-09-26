/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Warden-only one-click monster generator.
 *
 * Follows the SRD's **"Creating Monsters"** procedure
 * (`srd-2e/wardens-guide/creating-monsters.md`, everything above "Converting Monsters"):
 *
 *   1. Roll Monster Appearance — Physique + Feature.
 *   2. Roll Monster Traits — Quirk + Weakness.
 *   3. Roll Monster Attacks — Type + Critical Damage.
 *   4. Roll Monster Abilities — Ability + Target.
 *   5. Describe the creature in plain English (the five-bullet `description`).
 *   6. Give it stats from the stat-block format.
 *
 * The result is a real `npc` Actor with `role: "monster"` — no new Actor type, no new sheet, no
 * new pack. It gets one equipped `*` attack Item of the tier die, an equipped armour Item when the
 * tier roll grants it (so `armorTotal` derives exactly as for the bestiary), a composed
 * name, and a random core-icon portrait worn by a hostile, unlinked token.
 *
 * ## Hit Protection and the ability ladder are NOT dice
 *
 * The SRD gives *words*, not dice: "average creatures 3 HP, hardier ones 6 HP, serious threats 10
 * or higher"; "3 is deficient, 6 is weak, 10 is average, 14 is noteworthy, 18 is legendary". This
 * generator turns that prose into a tier table (HP + attack die) and a weighted pick over the five
 * ladder rungs. Scores come **only** off `3 / 6 / 10 / 14 / 18` — never a rolled bell curve; that
 * is what separates a monster from an NPC (`module/npc-generator.js` rolls attributes as dice).
 *
 * ### Tier table — the SRD's HP prose as a table
 *
 * | Tier     | HP | Attack die | Armour chance | Armour value        |
 * |----------|----|-----------  |---------------|---------------------|
 * | Standard | 3  | d6         | 25%           | 1                   |
 * | Hardier  | 6  | d8         | 50%           | 1 (×3), 2 (×1)      |
 * | Serious  | 10 | d10        | 75%           | 1 (×2), 2 (×2), 3 (×1) |
 *
 * The attack die follows the tier because the bestiary clusters d6 / d8 / d10. "Random"
 * picks a tier weighted **3 : 2 : 1** (Standard : Hardier : Serious), then everything follows it.
 *
 * ### Ability weight tables — a house realization of the SRD's guidance
 *
 * The SRD's "Ability Score" / "Strength" / "Dexterity" / "Willpower" sections say STR tracks a
 * creature's ability to *survive a direct hit* (so it climbs with tier), DEX starts at 10 and only
 * moves for something notably quick or slow (so it stays mid-band — speed is texture), and WIL is
 * "only as willful as any creature just looking for its next meal" for a plain beast (a bell curve).
 * These weights (index-aligned to the ladder `[3, 6, 10, 14, 18]`) are that prose turned into dice —
 * recorded here so a reviewer does not "correct" them back toward a uniform roll:
 *
 * | Row                          |  3 |  6 | 10 | 14 | 18 |
 * |------------------------------|----|----|----|----|----|
 * | WIL (all), STR (standard)    |  1 |  3 |  8 |  3 |  1 |
 * | STR (hardier)                |  – |  2 |  8 |  4 |  2 |
 * | STR (serious)                |  – |  1 |  5 |  6 |  4 |
 * | DEX (all)                    |  – |  3 | 10 |  3 |  – |
 */

import { CairnActor } from "./documents/actor.js";
import { SYSTEM_ID, TABLES } from "./constants.js";
import { pick, rollWardenTable, rollWardenText, stripTags } from "./helpers.js";

const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Constants                                   */
/* -------------------------------------------- */

/** The five SRD ability rungs. Scores come only off these — see the file header. */
const LADDER = [3, 6, 10, 14, 18];

/** Per-tier HP, attack die, and armour odds. See the tier table in the file header. */
const TIERS = {
  standard: { hp: 3, die: "d6", armorChance: 0.25, armorValues: [1] },
  hardier: { hp: 6, die: "d8", armorChance: 0.5, armorValues: [1, 1, 1, 2] },
  serious: { hp: 10, die: "d10", armorChance: 0.75, armorValues: [1, 1, 2, 2, 3] }
};

/** "Random" draws from this bag — Standard : Hardier : Serious weighted 3 : 2 : 1. */
const RANDOM_TIER_BAG = ["standard", "standard", "standard", "hardier", "hardier", "serious"];

/** Ability-score weights, index-aligned to {@link LADDER}. See the file header for the rationale. */
const ABILITY_WEIGHTS = {
  WIL: [1, 3, 8, 3, 1],
  DEX: [0, 3, 10, 3, 0],
  STR: {
    standard: [1, 3, 8, 3, 1],
    hardier: [0, 2, 8, 4, 2],
    serious: [0, 1, 5, 6, 4]
  }
};

/**
 * Portrait pool — verified Foundry core `icons/creatures/**` paths. The token wears the same
 * image. A monster is not a person, so unlike
 * the NPC generator there is no per-concept mapping — a rolled creature gets a random face.
 */
const MONSTER_PORTRAITS = [
  "icons/creatures/mammals/beast-horned-scaled-glowing-orange.webp",
  "icons/creatures/mammals/bull-horns-eyes-glowin-orange.webp",
  "icons/creatures/mammals/cat-hunched-glowing-red.webp",
  "icons/creatures/mammals/deer-antlers-glowing-blue.webp",
  "icons/creatures/mammals/elk-moose-marked-green.webp",
  "icons/creatures/mammals/rodent-rat-diseaed-gray.webp",
  "icons/creatures/mammals/wolf-shadow-black.webp",
  "icons/creatures/reptiles/dragon-horned-blue.webp",
  "icons/creatures/reptiles/lizard-mouth-glowing-red.webp",
  "icons/creatures/reptiles/serpent-horned-green.webp",
  "icons/creatures/reptiles/snake-fangs-bite-green.webp",
  "icons/creatures/reptiles/turtle-shell-glowing-green.webp",
  "icons/creatures/invertebrates/beetle-stag-tan-brown.webp",
  "icons/creatures/invertebrates/centipede-brown.webp",
  "icons/creatures/invertebrates/leech-attack-green.webp",
  "icons/creatures/invertebrates/scorpion-yellow.webp",
  "icons/creatures/invertebrates/snail-spiral-green.webp",
  "icons/creatures/invertebrates/spider-mandibles-brown.webp",
  "icons/creatures/invertebrates/spider-skull-green.webp",
  "icons/creatures/invertebrates/wasp-swarm-attack.webp",
  "icons/creatures/magical/construct-gargoyle-stone-gray.webp",
  "icons/creatures/magical/construct-golem-stone-blue.webp",
  "icons/creatures/magical/humanoid-giant-forest-blue.webp",
  "icons/creatures/magical/spirit-earth-stone-magma-yellow.webp",
  "icons/creatures/magical/spirit-fire-orange.webp",
  "icons/creatures/magical/spirit-poison-smoke-green.webp",
  "icons/creatures/magical/spirit-undead-ghost-purple.webp",
  "icons/creatures/magical/spirit-undead-horned-blue.webp",
  "icons/creatures/slimes/slime-face-teeth-purple.webp",
  "icons/creatures/slimes/slime-movement-pseudopods-green.webp",
  "icons/creatures/amphibians/bullfrog-glowing-green.webp",
  "icons/creatures/birds/corvid-watchful-glowing-green.webp",
  "icons/creatures/birds/raptor-owl-flying-moon.webp",
  "icons/creatures/fish/deepsea-creature-glowing-blue.webp",
  "icons/creatures/fish/fish-fangtooth-skeletal-green.webp",
  "icons/creatures/fish/squid-kraken-teal.webp",
  "icons/creatures/unholy/demon-fire-horned-clawed.webp",
  "icons/creatures/unholy/demon-horned-winged-laughing.webp",
  "icons/creatures/tentacles/tentacles-eyes-poisoned-green.webp",
  "icons/creatures/eyes/void-single-black-purple.webp"
];

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/** "a" / "an" for the appearance bullet — Physique words can start with a vowel (Albino, Eyeless). */
function article(word) {
  return /^[aeiou]/i.test(String(word).trim()) ? "An" : "A";
}

/** One ladder rung, chosen by a weight array index-aligned to {@link LADDER}. Never a dice roll. */
function weightedLadder(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return LADDER[i];
  }
  return LADDER[LADDER.length - 1];
}


/* -------------------------------------------- */
/*  Tier picker                                 */
/* -------------------------------------------- */

/**
 * Show the four-choice tier `DialogV2`. Dismissing (✕) resolves to `null` — a monster only ever
 * arrives from an explicit button press.
 * @returns {Promise<"standard" | "hardier" | "serious" | "random" | null>}
 */
async function pickTier() {
  const tier = await DialogV2.wait({
    classes: [SYSTEM_ID, "cairn-tier-picker"],
    window: { title: game.i18n.localize("CAIRN.MonsterGen.PickTier") },
    content: `<p>${game.i18n.localize("CAIRN.MonsterGen.PickTierHint")}</p>`,
    buttons: [
      { action: "standard", label: game.i18n.localize("CAIRN.MonsterGen.Standard") },
      { action: "hardier", label: game.i18n.localize("CAIRN.MonsterGen.Hardier") },
      { action: "serious", label: game.i18n.localize("CAIRN.MonsterGen.Serious") },
      { action: "random", label: game.i18n.localize("CAIRN.MonsterGen.Random"), default: true }
    ],
    rejectClose: false
  });
  return tier ?? null;
}

/* -------------------------------------------- */
/*  Assembly                                    */
/* -------------------------------------------- */

/** The one equipped `*` attack Item — a bite is not an inventory item, so `slots: 0` (which reads
 *  as *petty*) keeps it off any ledger. */
function makeAttackItem(verb, die) {
  return {
    // Verbatim table verb + `*`. Not singularised — that breaks on translation; the `*` marks
    // "special effect is in the description", which is always true for a rolled monster.
    name: `${verb}*`,
    type: "gear",
    img: "icons/svg/sword.svg",
    system: {
      description: `<p>${verb} (${die})</p>`,
      slots: 0,
      equipped: true,
      damage: die,
      blast: false
    },
    flags: { [SYSTEM_ID]: { generated: true } }
  };
}

/**
 * An equipped armour Item, so `armorTotal` derives via `NpcData.prepareDerivedData` (the actor's
 * own `armor` stays 0). `slots: 0` — natural armour is a hide, not carried gear, so it occupies no
 * slot, exactly like the attack Item; `sumEquippedArmor` keys off `armor`/`equipped`, not the cost.
 */
/**
 * @param {string} feature     the rolled Monster Feature, as text
 * @param {boolean} isArmour   whether that feature's result is marked `flags.cairn2e.armour` —
 *                             Carapace, Scales and Shell ARE natural armour, and the Item is named
 *                             for them. A marker, not the word, because a translation renames it.
 * @param {number} value
 */
function makeArmourItem(feature, isArmour, value) {
  const name = isArmour ? feature : "Tough Hide";
  return {
    name,
    type: "gear",
    img: "icons/svg/shield.svg",
    system: {
      description: `<p>${name} (${value} Armor)</p>`,
      slots: 0,
      equipped: true,
      armor: value
    },
    flags: { [SYSTEM_ID]: { generated: true } }
  };
}

/**
 * Roll one complete monster. Returns `Actor.create` fragments — the caller (or the re-roll) decides
 * what to keep.
 * @param {"standard" | "hardier" | "serious" | "random"} tierChoice
 * @returns {Promise<{ name: string, img: string, system: object, items: object[] }>}
 */
async function buildMonsterData(tierChoice) {
  const tier = tierChoice === "random" ? pick(RANDOM_TIER_BAG) : tierChoice;
  const spec = TIERS[tier];

  const physique = await rollWardenText(TABLES.MONSTER_PHYSIQUE);
  const featureRoll = await rollWardenTable(TABLES.MONSTER_FEATURE);
  const feature = stripTags(featureRoll?.text);
  const featureIsArmour = !!featureRoll?.results?.[0]?.flags?.[SYSTEM_ID]?.armour;
  const quirk = await rollWardenText(TABLES.MONSTER_QUIRK);
  const weakness = await rollWardenText(TABLES.MONSTER_WEAKNESS);
  const attackVerb = await rollWardenText(TABLES.MONSTER_ATTACK);
  const criticalDamage = await rollWardenText(TABLES.MONSTER_CRITICAL_DAMAGE);
  const ability = await rollWardenText(TABLES.MONSTER_ABILITY);
  const target = await rollWardenText(TABLES.MONSTER_ABILITY_TARGET);

  const STR = weightedLadder(ABILITY_WEIGHTS.STR[tier]);
  const DEX = weightedLadder(ABILITY_WEIGHTS.DEX);
  const WIL = weightedLadder(ABILITY_WEIGHTS.WIL);

  const items = [makeAttackItem(attackVerb, spec.die)];
  if (Math.random() < spec.armorChance) {
    items.push(makeArmourItem(feature, featureIsArmour, pick(spec.armorValues)));
  }

  const name = `${physique} ${feature} Creature`.replace(/\s+/g, " ").trim();

  // The SRD's five bullets ("Monster Stat Block Format"), one `feature` Item each, in the order
  // the statblock prints them. A plain bullet is the Item's name with an empty description; the
  // Critical Damage one is the clause as its name with the `critical` flag set, and the sheet
  // draws the words — the same rule the bestiary packs follow, so a generated monster and a
  // written one look alike on the Features tab. Flagged `generated` like the attack and armour
  // so a re-roll replaces exactly these.
  const features = [
    `${article(physique)} ${physique} ${feature} creature`,
    quirk,
    `Weak to ${weakness}`,
    `${ability} ${target}`
  ].map((text) => ({ name: text, type: "feature", system: { description: "" } }));
  features.push({
    name: criticalDamage, type: "feature",
    system: { description: "", critical: true }
  });
  for (const f of features) f.flags = { [SYSTEM_ID]: { generated: true } };

  const system = {
    role: "monster",
    abilities: {
      STR: { value: STR, max: STR },
      DEX: { value: DEX, max: DEX },
      WIL: { value: WIL, max: WIL }
    },
    hp: { value: spec.hp, max: spec.hp },
    // Natural armour is modelled as the equipped Item above, so the actor's own `armor` stays 0 and
    // `armorTotal` sums from the Item — exactly the bestiary's own split.
    armor: 0,
    morale: null,
    slots: { max: 0 },
    description: ""
  };

  return { name, img: pick(MONSTER_PORTRAITS), system, items: [...items, ...features] };
}

async function createMonsterActor({ name, img, system, items }) {
  const actor = await CairnActor.create({
    name,
    type: "npc",
    img,
    system,
    items,
    prototypeToken: {
      texture: { src: img },
      disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
      actorLink: false
    }
  });
  if (actor) actor.sheet.render(true);
  return actor;
}

/* -------------------------------------------- */
/*  Public entry points                         */
/* -------------------------------------------- */

/**
 * Roll a complete monster. With no `tier`, the four-choice picker is shown first; dismissing it
 * creates nothing.
 * @param {"standard" | "hardier" | "serious" | "random"} [tier]
 * @returns {Promise<CairnActor|null>}
 */
export async function generateMonster(tier) {
  const chosen = tier ?? (await pickTier());
  if (!chosen) return null;
  return createMonsterActor(await buildMonsterData(chosen));
}

/**
 * Re-roll an existing monster in place. The tier picker *is* the confirmation (no second "are you
 * sure"). Replaces stats / attack / armour / features; **keeps** name, portrait and token.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor>}
 */
export async function regenerateMonster(actor) {
  const tier = await pickTier();
  if (!tier) return actor;

  const { system, items } = await buildMonsterData(tier);

  const staleIds = actor.items.filter((i) => i.getFlag(SYSTEM_ID, "generated")).map((i) => i.id);
  if (staleIds.length) await actor.deleteEmbeddedDocuments("Item", staleIds);

  await actor.update({ system });
  if (items.length) await actor.createEmbeddedDocuments("Item", items);
  return actor;
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { FLAGS, SYSTEM_ID, packUuid } from "./constants.js";
import {
  BERRIES, BONE, CLOTH, EGGS, FEATHER, FISH, FLAX, FOWL, GARGOYLE, HERBS, HIDE, HONEY, IRON, LOG, MEAT,
  MUSHROOMS, NAILS, NUTS, ORE, PHOENIX, PIXIE, REEDS, RESIN, SALT, SAND, SINEW, STICK, STONE, TALLOW,
  THREAD, TROLL, VENOM, WAX
} from "./crafting.js";
import { SEASON_DAYS, darknessAt, watchGeometry } from "./calendar-rules.js";
import { rollHarvestSave } from "./rolls.js";

/**
 * Canvas Harvest: an optional module that turns places on the map into things to mine, chop, gather
 * or carve. What a strike gives lands beside the token as a Canvas Loot item. The resources below
 * give the raw side of Grid Crafter's recipes (`crafting.js`): a vein gives ore, a tree logs, a
 * carcass meat and hide. Coins never drop: Canvas Loot sets a coin's `system.value` to 1.
 */
const MODULE = "canvas-harvest";
const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/harvest-card.hbs`;

const material = (id) => packUuid("materials", "Item", id);
const gear = (id) => packUuid("gear", "Item", id);
const moreGear = (id) => packUuid("more-gear", "Item", id);
const weapon = (id) => packUuid("weapons", "Item", id);
const bgGear = (id) => packUuid("background-gear", "Item", id);

const RUBBLE = material("eFwaKO3ML7B4jJ9n");           // Rubble
const MANTICORE = material("2FgWKVJ3Kuf4yAcJ");        // Manticore Spike
const KILLER_HONEY = moreGear("XgoKSVexKCJyveRP");     // Killer Bee Honey
const GOLD = moreGear("F5ZogXdhwxwOIKpn");             // Gold Nugget
const HEMATITE = moreGear("s3vOj4pUgfsufic4");         // Hematite
const JASPER = moreGear("b9EKIv03eSrTRHSW");           // Jasper
const TURQUOISE = moreGear("qDml4cyFVVqj5taF");        // Turquoise
const AMETHYST = moreGear("Evjq9aHo9jGPhET8");         // Amethyst
const RUBY = moreGear("2MqTbhayTL7tcsK5");             // Ruby

/**
 * The items each Tool Set counts, keyed by Canvas Harvest's set ids. A resource switches a set on
 * and any of its items opens it, so "a blade" is nine knives and not the four a resource could list.
 * The Gather set stays empty: herbs, berries and nests are worked with bare hands.
 */
export const TOOL_SETS = {
  strike: [
    moreGear("t2HEKyfmgxgBA4ho"),  // Pick
    moreGear("KpQA9uUHYKruyfZo"),  // Crowbar
    gear("0zOZuLW1Yw2gr9wT"),      // Chisel
    bgGear("UCGz949Ymr5OqJGz")     // Smelting Hammer
  ],
  chop: [
    weapon("1aObADSCj3jIkUPw"),    // Axe
    bgGear("EcAwRAxLdrvir9eM"),    // Hand Axe
    bgGear("GwK6hO7CYbR10jHy")     // Saw
  ],
  carve: [
    weapon("a7ny2xCcpEwZTDuM"),    // Dagger
    bgGear("BGYt5BrAy8cCxZ5d"),    // Knife
    bgGear("7hlnv0EMhKk0KRDa"),    // Bone Knife
    bgGear("x89IPsPuvTrESmM5"),    // Serrated Knife
    bgGear("DEZjfBsajrtrRMD3"),    // Paring Knife
    bgGear("gJdBtG0fnS8XIAJA"),    // Root Knife
    bgGear("xdDnbv6De7W1mrwi"),    // Silver Knife
    bgGear("1xLPGZIJcr5EUPbB"),    // Needle-knife
    bgGear("RD22fSaMtxvVpaJ5")     // Bonesaw
  ]
};

/** A rod or a net for a fishing spot, a trap for a game trail: the resource's own tools, since the
 *  Gather set would open a fishing spot with a trap. */
const FISHING = [gear("LpppO7mC1EgIRTXv"), gear("5SZWEE7UyIgdgwSE")];  // Fishing Rod, Net
const TRAPS = [
  gear("y9WcPO45F4qWK4Rv"),        // Trap
  bgGear("L3HtfuzAcSRGwQes"),      // Snare Trap
  moreGear("jzRqy9sifk4ozpkn"),    // Large Trap
  bgGear("Do2tcqARCv1s7aE6")       // Spring-Loaded Trap
];

/**
 * What a resource means to this system, as Canvas Harvest tags: they follow a resource the Warden
 * duplicates in the Resource Book, where its id does not.
 */
export const TAGS = {
  /** Refused unless the clock says full daylight: a Gargoyle is frozen only while the sun is on it. */
  DAYLIGHT: `${SYSTEM_ID}.daylight-only`,
  /** A DEX save asked of whoever struck; a failure is a line on the card, and the Warden rules the rest. */
  VENOMOUS: `${SYSTEM_ID}.venomous`,
  /** The Warden is told the hive woke. What the bees do is theirs to decide. */
  HIVE: `${SYSTEM_ID}.hive`,
  /** The Warden is reminded of the noise on a spot's first strike, the once. */
  NOISY: `${SYSTEM_ID}.noisy`,
  /** A dry spot fills again a day, a week (six days in Vald) or a season after it ran dry. */
  REGROW_DAY: `${SYSTEM_ID}.regrow.day`,
  REGROW_WEEK: `${SYSTEM_ID}.regrow.week`,
  REGROW_SEASON: `${SYSTEM_ID}.regrow.season`
};
const REGROW_DAYS = new Map([[TAGS.REGROW_DAY, 1], [TAGS.REGROW_WEEK, 6], [TAGS.REGROW_SEASON, SEASON_DAYS]]);

const drop = (uuid, weight, min = 1, max = min) => ({ uuid, weight, min, max });

/**
 * The resources this system registers. A drop's `max` is at most 3 for a petty item and 2 for one
 * that takes a slot: nothing stacks here, and Canvas Harvest lands each unit on its own free space.
 * `name` and `verb` are added from en.json at registration (`CAIRN.Harvest.Resource.<Id>`).
 */
export const RESOURCES = [
  // Places.
  { id: "iron-vein", img: "icons/environment/wilderness/mine-exterior-entrance.webp", animation: "strike",
    toolSets: ["strike"], strikes: 8, tags: [TAGS.NOISY],
    drops: [drop(ORE, 6, 1, 2), drop(STONE, 3), drop(HEMATITE, 1)] },
  // Mostly waste rock; one strike in ten turns up something worth keeping.
  { id: "gem-vein", img: "icons/commodities/stone/geode-raw-purple.webp", animation: "strike",
    toolSets: ["strike"], strikes: 3, tags: [TAGS.NOISY],
    drops: [drop(RUBBLE, 90), drop(TURQUOISE, 5), drop(GOLD, 3), drop(AMETHYST, 1), drop(RUBY, 1)] },
  { id: "rock-face", img: "icons/environment/wilderness/terrain-rocks-brown.webp", animation: "strike",
    toolSets: ["strike"], strikes: 10, tags: [TAGS.NOISY],
    drops: [drop(STONE, 6, 1, 2), drop(JASPER, 1)] },
  { id: "sand-bank", img: "icons/environment/wilderness/terrain-river-road-gray.webp", animation: "gather",
    strikes: 6, tags: [TAGS.REGROW_SEASON],
    drops: [drop(SAND, 5, 1, 2), drop(STONE, 1)] },
  { id: "salt-crust", img: "icons/commodities/materials/powder-grey.webp", animation: "strike",
    toolSets: ["strike"], strikes: 6, tags: [TAGS.REGROW_SEASON],
    drops: [drop(SALT, 1, 1, 3)] },
  { id: "tree", img: "icons/environment/wilderness/tree-oak.webp", animation: "chop",
    toolSets: ["chop"], strikes: 6, tags: [TAGS.NOISY],
    drops: [drop(LOG, 4), drop(STICK, 3, 1, 3), drop(RESIN, 1, 1, 2)] },
  { id: "deadfall", img: "icons/commodities/wood/kindling-sticks-yellow.webp", animation: "gather",
    strikes: 4, drops: [drop(STICK, 1, 1, 3)] },
  { id: "herb-patch", img: "icons/consumables/plants/herb-marjoram-basil-oregano-leaf-bunch-green.webp", animation: "gather",
    strikes: 4, tags: [TAGS.REGROW_WEEK],
    drops: [drop(HERBS, 4, 1, 3), drop(BERRIES, 2, 1, 2), drop(MUSHROOMS, 1)] },
  { id: "mushroom-ring", img: "icons/consumables/mushrooms/cluster-red-brown.webp", animation: "gather",
    strikes: 4, tags: [TAGS.REGROW_WEEK],
    drops: [drop(MUSHROOMS, 1, 1, 3)] },
  { id: "bramble", img: "icons/consumables/fruit/berry-bunch-red-green.webp", animation: "gather",
    strikes: 4, tags: [TAGS.REGROW_SEASON],
    drops: [drop(BERRIES, 4, 1, 3), drop(NUTS, 1)] },
  { id: "wild-flax", img: "icons/consumables/plants/flax-leaves-spiked-bundle-orange.webp", animation: "gather",
    strikes: 4, tags: [TAGS.REGROW_SEASON],
    drops: [drop(FLAX, 1, 1, 3)] },
  { id: "reed-bed", img: "icons/consumables/plants/dried-bundle-tied-stems-sticks-brown.webp", animation: "gather",
    strikes: 5, tags: [TAGS.REGROW_WEEK],
    drops: [drop(REEDS, 1, 1, 3)] },
  { id: "wild-hive", img: "icons/consumables/food/honey-beehive-brown.webp", animation: "gather",
    strikes: 3, tags: [TAGS.REGROW_SEASON],
    drops: [drop(HONEY, 2), drop(WAX, 3, 1, 2)] },
  { id: "bird-nest", img: "icons/consumables/eggs/egg-nest-pink.webp", animation: "gather",
    strikes: 2, tags: [TAGS.REGROW_WEEK],
    drops: [drop(EGGS, 3), drop(FEATHER, 2, 1, 3)] },
  { id: "fishing-spot", img: "icons/skills/trades/fishing-rod-gray.webp", animation: "gather",
    tools: FISHING, strikes: 4, tags: [TAGS.REGROW_DAY],
    drops: [drop(FISH, 1)] },
  { id: "game-trail", img: "icons/environment/traps/cage-simple-wood.webp", animation: "gather",
    tools: TRAPS, strikes: 3, tags: [TAGS.REGROW_DAY],
    drops: [drop(MEAT, 3), drop(FOWL, 2), drop(HIDE, 1)] },
  { id: "old-battlefield", img: "icons/equipment/head/helm-norman-brown.webp", animation: "gather",
    strikes: 5, drops: [drop(BONE, 3), drop(CLOTH, 2), drop(NAILS, 2, 1, 3), drop(IRON, 1)] },

  // Carcasses, dragged onto the dead creature's token.
  { id: "small-game", img: "icons/commodities/leather/fur-brown.webp", animation: "carve",
    toolSets: ["carve"], strikes: 2, drops: [drop(MEAT, 3), drop(HIDE, 1), drop(BONE, 1)] },
  { id: "large-game", img: "icons/creatures/mammals/deer-antlers-green.webp", animation: "carve",
    toolSets: ["carve"], strikes: 5,
    drops: [drop(MEAT, 4, 1, 2), drop(HIDE, 2), drop(BONE, 2), drop(SINEW, 2, 1, 2)] },
  { id: "fowl", img: "icons/commodities/biological/wing-bird-white.webp", animation: "carve",
    strikes: 2, drops: [drop(FOWL, 2), drop(FEATHER, 3, 1, 3)] },
  { id: "bear", img: "icons/commodities/claws/claw-bear-brown.webp", animation: "carve",
    toolSets: ["carve"], strikes: 6,
    drops: [drop(MEAT, 4, 1, 2), drop(HIDE, 3), drop(BONE, 2), drop(SINEW, 1, 1, 2), drop(TALLOW, 2, 1, 2)] },
  { id: "predator", img: "icons/creatures/abilities/wolf-howl-moon-white.webp", animation: "carve",
    toolSets: ["carve"], strikes: 4,
    drops: [drop(HIDE, 3), drop(BONE, 2), drop(SINEW, 2, 1, 2), drop(MEAT, 1)] },
  { id: "winged-beast", img: "icons/commodities/biological/wing-lizard-brown.webp", animation: "carve",
    toolSets: ["carve"], strikes: 5,
    drops: [drop(FEATHER, 4, 1, 3), drop(MEAT, 2), drop(BONE, 2), drop(HIDE, 1)] },
  { id: "fish-catch", img: "icons/environment/creatures/fish-crosshatched-silver-blue.webp", animation: "carve",
    toolSets: ["carve"], strikes: 3, drops: [drop(FISH, 1, 1, 2)] },
  // "If a skeleton is killed and its bones are not scattered, it reforms" (bestiary.md): taking
  // them is scattering them.
  { id: "skeleton-remains", img: "icons/commodities/bones/bones-stack-tan.webp", animation: "carve",
    strikes: 3, drops: [drop(BONE, 1, 1, 2)] },
  { id: "spider-nest", img: "icons/creatures/invertebrates/spider-web-black.webp", animation: "carve",
    toolSets: ["carve"], strikes: 3, drops: [drop(THREAD, 3, 1, 3), drop(CLOTH, 1)] },

  // Monster parts, each where the bestiary puts it.
  { id: "troll-carcass", img: "icons/consumables/meat/steak-glowing-fatty-white.webp", animation: "carve",
    toolSets: ["carve"], strikes: 2, drops: [drop(TROLL, 2), drop(MEAT, 1)] },
  // "Fear the day, when the sun's light freezes them in place."
  { id: "frozen-gargoyle", img: "icons/environment/wilderness/statue-hound-horned.webp", animation: "strike",
    toolSets: ["strike"], strikes: 3, tags: [TAGS.DAYLIGHT],
    drops: [drop(GARGOYLE, 2), drop(STONE, 3)] },
  { id: "pixie-bed", img: "icons/creatures/magical/fae-fairy-winged-glowing-green.webp", animation: "gather",
    strikes: 1, drops: [drop(PIXIE, 1)] },
  { id: "killer-bee-hive", img: "icons/creatures/invertebrates/wasp-swarm-movement.webp", animation: "gather",
    strikes: 3, tags: [TAGS.HIVE, TAGS.REGROW_SEASON],
    drops: [drop(KILLER_HONEY, 1), drop(WAX, 3, 1, 2)] },
  { id: "manticore-carcass", img: "icons/commodities/biological/tail-spiked-green.webp", animation: "carve",
    toolSets: ["carve"], strikes: 3, drops: [drop(MANTICORE, 1)] },
  { id: "viper-carcass", img: "icons/creatures/reptiles/snake-poised-white.webp", animation: "carve",
    toolSets: ["carve"], strikes: 2, tags: [TAGS.VENOMOUS],
    drops: [drop(VENOM, 2), drop(HIDE, 1)] },
  { id: "phoenix-ashes", img: "icons/magic/fire/projectile-feathers-embers-gold.webp", animation: "gather",
    strikes: 1, drops: [drop(PHOENIX, 1)] }
];

/** `iron-vein` → `IronVein`, the resource's key under `CAIRN.Harvest.Resource`. */
const keyOf = (id) => id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");

/** Set when Canvas Harvest is ready: nothing below runs in a world without it. */
let api = null;

/** The calendar's day, read as `calendar.js#geometry` reads it. */
const geometry = () => watchGeometry(game.time.calendar.days);

/** How many days a resource takes to grow back, or 0 when it never does. */
function regrowDays(resource) {
  const tag = resource?.tags?.find((t) => REGROW_DAYS.has(t));
  return tag ? REGROW_DAYS.get(tag) : 0;
}

/** A Gargoyle is worked only in full daylight, by the same clock that darkens the scene. */
function refuseAtNight(_token, resource, _spot, veto) {
  if (!resource.tags?.includes(TAGS.DAYLIGHT)) return;
  if (darknessAt(game.time.worldTime, geometry()) === 0) return;
  // The reason is shown as HTML, so the name a Warden may have typed is escaped.
  veto.reason = game.i18n.localize("CAIRN.Harvest.Night", { resource: foundry.utils.escapeHTML(resource.name) });
  return false;
}

/** Post a harvest card for `token`, its caption the resource struck. */
async function postCard(token, resource, data, { wardenOnly = false } = {}) {
  const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, data);
  return ChatMessage.implementation.create(
    { speaker: ChatMessage.getSpeaker({ token }), flavor: foundry.utils.escapeHTML(resource.name), content },
    wardenOnly ? { messageMode: "gm" } : {}
  );
}

/**
 * What a strike sets off, on the active GM, after its items reached the map. Each tag is answered
 * on its own: a resource the Warden tags with two gets both.
 */
async function answerStrike(token, { resource, spot }) {
  const tags = resource.tags ?? [];
  const name = token.name;
  const what = resource.name;
  if (tags.includes(TAGS.VENOMOUS)) {
    await postCard(token, resource, {
      lead: game.i18n.localize("CAIRN.Harvest.Venom.Lead", { name, resource: what }),
      save: "DEX",
      saveLabel: game.i18n.localize("CAIRN.Save", { key: game.i18n.localize("DEX") })
    });
  }
  if (tags.includes(TAGS.HIVE)) {
    await postCard(token, resource, {
      lead: game.i18n.localize("CAIRN.Harvest.Hive.Lead", { name, resource: what }),
      hint: game.i18n.localize("CAIRN.Harvest.Hive.Hint")
    }, { wardenOnly: true });
  }
  if (tags.includes(TAGS.NOISY) && !spot.getFlag(SYSTEM_ID, FLAGS.HARVEST_HEARD)) {
    await spot.setFlag(SYSTEM_ID, FLAGS.HARVEST_HEARD, true);
    await postCard(token, resource, {
      lead: game.i18n.localize("CAIRN.Harvest.Noise.Lead", { name, resource: what }),
      hint: game.i18n.localize("CAIRN.Harvest.Noise.Hint")
    }, { wardenOnly: true });
  }
}

/**
 * The save button on a harvest card. The token comes from the scene the message names, as Critical
 * Damage's does: its owner may be looking at another scene. Once a save answers the card the
 * button is gone for everyone.
 */
function wireSaveButton(message, html) {
  const button = html.querySelector(".roll-harvest-save");
  if (!button) return;
  const token = game.scenes.get(message.speaker?.scene)?.tokens.get(message.speaker?.token);
  const answered = game.messages.some((m) => m.getFlag(SYSTEM_ID, FLAGS.HARVEST_SAVE_FOR) === message.id);
  const canRoll = !answered && token?.actor && (token.actor.testUserPermission(game.user, "OWNER") || game.user.isGM);
  if (!canRoll) {
    button.hidden = true;
    return;
  }
  button.addEventListener("click", async () => {
    button.setAttribute("disabled", "disabled");
    const failText = game.i18n.localize("CAIRN.Harvest.Venom.Fail", { name: token.name });
    await rollHarvestSave(token.actor, button.dataset.key, { token, cardId: message.id, failText });
  });
}

/** A spot that grows back remembers when it ran dry. */
function markDry(spot) {
  if (!game.user.isActiveGM || !regrowDays(api.getResource(spot.system.resource))) return;
  return spot.setFlag(SYSTEM_ID, FLAGS.HARVEST_DRY_AT, game.time.worldTime);
}

/**
 * Refilled by anyone, for any reason: nothing is left to wait for. Back to full, it is a fresh spot,
 * and its first strike makes noise again.
 */
async function clearMarks(spot, { left }) {
  if (!game.user.isActiveGM) return;
  const full = left >= (api.getResource(spot.system.resource)?.strikes ?? Infinity);
  if ((left > 0) && (spot.getFlag(SYSTEM_ID, FLAGS.HARVEST_DRY_AT) !== undefined)) await spot.unsetFlag(SYSTEM_ID, FLAGS.HARVEST_DRY_AT);
  if (full && spot.getFlag(SYSTEM_ID, FLAGS.HARVEST_HEARD)) await spot.unsetFlag(SYSTEM_ID, FLAGS.HARVEST_HEARD);
}

/** Refill every dry spot, on every scene, whose resource has grown back by the world's clock. */
async function regrow() {
  if (!api || !game.user.isActiveGM) return;
  const day = geometry().day;
  for (const scene of game.scenes) {
    for (const { behaviorUuid, resourceId } of api.getSpots(scene)) {
      const spot = foundry.utils.fromUuidSync(behaviorUuid);
      const dryAt = spot?.getFlag(SYSTEM_ID, FLAGS.HARVEST_DRY_AT);
      const days = regrowDays(api.getResource(resourceId));
      if ((dryAt === undefined) || !days) continue;
      if (game.time.worldTime - dryAt >= days * day) await api.refill(spot);
    }
  }
}

/**
 * Register when Canvas Harvest is ready; the hook never fires without the module, so nothing here
 * runs in a world that does not use it. Every client registers, because Canvas Harvest keeps
 * resources and Tool Sets in memory, and the GM checks each strike against its own copy. Names and
 * verbs are localized here, where `game.i18n` is ready. The save button is wired from `init`,
 * since the log renders before the module is ready.
 */
export function registerHarvest() {
  Hooks.on("renderChatMessageHTML", wireSaveButton);
  // A save that answers a card redraws that card on every client, so its button is gone everywhere.
  Hooks.on("createChatMessage", (message) => {
    const card = game.messages.get(message.getFlag(SYSTEM_ID, FLAGS.HARVEST_SAVE_FOR));
    if (card) ui.chat.updateMessage(card);
  });
  Hooks.once(`${MODULE}.ready`, (harvest) => {
    api = harvest;
    for (const [set, uuids] of Object.entries(TOOL_SETS)) api.addTools(SYSTEM_ID, set, uuids);
    api.registerResources(SYSTEM_ID, RESOURCES.map((r) => ({
      ...r,
      name: game.i18n.localize(`CAIRN.Harvest.Resource.${keyOf(r.id)}.Name`),
      verb: game.i18n.localize(`CAIRN.Harvest.Resource.${keyOf(r.id)}.Verb`)
    })));
    Hooks.on(`${MODULE}.preHarvest`, refuseAtNight);
    Hooks.on(`${MODULE}.harvest`, answerStrike);
    Hooks.on(`${MODULE}.spotDepleted`, markDry);
    Hooks.on(`${MODULE}.spotRefilled`, clearMarks);
    Hooks.on("updateWorldTime", regrow);
    // Time may have moved while no GM was connected.
    regrow();
  });
}

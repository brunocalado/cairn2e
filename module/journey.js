/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The Wilderness Exploration procedure, run as one shared journey —
 * `srd-2e/players-guide/procedures.md` → "Wilderness Exploration" and
 * `srd-2e/wardens-guide/wilderness-exploration.md`.
 *
 * ## One party, one action
 *
 * "If the characters split up, each group is treated as an independent entity" — so a journey is
 * one group, and a watch is one action that group takes together. The group decides at the table
 * and the Warden presses the action it decided on: `journey.action` is one of the four Wilderness
 * Actions, and every member takes it. There is no ballot — a vote per character only ever
 * restated a conversation that had already happened, and it left the window waiting on players
 * who had all said the same thing aloud a minute earlier. A character who is not on this watch's
 * journey is taken off the roster, and nothing the journey does reaches their sheet.
 *
 * ## The state
 *
 * One JSON object in a hidden world setting (`SETTINGS.JOURNEY`), `null` when nothing is
 * underway. Core broadcasts a world setting to every client and runs its `onChange` on each
 * (`module/settings.js`), which is what keeps every open tracker window in step. Only the Warden
 * can write it, so every mutation runs on the Warden's client: a player's click comes in through
 * {@link JOURNEY_QUERY}, the same door `module/apps/scars.js` uses to hand a window to a player.
 * `apply()` is the one function every mutation goes through — from a button here, from a query
 * there, from a macro — so the Warden gate lives in one place.
 *
 * ## The cycle, as this file runs it
 *
 *  1. Every new day rolls its own weather (season column, Extreme twice → Catastrophic) without
 *     being asked — the procedure has no day that skips it. The Warden can set it by hand when
 *     the story has already decided what the sky is doing, or press Auto to roll it again. The
 *     window states the table's effect; the Warden applies it — a Fatigue to the party or a watch
 *     to the journey — with the buttons, because the table says "or".
 *  2. The Warden sets the party's action. Travel needs the party's lost roll (one d6, one roll,
 *     "the party rolls"); Supply needs the bounty roll, whose die grows with the party. Those
 *     buttons appear once the action is set, and changing the action throws away a roll made for
 *     the old one, so what is applied is what was rolled for.
 *  3. "Resolve the watch": Make Camp consumes a Ration use per participant and lifts Deprived and
 *     clears every Fatigue on one who ate (one who could not is Deprived); Supply creates the rolled Rations
 *     among them; Travel moves the party a watch closer, or, when lost, finds the way again
 *     instead. Then the `Wilderness Event` table is rolled — twice through a night the party
 *     travels — and the clock advances. A night nobody camped through adds a Fatigue and
 *     Deprived to everyone and raises the terrain's Difficulty a step for the next day.
 *
 * The event is the Warden's to narrate, so its card is whispered to the Wardens rather than
 * posted in the open, and an Encounter draw goes the same way.
 *
 * What is NOT automated is what the SRD leaves to the Warden: mounts, guides and maps, the
 * weather's own Fatigue-or-watch choice, and the encounter that an Encounter event draws.
 */

import { SYSTEM_ID, SETTINGS, GEAR, TABLES, CONDITION } from "./constants.js";
import { rollWardenTable, copyOf } from "./helpers.js";
import {
  ACTIONS, WATCHES, WEATHER, WEATHER_EFFECTS, PATHS, DISTANCES, TERRAINS, VAST_MAX,
  watchesNeeded, isLost, supplyDie, weatherFor, raiseTerrain, nextWatch, pendingNeeds, eventsForWatch
} from "./journey-rules.js";
import {
  rollJourneyDie, postRollCard, postJourneyCard, drawWildernessEncounter, rollReaction
} from "./rolls.js";
import { parseEncounterResults } from "./encounters.js";

/** The query a player's client sends the Warden's; registered in `module/cairn2e.js`. */
export const JOURNEY_QUERY = `${SYSTEM_ID}.journey`;

/**
 * The `Wilderness Event` markers dispatch reads, from `flags.cairn2e.event` on each result: an
 * encounter chains into a `Wilderness Encounter` draw, and exhaustion reminds the Warden to weigh
 * Fatigue against the party. Never the row's name — that is only what the window prints, and a
 * translation module renames it.
 */
const EVENT = { ENCOUNTER: "encounter", EXHAUSTION: "exhaustion" };
/** Supply creates the `gear` pack's Rations ({@link GEAR}.RATIONS); what Make Camp eats is any
 *  gear marked `ration`. Food the procedure spends is marked on the item, not read off its name:
 *  a Warden's renamed or homebrew food is still food. */
const isRation = (i) => i.type === "gear" && i.system.ration;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/** The journey underway, or `null`. Read on any client. A copy: a mutation works on its own
 *  object and the setting changes only when it is saved. */
export function current() {
  const journey = game.settings.get(SYSTEM_ID, SETTINGS.JOURNEY);
  return journey ? foundry.utils.deepClone(journey) : null;
}

/** How many Rations the character is carrying — uses, not items: a Ration is spent a use at a
 *  time (`consumeRation`), so three items with one use left are three Rations, not three stacks. */
export function rationsCarried(actor) {
  return actor.items.reduce((n, i) => n + (isRation(i) ? i.system.uses.value : 0), 0);
}

/**
 * Who is walking: the crew the journey carries, resolved.
 *
 * A stored list and not a rule for deriving one, because the SRD's word is "party member" and it
 * is explicitly wider than the player characters — "Each party member **(and their mounts)**
 * consumes a Ration", "One or more party members may hunt, fish, or forage… with each additional
 * participant", and a hired *Local Guide* is what changes the lost roll
 * (`srd-2e/players-guide/procedures.md`). No derivation from ownership or from users can hold a
 * mount or a hireling, so the Warden puts them on the list instead and the list is the answer.
 *
 * A uuid that no longer resolves is dropped rather than rendered as a hole, the same way the
 * party model's `roster` handles a deleted member (`data/actor-party.js`). So is anything that
 * is not a world Actor: `fromUuidSync` answers a compendium uuid with an index entry once the
 * pack's cache has flushed, and an index entry has no items to count — the tracker threw on it
 * after a reload. The crew drop refuses a compendium Actor; this is the net under a macro.
 * @param {object} journey
 * @returns {Actor[]}
 */
export function members(journey) {
  return (journey.crew ?? []).map((uuid) => fromUuidSync(uuid)).filter((actor) => actor instanceof Actor);
}

/** The terrain Difficulty the party travels under today: the route's, raised by weather and sleep. */
export function effectiveTerrain(journey) {
  let steps = journey.sleepDeprived ? 1 : 0;
  if (journey.weather && WEATHER_EFFECTS[journey.weather].step) steps += 1;
  return raiseTerrain(journey.route.terrain, steps);
}

/* -------------------------------------------- */
/*  Writing — Warden's client only              */
/* -------------------------------------------- */

/**
 * Apply one mutation. Runs on the Warden's client, whether the click was theirs or a player's
 * (through the query). A player's click is checked against what that player may do: the party's
 * two rolls, which the SRD hands the table rather than the Warden — never anything else.
 * @param {string} type
 * @param {object} data
 * @param {User} [user]  The user who asked; the Warden when omitted.
 * @returns {Promise<boolean>}
 */
export async function apply(type, data = {}, user = game.user) {
  if (!game.user.isGM) return false;
  const wardenOnly = !user.isGM && !PLAYER_MUTATIONS.has(type);
  if (wardenOnly) return false;
  const handler = MUTATIONS[type];
  if (!handler) return false;
  const journey = current();
  if (type !== "start" && !journey) return false;
  await handler(journey, data);
  return true;
}

/** The mutations a player may ask for. Everything else is the Warden's. */
const PLAYER_MUTATIONS = new Set(["rollLost", "rollSupply", "resupply"]);

const MUTATIONS = {
  start,
  setAction,
  addCrew,
  removeCrew,
  setWeather,
  rollLost,
  rollSupply,
  resupply,
  resolveWatch,
  rerollEvent,
  markEncounterPlaced,
  adjust,
  addFatigueToParty,
  end
};

async function save(journey) {
  await game.settings.set(SYSTEM_ID, SETTINGS.JOURNEY, journey);
}

/**
 * The party has arrived. The ONE place the transition is handled, and that is the point of it:
 * the watch that lands them and the Warden's counter both come through here, so arriving is
 * announced exactly once however it happened. It was not — the counter finished the journey in
 * complete silence, and a watch spent at the destination announced arrival again every time.
 *
 * Where they arrived is the map's to say, and the table's. This posts that they did.
 *
 * `flavor` is the heading the card wears: the watch's own when a watch landed them, the journey's
 * when the counter did, so the card belongs to whatever caused it.
 * @param {object} journey
 * @param {string} flavor
 */
async function arrive(journey, flavor) {
  journey.arrived = true;
  await postJourneyCard({ flavor, lead: game.i18n.localize("CAIRN.Journey.Arrived") });
}

/**
 * The three penalty tables and the vast-terrain run as segmented-control options, with
 * `selected` following the route given — the journey window's blank form, a form pre-filled from
 * a `route` page, and that page's own edit form all draw from this one function, so the three
 * cannot drift. The penalty is read from `journey-rules.js` rather than written into the label,
 * so the button and the arithmetic cannot drift either.
 *
 * Season is not here: a route has none (`data/page-route.js`).
 * @param {{path?: string, distance?: string, terrain?: string, vast?: number}} [route]
 */
export function routeChoices({ path = "road", distance = "short", terrain = "easy", vast = 0 } = {}) {
  const t = (k) => game.i18n.localize(k);
  const table = (rows, prefix, cost, notes, picked) => Object.keys(rows).map((key) => {
    const watches = cost ? cost(rows[key]) : 0;
    return {
      key,
      label: t(`${prefix}.${key}`),
      cost: watches > 0 ? `+${watches}` : "",
      note: notes ? t(`${notes}.${key}`) : "",
      selected: key === picked
    };
  });
  return {
    paths: table(PATHS, "CAIRN.Journey.Paths", (v) => v.watches, "CAIRN.Journey.PathNotes", path),
    distances: table(DISTANCES, "CAIRN.Journey.Distances", (v) => v, "", distance),
    terrains: table(TERRAINS, "CAIRN.Journey.Terrains", (v) => v, "CAIRN.Journey.TerrainNotes", terrain),
    vasts: Array.from({ length: VAST_MAX + 1 }, (_, i) => ({ key: i, label: `+${i}`, selected: i === Number(vast) }))
  };
}

/** Begin a journey from the route the Warden described. */
async function start(_journey, { path, distance, terrain, season, vast }) {
  // All four keys, before anything is written. The form only offers valid ones, so this bites a
  // macro — and an unknown season used to throw inside `weatherFor` AFTER the save, leaving a
  // journey whose weather could never be rolled and whose every watch was blocked.
  if (!PATHS[path] || !(distance in DISTANCES) || !(terrain in TERRAINS) || !WEATHER[season]) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Journey.BadRoute"));
    return;
  }
  const route = {
    path,
    distance,
    terrain,
    season,
    vast: Math.min(Math.max(Number(vast) || 0, 0), 2)
  };
  const journey = {
    // Who sets out. Seeded from the characters this world's users are assigned, because that is
    // right for the common case and costs the Warden nothing to have ready — and it is only a
    // SEED: a mount, a hireling or a whole party is dragged onto the roster afterwards
    // (`addCrew`), and the list is what the procedure charges from then on.
    crew: game.users
      .map((user) => user.character)
      .filter((actor) => actor?.type === "character")
      .map((actor) => actor.uuid),
    route,
    watchesNeeded: watchesNeeded(route),
    progress: 0,
    day: 1,
    watch: 0,
    weather: null,
    previousWeather: "",
    lost: false,
    camped: false,
    sleepDeprived: false,
    action: "",
    lostRoll: null,
    supplyRoll: null,
    // What the Wilderness Events table said about the watch that just ended — one row, or two
    // through a night the party travelled. Replaced wholesale by the next watch: this is what
    // just happened, not a log, and a journey of thirty watches would otherwise carry thirty of
    // them in a world setting that is broadcast to every client on every write.
    events: [],
    eventsWatch: "",
    arrived: false
  };
  await save(journey);
  const t = (k) => game.i18n.localize(k);
  await postJourneyCard({
    flavor: t("CAIRN.Journey.Title"),
    lead: t("CAIRN.Journey.Started"),
    lines: [
      `${t("CAIRN.Journey.Path")}: ${t(`CAIRN.Journey.Paths.${route.path}`)}`,
      `${t("CAIRN.Journey.Distance")}: ${t(`CAIRN.Journey.Distances.${route.distance}`)}`,
      `${t("CAIRN.Journey.Terrain")}: ${t(`CAIRN.Journey.Terrains.${route.terrain}`)}`,
      game.i18n.localize("CAIRN.Journey.NeedsWatches", { n: journey.watchesNeeded })
    ],
    open: true
  });
  // The first day has weather like every other one, so it is rolled here rather than waited for.
  await rollWeather(journey);
}

/**
 * Put one or more Actors on the journey — a character, a hireling, a mount, or every deployed
 * member of a party dropped onto the roster at once (`apps/journey-tracker.js`).
 *
 * Adding and not replacing: a drop that wiped the list would throw away whoever the Warden had
 * put there by hand, in silence. A uuid already on it is ignored, so the same drop twice is the
 * same crew.
 */
async function addCrew(journey, { uuids }) {
  const crew = new Set(journey.crew ?? []);
  const before = crew.size;
  for (const uuid of Array.isArray(uuids) ? uuids : []) if (typeof uuid === "string") crew.add(uuid);
  if (crew.size === before) return;
  journey.crew = [...crew];
  await save(journey);
}

/** Take one off the journey. The row is gone, not marked — the list is the whole answer. */
async function removeCrew(journey, { uuid }) {
  const crew = (journey.crew ?? []).filter((u) => u !== uuid);
  if (crew.length === (journey.crew ?? []).length) return;
  journey.crew = crew;
  await save(journey);
}

/** What the party does this watch, as the group decided it. An empty string takes the choice back. */
async function setAction(journey, { action }) {
  if (action !== "" && !ACTIONS.includes(action)) return;
  if (journey.action === action) return;
  const crewBefore = members(journey).length;
  journey.action = action;
  dropStaleRolls(journey, crewBefore);
  await save(journey);
}

/**
 * Throw away a roll the party has just invalidated: the lost roll once it is no longer
 * travelling, the Supply bounty once it is no longer foraging or the number of foragers moved
 * (the die grows with them). A roll that still stands is kept, so pressing the same action twice
 * does not make the party throw the same die twice.
 */
function dropStaleRolls(journey, crewBefore) {
  if (journey.action !== "travel") journey.lostRoll = null;
  if (journey.action !== "supply" || members(journey).length !== crewBefore) journey.supplyRoll = null;
}

/**
 * The day's weather. Rolled without being asked whenever a day begins — the procedure has no day
 * that skips the table — and again whenever the Warden presses Auto, which is what that button
 * means: hand the sky back to the dice.
 */
async function rollWeather(journey) {
  const roll = await rollJourneyDie("1d6");
  const weather = weatherFor(journey.route.season, roll.total, journey.previousWeather);
  journey.weather = weather;
  await save(journey);
  await postRollCard(roll, {
    flavor: game.i18n.localize("CAIRN.Journey.WeatherFlavor", { day: journey.day }),
    lead: game.i18n.localize(`CAIRN.Journey.Weathers.${weather}`),
    text: game.i18n.localize(`CAIRN.Journey.WeatherEffects.${weather}`)
  });
}

/**
 * The Warden's hand on the sky: set today's weather to any row of the Difficulty table, or ask
 * for it back from the dice with Auto (the empty value). Setting it by hand posts no card — the
 * story already said what the weather is, and a Warden turning the dial should not have to watch
 * the chat fill up; rolling it does, because a roll is a roll.
 */
async function setWeather(journey, { weather }) {
  if (weather === "") return rollWeather(journey);
  if (!WEATHER_EFFECTS[weather]) return;
  journey.weather = weather;
  await save(journey);
}

/** "The party rolls 1d6 to see if they get lost." One roll for the party, against the path's odds. */
async function rollLost(journey) {
  if (journey.lostRoll !== null || journey.lost) return;
  if (journey.action !== "travel") return;
  const roll = await rollJourneyDie("1d6");
  const lost = isLost(roll.total, journey.route.path);
  journey.lostRoll = { face: roll.total, lost };
  await save(journey);
  await postRollCard(roll, {
    flavor: game.i18n.localize("CAIRN.Journey.LostFlavor"),
    lead: game.i18n.localize(lost ? "CAIRN.Journey.Lost" : "CAIRN.Journey.NotLost"),
    text: game.i18n.localize("CAIRN.Journey.LostOdds", {
      odds: PATHS[journey.route.path].lost,
      path: game.i18n.localize(`CAIRN.Journey.Paths.${journey.route.path}`)
    }),
    resultCls: lost ? "failure" : "success"
  });
}

/** The Supply bounty: 1d4 Rations, a die size up per extra participant, capped at 1d12. */
async function rollSupply(journey) {
  if (journey.supplyRoll !== null) return;
  if (journey.action !== "supply") return;
  const foragers = members(journey).length;
  if (!foragers) return;
  const die = supplyDie(foragers);
  const roll = await rollJourneyDie(`1d${die}`);
  journey.supplyRoll = { die, total: roll.total };
  await save(journey);
  await postRollCard(roll, {
    flavor: game.i18n.localize("CAIRN.Journey.SupplyFlavor"),
    lead: game.i18n.localize("CAIRN.Journey.SupplyFound", { n: roll.total }),
    text: game.i18n.localize("CAIRN.Journey.SupplyDie", { participants: foragers, die })
  });
}

/**
 * The party spends the watch at a settlement instead of foraging: "The party may encounter homes
 * and small villages, spending gold and a full watch to resupply"
 * (`srd-2e/players-guide/procedures.md` → Supply). It fills the same slot the bounty roll does,
 * so the watch can be spent either way, and it is the party's to choose for the same reason the
 * bounty roll is.
 *
 * The watch is charged at resolve; the gold is not charged at all, because the SRD names no price
 * and no quantity. Inventing either would be a house rule wearing the SRD's clothes — the Warden
 * settles it on the sheets, where the purse already is.
 */
async function resupply(journey) {
  if (journey.supplyRoll !== null) return;
  if (journey.action !== "supply") return;
  journey.supplyRoll = { settlement: true };
  await save(journey);
}

/**
 * Resolve the watch: apply the action the party took to every member's sheet, move the party,
 * roll the event, advance the clock. Refused while no action is set or a roll it needs is still
 * owed.
 */
async function resolveWatch(journey) {
  const need = pendingNeeds(journey);
  if (!need.ready) return;

  const action = need.action;
  const crew = members(journey);
  const names = crew.map((a) => a.name).join(", ");
  const lines = [];
  const t = (k) => game.i18n.localize(k);

  // Make Camp: a Ration each; those who ate and slept clear every Fatigue.
  if (action === "camp") {
    for (const actor of crew) {
      const ate = await consumeRation(actor);
      if (ate) {
        // Food and rest met: the need is answered, so Deprived lifts first — a Deprived PC "cannot
        // recover … from Fatigue" (`core-rules.md`), and nothing else in the system lifts it.
        await actor.toggleStatusEffect(CONDITION.DEPRIVED, { active: false });
        const fatigue = actor.items.filter((i) => i.type === "fatigue").map((i) => i.id);
        if (fatigue.length) await actor.deleteEmbeddedDocuments("Item", fatigue);
        lines.push(game.i18n.localize("CAIRN.Journey.Camped", { name: actor.name }));
      } else {
        await actor.toggleStatusEffect(CONDITION.DEPRIVED, { active: true });
        lines.push(game.i18n.localize("CAIRN.Journey.CampedHungry", { name: actor.name }));
      }
    }
  }

  // Supply: the rolled bounty dealt round the participants, or a settlement — "spending gold and
  // a full watch to resupply". The watch is charged by the clock, which advances at the foot of
  // this function like any other watch; the gold is not charged at all, because the SRD prices it
  // at nothing. The route is no longer for it either: `watchesNeeded` is the route's length, and
  // resupplying left the route exactly as long as it was.
  if (action === "supply" && journey.supplyRoll) {
    if (journey.supplyRoll.settlement) {
      lines.push(t("CAIRN.Journey.Resupplied"));
    } else {
      await dealRations(crew, journey.supplyRoll.total);
      lines.push(game.i18n.localize("CAIRN.Journey.Supplied", { n: journey.supplyRoll.total, names }));
    }
  }

  // Explore: the Warden narrates what was found. The watch bought no ground — "The Travel action
  // is still required to leave the current area, even if it has been completely explored" — and
  // it did not lengthen the ROUTE either, so neither number on the journey bar moves; the clock
  // is what records the watch.
  if (action === "explore") {
    lines.push(game.i18n.localize("CAIRN.Journey.Explored", { names }));
  }

  // Travel: a watch closer — or, when lost, the way found again instead.
  if (action === "travel") {
    if (journey.lost) {
      journey.lost = false;
      lines.push(t("CAIRN.Journey.WayFound"));
    } else if (journey.lostRoll?.lost) {
      journey.lost = true;
      lines.push(t("CAIRN.Journey.GotLost"));
    } else {
      journey.progress += 1;
      lines.push(game.i18n.localize("CAIRN.Journey.Travelled", { progress: journey.progress, needed: journey.watchesNeeded }));
    }
  }

  const flavor = watchLabel(journey);
  await postJourneyCard({
    flavor,
    lead: game.i18n.localize("CAIRN.Journey.PartyTakes", { action: t(`CAIRN.Journey.Actions.${action}`) }),
    lines
  });

  // The event: once per watch, twice through a night the party travels (`eventsForWatch`). It is
  // written onto the journey rather than whispered to chat — the Warden is already looking at the
  // window, and the window's copy is the one that can be rerolled and placed.
  const count = eventsForWatch(journey.watch === WATCHES.length - 1, action);
  journey.events = [];
  journey.eventsWatch = flavor;
  for (let i = 0; i < count; i++) {
    const entry = await rollEvent(journey);
    if (entry) journey.events.push(entry);
  }

  // After the event, so arrival is the last word of the watch — and only on the watch that lands
  // them: the old test was on `arrived` alone, which announced it again every watch they spent
  // at the destination.
  if (!journey.arrived && journey.progress >= journey.watchesNeeded) await arrive(journey, flavor);

  // The clock. A night nobody camped through costs everyone a Fatigue and Deprived, and the next
  // day's terrain is a step harder.
  if (action === "camp") journey.camped = true;
  const next = nextWatch(journey);
  const newDay = next.day !== journey.day;
  if (newDay) {
    if (!journey.camped) {
      await addFatigueToParty(journey, { deprive: true });
      await postJourneyCard({ flavor, lead: t("CAIRN.Journey.NoSleep") });
    }
    journey.sleepDeprived = !journey.camped;
    journey.camped = false;
    journey.previousWeather = journey.weather;
    journey.weather = null;
  }
  journey.day = next.day;
  journey.watch = next.watch;
  journey.action = "";
  journey.lostRoll = null;
  journey.supplyRoll = null;
  await save(journey);
  // A new day has weather before it has anything else, so it is rolled here — the saved journey
  // is the one the roll writes on, and its own save is what the open windows redraw from.
  if (newDay) await rollWeather(journey);
}

/** Throw one of this watch's events back and roll it again, in place. The Warden's. */
async function rerollEvent(journey, { index }) {
  const i = Number(index);
  if (!Array.isArray(journey.events) || !journey.events[i]) return;
  const entry = await rollEvent(journey);
  if (!entry) return;
  journey.events[i] = entry;
  await save(journey);
}

/**
 * Remember that an event's encounter has been put on a scene, so the button cannot fire twice.
 * The placement itself is NOT here: it needs a click on the canvas, which is local to the
 * Warden's own client and cannot be proxied through a setting
 * (`module/apps/journey-tracker.js#onPlaceEncounter`).
 */
async function markEncounterPlaced(journey, { index }) {
  const entry = journey.events?.[Number(index)];
  if (!entry?.encounter) return;
  entry.encounter.placed = true;
  await save(journey);
}

/**
 * The Warden's hand on the numbers: a watch more or less to the journey (weather, a barrier, a
 * guide), a watch of progress more or less (a shortcut, a wrong turn the roll never saw).
 */
async function adjust(journey, { field, delta }) {
  const d = Math.sign(Number(delta) || 0);
  if (field === "watchesNeeded") journey.watchesNeeded = Math.max(1, journey.watchesNeeded + d);
  else if (field === "progress") journey.progress = Math.min(Math.max(journey.progress + d, 0), journey.watchesNeeded);
  else return;
  const wasArrived = journey.arrived;
  journey.arrived = journey.progress >= journey.watchesNeeded;
  // Only on the transition: the Warden's `+1` that lands the party arrives them, and the `−1`
  // afterwards does not walk them back — where the party is is a fact about the fiction, not a
  // function of a counter, so `arrive` runs once and the position it set stays put.
  if (!wasArrived && journey.arrived) await arrive(journey, game.i18n.localize("CAIRN.Journey.Title"));
  await save(journey);
}

/** A Fatigue on every character on the journey — the weather's toll, or a night without sleep. */
async function addFatigueToParty(journey, { deprive = false } = {}) {
  for (const actor of members(journey)) {
    try {
      await actor.addFatigue();
    } catch (err) {
      // No free slot: the creation is refused with the player's warning (`documents/item.js`).
      console.warn(`${SYSTEM_ID} | ${actor.name}: Fatigue refused`, err);
    }
    if (deprive) await actor.toggleStatusEffect(CONDITION.DEPRIVED, { active: true });
  }
}

/** The journey is over — arrived, abandoned, or replanned. */
async function end() {
  await save(null);
  await postJourneyCard({
    flavor: game.i18n.localize("CAIRN.Journey.Title"),
    lead: game.i18n.localize("CAIRN.Journey.Ended")
  });
}

/* -------------------------------------------- */
/*  The sheets                                  */
/* -------------------------------------------- */

/** Spend one use of the character's Rations. `false` when there is none left to spend. */
async function consumeRation(actor) {
  const rations = actor.items.find((i) => isRation(i) && i.system.uses.value > 0);
  if (!rations) return false;
  await rations.update({ "system.uses.value": rations.system.uses.value - 1 });
  return true;
}

/**
 * Create `count` Rations from the `gear` pack, dealt one at a time round the participants — and
 * written as one create per actor, not one per Ration: a bounty of six on a party of two was six
 * writes and six renders of every open sheet.
 */
async function dealRations(actors, count) {
  const source = await fromUuid(GEAR.RATIONS);
  if (!source) return;
  const data = copyOf(source);
  const perActor = new Map();
  for (let i = 0; i < count; i++) {
    const actor = actors[i % actors.length];
    perActor.set(actor, [...(perActor.get(actor) ?? []), foundry.utils.deepClone(data)]);
  }
  for (const [actor, items] of perActor) {
    try {
      // A body with no room keeps the Rations that fit and warns for the rest
      // (`documents/item.js#_preCreateOperation` trims the batch); the other actors still deal.
      await actor.createEmbeddedDocuments("Item", items);
    } catch (err) {
      console.warn(`${SYSTEM_ID} | ${actor.name}: Rations refused`, err);
    }
  }
}

/* -------------------------------------------- */
/*  The event                                   */
/* -------------------------------------------- */

/** "Day 2, night" — the caption of every card a watch posts. */
export function watchLabel(journey) {
  return game.i18n.localize("CAIRN.Journey.WatchFlavor", {
    day: journey.day,
    watch: game.i18n.localize(`CAIRN.Journey.Watches.${WATCHES[journey.watch]}`)
  });
}

/**
 * Roll `Wilderness Event` and return it as the window will draw it. Nothing is posted: the table's
 * rows are the Warden's material — a Sign to place, a Loss to price, an Encounter to stage — and
 * the party is meant to meet the result rather than read the row it came from, which used to mean
 * a whisper to the Wardens and now means the Warden's own window.
 *
 * An Encounter brings its creatures with it: the `Wilderness Encounter` table is drawn silently,
 * its rows parsed from the results themselves rather than from a card, and the Reaction rolled —
 * "Don't forget to roll for NPC reactions if applicable"
 * (`srd-2e/players-guide/procedures.md` → Wilderness Events). The Reaction is a roll, so it still
 * posts a card; the band is kept here so the window can show it beside what it belongs to.
 * @returns {Promise<{category: string, text: string, party: string|null, encounter: object|null}|null>}
 */
async function rollEvent(journey) {
  const event = await rollWardenTable(TABLES.WILDERNESS_EVENT);
  if (!event) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Journey.NoTable", { uuid: TABLES.WILDERNESS_EVENT }));
    return null;
  }
  // The row's marker is what dispatch reads; its name ("Encounter", "Sign", ...) is what the
  // window prints, and `event.text` is its prose.
  const result = event.results?.[0];
  const kind = result?.flags?.[SYSTEM_ID]?.event ?? "";
  const entry = {
    category: String(result?.name ?? "").trim(),
    text: event.text,
    // Exhaustion is the one row that names the party: the Warden weighs Fatigue against who is
    // actually out there. No Fatigue is added — only camp and a skipped night write one.
    party: kind === EVENT.EXHAUSTION ? partyNames(journey) : null,
    encounter: null
  };
  if (kind === EVENT.ENCOUNTER) entry.encounter = await drawEncounter();
  return entry;
}

/** The creatures an Encounter brought, their Reaction, and whether they are on a scene yet. */
async function drawEncounter() {
  const draw = await drawWildernessEncounter({ displayChat: false });
  if (!draw) return null;
  const rows = parseEncounterResults(draw.results);
  const reaction = await rollReaction();
  return { rows, reaction: { total: reaction.total, label: reaction.label }, placed: false };
}

/** The party by name, for the Exhaustion reminder. */
function partyNames(journey) {
  const names = members(journey).map((a) => a.name);
  return names.length ? names.join(", ") : game.i18n.localize("CAIRN.Journey.NoParty");
}

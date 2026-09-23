/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The arithmetic of Wilderness Exploration — `srd-2e/players-guide/procedures.md` → "Travel
 * Duration", "Path Difficulty", "Terrain Difficulty", "Weather", and the "Travel" / "Supply"
 * actions. Pure: no Foundry global is touched, so `checks/journey-rules.check.mjs` imports this
 * under plain Node and asserts every table row. `module/journey.js` is where it meets the world.
 */

/** Path Difficulty: the watch penalty and the "N-in-6" odds of getting lost. */
export const PATHS = {
  road: { watches: 0, lost: 0 },
  trail: { watches: 1, lost: 2 },
  wilderness: { watches: 2, lost: 3 }
};

/** Path Distance, in watches. */
export const DISTANCES = { short: 1, medium: 2, long: 3 };

/** Terrain Difficulty, in watches. The order is the one "raise the Difficulty by a step" walks. */
export const TERRAINS = { easy: 0, tough: 1, perilous: 2 };

/** "For especially vast terrain, assign a penalty of up to +2 watches." */
export const VAST_MAX = 2;

/** The Weather Type table: one d6 column per season, face 1 first. */
export const WEATHER = {
  spring: ["nice", "fair", "fair", "unpleasant", "inclement", "extreme"],
  summer: ["nice", "nice", "fair", "unpleasant", "inclement", "extreme"],
  fall: ["fair", "fair", "unpleasant", "inclement", "inclement", "extreme"],
  winter: ["fair", "unpleasant", "inclement", "inclement", "extreme", "extreme"]
};

/**
 * Weather Difficulty, as what the table asks the Warden to do. `fatigue` / `watch` say whether
 * the row mentions adding a Fatigue and adding a watch, `either` that the row offers the choice
 * ("or") rather than both ("and"), `step` that terrain Difficulty rises a step, `halt` that most
 * parties cannot travel.
 */
export const WEATHER_EFFECTS = {
  nice: { fatigue: false, watch: false, either: false, step: false, halt: false },
  fair: { fatigue: false, watch: false, either: false, step: false, halt: false },
  unpleasant: { fatigue: true, watch: true, either: true, step: false, halt: false },
  inclement: { fatigue: true, watch: true, either: true, step: true, halt: false },
  extreme: { fatigue: true, watch: true, either: false, step: true, halt: false },
  catastrophic: { fatigue: false, watch: false, either: false, step: false, halt: true }
};

/** The three watches of a day, in order. */
export const WATCHES = ["morning", "afternoon", "night"];

/** The four Wilderness Actions — what the party may do with a watch. */
export const ACTIONS = ["travel", "explore", "supply", "camp"];

/**
 * How many watches the journey takes: "combine all penalties from the path, terrain, and weather
 * difficulty tables". Weather is rolled daily and is not known at planning time, so it is not
 * here — the Warden adds a watch when a day's weather says so.
 * @param {{path: string, distance: string, terrain: string, vast?: number}} route
 * @returns {number}
 */
export function watchesNeeded({ path, distance, terrain, vast = 0 }) {
  const extra = Math.min(Math.max(Number(vast) || 0, 0), VAST_MAX);
  return PATHS[path].watches + DISTANCES[distance] + TERRAINS[terrain] + extra;
}

/**
 * The lost roll: "The party rolls 1d6 to see if they get lost" against the path's "N-in-6".
 * @param {number} face  The d6 face.
 * @param {string} path  A key of {@link PATHS}.
 * @returns {boolean}
 */
export function isLost(face, path) {
  return face <= PATHS[path].lost;
}

/**
 * The Supply die: "1d4 Rations … The chance of a greater bounty increases with each additional
 * participant (e.g. 1d4 becomes 1d6, up to a maximum of 1d12)."
 * @param {number} participants  At least one.
 * @returns {number}  The die size.
 */
export function supplyDie(participants) {
  return Math.min(4 + 2 * (Math.max(participants, 1) - 1), 12);
}

/**
 * Today's weather from a d6 face, the season, and yesterday's weather: "If the 'Extreme' weather
 * result is rolled twice in a row, the weather turns to 'Catastrophic'."
 * @param {string} season   A key of {@link WEATHER}.
 * @param {number} face     The d6 face.
 * @param {string} [previous]  Yesterday's result, if any.
 * @returns {string}
 */
export function weatherFor(season, face, previous = "") {
  const rolled = WEATHER[season][face - 1];
  if (rolled === "extreme" && (previous === "extreme" || previous === "catastrophic")) return "catastrophic";
  return rolled;
}

/**
 * "Traveling when sleep-deprived raises the terrain Difficulty by a step" — and Inclement or
 * Extreme weather does the same. Perilous is the top step.
 * @param {string} terrain
 * @param {number} steps
 * @returns {string}
 */
export function raiseTerrain(terrain, steps) {
  const keys = Object.keys(TERRAINS);
  return keys[Math.min(keys.indexOf(terrain) + Math.max(steps, 0), keys.length - 1)];
}

/**
 * The watch after this one. A day is three watches; the third rolls into the next day's morning.
 * @param {{day: number, watch: number}} clock
 * @returns {{day: number, watch: number}}
 */
export function nextWatch({ day, watch }) {
  return watch >= WATCHES.length - 1 ? { day: day + 1, watch: 0 } : { day, watch: watch + 1 };
}

/**
 * The action the Warden set, and what the watch still needs before it can be resolved: the day's
 * weather, the lost roll a Travel owes, the supply roll a Supply owes. `ready` is all of it met —
 * the one predicate the Resolve button and `journey.js#resolveWatch` both read.
 * @param {{ action: string, weather: string|null, lost: boolean, lostRoll: object|null, supplyRoll: object|null }} journey
 * @returns {{ weather: boolean, lost: boolean, supply: boolean, action: string, ready: boolean }}
 */
export function pendingNeeds(journey) {
  const action = ACTIONS.includes(journey.action) ? journey.action : "";
  const need = {
    weather: journey.weather === null,
    lost: action === "travel" && !journey.lost && journey.lostRoll === null,
    supply: action === "supply" && journey.supplyRoll === null,
    action
  };
  need.ready = !!action && !need.weather && !need.lost && !need.supply;
  return need;
}

/**
 * Wilderness Events a watch rolls: once, and twice through a night the party travels —
 * "Traveling at night is always more dangerous! The Warden should roll _twice_" (`procedures.md`
 * → Night). Only travelling: exploring, supplying or camping at night is not travelling.
 * @param {boolean} night
 * @param {string} action
 * @returns {1|2}
 */
export function eventsForWatch(night, action) {
  return night && action === "travel" ? 2 : 1;
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The watch, on everyone's screen: a chip directly above the player list, three marks with the
 * current one lit. The Warden clicks it to move to the next watch and right-clicks to step back;
 * a player only reads it.
 *
 * Its time is Foundry's world time (`core.time`), read through `clock-rules.js`, so a calendar
 * module and this chip always show the same moment — and the journey (`journey.js`) reads and
 * advances this same clock rather than keeping one of its own. While a journey is underway the
 * chip does not step: the journey is the procedure that spends that time (a Ration, an event, the
 * day's weather), so a click opens it instead of skipping a watch nobody resolved.
 *
 * WHERE IT SITS. Core's left column (`#ui-left-column-1`) holds the scene controls (`flex: 1`)
 * and `#players`, `justify-content: space-between`; a third child between them lands directly
 * above the list. `#players` is created once and its re-renders replace only its children, so a
 * sibling before it survives them. Audio/Video never moves the list out of that column — a docked
 * camera bar shifts or shortens the whole interface around it (observed on 14.368 in every dock
 * position, minimised or not) — so the chip moves with the list and needs no camera handling.
 */

import { SYSTEM_ID, SETTINGS } from "../constants.js";
import { WATCHES } from "../journey-rules.js";
import { watchGeometry, watchAt, nextWatchStart, previousWatchStart } from "../clock-rules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The watch geometry of the world's calendar — its day need not be 24 hours. */
function geometry() {
  return watchGeometry(game.time.calendar.days);
}

/** The watch it is now: an index of {@link WATCHES}. */
export function currentWatch() {
  return watchAt(game.time.worldTime, geometry());
}

/** Move the world to the start of the next watch. Writes `core.time`, so the Warden's. */
export function advanceWatch() {
  return game.time.set(nextWatchStart(game.time.worldTime, geometry()));
}

/** One step back: to this watch's start, or the previous one's when already on a boundary. */
function rewindWatch() {
  return game.time.set(previousWatchStart(game.time.worldTime, geometry()));
}

export class CairnWatchClock extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${SYSTEM_ID}-watch-clock`,
    // `faded-ui` is what core puts on the player list and the scene controls: the chip fades
    // with them under the same client setting and comes back on hover.
    classes: [SYSTEM_ID, "cairn-watch-clock", "faded-ui"],
    tag: "aside",
    window: { frame: false, positioned: false },
    actions: { step: CairnWatchClock.#onStep }
  };

  static PARTS = {
    clock: { template: `systems/${SYSTEM_ID}/templates/apps/watch-clock.hbs` }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const now = currentWatch();
    const watch = game.i18n.localize(`CAIRN.Watches.${WATCHES[now]}`);
    const journeying = !!game.settings.get(SYSTEM_ID, SETTINGS.JOURNEY);
    context.marks = WATCHES.map((key, i) => ({ key, current: i === now }));
    context.watch = watch;
    context.label = game.i18n.localize("CAIRN.Clock.Name", { watch });
    context.canStep = game.user.isGM;
    context.hint = !game.user.isGM ? context.label
      : game.i18n.localize(journeying ? "CAIRN.Clock.HintJourney" : "CAIRN.Clock.Hint", { watch });
    return context;
  }

  /** @override — right-click steps back. The `actions` map answers left clicks only, and the
   *  application's element outlives every re-render, so the listener is bound once. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    if (!game.user.isGM) return;
    this.element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!game.settings.get(SYSTEM_ID, SETTINGS.JOURNEY)) rewindWatch();
    });
  }

  /** The Warden's click: the next watch, or the journey when one is underway. */
  static async #onStep() {
    if (!game.user.isGM) return;
    if (!game.settings.get(SYSTEM_ID, SETTINGS.JOURNEY)) return advanceWatch();
    // Loaded on demand: the tracker imports the journey, which imports this file.
    const { CairnJourneyTracker } = await import("./journey-tracker.js");
    return CairnJourneyTracker.open();
  }
}

/**
 * Put the chip above the player list on its first render, and keep it current. An empty element
 * carrying the chip's id goes in first: `ApplicationV2` inserts its element by replacing one with
 * the same id, which is how core's own `<template id="players">` becomes the list.
 */
export function installWatchClock() {
  clock = new CairnWatchClock();
  Hooks.on("renderPlayers", (app, element) => {
    if (document.getElementById(clock.id)) return;
    const slot = document.createElement("div");
    slot.id = clock.id;
    element.before(slot);
    clock.render({ force: true });
  });
  Hooks.on("updateWorldTime", refreshWatchClock);
}

/** The one chip on this client, once installed. */
let clock = null;

/** Redraw the chip — the time moved, or a journey began or ended (its click and hint change). */
export function refreshWatchClock() {
  if (clock?.rendered) clock.render();
}

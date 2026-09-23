/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import * as journey from "./journey.js";
import { CairnJourneyTracker } from "./apps/journey-tracker.js";

/**
 * Pointcrawls, as Foundry already draws them: a Scene with the map as its background and a Note
 * per point of interest linking to that point's journal page
 * (`srd-2e/wardens-guide/pointcrawls.md`).
 *
 * Everything else on that map — the roads, what each costs in watches, which point the party is
 * standing on — belongs to the MAP and to the table. The SRD's own example is a drawing with its
 * paths and travel times lettered onto it, and a Warden's art already carries them. This system
 * drew both, first as ink curves and then as a ring round a pin, and neither could help but read
 * as a second map laid over the first.
 *
 * What is left is the one thing Foundry can add that a picture cannot: a Note dropped wherever
 * the art already says how long a road takes, linking to a `route` page, whose double-click opens
 * the journey with that road's numbers already in it (`module/data/page-route.js`). No lines, no
 * markers, and nothing written to a Note or a Scene.
 *
 * Here rather than in `journey.js` because this is canvas and journal glue: the procedure knows
 * nothing about Notes and imports no canvas object, and it stays that way.
 */

/** The subtype id, as `system.json#documentTypes.JournalEntryPage` declares it. */
export const ROUTE_TYPE = "route";

/**
 * A `route` page as the object `journey.apply("start", …)` takes: the four inputs the Wilderness
 * Exploration tables price, and nothing else. A route names no points — it is the cost of one
 * road, and the map already says which road that is.
 * @param {JournalEntryPage} page
 */
export function routeOf(page) {
  const { path, distance, terrain, vast } = page.system;
  return { path, distance, terrain, vast };
}

/**
 * The Warden's way in, from a pin or from the page's own button: a journey already underway is
 * ended — its "journey is over" card is the record, and the maintainer chose that over a confirm
 * — and the window opens on a form already set to this route.
 * @param {JournalEntryPage} page
 * @returns {Promise<boolean>}  Whether this was a route the Warden may begin.
 */
export async function beginFromPage(page) {
  if (!game.user.isGM || page?.type !== ROUTE_TYPE) return false;
  if (journey.current()) await journey.apply("end");
  CairnJourneyTracker.open({ route: routeOf(page) });
  return true;
}

/**
 * Double-clicking a map pin that links to a route: the Warden gets the pre-filled journey form
 * instead of the page, everyone else gets the page as they would any other.
 *
 * `Note#_onClickLeft2` calls this hook and a `false` cancels its own sheet render
 * (`client/canvas/placeables/note.mjs`), which is what swaps one for the other.
 */
export function registerPointcrawlHooks() {
  Hooks.on("activateNote", (note) => {
    const page = note.document.page;
    if (!game.user.isGM || page?.type !== ROUTE_TYPE) return;
    beginFromPage(page);
    return false;
  });
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { PATHS, DISTANCES, TERRAINS, VAST_MAX } from "../journey-rules.js";

const fields = foundry.data.fields;

/**
 * One road of a pointcrawl (`srd-2e/wardens-guide/pointcrawls.md`), priced in watches by the
 * Wilderness Exploration tables — "Indicate the rough travel time (in Watches or days of travel)
 * between any two points". The SRD's own worked example is exactly
 * `watchesNeeded({ path, distance, terrain, vast })`, so a route stores those four inputs and
 * nothing derived from them.
 *
 * It names no points, and that is deliberate. WHICH road this is, is said by where its map pin
 * sits: the Warden drops it on the path their art already draws, beside the travel time the art
 * already letters. A page that also stored its two endpoints made the same statement twice and
 * asked the Warden to keep them agreeing.
 *
 * No season either: the season belongs to the world at the moment the party sets out, and the
 * journey window is where it is picked.
 */
export class RouteData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Route"];

  static defineSchema() {
    return {
      path: new fields.StringField({ required: true, blank: false, initial: "road", choices: Object.keys(PATHS) }),
      distance: new fields.StringField({ required: true, blank: false, initial: "short", choices: Object.keys(DISTANCES) }),
      terrain: new fields.StringField({ required: true, blank: false, initial: "easy", choices: Object.keys(TERRAINS) }),
      vast: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: VAST_MAX }),

      description: new fields.HTMLField({ required: true, blank: true })
    };
  }
}

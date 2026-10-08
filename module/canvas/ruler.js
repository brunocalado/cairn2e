/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { metric, toTenth } from "../token-distance-rules.js";

/** Core's label markup with the system's figures; core's classes stay, so core's CSS styles it. */
const WAYPOINT_LABEL_TEMPLATE = `systems/${SYSTEM_ID}/templates/canvas/waypoint-label.hbs`;

/**
 * Adds `measure` to core's label context, the figures the system's template prints. Scenes stay
 * in feet and the table reads metres: on a scene in `ft` the total reads as the hover does,
 * `12 m (40 ft)`, and the delta and the elevation in metres only, since the total already gives
 * the feet. Any other unit prints in its own, to one decimal.
 * The elevation the previous label stood at is kept under the system's own key in `state`,
 * because the one core keeps there is not documented.
 * @param {object|void} context  what core's `_getWaypointLabelContext` returned
 * @param {object} waypoint
 * @param {object} state         core's per-path state
 * @param {{total: number, delta: number, height: (waypoint: object) => number}} figures
 *   feet so far, feet this segment adds, and a waypoint's elevation in feet
 * @returns {object|void}
 */
function withMetres(context, waypoint, state, { total, delta, height }) {
  state.cairnElevation ??= height(waypoint.previous ?? waypoint);
  if (!context) return context;
  const { units } = canvas.grid;
  const ft = units === "ft";
  const figure = (n) => (ft ? metric(n).metres : toTenth(n));
  const elevation = height(waypoint);
  const rise = toTenth(elevation - state.cairnElevation);
  state.cairnElevation = elevation;
  context.measure = {
    total: !Number.isFinite(total) ? "∞"
      : ft ? game.i18n.localize("CAIRN.TokenDistance", metric(total)) : `${toTenth(total)} ${units}`.trim(),
    delta: (waypoint.index < 2) ? null : Number.isFinite(delta) ? figure(delta).signedString() : "∞",
    elevation: ft ? game.i18n.localize("CAIRN.ElevationMetres", { metres: figure(elevation).signedString() })
      : `${figure(elevation).signedString()} ${units}`.trim(),
    rise: (rise === 0) ? null : figure(rise).signedString()
  };
  return context;
}

/**
 * Cairn 2e's token drag ruler. Core labels the token's path with its cost, which with no terrain is
 * its distance; a terrain module's cost is in the scene's feet like the distance, so it converts
 * the same way.
 */
export class CairnTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
  static WAYPOINT_LABEL_TEMPLATE = WAYPOINT_LABEL_TEMPLATE;

  /** @override */
  _getWaypointLabelContext(waypoint, state) {
    const base = canvas.level.elevation.base;
    return withMetres(super._getWaypointLabelContext(waypoint, state), waypoint, state, {
      total: waypoint.measurement.cost, delta: waypoint.cost, height: (w) => w.elevation - base
    });
  }
}

/** Cairn 2e's measuring ruler. */
export class CairnRuler extends foundry.canvas.interaction.Ruler {
  static WAYPOINT_LABEL_TEMPLATE = WAYPOINT_LABEL_TEMPLATE;

  /** @override — the first waypoint has no `backward`; core reads it only from the third on. */
  _getWaypointLabelContext(waypoint, state) {
    return withMetres(super._getWaypointLabelContext(waypoint, state), waypoint, state, {
      total: waypoint.measurement.distance, delta: waypoint.measurement.backward?.distance,
      height: (w) => w.elevation
    });
  }
}

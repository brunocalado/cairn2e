/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The two grid-space centres, one under each token, that sit closest to each other: what a
 * player counts on the map. Centre to centre would be wrong for anything larger than 1×1, since
 * a 2×2's centre is a grid corner and the figure comes out half a square off the ruler.
 *
 * A token covers `width` × `height` spaces from its top-left (x, y). On each axis the ranges of
 * space centres either overlap (both points take the overlap's start, so the axis adds nothing)
 * or one ends before the other begins (the facing edges). Square spaces are assumed: on a hex or
 * gridless scene the result is approximate.
 * @param {{x: number, y: number, width: number, height: number}} a  x/y in px, size in spaces
 * @param {{x: number, y: number, width: number, height: number}} b
 * @param {number} size  the grid's space size in px
 * @returns {[{x: number, y: number}, {x: number, y: number}]}
 */
export function nearestSpaces(a, b, size) {
  const axis = (a0, a1, b0, b1) => {
    if (a1 < b0) return [a1, b0];
    if (b1 < a0) return [a0, b1];
    const m = Math.max(a0, b0);
    return [m, m];
  };
  const centres = (t, k, n) => [t[k] + (size / 2), t[k] + (t[n] * size) - (size / 2)];
  const [xa, xb] = axis(...centres(a, "x", "width"), ...centres(b, "x", "width"));
  const [ya, yb] = axis(...centres(a, "y", "height"), ...centres(b, "y", "height"));
  return [{ x: xa, y: ya }, { x: xb, y: yb }];
}

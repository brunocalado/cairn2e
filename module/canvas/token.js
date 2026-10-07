/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { METRES_PER_FOOT } from "../constants.js";
import { nearestSpaces } from "../token-distance-rules.js";

/**
 * The system's paper and ink, for what it draws on the canvas. Paper as a halo under ink is what
 * keeps a mark readable on a dark cave map and a pale parchment one alike. Hex, not the CSS
 * tokens, because the canvas cannot read custom properties.
 */
const PAPER = 0xf8f6f1;
const INK = 0x191813;

/**
 * The reticule's three strokes, widest first, each laid over the one before. The blood core is
 * the system's own `--cairn-blood`, so a target reads as this system's mark rather than core's.
 */
const RETICULE_STROKES = [
  { color: PAPER, width: 12 },
  { color: INK, width: 8 },
  { color: 0x6e1414, width: 4.5 }
];

/**
 * Cairn 2e token.
 *
 * Three things differ from core's token: the turn marker, because 2e's round is side-based
 * (`core-rules.md` → Combat) and there is no single combatant "whose turn it is" to point at;
 * the target reticule, because core's four small triangles in the token's disposition colour
 * vanish against a busy map; and the tooltip, which adds the distance from the selected token
 * while this one is hovered, in the system's face.
 */
export class CairnToken extends foundry.canvas.placeables.Token {
  /** @override — the distance from the selected token under core's elevation. */
  _getTooltipText() {
    return [super._getTooltipText(), this.#distanceFromSelected()].filter(Boolean).join("\n");
  }

  /**
   * @override — core's body carried across unchanged, with the system's face and ink in place of
   * `_getTextStyle()`. Calling `super` and swapping the style afterwards would leave
   * `levelIndicator` sized and placed from core's font. `_getTextStyle` itself stays core's,
   * because the nameplate uses it too.
   */
  _refreshTooltip() {
    this.tooltip.text = this._getTooltipText();
    this.tooltip.style = this.#tooltipStyle();
    const s = canvas.dimensions.uiScale;
    const { fontSize } = PIXI.TextMetrics.measureFont(this.tooltip.style.toFontString());
    this.levelIndicator.width = this.levelIndicator.height = fontSize * s * 1.25;
    this.levelIndicator.y = this.tooltip.y - (this.tooltip.text ? this.tooltip.height : 0);
  }

  /** @inheritDoc — core redraws the tooltip only when elevation changes; hover changes it here. */
  _onHoverIn(event, options) {
    const result = super._onHoverIn(event, options);
    this.renderFlags.set({ refreshTooltip: true });
    return result;
  }

  /** @inheritDoc */
  _onHoverOut(event, options) {
    const result = super._onHoverOut(event, options);
    this.renderFlags.set({ refreshTooltip: true });
    return result;
  }

  /**
   * How far the first controlled token stands from this one, while this one is hovered: between
   * the nearest square under each, so a large token reads what a player counts on the map, and
   * through the scene's own `measurePath`, so the figure agrees with core's ruler, elevation
   * included. It refreshes on the next hover, not while either token moves.
   * @returns {string}  "" when there is nothing to measure
   */
  #distanceFromSelected() {
    const source = canvas.tokens.controlled[0];
    if (!this.hover || !source || (source === this)) return "";
    const [from, to] = nearestSpaces(source.document, this.document, canvas.grid.size);
    const { distance } = canvas.grid.measurePath([
      { ...from, elevation: source.document.elevation },
      { ...to, elevation: this.document.elevation }
    ]);
    const { units } = canvas.grid;
    // Scenes stay in feet and the table reads metres; any other unit is printed as core prints
    // elevation, in the scene's own.
    if (units !== "ft") return `${Math.round(distance * 10) / 10} ${units}`.trim();
    const metres = Math.round(distance * METRES_PER_FOOT * 10) / 10;
    return game.i18n.localize("CAIRN.TokenDistance", { metres, feet: distance });
  }

  /**
   * Lora in ink on a paper halo, with no drop shadow: the system's monochrome look, and readable
   * on any map. Lora is registered in `CONFIG.fontDefinitions`, so it is loaded before the canvas
   * draws; a face PIXI asks for that is not loaded yet falls back to another without a word.
   * @returns {PIXI.TextStyle}
   */
  #tooltipStyle() {
    const style = CONFIG.canvasTextStyle.clone();
    Object.assign(style, {
      fontFamily: "Lora", fontSize: 24, fill: INK, stroke: PAPER, strokeThickness: 4,
      dropShadow: false, wordWrapWidth: this.w * 2.5
    });
    return style;
  }

  /**
   * @override — mark every token of the side that is acting, not one token.
   *
   * Core's own version gates on `game.combat?.combatant?.tokenId === this.id`, and
   * `CairnCombat#combatant` is deliberately `null`, so left alone the ring would simply never be
   * drawn. The rest of the method — registering and unregistering in `canvas.tokens.turnMarkers`,
   * creating and destroying the PIXI child — is core's, carried across unchanged; only the test
   * for whether this token is acting is this system's.
   */
  _refreshTurnMarker() {
    const { TokenTurnMarker } = foundry.canvas.placeables.tokens;

    // Should a Turn Marker be active?
    const { turnMarker } = this.document;
    const markersEnabled = CONFIG.Combat.settings.turnMarker.enabled
      && (turnMarker.mode !== CONST.TOKEN_TURN_MARKER_MODES.DISABLED);
    const markerActive = markersEnabled && (game.combat?.isTokenActing(this.id) === true);

    // Activate a Turn Marker
    if (markerActive) {
      if (!this.turnMarker) this.turnMarker = this.addChildAt(new TokenTurnMarker(this), 0);
      canvas.tokens.turnMarkers.add(this);
      this.turnMarker.draw();
    }

    // Remove a Turn Marker
    else if (this.turnMarker) {
      canvas.tokens.turnMarkers.delete(this);
      this.turnMarker.destroy();
      this.turnMarker = null;
    }
  }

  /**
   * @override — ink brackets at the four corners and a small cross at the centre, in place of
   * core's four triangles.
   *
   * The brackets scale with the token, so a Large creature's reticule is not a speck at its
   * corners, and they stand a little outside its square so they never sit on the art. Core's
   * TokenLayer re-calls this every frame while anything is targeted, with `margin` going 0.5 → 1
   * and `alpha` fading to 0 on a two-second loop; here that pulls the brackets slightly inward
   * and only dims them, because a reticule that blinks out once a loop is exactly the "hard to
   * see" this override exists to fix.
   */
  _drawTargetArrows({ margin = 0, alpha = 1 } = {}) {
    const g = this.targetArrows;
    g.clear();
    if (!this.targeted.has(game.user)) return;

    const s = canvas.dimensions.uiScale;
    const { w, h } = this;
    const arm = Math.min(w, h) * 0.3;
    const cross = Math.min(w, h) * 0.08;
    const pull = Math.max(0, margin - 0.5) * 2;
    const o = (8 * s) - (pull * 6 * s);
    alpha = 0.6 + (0.4 * alpha);

    const corners = [
      [-o, -o, 1, 1], [w + o, -o, -1, 1], [-o, h + o, 1, -1], [w + o, h + o, -1, -1]
    ];
    const [cx, cy] = [w / 2, h / 2];
    for (const { color, width } of RETICULE_STROKES) {
      g.lineStyle({ color, alpha, width: width * s, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
      for (const [x, y, dx, dy] of corners) {
        g.moveTo(x + (dx * arm), y).lineTo(x, y).lineTo(x, y + (dy * arm));
      }
      g.moveTo(cx - cross, cy).lineTo(cx + cross, cy);
      g.moveTo(cx, cy - cross).lineTo(cx, cy + cross);
    }
  }

  /**
   * @override — the other users targeting this token, as pips along its top edge in their own
   * colours, larger than core's and ringed in ink and paper so they hold up on the same maps the
   * reticule does. Colour is what says *who* marked it, so it stays the user's.
   */
  _drawTargetPips() {
    const g = this.targetPips;
    g.clear();
    const others = Array.from(this.targeted).filter(u => u !== game.user);
    if (!others.length) return;

    const s = canvas.dimensions.uiScale;
    const r = 8 * s;
    const step = 22 * s;
    const x0 = (this.w / 2) - ((others.length - 1) * step / 2);
    const y = -14 * s;
    for (const [i, u] of others.entries()) {
      g.lineStyle({ color: PAPER, width: 6 * s }).drawCircle(x0 + (i * step), y, r);
      g.lineStyle({ color: INK, width: 3 * s }).beginFill(u.color, 1).drawCircle(x0 + (i * step), y, r).endFill();
    }
  }
}

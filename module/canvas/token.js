/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Cairn 2e token.
 *
 * One override, for one reason: 2e's round is side-based (`core-rules.md` → Combat), so there is
 * no single combatant "whose turn it is" for core's turn marker to point at.
 */
export class CairnToken extends foundry.canvas.placeables.Token {
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
}

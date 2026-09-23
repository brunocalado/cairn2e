/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";

/**
 * The pause banner with the Cairn logo where core puts its clockwork. Core's `_renderHTML` draws
 * one `<img>` and one caption; the caption is kept and the image is replaced by the wordmark's
 * own markup, inlined so the stylesheet can reach the candle flame on the "i" and make it burn.
 * The figure carries the system class so the stylesheet can reach it without leaving `.cairn2e`.
 *
 * `assets/logo.svg` ships byte-for-byte (`docs/CREDITS.md`): everything below happens to a parsed copy
 * at render time, never to the file. Its `<defs><style>` is dropped because a `<style>` inside an
 * inline SVG applies to the whole document, unlayered — it would outrank the system's own (layered)
 * fill on the flame. The paths are, in file order, C a r n, then the four flame pieces, then the
 * three parts of the "i"; the wordmark is the game's logo and does not change, so the flame is
 * addressed by that position.
 */
export class CairnGamePause extends foundry.applications.ui.GamePause {
  static DEFAULT_OPTIONS = { classes: [SYSTEM_ID] };

  /** The parsed wordmark, fetched once; every render clones it. */
  static #logo;

  /** @override */
  async _renderHTML(context, options) {
    const [, caption] = await super._renderHTML(context, options);
    CairnGamePause.#logo ??= await this.#fetchLogo();
    return [CairnGamePause.#logo.cloneNode(true), caption];
  }

  async #fetchLogo() {
    const response = await foundry.utils.fetchWithTimeout(`systems/${SYSTEM_ID}/assets/logo.svg`);
    const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml").documentElement;
    svg.querySelector("defs")?.remove();
    const flame = document.createElementNS(svg.namespaceURI, "g");
    flame.classList.add("cairn-flame");
    const paths = [...svg.querySelectorAll("path")].slice(4, 8);
    paths[0].before(flame);
    flame.append(...paths);
    return document.importNode(svg, true);
  }
}

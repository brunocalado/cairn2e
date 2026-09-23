/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { paintInk, scheduleInk } from "../ink.js";

/**
 * What every window that draws its rules and frames on a canvas does, in one place: repaint after
 * a render, on a resize of the content box, on a scroll or a `<details>` toggle inside a part, and
 * on a tab change; save a ProseMirror editor when it loses focus; stop observing on close.
 *
 * Per-part listeners are bound in `_attachPartListeners`, which core's `_replaceHTML` calls once
 * for each part it actually rendered, with the element it just created. These windows re-render
 * PARTS — an item change re-renders five of the character sheet's, and the creator re-renders
 * `name` alone on Roll Name — and a part that was not re-rendered keeps its element. Binding over
 * `this.element` in `_onRender` put one more listener on every surviving part per render; bound
 * here, a listener can only ever be on the element that was just made.
 *
 * A `root: true` part (the faction and route VIEW faces) has its children moved into the content
 * before this hook sees it, so nothing inside one is bound here. Neither view face holds a
 * scroller or an editor.
 *
 * Apply it OUTERMOST, over `CairnSheetMixin` where a class has both:
 *
 *     class CairnItemSheet extends CairnInkMixin(CairnSheetMixin(HandlebarsApplicationMixin(ItemSheetV2))) {}
 *
 * @param {typeof foundry.applications.api.ApplicationV2} Base
 */
export const CairnInkMixin = (Base) => class extends Base {
  /** Selectors, inside a part, whose scroll moves drawn marks. A part root that matches counts. */
  static INK_SCROLLERS = [".tab"];

  /**
   * One per instance. A window whose height is its content's (`position.height: "auto"`) settles
   * a frame or two after the render that changed it, and again on a tab swap with no render at
   * all; a mark measured before the box grew is drawn short, so the box itself is watched. It
   * cannot feed back: the canvases are absolutely positioned and out of flow, so sizing them never
   * changes what is observed. Disconnected on close: a reopen is a first render again, with a new
   * content box, and a guard that still held the old observer would never watch it.
   * @type {ResizeObserver|null}
   */
  #inkResize = null;

  /** The box the ink layer draws in. Null for a page sheet's view face, which has no frame. */
  #inkHost() {
    return this.element?.querySelector(".window-content") ?? null;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const host = this.#inkHost();
    if (!host) return;
    scheduleInk(host);
    if (!this.#inkResize) {
      this.#inkResize = new ResizeObserver(() => paintInk(host));
      this.#inkResize.observe(host);
    }
  }

  /** @override */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    const repaint = () => paintInk(this.#inkHost());
    const scrollers = this.constructor.INK_SCROLLERS;
    if (scrollers.length) {
      const selector = scrollers.join(",");
      const targets = htmlElement.matches(selector) ? [htmlElement] : [];
      targets.push(...htmlElement.querySelectorAll(selector));
      for (const target of targets) {
        target.addEventListener("scroll", repaint, { passive: true });
        // Unfolding a `<details>` moves every row under it without resizing the content box, so
        // neither a render nor the observer hears it. `toggle` does not bubble: capture phase.
        target.addEventListener("toggle", repaint, true);
      }
    }
    // An editor here is always active and its toolbar — where core puts the save button — is
    // hidden, so leaving the field is what commits it. `save()` writes the serialized HTML back
    // onto the element and fires `change`, which is what `submitOnChange` listens for; it is a
    // no-op when nothing was typed.
    for (const editor of htmlElement.querySelectorAll("prose-mirror")) {
      editor.addEventListener("focusout", () => editor.save());
    }
  }

  /**
   * @override — a tab switch only toggles classes (`api/application.mjs` `changeTab`), so no
   * render follows and the panel that just became visible was measured while hidden.
   */
  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    scheduleInk(this.#inkHost());
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#inkResize?.disconnect();
    this.#inkResize = null;
  }
};

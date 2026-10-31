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
 * on a tab change; open a rich-text editor from its text or a drag, and save and close it when it
 * is left (`bindEditor`); stop observing on close.
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
    for (const editor of htmlElement.querySelectorAll("prose-mirror[toggled]")) bindEditor(editor);
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

/**
 * A toggled editor with no pencil: closed, it is the enriched text, so a link in it is a button
 * that opens its document; a click on the text opens it, a drag entering it opens it, and leaving
 * it saves and closes it. Toggled rather than always open because an open editor shows a dropped
 * document as its raw `@UUID[…]{Name}` text, and core draws it as a link only while closed.
 *
 * - The click places the caret where it landed only when the raw text reads the same as the
 *   enriched one. A link's raw form is longer, so coordinates taken on the enriched text would put
 *   the caret inside its `@UUID[…]`, and what was typed would go into the id. Otherwise the caret
 *   goes to the end. A click on a link, an inline roll or a chip that acts does what it does and
 *   leaves the box closed.
 * - `open` is heard on the element itself: core dispatches it as a plain `new Event("open")` and
 *   hands `{ bubbles: true }` to `dispatchEvent`, which ignores it, so it never bubbles.
 * - A drag entering the box opens it so core's ProseMirror drop plugin writes the link at the drop
 *   point and stops the drop there; on a closed box the sheet's own drop handler took it (an NPC
 *   gained the item instead). A drag that only crosses the box closes it again on the way out,
 *   and one that starts inside it (a link dragged out) never opens it.
 * - The toolbar, where core puts the save button, is hidden, so leaving the box is what commits
 *   it. `save()` fires `change`, which `submitOnChange` listens for, and closes the editor; the
 *   sheet then rebuilds the part, because a closed editor's enriched view is a private copy core
 *   set once and never refreshes (`_sheet-mixin.js#staleEditorParts`).
 * - Activation is async (`#activateEditor` awaits the document), and `save()` before it finishes
 *   throws on the editor it has not built yet. So a save asked for in that window waits for
 *   `open`, and anything else only saves once the element carries `active`.
 * - `save()` is never re-entered. It destroys the ProseMirror view, and when the view still holds
 *   focus — a drag leaving the box it opened — that fires `focusout` synchronously, inside the
 *   save; a second `save()` from there closed the editor under the first, which then threw on the
 *   destroyed view and left the box empty (measured 14.369).
 * @param {HTMLElement} editor  A `<prose-mirror toggled>`.
 */
function bindEditor(editor) {
  let clickAt = null;
  let dragFromInside = false;
  let openedByDrag = false;
  let closeOnOpen = false;
  let closing = false;
  const active = () => editor.classList.contains("active");
  const close = () => {
    if (closing || !active()) return;
    closing = true;
    try { editor.save(); }
    finally { closing = false; }
  };

  editor.addEventListener("click", (event) => {
    if (editor.open || event.target.closest("a, button, [role=\"button\"]")) return;
    const raw = document.createElement("template");
    raw.innerHTML = editor.value;
    const shown = editor.querySelector(".editor-content")?.textContent;
    clickAt = raw.content.textContent === shown ? { x: event.clientX, y: event.clientY } : null;
    editor.open = true;
  });

  editor.addEventListener("open", () => {
    if (closeOnOpen) {
      closeOnOpen = false;
      close();
      return;
    }
    editor.focus();
    const selection = document.getSelection();
    const at = clickAt && document.caretPositionFromPoint(clickAt.x, clickAt.y);
    clickAt = null;
    if (at && editor.contains(at.offsetNode)) selection.collapse(at.offsetNode, at.offset);
    else {
      const range = document.createRange();
      range.selectNodeContents(editor.querySelector(".ProseMirror"));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });

  // Focus moving between the editor's own parts is not leaving it.
  editor.addEventListener("focusout", (event) => {
    if (!editor.contains(event.relatedTarget)) close();
  });

  editor.addEventListener("dragstart", () => { dragFromInside = true; });
  editor.addEventListener("dragend", () => { dragFromInside = false; });
  editor.addEventListener("dragenter", () => {
    if (dragFromInside) return;
    if (editor.open) {
      // Back in before the activation the drag started has finished: keep it open after all.
      if (closeOnOpen) [closeOnOpen, openedByDrag] = [false, true];
      return;
    }
    openedByDrag = true;
    editor.open = true;
  });
  editor.addEventListener("dragleave", (event) => {
    if (!openedByDrag || editor.contains(event.relatedTarget)) return;
    openedByDrag = false;
    if (active()) close();
    else if (editor.open) closeOnOpen = true;
  });
  editor.addEventListener("drop", () => {
    openedByDrag = false;
    closeOnOpen = false;
  });
}

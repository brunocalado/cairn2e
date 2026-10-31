/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * What the system's windows share: the mixin every document sheet is built on, the two editor
 * helpers its render rules use, and the frame code every window uses, sheet or not
 * (`addFrameLabel`), which is a free function for that reason.
 */

/**
 * The editor parts a document change has left showing an old value.
 *
 * A sheet keeps its ProseMirror parts out of an ordinary redraw: rebuilding one costs the user
 * its scroll position and selection. But a write from elsewhere — a macro, a second Warden, a
 * re-roll — left the sheet showing the old text, which the next edit then wrote back over the new.
 * So a part is stale when the change touched its field and nobody is typing in it (an editor with
 * focus keeps the user's text), and then one of three: its editor is closed, because a closed
 * toggled editor shows the enriched text it was built with and core never refreshes that copy, not
 * even after its own save; or there is no editor in it (a reader's enriched text); or the open
 * editor holds something else.
 * @param {foundry.applications.api.DocumentSheetV2} sheet
 * @param {object|undefined} renderData  The change, as core hands it to the render.
 * @param {Record<string, string>} editors  Field path → the id of the part that draws it.
 * @returns {string[]}  Part ids to rebuild.
 */
export function staleEditorParts(sheet, renderData, editors) {
  const stale = [];
  for (const [field, part] of Object.entries(editors)) {
    if (!foundry.utils.hasProperty(renderData ?? {}, field)) continue;
    const element = sheet.element?.querySelector(`[data-application-part="${part}"]`);
    if (!element) continue;
    const editor = element.querySelector(`prose-mirror[name="${field}"]`);
    if (editor?.matches(":focus-within")) continue;
    if (editor?.open && editor.value === foundry.utils.getProperty(sheet.document, field)) continue;
    stale.push(part);
  }
  return stale;
}

/**
 * The parts an update rebuilds when every field it touched is an editor's, or null when it touched
 * anything else. Without it, a description save rebuilds every part of the sheet: the actor sheet's
 * `partsForRenderContext` has no answer for an editor field and lets every part through.
 * @param {foundry.applications.api.DocumentSheetV2} sheet
 * @param {object|undefined} renderData  The change, as core hands it to the render.
 * @returns {string[]|null}  Part ids, or null when the change is not an editor's alone.
 */
export function editorOnlyParts(sheet, renderData) {
  const editors = sheet.constructor.EDITOR_FIELDS;
  const keys = Object.keys(foundry.utils.flattenObject(renderData ?? {})).filter((k) => !k.startsWith("_"));
  if (!keys.length || !keys.every((k) => k in editors)) return null;
  return staleEditorParts(sheet, renderData, editors);
}

/**
 * The editor parts a document change must leave alone: drawn on screen, and not left stale by an
 * outside write.
 *
 * One with no element on screen has nothing to keep, and leaving it out means it is never built
 * at all. An item's Recharge tab exists only while `magic` is `relic`, and that transition IS a
 * document update — so without this test the one render that would have created the part is the
 * one that drops it, leaving a tab in the rail pointing at nothing until the sheet is reopened.
 *
 * The test is the DOM and not `sheet.parts`, which is core's record of every part it has ever
 * rendered (`api/handlebars-application.mjs`) and keeps a detached element for one the sheet has
 * since pruned in `_onRender` — so a relic turned back into a spellbook and into a relic again
 * would be filtered out on that second pass and never rebuilt.
 * @param {foundry.applications.api.DocumentSheetV2} sheet
 * @param {object|undefined} renderData  The change, as core hands it to the render.
 * @returns {string[]}  Part ids.
 */
export function keptEditorParts(sheet, renderData) {
  const editors = sheet.constructor.EDITOR_FIELDS;
  const onScreen = new Set([...(sheet.element?.querySelectorAll("[data-application-part]") ?? [])]
    .map((part) => part.dataset.applicationPart));
  const stale = staleEditorParts(sheet, renderData, editors);
  return Object.values(editors).filter((id) => onScreen.has(id) && !stale.includes(id));
}

/**
 * What every document sheet in this system does, in one place.
 *
 * It is a mixin rather than a base class because the sheets do not share an ancestor: an actor
 * sheet extends `ActorSheetV2` and an item sheet extends `ItemSheetV2`, and both of those are
 * already wrapped in `HandlebarsApplicationMixin`. A mixin composes over whichever of them a
 * sheet is built on, and a sheet added later opts in by naming it — which is the point: this is
 * where the next thing every sheet has to do goes, instead of being copied into each class.
 *
 * Apply it OUTERMOST, so what it defines wins over the class it wraps:
 *
 *     class CairnItemSheet extends CairnSheetMixin(HandlebarsApplicationMixin(ItemSheetV2)) {}
 *
 * A sheet that wants something else still overrides it in its own class — a subclass's member
 * beats the mixin's, which is how `CairnCharacterEdit` keeps titling itself "Edit: <name>".
 * @param {typeof foundry.applications.api.DocumentSheetV2} Base
 */
export const CairnSheetMixin = (Base) => class extends Base {
  /**
   * Document paths whose only display on the sheet is inside a ProseMirror editor, each with the
   * part that draws it. An update that touches nothing else must not rebuild the sheet around it —
   * only a part left showing an old value is rebuilt (`staleEditorParts`), which includes the part
   * of an editor that has just saved and closed. Each sheet that has one lists its own.
   * @type {Record<string, string>}
   */
  static EDITOR_FIELDS = {};

  /** @override — skip a render that cannot change anything the sheet draws. Same shape as core's
   *  own `DocumentDirectory#_canRender` (`sidebar/document-directory.mjs:188`). */
  _canRender(options) {
    const { renderContext, renderData } = options;
    if (renderContext === `update${this.document.documentName}` && renderData) {
      const editors = this.constructor.EDITOR_FIELDS;
      const touched = Object.keys(foundry.utils.flattenObject(renderData))
        .filter((k) => !k.startsWith("_") && !(k in editors));
      if (!touched.length && !staleEditorParts(this, renderData, editors).length) return false;
    }
    return super._canRender(options);
  }

  /**
   * @override — the window says the document's NAME and nothing else.
   *
   * `DocumentSheetV2` builds `"<type label>: <name>"` (`api/document-sheet.mjs:99-103`), so an
   * actor called Thorn opens a window titled "Player Character: Thorn". The prefix is the one
   * thing on the title bar the reader already knows: they opened this sheet from that actor, the
   * sheet's own header carries the portrait and the name again, and at a table with four
   * characters open the part that tells them apart is pushed right by a word they cannot use.
   *
   * There is nothing to keep in step on a rename: core re-reads this getter whenever a render
   * carries a changed `name` (`api/document-sheet.mjs:163-166`), and the pop-out window takes
   * its browser title from the same place (`api/application.mjs:1409`).
   *
   * The fallback is core's own string, not an empty bar: a document created without a name has
   * no name to show, and "Gear: 7ZqA…" at least says what the window is.
   * @type {string}
   */
  get title() {
    return this.document?.name || super.title;
  }
};

/**
 * A labelled button in the title bar, LEFT of the ellipsis.
 *
 * Not a frame button: core inserts those to the right of the ellipsis, icon-only, with the word
 * in an `aria-label` nobody sees (`_renderFrameButtons` → before the ✕). This one shows the word,
 * slotted before core's own controls toggle. Any `[data-action]` inside the application element
 * dispatches through the window's `actions`, so it needs no listener of its own.
 * @param {HTMLElement} frame  What `_renderFrame` returned.
 * @param {{ action: string, label: string, tooltip?: string }} button  Label and tooltip localized.
 */
export function addFrameLabel(frame, { action, label, tooltip }) {
  const button = frame.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "header-control cairn-frame-label";
  button.dataset.action = action;
  if (tooltip) button.dataset.tooltip = tooltip;
  button.textContent = label;
  frame.querySelector('button[data-action="toggleControls"]').insertAdjacentElement("beforebegin", button);
}

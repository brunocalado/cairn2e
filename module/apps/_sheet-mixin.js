/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

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

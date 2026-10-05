/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { outcomeLabel } from "../scars.js";
import { movedMaximum } from "../gains.js";
import { CairnItemSheet, removeAt, rowIndex } from "./item-sheet.js";
import { bindGrantZones, dropGrant, grantDrag, grantRows, onGrantOpen, onGrantRemove } from "./_item-grants.js";

/** The sheet of a growth: its milestones, what it grants, and the maximum it moved. */
export class CairnGrowthSheet extends CairnItemSheet {
  static DEFAULT_OPTIONS = {
    // A growth's Description tab holds two text boxes, the story and what was gained, and two in
    // 340px leave each under a paragraph tall.
    position: { height: 480 },
    actions: {
      milestoneAdd: CairnGrowthSheet.#onMilestoneAdd,
      milestoneRemove: CairnGrowthSheet.#onMilestoneRemove,
      // The gear sheet maps the same two, and core calls each with the sheet as `this`.
      grantOpen: onGrantOpen,
      grantRemove: onGrantRemove
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    // A growth prints the maximum it moved on its Description tab, the same printout as a scar's
    // Details, and it reuses the scar's two maximum labels: they name a resource on the ACTOR, not
    // a property of a scar, and one English string in one place cannot drift from itself.
    const { from, to } = item.system.outcome;
    context.growth = {
      hasOutcome: movedMaximum(item.system),
      outcomeLabel: outcomeLabel(item.system.outcome),
      from,
      to
    };
    context.grants = await grantRows(item);
    return context;
  }

  /** Append an empty, unticked milestone. Blank on purpose — the row IS the prompt to type one. */
  static async #onMilestoneAdd() {
    if (!this.isEditable) return;
    const list = [...this.document.system.milestones, { text: "", done: false }];
    await this.document.update({ "system.milestones": list });
  }

  static async #onMilestoneRemove(event, target) {
    if (!this.isEditable) return;
    await removeAt(this.document, "system.milestones", rowIndex(target));
  }

  /** @override — a Grants row carries the document it names (`_item-grants.js#grantDrag`). */
  async _onDragStart(event) {
    if (grantDrag(this, event)) return;
    return super._onDragStart(event);
  }

  /** @override — a drop on the Grants zone links the document. */
  async _onDropDocument(event, document) {
    if (event.target.closest?.(".cairn-grants-drop")) return dropGrant(this, document);
    return super._onDropDocument(event, document);
  }

  /** @override */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    bindGrantZones(htmlElement);
  }
}

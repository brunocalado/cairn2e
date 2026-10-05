/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { outcomeLabel } from "../scars.js";
import { CairnItemSheet } from "./item-sheet.js";

/** The sheet of a scar, whose Details tab is a printout of what it did. */
export class CairnScarSheet extends CairnItemSheet {
  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    // A scar's Details is a printout of `system.outcome`. The label of the row it changed is
    // built here rather than in the template: "hp" is the character's Hit Protection maximum and
    // the other three are attribute keys that are their own words.
    const { attr, from, to } = item.system.outcome;
    context.scar = {
      entry: item.system.entry,
      hasOutcome: item.system.resolved && !!attr,
      outcomeLabel: outcomeLabel(item.system.outcome),
      from,
      to,
      stateLabel: item.system.resolved ? "CAIRN.Scar.Resolved" : "CAIRN.Scar.Pending"
    };
    return context;
  }
}

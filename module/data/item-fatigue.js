/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { containerField } from "./_fields.js";

const fields = foundry.data.fields;

/**
 * Fatigue is a real item type, not a named `gear` entry.
 *
 * Upstream identified Fatigue by `item.name === game.i18n.localize("CAIRN.Fatigue")` — rename the
 * string and the game breaks silently. Now every check is `item.type === "fatigue"`.
 *
 * Rules (`srd-2e/players-guide/core-rules.md`): each Fatigue occupies exactly one slot, never
 * *petty*, never *bulky*, cannot be equipped. It lasts until the PC recuperates.
 * The shape carries a description and the container pointer every carried item has; everything
 * else is fixed by the rules and enforced by the slot maths in the document.
 */
export class FatigueData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Fatigue"];

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true }),
      // "Each PC starts with a Backpack that can hold up to six slots of items or Fatigue"
      // (`srd-2e/players-guide/character-creation.md`) — so a Fatigue can sit in a container,
      // and carries the same pointer every other item does.
      container: containerField()
    };
  }
}

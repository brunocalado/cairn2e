/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

const fields = foundry.data.fields;

/**
 * Fatigue is a real item type, not a named `gear` entry.
 *
 * Upstream identified Fatigue by `item.name === game.i18n.localize("CAIRN.Fatigue")` — rename the
 * string and the game breaks silently. Now every check is `item.type === "fatigue"`.
 *
 * Rules (`srd-2e/players-guide/core-rules.md`): each Fatigue occupies exactly one slot, never
 * *petty*, never *bulky*, cannot be equipped. It lasts until the PC recuperates.
 * The shape is a description and nothing else; everything else is fixed by the rules and enforced
 * by the slot maths in the document.
 *
 * It has no `container` pointer: a Fatigue is always one of the ten slots, never in a mule or a
 * sack. "A Backpack that can hold up to six slots of items or Fatigue"
 * (`character-creation.md` § Inventory) is how a PC carries the ten, not a container — Cairn's
 * author, asked directly (2026-09-27). `data/_derived.js#nestingRefusal` refuses the move too.
 */
export class FatigueData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Fatigue"];

  static defineSchema() {
    return {
      description: new fields.HTMLField({ required: true, blank: true })
    };
  }
}

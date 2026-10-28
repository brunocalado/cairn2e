/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { TABLES } from "./constants.js";

/**
 * Who in a party is owed an Omen, with no Foundry in it, so `checks/omens.check.mjs` runs it under
 * Node. `omens.js` reads the party into this shape and does the drawing.
 *
 * "If you are the youngest character, roll on the Omens table. The result should be read aloud to
 * the other players" (`srd-2e/players-guide/character-creation.md`). Youngest of the party, so it
 * is answered once every character is made — and two Backgrounds draw an Omen of their own, kept
 * private: the Foundling's, "even if you're not the youngest player", and the Mountebank's False
 * Prophet. Those are growths granted with the starting gear, left owed until the party draws them.
 *
 * - `youngest` is empty once anyone holds an Omen: an announced Omen never moves, so a character
 *   who joins later and turns out younger takes nothing, and a second draw hands out nothing.
 *   A drawn face counts even with the switch off: the switch is the Warden's to take a resolved
 *   Omen off the sheet, and switching it off does not undo the announcement.
 *   Otherwise it is every character tied at the lowest age; one with no age rolled (0) is left out.
 * - `growths` is every Omens-table growth not yet drawn.
 * - `taken` is every face already held — by an Omen still switched on, or a growth — so the draw
 *   deals nobody a face somebody in the party has.
 *
 * @param {{ id: string, age: number, omen: { enabled: boolean, result: string },
 *           growths: { id: string, table: string, drawn: string, resolved: boolean }[] }[]} characters
 *   the party's characters, never its hirelings or mules
 * @returns {{ youngest: string[], growths: { actor: string, growth: string }[], taken: Set<string> }}
 */
export function omensOwed(characters) {
  const taken = new Set();
  const growths = [];
  for (const c of characters) {
    if (c.omen.enabled && c.omen.result) taken.add(c.omen.result);
    for (const g of c.growths) {
      if (g.drawn) taken.add(g.drawn);
      if (g.table === TABLES.OMENS && !g.resolved) growths.push({ actor: c.id, growth: g.id });
    }
  }

  const aged = characters.filter((c) => c.age > 0);
  const lowest = Math.min(...aged.map((c) => c.age));
  const youngest = characters.some((c) => c.omen.enabled || c.omen.result)
    ? []
    : aged.filter((c) => c.age === lowest).map((c) => c.id);
  return { youngest, growths, taken };
}

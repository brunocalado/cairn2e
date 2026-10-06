/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { packUuid } from "./constants.js";

/**
 * What the Warden's Treasure window offers, with no Foundry in it — `checks/treasure.check.mjs`
 * runs these under Node.
 *
 * The SRD has no treasure table: a Treasure "is specific to the environment from where it is
 * recovered" (`overview-and-principles.md` § Treasure). So the window is a Warden's aid and not a
 * rule, and its defaults invent nothing. They are the folders the system's packs are already filed
 * in by price — the Valuables bands, the relics, scrolls and spellbooks by what they cost — and
 * the Warden adds a table or a folder of their own by dropping it on the window.
 */

/** The most draws one source makes per Roll. Ten of anything is a hoard; past it, roll again. */
export const MAX_COUNT = 10;

/**
 * A source is a RollTable, an Item folder (subfolders included), or coin by formula.
 * `on` and `count` are the Warden's last choice and are kept, so the window reopens as it was left.
 * Labels are NOT stored: the window reads the document's name when it draws, so a renamed or
 * translated table shows its new name.
 * @typedef {{ id: string, kind: "table"|"folder", uuid: string, on: boolean, count: number }
 *          | { id: "coin", kind: "coin", formula: string, on: boolean, count: number }} TreasureSource
 */

/** @returns {TreasureSource[]} */
export function defaultTreasureSources() {
  const folder = (id, pack, folderId) => ({ id, kind: "folder", uuid: packUuid(pack, "Folder", folderId), on: false, count: 1 });
  return [
    // A table's choice, not the SRD's: 30 to 180 gp, so a roll often crosses the line where "a
    // bag of coins worth less than 100gp is petty" (`character-creation.md`) and the haul starts
    // to weigh.
    { id: "coin", kind: "coin", formula: "3d6*10", on: false, count: 1 },
    folder("valuables-common", "more-gear", "zp21eCWEd0bf48mP"),       // Common (10gp)
    folder("valuables-ornamental", "more-gear", "Oo11ISGG2Z4h2h8D"),   // Ornamental (25gp)
    folder("valuables-semiprecious", "more-gear", "Qai89dBcno9Coube"), // Semiprecious (100gp)
    folder("valuables-precious", "more-gear", "HJvY3JTRuL5xJNFj"),     // Precious (500gp)
    folder("relics-150", "relics", "GrRVMrn19Cm4uCtB"),
    folder("relics-300", "relics", "UlnseD8X1WIqJdUA"),
    folder("relics-600", "relics", "Pos0prP8w9WLaBgG"),
    folder("scrolls-common", "scrolls", "HeofFbO6OthG77Yu"),
    folder("scrolls-greater", "scrolls", "cY8dColvFmUwDJFw"),
    folder("spellbooks-common", "spellbooks", "OFCsBBsWPJ18tVWP"),
    folder("spellbooks-greater", "spellbooks", "CUFHa1lIQAt4nRUN")
  ];
}

/** The list with `source` at its end — unless a source with the same uuid, or id, is already there. */
export function withSource(list, source) {
  if (list.some((s) => s.id === source.id || (source.uuid && s.uuid === source.uuid))) return list;
  return [...list, source];
}

export function withoutSource(list, id) {
  return list.filter((s) => s.id !== id);
}

/** One source's choices written back. `count` is a whole number from 1 to {@link MAX_COUNT}. */
export function withSourceSettings(list, id, { on, count, formula } = {}) {
  return list.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s };
    if (on !== undefined) next.on = !!on;
    if (count !== undefined) next.count = Math.min(MAX_COUNT, Math.max(1, Math.trunc(Number(count)) || 1));
    if (formula !== undefined && s.kind === "coin") next.formula = String(formula).trim();
    return next;
  });
}

/** What a Roll draws: the ticked sources, in the list's order, each carrying its own `count`. */
export function drawPlan(list) {
  return list.filter((s) => s.on && s.count >= 1);
}

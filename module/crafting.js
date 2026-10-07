/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, packUuid } from "./constants.js";

/** Grid Crafter: an optional module that forges items from ingredients laid on a 3×3 grid. */
const MODULE = "grid-crafter";

const material = (id) => packUuid("materials", "Item", id);
const gear = (id) => packUuid("gear", "Item", id);
const weapon = (id) => packUuid("weapons", "Item", id);
const armor = (id) => packUuid("armor", "Item", id);

// Every material id is id16("cairn2e:material:<slug>"), as the pack derives it.
const IRON = material("LR5yGUvpe1DllgXT");     // Iron Ingot
const STEEL = material("N9KmYAOZMNQ5ddSe");    // Steel Ingot
const PLATE = material("x5XamCV1i3lbU4GS");    // Steel Plate
const NAILS = material("sdlljXZJsG0XDPai");    // Nails
const STICK = material("yBZHeqyV5CbuMJYv");    // Stick
const PLANK = material("8QljGICu9OT9Khym");    // Plank
const STONE = material("agcb3KV9VY4LxjuU");    // Stone
const HIDE = material("4OV0LEtVN8b8oVKx");     // Hide
const LEATHER = material("hg0aNqsFLKvtFVqS");  // Leather
const STRIP = material("lYFTNbfPIlf8ba44");    // Leather Strip
const BONE = material("BiqB4ygPYUZGMLkl");     // Bone
const CLOTH = material("JaJx5zyAPRdmz9Wj");    // Cloth
const THREAD = material("eXms8M5FCH5zalA0");   // Thread
const SALT = material("QYWDgXZrcx7Bk2LP");     // Salt
const CHAIN = gear("OTCJHK1d9Rk6QIfR");        // Chain
const GAMBESON = armor("wdc9nLqwIN0iNkFj");    // Gambeson

const _ = null;

/**
 * Homebrew: 2e has no crafting rules, though it names the act — "given proper ingredients"
 * (procedures.md § Training), "given time and adequate materials" (kettlewright.md). Every recipe
 * makes something for less than it costs to buy, holds at most five ingredients — each a whole item,
 * a slot apiece — and never spends an item with more than one use, because Grid Crafter spends a
 * whole item per cell. A shaped grid matches anywhere on the board and mirrored left to right, so
 * no two recipes may share a cropped shape (`checks/crafting.check.mjs`). `id` is what a player's
 * recipe book remembers the recipe by: never rename one.
 *
 * The stone and bone variants make the Marketplace's own Axe, Spear and Dagger from found things — a
 * stone axe is still a d8 Axe.
 */
export const RECIPES = [
  // Intermediates: what the other recipes are made of.
  { id: "steel-ingot", result: STEEL,
    cells: [[_, IRON, _],
            [_, IRON, _],
            [_, _, _]] },
  { id: "steel-plate", result: PLATE, quantity: 2,
    cells: [[STEEL, _, _], [_, _, _], [_, _, _]] },
  { id: "nails", result: NAILS, quantity: 5,
    cells: [[IRON, _, _], [_, _, _], [_, _, _]] },
  { id: "leather", result: LEATHER, shaped: false,
    cells: [HIDE, SALT, _, _, _, _, _, _, _] },
  { id: "leather-strip", result: STRIP, quantity: 4,
    cells: [[LEATHER, _, _], [_, _, _], [_, _, _]] },

  // Weapons, cheapest first, as the Weaponsmith shelves them.
  { id: "cudgel", result: weapon("1QVV6Hd59hT1x4h1"),
    cells: [[_, PLANK, _],
            [_, STRIP, _],
            [_, _, _]] },
  { id: "dagger", result: weapon("a7ny2xCcpEwZTDuM"),
    cells: [[_, IRON, _],
            [_, STICK, _],
            [_, _, _]] },
  { id: "dagger-bone", result: weapon("a7ny2xCcpEwZTDuM"),
    cells: [[_, BONE, _],
            [_, STRIP, _],
            [_, _, _]] },
  { id: "sickle", result: weapon("hEOii1unpB3UBy5L"),
    cells: [[IRON, IRON, _],
            [_, STICK, _],
            [_, _, _]] },
  { id: "sling", result: weapon("xEjdizfTpn66xhpK"),
    cells: [[STRIP, CLOTH, STRIP],
            [_, _, _],
            [_, _, _]] },
  { id: "staff", result: weapon("FR6w8pHdVrJYdftU"),
    cells: [[_, STICK, _],
            [_, STICK, _],
            [_, STICK, _]] },
  { id: "axe", result: weapon("1aObADSCj3jIkUPw"),
    cells: [[IRON, IRON, _],
            [_, STICK, _],
            [_, STICK, _]] },
  { id: "axe-stone", result: weapon("1aObADSCj3jIkUPw"),
    cells: [[STONE, STONE, _],
            [_, STRIP, _],
            [_, STICK, _]] },
  { id: "flail", result: weapon("7uFzZkd7iZC32dKu"),
    cells: [[STICK, _, _],
            [_, IRON, _],
            [_, IRON, IRON]] },
  { id: "mace", result: weapon("7UPpQmxPZ5LgNQWN"),
    cells: [[NAILS, IRON, NAILS],
            [_, STICK, _],
            [_, STICK, _]] },
  { id: "spear", result: weapon("hHDraN8apA23UPS9"),
    cells: [[_, IRON, _],
            [_, STICK, _],
            [_, STICK, _]] },
  { id: "spear-stone", result: weapon("hHDraN8apA23UPS9"),
    cells: [[_, STONE, _],
            [STRIP, STICK, _],
            [_, STICK, _]] },
  { id: "sword", result: weapon("FgArC8sR078bwJEr"),
    cells: [[_, STEEL, _],
            [_, STEEL, _],
            [_, STRIP, _]] },
  { id: "bow", result: weapon("xNFvJV971IDEj7zZ"),
    cells: [[STICK, THREAD, _],
            [STICK, _, _],
            [STICK, THREAD, _]] },
  { id: "halberd", result: weapon("PqnBufW2R8SfCcog"),
    cells: [[STEEL, STICK, _],
            [STEEL, STICK, _],
            [_, STICK, _]] },
  { id: "long-sword", result: weapon("WwEEaLMmjSyap9kH"),
    cells: [[_, STEEL, _],
            [_, STEEL, _],
            [IRON, STEEL, STRIP]] },
  { id: "war-hammer", result: weapon("2RgcMeClMBxWr0ip"),
    cells: [[STEEL, STEEL, STEEL],
            [_, STICK, _],
            [_, STICK, _]] },
  { id: "crossbow", result: weapon("qLSAVP83onsMvq0d"),
    cells: [[THREAD, IRON, THREAD],
            [_, PLANK, _],
            [_, PLANK, _]] },

  // Armour, as the Armorer shelves it.
  { id: "helmet", result: armor("HgY89TClg3swr6Mx"),
    cells: [[PLATE, PLATE, _],
            [STRIP, _, _],
            [_, _, _]] },
  { id: "shield", result: armor("ImIULTvK8p5ZoWUC"),
    cells: [[_, PLANK, _],
            [PLANK, IRON, PLANK],
            [_, _, _]] },
  { id: "gambeson", result: GAMBESON,
    cells: [[CLOTH, THREAD, CLOTH],
            [_, CLOTH, _],
            [_, _, _]] },
  { id: "brigandine", result: armor("WvHpP6L5AyMd6oO7"),
    cells: [[LEATHER, NAILS, LEATHER],
            [PLATE, _, PLATE],
            [_, _, _]] },
  { id: "chainmail", result: armor("vYkrBTEXzHrxUzSk"),
    cells: [[CHAIN, GAMBESON, CHAIN],
            [_, _, _],
            [_, _, _]] },
  { id: "plate", result: armor("HFI9vH2O90lK0XwE"),
    cells: [[_, PLATE, _],
            [PLATE, GAMBESON, PLATE],
            [_, PLATE, _]] }
];

/**
 * Register the recipes when Grid Crafter is ready; the hook never fires without the module, so
 * nothing here runs in a world that does not use it. Every client registers, because Grid Crafter
 * keeps recipes in memory, not in the world.
 */
export function registerCrafting() {
  Hooks.once(`${MODULE}.ready`, (api) => api.registerRecipes(SYSTEM_ID, RECIPES));
}

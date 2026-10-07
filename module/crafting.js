/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { GEAR, SYSTEM_ID, packUuid } from "./constants.js";

/** Grid Crafter: an optional module that forges items from ingredients laid on a 3×3 grid. */
const MODULE = "grid-crafter";

const material = (id) => packUuid("materials", "Item", id);
const gear = (id) => packUuid("gear", "Item", id);
const moreGear = (id) => packUuid("more-gear", "Item", id);
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
const GLASS = material("5c5J4HtAjGWa2j6C");    // Glass
const HERBS = material("YWkjnNFpBnAP6KEY");    // Herbs
const MUSHROOMS = material("W14ZDOc6ucmSlUN6"); // Mushrooms
const WAX = material("uRm9psesRIQFI465");      // Wax
const BERRIES = material("Wa6Zczi11KDvWqmE");  // Berries
const MEAT = material("SqWNZv1XM3TFGCzy");     // Raw Meat
const FISH = material("cGgAyWkeJ0vEpBjU");     // Raw Fish
const FLOUR = material("83I1A0OjQVBGRAuh");    // Flour
const EGGS = material("YvvcLqcivp6GvByA");     // Eggs
const SALT = material("QYWDgXZrcx7Bk2LP");     // Salt
const CHAIN = gear("OTCJHK1d9Rk6QIfR");        // Chain
const ROPE = GEAR.ROPE;
const HONEY = moreGear("uXeP0joPv5XTEMMx");    // Honey
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
            [_, PLATE, _]] },

  // Gear, as the Marketplace lists it. Alchemy is shapeless, like cooking: a salve has no shape.
  { id: "air-bladder", result: gear("BgBHOBRaOlLJCh31"),
    cells: [[_, HIDE, _],
            [_, THREAD, _],
            [_, _, _]] },
  { id: "antitoxin", result: GEAR.ANTITOXIN, shaped: false,
    cells: [HERBS, HERBS, MUSHROOMS, GLASS, _, _, _, _, _] },
  { id: "bandages", result: gear("F8yysdbnA0y5L4sA"),
    cells: [[CLOTH, HERBS, CLOTH],
            [_, _, _],
            [_, _, _]] },
  { id: "bathing-goods", result: gear("dcg6C3sgIfUklUu7"), shaped: false,
    cells: [WAX, HERBS, _, _, _, _, _, _, _] },
  { id: "book", result: GEAR.BOOK,
    cells: [[_, LEATHER, _],
            [HIDE, HIDE, HIDE],
            [_, THREAD, _]] },
  { id: "caltrops", result: gear("QYy0LFVooHDbjiTV"),
    cells: [[IRON, _, _],
            [_, IRON, _],
            [_, _, _]] },
  { id: "card-deck", result: gear("qjn8EvZyXYZb1eST"),
    cells: [[HIDE, BERRIES, _],
            [_, _, _],
            [_, _, _]] },
  { id: "cart", result: gear("S8va0NhfI1MpGSsu"),
    cells: [[PLANK, PLANK, PLANK],
            [_, PLANK, _],
            [_, IRON, _]] },
  { id: "chain", result: CHAIN,
    cells: [[_, IRON, _],
            [_, IRON, _],
            [_, IRON, _]] },
  { id: "chalk", result: gear("sz3hlSxhxVLBvkKX"),
    cells: [[STONE, _, _], [_, _, _], [_, _, _]] },
  { id: "chest", result: gear("oyCPkncx99bsRO5E"),
    cells: [[_, PLANK, _],
            [PLANK, NAILS, PLANK],
            [_, PLANK, _]] },
  { id: "chisel", result: gear("0zOZuLW1Yw2gr9wT"),
    cells: [[_, STEEL, _],
            [_, STICK, _],
            [_, _, _]] },
  { id: "common-agents", result: gear("LJuSzL3jPRwPcvAL"), shaped: false,
    cells: [HERBS, WAX, MEAT, _, _, _, _, _, _] },
  { id: "common-tools", result: gear("QDL96czD5DIDWr79"),
    cells: [[IRON, _, IRON],
            [STICK, _, STICK],
            [_, _, _]] },
  { id: "containers", result: gear("MLu8HRRZKwQjdGBU"),
    cells: [[LEATHER, THREAD, LEATHER],
            [_, _, _],
            [_, _, _]] },
  { id: "cooking-gear", result: gear("5eQEA0pByDrzJ06P"),
    cells: [[IRON, _, IRON],
            [_, IRON, _],
            [_, _, _]] },
  { id: "costume-gear", result: gear("7Wnavu7ZBS1W8hbB"),
    cells: [[CLOTH, WAX, CLOTH],
            [_, BERRIES, _],
            [_, _, _]] },
  { id: "dowsing-rod", result: gear("oRPrPL68rhEdLYxk"),
    cells: [[STICK, _, STICK],
            [_, STICK, _],
            [_, _, _]] },
  { id: "expeditionary-gear", result: gear("5yJLuqVex4HpsIhJ"),
    cells: [[IRON, ROPE, IRON],
            [_, _, _],
            [_, _, _]] },
  { id: "fire-oil", result: gear("vwTBmANkGI22L7n2"),
    cells: [[_, CLOTH, _],
            [_, GLASS, _],
            [_, MEAT, _]] },
  { id: "fishing-rod", result: gear("LpppO7mC1EgIRTXv"),
    cells: [[STICK, _, _],
            [_, STICK, THREAD],
            [_, _, NAILS]] },
  { id: "games", result: gear("sIS4sBDYuDjnLPo0"),
    cells: [[BONE, PLANK, BONE],
            [_, _, _],
            [_, _, _]] },
  { id: "gloves", result: gear("kWbQCs7Zt0qwwh8F"),
    cells: [[LEATHER, _, LEATHER],
            [_, THREAD, _],
            [_, _, _]] },
  { id: "grappling-hook", result: gear("3QIHHBWQeDmDJASp"),
    cells: [[IRON, _, IRON],
            [_, IRON, _],
            [_, ROPE, _]] },
  { id: "lantern", result: gear("lAOJ4KhINKHkQFKY"),
    cells: [[_, IRON, _],
            [GLASS, WAX, GLASS],
            [_, IRON, _]] },
  { id: "mirror", result: gear("8AfmfTU2E7oJ994j"),
    cells: [[_, GLASS, _],
            [_, IRON, _],
            [_, _, _]] },
  { id: "net", result: gear("5SZWEE7UyIgdgwSE"),
    cells: [[THREAD, THREAD, _],
            [THREAD, THREAD, _],
            [_, _, _]] },
  { id: "oil-can", result: gear("DEIG5kYj2mhV3hRM"),
    cells: [[_, MEAT, _],
            [_, MEAT, _],
            [_, IRON, _]] },
  { id: "outdoor-comfort", result: gear("Ep7hnDLh5HBoEOZr"),
    cells: [[HIDE, CLOTH, CLOTH],
            [_, _, _],
            [_, _, _]] },
  { id: "parchment", result: gear("7NQNLHQ66u6U31jM"),
    cells: [[HIDE, SALT, HIDE],
            [_, _, _],
            [_, _, _]] },
  { id: "pole", result: gear("C1iwGcA5I86vOI5Z"),
    cells: [[_, PLANK, _],
            [_, PLANK, _],
            [_, _, _]] },
  { id: "repellent", result: GEAR.REPELLENT, shaped: false,
    cells: [HERBS, HERBS, HERBS, _, _, _, _, _, _] },
  { id: "rope", result: ROPE,
    cells: [[_, THREAD, _],
            [_, THREAD, _],
            [_, THREAD, _]] },
  { id: "sedative", result: gear("Pl1vyKGTou4BZeAC"), shaped: false,
    cells: [HERBS, MUSHROOMS, MUSHROOMS, GLASS, _, _, _, _, _] },
  { id: "sewing-kit", result: gear("RFXTI1B6phAqB4hY"),
    cells: [[_, BONE, _],
            [THREAD, LEATHER, THREAD],
            [_, _, _]] },
  { id: "simple-instruments", result: gear("5YhwJSdfOq8wWj9E"),
    cells: [[THREAD, PLANK, THREAD],
            [_, _, _],
            [_, _, _]] },
  { id: "smoking-pipe", result: gear("CVGcWnnLF3qFEF3J"),
    cells: [[STICK, BONE, _],
            [_, _, _],
            [_, _, _]] },
  { id: "specialized-tools", result: gear("TxTE0Kqi1Pemap5K"),
    cells: [[STEEL, STRIP, STEEL],
            [_, _, _],
            [_, _, _]] },
  { id: "spiked-boots", result: gear("x7XzCfvN7U9vRo4N"),
    cells: [[LEATHER, _, LEATHER],
            [NAILS, _, NAILS],
            [_, _, _]] },
  { id: "tent", result: gear("uAtHUVkrUHWlKi5x"),
    cells: [[_, CLOTH, _],
            [CLOTH, STICK, CLOTH],
            [_, ROPE, _]] },
  { id: "thieving-tools", result: GEAR.THIEVING_TOOLS,
    cells: [[STEEL, LEATHER, IRON],
            [_, _, _],
            [_, _, _]] },
  { id: "torch", result: GEAR.TORCH,
    cells: [[_, WAX, _],
            [_, CLOTH, _],
            [_, STICK, _]] },
  { id: "trap", result: GEAR.TRAP,
    cells: [[IRON, NAILS, IRON],
            [_, CHAIN, _],
            [_, _, _]] },
  { id: "whistle", result: gear("LsozBVpc307VB58Y"),
    cells: [[BONE, _, _], [_, _, _], [_, _, _]] },
  { id: "wilderness-clothes", result: gear("tGF9mBAjp5fivlyB"),
    cells: [[_, HIDE, _],
            [_, THREAD, _],
            [_, CLOTH, _]] },

  // Food is shapeless: a stew has no shape. What is cooked is food, which raw meat and fish are not.
  { id: "rations", result: GEAR.RATIONS, shaped: false,
    cells: [MEAT, MEAT, SALT, _, _, _, _, _, _] },
  { id: "smoked-meat", result: moreGear("UYMZMEjqOvH0cVNq"), shaped: false,
    cells: [MEAT, SALT, _, _, _, _, _, _, _] },
  { id: "salted-fish", result: moreGear("FZGY21ESRCyLxI0E"), quantity: 2, shaped: false,
    cells: [FISH, SALT, SALT, _, _, _, _, _, _] },
  { id: "jerked-beef", result: moreGear("va6jaq0RCIQyAang"), shaped: false,
    cells: [MEAT, SALT, HERBS, _, _, _, _, _, _] },
  { id: "jam", result: moreGear("DaIe6h4mA3CMQNuG"), quantity: 2, shaped: false,
    cells: [BERRIES, BERRIES, HONEY, _, _, _, _, _, _] },
  { id: "hunters-stew", result: moreGear("Xi4rwuDAwmrOz8ae"), shaped: false,
    cells: [MEAT, MEAT, HERBS, SALT, _, _, _, _, _] },
  { id: "fish-stew", result: moreGear("B2Bf5ixPnIy1tUt1"), shaped: false,
    cells: [FISH, FISH, HERBS, SALT, _, _, _, _, _] },
  { id: "pemmican", result: moreGear("n6cVjhDIEJa4V8eu"), shaped: false,
    cells: [MEAT, MEAT, BERRIES, SALT, _, _, _, _, _] },
  { id: "mushroom-soup", result: moreGear("qJELvjFtKGhMdEEG"), shaped: false,
    cells: [MUSHROOMS, MUSHROOMS, HERBS, _, _, _, _, _, _] },
  { id: "honey-cakes", result: moreGear("9cXVG6PemCUPDzD2"), shaped: false,
    cells: [FLOUR, EGGS, HONEY, _, _, _, _, _, _] }
];

/**
 * Register the recipes when Grid Crafter is ready; the hook never fires without the module, so
 * nothing here runs in a world that does not use it. Every client registers, because Grid Crafter
 * keeps recipes in memory, not in the world.
 */
export function registerCrafting() {
  Hooks.once(`${MODULE}.ready`, (api) => api.registerRecipes(SYSTEM_ID, RECIPES));
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { GEAR, SYSTEM_ID, packUuid } from "./constants.js";
import { installForgeMacro } from "./world-macros.js";

/** Grid Crafter: an optional module that forges items from ingredients laid on a 3×3 grid. */
const MODULE = "grid-crafter";

const material = (id) => packUuid("materials", "Item", id);
const gear = (id) => packUuid("gear", "Item", id);
const moreGear = (id) => packUuid("more-gear", "Item", id);
const weapon = (id) => packUuid("weapons", "Item", id);
const armor = (id) => packUuid("armor", "Item", id);
const potion = (id) => packUuid("potions", "Item", id);

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
const FEATHER = material("0G3hIrsmGNi4Y2dD");  // Feather
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
const TALLOW = material("cn0bmxAJv4XOVrJd");   // Tallow
const RESIN = material("kpvdmQ2helBdb6py");    // Resin
const REEDS = material("1KOlG5ivhFCLhkqS");    // Reeds
const SINEW = material("OmvXDxrrQMCTWr2A");    // Sinew
const MILK = material("QfYsVtcCaat3wc4h");     // Milk
const FOWL = material("zu4qKYpliSHqKu3G");     // Raw Fowl
const VEG = material("VJDxi8WZpgu7aEIS");      // Vegetables
const TROLL = material("HAq4pfOoxbN0BmCc");    // Troll Tallow
const GARGOYLE = material("io87TFV1OHXBAnZ4"); // Gargoyle Grit
const PIXIE = material("u4nsNVJWqnYoib9O");    // Pixie Scale
const CHAIN = gear("OTCJHK1d9Rk6QIfR");        // Chain
const ROPE = GEAR.ROPE;
const HONEY = moreGear("uXeP0joPv5XTEMMx");    // Honey
const NUTS = moreGear("e57xJZLLUbIofqNi");     // Nuts
const DRIED_FRUIT = moreGear("7C67dwIW4uzc5Zhd"); // Dried Fruit
const GAMBESON = armor("wdc9nLqwIN0iNkFj");    // Gambeson

// The tools a recipe requires: carried, never placed on the grid, never spent.
const SMITHING = moreGear("BlfhkEV97jV7USHZ"); // Smithing Tools
const ALCHEMY = moreGear("6PdKfobixgDpByOk");  // Alchemy Kit
const COOKING = gear("5eQEA0pByDrzJ06P");      // Cooking Gear
const SEWING = gear("RFXTI1B6phAqB4hY");       // Sewing Kit

const _ = null;

/** Files a section's recipes under the category of what they make: the first, which the Recipe Book groups by. */
const filed = (category, recipes) => recipes.map((r) => ({ ...r, categories: [category] }));

/** The trade each tool stands for, as a category. */
const TRADES = new Map([[SMITHING, "Smithing"], [SEWING, "Sewing"], [COOKING, "Cooking"], [ALCHEMY, "Alchemy"]]);

/**
 * Homebrew: 2e has no crafting rules, though it names the act — "given proper ingredients"
 * (procedures.md § Training), "given time and adequate materials" (kettlewright.md). Every recipe
 * makes something for less than it costs to buy, holds at most five ingredients — each a whole item,
 * a slot apiece — and never spends an item with more than one use, because Grid Crafter spends a
 * whole item per cell. A shaped grid matches anywhere on the board, exactly as drawn, and Grid
 * Crafter drops a variant whose grid another recipe already makes, so no two recipes may share one
 * (`checks/crafting.check.mjs`). `id` is what a player's recipe book remembers the recipe by.
 *
 * A thing made more than one way is one recipe with `variants`, at most four, each its own grid and
 * tool. Most give a way without the tool from found or cheap things: the stone axe and spear, the
 * bone dagger and fish-hook, the hide-faced shield, rawhide rope, a fur wrap tied with strips, a
 * sinew bowstring, a reed basket or mat. A stone axe is still a d8 Axe. The Torch has the most: wax,
 * tallow, resin, or a rushlight of reeds.
 *
 * `requires` is a tool the crafter must carry, by one rule per trade: whatever is worked from an
 * ingot or a plate needs Smithing Tools, a brewed vial needs an Alchemy Kit, a dish cooked over the
 * fire needs Cooking Gear, and thread sewn into cloth, leather or hide needs a Sewing Kit. The rest
 * is made bare-handed. No tool is required by its own recipe, so each can be made or bought before
 * it is needed.
 *
 * A recipe is filed under what it makes, then under the trade of every tool its variants require,
 * then under Without Tools when one of them requires none: the list a party in the wild looks at.
 *
 * The durable weapons, armour and gear also break back down into what they were made of (`DISMANTLES`).
 */
export const RECIPES = [
  // Intermediates: what the other recipes are made of.
  ...filed("Materials", [
    { id: "steel-ingot", result: STEEL, requires: SMITHING,
      cells: [[_, IRON, _],
              [_, IRON, _],
              [_, _, _]] },
    { id: "steel-plate", result: PLATE, requires: SMITHING, quantity: 2,
      cells: [[STEEL, _, _], [_, _, _], [_, _, _]] },
    { id: "nails", result: NAILS, requires: SMITHING, quantity: 5,
      cells: [[IRON, _, _], [_, _, _], [_, _, _]] },
    { id: "leather", result: LEATHER, shaped: false, variants: [
      { cells: [HIDE, SALT, _, _, _, _, _, _, _] },
      { cells: [HIDE, HERBS, _, _, _, _, _, _, _] }] },
    { id: "leather-strip", result: STRIP, quantity: 4,
      cells: [[LEATHER, _, _], [_, _, _], [_, _, _]] },
    { id: "tallow", result: TALLOW, requires: COOKING, quantity: 2, shaped: false,
      cells: [MEAT, _, _, _, _, _, _, _, _] }
  ]),

  // Weapons, cheapest first, as the Weaponsmith shelves them.
  ...filed("Weapons", [
    { id: "cudgel", result: weapon("1QVV6Hd59hT1x4h1"),
      cells: [[_, PLANK, _],
              [_, STRIP, _],
              [_, _, _]] },
    { id: "dagger", result: weapon("a7ny2xCcpEwZTDuM"), variants: [
      { requires: SMITHING,
        cells: [[_, IRON, _],
                [_, STICK, _],
                [_, _, _]] },
      { cells: [[_, BONE, _],
                [_, STRIP, _],
                [_, _, _]] }] },
    { id: "sickle", result: weapon("hEOii1unpB3UBy5L"), requires: SMITHING,
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
    { id: "axe", result: weapon("1aObADSCj3jIkUPw"), variants: [
      { requires: SMITHING,
        cells: [[IRON, IRON, _],
                [_, STICK, _],
                [_, STICK, _]] },
      { cells: [[STONE, STONE, _],
                [_, STRIP, _],
                [_, STICK, _]] }] },
    { id: "flail", result: weapon("7uFzZkd7iZC32dKu"), requires: SMITHING,
      cells: [[STICK, _, _],
              [_, IRON, _],
              [_, IRON, IRON]] },
    { id: "mace", result: weapon("7UPpQmxPZ5LgNQWN"), requires: SMITHING,
      cells: [[NAILS, IRON, NAILS],
              [_, STICK, _],
              [_, STICK, _]] },
    { id: "spear", result: weapon("hHDraN8apA23UPS9"), variants: [
      { requires: SMITHING,
        cells: [[_, IRON, _],
                [_, STICK, _],
                [_, STICK, _]] },
      { cells: [[_, STONE, _],
                [STRIP, STICK, _],
                [_, STICK, _]] }] },
    { id: "sword", result: weapon("FgArC8sR078bwJEr"), requires: SMITHING,
      cells: [[_, STEEL, _],
              [_, STEEL, _],
              [_, STRIP, _]] },
    { id: "bow", result: weapon("xNFvJV971IDEj7zZ"), variants: [
      { cells: [[STICK, THREAD, _],
                [STICK, _, _],
                [STICK, THREAD, _]] },
      { cells: [[STICK, SINEW, _],
                [STICK, _, _],
                [STICK, SINEW, _]] }] },
    { id: "halberd", result: weapon("PqnBufW2R8SfCcog"), requires: SMITHING,
      cells: [[STEEL, STICK, _],
              [STEEL, STICK, _],
              [_, STICK, _]] },
    { id: "long-sword", result: weapon("WwEEaLMmjSyap9kH"), requires: SMITHING,
      cells: [[_, STEEL, _],
              [_, STEEL, _],
              [IRON, STEEL, STRIP]] },
    { id: "war-hammer", result: weapon("2RgcMeClMBxWr0ip"), requires: SMITHING,
      cells: [[STEEL, STEEL, STEEL],
              [_, STICK, _],
              [_, STICK, _]] },
    { id: "crossbow", result: weapon("qLSAVP83onsMvq0d"), requires: SMITHING,
      cells: [[THREAD, IRON, THREAD],
              [_, PLANK, _],
              [_, PLANK, _]] }
  ]),

  // Armour, as the Armorer shelves it.
  ...filed("Armour", [
    { id: "helmet", result: armor("HgY89TClg3swr6Mx"), requires: SMITHING,
      cells: [[PLATE, PLATE, _],
              [STRIP, _, _],
              [_, _, _]] },
    { id: "shield", result: armor("ImIULTvK8p5ZoWUC"), variants: [
      { requires: SMITHING,
        cells: [[_, PLANK, _],
                [PLANK, IRON, PLANK],
                [_, _, _]] },
      { cells: [[_, PLANK, _],
                [PLANK, HIDE, PLANK],
                [_, _, _]] }] },
    { id: "gambeson", result: GAMBESON, requires: SEWING,
      cells: [[CLOTH, THREAD, CLOTH],
              [_, CLOTH, _],
              [_, _, _]] },
    { id: "brigandine", result: armor("WvHpP6L5AyMd6oO7"), requires: SMITHING,
      cells: [[LEATHER, NAILS, LEATHER],
              [PLATE, _, PLATE],
              [_, _, _]] },
    { id: "chainmail", result: armor("vYkrBTEXzHrxUzSk"),
      cells: [[CHAIN, GAMBESON, CHAIN],
              [_, _, _],
              [_, _, _]] },
    { id: "plate", result: armor("HFI9vH2O90lK0XwE"), requires: SMITHING,
      cells: [[_, PLATE, _],
              [PLATE, GAMBESON, PLATE],
              [_, PLATE, _]] }
  ]),

  // Gear, as the Marketplace lists it. Alchemy is shapeless, like cooking: a salve has no shape.
  ...filed("Gear", [
    { id: "air-bladder", result: gear("BgBHOBRaOlLJCh31"), requires: SEWING,
      cells: [[_, HIDE, _],
              [_, THREAD, _],
              [_, _, _]] },
    { id: "antitoxin", result: GEAR.ANTITOXIN, requires: ALCHEMY, shaped: false,
      cells: [HERBS, HERBS, MUSHROOMS, GLASS, _, _, _, _, _] },
    { id: "bandages", result: gear("F8yysdbnA0y5L4sA"),
      cells: [[CLOTH, HERBS, CLOTH],
              [_, _, _],
              [_, _, _]] },
    { id: "bathing-goods", result: gear("dcg6C3sgIfUklUu7"), shaped: false,
      cells: [WAX, HERBS, _, _, _, _, _, _, _] },
    { id: "book", result: GEAR.BOOK, requires: SEWING,
      cells: [[_, LEATHER, _],
              [HIDE, HIDE, HIDE],
              [_, THREAD, _]] },
    { id: "caltrops", result: gear("QYy0LFVooHDbjiTV"), requires: SMITHING,
      cells: [[IRON, _, _],
              [_, IRON, _],
              [_, _, _]] },
    { id: "card-deck", result: gear("qjn8EvZyXYZb1eST"),
      cells: [[HIDE, BERRIES, _],
              [_, _, _],
              [_, _, _]] },
    { id: "cart", result: gear("S8va0NhfI1MpGSsu"), requires: SMITHING,
      cells: [[PLANK, PLANK, PLANK],
              [_, PLANK, _],
              [_, IRON, _]] },
    { id: "chain", result: CHAIN, requires: SMITHING,
      cells: [[_, IRON, _],
              [_, IRON, _],
              [_, IRON, _]] },
    { id: "chalk", result: gear("sz3hlSxhxVLBvkKX"),
      cells: [[STONE, _, _], [_, _, _], [_, _, _]] },
    { id: "chest", result: gear("oyCPkncx99bsRO5E"),
      cells: [[_, PLANK, _],
              [PLANK, NAILS, PLANK],
              [_, PLANK, _]] },
    { id: "chisel", result: gear("0zOZuLW1Yw2gr9wT"), requires: SMITHING,
      cells: [[_, STEEL, _],
              [_, STICK, _],
              [_, _, _]] },
    { id: "common-agents", result: gear("LJuSzL3jPRwPcvAL"), shaped: false, variants: [
      { cells: [HERBS, WAX, TALLOW, _, _, _, _, _, _] },
      { requires: COOKING, cells: [HIDE, BONE, _, _, _, _, _, _, _] },
      { cells: [RESIN, TALLOW, _, _, _, _, _, _, _] }] },
    { id: "common-tools", result: gear("QDL96czD5DIDWr79"), requires: SMITHING,
      cells: [[IRON, _, IRON],
              [STICK, _, STICK],
              [_, _, _]] },
    { id: "containers", result: gear("MLu8HRRZKwQjdGBU"), variants: [
      { requires: SEWING,
        cells: [[LEATHER, THREAD, LEATHER],
                [_, _, _],
                [_, _, _]] },
      { cells: [[REEDS, REEDS, REEDS],
                [_, _, _],
                [_, _, _]] }] },
    { id: "cooking-gear", result: COOKING, requires: SMITHING,
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
    { id: "expeditionary-gear", result: gear("5yJLuqVex4HpsIhJ"), requires: SMITHING,
      cells: [[IRON, ROPE, IRON],
              [_, _, _],
              [_, _, _]] },
    { id: "fire-oil", result: gear("vwTBmANkGI22L7n2"),
      cells: [[_, CLOTH, _],
              [_, GLASS, _],
              [_, TALLOW, _]] },
    { id: "fishing-rod", result: gear("LpppO7mC1EgIRTXv"), variants: [
      { cells: [[STICK, _, _],
                [_, STICK, THREAD],
                [_, _, NAILS]] },
      { cells: [[STICK, _, _],
                [_, STICK, THREAD],
                [_, _, BONE]] },
      { cells: [[STICK, _, _],
                [_, STICK, SINEW],
                [_, _, BONE]] }] },
    { id: "games", result: gear("sIS4sBDYuDjnLPo0"),
      cells: [[BONE, PLANK, BONE],
              [_, _, _],
              [_, _, _]] },
    { id: "gloves", result: gear("kWbQCs7Zt0qwwh8F"), requires: SEWING,
      cells: [[LEATHER, _, LEATHER],
              [_, THREAD, _],
              [_, _, _]] },
    { id: "grappling-hook", result: gear("3QIHHBWQeDmDJASp"), requires: SMITHING,
      cells: [[IRON, _, IRON],
              [_, IRON, _],
              [_, ROPE, _]] },
    { id: "lantern", result: gear("lAOJ4KhINKHkQFKY"), requires: SMITHING,
      cells: [[_, IRON, _],
              [GLASS, WAX, GLASS],
              [_, IRON, _]] },
    { id: "mirror", result: gear("8AfmfTU2E7oJ994j"), requires: SMITHING,
      cells: [[_, GLASS, _],
              [_, IRON, _],
              [_, _, _]] },
    { id: "net", result: gear("5SZWEE7UyIgdgwSE"),
      cells: [[THREAD, THREAD, _],
              [THREAD, THREAD, _],
              [_, _, _]] },
    { id: "oil-can", result: gear("DEIG5kYj2mhV3hRM"), requires: SMITHING,
      cells: [[_, TALLOW, _],
              [_, TALLOW, _],
              [_, IRON, _]] },
    { id: "outdoor-comfort", result: gear("Ep7hnDLh5HBoEOZr"), variants: [
      { cells: [[HIDE, CLOTH, CLOTH],
                [_, _, _],
                [_, _, _]] },
      { cells: [[REEDS, REEDS, _],
                [REEDS, REEDS, _],
                [_, _, _]] }] },
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
    { id: "rope", result: ROPE, variants: [
      { cells: [[_, THREAD, _],
                [_, THREAD, _],
                [_, THREAD, _]] },
      { cells: [[_, STRIP, _],
                [_, STRIP, _],
                [_, STRIP, _]] }] },
    { id: "sedative", result: gear("Pl1vyKGTou4BZeAC"), requires: ALCHEMY, shaped: false,
      cells: [HERBS, MUSHROOMS, MUSHROOMS, GLASS, _, _, _, _, _] },
    { id: "sewing-kit", result: SEWING,
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
    { id: "specialized-tools", result: gear("TxTE0Kqi1Pemap5K"), requires: SMITHING,
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
    { id: "thieving-tools", result: GEAR.THIEVING_TOOLS, requires: SMITHING,
      cells: [[STEEL, LEATHER, IRON],
              [_, _, _],
              [_, _, _]] },
    { id: "torch", result: GEAR.TORCH, variants: [
      { cells: [[_, WAX, _],
                [_, CLOTH, _],
                [_, STICK, _]] },
      { cells: [[_, TALLOW, _],
                [_, CLOTH, _],
                [_, STICK, _]] },
      { cells: [[_, RESIN, _],
                [_, CLOTH, _],
                [_, STICK, _]] },
      { cells: [[_, TALLOW, _],
                [_, REEDS, _],
                [_, REEDS, _]] }] },
    { id: "trap", result: GEAR.TRAP, requires: SMITHING,
      cells: [[IRON, NAILS, IRON],
              [_, CHAIN, _],
              [_, _, _]] },
    { id: "whistle", result: gear("LsozBVpc307VB58Y"),
      cells: [[BONE, _, _], [_, _, _], [_, _, _]] },
    { id: "wilderness-clothes", result: gear("tGF9mBAjp5fivlyB"), variants: [
      { requires: SEWING,
        cells: [[_, HIDE, _],
                [_, THREAD, _],
                [_, CLOTH, _]] },
      { cells: [[_, HIDE, _],
                [_, STRIP, _],
                [_, HIDE, _]] }] }
  ]),

  // Food is shapeless: a stew has no shape. What is cooked is food, which raw meat and fish are not.
  // A dish that goes over the fire needs Cooking Gear; what is salted, dried or mixed does not.
  ...filed("Food", [
    { id: "rations", result: GEAR.RATIONS, shaped: false, variants: [
      { cells: [MEAT, MEAT, SALT, _, _, _, _, _, _] },
      { cells: [FISH, FISH, SALT, _, _, _, _, _, _] }] },
    { id: "smoked-meat", result: moreGear("UYMZMEjqOvH0cVNq"), shaped: false,
      cells: [MEAT, SALT, _, _, _, _, _, _, _] },
    { id: "salted-fish", result: moreGear("FZGY21ESRCyLxI0E"), quantity: 2, shaped: false,
      cells: [FISH, SALT, SALT, _, _, _, _, _, _] },
    { id: "jerked-beef", result: moreGear("va6jaq0RCIQyAang"), shaped: false,
      cells: [MEAT, SALT, HERBS, _, _, _, _, _, _] },
    { id: "jam", result: moreGear("DaIe6h4mA3CMQNuG"), requires: COOKING, quantity: 2, shaped: false,
      cells: [BERRIES, BERRIES, HONEY, _, _, _, _, _, _] },
    { id: "hunters-stew", result: moreGear("Xi4rwuDAwmrOz8ae"), requires: COOKING, shaped: false,
      cells: [MEAT, MEAT, HERBS, SALT, _, _, _, _, _] },
    { id: "fish-stew", result: moreGear("B2Bf5ixPnIy1tUt1"), requires: COOKING, shaped: false,
      cells: [FISH, FISH, HERBS, SALT, _, _, _, _, _] },
    { id: "pemmican", result: moreGear("n6cVjhDIEJa4V8eu"), shaped: false,
      cells: [MEAT, MEAT, BERRIES, SALT, _, _, _, _, _] },
    { id: "mushroom-soup", result: moreGear("qJELvjFtKGhMdEEG"), requires: COOKING, shaped: false,
      cells: [MUSHROOMS, MUSHROOMS, HERBS, _, _, _, _, _, _] },
    { id: "honey-cakes", result: moreGear("9cXVG6PemCUPDzD2"), requires: COOKING, shaped: false,
      cells: [FLOUR, EGGS, HONEY, _, _, _, _, _, _] },
    { id: "bread", result: moreGear("0CmxUSfbtPFMBz5v"), requires: COOKING, quantity: 2, shaped: false,
      cells: [FLOUR, _, _, _, _, _, _, _, _] },
    { id: "dried-fruit", result: DRIED_FRUIT, shaped: false,
      cells: [BERRIES, BERRIES, _, _, _, _, _, _, _] },
    { id: "cheese-local", result: moreGear("hR7BHskkiM7a7CIz"), requires: COOKING, quantity: 2, shaped: false,
      cells: [MILK, MILK, SALT, _, _, _, _, _, _] },
    { id: "roast-chicken", result: moreGear("34aQvMqgb8HP8fvp"), requires: COOKING, shaped: false,
      cells: [FOWL, SALT, _, _, _, _, _, _, _] },
    { id: "roast-goose", result: moreGear("JRaB1j5guyzAB86d"), requires: COOKING, shaped: false,
      cells: [FOWL, HERBS, HONEY, _, _, _, _, _, _] },
    { id: "meat-pie", result: moreGear("GXDPOhytdXL0nLS5"), requires: COOKING, shaped: false,
      cells: [FLOUR, MEAT, SALT, _, _, _, _, _, _] },
    { id: "fish-pie", result: moreGear("tNqR8aIgpgxRy7AN"), requires: COOKING, shaped: false,
      cells: [FLOUR, FISH, HERBS, _, _, _, _, _, _] },
    { id: "vegetable-pottage", result: moreGear("77WzCtMqCxoB2Jtc"), requires: COOKING, shaped: false,
      cells: [VEG, VEG, SALT, _, _, _, _, _, _] },
    { id: "fowl-soup", result: moreGear("pYctxhdwCKopKSWM"), requires: COOKING, shaped: false,
      cells: [FOWL, VEG, HERBS, SALT, _, _, _, _, _] },
    { id: "mushroom-omelette", result: moreGear("Bo0yQLTSar45lqlU"), requires: COOKING, shaped: false,
      cells: [EGGS, MUSHROOMS, HERBS, _, _, _, _, _, _] },
    { id: "berry-tart", result: moreGear("nmDjU2NjQgHOHAkU"), requires: COOKING, shaped: false,
      cells: [FLOUR, BERRIES, HONEY, _, _, _, _, _, _] },
    { id: "porridge", result: moreGear("aPSpoYuVqAqNJ9Wy"), requires: COOKING, shaped: false,
      cells: [FLOUR, MILK, HONEY, _, _, _, _, _, _] },
    { id: "trail-mix", result: moreGear("lbf5XcSob8ICRK05"), shaped: false,
      cells: [NUTS, DRIED_FRUIT, HONEY, _, _, _, _, _, _] }
  ]),

  // Potions (Homebrew), brewed rather than found: 2e hires out an Alchemist and lets Herbology make
  // a salve. Shapeless like the rest of alchemy, and every one is poured into a Glass vial.
  ...filed("Potions", [
    { id: "discerning-fire", result: potion("JsXNGtyTd6do4Qbc"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, TALLOW, WAX, SALT, _, _, _, _, _] },
    { id: "aspect-of-nature", result: potion("Qt1LcaZpt75oXOXT"), shaped: false, variants: [
      { requires: ALCHEMY, cells: [GLASS, HERBS, FEATHER, _, _, _, _, _, _] },
      { requires: ALCHEMY, cells: [GLASS, HERBS, BONE, _, _, _, _, _, _] },
      { requires: ALCHEMY, cells: [GLASS, HERBS, HIDE, _, _, _, _, _, _] }] },
    { id: "astral-sight", result: potion("0uqB4aGNo7ZClrsG"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, MUSHROOMS, BERRIES, SALT, _, _, _, _, _] },
    { id: "dragons-roar", result: potion("8kwslqDlLWCqvlO0"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, BONE, TALLOW, SALT, _, _, _, _, _] },
    { id: "liquid-luck", result: potion("ObiettKQSBCmEoli"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, HONEY, HERBS, BERRIES, _, _, _, _, _] },
    { id: "heartstopper", result: potion("9MwOmL24PBKxq00d"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, MUSHROOMS, MUSHROOMS, MUSHROOMS, _, _, _, _, _] },
    { id: "new-potential", result: potion("0UhW8YXgn00FGOCg"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, EGGS, HERBS, MUSHROOMS, BERRIES, _, _, _, _] },
    { id: "stoneform", result: potion("XEnQs002PTTeRAtY"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, STONE, STONE, SALT, _, _, _, _, _] },
    { id: "water-deflector", result: potion("DmH7WEDwJlwRrFTa"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, WAX, WAX, FEATHER, _, _, _, _, _] },

    // Potions of the system's own, each around a Monster Part: rare, never sold, and most of the
    // recipe's price, so brewing one saves little and the worth is in having taken the part.
    { id: "ironheart-tonic", result: potion("WxOy210nhZSlKs5n"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, GARGOYLE, SALT, HERBS, _, _, _, _, _] },
    { id: "borrowed-vigor", result: potion("zTJaK6jvOwHVfnKF"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, TROLL, HONEY, HERBS, _, _, _, _, _] },
    { id: "bane-oil", result: potion("PTipsmetn3rdjLE8"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, TROLL, BONE, SALT, _, _, _, _, _] },
    { id: "honeytongue", result: potion("yBnyOTNpZMwoxROX"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, PIXIE, HONEY, BERRIES, _, _, _, _, _] },
    { id: "last-stand-cordial", result: potion("PDXTPmOTFExeoDbg"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, TROLL, HERBS, TALLOW, _, _, _, _, _] },
    { id: "lethe-water", result: potion("7HBWiFzpfFZxXeeb"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, PIXIE, MUSHROOMS, BERRIES, _, _, _, _, _] },
    { id: "owl-eye-drops", result: potion("DGesbkzk13zzwxOf"), requires: ALCHEMY, shaped: false,
      cells: [GLASS, GARGOYLE, FEATHER, BERRIES, _, _, _, _, _] }
  ])
];

/**
 * What is used up, and the Cart, never break down. A thing with uses would come apart into fresh
 * parts however far it was used; the Cart is a container, and deleting a container deletes its load.
 */
const UNBROKEN = new Set(["antitoxin", "bandages", "cart", "fire-oil", "lantern", "oil-can",
  "parchment", "repellent", "sedative", "torch"]);

/**
 * Homebrew: the durable things a recipe makes break back down. With `refund`, an item made at the
 * table gives back exactly what its receipt says was spent, so making and breaking is an undo and
 * nothing grows. An item with no receipt (bought, looted, given at creation) breaks into the
 * recipe's first variant, the Marketplace's way, which costs less than the item: a bought thing
 * broken and sold loses gold. cairn2e copies flags with an item that changes hands and has no
 * stacks, so a crafted thing keeps its receipt. Grid Crafter names unnamed variants `v0`… by
 * position, so the first is always `v0`.
 */
export const DISMANTLES = RECIPES
  .filter((r) => ["Weapons", "Armour", "Gear"].includes(r.categories[0]) && !UNBROKEN.has(r.id))
  .flatMap((r) => {
    const ways = r.variants ?? [r];
    const tools = new Set(ways.map((v) => v.requires ?? null));
    if (tools.size > 1) return [];
    const first = ways[0].cells;
    return [{
      id: `${r.id}-dismantle`, kind: "dismantle", input: r.result, refund: true,
      outputs: (Array.isArray(first[0]) ? first.flat() : first).filter(Boolean),
      favorite: { recipe: `${SYSTEM_ID}.${r.id}`, variant: "v0" },
      requires: [...tools][0] ?? undefined,
      categories: categoriesOf(r)
    }];
  });

/** A recipe's categories as keys under `CAIRN.Crafting.Category`: what it makes, its trades, Without Tools. */
export function categoriesOf(recipe) {
  const tools = new Set((recipe.variants ?? [recipe]).map((v) => v.requires ?? null));
  const trades = [...TRADES].filter(([tool]) => tools.has(tool)).map(([, trade]) => trade);
  return [...recipe.categories, ...trades, ...(tools.has(null) ? ["WithoutTools"] : [])];
}

/**
 * Register the recipes when Grid Crafter is ready; the hook never fires without the module, so
 * nothing here runs in a world that does not use it. Every client registers, because Grid Crafter
 * keeps recipes in memory, not in the world. Categories are names the books show, so they are
 * localized here, where `game.i18n` is ready.
 */
export function registerCrafting() {
  const label = (c) => game.i18n.localize(`CAIRN.Crafting.Category.${c}`);
  Hooks.once(`${MODULE}.ready`, (api) => api.registerRecipes(SYSTEM_ID, [
    ...RECIPES.map((r) => ({ ...r, categories: categoriesOf(r).map(label) })),
    ...DISMANTLES.map((d) => ({ ...d, categories: d.categories.map(label) }))
  ]));
  Hooks.once(`${MODULE}.ready`, installForgeMacro);
}

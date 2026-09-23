/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CharacterData } from "./actor-character.js";
import { NpcData } from "./actor-npc.js";
import { PartyData } from "./actor-party.js";
import { GearData } from "./item-gear.js";
import { FatigueData } from "./item-fatigue.js";
import { BackgroundData } from "./item-background.js";
import { FeatureData } from "./item-feature.js";
import { ScarData } from "./item-scar.js";
import { GrowthData } from "./item-growth.js";
import { CoinData } from "./item-coin.js";
import { RouteData } from "./page-route.js";
import { FactionData } from "./page-faction.js";

export { CharacterData, NpcData, PartyData, GearData, FatigueData, BackgroundData, FeatureData, ScarData, GrowthData, CoinData, RouteData, FactionData };

/** Map for `CONFIG.Actor.dataModels`, keyed by the subtype id in `system.json` `documentTypes`. */
export const ACTOR_MODELS = {
  character: CharacterData,
  npc: NpcData,
  party: PartyData
};

/** Map for `CONFIG.Item.dataModels`. */
// Two carried subtypes: a weapon, an armour, a spellbook, a scroll, a relic and a container are all
// `gear`, told apart by fields (`item-gear.js`), and coin is `coin` (`item-coin.js`) because its
// weight is read off its value. The other five are not things carried.
export const ITEM_MODELS = {
  gear: GearData,
  coin: CoinData,
  fatigue: FatigueData,
  background: BackgroundData,
  feature: FeatureData,
  scar: ScarData,
  growth: GrowthData
};

/** Map for `CONFIG.JournalEntryPage.dataModels`. Two kinds of Warden machinery that belong in a
 *  journal rather than in the Actors directory: a pointcrawl's paths are journal pages
 *  (`module/pointcrawl.js`), so the journal holding the points holds the routes between them; and
 *  a region's factions are pages of one journal, revealed a page at a time (`page-faction.js`). */
export const PAGE_MODELS = {
  route: RouteData,
  faction: FactionData
};

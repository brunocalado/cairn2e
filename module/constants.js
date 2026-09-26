/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The system id. Single source of truth — must equal `id` in system.json and the
 * on-disk data directory name. Imported everywhere; never written as a string literal.
 */
export const SYSTEM_ID = "cairn2e";

/**
 * The classes this system's own tooltip wears (`css/src/tooltip-chips-embeds.css`, Primitive 10).
 *
 * Core's tooltip is ONE element parented to the document body, so it sits outside every
 * `.cairn2e` scope and the stylesheet cannot reach it by position. `TooltipManager#activate`
 * copies the `data-tooltip-class` of the nearest ancestor that carries one onto the tooltip just
 * before it opens — and `closest` matches the element itself, so stamping the attribute either on
 * the ROOT of everything this system draws, or on a single loose element it drew into somebody
 * else's window, is the same mechanism. A tooltip raised from a system window, a system chat card
 * or an enriched chip sitting in core's journal sheet opens on paper with an ink frame; one
 * raised anywhere else keeps core's.
 *
 * Here rather than at its old home in `module/cairn2e.js`: three call sites now read it — the two
 * hooks there and `module/enrichers.js` — which is §4's threshold for deriving a shared string.
 */
export const TOOLTIP_CLASS = `${SYSTEM_ID} cairn-tooltip`;

/**
 * What the character edit window accepts, held twice — on the control, where `maxlength` stops
 * the typing, and on the submit path, which stops everything a keystroke did not make. One set of
 * numbers for both, so the two cannot disagree: four digits of age, two of each maximum (0-99), a
 * thousand characters of Bond, Omen or table answer, two hundred of table question.
 */
export const EDIT_LIMITS = Object.freeze({ ageDigits: 4, statDigits: 2, text: 1000, question: 200 });

/**
 * World setting keys. 2e deletes every setting that configures away a rule — `use-panic`,
 * `use-gold-threshold`, `show-gold-not-cost`, `show-features-section`, `use-cairn-dice-notation`
 * are gone — and `show-generate-header` with them: it turned a Warden's tool into a switch that,
 * once on, showed it to players too. "Regenerate" is gated on the Warden's role instead.
 * Of the keys that remain, exactly one is a toggle — `BESTIARY_ART`, which configures away no
 * rule, only whose pictures the monsters wear. The rest are storage, pointers, or the record of a
 * one-time install.
 */
export const SETTINGS = {
  /** Hidden (`config: false`) — the one journey underway (`module/journey.js`), or `null`. It
   *  carries its own crew, so no Actor has to exist for a party to travel. World scope so every
   *  client reads the same state and core broadcasts each write; only the Warden writes it, which
   *  is the rule the procedure wants anyway. */
  JOURNEY: "journey",

  /** Hidden (`config: false`) — whether the Welcome scene and its Playlist have been created in
   *  this world (`module/welcome.js`). Not a toggle: it is the record of a one-time install, and
   *  it stays true even after the Warden deletes what it made. */
  WELCOME_INSTALLED: "welcome-installed",

  /** Hidden (`config: false`) — whether this world's core Prototype Token Overrides and combat
   *  turn marker have been seeded (`module/token-defaults.js`). The record of a one-time install,
   *  like the one above: the values it writes are the Warden's to change afterwards, and a Warden
   *  who changed them is not asking for ours back on the next launch. */
  TOKEN_DEFAULTS_INSTALLED: "token-defaults-installed",

  /** Hidden (`config: false`) — the id of the world's active `party` Actor, or "". It is what
   *  the P keybinding opens, and the only answer to "which party" in a world that has two.
   *  Not a toggle either: it is a pointer, kept honest by `CairnActor`'s create and delete. */
  ACTIVE_PARTY: "active-party",

  /** Hidden (`config: false`) — the Macro uuids the Warden put in every character's Actions
   *  menu, in the Warden's order. Uuids only: a name or an image stored beside one goes stale the
   *  moment the macro is renamed, so both are read off the live document every time. Edited only
   *  through the settings menu (`module/apps/action-macros.js`). */
  ACTION_MACROS: "action-macros",

  /** Shown — whether the Warden's own bestiary art is laid over `cairn2e.bestiary` through core's
   *  Compendium Art map (`module/bestiary-art.js`). Off by default: a fresh install has no folder. */
  BESTIARY_ART: "bestiary-art",

  /** Shown — the folder under `Data/` holding `portraits/` and `tokens/`. A String with core's
   *  folder picker, not a FilePathField: core refuses a folder there. */
  BESTIARY_ART_PATH: "bestiary-art-path",

  /** Hidden (`config: false`) — the scan's result, `{ [actorId]: { img?, token? } }`, or `null`
   *  when the switch is off. World scope because only the Warden may browse the folder and every
   *  client must apply the same answer; core broadcasts the write and each client's `onChange`
   *  injects it. Not a toggle: it is the transport. */
  BESTIARY_ART_MAP: "bestiary-art-map",

  /** Hidden (`config: false`) — every saved store, `{ [id]: { name, items: string[] } }`, `items`
   *  being Item uuids (`module/apps/store.js`). A store is a price list: the price of a row is
   *  the referenced Item's `cost` when the window draws, so "to change the price, edit the item"
   *  holds and a store never keeps a copy that can drift. World scope: the Warden writes, core
   *  broadcasts, and a player's open window redraws on `onChange`. Only the Warden writes it,
   *  which the window enforces by drawing the editing controls for nobody else. */
  STORES: "stores"
};

/**
 * Flag keys under the system scope.
 */
export const FLAGS = {
  /**
   * On a character Actor: a player's once-only character-creator rolls (attributes, the swap,
   * HP). Written the moment a roll lands, cleared when the creator is applied to the actor by
   * anyone, or by the Warden's "Reset generator rolls" in the sheet's header menu — never
   * otherwise, so closing the window is not a re-roll. On the actor rather than the player so
   * it follows the character if it changes hands.
   */
  CREATOR_ROLLS: "creator-rolls",

  /**
   * On a `party` Actor: the Token documents of the members most recently gathered in, as a list
   * of `{ uuid, token }`. A follower's token is unlinked — `module/encounters.js` creates them
   * that way on purpose — so its state lives on the token and nowhere else, and gathering the
   * group in without this would delete a mount's wounds along with its picture. Read back when
   * the party is set down again; position is the one thing taken from the party token instead.
   *
   * A LIST, not an object keyed by uuid, and that is not a style choice: a uuid contains dots,
   * and `setFlag` expands a dotted key into nested objects, so `{ "Actor.abc": … }` was stored
   * as `{ Actor: { abc: … } }` and never read back. An object flag is also merged rather than
   * replaced, so a member taken off the roster would have left its token behind for ever.
   */
  GATHERED_TOKENS: "gathered-tokens",

  /**
   * On a damage-result ChatMessage: what that hit took, as `{ actorUuid, hp, str }` — **deltas**,
   * not the before-values the card prints. `module/chat.js#reverseHit` adds them back, which
   * composes with anything that touched the actor in between; writing the absolutes back would
   * clobber a heal or a second hit silently.
   *
   * No dots in the inner keys: `setFlag` expands a dotted key into nested objects, which is the
   * trap {@link FLAGS.GATHERED_TOKENS} records the cost of.
   */
  HIT: "hit",

  /**
   * On the same message, once the hit has been given back. It is what stops the context-menu
   * entry offering itself a second time — a second reversal would hand the actor the HP twice.
   */
  REVERSED: "reversed"
};

/**
 * Token/ActiveEffect status ids for the 2e conditions. Deliberately unprefixed: status ids are
 * core's namespace, and `dead` in particular must stay literal because
 * `CONFIG.specialStatusEffects.DEFEATED` is the string "dead" and the combat tracker reads it.
 */
export const CONDITION = {
  DEPRIVED: "deprived",
  PANICKED: "panicked",
  CRITICAL_DAMAGE: "critical-damage",
  FATIGUED: "fatigued",
  ENCUMBERED: "encumbered",
  DEAD: "dead",
  PARALYZED: "paralyzed",
  DELIRIOUS: "delirious",
  // Not one of the eight from `core-rules.md`: Doomed is row 12 of the Scars table, and it lasts
  // exactly until the character's next Critical Damage save.
  DOOMED: "doomed",
  // The Morale rule's marker: an enemy that fails its WIL save runs. "Morale does not affect
  // PCs" (`core-rules.md`), so this one never appears on a character token.
  FLEEING: "fleeing"
};

/**
 * Combatant flag keys. 2e fights side against side and has no initiative roll, so what the
 * tracker needs to remember is per combatant and per round: whether it has acted, and — in the
 * first round only — how its DEX save went (`module/documents/combat.js`).
 *
 * They live on the COMBATANT rather than on the Combat because a player who owns one may write
 * its flags without the GM, which is what lets a player tick their own row and roll their own
 * save with no socket anywhere in the system.
 */
export const COMBAT_FLAGS = {
  /** This combatant has taken its action this round. Cleared for everyone by `nextRound`. */
  RESOLVED: "resolved",

  /**
   * The first-round DEX save: `"passed"`, `"failed"`, or absent if it was never rolled.
   * 2e asks for it once, in the first round of the combat, and only of the adventurers
   * (`core-rules.md`). Cleared alongside RESOLVED, so it cannot outlive the round it belongs to.
   */
  DEX_SAVE: "dexSave"
};

/**
 * Combat flags. Unlike {@link COMBAT_FLAGS} these belong to the encounter as a whole, and only
 * the Warden writes them — which is fine, because only the Warden is shown what they drive.
 */
export const MORALE_FLAGS = {
  /** How many opponents the fight started with — the baseline "half their number" is half of. */
  BASELINE: "opponentBaseline",
  /** The first-casualty save has been made. Each trigger fires at most once per combat. */
  FIRST_CASUALTY: "moraleFirstCasualty",
  /** The half-strength save has been made. */
  HALF: "moraleHalf"
};

/** A bag of coins worth less than this is *petty* and occupies no slot (`core-rules.md`). */
export const GOLD_PETTY_THRESHOLD = 100;

/**
 * The most inventory slots a character can ever have. Ten is the 2e rule (`core-rules.md`), and
 * it is a HARD ceiling: a world setting may house-rule fewer, never more, and no write that would
 * put an eleventh slot's worth of things on a character is allowed through.
 */
export const MAX_SLOTS = 10;

/**
 * The image a document is created with, by subtype.
 *
 * Core gives every new Item `icons/svg/item-bag.svg` and every new Actor the mystery-man
 * silhouette, so a fresh world filled up with rows of identical placeholders — and the portrait
 * is the first thing on a character's sheet. These are read by `getDefaultArtwork` on each
 * document class (`documents/actor.js`, `documents/item.js`), which is the `img` field's own
 * `initial` in core's schema: it applies on EVERY creation path — the directory, a sheet's add
 * control, a generator, an import — and only when no image was supplied, so a document that
 * arrives with art keeps it.
 *
 * All core paths, so every Foundry install has them. The three Actors come from the same family,
 * which is what makes a PC, an NPC and the band they travel in read as the same kind of thing at
 * a glance.
 */
export const DEFAULT_ARTWORK = {
  Actor: {
    character: "icons/environment/people/infantry-armored.webp",
    npc: "icons/environment/people/commoner.webp",
    // Several people on one road, against the two single figures above: a party is not a person.
    party: "icons/environment/people/group.webp"
  },
  Item: {
    // A carried thing of no particular kind. The kinds themselves are `GEAR_ARTWORK` below.
    gear: "icons/containers/bags/sack-cloth-heavy-brown.webp",
    // A tied leather purse, muted like the rest: coin is a line on the ledger, not loot glinting.
    coin: "icons/containers/bags/coinpouch-simple-leather-brown.webp",
    // Where a character comes from: a closed, bound book, against the spellbook's open one.
    background: "icons/sundries/books/book-embossed-bound-brown.webp",
    // What a Fatigue costs you, rather than what causes it: it is a slot of the ten filled by
    // something that is not gear, and it clears with a night's rest.
    fatigue: "icons/skills/wounds/injury-pain-body-orange.webp",
    // A rule an actor HAS — most often a monster's, and most often how it hurts you. Not a book:
    // that is the spellbook's, and a rule must not look like a thing that is carried.
    feature: "icons/skills/melee/blade-tip-chipped-blood-red.webp",
    // Stitched flesh: what a Scar is once it has healed. The Fatigue's image is the body still in
    // pain, and the two must not be confused on a list that can hold both.
    scar: "icons/skills/wounds/injury-stitched-flesh-red.webp",
    // What a character BECAME, against the scar's image of what happened to them. The two sit
    // in the same tab, so they must not read alike at a glance.
    growth: "icons/magic/nature/vines-thorned-curled-glow-green.webp"
  }
};

/**
 * The image each KIND of gear wears. Every carried thing is one `gear` Item told apart by its
 * fields (`data/item-gear.js`), so this is not a subtype map — it is what the Create Item prompt
 * hands a new Weapon or Relic (`apps/_item-prompt.js#ITEM_PRESETS`) and what the character
 * generator gives an item it had to invent because no Marketplace entry matched.
 *
 * Muted and mundane on purpose: Cairn is a low-fantasy game, and a glowing purple tome on the
 * ledger of a character whose whole inventory is ten lines reads as loot from another system.
 */
export const GEAR_ARTWORK = {
  gear: DEFAULT_ARTWORK.Item.gear,
  weapon: "icons/weapons/swords/shortsword-guard-brown.webp",
  armor: "icons/equipment/chest/breastplate-cuirass-steel-grey.webp",
  spellbook: "icons/sundries/books/book-open-brown.webp",
  scroll: "icons/sundries/scrolls/scroll-bound-black-tan.webp",
  relic: "icons/equipment/neck/amulet-carved-stone-spiral.webp",
  container: "icons/containers/bags/pack-leather-strapped-tan.webp"
};

/**
 * Compendium id of the `tables` pack — the system's RollTables: Scars (read by `rolls.js`),
 * Reactions, Die of Fate, and the Warden tables. Reused across the pack build and
 * the roll code — a shared constant instead of a literal `"cairn2e.tables"` at each call
 * site. The 1e `utils` pack held Scars alone; it was folded into this one.
 */
export const TABLES_PACK_ID = `${SYSTEM_ID}.tables`;

/**
 * Compendium id of the `warden` pack — the Warden-tooling RollTables: NPC, monster,
 * faction and travel generators, plus one generic wilderness encounter table. Drawn from by the
 * Phase-2 generators.
 */
export const WARDEN_PACK_ID = `${SYSTEM_ID}.warden`;

/**
 * Compendium ids the character generator draws from. Every id is derived from
 * `SYSTEM_ID` so the bare `cairn` prefix (CLAUDE.md §4) can never leak in.
 */
export const PACKS = {
  BACKGROUNDS: `${SYSTEM_ID}.backgrounds`,
  BACKGROUND_TABLES: `${SYSTEM_ID}.background-tables`,
  BACKGROUND_GEAR: `${SYSTEM_ID}.background-gear`,
  TRAITS: `${SYSTEM_ID}.character-traits`,
  BONDS: `${SYSTEM_ID}.bonds`,
  OMENS: `${SYSTEM_ID}.omens`,
  GEAR: `${SYSTEM_ID}.gear`,
  WEAPONS: `${SYSTEM_ID}.weapons`,
  ARMOR: `${SYSTEM_ID}.armor`
};

/** The d20 selector RollTable inside {@link PACKS.BACKGROUND_TABLES}. */
export const BACKGROUND_SELECTOR_TABLE = "Backgrounds";

/**
 * A compendium document's uuid, from its pack name and its authored `_id`. The ids are written in
 * `packs/_source/` and survive every rebuild, so a uuid is the one address a translation module —
 * which renames documents — cannot move.
 */
export const packUuid = (pack, type, id) => `Compendium.${SYSTEM_ID}.${pack}.${type}.${id}`;

/**
 * The Marketplace documents the code hands out on its own: the NPC kit and the journey's Rations.
 * By uuid, never by name, so a translated pack changes nothing the code does.
 */
export const GEAR = {
  RATIONS: packUuid("gear", "Item", "o6vtsY4SfrFJHnol"),
  TORCH: packUuid("gear", "Item", "38nboO4axGNV5vQC"),
  ANTITOXIN: packUuid("gear", "Item", "m9pA9rDapkpMFjYi"),
  ANIMAL_FEED: packUuid("gear", "Item", "zx6dah3S6hfrFBC3"),
  ROPE: packUuid("gear", "Item", "yQOui5IqPJ0IHTCf"),
  THIEVING_TOOLS: packUuid("gear", "Item", "Re9jpaWAjgO528ON"),
  COMPASS: packUuid("gear", "Item", "jIUcDxlW7tojBgaG"),
  BOOK: packUuid("gear", "Item", "MiIdPDU4ca9DCT1P"),
  REPELLENT: packUuid("gear", "Item", "riO6dGPX20svCtL0"),
  TRAP: packUuid("gear", "Item", "y9WcPO45F4qWK4Rv")
};

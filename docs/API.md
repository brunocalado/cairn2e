# Cairn 2e API

This page is for people who write macros and modules for Cairn 2e. Everything the system offers
them is on one object, `game.cairn2e`, which is also a global named `cairn2e`, so a macro can be
one line: `cairn2e.rest()`.

## Contents

1. [When to call](#1-when-to-call)
2. [Renaming the calendar](#2-renaming-the-calendar)
3. [One-line macros](#3-one-line-macros)
4. [Windows](#4-windows)
5. [Rolls](#5-rolls)
6. [Generators](#6-generators)
7. [Journeys](#7-journeys)
8. [Scars, the party and weapon macros](#8-scars-the-party-and-weapon-macros)
9. [Hooks](#9-hooks)

## 1. When to call

The system builds `game.cairn2e` during its own `init` hook.

- **From a macro**, everything is ready: the world has loaded long before anyone clicks one.
- **From a module**, call the API from `ready` or later. The one exception is
  `defineCalendar` (§2), which only works earlier.
- **Load order.** Foundry runs the system's scripts before an ordinary module's, so a module's
  `init` listener runs after the system's and `game.cairn2e` already exists there. A module with
  `"library": true` in its manifest is loaded *before* the system, so `game.cairn2e` does not
  exist yet during its `init`; such a module uses `i18nInit`, which comes after every `init`.

Most functions act on **the selected token**, or on **your own character** when nothing is
selected. The Warden's tools (generators, journeys, treasure) are meant for the Warden. A player
who calls a generator needs the Foundry permission to create what it makes, and the calls marked
*Warden only* below refuse a player.

## 2. Renaming the calendar

The world clock uses the Vald calendar from the Warden's Guide: twelve months of 24 days, a
six-day week, four seasons, and the six-day Reclamation in every year ending in 0. A module can
give that calendar other names, another first year, and other events, with one call:

```js
Hooks.once("init", () => {
  game.cairn2e.defineCalendar({
    name: "The Reckoning of Hollow",
    months: [
      { name: "Frostwane", abbreviation: "Frw" },
      { name: "Thawing" },          // no abbreviation: the year strip shows "Thawing"
      // ... ten more, twelve in all, in order
    ],
    reclamation: { name: "The Tithing", abbreviation: "Tth" },
    weekdays: ["Moonday", "Ashday", "Wellday", "Coinday", "Bathday", "Hearthday"],
    reclamationDays: ["Ash", "Bone", "Coal", "Dust", "Ember", "Flint"],
    seasons: ["Deep", "Thaw", "Rains", "Reaping"],
    startYear: 412,
    events: ["my-module.hollow-events"]
  });
});
```

| Key | What it takes |
|---|---|
| `name` | The calendar's name. |
| `months` | Exactly 12 months, in order, each `{ name, abbreviation }`. `abbreviation` is optional; without one, the month's name is used. |
| `reclamation` | The leap week, as `{ name, abbreviation }`. |
| `weekdays` | Exactly 6 day names. |
| `reclamationDays` | Exactly 6 names for the days of the leap week, which replace the weekdays during it. |
| `seasons` | Exactly 4 names, in the order Dead, Dry, Wet, Harvest. |
| `startYear` | A whole number, 0 or more: the year a new world starts in. Vald's is 7728. |
| `events` | A list of compendium ids. They replace `cairn2e.vald-calendar` as the source of the calendar's events. `[]` means no events. |

**Every key is optional.** A key you leave out keeps Vald's value. A key you give is taken
whole: there is no way to rename only the third month, so give all twelve.

**Names** can be plain text or i18n keys. Foundry shows a string it has no translation for as it
is, so `"Frostwane"` and `"MY-MODULE.Months.Frostwane"` both work. A key lets your module's own
language files translate the names.

**A mistake stops the call.** A wrong count, an empty name, a `startYear` that is not a whole
number, an `events` that is not a list of strings, or a key the system does not know makes
`defineCalendar` throw, and nothing changes: the calendar stays Vald's. The error is in your
module's console, at load.

### When it takes effect

- **Names** are read on every load. Nothing is stored in the world, so updating your module
  changes the names on the next reload, and disabling it brings Vald's back. Calendar notes store
  their dates as numbers, so renaming a month never moves a note.
- **`startYear`** is used once, on a world's first launch. It never moves the clock of a world
  that is already running; the Warden sets the date in the calendar itself.
- **`events`** are imported on a world's first launch, as notes everyone can read. A pack id the
  world does not have is skipped with a warning in the console, and the others still import.
  Later, the Warden's **Configure Settings → Calendar events → Import missing events** button
  brings in any event the world has no copy of: one added to your pack since, or one the Warden
  deleted. A note the Warden edited is never overwritten.

`defineCalendar` only works during `init` and `i18nInit`. After that, Foundry has already built
the world's calendar, and the call throws without changing anything. If two modules call it, the
last call wins. It does not merge with the earlier one.

### What it cannot change

Month and week length, the Reclamation, the leap rule and the seasons' dates stay Vald's:
calendar notes, foraging regrowth and the Weather in Vald tables all depend on them. A module
that wants a different calendar sets Foundry's `CONFIG.time.worldCalendarConfig` and
`CONFIG.time.worldCalendarClass` itself. The system then drops its chat clock and the calendar
buttons in the Notes controls, the Actions menu and the Cairn tab, and the Calendar macro and
`cairn2e.calendar()` show a warning instead of opening the window. Its watches and scene darkness
follow that calendar's day.

## 3. One-line macros

Each of these is a complete Script macro.

| Call | What it does |
|---|---|
| `cairn2e.rest()` | Restores lost HP. |
| `cairn2e.restoreAbilities()` | Restores STR, DEX and WIL to their maximum. |
| `cairn2e.save("DEX")` | Rolls a save: `"STR"`, `"DEX"` or `"WIL"`, in any case. |
| `cairn2e.morale()` | Rolls a Morale save for the selected NPC. |
| `cairn2e.reaction()` | Rolls 2d6 on the Reaction table. Works with nothing selected. |
| `cairn2e.dieOfFate()` | Rolls the Die of Fate, 1d6. Works with nothing selected. |
| `cairn2e.takeDamage()` | Asks for an amount of damage and applies it like a damage card's Apply: armor, overflow into STR, Critical Damage and Scars. |
| `cairn2e.resetPlayerHotbars()` | Warden only. Puts the supplied player macros back on every player's hotbar. |

## 4. Windows

| Call | Opens |
|---|---|
| `cairn2e.calendar()` | The calendar. |
| `cairn2e.rulesSummary()` | The one-page rules summary. |
| `cairn2e.stores()` | The stores open to visits; every store, for the Warden. |
| `cairn2e.treasure()` | Warden only. The Treasure window. |
| `cairn2e.restoreDefaultStores()` | Warden only. After a warning, puts every store back to the system's ten. |
| `cairn2e.journey.open()` | The journey window (§7). |
| `new cairn2e.CairnCharacterCreator().render(true)` | The character creator. |

## 5. Rolls

`cairn2e.rolls` holds every roll the system makes. Each one posts its own chat card. The ones a
macro is most likely to want:

```js
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;

await cairn2e.rolls.rollSave(actor, "WIL");      // true if the save passed
await cairn2e.rolls.rollMorale(npc);             // a Morale save; not for characters
await cairn2e.rolls.rollReaction();              // { message, total, key, label }
await cairn2e.rolls.rollDieOfFate();             // 1d6, 4 or more favours the characters
await cairn2e.rolls.rollDamage(actor, weapon);   // the same dialog as the sheet's Roll Damage
await cairn2e.rolls.rollDamage(actor, weapon, { skipDialog: true });  // the weapon's own die
```

- `rollSave` follows the 2e rule: roll under or equal, a 1 always passes, a 20 always fails.
- `rollDamage` takes a weapon Item the actor owns. It handles Panic, Impaired and Enhanced
  attacks, Blast and Detachments, and returns the chat card (or `true` for Blast, which posts one
  card per target, or `null` if the dialog was cancelled).
- `rollReaction` and `rollDieOfFate` take an optional actor, who then speaks the card.

## 6. Generators

These are the buttons of the Warden's Cairn sidebar tab. Each one creates documents.

| Call | Creates |
|---|---|
| `cairn2e.characterGenerator.createCharacter()` | A random character, every choice rolled. |
| `cairn2e.characterGenerator.regenerateActor(actor)` | Rolls an existing character again, in place. |
| `cairn2e.npcGenerator.generateNpc()` | Someone the party meets, with their sheet open. |
| `cairn2e.npcGenerator.generateNpcs(count, { folder })` | `count` of them at once, in a folder (a folder id). |
| `cairn2e.npcGenerator.generateHireling()` | Someone the party pays. |
| `cairn2e.npcGenerator.regenerateNpc(actor)` | After asking, rolls an NPC again. Keeps its name, portrait, token, description and anything added by hand. |
| `cairn2e.monsterGenerator.generateMonster(tier)` | A monster. `tier` is `"standard"`, `"hardier"`, `"serious"` or `"random"`; without one, a picker asks. |
| `cairn2e.monsterGenerator.regenerateMonster(actor)` | Rolls a monster again, after the same picker. Keeps its name, portrait and token. |
| `cairn2e.factionGenerator.generateFaction()` | A faction, as a new page of the Factions journal. |
| `cairn2e.kettlewrightImport.importKettlewrightCharacter()` | Asks for a Kettlewright `.json` and creates a character from it. Needs the permission to create Actors. |

## 7. Journeys

`cairn2e.journey` is the Wilderness Exploration procedure behind the journey window.

```js
cairn2e.journey.current();   // the journey underway, or null; a copy, safe to read anywhere
cairn2e.journey.open();      // the journey window

// Start one, as the Warden. Every key is required.
await cairn2e.journey.apply("start", {
  path: "trail",          // "road", "trail" or "wilderness"
  distance: "medium",     // "short", "medium" or "long"
  terrain: "tough",       // "easy", "tough" or "perilous"
  season: "fall",         // "spring", "summer", "fall" or "winter"
  vast: 0                 // 0 to 2 extra watches for vast terrain
});
```

`apply(type, data)` returns `true` when the change was made. The other types are the window's
buttons: `rollLost`, `rollSupply`, `resupply`, `resolveWatch`, `rerollEvent`, `setWeather`,
`adjust`, `addFatigueToParty`, `end` and a few more. `apply` runs on the Warden's client only,
and returns `false` on a player's. A player's Lost and Supply rolls reach the Warden through the
journey window. Driving a journey through the window is simpler, and the window stays in step
with what `apply` does.

## 8. Scars, the party and weapon macros

```js
cairn2e.party;                                 // the active party Actor, or null
await cairn2e.scars.open(actor, { hpLost: 4 }); // the Scars window, for a hit that took 4 HP
await cairn2e.rollItemMacro(weapon.uuid);      // what a weapon dragged to the hotbar runs
```

- `scars.open(actor)` without `hpLost` opens the window for a Scar that answers no particular
  hit, as the sheet's Scars tab does.
- `rollItemMacro` takes a weapon's uuid. For an unlinked token, that is the token's own copy of
  the weapon.
- `cairn2e.CairnActor` and `cairn2e.CairnItem` are the system's document classes. The Actor
  types are `character`, `npc` and `party`. Create them with `Actor.implementation.create(...)`:
  the bare global `Actor` is Foundry's own class, and skips the system's creation defaults.

## 9. Hooks

**`cairn2e.animationLabels`** is called once, when the system hands its entries to the
Automated Animations module, with an object your listener adds names to. It is how a
translation makes animations play for translated item names; see
[Translating Cairn 2e](translating.md#5-what-works-by-name-and-in-which-language).

```js
Hooks.on("cairn2e.animationLabels", (labels) => {
  labels["Axe"] = ["Machado"];
});
```

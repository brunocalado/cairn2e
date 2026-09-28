# Changelog

Every release of Cairn 2e for Foundry VTT. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.0.5] - 2026-09-28

### Added

- Drag a gear from your sheet onto another player character's token to hand it over straight
  away, as Barter does: a container goes with what is inside it, what doesn't fit stays with you,
  and a card in the chat says what changed hands. Gear only, as coin goes through Barter.

### Changed

- A Fatigue always takes one of the ten slots and can no longer be put into a container. The
  Backpack in the rules is how a character carries their ten slots, not a container.

## [0.0.4] - 2026-09-27

### Changed

- **Encumbered** can be set and lifted by hand from any token's conditions, a character's
  included. The status, not the slot count, is what puts HP at 0, so the Warden's call is a real
  0 HP. A full inventory still puts it on and freeing a slot still takes it off, and a hand-set
  one holds until an item comes, goes or changes. An NPC's Encumbered also zeroes its HP, follows
  its own slots when it has any, and is the Warden's alone on a creature with none.
- A party Fatigue from the journey (the weather, or a night without camp) posts a chat card
  naming who took it, who had no free slot and must drop an item to take it, and who is Deprived.

### Fixed

- HP held at 0 by Encumbered or Panic shows as a red **0** on the character and NPC sheets, with
  the reason and the real HP in its tooltip. The sheet used to show the untouched HP.
- Casting a spell with no free slot no longer passes for free: the card says no Fatigue was added
  and that an item must be dropped to cast it.

## [0.0.3] - 2026-09-27

### Added

- An **Actions** menu on the character sheet, for the character's owners: **Whisper** (a private
  message spoken as the character), **Barter** (hand gear and coin to another player's
  character, recorded in a chat card) and the macros the Warden picks in a new Settings menu.
- Rest and Restore Abilities post a chat card listing each value they changed.
- A **Report an Issue** link in the sidebar, above Settings and Configuration.
- Translations are modules: `docs/translating.md` is the guide for building one. Tables,
  compendium documents and table results are found by uuid and flags, never by their English
  names, and every phrase the system composes comes from `lang/en.json`.
- The releases are published to the package page on foundryvtt.com.

### Changed

- A Background's d6 results grant their items, spells and coin directly instead of being read
  from the English text, checked row by row against the SRD. Abilities, vows, companions, extra
  HP, a second Bond and an Omen land on the **Growth** tab.
- A new character gets no Backpack: a PC has ten slots with or without one.
- A Warden's imported copy of a system table replaces it whatever it is renamed to. A table
  written from scratch under the same name no longer does.
- `[[/table …]]` accepts a table uuid, which survives a translation renaming the table.
- Barber-Surgeon's body parts and Fletchwind's White Ash carry their armour and damage numbers.

### Fixed

- A container dragged onto another sheet arrives with its contents instead of empty, stowed
  things can be dragged, and coin moves with the rest.
- Kettlewright import: the Main container is the character's own ten slots, not a bag; mounts
  and wagons carry themselves; "Carrying …" placeholder rows are skipped.

## [0.0.2] - 2026-09-23

### Changed

- The journey roster refuses an actor whose token is unlinked, with a warning that names it and
  says how to link it. Its Rations and Fatigue used to land on the directory actor, which no token
  on the map shows. A party brings in its linked members and names the rest.

## [0.0.1] - 2026-09-23

### Added

- First public release.

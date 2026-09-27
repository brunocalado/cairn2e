# Changelog

Every release of Cairn 2e for Foundry VTT. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

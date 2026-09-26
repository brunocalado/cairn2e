# Translating Cairn 2e

Cairn 2e ships in English only. **A translation is a separate Foundry module**, built and
published by whoever makes it: the system itself never carries a second language. This page is
the contract between the two. It says what a translation module must provide, what it may
translate, and what it must never touch.

Nothing the system does depends on the name of a document or on the wording of a table result.
Every compendium document is looked up by its id, and every rule that a table result triggers is
stored as data on the result. A translation can rename and rewrite everything a player reads, and
the system behaves exactly as it does in English. This was verified on Foundry 14.368 with
Babele 2.9.1, with every name, every table result and every interface string translated.

## 1. The module's manifest

A translation module needs two things in its `module.json`:

- **A `languages` entry scoped to this system.** Foundry loads it only when Cairn 2e is the world's
  system.

  ```json
  "languages": [
    { "lang": "pt-BR", "name": "Português (Brasil)", "path": "lang/pt-BR.json", "system": "cairn2e" }
  ]
  ```

- **A compendium translator**, as a dependency of *your* module, never of the system:
  [Babele](https://foundryvtt.com/packages/babele), which itself requires
  [libWrapper](https://foundryvtt.com/packages/lib-wrapper). Register your translation files
  during Babele's own init hook:

  ```js
  Hooks.once("babele.init", (babele) => {
    babele.register({ module: "cairn2e-pt-br", lang: "pt-BR", dir: "compendium" });
  });
  ```

## 2. What to translate

- **`lang/en.json`, in full.** Copy it to your language file and translate every value. The keys
  stay as they are.
- **Every pack's document names and descriptions.** Babele's own *Export translations* produces a
  starting file per pack (`cairn2e.gear.json`, `cairn2e.warden.json`, …).
  - **Items keep their description in `system.description`**, not where Babele looks by default
    (`system.description.value`). Every Item pack's file needs
    `"mapping": { "description": "system.description" }`, or item descriptions stay in English.
- **Table results.** Every RollTable result's `name` and `description`. In Babele's files a text
  result is keyed by its range (`"1-1"`), and a result that points at a document is keyed by its
  `_id`. That second kind takes its name from the document it points at.
- **The Backgrounds' name lists** (`system.names`).

## 3. What never to translate

- **Ids, uuids and `documentUuid`.** The system finds every document through them.
- **Flags** — `flags.cairn2e.*` on table results (`event`, `portrait`, `armour`, `hp`). They are
  what the journey, the NPC generator, the monster generator and the character creator read.
- **Formulas and ranges** — a table's `formula`, a result's `range`, a weapon's damage die.
- **The `{placeholders}` in `en.json` strings.** Keep every one, spelled exactly. You may
  **reorder** them: `"{physique} {feature} Creature"` can become
  `"Criatura {feature} {physique}"`. Only `{article}` in `CAIRN.MonsterGen.Appearance` may be
  dropped: it carries the English "A"/"An", and a language that has no use for it leaves it out.

## 4. Conventions in the text that the system does read

A few table texts carry meaning in their shape. Keep the shape:

- **Scars.** Each row of the *Scars* table is `Title: text`. The Scars window splits on the
  first colon, and the part before it names the Scar.
- **Encounter rows start with their count** (`1d6 Wolves`, `2 Bandits`). A row without a count
  gets no *Add to scene* button, unless it is a result that points straight at an Actor.
- **The random-NPC phrase.** An encounter row that should create a fresh person instead of a
  creature must contain the translated `CAIRN.Encounter.RandomNpc`, exactly as your language file
  spells it (case does not matter). Wardens type this phrase into their own tables, so tell your
  users what it is.

## 5. What works by name, and in which language

Three features match a name, and each does so on purpose, against the name the user sees:

- **The `[[/table …]]` chip**, written with a table's name, matches the names this world shows.
  In a translated world those are the translated names: Babele translates the compendium index
  too. `[[/table Compendium.cairn2e.tables.RollTable.…]]`, written with a uuid, works in every
  language; shipped content should use it.
- **Bestiary art** matches image files to monsters by name. It ignores accents and punctuation, so
  `Cao-Piscante.webp` and `Cão Piscante.webp` both reach "Cão Piscante".
- **Light Sources** (the optional module) matches carried items to its light sources partly by
  name. It works when the world was created with the translation already active.

## 6. What stays English

**The Kettlewright importer.** Kettlewright exports are English, and the importer matches their
item and background names against the compendiums. In a translated world nothing matches, so:

- every item arrives as a bespoke item built from the file's own text;
- the background is reported as unmatched;
- the summary may call the file "not 2e".

Nothing breaks, and the character is still created. This is by design, not a bug to fix in a
translation.

## 7. A Warden's own tables

A Warden replaces one of the system's tables by **importing it** from the compendium into the
world and editing the copy. The system recognises the copy by where it came from, not by its name,
so the copy can be renamed freely. That holds in every language. A table written from scratch is
not picked up, even under the same name.

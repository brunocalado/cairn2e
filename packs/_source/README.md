# `packs/_source/` — the editable compendium

**One rule: edit the JSON here, run the build, never touch `packs/<name>/`.**

`packs/<name>/` is a binary LevelDB directory. Foundry rewrites it on every world launch, git
ignores it, and a hand-edit there is invisible and unrecoverable. This directory is the versioned,
reviewable form: **one JSON file per document**, kebab-cased from the document name.

## Layout

```
packs/_source/<pack-name>/<document-name>.json
```

Each file is the document as Foundry exports it, minus per-install noise:

- `_stats` is stripped (stale `coreVersion` / `systemId` metadata, not content).
- `ownership` is flattened to `{ "default": 0 }`.
- `_id`, `_key` and `folder` are **kept** — stable ids let cross-pack references survive a rebuild.
  A new document needs both `"_id"` (16-char alphanumeric) and `"_key"` (`"!items!<_id>"` for an
  Item, `"!actors!<_id>"` for an Actor); `build-packs.mjs` refuses a file that is missing either,
  because `compilePack` would otherwise skip it silently.

The layout is **flat**, whatever folders a pack has. A compendium Folder is a file of its own,
`_folder-<slug>.json`, beside the documents it holds (`"_key": "!folders!<_id>"`, no `ownership`),
and a document names its Folder by the `folder` id. `build-packs.mjs` holds a Folder file to the
same `_id` / `_key` rule as any document. `npm run packs:extract` writes exactly this layout, and
keeps every file the tree already has under its committed name, matched by `_id` — a Folder's
filename can be its id seed, as `more-gear`'s Valuables bands are — so an extract never leaves a
second copy of anything for the next build to pack twice. `checks/pack-roundtrip.check.mjs` holds
the round trip.

## What a thing costs: `system.slots`

One number, and *petty* / *bulky* are readings of it — `0` and `2` — not fields. A document writes
`"slots": 0` for Chalk, `1` for a Rope, `2` for Plate, and whatever the Warden indicated for the
rare thing that is neither: `srd-2e/wardens-guide/dungeon-seeds.md` prints a Candelabra at four.
There is no `petty` or `bulky` key to write, and a pack that carries one is broken content.

Do not confuse it with `capacity`, which is what a container HOLDS. A Cart costs two slots and
holds four: `"slots": 2, "capacity": 4`. `slotsUsed` / `slotsMax` are the actor's ten and never
appear on an item.

## One carried subtype: `gear`, along three axes

Every carried thing — a sword, a Gambeson, a spellbook, a scroll, a relic, a mule — is a `gear`
Item (`module/data/item-gear.js`), and the folder it ships in is a promise about its fields, not a
subtype: `weapons/` documents carry a `damage` die, `armor/` an `armor` value, `spellbooks/`
`magic: "spellbook"`, `relics/` `magic: "relic"` (whatever the thing looks like — A Blade Called
Hope is a d6 sword **and** a relic, the Obliteration Scroll a one-use relic, never a scroll),
and the Transport lines in `gear/` a `capacity`. A relic's die or +1 Armor is a field, never a
sentence in `description`. The Cart alone `takesSlots` and is *bulky* (it is pulled); the beasts
haul themselves, cost none of the ten, and are never under direct possession. **A document is written out in full** — every field of the
schema, defaults included — so a diff reads the same on every file and validation has nothing to
guess. `checks/compendium.check.mjs` holds all of this.

## Commands

| Command | Direction |
|---|---|
| `npm run packs` | `_source/` → `packs/<name>/` (LevelDB). Validates every `system` payload first. |
| `npm run packs:extract` | `packs/<name>/` → `_source/`. Pull back a document edited in-client. |

Both take optional pack names (`npm run packs -- utils weapons`) and `--verbose`. See the header
of `tools/build-packs.mjs` / `tools/extract-packs.mjs` for the full flag list.

**A running world holds the LevelDB open**, and every pack then fails with `"<name>" is locked —
close the world that has it open and retry`. Nothing is half-written when this happens; stop the
server, build, start it again.

### Validation

`npm run packs` constructs each document's `TypeDataModel` and fails the build if it
throws. This needs Foundry's common library: the scripts look for the install via `FOUNDRY_PATH`
(or `FOUNDRY_VTT_PATH`), then a few guesses next to the repo. If it can't be found:

```
FOUNDRY_PATH=/path/to/FoundryVTT npm run packs
```

Validation catches structural problems — wrong JSON types, an unknown subtype, a `choices`
violation (`"damage": "1d8"`), `petty` + `bulky` together. It does **not** catch out-of-range
numbers: Foundry silently clamps a negative cost to 0, `quantity: 0` to 1, a non-integer to a
round number. Get the numbers right by reading `srd-2e/`, not by trusting the build.

### RollTables are not validated

Validation covers Actor and Item `system` payloads only. A `RollTable` is written by hand and
nothing checks it, so the v14 shape has to be right the first time (confirmed against 14.367
`common/documents/`): a result carries `type: "text" | "document"` (initial `"text"`),
`description` (HTML — the old `text` field is `@deprecated`), and `documentUuid`, a real
`DocumentUUIDField`. The v12 `documentCollection` / `documentId` pair is gone. A result that
grants a document is `type: "document"` + `name` + `documentUuid:
"Compendium.cairn2e.<pack>.Item.<id>"`.

### Ids are stable, so cross-pack references can be authored by hand

A hand-written 16-character `_id` survives `npm run packs` → `npm run packs:extract` unchanged —
only whitespace and key order are canonicalised on the first extract. That is what makes a
background able to name its two RollTables, or a table result a `gear` Item, without looking
anything up.

Every id in these packs is **derived, not invented**: `id16(seed)` = the first 16 bytes of
`md5(seed)`, each `byte % 62` into `[A-Za-z0-9]`, with seeds shaped like
`"cairn2e:background:<slug>"`, `"cairn2e:spellbook:<slug>"`, `"cairn2e:npc:<slug>"`,
`"cairn2e:npc:<slug>:item:<n>"` (1-based, stat-line order), `"cairn2e:hireling:<slug>"` and
`"cairn2e:hireling:<slug>:item:<n>"` (same rule), `"cairn2e:scroll:<slug>"`, `"cairn2e:homebrew:<slug>"`,
`"cairn2e:homebrew:folder:<slug>"`, the five magic packs' price folders (see *Prices on magic*), `"cairn2e:bgtable:<slug>:<n>"`,
`"cairn2e:bggear:<slug>"` and `"cairn2e:bggear:folder:<slug>"`.
`<slug>` is `kebabCase(name)`, the same rule `tools/pack-common.mjs` applies to filenames. Compute
a reference rather than looking it up, and a new document lands with the id everything else
already expects.

An **embedded** Item (a bestiary Actor's weapon or feature) is the one exception: it may be written
without `_id` and `_key`. The first `npm run packs` assigns both — the id with the client's own
`foundry.utils.randomID(16)`, the key as `!actors.items!<parent _id>.<_id>` — and rewrites the
source file; that rewritten file is what gets committed. Nothing references an embedded item by
id, so a random one is as stable as a derived one, and `checks/compendium.check.mjs` asserts the
key of every embedded item against its parent.

## `bestiary` — a monster's bullets are `feature` Items

Every bestiary Actor carries `"role": "monster"`, an empty `system.description`, its statline as
the header and embedded weapon / armour Items, and one embedded **`feature`** Item per bullet of
its SRD entry (`srd-2e/wardens-guide/bestiary.md`), in bullet order, after the weapons. The
naming rule, which the monster generator follows too:

| Bullet | `name` | `system.description` |
|---|---|---|
| `**Magic**: The Boggart can …` | `Magic` | `<p>The Boggart can …</p>` (the rest, HTML kept) |
| `**Critical Damage**: Tears flesh …` | `Tears flesh …` — the whole clause, plain text, with **`"critical": true`** | `""` |
| `Critical Damage: The Night Cat …` (unbolded) | the same: the clause, flagged | `""` |
| `Wild, hairy tricksters that prize shiny trinkets above coin.` | the sentence, plain text | `""` |
| `Fighting a **Basilisk** without meeting its gaze is difficult. (Attacks … are _impaired_.)` | `Fighting a Basilisk without meeting its gaze is difficult.` | `<p>(Attacks … are <em>impaired</em>.)</p>` |

A bullet opening with a **label** and a colon is named by the label; any other bullet is named by
its **first sentence** as plain text (inline tags stripped, the full stop kept), with the remaining
sentences as its description, or `""` for a one-sentence bullet. A colon mid-sentence ("Can cast
the following spells at will: …") is not a label. Every feature wears `FEATURE_ICON`
(`module/constants.js`). There is no separate `criticalDamage` field on an NPC: in every entry
that has one, the bullet already is the feature.

**Critical Damage is the one label that is not a name.** The 29 `**Critical Damage**: …` bullets
are features flagged `system.critical: true`, named by the whole clause (every sentence of it,
inline tags stripped) with an empty description. The sheet prints "Critical Damage:" in blood
before a flagged feature's name, so a feature *named* "Critical Damage" would say it twice —
`checks/compendium.check.mjs` refuses one. "On taking Critical Damage, the hydra …" and "When
taking Critical Damage, a Troll …" are what the monster does when *it* takes it; they are plain
bullets and stay unflagged. A hand-made feature on any NPC becomes a clause the same way, with
the toggle under its name.

## `scrolls` — the hundred spells as the other vessel

`core-rules.md` § Scrolls: "similar to Spellbooks, however: they are *petty*, they do not cause
Fatigue, they disappear after one use." So `scrolls/` is `spellbooks/` again, one document per
spell by the same name, as `magic: "scroll"`, `slots: 0`, `uses: 1/1`. A spellbook document's
italic first paragraph is the *book's* quirk ("Leaves grow along the spine"); a scroll is a
different object and carries only the spell. Ids derive from `cairn2e:scroll:<slug>`.

## `more-gear` — the Homebrew folder's one pack

**Not SRD** (CLAUDE.md § 1, Homebrew). The pack is named for what it holds, not for where it came
from: its first and largest source is Oskar Swida's *More Equipment* list in the cairnrpg.com
repository (`resources/more-equipment.md`), an OSE-derived price list that "does not change any of
the items listed in the SRD, it just adds new ones". That sentence is the pack's rule: **a name the
Marketplace sells is never here** — the check refuses it — and what came from that list was
re-priced onto the Marketplace's own scale (1–200 gp, Wilderness Clothes 15, Common Tools 10,
Room & Board 10) rather than copied from OSE. 119 documents in six compendium folders, one of which has
bands of its own:

- **Clothing** (33) — all *petty*, priced by material: plain cloth 5, leather/wool 15, silk or
  elegant 20–30, formal 40–60, the extravagant ballgown 100. Dropped as SRD duplicates: the three
  Gloves (Marketplace `Gloves`), both Cloaks (`Wilderness Clothes`), Jerkin (`Leather Jerkin` in
  `background-gear/`); the gendered "elegant hat, women's style" folded into `Hat, elegant`.
- **Drink** (7) and **Food** (15) — what a tavern sells, for shopping at the table: drinks by the
  bottle, the three inn meals (0 slots, one use — eaten there), and food that travels (bread,
  cheese, cured meat, fruit, nuts, honey). Raw staples by the pound (flour, lard, a side of beef)
  were left out: the Cairn answer to food is `Rations`, and the Warden may rule any of these a
  Ration. Prices kept within 1–15, under a night's Room & Board; champagne dropped as
  anachronistic. They are two folders rather than one because a Warden pricing a tavern round
  reaches for one of them and not the other.
- **Tools & Gear** (23) — the residue after 41 of the source's 66 lines turned out to be
  Marketplace items under another name or price (Torch 1 vs 5, Lockpicks = Thieving Tools, Cook
  Pots = Cooking Gear, Bedroll = Outdoor Comfort…). Snapped to the analogue: Barding 150 → 60
  (Plate), Large Trap 20 → 50 (it must cost more than the 35 gp Trap it is larger than), Lock
  30 → 25 (Chest), Rope Ladder 25 → 15, Tinder Box 3 → 5 (Torch). Holy Symbol and Holy Water
  dropped: the 2e rules have no religion for them to serve.
- **Transport** (5) — Camel (+3, fast) 75, Donkey (+4, slow) 20, draft Horse (+3) 40, Oxen
  (+6, slow) 60 and the big Cart (+6) 100, modelled like the Marketplace's Horse and Mule:
  `capacity` set, `takesSlots: false`, they haul themselves. The source's riding Horse (+2, 75)
  and Mule (+6, 50) contradict the SRD's and were dropped.
- **Valuables** (36) — the stones a hoard is carried home as, in four subfolders. See below.

Skipped whole from the *More Equipment* list: **Livestock** (creatures without a statline — an
Actor this system will not invent), **Livestock Feed** (`Animal Feed` covers it), Buildings,
Mercenaries, Specialists and Water Vessels. Ids derive from `cairn2e:homebrew:<slug>` and
`cairn2e:homebrew:folder:<slug>` — the seed says `homebrew` where the pack says `more-gear`, and
it stays that way: the seed is an arbitrary string, and changing it would rewrite every `_id` in
the pack to buy nothing.

### `Valuables` — treasure, not stock

The names come from the *Precious Stones Art Pack* by Mestre Digital (a Foundry module), and only
the names: its art is Midjourney under CC BY-NC, which this repository will not ship. Every stone
wears a core Foundry icon from `icons/commodities/`, one apiece, chosen by colour and cut. The 46
files there became 36 documents — `Emerald Brilliant Green` folded into `Emerald`, `Spinel Deep
Blue` into `Spinel`, the two graded pearls into one, `Small Diamond` renamed `Diamond` — and the
seven organics (Amber, Coral, Ivory, Jet, Pearl, Black Pearl, Shell) were dropped as not stone.

Two decisions, both arguable, both made here rather than per document:

- **Priced by band, never per stone, and filed by band too** — the four bands are subfolders of
  Valuables, named with their price, because reading the value off the folder is the whole point
  of splitting them: **Common (10gp)** (Agate, Alabaster, Hematite, Jasper, Malachite, Obsidian,
  Pyrite, Quartz), **Ornamental (25gp)** (Azurite, Bloodstone, Carnelian, Chrysoprase, Rose Quartz,
  Tiger Eye, Turquoise), **Semiprecious (100gp)** (sixteen, from Amethyst to Zircon) and
  **Precious (500gp)** for the five that end a session's haul (Diamond, Emerald, Ruby, Sapphire,
  Star Sapphire). The top band is the SRD's own number: the Bond that hands a character a
  "**Single Gem** (500gp, cold and brittle)" (`players-guide/character-creation.md`). Their ids
  derive from `cairn2e:homebrew:folder:valuables-<band>`, and the check holds every stone to the
  folder its price names — nothing sits loose in Valuables itself.
- **Every stone is *petty*** — `slots: 0`. A bag of coins under 100gp is *petty* and every hundred
  after that is a slot (`character-creation.md` § Inventory Slots), so 500 gp in coin weighs five
  slots and the same value in one sapphire weighs none. That gap is not an oversight: it is the
  reason a hoard gets cut into stones before it is carried anywhere. A Warden who wants a gem to
  cost a slot has the field on the sheet — the Wardens' Guide's own example jewel does exactly
  that, and it is large enough to fill a fist.

## `more-spellbooks` and `more-scrolls` — the same list in both vessels

**Not SRD** (CLAUDE.md § 1, Homebrew). The source is the *More Spellbooks* list in the cairnrpg.com
repository (`resources/more-spellbooks.md`), a d666 table of 216 spells, each one name plus one
line. It is carried the way the SRD carries its own hundred: a `spellbook` pack and a `scroll`
pack holding the same names, priced by the vessel table below (300/600 and 50/100). Ids derive
from `cairn2e:homebrew:spellbook:<slug>` and `cairn2e:homebrew:scroll:<slug>`.

**159 of the 216 came across.** The 57 that did not, by reason:

- **Four share a name with one of the SRD's hundred** — `Fish Lung`, `Masquerade`, `Miniaturize`,
  `Passage`. The first two are the same spell word for word; the check refuses the name either way.
- **Thirty-nine are an SRD spell under another name.** Homebrew adds and never restates, so a
  second `Charm` is a second answer to a question already answered: `Hoodwink Person`,
  `Hoodwink Monster` (Charm) · `Sudden Slumber`, `Song of Repose` (Sleep) · `Pyschic Touch`
  (Read Mind) · `Psychic Eye`, `Peeping Warlock` (Arcane Eye) · `Linguist`, `Philolomancy`
  (Comprehend) · `Mirage`, `Simple Illusion`, `Ephemeral Audio`, `Puppeteer` (Visual / Auditory
  Illusion) · `Obscuring Mist` (Fog Cloud) · `Passive Invisibility` (Shroud) · `Rat-Tat-Tat`
  (Knock) · `Psychokinesis` (Telekinesis) · `Vines of Ichor` (Web) · `Witch Sight`, `Wizardsniff`
  (Detect Magic) · `Obfuscation` (Disguise) · `Fleetfooted`, `Feline Dexterity`, `Wizard's Exit`
  (Haste) · `Mind Bond`, `Ghost Whisper` (Telepathy) · `Inferno`, `Glacier`, `Gale` (Elemental
  Wall) · `Otherworldly Gate` (Gate) · `Shelter` (Manse) · `Fold Portal` (Mirrorwalk) ·
  `Scry Object` (Sense) · `Mind Reader` (Scry) · `Shrinking Cant` (Miniaturize) · `Lamp's Hue`
  (Illuminate) · `Energize Rope`, `Hempen Hoop` (Animate Object) · `Skillfull Repair` (Skillful
  Repair, and misspelled).
- **Nine are a second spelling of a spell already in the table** — `Sorcerer's Lock` (Magic Seal),
  `Thwart the Elements` (Fortify), `Scintillate` and `Pyramid of Passivity` (Induce Despair),
  `Induce Horror` (Terrify), `Hide Mind` and `Disrupt Scry` (Obfuscate), `Minor Aegis`
  (Incorporeal Shrug), `Solar Portal` (Extraplanar Convocation).
- **Five were cut at the table** — `Fire Curse`, `Sinister Flame` and `Librarian's Trap` deal STR
  loss as an attack, which is how a monster hurts a character and skips the HP layer entirely;
  `Addle Brain` (0 WIL for an hour — delirium, by `core-rules.md`) and `Pocket Container` (a
  six-item chest, against a ten-slot inventory) were judged too strong for a 300 gp book.

Three edits to what did come across:

- **Damage caps at d10.** Cairn rolls no attack roll, so a spell's die competes directly with a
  weapon's — and the Marketplace's best is a d10 at 20–30 gp, while d12 is the *enhanced* die.
  `Lightning Strike`, `Icy Tempest`, `Word of Pain`, `Terrifying Illusion` and `Paincurrent`
  were dropped from 1d12 to 1d10; the check refuses a d11 or d12 anywhere in these two packs.
- **Two renames, where the name named nothing in the effect** — `Influence` (armour 3, no running
  or swimming) is **Stone Hide**; `Necrotic Touch` (DEX save or paralysed) is **Rigor Touch**.
- **Three spellings fixed** — `Doppleganger`, `Firey Missile`, `Otherwordly Pet`.

**No book quirk.** An SRD spellbook opens with an italic line in the book's own voice ("*Leaves
grow along the spine*"); the source list has none, and inventing 159 of them is authorship rather
than import. A homebrew book carries the spell and nothing else, and the check holds it to that.

**Fifteen are *greater*** by the rule in the next section — on its own the spell settles something
the party could not otherwise do at all: Astral Step, Banishment, Beguilement, Epidemic,
Extraplanar Convocation, Gorgon's Gaze, Master Undead, Orb of Immortality, Phase Anchor, Secret
Attaché, Sinister Polymorph, Soul Annex, Summon Elemental, Trueshift, Ultimate Sacrifice.

## Prices on magic — a table rule, not an SRD one

`srd-2e/` prices no spellbook, scroll or relic; `core-rules.md` says spellbooks "are recovered from
places like tombs, dungeons, and manors". The `cost` these three packs carry is this system's
own rule, settled 2026-09-21 in the Marketplace's spirit — a price per **category**, never a
number per item — with one exception band:

| Vessel | Common | Greater (×2) |
|---|---|---|
| Scroll | 50 | 100 |
| Spellbook | 300 | 600 |
| Relic with finite uses (no Recharge) | 150 | 300 |
| Relic with a Recharge, or no use count | 300 | 600 |

**Greater** is the one judgment call, and its criterion is written so the list can be argued
with: *on its own, the thing settles something the party could not otherwise do at all — cross a
wall or a plane, undo a death, command a mind, level a building — rather than help with it.*
Anything that only gives an edge (light, smell, a jump, a climb) is common. The lists — 18
spells, 7 relics — live in `checks/compendium.check.mjs`, which enforces every price; moving a
name is a change to the rule and is made there.

**Filed by price.** The price is the one thing that varies inside these packs, so all five —
`spellbooks`, `scrolls`, `relics`, `more-spellbooks`, `more-scrolls` — are filed by it, the way
`more-gear`'s Valuables are: a root folder per band, named with the price, and no document loose
at the root. Books and scrolls have two, **Common (300gp)** / **Greater (600gp)** and
**Common (50gp)** / **Greater (100gp)**. Relics have three named by the number alone —
**150gp**, **300gp**, **600gp** — because 300gp holds both a greater finite relic and a common
recharging one, and no single word names that band. Folder ids derive from
`cairn2e:spellbook:folder:<slug>`, `cairn2e:scroll:folder:<slug>`, `cairn2e:relic:folder:<slug>`,
`cairn2e:homebrew:spellbook:folder:<slug>` and `cairn2e:homebrew:scroll:folder:<slug>`, the slug
being the filename after `_folder-`. Moving a name to the greater list moves its document's
`folder` too; the check holds both.

## `hirelings` — the twelve Marketplace careers, kitted

The `Hirelings (per day)` table (`srd-2e/players-guide/marketplace.md`) names twelve careers and
their rates; `core-rules.md` § Hirelings builds one by rolling 3d6 per attribute, 1d6 HP and
"equipment appropriate to their station". This pack is that, done once per career, from the
example hirelings the cairnrpg.com repository ships beside the SRD (`resources/hirelings.md`):
one `npc` Actor per career, `role: "hireling"`, named by the career, `career` and `dayRate` set,
ten slots, traits blank for the Warden's *Randomize* to fill. The kit is embedded gear — a line
that names a Marketplace document is a copy of it (its cost kept), the rest are written here at
cost 0 like `background-gear/`. Weapons and armour ship equipped so `armorTotal` derives; the
intrinsic `armor` stays 0, because a Gambeson is a thing a Blacksmith can take off.

Three lines were settled against the SRD rather than copied: the Bodyguard's `Sword (d6)` is a
Marketplace Sword (d8); `Chains (10ft)` is the Marketplace `Chain`; and the Animal Handler's
`Hawk [2 HP, 5 STR, 16 DEX, 5 WIL, claws (d4+d4)]` is not in the 2e bestiary (a closed list), so
it ships in this pack as its one creature — a `monster`, like every beast the party runs — and
the handler carries a `Hawk` feature that links it.

## `background-gear` — what a background hands out and the Marketplace does not sell

`gear/`, `weapons/` and `armor/` are the 2e Marketplace table (`srd-2e/players-guide/marketplace.md`)
and nothing else — 56 / 15 / 6 documents, short on purpose. The three melee lines are aggregates
(`Dagger, Cudgel, Sickle, Staff, etc. (d6 damage)`), and `weapons/` spells out every name a line
suggests as its own document at that line's price and weight — so a Cudgel and a Long Sword are
each a thing to buy, not a sentence on the Dagger. A background's starting-gear list names things
that table does not carry: `Boiled Leather (1 Armor)`, `Twine Bauble`, `Soporific Darts`. Those live in **`background-gear/`**, one Item pack of mixed
subtypes, so that Weapons stays six documents long for anyone browsing it to buy something.

The pack is exactly the residue of the twenty `## Starting Gear` lists in `srd-2e/backgrounds/`:
a line that names a Marketplace document points at it, every other line gets a document here.
Nothing is added that no background names. `cost` is 0 throughout — background issue, not
merchandise.

The pack is filed by origin, in compendium folders: one `_folder-<slug>.json` per background that
hands out something of its own, and `_folder-shared.json` for what more than one does — Boiled
Leather (Fletchwind, Marchguard, Prowler). A document can sit in one folder only, which is why
Marchguard has none: its one line here is shared (its Long Sword is a Marketplace weapon). Each
document's `folder` names its folder's `_id`; the folder files are the same shape as
`gear/_folder-transport.json`.

Five lines needed a call, settled 2026-09-15 against the SRD:

| Line | Decision |
|---|---|
| Half Witch — `Spellbook (Thicket: …)` | The `Thicket` document in `spellbooks/`: same spell text, same italic rider. No new document. |
| Jongleur — `Costume` | Its own document. The Marketplace's `Costume Gear (Face Paint, Disguise)` is a disguise kit; a jongleur's costume is what they perform in. |
| Cutpurse — `Lockpicks` | Its own document. The Marketplace's `Thieving Tools (Lockpick, Metal File, etc.)` is the 25gp kit; the SRD's `Lockpick` at 10 is a hireling. |
| Fieldwarden — `Repellent (pick the type, 3 uses)` | Its own document, `uses 3/3`. The Marketplace `Repellent` ships with no use count and stays that way. |
| Fletchwind — `Bow (see table)` | The Marketplace `Bow`. "See table" points at the background's own *How did you earn your bow?* d6, which describes the bow rather than replacing it. |

## Workflow

1. Edit a file under `packs/_source/<name>/`.
2. `npm run packs` (rebuilds every pack) or `npm run packs -- <name>`.
3. Relaunch the world. Skipping step 2 makes the change a no-op that reads like a code bug.

Authoring a pack that others reference: author it, build, extract once to canonicalise, then wire
the references.

### A manifest change can stale the packs without touching a source file

The build writes each document **cleaned through its schema**, so any field whose `initial` reads
from the manifest is resolved at build time and frozen into the LevelDB. No source file here
mentions `prototypeToken`, yet every Actor in `bestiary/` carries a full one, and its
`bar1.attribute` / `bar2.attribute` are whatever `system.json`'s `primaryTokenAttribute` and
`secondaryTokenAttribute` said on the day it was built.

So: **editing one of those two manifest keys means `npm run packs`, even though `_source/` did not
change.** Observed — after swapping the two, a monster imported from the pack still showed the old
bar assignment while a newly created Actor showed the new one, which reads like the override is
broken rather than like stale build output. The same applies to `grid.distance` / `grid.units`,
which seed a Scene's grid the same way.

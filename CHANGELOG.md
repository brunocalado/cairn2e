# 0.0.8

- [Added] The Warden can mark a relic **unknown**. Until it is revealed, its holder sees a name and an
  appearance the Warden wrote, on the sheet, in Barter, in the Store and in every chat card, and
  cannot use it: no equip, no charge, no damage, no post. They can still carry it, set it aside,
  stow it and hand it over. **Reveal** in the relic's title-bar menu tells the table what it was.
- [Added] A **Name Generator** in the Warden's tools builds names by the Warden's Guide's Naming
  Procedures: places, terrains, factions, realms and forests, one tab each, showing every part and
  its die and rerolling any one of them. The words are new tables in the Warden Tables compendium,
  and Generate Faction now names its page by the Faction Names Formula.
- [Added] A **Calendar** replaces the watch chip, kept on Foundry's world time in the Vald calendar:
  twelve months of 24 days, a six-day week, four seasons and the Reclamation in years ending in 0.
  It shows today, a watch dial with the time and a month grid, and opens from the Notes controls,
  a Calendar hotbar macro, the character's Actions menu and the Warden's tools. The Warden sets the
  time by dragging the needle, moves a day back or on, makes any day today and shows the calendar
  to every player. A new world starts on 1 Mourning 7728, 06:00.
- [Added] The Warden can add **notes** to any day of the calendar: a title, text, a length, every year
  or once, Warden only or everyone. A new world starts with the SRD's 24 dated events.
- [Added] The Warden can apply **any roll** in the log as damage, from its context menu or the Apply as
  damage button under a bare roll, to HP or to one attribute, with or without armour. Each applied
  hit's card carries a **Reverse the hit** button, so one roll applied to several targets can be
  undone for one of them.
- [Added] A gear or a growth lists the **actors and gear it grants**, dropped on it and dragged back out.
  A granted Actor dragged onto the scene becomes one linked copy owned by the item's players; the
  five background companions use it.
- [Added] The character creator offers the world's own Backgrounds under **Other Backgrounds**, beside
  the SRD's twenty, and a Warden's imported copy of one stands in for it.
- [Added] A growth's Description carries a help mark explaining Downtime Milestones and their Costs.
- [Changed] A targeted token is marked with thick ink brackets and a blood-red cross that read on any
  map, and other players' target pips are larger.
- [Changed] The Warden's tools are grouped into Generators, Campaign and Reference.
- [Changed] Morale, Reaction and both faction rolls are whispered to the Wardens, with no private-roll
  card left in the players' log; so is the Dungeon Event card.
- [Changed] Dungeon exploration: **Next Turn** asks first when someone moved past torchlight with no
  event rolled, and the distance moved is green within 40 ft, amber past it and red past 120 ft,
  starting again from 0 each turn.
- [Changed] An item's description is an editor that is always open for whoever may edit it; the
  pencil is gone.
- [Changed] The NPC edit window and a growth's gain take two-digit attributes (0-99), and an NPC's day
  rate up to 9999.
- [Changed] Rules Summary's Show to everyone moves to the title bar, and the window opens as tall as
  its longest column.
- [Fixed] Light Sources 0.5.0 is registered on every client.

# 0.0.7

- [Changed] With **Light Sources** 0.3.0, a lit Torch, Lantern, Candle Helmet or Lightsucker Candle is the
  item that burns: lighting it spends one of its own uses and the flame stays on it. Remove it
  from the sheet and it goes out, hand it to another character (through Barter or a drag between
  sheets) and it arrives lit, and a module that carries items onto the map, such as Canvas Loot,
  takes the flame with it.

# 0.0.6

- [Added] A **Rules Summary** window puts the player's rules on one landscape page, worded from the 2e
  SRD. The Warden opens it from the system tab and can show it to everyone; a character opens it
  from Actions, under Barter.
- [Added] A new world imports the system macros into a Cairn 2e folder, and every player gets the saves,
  the Die of Fate, the two rests and the Rules Summary on their hotbar at their first login,
  including seats made in User Management. Morale and Reactions stay the Warden's. The Warden's
  **Reset Player Hotbars** macro puts the player macros back without touching other slots.
- [Added] **Unarmed** is a real d4 gear every character is born with, so it can be renamed, re-died or
  deleted.
- [Added] A gear can be **bodily** (part of the body: no slot, always to hand, never set aside, stowed,
  traded or sold) or **paired** (the SRD's d8+d8, rolled keep-highest). The bestiary's natural
  attacks are bodily and its dX+dX attacks paired; the Barber-Surgeon's alchemical sigils are
  bodily armour.
- [Added] A **Companions** pack holds the creatures backgrounds grant (the Blood Pail's servant, the
  Raven Familiar, the hollow wolf, the Homunculus, the Falcon) at their SRD stats, linked from
  what grants them. Item and NPC descriptions and a relic's recharge read as enriched text until
  their pencil is pressed, so links work.
- [Added] With **Automated Animations** active, Cairn's weapons, monster attacks and spells animate and
  sound (JB2A Patreon and PSFX). Each entry is added once per world, and a world setting stops
  further additions.
- [Added] With **Dice So Nice**, every die but the d20 wears the Cairn Blood Moon theme by default;
  players can pick another.
- [Added] The character creator explains STR, DEX and WIL behind a help mark on each box; Blast and
  Paired carry one too.
- [Changed] The Petty tab holds a **Body** zone over Petty Items, and the Belongings tab is now **Aside**.
- [Changed] An item dropped on a token no longer changes hands: the Barter window is the one way to trade.
- [Changed] A new token's defaults are written once at creation instead of through Prototype Token
  Overrides, so the Warden can change Display Name, Display Bars and Lock Rotation freely. A PC
  starts seeing 5 grid units.

# 0.0.5

- [Added] Drag a gear from your sheet onto another player character's token to hand it over straight
  away, as Barter does: a container goes with what is inside it, what doesn't fit stays with you,
  and a card in the chat says what changed hands. Gear only, as coin goes through Barter.
- [Changed] A Fatigue always takes one of the ten slots and can no longer be put into a container. The
  Backpack in the rules is how a character carries their ten slots, not a container.

# 0.0.4

- [Changed] **Encumbered** can be set and lifted by hand from any token's conditions, a character's
  included. The status, not the slot count, is what puts HP at 0, so the Warden's call is a real
  0 HP. A full inventory still puts it on and freeing a slot still takes it off, and a hand-set
  one holds until an item comes, goes or changes. An NPC's Encumbered also zeroes its HP, follows
  its own slots when it has any, and is the Warden's alone on a creature with none.
- [Changed] A party Fatigue from the journey (the weather, or a night without camp) posts a chat card
  naming who took it, who had no free slot and must drop an item to take it, and who is Deprived.
- [Fixed] HP held at 0 by Encumbered or Panic shows as a red **0** on the character and NPC sheets, with
  the reason and the real HP in its tooltip. The sheet used to show the untouched HP.
- [Fixed] Casting a spell with no free slot no longer passes for free: the card says no Fatigue was added
  and that an item must be dropped to cast it.

# 0.0.3

- [Added] An **Actions** menu on the character sheet, for the character's owners: **Whisper** (a private
  message spoken as the character), **Barter** (hand gear and coin to another player's
  character, recorded in a chat card) and the macros the Warden picks in a new Settings menu.
- [Added] Rest and Restore Abilities post a chat card listing each value they changed.
- [Added] A **Report an Issue** link in the sidebar, above Settings and Configuration.
- [Added] Translations are modules: `docs/translating.md` is the guide for building one. Tables,
  compendium documents and table results are found by uuid and flags, never by their English
  names, and every phrase the system composes comes from `lang/en.json`.
- [Added] The releases are published to the package page on foundryvtt.com.
- [Changed] A Background's d6 results grant their items, spells and coin directly instead of being read
  from the English text, checked row by row against the SRD. Abilities, vows, companions, extra
  HP, a second Bond and an Omen land on the **Growth** tab.
- [Changed] A new character gets no Backpack: a PC has ten slots with or without one.
- [Changed] A Warden's imported copy of a system table replaces it whatever it is renamed to. A table
  written from scratch under the same name no longer does.
- [Changed] `[[/table …]]` accepts a table uuid, which survives a translation renaming the table.
- [Changed] Barber-Surgeon's body parts and Fletchwind's White Ash carry their armour and damage numbers.
- [Fixed] A container dragged onto another sheet arrives with its contents instead of empty, stowed
  things can be dragged, and coin moves with the rest.
- [Fixed] Kettlewright import: the Main container is the character's own ten slots, not a bag; mounts
  and wagons carry themselves; "Carrying …" placeholder rows are skipped.

# 0.0.2

- [Changed] The journey roster refuses an actor whose token is unlinked, with a warning that names it and
  says how to link it. Its Rations and Fatigue used to land on the directory actor, which no token
  on the map shows. A party brings in its linked members and names the rest.

# 0.0.1

- [Added] First public release.

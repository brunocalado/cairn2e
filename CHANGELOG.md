# 0.1.2

- [Added] **A Bond gives what it names.** The Strange Compass and 20gp, the Stone Heart, the half
  Ancient Key and the rest arrive in the new character's inventory. The creator lists them under the
  Bond, rewording the Bond keeps them, and the **×** beside one leaves it behind.
- [Added] **A second Bond or an Omen from the Background.** The Foundling draws an Omen whatever
  their age, and the Fieldwarden and the Outrider's *Always Pay Your Debts* roll a second Bond. The
  roll is recorded on the Growth tab, and a second Bond hands over its things like the first.
- [Changed] **Morale.** Every opponent's row in the combat tracker has a Morale flag the Warden can
  roll at any moment. When a trigger is crossed (first casualty, half their number down, or a lone
  foe at 0 HP) the Warden is whispered one reminder, which rolls nothing. The tracker's banner is
  gone.
- [Changed] **Critical Damage** is rolled once per hit, by the target's owner, from any scene. A
  detachment that fails it is routed rather than dead.
- [Changed] Scar row 3, *Walloped*, makes the character Deprived and waits on the Growth tab for its
  1d6 to max HP, like the other Scars whose gain comes later.
- [Changed] Each kind of item has its own sheet, so a coin, a Fatigue or a feature shows no button
  it never uses. A gear's slot count now goes up to ten.
- [Changed] The calendar, the journey window and a sheet's **−** / **+** steppers redraw only what
  changed, and feel faster.
- [Fixed] **Barter** takes any number of recipients, takes the coin before it asks, and lands a
  trade once even when the answer is slow.
- [Fixed] **Coin, containers and stores** lose and duplicate nothing: a sack moved into its own
  container stays whole, an item dropped on a container's sheet from another actor moves instead of
  copying, and the checkout refuses a sale whose container filled up since. A Kettlewright import
  fills each container with its own contents.
- [Fixed] **Journeys.** A watch resolves once per click, a Supply roll made for another crew is
  dropped, Camp or Supply with nobody does nothing, arrival is announced once, and an encounter is
  marked *Added* only when something was placed. The Wilderness Event rows are the Warden's alone.
- [Fixed] **The party sheet.** A row always edits the member it shows, a deleted member can be
  removed, a row dragged from another party joins it, and an item dropped on the sheet is refused
  with a warning instead of vanishing from the character it came from.
- [Fixed] **Unlinked tokens** are their own creature: their conditions follow their own inventory,
  and a hotbar macro made from their weapon rolls that weapon.
- [Fixed] A sheet its viewer cannot edit shows no control that edits. The Scars window is one per
  character and takes one Scar per confirm, and deleting a Scar never leaves negative HP. A monster
  re-roll keeps the Warden's description, and a promoted hireling has fists.
- [Fixed] **Reverse the hit** gives back exactly what Apply took when the roll had a fraction. A link
  to another item in a description works on its chat card. Names typed by players reach chat as
  text.
- [Fixed] A new calendar note opens on the day that was clicked.

# 0.1.1

- [Changed] **Automated Animations plays Cairn's own menu.** The first time a world loads, the
  system's entries replace AA's Automatic Recognition menu, whose defaults are made for D&D; a
  later version only adds its new entries, so an entry the Warden edits or deletes stays that way.
  An existing world gets the replacement once, on its next load: export AA's menu first to keep
  any entry made by hand.
- [Fixed] **Every weapon and monster attack in the compendiums animates with a PSFX sound.** Sword,
  Dagger, Mace, Spear, Rapier, Hand Axe, Great Sword, Bow, Crossbow, Bite and Claws played silent,
  and whips, saws, the Fletchwind's bows, the Background explosives and many Bestiary attacks
  played nothing at all. Last Breath swings a short sword instead of breathing fire.

# 0.1.0

- [Added] **Players visit stores on their own.** A store the Warden marks *Players can visit*
  opens from a **Stores** button beside the Gold on a player's character sheet, and a list at the
  top of the window moves between every store open to them. A door beside the Warden's store
  picker shows, green or red, whether players can visit the store on screen.
- [Added] A new world starts with **ten small stores**, from the Weaponsmith to the Tavern, open to
  visits and selling the Marketplace between them. The Warden's **Restore Default Stores** macro
  brings them back after a warning.
- [Added] A **Player's Guide** compendium holds the SRD's rules chapters, one page per section,
  linked to the items, tables, hirelings and backgrounds they name, with a roll button on every
  table the text says to roll.
- [Added] **Any gear can be unknown** to its holder, not only a relic. The eye in the item sheet's
  title bar hides or reveals it, and a **Guise** tab holds the name, picture and appearance its
  holder sees in its place, on the sheet, in Barter, inside a container and on a store's shelf.
- [Added] **Weather on the calendar.** A cloud beside the selected date rolls that day's season on
  the *Weather in Vald* table and writes the result as a note everyone sees. The four tables are in
  the Warden Tables compendium.
- [Added] The chat box shows the world's **date and time** between its Format menu and its text.
- [Added] **Dungeon exploration.** Each row offers the rulebook's actions in a list, each with its
  rule; a panicked character can **Shake off panic** from there; an undo takes a token back to
  where the turn began; and a help mark in the header explains the turn and opens the Rules
  Summary. The acted mark is a switch, and each row is laid out on one grid.
- [Changed] The character creator's **Bond** and **Omen** are text boxes: a roll fills one, and
  what it holds, reworded or written from nothing, is what the character keeps. The HP box has a
  help mark that says what Hit Protection is.
- [Changed] A store's shelf and a shopper's own list are in alphabetical order, by the name the
  viewer reads. The Gloves are sold at the Tailor instead of the Toolmaker.
- [Changed] The Scars window keeps the row the HP lost for a player answering a hit, and its dice
  roll through Dice So Nice for the whole table.
- [Fixed] The Guise tab shows a new name and picture set from outside the sheet without being
  reopened.
- [Changed] The README and the user guide cover this version, with new screenshots of a dungeon
  exploration and of an unknown gear from both sides, and every screenshot is now WebP.

# 0.0.9

- [Changed] An unknown relic's appearance, a relic's recharge and an NPC's description are always
  open for whoever may edit them, as an item's description is: click and type, and the text is
  saved on leaving the box. The pencil is gone; a reader sees the text with its links working.
- [Changed] The README and the user guide cover 0.0.8, and the user guide carries screenshots of
  every surface it describes, all taken on the current look.

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

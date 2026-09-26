# Cairn 2e — user guide

How to play **Cairn Second Edition** on **Foundry VTT v14** with this system: where each button
is and what it does. It is written for the Warden (the game master) and the players alike. It does
not teach the rules: they are in the Cairn 2e books and free online at
[cairnrpg.com](https://cairnrpg.com).

**Contents**

1. [Getting started](#1-getting-started)
2. [Making a character](#2-making-a-character)
3. [The character sheet](#3-the-character-sheet)
4. [Items, magic and containers](#4-items-magic-and-containers)
5. [Rolling dice](#5-rolling-dice)
6. [Damage, Critical Damage and Scars](#6-damage-critical-damage-and-scars)
7. [Combat](#7-combat)
8. [Conditions](#8-conditions)
9. [Growth](#9-growth)
10. [The party](#10-the-party)
11. [Stores and coin](#11-stores-and-coin)
12. [Warden tools](#12-warden-tools)
13. [Journeys through the wilderness](#13-journeys-through-the-wilderness)
14. [Handy shortcuts in text](#14-handy-shortcuts-in-text)
15. [Macros](#15-macros)
16. [Compendiums](#16-compendiums)

---

## 1. Getting started

### A new world

Create a world on the **Cairn 2e** system and launch it. The first time it opens you get:

- a **Welcome** scene, with its own music;
- the game master seat renamed to **Warden**, which is what Cairn calls it.

If players should build their own characters, open **Configure Settings → Permissions** and allow
**Create Actor** for the Player role.

### The Cairn 2e tab

The system adds its own tab to the right-hand sidebar, **Cairn 2e** (the skull icon). Its buttons
depend on who you are:

| Section | Who sees it | Buttons |
|---|---|---|
| **Characters** | anyone allowed to create actors | Generate character · Import from Kettlewright |
| **Warden Tools** | the Warden only | Generate NPC · Generate Hireling · Generate Monster · Generate Faction · Store |
| **Wilderness** | the Warden only | Journey |

A player who cannot create actors does not see the tab at all, and doesn't need it.

### Settings

Most of Cairn's rules have no on/off switch: they just apply. **Configure Settings** has only
two options for this system, **Bestiary artwork** and **Bestiary artwork folder**: use your own
pictures for the monsters in the Bestiary compendium (see [§16](#16-compendiums)). What a store
charges and pays is set on each store (see [§11](#11-stores-and-coin)).

### Recommended modules

Both are optional:

- [Dice So Nice](https://foundryvtt.com/packages/dice-so-nice) rolls your dice in 3D, including a
  custom Cairn d20.
- [Light Sources](https://github.com/brunocalado/light-sources) lights torches, lanterns and
  candles from the token's right-click menu and spends their uses as they burn.

---

## 2. Making a character

### The character creator

**Generate character** in the Cairn 2e tab opens a guided window with seven steps. Use **Back**
and **Next** to move between them:

1. **Background**: roll a d20 or pick one from the list. The Background gives you a list of names,
   your starting gear and two small tables to roll on.
2. **Name**: pick one of the Background's names, roll one, or type your own.
3. **Attributes**: press **Roll 3d6 × 3**. If you like, pick two attributes and **Swap** them,
   once. Roll your **HP** here too.
4. **Background tables**: roll each of the Background's two tables. When a result names an item,
   you get that item.
5. **Traits**: press **Roll all**, or roll the eight traits one by one.
6. **Bond**: roll a Bond and an age. Tick **Youngest character** if that is you, and you roll an
   **Omen** too.
7. **Review**: check everything, then press **Create Character**. Anything you left blank is rolled
   for you. Every new character also starts with a **Backpack**.

**Rolled once.** A player's attribute roll, swap and HP roll are kept even if they close the
window, so closing it doesn't give a re-roll. The Warden can allow a new try from the character
sheet's menu (the cog icon): **Reset generator rolls**.

**Re-making an existing character.** The same window opens from a character sheet's menu
(**Generate Character**). There the last button is **Apply**. It replaces the character's name,
attributes, identity and items, and keeps their containers and what's in them. The Warden also has
**Regenerate** in that menu, which re-rolls the whole character at once after asking to confirm.

### Importing from Kettlewright

If you built your character in [Kettlewright](https://kettlewright.com), the Cairn companion app,
export it there as **JSON**. Then press **Import from Kettlewright** in the Cairn 2e tab and pick
the file. A new character is created and its sheet opens, followed by a short summary.

- It brings over the name, attributes, HP, gold, Background, Bond, Omen, age, traits, the
  Deprived and Panicked states, the portrait (when the export has a web address for it), and the
  items and containers.
- Items with the same name as something in the compendiums become that exact item. Everything
  else is created from the file's own text.
- **Descriptions, notes and scars are not imported.** Copy those by hand.
- The import works **one way only** and does its best. Read the summary, then compare the sheet
  with the original.

---

## 3. The character sheet

### The top of the sheet

- **Portrait and name.**
- **Background and age.** Drag a Background from the compendium onto its spot to set it.
- **Panicked** and **Deprived**: click one to turn it on or off.
- **Rest** restores lost HP. **Restore Abilities** restores STR, DEX and WIL to their maximum. Both
  are crossed out and refuse while you are **Deprived**, as the rules say.
- **Die of Fate** rolls a d6 in the open.

### Attributes and HP

**STR**, **DEX**, **WIL** and **HP** each show `current / max`. The **−** and **+** buttons change
the current value (hold one down to keep counting). Click the attribute's name to roll a save
(see [§5](#5-rolling-dice)).

**Armor** is worked out for you: it adds up the armor you have equipped, up to a maximum of 3.

### The edit window

The quill icon opens **Edit Character**. That's where you type things in: maximum attributes,
traits, Background answers, Bond, Omen and description. Press **Save** when you're done. The sheet
itself is for reading and playing at the table.

### Gold

The gold amount sits at the end of the row of tabs. Click it and type a new total. Coins are real
items that take space, so see [§11](#11-stores-and-coin) for how they are carried.

### Tabs

| Tab | What it holds |
|---|---|
| **Inventory** | Your ten numbered slots. A *bulky* item takes two slots. Next to the slots is the **Fatigue** track: click an empty circle to take a Fatigue, which fills a slot, and click a marked one to clear it. |
| **Petty** | Small things that take no slot. |
| **Belongings** | Things you own but aren't carrying, such as gear left at camp or on a mule. |
| **Identity** | Your Background answers, the eight traits, Bond, Omen and description. |
| **Growth** | Your Scars and your Growth: how the character has changed through play (see [§6](#6-damage-critical-damage-and-scars) and [§9](#9-growth)). |

**Too much to carry.** When all ten slots are full, your HP counts as 0 until you make room. Your
real HP isn't lost: free a slot and it comes back. You can't pick up an eleventh slot's worth at
all; drop something first.

### Items on the sheet

Each item row has small buttons: **equip / unequip**, **use / restore a use**, **set aside** (it
moves to Belongings, and the same button brings it back), **post to chat** and **delete**. A
weapon has a die button that rolls its damage.

To add something, drag it from a compendium onto the sheet, or press **+** on a tab and pick a
kind: gear, weapon, armor, spellbook, scroll, relic, container or coin.

---

## 4. Items, magic and containers

### Magic

- **Spellbooks**: the cast button reads the spell aloud and adds a **Fatigue** for you. If you are
  **Deprived**, you are asked first: roll the WIL save, or cast without it if the Warden allows.
- **Scrolls**: petty (no slot), and they cause no Fatigue. Reading one uses it up, and you are
  asked to confirm first.
- **Relics**: cause no Fatigue and have a limited number of uses. Their sheet has a **Recharge**
  tab that says what brings the uses back.

### Containers

A container is an item that holds other items: a backpack, a sack, a mule. Every new character
has a 6-slot **Backpack**.

- To put something inside, drag it onto the container's row on your sheet, or onto the container's
  own window. The container's **Contents** tab lists what's inside and has a button to take things
  out.
- Drag an item anywhere else on the sheet to take it out again.
- A container can only hold things while someone carries it. It refuses anything that doesn't
  fit.
- Deleting a container deletes what's inside too, and you are asked to confirm.
- **Takes Slots** decides whether the container uses your own slots. A backpack or a hand-pulled
  cart does. A horse, a mule or a wagon hauls itself, so it takes none and sits among your
  Belongings.

The Gear compendium has a **Transport** folder with a **Cart** (4 slots), **Horse** (4), **Mule**
(6) and **Wagon** (8).

---

## 5. Rolling dice

| What | How |
|---|---|
| **Save** | Click **STR**, **DEX** or **WIL** on the sheet. You roll a d20 and need to roll equal to or under the attribute. A 1 always succeeds and a 20 always fails. |
| **Weapon damage** | Click the die on the weapon's row. A small window offers **Impaired** (a d4), **Enhanced** (a d12), **Blast**, and **Second weapon** (roll both weapons' dice and keep the highest). **Shift-click** skips the window. A Panicked attacker is always Impaired. |
| **Die of Fate** | The button at the top of a character sheet, or the macro. |
| **Reaction** | The button at the top of an NPC sheet, or the macro. It rolls 2d6 on the Reaction table. |
| **Morale** | The button at the top of an NPC sheet, or the macro. It rolls a WIL save for the enemy. Player characters never roll Morale. |

**One-click weapon macro.** Drag a weapon from your sheet onto the hotbar (the row of numbered
slots at the bottom of the screen). Clicking that slot rolls the weapon's damage.

---

## 6. Damage, Critical Damage and Scars

### Applying damage

1. Target the tokens that were hit.
2. Roll damage. The Warden sees an **Apply damage** button on the chat card. **Shift-click** it to
   re-target instead.
3. The system takes the target's armor off the damage, removes it from HP, and carries whatever is
   left over onto STR.

The result card shows what happened. When STR was lost, the target's owner gets a **Roll STR save**
button on the card for Critical Damage. At STR 0 the target is dead.

**Undoing a hit.** Applied it to the wrong token? The Warden can right-click the result card in the
chat and pick **Reverse the hit**. The HP and STR it took are given back.

### Scars

When a hit takes a player's character to **exactly 0 HP** without touching STR, that player gets
the **Scars** window. The right row of the Scars table is already chosen. Roll where it landed,
then press **Take this Scar**.

Some Scars only give their benefit later, for example "once mended". Those wait on the **Growth**
tab, where you roll the benefit when the Warden agrees the time has come. **Add a Scar** on the
same tab records a Scar that no hit produced. Deleting a Scar puts any maximum it raised back where
it was.

---

## 7. Combat

Cairn has no initiative. Each round the adventurers act, then their opponents. The combat tracker
is built around that:

- It shows two groups, **Adventurers** and **Opponents**, instead of an initiative list.
- Each row has a button to **mark it as having acted** this round. Players can mark their own
  characters.
- The group that still has to act is written in full ink, and every token of that group is marked
  on the map.
- In the **first round** each player character has a button to roll the **DEX save** the rules ask
  for. Anyone who fails loses that turn.
- The Warden gets a reminder when the opponents owe a **Morale** save: on their first casualty,
  and when half of them are down. Players don't see it.

---

## 8. Conditions

Right-click a token and open its conditions list. The system replaces Foundry's usual list with
Cairn's ten conditions, each with its name beside the icon:

**Critical Damage · Dead · Delirious · Deprived · Doomed · Encumbered · Fatigued · Fleeing ·
Panicked · Paralyzed**

- **Fatigued** and **Encumbered** are set by the system for characters, from their Fatigue items
  and full slots. They can't be switched on by hand for a character.
- **Panicked** makes the character count as having 0 HP and makes all their attacks Impaired.
- **Doomed** comes from one row of the Scars table. **Fleeing** marks an enemy that failed its
  Morale.
- The rest are markers you set yourself. They remind the table, and the rules are yours to run.

---

## 9. Growth

In Cairn, characters change through what happens to them, not through experience points. The
**Growth** tab is where that is recorded.

1. When the Warden says the character has grown, press **Add a Growth** on the Growth tab. (A
   Growth can't be dragged in from elsewhere: it is earned in play.)
2. A Growth can have **milestones**, a list of steps to tick off.
3. When it pays off, press **Record the gain**. Either pick which maximum it changes (HP, STR, DEX
   or WIL) and to what, or write the gain in words (for example "no longer needs Rations").

Deleting a Growth puts back any maximum it changed.

---

## 10. The party

A **Party** is a special kind of actor that holds the group together. Create one in the Actors
directory like any other actor and choose **Party** as its type.

- **Drag characters onto its sheet** to add them. The order of the list is the **marching order**;
  drag rows to change it.
- The sheet has two tabs: **Party** for the player characters and **Followers** for hirelings,
  mounts and other companions. Each row shows that member's HP, attributes, armor and load at a
  glance. Click a name to open their sheet.
- **Press P** to open the active party's sheet from anywhere. To choose which party is active,
  right-click it in the Actors directory and pick **Make this the active party**. (You can change
  the key under **Configure Controls**.)
- **The party token.** Put the party's token on the map to travel as one piece. Right-click it to
  **Gather the party in** (the members' tokens go into the party token) or **Set the party down**
  (they come back out around it). A member can be held back from travelling with the party with
  the button on their row.

---

## 11. Stores and coin

### Coin

Coins are items. There is one sack per place: one on your body, one in each container, one among
your Belongings.

- **Spending** takes coins from your body first, then from containers you carry, then from what's
  further away (the mule, the sack left at camp).
- **Gaining** puts coins on your body if they fit. If they don't, you are asked which container
  should take them. Only containers with room for the whole amount are offered.
- A sack of less than 100 gold is petty and takes no slot. Every full hundred takes one slot, and
  the system won't let a pile of gold overflow your slots.

### Stores

The Warden opens **Store** from the Cairn 2e tab.

**For the Warden:**

- **New** makes a store. Give it a name.
- Fill its shelves by dragging items, or a **whole folder** of items, from a compendium or the
  Items directory. The **×** on a row takes it off the shelf.
- **Settings** sets what this store charges (100% is the book price, more is expensive, less is a
  sale) and what it pays when buying from characters (it starts at 50%, the usual half).
- Prices come from the items themselves. To change a price everywhere, edit the item.
- **Open to players** opens the store on every player's screen.

**For players:**

- The **For sale** tab lists the shelves. The **Yours** tab lists your own things that have a
  price.
- Add things to the **cart** with **+** or by dragging them. The bottom of the window adds up the
  **gold** and the **slots** you'd need.
- **Confirm** stays greyed out, with the reason, while you are short of coin or the things won't
  fit. Once it goes through, the gold and items are moved for you.

---

## 12. Warden tools

These buttons are in the **Warden Tools** section of the Cairn 2e tab. Only the Warden sees them.

### Generate NPC / Generate Hireling

One click creates a complete NPC: name, attributes, HP, appearance, a quirk, a goal, a virtue and
a vice, plus a Background (for an NPC) or a **career and daily wage** (for a hireling). It also
gets a few basic items (Rations, a Torch, a weapon, armor, and a hireling's work tools), so its
Armor is real.

**The NPC sheet** has **Roll Morale**, **Roll Reaction** and a **Detachment** switch. A detachment
is a large group fighting as one: its attacks are Enhanced and hit everyone nearby (Blast), and
attacks against it are Impaired.

- **Edit window.** Each identity field has a die that rolls just that field. **Randomize** rolls
  them all, and **Save** keeps the result.
- **Tabs.** **Items**, **Features** (special abilities), **Identity** and **Description**.
- **Menu (cog icon).**
  - **Re-roll NPC** rolls new stats but keeps the name, picture, token, description and any items
    you added by hand.
  - On a hireling, **Promote to Player Character** turns them into a full character and can hand
    them to a player, for example after a character dies.

### Generate Monster

Pick how tough it is: **Standard** (3 HP, d6 attack), **Hardier** (6 HP, d8), **Serious** (10 HP,
d10) or **Random**. You get a hostile monster with an attack, its special abilities as Features,
and sometimes armor. **Re-roll Monster** in the sheet's menu makes a new one.

### Generate Faction

Rolls the Faction tables and writes the result as a page in a journal called **Factions**. Every
new faction is another page there, and each page can be shown to the players on its own.

A faction page is a form you keep up to date as the campaign goes:

- **Type and traits**, **Advantages**, **Agents** (in order of rank), an **Agenda** of goals you
  tick off as they are achieved, and **Obstacles**. Each list has a die that rolls a new entry
  from its table.
- **Drag an actor** onto the page to make it an agent. Its WIL is read straight from its sheet.
  **Drag an item** onto the page to make it an advantage.
- **Drag an agent** onto another to change their rank. The top agent rolls when the faction is
  opposed.
- **Faction action** rolls what the faction does this time, and tells you whether it gains or loses
  something. You then edit the page to match.
- **Opposed save**: when two factions clash, the one most at risk rolls WIL with its top agent. On
  a fail, it doesn't act this time.

### Encounters from tables

When the Warden rolls an encounter table and a result names creatures ("1d4 Wolves"), the chat
card gets an **Add to scene** button. It rolls how many there are, brings the creature in from the
Bestiary, and places neutral tokens in the middle of your view. A "random NPC" result creates a
fresh NPC instead. The button works once per card.

Meeting a creature is not fighting it, so roll a **Reaction** to see how it goes.

### Using your own tables

Every table the Warden tools roll on (NPC, monster, faction, travel and encounter tables) can be
replaced with your own. **Import** the table from the **Warden Tables** compendium into your world
(right-click it and choose Import, or drag it into the Roll Tables sidebar), then edit your copy:
the generators use yours instead. You can rename your copy, and it survives system updates.

A table you build from scratch is not picked up, even with the same name. Start from ours and
change it.

---

## 13. Journeys through the wilderness

**Journey** in the Cairn 2e tab opens a window, shared with everyone, that runs travel watch by
watch.

### Setting out

The Warden picks the **path** (road, trail or wilderness), the **distance**, the **terrain**, the
**season**, and up to two extra watches for especially vast land. Then press **Begin the journey**.
A card appears in the chat with an **Open the journey** button for everyone. **Show to everyone**
opens the window on every player's screen.

**Who travels.** Drag characters, hirelings, mounts or a whole party onto the window. The **×** on a
row takes someone off the journey, and nothing the journey does touches them after that.

Only an actor whose token is **linked** can travel. Generated NPCs, hirelings and monsters, and
creatures added from an encounter, get unlinked tokens: each token is its own copy, so the journey
would have no single sheet to take Rations from or give Fatigue to. Dropping one shows a warning
and leaves it off. To bring it along, tick **Link Actor Data** in its prototype token settings (and
on any of its tokens already on the map), then drag it in again. A party brings in its linked
members and names the ones it left behind.

### Each watch

A day has three watches: morning, afternoon and night.

1. **Weather** is rolled automatically each morning. The Warden can pick it by hand instead, or
   press **Auto** to roll again. When the weather costs something, buttons offer to add a Fatigue
   to the party or a watch to the journey. The weather table says "or", so that choice is the
   Warden's.
2. **Choose what the party does**: Travel, Explore, Supply or Make Camp. The group decides
   together at the table and the Warden picks it.
   - **Travel** asks for a roll to see whether the party gets lost.
   - **Supply** asks for a foraging roll, or offers **Resupply at a settlement**.
   - Players can make these rolls too.
3. **Spend the watch.** The button only works once everything needed has been rolled. It then
   updates the sheets for you:
   - **Make Camp** eats one Ration per person and clears their Fatigue. Anyone with no Ration
     becomes Deprived.
   - **Supply** hands out the Rations found.
   - **Travel** moves the party closer, or finds the way again if they were lost.

**Events.** After each watch a **Wilderness Event** is rolled and shown in the journey window. The
Warden can roll it again. When the event is an **Encounter**, the creatures and their Reaction come
with it. The Warden's **Put them on the map** button lets them click where the creatures appear
(Escape cancels).

**A night without camp** costs everyone a Fatigue and makes them Deprived, and the next day's
terrain is harder. The **±** buttons at the top let the Warden adjust the watches needed or
travelled by hand. **End the journey** closes it for everyone.

Left to the Warden and the table: mounts, guides and maps, and how an encounter plays out.

### Routes on a map (pointcrawls)

For a map with marked places, create a **Route** page in a journal for each road. Set its path,
distance, terrain and season, and the two places it links. Then add a map pin (a Note) on the road
that points to that page.

When the Warden **double-clicks the pin**, the Journey window opens with that road already filled
in. Players who double-click it just read the page. The page also has its own **Begin the journey**
button.

---

## 14. Handy shortcuts in text

Anything you write in a journal, an item or NPC description, or a chat message can contain these
shortcuts:

| Type this | You get |
|---|---|
| `[[/save WIL]]` | a button that rolls a WIL save for the selected token (or your character). Also works with `STR` and `DEX`. |
| `[[/save STR]]{Resist the cold}` | the same, showing your own words on the button |
| `[[/table Reactions]]` | a button that rolls on the named table |
| `@Condition[deprived]` | the condition's name. Hover it to read what it means. |
| `@Rule[panic]` | the rule's name. Hover it to read the rule. |

Rules you can name with `@Rule[...]`: `panic`, `impaired`, `enhanced`, `deprived`, `fatigue`,
`detachment`, `morale`, `critical-damage`.

---

## 15. Macros

The **Macros** compendium is open to everyone. Drag a macro onto your hotbar and click it to use
it:

| Macro | What it does |
|---|---|
| **Die of Fate** | rolls a d6 |
| **Rest** | restores lost HP |
| **Restore Abilities** | restores STR, DEX and WIL to their maximum |
| **Roll Morale** | rolls a Morale save for the selected enemy |
| **Roll Reaction** | rolls 2d6 on the Reaction table |
| **STR**, **DEX**, **WIL** | roll that save |

Each macro works on the **selected token**. With nothing selected, it works on **your own
character**. Die of Fate and Reaction roll even with neither.

### Writing your own

Each of these is one line, so you can build your own macro: create a **Script** macro and type
one of these lines.

```js
cairn2e.rest();             // restore HP
cairn2e.restoreAbilities(); // restore STR, DEX and WIL
cairn2e.save("DEX");        // a save: "STR", "DEX" or "WIL"
cairn2e.morale();           // a Morale save for the selected NPC
cairn2e.reaction();         // 2d6 on the Reaction table
cairn2e.dieOfFate();        // 1d6
```

---

## 16. Compendiums

The **Compendium Packs** tab holds everything the game needs, in a **Cairn 2e** folder:

| Folder | Packs |
|---|---|
| **Character Creation** | Backgrounds, Background Tables, Background Gear, Character Traits, Bonds, Omens |
| **Equipment** | Gear, Weapons, Armor |
| **Magic** | Spellbooks, Scrolls, Relics |
| **Reference** | Game Tables, Bestiary, Hirelings |
| **Warden** | Warden Tables |
| **Homebrew** | More Gear, More Spellbooks, More Scrolls: extra content by the system's author, not from the Cairn book |

**Macros** sits at the top of the folder.

- Compendiums are **read-only**. To use something, drag it onto a sheet, onto the map, or into your
  world.
- Only the Warden sees the **Bestiary**, so players can't read the monster stats.

**Monster pictures.** The Bestiary comes with Foundry's standard icons. To use your own art:

1. Create a folder under your Foundry `Data` folder (by default `cairn2e-assets`) with two
   subfolders, `portraits` and `tokens`.
2. Name each file after its monster, for example `Blink-Dog.webp`.
3. Turn on **Bestiary artwork** in the settings.

The compendium itself is never changed. Turn the setting off and the standard icons come back.

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { SYSTEM_ID, CONDITION, TABLES_PACK_ID, WARDEN_PACK_ID } from "./constants.js";
import { findTable } from "./helpers.js";
import { slotsForItem } from "./data/_derived.js";

/**
 * The single place that knows how a Cairn 2e roll works. Every save, damage roll, Critical
 * Damage save, Scars die, Morale check, Reaction and Die of Fate is built here — nowhere else in
 * the system constructs a `Roll` or a dice formula. Sheets and macros call into this file and post
 * nothing themselves; see `srd-2e/players-guide/core-rules.md` for the rules each function below
 * implements.
 */

const TEMPLATES = `systems/${SYSTEM_ID}/templates/chat`;
const SAVE_CARD_TPL = `${TEMPLATES}/save-card.hbs`;
const DAMAGE_CARD_TPL = `${TEMPLATES}/damage-roll-card.hbs`;
const ROLL_CARD_TPL = `${TEMPLATES}/roll-card.hbs`;
const JOURNEY_CARD_TPL = `${TEMPLATES}/journey-card.hbs`;
const DMG_DIALOG_TPL = `systems/${SYSTEM_ID}/templates/apps/damage-dialog.hbs`;

/** The `warden` pack table `module/journey.js` chains an Encounter category into. */
const WILDERNESS_ENCOUNTER_TABLE = "Wilderness Encounter";

// Impaired forces d4 regardless of the weapon's own die, and unarmed attacks are always d4
// (core-rules.md → Attack Modifiers) — one literal, used for both. Panic forces Impaired, so this
// is also the formula Panic substitutes — the single place that happens.
const IMPAIRED_OR_UNARMED_FORMULA = "1d4";
// Enhanced forces d12 regardless of the weapon's own die (core-rules.md → Attack Modifiers).
const ENHANCED_FORMULA = "1d12";

/* -------------------------------------------- */
/*  The Roll                                    */
/* -------------------------------------------- */

/**
 * The system's Roll. It rolls exactly what core's does — the only difference is how it is drawn:
 * the chat template is the ruled line a save card shows, so `/r 1d20` from the chat box and a STR
 * save from a sheet look like the same book, and the dice faces fold out of both.
 *
 * Registered FIRST in `CONFIG.Dice.rolls` (see `cairn2e.js#init`), which is what `Roll.create` and
 * the chat box's `/r` resolve through (`Roll.defaultImplementation`). Core's own `Roll` stays in
 * that array behind it: `Roll.fromData` resolves a stored roll by class name, so a roll another
 * package posted still reconstructs.
 */
export class CairnRoll extends foundry.dice.Roll {
  static CHAT_TEMPLATE = `${TEMPLATES}/roll.hbs`;

  static TOOLTIP_TEMPLATE = `${TEMPLATES}/roll-tooltip.hbs`;
}

/**
 * Evaluate a formula as a {@link CairnRoll}. Lived in `helpers.js` until the system had a Roll
 * class of its own; it is here now so that every Roll this system builds is built in one file.
 * @param {string} formula
 * @param {object} [data]
 * @returns {Promise<CairnRoll>}
 */
export const evaluateFormula = async (formula, data) => new CairnRoll(formula, data).evaluate();

/* -------------------------------------------- */
/*  Saves                                       */
/* -------------------------------------------- */

/**
 * The 2e roll-under save rule, as a pure function of the die face and the target number
 * (core-rules.md → Saves): **a natural 1 always succeeds and a natural 20 always fails**, otherwise
 * the roll passes on `face <= target`. Kept separate from the dice so it is checkable in isolation
 * (`checks/rules-saves.check.mjs`) — this is the rule a refactor is most likely to get subtly wrong.
 * @param {number} face  the d20 result (1–20)
 * @param {number} target  the attribute value being saved against
 * @returns {boolean}
 */
export function savePasses(face, target) {
  if (face === 1) return true;
  if (face === 20) return false;
  return face <= target;
}

/**
 * d20 roll-under against `target`. Reads the die face directly — Foundry's `cs<=` roll modifier
 * only compares the total, which would break the natural-1 / natural-20 rule in {@link savePasses}.
 * @param {number} target
 * @returns {Promise<{roll: Roll, passed: boolean}>}
 */
async function evaluateSave(target) {
  const roll = await new CairnRoll("1d20").evaluate();
  return { roll, passed: savePasses(roll.total, target) };
}

/**
 * Render and post a save's chat card. `outcomeText` adds a line below the roll (Critical Damage).
 *
 * `messageMode` is left undefined by every caller but the faction's: `Roll#toMessage` falls back
 * to `core.messageMode` when it is, so an ordinary save is as public as the table's setting says.
 */
async function postSaveRoll(roll, { actor, token, flavor, passed, outcomeText, messageMode } = {}) {
  const content = await foundry.applications.handlebars.renderTemplate(SAVE_CARD_TPL, {
    // The same roll line every other roll draws, rendered through the Roll's own chat template —
    // a save used to hand-draw it, which is why it could never show the die faces.
    rollHTML: await roll.render(),
    resultCls: passed ? "success" : "failure",
    resultLabel: game.i18n.localize(passed ? "CAIRN.Success" : "CAIRN.Fail"),
    outcomeText
  });
  // The flavor IS the card's caption — the message template draws it over the body's rule — so it
  // is passed here and never drawn by the card itself.
  return roll.toMessage({
    speaker: token ? ChatMessage.getSpeaker({ token }) : ChatMessage.getSpeaker({ actor }),
    flavor,
    content
  }, { messageMode });
}

/**
 * A plain ability save (STR/DEX/WIL), e.g. the save link next to an attribute on a sheet.
 * @param {Actor} actor
 * @param {"STR"|"DEX"|"WIL"} key
 * @returns {Promise<boolean>} whether the save passed
 */
export async function rollSave(actor, key) {
  const { roll, passed } = await evaluateSave(actor.system.abilities[key].value);
  await postSaveRoll(roll, {
    actor,
    flavor: game.i18n.localize("CAIRN.Save", { key: game.i18n.localize(key) }),
    passed
  });
  return passed;
}

/**
 * Morale: a WIL save on the first casualty, at half strength, or (a lone foe) at 0 HP
 * (core-rules.md → Morale). A led group may use its leader's WIL instead of its own — `null` on
 * `system.morale` means "use this actor's own WIL" (actor-npc.js). Not for PCs; the NPC sheet is
 * the only place this is offered.
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function rollMorale(actor) {
  const target = actor.system.morale ?? actor.system.abilities.WIL.value;
  const { roll, passed } = await evaluateSave(target);
  await postSaveRoll(roll, {
    actor,
    flavor: `${game.i18n.localize("CAIRN.Morale")} ${game.i18n.localize("CAIRN.Save", { key: game.i18n.localize("WIL") })}`,
    passed
  });
  return passed;
}

/**
 * The STR save Critical Damage prompts (core-rules.md → Critical Damage), rolled against the
 * target's *current* STR — `module/combat/damage.js` has already written the post-overflow value
 * before this is called, so no override is needed. Unlike a plain save, failure means something
 * different for a PC (incapacitated, dies within the hour unless aided) than for an NPC or monster
 * (dead outright); upstream treated both the same.
 * @param {Actor} actor
 * @param {TokenDocument} [token]
 * @returns {Promise<boolean>}
 */
export async function rollCriticalDamageSave(actor, token) {
  const { roll, passed } = await evaluateSave(actor.system.abilities.STR.value);

  // Doomed (Scars, row 12): "If your next save against critical damage is a fail, you die
  // horribly. If you pass, roll 3d6." THIS is that save, and it ends here either way — the row
  // says "your next save", not "every save from now on". A failure is death for a character,
  // where an ordinary failure only takes them out of the fight; the card says so and nothing
  // else happens, because when a character dies is the Warden's to rule (module/conditions.js).
  // A passing character still owes the 3d6, and the die is waiting on their Scars tab.
  const doomed = actor.statuses?.has(CONDITION.DOOMED) === true;
  if (doomed) await actor.toggleStatusEffect(CONDITION.DOOMED, { active: false });

  const outcomeText = passed
    ? game.i18n.localize("CAIRN.CriticalDamageSuccess")
    : game.i18n.localize(actor.type === "character" && !doomed ? "CAIRN.Incapacitated" : "CAIRN.Dead");
  await postSaveRoll(roll, {
    actor,
    token,
    flavor: game.i18n.localize("CAIRN.Save", { key: game.i18n.localize("STR") }),
    passed,
    outcomeText
  });
  return passed;
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * The Impaired / Enhanced / Blast dialog for a free-choice damage roll, drawn from
 * `templates/apps/damage-dialog.hbs`. Not shown at all when Panic or a Detachment already
 * determined the roll (see `rollDamage`) — those follow from the situation, not from the
 * attacker's choice — the one place auto-detection is right.
 */
async function promptDamageOptions(defaultBlast, weapons) {
  const content = await foundry.applications.handlebars.renderTemplate(DMG_DIALOG_TPL, {
    blast: defaultBlast,
    weapons: weapons.map((w) => ({ id: w.id, name: w.name, damage: w.system.damage }))
  });
  return foundry.applications.api.DialogV2.prompt({
    classes: [SYSTEM_ID],
    window: { title: game.i18n.localize("CAIRN.RollDamage") },
    content,
    // Impaired and Enhanced are one choice (core-rules.md → Attack Modifiers): switching one on
    // switches the other off, so the form can never hand rollDamage both.
    render: (_event, dialog) => {
      const impaired = dialog.element.querySelector('input[name="impaired"]');
      const enhanced = dialog.element.querySelector('input[name="enhanced"]');
      impaired.addEventListener("change", () => { if (impaired.checked) enhanced.checked = false; });
      enhanced.addEventListener("change", () => { if (enhanced.checked) impaired.checked = false; });
      // Two weapons, not three: the rule is "both damage dice", so at most one second weapon.
      const seconds = dialog.element.querySelectorAll('input[name^="second."]');
      for (const el of seconds) el.addEventListener("change", () => {
        if (!el.checked) return;
        for (const other of seconds) if (other !== el) other.checked = false;
      });
    },
    ok: {
      label: game.i18n.localize("CAIRN.RollDamage"),
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    },
    rejectClose: false
  });
}

/**
 * Render the damage card and post the roll, the target token ids flagged on the message as it is
 * created — a flag written afterwards was a second broadcast, and another client could draw the card
 * before its Apply had anything to apply to.
 */
async function postDamageRoll(actor, roll, label, targetIds) {
  const content = await foundry.applications.handlebars.renderTemplate(DAMAGE_CARD_TPL, {
    rollHTML: await roll.render(),
    hasTargets: targetIds.length > 0
  });
  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: label,
    content,
    flags: targetIds.length ? { [SYSTEM_ID]: { targets: targetIds } } : {}
  });
}

/**
 * The dice expression one damage roll evaluates. Two weapons at the same time roll both damage
 * dice and keep the single highest (core-rules.md → Attack Modifiers). The rules write that as
 * `d8+d8`; Foundry would sum it, so it becomes a `{d8,d8}kh` pool here.
 * @param {string} base  the weapon's (or the Impaired/Enhanced) die
 * @param {string} [extraDie]  the second weapon's die, or `""` for none
 * @returns {string}
 */
export function damageFormula(base, extraDie = "") {
  return extraDie ? `{${base},${extraDie}}kh` : base;
}

/**
 * The die one weapon rolls under the attack modifiers. Impaired forces d4 "regardless of the
 * attacks damage die" and Enhanced d12 "instead of their normal die" (core-rules.md → Attack
 * Modifiers), so with two weapons each is substituted on its own: `{1d4,1d4}kh`. No weapon is
 * the unarmed d4.
 * @param {Item|null} weapon
 * @param {{impaired?: boolean, enhanced?: boolean}} [mods]
 * @returns {string}
 */
export function dieForWeapon(weapon, { impaired = false, enhanced = false } = {}) {
  if (impaired) return IMPAIRED_OR_UNARMED_FORMULA;
  if (enhanced) return ENHANCED_FORMULA;
  return weapon?.system?.damage ?? IMPAIRED_OR_UNARMED_FORMULA;
}

/**
 * The weapons an attacker could swing "at the same time" as the clicked one: every other weapon
 * that sits in the ten slots — the same test the character sheet's ledger runs. No container
 * pointer (a sword in a backpack is not in hand), and it occupies a slot (`slotsForItem`, so a
 * *petty* weapon — a thing in a pocket — is out by the one definition the sheet keys on) — and it
 * is equipped, the same guard Roll Damage itself sits behind on every row: "in hand" means the
 * same thing for both dice, so a dagger still sheathed is not offered as the second one.
 * @param {Iterable<Item>} items  the attacker's items
 * @param {Item|null} clicked  the weapon whose Roll Damage was clicked, or `null` for unarmed
 * @returns {Item[]}
 */
export function secondWeaponCandidates(items, clicked) {
  return Array.from(items).filter(
    (i) => !!i.system.damage && !!i.system.equipped && i.id !== clicked?.id && !i.system.container && slotsForItem(i) > 0
  );
}

/**
 * Roll weapon (or unarmed) damage and post it to chat. The only place Panic, Impaired, Enhanced,
 * Blast and Detachments meet — collapses what used to be three separate copies of this logic
 * (`actor-sheet.js` `_onRoll`, `macros.js` `rollItemMacro`, and the panic check duplicated in
 * both).
 * @param {Actor} actor  The attacker.
 * @param {Item|null} item  The weapon rolled, or `null` for an unarmed attack.
 * @param {object} [options]
 * @param {boolean} [options.skipDialog=false]  Roll the weapon's own die with no modifier and
 *   no second weapon — the sheet passes this for a Shift-click. Panic and Detachments still
 *   decide first; they never asked.
 * @returns {Promise<ChatMessage|null>} `null` if the free-choice dialog was cancelled.
 */
export async function rollDamage(actor, item = null, { skipDialog = false } = {}) {
  const targets = Array.from(game.user.targets);
  const attackerIsDetachment = actor.system.isDetachment === true;
  const anyTargetIsDetachment = targets.some((t) => t.actor?.system?.isDetachment === true);
  const weaponBlast = !!item?.system?.blast;

  let impaired = false;
  let enhanced = false;
  let blast = weaponBlast;
  let second = null;

  if (actor.system.panicked) {
    // Panic ⇒ Impaired. The only substitution in the system; see IMPAIRED_OR_UNARMED_FORMULA.
    impaired = true;
  } else if (attackerIsDetachment) {
    // detachments.md: a detachment's own attacks are always Enhanced and deal Blast.
    enhanced = true;
    blast = true;
  } else if (anyTargetIsDetachment && !weaponBlast) {
    // core-rules.md → Detachments: attacks against a detachment by an individual are Impaired,
    // except Blast damage.
    impaired = true;
  } else if (!skipDialog) {
    const choice = await promptDamageOptions(weaponBlast, secondWeaponCandidates(actor.items, item));
    if (!choice) return null;
    impaired = !!choice.impaired;
    enhanced = !!choice.enhanced;
    blast = !!choice.blast;
    // The toggles are named `second.<itemId>` and `FormDataExtended#object` is flat — it never
    // expands a dotted name — so the pick is the one `second.*` key that is true; the dialog lets
    // at most one be on.
    const onKey = Object.keys(choice).find((k) => k.startsWith("second.") && choice[k] === true);
    second = onKey ? actor.items.get(onKey.slice("second.".length)) ?? null : null;
  }

  const mods = { impaired, enhanced };
  const formula = damageFormula(dieForWeapon(item, mods), second ? dieForWeapon(second, mods) : "");

  const tags = [];
  if (actor.system.panicked) tags.push(game.i18n.localize("CAIRN.RollingWithPanic"));
  else if (impaired) tags.push(game.i18n.localize("CAIRN.Impaired"));
  if (!impaired && enhanced) tags.push(game.i18n.localize("CAIRN.Enhanced"));
  if (blast) tags.push(game.i18n.localize("CAIRN.Blast"));
  const weapons = [item, second].filter(Boolean);
  const base = weapons.length
    ? `${game.i18n.localize("CAIRN.RollingDmgWith")} ${weapons.map((w) => w.name).join(" & ")}`
    : game.i18n.localize("CAIRN.RollDamage");
  const label = tags.length ? `${base} (${tags.join(", ")})` : base;

  // Blast rolls separately for each affected target (core-rules.md → Attack Modifiers).
  if (blast && targets.length) {
    for (const token of targets) {
      const roll = await evaluateFormula(formula, actor.getRollData());
      await postDamageRoll(actor, roll, label, [token.id]);
    }
    return true;
  }

  const roll = await evaluateFormula(formula, actor.getRollData());
  return postDamageRoll(actor, roll, label, targets.map((t) => t.id));
}

/* -------------------------------------------- */
/*  Scars                                       */
/* -------------------------------------------- */

/**
 * One of the Scars table's own dice: the d6 that says where it landed, or a row's gain
 * (`srd-2e/players-guide/core-rules.md` → Scars Table).
 *
 * Returns the total instead of posting. A Scar is taken in one window rather than assembled out of
 * four chat cards, so the window shows each die where it was rolled and posts the outcome once
 * (`module/apps/scars.js`).
 * @param {string} formula
 * @returns {Promise<number>}
 */
export async function rollScarDie(formula) {
  const roll = await evaluateFormula(formula);
  return roll.total;
}

/* -------------------------------------------- */
/*  Reactions                                   */
/* -------------------------------------------- */

const REACTION_BANDS = [
  { max: 2, key: "Hostile" },
  { max: 5, key: "Wary" },
  { max: 8, key: "Curious" },
  { max: 11, key: "Kind" },
  { max: 12, key: "Helpful" }
];

/**
 * 2d6 against the five-band Reaction table (core-rules.md → Reactions). GM-facing; no actor is
 * required.
 *
 * Returns the band as well as the card: the journey window shows a Wilderness Encounter's reaction
 * beside the creatures it belongs to, and a caller that only wants the card ignores the rest.
 * @param {Actor} [actor]
 * @returns {Promise<{message: ChatMessage, total: number, key: string, label: string}>}
 */
export async function rollReaction(actor) {
  const roll = await evaluateFormula("2d6");
  const band = REACTION_BANDS.find((b) => roll.total <= b.max);
  const label = game.i18n.localize(`CAIRN.Reactions.${band.key}`);
  const message = await roll.toMessage({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
    flavor: `${game.i18n.localize("CAIRN.Reaction")}: ${label}`
  });
  return { message, total: roll.total, key: band.key, label };
}

/* -------------------------------------------- */
/*  Die of Fate                                 */
/* -------------------------------------------- */

/**
 * 1d6; 4+ favours the PCs (core-rules.md → Die of Fate). Available to the GM with no character
 * sheet open via `game.cairn2e.rolls.rollDieOfFate()`.
 * @param {Actor} [actor]
 */
export async function rollDieOfFate(actor) {
  const roll = await evaluateFormula("1d6");
  return roll.toMessage({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker(),
    flavor: game.i18n.localize("CAIRN.DieOfFate")
  });
}

/* -------------------------------------------- */
/*  Encounters                                  */
/* -------------------------------------------- */

/**
 * Roll how many creatures an encounter-table row calls for and post it to chat (Dice So Nice
 * animates it if present). The encounter "Add to scene" button (`module/encounters.js`) is the only
 * caller — the quantity is rolled here, the system's one place for dice, not in the button handler.
 * A plain formula, not `evaluateFormula`'s: the Cairn "keep highest" notation is a damage rule and
 * has no business in a head-count.
 * @param {string} formula  a dice expression or bare integer from the row (`1d6`, `2d4`, `3`)
 * @param {string} label  the creature name, for the card flavor
 * @returns {Promise<number>}  the rolled total, clamped to >= 0
 */
export async function rollEncounterCount(formula, label) {
  const roll = await new CairnRoll(String(formula)).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker(),
    flavor: game.i18n.localize("CAIRN.Encounter.CountFlavor", { label })
  });
  return Math.max(roll.total ?? 0, 0);
}

/**
 * One die of the journey — the lost roll, the weather roll, the Supply bounty — evaluated so the
 * caller can read the face and decide what it means before anything is posted.
 * @param {string} formula
 * @returns {Promise<CairnRoll>}
 */
export async function rollJourneyDie(formula) {
  return new CairnRoll(formula).evaluate();
}

/**
 * Post a die with what it meant: the roll line, a lead ("Lost", "Inclement", "Major Success"), and
 * the rule's prose under it. The caption is the message's `flavor`, as on every card.
 *
 * Not the journey's alone — a faction's d6 is the same three lines, which is why neither the
 * function nor its template says "journey" any more.
 * @param {CairnRoll} roll
 * @param {{ flavor: string, lead: string, text?: string, resultCls?: string }} data
 * @returns {Promise<ChatMessage>}
 */
export async function postRollCard(roll, { flavor, lead, text = "", resultCls = "", messageMode }) {
  const content = await foundry.applications.handlebars.renderTemplate(ROLL_CARD_TPL, {
    rollHTML: await roll.render(),
    lead,
    text,
    resultCls
  });
  return roll.toMessage({ speaker: ChatMessage.getSpeaker(), flavor, content }, { messageMode });
}

/**
 * Post a journey card with no die on it: the route when it starts (with the "Open the journey"
 * button every client can press), each watch's summary, and the arrival.
 * @param {{ flavor: string, lead?: string, lines?: string[], open?: boolean }} data
 * @returns {Promise<ChatMessage>}
 */
export async function postJourneyCard({ flavor, lead = "", lines = [], open = false }) {
  const content = await foundry.applications.handlebars.renderTemplate(JOURNEY_CARD_TPL, { lead, lines, open });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker(), flavor, content });
}

/**
 * Draw `Wilderness Encounter` for real — world-first, the same table-lookup convention as
 * `helpers.js#rollWardenTable`, but `RollTable#draw()` rather than `roll()`: the point of this draw
 * is the chat card `module/encounters.js#renderEncounterButton` grows the "Add to scene"
 * button onto (via the `renderChatMessageHTML` hook in `module/cairn2e.js`), not a value to read.
 * Whispered like the event that chained into it, so the party meets the monster rather than the
 * table row it came from. Missing table → a warning, nothing drawn.
 * @returns {Promise<ChatMessage|null>}
 */
export async function drawWildernessEncounter({ displayChat = true } = {}) {
  const table = await findTable(WILDERNESS_ENCOUNTER_TABLE);
  if (!table) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Journey.NoTable", { name: WILDERNESS_ENCOUNTER_TABLE }));
    return null;
  }
  // The journey window draws silently and keeps the rows itself: the Warden is already looking at
  // the surface that would have carried the card, and the window's copy is the one with buttons.
  return displayChat ? table.draw({ messageMode: "gm" }) : table.draw({ displayChat: false });
}

/* -------------------------------------------- */

/**
 * Draw a RollTable named in enriched text (`[[/table Reactions]]`), and post the card.
 *
 * The lookup is the system's standing convention, widened by one pack: the WORLD copy wins, then
 * `tables`, then `warden`. World-first is what lets a Warden edit a table and keep the edit
 * across a system update (`module/helpers.js#rollWardenTable`), and a chip in a journal must obey
 * the same rule as a generator or the two would draw from different rows of the same name.
 *
 * `draw()` rather than `roll()`, unlike the generators: the point of a chip the Warden clicked is
 * the card at the table, not a value for code to read.
 * @param {string} name  The table's display name, exactly as it is written in the text.
 * @returns {Promise<RollTableDraw|null>}
 */
export async function drawNamedTable(name) {
  const table = await findTable(name, [TABLES_PACK_ID, WARDEN_PACK_ID]);
  if (!table) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Enrich.NoTable", { name }));
    return null;
  }
  return table.draw();
}

/* -------------------------------------------- */
/*  Factions                                    */
/* -------------------------------------------- */

/**
 * Both faction rolls are whispered to the Wardens.
 *
 * A faction is campaign machinery: what it is about to do, and whether it is even allowed to act
 * this turn, are things the table is supposed to MEET rather than read. The same reasoning the
 * wilderness event and its encounter draw already follow (`drawWildernessEncounter` passes
 * `messageMode: "gm"` to `RollTable#draw`).
 *
 * `gm` and not `blind`: blind hides the result from the Warden too, which is the one person who
 * needs it. v14 takes this as an OPTION on `Roll#toMessage`, which applies it to the message
 * itself — the older roll-mode helper on `ChatMessage` is deprecated in this version, and naming
 * it here would be a shipped file naming a deprecated API (`checks/deprecated-api.check.mjs`).
 */
const WARDEN_ONLY = "gm";

/**
 * The **Faction Actions** table, verbatim from `srd-2e/wardens-guide/setting-seeds.md`:
 *
 * | d6 | Consequence   | Impact                                                       |
 * |----|---------------|--------------------------------------------------------------|
 * | 1  | Failure       | A new **Obstacle** is introduced, and an **Advantage** is lost |
 * | 2  | Setback       | An **Advantage** is lost                                      |
 * | 3  | Status Quo    | Nothing is gained, but nothing is lost                        |
 * | 4  | Mixed Success | A **goal** is achieved, but an **Advantage** is lost           |
 * | 5  | Success       | A **goal** is achieved, and no **Advantages** are lost         |
 * | 6  | Major Success | A **goal** is achieved, and a new **Advantage** is found       |
 *
 * Keyed by face rather than held as an array so the six rows read as the printed table does, and
 * so an off-table total is a missing key rather than a silent index shift. The strings are i18n
 * keys written in full, which is what lets `checks/i18n.check.mjs` see them.
 */
export const FACTION_ACTIONS = {
  1: { name: "CAIRN.Faction.Action.Failure", impact: "CAIRN.Faction.Impact.Failure" },
  2: { name: "CAIRN.Faction.Action.Setback", impact: "CAIRN.Faction.Impact.Setback" },
  3: { name: "CAIRN.Faction.Action.StatusQuo", impact: "CAIRN.Faction.Impact.StatusQuo" },
  4: { name: "CAIRN.Faction.Action.MixedSuccess", impact: "CAIRN.Faction.Impact.MixedSuccess" },
  5: { name: "CAIRN.Faction.Action.Success", impact: "CAIRN.Faction.Impact.Success" },
  6: { name: "CAIRN.Faction.Action.MajorSuccess", impact: "CAIRN.Faction.Impact.MajorSuccess" }
};

/**
 * Roll a faction's d6 and say what it means. "Whenever a faction is positioned to advance a goal
 * in their agenda, roll a d6 on the Faction Actions table."
 *
 * The card STATES the consequence and writes nothing back to the page. Which advantage is lost,
 * and which goal a success advances, are the Warden's calls about the fiction — the table names
 * the kind of thing that happened, not the thing.
 *
 * No `resultCls`: the six rows are a graded range, not a pass and a fail, and colouring two of
 * them would say a distinction the table does not make (`ui-change`: everything else is ink).
 * @param {string} name  the faction's name, for the caption
 * @returns {Promise<number>} the face rolled
 */
export async function rollFactionAction(name) {
  const roll = await new CairnRoll("1d6").evaluate();
  const row = FACTION_ACTIONS[roll.total];
  await postRollCard(roll, {
    flavor: game.i18n.localize("CAIRN.Faction.ActionCaption", { name }),
    lead: row ? game.i18n.localize(row.name) : "",
    text: row ? game.i18n.localize(row.impact) : "",
    messageMode: WARDEN_ONLY
  });
  return roll.total;
}

/**
 * The opposed-faction save: "If two factions are _opposed_, the faction _most at risk_ makes a WIL
 * save, using the score of its highest-ranking agent. On a fail, the faction does not roll on the
 * Faction Actions table at this time."
 *
 * A plain d20 roll-under through the same `evaluateSave` every other save uses, so the natural-1
 * and natural-20 rule is the one in {@link savePasses} and not a second copy of it. It takes a
 * number rather than an Actor because an agent need not have one — a name and a WIL written on the
 * page is a complete agent.
 * @param {string} agent  the highest-ranking agent's name, for the caption
 * @param {number} wil
 * @returns {Promise<boolean>} whether the faction may roll its action
 */
export async function rollFactionSave(agent, wil) {
  const { roll, passed } = await evaluateSave(wil);
  await postSaveRoll(roll, {
    flavor: game.i18n.localize("CAIRN.Faction.SaveCaption", { name: agent }),
    passed,
    outcomeText: game.i18n.localize(passed ? "CAIRN.Faction.SavePassed" : "CAIRN.Faction.SaveFailed"),
    messageMode: WARDEN_ONLY
  });
  return passed;
}

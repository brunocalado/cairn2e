/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { SYSTEM_ID } from "./constants.js";
import { getInfoFromDropData } from "./helpers.js";
import { rollDamage, rollDieOfFate, rollMorale, rollReaction, rollSave } from "./rolls.js";

/**
 * @param {Object} data
 * @param {Number} slot
 * @return {Promise.<void>}
 */
export const createCairnMacro = async (data, slot) => {
  const { item, actor } = await getInfoFromDropData(data);
  if (!item || !actor) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MacroOwnedItemsOnly"));
  }

  // A gear its holder does not know is not rolled: the die is part of what it hides — and asked
  // first, or "weapons only" would answer whether it has one.
  if (item.isHiddenFromMe) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Unknown.Refused", { name: item.shownName }));
  }
  if (!item.system.damage) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MacroWeaponsOnly"));
  }

  // The macro is on the hotbar, which other users can see: the gear's guise while unknown.
  // By the item's uuid, which names its actor too: an unlinked token's actor shares its base
  // actor's id, so an actor id rolled the base actor's weapon — or found none.
  const command = `game.cairn2e.rollItemMacro("${item.uuid}");`;
  let macro = game.macros.find((m) => m.name === item.tableName && m.command === command);
  if (!macro) {
    macro = await Macro.create({
      name: item.tableName,
      type: "script",
      img: item.tableImg,
      command,
      // Was the literal "cairn.itemMacro" — the bare 1e id CLAUDE.md §4 forbids. Fixed in passing.
      flags: { [SYSTEM_ID]: { itemMacro: true } },
    });
  }
  await game.user.assignHotbarMacro(macro, slot);
};

/**
 * @param {string} itemUuid  The weapon's uuid — a token's own for an unlinked token.
 * @return {Promise.<void>}
 */
export const rollItemMacro = async (itemUuid) => {
  const item = await fromUuid(itemUuid);
  const actor = item?.parent;

  if (item?.documentName !== "Item" || actor?.documentName !== "Actor") {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MacroItemMissing", { uuid: itemUuid }));
  }

  // A macro made before the Warden hid the gear still may not roll it.
  if (item.isHiddenFromMe) {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Unknown.Refused", { name: item.shownName }));
  }
  // All roll-building (formula, Panic/Impaired/Enhanced/Blast, the chat card, target flagging)
  // lives in module/rolls.js — see its header comment.
  return rollDamage(actor, item);
};

/**
 * The actor a supplied macro acts on: the first controlled token's, else the user's own assigned
 * character — a player whose token is not on the current scene can still rest or save. Warns and
 * answers `null` when there is neither.
 * @param {object} [options]
 * @param {boolean} [options.required=true]  false for a roll that means something with no actor
 * @returns {Actor|null}
 */
function macroActor({ required = true } = {}) {
  const actor = canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
  if (!actor && required) ui.notifications.warn(game.i18n.localize("CAIRN.Notify.MacroNoTarget"));
  return actor;
}

/**
 * One-line entry points for the supplied macros and for anyone's own — `cairn2e.rest()` rather
 * than the token lookup, guard and call each macro used to repeat. Spread onto `game.cairn2e`.
 */
export const macroApi = {
  /** Restore lost HP (a moment's rest). */
  rest: () => macroActor()?.rest(),
  /** Restore lost STR, DEX and WIL (a week's rest with a healer). */
  restoreAbilities: () => macroActor()?.restoreAbilities(),
  /**
   * A plain ability save.
   * @param {"STR"|"DEX"|"WIL"} key  case-insensitive
   */
  save: (key) => {
    const actor = macroActor();
    return actor ? rollSave(actor, String(key).toUpperCase()) : undefined;
  },
  /** A Morale save for the selected NPC. */
  morale: () => {
    const actor = macroActor();
    return actor ? rollMorale(actor) : undefined;
  },
  // Reaction and the Die of Fate are the Warden's rolls as often as a character's: with nothing
  // selected they roll anyway, spoken by the user.
  /** 2d6 on the Reaction table. */
  reaction: () => rollReaction(macroActor({ required: false }) ?? undefined),
  /** The Die of Fate, 1d6. */
  dieOfFate: () => rollDieOfFate(macroActor({ required: false }) ?? undefined),
};

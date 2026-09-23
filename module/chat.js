/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, FLAGS } from "./constants.js";

/**
 * What the chat log offers on a right-click.
 *
 * One entry today: taking back an applied hit. It matters more here than it would in most
 * systems because of what a hit sets off — damage past 0 HP comes off STR
 * (`srd-2e/players-guide/core-rules.md` § Attribute Loss) and a character walked to 0 opens the
 * Scars window — so applying one to the wrong token is three corrections by hand, not one.
 *
 * A context menu rather than a button on the card: the card is read by everyone at the table and
 * the control is the Warden's, so a button would be `hidden` for most readers. A menu costs the
 * card no space and is where a Foundry user already looks for a correction.
 */

/**
 * Add this system's entries to a chat message's context menu.
 *
 * v14 spells an entry `{label, icon, onClick, visible}` — not the older `condition`/`callback`
 * (`client/applications/ux/context-menu.mjs`). `visible` is handed the `<li>`, so the message is
 * looked up from its dataset rather than closed over.
 * @param {HTMLElement} _html
 * @param {object[]} options
 */
export function addChatMessageContextOptions(_html, options) {
  options.push({
    label: "CAIRN.Chat.ReverseHit",
    icon: '<i class="fa-solid fa-rotate-left"></i>',
    visible: (li) => {
      if (!game.user.isGM) return false;
      const message = game.messages.get(li.dataset.messageId);
      if (!message) return false;
      return !!message.getFlag(SYSTEM_ID, FLAGS.HIT) && !message.getFlag(SYSTEM_ID, FLAGS.REVERSED);
    },
    onClick: (_event, li) => reverseHit(game.messages.get(li.dataset.messageId))
  });
  return options;
}

/* -------------------------------------------- */

/**
 * Give back what a hit took.
 *
 * The write is the **inverse delta**, not the before-values the card displays. Restoring absolutes
 * is the tempting version and it is wrong: anything that touched the actor between the hit and the
 * undo — a heal, a second hit, a Scar's new maximum — would be silently clobbered. Adding back
 * what was subtracted composes with all of it, and the schema's own `min`/`max` clamp the result.
 *
 * No Scar can re-fire on the way back, and that is a property rather than a guard:
 * `scarHpLost` (`module/scars.js`) returns `null` unless `hpTo === 0`, and a reversal moves HP up
 * from 0. Nothing here has to suppress it.
 *
 * What is NOT undone is a Scar the hit already produced. That is an Item with its own delete path
 * and its own revert notice — undoing two numbers does not un-roll a die, and deleting a player's
 * result behind their back would be worse than leaving it.
 * @param {ChatMessage} message
 */
export async function reverseHit(message) {
  const hit = message?.getFlag(SYSTEM_ID, FLAGS.HIT);
  if (!hit) return;

  const actor = await fromUuid(hit.actorUuid);
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Chat.ReverseNoActor"));
    return;
  }

  await actor.update({
    "system.hp.value": actor.system.hp.value + hit.hp,
    "system.abilities.STR.value": actor.system.abilities.STR.value + hit.str
  });

  // The card's markup is frozen into the message at posting time (core only rebuilds a roll
  // message's block while the stored content has no element children, and every card here stores
  // a body). So the note is appended to the stored content rather than re-rendered from the
  // template: the card on screen and the card in the database stay the same thing, and it
  // survives a reload. The flag is what stops the entry offering itself twice.
  const note = `<p class="cairn-damage-reversed">${game.i18n.localize("CAIRN.Chat.Reversed")}</p>`;
  await message.update({
    content: `${message.content}${note}`,
    [`flags.${SYSTEM_ID}.${FLAGS.REVERSED}`]: true
  });
}

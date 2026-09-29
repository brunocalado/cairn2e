/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { sendBarter } from "../transfer.js";

/**
 * Handing a thing over on the map: a gear dragged off a character's sheet and dropped on another
 * character's token goes to them at once, as the Barter window's Send does, card in chat and all.
 *
 * Gear only. Coin is handed over by amount, in the Barter window; and between characters only,
 * because a barter is a trade between players.
 *
 * Registered on `dropCanvasData`. The hook's `false` stops core and every later listener, and it
 * must be synchronous (a Promise is not `false`), so whether the drop is this system's is settled
 * before anything is awaited: an item one of your characters holds, over a token you can see.
 * Anything else goes on to core, or to a module that wants it.
 * @param {Canvas} canvas
 * @param {{ type: string, uuid?: string, x: number, y: number }} data
 * @returns {false|void}
 */
export function onDropCanvasData(canvas, data) {
  if (data?.type !== "Item" || !data.uuid) return;
  const item = fromUuidSync(data.uuid);
  const sender = item?.parent;
  if (item?.documentName !== "Item" || sender?.type !== "character" || !sender.isOwner) return;
  const target = canvas.tokens.placeables.findLast((t) => t.isVisible && t.bounds.contains(data.x, data.y))?.actor;
  if (!target || target.uuid === sender.uuid) return;
  handOver(sender, target, item);
  return false;
}

/** The part that waits: what may go is told here, and the rest is the Barter's own send. */
async function handOver(sender, target, item) {
  if (target.type !== "character") {
    return ui.notifications.warn(game.i18n.localize("CAIRN.Barter.CharactersOnly", { name: target.name }));
  }
  if (item.type !== "gear") return ui.notifications.warn(game.i18n.localize("CAIRN.Barter.GearOnly"));
  if (item.system.natural) return ui.notifications.warn(game.i18n.localize("CAIRN.Barter.Natural", { name: item.name }));
  await sendBarter(sender, target, [item]);
}

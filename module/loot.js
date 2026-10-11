/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "./constants.js";
import { metric } from "./token-distance-rules.js";

/**
 * Canvas Loot: an optional module that drops, throws and picks up items as tiles on the map. Its
 * chat messages are redrawn as this system's cards: the item is the caption, whoever acted the
 * sender, and the body says what happened to it.
 */
const MODULE = "canvas-loot";
const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/loot-card.hbs`;

/** The card's compiled template, set on `canvas-loot.ready`. */
let template = null;

const TEXT = {
  place: "CAIRN.Loot.Place", drop: "CAIRN.Loot.Drop", throw: "CAIRN.Loot.Throw", pickup: "CAIRN.Loot.Pickup"
};

/** A throw's distance as the ruler reads it: metres with the scene's feet beside them. */
function distanceOf({ distance, units }) {
  return (units === "ft") ? game.i18n.localize("CAIRN.TokenDistance", metric(distance))
    : `${distance} ${units}`.trim();
}

/**
 * Canvas Loot calls its hook without awaiting it, so the content is drawn here from the template
 * compiled on `ready` rather than through `renderTemplate`, which returns a promise the message
 * would never wait for.
 */
function restyle(messageData) {
  const data = messageData.flags[MODULE];
  const key = TEXT[data.event];
  if (!template || !key) return;
  messageData.flavor = foundry.utils.escapeHTML(data.item.name);
  messageData.content = template({
    img: data.item.img,
    text: game.i18n.localize(key, { distance: data.event === "throw" ? distanceOf(data) : "" }),
    show: !!data.tileUuid
  });
}

export function registerLoot() {
  Hooks.once(`${MODULE}.ready`, async () => {
    template = await foundry.applications.handlebars.getTemplate(CARD_TPL);
    Hooks.on(`${MODULE}.preChatMessage`, restyle);
  });
}

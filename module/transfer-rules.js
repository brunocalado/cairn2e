/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * What travels when a thing changes hands, with no Foundry in it — `checks/transfer.check.mjs`
 * runs this under Node. `module/transfer.js` is the side that writes documents.
 *
 * An item's own source is not enough to move it. A container's contents are its SIBLINGS in the
 * actor's collection, pointing back at it through `system.container`, so copying the container
 * alone arrives empty — and deleting the original then takes the contents with it
 * (`CairnItem._preDeleteOperation`). A stowed thing carries a pointer at a container the other
 * actor does not have, and the document refuses it as "not a container". So a move is a list of
 * BUNDLES: the thing, its pointer cleared, and whatever it holds.
 *
 * Being worn is a state of the person, not of the object: a sword taken off a dead man is in your
 * pack, not in your hand, and a shield's Armor counts for nobody until it is taken up again. Every
 * gear arrives unequipped, contents included.
 *
 * Everything here takes plain `{ _id, type, system }` sources — `Item#toObject()`.
 */

/**
 * The source a thing is recreated from on the other actor: no id (the new actor gives one), on
 * the body rather than in a container it no longer has, and not in anybody's hand. A sack of coin
 * set aside is taken back up: the receiver lands it through `putCoin`, which decides the place.
 * @param {object} source
 * @returns {object}
 */
function arrival(source) {
  const data = structuredClone(source);
  delete data._id;
  data.system = { ...(data.system ?? {}), container: "" };
  if (data.type === "gear") data.system.equipped = false;
  if (data.type === "coin") data.system.carried = true;
  return data;
}

/**
 * The bundles that move `chosen` off an actor holding `all`.
 *
 * A container carries every sibling pointing at it, and a content chosen alongside its own
 * container travels once, inside it. Each bundle keeps the SOURCE ids, because those are what the
 * sender deletes once the receiver says what landed.
 * @param {object[]} chosen  Sources of the things picked.
 * @param {object[]} all     Sources of every item on the source actor.
 * @returns {{ id: string, data: object, contents: { id: string, data: object }[] }[]}
 */
export function bundleItems(chosen, all) {
  const picked = new Set(chosen.map((s) => s._id));
  const bundles = [];
  for (const source of chosen) {
    const holder = source.system?.container;
    if (holder && picked.has(holder)) continue;
    const contents = (source.system?.capacity ?? 0) > 0
      ? all.filter((s) => s.system?.container === source._id).map((s) => ({ id: s._id, data: arrival(s) }))
      : [];
    bundles.push({ id: source._id, data: arrival(source), contents });
  }
  return bundles;
}

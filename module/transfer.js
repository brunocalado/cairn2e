/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { gainPlaces, putCoin } from "./coin.js";

/**
 * Writing a move between actors. What travels is `transfer-rules.js#bundleItems`; this is the
 * receiving half, and it only ever writes to the RECEIVER. The sender deletes what this reports
 * as landed, and nothing else, so a thing refused here is still where it was.
 *
 * Nothing is re-checked: the ten, a container's capacity and one sack per place are the
 * document's (`CairnItem._preCreateOperation`), which drops what does not fit and says so. What
 * this has to know is which source each surviving write came from, and a batch cannot say —
 * the survivors come back with no index to what went in. So it is one bundle per call.
 */

/**
 * Put `bundles` on `actor`.
 *
 * A container and its contents land together or not at all: the contents go in one batch
 * pointing at the new container, and if any is refused the new container goes again (taking the
 * ones that landed with it). Without that, the sender's delete of the original container would
 * destroy whatever did not arrive.
 *
 * A sack of coin lands through `putCoin` — grown into the sack already there, or made — at the
 * first place the whole amount fits. No question is asked: this may run on another user's client.
 * @param {Actor} actor
 * @param {{ id: string, data: object, contents: { id: string, data: object }[] }[]} bundles
 * @returns {Promise<{ landed: string[] }>}  Source ids that now exist on `actor`.
 */
export async function receiveItems(actor, bundles) {
  const landed = [];
  for (const { id, data, contents } of bundles) {
    if (data.type === "coin") {
      const amount = data.system?.value ?? 0;
      const [place] = gainPlaces(actor, amount);
      if (place === undefined) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Notify.CoinNoRoom", { amount }));
        continue;
      }
      if (await putCoin(actor, amount, place)) landed.push(id);
      continue;
    }

    const [made] = await actor.createEmbeddedDocuments("Item", [data]);
    if (!made) continue;
    if (contents.length) {
      const inside = contents.map((c) => ({ ...c.data, system: { ...c.data.system, container: made.id } }));
      const stowed = await actor.createEmbeddedDocuments("Item", inside);
      if (stowed.length < inside.length) {
        await made.delete();
        continue;
      }
    }
    landed.push(id, ...contents.map((c) => c.id));
  }
  return { landed };
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, TABLES } from "./constants.js";
import { drawTable } from "./helpers.js";
import { toPlainText } from "./character-generator.js";
import { omensOwed } from "./omen-rules.js";

/**
 * The party's Omens, drawn by the Warden from the party sheet's title bar once every character is made.
 * Who is owed one, and why it waits for the whole party, is `omen-rules.js`'s; this reads the
 * party into its shape, draws, writes, and posts the cards.
 */

const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/omen-card.hbs`;

/** The party's characters by uuid, the address the roster holds them by. A hireling or a mule is
 *  on the roster too, and draws no Omen. */
function partyCharacters(party) {
  return new Map(party.system.roster
    .filter(({ actor }) => actor.type === "character")
    .map(({ actor }) => [actor.uuid, actor]));
}

/** What the party owes, with its characters to write it to. */
function owed(party) {
  const characters = partyCharacters(party);
  return {
    characters,
    ...omensOwed([...characters.values()].map((actor) => ({
      id: actor.uuid,
      age: actor.system.age,
      omen: actor.system.omen,
      growths: actor.items.filter((i) => i.type === "growth").map((i) => ({
        id: i.id, table: i.system.table, drawn: i.system.drawn, resolved: i.system.resolved
      }))
    })))
  };
}

/** Whether the party still owes an Omen: what shows Draw Omens in the Warden's title bar. */
export function owesOmens(party) {
  const { youngest, growths } = owed(party);
  return youngest.length > 0 || growths.length > 0;
}

/**
 * One Omen that is no face in `taken`, which it joins. A repeat is drawn again, capped as the
 * faction generator caps its repeated Advantages, so a party already holding every face still
 * gets one. Drawn from the pack, where core marks nothing `drawn` on the table itself.
 * @param {Set<string>} taken  result ids already held in the party
 * @returns {Promise<{text: string, result: string}|null>}
 */
async function drawOmen(taken) {
  let face = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    face = (await drawTable(TABLES.OMENS)).results.find((r) => r.type === "text") ?? null;
    if (!face || !taken.has(face.id)) break;
  }
  if (!face) return null;
  taken.add(face.id);
  return { text: toPlainText(face.description), result: face.id };
}

/**
 * An Omen's card, spoken by the character under the caption "Omen". It carries no Roll: core
 * shows every player a whispered message that holds one, its content hidden, and that would tell
 * the table a private Omen had just been drawn (`rolls.js#drawDungeonEvent`).
 * @param {Actor} actor
 * @param {string} text
 * @param {{note: string, whisper?: string[], messageMode?: string}} options
 */
async function postOmen(actor, text, { note, whisper = [], messageMode }) {
  const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, {
    text,
    note: game.i18n.localize(note)
  });
  return ChatMessage.implementation.create(
    { speaker: ChatMessage.getSpeaker({ actor }), flavor: game.i18n.localize("CAIRN.Omen"), content, whisper },
    { messageMode }
  );
}

/** Parties whose draw is still writing. The button hides only once the writes re-render the
 *  sheet, so it is still there while the first draw lands, and a second click would deal the
 *  youngest two Omens. */
const drawing = new Set();

/**
 * Draw every Omen the party owes, write each to its character and post its card. The youngest's
 * goes to everyone, because the rule says it is read aloud; a growth's goes to the character's
 * owners and the Wardens, because the Foundling and the Mountebank keep theirs private. The
 * Warden's alone: it writes the players' characters.
 * @param {Actor} party
 */
export async function drawPartyOmens(party) {
  if (!game.user.isGM || drawing.has(party.id)) return;
  drawing.add(party.id);
  try {
    const { characters, youngest, growths, taken } = owed(party);
    for (const uuid of youngest) {
      const actor = characters.get(uuid);
      const omen = await drawOmen(taken);
      if (!omen) return;
      await actor.update({ "system.omen": { enabled: true, ...omen } });
      await postOmen(actor, omen.text, { note: "CAIRN.Party.OmenYoungest", messageMode: "public" });
    }
    for (const { actor: uuid, growth } of growths) {
      const actor = characters.get(uuid);
      const omen = await drawOmen(taken);
      if (!omen) return;
      await actor.items.get(growth).update({
        "system.gained": omen.text, "system.drawn": omen.result, "system.resolved": true
      });
      const owners = game.users.filter((u) => actor.testUserPermission(u, "OWNER")).map((u) => u.id);
      await postOmen(actor, omen.text, { note: "CAIRN.Party.OmenPrivate", whisper: owners });
    }
  } finally {
    drawing.delete(party.id);
  }
}

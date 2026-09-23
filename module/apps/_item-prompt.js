/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";

/**
 * What the "Create Item" prompt offers. Each is a `gear` with the fields that make it that kind
 * pre-filled (`data/item-gear.js`): a player still picks "Weapon" or "Relic", and gets a thing
 * with a die or a use instead of a blank form. A container made at the table is a bag or a pack —
 * hauled by the character, so `takesSlots`; the beasts and the Cart come from the Marketplace pack.
 */
/* The art follows from the fields, not from the preset name: `documents/item.js#getDefaultArtwork`
   reads the same seven kinds off a gear's own data, so an item created anywhere else — a macro, a
   drag, an import — looks like what it is too. */
const ITEM_PRESETS = {
  gear: {},
  // The one preset that is not a `gear`: a sack of coin is its own subtype (`data/item-coin.js`),
  // and `createItemFromPrompt` reads the type off this entry.
  coin: { type: "coin" },
  weapon: { damage: "d6" },
  armor: { armor: 1 },
  spellbook: { magic: "spellbook" },
  scroll: { magic: "scroll", slots: 0, uses: { value: 1, max: 1 } },
  relic: { magic: "relic", uses: { value: 1, max: 1 } },
  container: { capacity: 1, takesSlots: true }
};

/**
 * The "Create Item" prompt, shared by the inventory's add control, the Petty Items one, the
 * Belongings one and the NPC's.
 *
 * The choice is a PRESET, not a subtype: every carried thing is `gear`, and "Weapon" or "Relic"
 * pre-fills the fields that make it one, so nobody creates a blank thing and hunts for the
 * die.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean|null} [options.petty]  What the new thing's *petty* flag becomes; `null`
 *   leaves the DataModel default. The NPC sheet passes `null` because *petty* decides nothing
 *   there (no ledger, no slot tags), and so does the Belongings control — a thing written down
 *   after the fact is edited into shape afterwards, not described in the prompt.
 * @param {boolean} [options.askPetty]  Whether the prompt carries the *petty* checkbox at all.
 *   Only the inventory's own control asks: a control that says what it makes has already
 *   answered the question.
 * @param {boolean} [options.carried]  Whether the new thing is under direct possession. The
 *   Belongings heading makes things that are NOT: a sword left in a dungeon three days ago is
 *   written down after the fact, and a character with ten full slots has no room to create it
 *   first and set it aside afterwards.
 */
export async function createItemFromPrompt(actor, { petty = null, askPetty = false, carried = true } = {}) {
  const presets = Object.keys(ITEM_PRESETS);
  const options = presets
    .map((t) => `<option value="${t}">${game.i18n.localize(`CAIRN.Preset.${t}`)}</option>`)
    .join("");
  const content = `
    <div class="cairn-field">
      <label>${game.i18n.localize("CAIRN.Name")}</label>
      <input type="text" name="name" autofocus>
    </div>
    <div class="cairn-field">
      <label>${game.i18n.localize("CAIRN.Type")}</label>
      <select name="preset">${options}</select>
    </div>`;
  const pettyRow = !askPetty ? "" : `
    <div class="cairn-field">
      <label>${game.i18n.localize("CAIRN.Petty")}</label>
      <input type="checkbox" name="petty"${petty ? " checked" : ""}>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    classes: [SYSTEM_ID],
    window: { title: game.i18n.localize("CAIRN.CreateItem") },
    content: content + pettyRow,
    ok: {
      label: game.i18n.localize("CAIRN.CreateItem"),
      callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    },
    rejectClose: false
  });
  if (!result) return;

  // An unnamed thing is created anyway, named after what it is — the item directory does the
  // same, and failing silently on an empty field reads as a broken button.
  const preset = ITEM_PRESETS[result.preset] ? result.preset : "gear";
  const name = result.name?.trim()
    || game.i18n.localize("CAIRN.NewItem", { type: game.i18n.localize(`CAIRN.Preset.${preset}`) });
  // The question is asked in 2e's word and answered in the field behind it: *petty* IS
  // `slots: 0` (`data/_fields.js#itemBaseFields`). Unticked leaves the preset's own cost, which
  // for everything but a Scroll is the schema's one slot.
  const isPetty = askPetty ? !!result.petty : petty;

  const { type = "gear", ...system } = ITEM_PRESETS[preset];
  await actor.createOwnedItem({
    name,
    type,
    system: {
      ...system,
      // *petty* is a reading of `slots` on a gear; a sack's weight is read off its value.
      ...(isPetty && type === "gear" ? { slots: 0 } : {}),
      ...(carried ? {} : { carried: false })
    }
  });
}
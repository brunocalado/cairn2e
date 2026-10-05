/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * What an item comes with (`system.grants`), as functions over the sheet that draws it. A gear and
 * a growth both carry the list and the other kinds of item do not, so it is neither the base
 * sheet's nor either subclass's: each of the two sheets calls these from its own overrides, and
 * maps the two actions to them.
 */

import { SYSTEM_ID } from "../constants.js";
import { GRANT_DRAG_KEY } from "../grants.js";
import { removeAt, rowIndex } from "./item-sheet.js";

/** What a Grants zone takes: any Actor but a party, and gear. A party is a roster of other
 *  actors, not something an item can come with. */
export function grantable(document) {
  if (document?.documentName === "Actor") return document.type !== "party";
  return document?.documentName === "Item" && document.type === "gear";
}

/**
 * What the item comes with, as rows: the document's own name and picture, and for an actor the
 * numbers the SRD prints beside a companion ("8 HP, 3 STR, 11 DEX, 13 WIL"), read off the actor
 * rather than written in the prose. A uuid that resolves to nothing keeps its row, as a
 * Background's does.
 * @param {Item} item
 * @returns {Promise<object[]>}
 */
export async function grantRows(item) {
  return Promise.all(item.system.grants.map(async (uuid) => {
    const doc = await fromUuid(uuid).catch(() => null);
    const row = { uuid, ok: !!doc, name: doc?.name ?? "", img: doc?.img ?? "" };
    if (doc?.documentName === "Actor" && doc.system.abilities) {
      const { hp, abilities } = doc.system;
      row.stats = game.i18n.localize("CAIRN.Grants.Stats", {
        hp: hp.max, str: abilities.STR.max, dex: abilities.DEX.max, wil: abilities.WIL.max
      });
    }
    return row;
  }));
}

/**
 * A document dropped on the Grants zone. Anyone who may edit the item may link to it, and what
 * is linked is the uuid: the actor or gear itself is never copied onto the item.
 * @param {foundry.applications.sheets.ItemSheetV2} sheet
 * @param {Document} document
 * @returns {Promise<Document|null>}
 */
export async function dropGrant(sheet, document) {
  if (!sheet.isEditable) return null;
  if (!grantable(document) || document.uuid === sheet.document.uuid) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Grants.Refused"));
    return null;
  }
  const list = sheet.document.system.grants;
  // Listed once: a second drop of the same one is a slip, not a second companion.
  if (list.includes(document.uuid)) return null;
  await sheet.document.update({ "system.grants": [...list, document.uuid] });
  return document;
}

/**
 * A Grants row carries the document it names, so it lands on a character sheet or a scene as if
 * it had been dragged out of its own compendium. Built from the uuid alone: `dataTransfer` takes
 * data only while `dragstart` is being dispatched, so nothing here may wait on a lookup. An Actor
 * also names the item it came from, which is what lets a player put it on the scene through the
 * Warden (`module/grants.js`).
 * @param {foundry.applications.sheets.ItemSheetV2} sheet
 * @param {DragEvent} event
 * @returns {boolean}  Whether the drag started on a Grants row; the caller handles it otherwise.
 */
export function grantDrag(sheet, event) {
  const grant = event.currentTarget.dataset.grantUuid;
  if (!grant) return false;
  const type = foundry.utils.parseUuid(grant)?.type;
  if (!type) return true;
  const data = { type, uuid: grant };
  if (type === "Actor") data[SYSTEM_ID] = { [GRANT_DRAG_KEY]: sheet.document.uuid };
  event.dataTransfer.setData("text/plain", JSON.stringify(data));
  return true;
}

/**
 * The Grants zone says it will take the drop while one is over it. `:hover` does not follow a
 * drag in Chromium, so the state is a class; `dragleave` fires when the pointer crosses into a
 * child too, hence the `relatedTarget` test.
 * @param {HTMLElement} root  A part the sheet has just drawn.
 */
export function bindGrantZones(root) {
  for (const zone of root.querySelectorAll(".cairn-grants-drop")) {
    const over = (on) => zone.classList.toggle("dragover", on);
    zone.addEventListener("dragover", () => over(true));
    zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget)) over(false); });
    zone.addEventListener("drop", () => over(false));
  }
}

/** Open what the row names. An action: `this` is the sheet. */
export async function onGrantOpen(event, target) {
  const doc = await fromUuid(target.closest("[data-grant-uuid]")?.dataset.grantUuid).catch(() => null);
  doc?.sheet.render({ force: true });
}

/** An action: `this` is the sheet. */
export async function onGrantRemove(event, target) {
  await removeAt(this.document, "system.grants", rowIndex(target));
}

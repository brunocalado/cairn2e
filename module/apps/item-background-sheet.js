/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CairnItemSheet, removeAt, rowIndex } from "./item-sheet.js";

/** The sheet of a Background: its names, its two d6 tables and its starting gear. */
export class CairnBackgroundSheet extends CairnItemSheet {
  static DEFAULT_OPTIONS = {
    // The Background's three lists are the tallest thing an item sheet draws.
    // TODO: with ten names, the Starting Gear and Tables zones sit entirely below the fold at 480,
    // so reaching them means scrolling past the whole name list. Either the window grows past the
    // other item sheets, or the Names zone folds — the maintainer's call.
    position: { height: 480 },
    actions: {
      nameAdd: CairnBackgroundSheet.#onNameAdd,
      nameRemove: CairnBackgroundSheet.#onNameRemove,
      tableRemove: CairnBackgroundSheet.#onTableRemove,
      gearRemove: CairnBackgroundSheet.#onGearRemove
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // A Background's tables and gear are stored as uuids and shown as names. A uuid that resolves
    // to nothing is reported rather than dropped: the row is how anyone finds out the document went.
    const resolve = (uuids) => Promise.all(
      (uuids ?? []).map(async (uuid) => {
        const doc = await fromUuid(uuid).catch(() => null);
        return { uuid, ok: !!doc, name: doc?.name ?? "" };
      })
    );
    context.tables = await resolve(this.item.system.tables);
    context.startingGear = await resolve(this.item.system.startingGear);
    return context;
  }

  /**
   * @override — a document dropped on a Background sheet. Its type says which list it joins: a
   * RollTable is one of the two d6 tables, an Item is starting gear. Nothing else is taken, so
   * dropping an Actor or a Journal here does nothing rather than something surprising.
   * @param {DragEvent} event
   * @param {Document} document
   * @returns {Promise<Document|null>}
   */
  async _onDropDocument(event, document) {
    if (!this.isEditable) return null;
    let path;
    if (document?.documentName === "RollTable") path = "system.tables";
    // A background is not gear, and a background cannot hand out another one.
    else if (document?.documentName === "Item" && document.type !== "background") path = "system.startingGear";
    else return null;

    const list = foundry.utils.getProperty(this.document, path) ?? [];
    // A document is listed once: a second drop of the same one is a slip, not a second copy.
    if (list.includes(document.uuid)) return null;
    await this.document.update({ [path]: [...list, document.uuid] });
    return document;
  }

  /** Append an empty name row. It is blank on purpose — the row IS the prompt to type one. */
  static async #onNameAdd() {
    if (!this.isEditable) return;
    await this.document.update({ "system.names": [...this.document.system.names, ""] });
  }

  static async #onNameRemove(event, target) {
    if (!this.isEditable) return;
    await removeAt(this.document, "system.names", rowIndex(target));
  }

  static async #onTableRemove(event, target) {
    if (!this.isEditable) return;
    await removeAt(this.document, "system.tables", rowIndex(target));
  }

  static async #onGearRemove(event, target) {
    if (!this.isEditable) return;
    await removeAt(this.document, "system.startingGear", rowIndex(target));
  }
}

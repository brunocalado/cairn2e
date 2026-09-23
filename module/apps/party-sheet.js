/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { CONDITIONS } from "../conditions.js";
import { abilityRows } from "../helpers.js";
import { CairnActorSheet } from "./actor-sheet.js";

const TEMPLATES = `systems/${SYSTEM_ID}/templates`;

/**
 * The party sheet — the group read as one page.
 *
 * It edits almost nothing. Every number on it belongs to a member and is shown, not set: the
 * party's own document holds a roster and no statistics, because Cairn 2e gives a group none.
 * What the sheet is for is the two questions a table asks constantly and otherwise answers by
 * opening four windows — how is everybody doing, and who is even here.
 *
 * Two tabs, split by what the member IS: the player characters, then everyone travelling with
 * them. The split is not a second list — `system.members` is one array and its ORDER is the
 * party's marching order (`srd-2e/players-guide/procedures.md` § Dungeon Elements → Doors), so
 * every row carries its index in that one array and never the index of the tab it is drawn in.
 */
export class CairnPartySheet extends CairnActorSheet {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "party"],
    position: { width: 600, height: 620 },
    window: { resizable: true },
    actions: {
      memberOpen: CairnPartySheet.#onMemberOpen,
      memberRemove: CairnPartySheet.#onMemberRemove,
      memberDeployToggle: CairnPartySheet.#onMemberDeployToggle
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/parts/party-header.hbs` },
    nav: { template: `${TEMPLATES}/parts/actor-tabs.hbs` },
    members: { template: `${TEMPLATES}/actor/party-members.hbs`, scrollable: [""] },
    followers: { template: `${TEMPLATES}/actor/party-followers.hbs`, scrollable: [""] }
  };

  static TABS = {
    primary: {
      initial: "members",
      tabs: [
        { id: "members", label: "CAIRN.Party.Members" },
        { id: "followers", label: "CAIRN.Party.Followers" }
      ]
    }
  };

  /* -------------------------------------------- */
  /*  Prepare context                             */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rows = this.actor.system.roster.map((entry, index) => this.#row(entry, index));
    context.members = rows.filter((r) => r.isCharacter);
    context.followers = rows.filter((r) => !r.isCharacter);
    return context;
  }

  /**
   * One member's line.
   *
   * `index` is the member's place in `system.members`, handed down so a write can address the
   * right entry from either tab: the two tabs are filtered views of one array, and a row that
   * carried the position it happens to occupy on screen would edit somebody else's.
   * @param {{actor: Actor, deployed: boolean}} entry
   * @param {number} index
   */
  #row({ actor, deployed }, index) {
    const system = actor.system;
    const isCharacter = actor.type === "character";
    return {
      index,
      // Printed on the row. 1-based because it is read at the table, not indexed by code, and
      // taken over the WHOLE array: the Party tab may read 1 and 3 with the Followers tab's 2
      // between them — that is the marching order, and a per-tab count would hide it.
      order: index + 1,
      deployed,
      uuid: actor.uuid,
      id: actor.id,
      name: actor.name,
      img: actor.img,
      isCharacter,
      hp: system.hp,
      abilities: abilityRows(system),
      armor: system.armorTotal ?? 0,
      // The two readings 2e gives only a player character: an NPC carries no ten-slot ledger
      // (`apps/npc-sheet.js#CairnNpcSheet` draws a flat list) and takes no Fatigue.
      slots: isCharacter ? { used: system.slotsUsed, max: system.slotsMax } : null,
      fatigue: isCharacter ? actor.items.filter((i) => i.type === "fatigue").length : null,
      conditions: CONDITIONS
        .filter((c) => actor.statuses.has(c.id))
        .map((c) => ({ id: c.id, img: c.img, label: game.i18n.localize(c.name) })),
      deployHint: game.i18n.localize(deployed ? "CAIRN.Party.DeployedOn" : "CAIRN.Party.DeployedOff")
    };
  }

  /* -------------------------------------------- */
  /*  Drags and drops                             */
  /* -------------------------------------------- */

  /**
   * @override — a member row drags as its Actor, carrying where it came from.
   *
   * Core's own handler only knows how to drag an Item or an ActiveEffect off an actor sheet
   * (`client/applications/sheets/actor-sheet.mjs`), so a row naming an Actor would start a drag
   * with an empty payload. The extra key is what tells the drop apart from an Actor dragged in
   * from the directory: same document, different intention.
   */
  _onDragStart(event) {
    const row = event.currentTarget.closest("[data-uuid][data-index]");
    if (!row) return super._onDragStart(event);
    const actor = fromUuidSync(row.dataset.uuid);
    if (!actor) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({
      ...actor.toDragData(),
      [SYSTEM_ID]: { fromIndex: Number(row.dataset.index) }
    }));
  }

  /**
   * Move a member to where it was dropped.
   *
   * Dropped on a row, it takes that row's place; dropped anywhere else on the sheet, it goes to
   * the back. Both tabs are views of ONE array, so a character dropped onto a follower's line
   * really does move there — which is the point, since the order is the marching order and a
   * mule can walk in front.
   */
  async #reorder(fromIndex, event) {
    const members = this.actor.system.members;
    const row = event.target.closest?.("[data-index]");
    const to = row ? Number(row.dataset.index) : members.length - 1;
    if (!Number.isInteger(to) || to === fromIndex) return null;

    const next = [...members];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(to, 0, moved);
    await this.actor.update({ "system.members": next });
    return null;
  }

  /**
   * @override — an Actor dropped on the sheet joins the roster.
   *
   * v14 hands this the resolved document rather than the drag payload
   * (`client/applications/sheets/actor-sheet.mjs`). A party is refused: a group inside a group
   * has no reading, and the map controls would have to decide what setting one down means.
   */
  async _onDropActor(event, actor) {
    if (!this.isEditable) return null;

    // A row dragged from this sheet is a move, not a second membership.
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const fromIndex = data?.[SYSTEM_ID]?.fromIndex;
    if (Number.isInteger(fromIndex)) return this.#reorder(fromIndex, event);

    if (actor.type === "party") {
      ui.notifications.warn(game.i18n.localize("CAIRN.Party.NoPartyInParty"));
      return null;
    }
    const members = this.actor.system.members;
    if (members.some((m) => m.actor === actor.uuid)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Party.AlreadyAMember", { name: actor.name }));
      return null;
    }
    await this.actor.update({
      "system.members": [...members, { actor: actor.uuid, deployed: true }]
    });
    return actor;
  }

  /* -------------------------------------------- */
  /*  Row controls                                */
  /* -------------------------------------------- */

  /** The member's own sheet. The roster is a way in, not a replacement. */
  static async #onMemberOpen(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const actor = uuid ? fromUuidSync(uuid) : null;
    actor?.sheet.render({ force: true });
  }

  /** Off the roster entirely. Shift skips the question, as the item rows do. */
  static async #onMemberRemove(event, target) {
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const members = this.actor.system.members;
    const entry = members[index];
    if (!entry) return;

    if (!event.shiftKey) {
      // Escaped before it reaches `localize`, which interpolates without escaping anything.
      const name = foundry.utils.escapeHTML(fromUuidSync(entry.actor)?.name ?? "");
      const ok = await foundry.applications.api.DialogV2.confirm({
        classes: [SYSTEM_ID],
        window: { title: game.i18n.localize("CAIRN.Party.RemoveTitle") },
        content: `<p>${game.i18n.localize("CAIRN.Party.RemoveConfirm", { name })}</p>`
      });
      if (!ok) return;
    }
    await this.actor.update({ "system.members": members.toSpliced(index, 1) });
  }

  /**
   * On the roster, out of the group's map movements.
   *
   * The whole array is written back rather than one indexed path: a partial write of
   * `system.members.N.deployed` reaches the ArrayField as a single-entry object, and every other
   * member's `actor` uuid would be missing from the entry it rebuilds.
   */
  static async #onMemberDeployToggle(event, target) {
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const members = this.actor.system.members.map((m) => ({ ...m }));
    if (!members[index]) return;
    members[index].deployed = !members[index].deployed;
    await this.actor.update({ "system.members": members });
  }
}

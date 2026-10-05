/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS, FLAGS, CONDITION, DEFAULT_ARTWORK } from "../constants.js";
import { attrPath, attrResource, gainUpdate, movedMaximum, revertUpdate } from "../gains.js";
import { scarHpLost, outcomeLabel } from "../scars.js";
import { tokenDefaults } from "../token-defaults.js";

/**
 * The creation data of a character's fists (`FLAGS.UNARMED`). Named in the table's language when
 * it is made; the mark, not the name, is what finds it again.
 * @returns {object}
 */
export function unarmedItemData() {
  return {
    name: game.i18n.localize("CAIRN.Unarmed"),
    type: "gear",
    system: { damage: "d4", bodily: true, slots: 0 },
    flags: { [SYSTEM_ID]: { [FLAGS.UNARMED]: true } }
  };
}

/**
 * The Cairn 2e Actor.
 *
 * All arithmetic (slots, armour, encumbrance, effective HP) lives on the DataModels'
 * `prepareDerivedData` — see `module/data/actor-*.js`. This class holds only document-level
 * behaviour: the owned-item actions the sheet calls, and the 2e recovery rules (Rest / restore
 * Attributes / clear Fatigue), each of which a **Deprived** PC cannot benefit from
 * (`core-rules.md`).
 */
export class CairnActor extends Actor {
  /**
   * The `party` Actors whose roster lists this one. `PartyData#prepareBaseData` adds a party on
   * every data preparation and nothing removes one, so a member taken off a roster keeps that
   * party in its set until reload — `renderParties` may then redraw a party that no longer lists
   * it, which is harmless.
   * @type {Set<Actor>}
   */
  parties = new Set();

  /**
   * Redraw the members list of every party that lists this Actor.
   *
   * Debounced, because the changes worth showing arrive in bursts: ten taps on a stepper, a
   * generator writing a whole inventory. Only the `members` and `followers` parts are asked for
   * — the base sheet honours an explicit `parts` list (`apps/actor-sheet.js#_configureRenderOptions`),
   * so the header and the tab strip are not rebuilt and the roster tabs are all that redraw.
   */
  renderParties = foundry.utils.debounce(() => {
    for (const party of this.parties) party.render({ parts: ["members", "followers"] });
  }, 10);

  /**
   * @override — the portrait a new Actor wears, chosen by its subtype
   * (`constants.js#DEFAULT_ARTWORK`). Core hands every Actor the mystery-man silhouette, which
   * reads as a placeholder rather than as a person, and the portrait is the first thing on the
   * sheet.
   *
   * Core makes this the `img` field's own `initial` (`common/documents/actor.mjs`), so it answers
   * on every path that builds an Actor and only when none was supplied — an import, a template or
   * a generator keeps the art it arrived with. The prototype token is given the same source: core
   * copies `img` onto it when the token has none, and the Actors directory reads `texture` from
   * here directly.
   */
  static getDefaultArtwork(actorData) {
    const img = DEFAULT_ARTWORK.Actor[actorData?.type] ?? super.getDefaultArtwork(actorData).img;
    return { img, texture: { src: img } };
  }

  /**
   * @override — the prototype token's defaults (`module/token-defaults.js`), and every
   * character's fists: a bodily `gear` rolling d4, "Unarmed attacks always do d4 damage"
   * (`core-rules.md`). The fists are a real item rather than a line the sheet draws, so they can
   * be renamed, given another die or deleted like anything else a character has.
   *
   * And a party belongs to the party. Gathered into one token the members have no tokens of their
   * own, so the party's is the only thing the table can see the map through — a party only the
   * Warden owned would leave the players in the dark while travelling. Editing the roster is the
   * price, and a table with one Warden can pay it. A default only: a party created with a default
   * ownership of its own keeps it.
   *
   * Here rather than in `create`, because `_preCreate` runs for every path that makes an Actor —
   * the sidebar, the creator, the generators (`createDocuments` never passes through `create`),
   * an import, a duplicate. One that already carries a marked item (a duplicate, a compendium
   * copy) is not given a second.
   */
  async _preCreate(data, options, user) {
    if ((await super._preCreate(data, options, user)) === false) return false;
    this.#applyTokenDefaults(data);
    if (this.type === "party" && data.ownership?.default === undefined) {
      this.updateSource({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
    }
    if (this.type !== "character") return;
    const items = this._source.items ?? [];
    if (items.some((i) => i.flags?.[SYSTEM_ID]?.[FLAGS.UNARMED])) return;
    this.updateSource({ items: [...items, unarmedItemData()] });
  }

  /**
   * Write the subtype's token defaults over whatever the creation data left undecided. A value
   * the caller chose is kept — a generator's neutral disposition, a duplicate's own range — and
   * "undecided" includes core's initial value, not only a missing key: an Actor imported from a
   * compendium arrives through `toObject()`, which spells out every field at its initial.
   * @param {object} data  the creation data `_preCreate` was handed
   */
  #applyTokenDefaults(data) {
    const schema = foundry.data.PrototypeToken.schema;
    const update = {};
    for (const [path, value] of Object.entries(tokenDefaults(this.type))) {
      const given = foundry.utils.getProperty(data, `prototypeToken.${path}`);
      if (given !== undefined && given !== schema.getField(path).getInitialValue({})) continue;
      update[path] = value;
    }
    if (!foundry.utils.isEmpty(update)) this.updateSource({ prototypeToken: foundry.utils.expandObject(update) });
  }

  /**
   * @override — the Create Actor dialog lists Player Character first.
   *
   * Core sorts the type list alphabetically by localized label, and "Non-Player Character"
   * sorts before "Player Character". The dialog's `context` is spread over core's own template
   * data last, so handing it a `types` list in the manifest's order replaces the sorted one.
   *
   * Party is last because it is the rarest: a table makes one of them and dozens of the other
   * two, and the order here is how often the entry is wanted, not the manifest's own.
   */
  static async createDialog(data = {}, createOptions = {}, dialogOptions = {}, renderOptions = {}) {
    const types = ["character", "npc", "party"].map((value) => ({
      value,
      label: game.i18n.localize(CONFIG.Actor.typeLabels[value]),
    }));
    return super.createDialog(
      data,
      createOptions,
      { ...dialogOptions, context: { types, ...dialogOptions.context } },
      renderOptions
    );
  }

  /**
   * @override — the token follows the name, and a hit that reaches 0 HP decides a Scar.
   *
   * Nothing here about coin: coin is Items (`data/item-coin.js`), so a sack that would not fit is
   * refused where every other item is, in `CairnItem._preCreateOperation`.
   */
  async _preUpdate(changes, options, user) {
    if ((await super._preUpdate(changes, options, user)) === false) return false;
    this.#followingTokenName(changes, options);
    if (this.type !== "character") return;

    // Scars are decided HERE because this is the only place that sees the HP before and after in
    // the same breath — `_onUpdate` and the `updateActor` hook both arrive with the old value
    // already gone. It covers every path at once: the damage card's Apply, the sheet's − stepper,
    // a macro, an import. The answer rides on `options` to the other side of the write.
    const hpTo = foundry.utils.getProperty(changes, "system.hp.value");
    if (hpTo === undefined) return;
    const lost = scarHpLost({
      isCharacter: true,
      hasPlayerOwner: this.hasPlayerOwner,
      hpFrom: this.system.hp.value,
      hpTo,
      strFrom: this.system.abilities.STR.value,
      strTo: foundry.utils.getProperty(changes, "system.abilities.STR.value") ?? this.system.abilities.STR.value
    });
    if (lost !== null) foundry.utils.setProperty(options, `${SYSTEM_ID}.scarHpLost`, lost);
  }

  /**
   * @override — a Scar decided in `_preUpdate` is announced once the write has landed.
   *
   * `_onUpdate` runs on EVERY connected client (`common/abstract/document.mjs`), so without the
   * `userId` gate every screen at the table would post its own card and open its own window. The
   * client that asked for the update is the one that speaks; who gets the WINDOW is a separate
   * question, and `CairnScars.announce` answers it — the character's player, wherever they are.
   */
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);

    // Not gated on `userId`: every client showing this member on a party sheet has to redraw it,
    // not only the one that made the change.
    this.renderParties();

    // The placed half of the rename above. It cannot ride the actor's own write — a Token is a
    // document in a Scene — so it is a second write, made only by the client that asked for the
    // rename and only for the tokens that were wearing the old name.
    const renamedFrom = foundry.utils.getProperty(options, `${SYSTEM_ID}.renamedFrom`);
    if (renamedFrom !== undefined && userId === game.userId) this.#renameTokens(renamedFrom);

    const lost = foundry.utils.getProperty(options, `${SYSTEM_ID}.scarHpLost`);
    if (lost === undefined || userId !== game.userId) return;
    // Imported here rather than at the top of the file: `module/documents/` must stay loadable
    // under plain Node, because the offline checks import it, and an Application module reads
    // `foundry.applications.api` the moment it is evaluated.
    import("../apps/scars.js").then(({ CairnScars }) => CairnScars.announce(this, lost));
  }

  /* -------------------------------------------- */

  /**
   * @override — the first party a world gets becomes its active one.
   *
   * So a table that only ever makes one party never has to learn that the setting exists, and
   * the P key works the moment there is something for it to open. A second party does not steal
   * the title: choosing is the Warden's, from the Actors directory.
   *
   * `isActiveGM` because this runs on every connected client and only one of them may write a
   * world setting — the same guard `module/token-defaults.js` and `module/welcome.js` use.
   */
  _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if (this.type !== "party" || !game.user.isActiveGM) return;
    if (game.settings.get(SYSTEM_ID, SETTINGS.ACTIVE_PARTY)) return;
    game.settings.set(SYSTEM_ID, SETTINGS.ACTIVE_PARTY, this.id);
  }

  /* -------------------------------------------- */

  /**
   * @override — a deleted member leaves the roster it was on.
   *
   * Nothing is written back to the party: `PartyData#roster` resolves its uuids every time it is
   * read, so the row is simply gone the next time the sheet draws. This is that redraw.
   */
  _onDelete(options, userId) {
    super._onDelete(options, userId);
    this.renderParties();

    // A deleted party must not stay the answer to "which party": the key would report there is
    // one and then open nothing. Cleared rather than passed on — which of the others should
    // inherit is not this code's to guess.
    if (this.type !== "party" || !game.user.isActiveGM) return;
    if (game.settings.get(SYSTEM_ID, SETTINGS.ACTIVE_PARTY) !== this.id) return;
    game.settings.set(SYSTEM_ID, SETTINGS.ACTIVE_PARTY, "");
  }

  /* -------------------------------------------- */

  /**
   * @override — an Item or an ActiveEffect arriving on a member changes what the roster shows.
   *
   * All three descendant hooks, and the create is the one that matters most: a **Fatigue is an
   * Item** and a condition is an ActiveEffect, so the two things a group roster most needs to
   * report both reach an Actor as a create. Hooking only update and delete would leave a party
   * sheet insisting nobody is tired.
   */
  _onCreateDescendantDocuments(parent, collection, documents, data, options, userId) {
    super._onCreateDescendantDocuments(parent, collection, documents, data, options, userId);
    this.renderParties();
  }

  /** @override — see `_onCreateDescendantDocuments`. */
  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    this.renderParties();
  }

  /** @override — see `_onCreateDescendantDocuments`. */
  _onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId) {
    super._onDeleteDescendantDocuments(parent, collection, documents, ids, options, userId);
    this.renderParties();
  }

  /* -------------------------------------------- */

  /**
   * A token that was wearing this actor's name goes on wearing it.
   *
   * The rename runs ONE way. Renaming the actor carries the name to the tokens that shared it;
   * renaming a token never touches the actor, because a token named something else — "Bandit
   * Captain", a disguise, a second body — is deliberately its own thing and the rename would
   * overwrite the party's name for it.
   *
   * The test is against the name the actor had BEFORE this write, so it answers "were these two
   * the same thing a moment ago?" rather than "do they look alike now". A prototype token whose
   * name is blank needs nothing done to it: core falls back to the actor's name when it prepares
   * a token with no name of its own (`client/documents/token.mjs#prepareBaseData`), so it already
   * follows every rename.
   *
   * The prototype rides the actor's own update; the placed tokens cannot, and are done in
   * `_onUpdate` once this write has landed.
   */
  #followingTokenName(changes, options) {
    const name = changes.name;
    if (typeof name !== "string" || name === this.name) return;
    // An update that sets both is saying what it wants the token called; it is not overruled.
    if (foundry.utils.getProperty(changes, "prototypeToken.name") === undefined
      && this.prototypeToken.name === this.name) {
      foundry.utils.setProperty(changes, "prototypeToken.name", name);
    }
    foundry.utils.setProperty(options, `${SYSTEM_ID}.renamedFrom`, this.name);
  }

  /**
   * Carry a rename to the tokens of this actor already placed in scenes.
   *
   * Only LINKED tokens, and only those whose stored name is the one the actor just stopped using:
   * an unlinked token is a copy that went its own way the moment it was dropped, and a token with
   * no stored name follows the actor by itself. Each token is asked whether this user may write
   * to it, so a player renaming their own character updates their own token and silently skips a
   * scene they have no rights to rather than failing the rename.
   */
  async #renameTokens(from) {
    for (const scene of game.scenes) {
      const updates = scene.tokens
        .filter((token) => token.actorId === this.id && token.actorLink
          && token._source.name === from && token.canUserModify(game.user, "update"))
        .map((token) => ({ _id: token.id, name: this.name }));
      if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
    }
  }

  /* -------------------------------------------- */

  /*  2e recovery — each blocked by Deprived      */
  /* -------------------------------------------- */

  /** Rest: a moment's pause and a drink of water restores lost HP. */
  async rest() {
    if (this.system.deprived) {
      return ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DeprivedNoRecovery"));
    }
    const lines = [this.#recoveryLine("CAIRN.HitProtection", this.system.hp)].filter(Boolean);
    const updated = await this.update({ "system.hp.value": this.system.hp.max });
    await this.#postRecovery("CAIRN.Recovery.RestFlavor", lines);
    return updated;
  }

  /** A week's rest with a healer restores lost Attributes. */
  async restoreAbilities() {
    if (this.system.deprived) {
      return ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DeprivedNoRecovery"));
    }
    const { STR, DEX, WIL } = this.system.abilities;
    const lines = [["STR", STR], ["DEX", DEX], ["WIL", WIL]]
      .map(([key, attr]) => this.#recoveryLine(key, attr)).filter(Boolean);
    const updated = await this.update({
      "system.abilities.STR.value": STR.max,
      "system.abilities.DEX.value": DEX.max,
      "system.abilities.WIL.value": WIL.max,
    });
    await this.#postRecovery("CAIRN.Recovery.RestoreFlavor", lines);
    return updated;
  }

  /** One line of a recovery card — a value that is below its max, and so is about to move. */
  #recoveryLine(labelKey, { value, max }) {
    return value < max ? { label: game.i18n.localize(labelKey), from: value, to: max } : null;
  }

  /**
   * Say in chat what a recovery changed, so the table sees a player's character heal without
   * anyone watching the sheet. Only for a character a player has as their own — a Warden resting
   * an NPC or a spare sheet is bookkeeping, not play — and only when something moved.
   */
  async #postRecovery(flavorKey, lines) {
    if (!lines.length) return;
    if (!game.users.some((u) => !u.isGM && u.character?.id === this.id)) return;
    const content = await foundry.applications.handlebars.renderTemplate(
      `systems/${SYSTEM_ID}/templates/chat/recovery-card.hbs`, { lines });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.localize(flavorKey, { name: foundry.utils.escapeHTML(this.name) }),
      content
    });
  }

  /** Add one Fatigue item (one slot). With no free slot the creation is refused with a warning
   *  (`documents/item.js`), which is the rule: the player must drop something first. */
  async addFatigue() {
    return this.createEmbeddedDocuments("Item", [
      { name: game.i18n.localize("CAIRN.Fatigue"), type: "fatigue" },
    ]);
  }

  /** A full night's rest in a safe spot clears one Fatigue. */
  async removeFatigue() {
    if (this.system.deprived) {
      return ui.notifications.warn(game.i18n.localize("CAIRN.Notify.DeprivedNoRecovery"));
    }
    const fatigue = this.items.find((i) => i.type === "fatigue");
    if (fatigue) return fatigue.delete();
  }

  /* -------------------------------------------- */
  /*  Derived conditions                          */
  /* -------------------------------------------- */

  /**
   * Bring derived conditions in line with the numbers they are derived from, so a Warden reads a
   * token's state off the token instead of opening the sheet.
   *
   * **Only what `only` names**, and the callers in `module/cairn2e.js` name exactly what the write
   * that woke them actually changed. This is the difference between a marker and a cage: forcing
   * all five on every write meant a Warden could never set one by hand, because the next write to
   * the actor erased it. The SRD needs that toggle — `bestiary.md`'s Mind Blast paralyses a target
   * whose DEX never moves, and a PC left untreated after Critical Damage dies within the hour with
   * STR above 0 (`core-rules.md`). Passing nothing reconciles all five, which is what a caller that
   * does not know the diff should do.
   *
   * The trade is that this stops being self-healing for the four markers a Warden can set: one put
   * on (or taken off) by hand stays until the number behind it moves — for Encumbered, until an
   * item comes, goes or changes — and clearing it is the Warden's.
   *
   * An NPC reconciles Encumbered alone, from its slot count, and only when it has slots. Everything else on an NPC is the
   * Warden's to set — `core-rules.md` leaves a monster's death to their discretion — which is why
   * every condition stays clickable on an NPC token.
   *
   * Encumbered is the one derived condition something READS: `hp.effective` falls to 0 from the
   * status, not from the slot count (`data/actor-character.js`), so a Warden's hand-set Encumbered
   * zeroes HP exactly as a full ten does, and lifting it by hand gives the HP back.
   *
   * Nothing here enforces a rule. Dead is a marker on a PC at 0 STR, not a death; the Warden still
   * rules on what follows.
   *
   * @param {Set<string>|string[]|null} [only]  Condition ids to reconcile; all five if omitted.
   */
  async syncDerivedConditions(only = null) {
    if (this.type !== "character" && this.type !== "npc") return;
    const wanted = only === null ? null : new Set(only);
    // A creature with no slots has no count to follow, so its Encumbered is the Warden's alone —
    // otherwise editing one of its features would clear a hand-set one.
    const want = {};
    if (this.type === "character" || this.system.slotsMax > 0) want[CONDITION.ENCUMBERED] = this.system.slotsFull;
    if (this.type === "character") Object.assign(want, {
      [CONDITION.FATIGUED]: this.items.some((i) => i.type === "fatigue"),
      [CONDITION.DEAD]: this.system.abilities.STR.value === 0,
      [CONDITION.PARALYZED]: this.system.abilities.DEX.value === 0,
      [CONDITION.DELIRIOUS]: this.system.abilities.WIL.value === 0
    });
    // One delete and one create for the whole reconcile, not a `toggleStatusEffect` each: five
    // writes were five renders of the token, which a Warden sees as a flicker. The effects are
    // found and built exactly as core's toggle does (`Actor#toggleStatusEffect`): by the status's
    // static `_id` when it has one, else every single-status effect carrying it.
    const create = [];
    const remove = [];
    for (const [id, active] of Object.entries(want)) {
      if (wanted && !wanted.has(id)) continue;
      if (this.statuses.has(id) === active) continue;
      if (active) {
        const effect = await ActiveEffect.implementation.fromStatusEffect(id, { parent: this });
        create.push(effect.toObject());
        continue;
      }
      const staticId = CONFIG.statusEffects[id]?._id;
      if (staticId) remove.push(...(this.effects.has(staticId) ? [staticId] : []));
      else remove.push(...this.effects.filter((e) => e.statuses.size === 1 && e.statuses.has(id)).map((e) => e.id));
    }
    if (remove.length) await this.deleteEmbeddedDocuments("ActiveEffect", remove);
    if (create.length) await this.createEmbeddedDocuments("ActiveEffect", create, { keepId: true });
  }

  /* -------------------------------------------- */
  /*  A Scar's or a Growth's gain                 */
  /* -------------------------------------------- */

  /**
   * Move a maximum by a gain and record on `record` (a Scar or a Growth) what it did, in ONE
   * request: two awaited writes left a gain with no record, or a record of a gain never made, when
   * the second failed. `parent` is the actor's own, as `Document#update` passes it, so a token's
   * synthetic actor is routed to its delta (`client-backend.mjs#adjustActorDeltaRequest`).
   * @param {Item} record
   * @param {{ attr: string, mode: "higher"|"add"|"set", total: number }} gain
   * @returns {Promise<{from: number, to: number}>}
   */
  async applyGain(record, { attr, mode, total }) {
    const res = attrResource(this, attr);
    const path = attrPath(attr);
    const { from, to, value } = gainUpdate({ mode, total, max: res.max, value: res.value });
    await foundry.documents.modifyBatch([
      { action: "update", documentName: "Actor", parent: this.parent,
        updates: [{ _id: this.id, [`${path}.max`]: to, [`${path}.value`]: value }] },
      { action: "update", documentName: "Item", parent: this,
        updates: [{ _id: record.id, "system.outcome.attr": attr, "system.outcome.from": from,
          "system.outcome.to": to, "system.resolved": true }] }
    ]);
    return { from, to };
  }

  /** Put back what `record` did to a maximum, by the delta it recorded (`gains.js#revertUpdate`). */
  async revertGain(record) {
    if (!movedMaximum(record.system)) return null;
    const { attr, from, to } = record.system.outcome;
    const res = attrResource(this, attr);
    const path = attrPath(attr);
    const next = revertUpdate({ from, to, max: res.max, value: res.value });
    await this.update({ [`${path}.max`]: next.max, [`${path}.value`]: next.value });
    return next;
  }

  /* -------------------------------------------- */
  /*  Owned items (sheet actions)                 */
  /* -------------------------------------------- */

  async createOwnedItem(itemData) {
    await this.createEmbeddedDocuments("Item", [itemData]);
  }

  /** The sentence the delete question adds for a Scar or a Growth that changed a maximum, or ""
   *  for anything else — including one whose gain is still owed, which changed nothing. */
  #revertNotice(item) {
    if (!["scar", "growth"].includes(item.type) || !movedMaximum(item.system)) return "";
    const { attr, from, to } = item.system.outcome;
    const res = attrResource(this, attr);
    const { max } = revertUpdate({ from, to, max: res.max, value: res.value });
    const label = outcomeLabel(item.system.outcome);
    return ` ${game.i18n.localize("CAIRN.Scar.DeleteRevert", { label, from: res.max, to: max })}`;
  }

  async deleteOwnedItem(itemId) {
    const item = this.items.get(itemId);
    if (!item) {
      return ui.notifications.error(game.i18n.localize("CAIRN.NoItemToDelete"));
    }
    // A container takes its contents with it (`CairnItem#_preDeleteOperation`), so the question
    // says how many go too — a Backpack is up to six things behind a one-word question otherwise.
    const inside = item.system.isContainer ? item.system.contents.length : 0;
    const name = foundry.utils.escapeHTML(item.shownName);
    const proceed = await foundry.applications.api.DialogV2.confirm({
      classes: [SYSTEM_ID],
      // Deleting a Scar or a Growth puts back what it did, so the question says which number moves
      // and where to — the one thing about this delete that is not obvious from the row removed.
      content: `${game.i18n.localize("CAIRN.Notify.ConfirmDelete")} ${name}?`
        + (inside ? ` ${game.i18n.localize("CAIRN.Notify.ConfirmDeleteContents", { n: inside })}` : "")
        + this.#revertNotice(item),
      rejectClose: false,
      modal: true,
    });
    if (!proceed) return;
    await item.delete();
  }
}

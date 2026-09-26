/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { applyGold } from "../coin.js";
import { goldTotal } from "../coin-rules.js";
import { bundleItems } from "../transfer-rules.js";
import { deliverBarter } from "../transfer.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/barter`;
const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/barter-card.hbs`;

/** What may sit inside a container that is handed over. A Fatigue can be stowed
 *  (`data/item-fatigue.js`), and a Fatigue is not a thing anyone can be given. */
const PORTABLE = new Set(["gear", "coin"]);

/**
 * Barter — a player hands things from their character to another player's: gear, picked row by
 * row, and an amount of coin. One way, with nothing to accept: the trade itself is talked out at
 * the table, and this is the moment the goods change hands.
 *
 * Only characters a player has as their own are offered, the sender's excepted. The write runs
 * where it is allowed (`transfer.js#deliverBarter`): whatever fits arrives, whatever does not
 * stays, and the sender is told which. A card in chat says what went from whom to whom.
 *
 * A container goes with what is in it, so ticking one ticks its contents with it; a thing in a
 * container can also be handed over on its own, and arrives on the other character's body. The
 * coin offered is what the character holds outside any container being handed over — the coin
 * in a Backpack goes with the Backpack.
 */
export class CairnBarter extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static INK_SCROLLERS = [".cairn-barter-list"];

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-barter"],
    position: { width: 400, height: "auto" },
    window: { icon: "fa-solid fa-handshake", resizable: false },
    actions: {
      barterPick: CairnBarter.#onPick,
      barterSend: CairnBarter.#onSend
    }
  };

  static PARTS = {
    items: { template: `${TEMPLATES}/items.hbs`, scrollable: [".cairn-barter-list"] },
    foot: { template: `${TEMPLATES}/foot.hbs` }
  };

  /** @param {{ actor: Actor }} options */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  /** Ids of the things picked. */
  #picked = new Set();

  /** The coin typed, and the recipient chosen — kept here so a redraw of the foot keeps them. */
  #coin = 0;
  #target = "";

  /** A send is out: Send stays dead until it answers, so one click is one trade. */
  #busy = false;

  get title() {
    return `${game.i18n.localize("CAIRN.Barter.Title")}: ${this.actor.name}`;
  }

  /** The coin that is free to offer: everything but what sits in a container being handed over. */
  #coinMax() {
    const inside = this.actor.items.filter((i) => i.type === "coin" && this.#picked.has(i.system.container));
    return Math.max(0, goldTotal(this.actor.items) - goldTotal(inside));
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const items = this.actor.items;
    const rows = [];
    const byName = (a, b) => a.name.localeCompare(b.name);
    for (const item of items.filter((i) => i.type === "gear" && !i.system.container).sort(byName)) {
      const contents = items.filter((i) => i.system.container === item.id).sort(byName);
      const blocked = contents.some((c) => !PORTABLE.has(c.type));
      const whole = this.#picked.has(item.id);
      rows.push({
        id: item.id, name: item.name, img: item.img, picked: whole, locked: blocked,
        reason: blocked ? game.i18n.localize("CAIRN.Barter.HoldsFatigue") : "",
        setAside: item.system.carried === false && !item.system.isContainer
      });
      for (const c of contents) {
        const coin = c.type === "coin";
        rows.push({
          id: c.id, img: c.img, inside: true,
          name: coin ? `${c.name} (${c.system.value} ${game.i18n.localize("CAIRN.GoldAbbrev")})` : c.name,
          // Coin is handed over by amount, below, so a sack is never picked on its own; inside a
          // container that goes, it goes too, and says so.
          picked: whole || this.#picked.has(c.id),
          locked: whole || coin || !PORTABLE.has(c.type)
        });
      }
    }
    rows.forEach((row, i) => { row.rule = i < rows.length - 1; });
    context.rows = rows;

    const seen = new Set();
    context.targets = game.users
      .filter((u) => !u.isGM && u.character)
      .map((u) => u.character)
      .filter((a) => a.type === "character" && a.id !== this.actor.id && !seen.has(a.id) && seen.add(a.id))
      .sort(byName)
      .map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === this.#target }));
    context.actorId = this.actor.id;
    context.coinMax = this.#coinMax();
    this.#coin = Math.min(this.#coin, context.coinMax);
    context.coin = this.#coin;
    return context;
  }

  /** @override — the coin field and the recipient are typed and chosen, not clicked, so they are
   *  bound on the foot that was just made, never over `this.element`. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "foot") return;
    htmlElement.querySelector("input[name=coin]").addEventListener("input", (event) => {
      const n = Math.floor(Number(event.currentTarget.value));
      this.#coin = Number.isFinite(n) ? Math.min(Math.max(0, n), this.#coinMax()) : 0;
      this.#syncSend();
    });
    htmlElement.querySelector("select[name=target]").addEventListener("change", (event) => {
      this.#target = event.currentTarget.value;
      this.#syncSend();
    });
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#syncSend();
  }

  /** Send is live with a recipient chosen and something to give, and while no send is out. */
  #syncSend() {
    const send = this.element.querySelector("[data-action=barterSend]");
    if (send) send.disabled = this.#busy || !this.#target || (!this.#picked.size && !this.#coin);
  }

  static #onPick(event, target) {
    const id = target.dataset.id;
    if (this.#picked.has(id)) {
      this.#picked.delete(id);
    } else {
      this.#picked.add(id);
      // Its contents go inside it; picked on their own as well, they would be counted twice.
      for (const c of this.actor.items) if (c.system.container === id) this.#picked.delete(c.id);
    }
    this.render({ parts: ["items", "foot"] });
  }

  static async #onSend() {
    const target = await fromUuid(this.#target);
    const coin = Math.min(this.#coin, this.#coinMax());
    const chosen = [...this.#picked].map((id) => this.actor.items.get(id)).filter(Boolean);
    if (!target || (!chosen.length && !coin)) return;

    this.#busy = true;
    this.#syncSend();
    try {
      const bundles = bundleItems(chosen.map((i) => i.toObject()), this.actor.items.map((i) => i.toObject()));
      const result = await deliverBarter(target, { targetUuid: target.uuid, bundles, coin });
      if (!result) return ui.notifications.warn(game.i18n.localize("CAIRN.Barter.NobodyToReceive", { name: target.name }));
      if (result.refused) return ui.notifications.error(game.i18n.localize("CAIRN.Barter.Refused"));

      const landed = new Set(result.landed);
      const moved = bundles.filter((b) => landed.has(b.id)).map((b) => b.data.name);
      const left = bundles.filter((b) => !landed.has(b.id)).map((b) => b.data.name);
      if (landed.size) await this.actor.deleteEmbeddedDocuments("Item", [...landed]);
      if (result.coin) await applyGold(this.actor, -result.coin);

      if (left.length) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Barter.LeftBehind", { names: left.join(", "), name: target.name }));
      }
      if (coin && !result.coin) {
        ui.notifications.warn(game.i18n.localize("CAIRN.Barter.CoinLeftBehind", { amount: coin, name: target.name }));
      }
      if (!moved.length && !result.coin) return;

      const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, { items: moved, coin: result.coin });
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: game.i18n.localize("CAIRN.Barter.Flavor", { from: this.actor.name, to: target.name }),
        content
      });
      this.#picked.clear();
      this.#coin = 0;
      await this.close();
    } finally {
      this.#busy = false;
      if (this.rendered) this.render({ parts: ["items", "foot"] });
    }
  }
}

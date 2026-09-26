/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/whisper`;
const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/whisper-card.hbs`;

/**
 * Whisper — a private word, spoken as the character, to the connected users the player picks.
 * Core's own whisper targeting carries it (`ChatMessage#whisper`), so only the picked users and
 * the Warden's GM view ever see it.
 *
 * Plain text: what is typed is escaped before it reaches the card, so pasted markup is shown and
 * never run. Line breaks are the one thing carried over.
 *
 * Picking a user redraws nothing — the user's button and Send are set in place — so the
 * text being written is never thrown away by a click.
 */
export class CairnWhisper extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-whisper"],
    position: { width: 380, height: "auto" },
    window: { icon: "fa-solid fa-comment-dots", resizable: false },
    actions: {
      whisperPick: CairnWhisper.#onPick,
      whisperSend: CairnWhisper.#onSend
    }
  };

  static PARTS = {
    recipients: { template: `${TEMPLATES}/recipients.hbs` },
    message: { template: `${TEMPLATES}/message.hbs` }
  };

  /** @param {{ actor: Actor }} options */
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  /** Ids of the users picked. Kept across renders; a user who has since left is dropped. */
  #picked = new Set();

  get title() {
    return `${game.i18n.localize("CAIRN.Whisper.Title")}: ${this.actor.name}`;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const users = game.users.filter((u) => u.active && !u.isSelf);
    for (const id of this.#picked) if (!users.some((u) => u.id === id)) this.#picked.delete(id);
    context.users = users
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ id: u.id, name: u.name, picked: this.#picked.has(u.id) }));
    return context;
  }

  /** @override — keys are not clicks, so Ctrl+Enter and the typing that arms Send are bound on
   *  the part that was just made, never over `this.element`, where a surviving textarea would
   *  collect one more listener per render. */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "message") return;
    const box = htmlElement.querySelector("textarea[name=message]");
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      CairnWhisper.#onSend.call(this);
    });
    box.addEventListener("input", () => this.#syncSend());
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.#syncSend();
    this.element.querySelector("textarea[name=message]")?.focus();
  }

  /** Send is live while someone is picked and something is written. */
  #syncSend() {
    const text = this.element.querySelector("textarea[name=message]")?.value.trim();
    const send = this.element.querySelector("[data-action=whisperSend]");
    if (send) send.disabled = !this.#picked.size || !text;
  }

  static #onPick(event, target) {
    const id = target.dataset.userId;
    if (this.#picked.has(id)) this.#picked.delete(id);
    else this.#picked.add(id);
    target.setAttribute("aria-pressed", String(this.#picked.has(id)));
    this.#syncSend();
  }

  static async #onSend() {
    const text = this.element.querySelector("textarea[name=message]")?.value.trim();
    const to = [...this.#picked];
    if (!to.length || !text) return;
    const names = to.map((id) => game.users.get(id)?.name).filter(Boolean);
    const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, {
      text: foundry.utils.escapeHTML(text).replace(/\r?\n/g, "<br>")
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.localize("CAIRN.Whisper.Flavor", { names: names.join(", ") }),
      content,
      whisper: to
    });
    ui.notifications.info(game.i18n.localize("CAIRN.Whisper.Sent", { names: names.join(", ") }));
    this.#picked.clear();
    await this.close();
  }
}

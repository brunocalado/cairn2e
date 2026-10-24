/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, TABLES } from "../constants.js";
import { fromPack } from "../helpers.js";
import { SCAR_ENTRIES, scarEntry, applyScarGain, outcomeLabel } from "../scars.js";
import { rollScarDie, rollScarSave } from "../rolls.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { CairnSheetMixin } from "./_sheet-mixin.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/scars`;
const CARD = `systems/${SYSTEM_ID}/templates/chat/scar-card.hbs`;

/** The query a client sends to hand the Scars window to the character's own player. Registered in
 *  `module/cairn2e.js`; the name is built from `SYSTEM_ID`, never written out. */
export const SCAR_QUERY = `${SYSTEM_ID}.openScars`;

/** The rows of the table, as `{ entry, title, text }`, cached for the session after the first
 *  read. Every row of the shipped table is written "<Title>: <text>", so the title is the words
 *  before the first colon — one source for both, and a title that cannot drift from its prose. */
let ROWS = null;

async function tableRows() {
  if (ROWS) return ROWS;
  const table = await fromPack(TABLES.SCARS);
  if (!table) return null;
  ROWS = [...table.results]
    .sort((a, b) => a.range[0] - b.range[0])
    .map((result) => {
      const text = result.description ?? "";
      const cut = text.indexOf(":");
      return {
        entry: result.range[0],
        title: cut > 0 ? text.slice(0, cut) : text,
        text: cut > 0 ? text.slice(cut + 1).trim() : ""
      };
    });
  return ROWS;
}

/** "2d6 · 3+5 = 8", or "d6 · 4" for a single die: the faces, printed beside the line they decided. */
function diceText(roll) {
  const faces = roll.dice.flatMap((die) => die.results.map((r) => r.result));
  const formula = roll.formula.replace(/^1d/, "d");
  return faces.length > 1 ? `${formula} · ${faces.join("+")} = ${roll.total}` : `${formula} · ${roll.total}`;
}

/**
 * One line of what a Scar did: `{ label, value, dice, tone }`. `tone` is how the line reads —
 * "gain" and "loss" for what a die moved, "state" for a condition the row put on, "owed" for a
 * roll still waiting. The window says all of it with weight; the chat card gives the two a die
 * decided the roll-outcome hue, and a condition, which is a state, stays ink.
 */
const line = (label, value, { dice = "", tone = "" } = {}) => ({ label, value, dice, tone });

function conditionLine(id) {
  const name = CONFIG.statusEffects.find((e) => e.id === id)?.name ?? id;
  return line(game.i18n.localize("CAIRN.Scar.Line.Now"), game.i18n.localize(name), { tone: "state" });
}

/**
 * The window a character takes a Scar in (`srd-2e/players-guide/core-rules.md` → Scars).
 *
 * It shows the one row the HP lost lands on and a single button that rolls everything that row
 * rolls at once — where it landed, which attribute, the WIL save, the gain — writing each result
 * into the window as its die lands, and into the Scar's chat card with it. The player sees what
 * the hit did to them, line by line, instead of a maximum that moved on its own; the window stays
 * open until they close it.
 *
 * The twelve rows are behind a toggle for the Warden, who may say a different row applies, and
 * open from the start when there was no hit (the Scars tab's Add). A player answering a hit cannot
 * change the row: the row is also what its dice are rolled against.
 *
 * The incoming number is CLAMPED into the table. The table has twelve rows and a character's
 * maximum HP can pass twelve (rows 3, 6, 9 and 12 raise it), and a draw outside the range used to
 * produce nothing at all.
 *
 * A row that defers its gain ("once mended", "after recovery") is taken here with the gain owed:
 * it waits on the fiction and is rolled from the character's Growth tab when the table agrees.
 */
export class CairnScars extends CairnInkMixin(CairnSheetMixin(HandlebarsApplicationMixin(DocumentSheetV2))) {
  /** @override — the rules between rows are measured from viewport positions, so the scrolling
   *  list repaints them as it moves, or they stay put while the text slides under them. */
  static INK_SCROLLERS = [".cairn-scars-list"];

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-scars"],
    position: { width: 460, height: "auto" },
    window: { icon: "fa-solid fa-heart-crack", resizable: false },
    sheetConfig: false,
    ownershipConfig: false,
    canImport: false,
    actions: {
      scarPick: CairnScars.#onPick,
      scarToggleTable: CairnScars.#onToggleTable,
      scarRoll: CairnScars.#onRoll,
      scarDone: CairnScars.#onDone
    }
  };

  // Three parts rather than one: the list is the scroller, and the head and foot redraw on every
  // die that lands while the list does not change.
  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    rows: { template: `${TEMPLATES}/rows.hbs`, scrollable: [""] },
    footer: { template: `${TEMPLATES}/footer.hbs` }
  };

  /**
   * @param {number|null} hpLost  How the window was reached. A number is a hit — the head prints
   *   it and the row it indexes is the one taken. `null` is the Scars tab's Add: nothing was lost,
   *   and the list is open to pick a row from.
   * @param {ChatMessage|null} message  The Scar's card, filled in as the dice land when this
   *   user may write it; otherwise the roll posts a card of its own.
   */
  constructor(options = {}) {
    super(options);
    this.hpLost = options.hpLost ?? null;
    this.message = options.message ?? null;
    /** The notice card this window answers, if any. `message` moves to a card of this user's own
     *  when they cannot write the notice; the Scar remembers the notice, so its button stops. */
    this.cardId = this.message?.id ?? null;
    this.entry = Math.min(Math.max(this.hpLost ?? 1, 1), SCAR_ENTRIES.length);
    // The row a hit lands on is the HP it took, not a choice. Only the Warden may say otherwise.
    this.locked = this.hpLost !== null && !game.user.isGM;
    this.tableOpen = this.hpLost === null;
    /** "ready" until the button is pressed, "rolling" while the dice land, then "done". */
    this.phase = "ready";
    /** `{ name, dice }` once the row's location die has landed. */
    this.location = null;
    this.lines = [];
  }

  get title() {
    return game.i18n.localize("CAIRN.Scar.Title");
  }

  /** The Scar's name: the row's title, and where it landed when the row says where. It is the
   *  item's name and the card's lead alike. */
  #scarName(row) {
    const title = row?.title ?? "";
    return this.location ? `${title} (${this.location.name})` : title;
  }

  /** What the button will roll, said before it is pressed. */
  #preview(spec) {
    const parts = [];
    if (spec.location) parts.push(game.i18n.localize("CAIRN.Scar.Preview.Location"));
    if (spec.choose) parts.push(game.i18n.localize("CAIRN.Scar.Preview.Attribute"));
    if (!spec.deferred && spec.save) parts.push(game.i18n.localize("CAIRN.Scar.Preview.Save", { key: game.i18n.localize(spec.save) }));
    if (!spec.deferred) parts.push(game.i18n.localize("CAIRN.Scar.Preview.Gain", { formula: spec.formula }));
    if (!parts.length) return "";
    return game.i18n.localize("CAIRN.Scar.Preview.Rolls", { list: game.i18n.getListFormatter().format(parts) });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rows = (await tableRows()) ?? [];
    const row = rows.find((r) => r.entry === this.entry);
    const spec = scarEntry(this.entry);
    const ready = this.phase === "ready";
    context.hpLost = this.hpLost;
    context.number = this.hpLost ?? this.entry;
    context.name = this.#scarName(row);
    context.text = row?.text ?? "";
    context.placeDice = this.location?.dice ?? "";
    context.canToggle = ready && this.hpLost !== null && !this.locked;
    context.tableOpen = this.tableOpen;
    context.showTable = ready && this.tableOpen;
    context.locked = this.locked;
    context.rows = rows.map((r) => ({ ...r, selected: r.entry === this.entry }));
    context.ready = ready;
    context.rolling = this.phase === "rolling";
    context.done = this.phase === "done";
    context.preview = ready ? this.#preview(spec) : "";
    context.deferredNote = ready && !!spec.deferred;
    // A row with nothing to roll now (3, 5, 7, 11, 12) is taken, not rolled.
    context.buttonLabel = spec.location || spec.choose || !spec.deferred ? "CAIRN.Scar.Roll" : "CAIRN.Scar.Take";
    // Only the line that just landed fades in; the ones above it were already read.
    context.lines = this.lines.map((l, i) => ({ ...l, fresh: i === this.lines.length - 1 }));
    return context;
  }

  /** Choose a different row: the Warden's word beats the arithmetic. */
  static async #onPick(event, target) {
    if (this.locked || this.phase !== "ready") return;
    const entry = Number(target.dataset.entry);
    if (!Number.isFinite(entry) || entry === this.entry) return;
    this.entry = entry;
    await this.render();
  }

  static async #onToggleTable() {
    this.tableOpen = !this.tableOpen;
    await this.render();
  }

  static async #onDone() {
    await this.close();
  }

  /**
   * Roll the scar. The flag outlives a re-render, the button's `disabled` does not: the scar's own
   * create re-renders this actor-bound window within milliseconds, and a second click on a fresh
   * button took a second Scar.
   */
  static async #onRoll(event, target) {
    if (this.#busy || this.phase !== "ready") return;
    this.#busy = true;
    target.setAttribute("disabled", "disabled");
    try {
      return await this.#roll();
    } finally {
      this.#busy = false;
    }
  }

  /** A roll is out. */
  #busy = false;

  /**
   * `#onRoll`'s body. Every die is awaited before the next — Dice So Nice holds each until it
   * lands — and each result is shown before the next die is thrown, so the table watches the Scar
   * happen in the order the row reads.
   *
   * The record is created after the dice that name it and before the gain, so a row that defers
   * its roll is a scar the character carries from this moment with the roll still owed.
   */
  async #roll() {
    const actor = this.document;
    const spec = scarEntry(this.entry);
    const row = ((await tableRows()) ?? []).find((r) => r.entry === this.entry);
    this.phase = "rolling";
    await this.#show();

    if (spec.location) {
      const roll = await rollScarDie("1d6");
      // The die names a key (`scars.js#SCAR_ENTRIES`); what is printed, and what the Scar is named
      // with, is that place in the table's language.
      this.location = {
        name: game.i18n.localize(`CAIRN.Scar.Locations.${spec.location[roll.total - 1]}`),
        dice: diceText(roll)
      };
      await this.#show();
    }

    // Row 6's d6 picks which attribute grows; every other row knows its own. The die is printed
    // on the gain's line, which already names the attribute.
    let attr = spec.attr ?? "";
    let chosen = "";
    if (spec.choose) {
      const roll = await rollScarDie("1d6");
      attr = spec.choose[roll.total - 1];
      chosen = diceText(roll);
    }

    // The flag is what `CairnItem._preCreateOperation` looks for: this window is the one place a
    // scar may be created, and a scar that arrives any other way is refused.
    const [scar] = await actor.createEmbeddedDocuments("Item", [{
      name: this.#scarName(row),
      type: "scar",
      system: {
        entry: this.entry,
        description: row ? `<p>${row.text}</p>` : "",
        outcome: { attr },
        resolved: false
      },
      flags: this.cardId ? { [SYSTEM_ID]: { scarCard: this.cardId } } : {}
    }], { [SYSTEM_ID]: { scar: true } });

    // Deprived or Doomed, on the rows that say so. Clearing it is a night's rest or the next
    // Critical Damage save — the system does not take conditions off by itself.
    if (spec.condition) {
      await actor.toggleStatusEffect(spec.condition, { active: true });
      this.lines.push(conditionLine(spec.condition));
      await this.#show();
    }

    if (spec.deferred) {
      this.lines.push(line(game.i18n.localize("CAIRN.Scar.Line.Owed"),
        game.i18n.localize("CAIRN.Scar.Line.OwedValue", { formula: spec.formula }), { tone: "owed" }));
    } else {
      await CairnScars.resolve(actor, scar, {
        post: false,
        chosen,
        onLine: async (l) => {
          this.lines.push(l);
          await this.#show();
        }
      });
    }
    this.phase = "done";
    await this.#show();
    return scar;
  }

  /** Draw the state the roll has reached, here and on the card. The window may have been closed
   *  mid-roll; the card is finished anyway, because the table is reading it. */
  async #show() {
    if (this.rendered) await this.render();
    const content = await foundry.applications.handlebars.renderTemplate(CARD, {
      name: this.#scarName(((await tableRows()) ?? []).find((r) => r.entry === this.entry)),
      lost: this.hpLost,
      lines: this.lines,
      rolling: this.phase === "rolling"
    });
    // A message is its author's to write (and the Warden's). The card the window was opened with
    // is this user's when they posted it themselves; one the Warden posted for a player who was
    // away is not, and the roll tells its story in a card of its own. So does a card deleted while
    // the dice were landing, or the update would throw and leave the Scar half rolled.
    if (this.message?.isOwner && game.messages.has(this.message.id)) {
      await this.message.update({ content });
      return;
    }
    this.message = await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: game.i18n.localize("CAIRN.Scar.Title"),
      content
    });
  }

  /**
   * Roll a scar's gain and apply it — from the window when the row grows at once, and from the
   * Growth tab when a deferred row's moment arrives. A row gated by a save (8 and 10) grows only
   * on a pass; a failure resolves the scar with no change, which is not the same thing as still
   * owing the roll.
   * @param {Actor} actor
   * @param {Item} scar
   * @param {object} [options]
   * @param {boolean} [options.post]  post the lines as a card of their own (the Growth tab's case)
   * @param {string} [options.chosen]  the row 6 die that picked the attribute, for the gain's line
   * @param {(line: object) => Promise<void>} [options.onLine]  called as each line lands
   * @returns {Promise<object[]>} the lines
   */
  static async resolve(actor, scar, { post = true, chosen = "", onLine } = {}) {
    const spec = scarEntry(scar.system.entry);
    const lines = [];
    const add = async (l) => {
      lines.push(l);
      await onLine?.(l);
    };

    let grows = true;
    if (spec.save) {
      const { roll, passed, target } = await rollScarSave(actor, spec.save);
      grows = passed;
      await add(line(
        game.i18n.localize("CAIRN.Save", { key: game.i18n.localize(spec.save) }),
        game.i18n.localize(passed ? "CAIRN.Scar.Line.Passed" : "CAIRN.Scar.Line.Failed"),
        { dice: game.i18n.localize("CAIRN.Scar.Line.SaveDice", { dice: diceText(roll), target }), tone: passed ? "gain" : "loss" }
      ));
      if (!passed) await scar.update({ "system.resolved": true });
    }

    if (grows) {
      const roll = await rollScarDie(spec.formula);
      const { from, to } = await applyScarGain(actor, scar, roll.total);
      const dice = chosen ? `${chosen}, ${diceText(roll)}` : diceText(roll);
      await add(line(
        outcomeLabel(scar.system.outcome),
        from === to ? game.i18n.localize("CAIRN.Scar.Line.Unbeaten", { from }) : `${from} → ${to}`,
        { dice, tone: to > from ? "gain" : to < from ? "loss" : "" }
      ));
    }

    if (post) await CairnScars.post(actor, scar, lines);
    return lines;
  }

  /**
   * A character has landed on exactly 0: put the Scar in front of the player whose character it
   * is. The rules have the player roll on the table, so the window goes to the OWNER, not to
   * whoever swung — and the owner's client posts the card, because a message is its author's to
   * write and the window fills that card in as the dice land.
   *
   * With no owner connected, this client posts the card, and its button opens the same window
   * whenever they come back. `User#query` throws when the target is not connected
   * (`client/documents/user.mjs`), which is exactly that case.
   */
  static async announce(actor, hpLost) {
    // The Warden does not roll for a player who is away, and a character nobody plays has no one
    // to hand the window to: both fall through to the card, whose button waits.
    const owners = game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
    if (owners.some((u) => u.isSelf)) return CairnScars.take(actor, hpLost);
    for (const owner of owners) {
      try {
        return await owner.query(SCAR_QUERY, { actorUuid: actor.uuid, hpLost }, { timeout: 20000 });
      } catch (err) {
        console.warn(`${SYSTEM_ID} | could not hand the Scars window to ${owner.name}`, err);
      }
    }
    return CairnScars.#postNotice(actor, hpLost);
  }

  /** On the owner's client: post the Scar's card and open the window that fills it in. */
  static async take(actor, hpLost) {
    const message = await CairnScars.#postNotice(actor, hpLost);
    return CairnScars.open(actor, { hpLost, message });
  }

  /** The card a Scar starts as: who owes it, how much was lost, and the button that opens the
   *  window. The flags carry the actor, not the speaker's token: a Scar can be rolled a session
   *  later, when that token is gone. */
  static async #postNotice(actor, hpLost) {
    const content = await foundry.applications.handlebars.renderTemplate(CARD, {
      notice: true,
      name: actor.name,
      lost: hpLost
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: game.i18n.localize("CAIRN.Scar.Title"),
      content,
      flags: { [SYSTEM_ID]: { scarActor: actor.uuid, scarHpLost: hpLost } }
    });
  }

  /** A gain rolled later, from the Growth tab: its own event, and its own card. */
  static async post(actor, scar, lines) {
    const content = await foundry.applications.handlebars.renderTemplate(CARD, { name: scar.name, lines });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: game.i18n.localize("CAIRN.Scar.Title"),
      content
    });
  }

  /**
   * Whether the Scar this notice card asks for has been taken. The card cannot say so itself when
   * the Warden posted it for a player who was away: the player cannot rewrite the Warden's message,
   * so the Scar carries the card's id instead.
   */
  static taken(actor, message) {
    return actor.items.some((i) => i.type === "scar" && i.getFlag(SYSTEM_ID, "scarCard") === message.id);
  }

  /** The way in, from anywhere: `game.cairn2e.scars.open(actor, { hpLost })` — or without
   *  `hpLost` when no hit is being answered, which is what the Scars tab's Add passes. */
  static async open(actor, { hpLost = null, message = null } = {}) {
    if (!actor) return null;
    if (message && CairnScars.taken(actor, message)) {
      ui.notifications.info(game.i18n.localize("CAIRN.Scar.Taken"));
      return null;
    }
    if (!(await tableRows())) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Scar.NoTable"));
      return null;
    }
    // One window per character: a second open brings the first forward rather than stacking a
    // twin under the same id, where either could take the Scar. A window whose Scar is already
    // taken has nothing left to offer, and gives way to the new one.
    const open = [...foundry.applications.instances.values()].find((a) => a instanceof CairnScars && a.document === actor);
    if (open?.phase === "done") await open.close();
    else if (open) return open.render(true);
    return new CairnScars({ document: actor, hpLost, message }).render(true);
  }
}

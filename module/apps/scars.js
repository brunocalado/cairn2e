/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, TABLES } from "../constants.js";
import { fromPack } from "../helpers.js";
import { SCAR_ENTRIES, scarEntry, applyScarGain, outcomeText } from "../scars.js";
import { rollScarDie, rollSave } from "../rolls.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { CairnSheetMixin } from "./_sheet-mixin.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/scars`;
const CHAT = `systems/${SYSTEM_ID}/templates/chat`;

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

/**
 * The window a character takes a Scar in (`srd-2e/players-guide/core-rules.md` → Scars).
 *
 * It is opened with an actor and the HP lost, and everything the rule needs is inside it: the
 * twelve rows with the one for that number already chosen, the row's own location die, and the
 * button that takes it. Nothing here depends on a chat card or on a marked token — a character
 * walked down to 0 on their own sheet reaches this same window.
 *
 * The incoming number is CLAMPED into the table. The table has twelve rows and a character's
 * maximum HP can pass twelve (rows 3, 6, 9 and 12 raise it), and a draw outside the range used to
 * produce nothing at all — Foundry's own `RollTable#roll` warns and returns an empty result set,
 * which read at the table as "the system forgot".
 *
 * The gain is not offered here for a row that defers it ("once mended", "after recovery"):
 * those wait on the fiction and are rolled from the character's Scars tab when the table agrees.
 */
export class CairnScars extends CairnInkMixin(CairnSheetMixin(HandlebarsApplicationMixin(DocumentSheetV2))) {
  /** @override — the rules between rows are measured from viewport positions, so the scrolling
   *  list repaints them as it moves, or they stay put while the text slides under them. */
  static INK_SCROLLERS = [".cairn-scars-list"];

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "cairn-scars"],
    position: { width: 520, height: 560 },
    window: { icon: "fa-solid fa-heart-crack", resizable: false },
    sheetConfig: false,
    ownershipConfig: false,
    canImport: false,
    actions: {
      scarPick: CairnScars.#onPick,
      scarRollLocation: CairnScars.#onRollLocation,
      scarConfirm: CairnScars.#onConfirm
    }
  };

  // Three parts rather than one: a re-render after picking a row rebuilds the list and the foot,
  // and the list is the scroller.
  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    rows: { template: `${TEMPLATES}/rows.hbs`, scrollable: [""] },
    footer: { template: `${TEMPLATES}/footer.hbs` }
  };

  /**
   * @param {number|null} hpLost  How the window was reached. A number is a hit — the head prints
   *   it and the row it indexes comes up chosen. `null` is the Scars tab's Add: nothing was lost,
   *   the head says only that a row is to be picked, and the list starts at row 1.
   */
  constructor(options = {}) {
    super(options);
    this.hpLost = options.hpLost ?? null;
    this.entry = Math.min(Math.max(this.hpLost ?? 1, 1), SCAR_ENTRIES.length);
    this.location = null;
  }

  get title() {
    return game.i18n.localize("CAIRN.Scar.Title");
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const rows = (await tableRows()) ?? [];
    const spec = scarEntry(this.entry);
    context.hpLost = this.hpLost;
    context.rows = rows.map((row) => ({ ...row, selected: row.entry === this.entry }));
    context.location = this.location;
    context.canRollLocation = !!spec.location && !this.location;
    context.deferredNote = !!spec.deferred;
    return context;
  }

  /** Choose a different row: the Warden's word beats the arithmetic. */
  static async #onPick(event, target) {
    const entry = Number(target.dataset.entry);
    if (!Number.isFinite(entry) || entry === this.entry) return;
    this.entry = entry;
    this.location = null;
    await this.render();
  }

  /** The row's own d6: where it landed, in the words the row lists. */
  static async #onRollLocation(event, target) {
    target.setAttribute("disabled", "disabled");
    const spec = scarEntry(this.entry);
    const total = await rollScarDie("1d6");
    this.location = spec.location[total - 1];
    await this.render();
  }

  /**
   * Take the scar: create the record, then roll whatever the row takes at once.
   *
   * The record is created FIRST and separately from the gain, so a row that defers its roll is
   * a scar the character carries from this moment with the roll still owed — which is what the
   * table says, and what the Scars tab draws.
   */
  static async #onConfirm(event, target) {
    target.setAttribute("disabled", "disabled");
    const actor = this.document;
    const spec = scarEntry(this.entry);
    const rows = (await tableRows()) ?? [];
    const row = rows.find((r) => r.entry === this.entry);

    // Row 6's d6 picks which attribute grows; every other row knows its own.
    let attr = spec.attr ?? "";
    if (spec.choose) {
      const face = await rollScarDie("1d6");
      attr = spec.choose[face - 1];
    }

    // The flag is what `CairnItem._preCreateOperation` looks for: this window is the one place a
    // scar may be created, and a scar that arrives any other way is refused.
    const [scar] = await actor.createEmbeddedDocuments("Item", [{
      name: this.location ? `${row.title} (${this.location})` : row.title,
      type: "scar",
      system: {
        entry: this.entry,
        description: row ? `<p>${row.text}</p>` : "",
        outcome: { attr },
        resolved: false
      }
    }], { [SYSTEM_ID]: { scar: true } });

    // Deprived, on the two rows that say so. Clearing it is a night's rest, which stays the
    // player's — the system does not take conditions off by itself.
    if (spec.condition) await actor.toggleStatusEffect(spec.condition, { active: true });

    if (!spec.deferred) await CairnScars.resolve(actor, scar, { post: false });
    await CairnScars.post(actor, scar);
    await this.close();
    return scar;
  }

  /**
   * Roll a scar's gain and apply it — here, and from the Scars tab when a deferred row's
   * moment arrives. A row gated by a save (8 and 10) grows only on a pass; a failure resolves the
   * scar with no change, which is not the same thing as still owing the roll.
   */
  static async resolve(actor, scar, { post = true } = {}) {
    const spec = scarEntry(scar.system.entry);
    let grown = null;
    if (spec.save && !(await rollSave(actor, spec.save))) {
      await scar.update({ "system.resolved": true });
    } else {
      const total = await rollScarDie(spec.formula);
      grown = await applyScarGain(actor, scar, total);
    }
    // The window posts one card for the whole of taking a scar; a roll made later from the Scars
    // tab is its own event and says so.
    if (post) await CairnScars.post(actor, scar);
    return grown;
  }

  /**
   * A character has landed on exactly 0: tell the table, and put the window in front of the player
   * whose character it is.
   *
   * The card is posted by the client that made the hit, and it is posted whether or not anybody is
   * there to roll — a Scar owed by a player who is not connected is not lost, because the card's
   * button opens the same window whenever they come back.
   *
   * The window itself goes to the OWNER, not to whoever swung: the rules have the player roll on
   * the table. `User#query` throws when the target is not connected (`client/documents/user.mjs`),
   * which is exactly the case the card already covers, so the failure is logged and nothing else.
   */
  static async announce(actor, hpLost) {
    const content = await foundry.applications.handlebars.renderTemplate(`${CHAT}/scar-notice-card.hbs`, {
      name: actor.name,
      lost: hpLost
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: game.i18n.localize("CAIRN.Scar.Title"),
      content,
      flags: { [SYSTEM_ID]: { scarActor: actor.uuid, scarHpLost: hpLost } }
    });

    // Nobody else opens it. A character with no player owner never gets here at all
    // (`scarHpLost`), and one whose player is not connected keeps the card until they are: the
    // player rolls on the table, not the Warden on their behalf.
    const owners = game.users.filter((u) => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
    if (owners.some((u) => u.isSelf)) return CairnScars.open(actor, { hpLost });
    for (const owner of owners) {
      try {
        return await owner.query(SCAR_QUERY, { actorUuid: actor.uuid, hpLost }, { timeout: 20000 });
      } catch (err) {
        console.warn(`${SYSTEM_ID} | could not hand the Scars window to ${owner.name}`, err);
      }
    }
    return null;
  }

  /** What the character came away with, for the table to hear. */
  static async post(actor, scar) {
    const content = await foundry.applications.handlebars.renderTemplate(`${CHAT}/scar-result-card.hbs`, {
      name: scar.name,
      text: foundry.utils.getType(scar.system.description) === "string"
        ? scar.system.description.replace(/<[^>]+>/g, "")
        : "",
      pending: !scar.system.resolved,
      outcome: outcomeText(scar.system)
    });
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: game.i18n.localize("CAIRN.Scar.Title"),
      content
    });
  }

  /** The way in, from anywhere: `game.cairn2e.scars.open(actor, { hpLost })` — or without
   *  `hpLost` when no hit is being answered, which is what the Scars tab's Add passes. */
  static async open(actor, { hpLost = null } = {}) {
    if (!actor) return null;
    if (!(await tableRows())) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Scar.NoTable"));
      return null;
    }
    const app = new CairnScars({ document: actor, hpLost });
    return app.render(true);
  }
}

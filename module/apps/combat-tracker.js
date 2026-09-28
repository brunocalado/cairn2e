/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { COMBAT_FLAGS, CONDITION, FIGHT_FLAGS, MORALE_FLAGS, SYSTEM_ID } from "../constants.js";
import { drawDungeonEvent, postJourneyCard, rollMorale, rollSave } from "../rolls.js";
import { consumeRation } from "../journey.js";

/** "move a distance equal to their torchlight's perimeter (about 40ft)" (`procedures.md`). */
const TORCHLIGHT_FT = 40;

/** The actions `procedures.md` → Actions names, offered as suggestions for a declaration. */
const DUNGEON_ACTIONS = ["search", "listen", "force", "disarm", "rest", "cast", "hurry"];

/** When the party risks a Dungeon Event (`procedures.md` → Dungeon Events), in the SRD's order. */
const DUNGEON_TRIGGERS = ["linger", "hurry", "enter", "loud"];

/**
 * How far a token has moved this turn, from core's movement history, which the combat clears at
 * every turn start. Measured through the token's own path measurement rather than by adding the
 * waypoints' `cost`: a move made by a document update carries a cost of 0 (observed on 14.368),
 * while the measured distance is the one the ruler shows.
 * @param {TokenDocument|null} token
 * @returns {{moved: number, units: string}}
 */
function movedThisTurn(token) {
  const units = token?.parent?.grid?.units ?? "";
  const history = token?.movementHistory ?? [];
  if (history.length < 2) return { moved: 0, units };
  return { moved: Math.round(token.measureMovementPath(history).distance), units };
}

/**
 * The combat tracker, grouped by side.
 *
 * 2e's round is side-based (`core-rules.md` → Combat) and has no initiative, so the tracker shows
 * two headed blocks — the adventurers, then their opponents — instead of one list sorted by a
 * number. Each row carries a control its owner ticks once that combatant has acted, and the
 * heading of the side still owed actions is the one drawn in full ink.
 *
 * All three parts are the system's: the header drops core's initiative rolls, the tracker
 * regroups the rows by side, and the footer keeps only the round controls.
 */
export class CairnCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID],
    actions: {
      createDungeon: CairnCombatTracker.#onCreateDungeon,
      rollDungeonEvent: CairnCombatTracker.#onRollDungeonEvent,
      startFight: CairnCombatTracker.#onStartFight,
      exhaustionFatigue: CairnCombatTracker.#onExhaustionFatigue,
      exhaustionRation: CairnCombatTracker.#onExhaustionRation,
      toggleResolved: CairnCombatTracker.#onToggleResolved,
      rollDexSave: CairnCombatTracker.#onRollDexSave,
      rollMorale: CairnCombatTracker.#onRollMorale
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: `systems/${SYSTEM_ID}/templates/apps/combat-tracker-header.hbs`
    },
    tracker: {
      template: `systems/${SYSTEM_ID}/templates/apps/combat-tracker.hbs`,
      scrollable: [""]
    },
    footer: {
      template: `systems/${SYSTEM_ID}/templates/apps/combat-tracker-footer.hbs`
    }
  };

  /**
   * @inheritDoc
   *
   * Core has already built one entry per combatant in `context.turns`, with the thumbnail, the
   * effect icons and the permission flags the row needs. Regroup those entries into the two sides
   * rather than rebuilding them, then sort each side by name — with no initiative, the name is
   * the only ordering 2e offers, and it is at least the one the players can predict.
   */
  /**
   * What a dungeon exploration's player has typed into their row and not yet committed, by
   * combatant id. Core restores the focused input after a re-render but draws it with the value
   * the flag held, so a keystroke that races another row's update would otherwise be thrown away.
   * @type {Map<string, string>}
   */
  #drafts = new Map();

  /**
   * @inheritDoc
   *
   * The header and footer say "turn" instead of "round" for a dungeon exploration.
   */
  async _prepareCombatContext(context, options) {
    await super._prepareCombatContext(context, options);
    context.isDungeon = !!this.viewed?.isDungeon;
  }

  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    if (!combat) return;
    if (combat.isDungeon) {
      context.dungeon = this.#dungeonContext(combat, context.turns ?? []);
      return;
    }

    const sides = { adventurers: [], opponents: [] };
    for (const turn of context.turns ?? []) {
      const combatant = combat.combatants.get(turn.id);
      if (!combatant) continue;
      turn.resolved = combatant.resolved;
      turn.dexSave = combatant.dexSave;
      turn.isAdventurer = combatant.isAdventurer;
      // Core marks the combatant at `combat.turn` active; there is no active combatant here.
      turn.css = turn.css.replace("active", "").trim();
      sides[combatant.isAdventurer ? "adventurers" : "opponents"].push(turn);
    }
    for (const rows of Object.values(sides)) rows.sort((a, b) => a.name.localeCompare(b.name));

    context.sides = sides;
    context.activeSide = combat.activeSide;
    // The DEX save belongs to the first round of the COMBAT, not to a combatant's first round:
    // somebody who joins in round three never owed one (`core-rules.md`).
    context.isFirstRound = combat.round === 1;
    // The Warden's prompt, and only the Warden's: Morale is a thing the enemy owes and the
    // players are not supposed to be told the arithmetic behind it.
    context.moraleDue = game.user.isGM ? combat.moraleDue : null;
  }

  /**
   * The rows and the Warden's reminders of a dungeon exploration (`procedures.md` → Dungeon
   * Exploration). Built on core's per-combatant entries, like the fight's sides.
   * @param {CairnCombat} combat
   * @param {object[]} turns  core's entries, one per visible combatant
   */
  #dungeonContext(combat, turns) {
    const rows = [];
    for (const turn of turns) {
      const combatant = combat.combatants.get(turn.id);
      if (!combatant) continue;
      const { moved, units } = movedThisTurn(combatant.token);
      rows.push({
        ...turn,
        css: turn.css.replace("active", "").trim(),
        resolved: combatant.resolved,
        declared: this.#drafts.get(turn.id) ?? combatant.getFlag(SYSTEM_ID, COMBAT_FLAGS.DECLARED) ?? "",
        moved,
        units,
        // "move a distance equal to their torchlight's perimeter (about 40ft)" — past it, the
        // party is moving quickly, which is one of the four Dungeon Event triggers. Only a scene
        // measured in feet can be compared with a distance the SRD gives in feet.
        beyondTorch: (units === "ft") && (moved > TORCHLIGHT_FT)
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const hurried = rows.some((r) => r.beyondTorch);
    const event = combat.system.event;
    return {
      rows,
      event: event ? { ...event, exhaustion: event.kind === "exhaustion" } : null,
      suggestions: DUNGEON_ACTIONS.map((key) => game.i18n.localize(`CAIRN.Dungeon.Action.${key}`)),
      warden: game.user.isGM,
      triggers: DUNGEON_TRIGGERS.map((key) => ({
        label: game.i18n.localize(`CAIRN.Dungeon.Trigger.${key}`),
        lit: (key === "hurry") && hurried
      }))
    };
  }

  /**
   * @inheritDoc
   *
   * FIXME: works around a core defect at 14.368 — remove when core guards it itself.
   * `CombatTracker#_onRender` sets `let data = {}`, reassigns it from
   * `renderData.find(d => d._id === this.viewed?.id)` — which is `undefined` whenever the combat
   * that updated is not the one on screen, and deleting an encounter while another is active is
   * enough — and then evaluates `("turn" in data)`, which throws on `undefined`. It surfaced as
   * a TypeError out of this class's own stack, twice, in a live client.
   *
   * Handing core a `renderData` it will not treat as an array makes it keep its own `{}`
   * fallback and skip the block, which is both the minimal fix and a no-op here: the block
   * scrolls `.combatant.active` into view, and a side-based tracker marks no combatant active.
   */
  async _onRender(context, options) {
    const { renderData } = options;
    if (Array.isArray(renderData) && !renderData.some((d) => d._id === this.viewed?.id)) {
      options = { ...options, renderData: undefined };
    }
    await super._onRender(context, options);
    this.#bindDeclarations();
  }

  /**
   * A dungeon row's declaration. It is written when the player commits it (`change`: Enter, or
   * leaving the field) — one flag write per declaration rather than one per keystroke, each of
   * which would re-render every client's tracker. The owner may write their combatant's flags,
   * the permission the acted mark already relies on.
   */
  #bindDeclarations() {
    for (const input of this.element.querySelectorAll("input.cairn-declared")) {
      const { combatantId } = input.closest("[data-combatant-id]")?.dataset ?? {};
      if (!combatantId) continue;
      if (this.#drafts.has(combatantId) && (document.activeElement === input)) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
      input.addEventListener("input", () => this.#drafts.set(combatantId, input.value));
      input.addEventListener("change", async () => {
        this.#drafts.delete(combatantId);
        const combatant = this.viewed?.combatants.get(combatantId);
        if (combatant?.isOwner) await combatant.setFlag(SYSTEM_ID, COMBAT_FLAGS.DECLARED, input.value.trim());
      });
    }
  }

  /**
   * Draw a Dungeon Event and keep it on the exploration until the turn changes. The Warden
   * decides when — the SRD's four triggers are only reminders — so this is only ever a click.
   */
  static async #onRollDungeonEvent() {
    const combat = this.viewed;
    if (!combat?.isDungeon) return;
    const event = await drawDungeonEvent();
    if (event) await combat.update({ "system.event": event });
  }

  /**
   * Exhaustion: "The party must rest (triggering another roll on this table), add a **Fatigue**,
   * or consume a ration." The party chooses; these are the two that write to a sheet — resting is
   * the sheet's own Rest. Either one spends the event: its marker is emptied and its words stay on
   * screen, so the buttons go and a second click cannot charge the party twice.
   */
  static async #onExhaustionFatigue() {
    await CairnCombatTracker.#spendExhaustion(this.viewed, async (actor) => (await actor.addFatigue()).length > 0,
      "CAIRN.Dungeon.FatigueLead", "CAIRN.Dungeon.FatigueAdded", "CAIRN.Dungeon.FatigueNoRoom");
  }

  static async #onExhaustionRation() {
    await CairnCombatTracker.#spendExhaustion(this.viewed, consumeRation,
      "CAIRN.Dungeon.RationLead", "CAIRN.Dungeon.RationEaten", "CAIRN.Dungeon.RationNone");
  }

  /**
   * Charge every adventurer once and post one card that says who paid and who could not — a body
   * with no free slot refuses a Fatigue (`documents/item.js`), a pack with no Rations has none to
   * eat, and what happens then is the table's call.
   * @param {CairnCombat} combat
   * @param {(actor: Actor) => Promise<boolean>} charge  resolves whether the actor paid
   */
  static async #spendExhaustion(combat, charge, leadKey, paidKey, unpaidKey) {
    if (!combat?.isDungeon || (combat.system.event?.kind !== "exhaustion")) return;
    await combat.update({ "system.event.kind": "" });
    const actors = new Set(combat.combatants.filter((c) => c.isAdventurer && c.actor).map((c) => c.actor));
    const paid = [];
    const unpaid = [];
    for (const actor of actors) ((await charge(actor)) ? paid : unpaid).push(actor.name);
    const names = (list) => game.i18n.getListFormatter().format(list);
    const lines = [];
    if (paid.length) lines.push(game.i18n.localize(paidKey, { names: names(paid) }));
    if (unpaid.length) lines.push(game.i18n.localize(unpaidKey, { names: names(unpaid) }));
    await postJourneyCard({ flavor: combat.system.event.name, lead: game.i18n.localize(leadKey), lines });
  }

  /**
   * A fight breaks out. It is an ordinary side-based combat — sides, the first-round DEX save,
   * Morale — already holding the exploration's combatants, made the active one so its tokens
   * record their movement against it. The Warden adds the monsters. The exploration is left as it
   * is, and comes back when the fight is deleted (`CairnCombat#_onDelete`), which is why this is
   * a second combat and not the exploration converted in place: a fight starts at round one, and
   * the exploration would lose its turn count, its declarations and its pending event.
   */
  static async #onStartFight() {
    const dungeon = this.viewed;
    if (!dungeon?.isDungeon) return;
    const fight = await Combat.implementation.create({
      scene: dungeon.scene?.id ?? null,
      flags: { [SYSTEM_ID]: { [FIGHT_FLAGS.ORIGIN]: dungeon.id } },
      combatants: dungeon.combatants.map((c) => ({
        tokenId: c.tokenId, sceneId: c.sceneId, actorId: c.actorId, hidden: c.hidden
      }))
    });
    await fight.activate({ render: false });
  }

  /**
   * Begin a dungeon exploration: a `dungeon` Combat on the viewed scene, made the active one —
   * the two calls core's own "+" makes (`CombatTracker#_onCombatCreate`). Active matters: a token
   * records its movement only as a combatant of `game.combat`.
   */
  static async #onCreateDungeon() {
    const combat = await Combat.implementation.create({ type: "dungeon", scene: canvas.scene?.id ?? null });
    await combat.activate({ render: false });
  }

  /**
   * Tick or untick a combatant's action for this round. The write lands on the Combatant, whose
   * owner may update its flags without the GM (`Combatant` permissions, v14) — which is what lets
   * a player mark their own row with no socket involved.
   */
  static async #onToggleResolved(event, target) {
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = this.viewed?.combatants.get(combatantId);
    if (!combatant) return;
    await combatant.setFlag(SYSTEM_ID, COMBAT_FLAGS.RESOLVED, !combatant.resolved);
  }

  /**
   * The first-round DEX save: "each PC must make a DEX save in order to act" (`core-rules.md`).
   *
   * Offered to everything on the adventurers' side, hirelings included, and never forced. The
   * rule's letter says "each PC", but circumstances that negate the requirement are the Warden's
   * to judge, so the control is a prompt the table can ignore rather than a gate.
   *
   * `rollSave` posts the card itself, and the result is written to the combatant the roller
   * already owns — which is why the player rolls their own die with no GM in the loop.
   *
   * A failure also ticks the action mark: "PCs that fail their save lose their turn" — the
   * round has nothing left for them to do, and the side's heading should stop waiting on them.
   * Both flags land in one update so the row never shows a failure without the tick.
   */
  static async #onRollDexSave(event, target) {
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = this.viewed?.combatants.get(combatantId);
    if (!combatant?.actor) return;
    const passed = await rollSave(combatant.actor, "DEX");
    const flags = { [COMBAT_FLAGS.DEX_SAVE]: passed ? "passed" : "failed" };
    if (!passed) flags[COMBAT_FLAGS.RESOLVED] = true;
    await combatant.update({ [`flags.${SYSTEM_ID}`]: flags });
  }

  /**
   * Roll Morale for one opponent, because the Warden asked for it on that row.
   *
   * The trigger is detected, never acted on: the bestiary has monsters that save on their
   * leader's WIL and monsters that pass automatically while a commander is present, and both are
   * prose in a stat block. The Warden decides who saves and whether an exception applies; this
   * only rolls what `rollMorale` already implements and marks the trigger spent either way,
   * because the save happened.
   */
  static async #onRollMorale(event, target) {
    const combat = this.viewed;
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = combat?.combatants.get(combatantId);
    if (!combatant?.actor) return;

    const due = combat.moraleDue;
    const passed = await rollMorale(combatant.actor);
    if (!passed) await combatant.actor.toggleStatusEffect(CONDITION.FLEEING, { active: true });
    if (due) await combat.setFlag(SYSTEM_ID, due === "half" ? MORALE_FLAGS.HALF : MORALE_FLAGS.FIRST_CASUALTY, true);
  }
}

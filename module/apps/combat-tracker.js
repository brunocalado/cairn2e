/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { COMBAT_FLAGS, CONDITION, MORALE_FLAGS, SYSTEM_ID } from "../constants.js";
import { rollMorale, rollSave } from "../rolls.js";

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
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    if (!combat) return;

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

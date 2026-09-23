/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { COMBAT_FLAGS, MORALE_FLAGS, SYSTEM_ID } from "../constants.js";
import { moraleDue } from "../combat/morale.js";

/**
 * Cairn 2e combat.
 *
 * **2e has no initiative roll and no per-combatant turn.** The round is side-based
 * (`core-rules.md` → Combat): every able PC acts, then their opponents, and *the result of each
 * side's actions occur simultaneously*. The sides do not alternate — it is PCs, then opponents,
 * every round, until one side is defeated or flees.
 *
 * So the ordering Foundry wants is not modelled here at all. `initiative` is never written, never
 * read, and never shown; the tracker (`module/apps/combat-tracker.js`) groups the combatants into
 * two blocks at render time and each row carries a control its owner ticks when it has acted.
 *
 * Core's `setupTurns`, `current` and `previous` are deliberately left alone. The tracker renders
 * from its own grouped context rather than from `this.turns`, so the order of that list is
 * irrelevant, and leaving core's bookkeeping untouched keeps `_onUpdate` and the turn-event
 * machinery working exactly as shipped.
 */
export class CairnCombat extends Combat {
  /** @override — 2e rolls nothing for turn order. There is no turn order to roll for. */
  async rollInitiative(_ids) {
    return this;
  }

  /**
   * @override — there is no combatant "whose turn it is": a side acts at once.
   *
   * Core reads this for two things, and both are meant to go quiet. The canvas turn marker gates
   * on `game.combat?.combatant?.tokenId`, and the `yourTurn` / `nextUp` sound cues gate on this
   * and on {@link nextCombatant}. The sounds stay off (their theme, the client setting
   * `core.combatTheme`, is `"none"` unless a user picks one). The marker is drawn instead by
   * `module/canvas/token.js`, which lights every token of the side that is acting.
   */
  get combatant() {
    return null;
  }

  /** @override — nobody is "next up" when a whole side acts together. */
  get nextCombatant() {
    return null;
  }

  /**
   * The side that still owes an action: the adventurers until every one of them is spent or down,
   * and the opponents after that. 2e fixes this order, so nothing needs to be stored — it is read
   * off the combatants themselves.
   * @returns {"adventurers"|"opponents"}
   */
  get activeSide() {
    const pending = this.combatants.some((c) => c.isAdventurer && !c.resolved && !c.isDefeated);
    return pending ? "adventurers" : "opponents";
  }

  /**
   * @override — record how many opponents the fight opens with.
   *
   * 2e's Morale triggers are counted against that number and not against a live roster, so
   * reinforcements arriving mid-fight never re-arm a trigger that has already fired
   * (`module/combat/morale.js`).
   */
  async startCombat() {
    const opponents = this.combatants.filter((c) => !c.isAdventurer).length;
    await this.setFlag(SYSTEM_ID, MORALE_FLAGS.BASELINE, opponents);
    return super.startCombat();
  }

  /**
   * Which Morale save the opponents owe right now, if any.
   *
   * The tracker raises this as a prompt for the Warden and never rolls it: two monsters in the
   * bestiary carry exceptions written in prose (a leader's WIL, a commander's presence) that no
   * field on this system holds.
   * @returns {"firstCasualty"|"half"|null}
   */
  get moraleDue() {
    const baseline = this.getFlag(SYSTEM_ID, MORALE_FLAGS.BASELINE) ?? 0;
    // "Lone foes must save when they're reduced to 0 HP" (core-rules.md → Morale): a single
    // opponent is down at 0 HP even while it still stands on STR. A group's casualties are the
    // ones the Warden marked defeated — a monster at 0 HP that passed its critical save still fights.
    const isDown = baseline === 1
      ? (c) => c.isDefeated || c.actor?.system.hp?.value === 0
      : (c) => c.isDefeated;
    return moraleDue({
      baseline,
      down: this.combatants.filter((c) => !c.isAdventurer && isDown(c)).length,
      firstCasualtyDone: this.getFlag(SYSTEM_ID, MORALE_FLAGS.FIRST_CASUALTY) === true,
      halfDone: this.getFlag(SYSTEM_ID, MORALE_FLAGS.HALF) === true
    });
  }

  /**
   * Is this token's combatant one of those the acting side still owes an action for?
   *
   * `module/canvas/token.js` asks this to decide whether to draw the turn ring. It is the whole
   * of the difference from core, which asks instead whether the token IS the one combatant at
   * `combat.combatant` — a question 2e has no answer to.
   * @param {string} tokenId
   * @returns {boolean}
   */
  isTokenActing(tokenId) {
    if (!this.started) return false;
    const combatant = this.combatants.find((c) => c.tokenId === tokenId);
    if (!combatant || combatant.resolved || combatant.isDefeated) return false;
    return (combatant.isAdventurer ? "adventurers" : "opponents") === this.activeSide;
  }

  /**
   * @inheritDoc
   *
   * Core refreshes the turn markers only when the *turn index* changed, and here nothing ever
   * changes it: what moves the ring is a combatant being marked as having acted, which is a flag
   * write on an embedded document and no turn change at all. Without this the rings are drawn
   * once when the combat starts and then stay where they are for the rest of the fight.
   */
  _onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId) {
    super._onUpdateDescendantDocuments(parent, collection, documents, changes, options, userId);
    if (collection !== "combatants") return;
    const movesTheRing = changes.some((c) => (SYSTEM_ID in (c.flags ?? {})) || ("defeated" in c));
    if (movesTheRing) this._updateTurnMarkers();
  }

  /**
   * @override — core refreshes the one token at `combatant`, which is `null` here, so nothing
   * would ever be redrawn. Refresh every token in the combat instead, plus any that still holds a
   * marker from a state that has since changed.
   */
  _updateTurnMarkers() {
    if (!canvas.ready) return;

    // Everything that currently wears a ring is refreshed unconditionally, exactly as core does:
    // this is what CLEARS one, and it has to keep working for a combat that is being deleted or
    // is no longer the viewed one — where `isView` is already false and a ring would otherwise be
    // left painted on the canvas for the rest of the session.
    const tokens = new Set(canvas.tokens.turnMarkers);

    // Only a viewed combat may light new ones.
    if (this.isView) {
      for (const combatant of this.combatants) {
        const token = combatant.token?.object;
        if (token) tokens.add(token);
      }
    }
    for (const token of tokens) token.renderFlags.set({ refreshTurnMarker: true });
  }

  /** @override — a new round gives every combatant its action back. */
  async nextRound() {
    await this.clearResolved();
    return super.nextRound();
  }

  /**
   * Hand every combatant its action back, and clear the first-round DEX save with it, in one
   * write.
   *
   * The flags are set rather than deleted: one `updateEmbeddedDocuments` call means one database
   * round trip and one tracker re-render, where an unset per combatant would mean N of each. The
   * DEX save goes too — it belongs to the first round, and a mark that outlived it would be
   * reporting a turn that was lost several rounds ago.
   */
  async clearResolved() {
    if (!this.combatants.size) return;
    await this.updateEmbeddedDocuments(
      "Combatant",
      this.combatants.map((c) => ({
        _id: c.id,
        [`flags.${SYSTEM_ID}.${COMBAT_FLAGS.RESOLVED}`]: false,
        [`flags.${SYSTEM_ID}.${COMBAT_FLAGS.DEX_SAVE}`]: null
      }))
    );
  }
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { COMBAT_FLAGS, SYSTEM_ID } from "../constants.js";

/**
 * Cairn 2e combatant.
 *
 * Everything here answers one question the tracker asks of every row: which side is this on, and
 * has it acted yet? 2e's round is side-based (`core-rules.md` → Combat) — every able PC acts,
 * then their opponents, and the results resolve simultaneously — so a combatant has no turn of
 * its own to be at, only a side and a state.
 */
export class CairnCombatant extends Combatant {
  /**
   * Which side this combatant fights on.
   *
   * The token's disposition is what decides it. A hireling is an NPC the party controls, and a
   * friendly token puts it with the PCs, which is where 2e wants it; a charmed monster changes
   * sides by changing disposition, which is the Warden's existing control for exactly this.
   * Neutral and secret count as opponents — 2e's round has two sides and no third.
   */
  get isAdventurer() {
    return this.token?.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  }

  /** Has this combatant taken its action this round? Cleared for everyone by `nextRound`. */
  get resolved() {
    return this.getFlag(SYSTEM_ID, COMBAT_FLAGS.RESOLVED) === true;
  }

  /**
   * The first-round DEX save result, or `null` while it has not been rolled.
   *
   * A failure does not stop this combatant acting — the mark is all there is. 2e says the PC
   * "loses their turn", and what that costs is the Warden's to rule, the same way Panic is a
   * condition the sheet shows rather than a lock the system applies.
   * @returns {"passed"|"failed"|null}
   */
  get dexSave() {
    return this.getFlag(SYSTEM_ID, COMBAT_FLAGS.DEX_SAVE) ?? null;
  }
}

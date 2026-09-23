/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { CONDITION } from "./constants.js";

/**
 * The ten conditions this system puts on a token, replacing core's forty-odd generic statuses.
 *
 * Eight come from `core-rules.md`. **Doomed** is row 12 of the Scars table — only ever a player
 * character's, and it ends at that character's next Critical Damage save. **Fleeing** is the
 * Morale rule's marker: enemies save WIL on their first casualty and at half strength, and a
 * failure means they run. Morale does not affect PCs, so Fleeing is an NPC's and only an NPC's.
 *
 * What is NOT here, and why, because the question comes back: a condition earns a slot when the
 * SRD defines it as a state with rules, not when a table can produce the word. The d20 "Critical
 * Damage" column in `creating-monsters.md` rolls up Blinds, Paralyzes, Petrifies and seventeen
 * more — those are prompts for the Warden to improvise, not defined states. Paralyzed and
 * Delirious are here because `core-rules.md` defines them (DEX 0, WIL 0); Blind, Invisible and
 * Petrified are not, and core's `invisible` and `blind` were dropped from this roster for that
 * reason. Nothing broke when they went: the canvas reads
 * `CONFIG.specialStatusEffects.INVISIBLE` / `.BLIND` by id STRING, not by membership here, so
 * they simply stopped being offered as buttons — exactly the position `burrow`, `hover` and
 * `fly` have always been in. A Warden hides a token with the HUD's own eye button, which sets
 * the token's `hidden` flag.
 *
 * Five entries are derived from numbers the system already tracks, but only TWO of them are
 * withheld from a character token's HUD. `CairnActor#syncDerivedConditions` now reconciles a
 * condition when the number behind it changes rather than on every write, so Dead, Paralyzed and
 * Delirious can be set by hand and will stay — which the SRD needs, because `bestiary.md`'s Mind
 * Blast paralyses a target whose DEX never moves and a PC left untreated after Critical Damage
 * dies with STR above 0. Fatigued and Encumbered keep the gate for a different reason: their
 * truth lives in an Item and in the slot count, so a hand-set marker would contradict the open
 * sheet. See the comment on each.
 *
 * Every entry is a marker: a name and an image, no ActiveEffect `changes`. Nothing here enforces
 * a rule. Panic still reaches the dice only through the existing branch in `module/rolls.js`.
 *
 * The images are Foundry's colour art rather than the flat `icons/svg/` silhouettes, chosen for
 * what each one means rather than for forming a matched set. Worth knowing before changing one:
 * the same image is also drawn by the canvas on the token itself, at 20px over a 40%-opaque
 * black plate (`Token#_refreshEffects`), where a full-bleed painting reads as a coloured tile.
 */
export const CONDITIONS = [
  {
    id: CONDITION.DEPRIVED,
    name: "CAIRN.Condition.Deprived",
    img: "icons/magic/death/hand-withered-gray.webp",
    order: 1
  },
  {
    id: CONDITION.PANICKED,
    name: "CAIRN.Condition.Panicked",
    img: "icons/magic/control/fear-fright-mask-orange.webp",
    order: 2
  },
  {
    id: CONDITION.CRITICAL_DAMAGE,
    name: "CAIRN.Condition.CriticalDamage",
    img: "icons/skills/wounds/blood-spurt-spray-red.webp",
    order: 3
  },
  {
    // Derived, and kept off a character token's HUD: a Fatigue is an ITEM that occupies a slot
    // (`core-rules.md`), so a marker set by hand would sit on the token with nothing behind it on
    // the open sheet. Adding the item is the honest action, and the sheet already offers it.
    id: CONDITION.FATIGUED,
    name: "CAIRN.Condition.Fatigued",
    img: "icons/magic/control/sleep-bubble-purple.webp",
    order: 4,
    hud: { actorTypes: ["npc"] }
  },
  {
    // Derived, and the one that MUST stay off a character token's HUD: `system.encumbered` is
    // computed from the slot count, and `hp.effective` falls to 0 from that value, never from
    // this status. A marker set by hand would promise the Warden 0 effective HP and change
    // nothing the damage roll reads.
    id: CONDITION.ENCUMBERED,
    name: "CAIRN.Condition.Encumbered",
    img: "icons/containers/bags/pack-leather-strapped-tan.webp",
    order: 5,
    hud: { actorTypes: ["npc"] }
  },
  {
    // Core's own id, kept literal — CONFIG.specialStatusEffects.DEFEATED reads it, which is how
    // a token marked dead shows as defeated in the combat tracker.
    id: CONDITION.DEAD,
    name: "CAIRN.Condition.Dead",
    img: "icons/magic/death/bones-crossed-orange.webp",
    order: 6
  },
  {
    id: CONDITION.PARALYZED,
    name: "CAIRN.Condition.Paralyzed",
    img: "icons/magic/control/debuff-chains-shackles-movement-blue.webp",
    order: 7
  },
  {
    id: CONDITION.DELIRIOUS,
    name: "CAIRN.Condition.Delirious",
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
    order: 8
  },
  {
    id: CONDITION.DOOMED,
    name: "CAIRN.Condition.Doomed",
    img: "icons/magic/time/hourglass-brown-orange.webp",
    order: 9,
    // A PC's and only a PC's: it is set by taking row 12 of the Scars table, and monsters take no
    // Scars, so a Doomed toggle on a monster's token would offer a rule that cannot apply. NOT
    // derived — nothing recomputes it, so nothing would ever turn it off again.
    hud: { actorTypes: ["character"] }
  },
  {
    id: CONDITION.FLEEING,
    name: "CAIRN.Condition.Fleeing",
    img: "icons/skills/movement/figure-running-gray.webp",
    order: 10,
    // The mirror of Doomed. "Morale does not affect PCs" (`core-rules.md`), so this is offered on
    // an NPC token only. Not derived either: nothing computes "failed a Morale save", so the
    // Warden's click is the only thing that ever clears it. The NPC sheet's Morale button sets it
    // on a failure.
    hud: { actorTypes: ["npc"] }
  }
];

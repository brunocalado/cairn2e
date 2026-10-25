/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { SYSTEM_ID, FLAGS } from "../constants.js";

const DAMAGE_CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/damage-result-card.hbs`;

/**
 * The pure damage arithmetic (core-rules.md → Combat / Critical Damage), pulled out of
 * {@link Damage.applyToTarget} so it is checkable without a scene, a token, or a database write
 * (`checks/rules-damage.check.mjs`) — the single most likely thing in the system to be broken
 * by a refactor.
 *
 * `effHp` is how much HP is actually available to soak this hit (0 while encumbered or panicked);
 * whatever is not consumed from it survives on the *stored* HP, so un-encumbering later does not
 * retroactively un-spend HP that was never there to lose.
 *
 * @param {{ damage: number, armor: number, rawHp: number, effHp: number, str: number }} p
 * @returns {{ dmg: number, newHp: number, newStr: number, consumed: number, strChanged: boolean }}
 */
export function computeDamage({ damage, armor, rawHp, effHp, str }) {
  const dmg = Math.max(damage - armor, 0);
  let newEffHp;
  let newStr = str;
  if (dmg <= effHp) {
    newEffHp = effHp - dmg;
  } else {
    // Critical Damage: the remainder overflows onto STR.
    newEffHp = 0;
    newStr = Math.max(str - (dmg - effHp), 0);
  }
  const consumed = effHp - newEffHp;
  return { dmg, newHp: Math.max(rawHp - consumed, 0), newStr, consumed, strChanged: newStr !== str };
}

/**
 * Damage taken from an attribute instead of HP (`procedures.md` → Traps: "Damage from traps is
 * taken from Attributes (usually STR or DEX) and _not_ from HP. Armor can reduce damage, but only
 * if applicable"). Whether armour applies is the caller's to say, so `armor` is 0 when it does not.
 * No overflow and no Critical Damage save: that save belongs to damage that went PAST HP.
 * @param {{ damage: number, armor: number, value: number }} p
 * @returns {{ dmg: number, newValue: number }}
 */
export function computeAttributeDamage({ damage, armor, value }) {
  const dmg = Math.max(damage - armor, 0);
  return { dmg, newValue: Math.max(value - dmg, 0) };
}

/** The label each attribute's line on the result card carries. */
const ATTRIBUTE_LABELS = { STR: "CAIRN.Hit.StrLabel", DEX: "CAIRN.Hit.DexLabel", WIL: "CAIRN.Hit.WilLabel" };

/**
 * Applies a rolled damage total to targeted tokens: armor, then HP, then STR overflow, then the
 * Critical Damage prompt. Pure arithmetic and chat-card posting — the STR save the card offers is
 * rolled in `module/rolls.js`, the system's one place for that.
 *
 * Scars are not decided here. Every hit lands through `actor.update` with `hitOptions()` below,
 * and `CairnActor#_preUpdate` is the one place that sees the HP before and after in the same
 * breath. The option is what makes a write a hit: the SRD's Scar is owed to an ATTACK that takes
 * a PC to exactly 0, and a number corrected on the sheet is not one.
 */
/**
 * The update options that make a write a hit. A fresh object every time: core keeps the options
 * object as the operation itself — the updates, the timestamps — and `_preUpdate` writes the Scar
 * it decides onto it, so one shared object carried the last hit's Scar into the next.
 */
export const hitOptions = () => ({ [SYSTEM_ID]: { hit: true } });

export class Damage {
  /**
   * @param {string[]} targetIds  Token ids, from the chat message's `targets` flag.
   * @param {number} damage  The rolled damage total, before armor.
   * @param {object} [options]
   * @param {"STR"|"DEX"|"WIL"|null} [options.attribute]  Take it from this attribute, not HP.
   * @param {boolean} [options.armor=true]  Whether armour reduces an attribute hit.
   */
  static async applyToTargets(targetIds, damage, { attribute = null, armor = true } = {}) {
    // A hit is whole points: the fields are integers, and a fraction would be rounded on the
    // write but kept in the hit flag, so Reverse would give back a different number.
    damage = Math.trunc(damage);
    let landed = 0;
    for (const id of targetIds) {
      const data = attribute
        ? await this.applyToAttribute(id, damage, attribute, armor)
        : await this.applyToTarget(id, damage);
      if (!data) continue;
      landed++;
      await this.#postDamageMessage(data);
    }
    // Every target on another scene, or gone: say so, or the click did nothing visible.
    if (!landed) ui.notifications.warn("CAIRN.Notify.ApplyNoTargets", { localize: true });
  }

  /**
   * One hit on one actor, card and all — the same hit a damage card's Apply lands, for damage
   * that has no card behind it: the Take Damage prompt (`macros.js#takeDamage`), from a sheet's
   * Actions menu or a hotbar macro. No token is needed; when there is one it speaks the card.
   * @param {Actor} actor
   * @param {number} damage  Before armor.
   * @param {object} [options]
   * @param {"STR"|"DEX"|"WIL"|null} [options.attribute]  Take it from this attribute, not HP.
   * @param {boolean} [options.armor=true]  Whether armour reduces an attribute hit.
   * @param {TokenDocument|null} [options.token]
   * @returns {Promise<object|null>}  null for an actor with no body to hit
   */
  static async applyToActor(actor, damage, { attribute = null, armor = true, token = null } = {}) {
    damage = Math.trunc(damage);
    const data = attribute
      ? await this.#hitAttribute(actor, token, damage, attribute, armor)
      : await this.#hitHp(actor, token, damage);
    if (data) await this.#postDamageMessage(data);
    return data;
  }

  /**
   * @param {string} tokenId
   * @param {number} damage
   * @returns {Promise<object|null>} the before/after values `#postDamageMessage` renders
   */
  static async applyToTarget(tokenId, damage) {
    const token = canvas.scene?.tokens?.get(tokenId);
    if (!token?.actor) return null;
    return this.#hitHp(token.actor, token, damage);
  }

  /** `applyToTarget`'s body, once there is an actor. */
  static async #hitHp(actor, token, damage) {
    // Not everything on a map has a body. A party token stands for a group, not a creature: it
    // has no HP and no attributes, so there is nothing for armor to reduce and nothing to
    // overflow into. Asked by what it HAS rather than by its subtype, so a subtype added later
    // is judged by its schema instead of by a list somebody has to remember to extend.
    if (!actor.system.abilities) return null;

    const armor = actor.system.armorTotal ?? 0;
    const rawHp = actor.system.hp.value;
    const effHp = actor.system.hp.effective ?? rawHp;
    const str = actor.system.abilities.STR.value;

    const { dmg, newHp, newStr } = computeDamage({ damage, armor, rawHp, effHp, str });

    // STR goes in even when the hit stayed inside HP, and that cannot put a stale STR back over a
    // correction somebody made meanwhile: core's client diff drops every key equal to this
    // client's own source, and an STR the hit did not touch is the one it was read from.
    await actor.update({ "system.hp.value": newHp, "system.abilities.STR.value": newStr }, hitOptions());

    return { actor, token, dmg, damage, armor, hp: rawHp, str, newHp, newStr };
  }

  /**
   * An attribute hit: the damage comes off `attribute`, never HP. Zero DEX or WIL raises Paralyzed
   * or Delirious by itself (`CairnActor`'s derived conditions), and zero STR is the dead card.
   * @param {string} tokenId
   * @param {number} damage
   * @param {"STR"|"DEX"|"WIL"} attribute
   * @param {boolean} useArmor
   * @returns {Promise<object|null>}
   */
  static async applyToAttribute(tokenId, damage, attribute, useArmor) {
    const token = canvas.scene?.tokens?.get(tokenId);
    if (!token?.actor) return null;
    return this.#hitAttribute(token.actor, token, damage, attribute, useArmor);
  }

  /** `applyToAttribute`'s body, once there is an actor. */
  static async #hitAttribute(actor, token, damage, attribute, useArmor) {
    if (!actor.system.abilities?.[attribute]) return null;

    const armor = useArmor ? (actor.system.armorTotal ?? 0) : 0;
    const value = actor.system.abilities[attribute].value;
    const { dmg, newValue } = computeAttributeDamage({ damage, armor, value });
    await actor.update({ [`system.abilities.${attribute}.value`]: newValue }, hitOptions());
    return { actor, token, dmg, damage, armor, useArmor, attribute, value, newValue };
  }

  /**
   * The "Apply damage" button on a damage-roll chat card.
   * @param {PointerEvent} event
   * @param {ChatMessage} message
   */
  static onClickChatMessageApplyButton(event, message) {
    const targetIds = message.getFlag(SYSTEM_ID, "targets") ?? [];
    if (!targetIds.length) return;

    // Shift-click re-targets the same tokens on the canvas instead of applying damage.
    if (event.shiftKey) {
      targetIds.forEach((id, index) => {
        const token = canvas.scene?.tokens?.get(id)?.object;
        if (!token) return;
        const releaseOthers = index === 0 && !token.isTargeted;
        token.setTarget(!token.isTargeted, { releaseOthers });
      });
      return;
    }

    // A trap's card names the attribute it strikes, and its second button is the one that says
    // armour does not help.
    const attribute = message.getFlag(SYSTEM_ID, "attribute") ?? null;
    const armor = !event.currentTarget?.classList.contains("apply-dmg-no-armor");
    const dmg = message.rolls[0]?.total;
    if (Number.isFinite(dmg)) return this.applyToTargets(targetIds, dmg, { attribute, armor });
  }

  /**
   * Post the damage breakdown.
   * @param {object} data  From `applyToTarget`.
   */
  static async #postDamageMessage(data) {
    if (data.attribute) return this.#postAttributeMessage(data);
    const { actor, token, dmg, damage, armor, hp, str, newHp, newStr } = data;

    // What this hit took, so `module/chat.js#reverseHit` can give it back. Deltas rather than the
    // before-values the card prints: adding them back composes with a heal or a second hit that
    // landed in between, where restoring absolutes would silently erase both. Written on BOTH
    // branches below — the dead branch wrote to the actor too, so its card is reversible in
    // exactly the same way.
    const hitFlag = { [`flags.${SYSTEM_ID}.${FLAGS.HIT}`]: { actorUuid: actor.uuid, hp: hp - newHp, str: str - newStr } };

    // STR at 0 is dead outright, PC or not (core-rules.md → Attribute Loss) — no save to prompt.
    if (newStr === 0) {
      const content = await foundry.applications.handlebars.renderTemplate(DAMAGE_CARD_TPL, { dead: true });
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(token ? { token } : { actor }),
        flavor: game.i18n.localize("CAIRN.Damage"),
        content,
        ...hitFlag
      });
      return;
    }

    const strChanged = newStr !== str;

    // The card leads with a sentence, and the amount inside it is set at display size. The span is
    // built here rather than in the template so the sentence stays ONE localization key: splitting
    // it into "Struck for" + number + "damage" to get the markup in would leave three fragments
    // that no translator can reassemble. The class carries no design value of its own — the size
    // lives in the stylesheet.
    const lead = game.i18n.localize("CAIRN.Hit.Struck", {
      dmg: `<span class="cairn-damage-amount">${dmg}</span>`
    });

    const content = await foundry.applications.handlebars.renderTemplate(DAMAGE_CARD_TPL, {
      dmg,
      lead,
      // What the roll said and what the armor took, as the card's footnote.
      source: game.i18n.localize(armor ? "CAIRN.Hit.Source" : "CAIRN.Hit.SourceNoArmor", { damage, armor }),
      hp,
      newHp,
      hpChanged: newHp !== hp,
      str,
      newStr,
      strChanged,
      showCriticalSave: strChanged
    });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(token ? { token } : { actor }),
      flavor: game.i18n.localize("CAIRN.Damage"),
      content,
      ...hitFlag
    });
  }

  /**
   * Post an attribute hit. The same card as an HP hit — the sentence, the arithmetic, the one
   * number that moved — without the Critical Damage prompt, which only damage past HP owes. Its
   * flag carries the attribute's own delta (`str`, `dex` or `wil`), which is what
   * `module/chat.js#reverseHit` gives back.
   * @param {object} data  From `applyToAttribute`.
   */
  static async #postAttributeMessage(data) {
    const { actor, token, dmg, damage, armor, useArmor, attribute, value, newValue } = data;
    const hitFlag = {
      [`flags.${SYSTEM_ID}.${FLAGS.HIT}`]: { actorUuid: actor.uuid, hp: 0, [attribute.toLowerCase()]: value - newValue }
    };
    const speaker = ChatMessage.getSpeaker(token ? { token } : { actor });
    const flavor = game.i18n.localize("CAIRN.Damage");

    if ((attribute === "STR") && (newValue === 0)) {
      const content = await foundry.applications.handlebars.renderTemplate(DAMAGE_CARD_TPL, { dead: true });
      await ChatMessage.create({ speaker, flavor, content, ...hitFlag });
      return;
    }

    let source;
    if (!useArmor) source = game.i18n.localize("CAIRN.Hit.SourceArmorIgnored", { damage });
    else source = game.i18n.localize(armor ? "CAIRN.Hit.Source" : "CAIRN.Hit.SourceNoArmor", { damage, armor });

    const content = await foundry.applications.handlebars.renderTemplate(DAMAGE_CARD_TPL, {
      dmg,
      lead: game.i18n.localize("CAIRN.Hit.Struck", { dmg: `<span class="cairn-damage-amount">${dmg}</span>` }),
      source,
      attributeChanged: newValue !== value,
      attributeLabel: game.i18n.localize(ATTRIBUTE_LABELS[attribute]),
      attributeFrom: value,
      attributeTo: newValue
    });
    await ChatMessage.create({ speaker, flavor, content, ...hitFlag });
  }
}

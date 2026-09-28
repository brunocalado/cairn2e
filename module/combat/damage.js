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
 * Scars are not decided here. Every hit lands through `actor.update`, and `CairnActor#_preUpdate`
 * is the one place that sees the HP before and after in the same breath — so a character walked to
 * 0 on their own sheet reaches the Scars window by the same road as one taken down by this card.
 */
export class Damage {
  /**
   * @param {string[]} targetIds  Token ids, from the chat message's `targets` flag.
   * @param {number} damage  The rolled damage total, before armor.
   * @param {object} [options]
   * @param {"STR"|"DEX"|"WIL"|null} [options.attribute]  Take it from this attribute, not HP.
   * @param {boolean} [options.armor=true]  Whether armour reduces an attribute hit.
   */
  static async applyToTargets(targetIds, damage, { attribute = null, armor = true } = {}) {
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
   * @param {string} tokenId
   * @param {number} damage
   * @returns {Promise<object|null>} the before/after values `#postDamageMessage` renders
   */
  static async applyToTarget(tokenId, damage) {
    const token = canvas.scene?.tokens?.get(tokenId);
    if (!token?.actor) return null;
    const actor = token.actor;

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

    await actor.update({ "system.hp.value": newHp, "system.abilities.STR.value": newStr });

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
    const actor = token?.actor;
    if (!actor?.system.abilities?.[attribute]) return null;

    const armor = useArmor ? (actor.system.armorTotal ?? 0) : 0;
    const value = actor.system.abilities[attribute].value;
    const { dmg, newValue } = computeAttributeDamage({ damage, armor, value });
    await actor.update({ [`system.abilities.${attribute}.value`]: newValue });
    return { actor, token, dmg, damage, armor, useArmor, attribute, value, newValue };
  }

  /**
   * The "Apply damage" button on a damage-roll chat card.
   * @param {PointerEvent} event
   * @param {HTMLElement} html  The chat message's rendered root.
   * @param {ChatMessage} message
   */
  static onClickChatMessageApplyButton(event, html, message) {
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

    // The roll line this system draws (`templates/chat/roll.hbs`), not core's `.dice-total` — that
    // class carries core's grey-bar styling, so the roll line does not wear it.
    // A trap's card names the attribute it strikes, and its second button is the one that says
    // armour does not help.
    const attribute = message.getFlag(SYSTEM_ID, "attribute") ?? null;
    const armor = !event.currentTarget?.classList.contains("apply-dmg-no-armor");
    const dmg = parseInt(html.querySelector(".cairn-card-total")?.textContent, 10);
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
        speaker: ChatMessage.getSpeaker({ token }),
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
      speaker: ChatMessage.getSpeaker({ token }),
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
    const speaker = ChatMessage.getSpeaker({ token });
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

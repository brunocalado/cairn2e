/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, EDIT_LIMITS } from "../constants.js";
import { abilityRows, clampDigits, clampStat, digitsOnly } from "../helpers.js";
import { CairnEditSheet } from "./_edit-sheet.js";
import { NPC_DETAIL_KEYS, appearanceTraitRows, rollNpcDetail } from "../npc-generator.js";

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps`;

/**
 * The form behind an NPC sheet's quill — `CairnCharacterEdit`'s sibling, not a copy: the same
 * window, the same footer, the same rule that each field is editable in exactly one place.
 *
 * Three tabs. *General* holds the Role and the Career and Day Rate the Marketplace gives someone
 * the party pays (`players-guide/marketplace.md` § Hirelings). *Identity* holds the five
 * people-tables (`wardens-guide/npc-tables.md`) and the six Character Traits (`core-rules.md`
 * § Hirelings) — with a die beside every one and a *Randomize* control that rolls them all; the
 * tab is hidden for a creature. Every field is shown for every person, whatever the Role: this
 * window is where they are filled, and a hidden field is an unreachable one. The sheet's face is
 * the copy that leaves a blank out. *Attributes* holds the maxima
 * — STR / DEX / WIL / HP, as the character's does — plus the three numbers an NPC has that a
 * character does not: intrinsic Armor (a monster's hide is not a worn item,
 * `module/data/actor-npc.js`), the Morale target, and the slot count. Name is typed on the sheet.
 *
 * The dice write the FORM, never the document: Save writes and Cancel forgets a roll the way it
 * forgets a keystroke, which is the promise the rest of the window already makes.
 *
 * Not one class with per-type parts: a class branching on `document.type` in `PARTS`, `TABS` and
 * `_prepareContext` is two classes in a trench coat, and this is not one. The two forms are two
 * classes on one base, `CairnEditSheet`, which holds only what has no type in it — the window's
 * options, its title, its first-render tab, its render guard and its Cancel. The parts, tabs,
 * context and listeners here are the NPC's own. The window is the character's size, so the two
 * forms are the same window on screen; the taller tab here (Attributes: seven rows) fits it.
 */
export class CairnNpcEdit extends CairnEditSheet {
  static DEFAULT_OPTIONS = {
    actions: {
      rollDetail: CairnNpcEdit.#onRollDetail,
      randomizeAll: CairnNpcEdit.#onRandomizeAll
    }
  };

  static PARTS = {
    nav: { template: `${TEMPLATES}/edit-nav.hbs` },
    general: { template: `${TEMPLATES}/npc-edit/general.hbs`, scrollable: [""] },
    identity: { template: `${TEMPLATES}/npc-edit/identity.hbs`, scrollable: [""] },
    attributes: { template: `${TEMPLATES}/npc-edit/attributes.hbs`, scrollable: [""] },
    footer: { template: `${TEMPLATES}/edit-footer.hbs` }
  };

  static TABS = {
    primary: {
      initial: "general",
      tabs: [
        { id: "general", label: "CAIRN.Edit.General" },
        { id: "identity", label: "CAIRN.Identity" },
        { id: "attributes", label: "CAIRN.Edit.Attributes" }
      ]
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.document;
    const system = actor.system;

    context.actor = actor;
    context.system = system;
    context.abilities = abilityRows(system);
    context.limits = EDIT_LIMITS;
    // Read off the field's own `choices` (an array on `NpcData`) so the buttons and what a save
    // will accept cannot drift apart. These buttons are also how a Warden reclassifies an actor —
    // the NPC the party ends up hiring becomes a hireling here.
    context.roleOptions = system.schema.getField("role").choices.map((r) => ({
      value: r,
      label: `CAIRN.Role.${r.charAt(0).toUpperCase()}${r.slice(1)}`,
      selected: system.role === r
    }));
    context.appearanceTraits = appearanceTraitRows(system);
    return context;
  }

  /**
   * @override — the Role buttons show and hide the Identity tab without a render.
   *
   * Only the tab: every field on this window is shown for every person, because this is where
   * they are filled and a hidden field is an unreachable one. The Identity tab IS a tab, and it
   * takes the character window's Omen treatment exactly: its nav entry is hidden while the role
   * is a creature's, its panel stays in the form, and switching to a creature while standing on
   * it moves the reader back to General, where the buttons are.
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    // The character window's numbers: text fields so `maxlength` applies, kept to digits here so
    // a letter, a minus sign or a decimal point never reaches `data-dtype` as NaN.
    // Every `.max` on the window is two digits: the three attributes, HP and the slots.
    for (const box of htmlElement.querySelectorAll('input[name$=".max"]')) {
      digitsOnly(box, EDIT_LIMITS.statDigits);
    }
    digitsOnly(htmlElement.querySelector('input[name="system.dayRate"]'), EDIT_LIMITS.rateDigits);

    // The Role buttons are radios; the checked one is the value the select used to hold. The nav
    // entry they hide is in the nav part, which renders first.
    const roles = [...htmlElement.querySelectorAll('input[name="system.role"]')];
    const entry = this.element.querySelector('.tabs [data-tab="identity"]');
    if (!roles.length) return;
    const apply = () => {
      const creature = roles.find((r) => r.checked)?.value === "monster";
      entry.hidden = creature;
      if (creature && this.tabGroups.primary === "identity") this.changeTab("general", "primary");
    };
    apply();
    for (const r of roles) r.addEventListener("change", apply);
  }

  /**
   * @override — the same ranges the fields accept, applied where the form is read, as the
   * character window does (`character-edit.js#_processFormData`): the maxima and the slots 0 to
   * 99, the day rate 0 to 9999, whole. A value no keystroke made — the console, an autofill — is a
   * number to make sense of, not a typo to refuse.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const system = data.system;
    if (!system) return data;
    for (const ability of Object.values(system.abilities ?? {})) {
      if ("max" in ability) ability.max = clampStat(ability.max);
    }
    if (system.hp && "max" in system.hp) system.hp.max = clampStat(system.hp.max);
    if (system.slots && "max" in system.slots) system.slots.max = clampStat(system.slots.max);
    if ("dayRate" in system) system.dayRate = clampDigits(system.dayRate, EDIT_LIMITS.rateDigits);
    return data;
  }

  /** Fill the inputs a roll names. The form, not the document: Save writes, Cancel forgets. */
  #fill(values) {
    for (const [name, value] of Object.entries(values)) {
      const input = this.element.querySelector(`[name="${name}"]`);
      if (input) input.value = value;
    }
  }

  static async #onRollDetail(event, target) {
    this.#fill(await rollNpcDetail(target.dataset.key));
  }

  /** Every die on the window — all twelve, whatever the role, because every row is shown. */
  static async #onRandomizeAll() {
    for (const key of NPC_DETAIL_KEYS) this.#fill(await rollNpcDetail(key));
  }
}

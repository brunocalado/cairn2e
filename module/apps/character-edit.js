/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, EDIT_LIMITS } from "../constants.js";
import { traitRows, toPlainText, toPlainLines } from "../character-generator.js";
import { abilityRows } from "../helpers.js";
import { CairnEditSheet } from "./_edit-sheet.js";

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps`;

/** The caps this form holds on the submit path; the templates read the same object as `limits`. */
const AGE_DIGITS = EDIT_LIMITS.ageDigits;
const STAT_DIGITS = EDIT_LIMITS.statDigits;
const TEXT_MAX = EDIT_LIMITS.text;
const QUESTION_MAX = EDIT_LIMITS.question;

/** The highest maximum this form accepts, which is what its digits can say. */
const STAT_MAX = 10 ** STAT_DIGITS - 1;

/** A maximum as this form stores it: whole, and between 0 and `STAT_MAX`. */
function clampStat(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), STAT_MAX) : 0;
}

/**
 * Hold a text field to digits, at most `digits` of them, as they are typed and as they are pasted.
 *
 * The field keeps what it already has when nothing needs cutting, so the caret does not jump on
 * every keystroke — assigning `value` at all would move it to the end of the line.
 */
function digitsOnly(input, digits) {
  input?.addEventListener("input", () => {
    const clean = input.value.replace(/\D+/g, "").slice(0, digits);
    if (input.value !== clean) input.value = clean;
  });
}

/**
 * Every editable number and string on a character, in one window.
 *
 * The character sheet used to grow fields in place: the quill in its header swapped each printed
 * maximum for an `<input>`, which is taller than the text it replaced, so the five stat blocks
 * changed height and everything under them moved. Opening a mode that shifts the page is the
 * worst possible answer to "let me fix a number" — the thing you were aiming at is no longer
 * where you left it.
 *
 * So the sheet no longer has a mode at all. It is always the printed page, and this is the form.
 * The two are deliberately unlike each other: the sheet is ink on paper and nothing on it looks
 * like a control, while this is a plain stack of labelled fields that looks like exactly what it
 * is. It still carries the system scope class, so it is set in Lora on the same paper — a form in
 * the same book, not a form from somewhere else.
 *
 * What it holds is decided by one rule: **each field is editable in exactly one place.** Name,
 * Background and Gold are typed, dropped and typed on the sheet, so they are not here; the
 * current STR/DEX/WIL/HP values are edited on the sheet too, so only the maxima are. Armor is not
 * here in any form — 2e sums it from equipped armour and caps it at 3
 * (`module/data/actor-character.js#prepareDerivedData`), so there is no stored number to type
 * into, and a read-only row in an edit form is furniture.
 */
export class CairnCharacterEdit extends CairnEditSheet {
  // One part per tab, plus the nav and the footer. The six tabs are six panels of ONE form:
  // an inactive tab is `display: none`, not absent, so Save reads every field on every tab.
  // The window is sized so no panel scrolls; `scrollable` is declared all the same, because a
  // `.tab` part is the scroll container by construction and the day one overflows is the day
  // its scroll position has to survive a re-render.
  static PARTS = {
    nav: { template: `${TEMPLATES}/edit-nav.hbs` },
    general: { template: `${TEMPLATES}/character-edit/general.hbs`, scrollable: [""] },
    traits: { template: `${TEMPLATES}/character-edit/traits.hbs`, scrollable: [""] },
    background: { template: `${TEMPLATES}/character-edit/background.hbs`, scrollable: [""] },
    bond: { template: `${TEMPLATES}/character-edit/bond.hbs`, scrollable: [""] },
    omen: { template: `${TEMPLATES}/character-edit/omen.hbs`, scrollable: [""] },
    description: { template: `${TEMPLATES}/character-edit/description.hbs`, scrollable: [""] },
    footer: { template: `${TEMPLATES}/edit-footer.hbs` }
  };

  static TABS = {
    primary: {
      initial: "general",
      tabs: [
        { id: "general", label: "CAIRN.Edit.General" },
        { id: "traits", label: "CAIRN.Edit.Traits" },
        { id: "background", label: "CAIRN.Background" },
        { id: "bond", label: "CAIRN.Bond" },
        { id: "omen", label: "CAIRN.Omen" },
        // Last, because it is the only one that is not a thing the rules rolled: it holds what 2e
        // gives a character that this model has no field for.
        { id: "description", label: "CAIRN.Description" }
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
    context.limits = EDIT_LIMITS;
    context.abilities = abilityRows(system);
    context.traits = traitRows(system.traits);
    return context;
  }

  /* -------------------------------------------- */

  /**
   * @override — the Omen switch shows and hides the Omen TAB without a render.
   *
   * A re-render here would be the wrong tool twice over: it would throw away everything else the
   * form has typed but not yet saved, and it would rebuild the switch underneath the pointer that
   * just moved it. The tab's nav entry is hidden, never removed, and its panel stays in the form
   * either way, so Omen text written earlier survives a save made with the switch off and comes
   * back when it is turned on again. Turning it off while standing on the Omen tab moves the
   * reader back to General, where the switch is.
   */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);

    // Age and the four maxima are text fields so `maxlength` applies, which leaves the digits to
    // enforce here: this is what stops a letter, a minus sign or a decimal point from reaching
    // `data-dtype`, where it would arrive as NaN and fail the DataModel's own check with a
    // validation error. Telling someone they mistyped by refusing their save is the wrong way
    // round; the field simply does not take the character. Paste goes through `input` too, and is
    // cut by the same slice.
    digitsOnly(htmlElement.querySelector("input.cairn-edit-digits"), AGE_DIGITS);
    for (const box of htmlElement.querySelectorAll(".cairn-edit-stat input")) {
      digitsOnly(box, STAT_DIGITS);
    }

    // The switch is in its own part and the nav entry in the nav, which renders first.
    const toggle = htmlElement.querySelector('input[name="system.omen.enabled"]');
    const entry = this.element.querySelector('.tabs [data-tab="omen"]');
    if (!entry || !toggle) return;
    entry.hidden = !toggle.checked;
    toggle.addEventListener("change", () => {
      entry.hidden = !toggle.checked;
      if (!toggle.checked && this.tabGroups.primary === "omen") this.changeTab("general", "primary");
    });
  }

  /**
   * @override — the same three caps the fields wear, applied where the form is read.
   *
   * `maxlength` and the `input` handler above are the affordance: they stop the typing at the
   * point it happens, which is the only place a limit can be explained without an error message.
   * They are not the enforcement. A form can be submitted with values no keystroke produced — a
   * field set from the console, an autofill, a browser restoring a session — and this runs before
   * core validates (`api/document-sheet.mjs:487`), so what it returns is what the actor gets.
   *
   * Age is floored to a whole non-negative number rather than rejected: the field cannot produce
   * anything else, so a value that reaches here having been made some other way is not a typo to
   * report, it is a number to make sense of.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const system = data.system;
    if (!system) return data;

    if ("age" in system) {
      const age = Math.floor(Number(system.age));
      system.age = Number.isFinite(age) ? Math.min(Math.max(age, 0), 10 ** AGE_DIGITS - 1) : 0;
    }
    // The same range the boxes accept, applied where the form is read: 0 to 99, whole. The typed
    // field cannot produce anything else, so a value that arrives having been made some other way
    // is not a typo to report — it is a number to make sense of.
    for (const ability of Object.values(system.abilities ?? {})) {
      if ("max" in ability) ability.max = clampStat(ability.max);
    }
    if (system.hp && "max" in system.hp) system.hp.max = clampStat(system.hp.max);
    if (typeof system.bond === "string") system.bond = toPlainText(system.bond).slice(0, TEXT_MAX);
    // The description is the one field here that is a block, so it keeps its line breaks and is
    // flattened by the variant that does (`character-generator.js#toPlainLines`).
    if (typeof system.description === "string") {
      system.description = toPlainLines(system.description).slice(0, TEXT_MAX);
    }
    if (typeof system.omen?.text === "string") {
      system.omen.text = toPlainText(system.omen.text).slice(0, TEXT_MAX);
    }
    // Both halves of a table result are plain text, like the Bond and the Omen above — so a value
    // pasted out of a compendium result, which is authored HTML, is stored as the sentence it
    // reads as.
    for (const slot of ["first", "second"]) {
      const { question, answer } = system.backgroundTables?.[slot] ?? {};
      if (typeof question === "string") {
        system.backgroundTables[slot].question = toPlainText(question).slice(0, QUESTION_MAX);
      }
      if (typeof answer === "string") {
        system.backgroundTables[slot].answer = toPlainText(answer).slice(0, TEXT_MAX);
      }
    }
    return data;
  }

}

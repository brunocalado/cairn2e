/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
import { SYSTEM_ID } from "./constants.js";
import { gainUpdate, revertUpdate, attrPath, attrResource } from "./gains.js";
import { paintInk, scheduleInk } from "./ink.js";

const GAIN_DIALOG_TPL = `systems/${SYSTEM_ID}/templates/apps/growth-gain-dialog.hbs`;

/**
 * Record what a Growth did to a maximum: write it on the actor, and write on the growth what it
 * did, so deleting the growth can put it back.
 *
 * `mode: "set"` because a growth is an ASSIGNMENT — the Warden says what the number now is. Both
 * of the SRD's numeric examples read that way: Ox rerolls Willpower and keeps the higher result,
 * Rui's training "increas[es] her HP" (`srd-2e/wardens-guide/growth.md`). There is no die here
 * and no table row; the arithmetic is shared with Scars only because moving a maximum is one
 * rule, not two.
 *
 * The maximum is written DIRECTLY rather than through an ActiveEffect, for the reason a scar's
 * is: the change is permanent, nothing expires or suppresses it, and an effect that added would
 * make a later assignment compare against an already-modified number.
 *
 * @param {Actor} actor
 * @param {Item} growth
 * @param {"hp"|"STR"|"DEX"|"WIL"} attr
 * @param {number} total  the maximum it becomes
 */
export async function applyGrowthGain(actor, growth, attr, total) {
  const res = attrResource(actor, attr);
  const path = attrPath(attr);
  const { from, to, value } = gainUpdate({ mode: "set", total, max: res.max, value: res.value });
  await actor.update({ [`${path}.max`]: to, [`${path}.value`]: value });
  await growth.update({
    "system.outcome.attr": attr,
    "system.outcome.from": from,
    "system.outcome.to": to,
    "system.resolved": true
  });
  return { from, to };
}

/**
 * Record a gain that is words and not a number — the common kind: "reads her Spellbook under
 * duress without a save", "no longer needs Rations". Nothing on the actor moves; the growth
 * holds the text and is resolved, so the row stops offering the control. Deleting it puts
 * nothing back, because nothing was taken (`revertGrowthGain` returns on a blank `attr`).
 * @param {Item} growth
 * @param {string} text
 */
export async function recordGrowthGain(growth, text) {
  await growth.update({ "system.gained": text, "system.resolved": true });
}

/**
 * Ask what a Growth changed — a maximum and what it moved to, or, for the common growth that
 * moves no number, the gain in words — and record it.
 *
 * A form and not a roll — a growth has no die, and the Warden has already decided in the
 * fiction. The choices are read off the field's own `choices` rather than written out here, so
 * the options offered and what a save will accept cannot drift apart. Drawn from a template
 * into `DialogV2.prompt`, the way `rolls.js#promptDamageOptions` is.
 *
 * The growth row's apply control on the character sheet opens it; it lives here, beside the two
 * writes it ends in.
 * @param {Actor} actor
 * @param {Item} item  an unresolved growth
 */
export async function promptGrowthGain(actor, item) {
  // The field's own choices, the blank moved last and named — the gear rows' rule for a
  // clearing option — and chosen on open, because most growths move no number.
  const keys = item.system.schema.getField("outcome.attr").choices;
  const choices = [...keys.filter((k) => k !== ""), ""].map((k) => ({
    value: k,
    label: k === "" ? game.i18n.localize("CAIRN.None")
      : k === "hp" ? game.i18n.localize("CAIRN.Scar.MaxHp") : game.i18n.localize(k),
    selected: k === ""
  }));
  const content = await foundry.applications.handlebars.renderTemplate(GAIN_DIALOG_TPL, {
    choices, gained: item.system.gained
  });
  const result = await foundry.applications.api.DialogV2.prompt({
    classes: [SYSTEM_ID],
    window: { title: game.i18n.localize("CAIRN.Growth.ApplyTitle") },
    content,
    // One question, two shapes: a number when a maximum is named, words when none is.
    render: (_event, dialog) => {
      const radios = [...dialog.element.querySelectorAll('input[name="attr"]')];
      const number = dialog.element.querySelector(".cairn-gain-number");
      const text = dialog.element.querySelector(".cairn-gain-text");
      // The text box wears a drawn frame, and a dialog has no ink pass of its own. Repainted
      // on every switch too: a hidden box measures 0×0 and is skipped, but the frame it had
      // stays on the canvas until something paints over it — a ghost box across the button.
      const host = dialog.element.querySelector(".window-content");
      const apply = () => {
        const attr = radios.find((r) => r.checked)?.value ?? "";
        number.hidden = !attr;
        text.hidden = !!attr;
        (attr ? number.querySelector("input") : text.querySelector("textarea")).focus();
        paintInk(host);
      };
      apply();
      for (const r of radios) r.addEventListener("change", apply);
      scheduleInk(host);
    },
    ok: {
      label: game.i18n.localize("CAIRN.Growth.Apply"),
      callback: (ev, button) => new foundry.applications.ux.FormDataExtended(button.form).object
    },
    rejectClose: false
  });
  // `FormDataExtended` reads the hidden block's field too; the chosen button says which of the
  // two was meant, so a number typed and then abandoned for NONE is ignored, and vice versa.
  if (!result) return;
  if (result.attr) {
    // A blank number is a closed dialog, not a zero: assigning 0 is a real answer, so it is
    // the empty field and not the value that means "never mind".
    if (result.to === null || result.to === undefined) return;
    return applyGrowthGain(actor, item, result.attr, result.to);
  }
  const text = (result.text ?? "").trim();
  if (!text) return;
  return recordGrowthGain(item, text);
}
/**
 * Put back what a growth did, when it is deleted.
 *
 * A growth that never recorded a gain wrote nothing and puts nothing back — which is most of
 * them, since most of what the Growth chapter describes has no number in it at all.
 * @param {Item} growth
 */
export async function revertGrowthGain(growth) {
  const actor = growth.parent;
  const { attr, from, to } = growth.system.outcome;
  if (!actor || !growth.system.resolved || !attr || from === to) return null;
  const res = attrResource(actor, attr);
  const path = attrPath(attr);
  const next = revertUpdate({ from, to, max: res.max, value: res.value });
  await actor.update({ [`${path}.max`]: next.max, [`${path}.value`]: next.value });
  return next;
}

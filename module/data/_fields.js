/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Shared schema-field builders. Every 2e data shape is assembled from these so the
 * definitions stay in one place — a rule that changes shape (e.g. the slot count) is
 * edited here, not in eight model files.
 */

const fields = foundry.data.fields;

/**
 * A `{ value, max }` integer pair — HP, and each attribute.
 * @param {number} value  starting current value
 * @param {number} max    starting maximum
 * @returns {foundry.data.fields.SchemaField}
 */
export function resourceField(value = 0, max = 0) {
  return new fields.SchemaField({
    value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: value }),
    max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: max, min: 0 })
  });
}

/**
 * The three Cairn attributes, each a `{ value, max }` pair. 2e rolls 3d6 per attribute;
 * roll-under saves compare against `value`, and `max` is the ceiling recovery restores to.
 * @returns {foundry.data.fields.SchemaField}
 */
export function abilitiesField() {
  return new fields.SchemaField({
    STR: resourceField(10, 10),
    DEX: resourceField(10, 10),
    WIL: resourceField(10, 10)
  });
}

/**
 * A `{ value, max }` use counter for consumables (Rations 3 uses, Bandages 3 uses, …).
 * @returns {foundry.data.fields.SchemaField}
 */
export function usesField() {
  return new fields.SchemaField({
    value: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
  });
}

/**
 * The id of the `container` Item this one sits inside, or "" when it is carried on the body.
 *
 * A contained item is a sibling in the same actor's collection — no Item can embed an Item
 * (`Item.metadata.embedded` is effects only) — so the parent link lives on the child, where a
 * single update moves an item in or out.
 * @returns {foundry.data.fields.StringField}
 */
export function containerField() {
  return new fields.StringField({ required: true, blank: true, initial: "" });
}

/**
 * The fields every carried Item shares.
 *
 * What a thing costs is ONE number. "Most items take up one slot unless otherwise indicated.
 * *Petty* items do not take up any slots. *Bulky* items take up **two** slots"
 * (`srd-2e/players-guide/character-creation.md`) — and the indicated case is real and printed:
 * the Warden's Guide sells a Candelabra at four (`srd-2e/wardens-guide/dungeon-seeds.md`). Two
 * booleans could say 0 and 2 and nothing else, and they could say both at once, which is why they
 * needed a validation clause to police each other. A number can do neither.
 *
 * *petty* and *bulky* are 2e's words for two of its values and they survive everywhere the system
 * speaks — tags, rules, pack prose — as DERIVED labels off this field (`item-gear.js`).
 * @returns {Record<string, foundry.data.fields.DataField>}
 */
export function itemBaseFields() {
  return {
    description: new fields.HTMLField({ required: true, blank: true }),
    slots: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
    equipped: new fields.BooleanField({ initial: false }),
    cost: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
    container: containerField()
  };
}

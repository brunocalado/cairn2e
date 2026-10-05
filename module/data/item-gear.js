/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { GUISE_IMG, SYSTEM_ID } from "../constants.js";
import { grantsField, itemBaseFields, usesField } from "./_fields.js";
import { slotsForItem } from "./_derived.js";

const fields = foundry.data.fields;

/**
 * The one carried thing. A sword, a mule, a relic ring and a spellbook are all `gear`, told
 * apart by their fields along three independent axes:
 *
 * - **Physical** — `damage` (+ `blast`, + `paired`) makes it a weapon, `armor` makes it armour,
 *   and `slots` / `equipped` say what it costs to carry and whether it is in hand
 *   (`srd-2e/players-guide/marketplace.md`). *petty* and *bulky* are readings of `slots`, not
 *   fields: see `prepareBaseData`. `bodily` says it is part of the one who has it — claws, a
 *   bite, a metal arm on its shoulder — and so is never carried at all.
 * - **Magical** — `magic` says what using it costs: a Spellbook adds a Fatigue, a Scroll is used
 *   up, a Relic spends a charge and has a `recharge` condition (`core-rules.md` → Magic). Three
 *   answers to one question, so one enum rather than three subtypes — and the Reliquary proves the
 *   axis is independent of the physical one: A Blade Called Hope is a d6 sword AND a relic.
 * - **Storage** — `capacity` makes it a container. `takesSlots` says whether hauling it costs the
 *   character anything: a bag on the back and a cart pulled with both hands do (and then `slots`
 *   applies as to anything), while a mule or a wagon hauls itself and costs none.
 *
 * Two questions about a container point opposite ways, so they are named apart: `slots` is what
 * carrying THIS costs its owner, and `capacity` / `contentsSlots` are what it HOLDS and what is in
 * it. A Cart is `slots: 2`, `capacity: 4`. An actor's own `slotsUsed` / `slotsMax` are the ten and
 * belong to the actor — no item has either.
 *
 * Crossing all three is `carried` — is this under direct possession right now? It is the one
 * field that belongs to the situation rather than to the thing, it is toggled at the table, and
 * it answers for every kind of gear: a sword left on the dungeon floor is set aside exactly as a
 * cart left at camp is.
 *
 * Contents are siblings in the parent Actor's collection, each naming this one in
 * `system.container` (`_fields.js#containerField`): no Item can embed an Item.
 */
export class GearData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Item"];

  static defineSchema() {
    return {
      ...itemBaseFields(),
      uses: usesField(),
      grants: grantsField(),
      // Food the wilderness procedure spends: Make Camp eats one use, Supply deals new ones
      // (`procedures.md` → Make Camp, → Supply). A mark, not a name — a renamed or homebrew food
      // is still food.
      ration: new fields.BooleanField({ initial: false }),
      // Physical axis. A blank die is "not a weapon"; a zero is "not armour". *Impaired* forces
      // d4 and *Enhanced* d12 regardless of the die — that substitution lives in the roll code.
      damage: new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: { d4: "d4", d6: "d6", d8: "d8", d10: "d10", d12: "d12" }
      }),
      blast: new fields.BooleanField({ initial: false }),
      // The die rolled twice, the higher kept: the SRD's `d8+d8` (`core-rules.md` → Attack
      // Modifiers, "roll both damage dice and keep the single highest"). One weapon that is two —
      // a troll's claws, Twin Daggers — where the rule's own case is two weapons at once.
      paired: new fields.BooleanField({ initial: false }),
      // Part of the body, not a thing carried: it costs no slot, is always to hand, and can be
      // neither set aside, stowed, handed over nor sold. It is still a `gear`, so a claw is a die
      // like a sword's and a hide can be armour — the axes are the same; only where it lives differs.
      bodily: new fields.BooleanField({ initial: false }),
      // At most 3 on one item, the 2e cap (a Plate is 3); the actor's total is summed over equipped
      // items and capped at 3 again by `_derived.js#sumEquippedArmor`.
      armor: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 3 }),
      // Magical axis — what using it costs: a Fatigue, the item itself, or a charge that
      // recharges (core-rules.md → Magic).
      magic: new fields.StringField({
        required: true,
        blank: false,
        initial: "none",
        choices: { none: "none", spellbook: "spellbook", scroll: "scroll", relic: "relic" }
      }),
      recharge: new fields.HTMLField({ required: true, blank: true }),
      // A thing whose holder does not know what it is: "If a character has no justifiable
      // knowledge of a subject, then they simply do not know anything about it"
      // (`knowledge-and-perception.md` → Knowledge). Any gear — a scroll whose spell is unread, a
      // vial, a bag that is a relic, a tattoo that appeared overnight. The guise is what they call
      // it and what they can see. The real name, picture, description and Recharge are never
      // overwritten, so revealing it is clearing one boolean.
      unknown: new fields.BooleanField({ initial: false }),
      guiseName: new fields.StringField({ required: true, blank: true, initial: "" }),
      // Declared in `system.json`'s `filePathFields` too: the server sanitises a file path only
      // when the manifest names it (`FilePathField`'s own doc comment).
      guiseImg: new fields.FilePathField({ required: true, nullable: false, categories: ["IMAGE"], initial: GUISE_IMG }),
      guiseDescription: new fields.HTMLField({ required: true, blank: true }),
      // Storage axis. Zero holds nothing; a Mule is 6, a bag of holding whatever the Warden says.
      capacity: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),
      // Only read when capacity > 0 (see the class comment): a thing that holds nothing has no
      // hauling to cost anything. Set on the item's own sheet, not at the table.
      takesSlots: new fields.BooleanField({ initial: false }),
      // Under direct possession — true of every kind of gear, not only containers.
      carried: new fields.BooleanField({ initial: true })
    };
  }

  prepareBaseData() {
    if (this.uses.value > this.uses.max) this.uses.value = this.uses.max;
    // "Scrolls … are petty" (core-rules.md → Scrolls): by rule, not by choice.
    if (this.magic === "scroll") this.slots = 0;
    // A container is not a weapon and not armour. Both only ever apply while a thing is EQUIPPED
    // (`_derived.js#sumEquippedArmor`, and the equipped guard on every Roll Damage control), and a
    // container is never equipable (`documents/item.js#isEquipable`) — so a die or an armour value
    // on one is a number nothing in the system can ever read. Cleared here rather than refused on
    // save, so the sheet owes one rule ("a bag has no die") instead of two.
    if (this.capacity > 0) {
      this.damage = "";
      this.blast = false;
      this.paired = false;
      this.armor = 0;
      // A bag is not a limb: it holds things, and a thing that is part of you holds nothing.
      this.bodily = false;
    }
    if (!this.damage) this.paired = false;
    // Part of you is always to hand and always with you — there is no second state to be in.
    if (this.bodily) {
      this.equipped = true;
      this.carried = true;
    }
    // How the die is written wherever it is printed: the SRD's own `d8+d8` for a paired one.
    this.damageLabel = this.paired ? `${this.damage}+${this.damage}` : this.damage;
    // A container that hauls itself is never under direct possession. You can lead a mule by the
    // rein, but if you run, whether it comes is the Warden's to say — so it is always set aside,
    // and the toggle is not offered on it (`documents/item.js#isStashable`).
    if (this.capacity > 0 && !this.takesSlots) this.carried = false;
    // A stowed thing has no possession state of its own: the container answers for it. Held true
    // so that the container's `contentsSlots` below weighs what it holds, and so that taking the
    // container back never has to reconcile ten separate answers to one question.
    if (this.container) this.carried = true;

    // 2e's two words for two of the values `slots` can take — "*Petty* items do not take up any
    // slots. *Bulky* items take up two slots" (`character-creation.md`). Read off the number
    // rather than stored beside it, so nothing has to keep two answers in step and nothing can
    // claim both. Every tag, filter and pack still speaks in these words; only the storage moved.
    // Derived here in prepareBaseData, not prepareDerivedData, because the Scroll rule above can
    // change the number and these must describe what it ended up as.
    this.petty = this.slots === 0;
    this.bulky = this.slots === 2;
  }

  prepareDerivedData() {
    this.isContainer = this.capacity > 0;
    if (!this.isContainer) return;
    // Contents are siblings, so they can only be found through the parent Actor. A container with
    // no parent Actor — one in a compendium or the world Items directory — has no sibling
    // collection and is therefore always empty.
    const siblings = this.parent.parent?.items ?? [];
    this.contents = siblings.filter((i) => i.system.container === this.parent.id);
    // `slotsForItem` per item rather than `sumUsedSlots`: that one measures what is carried on the
    // BODY and skips everything with a container pointer, which is every item in this list.
    this.contentsSlots = this.contents.reduce((n, i) => n + slotsForItem(i), 0);
    this.encumbered = this.contentsSlots >= this.capacity;
  }

  /* -------------------------------------------- */

  /**
   * @override — `@Embed[Item.…]`. See `NpcData#toEmbed` for why this lives on the data model and
   * why a plain element is returned rather than an `HTMLDocumentEmbedElement`.
   *
   * `@Embed[Item.… description]` gives the prose alone. A Warden quoting a spell into a page
   * usually wants the words, not the tag row.
   *
   * The option goes INSIDE the brackets, space-separated after the uuid: that is what core's
   * `_parseEmbedConfig` collects into `config.values`. A trailing `{…}` is the caption, not an
   * option — writing `@Embed[Item.…]{description}` silently renders the full card with the word
   * "description" as its caption, which is how this was first written and what the live client
   * caught (2026-09-20).
   * @param {DocumentHTMLEmbedConfig} config
   * @param {EnrichmentOptions} [options]
   * @returns {Promise<HTMLElement|null>}
   */
  async toEmbed(config, options = {}) {
    const item = this.parent;
    if (!item.testUserPermission(game.user, "LIMITED")) return null;

    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(
      html ?? "", { relativeTo: item, secrets: item.isOwner, ...options }
    );

    const section = document.createElement("section");
    section.className = `${SYSTEM_ID} cairn-embed cairn-embed-gear`;
    if (config.values?.includes("description")) {
      section.innerHTML = await enrich(this.description);
      return section;
    }
    section.innerHTML = await foundry.applications.handlebars.renderTemplate(
      `systems/${SYSTEM_ID}/templates/embeds/gear.hbs`,
      {
        name: item.name,
        img: item.img,
        system: this,
        description: await enrich(this.description),
        recharge: this.magic === "relic" ? await enrich(this.recharge) : ""
      }
    );
    return section;
  }
}

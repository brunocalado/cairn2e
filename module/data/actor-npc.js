/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import { abilitiesField, resourceField } from "./_fields.js";
import { sumUsedSlots, sumEquippedArmor } from "./_derived.js";

const fields = foundry.data.fields;

/**
 * Non-Player Character / monster.
 *
 * Statblocks in `srd-2e/wardens-guide/bestiary.md` are: `N HP, N STR, N DEX, N WIL, attack (dN)`,
 * often with a `Critical Damage:` clause and sometimes `_detachment_`. The header and the embedded
 * weapon Items hold the statline; the bullets under it are embedded `feature` Items.
 *
 * `armor` is intrinsic here and stored as a plain number — a monster's hide is not a worn item —
 * whereas a PC's armour is summed from equipped items (see `CharacterData`). This split is
 * deliberate and modelled explicitly rather than left to `prepareData` to infer.
 */
export class NpcData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["CAIRN.Npc"];

  static defineSchema() {
    return {
      abilities: abilitiesField(),
      hp: resourceField(0, 0),

      // One `npc` Actor type covers everyone the party is not playing: someone met (`npc`),
      // someone paid (`hireling`) and a creature (`monster`). `role` unifies them instead of three
      // Actor types with near-identical sheets — the job-specific fields below live in their own
      // keys so the dropdown never loses data.
      //
      // A creature the PARTY runs — the Half-Witch's Raven Familiar, the Outrider's horse
      // (`srd-2e/backgrounds/`) — is a `monster` like any other. It has no role of its own because
      // nothing on the sheet would differ: the enemy controls it does not need (Detachment, Morale,
      // Reaction) are an unpressed button and an unset field, not a wrong one, and who is at the
      // sheet is Foundry ownership rather than anything this model should hold.
      role: new fields.StringField({
        required: true, blank: false, initial: "npc",
        choices: ["npc", "hireling", "monster"]
      }),

      // The NPC's background *word* (`wardens-guide/npc-tables.md` d20) — grants nothing mechanical,
      // it is flavour. A hireling uses `career` instead and leaves this blank.
      background: new fields.StringField({ required: true, blank: true }),

      // Hireling career off the 2e Marketplace list (`players-guide/marketplace.md` → Hirelings).
      career: new fields.StringField({ required: true, blank: true }),
      // Gold per day. Auto-filled from a known Career name by the generator; a hand-set value wins.
      dayRate: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 }),

      // The six appearance keys are `players-guide/character-creation.md` § Character Traits,
      // rolled for a hireling ("roll on the Character Traits tables", `core-rules.md` § Hirelings);
      // `quirk`, `goal`, `virtue` and `vice` are `wardens-guide/npc-tables.md`. Monsters leave
      // these blank and describe themselves on their `feature` Items.
      traits: new fields.SchemaField({
        physique: new fields.StringField({ required: true, blank: true }),
        skin: new fields.StringField({ required: true, blank: true }),
        hair: new fields.StringField({ required: true, blank: true }),
        face: new fields.StringField({ required: true, blank: true }),
        speech: new fields.StringField({ required: true, blank: true }),
        clothing: new fields.StringField({ required: true, blank: true }),
        quirk: new fields.StringField({ required: true, blank: true }),
        goal: new fields.StringField({ required: true, blank: true }),
        virtue: new fields.StringField({ required: true, blank: true }),
        vice: new fields.StringField({ required: true, blank: true })
      }),

      // Armour is capped at 3 for PCs, NPCs and monsters alike (core-rules.md).
      armor: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0, max: 3 }),

      // The Warden's free text. A monster's rules are its `feature` Items, not prose here.
      description: new fields.HTMLField({ required: true, blank: true }),

      // A group fighting as one. Attacks against it by individuals are impaired (except blast);
      // its attacks against individuals are enhanced and deal blast (detachments.md).
      isDetachment: new fields.BooleanField({ initial: false }),

      // Morale save target. Enemies make a WIL save on their first casualty, at half strength, and
      // — for a lone foe — at 0 HP. `null` ⇒ use this actor's own WIL; a number ⇒ a led group
      // using its leader's WIL. PCs are exempt (handled in the roll code, not here).
      morale: new fields.NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0, max: 20 }),

      // NPCs can carry equipment (hirelings especially).
      slots: new fields.SchemaField({
        max: new fields.NumberField({ required: true, nullable: false, integer: true, initial: 0, min: 0 })
      })
    };
  }

  prepareDerivedData() {
    const items = this.parent.items;
    this.slotsUsed = sumUsedSlots(items);
    this.slotsMax = this.slots.max;
    this.encumbered = this.slotsMax > 0 && this.slotsUsed >= this.slotsMax;

    // Intrinsic armour (`armor`) plus anything equipped, capped at 3. Stored `armor` is left
    // alone so the sheet input round-trips; `armorTotal` is the value damage rolls use.
    this.armorTotal = Math.min((this.armor ?? 0) + sumEquippedArmor(items), 3);

    this.hp.effective = this.hp.value;

    // A creature describes itself on Features and has none of the Details tab's people-fields
    // (`npc-tables.md` is about people). Named rather than tested inline because it is the
    // system's one expression of beast-versus-person: the Identity tab reads it, and so does the
    // promotion gate, which promotes people and refuses creatures.
    this.isCreature = this.role === "monster";
  }

  /* -------------------------------------------- */

  /**
   * @override — `@Embed[Actor.…]` in a journal page, an item description, anywhere text is
   * enriched. Core calls this through `ClientDocument#_buildEmbedHTML`, which delegates to the
   * DATA MODEL whenever `system` is a `TypeDataModel` — so this is the seam, not a `CairnActor`
   * override, and the split by subtype comes free.
   *
   * A plain `<section>` is returned rather than an `HTMLDocumentEmbedElement`, so core wraps it
   * in a `<figure>` and adds the citation link back to this Actor. Suppressing the wrapper would
   * take the citation with it, and a stat block a reader cannot trace back to its Actor is worse
   * than one in a box.
   *
   * `null` refuses the embed and leaves the source text on the page, which is the honest answer
   * for a reader who is not allowed to see this Actor.
   * @param {DocumentHTMLEmbedConfig} config
   * @param {EnrichmentOptions} [options]
   * @returns {Promise<HTMLElement|null>}
   */
  async toEmbed(config, options = {}) {
    const actor = this.parent;
    if (!actor.testUserPermission(game.user, "LIMITED")) return null;

    const section = document.createElement("section");
    // The scope class is on the fragment ITSELF: it lands in core's journal window, which has no
    // `.cairn2e` ancestor for the stylesheet to descend from (the same reason Primitive 11 is
    // written as a compound selector).
    section.className = `${SYSTEM_ID} cairn-embed cairn-embed-npc`;
    section.innerHTML = await foundry.applications.handlebars.renderTemplate(
      `systems/${SYSTEM_ID}/templates/embeds/npc.hbs`,
      {
        name: actor.name,
        // `@Embed[Actor.…]{token}` shows what is on the map instead of the portrait.
        img: config.values?.includes("token") ? actor.prototypeToken.texture.src : actor.img,
        hp: this.hp,
        armorTotal: this.armorTotal,
        abilities: this.abilities,
        isDetachment: this.isDetachment,
        weapons: actor.items.filter((i) => i.type === "gear" && i.system.damage),
        features: actor.items.filter((i) => i.type === "feature"),
        // `options` carries the enrichment context the outer pass was running under. Dropping it
        // breaks every link and chip inside the description — including this system's own.
        description: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
          this.description ?? "",
          { relativeTo: actor, secrets: actor.isOwner, ...options }
        )
      }
    );
    return section;
  }
}

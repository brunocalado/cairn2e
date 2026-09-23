/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, CONDITION } from "../constants.js";
import { appearanceTraitRows, regenerateNpc } from "../npc-generator.js";
import { regenerateMonster } from "../monster-generator.js";
import { promoteToCharacter } from "../promotion.js";
import { rollMorale, rollReaction } from "../rolls.js";
import { enrich, abilityRows } from "../helpers.js";
import { CairnActorSheet } from "./actor-sheet.js";
import { createItemFromPrompt } from "./_item-prompt.js";
import { CairnNpcEdit } from "./npc-edit.js";

const TEMPLATES = `systems/${SYSTEM_ID}/templates`;

export class CairnNpcSheet extends CairnActorSheet {
  static EDIT_APP = CairnNpcEdit;
  static EDIT_LABEL = "CAIRN.EditNpc";

  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "actor", "npc"],
    // The character sheet's frame: the same width so the two headers line up, and the content's
    // own height for the same reason the character's is (`CairnCharacterSheet.DEFAULT_OPTIONS`).
    position: { width: 600, height: "auto" },
    window: { resizable: false },
    actions: {
      rollMorale: CairnNpcSheet.#onRollMorale,
      rollReaction: CairnNpcSheet.#onRollReaction,
      detachmentToggle: CairnNpcSheet.#onDetachmentToggle,
      regenerateNpc: CairnNpcSheet.#onRegenerateNpc,
      promoteToCharacter: CairnNpcSheet.#onPromoteToCharacter,
      itemCreate: CairnNpcSheet.#onItemCreate,
      featureCreate: CairnNpcSheet.#onFeatureCreate
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/parts/npc-header.hbs` },
    nav: { template: `${TEMPLATES}/parts/actor-tabs.hbs` },
    items: { template: `${TEMPLATES}/actor/npc-items.hbs`, scrollable: [""] },
    features: { template: `${TEMPLATES}/actor/npc-features.hbs`, scrollable: [""] },
    identity: { template: `${TEMPLATES}/actor/npc-identity.hbs`, scrollable: [""] },
    description: { template: `${TEMPLATES}/actor/npc-description.hbs`, scrollable: [""] }
  };

  static EDITOR_FIELDS = ["system.description"];

  static TABS = {
    primary: {
      initial: "items",
      tabs: [
        { id: "items", label: "CAIRN.Items" },
        { id: "features", label: "CAIRN.Features" },
        { id: "identity", label: "CAIRN.Identity" },
        { id: "description", label: "CAIRN.Description" }
      ]
    }
  };

  /** @override — an Item change redraws the header (`armorTotal`) and both item lists. */
  partsForRenderContext(renderContext) {
    const subject = String(renderContext ?? "").replace(/^(create|update|delete)/, "").toLowerCase();
    if (subject === "items") return ["header", "items", "features"];
    return null;
  }

  /**
   * @override — a creature has no Identity: nothing on that tab is theirs.
   * `npc-tables.md` describes people (a background word, a quirk, a goal, a virtue and a vice)
   * and the hireling rule adds a career and the appearance traits; a creature describes itself on
   * Features. The part is dropped the way the item sheet drops a subtype's absent tabs, and
   * `_getTabsConfig` takes its entry off the strip.
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (this.actor.system.isCreature) delete parts.identity;
    return parts;
  }

  /** @override — the strip lists only the parts that survived; a reader standing on the tab that
   *  was just dropped (the role changed behind the quill) is moved to Items. */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (group !== "primary" || !config || !this.actor.system.isCreature) return config;
    if (this.tabGroups.primary === "identity") this.tabGroups.primary = "items";
    return { ...config, tabs: config.tabs.filter((t) => t.id !== "identity") };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    const role = system.role ?? "npc";

    context.roleLabel = game.i18n.localize(`CAIRN.Role.${role.charAt(0).toUpperCase()}${role.slice(1)}`);
    context.abilities = abilityRows(system);
    context.appearanceTraits = appearanceTraitRows(system);
    // In collection order — for a bestiary creature, the SRD's own bullet order. A name that is
    // a label ("Magic", "Critical Damage") rather than a sentence takes the SRD's colon before
    // its description; a lead sentence already ends in its own stop.
    context.features = [];
    for (const item of this.actor.items) {
      if (item.type !== "feature") continue;
      context.features.push({
        id: item.id,
        name: item.name,
        critical: item.system.critical,
        isLabel: !/[.!?)"\u201d\u2026]$/.test(item.name.trim()),
        description: await enrich(item.system.description, this.actor)
      });
    }
    return context;
  }

  /** @override — the re-roll control, Warden-only. A monster re-rolls through the tier picker;
   *  a person through the NPC re-roll. Either asks before it writes, so nothing here needs to
   *  guess which actors were rolled in the first place. */
  _getHeaderControls() {
    const controls = super._getHeaderControls();
    const role = this.actor.system.role;
    if (game.user.isGM) {
      controls.push({
        action: "regenerateNpc",
        icon: "fas fa-dice",
        label: role === "monster" ? "CAIRN.MonsterGen.Reroll" : "CAIRN.RerollNpc"
      });
    }
    return controls;
  }

  /**
   * @override — Promote sits in the title bar, LEFT of the ellipsis, as a labelled button.
   *
   * Not a frame button: core inserts those to the right of the ellipsis, icon-only, with the word
   * in an `aria-label` nobody sees (`_renderFrameButtons` → before the ✕). The maintainer wants
   * the word on the bar, so the button is built here and slotted before core's own controls
   * toggle. Any `[data-action]` inside the application element dispatches through `actions`, which
   * is how the quill already reaches `openEdit` from this header. Warden-only, like every other
   * door to promotion; whether this actor is a person is decided per render (`_onRender`).
   */
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    if (!game.user.isGM) return frame;
    const button = frame.ownerDocument.createElement("button");
    button.type = "button";
    button.className = "header-control cairn-frame-label";
    button.dataset.action = "promoteToCharacter";
    button.dataset.tooltip = game.i18n.localize("CAIRN.Promote.Title");
    button.textContent = game.i18n.localize("CAIRN.Promote.Promote");
    frame.querySelector('button[data-action="toggleControls"]').insertAdjacentElement("beforebegin", button);
    return frame;
  }

  /** @override — an Identity part left in the DOM by an earlier render (core replaces the parts it
   *  rendered and leaves the rest) is removed once the actor has become a creature. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.actor.system.isCreature) this.element.querySelector('[data-application-part="identity"]')?.remove();
    // Any person, not only a hireling, is offered promotion: the SRD's "hireling" is wider than
    // the role (§ Hirelings builds one from a background too), and someone the party travelled
    // with arrives at "take control of a hireling" (`core-rules.md` § Character Death) by another
    // door. A creature is refused — there is no rule handing a player a familiar to run as a PC —
    // and the role can change behind the quill while the sheet is open, so it is decided here.
    const promote = this.element.querySelector('.window-header [data-action="promoteToCharacter"]');
    if (promote) promote.hidden = this.actor.system.isCreature;
  }

  /* -------------------------------------------- */

  /** A failed Morale save means the enemy runs (`core-rules.md`), and the token says so. The
      Warden clears it when they decide the enemy has rallied — nothing recomputes it. */
  static async #onRollMorale() {
    const passed = await rollMorale(this.actor);
    if (!passed) await this.actor.toggleStatusEffect(CONDITION.FLEEING, { active: true });
  }

  static async #onRollReaction() {
    await rollReaction(this.actor);
  }

  /** Flips mid-fight — a detachment that loses members stops being one — so it is on the face
   *  like the character's conditions, not in the edit window. */
  static async #onDetachmentToggle() {
    await this.actor.update({ "system.isDetachment": !this.actor.system.isDetachment });
  }

  static async #onRegenerateNpc() {
    if (this.actor.system.role === "monster") await regenerateMonster(this.actor);
    else await regenerateNpc(this.actor);
  }

  /** The person a dead PC's player takes over. The sheet this window is does not survive it:
   *  core swaps the application when a document's subtype changes. */
  static async #onPromoteToCharacter() {
    await promoteToCharacter(this.actor);
  }

  /** The Items head's add control: the shared prompt, with the *petty* question left out. */
  static async #onItemCreate() {
    await createItemFromPrompt(this.actor);
  }

  /** The Features head's add control: a blank feature, opened for naming. */
  static async #onFeatureCreate() {
    // No `img`: a feature's art is its subtype's default (`constants.js#DEFAULT_ARTWORK`), which
    // core applies through the `img` field's own initial. Naming it here too was a second place
    // to keep in step with the first.
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{
      name: game.i18n.localize("CAIRN.NewFeature"),
      type: "feature"
    }]);
    item?.sheet.render(true);
  }
}

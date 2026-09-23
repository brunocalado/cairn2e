/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, FLAGS } from "./constants.js";

const { TokenHUD } = foundry.applications.hud;

/** How long a member takes to slide in or out of the party token, in milliseconds. */
const TRAVEL_MS = 400;

/**
 * Put each condition's name beside its icon in the token HUD's status palette.
 *
 * Core draws the palette as a five-column grid of 24px images and keeps the name in a tooltip, so
 * telling Deprived from Fatigued from Delirious means hovering each one in turn. Each image is
 * wrapped in a row that carries the name beside it, and the grid is widened to two columns — ten
 * conditions then read at a glance in five rows instead of nine hovers.
 *
 * **The click stays core's.** `TokenHUD.#onToggleEffect` reads `dataset.statusId` and the `active`
 * class off the element carrying `data-action="effect"`, and that element is still the `<img>`.
 * The name is laid over it with `pointer-events: none` (the stylesheet), so a click anywhere on
 * the row falls through to the image underneath — including the right click core registers for
 * the overlay. Nothing here handles an event.
 *
 * **Why the scope class goes on the palette and not on `#token-hud`.** The stylesheet reaches
 * descendants by type in four places — the button, input and link primitives — and the HUD is full
 * of `button.control-icon`, three text inputs and the `a.palette-list-entry` rows of the Levels and
 * Movement palettes. Scoping the whole HUD would paint core's dark chrome in paper-and-ink: the
 * ink-button primitive alone would give it ink-coloured glyphs on a dark bar, which is invisible
 * controls that still click. That exact bug already cost a session against core's window header,
 * and the comment above that primitive tells the story. The palette holds nothing but these rows,
 * so scoping it instead cannot reach any of them. It also keeps the `renderApplicationV2` handler
 * in `module/cairn2e.js` from stamping this system's tooltip class onto core's HUD buttons: that
 * handler tests the application ROOT, and the root is no longer marked.
 *
 * No guard against wrapping twice is needed. `TokenHUD.PARTS.hud` is a root part, so
 * `HandlebarsApplicationMixin#_replaceHTML` rebuilds the palette's children from scratch on every
 * render and this runs against fresh markup each time.
 */
export function installTokenHudLabels() {
  Hooks.on("renderTokenHUD", (app, element) => {
    const palette = element.querySelector(".palette.status-effects");
    if (!palette) return;
    palette.classList.add(SYSTEM_ID);

    for (const img of palette.querySelectorAll("img.effect-control")) {
      const label = document.createElement("span");
      label.className = "effect-name";
      // Core's template has already localized the name into the attribute, and reading it there
      // is also what keeps this out of `_getStatusEffectChoices()` — a @protected method, which
      // is only ours to call from a subclass.
      label.textContent = img.dataset.tooltipText ?? "";

      // The name is on screen now; leaving the tooltip would say the same thing twice.
      delete img.dataset.tooltipText;

      const row = document.createElement("div");
      row.className = "effect-row";
      row.replaceChildren(label);
      // `replaceWith` takes the image out of the DOM but the reference stays live, so the row
      // that took its place can take it back in.
      img.replaceWith(row);
      row.prepend(img);
    }
  });
}

/* -------------------------------------------- */
/*  The party control                           */
/* -------------------------------------------- */

/**
 * The Token HUD, with one control added for a party token: set the group down, or gather it in.
 *
 * **Why a subclass here when the labels above are a hook.** A control in this system is a
 * `data-action` plus an entry in an `actions` map, both halves, and a hook has no map to add to.
 * The label pass stays a hook because it only rewrites markup core already drew and needs
 * nothing from the class; the two live in one file because they are both "what this system does
 * to the token HUD", and neither touches the other.
 *
 * **Why the button is appended rather than templated.** Core draws the HUD from a single root
 * part, `templates/hud/token-hud.hbs`. A subclass that wanted a button inside it would have to
 * own a copy of core's markup and re-reconcile it every v14 build. ApplicationV2 delegates
 * clicks from the application's root element — one listener, then `closest("[data-action]")` —
 * so a button put here by hand reaches the actions map exactly as a templated one would.
 */
export class CairnTokenHUD extends TokenHUD {
  static DEFAULT_OPTIONS = {
    actions: { partyToggle: CairnTokenHUD.#onPartyToggle }
  };

  /**
   * True while a set-down or a gather-in is in flight.
   *
   * Both halves take about half a second of animation before they write, and a second press in
   * that window would read the same "are they down?" answer as the first and do it again — two
   * tokens per member, or a delete racing a create. Static because the HUD is re-instantiated
   * as it moves between tokens.
   */
  static #working = false;

  /** @override — a party is not a combatant: it has no HP, no attributes and no save to roll. */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (this.actor?.type === "party") context.canToggleCombat = false;
    return context;
  }

  /** @override — add the party control, for whoever may actually perform it. */
  _onRender(context, options) {
    super._onRender(context, options);
    if (this.actor?.type !== "party") return;
    // Creating and deleting tokens is Assistant-and-above by default, and a world may have
    // raised either to Gamemaster alone. Asking for the two permissions the press really uses
    // cannot be wrong, where `game.user.isGM` — which is "Assistant or above" — can be.
    if (!game.user.can("TOKEN_CREATE") || !game.user.can("TOKEN_DELETE")) return;

    const down = this.#membersAreDown();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon cairn-party-toggle";
    button.dataset.action = "partyToggle";
    button.dataset.tooltip = game.i18n.localize(down ? "CAIRN.Party.Gather" : "CAIRN.Party.SetDown");
    button.ariaLabel = button.dataset.tooltip;
    button.innerHTML = `<i class="fa-solid ${down ? "fa-people-arrows" : "fa-people-group"}" inert></i>`;
    (this.element.querySelector(".col.right") ?? this.element).append(button);
  }

  /* -------------------------------------------- */

  /**
   * Are the members on the map?
   *
   * Derived, never stored. A stored answer is a second source of truth that a hand-deleted
   * token, a scene change or a failed write can put out of step, with nothing to repair it.
   *
   * Only the members the roster says are **deployed** are counted. A member held back may well
   * have a token of its own standing somewhere — that is the whole point of holding it back —
   * and counting that one would leave this permanently certain the group is already down.
   * @returns {boolean}
   */
  #membersAreDown() {
    return this.actor.system.roster.some(({ actor, deployed }) =>
      deployed && this.#tokensOf(actor).length > 0);
  }

  /**
   * This member's tokens on the scene the party token is standing on.
   *
   * Asked of the SCENE, not of the returned token. `getDependentTokens` keeps handing back
   * tokens that have already been removed — some with no id at all, and some, measured in a
   * client on 2026-09-20, still carrying the id they had before they were deleted. An `id`
   * test catches the first kind and not the second, and updating one of the second kind throws
   * `does not exist in the EmbeddedCollection collection` in the middle of gathering the group
   * in, leaving half of it on the map. Membership is the only question with a reliable answer.
   * @param {Actor} actor
   * @returns {TokenDocument[]}
   */
  #tokensOf(actor) {
    return actor.getDependentTokens({ scenes: canvas.scene })
      .filter((t) => t.id && canvas.scene.tokens.has(t.id));
  }

  /* -------------------------------------------- */

  /**
   * @this {CairnTokenHUD}
   * @type {foundry.applications.types.ApplicationClickAction}
   */
  static async #onPartyToggle() {
    if (CairnTokenHUD.#working) return;
    CairnTokenHUD.#working = true;
    try {
      if (this.#membersAreDown()) await this.#gatherIn();
      else await this.#setDown();
    } finally {
      CairnTokenHUD.#working = false;
      this.render();
    }
  }

  /**
   * Take every deployed member's token off the map, and remember it.
   *
   * The snapshot is the whole token, not a note that it was there. A player character's token is
   * linked, so almost everything about it could be rebuilt from the Actor — but a follower's is
   * not (`module/encounters.js` creates a mount or a hireling unlinked, on purpose), and what
   * has happened to that token since it was placed lives on the token alone.
   *
   * The combatants are removed here rather than left to core. Core does have that cleanup —
   * `Combat._onDeleteTokens` — but at 14.368 it skips every combat bound to a scene: it
   * compares `combat.scene`, which is a Scene **document**, against a scene **id** string, and
   * those are never equal. Measured in a client on 2026-09-20 — a combatant survived its
   * token's deletion — so the group would otherwise be gathered in and still be in the
   * initiative order, as rows pointing at tokens that no longer exist.
   *
   * Removing them is the honest half of the trade, not a rescue: a member set down again comes
   * back OUT of the fight, which is why the Warden is told before it happens.
   */
  async #gatherIn() {
    const { x, y } = this.document;
    const gathered = [];
    const leaving = [];

    for (const { actor, deployed } of this.actor.system.roster) {
      if (!deployed) continue;
      for (const token of this.#tokensOf(actor)) {
        gathered.push({ uuid: actor.uuid, token: token.toObject() });
        leaving.push(token);
      }
    }
    if (!leaving.length) return;

    const inCombat = leaving.filter((t) => t.inCombat).map((t) => t.name);
    if (inCombat.length) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Party.GatheringFromCombat", {
        names: game.i18n.getListFormatter().format(inCombat)
      }));
    }

    await this.actor.setFlag(SYSTEM_ID, FLAGS.GATHERED_TOKENS, gathered);
    if (inCombat.length) await TokenDocument.implementation.deleteCombatants(leaving);
    // Walk them onto the party token before they go, so the group is seen to close up rather
    // than to vanish. The delete cannot ride the same call: an animated update resolves as soon
    // as the write lands, not when the movement finishes.
    await Promise.all(leaving.map((t) =>
      t.update({ x, y, alpha: 0 }, { animation: { duration: TRAVEL_MS } })));
    await new Promise((r) => setTimeout(r, TRAVEL_MS));
    await canvas.scene.deleteEmbeddedDocuments("Token", leaving.map((t) => t.id));
  }

  /**
   * Put every deployed member back on the map, in marching order.
   *
   * Each comes back as the token it was, out of the snapshot, falling back to its prototype for
   * a member who has never been set down here. Everything is restored except WHERE: the party
   * has moved since, and returning the group to where it stood two rooms ago is never what was
   * meant. Position comes from the party token.
   */
  async #setDown() {
    const roster = this.actor.system.roster.filter((m) => m.deployed);
    if (!roster.length) return;

    const gathered = this.actor.getFlag(SYSTEM_ID, FLAGS.GATHERED_TOKENS) ?? [];
    const places = marchingPositions(this.document, roster.length);
    const data = [];

    for (const [i, { actor }] of roster.entries()) {
      const kept = gathered.find((g) => g.uuid === actor.uuid)?.token;
      const source = kept ?? (await actor.getTokenDocument()).toObject();
      // A stored `_id` would ask the scene to re-create a token under an id it no longer has.
      delete source._id;
      data.push({ ...source, ...places[i], elevation: this.document.elevation, alpha: 0 });
    }

    const created = await canvas.scene.createEmbeddedDocuments("Token", data);
    await Promise.all(created.map((t) =>
      t.update({ alpha: 1 }, { animation: { duration: TRAVEL_MS } })));
  }
}

/**
 * Where the members stand once they are set down: single file behind the party token, first on
 * the roster nearest to it.
 *
 * A marching order is a line, and drawing it as one is the only layout that says which it is —
 * a ring or a block puts the order somewhere only the sheet can be read for. The column runs
 * down the map because a Foundry scene has no facing to run away from, and the party token
 * stays where it is at the head of it.
 *
 * Occupied cells are stepped over. A member held back is standing in that line already, and
 * numbering the deployed members 1..n dropped the next one exactly on top of them — measured in
 * a client on 2026-09-20, with one member held back mid-column. The cap is there because a
 * crowded scene has no free cell to find and a search for one must still end.
 * @param {TokenDocument} origin  the party's own token
 * @param {number} count
 * @returns {Array<{x: number, y: number}>}
 */
function marchingPositions(origin, count) {
  const size = canvas.grid.size;
  const taken = new Set(canvas.scene.tokens.map((t) => `${t.x},${t.y}`));
  const out = [];
  for (let step = 1; out.length < count && step <= count * 4; step++) {
    const point = canvas.grid.getTopLeftPoint({ x: origin.x, y: origin.y + step * size });
    const key = `${point.x},${point.y}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(point);
  }
  // A scene with nowhere left to stand still has to put them somewhere: the last cells of the
  // column, on top of whatever is there, rather than fewer members than the party has.
  while (out.length < count) {
    out.push(canvas.grid.getTopLeftPoint({ x: origin.x, y: origin.y + (out.length + 1) * size }));
  }
  return out;
}

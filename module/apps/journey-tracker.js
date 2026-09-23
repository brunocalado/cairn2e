/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID } from "../constants.js";
import * as journey from "../journey.js";
import { ACTIONS, WATCHES, WEATHER, PATHS, WEATHER_EFFECTS, pendingNeeds } from "../journey-rules.js";
import { CairnInkMixin } from "./_ink-mixin.js";
import { addEncounterToScene, pickScenePoint } from "../encounters.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/journey`;

/**
 * The journey window — one per client, showing the journey in `SETTINGS.JOURNEY` and nothing of
 * its own. It never holds state: every part is drawn from the setting, and the setting's
 * `onChange` (`module/settings.js`) calls {@link CairnJourneyTracker.refresh} on every client, so
 * the Warden's write is what every open window shows a moment later.
 *
 * The party travels as one group and decides at the table, so there is one run of action buttons
 * for the whole party and the Warden presses what the group settled on. Who may press what is
 * decided here for the drawing and again in `module/journey.js#apply` for the doing: a player
 * reads the sky, the roster and the action as set controls they cannot move, and presses only the
 * party's two rolls. A player's press becomes a query to the Warden's client; the Warden's press
 * is applied there directly.
 *
 * Opening it: the sidebar tab (Warden), the "Open the journey" button on the journey's start
 * card (anyone), or the Warden's "Show to everyone", which is a socket broadcast every client
 * answers by opening its own window (`module/cairn2e.js`).
 */
export class CairnJourneyTracker extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — nothing drawn here follows a scroller. */
  static INK_SCROLLERS = [];

  static DEFAULT_OPTIONS = {
    id: "cairn2e-journey",
    classes: [SYSTEM_ID, "cairn-journey"],
    tag: "form",
    position: { width: 560, height: 700 },
    window: { title: "CAIRN.Journey.Title", icon: "fas fa-route", resizable: true },
    form: { handler: CairnJourneyTracker.#onStart, submitOnChange: false, closeOnSubmit: false },
    actions: {
      setAction: CairnJourneyTracker.#onSetAction,
      setWeather: CairnJourneyTracker.#onSetWeather,
      removeCrew: CairnJourneyTracker.#onRemoveCrew,
      openSheet: CairnJourneyTracker.#onOpenSheet,
      rollLost: CairnJourneyTracker.#onRollLost,
      rollSupply: CairnJourneyTracker.#onRollSupply,
      resupply: CairnJourneyTracker.#onResupply,
      resolveWatch: CairnJourneyTracker.#onResolveWatch,
      adjust: CairnJourneyTracker.#onAdjust,
      addFatigue: CairnJourneyTracker.#onAddFatigue,
      rerollEvent: CairnJourneyTracker.#onRerollEvent,
      placeEncounter: CairnJourneyTracker.#onPlaceEncounter,
      pushToAll: CairnJourneyTracker.#onPushToAll,
      endJourney: CairnJourneyTracker.#onEndJourney
    }
  };

  // Five parts: the route form (drawn while nothing is underway), then the three faces of a
  // journey — where the party is and when (`header`), what this watch looks like (`watch`: the
  // sky, the roster and the action), and what the last one turned up (`events`). Last the
  // Warden's foot. Nothing scrolls: the window fits itself to the roster instead (`_onRender`).
  static PARTS = {
    setup: { template: `${TEMPLATES}/setup.hbs` },
    header: { template: `${TEMPLATES}/header.hbs` },
    watch: { template: `${TEMPLATES}/watch.hbs` },
    events: { template: `${TEMPLATES}/events.hbs` },
    footer: { template: `${TEMPLATES}/footer.hbs` }
  };

  /** The one window this client has. */
  static #instance = null;

  /** Which face is on screen — the route form or the journey — and how many are on the roster.
   *  Only read to refit when either changes, so the form is not a third of a window with two
   *  thirds of nothing under it, and a character dropped on the roster is not cut off below it. */
  #fit = null;

  /** What the next route form opens set to, or `null`. Held until `start` consumes it or the
   *  window closes: a pin's double-click sets it (`module/pointcrawl.js`), the form draws from
   *  it, and nothing else reads it. */
  #prefill = null;

  /** Open the window, or bring the open one forward — the route form set to `route` when one is
   *  given. */
  static open({ route = null } = {}) {
    CairnJourneyTracker.#instance ??= new CairnJourneyTracker();
    if (route) CairnJourneyTracker.#instance.#prefill = route;
    return CairnJourneyTracker.#instance.render({ force: true });
  }

  /** Redraw the open window from the setting. A closed one is left closed. */
  static refresh() {
    const app = CairnJourneyTracker.#instance;
    if (app?.rendered) app.render();
  }

  /**
   * Redraw the open window when a character it draws changes on ANY client.
   *
   * The roster row reads Rations, Fatigue and Deprived straight off the Actor, so a sheet edit
   * the journey never made still moves what the row says — and the setting's own `onChange`
   * (`module/settings.js`) only fires when the JOURNEY changes. Without this, deleting a Fatigue
   * on a sheet left the journey row showing the old count until something happened to write the
   * setting.
   *
   * Debounced, for the reason the condition sync in `cairn2e.js` is: dealing a Supply bounty
   * fires one `createItem` per Ration, and five renders of a four-part window is five times the
   * work for one logical change.
   *
   * Registered once, at `ready`, on every client — a player has the window open too and reads
   * the same numbers. The window itself may be closed; `refresh()` no-ops then.
   */
  static watchParty() {
    const redraw = foundry.utils.debounce(() => CairnJourneyTracker.refresh(), 100);
    const onRoster = (actor) => {
      if (!actor?.uuid || !CairnJourneyTracker.#instance?.rendered) return false;
      return (journey.current()?.crew ?? []).includes(actor.uuid);
    };
    Hooks.on("updateActor", (actor) => { if (onRoster(actor)) redraw(); });
    // Rations are gear uses and Fatigue is an item, so all three item hooks matter.
    for (const hook of ["createItem", "updateItem", "deleteItem"]) {
      Hooks.on(hook, (item) => { if (onRoster(item.parent)) redraw(); });
    }
    // Deprived is not stored on the model — it is an ActiveEffect and nothing else
    // (`data/actor-character.js`), and an effect write fires no `updateActor`.
    for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(hook, (effect) => { if (onRoster(effect.parent)) redraw(); });
    }
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    context.isGM = isGM;
    const state = journey.current();
    context.journey = state;

    if (!state) {
      // The four tables the route page and this form share (`journey.js#routeChoices`), set to
      // whatever a pin's double-click pre-filled, plus the season, which is the world's and not
      // the route's. `prefill` carries the two endpoints through the form as hidden inputs, so
      // a journey begun from a route remembers which two points it runs between.
      Object.assign(context, journey.routeChoices(this.#prefill ?? {}));
      context.seasons = choices(WEATHER, "CAIRN.Journey.Seasons");
      return context;
    }

    const need = pendingNeeds(state);
    const t = (k) => game.i18n.localize(k);
    context.route = {
      path: t(`CAIRN.Journey.Paths.${state.route.path}`),
      distance: t(`CAIRN.Journey.Distances.${state.route.distance}`),
      terrain: t(`CAIRN.Journey.Terrains.${journey.effectiveTerrain(state)}`),
      terrainRaised: journey.effectiveTerrain(state) !== state.route.terrain,
      season: t(`CAIRN.Journey.Seasons.${state.route.season}`),
      lostOdds: PATHS[state.route.path].lost
    };
    context.ticks = Array.from({ length: state.watchesNeeded }, (_, i) => ({ done: i < state.progress }));
    context.watches = WATCHES.map((w, i) => ({ label: t(`CAIRN.Journey.Watches.${w}`), current: i === state.watch }));
    context.weather = state.weather && {
      label: t(`CAIRN.Journey.Weathers.${state.weather}`),
      effect: t(`CAIRN.Journey.WeatherEffects.${state.weather}`),
      ...WEATHER_EFFECTS[state.weather]
    };
    // The Warden's sky dial: Auto first — the empty value, which hands the day back to the dice —
    // then every row of the Weather Difficulty table, Catastrophic included. That one is never
    // rolled directly, it only follows a second Extreme, but the Warden may still set it.
    // Auto reads as chosen only in the moment before a roll lands, since a rolled day names itself.
    // Each button carries its own row of the table as `effect`: the watch band shows it as a
    // tooltip over the button rather than as a line of prose under the run, so seven rows of
    // Difficulty can be read one at a time without the band changing height under the reader.
    context.weathers = [
      {
        key: "",
        label: t("CAIRN.Journey.WeatherAuto"),
        effect: t("CAIRN.Journey.WeatherAutoHint"),
        selected: state.weather === null
      },
      ...Object.keys(WEATHER_EFFECTS).map((key) => ({
        key,
        label: t(`CAIRN.Journey.Weathers.${key}`),
        effect: t(`CAIRN.Journey.WeatherEffects.${key}`),
        selected: key === state.weather
      }))
    ];
    // The watch that just ended, and what it turned up. `canEdit` and `index` are folded in here
    // rather than reached for with `../` in the template: the encounter block is two `{{#each}}`
    // frames deep, and a path that has to count them is one refactor from being silently wrong.
    context.events = (state.events ?? []).map((e, index) => ({ ...e, index, canEdit: isGM }));
    context.eventsWatch = state.eventsWatch ?? "";
    context.need = need;
    context.canResolve = isGM && need.ready;
    // Why the button is dead, when it is. `pending` already knows which of the three is owed, and
    // a greyed button that says nothing is a Warden clicking it twice and then reading the source.
    context.resolveHint = t(
      !need.action ? "CAIRN.Journey.NeedAction"
        : need.lost ? "CAIRN.Journey.NeedLost"
          : need.supply ? "CAIRN.Journey.NeedSupply"
            : need.weather ? "CAIRN.Journey.NeedWeather"
              : "CAIRN.Journey.Resolve");
    // One run of buttons for the whole party: the group decides at the table, the Warden presses
    // what it decided.
    context.actions = ACTIONS.map((key) => ({
      key,
      label: t(`CAIRN.Journey.Actions.${key}`),
      selected: key === need.action
    }));
    // A line per character, and the three numbers the Warden asks for between watches: what is
    // left to eat, what the walking has already cost, and whether they are Deprived — which is
    // what decides whether tonight's camp restores anything at all.
    // The crew the journey carries, in the order it was built. The list IS the membership, so
    // the row's one control takes its Actor off the trip rather than marking it.
    context.party = journey.members(state).map((actor) => ({
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      img: actor.img,
      rations: journey.rationsCarried(actor),
      fatigue: actor.items.filter((i) => i.type === "fatigue").length,
      deprived: actor.system.deprived
    }));
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // The route form is short and the journey is long, so the window fits itself to whichever it
    // is showing — and again when the roster grows or shrinks, since the roster does not scroll
    // and a row past the window's edge would simply be cut off. Only then: a height measured on
    // every redraw would undo the Warden's own resize and twitch every time a roll button came
    // and went. The configured height stays a number for the same reason —
    // `_configureRenderOptions` re-applies a configured "auto" after every single render.
    const fit = context.journey ? `journey:${context.party.length}` : "setup";
    if (fit !== this.#fit) {
      this.#fit = fit;
      this.setPosition({ height: "auto" });
    }
  }

  /** @override */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    this.#bindCrewDrop(htmlElement);
  }

  /**
   * The roster takes an Actor dropped on it.
   *
   * Bound by hand, because this is an `ApplicationV2` and not a document sheet: `ActorSheetV2`
   * and `ItemSheetV2` build their own `DragDrop` and bind it in their render, and a plain
   * application gets none — there is no `dragDrop` option for core to read (`actor-sheet.js`).
   * Two listeners on the list is the whole of it, and the same drag helper the party sheet's own
   * drop uses reads the payload.
   *
   * A `party` drops its deployed members in at once — the field already means "on this trip", as
   * against "the player who did not come tonight, the hireling left at camp"
   * (`data/actor-party.js`). Anything else drops itself in alone, which is how a mount or a
   * hireling with no owner joins a journey in a world that has no party Actor at all.
   */
  #bindCrewDrop(part) {
    const list = part.querySelector(".cairn-journey-crew");
    if (!list || !game.user.isGM) return;
    list.addEventListener("dragover", (event) => event.preventDefault());
    list.addEventListener("drop", async (event) => {
      event.preventDefault();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Actor") return;
      const actor = await fromUuid(data.uuid);
      // A compendium Actor resolves here, but after a reload `fromUuidSync` gives back an index
      // entry with no items, and the tracker threw on it (`journey.js#members`).
      if (actor?.pack) ui.notifications.warn(game.i18n.localize("CAIRN.Journey.CrewFromWorld"));
      if (!actor || actor.pack) return;
      const uuids = actor.type === "party"
        ? actor.system.roster.filter((m) => m.deployed).map((m) => m.actor.uuid)
        : [actor.uuid];
      if (uuids.length) await this.#send("addCrew", { uuids });
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Send a mutation where it runs: straight into `journey.apply` on the Warden's client, or as a
   * query to the Warden from a player's. A player with no Warden connected is told so.
   */
  async #send(type, data = {}) {
    if (game.user.isGM) return journey.apply(type, data);
    const gm = game.users.activeGM;
    if (!gm) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Journey.NoWarden"));
      return false;
    }
    try {
      return await gm.query(journey.JOURNEY_QUERY, { type, ...data }, { timeout: 10000 });
    } catch (err) {
      console.warn(`${SYSTEM_ID} | journey query failed`, err);
      ui.notifications.warn(game.i18n.localize("CAIRN.Journey.NoWarden"));
      return false;
    }
  }

  /** The route form's submit — the Warden's, and only while nothing is underway. @this {CairnJourneyTracker} */
  static async #onStart(event, form, formData) {
    if (!game.user.isGM || journey.current()) return;
    this.#prefill = null;
    await journey.apply("start", formData.object);
  }

  /** @override — the pre-fill belongs to the window that was opened for it. */
  _onClose(options) {
    super._onClose(options);
    this.#prefill = null;
  }

  /** The party's one action for this watch. */
  static #onSetAction(event, target) {
    if (target.disabled) return;
    this.#send("setAction", { action: target.value });
  }

  /** A row of the Weather Difficulty table, or Auto — the empty value, which rolls it. */
  static #onSetWeather(event, target) {
    if (target.disabled) return;
    this.#send("setWeather", { weather: target.value });
  }

  /** Take one off this journey. The row names its Actor. @this {CairnJourneyTracker} */
  static #onRemoveCrew(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-actor-uuid]")?.dataset.actorUuid;
    if (uuid) this.#send("removeCrew", { uuid });
  }

  /** The row opens the sheet it names — local to this client, and only for a sheet this user may see. */
  static #onOpenSheet(event, target) {
    const actor = game.actors.get(target.dataset.actorId);
    if (!actor?.testUserPermission(game.user, "LIMITED")) return;
    actor.sheet.render({ force: true });
  }

  /** @this {CairnJourneyTracker} */
  static #onRollLost() {
    this.#send("rollLost");
  }

  /** @this {CairnJourneyTracker} */
  static #onRollSupply() {
    this.#send("rollSupply");
  }

  /** Supply's other answer: the watch goes to a settlement rather than to foraging. */
  static #onResupply() {
    this.#send("resupply");
  }

  /** @this {CairnJourneyTracker} */
  static #onResolveWatch() {
    this.#send("resolveWatch");
  }

  /** @this {CairnJourneyTracker} */
  static #onAdjust(event, target) {
    this.#send("adjust", { field: target.dataset.field, delta: Number(target.dataset.delta) });
  }

  /** @this {CairnJourneyTracker} */
  static #onAddFatigue() {
    this.#send("addFatigueToParty");
  }

  /** Throw one of this watch's events back to the table. */
  static #onRerollEvent(event, target) {
    if (!game.user.isGM) return;
    this.#send("rerollEvent", { index: target.dataset.index });
  }

  /**
   * Put an Encounter's creatures on the scene, where the Warden says.
   *
   * This one does NOT go through `journey.apply` and cannot: it waits on a click on the canvas,
   * which is local to this client — there is no way to ask another client to point at something.
   * So the pick and the placement run here, and only the fact that it happened goes back into the
   * journey, so the button cannot fire twice.
   * @this {CairnJourneyTracker}
   */
  static async #onPlaceEncounter(event, target) {
    if (!game.user.isGM) return;
    const index = Number(target.dataset.index);
    const rows = journey.current()?.events?.[index]?.encounter?.rows ?? [];
    if (!rows.length) return;
    // Refuse before the pointer is taken over, not after the Warden has clicked at nothing.
    if (!canvas?.scene) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Encounter.NoScene"));
      return;
    }
    target.disabled = true;
    const origin = await pickScenePoint();
    // Escape, or a redraw that took the button away underneath us.
    if (!origin) {
      target.disabled = false;
      return;
    }
    const placed = await addEncounterToScene(rows, null, { origin });
    if (placed) await journey.apply("markEncounterPlaced", { index });
    else target.disabled = false;
  }

  /** The Warden asks every connected client to open its own window. */
  static #onPushToAll() {
    if (!game.user.isGM) return;
    game.socket.emit(`system.${SYSTEM_ID}`, { type: "openJourney" });
    ui.notifications.info(game.i18n.localize("CAIRN.Journey.Pushed"));
  }

  /** @this {CairnJourneyTracker} */
  static async #onEndJourney() {
    if (!game.user.isGM) return;
    const yes = await foundry.applications.api.DialogV2.confirm({
      classes: [SYSTEM_ID],
      window: { title: "CAIRN.Journey.EndTitle" },
      content: `<p>${game.i18n.localize("CAIRN.Journey.EndConfirm")}</p>`
    });
    if (yes) await journey.apply("end");
  }
}

/**
 * A rules table as a segmented control's options, with the first row chosen. The three tables a
 * route is made of moved to `journey.js#routeChoices`, which takes a route to follow — the route
 * page's edit form and a pre-filled journey form both need that. This is what is left: the
 * season, which belongs to the journey and never to a route.
 * @param {object} table   A `journey-rules.js` table, keyed by the key the state stores.
 * @param {string} prefix  The i18n prefix its names are under.
 * @param {{cost?: (value: any) => number, notes?: string}} [options]
 * @returns {{key: string, label: string, cost: string, note: string, selected: boolean}[]}
 */
function choices(table, prefix, { cost = null, notes = "" } = {}) {
  return Object.keys(table).map((key, i) => {
    const watches = cost ? cost(table[key]) : 0;
    return {
      key,
      label: game.i18n.localize(`${prefix}.${key}`),
      cost: watches > 0 ? `+${watches}` : "",
      note: notes ? game.i18n.localize(`${notes}.${key}`) : "",
      selected: i === 0
    };
  });
}

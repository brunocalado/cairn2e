/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { COMBAT_FLAGS, CONDITION, FIGHT_FLAGS, SYSTEM_ID } from "../constants.js";
import { chooseDungeonEvent, drawDungeonEvent, postJourneyCard, rollFirstRoundSave, rollMorale, rollSave } from "../rolls.js";
import { eatFood } from "../journey.js";
import { burningLights, putOutLight } from "../light-sources.js";
import { CairnRulesSummary } from "./rules-summary.js";
import { DUNGEON_TRIGGERS, MAX_EFFORT } from "../data/combat-dungeon.js";

/** "move a distance equal to their torchlight's perimeter (about 40ft)" (`procedures.md`). */
const TORCHLIGHT_FT = 40;

/** "Players can use their action to move up to three times that distance" (`procedures.md`). */
const HURRY_FT = 3 * TORCHLIGHT_FT;

/** "a character may move up to 40ft and take up to one action … moving for a second time"
 *  (`core-rules.md` → Combat): one free move, and a second one that spends the action. */
const FIGHT_MOVE_FT = 40;

/** The tooltip a row's distance carries, by pace, in an exploration and in a fight. */
const DUNGEON_PACE = { moved: "CAIRN.Dungeon.Moved", beyond: "CAIRN.Dungeon.BeyondTorch", over: "CAIRN.Dungeon.BeyondHurry" };
const FIGHT_PACE = { moved: "CAIRN.Combat.Moved", beyond: "CAIRN.Combat.BeyondMove", over: "CAIRN.Combat.BeyondRound" };

/**
 * The exploration actions the declaration offers as ideas (`procedures.md` → Actions, The
 * Basics). Examples, never a menu: the SRD lists them "such as … etc.", and a player may declare
 * anything. Engaging an enemy is A Fight Breaks Out, and running away is the fight's Retreat
 * (`core-rules.md` → Combat), so neither is here. Each key has a label
 * (`CAIRN.Dungeon.Action.<key>`) and a rule line (`CAIRN.Dungeon.ActionRule.<key>`); a panicked
 * character is offered `panic` after them.
 */
const DUNGEON_ACTIONS = ["search", "listen", "force", "disarm", "dodge", "cast", "rest", "hurry"];

/**
 * The ideas that say they may draw a Dungeon Event: moving quickly is one of the four triggers,
 * and forcing a door is the SRD's own example of a loud action ("Loud or noticeable actions may
 * also trigger an encounter").
 */
const RISKY_ACTIONS = new Set(["hurry", "force"]);

const DECLARE_TPL = `systems/${SYSTEM_ID}/templates/apps/dungeon-declare-dialog.hbs`;

/** A declaration is one short line, never a paragraph (maintainer's call, 2026-10-17): it is read
 *  off the tracker row, where a longer one wrapped into a block. */
const DECLARATION_MAX = 50;

const TASK_TPL = `systems/${SYSTEM_ID}/templates/apps/dungeon-task-dialog.hbs`;

/** A task's name is a label in a narrow sidebar column, not a description. */
const TASK_NAME_MAX = 40;

const PARTY_TPL = `systems/${SYSTEM_ID}/templates/apps/dungeon-party-dialog.hbs`;

/** "A, B and C", in the client's language. */
const listNames = (list) => game.i18n.getListFormatter().format(list);

/** A party member as the table knows them. Every unlinked token of one actor carries that actor's
 *  name, so two hirelings would both be "Hireling"; the token's own name tells them apart. */
const nameOf = (actor) => actor.token?.name ?? actor.name;

/**
 * How far a token has moved this turn or round, from core's movement history, which the combat
 * clears at every turn start. Measured through the token's own path measurement rather than by adding the
 * waypoints' `cost`: a move made by a document update carries a cost of 0 (observed on 14.368),
 * while the measured distance is the one the ruler shows.
 * @param {TokenDocument|null} token
 * @returns {{moved: number, units: string}}
 */
function movedThisTurn(token) {
  const units = token?.parent?.grid?.units ?? "";
  const history = token?.movementHistory ?? [];
  if (history.length < 2) return { moved: 0, units };
  return { moved: Math.round(token.measureMovementPath(history).distance), units };
}

/**
 * Where a turn's movement sits against its two limits: within the move that costs nothing, past
 * it (the action spent moving), or past all an action can cover. An exploration's limits are
 * torchlight and three torchlights (`procedures.md` → The Basics), where moving quickly is one
 * of the four Dungeon Event triggers; a fight's are one move and two. `""` on a scene not
 * measured in feet, which cannot be compared with a distance the SRD gives in feet.
 * @param {{moved: number, units: string}} movement
 * @param {number} near  the free move, in feet
 * @param {number} far   the most a turn can cover, in feet
 * @returns {""|"within"|"beyond"|"over"}
 */
function paceOf({ moved, units }, near, far) {
  if (units !== "ft") return "";
  if (moved > far) return "over";
  return (moved > near) ? "beyond" : "within";
}

/**
 * What a row prints of its token's movement: the distance, its pace, the tooltip that says it,
 * and whether the viewer may take it back — whoever owns the token, the Warden on every row.
 * @param {Combatant} combatant
 * @param {number} near
 * @param {number} far
 * @param {{moved: string, beyond: string, over: string}} labels  the tooltip keys by pace
 */
function movementRow(combatant, near, far, labels) {
  const movement = movedThisTurn(combatant.token);
  const pace = paceOf(movement, near, far);
  return {
    ...movement,
    canRevert: !!combatant.token?.isOwner && (movement.moved > 0),
    pace,
    beyond: (pace === "beyond") || (pace === "over"),
    paceLabel: labels[pace] ?? labels.moved
  };
}

/**
 * The declaration dialog's two behaviours, bound when it renders. An idea starts the sentence
 * with its name and leaves the caret after it, so the player goes on in their own words; the
 * pressed idea is remembered in the form for the one that rolls (`panic`). A chosen task is let
 * go by clicking it again — every task starts unchosen, and choosing none is "not this turn".
 * @param {HTMLElement} root  the dialog's element
 */
function wireDeclaration(root) {
  const text = root.querySelector("textarea[name='declared']");
  const idea = root.querySelector("input[name='idea']");
  const ideas = root.querySelectorAll("button[data-idea]");
  for (const button of ideas) {
    button.addEventListener("click", () => {
      text.value = button.dataset.label;
      idea.value = button.dataset.idea;
      for (const other of ideas) other.setAttribute("aria-pressed", String(other === button));
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    });
  }
  // The chosen task is kept here, not read off the radio: by the time a click arrives the browser
  // has already checked it, from the pointer and from an arrow key alike.
  const tasks = [...root.querySelectorAll("input[name='task']")];
  let chosen = tasks.find((radio) => radio.checked) ?? null;
  for (const radio of tasks) {
    radio.addEventListener("click", () => {
      if (radio === chosen) radio.checked = false;
      chosen = radio.checked ? radio : null;
    });
  }
}

/**
 * The combat tracker, grouped by side.
 *
 * 2e's round is side-based (`core-rules.md` → Combat) and has no initiative, so the tracker shows
 * two headed blocks — the adventurers, then their opponents — instead of one list sorted by a
 * number. Each row carries a control its owner ticks once that combatant has acted, and the
 * heading of the side still owed actions is the one drawn in full ink.
 *
 * All three parts are the system's: the header drops core's initiative rolls, the tracker
 * regroups the rows by side, and the footer keeps only the round controls.
 */
export class CairnCombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID],
    actions: {
      createDungeon: CairnCombatTracker.#onCreateDungeon,
      rollDungeonEvent: CairnCombatTracker.#onRollDungeonEvent,
      chooseDungeonEvent: CairnCombatTracker.#onChooseDungeonEvent,
      toggleTrigger: CairnCombatTracker.#onToggleTrigger,
      declareDungeon: CairnCombatTracker.#onDeclareDungeon,
      addTask: CairnCombatTracker.#onAddTask,
      deleteTask: CairnCombatTracker.#onDeleteTask,
      markEffort: CairnCombatTracker.#onMarkEffort,
      startFight: CairnCombatTracker.#onStartFight,
      spendFatigue: CairnCombatTracker.#onSpendFatigue,
      spendRation: CairnCombatTracker.#onSpendRation,
      putOutLights: CairnCombatTracker.#onPutOutLights,
      toggleResolved: CairnCombatTracker.#onToggleResolved,
      revertMovement: CairnCombatTracker.#onRevertMovement,
      openRules: CairnCombatTracker.#onOpenRules,
      rollDexSave: CairnCombatTracker.#onRollDexSave,
      rollMorale: CairnCombatTracker.#onRollMorale
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: `systems/${SYSTEM_ID}/templates/apps/combat-tracker-header.hbs`
    },
    tracker: {
      template: `systems/${SYSTEM_ID}/templates/apps/combat-tracker.hbs`,
      scrollable: [""]
    },
    footer: {
      template: `systems/${SYSTEM_ID}/templates/apps/combat-tracker-footer.hbs`
    }
  };

  /**
   * @inheritDoc
   *
   * The header and footer say "turn" instead of "round" for a dungeon exploration, and each
   * encounter's number in the header says which kind it is. The header never cycles: every
   * encounter stays a tab (see the template).
   */
  async _prepareCombatContext(context, options) {
    await super._prepareCombatContext(context, options);
    context.isDungeon = !!this.viewed?.isDungeon;
    const combats = context.combats ?? [];
    for (const entry of combats) entry.isDungeon = !!game.combats.get(entry.id)?.isDungeon;
    context.css = combats.length ? "tabbed" : "";
  }

  /**
   * @inheritDoc
   *
   * A panicked combatant's portrait trembles and a deprived one withers, each beside the icon the
   * effects strip draws for it (maintainer's call, 2026-10-17): the motion is read at a glance down
   * the column, and the icons say every condition the row's tooltip names.
   */
  async _prepareTurnContext(combat, combatant, index) {
    const turn = await super._prepareTurnContext(combat, combatant, index);
    const has = (status) => !!combatant.actor?.appliedEffects.some((e) => e.statuses.has(status));
    turn.panicked = has(CONDITION.PANICKED);
    turn.deprived = has(CONDITION.DEPRIVED);
    return turn;
  }

  /**
   * @inheritDoc
   *
   * Core has already built one entry per combatant in `context.turns`, with the thumbnail, the
   * effect icons and the permission flags the row needs. Regroup those entries into the two sides
   * rather than rebuilding them, then sort each side by name — with no initiative, the name is
   * the only ordering 2e offers, and it is at least the one the players can predict.
   */
  async _prepareTrackerContext(context, options) {
    await super._prepareTrackerContext(context, options);
    const combat = this.viewed;
    if (!combat) return;
    if (combat.isDungeon) {
      context.dungeon = this.#dungeonContext(combat, context.turns ?? []);
      return;
    }

    const sides = { adventurers: [], opponents: [] };
    for (const turn of context.turns ?? []) {
      const combatant = combat.combatants.get(turn.id);
      if (!combatant) continue;
      turn.resolved = combatant.resolved;
      turn.dexSave = combatant.dexSave;
      turn.isAdventurer = combatant.isAdventurer;
      Object.assign(turn, movementRow(combatant, FIGHT_MOVE_FT, 2 * FIGHT_MOVE_FT, FIGHT_PACE));
      // Core marks the combatant at `combat.turn` active; there is no active combatant here.
      turn.css = turn.css.replace("active", "").trim();
      sides[combatant.isAdventurer ? "adventurers" : "opponents"].push(turn);
    }
    for (const rows of Object.values(sides)) rows.sort((a, b) => a.name.localeCompare(b.name));

    context.sides = sides;
    context.activeSide = combat.activeSide;
    // The DEX save belongs to the first round of the COMBAT, not to a combatant's first round:
    // somebody who joins in round three never owed one (`core-rules.md`).
    context.isFirstRound = combat.round === 1;
  }

  /**
   * A dungeon exploration in the order of its cycle (`procedures.md` → Dungeon Exploration
   * Cycle): the party's rows and the ongoing work, then the four triggers and the event. Built on
   * core's per-combatant entries, like the fight's sides.
   * @param {CairnCombat} combat
   * @param {object[]} turns  core's entries, one per visible combatant
   */
  #dungeonContext(combat, turns) {
    const { tasks, triggers } = combat.system;
    const taskName = new Map(tasks.map((t) => [t.id, t.name]));
    const rows = [];
    for (const turn of turns) {
      const combatant = combat.combatants.get(turn.id);
      if (!combatant) continue;
      const declared = combatant.getFlag(SYSTEM_ID, COMBAT_FLAGS.DECLARED) ?? "";
      const taskId = combatant.getFlag(SYSTEM_ID, COMBAT_FLAGS.TASK) ?? "";
      rows.push({
        ...turn,
        css: turn.css.replace("active", "").trim(),
        resolved: combatant.resolved,
        declared,
        taskId,
        task: taskName.get(taskId) ?? "",
        // A player is asked outright; the Warden owns every row, and a button on each of them
        // would bury the party's words under the Warden's prompts.
        prompt: combat.started && turn.isOwner && !game.user.isGM && !declared,
        ...movementRow(combatant, TORCHLIGHT_FT, HURRY_FT, DUNGEON_PACE)
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const lit = DUNGEON_TRIGGERS.filter((key) => triggers[key]);
    return {
      rows,
      started: combat.started,
      warden: game.user.isGM,
      tasks: tasks.map((t) => ({
        ...t,
        marks: Array.from({ length: t.effort }, (_, index) => ({ index, n: index + 1, done: index < t.spent })),
        // The marks are the count; the words are for a screen reader only.
        progress: game.i18n.localize("CAIRN.Dungeon.TaskProgress", { spent: t.spent, effort: t.effort }),
        helpers: listNames(rows.filter((r) => r.taskId === t.id).map((r) => r.name))
      })),
      triggers: DUNGEON_TRIGGERS.map((key) => ({
        key,
        lit: triggers[key],
        word: game.i18n.localize(`CAIRN.Dungeon.TriggerWord.${key}`),
        tip: game.i18n.localize(`CAIRN.Dungeon.Trigger.${key}`)
      })),
      anyLit: lit.length > 0
    };
  }

  /**
   * @inheritDoc
   *
   * FIXME: works around a core defect at 14.368 — remove when core guards it itself.
   * `CombatTracker#_onRender` sets `let data = {}`, reassigns it from
   * `renderData.find(d => d._id === this.viewed?.id)` — which is `undefined` whenever the combat
   * that updated is not the one on screen, and deleting an encounter while another is active is
   * enough — and then evaluates `("turn" in data)`, which throws on `undefined`. It surfaced as
   * a TypeError out of this class's own stack, twice, in a live client.
   *
   * Handing core a `renderData` it will not treat as an array makes it keep its own `{}`
   * fallback and skip the block, which is both the minimal fix and a no-op here: the block
   * scrolls `.combatant.active` into view, and a side-based tracker marks no combatant active.
   */
  async _onRender(context, options) {
    const { renderData } = options;
    if (Array.isArray(renderData) && !renderData.some((d) => d._id === this.viewed?.id)) {
      options = { ...options, renderData: undefined };
    }
    await super._onRender(context, options);
  }

  /**
   * Light or put out one of the four Dungeon Event triggers. The Warden's alone, and only a mark:
   * nothing rolls because one is lit, and the roll stays a click of its own.
   */
  static async #onToggleTrigger(event, target) {
    const combat = this.viewed;
    const { key } = target.dataset;
    if (!game.user.isGM || !combat?.isDungeon || !combat.started || !DUNGEON_TRIGGERS.includes(key)) return;
    await combat.update({ [`system.triggers.${key}`]: !combat.system.triggers[key] });
  }

  /**
   * A player's declaration: what their character does this turn, in their own words, and the
   * ongoing work they lend a hand to, if any. Both land on the Combatant in one write — the flags
   * its owner may write without the GM.
   *
   * The actions are offered as ideas: picking one starts the sentence with its name, and the
   * field stays free text. Shaking off panic is the one idea with a roll of its own: "A
   * _panicked_ character must make a **WIL** **save** to overcome their condition as an
   * **action** on their **turn**" (`procedures.md` → Panic), rolled once the declaration is made.
   */
  static async #onDeclareDungeon(event, target) {
    const combat = this.viewed;
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = combat?.combatants.get(combatantId);
    // No turn before Begin Exploring, so nothing to declare for.
    if (!combat?.isDungeon || !combat.started || !combatant?.isOwner) return;
    const keys = combatant.actor?.system.panicked ? [...DUNGEON_ACTIONS, "panic"] : DUNGEON_ACTIONS;
    const chosen = combatant.getFlag(SYSTEM_ID, COMBAT_FLAGS.TASK) ?? "";
    // Handed over as a bare `<div>` rather than a string: DialogV2 runs a string through
    // `cleanHTML`, which strips the field's `maxlength` and `placeholder` (observed on 14.369).
    const content = document.createElement("div");
    content.innerHTML = await foundry.applications.handlebars.renderTemplate(DECLARE_TPL, {
      declared: combatant.getFlag(SYSTEM_ID, COMBAT_FLAGS.DECLARED) ?? "",
      maxLength: DECLARATION_MAX,
      ideas: keys.map((key) => ({
        key,
        label: game.i18n.localize(`CAIRN.Dungeon.Action.${key}`),
        rule: game.i18n.localize(`CAIRN.Dungeon.ActionRule.${key}`),
        risky: RISKY_ACTIONS.has(key)
      })),
      tasks: combat.system.tasks.map((t) => {
        const helpers = combat.combatants.filter((c) => (c.id !== combatant.id)
          && (c.getFlag(SYSTEM_ID, COMBAT_FLAGS.TASK) === t.id)).map((c) => c.name);
        return {
          id: t.id,
          name: t.name,
          chosen: t.id === chosen,
          info: helpers.length
            ? game.i18n.localize("CAIRN.Dungeon.TaskInfoHelped", { spent: t.spent, effort: t.effort, names: listNames(helpers) })
            : game.i18n.localize("CAIRN.Dungeon.TaskProgress", { spent: t.spent, effort: t.effort })
        };
      })
    });
    const result = await foundry.applications.api.DialogV2.input({
      classes: [SYSTEM_ID],
      window: { title: game.i18n.localize("CAIRN.Dungeon.DeclareTitle", { name: combatant.name }) },
      // Wide and short: the eight ideas sit four to a row, so the window fits a laptop's height.
      position: { width: 760 },
      content,
      render: (_event, dialog) => wireDeclaration(dialog.element),
      ok: { label: game.i18n.localize("CAIRN.Dungeon.Declare") },
      rejectClose: false
    });
    if (!result) return;
    await combatant.update({
      [`flags.${SYSTEM_ID}`]: {
        // `maxlength` is the field's; this is the boundary's, for a value that never went through it.
        [COMBAT_FLAGS.DECLARED]: String(result.declared ?? "").trim().slice(0, DECLARATION_MAX),
        [COMBAT_FLAGS.TASK]: result.task || ""
      }
    });
    if ((result.idea === "panic") && combatant.actor && await rollSave(combatant.actor, "WIL")) {
      await combatant.actor.toggleStatusEffect(CONDITION.PANICKED, { active: false });
    }
  }

  /**
   * Ongoing work: something that takes several turns of effort, which several characters can
   * share in one turn. The Warden names it and says how many turns it takes.
   */
  static async #onAddTask() {
    const combat = this.viewed;
    if (!game.user.isGM || !combat?.isDungeon) return;
    // A bare `<div>`, not a string, so `cleanHTML` leaves the name's `maxlength` in place.
    const content = document.createElement("div");
    content.innerHTML = await foundry.applications.handlebars.renderTemplate(TASK_TPL, {
      maxLength: TASK_NAME_MAX,
      efforts: Array.from({ length: MAX_EFFORT }, (_, i) => i + 1)
    });
    const result = await foundry.applications.api.DialogV2.input({
      classes: [SYSTEM_ID],
      window: { title: game.i18n.localize("CAIRN.Dungeon.AddTask") },
      // Wide enough for the twelve counts on one line.
      position: { width: 460 },
      content,
      ok: { label: game.i18n.localize("CAIRN.Dungeon.AddTask") },
      rejectClose: false
    });
    const name = String(result?.name ?? "").trim().slice(0, TASK_NAME_MAX);
    if (!name) return;
    const effort = Math.clamp(Math.round(Number(result.effort) || 1), 1, MAX_EFFORT);
    await combat.update({
      "system.tasks": [...combat.system.tasks, { id: foundry.utils.randomID(), name, effort, spent: 0 }]
    });
  }

  /** Strike a task off the list, done or abandoned. */
  static async #onDeleteTask(event, target) {
    const combat = this.viewed;
    const { taskId } = target.closest("[data-task-id]")?.dataset ?? {};
    if (!game.user.isGM || !combat?.isDungeon || !taskId) return;
    await combat.update({ "system.tasks": combat.system.tasks.filter((t) => t.id !== taskId) });
  }

  /**
   * Fill in a task's turns of effort up to the mark clicked, or empty it back to there when it
   * is already filled — so a mark is set or taken back by the same click.
   */
  static async #onMarkEffort(event, target) {
    const combat = this.viewed;
    const { taskId } = target.closest("[data-task-id]")?.dataset ?? {};
    const index = Number(target.dataset.index);
    if (!game.user.isGM || !combat?.isDungeon || !Number.isInteger(index)) return;
    const tasks = combat.system.tasks.map((t) => (t.id !== taskId) ? t
      : { ...t, spent: (index < t.spent) ? index : index + 1 });
    await combat.update({ "system.tasks": tasks });
  }

  /**
   * Draw a Dungeon Event onto the Warden's chat. The Warden decides when — the SRD's four
   * triggers are only reminders — so this is only ever a click.
   */
  static async #onRollDungeonEvent() {
    if (!game.user.isGM || !this.viewed?.isDungeon) return;
    await drawDungeonEvent();
  }

  /** The Warden picks the event the fiction calls for, posted as a rolled one is. */
  static async #onChooseDungeonEvent() {
    if (!game.user.isGM || !this.viewed?.isDungeon) return;
    await chooseDungeonEvent();
  }

  /**
   * The costs the Dungeon Events table charges, on the Warden's button and never on a draw:
   * Exhaustion's Fatigue and ration ("The party must rest …, add a Fatigue, or consume a ration";
   * resting is the sheet's own Rest) and Loss's light ("Torches are blown out"). Always there, for
   * a cost the fiction charges on any turn, and each asks who pays — the whole party by default,
   * and the Warden lets off whoever the story does.
   */
  static async #onSpendFatigue() {
    await CairnCombatTracker.#chargeParty(this.viewed, "CAIRN.Dungeon.WhoFatigue",
      async (actor) => (await actor.addFatigue()).length > 0,
      "CAIRN.Dungeon.FatigueAdded", "CAIRN.Dungeon.FatigueNoRoom");
  }

  static async #onSpendRation() {
    await CairnCombatTracker.#chargeParty(this.viewed, "CAIRN.Dungeon.WhoRation", eatFood,
      "CAIRN.Dungeon.RationEaten", "CAIRN.Dungeon.RationNone");
  }

  /**
   * Put out the lights the Warden picks, from those burning in the party, and say whose on the
   * card Fatigue and ration post — the module puts a light out without a word in chat.
   */
  static async #onPutOutLights() {
    const combat = this.viewed;
    if (!game.user.isGM || !combat?.isDungeon) return;
    const burning = await burningLights(CairnCombatTracker.#party(combat));
    if (!burning.length) {
      ui.notifications.info(game.i18n.localize("CAIRN.Dungeon.NoLights"));
      return;
    }
    const chosen = await CairnCombatTracker.#choosePayers("CAIRN.Dungeon.WhoLight",
      burning.map(({ actor, item }) => ({ actor, note: item })));
    if (!chosen.length) return;
    for (const actor of chosen) await putOutLight(actor);
    await postJourneyCard({
      flavor: game.i18n.localize("CAIRN.Dungeon.Events"),
      lines: [game.i18n.localize("CAIRN.Dungeon.LightsOut", { names: listNames(chosen.map(nameOf)) })]
    });
  }

  /** The party's characters, once each: the adventurers' rows that have an actor. */
  static #party(combat) {
    return [...new Set(combat.combatants.filter((c) => c.isAdventurer && c.actor).map((c) => c.actor))];
  }

  /**
   * Ask which of these pay, every one of them on at first. Closing the window pays nobody.
   * @param {string} titleKey
   * @param {{actor: Actor, note?: string}[]} members
   * @returns {Promise<Actor[]>}
   */
  static async #choosePayers(titleKey, members) {
    const content = document.createElement("div");
    content.innerHTML = await foundry.applications.handlebars.renderTemplate(PARTY_TPL, {
      // Keyed by place in the list, not by actor id: two unlinked tokens of one actor share the id.
      members: members.map(({ actor, note }, index) => ({ id: String(index), name: nameOf(actor), note: note ?? "" }))
    });
    const result = await foundry.applications.api.DialogV2.input({
      classes: [SYSTEM_ID],
      window: { title: game.i18n.localize(titleKey) },
      content,
      rejectClose: false
    });
    return result ? members.filter((_, index) => result[index]).map(({ actor }) => actor) : [];
  }

  /**
   * Charge whoever the Warden picks once, and post one card that says who paid and who could
   * not — a body with no free slot refuses a Fatigue (`documents/item.js`), a pack with no Rations
   * has none to eat, and what happens then is the table's call.
   * @param {CairnCombat} combat
   * @param {string} titleKey
   * @param {(actor: Actor) => Promise<boolean>} charge  resolves whether the actor paid
   */
  static async #chargeParty(combat, titleKey, charge, paidKey, unpaidKey) {
    if (!game.user.isGM || !combat?.isDungeon) return;
    const chosen = await CairnCombatTracker.#choosePayers(titleKey,
      CairnCombatTracker.#party(combat).map((actor) => ({ actor })));
    if (!chosen.length) return;
    const paid = [];
    const unpaid = [];
    for (const actor of chosen) ((await charge(actor)) ? paid : unpaid).push(nameOf(actor));
    const lines = [];
    if (paid.length) lines.push(game.i18n.localize(paidKey, { names: listNames(paid) }));
    if (unpaid.length) lines.push(game.i18n.localize(unpaidKey, { names: listNames(unpaid) }));
    await postJourneyCard({ flavor: game.i18n.localize("CAIRN.Dungeon.Events"), lines });
  }

  /**
   * A fight breaks out. It is an ordinary side-based combat — sides, the first-round DEX save,
   * Morale — already holding the exploration's combatants, made the active one so its tokens
   * record their movement against it. The Warden adds the monsters. The exploration is left as it
   * is, and comes back when the fight is deleted (`CairnCombat#_onDelete`), which is why this is
   * a second combat and not the exploration converted in place: a fight starts at round one, and
   * the exploration would lose its turn count, its declarations and its pending event.
   */
  static async #onStartFight() {
    const dungeon = this.viewed;
    if (!dungeon?.isDungeon) return;
    const fight = await Combat.implementation.create({
      scene: dungeon.scene?.id ?? null,
      flags: { [SYSTEM_ID]: { [FIGHT_FLAGS.ORIGIN]: dungeon.id } },
      combatants: dungeon.combatants.map((c) => ({
        tokenId: c.tokenId, sceneId: c.sceneId, actorId: c.actorId, hidden: c.hidden
      }))
    });
    await fight.activate({ render: false });
  }

  /**
   * Begin a dungeon exploration: a `dungeon` Combat on the viewed scene, made the active one —
   * the two calls core's own "+" makes (`CombatTracker#_onCombatCreate`). Active matters: a token
   * records its movement only as a combatant of `game.combat`.
   */
  static async #onCreateDungeon() {
    const combat = await Combat.implementation.create({ type: "dungeon", scene: canvas.scene?.id ?? null });
    await combat.activate({ render: false });
  }

  /**
   * Tick or untick a combatant's action for this round. The write lands on the Combatant, whose
   * owner may update its flags without the GM (`Combatant` permissions, v14) — which is what lets
   * a player mark their own row in a fight with no socket involved.
   */
  static async #onToggleResolved(event, target) {
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = this.viewed?.combatants.get(combatantId);
    if (!combatant) return;
    // In an exploration the mark is the Warden's: everyone acts at once, and "narrated" only
    // says whose action the Warden has already resolved at the table.
    if (this.viewed.isDungeon && (!game.user.isGM || !this.viewed.started)) return;
    await combatant.setFlag(SYSTEM_ID, COMBAT_FLAGS.RESOLVED, !combatant.resolved);
  }

  /** The header's help mark opens the Rules Summary, whose Dungeon section is the full text. */
  static #onOpenRules() {
    CairnRulesSummary.open();
  }

  /**
   * Take a token back to where it stood when the dungeon turn or the fight's round began. With no
   * movement id, core's `revertRecordedMovement` displaces the token to the first recorded waypoint
   * and empties the history, and the history only ever holds this turn's moves —
   * `CairnCombat#nextRound` clears it.
   * A player may undo their own token with no GM in the loop (observed on 14.368); the button is
   * drawn only for an owner.
   */
  static async #onRevertMovement(event, target) {
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    await this.viewed?.combatants.get(combatantId)?.token?.revertRecordedMovement();
  }

  /**
   * The first-round DEX save: "each PC must make a DEX save in order to act" (`core-rules.md`).
   *
   * Offered to everything on the adventurers' side, hirelings included, and never forced. The
   * rule's letter says "each PC", but circumstances that negate the requirement are the Warden's
   * to judge, so the control is a prompt the table can ignore rather than a gate.
   *
   * `rollFirstRoundSave` posts the card itself, and the result is written to the combatant the
   * roller already owns — which is why the player rolls their own die with no GM in the loop.
   *
   * A panicked character "does not act in the first round of combat" (`procedures.md` → Panic),
   * so the roll asks first rather than refusing: the Warden may still allow it, and the card then
   * says it was rolled through Panic.
   *
   * A failure also ticks the action mark: "PCs that fail their save lose their turn" — the
   * round has nothing left for them to do, and the side's heading should stop waiting on them.
   * Both flags land in one update so the row never shows a failure without the tick.
   */
  static async #onRollDexSave(event, target) {
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = this.viewed?.combatants.get(combatantId);
    if (!combatant?.actor) return;
    const panicked = !!combatant.actor.system.panicked;
    if (panicked) {
      const proceed = await foundry.applications.api.DialogV2.confirm({
        classes: [SYSTEM_ID],
        window: { title: "CAIRN.Combat.PanicTitle" },
        // A name is the player's own text and DialogV2 parses `content` as HTML.
        content: `<p>${game.i18n.localize("CAIRN.Combat.PanicConfirm", { name: foundry.utils.escapeHTML(combatant.name) })}</p>`,
        rejectClose: false,
        modal: true
      });
      if (!proceed) return;
    }
    const passed = await rollFirstRoundSave(combatant.actor, { panicked });
    const flags = { [COMBAT_FLAGS.DEX_SAVE]: passed ? "passed" : "failed" };
    if (!passed) flags[COMBAT_FLAGS.RESOLVED] = true;
    await combatant.update({ [`flags.${SYSTEM_ID}`]: flags });
  }

  /**
   * Roll Morale for one opponent, because the Warden asked for it on that row.
   *
   * The button is on every opponent at every moment, and it is not tied to the reminder
   * (`CairnCombat#remindMorale`): the bestiary has monsters that save on their leader's WIL and
   * monsters that pass automatically while a commander is present, both prose in a stat block, and
   * a Warden may call for Morale on a reason no count sees. The Warden decides who saves; this
   * only rolls what `rollMorale` already implements.
   */
  static async #onRollMorale(event, target) {
    const combat = this.viewed;
    const { combatantId } = target.closest("[data-combatant-id]")?.dataset ?? {};
    const combatant = combat?.combatants.get(combatantId);
    if (!combatant?.actor) return;

    const passed = await rollMorale(combatant.actor);
    if (!passed) await combatant.actor.toggleStatusEffect(CONDITION.FLEEING, { active: true });
  }
}

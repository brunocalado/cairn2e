/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Encounter tables and the Warden-only "Add to scene" button.
 *
 * Any RollTable draw card whose drawn rows parse as an encounter grows an **Add to scene** control
 * for the Warden. Clicking it rolls the quantity for real (`module/rolls.js#rollEncounterCount`),
 * imports the referenced bestiary Actor **once** into an "Encounters" folder, and drops that many
 * unlinked `disposition: NEUTRAL` tokens clustered at the view centre — one per grid cell.
 *
 * The button automates **logistics only**. Nothing here reads a monster's stats or rolls its
 * attacks: meeting is not fighting (`srd-2e/wardens-guide/wilderness-exploration.md`) — roll
 * `Reactions` to learn how the meeting goes.
 *
 * ## The row convention
 *
 * A drawn row qualifies when its text has **a leading count** (`1d6`, `2d4`, or a bare integer, at
 * the very start) **and a monster reference** — either a `type: "document"` result pointing at a
 * bestiary Actor, or a `@UUID[...]` content link to an Actor in the row text. A `type: "document"`
 * result is the Actor itself, so its leading count is optional and defaults to one. The magic
 * phrase **`random NPC`** runs `module/npc-generator.js#generateNpcs()` instead — a fresh person
 * each time, count optional, default one.
 *
 * Parsing works off the **rendered card HTML** (`.table-draw`), not the RollTable document: a
 * compendium table drawn straight from its sheet never enters `game.tables`, and the card already
 * carries every row's text and its enriched content links.
 */

import { SYSTEM_ID } from "./constants.js";
import { generateNpcs } from "./npc-generator.js";
import { rollEncounterCount } from "./rolls.js";

const ENCOUNTER_CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/encounter-card.hbs`;

/** Message flag: the button on this card has been used — it will not fire twice. */
const ADDED_FLAG = "encounterAdded";
/** Actor flag: the source UUID this Actor was imported from — the key for "import once, reuse". */
const SOURCE_FLAG = "encounterSource";
/** Folder flag: marks the "Encounters" Actor folder, found by this and not by its (localized) name. */
const FOLDER_FLAG = "encountersFolder";

/**
 * The magic phrase — generate a person, don't import a creature — in the table's own language: it
 * is `CAIRN.Encounter.RandomNpc`, the same string a translation module translates alongside the
 * tables, so a Warden writing "NPC aleatório" in a translated world is understood. Read at parse
 * time, never at import: the language is not loaded yet when this module is. Any run of spaces
 * in the text matches a space in the phrase, and case does not matter.
 *
 * The word edges are Unicode letters, not `\b`: `\b` knows only ASCII, so a phrase that begins or
 * ends on an accented letter (a French "PNJ créé") would never sit on a boundary. For an English
 * phrase the two are the same test.
 */
function randomNpcPattern() {
  const words = game.i18n.localize("CAIRN.Encounter.RandomNpc").trim().split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words.join("\\s+")}(?![\\p{L}\\p{N}_])`, "iu");
}

/** A leading count at the very start of the row text — dice (`1d6`, `2d4`) or a bare integer. */
const LEADING_COUNT = /^\s*(\d+d\d+|\d+)\b/i;

/* -------------------------------------------- */
/*  Row parsing                                 */
/* -------------------------------------------- */

/**
 * Parse every drawn row on a RollTable card into an encounter descriptor, dropping the rows that
 * do not qualify.
 * @param {HTMLElement} html  the chat message's rendered root
 * @returns {Array<{ kind: "monster"|"npc", countFormula: string, uuid?: string, label: string }>}
 */
export function parseEncounterCard(html) {
  const rows = [];
  const randomNpc = randomNpcPattern();
  for (const li of html.querySelectorAll(".table-draw .table-results li[data-result-id]")) {
    const row = parseRow(li, randomNpc);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * The same rows, taken from the `TableResult` documents a draw hands back rather than from a
 * rendered card. This is what the journey window needs: it draws with `displayChat: false`
 * (`rolls.js#drawWildernessEncounter`) and never posts one, so there is no HTML to walk.
 *
 * A row qualifies on the same two things as on the card path — a leading count and an Actor
 * reference — but both are read from different places. A v14 `TableResult` carries `type`,
 * `name`, `description` (stored HTML) and `documentUuid`
 * (`common/documents/table-result.mjs`), so a `type: "document"` result IS the Actor and a text
 * row carries its reference as an UNENRICHED `@UUID[...]` in the description, where the card
 * path would have read core's enriched `<a data-uuid>`.
 * @param {TableResult[]} results
 * @returns {Array<{ kind: "monster"|"npc", countFormula: string, uuid?: string, label: string }>}
 */
export function parseEncounterResults(results) {
  const rows = [];
  const randomNpc = randomNpcPattern();
  for (const result of results ?? []) {
    const row = parseResult(result, randomNpc);
    if (row) rows.push(row);
  }
  return rows;
}

/** An unenriched content link, which is the form a stored description holds it in. */
const RAW_UUID = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/;

/**
 * @param {TableResult} result
 * @param {RegExp} randomNpc  {@link randomNpcPattern}, built once per parse
 * @returns {{ kind: "monster"|"npc", countFormula: string, uuid?: string, label: string } | null}
 */
function parseResult(result, randomNpc) {
  // The description is stored HTML (`<p>1d6 Wolves</p>`), and `LEADING_COUNT` anchors at the very
  // start — so the tags have to go first or every row fails its own count.
  const text = String(result.description ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const countFormula = LEADING_COUNT.exec(text)?.[1] ?? null;

  if (randomNpc.test(text)) {
    return { kind: "npc", countFormula: countFormula ?? "1", label: game.i18n.localize("CAIRN.Encounter.RandomNpc") };
  }

  const direct = result.documentUuid ?? null;
  const link = direct ? null : RAW_UUID.exec(text);
  const uuid = direct ?? link?.[1] ?? null;
  if (!uuid || foundry.utils.parseUuid(uuid)?.type !== "Actor") return null;
  // Count first only, as on the card path: prose that merely mentions a monster gets no button.
  // A document result needs none — it is the Actor, and one is the default.
  if (!countFormula && !direct) return null;

  const label = String(direct ? result.name : (link?.[2] ?? "")).trim()
    || game.i18n.localize("CAIRN.Encounter.Creature");
  return { kind: "monster", countFormula: countFormula ?? "1", uuid, label };
}

/**
 * @param {HTMLElement} li  one `<li data-result-id>` from the drawn card
 * @param {RegExp} randomNpc  {@link randomNpcPattern}, built once per parse
 * @returns {{ kind: "monster"|"npc", countFormula: string, uuid?: string, label: string } | null}
 */
function parseRow(li, randomNpc) {
  const descEl = li.querySelector(".description");
  const text = (descEl?.textContent ?? li.textContent ?? "").trim();
  const countFormula = LEADING_COUNT.exec(text)?.[1] ?? null;

  if (randomNpc.test(text)) {
    return { kind: "npc", countFormula: countFormula ?? "1", label: game.i18n.localize("CAIRN.Encounter.RandomNpc") };
  }

  // A `type: "document"` result renders its link beside the row's description (the row *is* the
  // Actor); a text row's `@UUID[...]` link enriches to an anchor inside `.description`. The first
  // link is the monster reference — a trailing "... or [Gnomes]" stays the Warden's to exercise.
  //
  // "Beside" means a child of whatever holds core's rendered `details`. In core's own draw template
  // that was the <li>; this system's (`templates/chat/table-draw.hbs`) wraps them in
  // `.cairn-table-text` so the stamp can sit beside a stacked name and description. Falling back to
  // the <li> keeps this readable against either.
  const details = li.querySelector(".cairn-table-text") ?? li;
  const directLink = Array.from(details.children).find((el) => el.matches?.("a[data-uuid]")) ?? null;
  const link = directLink ?? li.querySelector(".description a[data-uuid]");
  const uuid = link?.dataset.uuid ?? null;
  if (!uuid || foundry.utils.parseUuid(uuid)?.type !== "Actor") return null;

  // Count first only: prose that merely mentions a monster ("Wolves guard the [Ogre]") gets no
  // button. A document-type result needs no leading count — it is the Actor, default to one.
  if (!countFormula && !directLink) return null;

  const label = (link.textContent ?? "").trim() || game.i18n.localize("CAIRN.Encounter.Creature");
  return { kind: "monster", countFormula: countFormula ?? "1", uuid, label };
}

/* -------------------------------------------- */
/*  Scene placement                             */
/* -------------------------------------------- */

/**
 * Roll each row's quantity, resolve its Actor(s), and drop the tokens on the scene. Sets the
 * {@link ADDED_FLAG} so the card cannot fire twice. No open scene → a polite refusal, nothing
 * rolled or written.
 *
 * `message` is null when the call did not come from a card — the journey window places from its
 * own Events block and remembers what it placed in the journey, not on a message. `origin` is
 * where the tokens go; without one they cluster on whatever the Warden is looking at, which is
 * all a chat card can know.
 * @param {Array<object>} rows  from {@link parseEncounterCard} or {@link parseEncounterResults}
 * @param {ChatMessage|null} message
 * @param {{origin?: {x: number, y: number}|null}} [options]
 * @returns {Promise<boolean>}  whether anything was placed
 */
export async function addEncounterToScene(rows, message, { origin = null } = {}) {
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Encounter.NoScene"));
    return false;
  }

  const folder = await ensureEncountersFolder();
  const actors = [];
  const summary = [];

  for (const row of rows) {
    const count = await rollEncounterCount(row.countFormula, row.label);
    if (count < 1) continue;

    if (row.kind === "npc") {
      // A fresh person each time, from the NPC generator, filed in the Encounters folder — all
      // of them in one create.
      actors.push(...await generateNpcs(count, { folder: folder.id }));
    } else {
      const actor = await importEncounterActor(row.uuid, folder);
      for (let i = 0; i < count && actor; i++) actors.push(actor);
    }
    summary.push(`${count} × ${row.label}`);
  }

  if (message) await message.setFlag(SYSTEM_ID, ADDED_FLAG, true);
  if (actors.length) await placeTokens(scene, actors, origin ?? viewCentre());
  if (summary.length) ui.notifications.info(game.i18n.localize("CAIRN.Encounter.Placed", { summary: summary.join(", ") }));
  return actors.length > 0;
}

/** Find the "Encounters" Actor folder by its {@link FOLDER_FLAG}, creating it on first use. */
async function ensureEncountersFolder() {
  const existing = game.folders.find((f) => f.type === "Actor" && f.getFlag(SYSTEM_ID, FOLDER_FLAG));
  if (existing) return existing;
  const FolderClass = foundry.utils.getDocumentClass("Folder");
  return FolderClass.create({
    name: game.i18n.localize("CAIRN.Encounter.FolderName"),
    type: "Actor",
    flags: { [SYSTEM_ID]: { [FOLDER_FLAG]: true } }
  });
}

/**
 * Import the referenced Actor **once**. A later encounter with the same source reuses that Actor —
 * N tokens, never N Actors.
 * @param {string} uuid
 * @param {Folder} folder
 * @returns {Promise<Actor|null>}
 */
async function importEncounterActor(uuid, folder) {
  const existing = game.actors.find(
    (a) => a.folder?.id === folder.id && a.getFlag(SYSTEM_ID, SOURCE_FLAG) === uuid
  );
  if (existing) return existing;

  const source = await fromUuid(uuid);
  if (!source) {
    ui.notifications.warn(game.i18n.localize("CAIRN.Encounter.NoActor"));
    return null;
  }

  const data = source.toObject();
  delete data._id;
  data.folder = folder.id;
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, { [SYSTEM_ID]: { [SOURCE_FLAG]: uuid } });
  // Meeting is not fighting: the imported creature's tokens are neutral and unlinked whatever the
  // bestiary entry's own disposition says.
  data.prototypeToken = foundry.utils.mergeObject(data.prototypeToken ?? {}, {
    disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
    actorLink: false
  });
  return foundry.utils.getDocumentClass("Actor").create(data);
}

/**
 * Create one NEUTRAL, unlinked token per Actor, clustered around `centre`, one per grid cell.
 * @param {Scene} scene
 * @param {Actor[]} actors
 * @param {{x: number, y: number}} centre
 */
async function placeTokens(scene, actors, centre) {
  const positions = clusterPositions(centre, actors.length);
  const tokenData = [];
  for (let i = 0; i < actors.length; i++) {
    const td = await actors[i].getTokenDocument({
      x: positions[i].x,
      y: positions[i].y,
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      actorLink: false
    });
    tokenData.push(td.toObject());
  }
  await scene.createEmbeddedDocuments("Token", tokenData);
}

/**
 * Put the Warden's next canvas click where the tokens go, and resolve to that point in scene
 * coordinates — or to `null` if they pressed Escape.
 *
 * There is no crosshair or point-picker in v14: `foundry.canvas.interaction` exports the mouse
 * manager, the render flags, the pings and the rulers, and nothing that picks a point. What the
 * core source does give (checked against 14.367) is all this needs — `canvas.stage` is the
 * interactive root (`eventMode: "static"`, and core hangs its own pointer listeners there), it
 * speaks PIXI v8 federated events so the name is `pointerdown` and never `mousedown`, and
 * `event.getLocalPosition(canvas.stage)` is core's own conversion to scene coordinates (it is
 * what `NotesLayer` uses to place a note under the pointer).
 *
 * Everything else here is bookkeeping: a cancelled pick must leave no listener on the stage, and
 * the guard makes the two exits idempotent so the key and the click cannot both resolve.
 * @returns {Promise<{x: number, y: number}|null>}
 */
export function pickScenePoint() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (point) => {
      if (done) return;
      done = true;
      canvas.stage.off("pointerdown", onClick);
      window.removeEventListener("keydown", onKey, true);
      resolve(point);
    };
    const onClick = (event) => {
      const p = event.getLocalPosition(canvas.stage);
      finish({ x: p.x, y: p.y });
    };
    // Capture phase: Escape is a busy key in Foundry, and this has to see it first to cancel.
    const onKey = (event) => { if (event.key === "Escape") finish(null); };
    canvas.stage.on("pointerdown", onClick);
    window.addEventListener("keydown", onKey, true);
    ui.notifications.info(game.i18n.localize("CAIRN.Encounter.PickPoint"));
  });
}

/** The point the Warden is currently looking at, in scene coordinates. */
function viewCentre() {
  const pivot = canvas?.stage?.pivot;
  if (pivot && Number.isFinite(pivot.x) && Number.isFinite(pivot.y)) return { x: pivot.x, y: pivot.y };
  const r = canvas?.dimensions?.sceneRect ?? canvas?.dimensions?.rect;
  return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { x: 0, y: 0 };
}

/** Top-left grid points for `count` tokens in a roughly square block centred on `centre`. */
function clusterPositions(centre, count) {
  const grid = canvas.grid;
  const size = grid.size;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const out = [];
  for (let i = 0; i < count; i++) {
    const x = centre.x + ((i % cols) - (cols - 1) / 2) * size;
    const y = centre.y + (Math.floor(i / cols) - (rows - 1) / 2) * size;
    out.push(grid.getTopLeftPoint({ x, y }));
  }
  return out;
}

/* -------------------------------------------- */
/*  Chat-card injection                         */
/* -------------------------------------------- */

/**
 * Grow the "Add to scene" control on an encounter draw card. GM-only — players see a plain card.
 * Called from the `renderChatMessageHTML` hook in `module/cairn2e.js`.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export async function renderEncounterButton(message, html) {
  if (!game.user.isGM) return;
  const drawEl = html.querySelector(".table-draw");
  if (!drawEl || drawEl.querySelector(".cairn-table-foot")) return;

  const rows = parseEncounterCard(html);
  if (!rows.length) return;

  const added = !!message.getFlag(SYSTEM_ID, ADDED_FLAG);
  const markup = await foundry.applications.handlebars.renderTemplate(ENCOUNTER_CARD_TPL, {
    added,
    rows: rows.map((r) => ({ count: r.countFormula, label: r.label }))
  });
  const node = document.createRange().createContextualFragment(markup).firstElementChild;
  drawEl.appendChild(node);
  if (added) return;

  const btn = node.querySelector(".cairn-encounter-add");
  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    const placed = await addEncounterToScene(rows, message);
    // On success the message flag update re-renders the card in its "Added" state; reflect it now
    // too in case that render lags. On failure (no open scene) the button stays live.
    if (placed) btn.textContent = game.i18n.localize("CAIRN.Encounter.Added");
    else btn.disabled = false;
  });
}

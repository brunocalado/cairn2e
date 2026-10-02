/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, FLAGS } from "./constants.js";

/**
 * Putting what an item grants on the scene — the Raven Familiar out of the Half-Witch's growth, the
 * servant out of the Blood Pail.
 *
 * The row on the item's Grants list (`parts/grants.hbs`) is dragged onto the canvas. A player may
 * create neither the Actor nor the Token that takes, so the drop is handed to the Warden's client
 * as a query, and the Warden's client does both: it makes a world copy of the granted Actor, owned
 * by the item's players, and sets a token LINKED to it where the row was dropped. Linked, because
 * a companion is one creature — the raven wounded on one scene is wounded on the next.
 *
 * A grant that is an Actor in the world's directory is that actor: it is put on the scene as it
 * is, and the item's players are made its owners. A grant read from a compendium needs a world
 * copy, because a token can only stand for a world Actor — one copy per item, recorded on the
 * item ({@link FLAGS.GRANTED}), so the next drag of the same row sets another token of THAT actor
 * rather than a second raven. Two characters with the growth each have their own. A copy the
 * Warden deleted is made again on the next drag.
 *
 * Only an item in the world is handled here. An item read from a compendium has nobody to own the
 * copy and nowhere to record it, so its drop is left to core, which imports the Actor for a Warden
 * and refuses a player as it would any compendium Actor.
 */

/** The query the drop is handed to the Warden's client by. */
export const GRANT_QUERY = `${SYSTEM_ID}.grantToScene`;

/** Folder flag: the "Grants" Actor folder, found by this and never by its localized name. */
const FOLDER_FLAG = "grantsFolder";

/** The key the item sheet puts on a Grants row's drag data, naming the item it came from. */
export const GRANT_DRAG_KEY = "grantFrom";

/**
 * `dropCanvasData`: a Grants row dropped on the scene. Synchronous, because the hook's return
 * value is what stops core from handling the drop itself; the work runs after it returns.
 * @param {Canvas} canvas
 * @param {object} data  the drag data, with the drop point in `x` / `y`
 * @returns {boolean|void}  false when the drop is ours
 */
export function onDropCanvasData(canvas, data) {
  const itemUuid = data?.[SYSTEM_ID]?.[GRANT_DRAG_KEY];
  if (data?.type !== "Actor" || typeof itemUuid !== "string" || itemUuid.startsWith("Compendium.")) return;
  placeGrant({ itemUuid, grantUuid: data.uuid, sceneId: canvas.scene?.id, x: data.x, y: data.y });
  return false;
}

/**
 * Ask the Warden's client to put the grant on the scene, or do it here when this IS the Warden's.
 * @param {{itemUuid: string, grantUuid: string, sceneId: string, x: number, y: number}} request
 */
async function placeGrant(request) {
  try {
    if (game.user.isGM) return await applyGrant(request, game.user);
    const gm = game.users.activeGM;
    if (!gm) {
      ui.notifications.warn("CAIRN.Grants.NoWarden", { localize: true });
      return;
    }
    await gm.query(GRANT_QUERY, request, { timeout: 20000 });
  } catch (err) {
    console.error(`${SYSTEM_ID} | could not put a grant on the scene`, err);
    ui.notifications.error("CAIRN.Grants.Failed", { localize: true });
  }
}

/**
 * The Warden's side. Everything in `request` came over the wire, so each part is checked before
 * anything is made: the item exists in the world, the asker owns it, it really grants this Actor,
 * and the scene and the point are real.
 * @param {object} request
 * @param {User} user  who asked — core's own record of the sender, not a field of the payload
 * @returns {Promise<boolean>}
 */
export async function applyGrant(request, user) {
  const { itemUuid, grantUuid, sceneId, x, y } = request ?? {};
  if (typeof itemUuid !== "string" || typeof grantUuid !== "string" || typeof sceneId !== "string") return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const item = await fromUuid(itemUuid);
  if (item?.documentName !== "Item" || item.pack) return false;
  if (!item.testUserPermission(user, "OWNER")) return false;
  if (!item.system.grants?.includes(grantUuid)) return false;
  const scene = game.scenes.get(sceneId);
  if (!scene) return false;

  const actor = await grantedActor(item, grantUuid);
  if (!actor) return false;
  const token = await actor.getTokenDocument({}, { parent: scene });
  // Linked whatever the actor's own prototype says, and centred under the pointer, as a token
  // dragged from the Actors directory lands.
  token.updateSource({
    actorLink: true,
    x: x - (token.width * scene.grid.sizeX) / 2,
    y: y - (token.height * scene.grid.sizeY) / 2
  });
  await scene.createEmbeddedDocuments("Token", [token.toObject()]);
  return true;
}

/**
 * The world's Actor for what `item` grants: the directory's own when the grant is one, else the
 * copy already made for this item, or a new one.
 * @param {Item} item
 * @param {string} grantUuid
 * @returns {Promise<Actor|null>}
 */
async function grantedActor(item, grantUuid) {
  if (!grantUuid.startsWith("Compendium.")) {
    const actor = await fromUuid(grantUuid);
    if (actor?.documentName !== "Actor" || actor.pack) return null;
    const owners = itemOwners(item).filter((id) => !actor.testUserPermission(game.users.get(id), "OWNER"));
    if (owners.length) {
      await actor.update(Object.fromEntries(owners.map((id) => [`ownership.${id}`, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER])));
    }
    return actor;
  }

  // A list, not an object keyed by uuid: a uuid has dots, and `setFlag` would expand them into
  // nested objects (`FLAGS.GATHERED_TOKENS` records the cost of that).
  const made = item.getFlag(SYSTEM_ID, FLAGS.GRANTED) ?? [];
  const existing = game.actors.get(made.find((m) => m.source === grantUuid)?.actor);
  if (existing) return existing;

  const source = await fromUuid(grantUuid);
  if (source?.documentName !== "Actor") return null;
  const data = source.toObject();
  delete data._id;
  data.folder = (await grantsFolder()).id;
  data.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const id of itemOwners(item)) data.ownership[id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  data.prototypeToken = foundry.utils.mergeObject(data.prototypeToken ?? {}, {
    actorLink: true,
    disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY
  });
  const actor = await foundry.utils.getDocumentClass("Actor").create(data);
  if (!actor) return null;
  await item.setFlag(SYSTEM_ID, FLAGS.GRANTED, [
    ...made.filter((m) => m.source !== grantUuid),
    { source: grantUuid, actor: actor.id }
  ]);
  return actor;
}

/** Who owns the item — the character's players — and not the Warden who may be the one dragging
 *  it out; the Warden owns everything regardless. */
function itemOwners(item) {
  return game.users.filter((u) => !u.isGM && item.testUserPermission(u, "OWNER")).map((u) => u.id);
}

/** The "Grants" Actor folder, made on first use. */
async function grantsFolder() {
  const existing = game.folders.find((f) => f.type === "Actor" && f.getFlag(SYSTEM_ID, FOLDER_FLAG));
  if (existing) return existing;
  return foundry.utils.getDocumentClass("Folder").create({
    name: game.i18n.localize("CAIRN.Grants.FolderName"),
    type: "Actor",
    flags: { [SYSTEM_ID]: { [FOLDER_FLAG]: true } }
  });
}

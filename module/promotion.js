/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, MAX_SLOTS } from "./constants.js";
import { toPlainText, toPlainLines, backpackData } from "./character-generator.js";
import { sumUsedSlots } from "./data/_derived.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Promotion: the `npc` the Warden ran becomes the `character` a player runs.
 *
 * 2e asks for this by name — "When a character dies, the player should create a new character or
 * take control of a hireling. They immediately join the party in order to reduce downtime"
 * (`srd-2e/players-guide/core-rules.md` § Character Death).
 *
 * It is offered to every person, not only to `role: "hireling"`, because the SRD's "hireling" is
 * already wider than that role: § Hirelings will also build one from a **background** and a name,
 * with no Marketplace career at all, and someone the party ends up travelling with arrives at the
 * same place by a different door. A creature is refused — `isCreature` — since a beast has
 * neither the traits nor the career this flattens, and 2e hands a player no familiar to run as a
 * PC. The control is Warden-only and lives in the header menu, so the offer costs a sheet nothing.
 *
 * The Actor is converted **in place**, not copied: `_id`, gear, portrait, prototype token and
 * every token already on a scene survive, and an unlinked token's delta is re-typed by core along
 * with its parent. A second Actor would have broken all of that for nothing.
 *
 * What the two DataModels do not share is simply gone once the write lands — the database keeps
 * only what the new schema declares. So everything worth keeping is turned into text first
 * (`promotedDescription`), and everything not worth keeping is named in the dialog before anyone
 * says yes, because there is no undo.
 */

/**
 * The text a promoted person carries into `system.description`: what they did for a living, the
 * prose the Warden wrote, their quirk and goal, then one line per Feature.
 *
 * The trade line is the career and day rate for someone the party paid, and the background word
 * for everyone else — the two are the same slot because they answer the same question and an NPC
 * never has both filled. A character's own background is an Item and the word is only ever
 * flavour on an NPC (`data/actor-npc.js`), so there is nowhere else for it to go.
 *
 * Pure, and the reason this file has a unit check. Every part is optional, blank parts add no
 * empty line, and the order never changes — the trade first because it is who they were, the
 * Features last because they are the longest.
 *
 * @param {object} args
 * @param {string} [args.career]        Marketplace career, e.g. "Blacksmith".
 * @param {number} [args.dayRate]       Gold per day; printed only with a career.
 * @param {string} [args.background]    The NPC's background word; used when there is no career.
 * @param {string} [args.description]   The NPC's prose, already flattened.
 * @param {string} [args.quirk]
 * @param {string} [args.goal]
 * @param {Array<{name: string, description?: string}>} [args.features]
 * @param {{rate: string, quirk: string, goal: string}} args.labels  Localized, so this stays pure.
 * @returns {string}
 */
export function promotedDescription({ career, dayRate, background, description, quirk, goal, features = [], labels }) {
  const parts = [];
  if (career) parts.push(dayRate ? `${career} (${dayRate}${labels.rate})` : career);
  else if (background) parts.push(background);
  if (description) parts.push(description);
  if (quirk) parts.push(`${labels.quirk}: ${quirk}`);
  if (goal) parts.push(`${labels.goal}: ${goal}`);
  for (const feature of features) {
    parts.push(feature.description ? `${feature.name} — ${feature.description}` : feature.name);
  }
  return parts.join("\n\n");
}

/**
 * The `CharacterData` source a promoted person becomes: what the two models share, plus the
 * description everything else was flattened into.
 *
 * Deliberately partial — `gold`, `bond`, `omen`, `age` and `backgroundTables` are left to their
 * schema defaults. The SRD requires none of them of someone a player took over, and inventing
 * a Bond for a character whose player has not chosen one is worse than an empty heading.
 *
 * Pure, for the same reason as above.
 *
 * @param {object} npcSystem  `actor.system.toObject()` of the hireling.
 * @param {string} description
 * @returns {object}
 */
export function promotedSystem(npcSystem, description) {
  const t = npcSystem.traits ?? {};
  return {
    abilities: npcSystem.abilities,
    hp: npcSystem.hp,
    // Six appearance rows and two of character: the eight a PC has, out of the NPC's ten. The
    // other two — quirk and goal — are `wardens-guide/npc-tables.md` and went into the text.
    traits: {
      physique: t.physique ?? "",
      skin: t.skin ?? "",
      hair: t.hair ?? "",
      face: t.face ?? "",
      speech: t.speech ?? "",
      clothing: t.clothing ?? "",
      virtue: t.virtue ?? "",
      vice: t.vice ?? ""
    },
    description
  };
}

/**
 * What the Warden is told they are giving up, as localized lines. Empty when nothing is lost,
 * which is the common case for a hireling straight out of the generator.
 * @param {{armor: number, features: number, slotsUsed: number}} counts
 * @returns {string[]}
 */
function discardedLines({ armor, features, slotsUsed }) {
  const lines = [];
  if (features) lines.push(game.i18n.localize("CAIRN.Promote.LoseFeatures", { count: features }));
  // A PC's Armor is summed from what they wear (`data/actor-character.js`), so a number typed on
  // an NPC has nowhere to go. Minting a piece of armour to hold it would be inventing equipment.
  if (armor > 0) lines.push(game.i18n.localize("CAIRN.Promote.LoseArmor", { armor }));
  if (slotsUsed > MAX_SLOTS) {
    lines.push(game.i18n.localize("CAIRN.Promote.OverSlots", { used: slotsUsed, max: MAX_SLOTS }));
  }
  return lines;
}

/** The connected players, plus nobody. Ownership is what turns the hireling into a PC: the Scars
 *  path and the travel roster both read `hasPlayerOwner`, never the type alone. */
function ownerOptions() {
  const users = game.users.filter((u) => u.active && !u.isGM);
  const nobody = `<option value="">${foundry.utils.escapeHTML(game.i18n.localize("CAIRN.Promote.Nobody"))}</option>`;
  const rest = users.map((u) => `<option value="${u.id}">${foundry.utils.escapeHTML(u.name)}</option>`);
  // The first connected player is preselected: promoting for nobody is the exception, and the
  // Warden who wants it is one click away from it.
  return users.length ? [...rest, nobody].join("") : nobody;
}

/**
 * Ask, then convert. Returns the promoted Actor, or `null` if the Warden cancelled or the write
 * did not land.
 * @param {CairnActor} actor
 * @returns {Promise<CairnActor|null>}
 */
export async function promoteToCharacter(actor) {
  if (actor?.type !== "npc" || actor.system.isCreature) return null;

  const src = actor.system.toObject();
  const features = actor.items.filter((i) => i.type === "feature");
  const description = promotedDescription({
    career: src.career,
    dayRate: src.dayRate,
    background: src.background,
    description: toPlainLines(src.description),
    quirk: src.traits?.quirk,
    goal: src.traits?.goal,
    features: features.map((f) => ({ name: f.name, description: toPlainText(f.system.description) })),
    labels: {
      rate: game.i18n.localize("CAIRN.Promote.RateSuffix"),
      quirk: game.i18n.localize("CAIRN.Quirk"),
      goal: game.i18n.localize("CAIRN.Goal")
    }
  });

  const lost = discardedLines({
    armor: src.armor ?? 0,
    features: features.length,
    slotsUsed: sumUsedSlots(actor.items)
  });

  const esc = foundry.utils.escapeHTML;
  const content =
    `<p>${esc(game.i18n.localize("CAIRN.Promote.Hint", { name: actor.name }))}</p>` +
    `<div class="cairn-field"><label for="cairn-promote-owner">${esc(game.i18n.localize("CAIRN.Promote.Owner"))}</label>` +
    `<select id="cairn-promote-owner" name="owner">${ownerOptions()}</select></div>` +
    // Read-only, and it is the last chance to read it: the Features it quotes are deleted by the
    // same button, and Foundry keeps no earlier version of a document.
    `<label for="cairn-promote-preview">${esc(game.i18n.localize("CAIRN.Description"))}</label>` +
    `<textarea id="cairn-promote-preview" class="cairn-edit-text" rows="6" readonly>${esc(description)}</textarea>` +
    (lost.length
      ? `<p class="hint">${esc(game.i18n.localize("CAIRN.Promote.Discards"))}</p><ul>` +
        lost.map((l) => `<li>${esc(l)}</li>`).join("") + `</ul>`
      : "");

  const userId = await DialogV2.wait({
    classes: [SYSTEM_ID, "cairn-promote"],
    window: { title: game.i18n.localize("CAIRN.Promote.Title"), icon: "fas fa-user-check" },
    position: { width: 460 },
    content,
    buttons: [
      {
        action: "promote",
        default: true,
        icon: "fas fa-user-check",
        label: game.i18n.localize("CAIRN.Promote.Promote"),
        // `DialogV2` turns a `null` return into the action string, so "nobody" comes back as the
        // action name and is told apart from a user id by the lookup below.
        callback: (event, button) => button.form?.elements?.owner?.value ?? ""
      },
      { action: "cancel", icon: "fas fa-xmark", label: game.i18n.localize("CAIRN.Promote.Cancel") }
    ],
    rejectClose: false
  });
  if (userId === null || userId === "cancel") return null;

  const owner = game.users.get(userId);
  await actor.update({
    type: "character",
    // Required: core refuses a subtype change whose `system` is an ordinary partial update.
    system: foundry.data.operators.ForcedReplacement.create(promotedSystem(src, description)),
    ...(owner ? { ownership: { [owner.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } } : {}),
    // What `CairnActor.create` gives a character it makes; an update never passes through it.
    prototypeToken: {
      actorLink: true,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      sight: { enabled: true }
    }
  });

  // The refusal above is thrown inside `_updateDiff` and swallowed by the database backend, which
  // logs it and resolves the promise anyway — so the await proves nothing and the type has to be
  // read back. Observed on 14.367; without this a failed promotion looks like a dead button.
  if (actor.type !== "character") {
    ui.notifications.error(game.i18n.localize("CAIRN.Promote.Failed", { name: actor.name }));
    return null;
  }

  if (features.length) {
    await actor.deleteEmbeddedDocuments("Item", features.map((f) => f.id));
  }
  // Every PC starts with one ("Each PC starts with a Backpack that can hold up to six slots",
  // `srd-2e/players-guide/character-creation.md`); an NPC never had one.
  await actor.createEmbeddedDocuments("Item", [backpackData()]);

  ui.notifications.info(game.i18n.localize("CAIRN.Promote.Done", { name: actor.name }));
  return actor;
}

/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The system's Automatic Recognition entries for Automated Animations, imported only when that
 * module is active (`automated-animations.js`).
 *
 * AA finds an entry by the NAME of the item behind a chat message: the longest label contained
 * in the item's name, whitespace and case ignored. So "Hammer" plays for War Hammer and Smelting
 * Hammer, and "Knife" for every knife in the Background kits. AA's own default menu already
 * covers Sword, Dagger, Mace, Spear, Rapier, Handaxe, Bow, Crossbow, Bite, Claw and Cure Wounds;
 * nothing here repeats them.
 *
 * Only what can play without a Measured Template: a cast in Cairn names targets, never an area,
 * so every spell is an on-token effect (on the targets, or on the caster when there are none).
 *
 * Animations are JB2A Patreon's, as AA's database names them (`autoanimations.<section>.<type>.
 * <animation>.<variant>.<color>` in Sequencer's database). Sounds are PSFX's, by Sequencer
 * database path: AA hands the path to `Sequence#sound().file()`, which resolves a database entry
 * and picks at random when it holds several files. The PSFX licence forbids repackaging its audio,
 * so nothing but the path is here. Without PSFX the sound fails soft and the animation still
 * plays.
 */

/** The Automatic Recognition schema these entries are written in. AA migrates an older one
 *  itself and refuses a newer one, so this is the version they were observed in (AA 7.1.3). */
export const AUTOREC_VERSION = 5;

/**
 * @param {string} [file]  a PSFX database path, or nothing for silence
 */
const sound = (file) => ({
  enable: !!file, delay: 0, file, repeat: 1, repeatDelay: 250, startTime: 0, volume: 0.75
});

const video = (dbSection, menuType, animation, variant, color) => ({
  dbSection, menuType, animation, variant, color, enableCustom: false, customPath: ""
});

/** The switched-off extra sections every entry carries, shaped as AA's own defaults are. */
const OFF = video("static", "spell", "curewounds", "01", "blue");
const LOOK = { contrast: 0, saturate: 0, tint: false, tintColor: "#FFFFFF", zIndex: 1 };
const FADE = { addTokenWidth: false, anchor: "0.5", delay: 0, elevation: 1000, fadeIn: 250, fadeOut: 500, isMasked: false, opacity: 1, repeat: 1, repeatDelay: 250, ...LOOK };
const extras = () => ({
  macro: { enable: false },
  secondary: { enable: false, video: OFF, sound: sound(), options: { ...FADE, isRadius: true, isWait: false, size: 1.5 } },
  source: { enable: false, video: OFF, sound: sound(), options: { ...FADE, isRadius: false, isWait: true, size: 1 } },
  target: { enable: false, video: OFF, sound: sound(), options: { ...FADE, isRadius: false, persistent: false, size: 1, unbindAlpha: false, unbindVisibility: false } }
});

const head = (label, menu) => ({
  label, menu,
  soundOnly: { sound: { delay: 0, enable: false, startTime: 0, volume: 0.75 } }
});

/** A weapon swing from the attacker to the target. */
const melee = (label, [menuType, animation, variant, color], file) => ({
  ...head(label, "melee"),
  primary: {
    video: video("melee", menuType, animation, variant, color),
    sound: sound(file),
    options: { delay: 0, elevation: 1000, isWait: false, opacity: 1, repeat: 1, repeatDelay: 500, size: 1, ...LOOK }
  },
  // AA's default: past reach, a weapon JB2A also draws thrown (an axe, a hammer) is thrown; one
  // it does not (a halberd) still swings.
  meleeSwitch: {
    video: video("range", "weapon", "arrow", "regular", "regular"),
    sound: sound(),
    options: { detect: "automatic", range: 2, returning: false, switchType: "on" }
  },
  ...extras()
});

/** A projectile from the attacker to the target. */
const range = (label, [menuType, animation, variant, color], file) => ({
  ...head(label, "range"),
  primary: {
    video: video("range", menuType, animation, variant, color),
    sound: sound(file),
    options: { delay: 0, elevation: 1000, isReturning: false, isWait: false, onlyX: false, opacity: 1, repeat: 1, repeatDelay: 500, ...LOOK }
  },
  ...extras()
});

/** An effect on the targets, or on the caster when nobody is targeted. */
const ontoken = (label, [menuType, animation, variant, color], file) => ({
  ...head(label, "ontoken"),
  primary: {
    video: video("static", menuType, animation, variant, color),
    sound: sound(file),
    options: { ...FADE, elevation: 0, isRadius: false, isWait: false, persistent: false, playOn: "default", repeatDelay: 500, size: 1.5, unbindAlpha: false, unbindVisibility: false }
  },
  ...extras()
});

/** AA's teleport preset: the caster picks a square within range and the token moves there. */
const teleport = (label, color, file) => {
  const end = (variant, delay) => ({
    dbSection: "static", enable: true, menuType: "spell", animation: "mistystep", variant, color,
    customPath: "", enableCustom: false,
    options: { delay, elevation: 1000, fadeIn: 250, fadeOut: 250, isMasked: false, isRadius: false, opacity: 1, size: 1.5 }
  });
  return {
    ...head(label, "preset"),
    presetType: "teleportation",
    macro: { enable: false },
    data: {
      options: { range: 30, hideFromPlayers: false, measureType: "alternating", teleport: true, speed: 120, delayMove: 1000, alpha: 0, delayFade: 750, delayReturn: 250, checkCollision: true },
      start: end("01", 0),
      end: end("02", 500),
      between: { ...video("range", "spell", "chainlightning", "primary", "blue"), enable: false, options: { delay: 0, elevation: 1000, opacity: 1, playbackRate: 1 } },
      sound: sound(file)
    }
  };
};

const SWOOSH_LIGHT = (n) => `psfx.weapon-swooshes.light.v1.group0${n}`;
const SWOOSH_HEAVY = (n) => `psfx.weapon-swooshes.heavy.v1.group0${n}`;
const SLASH = "psfx.impacts.slashing.v1";
const THUD = "psfx.impacts.bludgeoning.v1";
const CAST = "psfx.casting.generic.001";
const WHISPER = (n) => `psfx.1st-level-spells.dissonant-whispers.v1.00${n}`;
const DIVINATION = "psfx.magic-signs.rune.v1.divination.complete";
const EARTH = "psfx.casting.earth.001";
const GUST = "psfx.cantrips.gust.v1";

/**
 * Every entry, keyed by the English label a translation aliases (`docs/translating.md`).
 * Unarmed's label is the name the system gives the item, so it follows the language on its own.
 * @returns {Array<[string, (label: string) => object]>}
 */
const ENTRIES = () => [
  // Marketplace and Background weapons AA's defaults miss.
  ["Axe", (l) => melee(l, ["weapon", "greataxe", "01", "white"], SWOOSH_HEAVY(1))],
  ["Club", (l) => melee(l, ["weapon", "club", "01", "white"], SWOOSH_HEAVY(2))],
  ["Cudgel", (l) => melee(l, ["weapon", "club", "01", "white"], SWOOSH_HEAVY(2))],
  // JB2A draws no flail, and no sickle: the nearest head and the nearest curve.
  ["Flail", (l) => melee(l, ["weapon", "mace", "01", "white"], SWOOSH_HEAVY(3))],
  ["Sickle", (l) => melee(l, ["weapon", "scimitar", "01", "white"], SWOOSH_LIGHT(2))],
  ["Halberd", (l) => melee(l, ["weapon", "halberd", "01", "white"], SWOOSH_HEAVY(4))],
  ["Hammer", (l) => melee(l, ["weapon", "warhammer", "01", "white"], SWOOSH_HEAVY(5))],
  ["Staff", (l) => melee(l, ["weapon", "quarterstaff", "01", "white"], SWOOSH_LIGHT(3))],
  ["Knife", (l) => melee(l, ["weapon", "dagger", "01", "white"], SWOOSH_LIGHT(4))],
  ["Falchion", (l) => melee(l, ["weapon", "falchion", "01", "white"], SWOOSH_LIGHT(5))],
  ["Trident", (l) => melee(l, ["weapon", "spear", "01", "white"], "psfx.weapon-attacks.spear.v1")],
  ["Unarmed", (l) => melee(l, ["weapon", "unarmedstrike", "physical", "blue"], THUD)],
  ["Fists", (l) => melee(l, ["weapon", "unarmedstrike", "physical", "blue"], THUD)],
  ["Sling", (l) => range(l, ["weapon", "sling", "01", "white"], SWOOSH_LIGHT(1))],
  ["Throwing Knives", (l) => range(l, ["weapon", "dagger", "01", "white"], SWOOSH_LIGHT(1))],
  ["Blunderbuss", (l) => range(l, ["weapon", "bullet", "1", "orange"], "psfx.ranged-weapons.guns.single-fire.revolver")],

  // Monster attacks that recur in the Bestiary.
  ["Tentacles", (l) => melee(l, ["creature", "claw", "01", "green"], THUD)],
  ["Talons", (l) => melee(l, ["creature", "claw", "01", "brown"], SLASH)],
  ["Beak", (l) => melee(l, ["creature", "bite", "01", "grey"], SLASH)],
  ["Horn", (l) => melee(l, ["generic", "2hp", "01", "white"], THUD)],
  ["Gore", (l) => melee(l, ["generic", "2hp", "01", "white"], THUD)],
  ["Sting", (l) => melee(l, ["generic", "1hp", "01", "white"], SWOOSH_LIGHT(6))],
  ["Touch", (l) => ontoken(l, ["energy", "strands", "01", "purple"], "psfx.impacts.magicaleffects.necrotic")],
  ["Breath", (l) => ontoken(l, ["fire", "eruption", "01", "orange"], "psfx.creature.dragons.attacks.breath.small.fire")],

  // Spells (and the Scrolls that share their names) with something to show.
  ["Shield", (l) => ontoken(l, ["shieldspell", "complete", "01", "blue"], "psfx.1st-level-spells.shield-spell.intro.v1.003")],
  ["Ward", (l) => ontoken(l, ["shieldfx", "energyfield", "01", "yellow"], "psfx.1st-level-spells.shield-spell.intro.v1.003")],
  ["Haste", (l) => ontoken(l, ["marker", "energystrand", "01", "blueorange"], CAST)],
  ["Sleep", (l) => ontoken(l, ["spell", "sleep", "01", "darkpurple"], "psfx.1st-level-spells.sleep.v1.001")],
  ["Charm", (l) => ontoken(l, ["conditions", "heart", "01", "pink"], WHISPER(1))],
  ["Hypnotize", (l) => ontoken(l, ["conditions", "dizzystars", "01", "purple"], WHISPER(2))],
  ["Befuddle", (l) => ontoken(l, ["conditions", "dizzystars", "01", "yellow"], WHISPER(3))],
  ["Pacify", (l) => ontoken(l, ["conditions", "heart", "02", "teal"], WHISPER(4))],
  ["Phobia", (l) => ontoken(l, ["conditions", "fear", "01", "darkpurple"], WHISPER(1))],
  ["Command", (l) => ontoken(l, ["magicsign", "enchantment", "complete", "purple"], "psfx.casting.sound.001")],
  ["Web", (l) => ontoken(l, ["spell", "web", "01", "white"], CAST)],
  ["Thicket", (l) => ontoken(l, ["spell", "entangle", "01", "green"], "psfx.1st-level-spells.entangle.vines.v1.001.intro")],
  ["Control Plants", (l) => ontoken(l, ["spell", "entangle", "01", "green"], "psfx.1st-level-spells.entangle.vines.v1.001.intro")],
  ["Night Sphere", (l) => ontoken(l, ["spell", "darkness", "01", "black"], "psfx.casting.generic.002.001")],
  ["Elemental Wall", (l) => ontoken(l, ["spell", "wallofforce", "01", "orange"], "psfx.casting.generic-v2.001.01")],
  ["Detect Magic", (l) => ontoken(l, ["spell", "detectmagic", "01", "blue"], "psfx.1st-level-spells.detect-magic.v1.001")],
  ["Cone of Foam", (l) => ontoken(l, ["liquid", "splash", "01", "grey"], "psfx.casting.water.001")],
  ["Icy Touch", (l) => ontoken(l, ["impact", "frost", "01", "blue"], "psfx.impacts.magicaleffects.cold")],
  ["Flare", (l) => ontoken(l, ["generic", "explosion", "01", "orange"], "psfx.casting.fire.001")],
  ["Illuminate", (l) => ontoken(l, ["marker", "light", "complete", "yellow"], "psfx.cantrips.light.v1.001")],
  ["Push/Pull", (l) => ontoken(l, ["generic", "outpulse", "01", "whiteblue"], GUST)],
  ["Repel", (l) => ontoken(l, ["generic", "outpulse", "02", "whiteblue"], GUST)],
  ["Telekinesis", (l) => ontoken(l, ["generic", "outpulse", "01", "purplepink"], CAST)],
  ["Earthquake", (l) => ontoken(l, ["impact", "groundcrack", "01", "orange"], EARTH)],
  ["Pit", (l) => ontoken(l, ["impact", "groundcrack", "01", "white"], EARTH)],
  // AA's default Fog Cloud is a template effect, which a Cairn cast never places. An on-token
  // entry of the same label is searched first (AA walks the on-token menu before the template
  // one), so this is the one that plays.
  ["Fog Cloud", (l) => ontoken(l, ["smoke", "plume", "complete", "grey"], "psfx.casting.water.001")],
  ["Smoke Form", (l) => ontoken(l, ["smoke", "plume", "complete", "grey"], CAST)],
  ["Arcane Eye", (l) => ontoken(l, ["eyes", "single", "01", "bluegreen"], DIVINATION)],
  ["Vision", (l) => ontoken(l, ["eyes", "single", "02", "orangeyellow"], DIVINATION)],
  ["True Sight", (l) => ontoken(l, ["eyes", "single", "03", "yellow"], DIVINATION)],
  ["Wizard Mark", (l) => ontoken(l, ["marker", "standard", "01", "purplepink"], "psfx.magic-signs.circle.v1.abjuration.complete")],
  ["Raise", (l) => ontoken(l, ["magicsign", "necromancy", "complete", "darkpurple"], "psfx.casting.generic.002.001")],
  ["Teleport", (l) => teleport(l, "purple", "psfx.2nd-level-spells.misty-step.v1.complete.generic")]
];

/**
 * The entries to offer, each under its English label and under every alias a translation gave it.
 * @param {Record<string, string[]>} aliases  English label → the translated labels to add
 * @returns {object[]}  AA Automatic Recognition entries, each with its `menu`
 */
export function animationMenu(aliases = {}) {
  return ENTRIES().flatMap(([key, build]) => {
    const own = key === "Unarmed" ? game.i18n.localize("CAIRN.Unarmed") : key;
    return [own, ...(aliases[key] ?? [])].map((label) => build(label));
  });
}

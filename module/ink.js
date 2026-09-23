/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The drawn layer.
 *
 * No frame or rule in this system is a CSS border. A 1px border is a machined line and reads as a
 * web form; a tiled SVG wobble is worse, because a wobble that repeats is a pattern and the eye
 * catches the loop. Instead a canvas is laid over the sheet, every element carrying `data-ink` is
 * measured at its real rendered size, and its outline is inked here.
 *
 * Two things make it read as drawn rather than generated:
 *
 * - the outline is a **closed path**, not four independent lines, so the corners belong to each
 *   other the way a pen's do;
 * - every box gets its own **wear** — four corners bitten off at four depths, plus one larger
 *   defect (a C-shaped bite out of a side, or a crumpled base) for a box big enough to carry one.
 *
 * The randomness is **seeded** from `data-ink-seed` plus the element's measured size, so a box
 * keeps its silhouette across redraws. Unseeded jitter looks alive for one frame and then crawls
 * every time a part re-renders.
 *
 * Attributes, all optional except `data-ink` itself:
 *
 * | attribute              | meaning                                                          |
 * |------------------------|------------------------------------------------------------------|
 * | `data-ink`             | `box` \| `circle` \| `hline` \| `vline` \| `bracket` \| `strike`   |
 * |                        | \| `slab`                                                          |
 * | `data-ink-seed`        | stable key for this element's silhouette (defaults to the kind)   |
 * | `data-ink-w`           | stroke weight, default `1.8` (ignored by `slab`)                  |
 * | `data-ink-a`           | stroke alpha, default `0.88`                                      |
 * | `data-ink-at`          | `bottom` to put an `hline` on the element's lower edge            |
 * | `data-ink-c`           | which ink — a key of `INKS`, default the black one                |
 * | `data-ink-fill`        | `hover` floods the drawn shape while hovered; `always` floods it  |
 * | `data-ink-fill-a`      | how solid that flood is, default `0.92`                           |
 * | `data-ink-fill-hover-a`| the flood's alpha while hovered, for a shape that is already full |
 * | `data-ink-lift`        | on a slab's PARENT: the mark reacts while the parent is hovered   |
 * |                        | or holds keyboard focus. Empty, it deepens; set to a key of       |
 * |                        | `INKS`, the mark is re-inked in that colour instead               |
 * | `data-ink-layer`       | `over` draws on top of the content instead of behind it           |
 */

/** Ink, as `--cairn-ink`. Read once: the token is fixed, not themed (see `css/src/base.css`). */
const INK = "25, 24, 19";

/**
 * The inks this layer can be charged with, as `data-ink-c` names.
 *
 * `red` is the sheet's one drawn colour and it says exactly one thing: the rules have shut this
 * action. It is the strike over Rest and Restore Abilities while Deprived, and nothing else — a
 * second use would turn it from a signal into decoration. Desaturated far enough to read as ink
 * on paper rather than as a web error state.
 *
 * `blood` is not that red and is never used for the same thing. It is a SLAB colour: the brush
 * mark under an attribute cap re-inks to it while the cap is hovered, saying "this is a roll".
 * Deep and desaturated so it still reads as ink soaked into paper — a bright red here would be a
 * web hover state sitting on a drawn sheet. It comes out a shade darker than it is written,
 * because the black mark is laid down first and the coloured one crossfades over it.
 */
const INKS = {
  default: INK,
  red: "160, 27, 27",
  blood: "110, 20, 20"
};

/**
 * A small deterministic generator (FNV-1a seed, then an LCG), so one element always draws itself
 * the same way. `Math.random` here would make the sheet twitch on every partial render.
 * @param {string} key
 * @returns {(min: number, max: number) => number}
 */
function seeded(key) {
  let s = 2166136261;
  for (let i = 0; i < key.length; i++) {
    s ^= key.charCodeAt(i);
    s = Math.imul(s, 16777619);
  }
  s >>>= 0;
  return (min, max) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return min + (s / 4294967296) * (max - min);
  };
}

/**
 * Walk a point list, bellying each edge out and adding grain to the route. Two passes, because a
 * single stroke reads as thin and deliberate where a pen leaves a doubled edge.
 *
 * `fill` is the alpha the closed path is flooded with, and `0` means no flood at all. It is an
 * alpha rather than a flag because a chip has to say three different things with one shape: a
 * pale wash under a dark label while it is hovered, a solid ground under a reversed-out label
 * while it is on, and a lighter ground while it is both.
 */
function strokePath(ctx, pts, closed, weight, alpha, rnd, fill = 0, color = INK) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = `rgba(${color}, ${rnd(alpha * 0.72, alpha)})`;
    ctx.lineWidth = rnd(weight * 0.7, weight * 1.15);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    const edges = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < edges; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dist = Math.hypot(dx, dy) || 1;
      if (i === 0) ctx.moveTo(a[0] + rnd(-1.2, 1.2), a[1] + rnd(-1.2, 1.2));
      const segments = Math.max(2, Math.floor(dist / 12));
      for (let j = 1; j <= segments; j++) {
        const t = j / segments;
        // A slight belly at mid-edge: a ruled line has none, a drawn one always does.
        const belly = Math.sin(t * Math.PI) * rnd(-1.3, 1.3);
        ctx.lineTo(
          a[0] + dx * t + (-dy / dist) * belly + rnd(-0.8, 0.8),
          a[1] + dy * t + (dx / dist) * belly + rnd(-0.8, 0.8)
        );
      }
    }
    if (closed) ctx.closePath();
    // Fill the SAME path that is about to be stroked, so a hover fill stops exactly where the
    // drawn outline does. A CSS background could not: it paints the element's rectangle, and the
    // outline wanders a couple of pixels either side of it.
    if (fill > 0 && pass === 0) {
      ctx.fillStyle = `rgba(${color}, ${fill})`;
      ctx.fill();
    }
    ctx.stroke();
  }
}

/**
 * A rectangle with four bitten corners and, if it is big enough to carry one, a single larger
 * defect. Small boxes get corners only — a bite at chip scale is just dirt.
 */
function boxPoints(x, y, w, h, rnd) {
  // Barely a cut. The corners used to come off at up to 14px, which at button scale is a 45°
  // chamfer — and a chamfer is a machine's idea of a soft corner, not a hand's. A pen turns the
  // corner almost square and wanders on the way; that wander is what `strokePath`'s belly gives.
  const cap = Math.min(3, w * 0.05, h * 0.1);
  const corner = [rnd(0.4, cap), rnd(0.4, cap), rnd(0.4, cap), rnd(0.4, cap)];  // TL TR BR BL
  const pts = [];
  const roomy = Math.min(w, h) > 42;
  const defect = roomy ? Math.floor(rnd(0, 3)) : 3;  // 0 bite right, 1 bite left, 2 crumpled base

  pts.push([x + corner[0], y]);
  pts.push([x + w - corner[1], y]);
  pts.push([x + w, y + corner[1]]);

  if (defect === 0) {
    const at = y + h * rnd(0.35, 0.65);
    const d = rnd(4, Math.min(9, w * 0.12));
    pts.push([x + w, at - 7], [x + w - d * 0.55, at - 4], [x + w - d, at],
      [x + w - d * 0.55, at + 4], [x + w, at + 7]);
  }

  pts.push([x + w, y + h - corner[2]]);
  pts.push([x + w - corner[2], y + h]);

  if (defect === 2) {
    for (let k = 1; k <= 3; k++) pts.push([x + w - (w * k) / 4, y + h + rnd(-2.5, 2.5)]);
  }

  pts.push([x + corner[3], y + h]);
  pts.push([x, y + h - corner[3]]);

  if (defect === 1) {
    const at = y + h * rnd(0.35, 0.65);
    const d = rnd(4, Math.min(9, w * 0.12));
    pts.push([x, at + 7], [x + d * 0.55, at + 4], [x + d, at],
      [x + d * 0.55, at - 4], [x, at - 7]);
  }

  pts.push([x, y + corner[0]]);
  return pts;
}

/** A ring that is never quite a circle. */
function circlePoints(cx, cy, r, rnd) {
  const pts = [];
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r + rnd(-1.4, 1.4);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

/**
 * A brush slab: the filled ground that a reversed-out label sits on — an attribute cap, the
 * active tab, Gold.
 *
 * It is the one shape here that has to be *solid* rather than outlined, and that is the whole
 * difficulty. A paper-coloured label sits on top of it, so the middle band must stay opaque all
 * the way across; the brush has to read in the silhouette instead. Three things carry it: a
 * ragged top and bottom edge, ends pinched where the bristles land and lift, and bristle streaks
 * running the length of the mark and overshooting both ends. None of them ever punches a gap
 * through the middle, which is what a dry-brush texture would do and what would drop a letter
 * onto bare paper.
 */
function slabProfile(rnd) {
  // A brush lands harder than it lifts, so the two ends are never the same length of taper. This
  // asymmetry is most of what stops five marks in a row looking like five copies.
  //
  // It is skewed around a fixed mean rather than drawn independently, so the two tapers always
  // average out: a mark whose tail is reliably longer than its lead carries its ink to the left of
  // its box, and a label centred in that box then reads as sitting off-centre. The skew gives each
  // mark its own lean; the mean keeps the ink centred on the element it was measured from.
  const mean = rnd(0.08, 0.14);
  const skew = rnd(-0.04, 0.04);
  return { lead: mean + skew, tail: mean - skew };
}

/** How full the mark is at `t` along its length: 0 at the very ends, 1 through the body. */
function slabSpan(t, { lead, tail }) {
  return Math.min(1, Math.min(t / lead, (1 - t) / tail));
}

function slabPoints(x, y, w, h, rnd, profile) {
  // How deep the ragged edge may eat in. Past a sixth of the height it starts reaching the
  // label's cap line.
  const lip = h * 0.16;
  const steps = Math.max(10, Math.round(w / 9));
  const top = [];
  const bottom = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Linear, not eased: an eased taper closes into an ellipse and the mark stops reading as a
    // flat brush and starts reading as a pill.
    const pinch = (1 - slabSpan(t, profile)) * h * 0.28;
    const at = x + w * t;
    top.push([at, y + pinch + rnd(0, lip)]);
    bottom.push([at, y + h - pinch - rnd(0, lip)]);
  }
  return top.concat(bottom.reverse());
}

function drawSlab(ctx, x, y, w, h, rnd, color) {
  const over = Math.min(6, w * 0.06);
  const profile = slabProfile(rnd);

  // The body. Filled from its own path rather than run through `strokePath`, whose belly would
  // round off the raggedness this shape is made of.
  const pts = slabPoints(x, y, w, h, rnd, profile);
  ctx.fillStyle = `rgba(${color}, 0.95)`;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();

  // The bristles. This is where the mark gets its shape, not just its texture: a bristle's LENGTH
  // depends on how far it sits from the centre line, so the ones at the edge of the brush only
  // touch down across the middle of the mark and the ends come to a point. Drawing every bristle
  // at full width instead lays a rectangle of ink over the tapered body and undoes it — the row
  // of five caps then reads as one unbroken bar with seams in it.
  ctx.lineCap = "round";
  const bristles = Math.round(Math.min(260, Math.max(90, (w * h) / 12)));
  for (let i = 0; i < bristles; i++) {
    const startY = y + rnd(-h * 0.04, h * 1.04);
    const endY = startY + rnd(-h * 0.12, h * 0.12);
    const off = Math.min(1, Math.abs(startY - (y + h / 2)) / (h / 2));
    // Squared, so the shortening stays off the dense middle band and bites only at the edges. One
    // bristle in six is a stray that ignores it and runs long — the frayed marks a splayed brush
    // leaves past the body of the stroke, and the thing that keeps the ends from reading as cut.
    const stray = rnd(0, 1) < 0.16;
    const inset = stray ? 0 : off * off * w * 0.12;
    // ONE extension, used at BOTH ends. Drawing an independent overshoot per end lets the dense
    // middle of the mark finish further out on one side than the other, and the solid body — which
    // is what an eye centres a label on — then sits off-centre inside its own box. The taper
    // profile still leans the mark, but it only reaches the faint bristles near the edges, where
    // it reads as character rather than as a misalignment.
    const ext = rnd(0, over) * (1 - off);
    ctx.lineWidth = rnd(0.5, 2);
    ctx.strokeStyle = `rgba(${color}, ${((1 - off) * 0.8 + rnd(0, 0.2)) * (stray ? 0.45 : 1)})`;
    ctx.beginPath();
    ctx.moveTo(x + w * profile.lead * off * 0.5 + inset - ext, startY);
    ctx.quadraticCurveTo(
      x + w / 2,
      (startY + endY) / 2 + rnd(-h * 0.07, h * 0.07),
      x + w - w * profile.tail * off * 0.5 - inset + ext,
      endY
    );
    ctx.stroke();
  }

  // The flecks a loaded brush throws off at either end. Deliberately kept faint: a fleck as solid
  // as the body would extend the silhouette the eye measures, and one landing on one side only
  // would pull the mark's apparent centre with it.
  for (let i = 0; i < 14; i++) {
    const at = rnd(0, 1) > 0.5 ? x + rnd(-2, w * 0.14) : x + w - rnd(-2, w * 0.14);
    ctx.beginPath();
    ctx.arc(at, y + rnd(0, h), rnd(0.2, 1.4), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color}, ${rnd(0.15, 0.55)})`;
    ctx.fill();
  }
}

/**
 * Slabs are the only expensive thing on this layer — a couple of hundred bristle strokes each,
 * against a handful of lines for a frame — and the layer repaints on every hover over a chip. So
 * each is drawn once into its own canvas and blitted from then on. The cache key is the same seed
 * and size the silhouette is derived from, plus the ink it is charged with, which means a cached
 * slab is by definition the one a redraw would have produced.
 *
 * The tile carries a margin because the bristles and flecks deliberately overshoot the box, and a
 * tile cut to the box would clip off exactly the part that makes the ends read as a brush.
 */
const SLAB_PAD = 8;
const slabCache = new Map();

/**
 * One colourway of one slab, drawn once and kept.
 *
 * The generator is built HERE, from the key, rather than taken from the caller: two colourways of
 * the same mark have to be the same mark. `seeded` is stateful, so a single generator handed to
 * two `drawSlab` calls would advance between them and the red silhouette would be a different
 * brush from the black one underneath it — which is what a crossfade between them would show.
 * @param {number} w
 * @param {number} h
 * @param {string} key    the seed the silhouette is derived from
 * @param {string} color  an `INKS` value
 * @returns {HTMLCanvasElement}
 */
function slabTile(w, h, key, color) {
  const dpr = window.devicePixelRatio || 1;
  const id = `${key}|${dpr}|${color}`;
  let tile = slabCache.get(id);
  if (tile) return tile;
  // Sizes only change when the window is resized, so the map settles at a handful of entries.
  // The clear is there so a long drag-resize cannot grow it without bound.
  if (slabCache.size > 64) slabCache.clear();
  tile = document.createElement("canvas");
  tile.width = Math.round((w + SLAB_PAD * 2) * dpr);
  tile.height = Math.round((h + SLAB_PAD * 2) * dpr);
  const tctx = tile.getContext("2d");
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSlab(tctx, SLAB_PAD, SLAB_PAD, w, h, seeded(key), color);
  slabCache.set(id, tile);
  return tile;
}

/**
 * The mark is centred on its box **by construction**, and nothing here corrects it afterwards.
 *
 * An earlier version measured each tile's alpha-weighted centroid and shifted the blit onto it.
 * That is the wrong target twice over. The centroid counts the faintest spray as heavily, per
 * unit of alpha, as the solid body — so a mark whose body was visibly off to one side could
 * measure as perfectly centred, and did. And once the body IS symmetric, correcting toward the
 * centroid actively pushes it off centre to compensate for spray nobody can see.
 *
 * So the invariant lives in `drawSlab` instead: the dense bristles extend by the same amount at
 * both ends, the flecks stay too faint to form an edge, and the lean is carried by the faint
 * bristles near the mark's top and bottom. What the eye reads as the shape is symmetric about
 * the element that was measured, and no measurement is needed to keep it that way.
 *
 * @param {number} lift        0…1, how far into the lifted state the mark is
 * @param {string|null} color  the ink the lift re-draws in; `null` deepens the mark instead
 */
function blitSlab(ctx, x, y, w, h, key, lift = 0, color = null) {
  const tw = w + SLAB_PAD * 2;
  const th = h + SLAB_PAD * 2;
  ctx.drawImage(slabTile(w, h, key, INK), x - SLAB_PAD, y - SLAB_PAD, tw, th);
  if (lift <= 0) return;

  // The lift: the SAME tile laid down a second time, in the same place, at an alpha that ramps
  // with the state. Uncoloured that is a third strength of the same ink — the solid body is
  // already near-opaque and barely changes, and what deepens is everything at the edges (the
  // bristles, the fray, the flecks), so the mark reads as pressed a little harder into the paper
  // without moving or growing. Coloured it is a full-strength crossfade onto a second colourway,
  // which is why the two tiles must share a silhouette: the ragged edge has to stay exactly where
  // it was or the mark would appear to change shape on hover. Blitting cached tiles keeps either
  // as cheap as the first pass.
  ctx.globalAlpha = color ? lift : lift * 0.35;
  ctx.drawImage(slabTile(w, h, key, color ?? INK), x - SLAB_PAD, y - SLAB_PAD, tw, th);
  ctx.globalAlpha = 1;
}

/**
 * How long a lift takes to come up or go down.
 *
 * A mark that snaps between two inks reads as a state that was switched; one that takes a beat
 * reads as ink soaking in, which is the only register this layer has. It is short enough that it
 * never sits between the pointer and the answer.
 */
export const LIFT_MS = 130;

/**
 * Where each lifting element currently is between its two states, which state it is heading for,
 * and when it was last advanced. Keyed weakly on the element, so a sheet that closes takes its
 * entries with it.
 * @type {WeakMap<HTMLElement, {value: number, want: number, at: number}>}
 */
const liftLevels = new WeakMap();

/** Set by `liftLevel` when something is still moving; read by `paintInk` to book another frame. */
let liftMoving = false;

/** The frame `paintInk` has already booked, so a hover mid-ramp does not start a second loop. */
let liftFrame = 0;

/**
 * Advance one element's lift toward `want` and hand back where it is now.
 *
 * The ramp is driven from the paint rather than from the pointer: an element's target is whatever
 * `:hover` says at paint time, and a paint that finds anything still short of its target books
 * the next frame itself. That keeps the whole animation inside the one function that already
 * knows how to draw the layer, and it means a pointer that leaves mid-ramp simply reverses from
 * wherever the mark had got to instead of restarting.
 * Exported only so `checks/ink-lift.check.mjs` can drive it with a clock it controls. The ramp is
 * the one thing on this layer that no screenshot and no single evaluation can catch getting
 * subtly wrong, because what it does wrong it does between two frames.
 * @param {object} el    the element whose lift is being tracked (any object; used as a WeakMap key)
 * @param {number} want  0 or 1
 * @param {number} now   `performance.now()` for this paint
 * @returns {number}
 */
export function liftLevel(el, want, now) {
  const state = liftLevels.get(el);
  if (!state) {
    // First sight of this element: start AT the target, so a sheet that renders under the pointer
    // does not fade its mark in from nothing.
    liftLevels.set(el, { value: want, want, at: now });
    return want;
  }
  // The clock restarts the moment the target changes, and NOT before. The layer repaints for all
  // sorts of reasons — a chip hovered across the sheet, a tab scrolled — and the gap since the
  // last of those says nothing about how long this mark has been travelling. Carrying it made the
  // first frame of a hover advance by however many seconds the sheet had been sitting still,
  // which is every ramp finishing instantly.
  if (state.want !== want) {
    state.want = want;
    state.at = now;
  }
  if (state.value === want) return want;
  const step = Math.max(0, now - state.at) / LIFT_MS;
  state.at = now;
  state.value = want > state.value
    ? Math.min(want, state.value + step)
    : Math.max(want, state.value - step);
  if (state.value !== want) liftMoving = true;
  return state.value;
}

/**
 * A hover over anything that fills has to repaint the layer, because the fill is drawn and not
 * styled. Delegated and attached once: `.window-content` outlives every part render.
 */
function ensureHoverRepaint(host) {
  if (host.dataset.inkHover === "on") return;
  host.dataset.inkHover = "on";
  const repaint = (event) => {
    if (event.target?.closest?.("[data-ink-fill], [data-ink-lift]")) paintInk(host);
  };
  host.addEventListener("pointerover", repaint);
  host.addEventListener("pointerout", repaint);
  // A lifted mark answers the keyboard too: the roll link inside a cap takes focus, and the
  // mark under it has to deepen the same way it does under the pointer.
  host.addEventListener("focusin", repaint);
  host.addEventListener("focusout", repaint);
}

/**
 * Two canvases, created on demand and reused; neither is part of any Handlebars part.
 *
 * Almost everything is drawn BEHIND the content: a frame round a block of text has to sit under
 * the text, and a filled chip has to sit under its label. The exception is anything drawn around
 * an opaque image — a portrait frame under the picture loses its inner half to the picture, which
 * is what made every attempt at that frame look thin and offset. `data-ink-layer="over"` puts it
 * on the second canvas, above.
 *
 * Both are inert: the sheet is still a form, and the ink must never eat a click.
 */
function ensureCanvas(host, over) {
  const cls = over ? "cairn-ink-over" : "cairn-ink";
  let canvas = host.querySelector(`:scope > canvas.${cls}`);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = cls;
    canvas.setAttribute("aria-hidden", "true");
    if (over) host.append(canvas);
    else host.prepend(canvas);
  }
  return canvas;
}

/** Size a canvas to the host box and hand back a cleared, DPR-scaled context. */
function prepare(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/**
 * The box a mark is allowed to be drawn in, in viewport coordinates — or `null` when nothing
 * between the element and the host clips it.
 *
 * The canvas is ONE layer spanning the whole of `.window-content`, and the browser clips the DOM
 * but not a canvas: a row scrolled up out of a tab keeps being stroked at wherever it now is,
 * which is across the tab strip above the pane. The strip is transparent — every mark on it is
 * drawn on this same canvas — so the stray rules showed straight through the labels. Giving the
 * strip an opaque ground is not the answer and was tried: its own brush slab, the Gold chip's
 * box and the rule under it are all painted BELOW it on this canvas, and a ground would bury them.
 *
 * So the layer clips where the DOM clips — and the question "does this ancestor clip?" has
 * exactly one right answer: its computed `overflow`. Nothing else does, whatever else it looks
 * like.
 *
 * The first cut asked `scrollHeight > clientHeight` instead, to save a `getComputedStyle`, and it
 * was wrong in a way that took the sheet's brush marks with it. That comparison finds OVERFLOWING
 * CONTENT, which is not the same thing as a scroll container: every `.cairn-slab` is an absolutely
 * positioned child deliberately painted past its parent — 16px past the label on a tab, 2px past
 * the box on an attribute cap — so every one of their parents reported overflow and every mark got
 * clipped to a box smaller than itself. The active tab's mark lost 16px off each side at a
 * straight edge, which turned a feathered brush stroke into a flat black rectangle. An element
 * with `overflow: visible` clips nothing no matter what its `scrollHeight` says.
 *
 * Per axis, because they are independent: `overflow-x: clip` with `overflow-y: visible` is legal
 * and clips only sideways. An axis left `visible` is left unbounded.
 *
 * The box is the PADDING box, which is what content is clipped to: `clientLeft`/`clientTop` are
 * the border widths and `clientWidth`/`clientHeight` exclude them.
 *
 * `styles` is a per-paint cache. Ancestors are shared — every slot row in the ledger walks the
 * same three — so one repaint asks the browser for a handful of styles rather than one per mark.
 * @param {HTMLElement} el
 * @param {HTMLElement} host
 * Exported for `checks/ink-clip.check.mjs`: an ancestor already in `styles` is never looked up,
 * so the whole decision can be driven from a stand-in graph without a browser.
 * @param {Map<HTMLElement, CSSStyleDeclaration>} styles
 * @returns {{left: number, top: number, right: number, bottom: number}|null}
 */
export function scrollClip(el, host, styles) {
  let box = null;
  for (let node = el.parentElement; node && node !== host; node = node.parentElement) {
    let style = styles.get(node);
    if (!style) styles.set(node, style = getComputedStyle(node));
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";
    if (!clipsX && !clipsY) continue;
    const r = node.getBoundingClientRect();
    const left = r.left + node.clientLeft;
    const top = r.top + node.clientTop;
    const next = {
      left: clipsX ? left : -Infinity,
      right: clipsX ? left + node.clientWidth : Infinity,
      top: clipsY ? top : -Infinity,
      bottom: clipsY ? top + node.clientHeight : Infinity
    };
    box = box
      ? {
        left: Math.max(box.left, next.left),
        top: Math.max(box.top, next.top),
        right: Math.min(box.right, next.right),
        bottom: Math.min(box.bottom, next.bottom)
      }
      : next;
  }
  return box;
}

/**
 * Measure every `[data-ink]` under `host` and repaint the whole layer.
 *
 * Positions come from `getBoundingClientRect`, which is viewport-relative — so an element inside
 * a scrolled tab is inked exactly where it is seen, and one scrolled out of view is drawn outside
 * the canvas and clipped. That is why the canvas is sized from `clientHeight` and not
 * `scrollHeight`: `.window-content` never scrolls (the active `.tab` does), and reading the
 * scrolling height of the box the canvas lives in invites a feedback loop.
 *
 * Being outside the CANVAS is not the only way a mark can be out of view, which is what
 * `scrollClip` is for: inside a scrolling pane the mark is clipped to the pane, exactly as the
 * element it was measured from is.
 * @param {HTMLElement} host  The positioned element the canvas covers — `.window-content`.
 */
export function paintInk(host) {
  if (!host?.isConnected) return;
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) return;

  ensureHoverRepaint(host);
  const under = prepare(ensureCanvas(host, false), width, height);
  const above = prepare(ensureCanvas(host, true), width, height);
  const now = performance.now();
  liftMoving = false;

  // The canvas origin, NOT the host's own rect origin. Both canvases sit at `inset: 0`, which
  // resolves against the host's PADDING box, while `getBoundingClientRect` returns its BORDER box
  // — and `.window-content` carries a 4px border. Measuring from the border box drew every mark,
  // frame and rule exactly one border-width down and to the right of the element it belongs to:
  // a systematic 4px bias that reads as a blob sitting low and right of the label inside it.
  // `clientLeft` / `clientTop` are the left and top border widths, which is precisely the gap.
  const base = host.getBoundingClientRect();
  const originX = base.left + host.clientLeft;
  const originY = base.top + host.clientTop;

  // One repaint's worth of computed styles, for `scrollClip`. Cleared with the paint.
  const styles = new Map();

  for (const el of host.querySelectorAll("[data-ink]")) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    const x = rect.left - originX;
    const y = rect.top - originY;
    const kind = el.dataset.ink;
    const weight = Number(el.dataset.inkW) || 1.8;
    const alpha = Number(el.dataset.inkA) || 0.88;
    const color = INKS[el.dataset.inkC] ?? INKS.default;
    const key = `${el.dataset.inkSeed ?? kind}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
    const rnd = seeded(key);
    const ctx = el.dataset.inkLayer === "over" ? above : under;

    // Clipped to whatever scrolling pane the element sits in, for as long as this one mark is
    // being drawn. A pane that is not scrolling returns no box and nothing is clipped, so a sheet
    // whose content fits takes the path it always took.
    const clip = scrollClip(el, host, styles);
    if (clip) {
      // An axis its ancestors leave `visible` comes back infinite; the canvas is the bound there,
      // which it already was. Clamping to the host's own box keeps the rect finite.
      const cx = Math.max(clip.left - originX, 0);
      const cy = Math.max(clip.top - originY, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, Math.min(clip.right - originX, width) - cx, Math.min(clip.bottom - originY, height) - cy);
      ctx.clip();
    }

    switch (kind) {
      case "box": {
        // Three grounds out of one shape. A hovered chip that is OFF gets a pale wash it can
        // still be read through; one that is ON keeps its solid ground and only lightens, so the
        // reversed-out label never loses its contrast. A disabled control never fills at all —
        // hover is an affordance and there is nothing here to afford.
        const mode = el.dataset.inkFill;
        const hovered = !el.disabled && el.matches(":hover");
        const resting = Number(el.dataset.inkFillA) || 0.92;
        let fill = 0;
        if (mode === "always") fill = hovered ? (Number(el.dataset.inkFillHoverA) || resting) : resting;
        else if (mode === "hover" && hovered) fill = resting;
        strokePath(ctx, boxPoints(x, y, rect.width, rect.height, rnd), true, weight, alpha, rnd, fill, color);
        break;
      }
      case "slab": {
        // The slab itself is inert (`pointer-events: none`) and never hovered; the lift is
        // decided by its parent, which is the thing the pointer is over or the focus is in.
        //
        // `:has(:focus-visible)` rather than `:focus-within`: clicking a cap leaves the link
        // focused, and a mark that stayed lit after the pointer had moved on read as stuck. The
        // keyboard still gets it, because that is exactly what `:focus-visible` is for.
        const parent = el.parentElement;
        const mode = parent?.dataset.inkLift;
        let lift = 0;
        let liftColor = null;
        if (mode !== undefined) {
          lift = liftLevel(parent, parent.matches(":hover, :has(:focus-visible)") ? 1 : 0, now);
          liftColor = mode ? INKS[mode] ?? null : null;
        }
        blitSlab(ctx, x, y, Math.round(rect.width), Math.round(rect.height), key, lift, liftColor);
        break;
      }
      case "circle": {
        const r = Math.min(rect.width, rect.height) / 2 - 1;
        strokePath(ctx, circlePoints(x + rect.width / 2, y + rect.height / 2, r, rnd), true, weight, alpha, rnd, 0, color);
        break;
      }

      case "strike": {
        // A line ruled through a word, not a `text-decoration`: it overshoots the word at both
        // ends and it is never level, which is what a pen crossing something out actually leaves.
        // Measured from the LABEL, so it spans the text and not the control's padding — and drawn
        // with `data-ink-layer="over"`, because a strike behind the letters is not a strike.
        const at = y + rect.height / 2;
        const over = 3;
        strokePath(ctx, [
          [x - over, at + rnd(-1.2, 0.6)],
          [x + rect.width * 0.45, at + rnd(-1.4, 1)],
          [x + rect.width + over, at + rnd(-0.6, 1.4)]
        ], false, weight, alpha, rnd, 0, color);
        break;
      }

      case "vline": {
        // Along the element's LEFT edge, overshooting a little at both ends the way a pen does.
        strokePath(ctx, [
          [x + rnd(-0.6, 0.6), y - 1],
          [x + rnd(-1, 1), y + rect.height * 0.5],
          [x + rnd(-0.6, 0.6), y + rect.height + 1]
        ], false, weight, alpha, rnd, 0, color);
        break;
      }
      case "bracket": {
        // A `[` drawn down the element's LEFT edge, with a short hook turning inward at each
        // end. The hooks reach exactly the element's width, so how far they turn is set in CSS
        // with everything else about the box.
        //
        // One continuous path rather than three strokes: a stroke and two hooks drawn
        // separately each get their own start and end jitter, and the two joins then read as a
        // line someone failed to meet twice. A pen turns the corner without lifting.
        const hook = rect.width;
        const left = x + rnd(-0.5, 0.5);
        strokePath(ctx, [
          [left + hook, y + rnd(-1, 0.4)],
          [left, y + rnd(-0.4, 0.8)],
          [left + rnd(-1, 1), y + rect.height * 0.5],
          [left, y + rect.height + rnd(-0.8, 0.4)],
          [left + hook, y + rect.height + rnd(-0.4, 1)]
        ], false, weight, alpha, rnd, 0, color);
        break;
      }
      case "hline": {
        const at = el.dataset.inkAt === "bottom" ? y + rect.height - 1 : y + rect.height / 2;
        strokePath(ctx, [
          [x, at + rnd(-1, 1)],
          [x + rect.width * 0.4, at + rnd(-1.4, 1)],
          [x + rect.width, at + rnd(-1, 1.4)]
        ], false, weight, alpha, rnd, 0, color);
        break;
      }
    }

    if (clip) ctx.restore();
  }

  // A mark that has not reached its target yet books the next frame. Exactly one is ever
  // outstanding: a pointer event that repaints mid-ramp cancels the booking and makes its own.
  if (liftFrame) cancelAnimationFrame(liftFrame);
  liftFrame = liftMoving
    ? requestAnimationFrame(() => {
      liftFrame = 0;
      paintInk(host);
    })
    : 0;
}

/**
 * Repaint once the layout has settled, and again once the webfonts land.
 *
 * Both waits are load-bearing. A single `requestAnimationFrame` measures a frame where flex has
 * not finished, and every box comes out a few pixels short; and Lora and the blackletter arrive
 * after first paint, changing the height of every box that holds text.
 * @param {HTMLElement} host
 */
export function scheduleInk(host) {
  requestAnimationFrame(() => requestAnimationFrame(() => paintInk(host)));
  document.fonts?.ready?.then(() => paintInk(host));
}

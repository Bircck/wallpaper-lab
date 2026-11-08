'use strict';
// Koi Garden (dusk): Wallpaper Engine web wallpaper. Runtime contract from docs/tools/web-wallpaper-kit/TEMPLATE.md.
// The painting is a dusk plate. Everything that moves is its own layer over a clean plate (no pads, no branch):
//  - koi: painted sprites cut into rigid pieces that follow a spine path (as in the day version),
//  - 21 lily pads: one cut-out each, bobbing very slightly and nudged by koi swimming underneath (with a tiny ring),
//  - the cherry branch: one cut-out, a root-anchored sway (nothing is warped globally), petals shed on gusts,
//  - the stone lantern: its warm light breathes slowly (a mask of the painting's lit areas), fireflies drift near it.
// Pass A renders plate + koi shadows + koi into an offscreen buffer. Pass B shows it through the water (local refraction
// inside ripple rings, a faint sky film, lantern light on the water). Then floating petals, pads, branch, falling petals, fireflies.
(() => {
const canvas = document.querySelector('#scene');
const BASE = document.currentScript.src;
const url = f => new URL(f, BASE).href;
const AW = 1672, AH = 941;                 // art space = the concept frame in px (all sim units)
const FOCUS = [0.42, 0.0];                 // 21:9 keeps the top (branch, top pads) and the lantern window; 16:10 keeps the lantern
const FIELD = window.KOI_FIELD, KD = window.KOI_DATA, LAY = window.KOI_LAYERS;
const LAMP = LAY.lamp;                     // lantern window centre, art px
// Development hook (inert in WE): window.KOI_VARIANTS = { light: 0|1|2, pads: 0|1, sway: 0..2 (multiplier) } may be set before or after load.
const vv = (k, d) => (window.KOI_VARIANTS && window.KOI_VARIANTS[k] !== undefined) ? window.KOI_VARIANTS[k] : d;

// ---- settings: WE slider value (0-100) -> internal unit. 50 = tuned look.
const settings = { koi: 50, water: 1, wind: 1, petals: 1, glow: 1, quality: 1, fps: 30 };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fromSlider = {
  koi: v => v,                             // 0 none, 50 five, 80+ eight (count + activity derived below)
  water: v => v / 50,                      // rings, sky film, pads bobbing, lantern light on the water
  wind: v => v / 50,                       // branch sway, petal drift
  petals: v => v / 50,
  glow: v => v / 50,                       // lantern breathing, fireflies
  quality: v => clamp(v, 35, 100) / 100,
};
const weKeys = { koi: 'koi', water: 'water', wind: 'wind', petals: 'petals', glow: 'glow', renderscale: 'quality' };
const koiCount = () => clamp(Math.round(settings.koi / 10), 0, 8);
const activity = () => 0.75 + 0.5 * clamp(settings.koi / 100, 0, 1);   // 1.0 at 50

let gl, ready = false, lost = false, hostPaused = false, testMode = false;
let raf = 0, last = 0, acc = 0, pending = 0, time = 0, frames = 0;
let images = {}, P = {}, tex = {}, fbo = null, fboTex = null, buf = {};
let win = [0, 0, 1, 1];

window.wallpaperPropertyListener = {
  applyUserProperties(p) {
    for (const [weKey, key] of Object.entries(weKeys)) {
      if (!p[weKey]) continue;
      const n = Number(p[weKey].value);
      if (!Number.isFinite(n)) continue;
      settings[key] = fromSlider[key](clamp(n, 0, 100));
      if (key === 'quality') resize();
    }
    if (ready) draw();
    schedule();
  },
  applyGeneralProperties(p) {
    if (p.fps !== undefined && Number.isFinite(Number(p.fps))) settings.fps = clamp(Number(p.fps), 0, 240);
  },
  setPaused(paused) { hostPaused = Boolean(paused); schedule(); },
};

// =====================================================================================================
// Simulation (art px, seconds). Deterministic from a seed so seek(t) can replay it.
// =====================================================================================================
const DT = 1 / 30, MAXKOI = 8, MAXRIP = 12, NPADS = LAY.pads.length, MAXFLY = 20;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// smooth 1D noise from a seed (sum of incommensurate sines)
const wav = (t, s) => (Math.sin(t * 0.71 + s) + 0.6 * Math.sin(t * 1.37 + s * 2.3) + 0.35 * Math.sin(t * 2.91 + s * 4.1)) / 1.95;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Wind: still air most of the time, with a rare deliberate gust (builds over 2-4 s, holds a moment, dies away over 3-6 s).
// The schedule is deterministic and extended on demand, so seek(t) replays it.
const GUSTS = []; const gustRng = rng(3571); let gustNext = 7;
function ensureGusts(t) {
  while (gustNext < t + 90) {
    GUSTS.push({ t0: gustNext, amp: 0.5 + 0.5 * gustRng(), rise: 1.5 + 1.5 * gustRng(), hold: 0.4 + 1.2 * gustRng(), decay: 1.6 + 2.0 * gustRng() });
    gustNext += 15 + 22 * gustRng();
  }
}
function gust(t) {   // force envelope 0..1.3 at time t
  ensureGusts(t);
  let e = 0, last = -1;
  for (let i = 0; i < GUSTS.length && GUSTS[i].t0 <= t; i++) last = i;
  for (let i = last; i >= 0 && i > last - 3; i--) {
    const g = GUSTS[i], tau = t - g.t0;
    const sh = tau < g.rise ? smooth(0, 1, tau / g.rise) : tau < g.rise + g.hold ? 1 : Math.exp(-(tau - g.rise - g.hold) / g.decay);
    e += g.amp * sh;
  }
  return Math.min(e, 1.3);
}
// three damped modes (limb, strands, loose tips) driven by the gust; they ring down at their own frequencies, so nothing ticks at a fixed period
const WMODES = [{ w: 1.1, z: 0.2, G: 2.0 }, { w: 1.95, z: 0.17, G: 3.2 }, { w: 3.3, z: 0.14, G: 1.4 }], HN = 160;
function stepWind(dt) {
  const W = sim.wind, env = gust(sim.t);
  for (let m = 0; m < 3; m++) {
    const M = WMODES[m], breath = 0.05 * Math.max(0, wav(sim.t * 0.06 + m * 2.0, 1.7));
    const f = M.w * M.w * M.G * (env + breath);
    W.v[m] += (f - 2 * M.z * M.w * W.v[m] - M.w * M.w * W.x[m]) * dt;
    W.x[m] += W.v[m] * dt;
    W.hist[(W.n % HN) * 3 + m] = W.x[m];
  }
  W.n++;
}
function histAt(m, back) {   // mode displacement `back` seconds ago (the branch tip follows the root)
  const W = sim.wind, f = Math.max(0, W.n - 1 - back / DT), i0 = Math.floor(f), k = f - i0;
  const a = W.hist[(i0 % HN) * 3 + m], b = W.hist[((i0 + 1) % HN) * 3 + m];
  return W.n < 2 ? 0 : a + (b - a) * k;
}
// lantern breathing (offset of the warm light, about +-0.06 at glow 1): slow, never a flicker
const lampOffset = t => 0.06 * settings.glow * (0.5 * Math.sin(t * 0.69) + 0.3 * Math.sin(t * 1.19 + 1.3) + 0.2 * Math.sin(t * 0.37 + 4.0));
// branch sway: a root-anchored displacement (art px) of the branch layer at layer point (x, y). Zero at the trunk, growing along the
// limb and down the strands, each part lagging the root (limb 0.1-0.7 s, strands up to 1.3 s, tips more), strands slightly out of step.
function branchDisp(x, y, t) {
  const amp = settings.wind * vv('sway', 1);
  if (amp <= 0 || !sim || sim.wind.n < 2) return [0, 0];
  const u = Math.min(1, Math.hypot(x, y) / 760), uu = Math.pow(u, 1.7), hang = Math.pow(clamp(y / 470, 0, 1), 1.35);
  const ph = 0.5 + 0.5 * Math.sin(x * 0.0111);
  const a1 = uu * histAt(0, 0.1 + 0.6 * u);
  const a2 = hang * (0.8 + 0.4 * Math.sin(x * 0.0137 + 1.3)) * histAt(1, 0.12 + 0.9 * hang + 0.25 * ph);
  const a3 = Math.pow(hang, 1.5) * (0.6 + 0.4 * Math.sin(x * 0.021 + 0.4)) * histAt(2, 0.25 + 0.7 * hang + 0.4 * ph);
  return [amp * (a1 + a2 + a3), amp * (0.12 * a1 + 0.22 * a2 + 0.15 * a3)];
}
function fieldAt(x, y) {
  const gx = clamp(x / FIELD.step, 0, FIELD.w - 1.001), gy = clamp(y / FIELD.step, 0, FIELD.h - 1.001);
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, w = FIELD.w, d = FIELD.d;
  const a = d[iy * w + ix], b = d[iy * w + ix + 1], c = d[(iy + 1) * w + ix], e = d[(iy + 1) * w + ix + 1];
  let v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  if (x < 0 || y < 0 || x > AW || y > AH) v = Math.min(v, -20);
  return v;
}
function fieldGrad(x, y) { const h = 6; return [fieldAt(x + h, y) - fieldAt(x - h, y), fieldAt(x, y + h) - fieldAt(x, y - h)]; }
const surfAt = (x, y) => { const ix = Math.round(x / FIELD.step), iy = Math.round(y / FIELD.step); return ix >= 0 && iy >= 0 && ix < FIELD.w && iy < FIELD.h && FIELD.surf.charCodeAt(iy * FIELD.w + ix) === 49; };

// variety index, length (art px), lateral mirror, base cruise speed
// each fish has a home area it drifts around (keeps them spread over the whole pond; the left and centre never stay empty)
const HOMES = [[700, 620], [760, 330], [1000, 500], [1250, 350], [1450, 560], [900, 760], [1120, 190], [1330, 680]];
const ROSTER = [[0, 212, 1, 26], [4, 240, 1, 21], [2, 196, 1, 29], [1, 204, 1, 25], [3, 188, 1, 27], [0, 168, -1, 31], [1, 178, -1, 28], [2, 156, -1, 33]];
let sim;
function resetSim() {
  const R = rng(20261022);
  const koi = [];
  // start positions: well inside the swim area, spread out
  const cand = [];
  for (let iy = 0; iy < FIELD.h; iy++) for (let ix = 0; ix < FIELD.w; ix++) if (FIELD.d[iy * FIELD.w + ix] > 70) cand.push([ix * FIELD.step, iy * FIELD.step]);
  const placed = [];
  for (let i = 0; i < MAXKOI; i++) {
    let best = null, bestD = -1;
    for (let k = 0; k < 40; k++) {
      const c = cand[Math.floor(R() * cand.length)];
      const dmin = placed.reduce((m, p) => Math.min(m, Math.hypot(p[0] - c[0], p[1] - c[1])), 1e9);
      if (dmin > bestD) { bestD = dmin; best = c; }
    }
    placed.push(best);
    const [vi, len, mirror, cruise] = ROSTER[i];
    const kd = KD.koi[vi];
    const head = R() * Math.PI * 2;
    const k = {
      i, vi, kd, len, mirror, cruise, x: best[0], y: best[1], h: head, v: cruise, seed: R() * 100,
      home: HOMES[i], xmax: i === 0 ? 900 : i === 1 ? 980 : 0, depth: 0.4 + R() * 0.3, tDepth: 0.5, beat: R() * 6.28, turn: 0, mode: 'cruise', modeT: 0,
      nextBurst: 8 + R() * 30, nextHover: 20 + R() * 40, nextSurface: 18 + i * 13 + R() * 30, surf: 0, surfRip: false,
      vis: i < koiCount() ? 1 : 0, chain: [],
    };
    const segs = kd.joints;
    let px = k.x, py = k.y;
    for (let j = 0; j < segs.length; j++) { const s = segs[j] * len; k.chain.push([px - Math.cos(head) * s, py - Math.sin(head) * s]); }
    koi.push(k);
  }
  const cells = [];
  for (let iy = 0; iy < FIELD.h; iy++) for (let ix = 0; ix < FIELD.w; ix++) if (FIELD.d[iy * FIELD.w + ix] > 55) cells.push([ix * FIELD.step, iy * FIELD.step]);
  const pads = LAY.pads.map((d, i) => ({ x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, cd: 6 + i * 0.7, seed: i * 7.31 + 1.7 }));
  sim = { cells, t: 0, R: rng(777), koi, pads, wind: { x: [0, 0, 0], v: [0, 0, 0], hist: new Float32Array(3 * HN), n: 0 }, ripples: [], petals: [], nextPetal: 3, nextAmbient2: 6, lastSurface: -20, pendingRip: null };
}
function addRipple(x, y, amp, preAge = 0) {
  if (settings.water <= 0) return;
  sim.ripples.push({ x, y, t0: sim.t - preAge, amp: amp * Math.exp(0.55 * preAge) });   // preAge starts the ring at radius 34 * preAge; the amp makes up the fade
  if (sim.ripples.length > MAXRIP) sim.ripples.shift();
}
function pickTarget(k) {
  const R = sim.R; let best = null, bestS = -1e9;
  for (let n = 0; n < 18; n++) {
    const c = sim.cells[Math.floor(R() * sim.cells.length)];
    let s = Math.min(420, Math.hypot(c[0] - k.x, c[1] - k.y)) * 0.6 - Math.min(700, Math.hypot(c[0] - k.home[0], c[1] - k.home[1])) * 0.9;   // go somewhere, but stay around the home area
    for (const o of sim.koi) {
      if (o === k || o.vis <= 0) continue;
      s += Math.min(Math.hypot(c[0] - o.x, c[1] - o.y), 400) * 0.5;
      if (o.tx !== undefined) s += Math.min(Math.hypot(c[0] - o.tx, c[1] - o.ty), 400) * 0.7;
    }
    if (k.xmax && c[0] > k.xmax) s -= (c[0] - k.xmax) * 1.6;           // two fish stay in the left and centre water
    if (s > bestS) { bestS = s; best = c; }
  }
  k.tx = best[0] + (R() - 0.5) * 16; k.ty = best[1] + (R() - 0.5) * 16; k.tUntil = sim.t + 22 + R() * 26;
}
function stepKoi(k, dt) {
  const act = activity(), t = sim.t, R = sim.R;
  const active = k.i < koiCount();
  k.vis = clamp(k.vis + (active ? dt / 2.5 : -dt / 2.5), 0, 1);
  // ---- speed modes: cruise, short bursts, slow hovering
  k.modeT -= dt;
  if (k.mode === 'cruise') {
    if (t > k.nextBurst) { k.mode = 'burst'; k.modeT = 1.1 + R() * 0.9; k.nextBurst = t + (14 + R() * 34) / act; }
    else if (t > k.nextHover) { k.mode = 'hover'; k.modeT = 4 + R() * 5; k.nextHover = t + (30 + R() * 40) / act; }
  } else if (k.modeT <= 0) k.mode = 'cruise';
  const target = k.mode === 'burst' ? k.cruise * 3.4 * act : k.mode === 'hover' ? 5 : k.cruise * (0.85 + 0.3 * wav(t * 0.11, k.seed)) * act;
  k.v += (target - k.v) * Math.min(1, dt * (k.mode === 'burst' ? 2.4 : 0.55));
  // ---- steering: wander + stay in the swim area + keep apart
  // wander toward a roaming target spread over the whole open water (retargeted when reached, stale or crowded)
  if (k.tx === undefined || t > k.tUntil || Math.hypot(k.tx - k.x, k.ty - k.y) < 0.7 * k.len) pickTarget(k);
  let turn = 0.2 * wav(t * 0.23, k.seed * 3.1) + 0.08 * wav(t * 0.61, k.seed);
  { let d = Math.atan2(k.ty - k.y, k.tx - k.x) - k.h; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += clamp(d, -1, 1) * 0.42; }
  const fx = Math.cos(k.h), fy = Math.sin(k.h);
  const look = 0.55 * k.len + k.v * 1.3, margin = 0.45 * k.len + 18;
  const lx = k.x + fx * look, ly = k.y + fy * look;
  const sd = fieldAt(lx, ly);
  let brake = 1;
  if (sd < margin) {
    // feelers left and right pick a turning side once, and keep it until clear (no dithering head-on into a bank)
    if (!k.avoid) {
      const pl = fieldAt(k.x + Math.cos(k.h + 0.7) * look, k.y + Math.sin(k.h + 0.7) * look);
      const pr = fieldAt(k.x + Math.cos(k.h - 0.7) * look, k.y + Math.sin(k.h - 0.7) * look);
      k.avoid = pl >= pr ? 1 : -1;
    }
    const s = clamp((margin - sd) / margin, 0, 1.5);
    turn = turn * (1 - Math.min(1, s)) + k.avoid * s * 1.5;
    brake = 1 - 0.45 * Math.min(1, s);
  } else if (sd > margin * 1.3) k.avoid = 0;
  let crowd = 0;
  for (const o of sim.koi) {
    if (o === k || o.vis <= 0 || k.vis <= 0) continue;
    // compare body centres (half a length behind the head), keep a body length apart; overlaps stay rare and brief
    const ox = o.x - Math.cos(o.h) * o.len * 0.45, oy = o.y - Math.sin(o.h) * o.len * 0.45;
    const kx = k.x - fx * k.len * 0.45, ky = k.y - fy * k.len * 0.45;
    const dx = ox - kx, dy = oy - ky, dist = Math.hypot(dx, dy), near = 1.25 * (k.len + o.len) / 2;
    if (dist < 1.6 * near) crowd++;
    if (dist < near) {
      const w = 1;                                   // keep apart at every depth
      let d = Math.atan2(dy, dx) - k.h; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 2.0) turn -= Math.sign(d || 1) * 1.1 * w * (1 - dist / near);
      k.tDepth += (k.depth > o.depth ? 1 : -1) * dt * 0.25;
    }
  }
  if (crowd >= 2 && t > (k.retargetT || 0)) { pickTarget(k); k.retargetT = t + 6; }
  const maxTurn = (k.mode === 'burst' ? 1.6 : 0.75) * (0.6 + 0.4 * act) * (k.avoid ? 1.5 : 1) * clamp(0.25 + k.v / (k.cruise * 1.2), 0.25, 1.2);
  turn = clamp(turn, -maxTurn, maxTurn);
  k.turn += (turn - k.turn) * Math.min(1, dt * 2.0);
  k.h += k.turn * dt;
  k.x += Math.cos(k.h) * k.v * brake * dt; k.y += Math.sin(k.h) * k.v * brake * dt;
  // soft personal space: fish never sit on top of one another (overlaps shorter than a moment are the rule; a stack is not)
  for (const o of sim.koi) {
    if (o === k || o.vis <= 0 || k.vis <= 0) continue;
    const dx = k.x - o.x, dy = k.y - o.y, dist = Math.hypot(dx, dy) + 1e-3, need = 0.55 * (k.len + o.len) / 2;
    if (dist < need) { const push = (need - dist) * Math.min(1, dt * 3.5); k.x += dx / dist * push; k.y += dy / dist * push; }
  }
  // hard guard: never cross into the banks
  const here = fieldAt(k.x, k.y);
  if (here < 4) { const g = fieldGrad(k.x, k.y), n = Math.hypot(g[0], g[1]) || 1; k.x += g[0] / n * (4 - here) * 0.5; k.y += g[1] / n * (4 - here) * 0.5; }
  // ---- depth: slow drift, occasional rise to the surface with a ring at the mouth
  if (k.surf === 0 && t > k.nextSurface && t - sim.lastSurface > 14 / act && k.v < k.cruise * 1.6) { k.surf = 1; k.surfT = 0; k.surfRip = false; sim.lastSurface = t; }
  if (k.surf) {
    k.surfT += dt;
    k.tDepth = k.surfT < 4.2 ? 0.0 : 0.55;
    if (!k.surfRip && k.depth < 0.07) { k.surfRip = true; if (k.vis > 0.5) { const hx = k.x + Math.cos(k.h) * 4, hy = k.y + Math.sin(k.h) * 4; addRipple(hx, hy, 1.0); sim.pendingRip = { x: hx, y: hy, t: t + 0.9 }; } }
    if (k.surfT > 7) { k.surf = 0; k.nextSurface = t + (40 + R() * 70) / act; }
  } else k.tDepth = clamp(0.5 + 0.28 * wav(t * 0.05, k.seed * 1.7), 0.15, 0.85);
  const rate = k.surf ? 0.28 : 0.08;
  k.depth += clamp(k.tDepth - k.depth, -rate * dt, rate * dt);
  // ---- body chain follows the head (follow-the-leader keeps the spine on the swim path)
  const j = k.kd.joints;
  k.chain[0][0] = k.x; k.chain[0][1] = k.y;
  let prev = k.h;
  for (let s = 1; s < j.length; s++) {
    const a = k.chain[s - 1], b = k.chain[s], L = (j[s] - j[s - 1]) * k.len;
    let ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
    let d = Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
    const lim = s >= j.length - 2 ? 0.42 : 0.3;            // stiff body, a little more freedom at the peduncle
    if (Math.abs(d) > lim) ang = prev + Math.sign(d) * lim;
    b[0] = a[0] - Math.cos(ang) * L; b[1] = a[1] - Math.sin(ang) * L;
    prev = ang;
  }
  const sn = clamp(k.v / 90, 0, 1);
  k.beat += dt * Math.PI * 2 * (0.45 + 1.9 * sn);
  k.beatAmp = 0.07 + 0.32 * sn + 0.25 * Math.abs(k.turn) * 0.3;
}
// Lily pads: still until something touches them. A koi swimming under one (more if it is near the surface and quick) or a passing ring
// pushes it a few pixels and turns it a degree or two, a slow spring brings it back; a firm nudge sends one ring from the pad's rim.
const PAD_MAX = 6.5, PAD_AMAX = 0.05;
function stepPads(dt) {
  const t = sim.t, on = settings.water > 0 && vv('pads', 1) > 0, w = settings.water;
  for (let i = 0; i < NPADS; i++) {
    const p = sim.pads[i], d = LAY.pads[i];
    if (!on) { p.x = p.vx = p.y = p.vy = p.a = p.va = 0; continue; }
    let fx = 0, fy = 0, torque = 0;
    for (const k of sim.koi) {
      if (k.vis < 0.3 || k.depth > 0.9) continue;
      const pts = [[k.x, k.y], k.chain[2], k.chain[3]];
      for (let q = 0; q < pts.length; q++) {
        const dx = d.cx + p.x - pts[q][0], dy = d.cy + p.y - pts[q][1], dist = Math.hypot(dx, dy) + 1e-3;
        const reach = d.r * 0.95 + 18;
        if (dist < reach) {
          const s = 1 - dist / reach, f = 22 * s * clamp(k.v / 30, 0.4, 2.4) * (1 - 0.7 * k.depth) * (q === 0 ? 1 : 0.7);
          fx += dx / dist * f; fy += dy / dist * f;
          torque += (dx * Math.sin(k.h) - dy * Math.cos(k.h)) / reach * f * 0.012;
        }
      }
    }
    for (const r of sim.ripples) {
      const age = sim.t - r.t0, dx = d.cx - r.x, dy = d.cy - r.y, dist = Math.hypot(dx, dy) + 1e-3, front = age * 34;
      const e = Math.exp(-Math.pow((dist - front) / 12, 2)) * r.amp * Math.exp(-age * 0.55);
      if (e > 0.01) { fx += dx / dist * 9 * e; fy += dy / dist * 9 * e; }
    }
    p.vx += (fx - 2.2 * p.vx - 1.2 * p.x) * dt; p.vy += (fy - 2.2 * p.vy - 1.2 * p.y) * dt;     // period about 5 s, critically damped
    p.va += (torque - 2.2 * p.va - 1.2 * p.a) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.a += p.va * dt;
    const m = Math.hypot(p.x, p.y);
    if (m > PAD_MAX) { p.x *= PAD_MAX / m; p.y *= PAD_MAX / m; p.vx *= 0.5; p.vy *= 0.5; }
    p.a = clamp(p.a, -PAD_AMAX, PAD_AMAX);
    if (t > p.cd && Math.hypot(p.vx, p.vy) > 1.2 && w > 0) { addRipple(d.cx + p.x, d.cy + p.y, 0.45, d.r / 34); p.cd = t + 6; }
  }
}
function stepPetals(dt) {
  const R = sim.R, t = sim.t, rate = settings.petals;
  if (rate > 0 && t > sim.nextPetal) {
    const g = gust(t);
    sim.nextPetal = t + (3.5 + R() * 7) / rate / (0.6 + 2.4 * g);        // a few in the calm, a shower in a gust
    // most petals drift out from under the branch and settle on open water; a few land on the bank and vanish
    let b, dur, wind, lx, ly;
    const wk = 0.45 + 0.55 * settings.wind;
    for (let k = 0; k < 10; k++) {
      b = FIELD.blossoms[Math.floor(R() * FIELD.blossoms.length)];
      dur = 4.2 + R() * 2.2; wind = [(14 + R() * 16) * wk * (0.75 + 0.5 * g), (5 + R() * 10) * wk * (0.75 + 0.5 * g)];
      lx = b[0] + wind[0] * dur; ly = b[1] + wind[1] * dur;
      if (surfAt(lx, ly)) break;
    }
    const bd = branchDisp(b[0], b[1], t);                             // leave from where the blossom is now
    sim.petals.push({ x0: b[0] + bd[0], y0: b[1] + bd[1], x: b[0], y: b[1], wx: wind[0], wy: wind[1], t0: t, dur, land: surfAt(lx, ly), rot: R() * 6.28, spin: (R() - 0.5) * 3, seed: R() * 50, floating: false, life: 80 + R() * 70, tint: R() });
    if (sim.petals.length > 28) sim.petals.shift();
  }
  for (const p of sim.petals) {
    const age = t - p.t0;
    if (!p.floating) {
      const f = Math.min(1, age / p.dur);
      p.x = p.x0 + p.wx * age + 6 * Math.sin(age * 2.1 + p.seed);
      p.y = p.y0 + p.wy * age + 3 * Math.sin(age * 1.3 + p.seed);
      p.rot += p.spin * dt;
      if (f >= 1) {
        if (p.land && surfAt(p.x, p.y)) { p.floating = true; p.tf = t; addRipple(p.x, p.y, 0.32); }
        else p.dead = true;
      }
    } else {
      // slow surface current (gentle swirl) + a little wander; stops at pads and banks
      const cx = 6 + 2.4 * Math.sin(p.y * 0.004 + t * 0.03), cy = 0.8 + 2.0 * Math.cos(p.x * 0.003 + t * 0.02);   // a slow current carries them out across the pond
      const nx = p.x + (cx + 0.8 * wav(t * 0.2, p.seed)) * dt, ny = p.y + (cy + 0.8 * wav(t * 0.17, p.seed + 3)) * dt;
      if (surfAt(nx, ny)) { p.x = nx; p.y = ny; }
      p.rot += 0.04 * wav(t * 0.3, p.seed) * dt;
      if (t - p.tf > p.life) p.dead = true;
    }
  }
  sim.petals = sim.petals.filter(p => !p.dead);
}
function ambientRipples() {
  const R = sim.R, t = sim.t;
  if (settings.water <= 0) return;
  if (sim.nextAmbient2 === undefined) sim.nextAmbient2 = 6;
  if (t > sim.nextAmbient2) {
    sim.nextAmbient2 = t + (8 + R() * 14) / Math.max(0.3, settings.water);
    for (let k = 0; k < 12; k++) {
      const x = 480 + R() * 1150, y = 60 + R() * 760;
      if (surfAt(x, y)) { addRipple(x, y, 0.45); break; }
    }
  }
  if (sim.pendingRip && t >= sim.pendingRip.t) { addRipple(sim.pendingRip.x, sim.pendingRip.y, 0.55); sim.pendingRip = null; }
}
function advanceSim(target, cap = 900) {
  let n = 0;
  while (sim.t + DT <= target && n < cap) {
    sim.t += DT; n++;
    for (const k of sim.koi) stepKoi(k, DT);
    stepWind(DT);
    stepPads(DT);
    stepPetals(DT);
    ambientRipples();
  }
  if (n >= cap) sim.t = target;   // after a long stall, skip ahead instead of replaying minutes of motion
  sim.ripples = sim.ripples.filter(r => sim.t - r.t0 < 7);
}
// Fireflies: closed-form drifting paths (no state), each with a slow glow cycle of 8-20 s. Anchors cluster around the lantern.
const FLY = (() => {
  const R = rng(4242), out = [];
  // [x0, x1, y0, y1, n]: around the lantern, over the shallows, and over the open water on the right
  const zones = [[40, 420, 520, 900, 4], [300, 760, 200, 640, 4], [800, 1560, 80, 820, 9], [420, 1100, 760, 910, 3]];
  for (const [x0, x1, y0, y1, n] of zones) for (let i = 0; i < n; i++) out.push({ cx: x0 + R() * (x1 - x0), cy: y0 + R() * (y1 - y0), rx: 40 + R() * 70, ry: 30 + R() * 55, ph: R() * 6.28, sp: 0.55 + R() * 0.6, gp: 0.32 + R() * 0.4 });
  return out;
})();
const FLY_ORDER = [4, 8, 0, 12, 5, 9, 1, 13, 6, 10, 2, 14, 7, 11, 3, 15, 16, 17, 18, 19];   // spread over the zones as the count rises
function flyAt(f, t) {
  const a = t * 0.075 * f.sp + f.ph;
  return [f.cx + f.rx * Math.sin(a) + 0.35 * f.rx * Math.sin(a * 2.7 + 1.1), f.cy + f.ry * Math.sin(a * 0.83 + 2.0) + 0.3 * f.ry * Math.sin(a * 2.3)];
}

// =====================================================================================================
// Rendering
// =====================================================================================================
const VS_FULL = `attribute vec2 p;varying vec2 s;void main(){s=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;
// pass A, painting (the clean plate)
const FS_ART = `precision highp float;varying vec2 s;uniform sampler2D art;uniform vec4 win;
void main(){gl_FragColor=vec4(texture2D(art,win.xy+s*win.zw).rgb,0.);}`;   // alpha 0: koi coverage goes here
// shared: warm lantern light on lit areas of the painting (W = warm mask, lo = breathing offset)
const LIGHT = `vec3 lampLight(vec3 c,float W,float lo){return c*(1.+W*lo*1.1)+vec3(1.,.55,.2)*W*lo*.10;}`;
// koi pieces (premultiplied output). a: x y (art px) | u v (atlas) | su fA fB | depth alpha
const VS_KOI = `attribute vec2 pos;attribute vec2 uv;attribute float su;attribute vec4 fe;attribute vec2 da;uniform vec4 win;uniform float mode;
varying vec2 vuv;varying float vsu;varying vec4 vfe;varying vec2 vda;varying vec2 vart;
void main(){vec2 p=pos;if(mode>.5)p+=vec2(.75,1.)*(3.+(1.-da.x)*13.);
vart=p/vec2(${AW}.,${AH}.);vec2 s=(vart-win.xy)/win.zw;vuv=uv;vsu=su;vfe=fe;vda=da;gl_Position=vec4(s.x*2.-1.,1.-s.y*2.,0.,1.);}`;
const FS_KOI = `precision highp float;varying vec2 vuv;varying float vsu;varying vec4 vfe;varying vec2 vda;varying vec2 vart;
uniform sampler2D atlas,art,masks;uniform float mode,time;
vec2 wob(vec2 p,float t){return vec2(sin(p.x*.031+p.y*.017+t*.9)+.6*sin(p.y*.047-p.x*.011-t*1.3+1.7),sin(p.y*.029-p.x*.021+t*.8+2.3)+.6*sin(p.x*.053+p.y*.019+t*1.1))*.625;}
void main(){
  float depth=vda.x;
  // joints: each piece fades in just ahead of its front joint and out just behind its rear joint, so a bend never
  // opens a hard gap. Shadows use complementary ramps (no darker band where two pieces overlap).
  float e=vfe.w-vfe.z;
  float ramp=mode>.5 ? clamp((vsu-vfe.x)/max(vfe.y-vfe.x,1e-3),0.,1.)*(1.-clamp((vsu-vfe.z+e)/max(e,1e-3),0.,1.))
                     : clamp((vsu-vfe.x)/max(vfe.y-vfe.x,1e-3),0.,1.)*(1.-clamp((vsu-vfe.z)/max(e,1e-3),0.,1.));
  vec4 m=texture2D(masks,vart);
  if(mode>.5){
    vec4 t=texture2D(atlas,vuv,2.2+depth*1.8);
    float a=t.a*ramp*vda.y*(.16+.42*m.b)*(.55+.45*(1.-depth));
    gl_FragColor=vec4(vec3(.01,.03,.03)*a,a);return;}
  vec2 pa0=vart*vec2(${AW}.,${AH}.);
  // the water surface over the fish: a slow, very small refraction (about 1 px) of the sprite
  vec2 uvw=vuv+wob(pa0,time)*(3./2048.)*(.55+.45*depth);
  vec4 t=texture2D(atlas,uvw,.3+depth*1.5);
  if(t.a<.002)discard;
  vec3 c=t.rgb/t.a;
  // ink rim: the sprite's edge gets a thin dark line (about 1 art px), like the lines on the pads and rocks, a little softer when deep
  float dd=6./2048.;
  float an=.25*(texture2D(atlas,uvw+vec2(dd,0.),.6).a+texture2D(atlas,uvw-vec2(dd,0.),.6).a+texture2D(atlas,uvw+vec2(0.,dd),.6).a+texture2D(atlas,uvw-vec2(0.,dd),.6).a);
  float edge=clamp((t.a-an)*4.5,0.,1.);
  vec3 below=texture2D(art,vart).rgb;
  // under the surface, never on it: lower contrast and saturation, cool dusk light, the local water tone (more with depth), whites kept
  // below the lily pads' highlights. Warm where the lantern light reaches the lit shallows.
  float g=dot(c,vec3(.3,.55,.15));
  c=mix(c,vec3(g),.05+.10*depth);                             // keep the colour: kohaku red and orange stay saturated
  c*=mix(vec3(1.),vec3(.82,.95,1.),.4+.4*depth);
  float hi=smoothstep(.42,.80,g);                              // highlights (whites) are not darkened as much as the midtones: they catch the cool moonlight
  c*=mix(vec3(.54,.44,.57),vec3(.52,.60,.76),hi);              // dusk light: midtones dim and cool, highlights clearer
  vec2 pl=pa0-vec2(${LAMP[0].toFixed(1)},${LAMP[1].toFixed(1)});
  float lk=exp(-dot(pl,pl)/(2.*400.*400.))*(.3+.7*m.b);
  c*=1.+lk*vec3(1.5,.75,.1); c+=vec3(.045,.02,.0)*lk;
  float band=sin(pa0.x*.021+pa0.y*.013+time*.35)*sin(pa0.y*.027-pa0.x*.009+time*.28);   // slow light bands drifting over the fish
  c*=1.+.16*band*(1.-.5*depth);
  vec3 water=below*1.05+vec3(.0,.012,.02);
  c=mix(c,water,(.20+.42*depth)*(1.-.5*hi));               // deep fish sink into the water colour, but highlights stay clear
  c*=mix(.98,.80,depth);
  c=mix(c,vec3(.02,.016,.022),edge*.95*(1.-.3*depth));
  float a=t.a*ramp*vda.y*(1.-.25*depth);
  gl_FragColor=vec4(c*a,a);
}`;
// pass B: water. ripples (art px) -> local refraction + soft shading; sky film; lantern light on the water; lamp breathing.
const FS_WATER = `precision highp float;varying vec2 s;
uniform sampler2D under,art,masks;uniform vec4 win;uniform float time,sheen,ripAmt,lamp,glow;uniform float lightMode,waterMode;uniform vec4 rip[${MAXRIP}];
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return .55*vn(p)+.3*vn(p*2.03+7.1)+.15*vn(p*4.01+3.7);}
${LIGHT}
void main(){
  vec2 auv=win.xy+s*win.zw; vec2 p=auv*vec2(${AW}.,${AH}.);
  vec4 m=texture2D(masks,auv); float water=m.r; float shallow=m.b; float warm=m.g;
  vec2 grad=vec2(0.); float hsum=0.; float ink=0., inner=0.;
  for(int i=0;i<${MAXRIP};i++){
    vec4 r=rip[i]; if(r.w<=0.)continue;
    vec2 d=p-r.xy; float rr=length(d)+1e-3; float age=r.z;
    float R=age*34.; float w=6.+age*4.5;
    float env=r.w*exp(-pow((rr-R)/w,2.))*exp(-age*.55)*smoothstep(0.,.25,age)*smoothstep(0.,14.,rr+6.);
    float ph=(rr-R)*.42;
    hsum+=env*sin(ph); grad+=d/rr*env*cos(ph);
    // drawn ring: a thin, uneven, slightly broken dark line with a paler inner edge, plus a fainter second ring
    float th=atan(d.y,d.x), sd=r.x*.37+r.y*.11;
    float uneven=.55+.45*sin(th*3.+sd)*sin(th*5.-sd*1.7+age*.4);
    uneven=clamp(uneven+.25,0.,1.)*smoothstep(-.2,.35,sin(th*2.+sd*2.3));
    float lw=.9+age*.35;
    float fade=r.w*exp(-age*.5)*smoothstep(0.,.3,age);
    for(int j=0;j<2;j++){float Rj=j==0?R:R*.62; float wj=j==0?1.:.55;
      ink+=fade*wj*uneven*exp(-pow((rr-Rj)/lw,2.));
      inner+=fade*wj*uneven*exp(-pow((rr-(Rj-lw*2.4))/(lw*1.3),2.));}
  }
  grad*=ripAmt*water; hsum*=ripAmt*water;
  vec2 off=grad*1.8/vec2(${AW}.,${AH}.)/win.zw;
  vec4 U=texture2D(under,vec2(s.x,1.-s.y)+vec2(off.x,-off.y)); vec3 c=U.rgb; float koiA=U.a;
  // ripple light: one side of each ring catches the sky, the other darkens a touch
  float lit=dot(grad,normalize(vec2(-.6,-.8)));
  c+=vec3(.40,.50,.66)*clamp(lit,-1.,1.)*.05;
  float wv=ripAmt*water;
  c*=1.-clamp(ink*wv,0.,1.)*.42;
  c+=vec3(.40,.50,.62)*clamp(inner*wv,0.,1.)*.10;
  if(waterMode<.5){
    // previous look: a faint sky film over the deep water
    float n=fbm(p*.0021+vec2(time*.0045,time*.0018));
    float n2=fbm(p*.0052-vec2(time*.0031,-time*.0042)+11.);
    float band=smoothstep(.44,.78,n)*(.55+.45*n2);
    float grade=.55+.45*smoothstep(0.,1.,(p.x/${AW}.)*.8+(1.-p.y/${AH}.)*.4);
    float sh=sheen*(band*.10*(1.-.75*shallow)+koiA*.04)*grade;
    c=1.-(1.-c)*(1.-vec3(.38,.50,.74)*sh);
  } else {
    // moonlit pond: a cool lift toward the upper right (a few tens of levels, so the water is no flat slab), and a soft sky-reflection
    // film whose bands drift slowly across it (wide, a little stretched sideways, two scales moving at different speeds)
    float moon=smoothstep(-.05,.95,(p.x/${AW}.)*.75+(1.-p.y/${AH}.)*.5-.30);
    float lift=moon*water*(1.-.65*shallow);
    c+=vec3(.020,.056,.105)*lift*sheen;
    float nb=fbm(p*vec2(.0016,.0036)+vec2(time*.0042,time*.0016));
    float nb2=fbm(p*vec2(.0042,.0085)-vec2(time*.010,-time*.004)+5.3);
    float bands=smoothstep(.40,.74,nb)*(.5+.5*nb2);
    c=1.-(1.-c)*(1.-vec3(.30,.44,.68)*sheen*bands*.26*(.35+.65*moon)*(1.-.75*shallow)*water-vec3(.03)*koiA*sheen);
  }
  if(waterMode>1.5){
    // the lantern's reflection breaks on the rings: ring crests near the lantern catch warm light instead of cool sky
    vec2 ql=p-vec2(${LAMP[0].toFixed(1)},${LAMP[1].toFixed(1)});
    float lw=exp(-dot(ql,ql)/(2.*700.*700.))*water;
    c+=vec3(1.,.60,.26)*clamp(lit,0.,1.)*lw*glow*.12;
    c+=vec3(1.,.60,.26)*clamp(inner*wv,0.,1.)*lw*glow*.10;
  }
  // lantern light on the water: the painted warm light on the shallow bed drifts slowly (never twinkles)
  if(lightMode>.5){
    vec2 pl=p-vec2(${LAMP[0].toFixed(1)},${LAMP[1].toFixed(1)});
    float field=exp(-dot(pl,pl)/(2.*340.*340.))*(.35+.65*shallow)*water;
    float f=fbm(p*.011+vec2(time*.011,-time*.006));
    if(lightMode<1.5){                                                       // the lit pebbles slowly brighten and dim in drifting patches
      float pat=smoothstep(.30,.75,f)-.5;
      c*=1.+field*pat*glow*1.1*(.4+.6*warm);
      c+=vec3(1.,.62,.28)*field*max(pat,0.)*glow*.05;
    } else {                                                                 // slow wavering contour lines of warm light
      float d=abs(fract(f*6.)-.5); float pat=smoothstep(.10,.0,d);
      c+=vec3(1.,.62,.28)*field*pat*glow*.12;
    }
  }
  vec3 a=texture2D(art,auv).rgb;
  vec3 col=mix(a,c,water);
  gl_FragColor=vec4(lampLight(col,warm,lamp),1.);
}`;
// layers (lily pads, one quad each; branch mesh): premultiplied RGBA from the atlas, lantern breathing applied
const VS_LAY = `attribute vec2 pos;attribute vec2 uv;uniform vec4 win;varying vec2 vuv;varying vec2 vart;
void main(){vart=pos/vec2(${AW}.,${AH}.);vec2 s=(vart-win.xy)/win.zw;vuv=uv;gl_Position=vec4(s.x*2.-1.,1.-s.y*2.,0.,1.);}`;
const FS_LAY = `precision highp float;varying vec2 vuv;varying vec2 vart;uniform sampler2D lay,masks;uniform float lamp;
${LIGHT}
void main(){
  vec4 t=texture2D(lay,vuv); if(t.a<.002)discard;
  float W=texture2D(masks,vart).g;
  gl_FragColor=vec4(lampLight(t.rgb,W,lamp),t.a);
}`;
// petals: pos(art px) local(-1..1) | px size, alpha, mode(0 air, 1 floating, 2 floating shadow), tint
const VS_PET = `attribute vec2 pos;attribute vec2 loc;attribute vec4 prm;uniform vec4 win;varying vec2 vl;varying vec4 vp;varying vec2 vart;
void main(){vart=pos/vec2(${AW}.,${AH}.);vec2 s=(vart-win.xy)/win.zw;vl=loc;vp=prm;gl_Position=vec4(s.x*2.-1.,1.-s.y*2.,0.,1.);}`;
const FS_PET = `precision highp float;varying vec2 vl;varying vec4 vp;varying vec2 vart;uniform sampler2D masks;uniform float lamp;
${LIGHT}
void main(){
  vec2 q=vl; float aa=2.4/max(vp.x,2.);
  // single cherry petal: rounded teardrop, notch at the outer tip
  float d=length(vec2(q.x*1.55,(q.y+.12)*1.02))-.86;
  d=max(d,-(length(q-vec2(0.,1.02))-.2));
  float fill=1.-smoothstep(-aa,aa,d);
  if(fill<=0.)discard;
  float edge=smoothstep(-.2-aa,-.2+aa,d);
  vec3 c=mix(vec3(.96,.86,.84),vec3(.93,.74,.75),clamp(.5-q.y*.5,0.,1.)*.8+vp.w*.2);
  c=mix(c,vec3(.72,.48,.46),edge*.75);
  c*=vec3(.78,.78,.9);                                         // dusk light on the petals
  vec4 m=texture2D(masks,vart);
  c=lampLight(c,m.g,lamp);
  float a=fill*vp.y;
  if(vp.z>.5){a*=smoothstep(.5,.9,m.r);
    if(vp.z>1.5){gl_FragColor=vec4(vec3(.0,.02,.02)*a*.35,a*.35);return;}
    c*=.85;}
  gl_FragColor=vec4(c*a,a);
}`;
// fireflies: pos(art px) local(-1..1) | alpha, px per local unit
const VS_FLY = `attribute vec2 pos;attribute vec2 loc;attribute vec2 prm;uniform vec4 win;varying vec2 vl;varying vec2 vp;
void main(){vec2 s=(pos/vec2(${AW}.,${AH}.)-win.xy)/win.zw;vl=loc;vp=prm;gl_Position=vec4(s.x*2.-1.,1.-s.y*2.,0.,1.);}`;
const FS_FLY = `precision highp float;varying vec2 vl;varying vec2 vp;uniform float fs;
void main(){
  float r=length(vl)*vp.y;                                    // art px from the centre
  float core=exp(-r*r/(2.25*fs*fs)), halo=exp(-r*r/(42.25*fs*fs));
  float a=vp.x*(core+.26*halo);
  vec3 c=mix(vec3(1.,.82,.38),vec3(1.,.97,.8),core);
  gl_FragColor=vec4(c*a,a*.55);                              // additive
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs, attrs, unis) {
  const pr = gl.createProgram();
  gl.attachShader(pr, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(pr));
  const o = { pr, a: {}, u: {} };
  for (const a of attrs) o.a[a] = gl.getAttribLocation(pr, a);
  for (const u of unis) o.u[u] = gl.getUniformLocation(pr, u);
  return o;
}
function potCanvas(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
  return c;
}
function makeTex(src, { mip = false, premul = false } = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
// branch mesh: a grid over the layer box, vertex positions displaced by the sway each frame
const BNX = 40, BNY = 26;
let branchVerts, branchIdx;
function setupBranch() {
  const b = LAY.branch.box, w = b[2], h = b[3];
  branchVerts = new Float32Array((BNX + 1) * (BNY + 1) * 4);
  const idx = [];
  for (let j = 0; j < BNY; j++) for (let i = 0; i < BNX; i++) { const a = j * (BNX + 1) + i, c = a + 1, d = a + BNX + 1, e = d + 1; idx.push(a, c, e, a, e, d); }
  branchIdx = new Uint16Array(idx);
  buf.branch = gl.createBuffer(); buf.branchIdx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.branchIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, branchIdx, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  const S = LAY.branch.scale, TW = LAY.branch.tex[0], TH = LAY.branch.tex[1];
  for (let j = 0; j <= BNY; j++) for (let i = 0; i <= BNX; i++) {
    const o = (j * (BNX + 1) + i) * 4, x = w * i / BNX, y = h * j / BNY;
    branchVerts[o] = x; branchVerts[o + 1] = y; branchVerts[o + 2] = x * S / TW; branchVerts[o + 3] = y * S / TH;
  }
  branchVerts.rest = Float32Array.from(branchVerts);
}
function setup() {
  P.art = program(VS_FULL, FS_ART, ['p'], ['art', 'win']);
  P.koi = program(VS_KOI, FS_KOI, ['pos', 'uv', 'su', 'fe', 'da'], ['win', 'mode', 'time', 'atlas', 'art', 'masks']);
  P.water = program(VS_FULL, FS_WATER, ['p'], ['under', 'art', 'masks', 'win', 'time', 'sheen', 'ripAmt', 'lamp', 'glow', 'lightMode', 'waterMode', 'rip']);
  P.lay = program(VS_LAY, FS_LAY, ['pos', 'uv'], ['win', 'lay', 'masks', 'lamp']);
  P.pet = program(VS_PET, FS_PET, ['pos', 'loc', 'prm'], ['win', 'masks', 'lamp']);
  P.fly = program(VS_FLY, FS_FLY, ['pos', 'loc', 'prm'], ['win', 'fs']);
  buf.tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  buf.koi = gl.createBuffer(); buf.pet = gl.createBuffer(); buf.pad = gl.createBuffer(); buf.fly = gl.createBuffer();
  // painting and masks are resampled once to power-of-two sizes so they can be mip-mapped (clean at any screen size)
  tex.art = makeTex(potCanvas(images.plate, 4096, 2048), { mip: true });
  tex.masks = makeTex(potCanvas(images.masks, 2048, 1024));
  tex.atlas = makeTex(images.atlas, { mip: true, premul: true });
  tex.pads = makeTex(images.layers, { mip: true, premul: true });       // already 2048x1024, 1:1 with the 2x master
  tex.branch = makeTex(images.branch, { mip: true, premul: true });
  setupBranch();
  fbo = gl.createFramebuffer(); fboTex = null;
  lost = false; ready = true; resize(); draw();
  canvas.classList.add('on');
  schedule();
}
function resize() {
  if (!gl || lost || gl.isContextLost()) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round(innerWidth * dpr * settings.quality), h = Math.round(innerHeight * dpr * settings.quality);
  const cap = Math.min(1, Math.sqrt(3840 * 2160 / Math.max(1, w * h)), gl.getParameter(gl.MAX_TEXTURE_SIZE) / Math.max(w, h, 1));
  w = Math.max(1, Math.floor(w * cap)); h = Math.max(1, Math.floor(h * cap));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (ready) {
    if (fboTex) gl.deleteTexture(fboTex);
    fboTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // cover-fit window into the art (art uv), cropped around FOCUS, never stretched
  const a = w / h, r = AW / AH;
  if (a > r) { const dv = r / a; win = [0, clamp(FOCUS[1] - dv / 2, 0, 1 - dv), 1, dv]; }
  else { const du = a / r; win = [clamp(FOCUS[0] - du / 2, 0, 1 - du), 0, du, 1]; }
  if (ready) draw();
}

// ---- koi geometry -> vertex data
const KV = 11;  // floats per vertex: x y u v su inA inB outA outB depth alpha
let koiVerts = new Float32Array(MAXKOI * 9 * 6 * KV), petVerts = new Float32Array(40 * 2 * 6 * 8), padVerts = new Float32Array(NPADS * 6 * 4), flyVerts = new Float32Array(MAXFLY * 6 * 6);
function pushQuad(arr, o, corners) { // corners: 4 vertices (each array of KV floats) in order 0,1,2,3 around the quad
  for (const i of [0, 1, 2, 0, 2, 3]) { arr.set(corners[i], o); o += corners[i].length; }
  return o;
}
function buildKoi() {
  let o = 0;
  const A = KD.atlas;
  const list = sim.koi.filter(k => k.vis > 0.003).sort((a, b) => b.depth - a.depth);
  for (const k of list) {
    const kd = k.kd, J = kd.joints, Lc = kd.length, sc = k.len / Lc, hx = kd.head[0], hy = kd.head[1];
    const nseg = J.length - 1, ov = 0.05;
    // segment angles from the chain + travelling tail beat (stronger toward the tail)
    const W = [0.04, 0.1, 0.28, 0.6, 1.0];
    const ang = [], R = [[k.chain[0][0], k.chain[0][1]]];
    for (let s = 0; s < nseg; s++) {
      const a = k.chain[s], b = k.chain[s + 1];
      ang.push(Math.atan2(a[1] - b[1], a[0] - b[0]) + k.beatAmp * W[s] * Math.sin(k.beat - s * 0.95));
    }
    for (let s = 0; s < nseg; s++) {
      const L = (J[s + 1] - J[s]) * k.len;
      R.push([R[s][0] - Math.cos(ang[s]) * L, R[s][1] - Math.sin(ang[s]) * L]);
    }
    const toWorld = (s, X, Y) => {     // sprite-plane point (X toward head, Y lateral, atlas px from head tip) -> art px
      const u = -X - J[s] * Lc, c = Math.cos(ang[s]), sn = Math.sin(ang[s]), v = Y * k.mirror;
      return [R[s][0] + sc * (-u * c - v * sn), R[s][1] + sc * (-u * sn + v * c)];
    };
    const vert = (s, cx, cy, ox, oy, su, r, X, Y) => { const w = toWorld(s, X, Y); return [w[0], w[1], (ox + cx) / A, (oy + cy) / A, su, r[0], r[1], r[2], r[3], k.depth, k.vis]; };
    const NORAMP = [-1e5, -9e4, 9e4, 1e5];
    // fins first (they tuck under the body)
    const sn = clamp(k.v / 90, 0, 1), t = sim.t;
    for (const f of kd.fins) {
      const pect = f.kind === 'pectoral';
      const fold = (k.mode === 'burst' ? 0.42 : 0) + 0.18 * sn;
      const flap = (pect ? 0.11 : 0.06) * Math.sin(t * (pect ? 2.1 : 1.6) + k.seed + (f.side > 0 ? 0 : 1.3));
      const steer = (pect ? 0.22 : 0.08) * k.turn * f.side * k.mirror;
      const rot = f.side * (fold + flap) + steer;
      const rx = f.root[0] - hx, ry = f.root[1] - hy, c = Math.cos(rot), s = Math.sin(rot);
      const corner = (cx, cy) => {
        const X0 = cx - hx - rx, Y0 = cy - hy - ry;
        const X = rx + X0 * c - Y0 * s, Y = ry + X0 * s + Y0 * c;
        return vert(f.seg, cx, cy, kd.fin[0], kd.fin[1], 0, NORAMP, X, Y);
      };
      const b = f.box;
      o = pushQuad(koiVerts, o, [corner(b[0], b[1]), corner(b[2], b[1]), corner(b[2], b[3]), corner(b[0], b[3])]);
    }
    // body pieces from the tail to the head; each piece reaches a little behind its rear joint and feathers out there
    for (let s = nseg - 1; s >= 0; s--) {
      const u0 = (s === 0 ? -0.03 : J[s] - ov) * Lc, u1 = (s === nseg - 1 ? 1.03 : J[s + 1] + ov) * Lc;
      const r = [s === 0 ? -1e5 : (J[s] - ov) * Lc, s === 0 ? -9e4 : J[s] * Lc, s === nseg - 1 ? 9e4 : J[s + 1] * Lc, s === nseg - 1 ? 1e5 : (J[s + 1] + ov) * Lc];
      const x0 = hx - u1, x1 = hx - u0, y0 = 0, y1 = kd.size[1];
      const cv = (cx, cy) => vert(s, cx, cy, kd.body[0], kd.body[1], hx - cx, r, cx - hx, cy - hy);
      o = pushQuad(koiVerts, o, [cv(x0, y0), cv(x1, y0), cv(x1, y1), cv(x0, y1)]);
    }
  }
  return o / KV;
}
// petals: floating ones first (drawn under the pads), then the ones in the air (drawn over the branch); returns [nFloating, nAir] vertex counts
function buildPetals() {
  let o = 0; const t = sim.t, px = canvas.width / (win[2] * AW);   // screen px per art px
  const emit = (p, wantFloating) => {
    const age = t - p.t0;
    let size, alpha, mode, sx = 1;
    if (!p.floating) {
      const f = Math.min(1, age / p.dur);
      size = 6.2 * (1.75 - 0.75 * f); alpha = Math.min(1, age / 0.6) * (p.land ? 1 : 1 - Math.max(0, (f - 0.6) / 0.4));
      sx = 0.35 + 0.65 * Math.abs(Math.cos(age * 2.7 + p.seed)); mode = 0;
    } else {
      const left = p.life - (t - p.tf);
      size = 6.2; alpha = Math.min(1, left / 6); mode = 1;
    }
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const quad = (cx, cy, m, a) => {
      const pt = (lx, ly) => { const X = lx * size * sx, Y = ly * size; return [cx + X * c - Y * s, cy + X * s + Y * c, lx, ly, size * px, a, m, p.tint]; };
      return [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)];
    };
    if (mode === 1) o = pushQuad(petVerts, o, quad(p.x + 1.6, p.y + 2.2, 2, alpha));
    o = pushQuad(petVerts, o, quad(p.x, p.y, mode, alpha));
  };
  for (const p of sim.petals) if (p.floating) emit(p);
  const nf = o / 8;
  for (const p of sim.petals) if (!p.floating) emit(p);
  return [nf, o / 8 - nf];
}
function buildPads() {
  let o = 0;
  const [AWt, AHt] = LAY.atlas;
  for (let i = 0; i < NPADS; i++) {
    const d = LAY.pads[i], p = sim.pads[i], c = Math.cos(p.a), s = Math.sin(p.a);
    const [bx, by, bw, bh] = d.box, [u, v, uw, vh] = d.uv;
    const pt = (fx, fy) => {
      const x = bx + bw * fx - d.cx, y = by + bh * fy - d.cy;
      padVerts.set([d.cx + p.x + x * c - y * s, d.cy + p.y + x * s + y * c, (u + uw * fx) / AWt, (v + vh * fy) / AHt], o); o += 4;
    };
    pt(0, 0); pt(1, 0); pt(1, 1); pt(0, 0); pt(1, 1); pt(0, 1);
  }
  return o / 4;
}
function buildBranch() {
  const V = branchVerts, R0 = V.rest, t = sim.t;
  for (let i = 0; i < V.length; i += 4) {
    const d = branchDisp(R0[i], R0[i + 1], t);
    V[i] = R0[i] + d[0]; V[i + 1] = R0[i + 1] + d[1];
  }
}
function buildFlies() {
  const t = sim.t; let o = 0;
  const big = vv('flies', 1) > 0, cnt = Math.min(MAXFLY, Math.ceil((big ? 14 : 10) * settings.glow));
  for (let i = 0; i < cnt; i++) {
    const f = FLY[FLY_ORDER[i % FLY.length]], [x, y] = flyAt(f, t);
    const b = 0.5 + 0.5 * Math.sin(t * f.gp + f.ph * 3.1);
    const a = 0.12 + 0.88 * Math.pow(b, 1.7);
    const fade = clamp(settings.glow * (big ? 14 : 10) - i, 0, 1);          // extra fireflies fade in as the slider goes up
    const S = big ? 19 : 11, pp = (lx, ly) => [x + lx * S, y + ly * S, lx, ly, a * fade, S];
    o = pushQuad(flyVerts, o, [pp(-1, -1), pp(1, -1), pp(1, 1), pp(-1, 1)]);
  }
  return o / 6;
}
function bindAttr(pr, name, size, stride, off) { const l = pr.a[name]; if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride * 4, off * 4); }
function draw() {
  if (!ready || lost) return;
  advanceSim(time);
  const w = canvas.width, h = canvas.height;
  const lamp = lampOffset(sim.t);
  // ---- pass A: clean plate + koi into the offscreen buffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
  gl.disable(gl.BLEND);
  gl.useProgram(P.art.pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf.tri); bindAttr(P.art, 'p', 2, 2, 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.art); gl.uniform1i(P.art.u.art, 0);
  gl.uniform4fv(P.art.u.win, win);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disableVertexAttribArray(P.art.a.p);
  const nk = settings.koi > 0 || sim.koi.some(k => k.vis > 0) ? buildKoi() : 0;
  if (nk) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.koi.pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf.koi); gl.bufferData(gl.ARRAY_BUFFER, koiVerts.subarray(0, nk * KV), gl.DYNAMIC_DRAW);
    bindAttr(P.koi, 'pos', 2, KV, 0); bindAttr(P.koi, 'uv', 2, KV, 2); bindAttr(P.koi, 'su', 1, KV, 4); bindAttr(P.koi, 'fe', 4, KV, 5); bindAttr(P.koi, 'da', 2, KV, 9);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.atlas);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.art);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.masks);
    gl.uniform1i(P.koi.u.atlas, 0); gl.uniform1i(P.koi.u.art, 1); gl.uniform1i(P.koi.u.masks, 2);
    gl.uniform4fv(P.koi.u.win, win); gl.uniform1f(P.koi.u.time, time);
    gl.colorMask(true, true, true, false);
    gl.uniform1f(P.koi.u.mode, 1); gl.drawArrays(gl.TRIANGLES, 0, nk);   // shadows on the pond bed (no coverage)
    gl.colorMask(true, true, true, true);
    gl.uniform1f(P.koi.u.mode, 0); gl.drawArrays(gl.TRIANGLES, 0, nk);   // alpha accumulates koi coverage
    for (const a of ['pos', 'uv', 'su', 'fe', 'da']) if (P.koi.a[a] >= 0) gl.disableVertexAttribArray(P.koi.a[a]);
  }
  // ---- pass B: water
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.disable(gl.BLEND);
  gl.useProgram(P.water.pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf.tri); bindAttr(P.water, 'p', 2, 2, 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.art);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.masks);
  gl.uniform1i(P.water.u.under, 0); gl.uniform1i(P.water.u.art, 1); gl.uniform1i(P.water.u.masks, 2);
  gl.uniform4fv(P.water.u.win, win); gl.uniform1f(P.water.u.time, time);
  gl.uniform1f(P.water.u.sheen, settings.water); gl.uniform1f(P.water.u.ripAmt, Math.min(settings.water, 2) > 0 ? 0.6 + 0.4 * settings.water : 0);
  gl.uniform1f(P.water.u.lamp, lamp); gl.uniform1f(P.water.u.glow, settings.glow);
  gl.uniform1f(P.water.u.lightMode, settings.glow > 0 ? vv('light', 1) : 0);
  gl.uniform1f(P.water.u.waterMode, vv('surface', 1));
  const rip = new Float32Array(MAXRIP * 4);
  sim.ripples.forEach((r, i) => { rip.set([r.x, r.y, sim.t - r.t0, r.amp], i * 4); });
  gl.uniform4fv(P.water.u.rip, rip);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disableVertexAttribArray(P.water.a.p);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // ---- petals on the water (the pads cover them), branch shadow, pads, branch, petals in the air
  const [nfl, nair] = sim.petals.length ? buildPetals() : [0, 0];
  const drawPetals = (first, count) => {
    if (!count) return;
    gl.useProgram(P.pet.pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf.pet); gl.bufferData(gl.ARRAY_BUFFER, petVerts.subarray(0, (nfl + nair) * 8), gl.DYNAMIC_DRAW);
    bindAttr(P.pet, 'pos', 2, 8, 0); bindAttr(P.pet, 'loc', 2, 8, 2); bindAttr(P.pet, 'prm', 4, 8, 4);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.masks); gl.uniform1i(P.pet.u.masks, 2);
    gl.uniform4fv(P.pet.u.win, win); gl.uniform1f(P.pet.u.lamp, lamp);
    gl.drawArrays(gl.TRIANGLES, first, count);
    for (const a of ['pos', 'loc', 'prm']) if (P.pet.a[a] >= 0) gl.disableVertexAttribArray(P.pet.a[a]);
  };
  drawPetals(0, nfl);
  const useLay = texture => {
    gl.useProgram(P.lay.pr);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(P.lay.u.lay, 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.masks); gl.uniform1i(P.lay.u.masks, 2);
    gl.uniform4fv(P.lay.u.win, win); gl.uniform1f(P.lay.u.lamp, lamp);
  };
  const branchOn = true;
  if (branchOn) buildBranch();
  const drawBranch = () => {
    useLay(tex.branch);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.branch); gl.bufferData(gl.ARRAY_BUFFER, branchVerts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.branchIdx);
    bindAttr(P.lay, 'pos', 2, 4, 0); bindAttr(P.lay, 'uv', 2, 4, 2);
    gl.drawElements(gl.TRIANGLES, branchIdx.length, gl.UNSIGNED_SHORT, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    for (const a of ['pos', 'uv']) if (P.lay.a[a] >= 0) gl.disableVertexAttribArray(P.lay.a[a]);
  };
  const npad = buildPads();
  useLay(tex.pads);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.pad); gl.bufferData(gl.ARRAY_BUFFER, padVerts.subarray(0, npad * 4), gl.DYNAMIC_DRAW);
  bindAttr(P.lay, 'pos', 2, 4, 0); bindAttr(P.lay, 'uv', 2, 4, 2);
  gl.drawArrays(gl.TRIANGLES, 0, npad);
  for (const a of ['pos', 'uv']) if (P.lay.a[a] >= 0) gl.disableVertexAttribArray(P.lay.a[a]);
  drawBranch();
  drawPetals(nfl, nair);
  // ---- fireflies (additive)
  const nf = settings.glow > 0 ? buildFlies() : 0;
  if (nf) {
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(P.fly.pr); gl.bindBuffer(gl.ARRAY_BUFFER, buf.fly); gl.bufferData(gl.ARRAY_BUFFER, flyVerts.subarray(0, nf * 6), gl.DYNAMIC_DRAW);
    bindAttr(P.fly, 'pos', 2, 6, 0); bindAttr(P.fly, 'loc', 2, 6, 2); bindAttr(P.fly, 'prm', 2, 6, 4);
    gl.uniform4fv(P.fly.u.win, win); gl.uniform1f(P.fly.u.fs, vv('flies', 1) > 0 ? 1.7 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, nf);
    for (const a of ['pos', 'loc', 'prm']) if (P.fly.a[a] >= 0) gl.disableVertexAttribArray(P.fly.a[a]);
  }
  gl.disable(gl.BLEND);
  frames++;
}

// ---- scheduling (kit contract)
function frozen() { return settings.koi === 0 && settings.water === 0 && settings.wind === 0 && settings.petals === 0 && settings.glow === 0; }
function stopped() { return hostPaused || testMode || document.hidden || lost || !ready || frozen(); }
function schedule() {
  cancelAnimationFrame(raf); raf = 0; last = 0; acc = 0; pending = 0;
  if (!stopped()) raf = requestAnimationFrame(tick);
}
function tick(now) {
  if (stopped()) { raf = 0; return; }
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
  acc += dt; pending += dt;
  const interval = settings.fps > 0 ? 1 / settings.fps : 0;
  if (acc + 1e-4 >= interval) {
    acc = Math.max(0, acc - interval);
    if (acc > interval) acc = 0;
    time += pending; pending = 0;
    draw();
  }
  raf = requestAnimationFrame(tick);
}
function fail(err) {
  ready = false; cancelAnimationFrame(raf); canvas.hidden = true;
  document.body.style.backgroundImage = `url('${url('art.jpg')}')`;
  console.warn('Animation unavailable, showing still art:', err && err.message);
}
document.addEventListener('visibilitychange', schedule);
window.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; ready = false; schedule(); });
canvas.addEventListener('webglcontextrestored', () => { try { setup(); } catch (e) { fail(e); } });

// ---- test hooks (inert in WE)
window.wallpaperDiagnostics = { get state() {
  return { ready, lost, time, frames, paused: stopped(), fps: settings.fps, settings: { ...settings }, width: canvas.width, height: canvas.height,
    koi: sim ? sim.koi.filter(k => k.vis > 0).map(k => ({ v: k.kd.name, x: Math.round(k.x), y: Math.round(k.y), depth: +k.depth.toFixed(2), mode: k.mode, speed: Math.round(k.v) })) : [],
    ripples: sim ? sim.ripples.length : 0, petals: sim ? sim.petals.length : 0,
    pads: sim ? sim.pads.map(p => +Math.hypot(p.x, p.y).toFixed(2)) : [], gust: sim ? +gust(sim.t).toFixed(2) : 0, tip: sim ? branchDisp(600, 440, sim.t).map(v => +v.toFixed(2)) : [0, 0], lamp: sim ? +lampOffset(sim.t).toFixed(3) : 0 };
} };
window.wallpaperTest = {
  seek(t) { testMode = true; schedule(); if (t < sim.t) resetSim(); advanceSim(t, 1e7); time = t; draw(); },
  resume() { testMode = false; schedule(); },
};

resetSim();
try {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', premultipliedAlpha: false });
  if (!gl) throw Error('WebGL is not available.');
  let left = 5;
  const load = (k, f) => { const im = new Image(); im.onload = () => { images[k] = im; if (--left === 0) { try { setup(); } catch (e) { fail(e); } } }; im.onerror = () => fail(Error(f + ' could not be loaded')); im.src = url(f); };
  load('plate', 'plate.jpg'); load('masks', 'masks.png'); load('atlas', 'koi-atlas.png'); load('layers', 'layers.png'); load('branch', 'branch.png');
} catch (e) { fail(e); }
})();

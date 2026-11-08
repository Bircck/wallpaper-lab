'use strict';
// Summer Crossing runtime core: canvas, view, timing, the train schedule, the backdrop pass and the draw order.
// Every look lives in its own file under parts/ and registers itself with SC.part({...}) before this file runs.
// Art space is 1672x941 (y down). Every pass maps art px <-> screen through uView.
//
// A part can have:
//   title, order            name; backdrop order (sky 10, plants 20, sea 30, road 40)
//   files, wrap             texture key -> path; keys that repeat in x
//   formats                 texture key -> 'R8' or 'RG8' for maps the shaders read one or two channels of (less GPU memory)
//   lazy                    file keys not loaded at start: ctx.want(key, derivedKey) loads one the first time a pass needs it
//   derive                  textures cut on the GPU from loaded ones: [{key, fmt, w, h, wrap, from: [[src, sx, sy, sw, sh, dx, dy], ...]}].
//                           A source no other entry needs is deleted once its pieces are copied. Pixel-exact, so frames don't change.
//   common                  GLSL functions available to every program
//   backDecl, backBase, backBody   GLSL added to the full-screen backdrop: declarations; code that may replace I; code that changes col.
//                           Inside main: vec2 A (art px), q (A / art size); vec3 I, col; float m, sea, grass, dz, depth, wk; vec2 gp.
//   samplers                sampler uniform -> texture key, bound automatically for the backdrop
//   uniforms, set(ctx, P)   extra backdrop uniform names, and setting them every frame
//   setup(ctx)              build programs and buffers
//   draw: {far, train, dust, gate, near, top}   passes after the backdrop, in that order, with premultiplied blending
//   kinds, adjustKind(k, kind, settings)   train definitions (parts/train.js)
//   api                     functions added to window.wallpaperTest, called with (ctx, ...args)
(() => {
const SC = window.SC;
const canvas = document.querySelector('#scene');
const base = document.currentScript.src;
const url = f => new URL(f, base).href;
const ART_W = 1672, ART_H = 941, MASTER_W = 3344;
const CLOCK_WRAP = 86400;   // shader clocks wrap once a day: everything driven by them jumps for that one frame, and a float still resolves 1/128 s at this size
const FOCUS = [0.5, 0.5136];   // 21:9 keeps art y 125-841: the pole leaves the frame cleanly below its hardware, and some road shadow stays
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const parts = SC.parts.slice().sort((a, b) => (a.order || 50) - (b.order || 50));
const LAYERS = ['far', 'train', 'dust', 'gate', 'near', 'top'];

// art.jpg is the whole 2x painting (it is also the still shown if WebGL fails), but only rows above the plants' plate are ever drawn
// from it: it is cut to art y 0-480 on the GPU. sky-matte: the sky matte, art y 0-476. land-masks: R sea, G grass, art y 470-941.
const FILES = { artFull: 'assets/art.jpg', skyMatte: 'assets/sky-matte.png', land: 'assets/land-masks.png' }, WRAP = new Set();
const FORMATS = { skyMatte: 'R8', land: 'RG8' }, LAZY = new Set();
const DERIVE = [{ key: 'art', fmt: 'RGBA8', w: MASTER_W, h: 960, from: [['artFull', 0, 0, MASTER_W, 960, 0, 0]] }];
for (const p of parts) {
  Object.assign(FILES, p.files || {});
  Object.assign(FORMATS, p.formats || {});
  DERIVE.push(...(p.derive || []));
  (p.lazy || []).forEach(k => LAZY.add(k));
  (p.wrap || []).forEach(k => WRAP.add(k));
}
const KINDS = Object.assign({}, ...parts.map(p => p.kinds || {}));
const adjustKinds = parts.filter(p => p.adjustKind);

const GATE_DOWN = 3.2, GATE_UP = 3.6, BLINK_HZ = .85;
const passTime = k => (ART_W + 80 + k.carL * k.cars) / k.speed;
const evLen = k => k.lead + passTime(k) + k.tail + GATE_UP + 4;
// with today's sliders, for timing and drawing alike. Train speed scales both trains (the tuned speeds at 50).
const kindNow = name => { const k = { ...KINDS[name] }; adjustKinds.forEach(p => p.adjustKind(k, name, settings)); k.speed *= settings.speed; return k; };

// ---- settings: WE slider (0-100) -> internal; 50 = tuned, 0 = off
const settings = { clouds: 1, shadows: 1, sea: 1, wind: 1, trees: 1, express: 1, local: 1, speed: 1, contrail: 1, gate: 1, rumble: 0, quality: 1, fps: 30 };
const weKeys = { clouds: 'clouds', sea: 'sea', wind: 'wind', treewind: 'trees', express: 'express', local: 'local', trainspeed: 'speed', contrail: 'contrail', gate: 'gate', rumble: 'rumble', renderscale: 'quality' };   // cloud shadows have no slider: fixed at the tuned strength, and they move with Clouds
// how often a train comes: 0 never, 50 tuned (each kind about every 2.8 min), 100 three times as often
const often = x => x <= 50 ? x / 50 : 1 + 2 * (x - 50) / 50;
const fromSlider = { contrail: x => x ? 1 : 0, gate: x => x ? 1 : 0, rumble: x => x / 100,   // rumble: 0 off (the default), 100 = the old full rumble of the express
  express: often, local: often, speed: x => 2 ** ((x - 50) / 25),   // speed: 0 = a quarter, 50 = tuned, 100 = four times
  clouds: x => x / 50, sea: x => x / 50, trees: x => x / 50, wind: x => x / 50, quality: x => clamp(x, 35, 100) / 100 };

let gl, images = {}, tex = {}, prog = {}, ready = false, lost = false, hostPaused = false;
let raf = 0, last = 0, acc = 0, pending = 0, time = 0, frames = 0, testMode = false, frameDt = 1 / 30, timeScale = 1;
let manual = null;           // test hook: {kind, s} replaces the schedule until it is over
// slider-paced clocks: a slider move changes the rate from now on, it never jumps the phase
const pace = { clouds: { off: 0, t: 0 }, wind: { off: 0, t: 0 }, trees: { off: 0, t: 0 }, sea: { off: 0, t: 0 } };
const paceAt = (k, t) => pace[k].off + (t - pace[k].t) * settings[k];
function repace(k, newRate) { pace[k].off = paceAt(k, time); pace[k].t = time; settings[k] = newRate; }

window.wallpaperPropertyListener = {
  applyUserProperties(p) {
    for (const [weKey, key] of Object.entries(weKeys)) {
      if (!p[weKey]) continue;
      const n = Number(p[weKey].value);
      if (!Number.isFinite(n)) continue;
      const val = fromSlider[key](clamp(n, 0, 100));
      if (key === 'express' || key === 'local') reoften(key, val);
      else if (key === 'speed') respeed(val);
      else if (pace[key]) repace(key, val); else settings[key] = val;
      if (key === 'quality') resize();
    }
    // a slider drag sends many of these: keep the running loop and its clock, only redraw by hand when nothing is running
    schedule();
    if (ready && !raf) draw();
  },
  applyGeneralProperties(p) { if (p.fps !== undefined && Number.isFinite(Number(p.fps))) settings.fps = clamp(Number(p.fps), 0, 240); },
  setPaused(paused) { hostPaused = Boolean(paused); schedule(); },
};

// ---- schedule: express and local each on their own slider, one train at a time at the crossing.
// PERIOD: seconds from one train of a kind to the next of the same kind at 50, +-30 %. FIRST: the first express; the first local
// comes half a period later. MIN_GAP: quiet seconds after one event before the next may start, when both are due at once.
const FIRST = 12, PERIOD = 166, MIN_GAP = 6;
// A forward chain: each kind's next start is dealt when its last one starts, so a slider move changes what is still to come and
// a train that has already started always finishes. Seeking backward rebuilds it from the start, so frames stay exact for tests.
// An event is {kind, s, k, dir, sh}: sh is how much later than planned the train itself runs, from Train speed moves mid-event.
const chain = {};
function resetChain() {
  Object.assign(chain, { cur: null, free: 0, t: 0, n: { express: 0, local: 0 },
    due: { express: settings.express > 0 ? FIRST : Infinity, local: settings.local > 0 ? FIRST + PERIOD / 2 / settings.local : Infinity } });
}
resetChain();
const evEnd = e => e.s + evLen(kindNow(e.kind)) + (e.sh || 0);
function eventAt(t) {
  if (manual) { const end = evEnd(manual); if (t >= manual.s && t < end) return manual; if (t >= end) manual = null; }
  if (t < chain.t - 1e-6) resetChain();
  chain.t = t;
  for (let g = 0; g < 100000; g++) {
    if (chain.cur) {
      if (t < chain.cur.s) return null;
      const end = evEnd(chain.cur);
      if (t < end) return chain.cur;
      chain.free = end + MIN_GAP; chain.cur = null;
    }
    const kind = chain.due.express <= chain.due.local ? 'express' : 'local';
    if (!Number.isFinite(chain.due[kind])) return null;
    const s = Math.max(chain.due[kind], chain.free), n = chain.n[kind]++;
    chain.cur = { kind, s, k: n, dir: n % 2 ? 1 : -1, sh: 0 };   // each kind alternates its direction
    chain.due[kind] = settings[kind] > 0 ? s + PERIOD * (.7 + .6 * hash(n * 2 + (kind === 'local') + 3)) / settings[kind] : Infinity;
  }
  return null;
}
// a frequency slider: what is left of the wait stretches or shrinks, so a move takes effect at once without moving a running train
function reoften(kind, rate) {
  const old = settings[kind], due = chain.due[kind];
  settings[kind] = rate;
  if (rate <= 0) chain.due[kind] = Infinity;
  else if (!Number.isFinite(due)) chain.due[kind] = time + 8;   // back on: the next one comes soon
  else if (due > time) chain.due[kind] = time + (due - time) * old / rate;
}
// Train speed: a running train keeps its place and carries on at the new speed; after it has gone, the lamps and gate keep their timing
function respeed(mult) {
  const evs = [chain.cur, manual].filter(e => e && time >= e.s && time < evEnd(e));
  const before = evs.map(e => { const k = kindNow(e.kind); return [k.lead, passTime(k), time - e.s - k.lead - (e.sh || 0)]; });
  settings.speed = mult;
  evs.forEach((e, i) => {
    const [lead, tp0, tt] = before[i], tp1 = passTime(kindNow(e.kind));
    const tt1 = tt <= 0 ? tt : tt < tp0 ? tt * tp1 / tp0 : tp1 + tt - tp0;
    e.sh = time - e.s - lead - tt1;
  });
}
// state of one event at time t: lamps, gate angle, nose position, wake clock
function eventState(t) {
  const st = { lamps: [0, 0], gate: 0, train: null, wake: 0, rumble: 0, wire: 0 };
  const e = eventAt(t); if (!e) return st;
  const k = kindNow(e.kind), sh = e.sh || 0;
  const te = t - e.s, tp = passTime(k), tt = te - k.lead - sh;
  const lampsOff = k.lead + sh + tp + k.tail;
  const env = clamp(te / .12, 0, 1) * clamp((lampsOff - te) / .12, 0, 1);
  const f = (te * BLINK_HZ) % 1, sq = (a, b) => clamp((f - a) / .04, 0, 1) * clamp((b - f) / .04, 0, 1);
  st.lamps = [env * sq(0, .5), env * sq(.5, 1)];
  // gate: down well before the train, up after the lamps stop, small overshoot at the bottom
  const gs = k.lead - k.gateLead;
  const down = smooth(0, 1, (te - gs - .8) / GATE_DOWN), up = smooth(0, 1, (te - lampsOff) / GATE_UP);
  const settle = te > gs + .8 + GATE_DOWN ? Math.exp(-(te - gs - .8 - GATE_DOWN) * 3.4) * Math.sin((te - gs - .8 - GATE_DOWN) * 15) : 0;
  st.gate = down * (1 - up); st.gateBounce = settle * .012 * (1 - up);
  const dir = e.dir || 1;
  st.dir = dir;
  if (tt >= -.1 && tt <= tp + .1) {
    // nose: enters on one side, leaves with the tail past the other
    const s = tt * k.speed, nose = dir > 0 ? -40 + s : ART_W + 40 - s;
    st.train = { k, nose, dir, tt };
  }
  // wake: time since the nose / tail passed the middle of the frame, in seconds
  const a = clamp((tt + .15) / .25, 0, 1) * Math.exp(-Math.max(0, tt - tp) * 1.1) * k.wake;
  st.wake = tt > -.2 ? a : 0;
  st.wakeT = tt; st.wakeV = k.speed; st.wakeNose0 = dir > 0 ? -40 : ART_W + 40; st.wakeLen = k.carL * k.cars;
  st.rumble = (tt > -.3 && tt < tp + .4 ? clamp((tt + .3) / .4, 0, 1) * clamp((tp + .4 - tt) / .5, 0, 1) : 0) * k.rumble;
  // wires: shake once the train is passing, ring down after it
  st.wire = tt > 0 ? k.wake * clamp(tt / .5, 0, 1) * Math.exp(-Math.max(0, tt - tp) * .9) : 0;
  return st;
}

const COMMON = `#version 300 es
precision highp float;
uniform vec4 uView; uniform vec2 res;
uniform float uTime,uShadow,uCloudT,uWindT,uWindAmt,uWake,uWakeT,uWakeV,uNose0,uWakeLen,uDir;
vec2 artOf(vec2 fc){ return vec2(uView.x+fc.x/res.x*uView.z, uView.y+(1.-fc.y/res.y)*uView.w); }
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y);}
${parts.map(p => p.common || '').join('\n')}
`;
const VS_FULL = `#version 300 es
in vec2 p; void main(){gl_Position=vec4(p,0.,1.);}`;
// quad given in art px
const VS_QUAD = `#version 300 es
in vec2 p; uniform vec4 uView,uBox; out vec2 vA;
void main(){ vec2 A=mix(uBox.xy,uBox.zw,p); vA=A; vec2 n=(A-uView.xy)/uView.zw; gl_Position=vec4(n.x*2.-1.,1.-n.y*2.,0.,1.); }`;

// ---- backdrop: the painting, then each part's code in order
const FS_BACK = COMMON + `
uniform sampler2D uArt,uSkyM,uLand;
uniform vec2 uTexel; uniform float uSS,uGust;
out vec4 frag;
const float HOR=474.;
// the sky matte at q (texel for texel as the full-size masks were), and the art's top rows
float skyMatte(vec2 q){ return texture(uSkyM,vec2(q.x,q.y*(941./476.))).r; }
vec3 artAt(vec2 q){ return texture(uArt,vec2(q.x,q.y*(941./480.))).rgb; }
${parts.map(p => p.backDecl || '').join('\n')}
void main(){
  vec2 A=artOf(gl_FragCoord.xy); vec2 q=A/vec2(1672.,941.);
  vec3 I;
  if(uSS>.5){vec2 d=uTexel*.25;
    I=.25*(artAt(q-d)+artAt(q+d)+artAt(q+vec2(d.x,-d.y))+artAt(q+vec2(-d.x,d.y)));}
  else I=artAt(q);
  float wk=wakeAt(A.x);
${parts.map(p => p.backBase || '').join('\n')}
  float m=A.y<476.?skyMatte(q):0.;
  vec2 lm=A.y>=470.?texture(uLand,vec2(q.x,(A.y-470.)/471.)).rg:vec2(0.);
  float sea=lm.r,grass=lm.g;
  vec3 col=I;
  float dz=max(A.y-HOR,.5); float depth=min(260./(dz+6.),9.); vec2 gp=vec2((A.x-836.)*depth,260.*depth);
${parts.map(p => p.backBody || '').join('\n')}
  if(uShadow>0.&&A.y>HOR+1.) col*=cloudShadow(A,sea);
  frag=vec4(col,1.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 3).join('\n'));
  return s;
}
function program(vs, fs, names, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  Object.entries(attribs || {}).forEach(([n, loc]) => gl.bindAttribLocation(p, loc, n));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  const u = {}; for (const n of ['uView', 'res', 'uTime', 'uShadow', 'uCloudT', 'uBox', 'uWindT', 'uWindAmt', 'uWake', 'uWakeT', 'uWakeV', 'uNose0', 'uWakeLen', 'uDir', ...(names || [])]) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}
function params(wrapS) {
  for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, wrapS ? gl.REPEAT : gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
}
// one-channel and two-channel maps go up as R8 and RG8: the same values in the channels read, a quarter or half of the memory
function makeTex(img, key) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); params(WRAP.has(key));
  const f = FORMATS[key];
  if (f === 'R8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  else if (f === 'RG8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  return t;
}
// cut a texture out of loaded ones on the GPU: packed colour + alpha halves become an RGBA8 and an R8 texture, the art loses rows never drawn
let readFb = null;
function deriveTex(d) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); params(d.wrap);
  gl.texStorage2D(gl.TEXTURE_2D, 1, d.fmt === 'R8' ? gl.R8 : gl.RGBA8, d.w, d.h);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb);
  for (const [src, sx, sy, sw, sh, dx, dy] of d.from) {
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[src], 0);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, dx, dy, sx, sy, sw, sh);
  }
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  tex[d.key] = t;
}
// upload one image at a time and cut what can be cut right away, so the full-size sources never all sit in memory at once
let derived = new Set();
function addImage(k) {
  if (!readFb) readFb = gl.createFramebuffer();
  tex[k] = makeTex(images[k], k);
  const need = src => DERIVE.some(d => !derived.has(d) && d.from.some(f => f[0] === src));
  for (const d of DERIVE) if (!derived.has(d) && d.from.every(f => tex[f[0]])) { deriveTex(d); derived.add(d); }
  for (const src of Object.keys(tex)) if (DERIVE.some(d => d.from.some(f => f[0] === src)) && !need(src)) { gl.deleteTexture(tex[src]); delete tex[src]; }
}
function uploadAll() {
  derived = new Set();
  for (const k of Object.keys(images)) addImage(k);
  gl.deleteFramebuffer(readFb); readFb = null;
}
// a lazy file: loaded and uploaded between frames the first time a pass asks for it; until then the pass draws without it
const lazyLoading = {};
function want(key, derivedKey) {
  if (tex[derivedKey || key]) return true;
  if (!lazyLoading[key] && LAZY.has(key)) {
    lazyLoading[key] = true;
    const img = new Image();
    img.onload = () => { images[key] = img; if (ready && !lost) { addImage(key); gl.deleteFramebuffer(readFb); readFb = null; } };
    img.onerror = () => console.warn(FILES[key] + ' could not be loaded');
    img.src = url(FILES[key]);
  }
  return false;
}
let vao, tri, unit, nextUnit = 0, curEv = {}, curView = [0, 0, ART_W, ART_H];
// what a part sees
const ctx = {
  get gl() { return gl; }, settings, clamp, hash, smooth, ART_W, ART_H, COMMON, VS_QUAD,
  get time() { return time; }, get frameDt() { return frameDt; }, get ev() { return curEv; }, get view() { return curView; }, get vao() { return vao; },
  pace: k => paceAt(k, time),
  program, want,
  use(P) {
    gl.useProgram(P.p); nextUnit = 0;
    const u = P.u, view = curView, ev = curEv;
    gl.uniform4f(u.uView, ...view); gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, time % CLOCK_WRAP); gl.uniform1f(u.uShadow, settings.shadows); gl.uniform1f(u.uCloudT, paceAt('clouds', time) % CLOCK_WRAP);
    gl.uniform1f(u.uWindT, paceAt('wind', time) % CLOCK_WRAP); gl.uniform1f(u.uWindAmt, Math.min(settings.wind, 1) ** .5 * Math.max(1, settings.wind) ** 1.2);
    gl.uniform1f(u.uWake, ev.wake || 0); gl.uniform1f(u.uWakeT, ev.wakeT || 0); gl.uniform1f(u.uWakeV, ev.wakeV || 1); gl.uniform1f(u.uNose0, ev.wakeNose0 || 0); gl.uniform1f(u.uWakeLen, ev.wakeLen || 0); gl.uniform1f(u.uDir, ev.dir || 1);
  },
  bindTex(P, name, key) {
    const n = nextUnit++; gl.activeTexture(gl.TEXTURE0 + n); gl.bindTexture(gl.TEXTURE_2D, tex[key]); gl.uniform1i(P.u[name], n);
  },
  quad(P, x0, y0, x1, y1) {
    gl.uniform4f(P.u.uBox, x0, y0, x1, y1);
    gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
};
const backNames = () => ['uArt', 'uSkyM', 'uLand', 'uTexel', 'uSS', 'uGust', ...parts.flatMap(p => [...Object.keys(p.samplers || {}), ...(p.uniforms || [])])];
function setup() {
  prog.back = program(VS_FULL, FS_BACK, backNames());
  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  tex = {}; uploadAll();
  tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  unit = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  for (const p of parts) if (p.setup) { p.setup(ctx); gl.bindVertexArray(vao); }
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
  gl.viewport(0, 0, w, h);
  if (ready) draw();
}
function viewRect(rb) {
  const w = canvas.width, h = canvas.height, a = w / h, aa = ART_W / ART_H;
  let vw, vh, x0, y0;
  if (a > aa) { vw = ART_W; vh = ART_W / a; x0 = 0; y0 = clamp(FOCUS[1] * ART_H - vh / 2, 0, ART_H - vh); }
  else { vh = ART_H; vw = ART_H * a; y0 = 0; x0 = clamp(FOCUS[0] * ART_W - vw / 2, 0, ART_W - vw); }
  if (rb > 0) {
    // a slow soft rock, well under the frame rate so it can't alias into a shiver. Zoomed in just enough that no edge shows.
    const amp = 1.6 * rb, k = 1 - 2.4 * amp / Math.min(vw, vh), iw = vw * k, ih = vh * k;
    x0 += (vw - iw) / 2 + amp * .35 * Math.sin(time * 5.3); y0 += (vh - ih) / 2 + amp * .7 * Math.sin(time * 7.1 + 1.3);
    vw = iw; vh = ih;
  }
  return [x0, y0, vw, vh];
}
function draw() {
  if (!ready || lost) return;
  const ev = eventState(time); curEv = ev;
  curView = viewRect(ev.rumble * settings.rumble);
  const view = curView, w = canvas.width, h = canvas.height;
  const tx = view[2] / ART_W / w, ty = view[3] / ART_H / h;
  gl.disable(gl.BLEND);
  const P = prog.back; ctx.use(P);
  ctx.bindTex(P, 'uArt', 'art'); ctx.bindTex(P, 'uSkyM', 'skyMatte'); ctx.bindTex(P, 'uLand', 'land');
  for (const p of parts) for (const [name, key] of Object.entries(p.samplers || {})) ctx.bindTex(P, name, key);
  gl.uniform2f(P.u.uTexel, tx, ty); gl.uniform1f(P.u.uSS, MASTER_W * tx > 1.15 ? 1 : 0); gl.uniform1f(P.u.uGust, settings.wind);
  for (const p of parts) if (p.set) p.set(ctx, P);
  gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const layer of LAYERS) for (const p of parts) if (p.draw && p.draw[layer]) p.draw[layer](ctx);
  frames++;
}
// with every slider at 0 nothing moves, so nothing is drawn after the frame on screen
function frozen() { return settings.clouds === 0 && settings.sea === 0 && settings.wind === 0 && settings.trees === 0 && settings.express === 0 && settings.local === 0 && !manual && !chain.cur; }
function stopped() { return hostPaused || testMode || document.hidden || lost || !ready || frozen(); }
// Starts the loop when it should run and stops it when it shouldn't. A loop that is already running is left alone: restarting it
// zeroes the next frame's time step, so a slider drag (an event every frame) would hold the whole scene still while it moved.
function schedule() {
  if (stopped()) { cancelAnimationFrame(raf); raf = 0; return; }
  if (!raf) { last = 0; acc = 0; pending = 0; raf = requestAnimationFrame(tick); }
}
function tick(now) {
  if (stopped()) { raf = 0; return; }
  const dt = last ? Math.min((now - last) / 1000, .1) : 0; last = now;
  acc += dt; pending += dt;
  const interval = settings.fps > 0 ? 1 / settings.fps : 0;
  if (acc + 1e-4 >= interval) {
    acc = Math.max(0, acc - interval);
    if (acc > interval) acc = 0;
    if (pending > 0) frameDt = pending * timeScale;
    time += pending * timeScale; pending = 0;
    draw();
  }
  raf = requestAnimationFrame(tick);
}
function fail(err) {
  ready = false; cancelAnimationFrame(raf); canvas.hidden = true;
  document.body.style.backgroundImage = `url('${url(FILES.artFull)}')`;
  console.warn('Animation unavailable, showing still art:', err && err.message);
}
document.addEventListener('visibilitychange', schedule);
window.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; ready = false; schedule(); });
canvas.addEventListener('webglcontextrestored', () => { try { setup(); } catch (e) { fail(e); } });

// ---- development hooks for the checks, media scripts and the preview page (inert in WE)
window.wallpaperDiagnostics = { get state() { return { ready, lost, time, frames, paused: stopped(), fps: settings.fps, settings: { ...settings }, width: canvas.width, height: canvas.height }; } };
window.wallpaperTest = {
  seek(t, dt) { testMode = true; schedule(); time = t; if (dt) frameDt = dt; draw(); },
  resume() { testMode = false; schedule(); },
  // fire a train now. lead: seconds before the nose enters (undefined = the full lamp and gate lead-in)
  play(kind, lead, dir) { const k = KINDS[kind]; const skip = lead === undefined ? 0 : Math.max(0, k.lead - lead); manual = { kind, s: time - skip, dir: dir || (hash(time) < .5 ? -1 : 1) }; testMode = false; schedule(); return manual; },
  setTimeScale(x) { timeScale = x; },
  get time() { return time; },
  get event() { return curEv; },
  get textures() { return { ...tex }; },   // key -> WebGLTexture, for the texture audit
  kinds: KINDS,
};
for (const p of parts) for (const [name, fn] of Object.entries(p.api || {})) window.wallpaperTest[name] = (...args) => { const r = fn(ctx, ...args); if (ready && testMode) draw(); return r; };

try {
  gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) throw Error('WebGL2 is not available.');
  const START = Object.keys(FILES).filter(k => !LAZY.has(k));
  let left = START.length;
  // images in a fixed order whatever order they arrive in, so the GPU cuts always run the same way
  const loaded = {};
  for (const k of START) {
    const f = FILES[k], img = new Image();
    img.onload = () => { loaded[k] = img; if (--left === 0) { for (const key of START) images[key] = loaded[key]; try { setup(); } catch (e) { fail(e); } } };
    img.onerror = () => fail(Error(f + ' could not be loaded'));
    img.src = url(f) + (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '?v=' + (window.SC_V || 1) : '');
  }
} catch (e) { fail(e); }
})();

'use strict';
// Moon Cat v4: a black cat on a rooftop under a full moon (Wallpaper Engine web wallpaper, Halloween 2026).
// Style A (cel anime) painting taken apart into layers. Layers are textured quads in 2x art px
// (3344 x 1882), cover-fit to the screen around FOCUS.
// The cat is animated like cel animation, never by warping one drawing:
//   body  still apart from a chest/shoulder breath and a rare slow sigh (head and legs fixed)
//   head  its own layer: every move (look at viewer, look up, yawn, ear twitch, blinks, sniff, lick) plays as 30 fps
//         frames between drawn keys (RIFE in-betweens). Rare, deliberate events.
//   tail  the painted tail bends from about 30% of its length, driven by a baked chain-physics sim (curl, flick, swish).
// Scene life: chimney and town smoke, pumpkin flicker, window glow with lamps switching off and on, swaying trees, ivy,
// X5 clouds, lake reflections, mist, bats, falling leaves, ghost visits and a witch crossing the moon (about one a minute).
// All motion is a function of scene time, so wallpaperTest.seek(t) always shows the same frame.
// Runtime rules: docs/tools/web-wallpaper-kit/TEMPLATE.md (0-100 sliders, 50 = tuned, 0 = off; subtracting FPS limiter;
// setPaused; no rAF when frozen; render scale; cover fit; fade-in; context loss; still fallback; test hooks).
// WE sliders (project.json, 2026-10-28): Ghosts & witch (key creatures), Leaves, Clouds (their speed; 0 = still, not gone), Lights; 0 = off for all
// but Clouds. Not in project.json, so at their tuned values in WE: cat, wind (the trees, smoke, mist, lake and ivy), cloudamount (X5's density) and
// renderscale; their keys still work for the development hook and test pages.
(() => {
const canvas = document.querySelector('#scene');
const base = document.currentScript.src, url = f => new URL(f, base).href;
const M = window.MOON_CAT;
const LAB = window.MOON_CAT_LAB || null;          // only a development page sets this (variants, zoom, scripted events)
const ART_W = M.size[0], ART_H = M.size[1];
const FOCUS = M.focus || [0.66, 0.4676];          // art-space point kept on screen: 21:9 keeps the whole cat incl. the tail tip, the moon's top is cut a little

// ---- settings: WE slider (0-100) -> internal unit. 50 = tuned look, 0 = off.
const settings = { cat: 1, creatures: 1, leaves: 1, clouds: 1, lights: 1, wind: 1, cloudAmount: 1, quality: 1, fps: 30 };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fromSlider = { cat: v => v / 50, creatures: v => v / 50, leaves: v => v / 50, clouds: v => v / 50, lights: v => v / 50, wind: v => v / 50, cloudAmount: v => v / 50, quality: v => clamp(v, 35, 100) / 100 };
const weKeys = { cat: 'cat', creatures: 'creatures', leaves: 'leaves', clouds: 'clouds', lights: 'lights', wind: 'wind', cloudamount: 'cloudAmount', renderscale: 'quality' };

let gl, P = {}, quad, meshBuf, meshUV, meshIdx, tex = {};
let ready = false, lost = false, hostPaused = false;
let raf = 0, last = 0, acc = 0, pending = 0, time = 0, frames = 0, testMode = false;
const images = {};
// pace clocks: how far a paced part of the scene has run (the clouds, the bats, the leaf gusts). When a slider changes its pace it carries on
// from where it is; time * pace re-dealt everything (every cloud jumped, a bat in flight vanished: "wonky ... fast forwards feeling"). The
// pieces are kept, so a start dealt on a clock maps back to scene time (paceTime). wallpaperTest.seek(t) restarts them at time * pace, so test
// frames depend only on t and the sliders.
let paceAt = {}, paceDirty = false;
function paceClock(k, v) {
  const P = paceAt[k] || (paceAt[k] = [{ t: 0, c: 0, v }]); let a = P[P.length - 1];
  if (v !== a.v) { a = { t: time, c: a.c + (time - a.t) * a.v, v }; P.push(a); paceDirty = true; }
  return a.c + (time - a.t) * a.v;
}
function paceTime(k, c) {                         // the scene time at which clock k reads c (Infinity: not at the current pace)
  const P = paceAt[k] || [{ t: 0, c: 0, v: 1 }];
  for (let i = P.length - 1; i >= 0; i--) { const a = P[i]; if (c >= a.c || !i) return a.v ? a.t + (c - a.c) / a.v : c > a.c ? Infinity : a.t; }
}
const paceVer = k => (paceAt[k] || []).length;
const cloudClock = () => paceClock('clouds', Math.min(2, settings.clouds));

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

// ---- deterministic helpers
const hash = (k, i) => { const s = Math.sin(k * 127.1 + i * 311.7) * 43758.5453; return s - Math.floor(s); };
const sm = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
function noise1(x, k) { const i = Math.floor(x), f = x - i; return hash(k, i) + (hash(k, i + 1) - hash(k, i)) * sm(f); }
// one event per slot of length `period` (probability prob), placed so it fits inside the slot: {k, t0, len} or null
function slotAt(t, period, seed, prob, lenOf) {
  const k = Math.floor(t / period);
  if (hash(seed + 1, k) > prob) return null;
  const len = lenOf(k), room = Math.max(0, period - len - 2);
  const t0 = k * period + 1 + hash(seed, k) * room;
  return { k, t0, len };
}

// ---- shaders
// quads: rect in art px; the fragment looks up up to two textures by art position (so two drawings with different
// rects can be cross-dissolved in one pass: a true premultiplied mix, no see-through at the overlap)
const VS = `attribute vec2 p;uniform mat3 m;uniform vec4 rect;varying vec2 ap;
void main(){ap=rect.xy+p*rect.zw;vec3 q=m*vec3(ap,1.);gl_Position=vec4(q.xy,0.,1.);}`;
const FS = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1;uniform vec4 r0,r1;uniform float u1,op,add;
uniform vec4 br;      // flank breath: centre.xy, radius x, amount (horizontal only, legs and head untouched)
uniform vec4 fl;      // flutter: anchor.xy, amount (art px), time
vec4 samp(sampler2D t,vec4 r,vec2 a){vec2 uv=(a-r.xy)/r.zw;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)return vec4(0.);return texture2D(t,uv);}
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
void main(){
  vec2 a=ap;
  if(br.w!=0.){   // breath: the chest front swells forward and the shoulder line rises; br.w = art px at the peak
    float gate=smoothstep(668.,730.,a.y)*(1.-smoothstep(1000.,1090.,a.y));
    vec2 d1=(a-vec2(2300.,840.))/vec2(110.,190.),d2=(a-vec2(2575.,790.))/vec2(150.,150.);
    a-=br.w*gate*(exp(-dot(d1,d1))*vec2(-1.,0.)+exp(-dot(d2,d2))*vec2(.55,-.5));}
  if(fl.z!=0.){float w=clamp(length((a-fl.xy)/vec2(700.,420.)),0.,1.);vec2 q=a/55.;
    a+=fl.z*w*vec2(n2(q+vec2(fl.w*.8,0.))-.5,n2(q*1.3+vec2(0.,fl.w*.6))-.5);}
  vec4 c=samp(t0,r0,a);
  if(u1>0.)c=mix(c,samp(t1,r1,a),u1);
  c*=op;
  gl_FragColor=vec4(c.rgb,c.a*(1.-add));
}`;
// the tail: a skinned grid mesh (positions in art px computed on the CPU)
const VSM = `attribute vec2 p;attribute vec2 t;uniform mat3 m;varying vec2 uv;
void main(){uv=t;vec3 q=m*vec3(p,1.);gl_Position=vec4(q.xy,0.,1.);}`;
const FSM = `precision highp float;varying vec2 uv;uniform sampler2D t0;uniform float op;
void main(){gl_FragColor=texture2D(t0,uv)*op;}`;
// chimney smoke, cel style: one clean-edged silhouette made of overlapping lobes (puffs born at the chimney mouth every
// 0.5 s, rising, growing, leaning with the wind), flat two-tone shading per lobe (lit side toward the moon), and an
// opacity that only depends on height, so there are no soft airbrush gradients and no edges inside the plume.
const FSS = `precision highp float;
varying vec2 ap;uniform vec4 r0;uniform vec2 mouth;uniform float time,wind,amt;
float h(float n){return fract(sin(n*12.9898)*43758.5453);}
void main(){
  float cover=0.,best=9.,lit=0.;
  for(int j=0;j<17;j++){
    float k=floor(time/.5)-float(j);
    float age=(time-k*.5)/8.;
    if(age<0.||age>1.)continue;
    float hgt=320.*pow(age,.85);
    vec2 c=mouth+vec2(-hgt*hgt/320.*(.35+.75*wind)-hgt*.1+sin(age*3.5+k*.9)*10.*age,-hgt);
    float r=(12.+44.*pow(age,.7))*(.85+.3*h(k));
    vec2 d=ap-c;float ang=atan(d.y,d.x);
    float lump=1.+.12*sin(3.*ang+k*1.7+age*2.)+.06*sin(5.*ang-k*2.3);
    float dist=length(d)/(r*lump);
    cover=max(cover,1.-smoothstep(1.-1.4/r,1.,dist));  // crisp union edge, ~1.5 px anti-aliasing
    if(dist<best){best=dist;lit=step(.3,dot(d/(r*lump),normalize(vec2(-.8,-.6))));}
  }
  float y=(mouth.y-ap.y)/320.;
  float A=cover*amt*smoothstep(-.02,.03,y)*(1.-smoothstep(.35,.95,y));
  vec3 col=mix(vec3(.36,.36,.5),vec3(.58,.57,.7),lit);
  gl_FragColor=vec4(col*A,A);
}`;
// low mist over the lake and the town: thin drifting bands
const FSF = `precision highp float;
varying vec2 ap;uniform vec4 r0,rb;uniform sampler2D t0;uniform float time,amt;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
void main(){
  vec2 uv=(ap-r0.xy)/r0.zw;
  vec2 q=vec2(uv.x*5.+time*.012,uv.y*9.);           // both octaves drift left, with the smoke
  float d=n2(q)*.6+n2(q*2.1+vec2(time*.02,0.))*.4;
  float band=smoothstep(0.,.35,uv.y)*smoothstep(1.,.55,uv.y);
  float xe=2282.-1.059*(ap.y-1158.);                 // the near roof's left edge: no mist in front of the roof
  float lum=dot(texture2D(t0,(ap-rb.xy)/rb.zw).rgb,vec3(.3,.5,.2));
  float a=clamp(d-.35,0.,1.)*band*amt*smoothstep(xe,xe-90.,ap.x)*smoothstep(.07,.17,lum);   // not over the near-black trees
  gl_FragColor=vec4(vec3(.55,.56,.78)*a,a);
}`;

// town windows: lights-on minus lights-off, split into a positive (added) and a negative (subtracted) part so the colour
// is exact at Lights 50. Every pixel belongs to its two nearest windows (index map: R,G = sprite id + 1, B = weight), so
// each window breathes on its own, softly, with no cells; now and then one goes out for half a minute.
const FSL = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1,t2;uniform vec4 r0;uniform float amt;
float S(float i){return i<.5?1.:texture2D(t2,vec2((i+.5)/256.,.5)).r;}   // t2: one multiplier per window, set by the CPU (windowMult)
void main(){
  vec2 uv=(ap-r0.xy)/r0.zw;
  vec3 c=texture2D(t0,uv).rgb;
  vec4 ix=texture2D(t1,uv);
  float m=mix(S(floor(ix.g*255.+.5)),S(floor(ix.r*255.+.5)),ix.b);
  vec3 mm=pow(vec3(m),vec3(.8,1.,1.4))*amt;      // a lamp going out dies from blue to red: it passes through amber
  gl_FragColor=vec4(c*mm,0.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}
function link(vs, fs, names) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p'); gl.bindAttribLocation(p, 1, 't'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  const u = { prog: p }; for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}
function upload(img, f = {}) {    // f.pm: already premultiplied; f.nearest: an index map (no filtering)
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !f.pm);
  const filt = f.nearest ? gl.NEAREST : gl.LINEAR;
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filt], [gl.TEXTURE_MAG_FILTER, filt], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  return t;
}

// ---- view (cover fit) and 2D transforms (art px -> clip), column-major mat3
let view;
function fitView() {
  const a = canvas.width / canvas.height, aa = ART_W / ART_H;
  let vw = ART_W, vh = ART_H, cx = FOCUS[0] * ART_W, cy = FOCUS[1] * ART_H;
  if (LAB && LAB.zoom) { vh = LAB.zoom[2]; vw = vh * a; cx = LAB.zoom[0]; cy = LAB.zoom[1]; }
  else if (a > aa) { vh = ART_W / a; cy = Math.max(cy, 296 + vh / 2); }   // wider than the art: the window sits as low as it can with the cat's ears still in (21:9 keeps the cat whole, the lake and most of the town; the moon's top is cut. 32:9 is 940 art px tall: ears, moon, roof and the hills, no lake)
  else vw = ART_H * a;
  cx = clamp(cx, vw / 2, ART_W - vw / 2); cy = clamp(cy, vh / 2, ART_H - vh / 2);
  view = [2 / vw, 0, 0, 0, -2 / vh, 0, -2 * cx / vw, 2 * cy / vh, 1];
}
const mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[j * 3 + i] = a[i] * b[j * 3] + a[3 + i] * b[j * 3 + 1] + a[6 + i] * b[j * 3 + 2]; return r; };
function xform(px, py, ang = 0, sx = 1, sy = 1, dx = 0, dy = 0) {   // rotate/scale around (px,py), then move
  const c = Math.cos(ang), s = Math.sin(ang);
  return [c * sx, s * sx, 0, -s * sy, c * sy, 0, px + dx - (c * sx * px - s * sy * py), py + dy - (s * sx * px + c * sy * py), 1];
}
const R = n => M.layers[n] && M.layers[n].rect;
// draw a quad over `rect` showing texture a (and b mixed in by u), with options
function layer(a, o = {}) {
  if (!tex[a]) return;
  const ra = o.r0 || R(a), b = o.b && tex[o.b] ? o.b : null, rb = b ? R(b) : ra;
  let rect = o.rect || ra;
  if (b && !o.rect) { const x0 = Math.min(ra[0], rb[0]), y0 = Math.min(ra[1], rb[1]); rect = [x0, y0, Math.max(ra[0] + ra[2], rb[0] + rb[2]) - x0, Math.max(ra[1] + ra[3], rb[1] + rb[3]) - y0]; }
  const L = P.layer; gl.useProgram(L.prog);
  gl.uniformMatrix3fv(L.m, false, o.m ? mul(view, o.m) : view);
  gl.uniform4f(L.rect, rect[0], rect[1], rect[2], rect[3]);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[a]); gl.uniform4f(L.r0, ra[0], ra[1], ra[2], ra[3]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex[b || a]); gl.uniform4f(L.r1, rb[0], rb[1], rb[2], rb[3]);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1f(L.u1, b ? clamp(o.u, 0, 1) : 0);
  gl.uniform1f(L.op, o.op ?? 1); gl.uniform1f(L.add, o.add ? 1 : 0);
  const br = o.br || [0, 0, 1, 0]; gl.uniform4f(L.br, br[0], br[1], br[2], br[3]);
  const fl = o.fl || [0, 0, 0, 0]; gl.uniform4f(L.fl, fl[0], fl[1], fl[2], fl[3]);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// =====================================================================================================
// THE CAT
// =====================================================================================================
const NECK = [2400, 640];                         // head pivot: middle of the neck seam
const catOn = () => settings.cat > 0;
const variant = k => (LAB && LAB[k] !== undefined) ? LAB[k] : { head: 'frames', tail: 'bend', breath: 'v4', settle: true }[k];

// ---- head (v4): every head move plays as drawn frames at 24-30 fps, never as a cut from key to key. The key drawings
// (the painting, the v3 poses and the v4 keys) are joined by in-between frames interpolated between neighbouring keys,
// packed per transition in atlases (cat-frames.js; small moves like a blink or a sniff store only the patch that changes).
// The big moves (turn, look up, yawn) have their slow-in / slow-out drawn into the frame spacing (generated by
// build_frames.py), so every display frame at 30 fps shows a new drawing. An event is a list of steps: a transition played
// between two positions, or a held drawing. As a move arrives the head carries on a little about the neck and settles;
// while a pose is held it drifts a degree or so ("moving hold"). The v5 cel variants below (drawings only) lost to this
// (they looked worse than the smooth one); they stay for the development hook only.
const FR = window.MOON_CAT_FRAMES || { atlases: {}, tr: {} };
const HEADR = M.headRect || [2040, 300, 540, 360];
const EASE = { io: x => x * x * (3 - 2 * x), in: x => x * x, out: x => 1 - (1 - x) * (1 - x), lin: x => x };
// steps: [transition, seconds, from, to, ease, opts] (positions 0 = its first drawing .. 1 = its last; from = to holds a frame)
//        or [drawing, seconds, , , , opts] (a package head drawing, held).
// seconds = null: a drawn move (turn, rise, yawn) plays one drawing per 30 fps display frame, so no drawing shows twice;
// its slow-in / slow-out is in the drawings' spacing. opts.blend: cross-fade neighbouring drawings (a slow drift through
// near-identical frames); opts.over: [transition, at, close, hold, open] plays a patch move (a blink) inside a hold.
const SEQ = {
  // turn to the viewer, look, a slow blink, look, turn back
  look: h => [['turn', null, 0, 1], ['viewer', h * .45], ['vblink', .32, 0, 1, 'io'], ['vblink', .45, 1, 1], ['vblink', .42, 1, 0, 'io'],
              ['viewer', h * .55], ['turn', null, 1, 0]],
  // a yawn builds slowly and keeps stretching a little through the hold; it shuts jaw first, the ears follow, the head
  // comes down with the eyes still shut, then they open
  yawn: h => [['yawnopen', null, 0, .86], ['yawnopen', h, .86, 1, 'io', { blend: 1 }], ['yawnclose', null, 0, 1], ['blink', .3, 1, 1],
              ['blink', .32, 1, 0, 'io']],
  // the bat comes first (see drawBats; it reads the 'up' hold): the cat keeps still for half a second, looks up at it,
  // watches it with one slow blink, then looks down again
  up: h => [['rest', .6], ['rise', null, 0, 1], ['up', h, , , , { over: ['ublink', h * .42, .3, .35, .42] }], ['rise', null, 1, 0]],
  blink: () => [['blink', .09, 0, 1, 'in'], ['blink', .06, 1, 1], ['blink', .13, 1, 0, 'out']],
  slowblink: () => [['blink', .3, 0, 1, 'io'], ['blink', .42, 1, 1], ['blink', .42, 1, 0, 'io']],
  ear: () => [['ear', .09, 0, 1, 'out'], ['ear', .14, 1, 1], ['ear', .18, 1, 0, 'io'], ['ear', .08, 0, .7, 'out'], ['ear', .2, .7, 0, 'io']],
  // nose and mouth: three quick sniffs (the nose lifts, the whisker pad puffs, the whiskers swing forward; the head nods
  // up a touch with each), or a lick of the lips and nose
  sniff: () => [['sniff', .1, 0, .8, 'out'], ['sniff', .12, .8, .2, 'io'], ['sniff', .09, .2, .65, 'out'], ['sniff', .12, .65, .2, 'io'],
                ['sniff', .09, .2, .75, 'out'], ['sniff', .24, .75, 0, 'io']],      // nose up about 8 px at 1080p
  lick: () => [['lick', .16, 0, .43, 'io'], ['lick', .2, .43, 1, 'io'], ['lick', .12, 1, 1], ['lick', .32, 1, 0, 'io']],
};
// cel (v5): only the drawings, each exposed for whole 30 fps frames as on an anime exposure sheet (on 1s, 2s or 3s), never
// warped or mixed. An interpolated in-between slides and melts features that two keys draw differently ("morphing").
// Development hook only: the drawings of each move are the 'c-' entries that a cel-frames script adds (build_cel.py, not in this repo), in order:
//   c-turn  0 rest, 1 turn-0, 2 turn-a, 3 turn-mid, 4 turn-b, 5 turn-c, 6 turn-d, 7 turn-e, 8 viewer (1, 6, 7 drawn in v5)
//   c-rise  0 rest, 1 up-a, 2 up-mid, 3 up-c, 4 up        c-yawnopen  0 rest, 1 yawn-a, 2 -ab, 3 -abb, 4 -fold, 5 -b, 6 -mid, 7 yawn
//   c-yawnclose  0 yawn, 1 jaw, 2 shut, 3 close, 4 ears, 5 down, 6 settle (v5), 7 blink-closed
//   c-blink, c-vblink, c-ublink  0 open, 1 half, 2 closed (ublink 1 drawn in v5)    c-ear  0 rest, 1 ear-mid (v5), 2 twitch
//   c-sniff  0 rest, 1 sniff-c, 2 sniff-d    c-lick  0 rest, 1 lick-a, 2 lick-b
// xs(move, [[drawing, frames], ...], back) plays those drawings in that order; the next step shows the arrival drawing.
// An exposure [drawing, frames, next, f] is a slide: the drawing moved rigidly a fraction f of the way onto the next one
// (rotation about the neck, uniform scale, shift: the rigid part of the step between the two drawings, FR.kx), so a head
// that tilts travels smoothly while its drawings change on 1s or 2s. The neck fur bends to meet the body (drawHead).
const xs = (name, list, back) => [name, list.reduce((a, k) => a + k[1], 0) / 30, back ? 1 : 0, back ? 0 : 1, 'lin', { xs: list }];
const KX = FR.kx || {};
// A: the v4 drawings only
const SEQC = {
  look: h => [xs('c-turn', [[2, 2], [3, 2], [4, 2], [5, 3]]), ['viewer', h * .45], xs('c-vblink', [[1, 2], [2, 13], [1, 3]]),
              ['viewer', h * .55], xs('c-turn', [[5, 2], [4, 2], [3, 2], [2, 3]], 1), ['rest', .5]],
  yawn: h => [xs('c-yawnopen', [[1, 4], [2, 3], [3, 3], [4, 3], [5, 3], [6, 4]]), ['yawn', h],
              xs('c-yawnclose', [[1, 2], [2, 2], [3, 3], [4, 3], [5, 4]]), ['blink-closed', .3], xs('c-blink', [[1, 3]]), ['rest', .5]],
  up: h => [['rest', .6], xs('c-rise', [[1, 3], [3, 3]]), ['up', h, , , , { over: ['c-ublink', h * .42, [[2, 12]]] }],
            xs('c-rise', [[3, 3], [1, 3]], 1), ['rest', .5]],
  blink: () => [xs('c-blink', [[1, 1], [2, 2], [1, 2]])],
  slowblink: () => [xs('c-blink', [[1, 2], [2, 12], [1, 3]])],
  ear: () => [xs('c-ear', [[2, 6], [0, 4], [2, 3]])],
  sniff: () => [xs('c-sniff', [[1, 2], [2, 3], [1, 2], [0, 2], [1, 2], [2, 3], [1, 2], [0, 2], [1, 2], [2, 3], [1, 3]])],
  lick: () => [xs('c-lick', [[1, 3], [2, 9], [1, 3]])],
};
// B: plus the v5 drawings: the turn starts and ends in small steps (slow in, slow out), the ear swivels through a drawn
// in-between, the look-up blink has its half-closed eye, the yawn settles through a resting-size head
const SEQB = { ...SEQC,
  look: h => [xs('c-turn', [[1, 2], [2, 2], [3, 1], [4, 1], [5, 2], [6, 2], [7, 3]]), ['viewer', h * .45], xs('c-vblink', [[1, 2], [2, 13], [1, 3]]),
              ['viewer', h * .55], xs('c-turn', [[7, 2], [6, 2], [5, 2], [4, 1], [3, 1], [2, 2], [1, 3]], 1), ['rest', .5]],
  up: h => [['rest', .6], xs('c-rise', [[1, 3], [3, 3]]), ['up', h, , , , { over: ['c-ublink', h * .42, [[1, 2], [2, 10], [1, 3]]] }],
            xs('c-rise', [[3, 3], [1, 3]], 1), ['rest', .5]],
  ear: () => [xs('c-ear', [[1, 1], [2, 6], [1, 2], [0, 5], [1, 3]])],
  yawn: h => [xs('c-yawnopen', [[1, 4], [2, 3], [3, 3], [4, 3], [5, 3], [6, 4]]), ['yawn', h],
              xs('c-yawnclose', [[1, 2], [2, 2], [3, 3], [4, 3], [5, 3], [6, 3]]), ['blink-closed', .3], xs('c-blink', [[1, 3]]), ['rest', .5]],
};
// C: B plus slides on the moves that tilt the head (look-up, yawn), on 1s where the head travels
const SEQP = { ...SEQB,
  up: h => [['rest', .6], xs('c-rise', [[0, 1, 1, .1], [0, 1, 1, .25], [0, 1, 1, .45], [0, 1, 1, .7], [1, 1], [1, 1, 3, .3], [1, 1, 3, .6], [3, 1], [3, 1, 4, .5]]),
            ['up', h, , , , { over: ['c-ublink', h * .42, [[1, 2], [2, 10], [1, 3]]] }],
            xs('c-rise', [[4, 1, 3, .5], [3, 1], [3, 1, 1, .25], [3, 1, 1, .5], [3, 1, 1, .75], [1, 1], [1, 1, 0, .3], [1, 1, 0, .55], [1, 1, 0, .8]], 1), ['rest', .5]],
  yawn: h => [xs('c-yawnopen', [[0, 1, 1, .4], [1, 1], [1, 1, 2, .5], [2, 2], [2, 1, 3, .33], [2, 1, 3, .66], [3, 2], [3, 1, 4, .5], [4, 2],
                                [4, 1, 5, .5], [5, 2], [5, 1, 6, .5], [6, 2], [6, 1, 7, .5]]), ['yawn', h],
              xs('c-yawnclose', [[0, 1, 1, .5], [1, 1], [1, 1, 2, .5], [2, 2], [3, 2], [3, 1, 4, .5], [4, 1], [4, 1, 5, .5], [5, 2], [5, 1, 6, .5], [6, 2], [6, 1, 7, .5]]),
              ['blink-closed', .3], xs('c-blink', [[1, 3]]), ['rest', .5]],
};
function celAt(name, list, x) {                   // the drawing exposed x seconds into an exposure list
  let f = Math.floor(x * 30 + 1e-4), i = 0;
  while (i < list.length - 1 && f >= list[i][1]) f -= list[i++][1];
  const tr = FR.tr[name], [d, , nx, fr] = list[i], k = nx !== undefined && KX[name] && KX[name][d + '>' + nx];
  const sl = k ? { rot: k[0] * fr, sc: Math.pow(k[1], fr), dx: k[2] * fr, dy: k[3] * fr } : null;
  return { base: (tr && tr.base) || 'head-rest', f1: frameRef(name, d), f2: null, u: 0, i: d, sl };
}
const SEQV = { cel: SEQC, celplus: SEQB, slides: SEQP };
const celMode = () => !!SEQV[variant('head')];
const NOD = { sniff: .006, lick: -.006 };              // the head follows the muzzle a little (rad at the move's peak; + = muzzle up)
const HOLD = { look: [3.6, 6.2], yawn: [1.8, 2.5], up: [3.2, 5.4] };
// the yawn and the look-up are out (not good enough); their slots stay empty, so the look keeps its pace
const BIG = ['look', null, 'look', null, null];
const drawnLen = (name, a, b) => Math.abs(b - a) * (FR.tr[name] ? FR.tr[name].frames.length - 1 : 15) / 30;
function seqLen(s) { return s.reduce((a, k) => a + k[1], 0); }
function makeEvent(type, k, seed) {
  const hr = HOLD[type], h = hr ? hr[0] + (hr[1] - hr[0]) * hash(seed + 7, k) : 0;
  const s = (SEQV[variant('head')] || SEQ)[type](h).map(st => st[1] === null ? [st[0], drawnLen(st[0], st[2], st[3]), ...st.slice(2)] : st);
  return { type, seq: s, len: seqLen(s) };
}
// the big events (look / yawn / up): about one a minute at Cat 50
function bigEvent(t) {
  if (LAB && LAB.script) return scripted(t, ['look', 'yawn', 'up']);
  const f = settings.cat; if (!f) return null;
  const per = 66 / f;
  for (const dk of [0, -1]) {
    const k = Math.floor(t / per) + dk;
    const type = BIG[Math.floor(hash(51, k) * BIG.length)];
    if (!type) continue;
    const e = makeEvent(type, k, 50);
    const s = slotAt(k * per + .01, per, 50, .92, () => e.len);
    if (s && t >= s.t0 && t < s.t0 + e.len) return { ...e, t0: s.t0 };
  }
  return null;
}
const TAILEV = { flick: 2.2, twitch: .9, swish: 3 };       // tail events (seconds; tailBend)
function scripted(t, types) {
  for (const [t0, type] of LAB.script) {
    if (!types.includes(type)) continue;
    const e = TAILEV[type] ? { type, len: TAILEV[type] } : makeEvent(type, Math.round(t0), 50);
    if (t >= t0 && t < t0 + e.len) return { ...e, t0 };
  }
  return null;
}
// small events: blinks (every ~14 s), the ear flick (~2 min), a sniff or a lick (~1.5 min). Never near a big event or a
// sigh, and a sequencer keeps them apart: an event is dropped when another small event starts earlier and the two would
// come within GAP seconds of each other, so nothing is cut off mid-move and nothing clusters.
const SMALL = [['blink', 14, 70, .9], ['ear', 58, 80, .55], ['muzzle', 47, 90, .6]], GAP = 1.5;
function smallSlot(i, k) {                         // the event of slot k of small-event kind i, or null
  const [kind, p, seed, prob] = SMALL[i], per = p / settings.cat;
  const type = kind === 'blink' ? (hash(seed + 3, k) < .35 ? 'slowblink' : 'blink') : kind === 'muzzle' ? (hash(seed + 3, k) < .5 ? 'sniff' : 'lick') : kind;
  const e = makeEvent(type, k, seed);
  const s = slotAt(k * per + .01, per, seed, prob, () => e.len);
  if (!s) return null;
  const t0 = s.t0, t1 = t0 + e.len;
  if (bigEvent(t0 - 1.5) || bigEvent(t1 + 1.5) || bigEvent(t0) || sighAt(t0) || sighAt(t1)) return null;
  return { ...e, t0 };
}
function smallEvent(t) {
  if (LAB && LAB.script) return scripted(t, ['blink', 'slowblink', 'ear', 'sniff', 'lick']);
  if (!settings.cat) return null;
  for (let i = 0; i < SMALL.length; i++) {
    const e = smallSlot(i, Math.floor(t / (SMALL[i][1] / settings.cat)));
    if (!e || t < e.t0 || t >= e.t0 + e.len) continue;
    let clash = false;
    for (let j = 0; j < SMALL.length && !clash; j++) {
      if (j === i) continue;
      const per = SMALL[j][1] / settings.cat;
      for (let k = Math.floor((e.t0 - 4 - GAP) / per); k <= Math.floor((e.t0 + e.len + GAP) / per) && !clash; k++) {
        const o = smallSlot(j, k);
        clash = !!o && o.t0 < e.t0 + e.len + GAP && o.t0 + o.len + GAP > e.t0 && (o.t0 < e.t0 || (o.t0 === e.t0 && j < i));
      }
    }
    if (!clash) return e;
  }
  return null;
}
// one drawing of a transition: a package head (whole) or an atlas cell showing the transition's patch rect
function frameRef(name, i) {
  const tr = FR.tr[name];
  const f = tr ? tr.frames[clamp(i, 0, tr.frames.length - 1)] : 'head-rest';
  if (typeof f === 'string') return { t: f, r: R(f) || HEADR, p: HEADR };
  const A = FR.atlases[f[0]], rr = tr.rect;
  return { t: f[0], r: [rr[0] - f[1], rr[1] - f[2], A.size[0], A.size[1]], p: rr };
}
// position p (0..1) of a transition -> the drawing(s) to show
function framesAt(name, p, blend) {
  const tr = FR.tr[name], hv = variant('head');
  if (!tr) return { base: 'head-rest', f1: frameRef(name, 0), f2: null, u: 0 };
  const n = tr.frames.length - 1, base = tr.base || 'head-rest', q = clamp(p, 0, 1);
  // drawing i sits at i / n: the drawn moves are spaced for one drawing per display frame (their easing is in the
  // drawings), the small moves are evenly spaced poses eased by the step
  const at = i => i / n;
  if (hv === 'keys') { let best = 0; for (const k of tr.keys) if (Math.abs(at(k) - q) < Math.abs(at(best) - q)) best = k; return { base, f1: frameRef(name, best), f2: null, u: 0 }; }
  let i = 0; while (i < n - 1 && at(i + 1) <= q) i++;
  const u = clamp((q - at(i)) / Math.max(1e-6, at(i + 1) - at(i)), 0, 1);
  if (blend || hv === 'blend') return { base, f1: frameRef(name, i), f2: u > .01 ? frameRef(name, i + 1) : null, u };
  return { base, f1: frameRef(name, u < .5 ? i : i + 1), f2: null, u: 0 };
}
const held = d => ({ base: 'head-' + d, f1: { t: 'head-' + d, r: R('head-' + d) || HEADR, p: HEADR }, f2: null, u: 0 });
// follow-through: as a drawn move arrives, the head carries on a little along its motion (3 art px and about half a
// degree) and eases back once, no wobble. It starts four frames before the last drawing, so the move never stops dead.
const FT = tau => tau < -.12 || tau > .5 ? 0 : tau < .08 ? sm((tau + .12) / .2) : 1 - sm((tau - .08) / .42);
const SETTLE = { turn: -1, rise: 1, yawnopen: 1, yawnclose: -1 };      // rotation sense of each move, played forwards
const DRIFT = { look: -.012, yawn: .03, up: .012 };     // moving hold: +1 = the muzzle keeps rising a little, then settles
function headState(t, br) {
  const e = bigEvent(t) || smallEvent(t);
  if (!e) {    // a sigh half closes the eyes on the slow exhale
    const eyes = (br || breathAt(t)).eyes;
    if (celMode()) return { ...(eyes > .5 ? celAt('c-blink', [[1, 1]], 0) : held('rest')), rot: 0, dx: 0, dy: 0, type: eyes > .5 ? 'sigh' : undefined };
    return eyes > .004 ? { ...framesAt('blink', .5 * eyes), rot: 0, dx: 0, dy: 0, type: 'sigh' } : { ...held('rest'), rot: 0, dx: 0, dy: 0 };
  }
  const tau = t - e.t0, ft = variant('settle');
  let ks = 0, st = null, rot = 0, dx = 0, dy = 0, sc = 1;
  for (const s of e.seq) {
    const [d, len, from, to, , o] = s, tr = FR.tr[d];
    if (ft && tr && tr.ov1 && from !== undefined && from !== to && (to === 0 || to === 1) && !(o && o.blend)) {
      const g = FT(tau - ks - len), v = to > from ? tr.ov1 : tr.ov0;
      if (g) { dx += g * 3 * v[0]; dy += g * 3 * v[1]; rot += g * .009 * SETTLE[d.replace('c-', '')] * (to > from ? 1 : -1); }
    }
    if (!st && tau < ks + len) st = [s, tau - ks];
    ks += len;
  }
  let fr;
  if (!st) fr = held('rest');
  else {
    const [[d, len, from, to, ez, o], x] = st;
    if (from === undefined) {
      fr = held(d);
      if (o && o.over) {       // a blink inside the hold
        const [name, at, c, hh, op] = o.over, y = x - at;
        if (Array.isArray(c)) { if (y > 0 && y < c.reduce((a, k) => a + k[1], 0) / 30) fr = celAt(name, c, y); }
        else if (y > 0 && y < c + hh + op) fr = framesAt(name, y < c ? EASE.io(y / c) : y < c + hh ? 1 : 1 - EASE.io((y - c - hh) / op));
      }
    } else if (o && o.xs) {   // cel: the drawing on the exposure sheet; the nod follows the drawing
      fr = celAt(d, o.xs, x);
      const nod = NOD[d.replace('c-', '')];
      if (nod) rot += nod * fr.i / (FR.tr[d].frames.length - 1);
    } else {
      const pos = from + (to - from) * (EASE[ez] || EASE.lin)(clamp(x / len, 0, 1));
      fr = framesAt(d, pos, o && o.blend);
      if (NOD[d]) rot += NOD[d] * pos;
    }
  }
  if (!ft) { dx = dy = 0; rot = NOD[e.type] ? rot : 0; }
  // a "moving hold": the held drawing drifts a degree or so over the event (the yawn stretches up), never static-dead
  else if (DRIFT[e.type]) rot += DRIFT[e.type] * Math.sin(Math.PI * clamp(tau / e.len, 0, 1));
  if (fr.sl) { rot += fr.sl.rot; dx += fr.sl.dx; dy += fr.sl.dy; sc = fr.sl.sc; }     // a slide (v5 C)
  // in a look, yawn or look-up the head rides the breath a little (drawCat), faded in and out with the event
  return { ...fr, rot, dx, dy, sc, type: e.type, ride: HOLD[e.type] ? sm(tau / .6) * sm((e.len - tau) / .6) : 0 };
}
const FSH = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1,t2;uniform vec4 r0,r1,r2,p1,p2;uniform float u;uniform mat3 hi;uniform vec2 nb;
vec4 samp(sampler2D t,vec4 r,vec2 a){vec2 uv=(a-r.xy)/r.zw;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)return vec4(0.);return texture2D(t,uv);}
bool inside(vec4 p,vec2 a){return a.x>=p.x&&a.y>=p.y&&a.x<p.x+p.z&&a.y<p.y+p.w;}
void main(){                       // the base drawing, with frame 1 (and frame 2 mixed in by u) over their patch rects
  // the head moves rigidly (hi: screen -> drawing) above nb.x; the neck fur below bends back to rest at the seam (nb.y)
  vec2 a=mix(ap,(hi*vec3(ap,1.)).xy,1.-smoothstep(nb.x,nb.y,ap.y));
  vec4 b=samp(t0,r0,a);
  vec4 c=inside(p1,a)?samp(t1,r1,a):b;
  if(u>0.)c=mix(c,inside(p2,a)?samp(t2,r2,a):b,u);
  gl_FragColor=c;
}`;
function drawHead(h, lift) {
  const L = catProg('catHead', FSH, ['m', 'rect', 't0', 't1', 't2', 'r0', 'r1', 'r2', 'p1', 'p2', 'u', 'hi', 'nb']);
  gl.useProgram(L.prog);
  if (!L.units) { gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1); gl.uniform1i(L.t2, 2); L.units = 1; }
  const sc = h.sc || 1, F = xform(NECK[0], NECK[1], h.rot || 0, sc, sc, h.dx || 0, h.dy || 0);
  const det = F[0] * F[4] - F[1] * F[3], ia = F[4] / det, ib = -F[1] / det, ic = -F[3] / det, id = F[0] / det;
  gl.uniformMatrix3fv(L.hi, false, [ia, ib, 0, ic, id, 0, -(ia * F[6] + ic * F[7]), -(ib * F[6] + id * F[7]), 1]);
  gl.uniform2f(L.nb, 590, 640);                   // rigid above art row 590, the seam (634-658) stays where the body expects it
  gl.uniformMatrix3fv(L.m, false, lift ? mul(view, xform(0, 0, 0, 1, 1, 0, -lift)) : view);
  gl.uniform4f(L.rect, HEADR[0] - 140, HEADR[1] - 140, HEADR[2] + 280, HEADR[3] + 140);   // room for the head to move
  const f2 = h.f2 || h.f1, rb = R(h.base) || HEADR;
  for (const [unit, t, r, loc] of [[0, h.base, rb, L.r0], [1, h.f1.t, h.f1.r, L.r1], [2, f2.t, f2.r, L.r2]]) {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[t] || tex['head-rest']); gl.uniform4f(loc, r[0], r[1], r[2], r[3]);
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform4f(L.p1, h.f1.p[0], h.f1.p[1], h.f1.p[2], h.f1.p[3]); gl.uniform4f(L.p2, f2.p[0], f2.p[1], f2.p[2], f2.p[3]);
  gl.uniform1f(L.u, h.f2 ? h.u : 0);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ---- tail (v4): path deform. The painted tail bends along its centre line: every mesh vertex keeps its place across
// the tail and its offset from the line turns with the line, so the fur bends smoothly with no joints and no kinks.
// The root and the arc beside the roof stay put; from about a third of the way down the hanging part sways, a slow wave
// runs down to the tip and the tip curls and uncurls. Quick bits: a flick about every 40 s, a tip twitch about every
// 15 s, a lazy swish about every 30 s.
const TAIL = [[2268, 1152], [2228, 1168], [2202, 1212], [2180, 1262], [2160, 1305], [2145, 1345], [2134, 1390], [2133, 1432],
              [2142, 1468], [2160, 1497], [2186, 1521], [2196, 1548]];
const TFIX = .3, TK = 96;                        // fixed up to 30 % of the length; centre line resampled to TK points
let tailMesh = null;
function buildTail() {
  const cr = [];                                  // Catmull-Rom through TAIL, then resampled evenly by arc length
  for (let i = 0; i < TAIL.length - 1; i++) {
    const p0 = TAIL[Math.max(0, i - 1)], p1 = TAIL[i], p2 = TAIL[i + 1], p3 = TAIL[Math.min(TAIL.length - 1, i + 2)];
    for (let k = 0; k < 16; k++) {
      const u = k / 16, u2 = u * u, u3 = u2 * u;
      cr.push([0, 1].map(d => .5 * (2 * p1[d] + (p2[d] - p0[d]) * u + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * u2 + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * u3)));
    }
  }
  cr.push(TAIL[TAIL.length - 1]);
  const cum = [0]; for (let i = 1; i < cr.length; i++) cum.push(cum[i - 1] + Math.hypot(cr[i][0] - cr[i - 1][0], cr[i][1] - cr[i - 1][1]));
  const Lt = cum[cum.length - 1], C = new Float32Array(TK * 2);
  for (let k = 0, j = 1; k < TK; k++) {
    const d = Lt * k / (TK - 1); while (j < cr.length - 1 && cum[j] < d) j++;
    const u = clamp((d - cum[j - 1]) / Math.max(1e-6, cum[j] - cum[j - 1]), 0, 1);
    C[k * 2] = cr[j - 1][0] + (cr[j][0] - cr[j - 1][0]) * u; C[k * 2 + 1] = cr[j - 1][1] + (cr[j][1] - cr[j - 1][1]) * u;
  }
  const r = R('cat-tail'), step = 4, nx = Math.ceil(r[2] / step) + 1, ny = Math.ceil(r[3] / step) + 1;
  const pos = new Float32Array(nx * ny * 2), uv = new Float32Array(nx * ny * 2), s = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i, x = r[0] + Math.min(i * step, r[2]), y = r[1] + Math.min(j * step, r[3]);
    pos[v * 2] = x; pos[v * 2 + 1] = y; uv[v * 2] = (x - r[0]) / r[2]; uv[v * 2 + 1] = (y - r[1]) / r[3];
    let best = 1e18, bs = 0;                      // closest point on the centre line, in sample units
    for (let k = 1; k < TK; k++) {
      const ax = C[k * 2 - 2], ay = C[k * 2 - 1], vx = C[k * 2] - ax, vy = C[k * 2 + 1] - ay;
      const u = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1), dx = ax + vx * u - x, dy = ay + vy * u - y, d = dx * dx + dy * dy;
      if (d < best) { best = d; bs = k - 1 + u; }
    }
    s[v] = bs;
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx); }
  tailMesh = { pos, uv, s, C, idx: new Uint16Array(idx), out: new Float32Array(pos.length), P: new Float32Array(TK * 2), D: new Float32Array(TK) };
}
// v3's flick (only for the v3 baseline in the development hook)
const flickK = tau => tau < 0 || tau > 1.4 ? 0 : (tau < .22 ? sm(tau / .22) : Math.exp(-(tau - .22) / .22) * Math.cos((tau - .22) * 5.2));
// the quick moves are baked from a small physics simulation of the hanging part (bake_tail.py, not in this repo):
// the muscles fire for a moment, the base leads, the tip lags, overshoots and settles. Angle offsets at 29 points, 30 fps.
const TS = window.MOON_CAT_TAIL || null;
function tailResp(name, tau, x) {
  const r = TS && TS[name]; if (!r || tau < 0) return 0;
  const f = tau * TS.fps, i = Math.floor(f); if (i >= r.length - 1) return 0;
  const u = f - i, xj = x * (TS.n - 1), j = Math.min(TS.n - 2, Math.floor(xj)), v = xj - j, a = r[i], b = r[i + 1];
  return (a[j] * (1 - v) + a[j + 1] * v) * (1 - u) + (b[j] * (1 - v) + b[j + 1] * v) * u;
}
// the bend: angle offset (rad) of the centre line at s (0 root .. 1 tip); + swings the hanging part out (left), - curls it in
function tailBend(t) {
  const tv = variant('tail');
  if (!catOn() || tv === 'still') return null;
  const amt = Math.min(1.4, .6 + .4 * settings.cat), sc = LAB && LAB.script;
  const ev = (k, per, seed, prob) => sc ? scripted(t, [k]) : slotAt(t, per / Math.max(.05, settings.cat), seed, prob, () => TAILEV[k]);
  const fl = ev('flick', 41, 330, .8);
  if (tv === 'v3') {                              // the v3 baseline: three joints on the outer half, small curl
    const c = k => (noise1((t - k * .5) / 8.5, 300) - .5) * 1.0 + Math.sin((t - k * .5) * 2 * Math.PI / 9.3) * .75;
    let a = [.07 * c(0) * amt, .17 * c(1) * amt, .3 * c(2) * amt];
    if (fl) { const tau = t - fl.t0; a = [a[0] - .03 * flickK(tau), a[1] - .15 * flickK(tau - .05), a[2] - .4 * flickK(tau - .11)]; }
    return s => a[0] * sm((s - .43) / .1) + a[1] * sm((s - .59) / .1) + a[2] * sm((s - .75) / .1);
  }
  // slow life: the hanging part sways, a lazy wave runs down to the tip, the tip curls and uncurls (7-12 s)
  const sway = amt * (.2 * (noise1(t / 9.5, 300) - .5) + .05 * Math.sin(t * 2 * Math.PI / 11.3));
  const curl = amt * (.4 * (noise1(t / 6.8, 301) - .5) + .09 * Math.sin(t * 2 * Math.PI / 7.7 + 1));
  const wv = amt * .11, ph = t / 6.4;
  const tw = ev('twitch', 15, 340, .75), sw = ev('swish', 31, 350, .7);
  const swd = sw ? (hash(351, sw.k !== undefined ? sw.k : Math.round(sw.t0)) > .4 ? 1 : -1) : 0;
  return s => {
    const x = clamp((s - TFIX) / (1 - TFIX), 0, 1);
    let d = sway * sm(x / .35) + curl * sm((x - .4) / .6) + wv * sm(x / .5) * Math.sin(2 * Math.PI * (x * .7 - ph));
    if (fl) d += tailResp('flick', t - fl.t0, x);
    if (tw) d += tailResp('twitch', t - tw.t0, x);
    if (sw) d += swd * tailResp('swish', t - sw.t0, x);
    return d;
  };
}
function skinTail(bend) {
  const m = tailMesh, C = m.C, P = m.P, D = m.D;
  for (let k = 0; k < TK; k++) D[k] = bend ? bend(k / (TK - 1)) : 0;
  P[0] = C[0]; P[1] = C[1];
  for (let k = 1; k < TK; k++) {                  // integrate the rest segments, each turned by its angle offset
    const a = (D[k] + D[k - 1]) / 2, co = Math.cos(a), si = Math.sin(a), vx = C[k * 2] - C[k * 2 - 2], vy = C[k * 2 + 1] - C[k * 2 - 1];
    P[k * 2] = P[k * 2 - 2] + co * vx - si * vy; P[k * 2 + 1] = P[k * 2 - 1] + si * vx + co * vy;
  }
  for (let v = 0; v < m.s.length; v++) {
    const sv = m.s[v], k = Math.min(TK - 2, Math.floor(sv)), f = sv - k, g = 1 - f;
    const a = D[k] * g + D[k + 1] * f, co = Math.cos(a), si = Math.sin(a);
    const ox = m.pos[v * 2] - (C[k * 2] * g + C[k * 2 + 2] * f), oy = m.pos[v * 2 + 1] - (C[k * 2 + 1] * g + C[k * 2 + 3] * f);
    m.out[v * 2] = P[k * 2] * g + P[k * 2 + 2] * f + co * ox - si * oy;
    m.out[v * 2 + 1] = P[k * 2 + 1] * g + P[k * 2 + 3] * f + si * ox + co * oy;
  }
}
function drawTailMesh(op = 1) {
  const L = P.mesh; gl.useProgram(L.prog);
  gl.uniformMatrix3fv(L.m, false, view); gl.uniform1f(L.op, op);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex['cat-tail']);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf); gl.bufferData(gl.ARRAY_BUFFER, tailMesh.out, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(1); gl.bindBuffer(gl.ARRAY_BUFFER, meshUV); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawElements(gl.TRIANGLES, tailMesh.idx.length, gl.UNSIGNED_SHORT, 0);
  gl.disableVertexAttribArray(1);
}

// ---- breath: a calm chest and shoulder breath (4.6 s; the head and legs stay put) and now and then a big slow breath, a
// sigh (Cat 50: about every 90 s, three breath cycles long): a deep 4.6 s inhale swells the chest, the shoulder line rises
// and the neck and head ride up with it, a short hold, a long 6 s exhale with the eyes half closing, a pause. During a
// look, yawn or look-up the head also rides the normal breath a little, so a held pose is never a frozen drawing.
// The body layer is drawn by its own small shader (FSB). Never whole-cat scaling.
const BP = 4.6, SIGH = 3;                        // breath period (s); sigh length in breaths
const FSB = `precision highp float;
varying vec2 ap;uniform sampler2D t0;uniform vec4 r0;uniform vec4 br;   // br: chest swell, neck+head lift, shoulder rise (art px)
void main(){
  vec2 a=ap;
  float g=smoothstep(668.,730.,a.y)*(1.-smoothstep(1000.,1090.,a.y));   // chest and shoulders only, not the neck seam or legs
  vec2 d1=(a-vec2(2300.,840.))/vec2(110.,190.),d2=(a-vec2(2575.,790.))/vec2(150.,150.);
  a-=g*(br.x*exp(-dot(d1,d1))*vec2(-1.,0.)+br.z*exp(-dot(d2,d2))*vec2(.55,-.5));
  a.y+=br.y*(1.-smoothstep(660.,980.,a.y));      // neck and shoulders lift with the head, fading out down the chest
  vec2 uv=(a-r0.xy)/r0.zw;
  gl_FragColor=(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)?vec4(0.):texture2D(t0,uv);
}`;
function catProg(k, fs, names) {                 // the cat's own programs: linked on first use and again after a context restore
  if (!P[k] || P[k].tex !== tex) { P[k] = link(VS, fs, names); P[k].tex = tex; }
  return P[k];
}
function sighAt(t) {
  if (LAB && LAB.script) {
    for (const [t0, type] of LAB.script) if (type === 'sigh') { const c0 = Math.ceil(t0 / BP); if (t >= c0 * BP && t < (c0 + SIGH) * BP) return { t0: c0 * BP, len: SIGH * BP }; }
    return null;
  }
  const f = settings.cat; if (!f) return null;
  const N = Math.max(SIGH + 4, Math.round(20 / f)), c = Math.floor(t / BP), slot = Math.floor(c / N);
  if (hash(610, slot) > .9) return null;
  const c0 = slot * N + 1 + Math.floor(hash(611, slot) * (N - SIGH - 1));
  if (c < c0 || c >= c0 + SIGH) return null;
  const t0 = c0 * BP, len = SIGH * BP;
  for (let u = t0 - 1.5; u < t0 + len + 1.5; u += .5) if (bigEvent(u)) return null;    // never with a look, yawn or look-up
  return { t0, len };
}
// chest swell, shoulder rise and neck+head lift (art px), eyes half closing (0..1)
function breathAt(t) {
  const bv = variant('breath'), none = { chest: 0, shoulder: 0, lift: 0, eyes: 0 };
  if (!catOn() || !bv || bv === 'off') return none;
  if (bv === 'v3') { const k = sm(.5 - .5 * Math.cos(t * 2 * Math.PI / 4.2)); return { ...none, chest: 3.2 * k, shoulder: 3.2 * k }; }
  const s = sighAt(t);
  if (s) {
    const v = (t - s.t0) / s.len, k = sm(v / .33) * (1 - sm((v - .38) / .44));
    return { chest: 16 * k, shoulder: 9 * k, lift: 10 * k, eyes: sm((v - .4) / .1) * (1 - sm((v - .74) / .1)) };
  }
  const c = Math.floor(t / BP), u = t / BP - c, k = sm(u / .4) * (1 - sm((u - .42) / .5)) * (.92 + .16 * hash(612, c));
  return { chest: 8.6 * k, shoulder: 3.5 * k, lift: 0, eyes: 0 };    // about 5 px chest and 1.5 px shoulder at 1080p
}
function drawBody(b) {
  const L = catProg('catBody', FSB, ['m', 'rect', 't0', 'r0', 'br']), r = R('cat-body');
  gl.useProgram(L.prog); gl.uniform1i(L.t0, 0);
  gl.uniformMatrix3fv(L.m, false, view);
  gl.uniform4f(L.rect, r[0] - 16, r[1] - 16, r[2] + 32, r[3] + 32);   // room for the swell
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex['cat-body']);
  gl.uniform4f(L.r0, r[0], r[1], r[2], r[3]); gl.uniform4f(L.br, b.chest, b.lift, b.shoulder, 0);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawCat() {
  let b = breathAt(time);
  const h = headState(time, b);
  if (h.ride) b = { ...b, lift: b.lift + .25 * b.chest * h.ride };     // in a look, yawn or look-up the head rides the breath (~1 px)
  drawBody(b);
  skinTail(tailBend(time)); drawTailMesh();
  drawHead(h, b.lift);
  return h;
}

// =====================================================================================================
// THE SCENE
// =====================================================================================================
function windAt(t) {
  const swell = .55 + .45 * Math.sin(t * .17) * Math.sin(t * .053 + 1.3);
  const slot = Math.floor(t / 13), u = t / 13 - slot;
  const gust = hash(7, slot) > .6 ? Math.sin(Math.PI * clamp((u - .2) / .55, 0, 1)) ** 2 : 0;
  return (swell * .6 + gust * .6) * settings.wind;
}
// bats: a drawn flap cycle (bat-flap.png, 6 cels in the painting's style), rare and small.
// One also crosses the sky while the cat looks up.
const bats = { n: 0 };
function drawBat(x, y, size, ang, phase, op = 1, dir = 1) {
  if (!bats.n) return;
  const i = ((Math.floor(phase * bats.n) % bats.n) + bats.n) % bats.n, name = 'bat' + i;
  const w = size, h = size * bats.h / bats.w;
  const r = [x - w / 2, y - h * .45, w, h];
  layer(name, { rect: r, r0: r, m: xform(x, y, ang, dir, 1), op });
}
function batPass(t, e, far, seed) {
  // one bat crossing: path across part of the sky with a soft swoop; flaps at ~5 Hz with glides
  const u = (t - e.t0) / e.len; if (u < 0 || u > 1) return;
  const dir = hash(seed, e.k) > .5 ? 1 : -1, y0 = (far ? 330 : 110) + hash(seed + 2, e.k) * (far ? 420 : 200);   // near bats stay above the cat's head
  const x0 = dir > 0 ? -160 : ART_W + 160, x1 = dir > 0 ? ART_W + 160 : -160;
  const x = x0 + (x1 - x0) * u, y = y0 + Math.sin(u * 5.3 + e.k) * 60 + Math.sin(u * 17) * 10;
  const glide = sm(clamp((Math.sin(u * 9 + e.k) - .55) * 4, 0, 1));          // now and then it glides with wings out
  const ph = t * (far ? 4.4 : 3.6) + seed * .37;
  drawBat(x, y, far ? 80 : 130, Math.sin(u * 5.3 + e.k) * .12 * dir, glide > .5 ? 2.5 / 6 : ph, far ? .85 : 1, dir);
}
function drawBats(head, farOnly) {
  const k = settings.creatures; if (!k) return;
  const c = paceClock('bats', k);                  // the passes are dealt on a Ghosts & witch clock: moving the slider never moves a bat in flight
  for (const [seed, per, far] of [[400, 47, 1], [420, 71, 0]]) {
    if (!!far !== farOnly) continue;
    const len = far ? 13 : 9, s0 = Math.floor(c / per);
    for (let s = s0 - 1; s <= s0; s++) {           // above 50 a pass can run on into the next slot
      const e = slotAt(s * per + .01, per, seed, .8, () => len);
      if (e) batPass(time, { ...e, t0: paceTime('bats', e.t0), len }, far, seed);
    }
  }
  // the look-up: a bat flies in from the upper left first, hovers where the cat looks, then leaves to the right over its head
  if (!farOnly) {
    let e = bigEvent(time); if (!e || e.type !== 'up') { e = bigEvent(time - 2); if (e && e.type !== 'up') e = null; }
    if (e) {
      const tau = time - e.t0, H = e.seq.find(k => k[0] === 'up')[1], td = .6 + .067 + H - .9;
      const S = [1430, 60], G = [2075, 245], E = [3480, 40], C2 = [2480, 130];
      let x, y;
      if (tau < 1.1) { const u = 1 - (1 - tau / 1.1) ** 2; x = S[0] + (G[0] - S[0]) * u; y = S[1] + (G[1] - S[1]) * u + Math.sin(u * 3.1) * 40; }
      else if (tau < td) { const h = tau - 1.1; x = G[0] + 28 * Math.sin(h * 1.9); y = G[1] + 14 * Math.sin(h * 3.8) - 6 * Math.sin(h * 1.1); }
      else { const h = td - 1.1, P0 = [G[0] + 28 * Math.sin(h * 1.9), G[1] + 14 * Math.sin(h * 3.8) - 6 * Math.sin(h * 1.1)], u = ((tau - td) / 2.3) ** 1.5;
        x = (1 - u) * (1 - u) * P0[0] + 2 * u * (1 - u) * C2[0] + u * u * E[0]; y = (1 - u) * (1 - u) * P0[1] + 2 * u * (1 - u) * C2[1] + u * u * E[1]; }
      if (tau >= 0 && tau < td + 2.3) drawBat(x, y, 110, Math.sin(tau * 2.3) * .1, tau * 4.2, 1, 1);
    }
  }
}

// atlas sprite: art rect `r` shows atlas region `a` of texture `name` (atlas at art scale), moved by matrix m
function sprite(name, r, a, o = {}) {
  const ar = R(name); if (!ar) return;
  layer(name, { ...o, rect: [r[0] - 2, r[1] - 2, r[2] + 4, r[3] + 4], r0: [r[0] - a[0], r[1] - a[1], ar[2], ar[3]] });
}
// every cloud: the X5 sky (drawSkyX5, v6 sky block), else the v6 sky spec when one is set up (drawSky6), else the v5 sky (drawPainted5 / drawSky5).
// Development hook only: LAB.sky.draw(api) lets a development page draw its own sky with its own code, without editing this file.
function drawClouds() {
  if (LAB && LAB.sky && LAB.sky.draw) return LAB.sky.draw({ gl, view, time, t: cloudClock(), wind: settings.clouds, tex, M, R, link, VS, quad, layer, hash, sm, ART_W, ART_H });
  if (skyX5On()) return drawSkyX5();                                   // the package's sky: X5 (v6 sky block)
  const s6 = sky6(); if (s6) return drawSky6(s6); const sp = paint5(); if (sp) drawPainted5(sp); else if (sky5On()) drawSky5();
}
// windows: now and then a lamp is switched off for a while and on again (a short warm fade each way). The multipliers are
// worked out here and handed to the shader as a 256 x 1 texture. Light strings and tiny panes only breathe.
// panes that belong to one window (close together, in the houses) go out and come on together
function windowGroups() {
  if (S4.grp) return S4.grp;
  const W = M.windows || [], n = W.length, par = [...Array(n).keys()], f = i => par[i] === i ? i : (par[i] = f(par[i]));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (W[i][0] || W[j][0] || W[i][3] < 1440 || W[j][3] < 1440) continue;
    if (Math.abs(W[i][2] - W[j][2]) < 45 && Math.abs(W[i][3] - W[j][3]) < 20) par[f(j)] = f(i);
  }
  const seed = new Array(n).fill(0); for (let i = 0; i < n; i++) seed[f(i)] += W[i][1];
  return S4.grp = { root: par.map((_, i) => f(i)), seed };
}
function windowMult(i, t) {            // i = sprite id + 1
  const inf = M.windows && M.windows[i - 1], a = hash(i, 801), b = hash(i, 802);
  const breath = .92 + .08 * Math.sin(t * (.55 + .6 * a) + 6.283 * b);
  if (!inf || inf[0]) return breath;
  const G = windowGroups(), r = G.root[i - 1] + 1; if (G.seed[r - 1] < 80) return breath;
  const P = 70 + 40 * hash(r, 803), q = (t + P * hash(r, 804)) / P, k = Math.floor(q), u = (q - k) * P;
  if (hash(r * 13 + k, 805) > Math.min(.7, .2 * settings.lights)) return breath;        // about six lamps a minute at Lights 50
  const D = 7 + 20 * hash(r * 13 + k, 806), t0 = 2 + hash(r * 13 + k, 807) * (P - D - 6), depth = .85 + .15 * hash(r * 13 + k, 808);
  return breath * (1 - depth * sm((u - t0) / 1.1) * (1 - sm((u - t0 - D) / 1.3)));
}
function drawLights() {
  const n = 'lights-pos', fx = M.fx[n], r = R(n); if (!tex[n] || !settings.lights) return;
  const S = s4(), L = P.lights, n2 = (M.windows || []).length;
  for (let i = 1; i <= n2; i++) S.winData[i * 4] = Math.round(clamp(windowMult(i, time), 0, 1) * 255);
  gl.useProgram(L.prog); gl.uniformMatrix3fv(L.m, false, view);
  gl.uniform4f(L.rect, r[0], r[1], r[2], r[3]); gl.uniform4f(L.r0, r[0], r[1], r[2], r[3]);
  gl.uniform1f(L.amt, Math.min(1.5, settings.lights));
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, S.win);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, S.winData);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex[fx.index]);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[n]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
  gl.bindTexture(gl.TEXTURE_2D, tex[fx.neg]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.blendEquation(gl.FUNC_ADD);
}
// candle: slow irregular breathing of the flame, never a strobe
const flicker = t => .86 + .08 * noise1(t * 2.3, 5) + .05 * noise1(t * 6.1, 6) + .02 * noise1(t * 13.7, 7);
function quadProg(L, r) {
  gl.useProgram(L.prog); gl.uniformMatrix3fv(L.m, false, view);
  gl.uniform4f(L.rect, r[0], r[1], r[2], r[3]); gl.uniform4f(L.r0, r[0], r[1], r[2], r[3]);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
function drawSmoke(w) {
  const a = (M.smoke && M.smoke.anchor) || [3121, 427], H = a[1] + 30, r = [a[0] - H * 1.1, a[1] - H + 30, H * 1.3, H];
  const L = P.smoke; quadProg(L, r);
  gl.uniform2f(L.mouth, a[0], a[1] - 2);
  gl.uniform1f(L.time, time); gl.uniform1f(L.wind, w); gl.uniform1f(L.amt, .5);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
const MIST = [0, 1215, 2350, 400];               // low over the lake and the town
function drawMist() {
  const L = P.mist; quadProg(L, MIST); const br = R('base');
  gl.uniform4f(L.rb, br[0], br[1], br[2], br[3]); gl.uniform1i(L.t0, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.base);
  gl.uniform1f(L.time, settings.wind ? time : 0); gl.uniform1f(L.amt, .42);       // the mist drifts with the scene's wind (settings.wind, fixed in WE)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
// ===== leaves v6 =====
// Replaces drawIvy / leafGone / leafEventK / drawLeaf of package/main.js (a development page cuts the package's ivy and falling-leaf sections and puts this in).
// The problem in v4: a falling leaf's source leaf is hidden on the vine, and under it ivy-stems.png has nothing (its alpha is cut out where the
// leaves were), so the base plate shows through: a leaf-shaped hole of sky or bare brick inside the dark ivy.
// v6: each leaf that can fall (the four highest, pivot y < 1000) has its own FILL sprite, the vine as it looks without that leaf, painted by Codex
// and cut to the leaf's footprint. It sits between ivy-stems and the leaves and is drawn only while its leaf is gone.
// Variants (LAB.leaf; the package default is the chosen one):
//   v4     the package as it is (hole)
//   bare   fill = the bare vine (stalk, dark foliage, bricks, sky)
//   behind fill = a smaller leaf in shade that was behind the lit one, so the vine never looks bald
// In both the leaf comes back 40 s after it landed by unfolding from its stalk (tiny, turned, opening over 10 s), opaque all the way.
// A fade-in was tried and dropped: for seconds the vine shows through a half-transparent leaf (the double image of a cross-dissolve).
// A gust only takes leaves that are on the vine (not in v4). A and B also cover the pale washed-out leaf on the chimney bricks under the top
// leaf (a leftover in ivy-stems.png) with the plate's own bricks (ivyFill.fix, out/ivy-fix.png), and lay the bare vine under every leaf in
// the dark ivy mass (ivyFill.sway): ivy-stems.png has a hole under each leaf, so a leaf swaying a few degrees uncovered lighter bricks,
// roof tiles or sky at its edge (to avoid a cut-out look).
// a gust slot every 40 s at Leaves 50, dealt on a Leaves clock (paceClock): the slider sets how fast it runs, so moving it never re-deals the
// gusts that have begun (Wind 0 stops them too: a still scene). LEAF_BACKK slots cover the 110 s a gust lasts at the fastest pace (Leaves 100).
// Leaves slider: 25 and below, no leaves fall (a leaf already in the air lands); 0 also holds the ivy still. 50 tuned, 100 twice as often.
const leafRate = () => { const l = settings.leaves; return l <= .5 ? 0 : l < 1 ? (l - .5) * 2 : l; };
const LEAF_PER = 40, LEAF_LEN = 30, LEAF_BACKK = 7, leafClock = () => paceClock('leaves', leafRate());
const leafMode = () => (LAB && LAB.leaf) || M.leafMode || 'bare';
const fillOf = i => { const F = M.ivyFill, m = leafMode(), set = F && F[m]; return set && set[i] ? { tex: F.tex[m], ...set[i] } : null; };
// ivy: every leaf turns a little on its own stalk (pivot), a slow sway plus a shiver in gusts; it fades out below Leaves 25 and stops at 0
function ivyAng(i, t, w) {
  const ph = 6.28 * hash(600, i), sp = 1.1 + .9 * hash(601, i), k = Math.min(1, settings.leaves * 2);
  return settings.wind && k ? k * ((.035 * Math.sin(t * sp + ph) + .02 * Math.sin(t * sp * 2.7 + ph * 2)) * (.3 + w) + .06 * w * (noise1(t * 1.7 + i, 602) - .5)) : 0;
}
function drawIvy(w) {
  const mode = leafMode(), fx = M.ivyFill && M.ivyFill.fix;
  if (mode !== 'v4' && fx) sprite(fx.tex, fx.rect, fx.atlas, {});   // the plate's bricks over the pale washed-out leaf stuck on the chimney
  const sw = M.ivyFill && M.ivyFill.sway;                             // under every leaf in the dark mass: the bare vine, so a swaying leaf uncovers vine
  if (mode !== 'v4' && sw) for (const i in sw) sprite(M.ivyFill.tex.sway, sw[i].rect, sw[i].atlas, {});
  if (mode !== 'v4') (M.ivy || []).forEach((l, i) => {       // the fill under a leaf that is away (or still growing back)
    const st = leafState(i); if (st.op >= 1) return;
    const f = fillOf(i); if (!f) return;
    sprite(f.tex, f.rect, f.atlas, {});
  });
  (M.ivy || []).forEach((l, i) => {
    const st = leafState(i); if (st.op <= 0) return;
    const ang = ivyAng(i, time, w);
    let m = ang ? xform(l.pivot[0], l.pivot[1], ang) : null;
    if (st.grow !== undefined && st.grow < 1) {                  // unfolds from its stalk: tiny, turned and folded at first, opaque
      const g = st.grow, s = .06 + .94 * EASE.out(g), turn = (1 - g) * .45;
      m = xform(l.pivot[0], l.pivot[1], ang + turn, s, s * (.55 + .45 * g));
      sprite('ivy-atlas', l.rect, l.atlas, { m, op: sm(g / .06) });
      return;
    }
    sprite('ivy-atlas', l.rect, l.atlas, { m, op: st.op });
  });
}
// leaves that really fall. Now and then (Leaves 50: about every 45 s) a gust lets go of one to three ivy leaves high on the chimney.
// The motion is baked from a physical model (a rigid plate with added mass, circulation lift and drag, the falling-card model
// of Pesavento and Wang / Andersen et al.), so the swings, glides, hooks and turn-overs are not hand-made: each track holds the leaf's
// position, its chord angle and a slow spin about its own normal, every 0.1 s. A camera that looks down at the roof projects the leaf's two
// axes to a 2x2 matrix (leafMatrix), so the sprite shears, foreshortens and turns over (darker underside) like a real tilted leaf.
// The two highest leaves are blown across the sky and the moon (GLIDE, then fade); the lower ones DROP onto the roof, settle, lie a few
// seconds and fade.
// A gust only takes leaves that are on the vine at that moment (a leaf now stays away about a minute, so a later gust could otherwise
// pick it again: a second copy from an empty spot). So event k depends on the events before it: they are worked out once, in order
// from k = 0, and kept (LEAF_MEMO).
const LEAF_MEMO = { ver: 0, mode: '', ev: [] }, LEAF_NOW = { t: NaN };
function leafEventK(k) {
  if (!settings.wind || !M.ivy || !M.leafTracks || k < 0) return null;            // Leaves 25 and below: the clock stands still, so no new gust starts
  const mode = leafMode(), ver = paceVer('leaves');
  if (LEAF_MEMO.mode !== mode) Object.assign(LEAF_MEMO, { mode, ver, ev: [] });
  else if (LEAF_MEMO.ver !== ver) {               // the Leaves slider moved: keep the gusts that have begun (and empty slots already reached), deal the rest again
    const ev = LEAF_MEMO.ev, c = leafClock(); let n = 0;
    while (n < ev.length && (ev[n] ? ev[n].t0 <= time : n * LEAF_PER <= c)) n++;
    ev.length = n; LEAF_MEMO.ver = ver;
  }
  const ev = LEAF_MEMO.ev;
  while (ev.length <= k) ev.push(leafEventNew(ev.length, ev));
  return ev[k];
}
function leafEventNew(k, ev) {
  const e = slotAt(k * LEAF_PER + .01, LEAF_PER, 700, .85, () => LEAF_LEN); if (!e) return null;
  e.t0 = paceTime('leaves', e.t0);                // the slot is on the Leaves clock, the gust in scene time
  const away = new Set(), [after, over] = LEAF_BACK[leafMode()] || LEAF_BACK.bare;
  if (leafMode() !== 'v4') for (let j = Math.max(0, k - 12); j < k; j++) if (ev[j]) for (const lf of ev[j].leaves)
    if (ev[j].t0 + lf.d + leafPath(lf).dur + after + over + 2 > e.t0) away.add(lf.i);
  const pool = M.ivy.map((l, i) => i).filter(i => M.ivy[i].pivot[1] < 1000 && !away.has(i)).sort((a, b) => M.ivy[a].pivot[1] - M.ivy[b].pivot[1]), leaves = [];   // the highest leaves first
  const n = hash(703, e.k) < .4 ? (hash(704, e.k) < .45 ? 3 : 2) : 1;
  for (let j = 0; j < n && pool.length; j++) {
    const i = pool.splice(Math.floor(hash(710 + j, e.k) ** 1.6 * pool.length), 1)[0];
    leaves.push({ i, d: j ? leaves[j - 1].d + .5 + 1.1 * hash(715 + j, e.k) : 0, s: e.k * 11 + j });
  }
  return leaves.length ? { ...e, leaves } : null;
}
// the events around now: the natural schedule, or (development hook) LAB.leafScript = [[t0, [leaf indices]], ...] alone
function leafEvents() {
  if (LAB && LAB.leafScript) return !settings.leaves ? [] : LAB.leafScript.map(([t0, ids], n) => ({ k: n, t0, leaves: ids.map((i, j) => ({ i, d: j * 1.1, s: 37 + n * 11 + j + (LAB.leafSeed || 0) })) }));
  const c = leafClock(), N = LEAF_NOW;            // asked for every ivy leaf: worked out once per frame
  if (N.t === time && N.c === c && N.wind === settings.wind && N.pv === paceVer('leaves') && N.mode === LEAF_MEMO.mode && N.ev === LEAF_MEMO.ev) return N.out;
  const k0 = Math.floor(c / LEAF_PER), out = [];
  for (let dk = LEAF_BACKK; dk >= 0; dk--) { const e = leafEventK(k0 - dk); if (e) out.push(e); }
  return Object.assign(N, { t: time, c, wind: settings.wind, pv: paceVer('leaves'), mode: LEAF_MEMO.mode, ev: LEAF_MEMO.ev, out }).out;
}
function leafPath(lf) {
  const glide = M.ivy[lf.i].pivot[1] < 800, list = M.leafTracks.tracks[glide ? 'glide' : 'drop'];
  const tr = list[Math.floor(hash(720, lf.s) * list.length)];
  return { tr, glide, dur: tr.dur, sc: 1.45 + .2 * hash(729, lf.s) };
}
function trackAt(tr, tau) {                         // Catmull-Rom through the baked samples (dx, dy, theta, psi)
  const P = tr.p, n = P.length, f = clamp(tau * tr.hz, 0, n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
  const a = P[Math.max(i - 1, 0)], b = P[i], c = P[i + 1], d = P[Math.min(i + 2, n - 1)], o = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) o[k] = .5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u * u + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u * u * u);
  return o;
}
function leafMatrix(th, psi) {                      // 3D leaf -> 2D: right axis cos(psi) c + sin(psi) s, down axis -sin(psi) c + cos(psi) s, chord c, span s
  const E = M.leafTracks.elev, ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(psi), sp = Math.sin(psi), cE = Math.cos(E), sE = Math.sin(E);
  return { a: cp * ct, b: -sp * ct, c: -(cp * st * cE - sp * sE), d: sp * st * cE + cp * sE, front: ct * sE > 0 };
}
function leafPose(p, tau) {
  let [dx, dy, th, psi] = trackAt(p.tr, tau);
  if (!p.glide) th += (Math.round(th / Math.PI) * Math.PI - th) * sm((tau - (p.dur - 2.8)) / 2.8);     // on the roof it lies flat, face up or down
  const m = leafMatrix(th, psi), bl = sm(tau / 1.2), s = p.sc;                                         // from the face-on pose on the vine into the 3D pose
  let a = (1 - bl) + bl * m.a * s, b = bl * m.b * s, c = bl * m.c * s, d = (1 - bl) + bl * m.d * s;
  // never thinner than a quarter of its width: the 2x2 sprite matrix is rebuilt from its singular values with the smaller one floored (sign kept, so it still turns over)
  const E = (a + d) / 2, F = (a - d) / 2, G2 = (c + b) / 2, H2 = (c - b) / 2, Q = Math.hypot(E, H2), Rr = Math.hypot(F, G2), sx = Q + Rr, sy = Q - Rr;
  const ratio = sx > 1e-6 ? sy / sx : 1, sy2 = (sy < 0 ? -1 : 1) * Math.max(Math.abs(sy), .25 * sx);
  const a1 = Math.atan2(G2, F), a2 = Math.atan2(H2, E), th2 = (a2 - a1) / 2, ph = (a2 + a1) / 2, ct = Math.cos(th2), st = Math.sin(th2), cp = Math.cos(ph), sp = Math.sin(ph);
  a = cp * sx * ct - sp * sy2 * st; b = -cp * sx * st - sp * sy2 * ct; c = sp * sx * ct + cp * sy2 * st; d = -sp * sx * st + cp * sy2 * ct;
  return { dx, dy, a, b, c, d, ratio, front: m.front || bl < .3, op: p.glide ? 1 - sm((tau - p.dur + 3.2) / 3.2) : 1 - sm((tau - p.dur - 6.5) / 3.5) };
}
// the leaf on the vine: op (1 = there, 0 = away) and grow (0..1 while it unfolds; not in v4)
const LEAF_BACK = { v4: [12, 3], bare: [40, 10], behind: [40, 10] };      // seconds after the fall ends: [comes back after, over]
function leafState(i) {
  if (!settings.wind || !M.leafTracks) return { op: 1 };
  const mode = leafMode(), [after, over] = LEAF_BACK[mode] || LEAF_BACK.bare;
  let st = { op: 1 };
  for (const e of leafEvents()) for (const lf of e.leaves) {
    if (lf.i !== i) continue;
    const rel = e.t0 + lf.d; if (time < rel) continue;
    const dt = time - rel - leafPath(lf).dur - after;
    if (dt < 0) st = { op: 0 };
    else if (dt < over) st = mode === 'v4' ? { op: Math.min(st.op, sm(dt / over)) } : { op: .999, grow: dt / over };
  }
  return st;
}
function leafGone(i) { return leafState(i).op; }
if (LAB) window.leafLabEvents = (k0, k1) => { const o = []; for (let k = k0; k <= k1; k++) { const e = leafEventK(k); if (e) o.push({ k, t0: e.t0, leaves: e.leaves.map(l => [l.i, +(e.t0 + l.d).toFixed(2), +(e.t0 + l.d + leafPath(l).dur).toFixed(2)]) }); } return o; };
if (LAB) window.leafLabInfo = () => {                // development hook: when the last scripted leaf starts to come back (scene time)
  const e = LAB.leafScript && leafEvents().pop(); if (!e) return null;
  const lf = e.leaves[e.leaves.length - 1], [after] = LEAF_BACK[leafMode()] || LEAF_BACK.bare;
  return e.t0 + lf.d + leafPath(lf).dur + after;
};
function drawLeaf() {
  if (!M.leafTracks) return;
  for (const e of leafEvents()) {
    for (const lf of e.leaves) {
      const tau = time - e.t0 - lf.d; if (tau < 0) continue;
      const p = leafPath(lf); if (tau > p.dur + (p.glide ? 0 : 10.5)) continue;
      const q = leafPose(p, tau), l = M.ivy[lf.i], r = l.rect, a = l.atlas, cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
      const px = cx + q.dx, py = cy + q.dy, warm = Math.exp(-(((px - 2900) / 330) ** 2 + ((py - 1010) / 330) ** 2));   // the pumpkin's light
      const m = [q.a, q.c, 0, q.b, q.d, 0, px - (q.a * cx + q.b * cy), py - (q.c * cx + q.d * cy), 1];
      const kf = sm((q.ratio + .12) / .3), tf = [1.3 + .2 * warm, 1.2 + .08 * warm, 1.1], tb = [.85 + .2 * warm, .72 + .06 * warm, .75];     // the colour passes through the middle as it turns over
      const tint = [tb[0] + (tf[0] - tb[0]) * kf, tb[1] + (tf[1] - tb[1]) * kf, tb[2] + (tf[2] - tb[2]) * kf];
      drawSpr('ivy-atlas', [r[0] - 2, r[1] - 2, r[2] + 4, r[3] + 4], [a[0] - 2, a[1] - 2, a[2] + 4, a[3] + 4], { m, op: q.op, tint });
    }
  }
}
// ===== end leaves v6 =====
// embers: now and then a spark rises from the jack-o'-lantern, drifts up a little and goes out (Lights)
function drawEmbers() {
  if (!settings.lights || !tex.ember) return;
  for (let j = 0; j < 3; j++) {
    const per = 2.6, k = Math.floor(time / per) - j, t0 = k * per + hash(720, k) * 1.2, life = 3.4 + 1.6 * hash(721, k), tt = time - t0;
    if (hash(722, k) > .55 * Math.min(1.5, settings.lights) || tt < 0 || tt > life) continue;
    const u = tt / life, x = 2880 + 70 * hash(723, k) + Math.sin(tt * 1.7 + k) * 14 * u - 40 * u * u, y = 905 - (150 + 110 * hash(724, k)) * (1 - (1 - u) ** 1.4);
    const s = 9 + 5 * hash(725, k), a = sm(tt / .35) * (1 - sm((u - .45) / .55)) * (.75 + .25 * Math.sin(tt * 9 + k));
    const rr = [x - s / 2, y - s / 2, s, s];
    layer('ember', { rect: rr, r0: rr, add: true, op: a });
  }
}
// ---- v4 scene: swaying trees, a lake that moves, more clouds, leaves that really fall.
// Programs and small textures are built on first use, and again after a context restore (`tex` is replaced then).
// The trees: the painting's trees are cut out (trees.png) over a clean plate (the new base.jpg). Each pixel carries a sway weight
// (height above the root, trees-sway.png): the tip moves most, the root not at all, one gust signal drives them all and rolls through
// from the right; the pine and bushes also rustle a little inside (slow smooth noise).
const FST = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1;uniform vec4 r0;uniform float time,lean,osc,flut;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y);}
void main(){
  vec4 s=texture2D(t1,(ap-r0.xy)/r0.zw);
  float ph=time*1.05+ap.x*.0042+s.g*2.2;
  float dx=s.r*(-lean+osc*(.75*sin(ph)+.25*sin(ph*2.3+s.g*6.)));
  vec2 q=ap/62.;
  vec2 d2=s.b*flut*vec2(n2(q+vec2(time*.5,0.))-.5,n2(q*1.2+vec2(7.,time*.4))-.5);
  gl_FragColor=texture2D(t0,(ap-vec2(dx,0.)-d2-r0.xy)/r0.zw);
}`;
// The v4 lake (development hook only since v5; its mask is the v4 water-mask.png, not in this repo, R = water, G = how much of a
// reflection): inside the mask the rows of the painted reflections wander
// sideways, slowly and smoothly (the moon path and the town lights' dashes shimmer as vertical streaks), and thin pale strokes
// are born, drift left and fade over seconds (gold in the moon path). Nothing twinkles: every stroke lives 6-12 s.
const FSW = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1;uniform vec4 r0,rb;uniform float time,amt;
float h(float n){return fract(sin(n*12.9898)*43758.5453);}
float strokes(vec2 p,float yy,float seed){
  float RH=11.,r=floor((p.y-1384.)/RH),f=fract((p.y-1384.)/RH);
  float sp=1.2+2.4*h(r*3.1+seed),cl=110.+90.*h(r*7.7+seed);
  float xs=p.x+sp*time+h(r+seed*2.)*3000.,cx=floor(xs/cl),fx=xs/cl-cx;
  float life=6.+6.*h(cx*1.7+r*5.3+seed),q=(time+life*h(cx*9.1+r*2.7))/life,k=floor(q),u=q-k;
  float on=step(.62,h(cx*13.3+r*1.9+k*17.1+seed));
  float c=.28+.44*h(cx*5.9+r*8.3+k*3.3);
  float len=min((.09+.1*h(cx*2.9+r*6.1+k))*(.5+1.2*yy),min(c,1.-c)-.02);
  float prof=(1.-smoothstep(.55,1.,abs(fx-c)/len))*(1.-smoothstep(.1,.22,abs(f-.5)));
  return on*pow(sin(3.14159*u),2.)*prof;
}
void main(){
  vec2 uv=(ap-r0.xy)/r0.zw;
  vec4 mk=texture2D(t1,uv);float m=mk.r;
  if(m<.004){gl_FragColor=vec4(0.);return;}
  vec3 c0=texture2D(t0,(ap-rb.xy)/rb.zw).rgb;
  m*=smoothstep(.09,.16,dot(c0,vec3(.3,.5,.2)));      // never on the dark trees and roofs along the shore (the mask edge is only approximate there)
  if(m<.004){gl_FragColor=vec4(0.);return;}
  float yy=clamp((ap.y-1390.)/130.,0.,1.);
  float a=amt*(1.+3.*mk.g);
  float dx=a*(.65*sin(ap.y*.05-time*.5+ap.x*.0018)+.35*sin(ap.y*.11+time*.33+1.7));     // neighbouring rows move almost together: no comb teeth on the moon path
  vec3 c=texture2D(t0,(vec2(ap.x+dx,ap.y)-rb.xy)/rb.zw).rgb;
  float s=strokes(ap,yy,1.)+.8*strokes(ap+vec2(300.,5.),yy,9.);
  float pw=exp(-pow((ap.x-1790.)/140.,2.));
  c+=amt*s*mix(vec3(.2,.24,.4),vec3(.55,.42,.2),pw);
  gl_FragColor=vec4(c*m,m);
}`;
// a sprite out of an atlas, anywhere (matrix m), with a tint; moon > 0 fades it out outside the moon's disc (dark wisps only
// show where the moon is behind them)
const FSK = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1;uniform vec4 rect,sa,rm;uniform vec2 asz;uniform float op,moon,sky;uniform vec3 tint;
void main(){
  vec2 uv=(sa.xy+(ap-rect.xy)/rect.zw*sa.zw)/asz;
  vec4 c=texture2D(t0,uv)*op;c.rgb*=tint;
  if(sky>0.){vec2 u=(ap-rm.xy)/rm.zw;if(u.x>=0.&&u.y>=0.&&u.x<=1.&&u.y<=1.)c*=texture2D(t1,u).r;}   // wisps pass behind the chimney and the roof
  if(moon>0.){vec2 d=ap-vec2(2308.,568.);vec2 e=vec2(dot(d,vec2(.9664,-.2571))/556.,dot(d,vec2(.2571,.9664))/519.);
    float k=1.-smoothstep(.9,1.06,length(e));c*=moon>1.5?1.-.7*k:k;}
  gl_FragColor=c;
}`;
// small cel smoke from three chimneys in the town: the chimney smoke's recipe at a third of the size, each on its own clock
const FSS2 = `precision highp float;
varying vec2 ap;uniform vec2 mouth;uniform float time,wind,amt,sc;
float h(float n){return fract(sin(n*12.9898)*43758.5453);}
void main(){
  float cover=0.,best=9.,lit=0.;
  for(int j=0;j<17;j++){
    float k=floor(time/.5)-float(j);
    float age=(time-k*.5)/8.;
    if(age<0.||age>1.)continue;
    float hgt=320.*sc*pow(age,.85);
    vec2 c=mouth+vec2(-hgt*hgt/(320.*sc)*(.35+.75*wind)-hgt*.1+sin(age*3.5+k*.9)*10.*sc*age,-hgt);
    float r=sc*(12.+44.*pow(age,.7))*(.85+.3*h(k));
    vec2 d=ap-c;float ang=atan(d.y,d.x);
    float lump=1.+.12*sin(3.*ang+k*1.7+age*2.)+.06*sin(5.*ang-k*2.3);
    float dist=length(d)/(r*lump);
    cover=max(cover,1.-smoothstep(1.-1.2/r,1.,dist));
    if(dist<best){best=dist;lit=step(.3,dot(d/(r*lump),normalize(vec2(-.8,-.6))));}
  }
  float y=(mouth.y-ap.y)/(320.*sc);
  float A=cover*amt*smoothstep(-.02,.03,y)*(1.-smoothstep(.3,.9,y));
  vec3 col=mix(vec3(.36,.36,.5),vec3(.58,.57,.7),lit);
  gl_FragColor=vec4(col*A,A);
}`;
const S4 = { tex: null };
function s4() {
  if (S4.tex === tex) return S4;
  S4.tex = tex;
  S4.trees = link(VS, FST, ['m', 'rect', 'r0', 't0', 't1', 'time', 'lean', 'osc', 'flut']);
  S4.water = link(VS, FSW, ['m', 'rect', 'r0', 'rb', 't0', 't1', 'time', 'amt']);
  S4.smoke2 = link(VS, FSS2, ['m', 'rect', 'mouth', 'time', 'wind', 'amt', 'sc']);
  S4.spr = link(VS, FSK, ['m', 'rect', 'sa', 'asz', 't0', 't1', 'rm', 'op', 'moon', 'sky', 'tint']);
  S4.win = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, S4.win);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  S4.winData = new Uint8Array(256 * 4).fill(255);
  return S4;
}
const TOWN_SMOKE = [[956, 1408, .42, 0], [1411, 1487, .36, 3.1], [1032, 1450, .32, 5.7]];   // chimney mouth x, y, size, time offset
function drawTownSmoke(w) {
  const L = s4().smoke2;
  for (const [x, y, sc, ph] of TOWN_SMOKE) {
    quadProg(L, [x - 540 * sc, y - 320 * sc - 40, 700 * sc, 320 * sc + 60]);
    gl.uniform2f(L.mouth, x, y - 1); gl.uniform1f(L.time, .5 * time + 20 + ph); gl.uniform1f(L.wind, w); gl.uniform1f(L.amt, .5); gl.uniform1f(L.sc, sc);   // half the big chimney's pace (town smoke is 2x slower)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
function drawTrees() {
  const r = R('trees'); if (!tex.trees || !tex['trees-sway']) return;
  const L = s4().trees, w = windAt(time), amp = Math.min(1.5, settings.wind);
  quadProg(L, r); gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex['trees-sway']);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.trees);
  gl.uniform1f(L.time, time); gl.uniform1f(L.lean, 5 * w); gl.uniform1f(L.osc, 7 * amp + 9 * w); gl.uniform1f(L.flut, amp ? 6 + 6 * w : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
// ---- v5 lake: the water is cut out and repainted. A Codex calm-water plate (water-plate) fills a precise mask
// (water-mask: R = water, G = where the painting has its moon path, A = the shore row each water pixel mirrors about), and slow
// travelling waves on a perspective plane (x = dx / dy, z = 2000 / dy, dy = y - YH: a grazing view, so crests are long and thin on
// screen) carry a mirror of the lit far shore (water-shore: hills and castle-hill windows) and a soft moon glitter from the wave slopes.
// Drawn right after the window lights, so it also covers their static streaks below the far shore. This is variant B of the three tried; A (cel
// bands) and C (mirror + cel path) were rejected (the glints looked wrong on the painting). LAB.water = 'v4' shows the old lake.
// Nothing twinkles: the shortest wave has a 6 s period and every wave fades out before it gets under ~7 art px on screen.
const FSW5 = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1,t2;uniform vec4 r0,rs;uniform float time,amt;
const float YH=1250.,XC=1810.,FZ=2000.;
vec3 W,W2;float VZ;
float hn(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hn(i),hn(i+vec2(1,0)),f.x),mix(hn(i+vec2(0,1)),hn(i+1.),f.x),f.y);}
void wave(vec2 g,float dy,float lam,float ang,float per,float st,float ph){   // height, d/dX, d/dZ on the ground plane
  float k=6.2832/lam,sz=lam/cos(ang)*dy*dy/FZ;vec2 d=vec2(sin(ang),-cos(ang));
  float lod=smoothstep(5.,9.,sz);
  float p=k*dot(d,g)-6.2832*time/per+ph;
  vec3 v=vec3(st/k*sin(p),st*cos(p)*d);
  W+=lod*v;W2+=smoothstep(8.,16.,sz)*v;     // W2: only the longer waves, for the mirror (no 1-2 px wobble)
  VZ+=lod*lod*st*st*d.y*d.y*.5;             // variance of the slope toward the viewer, to normalise the glitter
}
void main(){
  vec2 uv=(ap-r0.xy)/r0.zw;
  vec4 mk=texture2D(t0,uv);float m=mk.r;
  if(m<.004){gl_FragColor=vec4(0.);return;}
  float env=mk.g,axis=r0.y+mk.a*255.,dy=ap.y-YH;
  vec2 g=vec2((ap.x-XC)/dy,FZ/dy);
  // a slow domain warp: crests bunch up and spread out, so the glitter is irregular, not ruled stripes
  g+=vec2(.35*(vn(vec2(g.x*1.3+time*.012,g.y*.9))-.5),.5*(vn(vec2(g.x*2.1,g.y*1.6-time*.02)+4.)-.5));
  W=vec3(0.);W2=W;VZ=0.;
  wave(g,dy,.62,.07,13.,.075,0.);
  wave(g,dy,.43,-.2,11.,.09,1.7);
  wave(g,dy,.31,.28,9.5,.09,4.1);
  wave(g,dy,.23,-.09,8.,.09,2.6);
  wave(g,dy,.165,.17,7.,.08,5.3);
  wave(g,dy,.12,-.31,6.,.07,3.7);
  // slow patches of calmer and rougher water drift across the lake, so the path breaks up irregularly
  float gust=.55+.9*vn(vec2(g.x*1.1+time*.018,g.y*.16-time*.025))*vn(vec2(g.x*.6-time*.011+3.,g.y*.09+7.));
  vec3 w=W*amt*gust,w2=W2*amt*gust;
  float near=smoothstep(120.,310.,dy),below=ap.y-axis;
  vec3 c=texture2D(t1,uv+vec2(w.y*dy*.03,w.z*dy*.025)/r0.zw).rgb;      // the calm plate, refracted by about a pixel
  float sig=.17*max(amt,.05),rel=-w.z/sig;
  float F=(-w.z-.5*abs(w.y))/(max(sqrt(VZ),.075)*sqrt(max(amt,.05))*gust);   // facets tilted toward the moon (not sideways), rougher
  // with Wind (F grows with sqrt(amt)); where only one long wave is left (near the far shore) F stays small, so the path is solid there
  // as in the painting, not striped
  float ek=smoothstep(.03,.2,env);
  // the mirror: the far shore above the axis, seen through the waves (lights become broken vertical streaks)
  vec2 q=vec2(ap.x+.07*w2.y*dy,min(2.*axis-ap.y+.6*w2.z*dy,axis-1.));
  vec3 sh=texture2D(t2,(q-rs.xy)/rs.zw).rgb;
  vec3 su=texture2D(t2,(q-vec2(0.,2.5)-rs.xy)/rs.zw).rgb,sd=texture2D(t2,(q+vec2(0.,2.5)-rs.xy)/rs.zw).rgb;
  float wl=max(sh.r-.85*sh.b,max(su.r-.85*su.b,sd.r-.85*sd.b));          // each light sampled taller: bigger, steadier streaks
  float warm=clamp(wl*2.4,0.,1.)*exp(-below/55.);                          // only lights near their shore reflect (deep ones twinkled)
  float sp=1.5+.12*below;                                                // the mirror smears more the further it is from its shore
  vec3 r=.3*sh;for(int i=-2;i<=2;i++)if(i!=0)r+=.175*texture2D(t2,(vec2(q.x,min(q.y+float(i)*sp,axis-1.))-rs.xy)/rs.zw).rgb;
  c=mix(c,r*vec3(.86,.9,1.)+vec3(.0,.01,.03),mix(.62,.38,near));
  c*=1.+.07*clamp(rel,-2.,2.)*(.4+.6*near);
  c+=vec3(1.,.55,.22)*warm*.55;
  // the moon path: soft glitter where the wave slopes catch the moon, inside the painting's own path
  float tb=mix(1.5,-1.9,env),gb=smoothstep(tb-.9,tb+.6,F)*ek;
  c=mix(c,vec3(1.,.83,.48),gb*.9);c+=vec3(.35,.3,.18)*smoothstep(tb+.6,tb+1.8,F)*smoothstep(.5,.85,env);
  gl_FragColor=vec4(c*m,m);
}`;
const W5 = { tex: null };
function water5() {
  if (W5.tex === tex) return W5;
  W5.tex = tex;
  W5.prog = link(VS, FSW5, ['m', 'rect', 'r0', 'rs', 't0', 't1', 't2', 'time', 'amt']);
  return W5;
}
function drawWater() {
  if (!settings.wind) return;
  if (LAB && LAB.water === 'v4') {   // the v4 lake, kept for the development hook (its mask is injected by a development page)
    const r = R('water-mask-v4'); if (!tex['water-mask-v4']) return;
    const L = s4().water, br = R('base');
    quadProg(L, r); gl.uniform4f(L.rb, br[0], br[1], br[2], br[3]); gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex['water-mask-v4']);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.base);
    gl.uniform1f(L.time, time); gl.uniform1f(L.amt, Math.min(1.5, settings.wind));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return;
  }
  const r = R('water-mask'), rs = R('water-shore');
  if (!tex['water-mask'] || !tex['water-plate'] || !tex['water-shore']) return;
  const L = water5().prog;
  quadProg(L, r); gl.uniform4f(L.rs, rs[0], rs[1], rs[2], rs[3]);
  ['water-mask', 'water-plate', 'water-shore'].forEach((n, i) => { gl.uniform1i(L['t' + i], i); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[n]); });
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1f(L.time, time); gl.uniform1f(L.amt, Math.min(1.5, settings.wind));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
// sprite from an atlas: art rect r, atlas region a (atlas px), optional matrix m, opacity, tint, moon mask
function drawSpr(name, r, a, o = {}) {
  const ar = R(name); if (!tex[name] || !ar) return;
  const L = s4().spr; quadProg(L, r);
  gl.uniformMatrix3fv(L.m, false, o.m ? mul(view, o.m) : view);
  gl.uniform4f(L.rect, r[0], r[1], r[2], r[3]); gl.uniform4f(L.sa, a[0], a[1], a[2], a[3]); gl.uniform2f(L.asz, ar[2], ar[3]);
  gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1);
  const rm = R('sky-mask'); if (o.sky && tex['sky-mask'] && rm) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex['sky-mask']); gl.uniform4f(L.rm, rm[0], rm[1], rm[2], rm[3]); }
  gl.uniform1f(L.sky, o.sky ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[name]);
  gl.uniform1f(L.op, o.op ?? 1); gl.uniform1f(L.moon, o.moon || 0); const t = o.tint || [1, 1, 1]; gl.uniform3f(L.tint, t[0], t[1], t[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
// ---- v5 sky: every cloud moves. Six layers of Codex-drawn cel clouds (clouds5-atlas) drift left at their own
// speed, far bands over the hills slowest, the big high masses fastest, all behind the land (sky-mask5: hills, castle, roof, chimney)
// and IN FRONT of the moon: over the disc a cloud lets some moonlight through, and the edges that face the moon light up.
// Each layer is a ring laid out once from a seed (every drawing used once before any repeats, repeats mirrored), longer than the frame
// plus its widest cloud, so no cloud is ever on screen twice. LAB.sky replaces the spec.
const SKY5 = {
  // rim colour; rim strength on the side facing the moon (outside the disc) and on every edge over the disc (backlit); rim width (art px);
  // moon seen through a cloud; moonlit lift near the moon; darkening against the moon and its halo
  // (variant B "Halloween": dark against the moon with gold rims; the development hook keeps A and C)
  rim: [1, .86, .58], rimAmt: 1.3, rimIn: 1.15, rimW: 9, see: .2, lift: .25, dark: .4,
  layers: [   // far to near, denser toward the horizon like the painting: drawings, centre y range, scale range, vertical squash (+-15 % per cloud),
              // cover (cloud width / step), speed (art px/s), tint, opacity, seed
    { kinds: ['horizon'], y: [1085, 1150], sc: [.85, 1.05], sy: .8, cover: 1.4, v: 2, tint: [.9, .88, .96], op: .95, seed: 1 },
    { kinds: ['horizon'], y: [985, 1060], sc: [1.1, 1.3], sy: .95, cover: 1.1, v: 2.8, tint: [.94, .92, .98], op: .95, seed: 5 },
    { kinds: ['mid'], y: [860, 990], sc: [.5, .65], sy: .55, cover: 1.4, v: 3.6, tint: [.93, .92, .98], op: .95, seed: 4 },
    { kinds: ['mid'], y: [560, 880], sc: [.8, 1.05], sy: .65, cover: 1.2, v: 5.5, tint: [1, 1, 1], op: 1, seed: 2 },
    { kinds: ['streak'], y: [340, 560], sc: [.8, 1.1], sy: .8, cover: .35, v: 7, tint: [.95, .95, 1], op: .8, seed: 6 },   // v4's thin wisps, few: the band at the cat's head height
    { kinds: ['high'], y: [40, 300], sc: [.85, 1.1], sy: .9, cover: .9, v: 9, tint: [.85, .83, .94], op: 1, seed: 3 },
  ],
};
const FSC5 = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1;uniform vec4 rect,sa,rm,lit;uniform vec2 asz,mc;uniform float op,flip,dark,rin;uniform vec3 tint,rimc;
float A(vec2 q){if(q.x<sa.x||q.y<sa.y||q.x>sa.x+sa.z||q.y>sa.y+sa.w)return 0.;return texture2D(t0,q/asz).a;}   // alpha, 0 outside this cloud
void main(){
  vec2 f=(ap-rect.xy)/rect.zw;if(flip>.5)f.x=1.-f.x;
  vec2 q=sa.xy+f*sa.zw;vec4 c=texture2D(t0,q/asz);
  vec2 u=(ap-rm.xy)/rm.zw;float m=u.y>1.?0.:texture2D(t1,clamp(u,0.,1.)).r;
  if(c.a<.004||m<.004){gl_FragColor=vec4(0.);return;}
  c.rgb*=tint;
  vec2 d=ap-mc;float r=length(vec2(dot(d,vec2(.9664,-.2571))/556.,dot(d,vec2(.2571,.9664))/519.));   // 1 on the painted moon's edge
  float inside=1.-smoothstep(.95,1.01,r),near=exp(-max(r-1.,0.)*3.2),zone=1.-smoothstep(.85,1.45,r);   // zone: the disc and its halo, so a cloud darkens gradually, with no seam at the moon's edge
  vec2 k=lit.y*sa.zw/rect.zw,tm=-normalize(d+.001);if(flip>.5)tm.x=-tm.x;
  float edge=c.a-A(q+tm*k),body=A(q-tm*k*1.5);                                  // the side that faces the moon; body: is there cloud behind that edge
  if(inside>0.){vec2 j=k*.8;float a1=A(q+vec2(j.x,0.)),a2=A(q-vec2(j.x,0.)),a3=A(q+vec2(0.,j.y)),a4=A(q-vec2(0.,j.y));   // backlit: every edge, thinner
    edge=mix(edge,c.a-min(min(a1,a2),min(a3,a4)),inside);body=mix(body,clamp((a1+a2+a3+a4)*.5-.5,0.,1.),inside);}
  float rim=clamp(edge,0.,1.)*body*mix(lit.x*near,rin,inside),s=1.-lit.z*inside;   // no body (a fragment smaller than the rim): no rim, so no glowing specks
  vec3 col=(c.rgb+rimc*c.a*lit.w*.22*near*(1.-inside))*(1.-dark*zone);
  gl_FragColor=vec4(col*s+rimc*rim,c.a*s)*op*m;
}`;
const S5 = { spec: null, tex: null };
function sky5On() { return !!(M.clouds5 && tex['clouds5-atlas'] && tex['sky-mask5']); }
function sky5() {
  const spec = (LAB && LAB.sky) || SKY5, C = M.clouds5.clouds;
  if (S5.spec === spec && S5.tex === tex) return S5;
  if (S5.tex !== tex) S5.prog = link(VS, FSC5, ['m', 'rect', 'sa', 'asz', 't0', 't1', 'rm', 'lit', 'mc', 'op', 'flip', 'dark', 'rin', 'tint', 'rimc']);
  S5.spec = spec; S5.tex = tex;
  S5.layers = spec.layers.map(L => {
    const h = (j, k) => hash(L.seed * 37 + j, k);
    const pool = C.map((c, i) => i).filter(i => L.kinds.includes(C[i].kind)).sort((a, b) => h(1, a) - h(1, b));
    const items = []; let x = 0, maxW = 0;
    for (let k = 0; x < ART_W + maxW + 200 || k < pool.length; k++) {
      const i = pool[k % pool.length], a = C[i].atlas, sc = L.sc[0] + (L.sc[1] - L.sc[0]) * h(2, k), w = a[2] * sc, hh = a[3] * sc * L.sy * (.85 + .3 * h(7, k));
      items.push({ a, x, y: L.y[0] + (L.y[1] - L.y[0]) * h(3, k) - hh / 2, w, h: hh, flip: (Math.floor(k / pool.length) + (h(4, k) > .5)) % 2 });
      x += w / L.cover * (.75 + .5 * h(5, k)); maxW = Math.max(maxW, w);
    }
    return { ...L, items, len: x, ph: h(6, 0) * x };
  });
  return S5;
}
function drawSky5() {
  const S = sky5(), spec = S.spec, L5 = S.prog, as = M.clouds5.size, rm = R('sky-mask5'), ct = cloudClock();
  gl.useProgram(L5.prog); gl.uniformMatrix3fv(L5.m, false, view); gl.uniform1i(L5.t0, 0); gl.uniform1i(L5.t1, 1);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex['sky-mask5']); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex['clouds5-atlas']);
  gl.uniform4f(L5.rm, rm[0], rm[1], rm[2], rm[3]); gl.uniform2f(L5.asz, as[0], as[1]); gl.uniform2f(L5.mc, 2307, 568);
  gl.uniform4f(L5.lit, spec.rimAmt, spec.rimW, spec.see, spec.lift); gl.uniform3f(L5.rimc, spec.rim[0], spec.rim[1], spec.rim[2]); gl.uniform1f(L5.dark, spec.dark); gl.uniform1f(L5.rin, spec.rimIn);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  for (const L of S.layers) {
    const off = (ct * L.v + L.ph) % L.len;
    gl.uniform3f(L5.tint, L.tint[0], L.tint[1], L.tint[2]); gl.uniform1f(L5.op, L.op);
    for (const it of L.items) {
      const x = ((it.x - off) % L.len + L.len + it.w) % L.len - it.w;           // in [-w, len - w): enters on the right, leaves on the left
      if (x > ART_W || x + it.w < 0) continue;
      gl.uniform4f(L5.rect, x, it.y, it.w, it.h); gl.uniform4f(L5.sa, it.a[0], it.a[1], it.a[2], it.a[3]); gl.uniform1f(L5.flip, it.flip);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}
// ---- v5 sky, painted (round 3): the painting's own clouds move, and nothing crosses the moon (anything on the
// moon behind the cat looks bad, and so did clouds behind it). The cloud layer is split into its masses (the big upper-left mass, the
// mid-left band, six loose cloudlets) and the horizon bank; Codex only finished what the painter never had to (the masses past the frame
// edges, and a bank that ends below the moon instead of being cut by it). The masses ride a perspective conveyor toward the viewer: they
// come up small and faint from the horizon just left of the moon (the cloudlet right of the moon from behind the chimney), grow and sail
// away up-left, so their paths never touch the moon's disc; each has copies spread over its trip, so the sky keeps the painting's layout.
// The bank stays where it is painted (horizon clouds barely move in perspective, and a drifting bank showed its hill-shaped cut) and the
// masses rise from behind it.
// M.paint5 (or LAB.sky.paint): { vp, vpOf: {name: vp}, sMin, k (1/s), kmul, copies, bankV (art px/s), masses: {name: rect}, bank: {rect, period} }.
const FSP5 = `precision highp float;
varying vec2 ap;uniform sampler2D t0,t1,t2;uniform vec4 r0,rm,rd;uniform float sx,per,occ,op;
void main(){
  vec2 u=(ap-rm.xy)/rm.zw;float m=u.y>1.?0.:texture2D(t1,clamp(u,0.,1.)).r;
  vec2 q=vec2(per>0.?mod(ap.x+sx-r0.x,per):ap.x-r0.x,ap.y-r0.y)/r0.zw;
  if(m<.004||q.x<0.||q.y<0.||q.x>1.||q.y>1.){gl_FragColor=vec4(0.);return;}
  if(occ>0.){vec2 v=(ap-rd.xy)/rd.zw;if(v.x>=0.&&v.y>=0.&&v.x<=1.&&v.y<=1.)m*=1.-texture2D(t2,v).a;}   // behind the moon's disc
  gl_FragColor=texture2D(t0,q)*m*op;
}`;
const SP5 = { tex: null, spec: null };
function paint5() { const s = (LAB && LAB.sky && LAB.sky.paint) || M.paint5; return s && tex['sky-mask5'] ? s : null; }
function paintCycle(sp) {          // per mass: its vanishing point and the scale range of its trip (from sMin, or where it enters the frame, to where it leaves)
  if (SP5.spec === sp) return SP5.cyc;
  SP5.cyc = Object.entries(sp.masses).map(([name, r]) => {
    const [vx, vy] = (sp.vpOf && sp.vpOf[name]) || sp.vp, sMin = sp.sMin || .05;
    const out = s => { const x = vx + (r[0] - vx) * s, y = vy + (r[1] - vy) * s; return x > ART_W || y > 1260 || x + r[2] * s < 0 || y + r[3] * s < 0; };
    const edge = (lo, hi) => { for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (out(mid) === out(lo)) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    return { name, r, vx, vy, lo: Math.log(out(sMin) ? edge(sMin, 1) : sMin), hi: Math.log(edge(1, 50)) };
  });
  SP5.spec = sp; return SP5.cyc;
}
function drawPainted5(sp) {
  const mk = tex['sky-mask5'], rm = R('sky-mask5'), rd = R('moon-disc');
  if (SP5.tex !== tex) { SP5.tex = tex; SP5.prog = link(VS, FSP5, ['m', 'rect', 't0', 't1', 't2', 'r0', 'rm', 'rd', 'sx', 'per', 'occ', 'op']); }
  const L = SP5.prog, t = cloudClock();
  const quadAt = (name, rect, r0, sx, per, occ, op = 1) => {
    const tx = tex['paint5-' + name]; if (!tx) return;
    quadProg(L, rect); gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1); gl.uniform1i(L.t2, 2);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex['moon-disc'] || tx);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mk); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.uniform4f(L.r0, r0[0], r0[1], r0[2], r0[3]); gl.uniform4f(L.rm, rm[0], rm[1], rm[2], rm[3]);
    gl.uniform4f(L.rd, rd[0], rd[1], rd[2], rd[3]); gl.uniform1f(L.occ, occ && tex['moon-disc'] ? 1 : 0);
    gl.uniform1f(L.sx, sx); gl.uniform1f(L.per, per); gl.uniform1f(L.op, op);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  // a cloud deck in perspective: each mass has n copies spread evenly over its trip (in log scale), so at any moment one is near its
  // painted size and others are farther (smaller, toward the horizon); masses higher up (U) move a little faster
  const now = [];
  for (const c of paintCycle(sp)) {
    const n = (sp.copies && sp.copies[c.name[0]]) || 2, k = sp.k * ((sp.kmul && sp.kmul[c.name[0]]) || 1), span = c.hi - c.lo, r = c.r;
    for (let j = 0; j < n; j++) {
      const ls = c.lo + (((-c.lo + k * t + j * span / n) % span) + span) % span, s = Math.exp(ls);
      now.push({ name: c.name, s, rect: [c.vx + (r[0] - c.vx) * s, c.vy + (r[1] - c.vy) * s, r[2] * s, r[3] * s] });
    }
  }
  now.sort((p, q) => p.s - q.s);                                         // far (small) first
  const sMin = sp.sMin || .05;
  for (const n of now) quadAt(n.name, n.rect, n.rect, 0, 0, false, sm((n.s - sMin) / (2 * sMin)));   // far ones form out of the haze
  const b = sp.bank;                                                     // the bank last: the masses rise from behind it
  if (b.period) quadAt('bank', [0, b.rect[1], ART_W, b.rect[3]], b.rect, (t * sp.bankV) % b.period, b.period, true);
  else quadAt('bank', b.rect, b.rect, 0, 0, false);
}
// ---- v6 sky: the painting's own cloud masses, and new ones Codex painted in its style, move as whole pieces and none
// of them ever touches the moon (nothing behind or over the moon, no rim light, keep the painting's look; curved paths and moving
// left looked best). The pieces share one atlas (M.sky6: atlas rect, native rect, hull, evaporation depth). Three choreographies (kind):
//   deck   a cloud deck in perspective: pieces come up from behind the hills left of the moon (a few right of it), grow and sail away from
//          their vanishing point, flat and hazy near the horizon and big overhead; the far end of the deck is the horizon bank
//   sweep  big masses rise from behind the painted bank, and a wind that blows harder higher up bends their paths to the left
//   drift  t = 0 is the painting; every mass drifts left (higher ones faster) and in time evaporates from its torn edges while a new one
//          condenses in its part of the sky, so the sky renews itself in place
// Every piece is recoloured by height (the painting's clouds run from violet-blue high up to mauve-pink at the horizon), hazed toward the
// sky near the horizon and hidden behind the land, the roof and the chimney (sky-mask5). `wisps` adds a few thin streaks that do cross
// the moon (a little darker there and slightly see-through, no rim). M.sky6spec, or LAB.sky.v6 in the development hook, selects it.
const VS6 = `attribute vec2 p;uniform mat3 m,rot;uniform vec4 rect;varying vec2 lp,ap;
void main(){lp=rect.xy+p*rect.zw;ap=(rot*vec3(lp,1.)).xy;vec3 q=m*vec3(ap,1.);gl_Position=vec4(q.xy,0.,1.);}`;   // lp: the piece's own frame, ap: where it is (turned by rot)
const FSC6 = `precision highp float;
varying vec2 lp,ap;uniform sampler2D t0,t1,t2,t3;uniform vec4 rect,sa,rm,rs,pz;uniform vec2 asz;uniform float op,flip,haze,ero,rc,dk;
vec3 C(float y){float u=clamp(y/1150.,0.,1.);return vec3(31.+84.*pow(u,1.6),43.+25.*pow(u,1.3),102.-8.*u)/255.;}
void main(){
  vec2 f=(lp-rect.xy)/rect.zw;if(flip>.5)f.x=1.-f.x;
  vec2 uv=(sa.xy+f*sa.zw)/asz;vec4 c=texture2D(t0,uv);
  vec2 u=(ap-rm.xy)/rm.zw;float m=u.y>1.?0.:texture2D(t1,clamp(u,0.,1.)).r;
  if(ero>0.)c*=smoothstep(ero-1.5,ero+1.5,texture2D(t3,uv).r*255.);      // evaporating or condensing: only cloud deeper than ero px shows
  if(c.a<.004||m<.004){gl_FragColor=vec4(0.);return;}
  vec3 s=c.rgb/c.a+rc*(C(ap.y)-C(pz.x+(f.y-.5)*pz.y));                  // pz: the piece's painted centre y and height
  vec4 k=texture2D(t2,clamp((ap-rs.xy)/rs.zw,0.,1.));s=mix(s,k.rgb/max(k.a,.02),haze*step(.02,k.a));
  float a=c.a*op*m;
  if(dk>0.){vec2 d=ap-vec2(2307.,568.);float i=1.-smoothstep(.97,1.01,length(vec2(dot(d,vec2(.9664,-.2571))/556.,dot(d,vec2(.2571,.9664))/519.)));
    s*=1.-dk*i;a*=1.-.2*i;}
  gl_FragColor=vec4(clamp(s,0.,1.)*a,a);
}`;
const S6 = { tex: null, spec: null, cache: new Map() };
function sky6() { const s = (LAB && LAB.sky && LAB.sky.v6) || M.sky6spec; return s && M.sky6 && tex['sky6-atlas'] && tex['sky-mask5'] ? s : null; }
const moonR = (x, y) => { const dx = x - 2307, dy = y - 568; return Math.hypot((dx * .9664 - dy * .2571) / 556, (dx * .2571 + dy * .9664) / 519); };
function offMoon(p, r, flip, margin, rot = 0) {     // every hull point of piece p drawn at rect r, turned by rot about its centre (and two points
  const H = p.h, n = H.length, c = Math.cos(rot), sn = Math.sin(rot), cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;   // between each), stays off the moon
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) {
    const a = H[i], b = H[(i + 1) % n], u = a[0] + (b[0] - a[0]) * j / 3, v = a[1] + (b[1] - a[1]) * j / 3;
    const dx = r[0] + (flip ? 1 - u : u) * r[2] - cx, dy = r[1] + v * r[3] - cy;
    if (moonR(cx + c * dx - sn * dy, cy + sn * dx + c * dy) < 1 + margin) return false;
  }
  return true;
}
const pool6 = kinds => M.sky6.pieces.map((p, i) => i).filter(i => kinds.includes(M.sky6.pieces[i].k));
function pick6(pool, seed, i) {                     // the pool reshuffled every cycle: each piece is used once before any repeats
  const n = pool.length, cyc = Math.floor(i / n);
  return pool.slice().sort((a, b) => hash(seed * 31 + cyc, a) - hash(seed * 31 + cyc, b))[((i % n) + n) % n];
}
function memo6(key, f) { let v = S6.cache.get(key); if (!v) { if (S6.cache.size > 3000) S6.cache.clear(); v = f(); S6.cache.set(key, v); } return v; }
// deck: instance i of a fan is born every `every` s at scale sMin and grows as s = sMin e^(k age); its centre is vp + s (X, -Y) (a flat
// deck: equal height on screen means equal distance), its size the painted size x min(s g, mag) with g = 1 / its painted distance, and
// its height foreshortened while it is far. X is picked across the fan, then slid away from the moon until the whole trip stays clear.
// F.align (a cloud must lie long along the way it goes; mirrored pieces at other angles looked wrong): no mirroring against the
// painted slant, and each piece is turned so its long axis (p.ang) lies on its own path, the line through the vanishing point; 'path'
// also picks the path from the piece's own slant (so it barely turns), 'rotate' spreads the paths over F.phi.
function rect6(sp, F, p, g, X, s) {     // gam < 1: far pieces stay larger than a flat deck says (the painter's horizon clouds are drawn big)
  const sc = Math.min(Math.pow(s * g, sp.gam || 1), sp.mag), w = p.r[2] * sc, h = p.r[3] * sc * Math.pow(Math.min(1, sc), sp.fore - 1);
  return [F.vp[0] + s * X - w / 2, F.vp[1] - s * F.Y - h / 2, w, h];
}
function pose6(sp, F, q, s) {           // rect and turn (radians) of instance q at scale s
  const r = rect6(sp, F, q.p, q.g, q.X, s); if (!F.align) return { r, rot: 0 };
  const a = (q.flip ? -1 : 1) * q.p.ang * Math.PI / 180, al = Math.atan2(Math.sin(a) * r[3] / q.p.r[3], Math.cos(a) * r[2] / q.p.r[2]);   // its slant as drawn (foreshortened)
  let rot = Math.atan(-F.Y / q.X) - al; rot -= Math.PI * Math.round(rot / Math.PI);
  return { r, rot };
}
function deck6(sp, t, out) {
  const P = M.sky6.pieces, life = Math.log(sp.sMax / sp.sMin);
  sp.fans.forEach((F, fi) => {
    for (let i = Math.floor((t - life / F.k) / F.every) - 1; i <= Math.floor(t / F.every); i++) {
      const age = t - (i + .8 * hash(F.seed + 11, i)) * F.every; if (age < 0 || age * F.k > life) continue;
      const q = memo6(`d${fi}:${i}`, () => {
        const p = P[pick6(pool6(F.pool), F.seed, i)];
        const flip = F.align ? ((F.side < 0) === (p.ang < 0) ? 1 : 0) : hash(F.seed + 5, i) < .5 ? 1 : 0;   // aligned: the slant always falls toward the vanishing point
        const g = 1 / clamp((F.vp[1] - p.r[1] - p.r[3] / 2) / F.Y, .3, 1.2);
        const u = ((i * .618034 + .35 * hash(F.seed + 3, i)) % 1 + 1) % 1;
        const ph = F.align === 'path' ? F.side * (90 - Math.abs(p.ang) + F.jit * (2 * u - 1)) : F.phi[0] + (F.phi[1] - F.phi[0]) * u;    // degrees from straight up
        const q = { p, flip, g, X: F.Y * Math.tan(ph * Math.PI / 180) };
        for (let n = 0; n < 80; n++) {
          let ok = true;
          for (let j = 0; j <= 12 && ok; j++) { const o = pose6(sp, F, q, sp.sMin * Math.pow(sp.sMax / sp.sMin, j / 12)); ok = offMoon(p, o.r, flip, sp.margin, o.rot); }
          if (ok) break; q.X += F.side * 70;
        }
        return q;
      });
      const s = sp.sMin * Math.exp(F.k * age), { r, rot } = pose6(sp, F, q, s);
      if (r[0] > ART_W + r[2] || r[0] + 2 * r[2] < 0 || r[1] + 2 * r[3] < 0 || r[1] > 1260) continue;
      out.push({ p: q.p, rect: r, rot, flip: q.flip, z: s, op: sm((s - sp.sMin) / (1.5 * sp.sMin)), haze: sp.haze * (1 - sm((s - sp.sMin) / sp.hazeS)) });
    }
  });
}
// sweep: a mass every `every` s rises at `rise` art px/s from below the land line; the wind blows u0 + u1 h to the left at height h, so the
// path bends left (x = x0 - (u0 h + u1 h^2 / 2) / rise) and it grows from grow[0] to grow[1] as it climbs
function sweepAt(sp, q, hgt) {
  const sc = sp.grow[0] + (sp.grow[1] - sp.grow[0]) * clamp(hgt / 1200, 0, 1), w = q.p.r[2] * sc, h = q.p.r[3] * sc;
  return [q.x0 - (sp.u0 * hgt + sp.u1 * hgt * hgt / 2) / sp.rise - w / 2, sp.yLand + .05 * h - hgt, w, h];
}
function sweep6(sp, t, out) {
  const P = M.sky6.pieces, life = (sp.yLand + 1300) / sp.rise;
  for (let i = Math.floor((t - life) / sp.every) - 1; i <= Math.floor(t / sp.every); i++) {
    const age = t - (i + .6 * hash(sp.seed + 11, i)) * sp.every; if (age < 0 || age > life) continue;
    const q = memo6(`s${i}`, () => {
      const p = P[pick6(pool6(sp.pool), sp.seed, i)], u = ((i * .618034 + .35 * hash(sp.seed + 3, i)) % 1 + 1) % 1;
      const q = { p, flip: hash(sp.seed + 5, i) < .5 ? 1 : 0, x0: sp.x[0] + (sp.x[1] - sp.x[0]) * u };
      for (let n = 0; n < 80; n++) { let ok = true; for (let j = 0; j <= 16 && ok; j++) ok = offMoon(p, sweepAt(sp, q, j * 90), q.flip, sp.margin); if (ok) break; q.x0 -= 70; }
      return q;
    });
    const hgt = age * sp.rise, r = sweepAt(sp, q, hgt);
    if (r[0] + r[2] < 0 || r[1] + r[3] < 0) continue;
    out.push({ p: q.p, rect: r, flip: q.flip, z: hgt, op: sm(hgt / 160), haze: sp.haze * (1 - sm(hgt / sp.hazeH)) });
  }
}
// drift: slot j holds one mass at a time. Generation 0 is the painting's own piece (slots[j].p0) at its painted place at t = 0; each later
// generation is a new piece of the slot's pool that condenses somewhere in the slot's zone while the one before evaporates: it fades, and a
// shallow depth threshold on the piece's field (up to `ero` px) takes its small torn bits and thin edges first.
function drift6(sp, t, out) {
  const P = M.sky6.pieces;
  const vAt = y => sp.v[0] + (sp.v[1] - sp.v[0]) * (1 - clamp(y / 1150, 0, 1));
  sp.slots.forEach((S, j) => {
    const L = S.life, per = L - sp.cond, ph = -(sp.cond + 60 + (L - 2 * sp.cond - 120) * hash(sp.seed + 1, j));   // gen 0 is whole at t = 0 and has at least 60 s left
    const k1 = Math.floor((t - ph) / per);
    for (let k = Math.max(0, k1 - 1); k <= k1; k++) {
      const b = ph + k * per, age = t - b; if (age < 0 || age > L) continue;
      const q = memo6(`r${j}:${k}`, () => {
        if (k === 0) { const p = P[S.p0], v = vAt(p.r[1] + p.r[3] / 2); return { p, flip: 0, r: [p.r[0] - v * b, p.r[1], p.r[2], p.r[3]], v }; }
        const p = P[pick6(pool6(S.pool), sp.seed + 13 * j, k)], sc = S.sc[0] + (S.sc[1] - S.sc[0]) * hash(sp.seed + 7 + j, k);
        const w = p.r[2] * sc, h = p.r[3] * sc, flip = hash(sp.seed + 5 + j, k) < .5 ? 1 : 0, z = S.zone;
        const r = [z[0] + (z[2] - z[0]) * hash(sp.seed + 2 + j, k) - w / 2, z[1] + (z[3] - z[1]) * hash(sp.seed + 3 + j, k) - h / 2, w, h];
        for (let n = 0; n < 80 && !offMoon(p, r, flip, sp.margin); n++) r[0] -= 70;
        return { p, flip, r, v: vAt(r[1] + h / 2) };
      });
      const f = age < sp.cond ? 1 - sm(age / sp.cond) : sm((age - L + sp.cond) / sp.cond), r = [q.r[0] - q.v * age, q.r[1], q.r[2], q.r[3]];
      if (r[0] + r[2] < 0 || f >= 1) continue;
      out.push({ p: q.p, rect: r, flip: q.flip, z: r[1] + r[3], op: 1 - f, haze: 0, ero: sp.ero * f });   // fades, and its thinnest bits go first
    }
  });
}
function bind6(atlas, asz, rc, dk) {
  const L = S6.prog, rm = R('sky-mask5'), rs = R('sky5') || [0, 0, ART_W, 1260];
  gl.useProgram(L.prog); gl.uniformMatrix3fv(L.m, false, view);
  gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1); gl.uniform1i(L.t2, 2); gl.uniform1i(L.t3, 3);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex['sky6-field'] || tex[atlas]);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex.sky5 || tex[atlas]);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex['sky-mask5']);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[atlas]);
  gl.uniform4f(L.rm, rm[0], rm[1], rm[2], rm[3]); gl.uniform4f(L.rs, rs[0], rs[1], rs[2], rs[3]); gl.uniform2f(L.asz, asz[0], asz[1]);
  gl.uniform1f(L.rc, rc); gl.uniform1f(L.dk, dk);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
function quad6(o, a, pz) {
  const L = S6.prog, r = o.rect;
  gl.uniform4f(L.rect, r[0], r[1], r[2], r[3]); gl.uniform4f(L.sa, a[0], a[1], a[2], a[3]); gl.uniform4f(L.pz, pz[0], pz[1], 0, 0);
  gl.uniformMatrix3fv(L.rot, false, o.rot ? xform(r[0] + r[2] / 2, r[1] + r[3] / 2, o.rot) : [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  gl.uniform1f(L.op, o.op); gl.uniform1f(L.flip, o.flip); gl.uniform1f(L.haze, o.haze || 0); gl.uniform1f(L.ero, o.ero || 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
// wisps: v4's thin streaks (clouds5-atlas) that do cross the moon, slowly and right to left, one every `every` s
function wisps6(W, t) {
  const C = M.clouds5 && M.clouds5.clouds; if (!C || !tex['clouds5-atlas']) return;
  const pool = C.map((c, i) => i).filter(i => C[i].kind === 'streak'), travel = ART_W + 1600;
  bind6('clouds5-atlas', M.clouds5.size, 0, W.dark);
  for (let i = Math.floor((t - travel / W.v[0]) / W.every) - 1; i <= Math.floor(t / W.every); i++) {
    const age = t - (i + .7 * hash(W.seed + 1, i)) * W.every, v = W.v[0] + (W.v[1] - W.v[0]) * hash(W.seed + 2, i); if (age < 0 || age * v > travel) continue;
    const c = C[pick6(pool, W.seed, i)], sc = .8 + .4 * hash(W.seed + 3, i), w = c.atlas[2] * sc, h = c.atlas[3] * sc * .8;
    const y = W.y[0] + (W.y[1] - W.y[0]) * hash(W.seed + 4, i);
    quad6({ rect: [ART_W + 200 - v * age, y - h / 2, w, h], op: W.op, flip: hash(W.seed + 5, i) < .5 ? 1 : 0 }, c.atlas, [0, 0]);
  }
}
function drawSky6(sp) {
  if (S6.tex !== tex) { S6.tex = tex; S6.prog = link(VS6, FSC6, ['m', 'rot', 'rect', 'sa', 'asz', 't0', 't1', 't2', 't3', 'rm', 'rs', 'pz', 'op', 'flip', 'haze', 'ero', 'rc', 'dk']); }
  if (S6.spec !== sp) { S6.spec = sp; S6.cache.clear(); }
  const t = cloudClock(), out = [];
  if (sp.still && tex[sp.still]) layer(sp.still);                        // a still layer (the painting's own clouds, for comparison)
  if (sp.kind === 'deck') deck6(sp, t, out); else if (sp.kind === 'sweep') sweep6(sp, t, out); else if (sp.kind === 'drift') drift6(sp, t, out);
  if (out.length) {
    out.sort((a, b) => a.z - b.z);                                       // far first
    bind6('sky6-atlas', M.sky6.size, sp.recolour ?? 1, 0);
    for (const o of out) quad6(o, o.p.a, [o.p.r[1] + o.p.r[3] / 2, o.p.r[3]]);
  }
  if (sp.bank && tex[sp.bank]) layer(sp.bank);                           // the painted bank, still: the masses rise from behind it
  if (sp.wisps) wisps6(sp.wisps, t);
}

// ---- v6 sky X5 (the chosen variant): the package's sky. X2's own painted stratus only: its three ribbons and the 17
// pieces cut between their islands (skyx5-*.png, from codex/art/ribbon-*.png and x2p-*.png), in four lanes on one slope (.12), drifting up-left at
// 6 / 10 / 12 / 14 art px/s at Wind 50 (10x X2; Wind 0..100 = still..2x). Every passing cloud is a slot with its own piece (picked by painted length,
// never the same twice in a row in a lane), +-15 % length and an offset across its lane. Up high a cloud fades toward the night blue; near the moon it
// goes 35 % darker and over the disc lets 20 % of it through. Hidden behind the land, roof and chimney by sky-mask5. The same code as the development X5
// (sky-codex.js: draw, slots, L5, byRoleX2). With it, M.order has no patch-moonedge and moon-disc.png is v6's disc with a clean lower edge.
// settings.cloudAmount (labs only): 0 none, 1 X5 as picked; below 1 a share of the slots stays empty (the rest keep their places), above it the
// lanes pack closer (2: gaps / 1.6, about 1.6x the cloud). The Clouds slider (settings.clouds) sets their speed: 0 still, 50 X5's pace, 100 twice it.
const X5 = {
  shapes: [['ribbon-0', 1698, 313, 0], ['ribbon-1', 1680, 135, 1], ['ribbon-2', 1651, 77, 2],
    ['x2p-00', 1304, 312, 0], ['x2p-01', 411, 99, 0], ['x2p-02', 1423, 312, 0], ['x2p-10', 1043, 135, 1], ['x2p-11', 728, 94, 1], ['x2p-12', 1326, 135, 1],
    ['x2p-13', 364, 66, 1], ['x2p-20', 377, 66, 2], ['x2p-21', 1284, 76, 2], ['x2p-22', 603, 72, 2], ['x2p-23', 1082, 76, 2], ['x2p-24', 870, 76, 2],
    ['x2p-25', 837, 69, 2], ['x2p-26', 1408, 76, 2], ['x2p-27', 314, 46, 2], ['x2p-28', 1470, 76, 2], ['x2p-29', 195, 39, 2]]
    .map(([n, w, h, role]) => ({ name: 'skyx5-' + n, w, h, role, wt: w })),
  lanes: [   // far lanes first; role 0 shelf, 1 ribbon, 2 far wisps. b: the lane's height at x = 0, k: scale, gap: art px between slots, skip: share of empty slots
    { role: 2, b: 980, k: 1.15, gap: 1700, speed: 6, jit: .35, dy: 110, skip: .05, op: .86, phase: 620, seed: 11 },
    { role: 1, b: 490, k: 1.3, gap: 2000, speed: 10, jit: .35, dy: 160, skip: .05, op: .94, phase: 650, seed: 23 },
    { role: 2, b: 170, k: 1, gap: 2300, speed: 12, jit: .4, dy: 100, skip: .15, op: .8, phase: 1900, seed: 61 },   // thin far wisps through the upper-left
    { role: 0, b: -210, k: 1, gap: 2000, speed: 14, jit: .3, dy: 110, skip: .08, op: .95, phase: 470, seed: 37 }],
  prog: null, tex: null,
};
X5.byRole = [0, 1, 2].map(k => X5.shapes.filter(s => s.role === k));
for (const s of X5.shapes) { M.layers[s.name] = { file: s.name + '.png', rect: [0, 0, s.w, s.h] }; M.fx[s.name] = { kind: 'skip' }; }
M.order = M.order.filter(n => n !== 'patch-moonedge');                  // it holds the old bank's pixels; moon-disc.png has its own clean edge now
const VSX5 = `attribute vec2 p;uniform mat3 m;uniform vec4 rect;uniform vec2 turn;varying vec2 uv;varying vec2 ap;
void main(){uv=p;vec2 q=(p-.5)*rect.zw;ap=rect.xy+vec2(q.x*turn.x-q.y*turn.y,q.x*turn.y+q.y*turn.x);gl_Position=vec4((m*vec3(ap,1.)).xy,0.,1.);}`;
const FSX5 = `precision highp float;varying vec2 uv;varying vec2 ap;uniform sampler2D cloud,mask;uniform vec4 mr;uniform float opacity;
void main(){vec4 c=texture2D(cloud,uv);vec2 mu=(ap-mr.xy)/mr.zw;float a=mu.y<0.||mu.y>1.||mu.x<0.||mu.x>1.?0.:texture2D(mask,mu).r;
vec2 d=ap-vec2(2307.,568.);float r=length(vec2(dot(d,vec2(.9664,-.2571))/556.,dot(d,vec2(.2571,.9664))/519.));
float inside=1.-smoothstep(.99,1.01,r),zone=1.-smoothstep(.85,1.3,r);
float high=1.-smoothstep(150.,650.,ap.y);c.rgb=mix(c.rgb,vec3(.135,.17,.31)*c.a,high*.8);c.rgb*=1.-.35*zone;c*=1.-.2*inside;gl_FragColor=c*a*opacity;}`;
const x5h = (n, s) => { const x = Math.sin(n * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
function x5pick(n, l, list) {          // a piece for slot n, weighted by painted length, never the same as the slot before
  const tot = list.reduce((a, s) => a + s.wt, 0), raw = k => { let u = x5h(k, l.seed + 3) * tot, i = 0; while (i < list.length - 1 && (u -= list[i].wt) > 0) i++; return i; };
  let i = raw(n); if (list.length > 1 && i === raw(n - 1)) i = (i + 1) % list.length; return list[i];
}
function x5slots(t) {
  const out = [], amt = settings.cloudAmount, keep = Math.min(1, amt), pack = 1 + .6 * Math.max(0, amt - 1);
  for (const l of X5.lanes) {
    const list = X5.byRole[l.role], s = l.phase - t * l.speed, reach = 2000 * l.k, gap = l.gap / pack;
    for (let n = Math.floor((-reach - s) / gap) - 1, n1 = Math.ceil((ART_W + reach - s) / gap) + 1; n <= n1; n++) {
      if (x5h(n, l.seed + 1) < l.skip || x5h(n, l.seed + 6) >= keep) continue;
      const sh = x5pick(n, l, list), w = sh.w * l.k * (.85 + .3 * x5h(n, l.seed + 4)), cx = s + (n + (x5h(n, l.seed + 2) - .5) * l.jit) * gap;
      if (cx + w * .6 < 0 || cx - w * .6 > ART_W) continue;
      const b = l.b + (x5h(n, l.seed + 5) - .5) * l.dy;
      out.push({ tex: sh.name, cx, cy: b + .12 * cx, angle: Math.atan(.12), w, h: w * sh.h / sh.w, op: l.op });
    }
  }
  return out;
}
const skyX5On = () => !(LAB && LAB.sky) && tex['skyx5-ribbon-0'] && tex['sky-mask5'];   // a development page with its own sky (LAB.sky) keeps it
function drawSkyX5() {
  if (!settings.cloudAmount) return;
  if (X5.tex !== tex) { X5.tex = tex; X5.prog = link(VSX5, FSX5, ['m', 'rect', 'turn', 'cloud', 'mask', 'mr', 'opacity']); }
  const p = X5.prog, t = cloudClock();
  gl.useProgram(p.prog); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix3fv(p.m, false, view); gl.uniform1i(p.cloud, 0); gl.uniform1i(p.mask, 1); gl.uniform4fv(p.mr, R('sky-mask5'));
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex['sky-mask5']);
  for (const q of x5slots(t)) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[q.tex]);
    gl.uniform4f(p.rect, q.cx, q.cy, q.w, q.h); gl.uniform2f(p.turn, Math.cos(q.angle), Math.sin(q.angle)); gl.uniform1f(p.opacity, q.op);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.activeTexture(gl.TEXTURE0);
}

// ===== creatures (ghost, moon event): owned by the creatures agent =====
// Rare events, every one a deterministic function of scene time (wallpaperTest.seek(t) shows the same frame).
// Creatures slider: 0 = none, 50 = one event (ghost, witch or veil, never two together) about every 2 min, 100 = twice as often.
//  ghost  a small cel-anime ghost drawn by Codex (ghost-atlas.png: an 8-cel float cycle with the tail wisp undulating, plus wave / glance / giggle / shy
//         drawings, head on the same spot in every cell), played along a slow hand-made path with easing, a little bob and lean. It lights the roofs and
//         walls around it (an additive relight that reads the painting itself). A: it seeps out of the big chimney beside the near roof, floats left
//         over the town, notices you, waves, giggles and fades. B: it peeks out from behind the near roof's edge (ghost-occ.png hides it there), twice.
//  moon   a witch with her cat crossing the moon (witch-moving.png: the one drawing with her head, hat, hair, skirt, the cat's tail and the straw moving,
//         baked frames) or a veil of cel clouds sliding across it (veil-clouds.png)
//         that dims the moon, its glow and the sky a little while it passes. Drawn just in front of the moon disc, so the drifting wisps pass over them.
// v5 ghost visits (v5), on the same sequencer, taking turns. These three were chosen; A and B (the v4 drawn ghost) are out of
// the rotation and their atlases are no longer in package/ (the v4 creatures development page hands them in as LAB.cr.files).
//  H      a 3D sheet ghost plays hide and seek with the big chimney: it slides out from behind its left edge, looks at the cat and at you, zips back, climbs up
//         behind it, pops up over the cap, waves its sleeve, giggles and drops back down. A Blender cloth simulation of the whole act rendered toon-flat
//         (sheetghost.py, not in this repo), 145 frames at 12 fps in ghost5-sheetH-heavy.png; ghost5-chimneyocc.png hides it behind the chimney.
//         Its light is drawn at '@ghost', the sheet itself after '@smoke' (drawGhostOver), in front of the chimney smoke (the chosen variant).
//  L      a lantern train: nine little ghosts with cold lanterns rise out of the moon path at the island's tip, walk along the shore and up into the castle,
//         whose windows turn ghost blue from the gate outward and back.
//  W      small lights on the lake: four will-o'-wisps rise from the water beside the moon path, circle each other and go out one by one.
//         L and W are drawn at '@ghostlake' (just before '@mist'); ghost5-lakeocc.png (R = water, G = what stands in front of it) keeps their light on the
//         water and hides them behind the town.
const CRL = () => (LAB && LAB.cr) || null;
const CRFILES = { witch: 'witch-moving.png', sheetH: 'ghost5-sheetH-heavy.png', chim5: 'ghost5-chimneyocc.png', lake5: 'ghost5-lakeocc.png' };
if (CRL() && CRL().ghost3d) CRFILES.ghost3d = CRL().ghost3d;      // development hook only: the v4 Blender ghost (variant C)
if (CRL() && CRL().files) Object.assign(CRFILES, CRL().files);
// the cloud veil (veil-clouds.png) is out of the package since 1.0 (no clouds shadowing the moon); a development page that wants it passes LAB.cr.files.veil   // development hook only: the v4 drawn ghost's atlases (ghost, occ) for A and B
const CRI = {};
for (const k in CRFILES) { const im = new Image(); im.onload = () => { CRI[k] = im; if (ready) draw(); }; im.src = url(CRFILES[k]); }
const CR_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const CR_VS = `attribute vec2 p;uniform mat3 view,mw;uniform vec4 rect;varying vec2 uv,wp;
void main(){uv=p;vec3 w=mw*vec3(rect.xy+p*rect.zw,1.);wp=w.xy;vec3 q=view*w;gl_Position=vec4(q.xy,0.,1.);}`;
// sprite from an atlas (two cells mixed by mixb), reveal line, floor line, roof occluder; pass 1 = soft halo of the silhouette (additive)
const CR_FSG = `precision highp float;
varying vec2 uv,wp;uniform sampler2D t0,t1;uniform vec4 ca,cb,occ,rv,hl;uniform vec3 tint;uniform vec2 flx;uniform float mixb,op,pass,emit,occOn,fl;
vec4 cell(vec4 c,vec2 q){return texture2D(t0,c.xy+clamp(q,0.,1.)*c.zw);}
vec4 frm(vec2 q){vec4 a=cell(ca,q);return mixb>0.?mix(a,cell(cb,q),mixb):a;}
void main(){
  float v=op;
  if(rv.w>0.)v*=smoothstep(0.,rv.w,dot(rv.xy,wp)-rv.z);
  v*=1.-step(flx.x,wp.x)*step(wp.x,flx.y)*smoothstep(0.,2.,wp.y-fl);   // hidden below fl inside x range flx (the chimney mouth)
  vec2 o=(wp-occ.xy)/occ.zw;float ins=step(0.,o.x)*step(0.,o.y)*step(o.x,1.)*step(o.y,1.);
  v*=1.-occOn*ins*texture2D(t1,clamp(o,0.,1.)).a;
  if(pass<.5){vec4 a=frm(uv);gl_FragColor=vec4(a.rgb+tint*a.a*emit,a.a)*v;}
  else{
    float h=0.;
    for(int i=0;i<8;i++){float an=.785398*float(i);vec2 d=vec2(cos(an),sin(an))*hl.xy;
      h+=frm(uv+d*.3).a*.45+frm(uv+d*.65).a*.3+frm(uv+d).a*.25;}
    h/=8.;
    gl_FragColor=vec4(tint*h*(1.-frm(uv).a)*hl.z*v,0.);
  }
}`;
// relight: the painting's own colours, tinted and added around the ghost (walls, roofs, chimneys pick up its light); the near roof gets only a little
const CR_FSR = `precision highp float;
varying vec2 uv,wp;uniform sampler2D t0,t1;uniform vec4 rb,occ;uniform vec3 pos,tint;uniform float amt,occOn;
void main(){
  float d=length(wp-pos.xy)/pos.z;float f=exp(-3.2*d*d)*(1.-smoothstep(.8,1.,d));
  vec3 b=texture2D(t0,(wp-rb.xy)/rb.zw).rgb;
  vec2 o=(wp-occ.xy)/occ.zw;float ins=step(0.,o.x)*step(0.,o.y)*step(o.x,1.)*step(o.y,1.);
  float roof=1.-occOn*ins*.75*texture2D(t1,clamp(o,0.,1.)).a;
  float lum=dot(b,vec3(.3,.5,.2)), warm=clamp((b.r-b.b)*2.2,0.,1.);   // already bright or warm things (the moon's glints, lit windows) are not lit again
  gl_FragColor=vec4(tint*(pow(b,vec3(.75))*1.15+.015)*(1.-.9*smoothstep(.3,.7,lum))*(1.-.75*warm)*f*amt*roof,0.);
}`;
// dim: a multiply over everything drawn so far (base, moon glow, moon), strongest on the moon itself
const CR_FSD = `precision highp float;
varying vec2 uv,wp;uniform sampler2D t0;uniform vec4 rm;uniform vec3 mc;uniform float amt;
void main(){
  vec2 q=(wp-rm.xy)/rm.zw;float ins=step(0.,q.x)*step(0.,q.y)*step(q.x,1.)*step(q.y,1.);
  float moon=texture2D(t0,clamp(q,0.,1.)).a*ins;                // the painted disc's own alpha: no mask edge ring
  float d=length((wp-mc.xy)/vec2(700.,700.));
  float k=amt*(.09+.23*moon+.08*exp(-d*d*1.3));
  gl_FragColor=vec4(1.-k*.7,1.-k*.9,1.-k*.95,1.);                  // warmer than the sky: the moon goes amber behind the veil, not green
}`;
// v5 sprite (the 3D sheet ghost): two atlas cells mixed; mode 1 hides it where G of an occluder texture (art rect lk) is set; pass 1 = soft halo
const CR_FS5 = `precision highp float;
varying vec2 uv,wp;uniform sampler2D t0,t1;uniform vec4 ca,cb,lk;uniform vec3 tint,hl;uniform float mixb,op,emit,pass,mode;
vec4 cell(vec4 c,vec2 q){return texture2D(t0,c.xy+clamp(q,0.,1.)*c.zw);}
vec4 frm(vec2 q){vec4 a=cell(ca,q);return mixb>0.?mix(a,cell(cb,q),mixb):a;}
void main(){
  float v=op;
  if(mode>.5){vec2 o=(wp-lk.xy)/lk.zw;v*=1.-texture2D(t1,clamp(o,0.,1.)).g*step(0.,o.y);}
  vec4 a=frm(uv);
  if(pass<.5)gl_FragColor=vec4(a.rgb+tint*a.a*emit,a.a)*v;
  else{float hh=0.;
    for(int i=0;i<8;i++){float an=.785398*float(i);vec2 d=vec2(cos(an),sin(an))*hl.xy;hh+=frm(uv+d*.35).a*.45+frm(uv+d*.7).a*.3+frm(uv+d).a*.25;}
    hh/=8.;gl_FragColor=vec4(tint*hh*(1.-a.a)*hl.z*v,0.);}
}`;
// the lantern train's arrival: the castle's window light (lights-pos) taken away (pass 0, reverse-subtract) and added back ghost blue (pass 1),
// spreading out from the gate (radius spread art px), strength amt
const CR_FSB = `precision highp float;
varying vec2 uv,wp;uniform sampler2D t0;uniform vec4 lr;uniform vec2 gate;uniform float amt,spread,pass;
void main(){
  vec3 c=texture2D(t0,clamp((wp-lr.xy)/lr.zw,0.,1.)).rgb;
  float a=amt*(1.-smoothstep(spread-40.,spread,length(wp-gate)));
  if(pass<.5)gl_FragColor=vec4(c*a,0.);
  else gl_FragColor=vec4(vec3(.52,.84,1.)*dot(c,vec3(.5,.45,.05))*1.6*a,0.);
}`;
let crP = null, crOwner = null;
function crProgs() {
  if (crOwner !== tex) {
    crOwner = tex;
    crP = { g: link(CR_VS, CR_FSG, ['view', 'mw', 'rect', 't0', 't1', 'ca', 'cb', 'occ', 'rv', 'hl', 'tint', 'flx', 'mixb', 'op', 'pass', 'emit', 'occOn', 'fl']),
            r: link(CR_VS, CR_FSR, ['view', 'mw', 'rect', 't0', 't1', 'rb', 'occ', 'pos', 'tint', 'amt', 'occOn']),
            d: link(CR_VS, CR_FSD, ['view', 'mw', 'rect', 't0', 'rm', 'mc', 'amt']),
            c5: link(CR_VS, CR_FS5, ['view', 'mw', 'rect', 't0', 't1', 'ca', 'cb', 'lk', 'tint', 'hl', 'mixb', 'op', 'emit', 'pass', 'mode']),
            b5: link(CR_VS, CR_FSB, ['view', 'mw', 'rect', 't0', 'lr', 'gate', 'amt', 'spread', 'pass']),
            w6: link(CR_VS, CR_FSW, ['view', 'mw', 'rect', 't0', 'ca', 'cb', 'col', 'mixb', 'op']) };
  }
  return crP;
}
function crTex(k) {
  const n = 'cr-' + k; if (tex[n] || !CRI[k]) return tex[n] || null;
  if (k === 'ghost' || k === 'witch' || k === 'sheetH') {   // power-of-two atlases, mip-mapped: the sprites are drawn at a third to a half of their size
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, CRI[k]); gl.generateMipmap(gl.TEXTURE_2D);
    for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
    tex[n] = t;
  } else tex[n] = upload(CRI[k]);
  return tex[n];
}
function crQuad(L, rect, mw) {
  gl.useProgram(L.prog); gl.uniformMatrix3fv(L.view, false, view); gl.uniformMatrix3fv(L.mw, false, mw || CR_ID);
  gl.uniform4f(L.rect, rect[0], rect[1], rect[2], rect[3]);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
// smooth path through [t, x, y] points (cubic Hermite, finite-difference tangents: equal neighbours = a gentle stop)
function crPath(pts, t) {
  const n = pts.length; if (t <= pts[0][0]) return [pts[0][1], pts[0][2]]; if (t >= pts[n - 1][0]) return [pts[n - 1][1], pts[n - 1][2]];
  let i = 0; while (t > pts[i + 1][0]) i++;
  const p0 = pts[i], p1 = pts[i + 1], dt = p1[0] - p0[0], u = (t - p0[0]) / dt;
  const tan = (j, c) => { const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)]; return (b[c] - a[c]) / Math.max(1e-6, b[0] - a[0]); };
  const h = u * u, h3 = h * u, a = 2 * h3 - 3 * h + 1, b = h3 - 2 * h + u, c = -2 * h3 + 3 * h, d = h3 - h;
  return [1, 2].map(k => a * p0[k] + b * dt * tan(i, k) + c * p1[k] + d * dt * tan(i + 1, k));
}
const crSm = (a, b, x) => sm((x - a) / (b - a));

// ---- the ghost
const CR_GH = 150, CR_CELL = 256 * CR_GH / 188;                    // body height and cell size (art px)
// atlas cells: 0-7 float cycle, 8 arm half up, 9 arm up, 10 wave out, 11 wave in, 12 glance left, 13 glance to you, 14 giggle, 15 shy
const CR_POSE = {
  wave: [[8, .28], [9, .3], [10, .36], [11, .36], [10, .36], [11, .36], [10, .36], [11, .36], [9, .3], [8, .28]],
  glance: [[12, 1.3], [13, 1.6]], giggle: [[14, 1.5]], shy: [[15, 1.7]],
  left: [[12, 1]], you: [[13, 1.6]],                                 // one glance, held as long as the act lasts
};
const CR_MOUTH = [1848, 1507, 52];                                   // the big chimney beside the near roof: centre x, mouth y, half width
const CR_GHOSTS = {
  A: {   // seeps out of the big chimney, floats left over the town, notices you, waves, giggles, floats on and fades
    acts: [['float', 9.5], ['glance'], ['wave'], ['giggle'], ['float', 20]],
    pts: [[0, 1832, 1448], [4.8, 1836, 1408], [7.5, 1822, 1378], [9.5, 1770, 1400], [17.2, 1640, 1450], [21.5, 1500, 1486], [25.5, 1350, 1500], [29.5, 1200, 1470], [34.5, 1050, 1400]],
    appear: [0, 4.8], fade: [28, 33.5], occ: 0, len: 35,
  },
  B: {   // peeks out from behind the near roof (looks round, hides, peeks again shy), comes out, waves, giggles, then goes home down the chimney
    acts: [['float', 1.2], ['glance'], ['float', 4.5], ['shy'], ['float', 2], ['wave'], ['giggle'], ['float', 10.9]],
    pts: [[0, 2210, 1500], [1.6, 2108, 1496], [3.9, 2100, 1492], [5.4, 2215, 1500], [7, 2215, 1500], [8.6, 2062, 1482], [10.4, 2044, 1478], [12.3, 1975, 1452], [15.6, 1925, 1440], [17.1, 1900, 1436], [18.6, 1850, 1422], [21, 1790, 1430], [23, 1836, 1432], [24.5, 1836, 1445], [27.5, 1836, 1583]],
    sink: [24.5, 27.5], occ: 1, len: 28,
  },
};
// variant C (development hook only): the same ghost as a small Blender toon model rendered flat: 7 clips of 16 frames (a loop of 1.33 s at 12 fps, the tail's curvature carries a
// travelling wave) in a 11 x 11 atlas of 192 px cells; every clip has the same tail phase, so clips cross-fade with the tails in step.
const CR_3D = { cell: 192, cols: 11, n: 16, fps: 12, frac: .76, base: { float: 0, wave: 16, giggle: 32, shy: 48, glanceL: 64, glanceV: 80, armmid: 96 } };
const crSkin = () => (CRL() && CRL().skin === '3d' && CRI.ghost3d) ? '3d' : 'codex';
function crClipCell(name, tau, blend) {
  const f = tau * CR_3D.fps, i = Math.floor(f) % CR_3D.n, u = f - Math.floor(f), b = CR_3D.base[name];
  return { a: b + i, b: b + (i + 1) % CR_3D.n, mix: blend ? sm(u) : 0 };
}
function crActCell3d(a, local, tau, blend) {
  if (a.k === 'float') return crClipCell('float', tau, blend);
  if (a.k === 'glance') return crClipCell(local < 1.3 ? 'glanceL' : 'glanceV', tau, blend);
  if (a.k === 'giggle' || a.k === 'shy') return crClipCell(a.k, tau, blend);
  // wave: the arm comes up through a half-raised drawing, waves, and goes down the same way
  const e = .14, u = sm(Math.min(1, Math.max(0, (local - e + .05) / .1))) * (1 - sm(Math.min(1, Math.max(0, (local - (a.dur - e) + .05) / .1))));
  const w = crClipCell('wave', tau, false), m = crClipCell('armmid', tau, false), h = crClipCell('float', tau, false);
  if (local < e - .05) return { a: h.a, b: m.a, mix: sm(local / (e - .05)) };
  if (local < e + .05) return { a: m.a, b: w.a, mix: sm((local - e + .05) / .1) };
  if (local < a.dur - e - .05) return crClipCell('wave', tau, blend);
  if (local < a.dur - e + .05) return { a: w.a, b: m.a, mix: sm((local - a.dur + e + .05) / .1) };
  return { a: m.a, b: h.a, mix: sm((local - a.dur + e + .05) / (e - .05)) };
}
function crActs(def) {
  if (def.t) return def.t;
  let t0 = 0; def.t = def.acts.map(([k, d]) => { const dur = d || CR_POSE[k].reduce((s, x) => s + x[1], 0), a = { k, t0, dur }; t0 += dur; return a; });
  return def.t;
}
function crActCell(a, local, tau, blend) {
  if (crSkin() === '3d') return crActCell3d(a, local, tau, blend);
  if (a.k === 'float') { const f = tau * 5.5, i = Math.floor(f), u = f - i; return { a: i % 8, b: (i + 1) % 8, mix: blend ? sm(u) : 0 }; }
  const L = CR_POSE[a.k]; let s = 0;
  for (const [c, d] of L) { s += d; if (local < s) return { a: c, b: c, mix: 0 }; }
  return { a: L[L.length - 1][0], b: L[L.length - 1][0], mix: 0 };
}
function crCells(def, tau, blend) {
  const acts = crActs(def); let i = 0; while (i < acts.length - 1 && tau >= acts[i + 1].t0) i++;
  const cur = crActCell(acts[i], tau - acts[i].t0, tau, blend), into = tau - acts[i].t0;
  if (i > 0 && into < .16) {                                   // short cross-fade from the last drawing of the act before
    const prev = crActCell(acts[i - 1], acts[i - 1].dur, tau, blend), pc = prev.mix > .5 ? prev.b : prev.a;
    return { a: pc, b: cur.a, mix: sm(into / .16) };
  }
  return cur;
}
function crGhostState(def, tau) {
  const blend = !CRL() || CRL().blend !== false;
  const p = crPath(def.pts, tau), pa = crPath(def.pts, tau - .3), pb = crPath(def.pts, tau + .3), vx = (pb[0] - pa[0]) / .6;
  const bob = 5 * Math.sin(tau * 2 * Math.PI / 3.4) + 2 * Math.sin(tau * 2 * Math.PI / 5.7 + 1), swx = 3 * Math.sin(tau * 2 * Math.PI / 4.9 + .5);
  const ang = clamp(vx * .0012, -.06, .06) + .03 * Math.sin(tau * 2 * Math.PI / 4.1 + 1.2);
  const s = { x: p[0] + swx, y: p[1] + bob, ang, flip: 1, ...crCells(def, tau, blend), op: 1, rv: [0, 0, 0, 0], fl: 1e5, flx: [0, 0], light: 1 };
  const kk = CR_GH / 128;
  s.flx = [CR_MOUTH[0] - CR_MOUTH[2], CR_MOUTH[0] + CR_MOUTH[2]];
  if (def.appear && tau < def.appear[1] + .5) {              // seeps out of the chimney: the lower part first, hidden below the mouth
    const u = crSm(0, def.appear[1], tau);
    s.rv = [0, 1, s.y + (72 - 183 * u) * kk, 46 * kk]; s.fl = CR_MOUTH[1]; s.light = sm(tau / (def.appear[1] + .5));
  }
  if (def.fade) { const u = crSm(def.fade[0], def.fade[1], tau); s.op = 1 - u; s.light = 1 - u; }   // drifts off and fades
  if (def.sink) {                                              // goes home: sinks into the chimney, cut off at its mouth
    s.fl = CR_MOUTH[1]; s.light = 1 - crSm(def.sink[0], def.sink[1], tau);
    if (tau > def.sink[1]) s.op = 0;
  }
  return s;
}
function crGhostDraw(s) {
  const skin = crSkin(), gt = crTex(skin === '3d' ? 'ghost3d' : 'ghost'), bt = tex.base; if (!gt || !bt || s.op <= 0) return;
  const cellArt = skin === '3d' ? CR_GH / CR_3D.frac : CR_CELL;
  const P2 = crProgs(), ot = crTex('occ'), half = cellArt / 2, br = R('base'), oc = [1600, 1150, 800, 700];
  const lit = s.light * 1.12, TINT = s.tint || [.55, .78, 1];
  if (lit > .01) {                                             // relight (additive)
    const L = P2.r, Rr = 250; crQuad(L, [s.x - Rr, s.y - Rr, 2 * Rr, 2 * Rr]);
    gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bt); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ot || bt); gl.activeTexture(gl.TEXTURE0);
    gl.uniform4f(L.rb, br[0], br[1], br[2], br[3]); gl.uniform4f(L.occ, oc[0], oc[1], oc[2], oc[3]);
    gl.uniform3f(L.pos, s.x, s.y + 6, Rr); gl.uniform3f(L.tint, TINT[0], TINT[1], TINT[2]); gl.uniform1f(L.amt, lit); gl.uniform1f(L.occOn, s.occ && ot ? 1 : 0);
    gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const L = P2.g, mw = xform(s.x, s.y, s.ang, s.flip, 1), q3 = CR_3D.cell / (CR_3D.cols * CR_3D.cell), cu = skin === '3d' ? (c => [(c % CR_3D.cols) * q3, Math.floor(c / CR_3D.cols) * q3, q3, q3]) : (c => [(c % 4) * .25, Math.floor(c / 4) * .25, .25, .25]);
  crQuad(L, [s.x - half, s.y - half, cellArt, cellArt], mw);
  gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, gt); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ot || gt); gl.activeTexture(gl.TEXTURE0);
  const a = cu(s.a), b = cu(s.b);
  gl.uniform4f(L.ca, a[0], a[1], a[2], a[3]); gl.uniform4f(L.cb, b[0], b[1], b[2], b[3]); gl.uniform1f(L.mixb, s.b === s.a ? 0 : s.mix);
  gl.uniform4f(L.occ, oc[0], oc[1], oc[2], oc[3]); gl.uniform1f(L.occOn, s.occ && ot ? 1 : 0);
  gl.uniform4f(L.rv, s.rv[0], s.rv[1], s.rv[2], s.rv[3]); gl.uniform1f(L.fl, s.fl); gl.uniform2f(L.flx, s.flx[0], s.flx[1]); gl.uniform1f(L.op, s.op);
  gl.uniform3f(L.tint, TINT[0], TINT[1], TINT[2]); gl.uniform1f(L.emit, .16);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(L.pass, 0); gl.uniform4f(L.hl, 0, 0, 0, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1f(L.pass, 1); gl.uniform4f(L.hl, 15 / cellArt, 15 / cellArt, .7 * s.light, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

// ---- schedule: {t0, len, k, type} of the event running at time t, or null
// One chain of creature visits, so two never overlap (so the ghosts and the witch are easy to see). The visits come in
// rounds: each round plays every visit once (the ghost visits of CR_PICK and the witch) in a shuffled order, never the same one twice in a row. The
// first round starts 15 s after the wallpaper does, chimney ghost, witch, lantern train, lake lights, so a new viewer meets all of them in about
// two minutes. The Ghosts & witch slider (settings.creatures) sets the pace:
// back to back at 50 (a visit starts about every 30 s), about every 60 s at 25, on top of each other at 100 (no downtime: one starts every
// ~4 s whenever a visit is free, so each comes back about 2 s after it ends, never the same visit twice at once); 0 = none. The start-to-start time varies by +-30 %; up to 50 a visit also waits until 3 s after
// the one before has ended, above 50 that wait shrinks to nothing. A visit that would come within 4 s of the cat's look-up (its bat) waits until it
// is clear. The chain is worked out from t = 0 once per pace and screen shape (CR_CHAIN), so any scene time shows the same frame; when the slider
// moves, the visits that have begun stay and only the rest is dealt again (crChain).
const CR_PICK = { ghosts: ['H', 'L', 'W'] };                         // the ghost visits taking turns (a development page can set them with creaturesTest.rotation or force one with LAB.cr.ghost)
// does a visit show on this screen? H needs the sky above the chimney (32:9 cuts it off), A and B the town, L and W the lake and the castle (32:9 shows
// neither). A visit that does not fit is left out of the rounds (at 32:9 only the witch comes).
function crFits(type) {
  if (!view) return true;
  const top = (1 - view[7]) / view[4], bottom = (-1 - view[7]) / view[4];
  return type === 'H' ? top < 300 : type === 'A' || type === 'B' ? bottom > 1530 : type === 'L' || type === 'W' ? bottom > 1480 : true;
}
const CR_LEN = { A: 35, B: 28, H: 13.5, L: 40, W: 24, witch: 27, veil: 40 };
const CR_GHOSTSET = new Set(['A', 'B', 'H', 'L', 'W']), crIsGhost = t => CR_GHOSTSET.has(t);
const CR_NAMES = { ghostA: 'A', ghostB: 'B', chimney: 'H', train: 'L', wisps: 'W' };
const CR_FIRST = 15, CR_MAXLEN = 40, CR_CHAIN = { key: '', rest: '', ev: [], next: 0, round: 0, queue: [], end: {} };
const crPeriod = f => f <= 1 ? 30 / f : 30 - 26 * Math.min(1, f - 1);   // seconds from one visit's start to the next, on average: 60 at 25, 30 at 50, 4 at 100
function crHitsLookUp(t0, len) {
  for (let u = t0 - 4; u <= t0 + len + 4; u += 1) { const e = bigEvent(u); if (e && e.type === 'up') return true; }
  return false;
}
function crRound(r, prev) {           // the visits of round r in their order; the veil is out (no clouds shadowing the moon), a development page can still ask for it with LAB.cr.moon
  const L = CRL(), G = (L && L.ghost) ? [L.ghost] : CR_PICK.ghosts, all = [...G, (L && L.moon) || 'witch'], fit = all.filter(crFits), list = fit.length ? fit : ['witch'];
  if (r === 0) { const first = ['H', 'witch', 'L', 'W'].filter(x => list.includes(x)); return [...first, ...list.filter(x => !first.includes(x))]; }
  const o = list.slice();
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(hash(940 + i, r) * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  if (o.length > 1 && o[0] === prev) [o[0], o[1]] = [o[1], o[0]];
  return o;
}
function crChain(tEnd, f) {           // the visits from t = 0 up to tEnd, in order
  const rest = CR_PICK.ghosts.join() + '|' + settings.cat + '|' + (view ? Math.round(view[4] * 1e5) + ',' + Math.round(view[7] * 1e3) : ''), key = f + '|' + rest;
  const C = CR_CHAIN, P = crPeriod(f), ov = clamp(f - 1, 0, 1);
  if (C.key !== key) {
    // only the Ghosts & witch pace moved: the visits that have begun play on as they are, the rounds go on from the last of them at the new pace
    // (rebuilding from t = 0 made a running visit hop or vanish)
    const kept = C.rest === rest ? C.ev.filter(e => e.t0 <= time) : [], last = kept[kept.length - 1];
    if (!last) Object.assign(C, { key, rest, ev: [], next: CR_FIRST, round: 0, queue: [], end: {} });
    else {
      const end = {}; for (const e of kept) end[e.type] = e.t0 + e.len;
      Object.assign(C, { key, rest, ev: kept, round: last.round, queue: last.queue.slice(), end,
        next: Math.max(time, last.t0 + P * (.7 + .6 * hash(935, last.k)), last.t0 + (last.len + 3) * (1 - ov)) });
      paceDirty = true;
    }
  }
  while (C.next <= tEnd) {
    if (!C.queue.length) C.queue = crRound(C.round++, C.ev.length ? C.ev[C.ev.length - 1].type : null);
    // above 50 visits overlap: take the first queued visit that isn't still running (else the one that ends first), so the chain never waits
    // behind a long one (the lantern train) while the screen is empty. Up to 50 the head of the queue is always free.
    const free = x => (C.end[x] || 0) + 2 <= C.next;
    let qi = C.queue.findIndex(free);
    if (qi < 0 && ov > 0 && C.queue.length < 8) { C.queue.push(...crRound(C.round++, C.queue[C.queue.length - 1])); qi = C.queue.findIndex(free); }   // the next round's free ones may go first
    if (qi < 0) qi = C.queue.reduce((b, x, i) => (C.end[x] || 0) < (C.end[C.queue[b]] || 0) ? i : b, 0);
    const type = C.queue.splice(qi, 1)[0], len = CR_LEN[type], k = C.ev.length;
    let t0 = Math.max(C.next, (C.end[type] || 0) + 2); for (let j = 0; j < 30 && crHitsLookUp(t0, len); j++) t0 += 2;
    C.ev.push({ t0, len, k, type, round: C.round, queue: C.queue.slice() }); C.end[type] = t0 + len;   // round and queue: where the rounds stood after it
    C.next = Math.max(t0 + P * (.7 + .6 * hash(935, k)), t0 + (len + 3) * (1 - ov));
  }
  return C.ev;
}
// every visit of a kind ('ghost' or 'moon') running at time t (above Ghosts & witch 50 two ghost visits can overlap), oldest first
function crEvents(t, kind) {
  const f = settings.creatures; if (!f) return [];
  const L = CRL(), out = [];
  if (L && L.script) {                                         // development hook: only the scripted events ([t0, 'ghostA' | 'ghostB' | 'witch' | 'veil'])
    for (const [t0, name] of L.script) {
      const type = CR_NAMES[name] || (name === 'ghost' ? (L.ghost || CR_PICK.ghosts[0]) : name);
      if ((kind === 'ghost') !== crIsGhost(type)) continue;
      if (t >= t0 && t < t0 + CR_LEN[type]) out.push({ t0, len: CR_LEN[type], k: Math.round(t0), type });
    }
    return out;
  }
  const ev = crChain(t, f); let lo = 0, hi = ev.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ev[m].t0 <= t) { i = m; lo = m + 1; } else hi = m - 1; }
  for (let j = i; j >= 0 && ev[j].t0 > t - CR_MAXLEN; j--) if (t < ev[j].t0 + ev[j].len && (kind === 'ghost') === crIsGhost(ev[j].type)) out.unshift(ev[j]);
  return out;
}
const crEvent = (t, kind) => crEvents(t, kind)[0] || null;   // the oldest one (test hooks)
// a few pale motes shed from the tail now and then: they hang where the ghost was, sink a little and fade (never in front of the roof it hides behind)
function crMotes(e, def, tau) {
  if (!tex['cr-dot']) { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(235,245,255,1)'); gr.addColorStop(.4, 'rgba(150,190,255,.6)'); gr.addColorStop(1, 'rgba(110,150,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); tex['cr-dot'] = upload(c); }
  M.layers['cr-dot'] = { rect: [0, 0, 32, 32] };
  for (let j = 0; j < 8; j++) {
    const kb = Math.floor(tau / .45) - j, tb = kb * .45, age = tau - tb, kk = kb + e.k * 17;
    if (tb < 1 || age < 0 || age > 2.6 || hash(950, kk) > .65 || tb > (def.sink ? 22 : 30) || (def.occ && tb < 11)) continue;
    const ps = crGhostState(def, tb), x = ps.x + 16 + (hash(951, kk) - .5) * 22 + Math.sin(age * 1.4 + kk) * 5 * age, y = ps.y + 66 + 12 * age + (hash(952, kk) - .5) * 10;
    const sz = 6 + 6 * hash(953, kk), a = crSm(0, .5, age) * (1 - crSm(.8, 2.6, age)) * .6, rr = [x - sz / 2, y - sz / 2, sz, sz];
    layer('cr-dot', { rect: rr, r0: rr, add: true, op: a });
  }
}
function drawGhost(w) {
  if (!settings.creatures) return;
  for (const e of crEvents(time, 'ghost')) drawGhostOne(e);
}
// H's sheet goes on after the chimney smoke (draw(): case '@smoke'), so the smoke doesn't smear its face; its light stays here, under the trees, ivy and cat
function drawGhostOver() {
  if (!settings.creatures) return;
  for (const e of crEvents(time, 'ghost')) if (e.type === 'H') crSheetGhost(e, true);
}
function drawGhostOne(e) {
  if (e.type === 'H') return crSheetGhost(e, false);
  if (e.type === 'L' || e.type === 'W') return;                   // drawn at '@ghostlake'
  if (!(crSkin() === '3d' ? CRI.ghost3d : CRI.ghost)) return;
  const def = CR_GHOSTS[e.type], tau = time - e.t0, s = crGhostState(def, tau); s.occ = def.occ;
  crGhostDraw(s); crMotes(e, def, tau);
}

// ---- v5: H, the 3D sheet ghost behind the big chimney (the 3D one worked best; heavier cloth, shorter, hiding behind the chimney).
// blender/sheetghost.py simulates a cloth sheet pinned over a head along CR_HIDE (with the bob, sway and lean, true head turns, sleeves held up by the arms,
// the hem trailing) and renders it toon-flat with ink lines; ghost5-sheetH-heavy.png holds its 145 frames (12 fps from tau .8, 16 x 16 cells of 128 px,
// each the same crop: art px across, centre dx, dy from the path point, which is the head). The path is in art px; the frames carry the motion.
const CR_HIDE = [[0, 3137, 640], [.8, 3132, 640], [2.0, 3010, 628], [4.6, 3006, 632], [5.2, 3132, 636], [6.3, 3134, 560], [7.6, 3136, 352],
  [10.4, 3138, 358], [11.6, 3137, 350], [12.4, 3136, 600], [13.5, 3136, 640]];
const R5CHIM = [2960, 380, 330, 520];
const CR_SHEET = { n: 145, fps: 12, t0: .8, art: 199.69, dx: 9.84, dy: 37.97, tint: [.55, .78, 1] };
// how much of it shows (0-1): peeking out about 1.1-5.1 s, behind the chimney, over the cap about 6.6-12.4 s. Its glow follows that: it stays a little
// while it hides (a light from behind the chimney), and fades out smoothly as it drops away at the end (the light used to just stop)
const crHideSeen = tau => Math.max(crSm(1.1, 2, tau) * (1 - crSm(4.6, 5.3, tau)), crSm(6.6, 7.5, tau) * (1 - crSm(11.6, 12.5, tau)));
function crSheetGhost(e, top) {                                     // top: the sheet (after '@smoke'), else its light (at '@ghost')
  const S = CR_SHEET, tau = time - e.t0, p = crPath(CR_HIDE, tau);
  const light = .8 * (.3 + .7 * crHideSeen(tau)) * crSm(.3, 1.6, tau) * (1 - crSm(11.8, 13.3, tau));
  if (!top) return cr5Light(p[0], p[1] + 6, 250, light * 1.12, S.tint);   // on the chimney and the roof around it
  const t3 = crTex('sheetH'), f = (tau - S.t0) * S.fps; if (!t3 || !crTex('chim5') || f < 0 || f > S.n - 1) return;
  const i = Math.floor(f), A = S.art, cx = p[0] + S.dx, cy = p[1] + S.dy;
  cr5Sprite(t3, 16, 16, { a: i, b: Math.min(S.n - 1, i + 1), mix: f - i }, [cx - A / 2, cy - A / 2, A, A], CR_ID,
    { op: 1, emit: .16, tint: S.tint, halo: [15, .7 * light], occ: ['chim5', R5CHIM] });
}

// draw atlas cells (a, b mixed) of a v5 sprite over rect with matrix mw: o = { op, emit, tint, halo: [art px, strength], occ: [texture, art rect] (hidden where its G is set) }
function cr5Sprite(t, cols, rows, c, rect, mw, o) {
  const L = crProgs().c5, ot = o.occ ? crTex(o.occ[0]) : null, lk = o.occ ? o.occ[1] : [0, 0, 1, 1];
  const cu = i => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows], a = cu(c.a), b = cu(c.b);
  crQuad(L, rect, mw); gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ot || t); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.uniform4f(L.ca, a[0], a[1], a[2], a[3]); gl.uniform4f(L.cb, b[0], b[1], b[2], b[3]); gl.uniform1f(L.mixb, c.b === c.a ? 0 : c.mix);
  gl.uniform4f(L.lk, lk[0], lk[1], lk[2], lk[3]); const tn = o.tint || [.55, .78, 1]; gl.uniform3f(L.tint, tn[0], tn[1], tn[2]);
  gl.uniform1f(L.op, o.op); gl.uniform1f(L.emit, o.emit || 0); gl.uniform1f(L.mode, ot ? 1 : 0);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(L.pass, 0); gl.uniform3f(L.hl, 0, 0, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (o.halo && o.halo[1] > .005) { gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1f(L.pass, 1); gl.uniform3f(L.hl, o.halo[0] / rect[2], o.halo[0] / rect[3], o.halo[1]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}
// soft additive light of a ghost on what is around it (the relight program: the painting's own colours, tinted)
function cr5Light(x, y, rr, amt, tint) {
  const bt = tex.base; if (!bt || amt < .01) return;
  const L = crProgs().r, br = R('base'); crQuad(L, [x - rr, y - rr, 2 * rr, 2 * rr]);
  gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bt); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bt);
  gl.uniform4f(L.rb, br[0], br[1], br[2], br[3]); gl.uniform4f(L.occ, 0, 0, 1, 1); gl.uniform3f(L.pos, x, y, rr); gl.uniform3f(L.tint, tint[0], tint[1], tint[2]);
  gl.uniform1f(L.amt, amt); gl.uniform1f(L.occOn, 0); gl.blendFunc(gl.ONE, gl.ONE); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}
// v5 hook in the draw order: '@ghostlake' (just before '@mist': over the water and the window lights, under the mist and the town smoke), for L and W
function drawGhost5(hook) {
  if (!settings.creatures || hook !== '@ghostlake') return;
  for (const e of crEvents(time, 'ghost')) {
    if (e.type === 'L') crProcession(e);
    if (e.type === 'W') crWisps(e);
  }
}

// ---- v5: lights in the background
// small glowing sprites: a pale blue lantern dot (cr-dot) and a cold green-white wisp flame (cr-wisp), both soft radial gradients made on first use
function cr5Dots() {
  const mk = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return upload(c); };
  if (!tex['cr-dot']) tex['cr-dot'] = mk([[0, 'rgba(235,245,255,1)'], [.4, 'rgba(150,190,255,.6)'], [1, 'rgba(110,150,255,0)']]);
  if (!tex['cr-wisp']) tex['cr-wisp'] = mk([[0, 'rgba(240,255,250,1)'], [.35, 'rgba(150,255,225,.65)'], [1, 'rgba(80,200,190,0)']]);
  M.layers['cr-dot'] = M.layers['cr-wisp'] = { rect: [0, 0, 32, 32] };
}
const R5LAKE = [500, 1380, 1680, 170];                               // ghost5-lakeocc.png rect (the water mask's)
let crLakePx = null;
function crLakeAt(x, y) {                                          // water (0-1) at an art position, read once from ghost5-lakeocc.png on the CPU
  if (!crLakePx) { const im = CRI.lake5; if (!im) return 0; const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); crLakePx = { d: g.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height }; }
  const u = Math.round(x - R5LAKE[0]), v = Math.round(y - R5LAKE[1]); if (u < 0 || v < 0 || u >= crLakePx.w || v >= crLakePx.h) return 0;
  const i = (v * crLakePx.w + u) * 4; return crLakePx.d[i] / 255 * (1 - crLakePx.d[i + 1] / 255);
}
const crDot = (k, x, y, w, h, op) => { if (op < .004) return; const rr = [x - w / 2, y - h / 2, w, h]; layer(k, { rect: rr, r0: rr, add: true, op }); };
// a light's reflection: a few short wavering strokes under it on the water (only where ghost5-lakeocc.png says water)
function crReflect(k, x, y, yw, op, n = 4) {
  for (let j = 0; j < n; j++) {
    const ry = 2 * yw - y + 4 + j * 6, rx = x + 2.2 * Math.sin(time * 2.1 + j * 1.7 + x * .05); if (crLakeAt(rx, ry) < .5) continue;
    crDot(k, rx, ry, 7 - j, 2.4, op * (1 - j / n));
  }
}

// L, the lantern train: nine small ghosts with cold lanterns rise out of the moon path at the island's tip, walk in a line along the shore (their lights
// in the water) and up the lit path to the castle; one by one they go in, and the castle's windows turn ghost blue, spreading from the gate, and back.
// A distant, quiet event: each lantern is a few pixels, the line and its slow walk are what you see. 40 s.
const CR_TRAIN = [[1738, 1394], [1712, 1386], [1660, 1381], [1600, 1379], [1548, 1366], [1500, 1342], [1452, 1322], [1400, 1307], [1350, 1294], [1300, 1282], [1262, 1266], [1236, 1258]];
const CR_TRAIN_N = 9, CR_TRAIN_GAP = 24, CR_TRAIN_V = 22, CR_GATE = [1236, 1258];
let crTrainLen = 0;
function crTrainAt(s) {                                              // position at arc length s along CR_TRAIN (polyline)
  const P = CR_TRAIN;
  if (!crTrainLen) for (let i = 1; i < P.length; i++) crTrainLen += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  for (let i = 1; i < P.length; i++) {
    const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    if (s <= d || i === P.length - 1) { const u = clamp(s / d, 0, 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u]; }
    s -= d;
  }
}
function crProcession(e) {
  cr5Dots(); const tau = time - e.t0; crTrainAt(0);
  for (let i = 0; i < CR_TRAIN_N; i++) {
    const s = CR_TRAIN_V * (tau - 1) - i * CR_TRAIN_GAP; if (s < -2 || s > crTrainLen + 2) continue;
    const step = Math.sin(2 * Math.PI * (tau * 1.5 + i * .37)), p = crTrainAt(Math.max(0, s)), x = p[0], y = p[1] - 1.2 * Math.abs(step);
    const fade = crSm(0, 28, s) * (1 - crSm(crTrainLen - 18, crTrainLen, s)), fl = .82 + .18 * noise1(time * 3 + i * 7.3, 970);
    crDot('cr-dot', x - 2, y + 8, 8, 13, .32 * fade);                 // the little ghost under its lantern, a pale smudge at this distance
    crDot('cr-dot', x, y, 32, 32, .5 * fade * fl);                    // the lantern's glow
    crDot('cr-dot', x, y, 8, 8, 1 * fade * fl);
    if (y > 1360) crReflect('cr-dot', x, y, 1388, .5 * fade * fl * crSm(1360, 1378, y));
  }
  // the castle: as the lanterns go in, its windows turn ghost blue from the gate outward, hold, and turn back to gold
  const lt = tex['lights-pos'], lr = R('lights-pos'); if (!lt || !lr || !settings.lights) return;
  const tIn = 1 + crTrainLen / CR_TRAIN_V, tAll = tIn + (CR_TRAIN_N - 1) * CR_TRAIN_GAP / CR_TRAIN_V;
  const amt = crSm(tIn - .5, tIn + 1.5, tau) * (1 - crSm(e.len - 4.5, e.len - 1, tau)) * Math.min(1, settings.lights), spread = 30 + 260 * crSm(tIn, tAll + 1, tau);
  if (amt < .003) return;
  const L = crProgs().b5; crQuad(L, [990, 1110, 340, 190]); gl.uniform1i(L.t0, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lt);
  gl.uniform4f(L.lr, lr[0], lr[1], lr[2], lr[3]); gl.uniform2f(L.gate, CR_GATE[0], CR_GATE[1]); gl.uniform1f(L.amt, amt); gl.uniform1f(L.spread, spread);
  gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.uniform1f(L.pass, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.blendEquation(gl.FUNC_ADD); gl.uniform1f(L.pass, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

// W, small lights on the lake: four will-o'-wisps rise out of the dark water beside the moon path one after another, drift together, circle each other
// slowly over the water (their light wavering in it), and go out one by one. Clear of the town's chimney smoke, which drifts left from x 1411. 24 s.
const CR_WISPS = [[1612, 1448, 0], [1668, 1468, 1.3], [1722, 1444, 2.4], [1640, 1466, 3.4]];   // where each rises (art px) and when (s)
function crWisps(e) {
  cr5Dots(); const tau = time - e.t0, C = [1655, 1452];
  CR_WISPS.forEach(([x0, y0, t0], i) => {
    const u = tau - t0; if (u < 0) return;
    const gather = crSm(2, 8, u), ang = .55 * (tau - 6) + i * Math.PI / 2, rr = 34 + 6 * Math.sin(tau * .7 + i);
    let x = x0 + (C[0] + Math.cos(ang) * rr - x0) * gather + 4 * Math.sin(u * .9 + i), y = y0 + (C[1] + Math.sin(ang) * rr * .32 - y0) * gather;
    const out = 17 + i * 1.2, rise = crSm(0, 1.6, u), fade = rise * (1 - crSm(out, out + 1.2, tau));
    y -= 10 * rise + 2.5 * Math.sin(u * 2.3 + i * 2);                 // they float a little above the water
    if (fade < .004 || crLakeAt(x, y + 14) < .5) return;             // only over open water (houses and trees in front hide them)
    const fl = .8 + .2 * noise1(time * 4.1 + i * 3.3, 975);
    crDot('cr-wisp', x, y, 46, 46, .42 * fade * fl);
    crDot('cr-wisp', x, y - 3, 10, 17, 1 * fade * fl);               // a small upright flame
    crDot('cr-wisp', x, y - 2, 5, 8, .8 * fade * fl);
    crReflect('cr-wisp', x, y, y + 12, .6 * fade * fl, 6);
  });
}

// ---- the moon event
// the witch (v6): one Codex drawing, her head turning about the neck (a sway, a glance down at her cat) with the whole hat
// and the hair on it, and the hair, hat, skirt hem, the cat's tail and the broom's straw bending along simulated chains, each part its own layer.
// The whole 27 s flight is baked at 15 fps (witch-moving.png, alpha = the silhouette), played 1.25x faster (CR_WSPEED) with neighbouring frames blended.
const CR_W6 = { cols: 12, rows: 34, cw: 0.0830078125, ch: 0.029296875, n: 405, fps: 15, w: 0.9524, h: 0.671, dx: -0.0109, dy: -0.0141, dw: 222 };   // crop in drawing widths; dw = the drawing's width in art px
const CR_FSW = `precision highp float;
varying vec2 uv,wp;uniform sampler2D t0;uniform vec4 ca,cb;uniform vec3 col;uniform float mixb,op;
vec4 cell(vec4 c,vec2 q){return texture2D(t0,c.xy+clamp(q,0.,1.)*c.zw);}
void main(){float a=cell(ca,uv).a;if(mixb>0.)a=mix(a,cell(cb,uv).a,mixb);gl_FragColor=vec4(col*a,a)*op;}`;
const CR_WP = [   // [t, x, y] witch paths: left to right (dir 1) or right to left (dir -1); she passes above the cat's ears
  [[0, 760, 690], [6, 1380, 520], [12, 2020, 392], [17, 2360, 262], [22, 2850, 236], [27, 3500, 120]],
  [[0, 3440, 110], [5, 3000, 215], [10, 2560, 258], [15, 2150, 268], [20, 1700, 372], [24, 1300, 500], [27, 900, 600]],
];
// her size (x the drawing's dw) and speed (x the baked 27 s flight; the frames, bob and sparkles all run on flight time). At first she was
// a little slow for her size; 64 % was picked and 1.25x (a 21.6 s crossing) on the tuning sliders. A development page can override both (LAB.cr.size / speed).
const CR_WSIZE = .64, CR_WSPEED = 1.25;
const crWsz = () => (CRL() && CRL().size) || CR_WSIZE, crWsp = () => (CRL() && CRL().speed) || CR_WSPEED;
Object.defineProperty(CR_LEN, 'witch', { get: () => 27 / crWsp(), enumerable: true });
function crWitchState(e) {
  const tau = (time - e.t0) * crWsp(), dir = (CRL() && CRL().dir) || (hash(930, e.k) > .5 ? 1 : -1), pts = CR_WP[dir > 0 ? 0 : 1], p = crPath(pts, tau), pa = crPath(pts, tau - .3), pb = crPath(pts, tau + .3);
  const bob = 8 * Math.sin(tau * 2 * Math.PI / 3.1) + 3 * Math.sin(tau * 2 * Math.PI / 1.7 + .6);
  const slope = Math.atan2(pb[1] - pa[1], Math.abs(pb[0] - pa[0])), ang = dir * (slope * .5 + .035 * Math.sin(tau * 2 * Math.PI / 2.3));
  return { tau, dir, pts, x: p[0], y: p[1] + bob, ang, op: crSm(0, 3, tau) * (1 - crSm(24, 27, tau)) };
}
function crWitchDraw(e) {
  const wt = crTex('witch'); if (!wt) return;
  const S = CR_W6, { tau, dir, pts, x, y, ang, op } = crWitchState(e), Z = crWsz(), DW = S.dw * Z;
  const f = Math.max(0, Math.min(S.n - 1, tau * S.fps)), i = Math.floor(f), blend = !CRL() || CRL().blend !== false;
  // sparkles shed from the broom's straw: they hang in the air where she was and fade slowly
  for (let j = 0; j < 22; j++) {
    const kb = Math.floor(tau / .12) - j, tb = kb * .12, age = tau - tb; if (tb < 1 || age > 2.4 || age < 0) continue;
    const pp = crPath(pts, tb), bx = pp[0] - dir * .46 * DW + (hash(940, kb + e.k * 31) - .5) * 26 * Z, by = pp[1] + .08 * DW + (hash(941, kb + e.k * 31) - .5) * 22 * Z + 6 * age * age;
    const s = (7 + 8 * hash(942, kb)) * Z, a = crSm(0, .3, age) * (1 - crSm(.6, 2.4, age)) * .8 * Math.min(1, op * 1.5);
    const rr = [bx - s / 2, by - s / 2, s, s]; layer('ember', { rect: rr, r0: rr, add: true, op: a });
  }
  const L = crProgs().w6, cu = c => [(c % S.cols) * S.cw, Math.floor(c / S.cols) * S.ch, S.cw, S.ch], a = cu(i), b = cu(Math.min(S.n - 1, i + 1));
  const W = S.w * DW, H = S.h * DW, cx = x + S.dx * DW, cy = y + S.dy * DW;
  crQuad(L, [cx - W / 2, cy - H / 2, W, H], xform(x, y, ang, dir, 1));
  gl.uniform1i(L.t0, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, wt);
  gl.uniform4f(L.ca, a[0], a[1], a[2], a[3]); gl.uniform4f(L.cb, b[0], b[1], b[2], b[3]); gl.uniform1f(L.mixb, blend ? f - i : 0);
  gl.uniform3f(L.col, 12 / 255, 9 / 255, 22 / 255); gl.uniform1f(L.op, op);           // the near-black violet of the cat and the old witch
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
const CR_VEIL = [   // strips of cel cloud in veil-clouds.png: two drawings of each cloud (atlas rects), scale, y, left edge x at t = 0, speed (art px/s, leftwards), cross-fade period and phase (s)
  { r: [4, 4, 1399, 242], r2: [4, 538, 1262, 231], sc: 1.15, y: 430, x0: 2980, v: 82, per: 23, ph: 0 },
  { r: [4, 254, 1319, 90], r2: [4, 777, 1242, 90], sc: 1.1, y: 700, x0: 3150, v: 112, per: 17, ph: 5 },
  { r: [4, 352, 1022, 178], r2: [4, 875, 673, 177], sc: 1.0, y: 215, x0: 2900, v: 68, per: 29, ph: 11 },
];
const CR_VEIL_AT = [1407, 1064];                                     // veil-clouds.png size
function crVeilDraw(e) {
  const vt = crTex('veil'); if (!vt) return;
  const tau = time - e.t0, fadeOut = 1 - crSm(e.len - 6, e.len, tau);
  let cover = 0;
  CR_VEIL.forEach((s, i) => {
    const w = s.r[2] * s.sc, x = s.x0 - s.v * tau, c0 = x + .14 * w, c1 = x + .86 * w;
    cover += Math.max(0, Math.min(c1, 2830) - Math.max(c0, 1790)) / 900 * (i === 0 ? 1 : .35);
  });
  const dim = sm(clamp(cover, 0, 1)) * fadeOut;
  const P2 = crProgs();
  if (dim > .002 && tex['moon-disc']) {                                            // the moon, its glow and the sky dim a little while the veil is over them
    const L = P2.d, rm = R('moon-disc'); crQuad(L, [0, 0, ART_W, ART_H]); gl.uniform1i(L.t0, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex['moon-disc']);
    gl.uniform4f(L.rm, rm[0], rm[1], rm[2], rm[3]); gl.uniform3f(L.mc, 2306, 568, 0); gl.uniform1f(L.amt, dim);
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  const L = P2.g, [aw, ah] = CR_VEIL_AT;
  CR_VEIL.forEach(s => {
    const w = s.r[2] * s.sc, h = s.r[3] * s.sc, x = s.x0 - s.v * tau, y = s.y + 6 * Math.sin(tau * .21 + s.y);
    if (x > ART_W || x + w < 0) return;
    // each cloud slowly turns into a second drawing of itself and back (its edges come and go like the painted clouds' do), so it is never one rigid shape
    const u = ((tau + s.ph) / s.per) % 1, m = sm((u - .1) / .3) - sm((u - .6) / .3);
    for (const [r, mix] of [[s.r, Math.min(1, 2 * (1 - m))], [s.r2, Math.min(1, 2 * m)]]) {     // both near full opacity at the half way point: the clouds grow into each other, no see-through mud
      if (mix < .003) continue;
      const rw = r[2] * s.sc, rh = r[3] * s.sc;
      crQuad(L, [x + (w - rw) / 2, y + (h - rh) / 2, rw, rh]);
      gl.uniform1i(L.t0, 0); gl.uniform1i(L.t1, 1); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vt); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, vt); gl.activeTexture(gl.TEXTURE0);
      gl.uniform4f(L.ca, r[0] / aw, r[1] / ah, r[2] / aw, r[3] / ah); gl.uniform4f(L.cb, 0, 0, 1, 1); gl.uniform1f(L.mixb, 0);
      gl.uniform4f(L.occ, 0, 0, 1, 1); gl.uniform1f(L.occOn, 0); gl.uniform4f(L.rv, -1, 0, -2960, 170); gl.uniform1f(L.fl, 1e5); gl.uniform2f(L.flx, 0, 0); gl.uniform1f(L.op, .92 * fadeOut * mix);
      gl.uniform3f(L.tint, 0, 0, 0); gl.uniform1f(L.emit, 0); gl.uniform1f(L.pass, 0); gl.uniform4f(L.hl, 0, 0, 0, 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  });
}
function drawMoonFx(w) {
  if (!settings.creatures) return;
  for (const e of crEvents(time, 'moon')) {
    if (e.type === 'veil' && CRI.veil) crVeilDraw(e);
    else if (e.type === 'witch' && CRI.witch) crWitchDraw(e);
  }
}
// inert test hook (checks and clips): where the ghost / the moon event is at scene time t
window.creaturesTest = {
  ghost: t => { const e = crEvent(t, 'ghost'); return e && (CR_GHOSTS[e.type] ? { ...e, ...crGhostState(CR_GHOSTS[e.type], t - e.t0) } : e); },
  moon: t => crEvent(t, 'moon'),
  witch: t => { const e = crEvent(t, 'moon'); if (!e || e.type !== 'witch') return null; const keep = time; time = t; const w = crWitchState(e); time = keep; return w; },
  hitsLookUp: (t0, len) => crHitsLookUp(t0, len),
  rotation: g => { CR_PICK.ghosts = g.length ? g : ['B']; CR_CHAIN.key = ''; },      // development hook: which ghost visits take turns
  events(t0, t1, dt = .5) { const out = []; let last = ''; for (let t = t0; t < t1; t += dt) { for (const k of ['ghost', 'moon']) for (const e of crEvents(t, k)) { const id = k + e.type + e.t0.toFixed(1); if (!out.some(o => o.id === id)) out.push({ id, kind: k, type: e.type, t0: +e.t0.toFixed(1), len: e.len }); } } return out; },
};
// ===== end creatures =====

function draw() {
  if (!ready || lost) return;
  fitView();
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const w = windAt(time);
  let head = null;
  for (const n of M.order || ['base', '@cat', '@bats']) {
    switch (n) {
      case '@cat': head = drawCat(); break;
      case '@bats': drawBats(head, false); break;
      case '@farbats': drawBats(head, true); break;
      case '@clouds': drawClouds(); break;
      case '@ivy': drawIvy(w); break;
      case '@mist': drawMist(); break;
      case '@smoke': drawSmoke(w); drawGhostOver(); break;   // the chimney ghost's sheet goes over the smoke (creatures block)
      case '@leaf': drawLeaf(); break;
      case '@embers': drawEmbers(); break;
      case '@water': drawWater(); break;
      case '@trees': drawTrees(); break;
      case '@townsmoke': drawTownSmoke(w); break;
      case '@ghost': drawGhost(w); break;
      case '@moonfx': drawMoonFx(w); break;
      case '@ghostlake': drawGhost5(n); break;   // v5: the lantern train and the lake lights (creatures block)
      default: {
        const fx = (M.fx && M.fx[n]) || {};
        if (fx.kind === 'lights') drawLights();
        else if (fx.kind === 'add') layer(n, { add: true, op: n === 'moon-glow' ? 1 + .07 * Math.sin(time * 2 * Math.PI / 50) : 1 });   // the moon's halo breathes over ~50 s
        else if (fx.kind === 'glow') layer(n, { op: settings.lights ? Math.min(1, settings.lights) * flicker(time + (n === 'glow-roof' ? .05 : 0)) : 0 });
        else if (fx.kind !== 'skip' && fx.kind !== 'atlas') layer(n);
      }
    }
  }
  frames++;
}
function frozen() { return !settings.cat && !settings.creatures && !settings.wind && !settings.lights; }
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

function setup() {
  P.layer = link(VS, FS, ['m', 'rect', 't0', 't1', 'r0', 'r1', 'u1', 'op', 'add', 'br', 'fl']);
  gl.useProgram(P.layer.prog); gl.uniform1i(P.layer.t0, 0); gl.uniform1i(P.layer.t1, 1);
  P.mesh = link(VSM, FSM, ['m', 't0', 'op']);
  P.smoke = link(VS, FSS, ['m', 'rect', 'r0', 'mouth', 'time', 'wind', 'amt']);
  P.mist = link(VS, FSF, ['m', 'rect', 'r0', 'rb', 't0', 'time', 'amt']);
  P.lights = link(VS, FSL, ['m', 'rect', 'r0', 't0', 't1', 't2', 'amt']);
  gl.useProgram(P.lights.prog); gl.uniform1i(P.lights.t0, 0); gl.uniform1i(P.lights.t1, 1); gl.uniform1i(P.lights.t2, 2);
  quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  for (const [k, img] of Object.entries(images)) tex[k] = upload(img, (M.fx && M.fx[k]) || {});
  { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,236,170,1)'); gr.addColorStop(.35, 'rgba(255,170,70,.75)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32); tex.ember = upload(c); M.layers.ember = { rect: [0, 0, 32, 32] }; }
  const bf = images['bat-flap'];                  // slice the flap cycle into one texture per cel
  if (bf && M.batFlap) {
    bats.n = M.batFlap.frames; bats.w = bf.width / bats.n; bats.h = bf.height;
    for (let i = 0; i < bats.n; i++) {
      const c = document.createElement('canvas'); c.width = bats.w; c.height = bats.h;
      c.getContext('2d').drawImage(bf, -i * bats.w, 0); tex['bat' + i] = upload(c);
      M.layers['bat' + i] = { rect: [0, 0, bats.w, bats.h] };
    }
  }
  buildTail();
  meshBuf = gl.createBuffer(); meshUV = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshUV); gl.bufferData(gl.ARRAY_BUFFER, tailMesh.uv, gl.STATIC_DRAW);
  meshIdx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tailMesh.idx, gl.STATIC_DRAW);
  gl.enable(gl.BLEND);
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
function fail(err) {
  ready = false; cancelAnimationFrame(raf); canvas.hidden = true;
  document.body.style.backgroundImage = `url('${url('preview.jpg')}')`;
  console.warn('Animation unavailable, showing still art:', err && err.message);
}
document.addEventListener('visibilitychange', schedule);
window.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; ready = false; schedule(); });
canvas.addEventListener('webglcontextrestored', () => { try { tex = {}; setup(); } catch (e) { fail(e); } });

window.wallpaperDiagnostics = { get state() { return { ready, lost, time, frames, paused: stopped(), fps: settings.fps, settings: { ...settings }, width: canvas.width, height: canvas.height }; } };
window.wallpaperTest = {
  seek(t) {
    testMode = true; schedule(); time = t;
    if (paceDirty) { paceAt = {}; LEAF_MEMO.mode = ''; CR_CHAIN.key = CR_CHAIN.rest = ''; paceDirty = false; }   // as if the sliders had always been where they are
    draw();
  },
  resume() { testMode = false; schedule(); },
  head: t => headState(t),
};

try {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) throw Error('WebGL is not available.');
  const names = Object.keys(M.layers).filter(n => M.layers[n].file);
  let left = names.length;
  for (const n of names) {
    const img = new Image();
    img.onload = () => { images[n] = img; if (--left === 0) { try { setup(); } catch (e) { fail(e); } } };
    img.onerror = () => fail(Error(M.layers[n].file + ' could not be loaded'));
    img.src = url(M.layers[n].file);
  }
} catch (e) { fail(e); }
})();

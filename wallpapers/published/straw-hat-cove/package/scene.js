'use strict';
// Straw Hat Cove: one WebGL2 pass over textures authored offline (pack_textures.py, not in this repo, merges and crops them;
// the rectangles in the shader's const block must match the ones there), with the moving plants drawn into a layer first.
//   scene/plate.webp   the painting without the moving pieces, plants or clouds: clean plate in the plant and cloth regions, foreground un-mixed above the horizon
//   scene/sky.webp     the clear sky above the horizon, under the clouds
//   scene/under.webp   caustic-free seabed
//   scene/map-a.webp   r water weight, g shore distance, b region flags, a what stands in front of the plants
//   scene/map-b.webp   r sky matte, g plant bend, b painted caustic web
//   scene/masks.webp   r Log Pose sheen, g cola, b lenses, a cane
//   scene/plants.webp, labels.webp, foliage-table.png   cut-out plants, one piece per leaf
//   scene/cloth.webp, vest.webp   moving props; the vest's cast shade sits beside it
//   scene/clouds.webp  long looping cloud strip (straight-alpha RGBA)
//   scene/light.webp, foam.webp   the lagoon's light and foam layers, one channel each
// cola fizz: the tuned preset; the Cola slider scales the amount (colaParam)
const FZ = { streams: 4, rate: 1.15, haze: 1.5, opacity: .45, surf: 1.5 };
const FZ_U = [['streams', 'uFzStreams'], ['rate', 'uFzRate'], ['haze', 'uFzHaze'], ['opacity', 'uFzOpacity'], ['surf', 'uFzSurf']];
// distant waves: per-layer speeds of the tuned settings (ripples, swell, glitter bands, gust patches), fixed
const DW_SPEED = [.89, 2.32, .21, 1.58];
const S = window.study = {
  live: false, ready: false, time: 0, wtime: 0, paused: false, fps: 30, frames: 0, scale: 1,
  crispStrength: 0.55, crispSpeed: 1, smokeAmount: 20, cola: 50, shine: 5, frost: 50, glintAmount: 50, waves: 50,
  windAmount: 50, plantAmount: 50, cloudDrift: 35, focus: .56,
  cloudPh: [0, 0], cloudSh: 0,   // looping-cloud phases (source px) and water-shadow drift
  dwClock: [0, 0, 0, 0],   // per-layer wave clocks (seconds), accumulated in tick and set in demo.seek
  crClock: [0, 0],   // extra caustics: their copies of time and wtime, accumulated the same way, so the speed slider never makes them jump
};
const canvas = document.createElement('canvas'); document.body.prepend(canvas);
const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false, alpha: false, depth: false, stencil: false });
if (!gl) document.getElementById('err').style.display = 'grid';
// a lost context takes every program and texture with it: accept the restore and start over (the poster shows meanwhile).
// Wallpaper Engine doesn't send the settings again after a reload, so they cross it in window.name (the end of this file reads them back).
canvas.addEventListener('webglcontextlost', e => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => { window.name = JSON.stringify({ s: settings(), fps: S.fps, paused: hostPaused }); location.reload(); });

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uPlate, uSky, uUnder, uMapA, uMapB, uLayer, uCldTex, uLight, uFoam, uVest, uCloth, uMasks;
uniform vec2 uRes; uniform float uT, uWT, uFocus;
uniform float uGlint;   // 0 off, 1 = the tuned look, 2 = more and brighter
uniform float uWaves;   // distant waves: 0 off, 1 = the tuned settings, 2 = double
uniform float uCrisp;   // extra caustics strength
uniform vec2 uCrClk;    // extra caustics clocks: their t and uWT, scaled by the speed slider on the CPU
uniform float uShine;   // lens and Log Pose shine (1 = round-5 look)
uniform float uMotion;  // wind on the props (1 = round-3 look)
uniform float uSmokeK, uSmokeA;  // cigarette plume scale and opacity
uniform float uVapour;  // cold vapour at the cane
uniform vec2 uCldPh;    // looping clouds: drift phase in source px of the near / mid layer (accumulated and wrapped on the CPU)
uniform float uCldSh;   // cloud-shadow drift on the water (unwrapped source px of the near layer)
uniform vec4 uDwClk;    // distant waves: layer clocks (ripples, swell, glitter, gusts)
uniform int uLayerRows;   // rows of the plants layer texture (it is only as tall as the plants can reach)
uniform int uZ;         // never set, so always 0. Loops that start at it can't be unrolled by the D3D compiler (5 s -> a fraction of that at every start)
// where things are in the painting, in source px (scene.json, not in this repo)
const float uHorA = .13045756764699862, uHorB = -.04825251591648701, uZK = .62;
const vec2 uSmoke = vec2(477.8, 503.), uTexFade = vec2(1.7, 3.4);
const vec4 uCl1 = vec4(566., 778., 1249., 547.);   // vest top, vest bottom, hat pivot xy
const vec4 uCl2 = vec4(563., 540., 552., 570.);    // bandana knot xy, bandana gate x0 x1
const vec4 uCola = vec4(1047., 522., 1075., 589.); // liquid box x0 y0 x1 y1
const vec3 uTip = vec3(476.81632653061223, 823., 468.);   // cane tip xy, cane top y
const vec4 uDome1 = vec4(792., 679., 814., 681.), uDome2 = vec4(801., 691., 7., 0.);   // Log Pose dome centres (x,y) x3 + radius
const vec4 uCh = vec4(832., 858., 770., 645.);     // Chopper hat pivot xy, tangerine leaf pivot xy
const vec4 uMap = vec4(758., 712.5, -.19611613513818404, -.9805806756909202);   // map corner: hinge xy, lift direction xy (unit)
const vec4 uSling = vec4(935., 694., 958., 709.);  // slingshot band: fork tip A xy, fork tip B xy
const vec2 uCldSc = vec2(.55, .55 * .844);         // cloud layer scales (source px per strip px)
const vec2 uCldTexSize = vec2(7768., 408.);        // cloud strip size in px
// crops of the textures (pack_textures.py)
const float SKY_K = 1882. / 256., UNDER_Y0 = 192. / 1882., UNDER_Y1 = 1648. / 1882.;
const vec2 CLOTH_O = vec2(480., 512.), CLOTH_S = vec2(856., 360.);   // source px
const vec2 MASK_O = vec2(384., 456.), MASK_S = vec2(716., 376.);     // source px
const ivec2 VEST_O = ivec2(1856, 1088), VEST_LO = ivec2(400, 0), VEST_HI = ivec2(718, 526);   // 2x texels; the vest is the right part of vest.webp
const vec2 SHADE_O = vec2(2192., 1088.), SHADE_S = vec2(400., 528.), VEST_TEX = vec2(720., 528.);   // the left part: its cast shade, 1000 source px to the left of where it falls
out vec4 o;
const vec2 TEX = vec2(1672., 941.);
const float IA = 1672. / 941.;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; for (int i = uZ; i < 4; i++){ v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
// the lagoon's wave field: height and gradient of seven directional swells
vec3 field(vec2 p, float t){ float h = 0.; vec2 g = vec2(0.);
  for (int i = uZ; i < 7; i++){ float id = float(i), a = .75 + id * 2.399; vec2 d = vec2(cos(a), sin(a));
    float k = 1.8 * pow(1.42, id), amp = .11 * pow(.55, id), phase = dot(p, d) * k - sqrt(9.8 * k) * t * .53 + id * 1.37;
    h += amp * sin(phase); g += d * k * amp * cos(phase); }
  return vec3(h, g); }
float lightF(vec2 p){ return smoothstep(.16, .82, texture(uLight, p).r); }
// gusts: calm stretches between breezes
float gust(float t){ return .35 + .65 * smoothstep(.15, .85, .5 + .5 * sin(t * .21) * sin(t * .13 + 1.)); }
vec2 coverUV(vec2 s){ float A = uRes.x / uRes.y; vec2 uv = s;
  if (A > IA){ float half_ = .5 * IA / A; uv.y = (s.y - .5) * IA / A + clamp(uFocus, half_, 1. - half_); }
  else uv.x = (s.x - .5) * A / IA + .5;
  return uv; }
float hq(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hq2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .103, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec2 h2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
// cel caustic border distance (Inigo Quilez), as in the veranda's "Cel web" style; used by the optional crisp caustics
float cellEdge(vec2 x, float t){
  vec2 n = floor(x), f = fract(x), mg = vec2(0), mr = vec2(0); float md = 8.;
  for (int j = uZ - 1; j <= 1; j++) for (int i = uZ - 1; i <= 1; i++){ vec2 g = vec2(i, j), q = h2(n + g); q = .5 + .42 * sin(t + 6.2831 * q); vec2 r = g + q - f; float d = dot(r, r); if (d < md){ md = d; mr = r; mg = g; } }
  md = 8.;
  for (int j = uZ - 2; j <= 2; j++) for (int i = uZ - 2; i <= 2; i++){ vec2 g = mg + vec2(i, j), q = h2(n + g); q = .5 + .42 * sin(t + 6.2831 * q); vec2 r = g + q - f; if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(.5 * (mr + r), normalize(r - mr))); }
  return md; }
float webAt(float e, vec2 x, float w){ float px = length(fwidth(x)); return 1. - smoothstep(w * .35, w + px * 1.2, e); }
// ---- occasional stronger breezes on top of the gusts (shared by all wind motion): two incommensurate cycles
// (about every 37 s and 53 s). Returns the envelope (quick rise, slow settle) and the time since it started.
vec2 breeze(float t){
  float p1 = mod(t + 31., 37.), p2 = mod(t + 30., 53.);
  float e1 = smoothstep(0., 1.4, p1) * exp(-max(0., p1 - 1.4) / 2.6);
  float e2 = .75 * smoothstep(0., 1.4, p2) * exp(-max(0., p2 - 1.4) / 2.6);
  return e1 >= e2 ? vec2(e1, p1) : vec2(e2, p2); }
// ---- wind on cloth: inverse displacement (destination px -> source px), all sharing the gust envelope
vec2 vestSrc(vec2 p, float t){
  float k = pow(clamp((p.y - uCl1.x) / (uCl1.y - uCl1.x), 0., 1.), 1.5), g = gust(t + p.x * .0015);
  vec2 b = breeze(t);
  float dx = (1.5 * sin(t * 1.05 + .6) + .55 * sin(t * 2.7 + p.y * .06) + .35 * sin(p.y * .11 - t * 3.4)) * g * k * (1. + 1.2 * b.x)
           + 2.2 * b.x * sin(b.y * 2.1 + p.y * .02) * k;
  dx *= uMotion * (.45 + (1. - .45) * smoothstep(1135., 1185., p.x));   // vest-fix v6 A: the front panel's left side swings (.45 at the post side); the back panel beside the post is static (cloth-vest.png static block), so only the front moves over it
  return p - vec2(dx, -.25 * abs(dx) * k); }
// vest-fix v2: the chair post stands in front of the vest. Its right edge is a slanted line (x = 1148 at y <= 600, then -.2 px per px), soft over 1 px.
// Same constants as POST_* in build_vest.py. 1 on the post, 0 elsewhere.
float vestPost(vec2 p){ float xe = 1148. - .2 * max(p.y - 600., 0.); return 1. - smoothstep(xe + .5, xe + 1.5, p.x); }
// vest-fix v1: alpha-weighted bilinear sample of the straight-alpha vest layer at continuous source px q (no dark/bright fringes at the
// soft alpha edge or the painted shadow, exact texel at zero displacement). Only used inside the vest zone.
vec4 vestTex(vec2 q){
  vec2 c = q * 2. - .5, i = floor(c), f = c - i; ivec2 i0 = clamp(ivec2(i) - VEST_O, VEST_LO, VEST_HI);
  vec4 a = texelFetch(uVest, i0, 0), b = texelFetch(uVest, i0 + ivec2(1, 0), 0), cc = texelFetch(uVest, i0 + ivec2(0, 1), 0), d = texelFetch(uVest, i0 + ivec2(1, 1), 0);
  vec4 w = vec4((1. - f.x) * (1. - f.y), f.x * (1. - f.y), (1. - f.x) * f.y, f.x * f.y) * vec4(a.a, b.a, cc.a, d.a);
  float s = w.x + w.y + w.z + w.w;
  return vec4((a.rgb * w.x + b.rgb * w.y + cc.rgb * w.z + d.rgb * w.w) / max(s, 1e-5), s); }
vec2 hatSrc(vec2 p, float t){
  float g = gust(t + p.x * .0015); vec2 b = breeze(t);
  // calm most of the time; a breeze swings it noticeably, then it settles like a pendulum on its hook
  float a = (radians(.35) * sin(t * .85) * g + radians(.12) * sin(t * 2.1 + 1.) * g + radians(3.2) * b.x * sin(b.y * 2.3)) * uMotion;
  return uCl1.zw + rot(p - uCl1.zw, -a); }
vec2 bandSrc(vec2 p, float t){
  float g = gust(t + p.x * .0015); vec2 b = breeze(t);
  float k = pow(clamp((length(p - uCl2.xy) - 10.) / 115., 0., 1.), 1.3) * smoothstep(uCl2.z, uCl2.w, p.x);
  vec2 d = vec2(1.8 * sin(t * 1.1 + .3) + .7 * sin(t * 2.6 + p.y * .07), .4 * sin(t * 1.3)) * g * k * (1. + 1.1 * b.x)
         + vec2(1.6 * b.x * sin(b.y * 2.6), 0.) * k;
  return p - d * uMotion; }
// Chopper's hat rests on the rock: a small rock about its brim on the breezes, the brim edge lifting a hair
vec2 chopSrc(vec2 p, float t){
  vec2 b = breeze(t); float g = gust(t + .5);
  float a = (radians(1.2) * b.x * sin(b.y * 3.1) + radians(.08) * sin(t * 1.3) * g) * uMotion;
  vec2 q = uCh.xy + rot(p - uCh.xy, -a);
  float lift = 1.3 * b.x * (.5 + .5 * sin(b.y * 3.1 + .6)) * smoothstep(uCh.y - 22., uCh.y - 4., p.y) * smoothstep(uCh.x - 20., uCh.x + 60., p.x);
  return q + vec2(0., lift * uMotion); }
// map corner: lifts from its fold line on the breezes and flutters a little at the tip
vec2 mapSrc(vec2 p, float t){
  vec2 b = breeze(t); float g = gust(t + 3.);
  vec2 d = p - uMap.xy; float k = clamp(dot(d, vec2(-.28, .96)) / 30., 0., 1.);   // 0 at the fold line, 1 at the tip
  float lift = (.55 * g * (.5 + .5 * sin(t * 1.7)) + 2.2 * b.x * (.6 + .4 * sin(b.y * 6.))) * k * k
             + .35 * sin(t * 7.3 + length(d) * .3) * g * k * k * k;
  return p - uMap.zw * min(lift * uMotion, 5.); }   // plate is reliable to ~5 px (helpers/props)
// slingshot band: hangs between the fork tips and sways sideways, most at its lowest point
vec2 slingSrc(vec2 p, float t){
  vec2 b = breeze(t); float g = gust(t + 1.3);
  vec2 ab = uSling.zw - uSling.xy; float h = clamp(dot(p - uSling.xy, ab) / dot(ab, ab), 0., 1.);
  float sag = smoothstep(738., 775., p.y) * clamp((length(p - (uSling.xy + ab * h)) - 4.) / 60., 0., 1.);   // still where the strand crosses the arm (y 728-738)
  float sw = (.7 * sin(t * 1.9 + .4) * g + .25 * sin(t * 4.1) * g + 1.8 * b.x * sin(b.y * 3.4)) * sag;
  sw = clamp(sw * uMotion, -3.5, 3.5);   // plate under the band is rebuilt for ~3 px
  return p - vec2(sw, .3 * abs(sw)); }
// tangerine leaves: a slight flutter from the stem, a bit more on the breezes
vec2 leafSrc(vec2 p, float t){
  float g = gust(t + 2.); vec2 b = breeze(t);
  float k = clamp(length(p - uCh.zw) / 26., 0., 1.);
  float a = (radians(2.2) * sin(t * 2.4 + p.x * .06) * g + radians(.8) * sin(t * 5.3 + p.y * .2) * g + radians(4.) * b.x * sin(b.y * 5.)) * k * uMotion;
  a = clamp(a, -radians(4.), radians(4.));   // the plate behind the leaves is valid for ~3 px (helpers/leaves)
  return uCh.zw + rot(p - uCh.zw, -a); }
// ---- cola fizz (the tuned snippet): fine, slow-to-moderate, irregular streams of tiny translucent bubbles, a faint suspended haze,
// a gentle sparkling band at the liquid surface, a few bubbles clinging to the glass. Every bubble is a slightly lighter version of the
// local cola pixel, hidden under the glass's own highlights and outside the mask. Lengths in source px, times in seconds.
float fzMask(vec2 q){ return texelFetch(uMasks, ivec2(clamp(q - MASK_O, vec2(0.), MASK_S - 1.)), 0).g; }
uniform float uFzStreams;    // number of nucleation streams
uniform float uFzRate;       // bubbles per second per stream
uniform float uFzOpacity;    // overall bubble opacity
uniform float uFzHaze;       // density of the slow suspended haze
uniform float uFzSurf;       // surface fizz amount
const float uFzSize = 1., uFzSpeed = 1.05, uFzGrowth = .55, uFzTint = 1., uFzHighlight = .38, uFzIrreg = 1., uFzSurfH = 7., uFzSurfY = 519., uFzCling = 1.;

float fzH(float n){ return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
float fzH2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fzN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(fzH2(i), fzH2(i + vec2(1., 0.)), f.x), mix(fzH2(i + vec2(0., 1.)), fzH2(i + vec2(1., 1.)), f.x), f.y); }

// one bubble: a soft speck (sub-pixel to ~1.5 px) blended toward \`lit\`, plus a faint highlight pip
void fzBubble(inout vec3 c, vec3 lit, vec2 p, vec2 b, float r, float a){
  vec2 d = p - b; float dd = dot(d, d);
  if (a <= .003 || dd > 4. + 6. * r * r) return;
  float body = exp(-dd / (r * r * 1.1 + .16));
  vec2 hp = d + vec2(.3, .3) * r;
  float hl = exp(-dot(hp, hp) / (.12 + .12 * r * r));
  c = mix(c, lit, clamp(body * a * uFzOpacity, 0., 1.));
  c += vec3(.95, .82, .62) * hl * uFzHighlight * .13 * a * uFzOpacity;
}

// suspended micro-bubble haze: three conveyor layers of sparse tiny bubbles (own cell columns, own speeds)
void fzHaze(inout vec3 c, vec3 lit, vec2 px, float t, float top, float bot){
  if (uFzHaze <= .001) return;
  for (int L = uZ; L < 3; L++){
    float fl = float(L);
    float cw = 4.4 + 1.7 * fl, ch = 20. + 9. * fl, lr = .34 + .09 * fl;
    float cxi = floor(px.x / cw);
    for (int i = uZ - 1; i <= 1; i++){
      float cx = cxi + float(i), seed = cx * 1.37 + fl * 17.3;
      float vs = uFzSpeed * 11. * (.55 + .25 * fl) * (.7 + .6 * fzH(seed + 1.));
      float yoff = t * vs + uFzIrreg * 3. * sin(t * .5 + seed * 2.1);            // gentle surging
      float ry = floor((px.y + yoff) / ch);
      float clus = mix(1., 2. * fzN(vec2(cx * .35 + fl * 5., ry * .5 + fl * 3.)), uFzIrreg * .85);
      if (fzH2(vec2(cx + fl * 5.3, ry * .73 + 3.1)) > uFzHaze * .5 * clus) continue;
      float h1 = fzH2(vec2(cx * 1.9 + ry, fl * 3.7)), h2 = fzH2(vec2(ry * 2.3 + fl, cx * .7 + 9.1));
      float by = (ry + .1 + .8 * h2) * ch - yoff;
      if (abs(px.y - by) > 3.) continue;
      float bx = (cx + .15 + .7 * h1) * cw + sin(by * .22 + seed + t * .6) * .35 * (.5 + uFzIrreg);
      float rise = clamp((bot - by) / (bot - top), 0., 1.);
      float r = uFzSize * lr * (1. + uFzGrowth * .9 * rise) * (.8 + .4 * h1);
      float a = .8 * (.4 + .6 * h2) * (1. - smoothstep(bot - 10., bot - 1., by)) * smoothstep(top - .5, top + 4., by);
      fzBubble(c, lit, px, vec2(bx, by), r, a);
    }
  }
}

// trains of bubbles from fixed nucleation sites, accelerating gently and growing as they rise
void fzStreams(inout vec3 c, vec3 lit, vec2 px, float t, vec4 box, float top, float bot){
  float bw = box.z - box.x;
  for (int s = uZ; s < 12; s++){
    if (float(s) >= uFzStreams - .001) break;
    float sid = float(s) + 1.;
    float sx = box.x + 3. + (bw - 6.) * fract(sid * .618034 + .13 * fzH(sid * 5.1));   // golden-ratio spread, any count looks even
    if (abs(px.x - sx) > 7.5) continue;
    float sy = bot - 1.5 - 5. * fzH(sid * 8.9);
    float v0 = uFzSpeed * (7. + 4. * fzH(sid * 1.1)), acc = uFzSpeed * (2. + 2. * fzH(sid * 4.4));
    float per = 1. / (uFzRate * (.7 + .6 * fzH(sid * 3.7)));
    float k0 = floor(t / per);
    for (int k = uZ; k < 24; k++){
      float n = k0 - float(k);
      float te = n * per + per * uFzIrreg * .7 * (fzH2(vec2(n, sid)) - .5);
      float age = t - te;
      if (age < 0.) continue;
      float y = sy - (v0 * age + .5 * acc * age * age);
      if (y < top - 2.) break;
      float on = mix(1., smoothstep(.2, .45, fzN(vec2(te * .11 + sid * 7.1, sid))), uFzIrreg);      // trains pause and restart
      on *= step(uFzIrreg * .25, fzH2(vec2(n * 1.3, sid + .5)));                                   // single dropouts
      float dir = (fzN(vec2(te * .2, sid * 3.)) - .5) * 2. * uFzIrreg * .5;                      // this bubble's drift, px/s
      float x = sx + dir * age + (fzN(vec2(te * .17 + sid * 3., sid * 2.)) - .5) * uFzIrreg * 2.5
              + sin(age * 5. + n * 1.7) * (.15 + .25 * uFzIrreg);
      float rise = clamp((sy - y) / (sy - top), 0., 1.);
      float r = uFzSize * (.42 + uFzGrowth * .6 * rise) * (.85 + .3 * fzH2(vec2(n, sid + .5)));
      float a = on * (.75 + .25 * fzH2(vec2(sid, n * .37))) * smoothstep(0., .25, age) * smoothstep(top - 1., top + 2.5, y);
      fzBubble(c, lit, px, vec2(x, y), r, a);
    }
  }
}

// surface fizz: tiny bubbles arriving at the surface, lingering and popping, denser right under it, plus a faint film line
void fzSurface(inout vec3 c, vec3 lit, vec2 px, float t, float top){
  if (uFzSurf <= .001) return;
  float dy = px.y - top, H = max(uFzSurfH, 1.);
  if (dy < -1.5 || dy > H + 1.5) return;
  float line = exp(-pow((dy - .3) / .8, 2.)) * (.3 + .7 * fzN(vec2(px.x * .6, t * .35)));
  c = mix(c, lit, clamp(line * .4 * uFzSurf * uFzOpacity, 0., 1.));
  float cw = 2.4, chh = 1.5;
  vec2 cell = vec2(floor(px.x / cw), floor(dy / chh));
  for (int j = uZ - 1; j <= 1; j++) for (int i = uZ - 1; i <= 1; i++){
    vec2 q = cell + vec2(float(i), float(j));
    if (q.y < -1. || q.y * chh > H) continue;
    float life = .7 + 1.6 * fzH2(q + 3.7);
    float ph = t / life + fzH2(q);
    float cyc = floor(ph), f = fract(ph);
    float dens = uFzSurf * 1.1 * exp(-q.y * chh / (H * .75 + .5)) * mix(1., 2. * fzN(vec2(q.x * .25, q.y * .6 + t * .08)), uFzIrreg * .7);
    if (fzH2(q + cyc * 7.31) > dens) continue;
    vec2 b = vec2((q.x + .15 + .7 * fzH2(q + cyc * 1.7)) * cw, top + (q.y + .2 + .6 * fzH2(q + cyc * 3.3)) * chh);
    float r = uFzSize * (.4 + .12 * fzH2(q + cyc * 5.1));
    float a = (.55 + .45 * fzH2(q + cyc * 9.9)) * smoothstep(0., .2, f) * (1. - smoothstep(.72, 1., f));
    fzBubble(c, lit, px, b, r, a * 1.3);
    float pop = exp(-pow((f - .9) / .04, 2.));                                                   // a tiny glint as it pops
    c += vec3(.95, .82, .62) * pop * exp(-dot(px - b, px - b) / .35) * .1 * uFzHighlight * uFzOpacity;
  }
}

// bubbles clinging to the inside of the glass: grow slowly (tens of seconds), then let go; wall found from the mask
void fzCling(inout vec3 c, vec3 lit, vec2 px, float t, vec4 box, float top, float bot){
  if (uFzCling <= .001) return;
  for (int s = uZ; s < 20; s++){
    if (float(s) >= uFzCling * 14. - .001) break;
    float sid = float(s) + 1.;
    float per = 16. + 26. * fzH(sid * 2.9);
    float ph = t / per + fzH(sid * 6.1), cyc = floor(ph), f = fract(ph);
    float side = fzH2(vec2(sid, cyc)) < .5 ? -1. : 1.;
    float y = floor(top + 5. + (bot - top - 9.) * fzH2(vec2(cyc * 1.9, sid))) + .5;
    if (abs(px.y - y) > 3.) continue;
    float wx = side < 0. ? box.x - 3. : box.z + 3.;                                              // scan inward until the mask starts
    for (int i = uZ; i < 14; i++){ if (fzMask(vec2(floor(wx) + .5, y)) > .5) break; wx -= side; }
    float r = uFzSize * (.5 + .75 * pow(f, .55));
    vec2 b = vec2(wx - side * (r * .55 + .5), y + (fzH2(vec2(sid, cyc + .5)) - .5) * 1.5);
    float a = .95 * smoothstep(0., .08, f) * (1. - smoothstep(.96, 1., f));
    fzBubble(c, min(lit * 1.3 + vec3(.04, .025, .012), vec3(.9)), px, b, r, a);   // a touch lighter than the streams: the glass shows them
  }
}

// the whole effect: returns the new colour (already masked by \`mk\` and hidden under glass glare)
vec3 colaFizz(vec3 col, vec2 px, float t, vec4 box, float mk){
  if (mk < .01) return col;
  float top = max(box.y, uFzSurfY), bot = box.w - 1.;
  // bubble colour: the local cola pixel lightened (tint 1) or a pale amber (tint 0); fades out on bright glass highlights
  float lum = dot(col, vec3(.3, .55, .15));
  vec3 lit = mix(vec3(.8, .62, .44), col * 1.9 + vec3(.06, .035, .02), uFzTint);
  lit = mix(col, min(lit, vec3(.85)), 1. - smoothstep(.16, .48, lum));
  vec3 c = col;
  fzHaze(c, lit, px, t, top, bot);
  fzStreams(c, lit, px, t, box, top, bot);
  fzSurface(c, lit, px, t, top);
  fzCling(c, lit, px, t, box, top, bot);
  float glare = smoothstep(.42, .75, dot(col, vec3(.3, .55, .15)));
  return mix(col, c, mk * (1. - glare));
}

// ---- cane frost (tuned settings): feathery fern crystals on the ground and up the shaft over a thin patchy film,
// sparkles and faint cold mist. Everything is cut off by a bounding box first, so pixels elsewhere pay one compare.
float frCane(vec2 p){ return textureLod(uMasks, (p - MASK_O) / MASK_S, 0.).a; }   // cane alpha at source px
uniform float uFrSparkle;    // glints on the frost (0 = none)
uniform float uFrDensity;    // crystal density (how many crystals appear, how filled the patches are)
uniform float uFrOpacity;    // opacity / whiteness (above 1 the thin lines saturate to solid white)
uniform float uFrCaneReach;  // how far up the cane (px) the frost climbs
uniform float uFrReach;      // ground frost radius (px, along x)
const float uFrSparkSize = .7, uFrTwinkle = .8, uFrScale = 1., uFrCaneDens = .88, uFrGround = .88, uFrSpread = .94, uFrIrreg = 1., uFrGrow = .5, uFrMist = .3, uFrTint = .5, uFrFine = .8, uFrPersp = .38, uFrTop = 26., uFrSeed = 10., uFrFan = .5;

float frH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 frH2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .103, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float frN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(frH(i), frH(i + vec2(1, 0)), f.x), mix(frH(i + vec2(0, 1)), frH(i + vec2(1, 1)), f.x), f.y); }
float frFbm(vec2 p){ float v = 0., a = .5; for (int i = uZ; i < 3; i++){ v += a * frN(p); p = p * 2.03 + 17.1; a *= .5; } return v * 1.143; }
vec2 frRot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// thin branching veins (ridged, domain-warped noise) in a frame where q.x runs across the streaks and q.y along them
float frVeins(vec2 q, float sc, vec2 wamp){
  q += (vec2(frN(q * .6 + 2.1), frN(q * .6 + 9.3)) - .5) * wamp;
  float v = 0., a = .6;
  for (int i = uZ; i < 3; i++){ v += a * (1. - abs(2. * frN(q * sc) - 1.)); q = q * 2.07 + 3.3; a *= .55; }
  return pow(clamp(v * 1.05, 0., 1.), 4.);
}
// ground frost cover (0..1) at isotropic plane coordinates pp (origin = cane foot)
float frCoverG(vec2 pp){
  float rr = length(pp) / max(uFrReach, 1.);
  float n = frFbm(pp * .05 + uFrSeed * 1.37);
  float core = 1. - smoothstep(.3, 1., rr + (n - .5) * uFrIrreg * 1.3);
  float sp = clamp(uFrSpread, 0., 2.);
  float isl = smoothstep(.48, .7, frFbm(pp * .03 + 9.1 + uFrSeed)) * (1. - smoothstep(.65, .75 + 1.2 * sp, rr + (n - .5) * uFrIrreg * .6));
  return clamp(core + isl * .9 * min(sp, 1.), 0., 1.);
}
// cane frost cover at (cx across, h height above the foot)
float frCoverC(float h, float cx){
  float n = frFbm(vec2(cx * .17, h * .05) + uFrSeed * 2.1);
  return 1. - smoothstep(.12, 1., h / max(uFrCaneReach, 1.) + (n - .5) * uFrIrreg * .9);
}

// One layer of feather crystals. Each 3x3 cell owns one: origin, direction (ground: away from the foot; cane: up the shaft),
// length, a tapered outline, a stem and chevron branch lines swept toward the growth direction.
// returns vec3(lines, veil, tipGlint)
vec3 frLayer(vec2 p, float cs, float perK, float seed, float mode, float t, float amt){
  vec2 ci = floor(p / cs);
  vec3 r = vec3(0.);
  for (int j = uZ - 1; j <= 1; j++) for (int i = uZ - 1; i <= 1; i++){
    vec2 id = ci + vec2(float(i), float(j));
    vec2 hh = frH2(id + seed);
    vec2 c = (id + .5 + .6 * (hh - .5)) * cs;                  // crystal centre
    float cover = mode < .5 ? frCoverG(c) : frCoverC(c.y, c.x);
    float gate = frH(id * 1.7 + seed + 5.3);
    float pres = smoothstep(gate - .1, gate + .1, cover * amt);
    if (pres <= 0.) continue;
    vec2 dir0 = mode < .5 ? (dot(c, c) > 1. ? normalize(c) : vec2(1., 0.)) : vec2(0., 1.);
    float jit = (frH(id + seed + 9.1) - .5) * (.5 + 2.2 * uFrFan) * (mode < .5 ? 1.2 : .8);
    vec2 dir = frRot(dir0, jit), nrm = vec2(-dir.y, dir.x);
    float L = cs * (1. + .55 * frH(id + seed + 2.2));
    float Lc = L * (1. - uFrGrow * .3 * (.5 + .5 * sin(t * .23 + frH(id + seed + 4.) * 6.283)));
    vec2 d = p - c;
    float u = dot(d, dir) + .5 * Lc, v = dot(d, nrm);          // u runs 0..Lc from the root to the tip
    float tt = u / Lc;
    if (tt < -.05 || tt > 1.) continue;
    float taper = 1. - tt;
    float per = max(cs * perK, .9);
    float hw = Lc * .23 * pow(max(taper, .001), .8) + .5;
    float dist = abs(fract((u - abs(v) * 1.05) / per + .5) - .5) * per * .7;
    float lw = .06 + .16 * taper;
    float brk = smoothstep(.15, .5, frN(p * (.9 / cs * 8.) + id));   // lacy breaks in the branches
    float line = (1. - smoothstep(lw, lw + .45, dist)) * mix(1., brk, .7);
    float inside = 1. - smoothstep(hw * .6, hw, abs(v));
    float stem = 1. - smoothstep(.1, .55 + .3 * taper, abs(v));
    float shape = smoothstep(-.05, .06, tt) * (1. - smoothstep(.85, 1., tt));
    float li = max(stem * (.7 + .3 * taper), line * inside * (.6 + .4 * taper)) * shape * pres;
    r.x = max(r.x, li);
    r.y = max(r.y, inside * shape * pres * (.4 + .6 * brk));
    r.z = max(r.z, stem * exp(-pow((tt - .96) / .06, 2.)) * pres);
  }
  return r;
}
// the three crystal sizes of the ground (mode 0) or the shaft (mode 1), in a loop so the compiler keeps one copy of frLayer: (lines, veil, tip glint)
vec3 frLayers(vec2 p, float mode, float t, float amt){
  float fk = min(uFrFine, 1.); vec3 r = vec3(0.);
  for (int L = uZ; L < 3; L++){
    float a = L == 0 ? 1. : (L == 1 ? .85 : 1.2);
    vec3 c = mode < .5
      ? frLayer(p + (L == 0 ? 0. : (L == 1 ? 17. : 31.)), (L == 0 ? 14. : (L == 1 ? 8.5 : 4.8)) * uFrScale, L == 0 ? .18 : (L == 1 ? .2 : .22), uFrSeed + (L == 0 ? 0. : (L == 1 ? 5. : 17.)), 0., t, amt * a)
      : frLayer(p + (L == 0 ? 0. : (L == 1 ? 7. : 13.)), (L == 0 ? 10. : (L == 1 ? 6. : 3.4)) * uFrScale, L == 0 ? .26 : (L == 1 ? .3 : .26), uFrSeed + (L == 0 ? 40. : (L == 1 ? 44. : 57.)), 1., t, amt * a);
    vec3 k = mode < .5 ? (L == 0 ? vec3(1.) : (L == 1 ? vec3(.9, .8, .7) : vec3(.8 * fk, .6 * fk, .5))) : (L == 0 ? vec3(1., .5, 1.) : (L == 1 ? vec3(.9, .4, .7) : vec3(.75 * fk, .5 * fk, .5)));
    r = max(r, c * k);
  }
  return r;
}
vec3 caneFrost(vec3 col, vec2 px, float t, vec3 tip){
  if (uFrOpacity <= 0.) return col;
  vec2 dq = px - tip.xy;
  float h = -dq.y, Rg = uFrReach, Rc = uFrCaneReach;
  if (abs(dq.x) > Rg * 1.4 + 34. || h > max(Rc, uFrTop) + 16. || dq.y > Rg * uFrPersp * 1.5 + 22.) return col;
  float ca = frCane(px);
  float lum = dot(col, vec3(.3, .55, .15));
  float green = smoothstep(.012, .08, col.g - max(col.r, col.b));         // no frost on foliage
  vec3 fcol = mix(vec3(.975, .985, 1.), vec3(.72, .87, 1.), uFrTint);
  vec3 shade = fcol * (.84 + .26 * lum);
  float aG = 0., aC = 0., fv = 0., gl = 0.;

  // ---- faint cold mist: low over the foot, thin rising wisp along the shaft (behind the cane)
  if (uFrMist > 0.){
    vec2 mq = (dq + vec2(4., -2.)) / vec2(Rg * 1.25 + 24., 20. + .1 * Rg);
    float mist = exp(-dot(mq, mq)) * smoothstep(.3, .72, frFbm(px * vec2(.032, .08) + vec2(t * .05, -t * .012)));
    float hh = max(h, 0.);
    float sw = (frFbm(vec2(hh * .02 - t * .15, 2.)) - .5) * 20. * (hh / 120.);
    float wisp = exp(-pow((dq.x + .12 * h - sw) / (7. + .12 * hh), 2.)) * smoothstep(-6., 4., h) * (1. - smoothstep(.4 * Rc, Rc * .9 + 10., h))
               * smoothstep(.36, .76, frFbm(vec2(px.x * .06, px.y * .04 + t * .12)));
    float fog = clamp((mist * .8 + wisp * .5) * uFrMist * .45, 0., .55);
    col = mix(col, mix(vec3(.88, .93, 1.), vec3(.78, .89, 1.), uFrTint), fog * (1. - ca));
  }

  // ---- ground frost: crystals radiating from the foot over a thin patchy film (plane coordinates, y un-squashed)
  float gm = smoothstep(-uFrTop - 5., -uFrTop + 4., dq.y);
  if (gm > 0. && Rg > 1. && uFrGround > 0.){
    vec2 pp = vec2(dq.x, (dq.y + 1.) / uFrPersp);
    pp += (vec2(frN(pp * .07 + 1.7), frN(pp * .07 + 8.3)) - .5) * 10. * uFrIrreg;
    vec3 cr = frLayers(pp, 0., t, uFrDensity);
    float lines = cr.x, veil = cr.y;
    float cv = frCoverG(pp);
    float fn = frFbm(pp * .13 + uFrSeed);
    float rad = length(pp), ang = atan(-pp.x, pp.y);                 // angle around the foot, seam straight up (hidden behind the cane)
    float vn = frVeins(vec2(ang * 11., rad * .05), 1. / max(uFrScale, .3), vec2(2.5, .35));
    float film = cv * (.1 + .9 * vn) * (.55 + .45 * smoothstep(.55, 1., cv)) * clamp(uFrDensity, 0., 1.);
    aG = (lines * .68 + veil * (.04 + .08 * fn) + film * .62) * uFrGround * gm * (1. - ca) * (1. - green);
    fv = max(fv, lines * (1. - green) * gm); gl = max(gl, cr.z);
  }

  // ---- cane frost: chevron crystals climbing the shaft, a rime coat, a fuzz past the edge, brighter edges
  if (Rc > 1. && uFrCaneDens > 0. && h > -6. && h < Rc + 12. && abs(dq.x + .12 * h) < 15.){
    float hs = max(h, 0.);
    vec2 cp = vec2(dq.x + .12 * hs, hs);
    float haloC = max(max(frCane(px + vec2(1.8, 0.)), frCane(px - vec2(1.8, 0.))), max(frCane(px + vec2(0., 1.8)), frCane(px - vec2(0., 1.8))));
    float mC = max(ca, .6 * haloC);
    if (mC > .01){
      float ad = uFrDensity * uFrCaneDens;
      vec3 cr = frLayers(cp, 1., t, ad);
      float lines = cr.x, veil = cr.y;
      float cov = frCoverC(h, cp.x);
      float streak = frVeins(vec2(cp.x * 1.4, cp.y * .12) + uFrSeed, 1. / max(uFrScale, .3), vec2(1.2, .3));      // rime veins along the shaft
      float edge = clamp(ca - min(frCane(px + vec2(1.6, 0.)), frCane(px - vec2(1.6, 0.))), 0., 1.);
      float dn = clamp(uFrDensity, 0., 1.);
      aC = (lines * .75 + veil * .12 + cov * (.1 + streak * .5) * dn + edge * cov * .35 * dn) * uFrCaneDens * mC;
      fv = max(fv, lines * mC); gl = max(gl, cr.z * mC);
    }
  }

  float a = clamp(max(aG, aC) * uFrOpacity, 0., 1.);
  col = mix(col, shade, a);

  // ---- sparkles (0 = off): small glints, only where there is frost and mostly on the crystal lines
  if (uFrSparkle > 0.){
    float cs = 3. * uFrSparkSize;
    vec2 cid = floor(px / cs); float hc = frH(cid + 3.7);
    vec2 cp2 = (cid + .25 + .5 * frH2(cid + 1.3)) * cs, dd = px - cp2;
    float tw = pow(.5 + .5 * sin(t * uFrTwinkle * (.8 + 1.6 * hc) + hc * 50.), 7.);
    float r2 = .3 * uFrSparkSize * uFrSparkSize;
    float spark = exp(-dot(dd, dd) / r2) + .4 * (exp(-dd.y * dd.y / (.05 * r2)) * exp(-dd.x * dd.x / (6. * r2)) + exp(-dd.x * dd.x / (.05 * r2)) * exp(-dd.y * dd.y / (6. * r2)));
    float on = step(1. - clamp(uFrSparkle * .15, 0., 1.), hc);
    float where = smoothstep(.25, .8, max(fv, gl)) * smoothstep(.1, .4, a);
    col += vec3(.88, .95, 1.) * clamp(on * tw * spark, 0., 1.) * where * (.6 + .15 * uFrSparkle);
  }
  return col;
}

// cold vapour at the frosted cane (user: "not just fog on the ground, like cold smoke"). Cold air sinks: a thin wispy
// sheet slides down the frosted shaft and spills outward over the rock in slow billows, and two slow curls of
// vapour lift off the shaft like smoke. Returns vec2(alpha behind the cane, alpha that may also veil the cane).
vec2 coldSmoke(vec2 px, float t, vec2 tip, float amt){
  vec2 dq = px - tip;
  if (amt <= 0. || abs(dq.x) > 190. || dq.y < -170. || dq.y > 55.) return vec2(0.);
  float h = -dq.y;
  // sheet sliding down the shaft (the cane leans: x = tip.x - .12 h); its pattern descends at ~10 px/s
  float cx = dq.x + .12 * max(h, 0.);
  float w = 3.5 + 9. * (1. - smoothstep(0., 45., h));
  float wob = sin(h * .09 + t * .8) * .9 + (fbm(vec2(h * .05 + t * .3, 3.)) - .5) * 4.;
  float envS = exp(-pow((cx - wob) / w, 2.)) * (1. - smoothstep(30., 58., h)) * smoothstep(-8., 2., h);
  float nS = fbm(vec2(cx * .22 + 7., h * .09 + t * .9));
  float sheet = envS * smoothstep(.34, .62, nS);
  // spill over the rock plane, rolling outward (~6 px/s) with slowly curling billows
  vec2 g = vec2(dq.x, (dq.y + 2.) / .38);
  float r = length(g);
  vec2 dir = g / max(r, 1.);
  vec2 wq = vec2(fbm(g * .02 + vec2(t * .04, 1.)), fbm(g * .02 + vec2(5., -t * .04))) - .5;
  float n1 = fbm(g * .045 - dir * t * .27 + wq * 2.2);
  float n2 = fbm(g * .09 - dir * t * .5 + wq * 3. + 11.);
  float billow = smoothstep(.33, .62, n1) * (.5 + .5 * smoothstep(.3, .62, n2));
  float spill = exp(-pow(r / 95., 2.) * 1.2) * billow * smoothstep(-24., -10., dq.y) * (.5 + .5 * smoothstep(4., 22., r));
  // two slow curls lifting off the frosted shaft, drifting apart and thinning
  float curls = 0.;
  for (int i = uZ; i < 2; i++){
    float fi = float(i), h0 = 8. + 20. * fi, x0 = -.12 * h0;
    float hh = h - h0;
    if (hh < -4. || hh > 110.) continue;
    float k = clamp(hh / 110., 0., 1.);
    float side = fi < .5 ? -1. : 1.;
    float sw = sin(hh * .06 - t * .55 + fi * 2.1) * 14. * k + (fbm(vec2(hh * .025 - t * .18, fi * 5.)) - .5) * 34. * k + side * 26. * k * k;
    float wd = 2.5 + 16. * k;
    float strand = exp(-pow((dq.x - x0 - sw) / wd, 2.)) * smoothstep(-4., 10., hh) * (1. - smoothstep(.45, 1., k));
    curls += strand * smoothstep(.3, .6, fbm(vec2(dq.x * .07 + fi * 4., hh * .045 - t * .35))) * (1. - .5 * k);
  }
  float behind = clamp((spill * .75 + curls * .55) * amt, 0., .7);
  float veil = clamp(sheet * .6 * amt, 0., .55);
  return vec2(behind, veil);
}

// ---- distant waves (the tuned settings baked in): four layers on the finished water colour: ripples, swell, glitter
// bands, gust patches. Everything lives in ground-plane coordinates (perspective-correct: fine and dense at the horizon, wide and slow in front).
// depth envelope of one layer: cut-off at 'reach', eased down to 'nearGain' over the lower part of the water
float dwEnv(float reach, float nearGain, float d){
  return (1. - smoothstep(reach * 1.2 - .16, reach * 1.2, d)) * mix(1., nearGain, smoothstep(.35, 1., d)); }
// glitter lives mostly in the sun path (a column that widens toward the viewer)
float dwSun(vec2 uv, float d){
  float wd = .22 * mix(.45, 1.4, d), on = exp(-pow((uv.x - .3) / wd, 2.));
  return mix(1., .12 + .88 * on, .33); }
// grid weights by depth: x tiny (far), y medium, z large (near)
vec3 dwLod(float d){ float w0 = 1. - smoothstep(.3, .55, d), w2 = smoothstep(.62, .88, d); return vec3(w0, max(0., 1. - w0 - w2), w2); }
// compact soft sprite: |dd| = 1 at the support edge (so a sprite never reaches the edge of its grid cell)
float dwSprite(vec2 dd){ float r2 = dot(dd, dd); return exp(-4.5 * r2) * (1. - smoothstep(.45, 1., r2)); }

// glitter bands: drifting patches (ground plane) that hold tiny twinkling flecks
float dwGlitter(vec2 px, vec2 mq, float tg, vec3 lod, out float band){
  band = smoothstep(.5, .82, noise(vec2(mq.x * 1.8 + tg * .03, mq.y * 3. + tg * .1)));
  if (band < .01) return 0.;
  float g = 0.;
  for (int L = uZ; L < 3; L++){
    float lw = L == 0 ? lod.x : (L == 1 ? lod.y : lod.z);
    if (lw < .01) continue;
    vec2 csz = vec2(4.6, 3.) * pow(1.9, float(L)) * .74, cell = floor(px / csz);
    float hc = hq(cell + 17.3 + 31. * float(L));
    if (hc < .8875) continue;
    vec2 dd = (px / csz - (cell + .3 + .4 * hq2(cell + 1. + 7. * float(L)))) / .3;
    float tw = pow(.5 + .5 * sin(tg * (2. + 3. * hc) + hc * 60.), 10.);
    g += lw * tw * dwSprite(dd);
  }
  return g * band; }

vec3 waterDetail(vec3 cx, vec2 px, vec2 uv, float shore, float amount){
  float hor = uHorA + uHorB * uv.x;
  float dh = px.y - hor * TEX.y;                                          // px below the horizon line (the horizon itself stays still)
  float base = smoothstep(1.5, 7., dh) * smoothstep(.02, .25, shore) * amount;
  if (base < .001) return cx;
  float zf = min(uZK / max(uv.y - hor, .6 / TEX.y), 80.);
  vec2 qf = vec2((uv.x - .5) * IA * zf, zf);                              // ground-plane coordinates
  float d = clamp(log(14. / zf) / 2.862, 0., 1.);
  float gz = zf * zf / (uZK * TEX.y);                                     // d zf / d source-py: phase gradient in rad/px = frequency * gz
  float dhs = max(dh, 6.);
  vec2 mq = vec2((px.x - 836.) / dhs, log(dhs) * 1.7);                  // self-similar mask coordinates: features grow in proportion to the distance below the horizon
  float shade = 0.; vec3 lit = vec3(0.);

  // ---- gust patches: slow dark ruffled patches (cat's paws) drifting over the water; they also rough up the ripples
  float eG = dwEnv(1., 1.88, d) * .6 * base;
  float gm = smoothstep(.45, .8, fbm(mq * vec2(1., 1.6) * .95 + vec2(uDwClk.w * .04, uDwClk.w * .05) + 5.));
  shade -= gm * .12 * eG;
  float rough = 1. + min(eG, 1.) * (gm - .35) * 1.2;

  // ---- ripples: fine lines in four octaves (wavelengths 4x apart), each faded where its lines would alias or turn into bands
  float eR = dwEnv(.88, .46, d) * .74 * base;
  if (eR > .001){
    float tr = uDwClk.x, rs = 0., rw = 0.;
    for (int o = uZ; o < 4; o++){
      float F = 34. * exp2(-2. * float(o)), gr = F * gz;
      float wo = smoothstep(.05, .14, gr) * (1. - smoothstep(1.1, 2.4, gr));
      if (wo < .01) continue;
      float s = F / 34.; vec2 nq = qf * s;
      float ph = F * zf + sqrt(s) * .9 * tr + (noise(nq * vec2(2.2, 3.) + float(o) * 9.1) - .5) * 5. + noise(vec2(nq.x * .7 - tr * .03, nq.y) + float(o) * 4.3) * 2.;
      float m = smoothstep(.28, .6, noise(vec2(nq.x * 1.4 + tr * .03, nq.y * 1.6) + float(o) * 6.7));
      rs += wo * sin(ph) * m; rw += wo;
    }
    float rip = clamp(rs / max(1., rw * .75), -1., 1.), eRr = eR * rough;   // gusts scale the amplitude, never the crest shape
    shade += rip * .11 * eRr;
    float nz = smoothstep(.45, .95, d);                                    // near water: the broad wavelets keep only thin, weaker highlight lines
    lit += vec3(.75, .9, 1.) * pow(max(rip, 0.), 3.5 * (1. + 2.5 * nz)) * .2 * eRr * (1. - .4 * nz) * uGlint;   // ripple highlights read as glints: they follow the Glints slider
  }

  // ---- swell: broad slow shading bands, three octaves, slightly oblique
  float eS = dwEnv(1., .6, d) * .81 * base;
  if (eS > .001){
    float ts = uDwClk.y, ss = 0., sw = 0.;
    for (int o = uZ; o < 3; o++){
      float K = 11. * pow(.38, float(o)), gr = K * gz;
      float wo = smoothstep(.006, .02, gr) * (1. - smoothstep(.8, 1.8, gr));
      if (wo < .01) continue;
      float ph = K * (zf + .12 * qf.x) + sqrt(K / 4.2) * .2 * ts + (noise(vec2(qf.x * .5 * K / 4.2, ts * .02 + float(o) * 3.)) - .5) * 4.5;
      float am = .3 + .9 * smoothstep(.25, .75, noise(mq * vec2(1.6, 2.6) + vec2(ts * .02, float(o) * 7.3)));   // swell comes in patches, not in strict stripes
      ss += wo * sin(ph) * am; sw += wo;
    }
    shade += ss / max(1., sw * .8) * .07 * eS;
  }

  // ---- glitter bands
  float eT = dwEnv(1., .39, d) * .81 * base;
  if (eT > .001){
    float band, gl = dwGlitter(px, mq, uDwClk.z, dwLod(d), band);
    lit += vec3(1., .97, .88) * gl * 1.1 * eT * dwSun(uv, d) * uGlint;   // the flecks follow the Glints slider (1 = 50)
    shade += band * .04 * eT;
  }

  cx *= 1. + clamp(shade, -.3, .3);                                       // multiplicative: swell, ripple troughs, patches
  cx += (1. - cx) * (1. - exp(-1.4 * lit));                               // additive light, soft-saturating (never clips)
  return cx;
}

// ---- looping clouds: a painted RGBA strip, REPEAT in S, drifting one way. The mid layer is mirrored and starts half a strip away so the same
// shape is never in both at once; the near layer goes over it. Level 0 always (the strip wraps, a computed mip level would show the seam).
vec4 clTex(vec2 px, float phase, float sc, float yb, float off, float flip){
  vec2 L = uCldTexSize * sc;
  float u = (px.x - phase) / L.x;  if (flip > .5) u = 1. - u;
  u += off;
  float v = 1. - (yb - px.y) / L.y;
  if (v < 0. || v > 1.) return vec4(0.);
  vec4 c = textureLod(uCldTex, vec2(u, v), 0.);
  c.a *= smoothstep(0., 12. / L.y, v) * (1. - smoothstep(1. - 12. / L.y, 1., v));   // no clamp-edge stripe
  return c;
}
vec3 skyClouds(vec3 sky, vec2 px){
  vec4 c = clTex(px, uCldPh.y, uCldSc.y, 114.5, .5, 1.);   // mid: base row 113 + 1.5, slightly lower, hugging the horizon
  sky = mix(sky, c.rgb, clamp(c.a * .9, 0., 1.));
  c = clTex(px, uCldPh.x, uCldSc.x, 113., 0., 0.);
  return mix(sky, c.rgb, clamp(c.a, 0., 1.));
}

// foreground matte over the clouds (map-b.r), stored only above the horizon. Everything below the horizon is foreground, so those texels
// (and the last row above the line) count as 1 whatever the channel holds there (a plain bilinear tap let the cloud
// strip through as white dashes along the horizon line behind the jungle).
float mtTexel(vec2 q){
  float hy = (uHorA + uHorB * (q.x + .5) / TEX.x) * TEX.y;
  return q.y + .5 > hy - 1. ? 1. : texelFetch(uMapB, ivec2(clamp(q, vec2(0.), TEX - 1.)), 0).r; }
float skyMatte(vec2 px){
  vec2 c = px - .5, i = floor(c), f = c - i;
  return mix(mix(mtTexel(i), mtTexel(i + vec2(1., 0.)), f.x), mix(mtTexel(i + vec2(0., 1.)), mtTexel(i + vec2(1., 1.)), f.x), f.y); }

void main(){
  vec2 s = vec2(gl_FragCoord.x / uRes.x, 1. - gl_FragCoord.y / uRes.y);
  vec2 uv = coverUV(s), px = uv * TEX; float t = uT;
  vec3 col = texture(uPlate, uv).rgb;
  vec4 MA = texture(uMapA, uv);
  int fl = int(texelFetch(uMapA, ivec2(clamp(px, vec2(0.), TEX - 1.)), 0).b * 255. + .5);
  // moving pieces own these spots (they never overlap): 1 bandana, 2 vest + straw hat, 3 Chopper's hat, 4 tangerine leaves, 5 map corner, 6 sling band
  int zone = fl & 7; bool cloth = (fl & 64) != 0;
  // ---- clouds over the clear sky, then the foreground over them through the matte
  if (uv.y < uHorA + uHorB * uv.x){
    float m = skyMatte(px);
    if (m < .999) col = mix(skyClouds(texture(uSky, vec2(uv.x, uv.y * SKY_K)).rgb, px), col, m);
  }
  float w = MA.r, shoreD = MA.g;
  if (w > .003){
    float lt = uWT;
    float hor = uHorA + uHorB * uv.x;
    float z = min(uZK / max(uv.y - hor, .004), 14.); float hzF = 1. - smoothstep(3., 7.5, z);   // A1: the horizon is in frame, so detail fades earlier than on the veranda
    vec2 p = vec2((uv.x - .5) * IA * z, z) * 10.5;
    float shore = shoreD, farFade = smoothstep(1.4, 2.9, z);
    vec3 w0 = field(p, lt);
    p += vec2(cos(p.x * 1.3 + p.y * 1.1 - lt * 1.2), sin(-p.x * .8 + p.y * 1.7 - lt * 1.5)) * .055 * hzF; // mesh orbit
    vec3 wv = field(p, lt) * hzF; vec2 flow = wv.yz;
    // light refraction of the seabed plate (small; lagoon-layered kept its bottom still)
    vec2 off = vec2(flow.x / (z * IA), -flow.y / (z * z)) * .0016 * mix(.3, 1., shore);
    vec2 uo = uv + off;
    vec3 bed = texture(uUnder, vec2(uo.x, (uo.y - UNDER_Y0) / (UNDER_Y1 - UNDER_Y0))).rgb;
    vec2 a = p * .095 + vec2(-lt * .027, lt * .019) + flow * .046;
    vec2 b = mat2(.8, -.6, .6, .8) * p * .123 + vec2(lt * .018, -lt * .024) - flow * .039 + vec2(.37, .21);
    // intersect independent moving light fields, rather than blending whole exposed frames
    float l1 = lightF(a), l2 = lightF(b);
    float caustic = pow(max(0., l1 * l2), .58) * (1. - .55 * farFade) * hzF;
    float broad = .5 + .5 * sin(p.x * 1.3 + p.y * .9 - lt * 1.4 + wv.x * 4.);
    vec3 c = bed * (1. - .08 + .035 * broad);
    c += vec3(.36, .43, .25) * caustic * .85;
    // extra caustics: a sharp churning cel web on the near and mid water
    if (uCrisp > 0.){
      // extra caustics moved too fast at first; their own clock and the flow they ride run at 70 %
      float tc = uCrClk.x * .7; vec2 flowC = (field(p, uCrClk.y * .7) * hzF).yz;
      vec2 P = vec2((uv.x - .5) * IA * z, z) * 3.;
      vec2 cw = P * (10. / 1.8) + flowC * 1.6 / 1.8 + vec2(fbm(P * 1.1 + tc * .05), fbm(P * 1.1 - 3.1 - tc * .04)) * 2.2;
      cw += (vec2(noise(cw * .45 + tc * .08), noise(cw * .45 + 9.2 - tc * .07)) - .5) * .75;
      float wgt = smoothstep(.25, .75, fbm(P * 1.7 + vec2(-tc * .03, tc * .02)));
      vec2 cw2 = mat2(.87, -.5, .5, .87) * cw * 1.31 + 7.3;
      float fw1 = length(fwidth(cw)), fw2 = length(fwidth(cw2));
      float netFade = (1. - smoothstep(1.5, 2.6, z)) * smoothstep(.0, .15, shore) * uCrisp * .85;
      if (netFade > 0.){
      float cell = cellEdge(cw, tc * .55);
      float w1 = 1. - smoothstep((.012 + .05 * wgt) * 1.28 * .35, (.012 + .05 * wgt) * 1.28 + fw1 * 1.2, cell), w2 = 1. - smoothstep((.008 + .022 * wgt) * 1.28 * .35, (.008 + .022 * wgt) * 1.28 + fw2 * 1.2, cellEdge(cw2, tc * .47 + 2.));
      float net = clamp(w1 * (.45 + .55 * wgt) + w1 * w2 * .5, 0., 1.);
      c += vec3(.21, .25, .18) * net * netFade;
      c = mix(c, vec3(.97, 1., .93), net * net * .3 * netFade);
      c *= 1. - .07 * smoothstep(.05, .35, cell) * netFade;

      }
    }
    // the painting's own caustic web, drifting with the flow
    c = mix(c, vec3(.94, 1., .93), texture(uMapB, uv + off * 3.).b * .3);
    vec3 norm = normalize(vec3(-w0.yz * hzF, 1.));
    vec3 n = normalize(mix(vec3(0, 0, 1), norm, .7) + vec3(-flow * .65, 0));
    vec3 sun = normalize(vec3(-.32, .48, 1.));
    float diffuse = dot(n, sun), refl = smoothstep(.76, .98, diffuse);
    c = mix(c, vec3(.12, .56, .64), .035 + .085 * (1. - diffuse));
    c += vec3(.10, .20, .18) * refl * .19;
    float glint = pow(max(0., dot(n, normalize(vec3(-.22, .33, 1.)))), 90.);
    c += vec3(.75, .91, .77) * glint * .25 * (uGlint < 1. ? uGlint : 1. + .3 * (uGlint - 1.));   // sun highlight follows the Glints slider (1 = 50; gentler above)
    c = mix(c, vec3(.62, .86, .96), farFade * .07);   // far sky sheen (reduced: A1 keeps its deep blue far sea)
    // generated transparent foam: two continuous spatial passes with local crest breakup
    vec2 fuv = p * .063 + vec2(-lt * .012, lt * .017) + flow * .02;
    float f = texture(uFoam, fuv).r, f2 = texture(uFoam, p * .089 + vec2(lt * .007, -lt * .011) + vec2(.6, .1) - flow * .023).r;
    float breakup = smoothstep(-.09, .14, wv.x + .07 * sin(p.x * 3.2 - p.y * 2.6 - lt * 1.7));
    float fa = (f * .25 + f2 * .09) * breakup * hzF;
    // plus a soft lapping edge where water meets rocks and sand
    float lap = .5 + .5 * sin(lt * 2.2 - shore * 10. + f * 4.);
    fa += (1. - smoothstep(.0, .04 + .07 * lap, shore)) * (.25 + .5 * f2) * .45;
    c = mix(c, vec3(.9, .97, .84), clamp(fa, 0., 1.) * (1. - .4 * farFade));
    // sun glints: sparse twinkles that sit on wave crests, denser toward the far water
    if (uGlint > 0.){
      vec2 q = vec2((uv.x - .5) * IA * z, z) * 3.;
      float sp = noise(q * 26. + t * vec2(.8, -.5)) * noise(q * 39. - t * .7);
      float gk = uGlint;                                   // Glints slider: 1 = approved, 2 = more and brighter, 0 = off
      float g = gk * smoothstep(.62 - .07 * (gk - 1.), .86 - .05 * (gk - 1.), sp) * smoothstep(.4, .8, fbm(q * .8 + t * .05)) * (.12 + .88 * farFade) * hzF * smoothstep(.0, .12, shore);
      c += vec3(1., .98, .9) * g * .45;
    }
    // slow cloud shadows drifting across the water only, on the same drift as the clouds (still when the clouds are still)
    c *= 1. - smoothstep(.48, .78, fbm(uv * vec2(2.2, 3.6) + vec2(-1., .4) * (uCldSh / 1672. * 2.2))) * .10;
    // A1 looks much further out than the veranda: past the mid lagoon the image layers would shrink into haze,
    // so the painting itself (its own painted web and deep-blue far sea) takes over, wobbling with the same flow
    float texF = 1. - smoothstep(uTexFade.x, uTexFade.y, z);
    // far sea: the painted ripples shimmer by a fraction of a pixel (nothing moves near shores or rocks)
    vec2 fo = vec2(sin(uv.x * IA * z * 38. + t * .9 + sin(z * 23. + t * .45)), sin(z * 51. - t * 1.05 + uv.x * 31.))
            * vec2(.7, .4) / TEX * smoothstep(.02, .3, shore) * (1. - texF) * min(uGlint, 1.);   // the painted flecks shimmer only as far as the Glints slider allows (0 = painting holds still; 50 and up unchanged)
    c = mix(texture(uPlate, uv + off * 2. + fo).rgb, c, texF);
    col = mix(col, c, w);
    // ---- distant waves: ripples, swell, glitter bands and gust patches (the Waves slider scales their strength)
    if (uWaves > .001) col += (waterDetail(c, px, uv, shore, uWaves) - c) * w;
  }
  // ---- cut-out plants: drawn into the layer before this pass, premultiplied, same pixel grid as the canvas. Barrel, table, chair and props stay in front
  ivec2 lq = ivec2(gl_FragCoord.xy);
  vec4 Pq = lq.y < uLayerRows ? texelFetch(uLayer, lq, 0) : vec4(0.);
  col = col * (1. - Pq.a * (1. - MA.a)) + Pq.rgb * (1. - MA.a);
  // ---- wind: vest, then the straw hat over it, and the bandana (tied on the katana)
  if (cloth){
    if (zone == 2){ vec3 c0 = col;
      vec2 sq = px * 2. - SHADE_O;
      if (sq.x > 0. && sq.y > 0. && sq.x < SHADE_S.x && sq.y < SHADE_S.y){ vec4 Sh = textureLod(uVest, sq / VEST_TEX, 0.); col = mix(col, Sh.rgb, Sh.a); }   // vest-fix v2: the vest's cast shade is STATIC, only the cloth moves
      vec4 V = vestTex(vestSrc(px, t)); col = mix(col, V.rgb, V.a);
      col = mix(col, c0, vestPost(px)); }   // the post is static and in front: the vest is never drawn over it
    vec2 cs = zone == 1 ? bandSrc(px, t) : (zone == 2 ? hatSrc(px, t) : (zone == 3 ? chopSrc(px, t) : (zone == 4 ? leafSrc(px, t) : (zone == 5 ? mapSrc(px, t) : slingSrc(px, t)))));
    vec4 Cc = texture(uCloth, (cs - CLOTH_O) / CLOTH_S);
    col = mix(col, Cc.rgb, Cc.a * (zone == 4 && (fl & 8) != 0 ? 0. : 1.));    // the ashtray and cane stay in front of the bandana
  }
  vec4 XA = vec4(0.);
  if (px.x > MASK_O.x && px.y > MASK_O.y && px.x < MASK_O.x + MASK_S.x && px.y < MASK_O.y + MASK_S.y) XA = textureLod(uMasks, (px - MASK_O) / MASK_S, 0.);
  // ---- lens shine: a thin bright line crosses each pair's lenses now and then (lens pixels only)
  if (uShine > 0. && XA.b > .01){
    bool cat = px.x > 1012.;
    float ph = mod(t + (cat ? 7.3 : 0.), 16.);
    float local = px.x - (cat ? 1021. : 943.) + (px.y - (cat ? 581. : 558.)) * .75;
    float line = exp(-pow((local - (ph * 62. - 18.)) / 2.4, 2.)) * step(ph, 1.9);
    float sheen = .045 * (.5 + .5 * sin(t * .6 + px.x * .02));
    col += (cat ? vec3(.85, .92, 1.) : vec3(1., .95, .82)) * (line * (cat ? .55 : .42) + sheen) * XA.b * uShine;
  }
  // ---- cola fizz
  if (uFzOpacity > 0. && XA.g > .01) col = colaFizz(col, px, t, uCola, XA.g);
  // ---- Log Pose: each glass dome twinkles in turn, plus a slow sheen sweep
  if (uShine > 0. && XA.r + step(abs(px.x - 800.), 40.) * step(abs(px.y - 685.), 40.) > 0.){
    for (int i = uZ; i < 3; i++){
      vec2 ci = i == 0 ? uDome1.xy : (i == 1 ? uDome1.zw : uDome2.xy);
      float id = float(i), ph = mod(t * .9 + id * 3.1, 9.3);
      float f = smoothstep(0., .25, ph) * (1. - smoothstep(.35, 1.1, ph));
      vec2 d = px - ci - vec2(-.3, -.32) * uDome2.z;
      vec2 dr = rot(d, .5);
      float star = exp(-dot(d, d) / 1.1) + .7 * (exp(-abs(dr.x) / .45) * exp(-dr.y * dr.y / 9.) + exp(-abs(dr.y) / .45) * exp(-dr.x * dr.x / 9.));
      col += vec3(1., 1., .93) * star * f * .75 * smoothstep(7., 3., length(d)) * uShine;
    }
    float sweep = exp(-pow((px.x - 780. + (px.y - 668.) * .6 - mod(t * 6., 120.) + 10.) / 2.5, 2.));
    col += vec3(.9, 1., .95) * sweep * .22 * XA.r * step(px.x, 899.) * uShine;
  }
  // ---- frost at Brook's cane: feathery crystals on the ground and up the shaft, sparkles and fog by slider
  col = caneFrost(col, px, t, uTip);
  if (uVapour > 0.){
    vec2 cs2 = coldSmoke(px, t, uTip.xy, uVapour);
    if (cs2.x + cs2.y > 0.){
      float caf = frCane(px);
      col = mix(col, vec3(.92, .96, 1.), clamp(cs2.x * (1. - caf) + cs2.y * (1. - .45 * caf), 0., .75));
    }
  }
  // ---- a thin cigarette wisp from the ashtray on the barrel
  vec2 q = (px - uSmoke) / (vec2(40., 130.) * vec2(mix(1., uSmokeK, .6), uSmokeK));
  if (uSmokeA > 0. && q.y < .03 && q.y > -1.2 && abs(q.x) < 1.6){
    float h = -q.y;
    // a thin rising strand: curls with height, leans with the breeze, breaks up and fades as it widens
    float lean = .5 * h * h * (.6 + .4 * gust(t));
    float wob = sin(h * 6.5 - t * 1.25) * .38 * h + (fbm(vec2(h * 2.2 - t * .32, t * .07)) - .5) * 1.5 * h + lean;
    float wid = .028 + .2 * h;
    float d = exp(-pow((q.x - wob) / wid, 2.));
    float br = smoothstep(.28, .72, fbm(vec2(q.x * 4. + 3., h * 3.5 - t * .8)));
    float al = d * mix(1., br, smoothstep(.05, .35, h)) * smoothstep(0., .04 / uSmokeK, h) * (1. - smoothstep(.45, 1.1, h)) * mix(.42 - .18 * h, .62 - .26 * h, clamp(uSmokeK - 1., 0., 1.)) * mix(1., 1.25, clamp(uSmokeK - 1., 0., 1.));
    col = mix(col, vec3(.94, .94, .92), clamp(al * uSmokeA, 0., 1.));
  }
  o = vec4(col, 1.);
}`;

// Start-up: frost, cold vapour and cola were about 2.3 of the 3 s this shader took to compile, and CEF keeps no shader cache, so that was at every start.
// They are cut out of it and link as small programs of their own, at the same time as this one. If they aren't ready for the first frame, the poster is held
// over their spots until they are. study.live: something draws. study.ready: all the effects draw, so every frame from then on is the real one.
const PAR = gl.getExtension('KHR_parallel_shader_compile');
const BASE_CUTS = [['col = caneFrost(col, px, t, uTip);', ''], ['vec2 cs2 = coldSmoke(px, t, uTip.xy, uVapour);', 'vec2 cs2 = vec2(0.);'], ['if (uFzOpacity > 0. && XA.g > .01) col = colaFizz(col, px, t, uCola, XA.g);', '']];
function startLink(fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); gl.deleteShader(s); }
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); return p;
}
function whenLinked(p, go) { if (gl.isContextLost()) return; if (!PAR || gl.getProgramParameter(p, PAR.COMPLETION_STATUS_KHR)) go(); else setTimeout(() => whenLinked(p, go), 25); }   // a timer: animation frames don't fire while WE hides the page
const base = startLink(BASE_CUTS.reduce((src, [a, b]) => { if (!src.includes(a)) throw new Error('base shader: ' + a); return src.replace(a, b); }, FS));
// The three left-out effects: frost + vapour at the cane, cola at the glass. Each draws over the finished picture on its own
// small rectangle: that rectangle is copied out of the canvas, the program reads the copy as its starting colour and writes the new colour back.
const FS_HEAD = FS.slice(0, FS.indexOf('void main(){'));
const FX_MAIN = body => `
uniform sampler2D uCopy; uniform ivec2 uOrg;
void main(){
  vec2 s = vec2(gl_FragCoord.x / uRes.x, 1. - gl_FragCoord.y / uRes.y);
  vec2 uv = coverUV(s), px = uv * TEX; float t = uT;
  vec3 col = texelFetch(uCopy, ivec2(gl_FragCoord.xy) - uOrg, 0).rgb;
  vec4 XA = vec4(0.);
  if (px.x > MASK_O.x && px.y > MASK_O.y && px.x < MASK_O.x + MASK_S.x && px.y < MASK_O.y + MASK_S.y) XA = textureLod(uMasks, (px - MASK_O) / MASK_S, 0.);
${body}
  o = vec4(col, 1.);
}`;
const FX = [
  { name: 'cane', src: FS_HEAD + FX_MAIN(`  col = caneFrost(col, px, t, uTip);
  if (uVapour > 0.){
    vec2 cs2 = coldSmoke(px, t, uTip.xy, uVapour);
    if (cs2.x + cs2.y > 0.){
      float caf = frCane(px);
      col = mix(col, vec3(.92, .96, 1.), clamp(cs2.x * (1. - caf) + cs2.y * (1. - .45 * caf), 0., .75));
    }
  }`), box: [280, 645, 672, 890], on: () => S.frost > 0 },
  { name: 'cola', src: FS_HEAD + FX_MAIN(`  if (uFzOpacity > 0. && XA.g > .01) col = colaFizz(col, px, t, uCola, XA.g);`), box: [1040, 514, 1084, 598], on: () => S.cola > 0 },
];
const COPY_UNIT = 15;   // the poster's unit too: whichever draws next binds its own
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
let prog = null, uni = {};
function fxLink() { for (const f of FX) { f.p = startLink(f.src); f.ready = false; f.uni = {}; f.tex = null; f.ver = 0; } }
function fxAdopt(f) {
  const p = f.p; if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return; }
  gl.useProgram(p);
  for (const n of ['uRes', 'uT', 'uFocus', 'uOrg', 'uVapour', ...FZ_U.map(x => x[1]), 'uFrSparkle', 'uFrDensity', 'uFrOpacity', 'uFrCaneReach', 'uFrReach']) f.uni[n] = gl.getUniformLocation(p, n);
  for (const [n] of TEX) if (!n.startsWith('fol:')) gl.uniform1i(gl.getUniformLocation(p, n), UNIT[n]);
  gl.uniform1i(gl.getUniformLocation(p, 'uCopy'), COPY_UNIT);
  f.ready = true; f.ver = 0;
}
let fxVer = 1;   // bumped whenever a slider or the size changes
function fxPush(f) {   // the sliders the effect programs read
  const U = f.uni, c = S.frost / 50;
  gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform1f(U.uFocus, S.focus);
  if (f.name === 'cane') {
    gl.uniform1f(U.uFrSparkle, 3 * S.frost / 100);
    gl.uniform1f(U.uFrOpacity, 1.05 * Math.min(c, 1) + .35 * Math.max(0, c - 1));
    gl.uniform1f(U.uFrReach, 56 * (.75 + .25 * c));
    gl.uniform1f(U.uFrCaneReach, 39 * (.75 + .25 * c));
    gl.uniform1f(U.uFrDensity, 1.35 * (.85 + .15 * c));
    gl.uniform1f(U.uVapour, .6 * S.frost / 100 * 1.6);
  } else for (const [k, u] of FZ_U) gl.uniform1f(U[u], colaParam(k));
}
// canvas rectangle (x, y from the bottom, w, h) that source-px box b covers at the current size and framing
function fxRect(b) {
  const w = canvas.width, h = canvas.height, A = w / h, IA = 1672 / 941, ys = [b[1] / 941, b[3] / 941], xs = [b[0] / 1672, b[2] / 1672];
  let sx, sy;
  if (A > IA) { const hf = .5 * IA / A, f = Math.min(Math.max(S.focus, hf), 1 - hf); sx = xs; sy = ys.map(v => (v - f) * A / IA + .5); }
  else { sx = xs.map(v => (v - .5) * IA / A + .5); sy = ys; }
  const x0 = Math.max(0, Math.floor(sx[0] * w) - 2), x1 = Math.min(w, Math.ceil(sx[1] * w) + 2);
  const y0 = Math.max(0, Math.floor((1 - sy[1]) * h) - 2), y1 = Math.min(h, Math.ceil((1 - sy[0]) * h) + 2);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}
function fxDraw() {
  for (const f of FX) {
    if (!f.ready || !f.on()) continue;
    const r = fxRect(f.box); if (!r) continue;
    gl.activeTexture(gl.TEXTURE0 + COPY_UNIT);
    if (!f.tex || f.tex.w < r[2] || f.tex.h < r[3]) {
      if (f.tex) gl.deleteTexture(f.tex.t);
      f.tex = { t: gl.createTexture(), w: r[2], h: r[3] }; gl.bindTexture(gl.TEXTURE_2D, f.tex.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, r[2], r[3], 0, gl.RGB, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    } else gl.bindTexture(gl.TEXTURE_2D, f.tex.t);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, r[0], r[1], r[2], r[3]);
    gl.useProgram(f.p);
    if (f.ver !== fxVer) { fxPush(f); f.ver = fxVer; }
    gl.uniform1f(f.uni.uT, S.time); gl.uniform2i(f.uni.uOrg, r[0], r[1]);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(r[0], r[1], r[2], r[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }
}
function adopt(p) {
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
  prog = p; gl.useProgram(p); uni = {};
  for (const n of ['uRes', 'uT', 'uWT', 'uFocus', 'uGlint', 'uWaves', 'uCrisp', 'uShine', 'uMotion', 'uSmokeK', 'uSmokeA', 'uVapour', 'uCldPh', 'uCldSh', 'uDwClk', 'uCrClk', 'uLayerRows', ...FZ_U.map(f => f[1]), 'uFrSparkle', 'uFrDensity', 'uFrOpacity', 'uFrCaneReach', 'uFrReach']) uni[n] = gl.getUniformLocation(p, n);
  for (const [n, , ] of TEX) if (!n.startsWith('fol:')) gl.uniform1i(gl.getUniformLocation(p, n), UNIT[n]);
  stale = true;
}
// the poster over the spots of effects still linking, faded away once they draw. Cane and vapour: source px around the cane's foot (only the plants move there, and they stay live). Cola: the glass.
const COVER_FS = `#version 300 es
precision highp float;
uniform sampler2D uPoster, uLayer; uniform vec2 uRes; uniform float uFocus, uK; uniform vec4 uCane, uGlass; uniform int uRows;
out vec4 o;
const vec2 TEX = vec2(1672., 941.);
const float IA = 1672. / 941., PA = 16. / 9., PF = .56;   // the poster: 2560x1440 at the default focus
vec2 coverUV(vec2 s){ float A = uRes.x / uRes.y; vec2 uv = s;
  if (A > IA){ float half_ = .5 * IA / A; uv.y = (s.y - .5) * IA / A + clamp(uFocus, half_, 1. - half_); }
  else uv.x = (s.x - .5) * A / IA + .5;
  return uv; }
float box(vec2 p, vec4 b){ vec2 d = max(b.xy - p, p - b.zw); return 1. - smoothstep(-12., 0., max(d.x, d.y)); }
void main(){
  vec2 uv = coverUV(vec2(gl_FragCoord.x / uRes.x, 1. - gl_FragCoord.y / uRes.y)), px = uv * TEX;
  float h = .5 * IA / PA;
  o = vec4(texture(uPoster, vec2(uv.x, (uv.y - clamp(PF, h, 1. - h)) * PA / IA + .5)).rgb, max(box(px, uCane), box(px, uGlass)) * uK * (1. - (int(gl_FragCoord.y) < uRows ? texelFetch(uLayer, ivec2(gl_FragCoord.xy), 0).a : 0.)));   // the plants stay live
}`;
let cover = null;
const COVER_P = PAR ? startLink(COVER_FS) : null;   // links in the background from the start
let posterTex = null;
function posterUp(img) {
  gl.activeTexture(gl.TEXTURE0 + TEX.length); posterTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, posterTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
}
function coverStart() {
  const unit = TEX.length, tex = posterTex;
  const p = COVER_P, L = n => gl.getUniformLocation(p, n);
  gl.useProgram(p); gl.uniform1i(L('uPoster'), unit); gl.uniform1i(L('uLayer'), UNIT.uLayer);
  cover = { tex, p, fadeFrom: 0, uRes: L('uRes'), uFocus: L('uFocus'), uK: L('uK'), uCane: L('uCane'), uGlass: L('uGlass'), uRows: L('uRows') };
}
function coverDrop() { if (cover) { gl.deleteTexture(cover.tex); gl.deleteProgram(cover.p); cover = null; } }
function coverDraw() {
  const k = cover.fadeFrom ? 1 - (performance.now() - cover.fadeFrom) / 700 : 1;
  if (k <= 0) { coverDrop(); return; }
  gl.activeTexture(gl.TEXTURE0 + COPY_UNIT); gl.bindTexture(gl.TEXTURE_2D, cover.tex);
  gl.useProgram(cover.p); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1i(cover.uRows, fol.rows); gl.uniform2f(cover.uRes, canvas.width, canvas.height); gl.uniform1f(cover.uFocus, S.focus); gl.uniform1f(cover.uK, k);
  gl.uniform4f(cover.uCane, S.frost > 0 ? 347 : 0, S.frost > 0 ? 640 : 0, S.frost > 0 ? 607 : 0, S.frost > 0 ? 885 : 0);
  gl.uniform4f(cover.uGlass, S.cola > 0 ? 1043 : 0, S.cola > 0 ? 518 : 0, S.cola > 0 ? 1079 : 0, S.cola > 0 ? 593 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.BLEND);
}

// one texture unit each, for good. mip: painted art is shrunk on 1080p/1440p screens, mipmaps keep it from aliasing and halve the cost.
// red: one channel in memory. wrap: 2 = the cloud strip (repeats along its length), 1 = the mirrored water layers.
const TEX = [['uPlate', 'scene/plate.webp', { mip: 1 }], ['uSky', 'scene/sky.webp', { mip: 1 }], ['uUnder', 'scene/under.webp', { mip: 1 }], ['uMapA', 'scene/map-a.webp'], ['uMapB', 'scene/map-b.webp'],
  ['uLayer', null], ['uCldTex', 'scene/clouds.webp', { wrap: 2 }], ['uLight', 'scene/light.webp', { mip: 1, red: 1, wrap: 1 }], ['uFoam', 'scene/foam.webp', { mip: 1, red: 1, wrap: 1 }],
  ['uVest', 'scene/vest.webp'], ['uCloth', 'scene/cloth.webp', { mip: 1 }], ['uMasks', 'scene/masks.webp'],
  ['fol:plants', 'scene/plants.webp', { mip: 1 }], ['fol:label', 'scene/labels.webp'], ['fol:table', 'scene/foliage-table.png']];   // the last three: foliage pass only
const UNIT = Object.fromEntries(TEX.map((t, i) => [t[0], i]));
const BUST = window.BUST || '';   // set by index.html on localhost only (no stale cached textures in the local preview)
function load(src) { return new Promise((ok, no) => { const i = new Image(); i.onerror = () => no(new Error(src)); i.src = src + BUST; i.decode().then(() => ok(i), () => no(new Error(src))); }); }   // decode off the main thread
function upload(i, img, o = {}) {
  gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const mx = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (img.width > mx) { const c = document.createElement('canvas'); c.width = mx; c.height = Math.max(1, Math.round(img.height * mx / img.width)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); img = c; }   // the cloud strip on GPUs with a tiny max texture size
  if (o.red) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  const wrap = o.wrap ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.wrap === 2 ? gl.REPEAT : wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.wrap === 2 ? gl.CLAMP_TO_EDGE : wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (o.mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
}
const SOURCES = TEX.filter(t => t[1]);
fxLink();
Promise.all([...SOURCES.map(t => load(t[1]).then(img => { upload(UNIT[t[0]], img, t[2]); return img; })), PAR ? load('poster.jpg').then(posterUp, () => {}) : null, new Promise(ok => whenLinked(base, ok))]).then(imgs => {
  folInit(imgs[SOURCES.findIndex(t => t[0] === 'fol:table')].height);
  if (!gl.getProgramParameter(base, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(base)); return; }   // keep the poster rather than a black canvas
  adopt(base);
  if (PAR && FX.every(f => gl.getProgramParameter(f.p, PAR.COMPLETION_STATUS_KHR))) {   // everything is linked already: no poster hold needed
    for (const f of FX) fxAdopt(f);
    S.ready = true; gl.deleteTexture(posterTex); gl.deleteProgram(COVER_P);
  } else if (PAR) {
    if (posterTex) coverStart();
    const pend = new Set(FX);
    for (const f of FX) whenLinked(f.p, () => { fxAdopt(f); pend.delete(f); if (!pend.size) { S.ready = true; if (cover) cover.fadeFrom = performance.now(); } });
  } else { for (const f of FX) fxAdopt(f); S.ready = true; }
  S.live = true; resize(); syncPlayback();
  // index.html shows poster.jpg (this first frame) during the shader compile: fade the live canvas in over it, then drop it
  canvas.style.opacity = 1;
  canvas.addEventListener('transitionend', () => { document.documentElement.style.backgroundImage = 'none'; }, { once: true });
}).catch(e => console.error('asset load failed', e));

// looping clouds: one slider, near-layer speed grows with the square of cloudDrift (slider 0 = still, 50 = cloudDrift 35 = about 2 source px/s, 100 = 16 px/s)
// Phases are integrated (dt * speed) and wrapped at the strip period of each layer, so the slider never makes the clouds jump and they only ever move one way.
const CLD_W = 7768, CLD_SC = [.55, .55 * .844], CLD_K = [1, .79];   // strip length, layer scales, relative speeds
const cloudPx = () => 4 * Math.pow(S.cloudDrift / 50, 2);   // near-layer speed, source px per second
function cloudPeriod(i) { return CLD_W * CLD_SC[i]; }
function cloudAdvance(dt) {
  const v = cloudPx() * dt;
  for (let i = 0; i < 2; i++) S.cloudPh[i] = (S.cloudPh[i] + v * CLD_K[i]) % cloudPeriod(i);
  S.cloudSh += v;
}
// one cola slider: 50 = the tuned settings (FZ), 0 = off, 100 = about twice as lively (more streams, haze and surface fizz)
function colaParam(k) {
  const c = S.cola / 50;
  if (k === 'streams') return FZ.streams * c;
  if (k === 'rate') return FZ.rate * (.6 + .4 * c);
  if (k === 'haze') return FZ.haze * c;
  if (k === 'opacity') return Math.min(.9, FZ.opacity * Math.sqrt(c));
  return FZ.surf * Math.pow(c, .8);
}
// one frost slider: 50 = the tuned settings, 0 off, 100 whiter and wider; sparkles and cold vapour follow it
function pushFrost() {
  const c = S.frost / 50;
  gl.uniform1f(uni.uFrSparkle, 3 * S.frost / 100);
  gl.uniform1f(uni.uFrOpacity, 1.05 * Math.min(c, 1) + .35 * Math.max(0, c - 1));
  gl.uniform1f(uni.uFrReach, 56 * (.75 + .25 * c));
  gl.uniform1f(uni.uFrCaneReach, 39 * (.75 + .25 * c));
  gl.uniform1f(uni.uFrDensity, 1.35 * (.85 + .15 * c));
  gl.uniform1f(uni.uVapour, .6 * S.frost / 100 * 1.6);   // 0-60 of the old fog scale
}
// ============================================================================================================
// Foliage pass. The cut-out plants are rendered into an offscreen RGBA8 layer (premultiplied) the size of the canvas before the main pass.
// Every leaf / blade / flower is a piece that rotates about its own base pivot, and the angle grows toward the tip, so long leaves curve a little.
// Pieces: labels.webp (piece id per source pixel) + foliage-table.png (one row per piece: bounding box, pivot, axis, length, height weight ...).
// Draw order = id order (pivots lower on screen are drawn later). Beneath the pieces an "underlay" (the opaque interior of the plants shifted by
// the same smooth field) shows through the slivers that open up between pieces, so no leaf ever reveals the plain filled plate behind it.
// ============================================================================================================
const FOL_COMMON = `
const vec2 TEX = vec2(1672., 941.);
const float IA = 1672. / 941.;
const float PLANT_Y0 = 328.;   // plants.webp and labels.webp start at this source row
const float SWAY_PX = 2.4, ROT_RAD = .06, FLUTTER = .3, WAVE_K = .0085, JITTER = 1., LEN_K = 30., BEND95 = .3804;
uniform vec4 uFol;    // t, amp (plants slider), wind on, focus
uniform vec2 uVp;     // layer size in px
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float gust(float t){ return .35 + .65 * smoothstep(.15, .85, .5 + .5 * sin(t * .21) * sin(t * .13 + 1.)); }
vec2 breeze(float t){
  float p1 = mod(t + 31., 37.), p2 = mod(t + 30., 53.);
  float e1 = smoothstep(0., 1.4, p1) * exp(-max(0., p1 - 1.4) / 2.6);
  float e2 = .75 * smoothstep(0., 1.4, p2) * exp(-max(0., p2 - 1.4) / 2.6);
  return e1 >= e2 ? vec2(e1, p1) : vec2(e2, p2); }
// travelling wave: one gust front crosses the whole picture, so neighbouring leaves are nearly in phase
float wph(vec2 p){ return dot(p, vec2(1., .42)) * WAVE_K; }
// smooth, low-frequency sway of a branch / clump in source px per unit height weight
vec2 swayField(vec2 p, float t){
  float w = wph(p), g = gust(t + p.x * .0015);
  float s = (sin(t * 1.12 - w) + .3 * sin(t * 2.63 - 1.9 * w + 1.)) * g;
  return vec2(s, .1 * s + .12 * sin(t * 1.47 - 1.3 * w) * g); }
vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// framebuffer pixel -> source px, and back to clip space
vec2 fragToSrc(vec2 fc){
  vec2 s = vec2(fc.x / uVp.x, 1. - fc.y / uVp.y);
  float A = uVp.x / uVp.y; vec2 uv = s;
  if (A > IA){ float half_ = .5 * IA / A; uv.y = (s.y - .5) * IA / A + clamp(uFol.w, half_, 1. - half_); }
  else uv.x = (s.x - .5) * A / IA + .5;
  return uv * TEX; }
vec2 srcToClip(vec2 p){
  vec2 s;
  float A = uVp.x / uVp.y; vec2 uv = p / TEX;
  if (A > IA){ float half_ = .5 * IA / A; s = vec2(uv.x, (uv.y - clamp(uFol.w, half_, 1. - half_)) * A / IA + .5); }
  else s = vec2((uv.x - .5) * IA / A + .5, uv.y);
  return vec2(s.x * 2. - 1., 1. - 2. * s.y); }
vec2 plantUV(vec2 p){ return vec2(p.x / TEX.x, (p.y - PLANT_Y0) / (TEX.y - PLANT_Y0)); }
`;
const FOL_VS_CORE = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uTable;
${FOL_COMMON}
flat out int vId; out vec2 vSrc; out float vShade;
const int G = 6;
float tf(int col){ vec4 v = texelFetch(uTable, ivec2(col, gl_InstanceID), 0); return (v.r * 255. * 256. + v.g * 255.) / 65535.; }
vec2 gridVert(int vid){
  int cell = vid / 6, k = vid - cell * 6;
  int cx = cell - (cell / G) * G, cy = cell / G;
  ivec2 c = k == 0 ? ivec2(0, 0) : k == 1 ? ivec2(1, 0) : k == 2 ? ivec2(0, 1) : k == 3 ? ivec2(1, 0) : k == 4 ? ivec2(1, 1) : ivec2(0, 1);
  return vec2(float(cx + c.x), float(cy + c.y)) / float(G); }
void main(){
  float t = uFol.x, amp = uFol.y;
  vec2 box0 = vec2(tf(0), tf(1)) * 8191.875, boxS = vec2(tf(2), tf(3)) * 8191.875;
  vec2 pv = vec2(tf(4), tf(5)) * 8191.875;
  vec2 axis = vec2(tf(6), tf(7)) * 2. - 1.;
  float L = tf(8) * 1023.98, hw = tf(9) * 2., hr = tf(14) * 2., kind = tf(10) * 8., seed = tf(11);   // hw: sway weight (0 where the pivot sits on the ground), hr: swing weight
  float wf = uFol.z > .5 ? 1. + .5 * breeze(t).x : 1.;
  vec2 b = breeze(t);
  // translation of the pivot: the smooth branch sway, weighted by how high the base sits above the ground
  vec2 Tr = swayField(pv, t) * SWAY_PX * hw * amp * wf;
  // rotation: slow sway (wave phase + per-leaf jitter) and a faster rustle that only wakes in gusts
  float g = gust(t + pv.x * .0015);
  float ph = wph(pv) + (noise(pv * .011 + 5.) - .5) * JITTER * 2.5 + (seed - .5) * .5;   // gust front + smooth patchy offset + a touch per leaf
  float f = sin(t * 1.25 - ph) + .4 * sin(t * 2.6 - 1.7 * ph + 1.);                       // the same two slow frequencies everywhere: neighbours stay in step
  float r = sin(t * (3.6 + 2.8 * fract(seed * 11.9)) - ph * 2.3 + seed * 17.);          // faster rustle, per leaf
  float side = 1. - 2. * smoothstep(.2, .6, axis.y);          // a leaf that points down swings the other way
  float th = ROT_RAD / (1. + L / LEN_K) * pow(hr, .8) * (f * g + FLUTTER * r * g * g * (1. + 1.5 * b.x)) * side * amp * wf * (kind > 1.5 ? 1.25 : 1.);
  vec2 q = box0 - 2. + gridVert(gl_VertexID) * (boxS + 4.);
  vec2 rel = q - pv;
  float u = clamp(dot(rel, axis) / max(L, 1.), 0., 1.);
  float a = th * (.5 + 1.1 * u * u);
  vec2 p = pv + rot(rel, a) + Tr;
  gl_Position = vec4(srcToClip(p), 0., 1.);
  vSrc = q; vId = gl_InstanceID + 1;
  vShade = 1. - .05 * clamp(-th * 2.5, 0., 1.);   // swinging one way a leaf dims by at most 5 %; never brighter than the painting, 1 at rest, independent of amplitude
}`;
const FOL_FS_CORE = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uSrc, uLabel;
${FOL_COMMON}
flat in int vId; in vec2 vSrc; in float vShade;
out vec4 o;
float idEq(ivec2 p){ vec4 L = texelFetch(uLabel, clamp(p - ivec2(0, int(PLANT_Y0)), ivec2(0), ivec2(1671, 612)), 0); return int(L.r * 255. + .5) + 256 * int(L.g * 255. + .5) == vId ? 1. : 0.; }
void main(){
  vec4 C = texture(uSrc, plantUV(vSrc));
  vec2 f = vSrc - .5; ivec2 i0 = ivec2(floor(f)); vec2 w = f - floor(f);
  float m = mix(mix(idEq(i0), idEq(i0 + ivec2(1, 0)), w.x), mix(idEq(i0 + ivec2(0, 1)), idEq(i0 + ivec2(1, 1)), w.x), w.y);
  float a = C.a * m;
  o = vec4(min(C.rgb * vShade, vec3(1.)) * a, a);
}`;
const FOL_VS_UNDER = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const FOL_FS_UNDER = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D uSrc, uBend, uLabel;
${FOL_COMMON}
out vec4 o;
vec4 plantAt(vec2 p){ return texture(uSrc, plantUV(p)); }
void main(){
  vec2 px = fragToSrc(gl_FragCoord.xy), uv = px / TEX;
  float t = uFol.x, amp = uFol.y;
  float wf = uFol.z > .5 ? 1. + .5 * breeze(t).x : 1.;
  float B = texture(uBend, uv).g;     // plant bend / 8
  float rw = texelFetch(uLabel, clamp(ivec2(floor(px)) - ivec2(0, int(PLANT_Y0)), ivec2(0), ivec2(1671, 612)), 0).b;     // root weight: 0 at the ground contact, 1 from 60 px above it
  vec2 src = px - swayField(px, t) * SWAY_PX * clamp(B / BEND95, 0., 1.6) * rw * amp * wf;
  vec4 C = plantAt(src);
  float a = min(C.a, min(min(plantAt(src + vec2(1.6, 0.)).a, plantAt(src - vec2(1.6, 0.)).a), min(plantAt(src + vec2(0., 1.6)).a, plantAt(src - vec2(0., 1.6)).a)));
  a = smoothstep(.92, 1., a);
  o = vec4(C.rgb * a, a);
}`;

// the two foliage programs start linking as the script loads, in the background; folCreate picks them up once the images are in
const FOL_PRE = new Map();
function folStart(vs, fs) {
  if (FOL_PRE.has(fs)) return FOL_PRE.get(fs);
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(p, s); gl.deleteShader(s); }
  gl.linkProgram(p); FOL_PRE.set(fs, p); return p;
}
folStart(FOL_VS_CORE, FOL_FS_CORE); folStart(FOL_VS_UNDER, FOL_FS_UNDER);
function folCreate(n) {
  const link = (vs, fs) => { const p = folStart(vs, fs); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); throw new Error('foliage link'); } return p; };
  const progC = link(FOL_VS_CORE, FOL_FS_CORE), progU = link(FOL_VS_UNDER, FOL_FS_UNDER);
  const set1 = (p, name, unit) => gl.uniform1i(gl.getUniformLocation(p, name), unit);
  gl.useProgram(progC); set1(progC, 'uSrc', UNIT['fol:plants']); set1(progC, 'uLabel', UNIT['fol:label']); set1(progC, 'uTable', UNIT['fol:table']);
  gl.useProgram(progU); set1(progU, 'uSrc', UNIT['fol:plants']); set1(progU, 'uLabel', UNIT['fol:label']); set1(progU, 'uBend', UNIT.uMapB);
  const locs = { C: {}, U: {} };
  for (const k of ['uFol', 'uVp']) { locs.C[k] = gl.getUniformLocation(progC, k); locs.U[k] = gl.getUniformLocation(progU, k); }
  const vao = gl.createVertexArray();
  const P = { tex: null, fbo: null, w: 0, h: 0 };
  P.size = (w, h, rows) => {
    if (P.w === w && P.h === h && P.rows === rows && P.tex) return;
    if (P.tex) gl.deleteTexture(P.tex); if (P.fbo) gl.deleteFramebuffer(P.fbo);
    P.tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + UNIT.uLayer); gl.bindTexture(gl.TEXTURE_2D, P.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    P.fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, P.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, P.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    P.w = w; P.h = h; P.rows = rows;
  };
  P.draw = (t, amp, wind, focus) => {
    const w = P.w, h = P.h, A = w / h, IA = 1672 / 941;
    gl.bindFramebuffer(gl.FRAMEBUFFER, P.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    // nothing above the plants' top (source row 335, less the furthest a leaf swings): no need to run the underlay's six texture reads there
    let sTop = 275 / 941;
    if (A > IA) { const hf = .5 * IA / A; sTop = (sTop - Math.min(Math.max(focus, hf), 1 - hf)) * A / IA + .5; }
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, w, Math.min(h, Math.ceil((1 - Math.max(0, sTop)) * h)));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    const set = (prog, L) => { gl.useProgram(prog); gl.uniform4f(L.uFol, t, amp, wind, focus); gl.uniform2f(L.uVp, w, h); };
    set(progU, locs.U); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (n > 0) { set(progC, locs.C); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6 * 6 * 6, n); }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  return P;
}
let fol = null;
function folInit(nPieces) { fol = folCreate(nPieces); }
function foliageFrame() {
  const w = canvas.width, h = canvas.height, A = w / h, IA = 1672 / 941;
  let sTop = 275 / 941;   // nothing above the plants' top (source row 335 less the furthest a leaf swings)
  if (A > IA) { const hf = .5 * IA / A; sTop = (sTop - Math.min(Math.max(S.focus, hf), 1 - hf)) * A / IA + .5; }
  fol.size(w, h, Math.min(h, Math.ceil((1 - Math.max(0, sTop)) * h)));
  fol.draw(S.time, S.plantAmount / 50 * 1.52, S.windAmount > 0 ? 1 : 0, S.focus);
}

// Motion has two sliders (the single motion slider moved far too much): Wind (vest, straw hat, bandana, Chopper's hat, tangerine leaves,
// map corner, slingshot band) and Plants. 0 = still, 50 = the tuned default, 100 = the old maximum.
let stale = true;   // the uniforms below only change with a slider or the canvas size
function pushSettings() {
  const w = S.windAmount, sm = S.smokeAmount / 100;   // one smoke slider: 0 off, 100 = the old size slider at 70 % (size 2.75)
  gl.uniform2f(uni.uRes, canvas.width, canvas.height); gl.uniform1f(uni.uFocus, S.focus);
  gl.uniform1f(uni.uMotion, w <= 50 ? 1.52 * w / 50 : 1.52 + 2.48 * (w - 50) / 50);
  gl.uniform1f(uni.uGlint, S.glintAmount / 50); gl.uniform1f(uni.uWaves, S.waves / 50);   // 50 = the tuned settings, 100 = double
  gl.uniform1f(uni.uCrisp, S.crispStrength); gl.uniform1f(uni.uShine, S.shine / 5);
  gl.uniform1f(uni.uSmokeK, 1 + 1.75 * sm); gl.uniform1f(uni.uSmokeA, Math.min(1, sm / .2));
  for (const [k, u] of FZ_U) gl.uniform1f(uni[u], colaParam(k));
  pushFrost();
  gl.uniform1i(uni.uLayerRows, fol.rows); fxVer++; stale = false;
}
function render() {
  if (!S.live) return;
  foliageFrame(); gl.useProgram(prog);
  if (stale) pushSettings();
  gl.uniform1f(uni.uT, S.time); gl.uniform1f(uni.uWT, S.wtime);
  gl.uniform2f(uni.uCldPh, S.cloudPh[0], S.cloudPh[1]); gl.uniform1f(uni.uCldSh, S.cloudSh);
  gl.uniform4f(uni.uDwClk, S.dwClock[0], S.dwClock[1], S.dwClock[2], S.dwClock[3]);
  gl.uniform2f(uni.uCrClk, S.crClock[0], S.crClock[1]);
  gl.viewport(0, 0, canvas.width, canvas.height); gl.drawArrays(gl.TRIANGLES, 0, 3);
  fxDraw();
  if (cover) coverDraw();
  S.frames++;
}
// screen pixels, not CSS pixels: with Windows display scaling (or browser zoom) innerWidth is smaller than the screen and
// the canvas got stretched up, so the wallpaper looked soft (2026-10-28). Ratio capped at 2 to bound the cost.
function resize() { const k = S.scale * Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(innerWidth * k)); canvas.height = Math.max(1, Math.round(innerHeight * k)); stale = true; render(); }
addEventListener('resize', resize);

// Keep FPS remainder separate from animation time; pause reasons are independent.
let last = 0, acc = 0, pending = 0, raf = null;
let hostPaused = false, userPaused = false;
function syncPlayback() {
  const paused = hostPaused || userPaused || document.hidden;
  const running = S.live && !paused;
  S.paused = paused;
  if (!running) {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null; acc = 0; pending = 0;
  } else if (raf === null) {
    last = performance.now(); acc = 0; pending = 0;
    raf = requestAnimationFrame(tick);
  }
}
function tick(now) {
  raf = null;
  if (S.paused || !S.live) return;
  const dt = Math.max(0, Math.min(.1, (now - last) / 1000)); last = now;
  acc += dt; pending += dt;
  const interval = 1 / S.fps;
  if (acc + 1e-6 >= interval) {
    const elapsed = pending; pending = 0; acc = Math.max(0, acc - interval);
    S.time += elapsed; S.wtime += elapsed * .12;
    cloudAdvance(elapsed);
    for (let i = 0; i < 4; i++) S.dwClock[i] += elapsed * DW_SPEED[i];
    S.crClock[0] += elapsed * S.crispSpeed; S.crClock[1] += elapsed * S.crispSpeed * .12;
    render();
  }
  raf = requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', syncPlayback);

// Host properties use new integer keys; defaults reproduce the selected source exactly.
const PROPERTY_MAP = {
  "waveamount": {
    "target": "waves",
    "lo": 0,
    "mid": 50,
    "hi": 100
  },
  "sunglints": {
    "target": "glintAmount",
    "lo": 0,
    "mid": 50,
    "hi": 100
  },
  "extracaustics": {
    "target": "crispStrength",
    "lo": 0,
    "mid": 0.55,
    "hi": 1.2
  },
  "causticspeed": {
    "target": "crispSpeed",
    "lo": 0,
    "mid": 1,
    "hi": 2
  },
  "propwind": {
    "target": "windAmount",
    "lo": 0,
    "mid": 50,
    "hi": 100
  },
  "plantsway": {
    "target": "plantAmount",
    "lo": 0,
    "mid": 50,
    "hi": 100
  },
  "smokelevel": {
    "target": "smokeAmount",
    "lo": 0,
    "mid": 20,
    "hi": 100
  },
  "colafizz": {
    "target": "cola",
    "lo": 0,
    "mid": 50,
    "hi": 100
  },
  "glassshine": {
    "target": "shine",
    "lo": 0,
    "mid": 5,
    "hi": 10
  },
  "frostlevel": {
    "target": "frost",
    "lo": 0,
    "mid": 50,
    "hi": 100
  },
  "cloudspeed": {
    "target": "cloudDrift",
    "lo": 0,
    "mid": 35,
    "hi": 100
  },
  "verticalframing": {
    "target": "focus",
    "lo": 0.3,
    "mid": 0.56,
    "hi": 0.7
  },
  "renderscale": {
    "target": "scale",
    "lo": 0.4,
    "mid": 1,
    "hi": 1.5
  }
};
const SETTING_KEYS = ["waves","glintAmount","crispStrength","crispSpeed","windAmount","plantAmount","smokeAmount","cola","shine","frost","cloudDrift","focus","scale"];
function settings() { return Object.fromEntries(SETTING_KEYS.map(k => [k, S[k]])); }
window.demo = {
  seek(t) { coverDrop(); S.time = t; S.wtime = t * .12; S.cloudPh = CLD_K.map((k, i) => (t * cloudPx() * k) % cloudPeriod(i)); S.cloudSh = t * cloudPx(); S.dwClock = DW_SPEED.map(v => t * v); S.crClock = [t * S.crispSpeed, t * S.crispSpeed * .12]; render(); },
  setPaused(v) { userPaused = !!v; syncPlayback(); }, render, settings,
};
window.wallpaperPropertyListener = {
  setPaused: v => { hostPaused = !!v; syncPlayback(); },
  applyGeneralProperties: p => {
    if (typeof p?.fps !== 'number' || !Number.isFinite(p.fps) || p.fps <= 0) return;
    const fps = Math.max(1, Math.min(240, p.fps));
    if (fps !== S.fps) { S.fps = fps; acc = 0; }
  },
  applyUserProperties: properties => {
    if (!properties || typeof properties !== 'object') return;
    let changed = false, scaleChanged = false;
    for (const [key, map] of Object.entries(PROPERTY_MAP)) {
      const value = properties[key]?.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const v = Math.round(Math.max(0, Math.min(100, value)));
      const mapped = v === 50 ? map.mid : v < 50 ? map.lo + (map.mid - map.lo) * v / 50 : map.mid + (map.hi - map.mid) * (v - 50) / 50;
      changed ||= S[map.target] !== mapped;
      scaleChanged ||= map.target === 'scale' && S.scale !== mapped;
      S[map.target] = mapped;
    }
    if (changed) { stale = true; if (scaleChanged) resize(); else render(); }
  },
};
try { const k = JSON.parse(window.name || '{}'); if (k.s) { Object.assign(S, k.s); S.fps = k.fps; hostPaused = k.paused; stale = true; } window.name = ''; } catch {}   // back from a context-loss reload

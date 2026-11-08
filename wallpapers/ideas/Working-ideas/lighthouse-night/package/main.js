'use strict';
// Lighthouse Night: Wallpaper Engine web wallpaper (batch 2026-10-22). Built from kit/skeleton, cloud-delta drift adapted from
// wallpapers/in-progress/firefly-shrine. One full-screen pass over the painting:
//  - clouds drift (premultiplied RGBA layer over a cloud-free plate, so they really cover the moon), the painted cloud
//    reflections drift with them on the water (signed delta strip);
//  - the lighthouse beam: an analytic soft cone in a simple camera model (closest approach of view ray and beam axis,
//    Gaussian line integral), occluded by land / sea by depth, mirrored in the calm water, lighting cloud undersides and mist;
//  - lamp pulse (brightest when the beam faces the viewer), cottage window breathing;
//  - moon glitter: perspective horizontal dashes confined to the painted moon column;
//  - two low sea-mist strips (Codex soft layer, un-mixed);
//  - a rare far boat light crossing the open sea.
// Everything is a function of scene time (seekable, FPS independent); drift phases are integrated so slider changes never jump.
(() => {
const canvas = document.querySelector('#scene');
const here = f => new URL(f, document.currentScript.src).href;
const FILES = { base: here('base.jpg'), clouds: here('clouds.png'), refl: here('reflections.png'), masks: here('masks.png'), masks2: here('masks2.png'), mist: here('mist.png') };
const STILL = here('still.jpg');
const ART_W = 1672, ART_H = 941;                // art-space constants are authored at 1x art px (research/.../layers.json)
const FOCUS = [0.5, 0.478];                     // in wing-extended art space: 16:9 shows exactly the painting; 21:9 shows rows ~50-850
                                                // (moon top to below the lamp reflection), the side wings fill the width
const HORIZON = 533, CAM_F = 1500, CAM_CX = 836; // simple pinhole camera fitted to the painting (lamp and its reflection agree)
const LAMP = [1089.8, 263.4], WINDOW = [927.7, 455.2], LAMP_R = [1089.2, 803.4], WINDOW_R = [927.5, 649.2];
const MOON = [550.3, 139.9, 54.1];
const SKY_ROWS = 1066;                          // clouds.png rows (2x master, 1882 rows); reflections.png = the rest

// ---- settings: WE slider value (0-100) -> internal unit. 50 = tuned look, 0 = off.
const settings = { beam: 1, beamspeed: 1, shimmer: 1, mist: 1, clouds: 1, quality: 1, fps: 30 };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fromSlider = {
  beam: v => v / 50, beamspeed: v => v / 50, shimmer: v => v / 50, mist: v => v / 50, clouds: v => v / 50,
  quality: v => clamp(v, 35, 100) / 100,
};
const weKeys = { beam: 'beam', beamspeed: 'beamspeed', seashimmer: 'shimmer', mist: 'mist', cloudspeed: 'clouds', renderscale: 'quality' };
// tuned units at slider 50
const BEAM_PERIOD = 34;            // seconds per turn
const BEAM_PHI0 = 2.2;             // start angle (rad): sweeping left-front, toward the viewer soon after load
const CLOUD_PX_S = 4.2, MIST_PX_S = [3.0, 1.9];
const BOAT_SLOT = 150, BOAT_DUR = 80;

let gl, prog, U = {}, tex = {}, imgs = {}, quadBuf;
let ready = false, lost = false, hostPaused = false;
let raf = 0, last = 0, acc = 0, pending = 0, time = 0, frames = 0, testMode = false;
let cloudPh = 0, mistPh = 0, beamPh = BEAM_PHI0;  // integrated phases

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

// ---- deterministic randomness
function hash(n) { let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
function vnoise(t, seed) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (hash(i * 131 + seed) * (1 - u) + hash((i + 1) * 131 + seed) * u) * 2 - 1;
}
// boat: one slot every BOAT_SLOT s, ~65 % of slots have a crossing; returns [x(art uv), alpha] or null
function boatAt(t) {
  const n = Math.floor(t / BOAT_SLOT);
  if (hash(n * 5 + 1) > .65) return null;
  const start = n * BOAT_SLOT + 10 + hash(n * 5 + 2) * (BOAT_SLOT - BOAT_DUR - 20), k = t - start;
  if (k < 0 || k > BOAT_DUR) return null;
  const dir = hash(n * 5 + 3) < .5 ? 1 : -1, x0 = .03, x1 = .355;   // open sea left of the headland, across the moon column
  const e = k / BOAT_DUR, x = dir > 0 ? x0 + (x1 - x0) * e : x1 - (x1 - x0) * e;
  return [x, clamp(k / 4, 0, 1) * clamp((BOAT_DUR - k) / 4, 0, 1)];
}

// ---- shaders
const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const f = n => n.toFixed(6);
const FS = `precision highp float;
varying vec2 uv;
uniform sampler2D base,clouds,refl,masks,masks2,mist;
const float SKYV=${f(SKY_ROWS / 1882)};   // sky layer rows / master rows (layers.json)
uniform vec2 res,focus;uniform float extPx,time;   // extPx = width of each painted side wing in art px (base.jpg)
uniform float cloudShift,beamAmt,beamPhi,beamSide,shimAmt,mistAmt,mistPh,facing,lampPulse,winFlick;
uniform vec3 boat;          // x (art uv), alpha, unused
const vec2 ART=vec2(${ART_W}.,${ART_H}.);
const vec3 LAMPW=vec3(${f((LAMP[0] - CAM_CX) / CAM_F)},${f((HORIZON - LAMP[1]) / CAM_F)},1.); // lamp in camera space, distance 1
const float HC=.004;        // camera height above the water (lamp distance = 1)
const vec3 BEAMC=vec3(1.,.9,.72);
vec2 toArt(vec2 uv){
  float a=res.x/res.y; vec2 q=vec2(uv.x,1.-uv.y);
  float aspectExt=(ART.x+2.*extPx)/ART.y;   // cover-fit the wing-extended art, never stretch
  if(a>aspectExt){float s=aspectExt/a;q.y=clamp(focus.y,.5*s,1.-.5*s)+(q.y-.5)*s;}
  else{float s=a/aspectExt;q.x=clamp(focus.x,.5*s,1.-.5*s)+(q.x-.5)*s;}
  q.x=(q.x*(ART.x+2.*extPx)-extPx)/ART.x;   // back to painting uv (outside 0..1 on the wings; masks clamp to their edge)
  return q;}
float sstep(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
vec3 dec(vec2 st){return (texture2D(refl,st).rgb*255.-128.)*2./255.;}
float tri(float u){u=mod(u,2.);return 1.-abs(1.-u);}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
// beam axis direction for the current angle (slight downward tilt)
vec3 axisDir(){return normalize(vec3(sin(beamPhi),-.012,cos(beamPhi)));}
// soft cone: Gaussian line integral of the beam along a view ray o+r*t (t = depth), occluded beyond tmax
float beam(vec3 o,vec3 r,float tmax){
  vec3 a=axisDir(); vec3 w=o-LAMPW;
  float b=dot(r,a), rr=dot(r,r);
  float den=max(rr-b*b,1e-5);
  float d=dot(r,w), e=dot(a,w);
  float t=(b*e-d)/den;               // closest approach on the ray
  float s=(rr*e-b*d)/den;            // ...and on the axis
  float sinT=sqrt(den/rr);
  float front=sstep(-.12,.08,s);      // nothing behind the lamp; soft so a beam facing the viewer has no hard rim
  s=max(s,0.);
  vec3 q=o+r*t, pa=LAMPW+a*s;
  float dist=length(q-pa);
  float R=.018+s*.15;                // soft cone: radius grows with distance from the lamp (half-angle ~8.5 deg)
  float q2=dist*dist/(R*R);
  float I=(exp(-q2)+.3*exp(-q2*.25))/(R*max(sinT,.06))*.021;
  I*=front*exp(-s*.55)/(1.+s*1.2);   // fades with distance along the beam
  float sig=R/max(sinT,.06)+.002;     // along-ray width of the beam crossing
  I*=sstep(-1.5*sig,1.5*sig,t)*(1.-sstep(tmax-.02-sig*.3,tmax+.02+sig*.3,t));
  // mist in the air breaks the beam into soft painterly bands that drift slowly
  float m=vn(vec2(pa.x*7.+time*.05,pa.z*7.-time*.03))*.65+vn(vec2(pa.x*19.-time*.07,pa.z*17.))*.35;
  I*=.7+.45*m;
  return I*beamSide;                  // when the beam faces the viewer the line model breaks down; the glare takes over
}
// horizontal glitter dashes on the calm water in perspective (x0 = column centre in art px), 0..1
float seaDash(vec2 a,float x0,float tt){
  float dy=max(a.y*ART.y-${HORIZON}.,.5);
  vec2 p=vec2((a.x*ART.x-x0)/dy*5.5,${CAM_F}./dy*2.6-tt*.5);
  float n=vn(p)*.55+vn(p*vec2(2.3,2.7)+vec2(tt*.23,-tt*.4))*.45;
  return sstep(.72,.84,n)*sstep(1.,6.,dy);
}
vec3 rayFor(vec2 a){return vec3((a.x*ART.x-${CAM_CX}.)/${CAM_F}.,(${HORIZON}.-a.y*ART.y)/${CAM_F}.,1.);}
float tSea(float ay){float dy=(ay*ART.y-${HORIZON}.)/${CAM_F}.;return dy>0.?HC/dy:1e5;}
void main(){
  vec2 a=toArt(uv);
  vec4 mk=texture2D(masks,a);      // R sky vis, G land depth code, B lamp/window glow, A reflected-sky water
  vec4 m2=texture2D(masks2,a);     // R moon column, G water, B foreground rocks
  vec3 c=texture2D(base,vec2((a.x*ART.x+extPx)/(ART.x+2.*extPx),a.y)).rgb;
  // ---- clouds: premultiplied RGBA layer drifting over the cloud-free plate (mirrored-tile wrap over the full width),
  //      so a cloud passing the moon really covers it; the painted cloud reflections drift with them on the water
  float u1=tri(a.x-cloudShift);
  float cloudness=0.;
  if(a.y<SKYV){
    vec4 L=texture2D(clouds,vec2(u1,a.y/SKYV));
    // the moon is an opaque disc in front of the clouds (stylised, as in many painted backgrounds): no cloud texture inside
    // it, an anti-aliased rim, and a soft moon glow over the clouds right around it
    float md=length((a-vec2(${f(MOON[0] / ART_W)},${f(MOON[1] / ART_H)}))*ART);
    L*=sstep(${f(MOON[2] - 1.2)},${f(MOON[2] + .3)},md);
    c+=vec3(1.,.95,.8)*L.a*mk.r*.22*exp(-max(md-${f(MOON[2])},0.)/14.);
    c=mix(c,c*(1.-L.a)+L.rgb,mk.r);
    cloudness=L.a*mk.r;
  }else if(mk.a>0.){
    c+=mk.a*dec(vec2(u1,(a.y-SKYV)/(1.-SKYV)));
  }
  // ---- moon glitter: horizontal dashes in perspective, inside the painted moon column only
  if(shimAmt>0.&&m2.r>.01){
    float dy=max(a.y*ART.y-${HORIZON}.,.5);
    float zz=${CAM_F}./dy;                       // ~ distance
    float lx=(a.x*ART.x-${f(MOON[0])})/dy;       // lateral, perspective-normalised
    vec2 p=vec2(lx*5.5,zz*2.6-time*.5);
    float n=vn(p)*.55+vn(p*vec2(2.3,2.7)+vec2(time*.23,-time*.4))*.45;
    float g=sstep(.72,.84,n);
    float near=sstep(1.,6.,dy);                  // thin at the horizon
    float col=m2.r;
    vec3 moonC=vec3(1.,.95,.78);
    c+=moonC*g*col*near*.42*shimAmt;
    c*=1.+col*(n-.5)*.10*shimAmt;                // the column breathes a little with the dashes
  }
  // ---- lamp and window (and their painted reflections)
  float lampD=length((a-vec2(${f(LAMP[0] / ART_W)},${f(LAMP[1] / ART_H)}))*ART);
  float lampRD=length((a-vec2(${f(LAMP_R[0] / ART_W)},${f(LAMP_R[1] / ART_H)}))*ART*vec2(1.,.45));
  float isLamp=1.-sstep(40.,60.,min(lampD,lampRD));
  c*=1.+mk.b*(isLamp*lampPulse+(1.-isLamp)*winFlick);
  // ---- beam
  if(beamAmt>0.){
    vec3 r=rayFor(a);
    float code=mk.g*2.;                          // land depth (in lamp distances), 0 = open
    float ts=tSea(a.y);
    // anti-aliased land edges carry a partial code: treat any land coverage as the headland (or the near rocks), never as
    // a nearer occluder, otherwise a dark rim of hidden beam outlines the tower against the lit sky
    float tmax=m2.b>.3?.12:(code>.01?max(code,.98):ts);
    float I=beam(vec3(0.),r,tmax);
    float Irefl=0.;
    if(m2.g>.01){                                // calm water mirrors the beam (the sea plane at -HC)
      vec2 am=vec2(a.x,(2.*${HORIZON}.-a.y*ART.y)/ART.y);
      float mcode=texture2D(masks,am).g*2.;      // headland reflection occludes it
      vec3 rm=vec3(r.x,-r.y,1.);
      // slow ripples: tiny tilt of the mirror so the reflected beam shimmers and streaks vertically
      float dy=max(a.y*ART.y-${HORIZON}.,.5);
      float rip=(vn(vec2(a.x*ART.x/dy*1.5,${CAM_F}./dy*.9-time*.4))-.5);
      rm.y+=rip*.0045*(.5+.5*shimAmt);
      rm.x+=rip*.002;
      Irefl=beam(vec3(0.,-2.*HC,0.),rm,mcode>.01?max(mcode,.98):1e5)*m2.g*.9;
      // the reflected beam breaks into glints on the slow ripples as it sweeps over the water
      float farW=1.-sstep(120.,300.,dy);          // near the camera the dashes would be big blobs: keep the glints mid-distance
      if(shimAmt>0.) c+=BEAMC*(1.-exp(-Irefl*3.))*seaDash(a,${f(LAMP_R[0])},time*1.1+7.)*.32*farW*min(shimAmt,1.5)*beamAmt;
    }
    float glare=pow(max(facing,0.),6.);
    float g2=pow(max(facing,0.),20.);           // the moment the beam looks straight at us
    float halo=exp(-lampD*lampD/(650.+glare*3500.))*(.07+glare*.45)+exp(-lampD*lampD/90.)*(.12+glare*.35)
              +exp(-lampD*lampD/(3000.+glare*30000.))*glare*.20   // the sky around the lamp lights up as the beam comes round
              +exp(-lampD*lampD/(9000.+g2*60000.))*g2*.12;        // broad soft bloom at the peak of the flash
    float haloR=(exp(-lampRD*lampRD/(500.+glare*2500.))*(.04+glare*.3)+exp(-lampRD*lampRD/(3000.+glare*20000.))*glare*.12)*m2.g;
    vec3 add=BEAMC*(1.-exp(-(I+Irefl)*1.4))*.55+BEAMC*(halo+haloR);
    // cloud undersides catch the beam passing just below them
    float Iu=beam(vec3(0.),rayFor(a+vec2(0.,.018)),1e5);
    add+=BEAMC*cloudness*(1.-exp(-Iu*2.))*.18;
    c+=add*beamAmt*(1.-m2.b*.85);                // foreground rocks are in front of everything
  }
  // ---- low sea mist: two slow RGBA strips over the horizon and the headland base, lit by the beam
  if(mistAmt>0.){
    for(int i=0;i<2;i++){
      float fi=float(i);
      float tw=fi<.5?1.3:.95;
      float cy=fi<.5?.578:.552, hh=fi<.5?.075:.05;
      float ph=fi<.5?mistPh:mistPh*.63+.41;
      float v=(a.y-cy)/hh+.5;
      if(v>0.&&v<1.){
        vec4 m=texture2D(mist,vec2(fract(a.x/tw-ph/tw),v));
        vec3 mc=min(c*1.1+vec3(.10,.11,.16)*(.6+dot(m.rgb,vec3(.33))),1.);
        float lit=0.;
        if(beamAmt>0.){lit=beam(vec3(0.),rayFor(a+vec2(0.,-.06)),1e5);}
        mc+=BEAMC*(1.-exp(-lit*2.5))*.45*beamAmt;
        c=mix(c,mc,clamp(m.a*mistAmt*(1.-m2.b)*(fi<.5?.85:.65),0.,1.));
      }
    }
  }
  // ---- rare far boat light on the open sea
  if(boat.y>0.){
    vec2 bp=vec2(boat.x,(${HORIZON}.-1.6)/ART.y);
    vec2 d=(a-bp)*ART;
    float core=exp(-dot(d,d)/.9), glow=exp(-dot(d,d)/14.);
    vec2 dr=(a-vec2(boat.x,(${HORIZON}.+2.6)/ART.y))*ART*vec2(1.,.35);
    float refl=exp(-dot(dr,dr)/1.2)*m2.g;
    c+=vec3(1.,.82,.55)*(core*.9+glow*.18+refl*.35)*boat.y;
  }
  gl_FragColor=vec4(c,1.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}
function texture(img, unit, rgba) {
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);   // clouds.png is signed data
  const fm = rgba ? gl.RGBA : gl.RGB;
  gl.texImage2D(gl.TEXTURE_2D, 0, fm, fm, gl.UNSIGNED_BYTE, img);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return t;
}
function setup() {
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  tex.base = texture(imgs.base, 0, false); tex.clouds = texture(imgs.clouds, 1, true); tex.refl = texture(imgs.refl, 5, false);
  tex.masks = texture(imgs.masks, 2, true); tex.masks2 = texture(imgs.masks2, 3, true); tex.mist = texture(imgs.mist, 4, true);
  U = {};
  for (const k of ['base', 'clouds', 'refl', 'masks', 'masks2', 'mist', 'res', 'focus', 'extPx', 'time', 'cloudShift', 'beamAmt', 'beamPhi', 'beamSide', 'shimAmt', 'mistAmt', 'mistPh', 'facing', 'lampPulse', 'winFlick', 'boat']) U[k] = gl.getUniformLocation(prog, k);
  [['base', 0], ['clouds', 1], ['masks', 2], ['masks2', 3], ['mist', 4], ['refl', 5]].forEach(([k, i]) => gl.uniform1i(U[k], i));
  const extPx = Math.max(0, (imgs.base.width / imgs.base.height * ART_H - ART_W) / 2);   // 0 if base.jpg has no wings
  gl.uniform1f(U.extPx, extPx); gl.uniform2f(U.focus, FOCUS[0], FOCUS[1]);
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
function draw() {
  if (!ready || lost) return;
  gl.uniform2f(U.res, canvas.width, canvas.height); gl.uniform1f(U.time, time);
  gl.uniform1f(U.cloudShift, cloudPh / ART_W);
  const b = Math.min(settings.beam, 2);
  gl.uniform1f(U.beamAmt, b); gl.uniform1f(U.beamPhi, beamPh);
  // facing: how directly the beam points at the viewer (axis vs direction lamp -> camera)
  const lw = [(LAMP[0] - CAM_CX) / CAM_F, (HORIZON - LAMP[1]) / CAM_F, 1], ll = Math.hypot(...lw);
  const ax = [Math.sin(beamPh), 0, Math.cos(beamPh)];
  const facing = -(ax[0] * lw[0] + ax[2] * lw[2]) / ll;
  gl.uniform1f(U.facing, b > 0 ? facing : 0);
  gl.uniform1f(U.beamSide, 1 - (x => x * x * (3 - 2 * x))(clamp((facing - .9) / .08, 0, 1)));
  // lamp: slow breathing plus a flash as the beam swings past the viewer (also when the beam slider is 0: then just steady)
  const flash = Math.pow(Math.max(facing, 0), 8);
  gl.uniform1f(U.lampPulse, b * (.10 * vnoise(time * .7, 3) + .9 * flash + .08));
  gl.uniform1f(U.winFlick, (settings.beam > 0 || settings.shimmer > 0) ? .07 * vnoise(time * .9, 11) + .04 * vnoise(time * 3.1, 17) : 0);
  gl.uniform1f(U.shimAmt, Math.min(settings.shimmer, 2));
  gl.uniform1f(U.mistAmt, Math.min(settings.mist, 2)); gl.uniform1f(U.mistPh, mistPh / ART_W);
  const bt = settings.shimmer > 0 ? boatAt(time) : null;
  gl.uniform3f(U.boat, bt ? bt[0] : 0, bt ? bt[1] : 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  frames++;
}
function frozen() { return settings.beam === 0 && settings.shimmer === 0 && settings.mist === 0 && settings.clouds === 0; }
function stopped() { return hostPaused || testMode || document.hidden || lost || !ready || frozen(); }
function schedule() {
  cancelAnimationFrame(raf); raf = 0; last = 0; acc = 0; pending = 0;
  if (!stopped()) raf = requestAnimationFrame(tick);
}
function advance(dt) {
  time += dt;
  cloudPh += dt * CLOUD_PX_S * settings.clouds;
  mistPh += dt * MIST_PX_S[0] * (settings.mist > 0 ? 1 : 0);
  beamPh += dt * (2 * Math.PI / BEAM_PERIOD) * settings.beamspeed;
}
function tick(now) {
  if (stopped()) { raf = 0; return; }
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0; last = now;
  acc += dt; pending += dt;
  const interval = settings.fps > 0 ? 1 / settings.fps : 0;
  if (acc + 1e-4 >= interval) {
    acc = Math.max(0, acc - interval);
    if (acc > interval) acc = 0;
    advance(pending); pending = 0;
    draw();
  }
  raf = requestAnimationFrame(tick);
}
function fail(err) {
  ready = false; cancelAnimationFrame(raf); canvas.hidden = true;
  document.body.style.backgroundImage = `url('${STILL}')`;
  console.warn('Animation unavailable, showing still art:', err && err.message);
}
document.addEventListener('visibilitychange', schedule);
window.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; ready = false; schedule(); });
canvas.addEventListener('webglcontextrestored', () => { try { setup(); } catch (e) { fail(e); } });

// ---- test hooks used by kit/verify.cjs and the development page (harmless in WE; no panel, no keyboard shortcuts)
window.wallpaperDiagnostics = { get state() { return { ready, lost, time, frames, paused: stopped(), fps: settings.fps, settings: { ...settings }, width: canvas.width, height: canvas.height, cloudPh, mistPh, beamPh }; } };
window.wallpaperTest = {
  seek(t) {
    testMode = true; schedule(); time = t;
    cloudPh = t * CLOUD_PX_S * settings.clouds; mistPh = settings.mist > 0 ? t * MIST_PX_S[0] : 0;
    beamPh = BEAM_PHI0 + t * (2 * Math.PI / BEAM_PERIOD) * settings.beamspeed; draw();
  },
  resume() { testMode = false; schedule(); },
  set(key, v) { settings[key] = v; if (key === 'quality') resize(); if (ready) draw(); schedule(); }, // development hook only: unclamped internal units
};

try {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) throw Error('WebGL is not available.');
  let left = Object.keys(FILES).length;
  for (const [k, src] of Object.entries(FILES)) {
    const im = new Image(); imgs[k] = im;
    im.onload = () => { if (--left === 0) { try { setup(); } catch (e) { fail(e); } } };
    im.onerror = () => fail(Error(src + ' could not be loaded'));
    im.src = src;
  }
} catch (e) { fail(e); }
})();

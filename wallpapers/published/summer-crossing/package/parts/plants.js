'use strict';
// Plants: the clean plate under them, light on the grass, the far trees as leaf clumps, the far weeds and the whole near plants, all bent
// from the ground. Values are the tuned ones (constants in parts/wind.js). The clean plate (build_near.py, not in this repo): a Codex
// ground with no plants on it, and the Codex plants drawn whole on top. Data: assets/plants-cp-data.js (SC_PLANTS_CP, SC_LAWN).
(() => {
const CP = () => window.SC_PLANTS_CP;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
// the light a gust or the wake puts on the grass at P, for the pieces to match the lawn under them
const GLIGHT = `
// only the express's wake lights the grass now: the rolling gust light is gone (it looked wrong)
float grassLight(vec2 P){ return wakeDrive(P.x)*.5*(1.-smoothstep(640.,760.,P.y)); }
`;
// The clean plate's far plants move the way Straw Hat Cove's foliage does (the first version moved wrongly; this copies
// how that wallpaper does it): every leaf clump is a rigid piece that turns a little about its base and rides one slow travelling sway, weighted by how
// high it stands; under the clumps an underlay, the plants' opaque inside moved by the same sway, fills the slivers that open between them.
// Nothing is warped. The signal and the wooden pole stay in front: wherever the post matte is, read at the screen position, nothing is drawn.
// Data from grass/clean/build_far.py: the band texture (premultiplied colour, a gap, alpha), the labels (clump id, sway weight), the clump table.
// F_WAKE: the express's push on the clumps. It was 3 (W_WAKE*3 = 2.4 art px of rigid shift); they shifted and floated a
// little weirdly when the express came by. Now 40 % of that (the far weeds: WEED_WAKE).
const FAR_CP = `
const float F_SWAY=2.6, F_ROT=.08, F_FLUTTER=.25, F_WAVE=.0085, F_LEN=15., F_WAKE=1.2;
uniform sampler2D uBand,uBandA,uLab,uOcc; uniform float uTreeAmt,uTreeT;
float fGust(float t){ return .35+.65*smoothstep(.15,.85,.5+.5*sin(t*.21)*sin(t*.13+1.)); }
float fPh(vec2 p){ return dot(p,vec2(1.,.42))*F_WAVE; }
// a branch's slow sway at p, in art px at full weight: one travelling wave, so neighbours stay in step. The express's wake pushes it too.
vec2 farSway(vec2 p){
  float t=uTreeT, w=fPh(p), g=fGust(t+p.x*.0015);
  // under the sway a slow drift, not a faster wave (that one made the clumps stop and start like the weeds, "right left still")
  float s=(sin(t*1.12-w)+.3*sin(t*.33-.7*w+1.))*g;
  vec2 d=vec2(s,.1*s+.12*sin(t*1.47-1.3*w)*g)*F_SWAY*uTreeAmt;
  d.x+=uDir*wakeDrive(p.x)*W_WAKE*F_WAKE;
  return d;
}
vec2 rot2(vec2 v,float a){ float c=cos(a),s=sin(a); return vec2(c*v.x-s*v.y,s*v.x+c*v.y); }
// the band at art point A: premultiplied colour (uBand) and alpha (uBandA), art rows 470..650 at 2x
vec4 bandAt(vec2 A){
  A.y=clamp(A.y,470.25,649.75);
  vec2 uv=vec2(A.x/1672.,(A.y-470.)/180.);
  return vec4(texture(uBand,uv).rgb,texture(uBandA,uv).r);
}
vec4 labAt(ivec2 X){ return texelFetch(uLab,clamp(X,ivec2(0),ivec2(3343,359)),0); }
float postFront(vec2 A){ return texture(uOcc,vec2(A.x/1672.,(A.y-470.)/180.)).r*step(470.,A.y)*step(A.y,650.); }
`;
const FS_FAR_UNDER = `
in vec2 vA; out vec4 frag;
void main(){
  vec2 A=vA;
  float w=labAt(ivec2(A.x*2.,(A.y-470.)*2.)).b;
  vec2 src=A-farSway(A)*w;
  vec4 C=bandAt(src);
  float a=min(C.a,min(min(bandAt(src+vec2(.8,0.)).a,bandAt(src-vec2(.8,0.)).a),min(bandAt(src+vec2(0.,.8)).a,bandAt(src-vec2(0.,.8)).a)));
  a=smoothstep(.92,1.,a)*(1.-postFront(A));
  if(a<.003) discard;
  float L=grassLight(A);
  frag=vec4((C.rgb/max(C.a,1e-3)*a*(1.+.3*L)+.04*L*a*vec3(1.,.94,.55))*cloudShadow(A,0.),a);
}`;
const VS_CLUMP = `
in vec2 p; in vec4 aBox; in vec4 aPiv; in vec4 aPar;   // p: corner in the box 0..1. aBox: x, y, w, h. aPiv: base x, y, sway weight, swing weight. aPar: length, seed, id
out vec2 vSrc; flat out float vId; out float vShade,vLight;
void main(){
  vec2 q=aBox.xy-.75+p*(aBox.zw+1.5);
  vec2 pv=aPiv.xy; float hw=aPiv.z,hr=aPiv.w,L=max(aPar.x,1.),seed=aPar.y,t=uTreeT;
  float g=fGust(t+pv.x*.0015);
  // slow sway (gust front, a smooth patchy offset, a touch per clump) and a faster rustle that only wakes in gusts
  float ph=fPh(pv)+(vn(pv*.011+5.)-.5)*2.5+(seed-.5)*.5;
  float f=sin(t*1.25-ph)+.4*sin(t*.37-.6*ph+1.);
  float r=sin(t*(3.6+2.8*fract(seed*11.9))-ph*2.3+seed*17.);
  float th=F_ROT/(1.+L/F_LEN)*pow(hr,.8)*(f*g+F_FLUTTER*r*g*g)*uTreeAmt;
  vec2 rel=q-pv; float u=clamp(-rel.y/L,0.,1.);
  vec2 P=pv+rot2(rel,th*(.5+1.1*u*u))+farSway(pv)*hw;
  vSrc=q; vId=aPar.z; vShade=cloudShadow(pv,0.); vLight=grassLight(pv);
  vec2 n=(P-uView.xy)/uView.zw; gl_Position=vec4(n.x*2.-1.,1.-n.y*2.,0.,1.);
}`;
const FS_CLUMP = `
in vec2 vSrc; flat in float vId; in float vShade,vLight; out vec4 frag;
float idEq(ivec2 X){ vec4 l=labAt(X); return abs(l.r*255.+256.*l.g*255.-vId)<.5?1.:0.; }
void main(){
  vec2 X=vec2(vSrc.x*2.,(vSrc.y-470.)*2.)-.5; ivec2 i0=ivec2(floor(X)); vec2 w=X-floor(X);
  float m=mix(mix(idEq(i0),idEq(i0+ivec2(1,0)),w.x),mix(idEq(i0+ivec2(0,1)),idEq(i0+ivec2(1,1)),w.x),w.y);
  vec2 A=artOf(gl_FragCoord.xy);
  float k=m*(1.-postFront(A));
  vec4 C=bandAt(vSrc);
  float a=C.a*k;
  if(a<.003) discard;
  frag=vec4((C.rgb*k*(1.+.3*vLight)+.04*vLight*a*vec3(1.,.94,.55))*vShade,a);
}`;
// whole near plants: a mesh curved from the ground. Nothing moves at the ground line, the tip moves most.
const VS_WHOLE = `
in vec2 p; in vec2 aUV; in vec4 aPar;   // aPar: root x, ground y here, seed, depth (0 back .. 1 front)
uniform float uDepK;                    // 0: pieces on the same ground move as one, so two layers that traced the same blade never part
uniform float uHs,uAmpK;                // height over which a plant bends fully (art px: 80 near, less for the small far weeds), and how far it goes
uniform float uWindK,uWakeK;            // the wind's share of that (from the Plants wind slider), and the express wake's (for the weeds: lean per px)
uniform float uWeed;                    // 1: the far weeds. The lawn's calm breath barely moved them, so they
                                        // sway on their own like Straw Hat Cove's leaves, a phase per weed. Then they moved far too much next to the
                                        // lawn in front: calm like it, no rustle, about half the lawn's movement on screen (WEED_SWAY)
const float WEED_SWAY=.17;
out vec2 vUV; out float vLight;
float curve(float h){ float f=pow(h/uHs,1.5); return f/(1.+.35*f); }
void main(){
  float G=aPar.y,seed=aPar.z,dep=aPar.w,dd=dep*uDepK;
  vec2 R=vec2(aPar.x,G);
  float h=max(G-p.y,0.);
  float f=curve(h);
  // along a row the delay and the strength change slowly, so a wide clump isn't one sheet; neighbours stay in step
  float lag=.1+.0011*h+.3*vn(vec2(R.x/95.,dd*7.))+.12*(1.-dep)*uDepK;
  float amp=mix(.86,1.14,vn(vec2(R.x/70.+11.,dd*5.+3.)));
  float lean=leanAt(R,uWindT-lag);
  if(uWeed>.5){
    // one slow sway and a slower drift under it, the tip a little behind the stem. A faster wave on top (2.6) made them stop and start, a
    // quarter of the time still and 34 turns a minute at 50 (it read as right, left, still, repeating, and was too
    // frequent); now 12.5 turns a minute at 50, about the foreground's pace at 100, with the same range
    float t=uWindT-h*.006, g=.35+.65*smoothstep(.15,.85,.5+.5*sin(t*.21)*sin(t*.13+1.));
    float ph=dot(R,vec2(1.,.42))*.0085+(vn(R*.011+5.)-.5)*2.5+(seed-.5)*1.2;
    float fs=sin(t*.65-ph)+.45*sin(t*.27-.6*ph+2.);
    lean=uWindAmt*WEED_SWAY*fs*g;
  }
  float wk=wakeDrive(p.x)*W_WAKE*(1.-smoothstep(660.,1000.,mix(min(G,941.),p.y,.3)));
  // the express's push. The near plants bend on the same curve as the wind. The far weeds lean from the root, the tip moving in proportion
  // to its height: on the curve everything above 30 px moved as one block (they read as moving purely along x)
  float push=uWeed>.5?h*uWakeK:f*10.*uWakeK*uAmpK;
  float dx=f*6.5*W_SWAY*amp*lean*uWindK*uAmpK+uDir*wk*push;
  vec2 P=p+vec2(dx,.12*dx*dx/max(h,16.));
  vUV=aUV;
  vLight=grassLight(p);          // from the mesh point's own place, so a wide piece has no step
  vec2 n=(P-uView.xy)/uView.zw; gl_Position=vec4(n.x*2.-1.,1.-n.y*2.,0.,1.);
}`;
const FS_WHOLE = `
in vec2 vUV; in float vLight; out vec4 frag; uniform sampler2D uAtlas,uOcc; uniform float uOccOn;
vec4 tap(vec2 q){ vec4 t=texture(uAtlas,q); return vec4(t.rgb*t.a,t.a); }
void main(){
  // the atlas is 2x: four taps keep thin blades from crawling when minified, one tap stays sharp when it isn't
  vec2 dx=dFdx(vUV)*.25,dy=dFdy(vUV)*.25,ts=vec2(textureSize(uAtlas,0));
  vec4 c=max(length(dx*ts),length(dy*ts))*4.>1.15?.25*(tap(vUV-dx-dy)+tap(vUV+dx-dy)+tap(vUV-dx+dy)+tap(vUV+dx+dy)):tap(vUV);
  // the far weeds stand behind the signal and the wooden pole: none of them is drawn where the post matte is
  vec2 A=artOf(gl_FragCoord.xy);
  if(uOccOn>.5) c*=1.-texture(uOcc,vec2(A.x/1672.,(A.y-470.)/180.)).r*step(470.,A.y)*step(A.y,650.);
  if(c.a<.002) discard;
  // the same gust light as the lawn under it, and the cloud shadow per pixel like the ground
  frag=vec4((c.rgb*(1.+.3*vLight)+.04*vLight*c.a*vec3(1.,.94,.55))*cloudShadow(A,0.),c.a);
}`;
let lawnArr, pFarUnder, pClump, pWhole, cpFar = null, cpWeeds = null, cpWhole = null;
function groundAt(g, x) {
  if (g.length === 2) return g[1];
  if (x <= g[0]) return g[1];
  for (let k = 2; k < g.length; k += 2) if (x <= g[k]) { const t = (x - g[k - 2]) / (g[k] - g[k - 2]); return g[k - 1] + (g[k + 1] - g[k - 1]) * t; }
  return g[g.length - 1];
}
// whole plants: a grid over the piece, only where it holds any plant. Wind is read at the plant's own root, or along the row for a wide clump.
function buildWhole(gl, A) {
  const W = A.atlasW, H = A.atlasH, c = A.cell, nL = A.layers.length, vs = [], ix = [];
  let base = 0;
  A.pieces.forEach(([layer, x0, y0, w, h, ax, ay, g, seed, cells, rx]) => {
    const nx = Math.max(1, Math.ceil(w / c)), ny = Math.max(1, Math.ceil(h / c)), map = new Map();
    const bit = k => (parseInt(cells[k >> 2], 16) >> (3 - (k & 3))) & 1;
    const wide = rx === undefined || rx < 0;
    const dep = nL > 1 ? layer / (nL - 1) : 1;
    const vert = (i, j) => {
      const key = j * (nx + 1) + i;
      if (map.has(key)) return map.get(key);
      const mx = Math.min(i * c, w), my = Math.min(j * c, h), X = x0 + mx / 2, Y = y0 + my / 2;
      vs.push(X, Y, (ax + mx) / W, (ay + my) / H, wide ? X : rx, groundAt(g, X), seed, dep);
      const id = base++; map.set(key, id); return id;
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!bit(j * nx + i)) continue;
      const a = vert(i, j), b = vert(i + 1, j), e = vert(i, j + 1), d = vert(i + 1, j + 1);
      ix.push(a, b, e, b, d, e);
    }
  });
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vs), gl.STATIC_DRAW);
  const st = 32;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, st, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 16);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(ix), gl.STATIC_DRAW);
  return { vao, count: ix.length };
}
// Tuned with Plants wind and Trees wind at 100 in Wallpaper Engine: the near plants were a bit tame, so a general boost of
// about 25 % and at 100 half again what 100 gave; the far weeds and clumps moved far more than the foreground leaves, so at 100
// three quarters of what 100 gave. Then, on 50: the middle plants were turned down by 10 % and the foreground ones boosted by 10 %.
// At 100 the foreground was fine as it was. Only the size of the sway changes, not its pace. w: the slider's rate, 1 at 50, 2 at 100.
const NEAR_K = w => w <= 1 ? 1.375 : 1.375 + .125 * (w - 1);
const MID_K = w => w <= 1 ? .9 : .9 - .15 * (w - 1);
// the express's push on the far weeds, as a lean: art px of tip travel per px of height at the wake's peak (x W_WAKE .8). A 60 px weed's tip
// moves 2.4 px, about its wind sway at 100; on the old curve it slid 9 px ("less giant sway from train", then "still WAYYY to big sway")
const WEED_WAKE = .05;
// o: hs, amp (the far weeds bend over less height, a little less far), windK and wakeK (shares of amp), occ (hide behind the posts)
function drawWhole(ctx, m, atlas, depK, o = {}) {
  const { gl } = ctx; if (!m || !m.count) return;
  const P = pWhole; ctx.use(P); ctx.bindTex(P, 'uAtlas', atlas); gl.uniform1f(P.u.uDepK, depK);
  ctx.bindTex(P, 'uOcc', 'plantsCpOcc'); gl.uniform1f(P.u.uOccOn, o.occ ? 1 : 0);
  gl.uniform1f(P.u.uHs, o.hs || 80); gl.uniform1f(P.u.uAmpK, o.amp || 1); gl.uniform1f(P.u.uWeed, o.weed ? 1 : 0);
  gl.uniform1f(P.u.uWindK, o.windK ?? 1); gl.uniform1f(P.u.uWakeK, o.wakeK ?? 1);
  gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); gl.bindVertexArray(ctx.vao);
}
// the clean plate's leaf clumps: a 4x4 grid over each clump's box, front clumps last
function buildClumps(gl, A) {
  const vs = [], ix = [], G = 4;
  let base = 0;
  for (const [x0, y0, w, h, px, py, hw, hr, L, seed, id] of A.pieces) {
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) vs.push(i / G, j / G, x0, y0, w, h, px, py, hw, hr, L, seed, id, 0);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a = base + j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1; ix.push(a, b, c, b, d, c); }
    base += (G + 1) * (G + 1);
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vs), gl.STATIC_DRAW);
  const st = 56;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, st, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, st, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 24);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 40);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(ix), gl.STATIC_DRAW);
  return { vao, count: ix.length };
}
// The default Trees wind was too strong. The Trees wind slider's 50 now gives what 32.5 gave
// (amplitude and pace both scale with it), so the slider keeps 50 = tuned.
const TREES_K = .65;
function drawClumps(ctx) {
  const { gl } = ctx;
  for (const P of [pFarUnder, pClump]) {
    ctx.use(P); ctx.bindTex(P, 'uBand', 'plantsCpBand'); ctx.bindTex(P, 'uBandA', 'plantsCpBandA'); ctx.bindTex(P, 'uLab', 'plantsCpLabel'); ctx.bindTex(P, 'uOcc', 'plantsCpOcc');
    gl.uniform1f(P.u.uTreeAmt, ctx.settings.trees * TREES_K * MID_K(ctx.settings.trees)); gl.uniform1f(P.u.uTreeT, (ctx.pace('trees') * TREES_K) % 86400);
    if (P === pFarUnder) ctx.quad(P, 0, 470, ctx.ART_W, 650);
    else { gl.bindVertexArray(cpFar.vao); gl.drawElements(gl.TRIANGLES, cpFar.count, gl.UNSIGNED_INT, 0); gl.bindVertexArray(ctx.vao); }
  }
}
SC.part({
  title: 'Plants', order: 20,
  files: { plantsCpNear: 'assets/plants-cp-near.webp', plantsCpPlate: 'assets/plants-cp-plate.jpg', bandPacked: 'assets/plants-cp-farband.webp', plantsCpWeeds: 'assets/plants-cp-farweeds.webp',
    plantsCpLabel: 'assets/plants-cp-farlabel.png', plantsCpOcc: 'assets/plants-cp-occ.png' },
  formats: { plantsCpOcc: 'R8' },
  // the far band is packed as colour rows 0..360, a 4-row gap, alpha rows 364..724: split on the GPU into RGBA8 + R8
  derive: [{ key: 'plantsCpBand', fmt: 'RGBA8', w: 3344, h: 360, from: [['bandPacked', 0, 0, 3344, 360, 0, 0]] },
    { key: 'plantsCpBandA', fmt: 'R8', w: 3344, h: 360, from: [['bandPacked', 0, 364, 3344, 360, 0, 0]] }],
  samplers: { uPlate2: 'plantsCpPlate' },
  uniforms: ['uLawn'],
  set(ctx, P) { ctx.gl.uniform2fv(P.u.uLawn, lawnArr); },
  backDecl: `uniform sampler2D uPlate2; uniform vec2 uLawn[64];
// the painted undergrowth and lawn breathe with the same wind, very little: the plate itself shifts, most at the top of the lawn, none at its end
float lawnShift(vec2 A){
  float u=clamp(A.x/1672.*64.-.5,0.,62.999),fi=floor(u); vec2 L=mix(uLawn[int(fi)],uLawn[int(fi)+1],u-fi);
  float h=L.y-A.y; if(h<=0.||L.x>1500.) return 0.;
  float f=pow(h/80.,1.5); f=f/(1.+.35*f);
  return LAWN_SWAY*smoothstep(L.x,L.x+26.,A.y)*f*(6.5*W_SWAY*leanAt(vec2(A.x,L.y),uWindT-.4)+uDir*wakeDrive(A.x)*W_WAKE*10.*(1.-smoothstep(660.,1000.,A.y)));
}`,
  // the plate under the plants, from row 470 down
  backBase: `
  if(A.y>=470.){
    vec2 t=vec2(q.x-(A.y>650.?lawnShift(A):0.)/1672.,(A.y-470.)/471.),d=uTexel*vec2(1.,941./471.)*.25;
    if(uSS>.5) I=.25*(texture(uPlate2,t-d).rgb+texture(uPlate2,t+d).rgb+texture(uPlate2,t+vec2(d.x,-d.y)).rgb+texture(uPlate2,t+vec2(-d.x,d.y)).rgb);
    else I=texture(uPlate2,t).rgb;
  }
`,
  // light on the grass rolls with the same gusts
  backBody: `
  if(grass>.01){
    float k=wakeDrive(A.x)*grass*.5*(1.-smoothstep(640.,760.,A.y));
    col=col*(1.+.3*k)+.04*k*vec3(1.,.94,.55);
  }
`,
  setup(ctx) {
    const aW = { aUV: 1, aPar: 2 };
    const fu = ['uBand', 'uBandA', 'uLab', 'uOcc', 'uTreeAmt', 'uTreeT'];
    pFarUnder = ctx.program(ctx.VS_QUAD, ctx.COMMON + GLIGHT + FAR_CP + FS_FAR_UNDER, fu);
    pClump = ctx.program(ctx.COMMON + GLIGHT + FAR_CP + VS_CLUMP, ctx.COMMON + GLIGHT + FAR_CP + FS_CLUMP, fu, { aBox: 1, aPiv: 2, aPar: 3 });
    pWhole = ctx.program(ctx.COMMON + GLIGHT + VS_WHOLE, ctx.COMMON + FS_WHOLE, ['uAtlas', 'uDepK', 'uHs', 'uAmpK', 'uWindK', 'uWakeK', 'uOcc', 'uOccOn', 'uWeed'], aW);
    lawnArr = new Float32Array(window.SC_LAWN);
    cpWhole = buildWhole(ctx.gl, CP().near);
    cpFar = buildClumps(ctx.gl, CP().far);
    cpWeeds = buildWhole(ctx.gl, CP().far.weeds);
  },
  draw: {
    far(ctx) {
      drawClumps(ctx);
      // the weeds in front of the trees, whole and rooted, on the Plants wind: they move on their own, not with the trees behind them
      drawWhole(ctx, cpWeeds, 'plantsCpWeeds', 0, { hs: 30, amp: .8, occ: true, weed: true, windK: MID_K(ctx.settings.wind), wakeK: WEED_WAKE });
    },
    near(ctx) { drawWhole(ctx, cpWhole, 'plantsCpNear', 0, { windK: NEAR_K(ctx.settings.wind) }); },
  },
});
})();

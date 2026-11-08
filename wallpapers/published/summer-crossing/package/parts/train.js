'use strict';
// Trains: premultiplied atlas with real motion blur (taps over one frame's travel), behind the signal matte.
(() => {
// y0/h: art rows of the atlas; carL: art px per car; speed: art px/s (about 63 px per metre on this painting)
// the repainted local stands with its wheel bottoms on the near rail head, art y 649 (make_local.py prints this geometry)
const LOCAL_PAINT = { atlas: 'localPaint', y0: 368.33, h: 281, carL: 1285, glass: [.258, .4715, .0257, .9685] };
const EXPRESS_PAINT = { atlas: 'expPaintFast', sharp: 'expPaint', y0: 387.77, h: 262 };   // make_express.py prints this geometry
const LOCAL_SHARP = .3, LOCAL_GLASS = .3;   // the local's sharpening and how much its window glass shows the sea behind
// the local's wheels, as `python make_local.py wheels` prints them: atlas 2x px centre and radii, and the tile's corner in assets/local-wheels.png
const WHEELS = [[372.46, 493.47, 65.06, 67.56, 297, 418], [689.41, 493.72, 66.83, 67.22, 614, 419], [2001.89, 493.87, 64.86, 67.64, 1927, 419], [2297.72, 493.29, 63.52, 67.96, 2223, 418]];
const WHEEL_T = 150, LOCAL_ATLAS = [2570, 562];   // tile size; the local atlas's colour half, 2x px
const f1 = v => v.toFixed(2);
// the signal stands in front of the trains: its matte, cut to its box at 2x (scripts/pack_assets.py), read texel for texel as before
const SIG = `
const vec4 SIGBOX=vec4(460.,226.,622.,690.);
float sigMatte(vec2 A){ return A.x>SIGBOX.x&&A.x<SIGBOX.z&&A.y>SIGBOX.y&&A.y<SIGBOX.w?texture(uSigM,(A-SIGBOX.xy)/(SIGBOX.zw-SIGBOX.xy)).r:0.; }
`;
const FS_TRAIN = `
in vec2 vA; out vec4 frag;
uniform sampler2D uAtlas,uAtlasA,uSigM,uSigFg,uWheels;
uniform float uNose,uCarL,uCars,uCols,uY0,uH,uBlur,uFlare,uFlareAmt,uBob,uSharp,uGlassA,uTailLamp;
uniform float uWheelTurn,uRoll,uSpin;   // the local's wheels: turning (1) or as painted; art px rolled since the nose came in; art px of travel one frame spans
uniform vec4 uGlass;   // atlas v0,v1,u0,u1 of the rows and columns where a hole in the paint is window glass
const vec4 WG[4]=vec4[4](${WHEELS.map(w => `vec4(${w.slice(0, 4).map(f1).join(',')})`).join(',')});
const vec2 WO[4]=vec2[4](${WHEELS.map(w => `vec2(${f1(w[4])},${f1(w[5])})`).join(',')});
const float WT=${f1(WHEEL_T)}; const vec2 WTEX=vec2(${f1(4 * WHEEL_T)},${f1(2 * WHEEL_T)}), LATLAS=vec2(${f1(LOCAL_ATLAS[0])},${f1(LOCAL_ATLAS[1])});
const float WPH[4]=float[4](0.,2.4,4.1,1.3);   // each wheel's marks start somewhere else
${SIG}
float side(vec2 p,vec2 a,vec2 b){ return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x); }
vec4 tap(float s,float vt){
  float len=uCarL*uCars;
  if(s<0.||s>=len) return vec4(0.);
  float c=floor(s/uCarL), f=s/uCarL-c, u;
  float fw=f/uCols;                                 // head car: nose at the left of column 0
  if(uCars<1.5) u=(f<.5?f:1.-f)/uCols;              // a single railcar: both ends are cabs
  else if(c<.5) u=fw;
  else if(c>uCars-1.5) u=(1.-f)/uCols;              // tail car: the head car turned round
  else u=(uCols>1.5?.5:0.)+((uCols>1.5)?fw:(mod(c,2.)<.5?fw:(1.-f)/uCols));
  vec4 k=vec4(texture(uAtlas,vec2(u,vt)).rgb,texture(uAtlasA,vec2(u,vt)).r);
  // painted express: the tail car is the head car turned round, so its lit headlamp shows red there (the lamp's outline in the 5080x524 paint)
  if(uTailLamp>.5&&c>uCars-1.5){
    vec2 p=vec2(u*5080.,vt*524.), A=vec2(102.,361.),B=vec2(147.,322.),C=vec2(258.,299.),D=vec2(200.,342.);
    if(side(p,A,B)>0.&&side(p,B,C)>0.&&side(p,C,D)>0.&&side(p,D,A)>0.){
      float l=dot(k.rgb,vec3(.3,.6,.1));
      k.rgb=mix(k.rgb,vec3(.95,.13,.09)*(.55+.45*l),smoothstep(.38,.72,l));
    }
  }
  // glass: what is behind comes through two panes, darker; slid to 1 it is a plain tinted window with no view
  if(uGlassA>0.&&vt>uGlass.x&&vt<uGlass.y&&u>uGlass.z&&u<uGlass.w){
    float g=(1.-k.a)*uGlassA;
    k+=vec4(mix(vec3(.05,.085,.14),vec3(.2,.31,.46),smoothstep(.55,1.,uGlassA))*g,g);
  }
  return k;
}
float rowOf(float y){ return clamp((y-uBob-uY0)/uH,.001,.999); }
// the local's wheels turn at the speed they roll. The painted wheel stays, lighting, rim and all; the rust and brake dust of a
// whole wheel are added to it, turned to now and blurred over the turn one frame spans so it can't strobe. Where the frame,
// springs or axle boxes stand in front, the mask is 0 and the painting stays as it is.
const float WGAIN=4., WSAT=.4;   // the painted discs are dark: the marks stronger than Codex painted them, with less of their colour
vec3 wheels(vec2 A,vec3 rgb,float al){
  float s=(uNose-A.x)*uDir;
  if(s<0.||s>=uCarL*uCars) return rgb;
  float c=floor(s/uCarL), f=s/uCarL-c;
  bool head=c<.5;                                   // two cars: the tail car is the head car turned round
  vec2 X=vec2((head?f:1.-f),rowOf(A.y))*LATLAS;
  for(int i=0;i<4;i++){
    vec4 g=WG[i]; vec2 n=(X-g.xy)/g.zw;
    if(dot(n,n)>1.1) continue;
    float m=texture(uWheels,(X-WO[i]+vec2(float(i)*WT,WT))/WTEX).r;
    if(m<.004) return rgb;
    float Ra=(g.z+g.w)*.25, sg=head?-1.:1.;         // art px; on screen the head car runs mirrored in the atlas
    float a0=sg*uRoll/Ra+WPH[i]+c*2.9, da=uSpin/Ra;
    vec3 r3=vec3(0.); const int M=24;
    for(int j=0;j<M;j++){
      float an=a0+((float(j)+.5)/float(M)-.5)*da, cs=cos(an), sn=sin(an);
      vec2 p=g.xy+vec2(cs*n.x+sn*n.y,cs*n.y-sn*n.x)*g.zw;   // the marks that were here an angle ago
      r3+=texture(uWheels,(p-WO[i]+vec2(float(i)*WT,0.))/WTEX).rgb;
    }
    vec3 d=r3/float(M)-128./255.;
    return rgb+mix(vec3(dot(d,vec3(.3,.6,.1))),d,WSAT)*WGAIN*al*m;
  }
  return rgb;
}
void main(){
  vec2 A=vA;
  // a box over the shutter's travel and never less than one screen pixel, in x and y: the same footprint as the painting behind it
  float foot=uView.z/res.x, span=max(uBlur,foot);
  vec4 acc=vec4(0.); const int N=14;
  for(int i=0;i<N;i++){
    float o=((float(i)+.5)/float(N)-.5)*span, oy=(mod(float(i),2.)<.5?-.25:.25)*foot;
    acc+=tap((uNose-(A.x+o))*uDir,rowOf(A.y+oy));
  }
  acc/=float(N);
  if(acc.a<.004) discard;
  // sharpness: straight colour against a small neighbourhood, so the silhouette gets no halo
  if(uSharp>.001){
    float r=foot*1.5;
    vec4 lo=.25*(tap((uNose-(A.x-r))*uDir,rowOf(A.y))+tap((uNose-(A.x+r))*uDir,rowOf(A.y))+tap((uNose-A.x)*uDir,rowOf(A.y-r))+tap((uNose-A.x)*uDir,rowOf(A.y+r)));
    vec3 s=acc.rgb/acc.a, l=lo.rgb/max(lo.a,.004);
    acc.rgb=clamp(s+uSharp*(s-l),0.,1.)*acc.a;
  }
  if(uWheelTurn>.5) acc.rgb=min(wheels(A,acc.rgb,acc.a),vec3(acc.a));
  float fs=sigMatte(A);
  vec3 rgb=acc.rgb;
  // sun on the body: the highlight stays put in the frame while the train runs through it
  float sun=exp(-pow((A.x-uFlare)/170.,2.))*smoothstep(0.,1.,(A.y-uY0)/40.)*(1.-smoothstep(.55,1.,(A.y-uY0)/uH));
  rgb+=acc.a*sun*uFlareAmt*vec3(1.,.98,.92);
  // cloud shadow: the train is upright, so all of it takes the shadow of the ground at its foot. cloudShadow(A) maps a pixel's height onto the
  // ground plane, and on the body (just below the horizon) that read as far sea: thin streaks sliding over the paint like water on the train.
  rgb*=cloudShadow(vec2(A.x,uY0+uH-6.),0.);
  // the signal stands in front: its own clean colours by its matte, over the painting. No background enters its edge pixels.
  vec3 sig=vec3(0.);
  if(fs>.002&&A.x>SIGBOX.x&&A.x<SIGBOX.z&&A.y>SIGBOX.y&&A.y<SIGBOX.w){
    sig=fs*acc.a*texture(uSigFg,(A-SIGBOX.xy)/(SIGBOX.zw-SIGBOX.xy)).rgb;
    if(A.y>475.) sig*=cloudShadow(A,0.);
  }
  frag=vec4(sig+(1.-fs)*rgb,acc.a);
}`;
// a contact shadow under the train, on the rails and ballast (multiplied)
const FS_SHADOW = `
in vec2 vA; out vec4 frag; uniform float uNose,uLen,uBlur,uBob; uniform sampler2D uSigM;
${SIG}
void main(){
  vec2 A=vA; float s=(uNose-A.x)*uDir;
  float span=smoothstep(-uBlur*.6-6.,uBlur*.6+12.,s)*smoothstep(-uBlur*.6-6.,uBlur*.6+12.,uLen-s);
  // under the body the sun cannot reach: the far verge seen between the bogies, the far rail, then a soft edge on the ballast
  float sh=.56*smoothstep(568.,580.,A.y)*(1.-smoothstep(631.,634.,A.y))+.48*smoothstep(631.,634.,A.y)*(1.-smoothstep(650.,654.,A.y))+.24*smoothstep(650.,654.,A.y)*(1.-smoothstep(662.,672.,A.y));
  float fs=sigMatte(A);
  frag=vec4(0.,0.,0.,sh*span*(1.-fs));
}`;
// dust the express drags off the ballast: a low soft plume that runs after the tail and thins out
const FS_DUST = `
in vec2 vA; out vec4 frag;
void main(){
  vec2 A=vA;
  float tNose=(A.x-uNose0)*uDir/uWakeV, tTail=tNose+uWakeLen/uWakeV;
  float age=uWakeT-tTail;
  float during=smoothstep(0.,.5,uWakeT-tNose)*(1.-smoothstep(0.,.1,age));
  float after=smoothstep(-.05,.12,age)*exp(-max(age,0.)*1.25);
  float env=max(during*.55,after);
  if(env<.004) discard;
  float x=A.x-uDir*(uWakeT*520.);
  float n=vn(vec2(x/190.,A.y/26.+uWakeT*.5))*.6+vn(vec2(x/62.,A.y/11.-uWakeT*.8))*.4;
  float top=642.-max(age,0.)*26.;
  float band=smoothstep(top-22.,top+22.,A.y)*(1.-smoothstep(668.,700.,A.y));
  float a=.26*env*band*smoothstep(.34,.74,n);
  vec3 c=vec3(.80,.72,.58);
  frag=vec4(c*a,a);
}`;
let pTrain, pShadow, pDust;
SC.part({
  title: 'Trains',
  // chosen values, fixed (local speed 440): painted express and repainted local.
  // The local's wheels turn (only on the local)
  files: { sigMatte: 'assets/signal-matte.png', sigFg: 'assets/signal-fg.png', localWheels: 'assets/local-wheels.png',
    localPacked: 'assets/local-paint.webp', expPacked: 'assets/express-paint.webp', expFastPacked: 'assets/express-paint-fast.webp' },
  formats: { sigMatte: 'R8' },
  // the sharp express paint only shows under about 14 art px of blur: Train speed under about 9 at 60 FPS or more. It loads then, not at start.
  lazy: ['expPacked'],
  // each atlas is packed as top premultiplied colour, bottom alpha in grey: split on the GPU into RGBA8 + R8
  derive: [['localPaint', 'localPacked', 2570, 562], ['expPaint', 'expPacked', 5080, 524], ['expPaintFast', 'expFastPacked', 2540, 524]].flatMap(([key, src, w, h]) => [
    { key, fmt: 'RGBA8', w, h, from: [[src, 0, 0, w, h, 0, 0]] }, { key: key + 'A', fmt: 'R8', w, h, from: [[src, 0, h, w, h, 0, 0]] }]),
  kinds: {
    express: { ...EXPRESS_PAINT, carL: 1270, cars: 6, speed: 2600, cols: 2, lead: 7, tail: 1.2, gateLead: 6.2, shutter: 1, wake: 1, bob: .35, rumble: 1 },
    local:   { ...LOCAL_PAINT, cars: 2, speed: 440, cols: 1, lead: 5.5, tail: .8, gateLead: 5, shutter: .08, wake: 0, bob: .25, rumble: 0 },
  },
  setup(ctx) {
    pTrain = ctx.program(ctx.VS_QUAD, ctx.COMMON + FS_TRAIN, ['uAtlas', 'uAtlasA', 'uSigM', 'uSigFg', 'uWheels', 'uNose', 'uCarL', 'uCars', 'uCols', 'uY0', 'uH', 'uBlur', 'uFlare', 'uFlareAmt', 'uBob', 'uSharp', 'uGlass', 'uGlassA', 'uTailLamp', 'uWheelTurn', 'uRoll', 'uSpin']);
    pShadow = ctx.program(ctx.VS_QUAD, ctx.COMMON + FS_SHADOW, ['uNose', 'uLen', 'uBlur', 'uBob', 'uSigM']);
    pDust = ctx.program(ctx.VS_QUAD, ctx.COMMON + FS_DUST);
  },
  draw: {
    train(ctx) {
      const { gl, ev, view, time, frameDt } = ctx;
      if (!ev.train) return;
      const { k, nose, dir } = ev.train;
      // physically one frame's travel times the shutter, whatever the frame time is
      const blur = k.speed * frameDt * k.shutter, len = k.carL * k.cars, isExpress = k.wake > .5;
      const a = dir > 0 ? nose - len : nose, b = dir > 0 ? nose : nose + len;
      const x0 = Math.max(view[0] - 2, a - blur - 2), x1 = Math.min(view[0] + view[2] + 2, b + blur + 2);
      if (x1 <= x0) return;
      const bob = isExpress ? (Math.sin(time * 9.1) * .6 + (Math.sin(ev.train.tt * k.speed / 200 * 6.283) > .985 ? 1 : 0)) * k.bob : Math.sin(time * 2.7) * k.bob;
      let P = pShadow; ctx.use(P); ctx.bindTex(P, 'uSigM', 'sigMatte');
      gl.uniform1f(P.u.uNose, nose); gl.uniform1f(P.u.uDir, dir); gl.uniform1f(P.u.uLen, len); gl.uniform1f(P.u.uBlur, blur);
      ctx.quad(P, x0, 566, x1, 676);
      // a painted express has a pre-blurred strip for speed and the full paint for slow motion (under about 4 art px of tap spacing x 3)
      const atlas = k.sharp && blur < 14 && ctx.want('expPacked', k.sharp + 'A') ? k.sharp : k.atlas;
      P = pTrain; ctx.use(P); ctx.bindTex(P, 'uSigM', 'sigMatte'); ctx.bindTex(P, 'uSigFg', 'sigFg'); ctx.bindTex(P, 'uAtlas', atlas); ctx.bindTex(P, 'uAtlasA', atlas + 'A');
      gl.uniform1f(P.u.uNose, nose); gl.uniform1f(P.u.uDir, dir); gl.uniform1f(P.u.uCarL, k.carL); gl.uniform1f(P.u.uCars, k.cars); gl.uniform1f(P.u.uCols, k.cols);
      gl.uniform1f(P.u.uY0, k.y0); gl.uniform1f(P.u.uH, k.h); gl.uniform1f(P.u.uBlur, blur); gl.uniform1f(P.u.uFlare, 980); gl.uniform1f(P.u.uBob, bob); gl.uniform1f(P.u.uFlareAmt, isExpress ? .1 : 0);
      gl.uniform1f(P.u.uSharp, isExpress ? 0 : LOCAL_SHARP); gl.uniform1f(P.u.uTailLamp, k.sharp ? 1 : 0);
      gl.uniform1f(P.u.uGlassA, k.glass ? LOCAL_GLASS : 0); if (k.glass) gl.uniform4f(P.u.uGlass, k.glass[0], k.glass[1], k.glass[2], k.glass[3]);
      // only the local's wheels turn, blurred over the turn of one frame
      ctx.bindTex(P, 'uWheels', 'localWheels');
      gl.uniform1f(P.u.uWheelTurn, k.atlas === 'localPaint' ? 1 : 0); gl.uniform1f(P.u.uRoll, ev.train.tt * k.speed); gl.uniform1f(P.u.uSpin, k.speed * frameDt);
      ctx.quad(P, x0, k.y0 - 2, x1, k.y0 + k.h + 2);
    },
    // the dust plume hangs around after the tail has gone, so it is drawn whenever the wake is alive
    dust(ctx) {
      const { ev, view } = ctx;
      if (ev.wake > .01 && ev.wakeV > 1000) { ctx.use(pDust); ctx.quad(pDust, view[0], 580, view[0] + view[2], 712); }
    },
  },
});
})();

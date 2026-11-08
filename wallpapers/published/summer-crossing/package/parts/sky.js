'use strict';
// Sky: cloud strip over a clean plate behind the sky matte, high wisps, contrail, telegraph wires redrawn live. Plate, edge sky and matte: make_masks.py.
(() => {
const CLOUD_PX_S = 3.6;
// contrail: every 2.5-4 minutes, first at about 45 s. The test hook trailNow replaces it. Short-lived on purpose: the line is meant
// to stay close behind the plane rather than hang over the sky.
const TRAIL_LEN = 112;
let manualTrail = null;
const trailEnv = te => Math.min(te / 2, (TRAIL_LEN - te) / 8, 1);
function trailState(ctx, t) {
  const { hash, settings } = ctx;
  if (manualTrail !== null) { const te = t - manualTrail; if (te >= 0 && te < TRAIL_LEN) return [te, hash(manualTrail), trailEnv(te), hash(manualTrail + 2) * 40]; if (te >= TRAIL_LEN) manualTrail = null; }
  // its own fixed pace: it used to hang off the old Trains slider, whose every move made the plane jump. A still sky (Clouds 0) has none.
  if (!settings.contrail || settings.clouds <= 0) return [0, 0, 0, 0];
  let s = 45, k = 0;
  for (let g = 0; g < 10000 && t > s + TRAIL_LEN; g++) { s += 150 + 90 * hash(k + 31); k++; }
  const te = t - s; if (te < 0 || te > TRAIL_LEN) return [0, 0, 0, 0];
  return [te, hash(k + 5), trailEnv(te), hash(k + 9) * 40];
}
SC.part({
  title: 'Sky', order: 10,
  files: { skyPlate: 'assets/sky-plate.jpg', skyBehind: 'assets/sky-behind.jpg', cloudsPacked: 'assets/clouds.webp' },
  // on the GPU: the two sky plates stacked in one texture (one sampler less), and the cloud strip's packed halves (top premultiplied colour,
  // bottom alpha in grey) as an RGBA8 and an R8 texture, so the alpha half doesn't take four channels
  derive: [
    { key: 'skyP', fmt: 'RGBA8', w: 1672, h: 960, from: [['skyPlate', 0, 0, 1672, 480, 0, 0], ['skyBehind', 0, 0, 1672, 480, 0, 480]] },
    { key: 'clouds', fmt: 'RGBA8', w: 5088, h: 960, wrap: true, from: [['cloudsPacked', 0, 0, 5088, 960, 0, 0]] },
    { key: 'cloudsA', fmt: 'R8', w: 5088, h: 960, wrap: true, from: [['cloudsPacked', 0, 960, 5088, 960, 0, 0]] },
  ],
  samplers: { uSkyP: 'skyP', uClouds: 'clouds', uCloudsA: 'cloudsA' },
  uniforms: ['uTrail', 'uCloudOff', 'uCirrusOff', 'uWire', 'uWireT'],
  set(ctx, P) {
    const { gl, time } = ctx, tr = trailState(ctx, time);
    gl.uniform4f(P.u.uTrail, tr[0], tr[1], tr[2], tr[3]);
    gl.uniform1f(P.u.uCloudOff, (ctx.pace('clouds') * CLOUD_PX_S) % 2544);
    gl.uniform1f(P.u.uCirrusOff, (ctx.pace('clouds') * CLOUD_PX_S * .45) % 1e5);   // has no period of its own: tied to the strip's 2544 it would jump once a cycle
    gl.uniform1f(P.u.uWire, ctx.ev.wire); gl.uniform1f(P.u.uWireT, time % 100);
  },
  api: { trailNow(ctx, te) { manualTrail = ctx.time - (te || 0); } },   // test hook: the plane now
  backDecl: `
uniform sampler2D uSkyP,uClouds,uCloudsA;   // uSkyP: the clean sky plate on top, the painted sky behind the edges below
uniform vec4 uTrail;   // x: seconds since the plane came in, y: slope seed, z: on, w: seed
uniform float uCloudOff,uCirrusOff,uWire,uWireT;
const float STRIPW=2544.,STRIPH=480.,CIRRUS=.2;   // high wisps: the chosen variant, fixed
vec4 ctap(float u,float v){u=fract(u); return vec4(texture(uClouds,vec2(u,v)).rgb,texture(uCloudsA,vec2(u,v)).r);}
vec4 cloud(float u,float v,float d){return .5*(ctap(u-d,v)+ctap(u+d,v));}
`,
  backBody: `
  // the matte over the same footprint as I when the painting is minified, or thin parts lose pixels that I still holds
  float mSky=m;
  if(A.y<HOR&&uSS>.5){vec2 d=uTexel*.25;
    mSky=.25*(skyMatte(q-d)+skyMatte(q+d)+skyMatte(q+vec2(d.x,-d.y))+skyMatte(q+vec2(-d.x,d.y)));}
  if(A.y<HOR&&mSky<.998){
    float vv=A.y/STRIPH; vec3 P=texture(uSkyP,vec2(q.x,vv*.5)).rgb;
    float u0=A.x/STRIPW, du=uTexel.x*1672./STRIPW*.25;
    vec4 ct=cloud(u0-uCloudOff/STRIPW,vv,du);
    vec3 Pt=P;
    if(A.y<400.){
      // very high thin cloud: long combed wisps, far above the cumulus, so they drift slower and sit behind everything
      vec2 c=vec2(A.x*.98+A.y*.2-uCirrusOff,A.y*1.-A.x*.2);
      float wa=vn(c/vec2(420.,120.)+3.1);
      float n1=vn(vec2(c.x/360.+wa*1.4,c.y/26.+wa*2.2))*.55+vn(vec2(c.x/120.+wa,c.y/9.+wa*2.6+7.))*.3+vn(vec2(c.x/40.,c.y/3.6+wa*3.+2.))*.15;
      float pat=smoothstep(.42,.72,vn(c/vec2(700.,200.)+11.3));
      float cir=smoothstep(.5,.76,n1)*pat*(1.-smoothstep(240.,400.,A.y))*CIRRUS;
      Pt=mix(Pt,vec3(.86,.92,1.),cir*.34);
    }
    if(uTrail.z>0.&&A.y<420.){
      // the line runs from high right to lower left; age = seconds since the plane passed this point
      vec2 p0=vec2(-180.,18.+uTrail.y*46.),p1=vec2(1860.,300.+uTrail.y*70.),dr=normalize(p1-p0); float V=23.;
      vec2 rel=A-p0-vec2(uTrail.x*1.1,0.);
      float s=dot(rel,dr),dd=dot(rel,vec2(-dr.y,dr.x)),head=uTrail.x*V;
      float age=(head-s)/V;
      if(age>-.4){
        float life=8., w=.75+age*.055;
        dd+=(vn(vec2(s/120.,uTrail.w))-.5)*age*.16;
        float nn=vn(vec2(s/9.,age*.05+uTrail.w))*.55+vn(vec2(s/34.,uTrail.w+4.))*.45;
        float core=1.-smoothstep(w*(.55+.5*nn),w*(1.25+.9*nn),abs(dd));
        float dens=smoothstep(.7,2.4,age)*exp(-age/life)*(1.-smoothstep(life*2.2,life*3.4,age))*(.72+.5*nn);
        Pt=mix(Pt,vec3(.97,.98,1.),core*min(dens,.92)*uTrail.z);
        // the plane itself, a tiny bright speck ahead of the line
        float sp=length(vec2(s-head,dd));
        Pt=mix(Pt,vec3(1.,1.,.98),uTrail.z*(1.-smoothstep(.8,1.8,sp)));
      }
    }
    // edge pixels hold some painted sky: swap it for the sky of this moment
    vec3 St=Pt*(1.-ct.a)+ct.rgb, B0=texture(uSkyP,vec2(q.x,vv*.5+.5)).rgb;
    col=mix(St,I+(1.-mSky)*(St-B0),smoothstep(0.,.03,mSky));
    // the telegraph wires, redrawn live: they sag a little in the wind and ring after a train
    if(A.y<215.){
      float aa=max(uTexel.y*941.,.5), span=A.x<1226.?(A.x+300.)/1526.:(A.x-1302.)/700.;
      if(A.x<1226.||A.x>1302.){
        float xn=(A.x-836.)/836.;
        float sway=(1.3*sin(uTime*.37+span*2.)+.7*sin(uTime*.61+span*5.))*sin(3.14159*clamp(span,0.,1.));
        float ring=uWire*sin(3.14159*clamp(span,0.,1.))*(1.5*sin(uWireT*6.5+span*2.)+.45*sin(uWireT*10.+span*5.));
        float wy=sway*.5+ring;
        vec2 ya=A.x<1226.?vec2((((-7.4893*xn-9.0933)*xn-14.4494)*xn-64.003)*xn*xn-94.5503*xn+144.16,(((-5.3542*xn+1.7192)*xn+.0929)*xn-55.6949)*xn*xn-91.595*xn+158.4007)
                         :vec2(((27.2061*xn-176.8921)*xn+312.6985)*xn-42.5226,((-5.8227*xn-88.7338)*xn+232.9735)*xn+1.778);
        for(int i=0;i<2;i++){
          float d=abs(A.y-(ya[i]+wy*(1.+.12*float(i))));
          float w=1.-smoothstep(.52-aa*.5,.52+aa*.5,d);     // as wide as the painted wire and its stubs
          col=mix(col,vec3(.102,.137,.22),w);
        }
      }
    }
  }
`,
});
})();

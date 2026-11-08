'use strict';
// Rain Lantern Alley 2: Wallpaper Engine web wallpaper.
// One WebGL pass over a still painted plate (the painting is untouched at rest). Motion = separate layers + mask-confined effects:
//  - hanging lantern: a cut-out that swings about its hook over the exact plate; both lantern reflections in the puddle are true
//    vertical mirrors of the scene above, so they swing, flicker and light up with it
//  - noren curtain at the stall: five cut-out panels (own alpha, interior fill behind them) that sway from the top
//  - rain: 3 depth layers of slanted streaks (+ a faint near layer), lit warm near the lanterns, none inside the stall
//  - ripple rings on the ground plane, only inside the puddle mask; rare bigger drip; eave drips
//  - gusts and breezes, one cause: every 30-90 s (and a weaker breeze between) the rain slants and thickens as a sheet, the lantern swings, the noren and the leaves stir,
//    steam and mist lean away, the lamps dip, then everything settles
//  - steam from the pot (behind the noren), drifting mist at the far end of the alley, a lit window that dims now and then,
//    lantern light on the wet stones breathing with the lamps, very rare soft sheet lightning (mirrored in the puddle)
// Rules from kit/TEMPLATE.md: 0-100 sliders (50 = tuned, 0 = off), subtract-interval FPS limiter, setPaused, render scale.
(() => {
const canvas = document.querySelector('#scene');
const base = document.currentScript.src;
const file = n => new URL(n, base).href;
const STILL = file('still.jpg');
const ART = [1672, 941];               // art-space units (the painting at 1x); textures may be larger
const EXT = 140;                       // plate and masks carry painted ultrawide wings of EXT art px on both sides
const FOCUS = [836, 500];              // art-space point kept centred: lantern (y~117) to reflection bottom (y~893)
const MIN_VIEW_H = 800;                // at ultrawide show at least this much art height (the painted side wings fill the width)

const settings = { rain: 1, wind: 1, mist: 1, lights: 1, lightning: 1, quality: 1, fps: 30 };
const lab = { steam: 0, near: 1, leaves: 1, clouds: 1, bloom: 1 };          // development-page switches only (window.wallpaperLab); the defaults are what ships
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fromSlider = {
  rain: v => v / 50, wind: v => v / 50, mist: v => v / 50, lights: v => v / 50, lightning: v => v / 50,
  quality: v => clamp(v, 35, 100) / 100,
};
const weKeys = { rain: 'rain', wind: 'wind', mist: 'mist', lights: 'lights', lightning: 'lightning', renderscale: 'quality' };

let gl, program, U = {}, tex = {}, images = {};
let ready = false, lost = false, hostPaused = false;
let raf = 0, last = 0, acc = 0, pending = 0, time = 0, frames = 0, testMode = false;
let view = { x0: 0, y0: 0, k: 1 };

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

const VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FS = `%LOD%precision highp float;
#define TX(s,uv) %TXFN%
uniform sampler2D plate,ltop,masks,stall,fill,masks2,noise,clouds;
uniform vec2 res,origin;uniform float k;
uniform float tRain,tRip,rainAmt,ripAmt,ang,f1,f2;
uniform vec4 drip;               // x,y (art), age (s), strength
uniform float dShear,gustR,gustFront;   // rain: extra shear, gust strength, x of the gust's rain front (art px)
uniform float nd[5];             // noren panel hem displacement, art px (negative = left)
uniform vec3 wgain;              // lit window gains (left house, window cluster, upper window)
uniform vec4 fol;                // x,y = leaf noise offsets (fractions), z = amplitude (art px), w = gust leaf shake
uniform vec4 stm;                // x = steam time offset, y = steam amount, z = lean (px per px of height), w = style
uniform vec4 mst;                // x,y,z = mist noise offsets (fractions), w = amount
uniform vec4 lgt;                // x = flash, y = sheen amount, z = wet-stone shimmer time offset, w = near rain on/off
uniform vec2 cld;                // x = cloud drift (art px, wraps at 1000), y = clouds on
uniform vec4 misc;               // x = lantern bloom amount
uniform vec4 nw;                 // noren: x = wave amplitude at the hem, y = hem lift (art px), z = time, w = gust strength
uniform vec3 pC[6];              // low-order fit of the cloud-free sky reflection in the puddle
uniform vec3 skyC[10];           // cubic fit of the cloud-free sky gradient (art px coordinates), see build_clouds.py (not in this repo)
const vec2 ART=vec2(1672.,941.);const float EXT=140.;const vec2 TEX=vec2(1952.,941.);
const vec4 RT=vec4(452.,120.,93.,128.);const vec2 PT=vec2(493.,119.);
const float AXL=512.5,AXR=548.;                 // water lines: the painting's own reflection placement for each lantern
const vec4 ZL=vec4(438.,772.,558.,900.),ZR=vec4(1138.,736.,1264.,900.);   // reflection zones x0,y0,x1,y1
const float YH=585.,FOC=1200.,CX=836.;   // ground plane: horizon row, focal length (art px), centre column
const vec4 NB=vec4(1228.,40.,248.,338.); // noren box x,y,w,h (art px)

float h12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec2 h22(vec2 p){vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));q+=dot(q,q.yzx+33.33);return fract((q.xx+q.yz)*q.zy);}
vec2 mir(vec2 a){a.x=clamp(a.x,-EXT,ART.x+EXT);return a;}
vec2 T(vec2 a){return vec2(a.x+EXT,a.y)/TEX;}   // art px -> plate/mask uv

vec4 layer(sampler2D t,vec4 r,vec2 pv,float an,vec2 a){
  vec2 d=a-pv;float c=cos(an),s=sin(an);
  vec2 uv=(vec2(c*d.x+s*d.y,-s*d.x+c*d.y)+pv-r.xy)/r.zw;
  if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)return vec4(0.);
  return TX(t,uv);
}
vec3 lit(vec3 c,float f){float w=smoothstep(.25,.75,c.r);return c*mix(1.,f,w);}

// ---- noren: 5 cut-out panels hanging from the rod. rest alpha > 0 means "covered by cloth at rest": the fill shows there
// when a panel has swayed away. Each panel is sheared sideways in proportion to (height below the rod)^1.5.
vec4 PG(int i){                                 // x0,x1 (art px, seam to seam), y of the top attachment, y of the hem (panel centre)
  if(i==0)return vec4(1228.,1271.,168.,360.);
  if(i==1)return vec4(1271.,1304.5,150.,351.);
  if(i==2)return vec4(1304.5,1345.,129.,341.);
  if(i==3)return vec4(1345.,1386.,106.,330.);
  return vec4(1386.,1480.,72.,314.);
}
vec3 withNoren(vec3 c,vec2 a,float gf){
  if(a.x<NB.x||a.x>NB.x+NB.z||a.y<NB.y||a.y>NB.y+NB.w)return c;
  vec2 uv0=(a-NB.xy)/NB.zw;
  float restA=TX(stall,uv0).a;
  vec4 pm=vec4(0.);
  for(int i=0;i<5;i++){
    vec4 pg=PG(i);
    float fi=float(i);
    float hh=clamp((a.y-pg.z)/(pg.w-pg.z),0.,1.);               // 0 at the rod (fixed), 1 at the hem
    float u=clamp((a.x-pg.x)/(pg.y-pg.x),0.,1.);               // across the panel
    float ph=fi*1.9+.7;
    float wv=sin(hh*4.4-nw.z*3.5+ph);                            // a wave running down the cloth (about 0.56 Hz)
    float wv2=sin(hh*7.5-nw.z*5.2+ph*1.7+u*1.3);               // a finer, faster one that grows with the gust
    float dx=nd[i]*pow(hh,1.35)+hh*(nw.x*wv+nw.w*1.1*wv2)+(u-.5)*hh*hh*nw.x*.22*sin(nw.z*2.3+ph);   // lean + waves + a little bow
    float lift=hh*hh*nw.y*sin(u*3.1+ph-nw.z*2.9);               // the hem rises and falls along its length (a rippling hem)
    vec2 sp=vec2(a.x-dx,a.y-lift);
    if(sp.x>=pg.x&&sp.x<pg.y){
      vec4 L=TX(stall,(sp-NB.xy)/NB.zw);
      pm=vec4(L.rgb*L.a,L.a)+pm*(1.-L.a);
    }
  }
  vec3 b=restA>.003?TX(fill,uv0).rgb*gf:c;
  return pm.rgb*gf+b*(1.-pm.a);
}

// ---- noise: a tileable texture baked at start-up (r = soft, g = medium, b = fine, a = broad), sampled by leaves, steam, mist and the stone shimmer

// ---- leaves: a slow coherent stir inside the foliage mask (branch-scale, not pixel noise)
vec2 leafDisp(vec2 a,float w){
  float n1=TX(noise,a*.0075+fol.xy).g-.5;
  float n2=TX(noise,a*.0075+fol.xy+vec2(.37,.61)).g-.5;
  float n3=TX(noise,a*.024+fol.xy*2.7).b-.5;
  float n4=TX(noise,a*.024+fol.xy*2.7+vec2(.5,.2)).b-.5;
  return vec2(n1*2.4+n3*1.2*fol.w,n2*1.4+n4*.8*fol.w)*fol.z*w;
}

// ---- clouds: the painted clouds are a cut-out strip (RGBA) that drifts left over the clean sky gradient, wrapping every 1000 art px.
// At rest (drift 0) the frame is the painting. Roofs, leaves and the mountain are never covered: the strip is clipped to the sky mask.
const vec4 CB=vec4(480.,185.,530.,171.),PB=vec4(480.,722.,530.,171.);   // sky strip box and the puddle strip box (art px); one atlas, sky on top
vec3 skyFit(vec2 a){
  float u=(a.x-720.)/350.,v=(a.y-200.)/250.;
  return skyC[0]+skyC[1]*v+skyC[2]*v*v+skyC[3]*v*v*v+u*(skyC[4]+skyC[5]*v+skyC[6]*v*v)+u*u*(skyC[7]+skyC[8]*v)+u*u*u*skyC[9];
}
vec3 puddleFit(vec2 a){
  float u=(a.x-760.)/300.,v=(a.y-810.)/90.;
  return pC[0]+pC[1]*u+pC[2]*v+pC[3]*u*v+pC[4]*v*v+pC[5]*u*v*v;
}
vec3 cloudsFx(vec3 c,vec2 a,float sky){
  if(cld.y<.5||a.x<380.||a.x>1100.)return c;
  bool inS=a.y>=CB.y&&a.y<=CB.y+CB.w,inP=a.y>=PB.y&&a.y<=PB.y+PB.w;     // the sky, and its painted reflection in the puddle
  if(!inS&&!inP)return c;
  vec4 B=inS?CB:PB;float row=inS?0.:.5;
  vec2 ur=(a-B.xy)/B.zw;
  vec3 base=c;
  if(a.x>=B.x&&a.x<B.x+B.z){                     // where a cloud was painted the sky is replaced by its clean gradient (faint cloud edges keep the painting)
    float ar=TX(clouds,vec2(ur.x,row+ur.y*.5)).a;
    if(ar>.2)base=mix(c,inS?skyFit(a):puddleFit(a),smoothstep(.2,.55,ar)*smoothstep(.45,.95,sky));
  }
  float xs=B.x+mod(a.x-B.x+cld.x,1000.);
  vec4 L=xs<B.x+B.z?TX(clouds,vec2((xs-B.x)/B.z,row+ur.y*.5)):vec4(0.);
  float fx=inS?1.:smoothstep(562.,640.,a.x);      // reflected clouds fade out before the lantern's mirrored zone, so no cloud is ever cut by its edge
  return mix(base,L.rgb,L.a*fx*smoothstep(.45,.95,sky));
}

// warm light of the lanterns scattered by the damp air: a soft glow that breathes with each lamp and follows the swinging one.
// Above the water it is added to the scene; in the puddle it is added again as the glow's own reflection (mirrored about each water line,
// fading smoothly towards the puddle rim), never through the mirrored-zone box, so no edge exists at any swing angle.
vec2 lampC(){float cs=cos(ang),sn=sin(ang);return PT+vec2(cs*5.-sn*65.,sn*5.+cs*65.);}   // centre of the swinging lantern
float halo(vec2 a,vec2 c,vec2 r1,vec2 r2){vec2 d1=(a-c)/r1,d2=(a-c)/r2;return exp(-dot(d1,d1))+.45*exp(-dot(d2,d2));}
vec3 bloomFx(vec3 c,vec2 a){
  if(misc.x<=0.)return c;
  float g1=halo(a,lampC(),vec2(46.,56.),vec2(150.,170.))*f1,g2=halo(a,vec2(1196.,278.),vec2(46.,66.),vec2(150.,190.))*f2;
  return c+vec3(1.,.5,.2)*(g1+g2)*.17*misc.x;
}
vec3 bloomPuddle(vec3 c,vec2 a,float pm){
  if(misc.x<=0.||pm<=.004)return c;
  vec2 l=lampC();
  float g1=halo(vec2(a.x,2.*AXL-a.y),l,vec2(46.,56.),vec2(120.,110.))*f1,g2=halo(vec2(a.x,2.*AXR-a.y),vec2(1196.,278.),vec2(46.,66.),vec2(120.,120.))*f2;
  float rim=smoothstep(690.,800.,a.y);
  return c+vec3(1.,.5,.2)*(g1+g2)*.13*misc.x*pm*rim;
}

vec3 lightning(vec3 c,vec2 a,float sky){        // sheet lightning behind the clouds: multiplicative, so clouds stay dark shapes
  if(lgt.x<=.001||sky<=.003)return c;
  vec2 ag=a.y>620.?vec2(a.x,1030.-a.y):a;      // the puddle shows the sky mirrored: its gradient follows
  vec2 d=(ag-vec2(640.,230.))/vec2(560.,320.);
  float g=exp(-dot(d,d));
  float flash=lgt.x*sky;
  return c*(1.+flash*(.10+.30*g))+vec3(.16,.22,.42)*flash*(.03+.4*g)*.4;
}

vec3 plateAt(vec2 a,out vec4 m2){                // the painting with the lamps' flicker, leaf stir, window and stone-light life
  vec4 mk2=TX(masks2,T(a));
  vec2 p=a;
  if(mk2.r>.004&&fol.z>0.)p+=leafDisp(a,mk2.r);
  vec3 c=cloudsFx(TX(plate,T(p)).rgb,a,mk2.g);
  float fl=a.x<836.?f1:f2;
  c*=1.+(fl-1.)*TX(masks,T(a)).g*1.6;
  if(mk2.b>.004){                                // windows: slow breathing + now and then one dims (like a lamp turned down)
    float gw=a.x<700.?wgain.x:a.x<900.?wgain.y:wgain.z;
    c*=1.+(gw-1.)*mk2.b*vec3(1.,.93,.78)*1.0;
  }
  if(mk2.a>.004&&lgt.y>0.){                      // lantern light on the wet stones breathes with the lamps and drifts slowly
    float s=TX(noise,a*vec2(.0042,.011)+vec2(lgt.z,-lgt.z*.4)).a-.5;
    c*=1.+mk2.a*lgt.y*((fl-1.)*1.5+s*.45);
  }
  m2=mk2;
  return c;
}
vec3 upper(vec2 a){                            // the scene above the water: plate + noren + swinging lantern, with flicker
  vec4 m2;vec3 c=plateAt(a,m2);
  float gf=1.+((a.x<836.?f1:f2)-1.)*TX(masks,T(a)).g*1.6;
  c=withNoren(c,a,gf);
  vec4 L=layer(ltop,RT,PT,ang,a);return mix(c,lit(L.rgb,f1),L.a);
}
float zoneW(vec2 a,vec4 z,float fe){vec2 d=min(a-z.xy,z.zw-a);return clamp(min(d.x,d.y)/fe,0.,1.);}
vec3 mirrorRefl(vec2 a,float ax){                // true (flipped) reflection about the water line ax, softened, puddle-tinted
  vec2 b=vec2(a.x,2.*ax-a.y);
  vec3 r=.5*upper(b)+.25*upper(b+vec2(0.,1.))+.25*upper(b-vec2(0.,1.));
  return r*vec3(.9,.86,.84)+vec3(.01,.004,0.);
}

// ---- steam from the pot: soft wisps that rise from the lid, widen, thin out and dissolve within about 70 art px (behind the noren: drawn
// before it). The lean with the wind is capped (about 11 degrees). Style 0 = wisps (default); style 1 = a smokier, broader variant.
vec3 steamFx(vec3 c,vec2 a){
  if(stm.y<=0.||a.x<1290.||a.x>1456.||a.y<306.||a.y>404.)return c;
  float tot=0.;
  for(int i=0;i<4;i++){
    float fi=float(i);
    vec3 sp=fi<.5?vec3(1356.,393.,0.):fi<1.5?vec3(1381.,378.,1.7):fi<2.5?vec3(1404.,390.,3.1):vec3(1368.,386.,4.4);   // x, y of the source, phase
    float hh=sp.y-a.y;if(hh<-2.)continue;
    float hn=clamp(hh/(stm.w<.5?70.:90.),0.,1.);
    float ph=stm.x*(.55+.1*fi)-hh*.06+sp.z;
    float cx=sp.x+stm.z*hh+sin(ph)*(1.+7.*hn)+sin(ph*.47+sp.z)*2.5*hn;
    float dx=a.x-cx;
    float wd=stm.w<.5?(2.6+10.*hn):(3.2+13.*hn);                      // widens as it rises
    float prof=exp(-dx*dx/(wd*wd));
    float vn=TX(noise,vec2(a.x*.026+fi*.31,a.y*.016+stm.x*.12)).g;     // slow drifting texture inside the wisp
    float life=smoothstep(0.,.08,hn)*pow(1.-hn,1.3);                  // soft start, dissolves with height
    tot+=prof*life*(.5+1.0*vn)*(stm.w<.5?1.0:1.2)*(.7+.3*h12(vec2(fi,3.)));
  }
  tot=clamp(tot,0.,.7)*stm.y;
  vec3 sc=vec3(1.,.87,.7);
  return mix(c,sc,tot*.6);
}

vec3 scene(vec2 a,float glowM){
  vec4 m2;vec3 c=plateAt(a,m2);
  float gf=1.+((a.x<836.?f1:f2)-1.)*glowM*1.6;
  c=steamFx(c,a);
  c=withNoren(c,a,gf);
  vec4 L=layer(ltop,RT,PT,ang,a);c=mix(c,lit(L.rgb,f1),L.a);
  c=bloomFx(c,a);
  // the painted reflections of both lanterns were upright; they are replaced by mirrored copies of the real lanterns
  float pm=0.;
  if(a.y>640.){
    float wl=zoneW(a,ZL,22.),wr=zoneW(a,ZR,24.);
    pm=TX(masks,T(a)).r;
    if(wl>0.)c=mix(c,mirrorRefl(a,AXL),wl*pm);
    if(wr>0.)c=mix(c,mirrorRefl(a,AXR),wr*pm);
    c=bloomPuddle(c,a,pm);
  }
  // sheet lightning lifts the sky; in the puddle the same lift is applied to whatever blue sky reflection is there (found by colour), so the
  // painted reflection and the mirrored zones are lit alike and no box shows
  float ws=a.y<620.?m2.g:pm*clamp((c.b-c.r-.06)/.10,0.,1.)*clamp((c.b-.16)/.12,0.,1.);
  return lightning(c,a,ws);
}
// one family of expanding rings around ground-plane centre ctr; returns ground-plane gradient (xy) and height (z)
vec3 ring(vec2 d,float age,float life,float rmax,float w0){
  if(age<0.||age>life)return vec3(0.);
  float u=age/life,r=rmax*sqrt(u),w=w0*(1.+u),dist=max(length(d),1e-4);
  float x=(dist-r)/w,x2=(dist-r*.55)/w;
  float fade=(1.-u)*(1.-u);
  float hgt=(sin(x*2.4)*exp(-x*x)+.5*sin(x2*2.4)*exp(-x2*x2))*fade;
  return vec3(d/dist*hgt,hgt);
}
vec3 ripples(vec2 a){
  float dy=a.y-YH;if(dy<30.)return vec3(0.);
  vec2 g=vec2((a.x-CX)/dy,FOC/dy);            // ground plane, camera-height units
  vec3 acc=vec3(0.);
  vec2 nl1=(a-vec2(505.,850.))/vec2(130.,75.),nl2=(a-vec2(1200.,830.))/vec2(130.,90.);
  float nearL=max(exp(-dot(nl1,nl1)),exp(-dot(nl2,nl2)));         // more rings beside the lantern reflections, where the eye goes
  float dens=(.22+.2*min(ripAmt,2.))+.32*nearL;
  for(int i=0;i<2;i++){
    float fi=float(i);float cell=.5;
    vec2 gp=g/cell+fi*vec2(.5,.37);vec2 id=floor(gp);vec2 fp=fract(gp)-.5;
    vec2 h=h22(id+fi*17.3);float P=1.1+.8*h.x;
    float cy=tRip/P+h.y*13.;float n=floor(cy);float age=fract(cy)*P;
    if(h12(id*1.37+n*.731+fi*3.1)>dens)continue;
    vec2 ctr=(h22(id+n*1.71+fi)-.5)*.12;
    acc+=ring((fp-ctr)*cell,age,.95,.2,.022);
  }
  if(drip.w>0.){vec2 gd=vec2((drip.x-CX)/(drip.y-YH),FOC/(drip.y-YH));
    acc+=ring(g-gd,drip.z,2.2,.42,.035)*1.6*drip.w+ring(g-gd,drip.z-.35,1.8,.3,.03)*drip.w;}
  // ground displacement -> art px (x scales with dy, z with dy^2/FOC)
  return vec3(acc.x*dy,-acc.y*dy*dy/FOC,acc.z);
}
float rainL(vec2 a,vec2 cs,float speed,float lenF,float wArt,float dens,float seed){
  vec2 p=vec2(a.x+a.y*.16+(a.y-500.)*dShear,a.y-tRain*speed*(1.+.12*gustR));
  vec2 gp=p/cs;vec2 id=floor(gp);vec2 f=fract(gp);
  if(h12(id+seed)>dens)return 0.;
  float ox=.1+.8*h12(id+seed+5.1),oy=h12(id+seed+9.7)*(1.-lenF);
  float dx=abs(f.x-ox)*cs.x/k;                  // canvas px
  float wpx=wArt/k;
  float ix=clamp(1.-dx/(max(wpx,.7)+.5),0.,1.)*min(1.,wpx/.7+.35);
  float ty=(f.y-oy)/lenF;
  float iy=ty<0.||ty>1.?0.:sqrt(sin(3.14159*ty))*mix(.55,1.,ty);
  return ix*iy*(.55+.45*h12(id+seed+2.3));
}
float lampLight(vec2 a){
  vec2 d1=(a-vec2(494.,182.))/150.,d2=(a-vec2(1196.,278.))/140.,d3=(a-vec2(1360.,410.))/210.;
  return exp(-dot(d1,d1))*f1+exp(-dot(d2,d2))*f2+.45*exp(-dot(d3,d3))*f2;
}
// splash tick: impact at art point c (ground), age u in 0..1, crown height hs art px; a thin bright spike + two side droplets
float tick(vec2 q,float u,float hs){
  if(u<0.||u>1.)return 0.;
  float up=hs*sin(3.14159*min(u*1.3,1.)),w=max(.5*k,hs*.07);
  float col=clamp(1.-abs(q.x)/(w+.6*k),0.,1.)*step(-up,q.y)*step(q.y,w)*(.6+.4*(-q.y/max(up,1e-3)));
  vec2 d1=q-vec2(-hs*.45*u,-up*.55),d2=q-vec2(hs*.45*u,-up*.5);
  float rr=max(.9*k,hs*.06);
  float dots=clamp(1.5-length(d1)/rr,0.,1.)+clamp(1.5-length(d2)/rr,0.,1.);
  return (col+.7*dots)*(1.-u);
}
// rain splash ticks on the wet paving, on the same ground plane as the ripples (perspective-sized, ~0.15 s each)
float splashes(vec2 a){
  float dy=a.y-YH;if(dy<12.)return 0.;
  vec2 g=vec2((a.x-CX)/dy,FOC/dy);
  float cell=.22,acc=0.,dens=(.45+.2*gustR)*min(rainAmt,2.);
  vec2 gp=g/cell;vec2 id0=floor(gp);
  for(int j=0;j<2;j++){                         // the tick rises above its impact: also check the nearer row
    vec2 id=id0-vec2(0.,float(j));
    vec2 h=h22(id+3.7);float P=.7+.7*h.x;
    float cy=tRip/P+h.y*9.;float n=floor(cy);float age=fract(cy)*P;
    if(age>.16||h12(id*2.13+n*.37)>dens)continue;
    vec2 gc=(id+.5+(h22(id+n*1.3)-.5)*.8)*cell;
    float dyc=FOC/gc.y;vec2 ac=vec2(CX+gc.x*dyc,YH+dyc);
    acc+=tick(a-ac,age/.16,dyc*.05);
  }
  return acc;
}
// a few slow drips from the stall roof edge: falling drop, then a tick and a small ring on the paving
const float GY=622.;
vec3 drips(vec2 a){                             // x = drop/tick brightness, y = ring height, z = lamp-lit bead and glint at the eave
  vec3 r=vec3(0.);
  for(int i=0;i<4;i++){
    float fi=float(i);
    vec2 e=fi<.5?vec2(1135.,152.):fi<1.5?vec2(1212.,114.):fi<2.5?vec2(1291.,80.):vec2(1368.,46.);
    if(abs(a.x-e.x)>40.)continue;
    float P=3.1+1.3*fi*.73;float cy=tRip/P+fi*.37;float n=floor(cy);float t=fract(cy)*P-1.2*h12(vec2(n,fi));
    float tf=.62,L=GY-e.y;
    if(t>-1.&&t<=0.){                           // a bead swells at the eave tip and catches the lantern light, then lets go
      float u=(t+1.)/1.;float rad=.6+2.2*u*u;
      vec2 q=(a-vec2(e.x,e.y+rad*.7))/vec2(rad*.8,rad);
      r.z+=clamp(1.2-length(q),0.,1.)*(.3+.7*u);
    }
    if(t>0.&&t<tf){
      float u=t/tf,y=e.y+L*u*u,v=2.*L*u/tf,len=max(3.,v*.012);
      vec2 q=a-vec2(e.x,y);
      r.x+=clamp(1.-abs(q.x)/(1.6*k+.8),0.,1.)*step(-len,q.y)*step(q.y,1.5)*pow(clamp(1.+q.y/len,0.,1.),2.)*1.5;
      r.z+=clamp(1.2-length(vec2(q.x,q.y+1.5))/(1.6+.5*k),0.,1.)*.8;        // the head of the falling drop catches the light
    } else if(t>=tf&&t<tf+1.2){
      float age=t-tf;float dy=GY-YH;
      r.x+=tick(a-vec2(e.x,GY),age/.2,dy*.05)*1.6;
      vec2 g=vec2((a.x-CX)/(a.y-YH),FOC/max(a.y-YH,1.)),gd=vec2((e.x-CX)/dy,FOC/dy);
      r.y+=ring(g-gd,age,1.1,.14,.02).z;
    }
  }
  return r;
}
// drifting mist at the far end of the alley and along the far paving, two slow layers moving against each other
vec3 mistFx(vec3 c,vec2 a){
  if(mst.w<=0.)return c;
  float behind=smoothstep(585.,615.,a.x)*(1.-smoothstep(690.,745.,a.x));      // only behind the far end wall: the mid-distance house (x > 745) and the left houses stay clear
  float zone=behind*smoothstep(420.,470.,a.y)*(1.-smoothstep(560.,610.,a.y));
  vec2 dr=(a-vec2(660.,425.))/vec2(170.,32.);
  float ridge=exp(-dot(dr,dr))*behind;     // a band along the foot of the mountain
  float w=max(zone*.8,ridge);
  if(w<=.003)return c;
  float n1=TX(noise,a*vec2(.0021,.0046)+mst.xy).a;
  float n2=TX(noise,a*vec2(.0049,.0098)+mst.zx).g;
  float d=smoothstep(.28,.85,n1*.62+n2*.38);
  vec2 dw=(a-vec2(840.,462.))/vec2(130.,100.);
  float warm=exp(-dot(dw,dw))*(.55+.45*wgain.y);        // the lit windows tint the mist near them
  vec3 mc=mix(vec3(.26,.37,.6),vec3(.95,.62,.36),warm*.8);
  float al=w*d*min(mst.w,1.6)*(1.-.8*TX(masks2,T(a)).r);       // less haze over foliage
  return c*(1.-.22*al)+mc*al*.42;
}
void main(){
  vec2 a=origin+vec2(gl_FragCoord.x,res.y-gl_FragCoord.y)*k;   // art px, y down
  vec2 m=mir(a);
  vec4 mk=TX(masks,T(m));
  vec3 c;
  if(mk.r>.004&&ripAmt>0.){
    vec3 rp=ripples(m);
    float s=mk.r*min(ripAmt,2.);
    vec2 a2=mir(m+rp.xy*.011*s);
    c=scene(a2,TX(masks,T(a2)).g);
    c+=(c*.6+vec3(.10,.13,.20))*rp.z*.75*s;
  } else c=scene(m,mk.g);
  c=mistFx(c,m);
  if(rainAmt>0.){
    float dn=min(rainAmt,1.)*.5+max(rainAmt-1.,0.)*.25;
    float front=1.+gustR*(.2+.85*exp(-dot(vec2((m.x-gustFront)/320.),vec2((m.x-gustFront)/320.))));     // a denser sheet of rain sweeps through with the gust
    dn*=front;
    float r=rainL(m,vec2(7.,80.),720.,.30,.45,dn,1.)*.55
           +rainL(m,vec2(13.,130.),1050.,.30,.7,dn*.9,7.)*.8
           +rainL(m,vec2(26.,240.),1550.,.24,1.2,dn*.75,13.);
    if(lgt.w>.5)r+=rainL(m,vec2(70.,360.),2300.,.34,3.4,dn*.22,21.)*.38;    // faint out-of-focus streaks close to the lens
    float L=clamp(lampLight(m),0.,1.4);
    float lum=dot(c,vec3(.3,.55,.15));
    float dark=1.-smoothstep(.08,.5,lum);         // sky-light catch: streaks stay readable over the dark walls
    vec3 rc=vec3(.48,.58,.78)*(.6+1.2*dark)+vec3(1.,.66,.38)*L*1.6;
    rc*=1.+lgt.x*2.2*TX(masks2,T(m)).g+.25*gustR;
    c+=rc*r*mk.b*(.22+.06*min(rainAmt,2.))*min(rainAmt,1.);
    float sp=splashes(m)*mk.a;
    c+=(vec3(.5,.6,.8)*.6+vec3(1.,.7,.45)*L*1.3)*sp*.8*min(rainAmt,1.5);
  }
  if(rainAmt>0.||ripAmt>0.){
    vec3 dr=drips(m);
    float L2=clamp(lampLight(m),0.,1.4);
    c+=(vec3(.55,.62,.8)*.5+vec3(1.,.7,.45)*L2*1.3)*dr.x*.6*min(max(rainAmt,ripAmt),1.);
    c+=vec3(1.,.74,.46)*dr.z*(.5+.5*clamp(L2,0.,1.))*min(max(rainAmt,ripAmt),1.);
    c+=(c*.6+vec3(.08,.1,.15))*dr.y*.6*mk.a*min(ripAmt,1.5);
  }
  c+=vec3(.010,.014,.032)*lgt.x;                  // the flash lifts the whole scene a touch
  gl_FragColor=vec4(c,1.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}
function upload(img, rgba, repeat) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  for (const [k2, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, wrap], [gl.TEXTURE_WRAP_T, wrap]]) gl.texParameteri(gl.TEXTURE_2D, k2, v);
  const f = rgba ? gl.RGBA : gl.RGB;
  if (img.data) gl.texImage2D(gl.TEXTURE_2D, 0, f, img.w, img.h, 0, f, gl.UNSIGNED_BYTE, img.data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, f, f, gl.UNSIGNED_BYTE, img);
  return t;
}
// tileable noise baked at start-up (no asset): 4 channels of periodic value noise at different scales
function makeNoise(N) {
  const hs = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const oct = (f, seed) => {
    const g = new Float32Array(f * f); for (let y = 0; y < f; y++) for (let x = 0; x < f; x++) g[y * f + x] = hs(x, y, seed);
    const o = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N * f, v = y / N * f, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const a = g[(y0 % f) * f + (x0 % f)], b = g[(y0 % f) * f + ((x0 + 1) % f)], c = g[((y0 + 1) % f) * f + (x0 % f)], d = g[((y0 + 1) % f) * f + ((x0 + 1) % f)];
      o[y * N + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
    return o;
  };
  const chans = [[4, 8], [8, 16], [16, 32], [3, 6]];      // r soft clouds, g medium, b fine, a broad: cells per tile of the two octaves
  const data = new Uint8Array(N * N * 4);
  chans.forEach((fr2, ci) => {
    const acc = new Float32Array(N * N); let wsum = 0;
    fr2.forEach((f, oi) => { const w = oi ? .5 : 1; const o = oct(f, ci * 10 + oi + 1); for (let i = 0; i < acc.length; i++) acc[i] += o[i] * w; wsum += w; });
    for (let i = 0; i < acc.length; i++) { let v = acc[i] / wsum; v = (v - .5) * 1.9 + .5; data[i * 4 + ci] = Math.round(clamp(v, 0, 1) * 255); }
  });
  return { data, w: N, h: N };
}
function setup() {
  program = gl.createProgram();
  // explicit-LOD fetches (no mip-maps are used) let the GPU compiler really skip the branches below: without it ANGLE/D3D tends to run
  // every branch for every pixel, because sampling with implicit derivatives is not allowed inside non-uniform flow
  const lod = !!gl.getExtension('EXT_shader_texture_lod');
  const fs = FS.replace('%LOD%', lod ? '#extension GL_EXT_shader_texture_lod : enable\n' : '').replace('%TXFN%', lod ? 'texture2DLodEXT(s,uv,0.)' : 'texture2D(s,uv)');
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const names = [['plate', false], ['ltop', true], ['masks', true], ['stall', true], ['fill', false], ['masks2', true], ['noise', true], ['clouds', true]];
  images.noise = makeNoise(256);
  names.forEach(([n, rgba], i) => { gl.activeTexture(gl.TEXTURE0 + i); tex[n] = upload(images[n], rgba, n === 'noise'); });
  U = {};
  const un = ['res', 'origin', 'k', 'tRain', 'tRip', 'rainAmt', 'ripAmt', 'ang', 'f1', 'f2', 'drip', 'dShear', 'gustR', 'gustFront', 'wgain', 'fol', 'stm', 'mst', 'lgt', 'cld', 'misc', 'nw'];
  for (const n of [...names.map(x => x[0]), ...un]) U[n] = gl.getUniformLocation(program, n);
  U.nd = gl.getUniformLocation(program, 'nd[0]');
  U.skyC = gl.getUniformLocation(program, 'skyC[0]');
  gl.uniform3fv(U.skyC, SKY_COEF);
  U.pC = gl.getUniformLocation(program, 'pC[0]');
  gl.uniform3fv(U.pC, PUD_COEF);
  names.forEach(([n], i) => gl.uniform1i(U[n], i));
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
  // framing: cover-fit, but never less than MIN_VIEW_H of art height (ultrawide shows painted side wings instead)
  const asp = w / h, [AW, AH] = ART;
  const vh = Math.max(Math.min(AH, AW / asp), Math.min(AH, MIN_VIEW_H, (AW + 2 * EXT) / asp)), vw = vh * asp;
  const y0 = clamp(FOCUS[1] - vh / 2, 0, AH - vh);
  const x0 = vw <= AW ? clamp(FOCUS[0] - vw / 2, 0, AW - vw) : clamp(FOCUS[0] - vw / 2, -EXT, AW + EXT - vw);
  view = { x0, y0, k: vh / h };
  if (ready) draw();
}

// ---- time-driven signals (deterministic in time, so seek(t) and any FPS give the same picture)
const TAU = Math.PI * 2;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Gusts: one 60 s window each, starting 8-38 s into it, so they come 30-90 s apart. Envelope: soft rise (30%), slower fall.
const GP = 60;
const gustEvent = i => ({ t0: i * GP + 8 + 30 * hash(i * 5.3 + 1.7), dur: 9 + 3.5 * hash(i * 2.7 + .3), amp: .8 + .2 * hash(i * 9.1 + 4.4) });
// a half-gust "breeze" (about a third of the strength) late in each window, so something leans visibly every 30 s or so, not only once a minute
const breezeEvent = i => ({ t0: i * GP + 52 + 4 * hash(i * 3.3 + .9), dur: 7.5 + 2 * hash(i * 6.1 + 2.2), amp: .3 + .06 * hash(i * 1.7 + 8.8) });
const shape = u => u < .3 ? .5 * (1 - Math.cos(Math.PI * u / .3)) : .5 * (1 + Math.cos(Math.PI * (u - .3) / .7));
function gustAt(t) {                                   // {g: 0..1 strength, u: 0..1 progress of the running event (or -1), i: its index}
  const i0 = Math.floor(t / GP);
  for (const i of [i0, i0 - 1]) {
    if (i < 0) continue;
    for (const e of [gustEvent(i), breezeEvent(i)]) {
      const u = (t - e.t0) / e.dur;
      if (u > 0 && u < 1) return { g: e.amp * shape(u), u, i };
    }
  }
  return { g: 0, u: -1, i: i0 };
}
function gustIntegral(t) {                              // integral of the gust strength from 0 to t (for the drift of mist and the like)
  let s = 0;
  const i0 = Math.floor(t / GP);
  for (let i = 0; i <= i0; i++) {
    for (const e of [gustEvent(i), breezeEvent(i)]) {
      const u = clamp((t - e.t0) / e.dur, 0, 1);
      const rise = Math.min(u, .3) / .3, fall = u > .3 ? (u - .3) / .7 : 0;
      s += e.amp * e.dur * (.3 * .5 * (rise - Math.sin(Math.PI * rise) / Math.PI) + (u > .3 ? .7 * .5 * (fall + Math.sin(Math.PI * fall) / Math.PI) : 0));
    }
  }
  return s;
}
// the hanging lantern: ambient sway (as before) + a damped pendulum pushed by the gust (angle > 0 = leans left)
const pend = { t: 0, th: 0, om: 0 };
function lanternGust(t) {
  const W = TAU / 3.9, Z = .13, K = .085, dt = 1 / 60;
  if (t < pend.t - 1e-6 || t - pend.t > 20) { pend.t = Math.max(0, (Math.floor(t / GP) - 1) * GP); pend.th = 0; pend.om = 0; }
  while (pend.t < t) {
    const h = Math.min(dt, t - pend.t), force = K * gustAt(pend.t).g;
    pend.om += h * (W * W * (force - pend.th) - 2 * Z * W * pend.om); pend.th += h * pend.om; pend.t += h;
  }
  return pend.th;
}
function flick(t, seed) {
  const n = 0.5 * Math.sin(TAU * 0.23 * t + seed) + 0.3 * Math.sin(TAU * 0.57 * t + seed * 2.1) + 0.2 * Math.sin(TAU * 1.31 * t + seed * 3.7);
  // a soft flutter every so often (1.2 s, shallow)
  const P = 13 + 5 * seed, i = Math.floor(t / P), ph = (t - i * P) - 4 * hash(i + seed);
  const flutter = ph > 0 && ph < 1.2 ? Math.sin(Math.PI * ph / 1.2) * (0.5 + 0.5 * Math.sin(TAU * 7 * ph)) : 0;
  const g = gustAt(t).g;                               // in a gust the flames lean: a slow dip with a gentle wobble
  return 1 + settings.lights * (0.07 * n - 0.09 * flutter - g * (0.07 + 0.025 * Math.sin(TAU * .9 * t + seed * 4)));
}
function swing(t) {
  const env = 0.7 + 0.3 * Math.sin(TAU * t / 19 + 0.7) + 0.15 * Math.sin(TAU * t / 7.3);
  const amb = 0.078 * env * (0.78 * Math.sin(TAU * t / 3.9) + 0.22 * Math.sin(TAU * t / 2.45 + 1.3));   // about +-4 degrees, a slow visible pendulum
  return settings.wind * (amb + lanternGust(t));
}
// noren panels: per-panel lean at the hem (art px, negative = left) plus a wave that runs down the cloth, strength in nw.
// Ambient: a visible breath (about 2 px at the hem) with its own phase per panel; a gust leans the cloth and sends bigger waves down it.
const nw = [0, 0, 0, 0];
function norenDisp(t, out) {
  const w = settings.wind;
  for (let i = 0; i < 5; i++) {
    const tt = t - i * .3, g = gustAt(tt).g;                    // each panel trails its neighbour by 0.3 s
    const breath = .55 * Math.sin(TAU * tt / (6.3 + .9 * i) + i * 1.7) + .3 * Math.sin(TAU * tt / (3.1 + .4 * i) + i * 2.9);
    out[i] = w * (breath * 1.8 - g * (3.4 - .35 * i));
  }
  const g = gustAt(t).g;
  nw[0] = w * (1.0 + 3.0 * g);                                   // wave amplitude at the hem (art px)
  nw[1] = w * (.8 + 2.6 * g);                                    // hem lift (art px)
  nw[2] = t; nw[3] = g * w;
}
// lit windows: a slow breath, and every minute or so one dims like a lamp turned down, then comes back
function windowGain(t, k) {
  const P = 75 + 23 * k, i = Math.floor(t / P), t0 = i * P + 8 + 30 * hash(i * 3.1 + k * 7.7), u = t - t0;
  const hold = 5 + 6 * hash(i + k * 2.2);
  const dim = u > 0 ? sstep(0, 3.5, u) * (1 - sstep(3.5 + hold, 3.5 + hold + 4.5, u)) : 0;
  const breath = .022 * Math.sin(TAU * t / (9 + 3 * k) + k * 2.3) + .012 * Math.sin(TAU * t / (3.7 + k) + k);
  return Math.max(.15, 1 + settings.lights * (breath - .62 * dim));
}
// very rare sheet lightning: one event per 120 s window, three soft lobes about 0.5 s apart
function flashAt(t) {
  const P = 120, i = Math.floor(t / P), t0 = i * P + 25 + 75 * hash(i * 1.9 + .5), u = t - t0;
  if (u < 0 || u > 4) return 0;
  const lobe = (tau, a) => tau < 0 ? 0 : a * (1 - Math.exp(-tau / .09)) * Math.exp(-tau / .5) * 2.2;
  return settings.lightning * Math.min(1.15, lobe(u, 1) + lobe(u - .55, .5) + lobe(u - 1.2, .25));
}
const DRIPS = [[150, 860], [330, 850], [640, 860], [760, 830], [1000, 870], [1400, 862], [560, 885], [700, 760], [260, 880], [1080, 800], [1300, 845], [880, 880]];
const NEAR_DRIPS = [[505, 836], [470, 815], [560, 850], [1190, 815], [1235, 850], [1160, 790], [1250, 800]];   // beside the lantern reflections
function dripAt(t) {
  const P = 14;                                        // one bigger drip per 14 s window, at a random moment in it; two in three land by a lantern
  for (const i of [Math.floor(t / P), Math.floor(t / P) - 1]) {
    const t0 = i * P + 1 + 9 * hash(i * 3.1), age = t - t0;
    if (age >= 0 && age < 2.4) {
      const near = hash(i * 4.9 + .2) < .67, L = near ? NEAR_DRIPS : DRIPS;
      const p = L[Math.floor(hash(i * 7.7) * L.length)];
      return [p[0], p[1], age, settings.rain > 0 ? 1 : 0];
    }
  }
  return [0, 0, 9, 0];
}

const nd = new Float32Array(5);
const SKY_COEF = new Float32Array([0.028565,0.185603,0.430183,0.01481,0.055658,0.087798,-0.007036,0.021509,-0.009881,0.008486,-0.040476,-0.095467,-0.016923,0.008689,0.04468,-0.015085,-0.004345,0.018096,0.03969,-0.023809,-0.06182,0.032981,0.046093,0.096445,0.040529,0.043818,0.026116,-0.018859,-0.007366,-0.040851]);   // /255: colour units
const PUD_COEF = new Float32Array([0.041279,0.190591,0.407209,-0.020522,0.021535,0.047953,-0.012067,-0.051987,-0.085233,-0.018748,-0.007278,-0.002386,0.012727,0.009669,-0.002261,0.015969,-0.014798,-0.031986]);   // puddle sky-reflection gradient, /255
const fr = x => x - Math.floor(x);
function draw() {
  if (!ready || lost) return;
  const gi = gustAt(time), g = gi.g * settings.wind;
  gl.uniform2f(U.res, canvas.width, canvas.height);
  gl.uniform2f(U.origin, view.x0, view.y0); gl.uniform1f(U.k, view.k);
  gl.uniform1f(U.tRain, time % 600); gl.uniform1f(U.tRip, time % 900);
  gl.uniform1f(U.rainAmt, settings.rain); gl.uniform1f(U.ripAmt, settings.rain);
  gl.uniform1f(U.ang, swing(time));
  gl.uniform1f(U.f1, flick(time, 0.0)); gl.uniform1f(U.f2, flick(time + 40, 1.0));
  gl.uniform4fv(U.drip, dripAt(time));
  // rain in a gust: more slant, a denser sheet that sweeps from right to left
  gl.uniform1f(U.dShear, .2 * g); gl.uniform1f(U.gustR, g);
  gl.uniform1f(U.gustFront, gi.u < 0 ? 4000 : 1900 - 2300 * gi.u);
  norenDisp(time, nd); gl.uniform1fv(U.nd, nd); gl.uniform4fv(U.nw, nw);
  gl.uniform3f(U.wgain, windowGain(time, 0), windowGain(time, 1), windowGain(time, 2));
  const ge = settings.wind * gustIntegral(time);
  // leaves: slow stir, stronger in a gust
  gl.uniform4f(U.fol, fr(time * .021), fr(time * .013), settings.wind * (.45 + 1.7 * gi.g) * lab.leaves, gi.g * settings.wind);
  // steam
  gl.uniform4f(U.stm, time * .8, settings.mist, -Math.min(.04 + .3 * gi.g, .2) * settings.wind, lab.steam);
  // mist: two layers drifting left (the wind's way), pushed along by gusts
  const mt = time + 5 * ge;
  gl.uniform4f(U.mst, fr(mt * .0034), fr(mt * .0004), fr(-mt * .0012 + .3), settings.mist);
  gl.uniform4f(U.misc, settings.lights * lab.bloom, 0, 0, 0);
  gl.uniform4f(U.lgt, flashAt(time), settings.lights, fr(time * .006), lab.near);
  // clouds drift left at about 3 art px/s (the wind's way), faster in a gust; wind 0 = they stay where they were painted
  gl.uniform2f(U.cld, (settings.wind > 0 ? settings.wind * (3 * time + 20 * gustIntegral(time)) : 0) % 1000, settings.wind > 0 ? lab.clouds : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3); frames++;
}
function frozen() { return ['rain', 'wind', 'mist', 'lights', 'lightning'].every(k2 => settings[k2] === 0); }
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
  document.body.style.backgroundImage = `url('${STILL}')`;
  console.warn('Animation unavailable, showing still art:', err && err.message);
}
document.addEventListener('visibilitychange', schedule);
window.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; ready = false; schedule(); });
canvas.addEventListener('webglcontextrestored', () => { try { setup(); } catch (e) { fail(e); } });

window.wallpaperDiagnostics = { get state() { return { ready, lost, time, frames, paused: stopped(), fps: settings.fps, settings: { ...settings }, width: canvas.width, height: canvas.height, view: { ...view }, gust: gustAt(time) }; } };
window.wallpaperTest = {
  seek(t) { testMode = true; schedule(); time = t; draw(); },
  resume() { testMode = false; schedule(); },
};
// development page only: switches that are not WE properties (steam style, near rain, leaf stir); the shipped defaults are in `lab` above
window.wallpaperLab = { set(o) { Object.assign(lab, o); if (ready) draw(); }, get state() { return { ...lab }; }, gustEvent, flashAt, windowGain };

try {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) throw Error('WebGL is not available.');
  const files = { plate: 'plate.jpg', ltop: 'lantern-top.png', masks: 'masks.png', stall: 'noren.png', fill: 'noren-fill.jpg', masks2: 'masks2.png', clouds: 'clouds.png' };
  let left = Object.keys(files).length;
  for (const [n, f] of Object.entries(files)) {
    const img = new Image();
    img.onload = () => { images[n] = img; if (--left === 0) { try { setup(); } catch (e) { fail(e); } } };
    img.onerror = () => fail(Error(f + ' could not be loaded'));
    img.src = file(f);
  }
} catch (e) { fail(e); }
})();

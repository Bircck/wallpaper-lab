'use strict';
// One wind for everything, the wake of a train, and cloud shadows on the land.
SC.part({
  title: 'Wind',
  common: `
// the tuned values: wind sway, calm breath, express wake, lawn sway. No gust bursts, no wake flutter.
const float W_SWAY=1.2,W_GUST=0.,W_BREATH=1.25,W_WAKE=.8,LAWN_SWAY=.08;
// gust fronts roll through in +x, with stretches of calm between them. 0 = still air, 1 = the strongest front.
float gustFront(vec2 P,float t){
  float n=vn(vec2(P.x/640.-t*.3+P.y/1400.,P.y/480.+t*.025));
  float env=.5+.5*sin(t*.17)*sin(t*.107+1.1);
  return smoothstep(.48,.78,n)*env;
}
float gustAt(vec2 P){ return gustFront(P,uWindT); }
// the push a plant feels at wind clock t: a slow breath at rest, the gust, and the swing back after a front has passed.
// Phase comes from position only, so neighbours stay in step. There is no fast term: nothing shivers in calm air.
float leanG(vec2 P,float t,float gw){
  float g=gustFront(P,t)-.26*gustFront(P,t-1.1)+.09*gustFront(P,t-2.2);
  float breath=.05*sin(t*.55+P.x*.005)+.04;
  float sway=.72+.16*sin(t*1.1+P.x*.009);
  return uWindAmt*(W_BREATH*breath+gw*g*sway);
}
float leanAt(vec2 P,float t){ return leanG(P,t,W_GUST); }
// lean is unitless, about 0.1 in a breeze and 1 in a strong gust. ph delays this plant a little behind the wind.
float windLean(vec2 P,float ph){ return leanAt(P,uWindT-ph*.25); }
// the wake of a train at x: rises just ahead of the nose, stays through the passage, rings down after the tail
float wakeEnv(float x){
  if(uWake<=0.) return 0.;
  float tNose=(x-uNose0)*uDir/uWakeV, tTail=tNose+uWakeLen/uWakeV;
  return smoothstep(-.12,.05,uWakeT-tNose)*(1.-smoothstep(0.,1.8,uWakeT-tTail));
}
float wakeAt(float x){
  if(uWake<=0.) return 0.;
  return wakeEnv(x)*(.72+.28*sin((uWakeT-(x-uNose0)*uDir/uWakeV)*11.+x*.01));
}
// the same wake as a push: one lean as the front arrives at x, held through the passage, then a slow swing back past rest. No fast term.
float wakePush(float x){
  if(uWake<=0.) return 0.;
  float tNose=(x-uNose0)*uDir/uWakeV, tTail=tNose+uWakeLen/uWakeV;
  float d=uWakeT-tNose,e=uWakeT-tTail;
  float a=smoothstep(-.12,.5,d)*(.82+.18*smoothstep(0.,1.2,d))*(1.-smoothstep(0.,1.5,e));
  float back=.2*smoothstep(.7,1.6,e)*(1.-smoothstep(1.6,3.,e));
  return (a-back)*smoothstep(0.,.04,uWake);
}
// what the plants take from the wake: the slow push (the old fast wake, 'Wake flutter', is gone)
float wakeDrive(float x){ return wakePush(x); }
// shared by every pass so plants and trains darken with the land when a cloud shadow crosses
float cloudShadow(vec2 A,float sea){
  float dz=max(A.y-474.,.5); float depth=min(260./(dz+6.),9.); vec2 gp=vec2((A.x-836.)*depth,260.*depth);
  vec2 sp=gp*vec2(.0021,.0042)-vec2(uCloudT*.07,uCloudT*.006);
  float n=vn(sp)*.65+vn(sp*2.13+7.3)*.35;
  return 1.-.17*uShadow*smoothstep(.5,.74,n)*smoothstep(480.,624.,A.y)*mix(1.,.65,sea);
}
`,
});

'use strict';
const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl',{alpha:false,antialias:false});
if(!gl)throw Error('WebGL unavailable');

let time=0,frames=0,paused=false,fps=30,amount=1,speed=1,lighting=1,scale=1,view=0,smoke=1,sparkles=1,fogAmount=.18,particles=0;
let motionMode=2;
let fogEdgeMode=1,fogEdgeSpeed=.7,fogEdgeDefinition=1;
let cloudSpeed=1,cloudOffset=0;
let electricMode=0,electricPower=0,chargePower=3.36,chargeSpeed=.3;
// Baked colour boost, the same maths as CSS saturate() that Wallpaper Engine's own Saturation option uses.
let saturation=1.3;
// Art-space grid of the masks and data layers. Effects measure in these units even if nebula.png is shipped larger.
const ART_W=1672,ART_H=941;
const effectNames=['clouds','electricity','sparkles','fog'];
const effectEnabled={clouds:true,electricity:true,sparkles:true,particles:true,fog:true};
let effectSolo=null,effectCoverage=null;
const effectOn=name=>effectEnabled[name]&&(!effectSolo||effectSolo===name);
window.regionEffects={state(){return{strengths:{clouds:smoke,electricity:lighting,sparkles,particles,fog:fogAmount},enabled:{...effectEnabled},solo:effectSolo,coverage:effectCoverage}}};
const sliderValues={cloudamount:50,cloudspeed:50,lightninglevel:50,dustamount:50,fogamount:50,renderscale:50};
const sliderRange={cloudamount:[0,1,1.5],cloudspeed:[0,.97,2],lightninglevel:[0,3.36,6],dustamount:[0,.4,1],fogamount:[0,.42,1],renderscale:[.5,1,1.5]};
function fromSlider(n,[low,mid,high]){return n<=50?low+(mid-low)*n/50:mid+(high-mid)*(n-50)/50;}
window.wallpaperPropertyListener={applyGeneralProperties(p){const value=p?.fps;if(typeof value==='number'&&Number.isFinite(value)&&value>0&&value!==fps){fps=Math.max(1,value);schedule()}},setPaused(p){const next=!!p;if(next!==paused){paused=next;schedule()}},applyUserProperties(p){
 let changed=false,scaled=false;
 for(const key of Object.keys(sliderRange)){
  const raw=p?.[key]?.value;if(typeof raw!=='number'||!Number.isFinite(raw))continue;
  const n=Math.max(0,Math.min(100,Math.round(raw))),v=fromSlider(n,sliderRange[key]);sliderValues[key]=n;changed=true;
  if(key==='cloudamount'){amount=v;smoke=v/.95;}
  if(key==='cloudspeed'){cloudOffset+=time*(cloudSpeed-v);cloudSpeed=v;}
  if(key==='lightninglevel')chargePower=v;
  if(key==='dustamount')spaceStrength=v;
  if(key==='fogamount')fogAmount=v;
  if(key==='renderscale'){scale=v;scaled=true;}
 }
 if(scaled)resize();else if(changed&&frames)draw();
}};
window.studyState=()=>({time,frames,paused,fps,dustPercent:spaceStrength*100,cloudSpeed,cloudTime:time*cloudSpeed+cloudOffset,amount,smoke,sparkles,particles,fog:fogAmount,scale,sliders:{...sliderValues},effects:window.regionEffects.state(),starCount:starData.length/8,simulation:'region-mapped cloud density, travelling filaments and source-matched stars',view,ready:frames>0});
function resize(){canvas.width=Math.round(innerWidth*scale);canvas.height=Math.round(innerHeight*scale);gl.viewport(0,0,canvas.width,canvas.height);if(frames>0)draw()}addEventListener('resize',resize);resize();
const vert='attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
const frag=`precision highp float;varying vec2 uv;uniform sampler2D art,gas,bankMask,plate,flowAtlas,flowLight,flowInfo,cloudEdgeData,cloudBackground,cloudPeaks,paintCoverage;const float view=0.;uniform vec2 resolution,texel;uniform float imageAspect;uniform float time,cloudTime,amount,smoke,fogAmount,cloudGain,chargePower,frameStep,saturation;
// Fixed in the released wallpaper. As constants the GPU compiler drops the unused debug views and legacy modes (cold compile 3.4 s -> 1.1 s).
const float lighting=1.,coverage=0.,electricMode=0.,electricPower=0.,chargeSpeed=.3,motionMode=2.,fogEdgeMode=1.,fogEdgeSpeed=2.,fogEdgeDefinition=1.;
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);}
float fbm(vec2 p){return .57*noise21(p)+.28*noise21(p*2.13+5.)+.15*noise21(p*4.37+9.);}
// Soft artwork-space regions follow the user's red cloud / blue star / green river map.
float ellipse(vec2 p,vec2 c,vec2 size){vec2 q=(p-c)/size;return exp(-dot(q,q)*1.6);}
float segment(vec2 p,vec2 a,vec2 b,float width){vec2 ab=b-a;vec2 q=p-a-ab*clamp(dot(p-a,ab)/dot(ab,ab),0.,1.);return exp(-dot(q,q)/(width*width));}
float cloudRegion(vec2 p){
 float left=ellipse(p,vec2(.07,.56),vec2(.16,.24));
 float bottom=ellipse(p,vec2(.31,.17),vec2(.20,.25));
 float mid=ellipse(p,vec2(.44,.34),vec2(.095,.15));
 float lower=segment(p,vec2(.49,.24),vec2(.75,.08),.12);
 float upper=segment(p,vec2(.44,1.02),vec2(.66,.65),.105);
 float right=segment(p,vec2(.79,.61),vec2(1.,.86),.092);
 return max(max(max(left,bottom),max(mid,lower)),max(upper,right));
}
// Actual artwork pixels, not a guessed river centerline. Shared by the effect and coverage.
float electricRegion(vec2 p){
 vec3 c=texture2D(art,p).rgb;
 vec3 a=texture2D(art,p+vec2(texel.x*3.,0.)).rgb;
 vec3 b=texture2D(art,p-vec2(texel.x*3.,0.)).rgb;
 vec3 d=texture2D(art,p+vec2(0.,texel.y*3.)).rgb;
 vec3 e=texture2D(art,p-vec2(0.,texel.y*3.)).rgb;
 float l=dot(c,vec3(.2126,.7152,.0722));
 float around=dot((a+b+d+e)*.25,vec3(.2126,.7152,.0722));
 float gold=smoothstep(.018,.12,c.r-c.b);
 float cyan=smoothstep(.006,.048,min(c.g,c.b)-c.r);
 float chroma=max(gold,cyan);
 float ridge=smoothstep(.002,.050,l-around);
 float connected=smoothstep(.025,.11,around);
 return chroma*smoothstep(.065,.30,l)*mix(.32,1.,ridge)*connected;
}
float sparkleRegion(vec2 p){
 float upperLeft=ellipse(p,vec2(.26,.92),vec2(.20,.11));
 float upperRight=ellipse(p,vec2(.85,.93),vec2(.17,.17));
 float leftPocket=ellipse(p,vec2(.20,.51),vec2(.075,.11));
 float bottomLeft=ellipse(p,vec2(.11,.15),vec2(.13,.23));
 float mid=ellipse(p,vec2(.62,.29),vec2(.14,.11));
 float right=ellipse(p,vec2(.90,.18),vec2(.13,.24));
 return max(max(max(upperLeft,upperRight),max(leftPocket,bottomLeft)),max(mid,right));
}
// Approved 0.6 illumination, evaluated only from original artwork.
vec3 expose(vec3 c,float e){float gain=exp2(e);return c*gain/(1.+c*(gain-1.));}
float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
// Light colour is sampled from the art's emitters, not a white overlay.
vec3 emission(vec2 p){vec3 c=texture2D(art,p).rgb;float warm=smoothstep(.02,.12,c.r-c.b);float cool=smoothstep(.008,.05,min(c.g,c.b)-c.r);return c*max(warm,cool)*smoothstep(.08,.36,luminance(c));}
vec3 spillLight(vec2 p,float reach){vec3 sum=vec3(0.);for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 dir=vec2(cos(a),sin(a));sum+=emission(p+dir*vec2(.014,.025)*reach)*.07;sum+=emission(p+dir*vec2(.034,.060)*reach)*.055;}return sum;}
vec2 branchPoint(float u){vec2 a=vec2(.035,.82),b=vec2(.18,.70),c=vec2(.28,.65),d=vec2(.33,.49),e=vec2(.48,.45);if(u<.25)return mix(a,b,u*4.);if(u<.5)return mix(b,c,(u-.25)*4.);if(u<.75)return mix(c,d,(u-.5)*4.);return mix(d,e,(u-.75)*4.);}
vec3 colouredResponse(vec3 source,vec3 radiance,float energy){float peak=max(max(source.r,source.g),source.b);vec3 hue=source*(vec3(1.)+radiance*2.5*(1.-exp(-max(energy,0.))));hue/=max(max(hue.r,hue.g),max(hue.b,.0001));float gain=1.+max(energy,0.)*3.;float target=peak*gain/(1.+peak*(gain-1.));return hue*target;}
float chargeSegment(vec2 p,vec2 a,vec2 b,float start,float clock,float lane){
 vec2 ab=(b-a)*vec2(1.,.563);vec2 ap=(p-a)*vec2(1.,.563);
 float u=clamp(dot(ap,ab)/dot(ab,ab),0.,1.);float distance=length(ap-ab*u);
 float phase=mod(start+u*length(ab)-clock*.075+lane,.34);
 return exp(-pow(distance/.027,2.))*(exp(-pow((phase-.07)/.013,2.))+.35*exp(-pow((phase-.105)/.042,2.)));
}
float charges(vec2 p,float clock){float c=0.;
c=max(c,chargeSegment(p,vec2(0.000000,0.880000),vec2(0.130000,0.730000),0.000000,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.130000,0.730000),vec2(0.280000,0.640000),0.155022,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.280000,0.640000),vec2(0.340000,0.500000),0.313349,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.340000,0.500000),vec2(0.490000,0.470000),0.412408,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.490000,0.470000),vec2(0.650000,0.490000),0.563355,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.650000,0.490000),vec2(0.830000,0.400000),0.723751,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.830000,0.400000),vec2(1.000000,0.530000),0.910747,clock*1.000000,0.000000));
c=max(c,chargeSegment(p,vec2(0.680000,0.900000),vec2(0.770000,0.790000),0.000000,clock*0.870000,0.120000));
c=max(c,chargeSegment(p,vec2(0.770000,0.790000),vec2(0.870000,0.680000),0.109249,clock*0.870000,0.120000));
c=max(c,chargeSegment(p,vec2(0.690000,0.440000),vec2(0.770000,0.250000),0.000000,clock*0.730000,0.210000));
c=max(c,chargeSegment(p,vec2(0.770000,0.250000),vec2(0.940000,0.060000),0.133576,clock*0.730000,0.210000));
return c;}

// Arc-length and branch identity are baked from selected original pixel ridges.
// Decode uint16 distance with nearest filtering; never interpolate branch IDs.
vec3 traceSignal(vec2 p,float clock){
 vec4 field=texture2D(flowAtlas,p);
 float id=floor(field.b*255.+.5);
 vec4 info=texture2D(flowInfo,vec2((id+.5)/32.,.5));
 float pathLength=(info.r*65280.+info.g*255.)/65535.*2.;
 float s=(field.r*65280.+field.g*255.)/65535.*pathLength;
 float seed=fract(id*.6180339887);
 float gap=.24+seed*.16;
 float phase=mod(s-clock*.072+seed*gap,gap);
 float slow=exp(-pow((phase-.064)/.009,2.))+.25*exp(-pow((phase-.035)/.024,2.));
 float wake=exp(-pow((phase-.012)/.012,2.));
 float gate=smoothstep(.12,.8,sin(clock*.71+id*2.31));
 // Sample a bounded shutter interval to keep fast heads legible at low FPS.
 float fast=0.;
 for(int k=0;k<3;k++){
  float ct=clock-float(k)*frameStep*chargeSpeed*.5;
  float f=mod(s-ct*.32+seed*.43,.48+seed*.20);
  fast+=(exp(-pow((f-.048)/.009,2.))+.24*exp(-pow((f-.025)/.02,2.)))/3.;
 }
 float energy=.65*slow+.65*gate*fast;
 float retreat=.18*wake;
 if(motionMode>1.5){
  // A rapid onset runs down one traced branch, then decays in place.
  // Each branch has a separate quiet interval and bounded event age.
  float period=4.5+seed*3.8;
  float age=mod(clock+seed*period*7.,period);
  float behind=age-s/.63;
  float ignition=smoothstep(-.03,.025,behind)*exp(-max(behind,0.)*3.8);
  float echo=smoothstep(.13,.17,behind)*exp(-max(behind-.16,0.)*6.);
  energy=.28*slow+1.25*ignition+.38*echo;
  retreat=.14*smoothstep(.6,1.5,behind)*(1.-smoothstep(2.0,3.,behind));
 }
 return vec3(energy,retreat,texture2D(gas,p).r*step(.5,id));
}
vec3 tracedSpill(vec2 p,float clock){
 // The receiving pixel stores its nearest traced emitter's colour and distance.
 // Sampling neighbouring assignments softens crossings; energy remains tied to
 // the emitter's arc coordinate, not a separate screen-space breathing field.
 vec3 result=vec3(0.);
 for(int i=0;i<5;i++){
  float a=float(i)*2.39996;
  vec2 q=p+vec2(cos(a),sin(a))*texel*float(i)*2.;
  vec4 lamp=texture2D(flowLight,q);
  float pulse=traceSignal(q,clock).x;
  result+=lamp.rgb*lamp.a*(.10+.90*pulse)*.2;
 }
 return result;
}
vec3 approvedLight(vec2 p,vec3 source,float t,float lighting,float cloudStrength){
vec3 left=texture2D(art,p-vec2(texel.x*2.,0.)).rgb;
vec3 right=texture2D(art,p+vec2(texel.x*2.,0.)).rgb;
vec3 down=texture2D(art,p-vec2(0.,texel.y*2.)).rgb;
vec3 up=texture2D(art,p+vec2(0.,texel.y*2.)).rgb;
vec3 mean=(source+left+right+down+up)*.2;
float lum=luminance(source);
float peak=max(lum,max(max(luminance(left),luminance(right)),max(luminance(up),luminance(down))));
float contrast=max(length(right-left),length(up-down));
float violet=smoothstep(.012,.07,mean.b-mean.g)*smoothstep(.002,.045,mean.r-mean.g);
float gas=violet*smoothstep(.035,.12,luminance(mean))*(1.-smoothstep(.07,.18,contrast))*(1.-smoothstep(.20,.38,peak));
vec2 border=smoothstep(vec2(0.),vec2(.08),p)*smoothstep(vec2(0.),vec2(.08),1.-p);
gas*=border.x*border.y;

vec3 color=source;
// Gas changes illumination softly; sharp geometry remains anchored.
// Broad illumination is allowed on cloud detail without displacing it.
// Dark and lit bands travel in distinct directions above/below the river.
float cloudMaterial=smoothstep(.008,.065,mean.b-mean.g)*smoothstep(-.006,.035,mean.r-mean.g);
cloudMaterial*=smoothstep(.025,.10,luminance(mean))*(1.-smoothstep(.40,.65,peak));
cloudMaterial*=border.x*border.y;
float upperBank=smoothstep(.42,.64,p.y);
// Blend bounded wave values, never time-dependent phases. Mixing phases
// makes their spatial frequency grow without limit (the reported TV bands).
float bend=.65*sin(p.y*13.+cloudTime*.23);
float swell=mix(sin(p.x*20.+p.y*12.-cloudTime*.85+bend),sin(-p.x*15.+p.y*19.-cloudTime*.62+bend),upperBank);
float eddy=sin(p.y*26.-p.x*9.+cloudTime*.72);
float exposure=0.; // Cloud motion comes from edge occupancy, not broad brightening.
color=expose(color,exposure);
// Filaments only brighten, never bend. Restrict to the existing river and
// warm/cyan material, keeping modulation small enough to preserve detail.
float center=.70-.42*p.x+.055*sin(p.x*8.);
float corridor=electricRegion(p);
float warm=smoothstep(.04,.17,source.r-source.b);
float cyan=smoothstep(.012,.07,source.g-source.r)*smoothstep(.012,.08,source.b-source.r);
float filament=motionMode<.5?corridor:traceSignal(p,t*chargeSpeed).z;
float drive=lighting*electricPower;
float reach=1.+sqrt(max(drive,0.))*.22;
vec3 light=motionMode<.5?spillLight(p,reach):tracedSpill(p,t*chargeSpeed);float irradiance=luminance(light);
float breathing=motionMode<.5?.5+.5*sin(t*.75+p.x*8.-p.y*5.):.5;
float density=smoothstep(.018,.16,lum)*(1.-smoothstep(.5,.9,lum));
float response=0.;vec3 tint=light;
if(electricMode<.5){
 // Emitter-coloured light spreads onto neighbouring material, with quieter cores.
 response=irradiance*(.6+1.9*breathing)+filament*.075*breathing;
}else if(electricMode<1.5){
 // Illuminate existing cloud rims from behind; leave electrical cores mostly alone.
 float violet=smoothstep(.006,.07,source.b-source.g);
 response=irradiance*(.4+3.*breathing)*mix(.15,1.6,violet)*(1.-filament*.85);
}else if(electricMode<2.5){
 // One charge follows an authored route; the source image supplies every strand.
 float u=fract(t*.075);vec2 tip=branchPoint(u);vec2 delta=(p-tip)*vec2(1.,.563);
 float envelope=smoothstep(0.,.12,u)*(1.-smoothstep(.85,1.,u));
 float halo=exp(-dot(delta,delta)/(.0028*reach*reach))*envelope;
 tint=emission(tip)+light;response=halo*(.12*filament+.7*irradiance+.10*density);
}else{
 // Recede, then recharge: contrast and reflected light rather than added white.
 float swell=motionMode<.5?.5+.5*sin(t*.58-p.x*7.+p.y*2.):clamp(traceSignal(p,t*chargeSpeed).x,0.,1.);
 color*=1.-filament*.24*(1.-swell)*min(drive,3.)/3.;
 response=irradiance*(.3+2.5*swell)+filament*.045*swell;
}
if(motionMode>.5 && electricMode>1.5 && electricMode<2.5){tint=light;response=irradiance*2.1;}
color=colouredResponse(color,tint,drive*response*1.8);

if(motionMode<.5){
// Quiet slow current with less frequent faster packets. Weights stay bounded.
float clock=t*chargeSpeed;
float fastGate=smoothstep(.35,.85,sin(clock*.57+1.3));
float slowPacket=charges(p,clock*.85);
float fastPacket=charges(p,clock*3.6+2.7);
float packet=.72*slowPacket+.28*fastGate*fastPacket;
float current=filament*packet*chargePower*lighting;
float peakCharge=max(max(color.r,color.g),color.b);
float gainCharge=1.+current*5.;
float chargedPeak=peakCharge*gainCharge/(1.+peakCharge*(gainCharge-1.));
color*=chargedPeak/max(peakCharge,.0001);
color=colouredResponse(color,light,packet*irradiance*drive*.55);

}else{
 vec3 trace=traceSignal(p,t*chargeSpeed);
 float strength=chargePower*lighting;
 // Dim/restoration provides readable travel in already-bright source threads.
 // A single scalar gain preserves each original RGB ratio, including overdrive.
 float signedEnergy=trace.z*(trace.x*1.7-trace.y)*strength;
 float gain=exp2(clamp(signedEnergy,-3.,7.));
 float peakCharge=max(max(color.r,color.g),color.b);
 float chargedPeak=peakCharge*gain/(1.+peakCharge*(gain-1.));
 color*=chargedPeak/max(peakCharge,.0001);
}

return color;
}
// Object-space volume: the sampling domain moves, never the artwork.
float h3(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float n3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float ridge(float x){float r=mix(.235,.375,smoothstep(.095,.175,x));r=mix(r,.402,smoothstep(.175,.23,x));r=mix(r,.285,smoothstep(.23,.29,x));r=mix(r,.23,smoothstep(.29,.34,x));r=mix(r,.085,smoothstep(.34,.43,x));return mix(r,-.01,smoothstep(.43,.48,x));}
float billow(vec3 q){return n3(q)*.53+n3(q*2.03+4.1)*.25+n3(q*4.07+11.3)*.14+n3(q*8.11+7.3)*.06+n3(q*16.3+19.1)*.02;}
void main(){float aspect=resolution.x/resolution.y;vec2 p=uv;if(aspect>imageAspect)p.y=(p.y-.5)*imageAspect/aspect+.5;else p.x=(p.x-.5)*aspect/imageAspect+.5;if(view==6.)p=vec2(.265,.27)+(uv-.5)*vec2(aspect*.30,.30);vec3 source=texture2D(art,p).rgb;vec3 color=approvedLight(p,source,time,lighting,cloudGain);float l=luminance(source);float center=.70-.42*p.x+.055*sin(p.x*8.);float corridor=electricRegion(p);float warm=smoothstep(.04,.17,source.r-source.b);float cyan=smoothstep(.012,.07,source.g-source.r)*smoothstep(.012,.08,source.b-source.r);float filament=corridor;
// Preserve the approved lower-left cloud/fog exclusion exactly.
if(p.x<.43 && p.y<.43){float oldCenter=.70-.42*p.x+.055*sin(p.x*8.);float oldCorridor=max(exp(-pow((p.y-oldCenter)/.09,2.)),max(segment(p,vec2(.00,.17),vec2(.17,.44),.052),max(segment(p,vec2(.69,.88),vec2(.86,.70),.055),segment(p,vec2(.72,.30),vec2(1.,.015),.055))));filament=max(warm,cyan)*smoothstep(.10,.38,l)*oldCorridor;}
float bank=texture2D(bankMask,p).r;
// Build an inward contour distance from the original bank silhouette.
float depth=0.;
for(int j=1;j<=16;j++)depth+=texture2D(bankMask,p+vec2(0.,float(j)*.0025)).r/16.;
// A moving condensation front changes occupancy, never artwork coordinates.
vec2 q=vec2(p.x*43.-cloudTime*.12,p.y*52.);
float n=fbm(q+vec2(.35*sin(cloudTime*.17),cloudTime*.08));
float patch=.55+.45*sin(p.x*39.-cloudTime*.44+2.1*fbm(vec2(p.x*17.,cloudTime*.035)));
float retreat=min(amount,6.)*(.08+.68*patch)*(.32+.68*n);
float keep=smoothstep(retreat-.10,retreat+.10,depth);
float rightZone=smoothstep(.745,.79,p.x)*smoothstep(.43,.50,p.y);
float zone=smoothstep(.07,.12,p.x)*(1.-smoothstep(.43,.47,p.x))*(1.-smoothstep(.43,.46,p.y));
float dissolved=bank*(1.-keep)*zone*min(amount,1.);
vec3 hidden=texture2D(plate,p).rgb;
// Narrow upper-right retreat borrows immediately adjacent distant material.
// This is an approximate hidden-edge fill, not a new source-art replacement.
hidden=mix(hidden,texture2D(art,clamp(p+vec2(-.015,.030),vec2(0.),vec2(1.))).rgb,rightZone);
// Only the selected bank's removed pixels reveal the local hidden plate.
color=mix(color,approvedLight(p,hidden,time,lighting,cloudGain),dissolved);
// Narrow attached contact light, sampled from original cloud material.
float rim=exp(-pow((depth-retreat-.035)/.047,2.))*bank*zone*keep*min(amount,1.);
color=expose(color,rim*.35);
// Broad oblique cloud strata, distributed through the composition.
// These are low-aspect-ratio banks rather than rising point-source plumes.
vec2 d0=(p-vec2(.205,.345));vec2 d1=(p-vec2(.435,.255));
vec2 d2=(p-vec2(.745,.115));vec2 d3=(p-vec2(.59,.775));
vec2 d4=(p-vec2(.865,.60));vec2 d5=(p-vec2(.19,.85));
float a0=exp(-dot(d0/vec2(.105,.055),d0/vec2(.105,.055)));
float a1=exp(-dot(d1/vec2(.095,.075),d1/vec2(.095,.075)));
float a2=exp(-dot(d2/vec2(.13,.06),d2/vec2(.13,.06)));
float a3=exp(-dot(d3/vec2(.10,.095),d3/vec2(.10,.095)));
float a4=exp(-dot(d4/vec2(.095,.06),d4/vec2(.095,.06)));
float a5=exp(-dot(d5/vec2(.13,.085),d5/vec2(.13,.085)));
float support=max(max(max(a0,a1*.85),max(a2*.8,a3)),max(a4*.8,a5*.65));
// Keep the approved lower-left field; extend its same density/material treatment
// across matching banks, with a soft handoff outside the protected lower-left.
float preserveLeft=(1.-smoothstep(.43,.51,p.x))*(1.-smoothstep(.43,.55,p.y));
support*=preserveLeft;
// The original violet material and illumination anchor the new density.
vec3 local=(source+texture2D(art,p+vec2(.012,.007)).rgb+texture2D(art,p-vec2(.012,.007)).rgb)*.333333;
float material=smoothstep(.006,.045,local.b-local.g)*smoothstep(-.008,.03,local.r-local.g);
support*=mix(.18,1.,material)*(1.-smoothstep(.32,.65,l))*(1.-filament*.96);
float upperFlow=smoothstep(.46,.65,p.y);
float rightCloud=segment(p,vec2(.79,.61),vec2(1.,.86),.092);
support*=1.+rightCloud*.45;
vec3 litBackground=color;
vec3 accumulated=vec3(0.);float transmittance=1.;
if(support>.008 && smoke>.001){
 for(int i=0;i<6;i++){
  float z=(float(i)+.5)/6.;
  // Wide, slow layered transport; no buoyant rise or rotating warp.
  // Sample two fixed-speed fields and blend densities; blending wind
  // before multiplying by elapsed time would shear the field into stripes.
  vec3 q=vec3(p*vec2(24.,31.)-cloudTime*vec2(.065,-.017)*(.75+z*.4),z*2.7);
  // Rotate the volume's sampling lattice to follow the bank, never the source pixels.
  vec2 upperDomain=vec2(p.x*.94+p.y*.34,-p.x*.34+p.y*.94);
  vec3 qUpper=vec3(upperDomain*vec2(24.,31.)-cloudTime*vec2(.065,-.017)*(.75+z*.4)+vec2(z*1.7,z*.93),z*2.7);
  float raw=0.;float detail=0.;float towardsLight=0.;
  if(upperFlow<.999){raw=billow(q)*(1.-upperFlow);detail=n3(q*6.7+vec3(11.,4.,8.))*(1.-upperFlow);towardsLight=billow(q+vec3(.30,.32,-.18))*(1.-upperFlow);}
  if(upperFlow>.001){raw+=billow(qUpper)*upperFlow;detail+=n3(qUpper*6.7+vec3(11.,4.,8.))*upperFlow;towardsLight+=billow(qUpper+vec3(.30,.32,-.18))*upperFlow;}
  float d=smoothstep(.43,.66,raw)*mix(.7,1.15,detail)*support;
  float edge=clamp((raw-towardsLight)*7.+.18,0.,1.);
  // Borrow the surrounding cloud's actual hues and fine light/dark structure.
  vec3 hue=local/max(max(local.r,local.g),max(local.b,.06));
  vec3 tint=local*(.40+edge*.80)+hue*(.016+edge*.032);
  // Outside the approved bank, retain the sculpted source's detail inside moving density.
  // Dark lobes stay dark; attached bright rims receive the moving condensation light.
  float sculpt=smoothstep(.018,.13,luminance(source));
  vec3 attached=source*(.72+edge*.64)+hue*(.008+edge*.018)*sculpt;
  tint=source*(.72+edge*.55); // Original pixel colour, without added pale emission.
  float pulse=.92+.08*sin(p.x*18.+p.y*3.-cloudTime*1.6);
  tint*=mix(1.,pulse,lighting);
  float alpha=1.-exp(-d*smoke*.65);
  accumulated+=transmittance*alpha*tint;transmittance*=1.-alpha;
 }
}
vec3 through=litBackground*transmittance+accumulated;
color+=(through-litBackground)*(1.-bank*preserveLeft+dissolved*preserveLeft);

// Retreat across each authored ridge reveals nearby distant material.
vec4 reveal=texture2D(cloudEdgeData,p);
float edgeDepth=reveal.g*128.;
// Compact inward boundary fade hides both ridge and polygon-closing seams.
float boundaryBlend=smoothstep(0.,1.,reveal.b);
float edgeClock=cloudTime;
float frontNoise=fbm(p*vec2(38.,45.)+vec2(-edgeClock*.15,edgeClock*.06));
float frontWave=.5+.5*sin(p.x*27.+p.y*19.-edgeClock*.46+frontNoise*3.);
float newRetreat=(5.+66.*frontWave)*(.55+.45*frontNoise)*min(amount,2.);
float darkCloud=1.-smoothstep(.30,.55,luminance(source));
float newReveal=(1.-smoothstep(newRetreat-10.,newRetreat+12.,edgeDepth))*boundaryBlend*darkCloud;
// Smooth tip patches bypass only the inward bank feather, not the region limit.
float peakMask=texture2D(cloudPeaks,p).r;
float peakPulse=smoothstep(.20,.85,frontWave);
float peakReveal=peakMask*peakPulse*.82*min(amount,1.5)*darkCloud;
newReveal=1.-(1.-newReveal)*(1.-clamp(peakReveal,0.,1.));
vec4 painted=texture2D(paintCoverage,p);
float brushReveal=painted.g*peakPulse*.85*min(amount,1.5);
newReveal=1.-(1.-newReveal)*(1.-clamp(brushReveal,0.,1.));
vec3 behind=texture2D(cloudBackground,p).rgb;
color=mix(color,behind,newReveal);
float cloudMask=painted.r;
vec3 electricBase=approvedLight(p,source,time,lighting,0.);
color=mix(electricBase,color,cloudMask);
// Low-density coloured fog, separate from cloud motion and painted cloud coverage.
float fogClock=time*fogEdgeSpeed;
float fogField=billow(vec3(p*vec2(5.,7.)-vec2(fogClock*.018,-fogClock*.012),1.3));
float fogDensity=smoothstep(.37,.68,fogField)*(1.-cloudMask*.8)*(1.-smoothstep(.20,.48,luminance(source)));
vec3 fogTint=vec3(.085,.065,.15)+source*.12;
color=mix(color,fogTint,1.-exp(-fogDensity*fogAmount*.8));
vec2 world=vec2((uv.x-.5)*aspect,uv.y-.5);
color*=.95*(1.-.13*smoothstep(.3,1.2,length(world)));
if(view==1.)color=vec3(dissolved);if(view==2.)color=vec3(bank*keep);
if(view==3.){float check=mod(floor(p.x*70.)+floor(p.y*40.),2.);color=mix(vec3(mix(.10,.17,check)),source,bank);}
if(view==4.)color=mix(source,texture2D(plate,p).rgb,bank);
if(view==5.)color=source;
if(coverage>.5){
 float weight=cloudMask;vec3 tint=vec3(1.,.16,.12);
 if(coverage>1.5&&coverage<2.5){weight=motionMode<.5?electricRegion(p):texture2D(gas,p).r;tint=vec3(.25,1.,.12);}
 if(coverage>2.5&&coverage<4.5){weight=sparkleRegion(p);tint=vec3(.05,.38,1.);}
 if(coverage>3.5){weight=fogDensity;tint=vec3(.72,.60,1.);}
 color=mix(source*.45,tint,weight*.60);
}
if(view==0.&&coverage<.5)color=clamp(mix(vec3(dot(color,vec3(.213,.715,.072))),color,saturation),0.,1.);
gl_FragColor=vec4(color,1.);}`;
function compile(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}let program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vert));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,frag));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);let a=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);let uniforms={};for(const k of ['art','gas','resolution','time','cloudTime','amount','lighting','texel','imageAspect','view','bankMask','plate','smoke','fogAmount','cloudGain','coverage','electricMode','electricPower','chargePower','chargeSpeed','motionMode','frameStep','flowAtlas','flowLight','flowInfo','cloudEdgeData','fogEdgeMode','fogEdgeSpeed','fogEdgeDefinition','cloudBackground','cloudPeaks','paintCoverage','saturation'])uniforms[k]=gl.getUniformLocation(program,k);gl.uniform1i(uniforms.art,0);gl.uniform1i(uniforms.gas,1);gl.uniform1i(uniforms.bankMask,2);gl.uniform1i(uniforms.plate,3);gl.uniform1i(uniforms.flowAtlas,4);gl.uniform1i(uniforms.flowLight,5);gl.uniform1i(uniforms.flowInfo,6);gl.uniform1i(uniforms.cloudEdgeData,7);gl.uniform1i(uniforms.cloudBackground,8);gl.uniform1i(uniforms.cloudPeaks,9);gl.uniform1i(uniforms.paintCoverage,10);
function texture(unit){gl.activeTexture(gl.TEXTURE0+unit);let t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);for(const k of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,k,gl.CLAMP_TO_EDGE);return t}const art=texture(0),gas=texture(1),bankTexture=texture(2),plateTexture=texture(3),flowTexture=texture(4),lightTexture=texture(5),infoTexture=texture(6),edgeTexture=texture(7),backgroundTexture=texture(8),peakTexture=texture(9),paintTexture=texture(10),image=new Image();
image.onload=()=>{findStars(image);gl.uniform2f(uniforms.texel,1/ART_W,1/ART_H);gl.uniform1f(uniforms.imageAspect,ART_W/ART_H);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,art);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);loadLayers().then(()=>{draw();frames++;canvas.classList.add('on');schedule()}).catch(e=>{throw e})};image.src='assets/nebula.png';
// Keep pacing remainder separate from elapsed scene time. Pause owns no RAF.
let raf=null,last=null,acc=0,pending=0;
function stopped(){return paused||document.hidden||gl.isContextLost()}
function schedule(){
 if(raf!==null)cancelAnimationFrame(raf);
 raf=null;last=null;acc=0;pending=0;
 if(frames>0&&!stopped())raf=requestAnimationFrame(loop);
}
function loop(now){
 raf=null;if(stopped())return;
 const elapsed=last===null?0:Math.max(0,Math.min(.1,(now-last)/1000));last=now;
 acc+=elapsed;pending+=elapsed;const interval=1/fps;
 if(acc+1e-6>=interval){time+=pending*speed;pending=0;acc=Math.max(0,acc-interval);draw();frames++;}
 raf=requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange',schedule);
function draw(){gl.useProgram(program);gl.uniform1f(uniforms.fogEdgeMode,fogEdgeMode);gl.uniform1f(uniforms.fogEdgeSpeed,fogEdgeSpeed);gl.uniform1f(uniforms.fogEdgeDefinition,fogEdgeDefinition);gl.uniform1f(uniforms.motionMode,motionMode);gl.uniform1f(uniforms.frameStep,1/fps);gl.uniform1f(uniforms.electricMode,electricMode);gl.uniform1f(uniforms.electricPower,electricPower);gl.uniform1f(uniforms.chargePower,chargePower);gl.uniform1f(uniforms.chargeSpeed,chargeSpeed);gl.uniform1f(uniforms.saturation,saturation);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);gl.uniform1f(uniforms.time,time);gl.uniform1f(uniforms.cloudTime,time*cloudSpeed+cloudOffset);gl.uniform1f(uniforms.amount,effectOn('clouds')?amount:0);gl.uniform1f(uniforms.lighting,effectOn('electricity')?lighting:0);gl.uniform1f(uniforms.cloudGain,effectOn('clouds')?smoke:0);gl.uniform1f(uniforms.coverage,effectCoverage?effectNames.indexOf(effectCoverage)+1:0);gl.uniform1f(uniforms.view,view);gl.uniform1f(uniforms.smoke,effectOn('clouds')?smoke:0);gl.uniform1f(uniforms.fogAmount,effectOn('fog')?fogAmount:0);gl.drawArrays(gl.TRIANGLES,0,6);if(!effectCoverage&&(view===0||view===6)){if(spaceStrength>0)drawStars(1);}}
window.studyRender=(t)=>{if(typeof t==='number')time=t;draw()};
async function loadLayers(){
 // Decode all layers in parallel, then upload them in the original order.
 const layers=[['assets/bank-mask.svg',2,bankTexture],['assets/bank-plate.png',3,plateTexture],['assets/gas.png',1,gas],['assets/flow.png',4,flowTexture],['assets/light.png',5,lightTexture],['assets/info.png',6,infoTexture],['assets/edge.png',7,edgeTexture],['assets/cloud-background.png',8,backgroundTexture],['assets/peaks.png',9,peakTexture],['assets/coverage.png',10,paintTexture]];
 const images=await Promise.all(layers.map(([src])=>{const img=new Image();img.src=src;return img.decode().then(()=>img);}));
 for(const [i,[src,unit,target]] of layers.entries()){
  const img=images[i];gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,target);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);if(unit===4||unit===6){gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);}gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
 }
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
}

canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();schedule();try{sessionStorage.setItem('luminous-runtime-v4',JSON.stringify({time,paused,fps,amount,smoke,cloudSpeed,cloudOffset,chargePower,spaceStrength,fogAmount,scale,sliders:sliderValues}));}catch{}});canvas.addEventListener('webglcontextrestored',()=>location.reload());

let spaceVariant=0;let spaceEnabled=true,spaceStrength=.4,spaceRate=1,spaceOffset=0;let spaceData=[],spaceBuffer;let originalStarProgram;let starData=[],starBuffer,starProgram;
function findStars(img){
 const c=document.createElement('canvas');c.width=ART_W;c.height=ART_H;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,ART_W,ART_H);const px=ctx.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height;
 const lum=(x,y)=>{let i=(y*W+x)*4;return(px[i]*.2126+px[i+1]*.7152+px[i+2]*.0722)/255};
 const candidates=[];
 for(let y=5;y<H-5;y++)for(let x=5;x<W-5;x++){
  let l=lum(x,y);if(l<.24)continue;
  if(l<lum(x-1,y)||l<=lum(x+1,y)||l<lum(x,y-1)||l<=lum(x,y+1))continue;
  let ring=0,bright=0;for(let j=0;j<8;j++){let th=j*Math.PI/4;const v=lum(x+Math.round(Math.cos(th)*4),y+Math.round(Math.sin(th)*4));ring+=v/8;if(v>l*.55)bright++;}
  // Reject extended lit filaments; retain isolated bright original pinpoints.
  if(l-ring<.14||bright>2)continue;
  candidates.push({x,y,l,score:l-ring});
 }
 candidates.sort((a,b)=>b.score-a.score);const chosen=[];
 // Uniform artwork-space spacing; one population without pocket weighting.
 const minDistance=28*W/1672;
 for(const p of candidates){if(chosen.some(q=>(p.x-q.x)**2+(p.y-q.y)**2<minDistance*minDistance))continue;chosen.push(p);if(chosen.length>=320)break;}
 window.starSelection={count:chosen.length,minDistance,positions:chosen.map(p=>[p.x,p.y])};
 for(let i=0;i<chosen.length;i++){const p=chosen[i],o=(p.y*W+p.x)*4,m=Math.max(px[o],px[o+1],px[o+2],1);starData.push((p.x+.5)/W,1-(p.y+.5)/H,px[o]/m,px[o+1]/m,px[o+2]/m,p.l,Math.sin(i*91.73+17.8)*.5+.5,6+5*p.l);}
 let seed=84391;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 for(let y=0;y<10;y++)for(let x=0;x<18;x++){const z=random(),p=random();spaceData.push((x+.3+random()*.4)/18,(y+.3+random()*.4)/10,.65+.23*p,.72+.02*p,.88-.31*p,z,p,3.2+5.8*Math.pow(z,4));}
 spaceBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,spaceBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(spaceData),gl.STATIC_DRAW);
 starBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,starBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(starData),gl.STATIC_DRAW);
 const vs=`attribute vec2 position;attribute vec3 tint;attribute vec3 props;uniform vec2 resolution;uniform float time,strength,variation;varying vec3 col;varying float flare;varying float kind;
void main(){float z=props.x,seed=props.y;float phase=seed*6.2831853;vec2 p=position;float lifetime=mix(6.,14.,seed);float cycle=time/lifetime+seed*9.73;float life=fract(cycle);float envelope=smoothstep(0.,.22,life)*(1.-smoothstep(.65,1.,life));float size=7.+12.*pow(z,2.);float opacity=.9;
// Each style is one whole-scene population. Respawns occur at zero opacity.
if(variation<.5){p+=vec2(time*.004,time*.0012);p+=vec2(sin(time*.21+phase)*.01,cos(time*.16+phase)*.018)*z;size=6.+12.*pow(z,3.);}
else if(variation<1.5){p+=vec2(sin(phase+time*.08)*.009,cos(phase+time*.07)*.012);size=(8.+15.*z)*(.75+.25*envelope);opacity=.95;}
else if(variation<2.5){p+=vec2(time*.002,-time*.001);p+=vec2(sin(time*.13+phase)*.013,cos(time*.1+phase)*.016)*z;size=12.+30.*pow(z,3.);opacity=.48;}
else if(variation<3.5){p+=vec2(time*.0025,time*.007);p+=vec2(sin(time*.4+phase)*.016,cos(time*.2+phase)*.005);size=7.+14.*z;opacity=.85;}
else{p+=vec2(time*.01,time*.004);p+=vec2(sin(time*.14+phase)*.004,cos(time*.13+phase)*.006);size=16.+22.*z;opacity=.9;}
p=fract(p);flare=envelope*opacity*strength;
flare*=smoothstep(0.,.025,p.x)*smoothstep(0.,.025,1.-p.x)*smoothstep(0.,.035,p.y)*smoothstep(0.,.035,1.-p.y);
col=tint;if(variation>2.5&&variation<3.5)col=mix(vec3(.94,.47,.22),vec3(.98,.78,.47),seed);else col=mix(tint,vec3(.83,.77,.92),z*.35);
kind=variation;gl_Position=vec4(p*2.-1.,0.,1.);gl_PointSize=max(2.,size*resolution.y/941.);}`;
 const fs=`precision highp float;varying vec3 col;varying float flare;varying float kind;
void main(){vec2 p=(gl_PointCoord-.5)*2.;float r=dot(p,p);if(r>=1.)discard;float shape;
if(kind<.5)shape=exp(-r*9.)+.17*exp(-r*2.5);
else if(kind<1.5)shape=exp(-r*15.)+.28*exp(-r*3.5);
else if(kind<2.5)shape=exp(-r*2.)*(1.-smoothstep(.35,1.,r));
else if(kind<3.5){vec2 q=p*vec2(1.6,.75);shape=exp(-dot(q,q)*6.)+.15*exp(-r*3.);}
else{vec2 q=vec2(dot(p,normalize(vec2(1.,-.4))),dot(p,normalize(vec2(.4,1.))));shape=exp(-q.x*q.x*2.-q.y*q.y*80.)*(1.-smoothstep(.4,1.,abs(q.x)));}
gl_FragColor=vec4(col,clamp(shape*flare*(1.-smoothstep(.75,1.,r)),0.,.95));}`;
 starProgram=gl.createProgram();gl.attachShader(starProgram,compile(gl.VERTEX_SHADER,vs));gl.attachShader(starProgram,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(starProgram);if(!gl.getProgramParameter(starProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(starProgram));
 const originalVs=`attribute vec2 position;attribute vec3 tint;attribute vec3 props;uniform vec2 resolution;uniform float imageAspect,time,strength,view,particleMode;varying vec3 col;varying float flare;
 // Soft artwork-space regions follow the user's red cloud / blue star / green river map.
float ellipse(vec2 p,vec2 c,vec2 size){vec2 q=(p-c)/size;return exp(-dot(q,q)*1.6);}
float segment(vec2 p,vec2 a,vec2 b,float width){vec2 ab=b-a;vec2 q=p-a-ab*clamp(dot(p-a,ab)/dot(ab,ab),0.,1.);return exp(-dot(q,q)/(width*width));}
float cloudRegion(vec2 p){
 float left=ellipse(p,vec2(.07,.56),vec2(.16,.24));
 float bottom=ellipse(p,vec2(.31,.17),vec2(.20,.25));
 float mid=ellipse(p,vec2(.44,.34),vec2(.095,.15));
 float lower=segment(p,vec2(.49,.24),vec2(.75,.08),.12);
 float upper=segment(p,vec2(.44,1.02),vec2(.66,.65),.105);
 float right=segment(p,vec2(.79,.61),vec2(1.,.86),.092);
 return max(max(max(left,bottom),max(mid,lower)),max(upper,right));
}
float sparkleRegion(vec2 p){
 float upperLeft=ellipse(p,vec2(.26,.92),vec2(.20,.11));
 float upperRight=ellipse(p,vec2(.85,.93),vec2(.17,.17));
 float leftPocket=ellipse(p,vec2(.20,.51),vec2(.075,.11));
 float bottomLeft=ellipse(p,vec2(.11,.15),vec2(.13,.23));
 float mid=ellipse(p,vec2(.62,.29),vec2(.14,.11));
 float right=ellipse(p,vec2(.90,.18),vec2(.13,.24));
 return max(max(max(upperLeft,upperRight),max(leftPocket,bottomLeft)),max(mid,right));
}

 void main(){float aspect=resolution.x/resolution.y;vec2 p=position;float zone=sparkleRegion(position);
 float life=fract(time/(8.+props.y*10.)+props.y*7.13);
 float alive=smoothstep(0.,.18,life)*(1.-smoothstep(.68,1.,life));
 // Only a minority wander locally; no shared direction or travel across the scene.
 if(particleMode>.5){float moving=step(.72,props.y);float seed=props.y*317.;
 p+=moving*vec2(sin(time*(.12+props.y*.09)+seed)*.0018,cos(time*(.09+props.y*.13)+seed*1.73)*.0022);}
 if(view==6.)p=(p-vec2(.265,.27))/vec2(aspect*.30,.30)+.5;else if(aspect>imageAspect)p.y=(p.y-.5)*aspect/imageAspect+.5;else p.x=(p.x-.5)*imageAspect/aspect+.5;gl_Position=vec4(p*2.-1.,0.,1.);
 float phase=time*(.7+props.y*1.3)+props.y*71.;float pulse=pow(.5+.5*sin(phase),5.);flare=(.04+1.35*pulse)*props.x*strength;if(particleMode>.5)flare=alive*(.18+.55*pulse)*strength;flare*=.8;col=tint;float zoom=view==6.?3.33:1.;gl_PointSize=max(2.,mix(props.z,4.+props.y*3.,particleMode)*resolution.y/941.*zoom);}`;
 const originalFs=`precision highp float;varying vec3 col;varying float flare;void main(){vec2 p=(gl_PointCoord-.5)*2.;float radius=dot(p,p);if(radius>=1.)discard;float core=exp(-radius*20.);float halo=exp(-radius*8.)*.12;float falloff=1.-smoothstep(.55,1.,radius);gl_FragColor=vec4(col*(core+halo)*falloff*flare,1.);}`;
 originalStarProgram=gl.createProgram();gl.attachShader(originalStarProgram,compile(gl.VERTEX_SHADER,originalVs));gl.attachShader(originalStarProgram,compile(gl.FRAGMENT_SHADER,originalFs));gl.linkProgram(originalStarProgram);if(!gl.getProgramParameter(originalStarProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(originalStarProgram));
}
function drawOriginalStars(particleMode=0){if(!originalStarProgram)return;gl.useProgram(originalStarProgram);gl.bindBuffer(gl.ARRAY_BUFFER,starBuffer);const attrs=[['position',2,0],['tint',3,8],['props',3,20]];for(const [n,size,offset]of attrs){const loc=gl.getAttribLocation(originalStarProgram,n);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);}
 for(const [n,v]of Object.entries({imageAspect:ART_W/ART_H,time,strength:particleMode?particles:sparkles,view,particleMode}))gl.uniform1f(gl.getUniformLocation(originalStarProgram,n),v);gl.uniform2f(gl.getUniformLocation(originalStarProgram,'resolution'),canvas.width,canvas.height);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.drawArrays(gl.POINTS,0,starData.length/8);gl.disable(gl.BLEND);for(const [n]of attrs)gl.disableVertexAttribArray(gl.getAttribLocation(originalStarProgram,n));}
function drawStars(particleMode=0){if(!particleMode)return drawOriginalStars(0);if(!starProgram)return;gl.useProgram(starProgram);gl.bindBuffer(gl.ARRAY_BUFFER,particleMode?spaceBuffer:starBuffer);const attrs=[['position',2,0],['tint',3,8],['props',3,20]];for(const [n,size,offset]of attrs){const loc=gl.getAttribLocation(starProgram,n);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,32,offset);}
 for(const [n,v]of Object.entries({imageAspect:ART_W/ART_H,variation:spaceVariant,time:particleMode?time*spaceRate+spaceOffset:time,strength:particleMode?spaceStrength:sparkles,view,particleMode}))gl.uniform1f(gl.getUniformLocation(starProgram,n),v);gl.uniform2f(gl.getUniformLocation(starProgram,'resolution'),canvas.width,canvas.height);gl.enable(gl.BLEND);gl.blendFunc(particleMode?gl.SRC_ALPHA:gl.ONE,particleMode?gl.ONE_MINUS_SRC_ALPHA:gl.ONE);gl.drawArrays(gl.POINTS,0,(particleMode?spaceData:starData).length/8);gl.disable(gl.BLEND);for(const [n]of attrs)gl.disableVertexAttribArray(gl.getAttribLocation(starProgram,n));}

// Defaults = the owner's live 1.3 settings (cloud amount 100, speed 97, lightning 84, fog 42, dust 40), set before asynchronous image decoding.
amount=1;smoke=1/.95;sparkles=1.2;fogAmount=.42;fogEdgeSpeed=2;cloudSpeed=.97;speed=1;scale=1;
window.studioSettings={get(){return{dustPercent:spaceStrength*100,cloudSpeed,amount,smoke,sparkles,fog:fogAmount,fogSpeed:fogEdgeSpeed,speed,scale,electric:{motion:motionMode,mode:electricMode,power:electricPower,movement:chargePower,velocity:chargeSpeed},enabled:{...effectEnabled}}}};
// Restore current runtime values after a context reload; legacy inspector storage is ignored.
try{const saved=JSON.parse(sessionStorage.getItem('luminous-runtime-v4')||'null');if(saved){sessionStorage.removeItem('luminous-runtime-v4');({time,paused,fps,amount,smoke,cloudSpeed,cloudOffset,chargePower,spaceStrength,fogAmount,scale}=saved);Object.assign(sliderValues,saved.sliders);resize();}}catch{}
// CAPTURE_HOOK

'use strict';
// Sea: the chosen variant, final. A calm plate replaces the painted sea, with fine dashes on sliding sheets, swell, gust patches, cloud columns,
// the headland's mirror, surf at its foot and faint rows of wave crests rolling in. The tuned values are constants below.
// The wallpaper's Sea slider only sets the speed: 0 stands the water still, it never fades to the painting. The cloud columns run on the clouds' own clock.
// Built by make_sea.py (not in this repo).
(() => {
const SPEED = .85;      // the water's own pace at Sea 50
const MIPPED = ['uSeaSheets', 'uSeaPillar'];
let mipsDone = false;
const SEA_DECL = `
uniform sampler2D uSeaPlate,uSeaMatte,uSeaHead,uSeaSheets,uSeaPillar;
uniform sampler2D uSeaCpFar;    // the clean plate's far band (grass/clean/build_far.py): R where it replaced the old far plate, G where it shows sea
uniform float uSeaT,uSeaW;      // uSeaT: sheets and crests. uSeaW: the air over the water. Both follow the Sea slider only; the Wind slider moves the plants, not the sea.
`;
// the water at one point
const SEA_LIVE = `
// the tuned values, set live with a development tuning hook
const float SEA_MIRROR=.6, SEA_COLS=.65, SEA_SWELL=1.6, SEA_GUST=2.5, SEA_DEPTH=1.6, SEA_GLOW=.45, SEA_SURF=1.3, SEA_ROLL=.2;
// one texture holds the wave sheets: R painted strokes (unused), G fine dashes, B swell
vec4 seaTap(vec2 uv){ return texture(uSeaSheets,uv,-.2)-.5; }
// a rigid sheet at a constant scale, sliding at a constant speed: a mark keeps its size, stays flat and goes one way. All in art px.
vec4 seaLayer(vec2 A,vec2 tile,vec2 v,float ofs){ return seaTap((A-v*uSeaT)/tile+ofs); }
vec3 seaLive(vec2 A,vec2 q,float dz,float cloudOff){
  float T=uSeaT, W=uSeaW;
  // The water is three sets of sheets, far, middle and near, cross-faded by row. Each slides with the wind in +x and a little toward the shore,
  // near sheets fastest. Nothing maps through a vanishing point, so nothing fans out or tilts. Perspective is in the sizes of the sheets.
  float d=dz+8., lv=log(d);
  float bF=smoothstep(3.,12.,dz)*(1.-smoothstep(30.,50.,dz)), bN=smoothstep(74.,104.,dz), bM=smoothstep(30.,50.,dz)*(1.-bN);
  // ---- calm plate and its depth. Colour depth 0 = the even tone of the painted sea, 1 = the plate, above 1 deeper still
  float pv=min((A.y-470.)/510.,.331);
  vec3 plate=texture(uSeaPlate,vec2(q.x,pv)).rgb;
  vec3 live=mix(vec3(.08,.46,.83),plate,SEA_DEPTH);
  live+=SEA_GLOW*.14*exp(-dz/5.)*vec3(.7,.75,.7);
  // ---- swell: broad soft bands rolling in
  float s=mix(seaLayer(A,vec2(520.,90.),vec2(1.2,.3),.37).b,seaLayer(A,vec2(820.,210.),vec2(2.6,.8),.11).b,bN);
  float swell=s*2.*smoothstep(10.,50.,dz);
  // ---- fine dashes: they show where a gust patch passes
  float hDF=seaLayer(A,vec2(420.,470.),vec2(.8,.08),.13).g;
  float hDM=seaLayer(A,vec2(620.,620.),vec2(2.7,.3),.61).g;
  float hDN=seaLayer(A,vec2(800.,760.),vec2(5.4,.7),.29).g;
  float hD=hDF*bF+hDM*bM+hDN*bN;
  // ---- gust patches: fronts in +x with the plants' gust envelope, faster near the shore, and fine dashes coming up inside them
  float gn=mix(vn(vec2(A.x/230.-W*.11,lv*3.4+9.)),vn(vec2(A.x/380.-W*.16,lv*3.4+9.)),smoothstep(40.,90.,dz))*.68+vn(vec2(A.x/150.-W*.26,lv*8.+3.3))*.32;
  float genv=.45+.55*(.5+.5*sin(W*.17)*sin(W*.107+1.1));
  float gust=smoothstep(.47,.72,gn+hD*.22)*genv*SEA_GUST*smoothstep(10.,48.,dz);
  float gu=min(gust,1.);
  // ---- mirror: the real clouds, read as narrow columns. cloudOff is the clouds' own clock, so the columns follow them whatever the Sea slider says.
  vec4 R=vec4(0.); float Rc=0.;
  for(int i=0;i<3;i++){
    float fi=float(i), vs=1.+.5*fi+hD*.25;
    float vv=clamp((452.-dz*vs)/480.,.004,.996), uu=fract((A.x+(fi-1.)*.8-cloudOff)/2544.);
    vec2 aa=textureLod(uSeaPillar,vec2(uu,vv*.5+.5),0.).rg;
    R+=vec4(textureLod(uSeaPillar,vec2(uu,vv*.5),0.).rgb,aa.r); Rc+=aa.g;
  }
  R/=3.; Rc/=3.;
  // the strip's G channel holds only the column peaks of each cloud: under a wide cumulus the deep blue survives between them, as the painting has it
  float cA=mix(R.a,Rc,SEA_COLS);
  float fres=mix(.98,.24,smoothstep(14.,120.,dz))*SEA_MIRROR*(1.-.5*gu)*smoothstep(0.,4.,dz);
  float cov=pow(cA,1.1);
  vec3 cloudC=(R.rgb/max(R.a,.04))*vec3(.8,.9,1.);
  live=live*(1.-fres*cov)+fres*cov*cloudC;
  // the headland in the water below it
  vec2 hv=vec2((A.x-1090.)/582.,(A.y-474.+hD*(1.+dz*.05))/100.);
  if(hv.x>0.&&hv.y<1.){
    float hy=clamp(hv.y,.004,.996);
    vec3 hc=texture(uSeaHead,vec2(hv.x,hy*.5)).rgb; float ha=texture(uSeaHead,vec2(hv.x,hy*.5+.5)).r;
    float hk=min(SEA_MIRROR,1.3)*.82*(1.-.5*gu)*(1.-smoothstep(10.,70.,dz)*.3);
    live=live*(1.-hk*ha)+hk*hc*vec3(.84,.93,1.);
  }
  // ---- light and shade of the water itself
  vec3 pale=mix(vec3(.56,.78,.99),cloudC,.3*cov);
  live*=1.+.045*SEA_SWELL*swell;
  // the fine dashes inside gust patches: thin soft lit shapes with a faint trough under them
  float mg=clamp(gu*1.1,0.,2.);
  float litF=smoothstep(.04,.5,hDF)*bF*.55*mg+smoothstep(.04,.5,hDM)*bM*.5*mg+smoothstep(.04,.5,hDN)*bN*.6*mg;
  float darkF=smoothstep(.04,.5,-hDF)*bF*.5*mg+smoothstep(.04,.5,-hDM)*bM*.45*mg+smoothstep(.04,.5,-hDN)*bN*.55*mg;
  live*=1.-clamp(.22*darkF,0.,.42);
  live=mix(live,pale,clamp(.3*litF,0.,.7));
  // gust: water in a gust mirrors the deep sky, so it goes a little darker and more saturated
  live=mix(live,live*vec3(.76,.86,.96),gu*.6);
  // waves: rows of crests rolling in toward the shore, spaced in perspective. Each crest is a thin pale line with its darker face just
  // in front of it, broken into pieces that belong to that crest and drift right with the wind, so no line crosses the sea.
  {
    float d=dz+6., xg=(A.x-836.)/d, v=log(d), px=uView.z/res.x;
    const float LV=.26;      // one wave in log depth: about 28 art px apart at the shore, 10 at mid sea
    float ph=v/LV-T*.085+.45*(vn(vec2(xg*.8,v*1.6))-.5);      // crests bend a little along their length
    float n=floor(ph), f=ph-n;
    float per=LV*d;      // art px from one crest to the next here
    float dc=min(f,1.-f)*per;      // art px to the nearest crest
    float nc=f<.5?n:n+1.;      // which crest that is, so its pieces travel with it
    float seg=smoothstep(.42,.68,vn(vec2(xg*1.5-T*.03,nc*1.73)))*smoothstep(.3,.6,vn(vec2(xg*.45-T*.012+3.,nc*.61)));
    float fade=smoothstep(7.,16.,per/px)*smoothstep(6.,30.,dz);      // crests closer than a few screen px would merge into bands
    float sg=sqrt(.45+.3*px*px);
    float crest=exp(-.5*dc*dc/(sg*sg));
    float face=f<.5?smoothstep(per*.32,0.,f*per)*smoothstep(0.,1.5,f*per):0.;      // the steep face toward the shore side of the crest
    float k=seg*fade*SEA_ROLL;
    live=mix(live,live*vec3(.8,.87,.94),min(face*.9*k,1.));
    live=mix(live,mix(live,vec3(.86,.95,1.),.6),min(crest*.75*k,1.));
  }
  // surf: a thin pale line breathing along the foot of the headland, slowly, never a flash
  if(A.x>1120.&&dz<40.){
    float up=texture(uSeaMatte,vec2(q.x,(A.y-2.4-470.)/170.)).r;
    // behind the far plants, what's above is the clean plate's own sea: the old matte there still says land inside the old crowns
    vec2 c2=texture(uSeaCpFar,vec2(q.x,(A.y-2.4-470.)/180.)).rg; up=mix(up,c2.g,c2.r);
    float br=smoothstep(.38,.72,vn(vec2(A.x/44.-T*.035,T*.07)))*.75+.25;
    live=mix(live,vec3(.86,.94,.98),(1.-up)*br*SEA_SURF*.3);
  }
  return live;
}
`;
// the sea's clocks. These only wrap once a day: the sheets move too slowly for float precision to matter before that.
function clocks(ctx, P) {
  const pace = ctx.pace('sea');
  ctx.gl.uniform1f(P.u.uSeaT, (pace * SPEED) % 86400);
  ctx.gl.uniform1f(P.u.uSeaW, pace % 86400);
}
SC.part({
  title: 'Sea', order: 30,
  files: { seaPlate: 'assets/sea-plate.webp', seaMatte: 'assets/sea-matte.png', seaHead: 'assets/sea-head.webp', seaSheets: 'assets/sea-sheets.webp', seaPillar: 'assets/sea-pillars.webp',
    seaCpFar: 'assets/plants-cp-farsea.png' },      // from grass/clean/build_far.py: where the clean plate replaced the far plate, and its sea
  formats: { seaMatte: 'RG8', seaCpFar: 'RG8' },
  wrap: ['seaSheets', 'seaPillar'],
  samplers: { uSeaPlate: 'seaPlate', uSeaMatte: 'seaMatte', uSeaHead: 'seaHead', uSeaSheets: 'seaSheets', uSeaPillar: 'seaPillar', uSeaCpFar: 'seaCpFar' },
  uniforms: ['uSeaT', 'uSeaW'],
  setup() { mipsDone = false; },
  set(ctx, P) {
    const { gl } = ctx;
    if (!mipsDone) {
      // the sheets are minified: mipmaps keep small far marks from aliasing into twinkle
      mipsDone = true;
      for (const name of MIPPED) {
        gl.activeTexture(gl.TEXTURE0 + gl.getUniform(P.p, P.u[name]));
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      }
    }
    clocks(ctx, P);
  },
  backDecl: `
${SEA_DECL}
${SEA_LIVE}
`,
  backBody: `
  if(A.y>470.&&A.y<640.){
    vec2 sm=texture(uSeaMatte,vec2(q.x,(A.y-470.)/170.)).rg;
    // The clean plate's far plants stand on a clean sea of their own. Where that plate replaced the old one (R), the live water covers
    // exactly its sea (G), with the plate as its own rest colour. The old matte and rest there still hold the old crowns, which showed in
    // the water as a pale ghost and a dark outline wherever a new crown swayed off them (rejected: rough cut-outs).
    vec2 cf=texture(uSeaCpFar,vec2(q.x,(A.y-470.)/180.)).rg;
    if(sm.g>.002||sm.r>.002||cf.g>.002){
      float pv0=min((A.y-470.)/510.,.331);
      vec3 rest=mix(texture(uSeaPlate,vec2(q.x,pv0+1./3.)).rgb,I,cf.r);
      // coverage: the matte, and behind the far plants the plate's own colour (its water is blue, nothing else around it is)
      float sa=mix(max(sm.r,sm.g*smoothstep(.08,.92,(I.b-I.g)/max(rest.b-rest.g,.05))),cf.g,cf.r);
      if(sa>.002){
        vec3 live=seaLive(A,q,dz,uCloudOff);
        // onto the painting. Edge pixels keep their land: only the sea's share of them changes. Deep water is all new.
        vec3 seaC=mix(I+sa*(live-rest),live,smoothstep(.92,1.,sa));
        col+=(seaC-I)*smoothstep(.6,2.5,dz);
      }
    }
  }
`,
});
})();

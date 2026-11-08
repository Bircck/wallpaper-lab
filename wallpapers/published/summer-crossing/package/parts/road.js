'use strict';
// Leaf shadows on the road: the ground is a still clean plate painted by Codex, and only the shadow's shape moves over it, as a
// coloured gel: plate * mix(warm, R, shape). Everything comes from make_road_shadow.py (not in this repo).
SC.part({
  title: 'Road', order: 40,
  files: { roadLeaves: 'assets/road-leaves.png', roadClean: 'assets/road-clean.jpg', roadMat: 'assets/road-mat.png' }, formats: { roadMat: 'RG8' },
  samplers: { uRoadLeaves: 'roadLeaves', uRoadClean: 'roadClean', uRoadMat: 'roadMat' },
  backDecl: `
const vec3 ROAD_R_ASPHALT=vec3(0.299,0.484,0.759),ROAD_R_DIRT=vec3(0.324,0.445,0.704),ROAD_WARM=vec3(1.138,1.095,1.013);
// the tuned values: how far the crown rocks, how far small patches slide, edge softness, how much a cloud shadow fades the leaf shadows
const float SH_SWAY=.35,SH_PATCH=.85,SH_SOFT=2.05,SH_CLOUD=.55;
uniform sampler2D uRoadLeaves,uRoadClean,uRoadMat;
`,
  backBody: `
  if(A.y>700.&&A.x>470.&&A.x<1370.){
    vec2 du=(A-vec2(470.,700.))/vec2(900.,241.);
    vec2 mat=texture(uRoadMat,du).rg;
    if(mat.r>.004){
      // how far this part of the shadow has swayed. Near ground is drawn bigger, and the ground is seen flat, so y moves about a third of x.
      float nearK=.55/depth;
      vec2 G=vec2((A.x-836.)*depth*1.8,A.y*2.9);
      // on its own clock: the Wind slider moves the plants, not these shadows
      float t=uTime;
      float gust=(gustFront(vec2(A.x-220.,720.),t)+gustFront(vec2(A.x,720.),t)+gustFront(vec2(A.x+220.,720.),t))/3.;
      // the whole crown rocks slowly, branches a few hundred px across go their own way, and the wind leans them all while a gust passes
      vec2 sway=vec2(7.*sin(t*.52+G.x*.0025+.7*sin(t*.13))+3.*sin(t*.83+1.7+G.y*.004-G.x*.002),
                     6.*sin(t*.41+.9+G.x*.0018));
      sway+=vec2(vn(G/260.+vec2(t*.09,-t*.07))-.5,vn(G/260.+vec2(31.+t*.07,t*.08))-.5)*vec2(14.,10.);
      sway+=vec2(9.,2.)*gust;
      // small patches slide a little against each other, mostly in gusts
      vec2 pch=vec2(vn(G/70.+vec2(-t*.16,t*.11))-.5,vn(G/70.+vec2(17.+t*.13,5.-t*.12))-.5)*vec2(8.,6.)*(.3+1.1*gust);
      vec2 off=(sway*SH_SWAY+pch*SH_PATCH)*nearK*vec2(1.,.32);
      off.y*=smoothstep(941.,925.,A.y);      // no shape exists below the frame
      vec3 sh=texture(uRoadLeaves,du-off/vec2(900.,241.)).rgb;
      // gaps between the leaves open and close a little instead of shaking
      float gapB=(vn(G/44.+vec2(t*.13,-t*.1))-.5)*2.*(.3+.9*gust)*1.1*SH_PATCH*nearK;
      float sd=(sh.r*255.-128.)/6.+gapB;
      float M=smoothstep(-SH_SOFT,SH_SOFT,sd);
      M=1.-(1.-M)*sh.g;
      float wm=sh.b;
      vec3 gel=mix(mix(vec3(1.),ROAD_WARM,wm),mix(ROAD_R_DIRT,ROAD_R_ASPHALT,mat.g),M);
      // thin cloud over the sun: the ground dims (scene core) and the leaf shadows go soft with it
      float str=1.-SH_CLOUD*clamp((1.-cloudShadow(A,0.))/.17,0.,1.);
      gel=max(mix(vec3(1.),gel,str),vec3(.02));
      vec3 pl;
      if(uSS>.5){vec2 d=uTexel*vec2(1672./900.,941./241.)*.25;
        pl=.25*(texture(uRoadClean,du-d).rgb+texture(uRoadClean,du+d).rgb+texture(uRoadClean,du+vec2(d.x,-d.y)).rgb+texture(uRoadClean,du+vec2(-d.x,d.y)).rgb);}
      else pl=texture(uRoadClean,du).rgb;
      // the painted shade holds less grain than lit ground. Only where the light changes anyway, so lit ground and shaded ground each stay exact.
      vec3 base=mix(vec3(.76,.6,.44),vec3(.52,.49,.47),mat.g);
      pl=base+(pl-base)*mix(1.,.87,M*min(str,1.));
      col=mix(col,pl*gel,mat.r);
    }
  }
`,
});

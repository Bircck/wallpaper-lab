const canvas=document.querySelector('canvas');
const settings={speed:1,swell:1,roll:1,curves:1,hills:1,sunSize:1,sunHeight:0,plant:1,wind:1,lines:1,dust:1,fps:30,tod:.5,followClock:false,plantStyle:'sprig'};
let W=1,H=1,time=0,frames=0,hostPaused=false,raf=0,last=0,acc=0,pending=0,gl=null,lost=false;
const TAU=Math.PI*2,rnd=n=>{let x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)},mix=(a,b,t)=>a+(b-a)*t;
window.__wallpaperStats={frames:0,time:0,paused:false,fps:30};
function stopped(){return hostPaused||document.hidden||lost||settings.speed===0}
function sync(){window.__wallpaperStats={frames,time,paused:stopped(),fps:settings.fps}}
function schedule(){cancelAnimationFrame(raf);last=0;acc=0;pending=0;sync();if(!stopped())raf=requestAnimationFrame(tick)}
// The scene moves well under a pixel per frame, so it never draws faster than its movement needs, whatever the host allows.
const frameStep=()=>settings.fps?1/Math.min(settings.fps,Math.max(15,30*settings.speed*Math.max(.5,settings.swell,settings.roll,settings.wind))):0;
function tick(now){if(stopped())return;let dt=last?Math.min(.1,(now-last)/1000):0;last=now;acc+=dt;pending+=dt;let step=frameStep();if(acc+1e-4>=step){time+=pending*settings.speed;pending=0;acc=step?Math.max(0,acc-step):0;if(acc>step)acc=0;render(time);frames++;sync()}raf=requestAnimationFrame(tick)}

// Time of day: 0 night, .25 dusk, .5 the original sunset, .75 day, 1 noon. Colours blend between neighbours.
const hex=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255);
const KEYS=[
 {skyTop:'#0b1130',skyLow:'#2b2a5c',disc:'#f2e8cf',arc:'#6e73a6',crest:'#aeb6ea',hatch:'#6f76ad',dustC:'#cfd8ff',shadowC:'#050720',plantA:'#0a0b1d',plantB:'#1a1c42',plantC:'#5a5f96',d0:'#3b3b6e',d1:'#2f3060',d2:'#25264f',d3:'#1b1c3f',d4:'#12132c',sunY:.22,sunR:.105,glow:.2,stars:1,moon:1,shadowA:.34},
 {skyTop:'#3d3a78',skyLow:'#e58f7b',disc:'#f4b27c',arc:'#c87f7a',crest:'#f6c9c0',hatch:'#b88aa8',dustC:'#ffd9d0',shadowC:'#2a1638',plantA:'#241a30',plantB:'#3b2a4a',plantC:'#c98f9c',d0:'#b07a8c',d1:'#8f5f7f',d2:'#6f4a6e',d3:'#523a5a',d4:'#382a44',sunY:.34,sunR:.14,glow:.12,stars:.22,moon:0,shadowA:.26},
 {skyTop:'#f0dfbf',skyLow:'#d9ac7f',disc:'#bb5536',arc:'#c37450',crest:'#f8dfb4',hatch:'#e3b680',dustC:'#fff1d2',shadowC:'#552c27',plantA:'#633e2e',plantB:'#7d4f38',plantC:'#c79a68',d0:'#dfb98d',d1:'#cd976b',d2:'#b97750',d3:'#995534',d4:'#713f2e',sunY:.29,sunR:.153,glow:0,stars:0,moon:0,shadowA:.2},
 {skyTop:'#cfe3d8',skyLow:'#f2d8a8',disc:'#e8873f',arc:'#efae72',crest:'#fdeac2',hatch:'#efc78e',dustC:'#fff6df',shadowC:'#5a3a26',plantA:'#54502f',plantB:'#6f6a3a',plantC:'#d8b97e',d0:'#ecc999',d1:'#deb07a',d2:'#cd9560',d3:'#b47848',d4:'#8f5a38',sunY:.24,sunR:.13,glow:.08,stars:0,moon:0,shadowA:.18},
 {skyTop:'#7fc4e8',skyLow:'#e6f1e6',disc:'#f8c14a',arc:'#fbe6a4',crest:'#fff4d6',hatch:'#f7deac',dustC:'#ffffff',shadowC:'#7a5a3a',plantA:'#4f6b3a',plantB:'#6f8c4a',plantC:'#e8d9a8',d0:'#f5e0b5',d1:'#efcd96',d2:'#e3b475',d3:'#cf9a58',d4:'#b47c3f',sunY:.19,sunR:.115,glow:.22,stars:0,moon:0,shadowA:.16}
].map(k=>Object.fromEntries(Object.entries(k).map(([n,v])=>[n,typeof v==='string'?hex(v):v])));
function palette(v){let f=Math.max(0,Math.min(1,v))*4,i=Math.min(3,Math.floor(f)),s=f-i,a=KEYS[i],b=KEYS[i+1],o={};for(const k in a)o[k]=Array.isArray(a[k])?a[k].map((x,n)=>mix(x,b[k][n],s)):mix(a[k],b[k],s);return o}
const CLOCK=[[0,0],[5,0],[6.25,.25],[7.25,.5],[9,.75],[11.5,.75],[12,1],[13,1],[13.5,.75],[17,.75],[19,.5],[20,.25],[21.5,0],[24,0]];
function clockTod(){let d=new Date(),h=d.getHours()+d.getMinutes()/60;for(let i=1;i<CLOCK.length;i++)if(h<=CLOCK[i][0]){let [a,x]=CLOCK[i-1],[b,y]=CLOCK[i];return mix(x,y,(h-a)/(b-a))}return 0}
let pal=palette(.5);

// Dune crests only change across the screen, so the vertex shader works them out per column and the pixel shader just reads them.
const CREST=`uniform vec2 R;uniform float sway[5],rollA[5],rollB[5],curves,hills;
float crest(int i,float u,out float s){float l=float(i),v=(u-.5)*hills+.5,A=(.12-l*.011)*curves,B=.018*curves,p1=v*5.+l*.92+rollA[i],p2=v*9.+l+rollB[i];s=(cos(p1)*5.*A+cos(p2)*9.*B)*hills*R.y/R.x;return .49+l*.11+sway[i]+sin(p1)*A+sin(p2)*B;}`;
const SCENE_VS=`attribute vec2 a;varying vec2 cv[5];${CREST}
void main(){for(int i=0;i<5;i++){float s,c=crest(i,a.x,s);cv[i]=vec2(c,1./sqrt(1.+s*s));}gl_Position=vec4(a*2.-1.,0.,1.);}`;
const sceneFS=moon=>`${moon?'#define MOON\n':''}precision highp float;
uniform vec2 R;uniform vec4 sun;uniform vec3 skyTop,skyLow,disc,arc,crestC,hatchC,shadowC,dune[5];uniform float lineAmt,moon,shadowA;varying vec2 cv[5];
float hash(vec2 p){vec3 a=fract(p.xyx*.1031);a+=dot(a,a.yzx+33.33);return fract((a.x+a.y)*a.z);}
#ifdef MOON
float circle(vec2 q,vec2 o,float r,float px){return clamp((r-length(q-o))*px+.5,0.,1.);}
#endif
void main(){
 vec2 f=vec2(gl_FragCoord.x,R.y-gl_FragCoord.y);float H=R.y,y=f.y/H;vec2 q=vec2(f.x/H,y)-sun.xy;float rr=length(q),r=sun.z;
 vec3 c=mix(skyTop,skyLow,y);
 c=mix(c,disc,sun.w*exp(-max(rr-r,0.)/(r*.55)));
 float inDisc=clamp((r-rr)*H+.5,0.,1.);c=mix(c,disc,inDisc);
#ifdef MOON
 vec3 s=disc*vec3(.93,.92,.94);float e=120.,m=circle(q,vec2(-.34,-.26)*r,.3*r,e)+circle(q,vec2(.08,-.5)*r,.13*r,e)+circle(q,vec2(.42,.02)*r,.2*r,e)+circle(q,vec2(-.2,.46)*r,.24*r,e)+circle(q,vec2(.3,.56)*r,.1*r,e);c=mix(c,s,clamp(m,0.,1.)*moon*inDisc);
#endif
 const vec2 A=vec2(-.97592,-.21814),B=vec2(.89101,-.45399);float R1=r*1.1765,da=A.x*q.y-A.y*q.x>=0.&&q.x*B.y-q.y*B.x>=0.?abs(rr-R1):min(length(q-R1*A),length(q-R1*B));
 c=mix(c,arc,clamp((.0015-da)*H+.5,0.,1.));
 float sig=.0125*H,off=.008*H,dTop=-1.,wTop=0.;
 for(int i=0;i<5;i++){float d=(y-cv[i].x)*H*cv[i].y;
  c=mix(c,shadowC,shadowA*(1.-smoothstep(-2.*sig,2.*sig,-d-off)));
  c=mix(c,dune[i],clamp(d+.5,0.,1.));
  c=mix(c,crestC,(1.-clamp(abs(d),0.,1.))*.168);
  if(d>0.){dTop=d;wTop=i>=3?1.:max(0.,lineAmt-1.)*smoothstep(0.,2.,float(i));}
 }
 // Sand lines belong to whichever dune is in front. They start in the gap between two lines (d = whole spacing), so the first one is never cut in half.
 if(wTop>.001&&dTop>.009*H){float sp=.009*H,hw=min(1.,.7*H/900.)*.5,lc=clamp(hw+.5-abs(fract(dTop/sp)-.5)*sp,0.,1.);c=mix(c,hatchC,lc*wTop*min(lineAmt,1.8)*max(1.,.7*H/900.)*.1255*(1.-smoothstep(.1*H,.3*H,dTop)));}
 c+=(hash(f*.73+vec2(.31,.17))-.5)*.014;
 gl_FragColor=vec4(c,1.);
}`;
// Stars and dust are single points, so they cost almost nothing instead of a check on every pixel.
const STAR_VS=`attribute vec4 a;uniform vec4 sun;uniform float amount;varying vec3 v;${CREST}
void main(){float asp=R.x/R.y,u=a.x/asp,top=2.,s;for(int i=0;i<5;i++)top=min(top,crest(i,u,s));float sz=a.z*R.y/1080.;gl_PointSize=2.*(sz+1.);v=vec3(sz,gl_PointSize,a.w*amount*(1.-a.y*1.15));
 gl_Position=a.y>top||length(a.xy-sun.xy)<sun.z?vec4(2.,2.,0.,1.):vec4(u*2.-1.,1.-a.y*2.,0.,1.);}`;
const DUST_VS=`attribute vec4 a;attribute vec2 b;uniform vec2 R;uniform float span,dustX,dustY,dustBob,amt;varying vec3 v;
void main(){float asp=R.x/R.y,k=b.x,x=mod(a.x-dustX*(1.+k*.45),span),y=fract(a.y-dustY*(1.+k*.3)+sin(dustBob+a.w*40.)*.06/(9.+k*4.)),sz=(.45+a.z*.75)*R.y/1080.*(1.+min(amt,4.)*.08);gl_PointSize=2.*(sz+1.);v=vec3(sz,gl_PointSize,(.2+.4*a.z)*mix(.12,1.,smoothstep(.3,.62,y)));
 gl_Position=x>asp+.01?vec4(2.,2.,0.,1.):vec4(x/asp*2.-1.,1.-y*2.,0.,1.);}`;
const POINT_FS='precision highp float;varying vec3 v;uniform vec3 color;void main(){gl_FragColor=vec4(color,clamp(v.x+.5-length(gl_PointCoord-.5)*v.y,0.,1.)*v.z);}';
// Plant parts are ribbons: a centre line with a half width on each side, and soft edges worked out by the GPU.
const RIBBON_VS=`attribute vec4 a;attribute vec3 b;uniform vec4 box;uniform float aa,sil;uniform vec3 tones[3];varying float dist,hw;varying vec3 col;
void main(){hw=b.x;dist=b.y*(b.x+aa);vec2 p=a.xy+a.zw*dist;col=sil>.5?vec3(1.):tones[int(b.z)];gl_Position=vec4((p.x-box.x)/box.z*2.-1.,1.-(p.y-box.y)/box.w*2.,0.,1.);}`;
const RIBBON_FS='precision highp float;varying float dist,hw;varying vec3 col;uniform float scale;void main(){gl_FragColor=vec4(col,clamp((hw-abs(dist))*scale+.5,0.,1.)*min(1.,2.*hw*scale));}';
const QUAD_VS='attribute vec2 a;uniform vec4 box;varying vec2 uv;void main(){uv=a;gl_Position=vec4(box.xy+a*box.zw,0.,1.);}';
const BLUR_FS='precision highp float;uniform sampler2D t;uniform vec2 dir;varying vec2 uv;void main(){float s=0.;for(int i=-3;i<=3;i++){float x=float(i);s+=texture2D(t,uv+dir*x).r*exp(-x*x/3.88);}gl_FragColor=vec4(s/3.4556);}';
const SHADOW_FS='precision highp float;uniform sampler2D t;uniform vec4 color;varying vec2 uv;void main(){gl_FragColor=vec4(color.rgb,texture2D(t,uv).r*color.a);}';

let scenes={},scene=null,star,dust,ribbon,blur,shadow,meshBuf,quadBuf,starBuf,dustBuf,plantBuf,targets=[],starN=0,dustAll=[],dustN=0,span=3,pointsFor=0;
const COLS=512,TW=190,TH=162,swayV=new Float32Array(5),rollAV=new Float32Array(5),rollBV=new Float32Array(5);
function shader(type,src){let s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function program(vs,fs){let p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,vs));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,fs));gl.bindAttribLocation(p,0,'a');gl.bindAttribLocation(p,1,'b');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));let u={};for(let i=0,n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i<n;i++){let name=gl.getActiveUniform(p,i).name.replace('[0]','');u[name]=gl.getUniformLocation(p,name)}return{p,u}}
function target(){let tex=gl.createTexture(),fb=gl.createFramebuffer();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,TW,TH,0,gl.RGBA,gl.UNSIGNED_BYTE,null);for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);return{tex,fb}}
function staticBuffer(data){let b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return b}
function setup(){gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});if(!gl)throw Error('WebGL unavailable');
scenes={};pointsFor=0;star=program(STAR_VS,POINT_FS);dust=program(DUST_VS,POINT_FS);ribbon=program(RIBBON_VS,RIBBON_FS);blur=program(QUAD_VS,BLUR_FS);shadow=program(QUAD_VS,SHADOW_FS);
let mesh=new Float32Array((COLS+1)*4);for(let i=0;i<=COLS;i++){mesh[i*4]=mesh[i*4+2]=i/COLS;mesh[i*4+3]=1}meshBuf=staticBuffer(mesh);quadBuf=staticBuffer(new Float32Array([0,0,1,0,0,1,1,1]));starBuf=gl.createBuffer();dustBuf=gl.createBuffer();plantBuf=gl.createBuffer();
targets=[target(),target()];gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enableVertexAttribArray(0);lost=false;applyPalette()}
function attrib(buf,size0,size1,stride){gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.vertexAttribPointer(0,size0,gl.FLOAT,false,stride,0);if(size1){gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,size1,gl.FLOAT,false,stride,size0*4)}else gl.disableVertexAttribArray(1)}
function applyPalette(){let t=settings.followClock?clockTod():settings.tod;pal=palette(t);if(!gl)return;let moon=pal.moon>.001?1:0;scene=scenes[moon]||(scenes[moon]=program(SCENE_VS,sceneFS(moon)));gl.useProgram(scene.p);let u=scene.u;
for(const [n,k] of [['skyTop','skyTop'],['skyLow','skyLow'],['disc','disc'],['arc','arc'],['crestC','crest'],['hatchC','hatch'],['shadowC','shadowC']])gl.uniform3fv(u[n],pal[k]);
gl.uniform3fv(u.dune,[...pal.d0,...pal.d1,...pal.d2,...pal.d3,...pal.d4]);gl.uniform1f(u.moon,pal.moon);gl.uniform1f(u.shadowA,pal.shadowA);gl.uniform1f(u.lineAmt,settings.lines);
gl.useProgram(ribbon.p);gl.uniform3fv(ribbon.u.tones,[...pal.plantA,...pal.plantB,...pal.plantC]);countDust()}
function countDust(){let keep=Math.min(1,settings.dust*.35),n=0;while(n<dustAll.length&&dustAll[n]<keep)n++;dustN=n}
const fr=x=>x-Math.floor(x),hash=(x,y)=>{let a=fr(x*.1031),b=fr(y*.1031),c=a,d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);a+=d;b+=d;c+=d;return fr((a+b)*c)};
function buildPoints(){let asp=W/H;if(pointsFor===asp)return;pointsFor=asp;let s=[];for(let gx=0;gx<=Math.ceil(asp*38);gx++)for(let gy=0;gy<38;gy++){if(hash(gx,gy)<=.66)continue;let z=hash(gx+11.3,gy+11.3);s.push((gx+.5+(hash(gx+3.1,gy+3.1)-.5)*.7)/38,(gy+.5+(hash(gx+7.7,gy+7.7)-.5)*.7)/38,.45+z*z*1.15,.35+.65*z)}starN=s.length/4;gl.bindBuffer(gl.ARRAY_BUFFER,starBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(s),gl.STATIC_DRAW);
span=Math.ceil(asp)+1;let d=[];for(let k=0;k<2;k++){let sc=9+k*4;for(let gx=0;gx<span*sc;gx++)for(let gy=0;gy<sc;gy++){let h=hash(gx+k*17,gy+k*17);d.push([(gx+.5+(hash(gx+5.1+k,gy+5.1+k)-.5)*.72)/sc,(gy+.5+(hash(gx+9.7+k,gy+9.7+k)-.5)*.72)/sc,hash(gx+13.3,gy+13.3),h,k])}}d.sort((a,b)=>a[3]-b[3]);dustAll=d.map(x=>x[3]);gl.bindBuffer(gl.ARRAY_BUFFER,dustBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(d.flatMap(x=>[x[0],x[1],x[2],x[3],x[4],0])),gl.STATIC_DRAW);countDust()}
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;schedule()});
canvas.addEventListener('webglcontextrestored',()=>{setup();resize();schedule()});

const STRIDE=7,PV=new Float32Array(STRIDE*24000),XS=new Float32Array(64),YS=new Float32Array(64),AS=new Float32Array(64),PL=new Float32Array(1500);let pn=0,startNew=false,shadowVerts=0;
function vert(x,y,nx,ny,w,side,tone){PV[pn]=x;PV[pn+1]=y;PV[pn+2]=nx;PV[pn+3]=ny;PV[pn+4]=w;PV[pn+5]=side;PV[pn+6]=tone;pn+=STRIDE}
// One step along a ribbon. New ribbons join the running strip through two invisible zero-area triangles.
function pt(x,y,nx,ny,w,tone){if(startNew){if(pn){PV.copyWithin(pn,pn-STRIDE,pn);pn+=STRIDE;vert(x,y,nx,ny,w,1,tone)}startNew=false}vert(x,y,nx,ny,w,1,tone);vert(x,y,nx,ny,w,-1,tone)}
function blade(x,y,a,len,w,bend,tone,n=12){let st=len/n;startNew=true;for(let i=0;i<=n;i++){let s=i/n;pt(x,y,-Math.sin(a),Math.cos(a),w*Math.pow(1-s,.8)*Math.min(1,.5+s*4),tone);a+=bend/n;x+=Math.cos(a)*st;y+=Math.sin(a)*st}}
// An almond leaf from its base point; side=1 or -1 is only that half of it.
function leaf(x,y,a,len,w,tone,side=0,n=10){let ca=Math.cos(a),sa=Math.sin(a);startNew=true;for(let i=0;i<=n;i++){let t=i/n,along=2*t*(1-t)*.42*len+t*t*len,h=2*t*(1-t)*w,off=side*h/2;pt(x+ca*along-sa*off,y+sa*along+ca*off,-sa,ca,side?h/2:h,tone)}}
function sprig(S,t,wn,ox,oy){const N=30,st=S*1.02/N;let x=ox,y=oy,gust=wn*(Math.sin(t*.42)*.1+Math.sin(t*1.03+1)*.035);for(let k=0;k<=N;k++){let s=k/N,a=-Math.PI/2+.02+.34*Math.sin(s*4.2-.6)*s+gust*s*s*1.5;XS[k]=x;YS[k]=y;AS[k]=a;x+=Math.cos(a)*st;y+=Math.sin(a)*st}
 for(let half=0;half<2;half++){for(let k=10,side=-1;k<N;k+=2,side=-side){let s=k/N,a=AS[k]+side*(.86-s*.34)+wn*Math.sin(t*1.15+k*1.3)*.035,len=S*.2*(1.1-Math.pow(s,2.2)*.55)*(.93+rnd(k)*.14);leaf(XS[k],YS[k],a,len,len*.2,half,half?side:0)}leaf(XS[N],YS[N],AS[N]+wn*Math.sin(t*1.3)*.04,S*.14,S*.026,half,half);if(!half)shadowVerts=pn/STRIDE}
 startNew=true;for(let k=0;k<=N;k++)pt(XS[k],YS[k],-Math.sin(AS[k]),Math.cos(AS[k]),S*.0105*(1-k/N*.82),0)}
function grass(S,t,wn,ox,oy){const n=34;for(let tone=0;tone<2;tone++){for(let i=tone;i<n;i+=2){let sp=(i/(n-1)-.5)*2+(rnd(i*3+1)-.5)*.28,r2=rnd(i*3+2),r3=rnd(i*3+3),g=wn*(Math.sin(t*.55-sp*1.3)*.2+Math.sin(t*1.4+i*1.7)*.04+.05);blade(ox+sp*S*.13,oy,-Math.PI/2+sp*.34,S*(.6+.46*(1-Math.abs(sp))*(.45+.55*r2)),S*(.0085+.004*r3),sp*.62+(r2-.5)*.32+g*(.7+.6*r2),tone?0:1)}if(!tone)shadowVerts=pn/STRIDE}}
function pampas(S,t,wn,ox,oy){for(let i=0;i<16;i++){let sp=(i/15-.5)*2+(rnd(i+40)-.5)*.2,g=wn*(Math.sin(t*.5-sp)*.12+.03);blade(ox+sp*S*.09,oy,-Math.PI/2+sp*.72,S*(.42+.2*rnd(i+50)),S*.0075,sp*1.25+g,1)}shadowVerts=pn/STRIDE;
 let pl=0;for(let i=0;i<5;i++){let sp=(i/4-.5)*2,x=ox+sp*S*.05,y=oy,a=-Math.PI/2+sp*.2+(rnd(i+60)-.5)*.08,len=S*(1-Math.abs(sp)*.16-rnd(i+70)*.08),N=44,st=len/N,b=sp*.32+wn*(Math.sin(t*.48-i*.5)*.13+Math.sin(t*1.2+i)*.03+.03);startNew=true;for(let k=0;k<=N;k++){let s=k/N;pt(x,y,-Math.sin(a),Math.cos(a),S*.0048*(1-s*.8),0);if(s>.62){PL.set([x,y,a,s,i,k],pl);pl+=6}a+=b/N*(.4+s*1.2);x+=Math.cos(a)*st;y+=Math.sin(a)*st}}
 for(let p=0;p<pl;p+=6){let x=PL[p],y=PL[p+1],a=PL[p+2],s=PL[p+3],i=PL[p+4],k=PL[p+5],m=(s-.62)/.38,len=S*.115*Math.sin(Math.min(1,m*1.05)*Math.PI*.92+.2);blade(x,y,a,S*.03,S*.0052,0,2,2);for(let j=0;j<3;j++){let side=j%2?1:-1,sp=side*(.1+.3*rnd(k*7+i+j)),fl=wn*Math.sin(t*1.5+k*.9+i+j)*.05;blade(x,y,a+sp+fl,len*(.7+.5*rnd(k*3+i+j)),S*.0046,side*.34+fl,2,6)}}}
const PLANTS={sprig,grass,pampas};
function drawPlant(t){if(settings.plant<=0||settings.plantStyle==='none')return;let S=H*.47*settings.plant,ox=W*.18,oy=H+S*.03,bw=S*1.5,bh=S*1.28,bx=ox-bw/2,by=H-bh;pn=0;startNew=false;PLANTS[settings.plantStyle](S,t,settings.wind,ox,oy);
gl.bindBuffer(gl.ARRAY_BUFFER,plantBuf);gl.bufferData(gl.ARRAY_BUFFER,PV.subarray(0,pn),gl.DYNAMIC_DRAW);gl.vertexAttribPointer(0,4,gl.FLOAT,false,STRIDE*4,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,STRIDE*4,16);
// The soft shadow: the first part of the plant at low resolution, blurred, then laid under the plant. A blur only needs a small image.
gl.useProgram(ribbon.p);let u=ribbon.u;gl.bindFramebuffer(gl.FRAMEBUFFER,targets[0].fb);gl.viewport(0,0,TW,TH);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.uniform4f(u.box,bx,by,bw,bh);gl.uniform1f(u.aa,4);gl.uniform1f(u.scale,TW/bw);gl.uniform1f(u.sil,1);gl.drawArrays(gl.TRIANGLE_STRIP,0,shadowVerts);
gl.disable(gl.BLEND);gl.useProgram(blur.p);attrib(quadBuf,2,0,0);gl.uniform4f(blur.u.box,-1,-1,2,2);for(let i=0;i<2;i++){gl.bindFramebuffer(gl.FRAMEBUFFER,targets[1-i].fb);gl.bindTexture(gl.TEXTURE_2D,targets[i].tex);i?gl.uniform2f(blur.u.dir,0,1/TH):gl.uniform2f(blur.u.dir,1/TW,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)}
gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(shadow.p);gl.bindTexture(gl.TEXTURE_2D,targets[0].tex);gl.uniform4f(shadow.u.box,bx/W*2-1,1-(by-S*.006+bh)/H*2,bw/W*2,bh/H*2);gl.uniform4f(shadow.u.color,pal.shadowC[0],pal.shadowC[1],pal.shadowC[2],Math.min(.55,pal.shadowA*1.5));gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
gl.useProgram(ribbon.p);attrib(plantBuf,4,3,STRIDE*4);gl.uniform4f(u.box,0,0,W,H);gl.uniform1f(u.aa,1);gl.uniform1f(u.scale,1);gl.uniform1f(u.sil,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,pn/STRIDE)}

function resize(){let d=devicePixelRatio,w=Math.max(1,Math.round(innerWidth*d)),h=Math.max(1,Math.round(innerHeight*d));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}W=w;H=h;if(gl)buildPoints();render(time)}
function crestUniforms(P){gl.uniform2f(P.u.R,W,H);gl.uniform1fv(P.u.sway,swayV);gl.uniform1fv(P.u.rollA,rollAV);gl.uniform1fv(P.u.rollB,rollBV);gl.uniform1f(P.u.curves,settings.curves);gl.uniform1f(P.u.hills,settings.hills)}
function render(t){if(!gl||lost)return;for(let l=0;l<5;l++){let phase=t*settings.roll;swayV[l]=Math.sin(t*.15+l*.6)*(.013+l*.006)*settings.swell;rollAV[l]=phase*(.006+l*.0072)%TAU;rollBV[l]=phase*(.009+l*.0095)%TAU}
let sunX=W/H*.65+Math.sin(t*.1)*.012,sunY=pal.sunY+settings.sunHeight,sunR=pal.sunR*settings.sunSize;
gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);gl.disable(gl.BLEND);gl.useProgram(scene.p);crestUniforms(scene);gl.uniform4f(scene.u.sun,sunX,sunY,sunR,pal.glow);attrib(meshBuf,2,0,0);gl.drawArrays(gl.TRIANGLE_STRIP,0,(COLS+1)*2);
gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
if(pal.stars>.002){gl.useProgram(star.p);crestUniforms(star);gl.uniform4f(star.u.sun,sunX,sunY,sunR,0);gl.uniform1f(star.u.amount,pal.stars);gl.uniform3f(star.u.color,1,.97,.9);attrib(starBuf,4,0,0);gl.drawArrays(gl.POINTS,0,starN)}
if(dustN){gl.useProgram(dust.p);let u=dust.u;gl.uniform2f(u.R,W,H);gl.uniform1f(u.span,span);gl.uniform1f(u.dustX,(t*.0065*Math.max(.25,settings.wind))%(20*span));gl.uniform1f(u.dustY,(t*.0012)%10);gl.uniform1f(u.dustBob,(t*.25)%TAU);gl.uniform1f(u.amt,settings.dust);gl.uniform3fv(u.color,pal.dustC);attrib(dustBuf,4,2,24);gl.drawArrays(gl.POINTS,0,dustN)}
drawPlant(t)}

// New keys prevent saved values from older builds being replayed with a different meaning.
const sliderRanges={tempo:['speed',0,1,5],dunemove:['swell',0,1,4],duneroll:['roll',0,1,6],dunecurves:['curves',.05,1,2.4],dunehills:['hills',.35,1,3],sunsize:['sunSize',.35,1,2],sunheight:['sunHeight',.62,0,-.22],plantsize:['plant',0,1,1.6],wind:['wind',0,1,5],lines:['lines',0,1,2.6],dust:['dust',0,1,6]};
function fromSlider(v,lo,mid,hi){const n=Math.max(0,Math.min(100,Math.round(v)));return n<=50?mix(lo,mid,n/50):mix(mid,hi,(n-50)/50)}
window.wallpaperPropertyListener={applyUserProperties(p){let changed=false;for(const [key,[setting,lo,mid,hi]] of Object.entries(sliderRanges)){const v=p[key]?.value;if((typeof v!=='number'&&typeof v!=='string')||String(v).trim()===''||!Number.isFinite(+v))continue;const next=fromSlider(+v,lo,mid,hi);if(settings[setting]!==next){settings[setting]=next;changed=true}}
 if(p.timeofday){let n=Math.max(0,Math.min(100,+p.timeofday.value))/100;if(Number.isFinite(n)&&settings.tod!==n){settings.tod=n;changed=true}}
 if(p.followclock){let n=!!p.followclock.value;if(settings.followClock!==n){settings.followClock=n;changed=true}}
 if(p.plantstyle&&(PLANTS[p.plantstyle.value]||p.plantstyle.value==='none')&&settings.plantStyle!==p.plantstyle.value){settings.plantStyle=p.plantstyle.value;changed=true}
 if(changed){applyPalette();render(time);schedule()}},applyGeneralProperties(p){if(p.fps!==undefined&&Number.isFinite(+p.fps)){settings.fps=Math.max(0,Math.min(240,+p.fps));sync()}},setPaused(v){hostPaused=!!v;schedule()}};
window.addEventListener('resize',resize);document.addEventListener('visibilitychange',schedule);
setInterval(()=>{if(settings.followClock&&!hostPaused&&!document.hidden){applyPalette();render(time)}},60000);
setup();resize();schedule();

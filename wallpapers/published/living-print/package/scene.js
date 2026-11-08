'use strict';
const canvas=document.querySelector('canvas');
const gl=canvas.getContext('webgl',{alpha:false,antialias:true,preserveDrawingBuffer:true});
const S=window.__wallpaperStats={frames:0,time:0,paused:false,fps:30,ready:false,mode:'animated',wind:1,boat:1,sail:1,hullRipples:1,water:1,sky:1,insects:1,fish:1,birds:1,lettering:1,speed:1,renderScale:1,paper:[.992,.969,.941]};
const layers=window.LIVING_SUWA_LAYERS||[];
// Renamed integer WE properties; 50 preserves selected settled defaults.
const CONTROL_MAP={"motionspeed":[["speed"],0,1,2],"windstrength":[["wind"],0,1,2],"watermovement":[["water","boat","sail","hullRipples"],0,1,2],"skymovement":[["sky"],0,1,2],"wildlife":[["birds","insects","fish"],0,1,2],"renderscale":[["renderScale"],0.5,1,1.5]};
const sliders=Object.fromEntries(Object.keys(CONTROL_MAP).map(k=>[k,50]));
function applySliders(properties){
 const values={};
 for(const [key,[internals,low,mid,high]] of Object.entries(CONTROL_MAP)){
  const value=properties?.[key]?.value;
  if(typeof value!=='number'||!Number.isFinite(value))continue;
  const n=Math.max(0,Math.min(100,Math.round(value)));sliders[key]=n;
  const mapped=n<=50?low+(mid-low)*n/50:mid+(high-mid)*(n-50)/50;
  // Cranes are whole birds: none below 25, one up to 74, then two.
  for(const internal of internals)values[internal]=internal==='birds'?Math.round(mapped):mapped;
 }
 const paper=properties?.backgroundcolor?.value;
 if(typeof paper==='string'){const c=paper.trim().split(/\s+/).map(Number);if(c.length===3&&c.every(Number.isFinite))values.paper=c}
 if(Object.keys(values).length)update(values);
}
let hostPause=false,userPause=false,lost=false,raf=0,last=0,acc=0,pending=0,program,buffer,boatBuffer,paperBuffer,tex={},count,boatCount;
const W=1948,H=1347,images={};
function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
function init(){
program=gl.createProgram();
gl.attachShader(program,shader(gl.VERTEX_SHADER,`
attribute vec2 a;varying vec2 uv;uniform vec2 screen;uniform float scale,kind,time,wind,boat,sail;uniform vec4 meta;uniform float phase;uniform vec2 attachment;uniform vec2 craneSize,craneAnchor;uniform vec4 cranePose;
float gustAt(float t){return .60*sin(t*.48)+.25*sin(t*.79+.35)+.15*sin(t*.21+1.1);}
void main(){
uv=a/vec2(1948.,1347.);vec2 p=a;
if(kind==1.||kind==2.){
// A shared gust bends each crown coherently; no wave travels through its silhouette.
float length=440.-(kind==1.?44.:77.);float k=clamp((440.-p.y)/length,0.,1.);
float gust=gustAt(time-(kind==1.?0.:.38));
float bend=k*k*wind*36.*gust*(kind==1.?1.:.9);
p.x+=bend;p.y+=bend*bend/(2.*length);
}
if(kind==3.){
// The original sail pixels flex within one continuous boat mesh. The mast and foot stay pinned.
float height=clamp((919.-p.y)/48.,0.,1.);
float mast=488.+clamp((p.y-870.)/49.,0.,1.)*5.;
float freeEdge=440.+clamp((p.y-875.)/44.,0.,1.)*22.;
float span=clamp((mast-p.x)/max(1.,mast-freeEdge),0.,1.);
float sailWeight=smoothstep(436.,442.,p.x)*(1.-smoothstep(919.,922.,p.y))*height*span;
float sailBend=sailWeight*wind*sail*5.5*gustAt(time-.65);
p.x+=sailBend;p.y+=abs(sailBend)*.12;
vec2 q=p-vec2(485.,938.);float ang=sin(time*.94)*.016*boat;float c=cos(ang),s=sin(ang);
p=vec2(q.x*c-q.y*s,q.x*s+q.y*c)+vec2(485.+sin(time*.16)*72.*boat,938.+sin(time*.94)*3.6*boat);
}
if(kind==4.){
float base=attachment.y>0.?attachment.y:meta.y;float k=clamp((base-p.y)/max(12.,base-meta.z),0.,1.);if(attachment.x>0.)k*=smoothstep(0.,75.,attachment.x-p.x);
// Nearby grasses respond most; distant foliage receives a much smaller projected bend.
float gust=gustAt(time-phase)*.94+.06*sin(time*2.2-phase);
float bend=k*k*meta.w*wind*gust;
p.x+=bend;p.y+=bend*bend/(2.*max(20.,base-meta.z));
}
if(kind==7.||kind==8.||kind==10.){
vec2 part=uv*craneSize;
// Two short beats, a long glide, one beat, then another long glide.
float cycle=mod(time+cranePose.w,20.);
float pulseTime=cycle<2.6?mod(cycle,1.3):(cycle>=11.&&cycle<12.3?cycle-11.:-1.);
float flap=0.,bodyBeat=0.,trailingBeat=0.;
if(pulseTime>=0.){
float u=pulseTime/1.3,envelope=sin(u*3.14159265);
flap=sin(u*6.2831853)*envelope;
// Shared body loading follows the wing stroke; the squared envelope settles into each glide.
bodyBeat=sin(u*6.2831853-.58)*envelope*envelope;
trailingBeat=sin(u*6.2831853-1.02)*envelope*envelope;
}
float flight=time*.35+cranePose.w;
if(kind==7.||kind==8.){
// Project a wing stroke around an attached shoulder; tips sweep down past the belly.
float projection=.28+.92*flap*(kind==8.?.92:1.);
float reach=max(0.,620.-part.y);
float depth=clamp(reach/620.,0.,1.);
part.y+=reach*(1.-projection);
part.x+=pow(depth,1.25)*(85.+55.*flap);
}
// Shared body-axis flex keeps all layer joins together while neck and feet trail the beat.
float along=(part.x-875.)/700.;
part.y+=along*along*(16.*trailingBeat+3.*sin(flight+along*.6));
vec2 local=part-craneAnchor;
float pitch=.034*bodyBeat+.007*sin(flight);
part=craneAnchor+mat2(cos(pitch),sin(pitch),-sin(pitch),cos(pitch))*local;
// 34 rig pixels project to at most 1.6 artwork pixels at the approved 72px width.
part.y+=34.*bodyBeat+9.*sin(flight-.85);
p=(part-craneAnchor)*cranePose.z+cranePose.xy;
}
vec2 px=(p-vec2(974.,673.5))*scale;gl_Position=vec4(px.x/screen.x*2.,-px.y/screen.y*2.,0.,1.);
}`));
gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`
precision highp float;
varying vec2 uv;
uniform sampler2D image,waterMask,skyMask,skyDriftMask,printPaper;
uniform float kind,time,water,sky,birds,lettering,insects,fish,craneFade,boat,hullRipples;
uniform vec3 paperColor;
float gustAt(float t){return .60*sin(t*.48)+.25*sin(t*.79+.35)+.15*sin(t*.21+1.1);}
float hash(float v){return fract(sin(v*127.1)*43758.5453);}
float segment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/max(.001,dot(d,d)),0.,1.));}
void main(){
// The Background colour fills the screen behind the cut-out sheet, with the faint tones and grain of the scan's own white. At the default colour it is that white.
if(kind==12.){gl_FragColor=vec4(paperColor*texture2D(image,(uv+1.)/3.).rgb/vec3(.992,.969,.941)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)*.0196,1.);return;}
vec2 p=uv*vec2(1948.,1347.);vec2 q=uv;
float wet=texture2D(waterMask,uv).r;
float air=texture2D(skyMask,uv).r;float drift=texture2D(skyDriftMask,uv).r;
if(kind==0.){
q.x+=drift*sky*(sin(p.y*.018+time*.14)*18.+sin(time*.08)*12.)/1948.;
q.y+=drift*sky*sin(p.x*.004+time*.12)*1.3/1347.;
q.x+=wet*water*sin(p.y*.105-time*1.8)*2.5/1948.;
q.y+=wet*water*(sin(p.y*.072-time*1.7+p.x*.005)*2.2)/1347.;
}
vec4 color=texture2D(image,q);
if(kind==0.){
float row=floor(p.y/27.);
float phase=fract(p.y/27.-time*.022);
float stroke=exp(-pow((phase-.5)*34.,2.));
float waves=pow(max(0.,sin(p.x*.018+hash(row)*19.+time*.48)),6.);
float flicker=.55+.45*sin(time*1.2+row*2.9);
float ripple=stroke*waves*flicker*wet*water*.30;
color.rgb=mix(color.rgb,vec3(.20,.36,.42),ripple);
float crest=exp(-pow((phase-.55)*44.,2.))*waves*wet*water*.15;
color.rgb=mix(color.rgb,vec3(.99,.92,.73),crest);
float flow=p.x*.008-time*.30;
float band=sin(p.y*.043+sin(flow)*1.3+sin(flow*.51+1.7)*.65);
float wash=pow(max(0.,band),5.)*(.55+.45*sin(flow*.71+2.));
color.rgb=mix(color.rgb,vec3(.87,.86,.71),wash*air*sky*.14);
}

if(kind==0.&&fish>0.&&wet>.01){
for(int i=0;i<2;i++){
float id=float(i);float event=mod(time+id*8.+2.,17.);
vec2 center=id==0.?vec2(465.,1090.):vec2(1440.,775.);
vec2 d=p-center;
float progress=clamp(event/5.,0.,1.);
float ring=abs(length(d/vec2(1.,.34))-(5.+progress*49.));
float ripple=(1.-smoothstep(.6,1.6,ring))*(1.-progress)*smoothstep(0.,.4,event)*.23;
float wake=abs(length((d-vec2(-3.,0.))/vec2(1.,.34))-(2.+progress*33.));
ripple+= (1.-smoothstep(.5,1.4,wake))*(1.-progress)*.12;
vec2 swim=d-vec2((event-1.)*12.,sin(event*4.)*1.5);
float body=length(swim/vec2(9.,2.5));
float tail=min(segment(swim,vec2(-8.,0.),vec2(-13.,-3.+sin(event*7.)*2.)),segment(swim,vec2(-8.,0.),vec2(-13.,3.+sin(event*7.)*2.)));
float fishInk=max(1.-smoothstep(.7,1.1,body),(1.-smoothstep(.3,.9,tail))*.7);
float glimpse=smoothstep(0.,.4,event)*(1.-smoothstep(1.4,2.8,event));
color.rgb=mix(color.rgb,vec3(.21,.36,.39),clamp((ripple+fishInk*glimpse*.28)*wet*fish,0.,.6));
}
}

// Short, broken contact ripples beneath the hull, in the boat's own local coordinates.
if(kind==0.&&hullRipples>0.&&boat>0.&&water>0.&&wet>.01){
float angle=sin(time*.94)*.016*boat;float c=cos(angle),s=sin(angle);
vec2 q=p-vec2(485.+sin(time*.16)*72.*boat,938.+sin(time*.94)*3.6*boat);
vec2 local=vec2(q.x*c+q.y*s,-q.x*s+q.y*c)+vec2(485.,938.);
if(local.x>417.&&local.x<579.&&local.y>936.&&local.y<981.){
float dx=local.x-500.;float hullLine=955.+dx*.035-dx*dx*.0016;
float extent=smoothstep(417.,435.,local.x)*(1.-smoothstep(559.,579.,local.x));
float ink=0.;
for(int i=0;i<3;i++){
float id=float(i);float phase=fract(time*.18+id*.3333);
float distance=abs(local.y-hullLine-phase*15.);
float broken=smoothstep(-.25,.45,sin(local.x*.107+id*2.3+time*.20));
float line=(1.-smoothstep(.35,1.05,distance))*broken;
float envelope=sin(phase*3.14159265)*(1.-phase);
ink+=line*envelope;
}
float rocking=.65+.35*abs(cos(time*.94));
float opacity=min(.38,ink*extent*rocking*wet*hullRipples*min(boat,1.)*min(water,1.)*.43);
color.rgb=mix(color.rgb,vec3(.235,.365,.420),opacity);
}
}

if(kind==5.){
bool signature=p.x>220.;float cycle=mod(time+(signature?0.:.6),12.);
float tip=mix(signature?271.:161.,signature?497.:419.,clamp(cycle/3.4,0.,1.));
float written=1.-smoothstep(tip-5.,tip+5.,p.y+sin(p.x*.8)*2.);
float fade=1.-smoothstep(10.,12.,cycle);
float strength=min(lettering,1.);
float ghost=mix(.28,.08,max(0.,lettering-1.));
if(cycle<3.4||cycle>10.)color.a*=mix(1.,mix(ghost,1.,written*fade),strength);
}

// A single side-on near-shore dart. Pixel-space p; no additional texture or uniform.
// Off at insects=0. Default active windows: [5,7.4], [37,39.4], ... seconds.
if(kind==6.){
    color=vec4(0.);
    float insectStrength=clamp(insects,0.,1.);
    float passPeriod=32.-6.*clamp(insects-1.,0.,1.);
    float passCycle=floor(time/passPeriod);
    float passTime=mod(time,passPeriod)-5.;
    if(insectStrength>0.&&passTime>=0.&&passTime<6.0){
        float direction=mod(passCycle,2.)<1.?1.:-1.;
        // Fast arrival; quiet holds with tiny drift; two quick repositionings; fast exit.
        // Keep both directions' hover stops over open water, not mirrored onto the hillside.
        float entry=direction>0.?-42.:1990.;
        float exitX=direction>0.?1990.:-42.;
        float cx=mix(entry,460.,smoothstep(0.,.55,passTime))
          +18.*smoothstep(.55,2.,passTime)-80.*smoothstep(2.,2.23,passTime)
          -12.*smoothstep(2.23,3.65,passTime)+95.*smoothstep(3.65,3.86,passTime)
          +8.*smoothstep(3.86,5.30,passTime);
        cx=mix(cx,exitX,smoothstep(5.30,6.,passTime));
        float cy=1045.-27.*smoothstep(2.,2.23,passTime)+37.*smoothstep(3.65,3.86,passTime)
          -38.*smoothstep(5.30,6.,passTime)+.9*sin(passTime*2.1);
        vec2 q=p-vec2(cx,cy);q.x*=direction;
        if(abs(q.x)<24.&&abs(q.y)<12.){
            float wingAlpha=0.;
            float beat=.5+.5*sin(time*263.8937829);
            // Four swept, overlapping wings: two near and two foreshortened far wings.
            // Low-opacity envelope is more stable at low host FPS than opaque flashing blades.
            for(int wi=0;wi<4;wi++){
                float n=float(wi);
                float hind=mod(n,2.);
                float far=floor(n/2.);
                float reach=mix(2.1,4.7,beat)*(1.-far*.34);
                vec2 center=vec2(.8-hind*3.9,-reach+far*.6);
                vec2 wing=q-center;
                float angle=-.29-hind*.10+far*.05;
                wing=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*wing;
                float shape=length(wing/vec2(7.3-hind*.8,.78+beat*.25));
                float membrane=(1.-smoothstep(.60,1.20,shape))*(.125-far*.042);
                wingAlpha=max(wingAlpha,membrane);
            }
            float abdomen=segment(q,vec2(-17.,.55),vec2(4.8,0.));
            float taper=mix(.32,.82,clamp((q.x+17.)/22.,0.,1.));
            float ink=1.-smoothstep(taper,taper+.56,abdomen);
            float thorax=1.-smoothstep(.72,1.20,length((q-vec2(5.7,0.))/vec2(2.5,1.35)));
            float head=1.-smoothstep(1.0,1.75,length(q-vec2(9.0,.25)));
            float legs=min(segment(q,vec2(5.1,.6),vec2(3.2,2.2)),segment(q,vec2(3.2,2.2),vec2(5.4,2.45)));
            legs=min(legs,segment(q,vec2(6.3,.7),vec2(5.8,2.5)));
            float legInk=(1.-smoothstep(.16,.64,legs))*.40;
            float dark=max(max(ink*.66,thorax*.75),max(head*.76,legInk));
            float opacity=max(dark,wingAlpha)*insectStrength;
            vec3 pigment=mix(vec3(.40,.49,.44),vec3(.19,.30,.29),smoothstep(.03,.22,dark));
            color=vec4(pigment,opacity);
        }
    }
}

if(kind==7.||kind==8.||kind==10.){
// Two printing values rather than shaded plumage: blue ink and the source paper.
float value=dot(color.rgb,vec3(.299,.587,.114));
float ink=1.-smoothstep(.46,.70,value);
vec3 paper=texture2D(printPaper,uv).rgb;
paper=mix(vec3(.91,.855,.70),paper,.32);
vec3 blue=vec3(.235,.365,.420);
float grain=dot(paper,vec3(.3333))-.80;
color.rgb=mix(paper,blue+grain*.22,ink);
color.a*=craneFade;
}
gl_FragColor=color;
}`));
gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
const v=[];for(let y=0;y<108;y++)for(let x=0;x<144;x++){const x0=x*W/144,x1=(x+1)*W/144,y0=y*H/108,y1=(y+1)*H/108;v.push(x0,y0,x1,y0,x0,y1,x0,y1,x1,y0,x1,y1)}
count=v.length/2;buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.STATIC_DRAW);
tex={};for(const [key,img] of Object.entries(images)){const t=gl.createTexture(),mip=/^crane-(body|near-wing|far-wing)$/.test(key);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mip?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);if(mip)gl.generateMipmap(gl.TEXTURE_2D);tex[key]=t}
// A compact two-pixel mesh gives the small sail enough vertices for a smooth attached bend.
const boatVertices=[];for(let y=850;y<980;y+=2)for(let x=360;x<610;x+=2)boatVertices.push(x,y,x+2,y,x,y+2,x,y+2,x+2,y,x+2,y+2);
boatCount=boatVertices.length/2;boatBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,boatBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(boatVertices),gl.STATIC_DRAW);
paperBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,paperBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-9e3,-9e3,9e3,-9e3,-9e3,9e3,-9e3,9e3,9e3,-9e3,9e3,9e3]),gl.STATIC_DRAW);
gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);S.ready=true;S.layerCount=5+layers.length;resize();sync();canvas.style.opacity=1;
}
function draw(){
if(!S.ready||lost)return;
gl.clearColor(...S.paper,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
const a=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
const u=n=>gl.getUniformLocation(program,n);
gl.uniform2f(u('craneSize'),1536,1024);gl.uniform2f(u('craneAnchor'),860,720);
gl.uniform2f(u('screen'),canvas.width,canvas.height);gl.uniform1f(u('scale'),Math.min(canvas.width/W,canvas.height/H)*.985);
for(const k of ['time','wind','boat','sail','hullRipples','water','sky','birds','lettering','insects','fish'])gl.uniform1f(u(k),S[k]);
gl.uniform3f(u('paperColor'),...S.paper);
gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,tex['water-mask']);gl.uniform1i(u('waterMask'),1);
gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,tex['sky-mask']);gl.uniform1i(u('skyMask'),2);
gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,tex['sky-drift-mask']);gl.uniform1i(u('skyDriftMask'),3);
gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,tex['crane-paper']);gl.uniform1i(u('printPaper'),4);
gl.activeTexture(gl.TEXTURE0);gl.uniform1i(u('image'),0);
const layer=(name,kind,meta=[0,0,0,0],phase=0)=>{
const bounds=layers.find(l=>l.name===name)?.bounds||({'tree-left':[500,30,1020,660],'tree-right':[980,60,1730,660],boat:[370,850,600,975]})[name];
if(bounds){const pad=name==='boat'?170:90,fit=Math.min(canvas.width/W,canvas.height/H)*.985,ox=(canvas.width-W*fit)/2,oy=(canvas.height-H*fit)/2;const x=Math.max(0,Math.floor(ox+(bounds[0]-pad)*fit)),y=Math.max(0,Math.floor(oy+(H-bounds[3]-pad)*fit)),right=Math.min(canvas.width,Math.ceil(ox+(bounds[2]+pad)*fit)),top=Math.min(canvas.height,Math.ceil(oy+(H-bounds[1]+pad)*fit));gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,Math.max(0,right-x),Math.max(0,top-y))}
const join=name==='bush-near-left'?[800,1136]:name==='bush-middle-left'?[894,913]:[0,0];gl.uniform2f(u('attachment'),...join);gl.uniform1f(u('kind'),kind);gl.uniform4f(u('meta'),...meta);gl.uniform1f(u('phase'),phase);gl.bindTexture(gl.TEXTURE_2D,tex[name]);const boatMesh=name==='boat';
if(boatMesh){gl.bindBuffer(gl.ARRAY_BUFFER,boatBuffer);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0)}
gl.drawArrays(gl.TRIANGLES,0,boatMesh?boatCount:count);
if(boatMesh){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0)}
gl.disable(gl.SCISSOR_TEST)};
const depthResponse={'reed-left':1,'sprig-left':1,'sprig-center':1,'sprig-upper':.75,'sprig-right':.55,'bush-near-left':.7,'bush-middle-left':.55,'bush-right-bank':.12};
const vegetation=(l,i,animate)=>layer(l.name,animate?4:9,[l.pivot[0],l.pivot[1],l.bounds[1],(l.amplitude||14)*(depthResponse[l.name]??1)],l.pivot[0]/1948*.65);
if(S.mode==='animated'){
gl.bindBuffer(gl.ARRAY_BUFFER,paperBuffer);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.uniform1f(u('kind'),12);gl.bindTexture(gl.TEXTURE_2D,tex.paper);gl.drawArrays(gl.TRIANGLES,0,6);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
layer('background',0);
for(let i=0;i<Math.min(2,Math.ceil(S.birds));i++){
const f=((S.time+14)/66)%1;const cx=-160+f*2300-i*112,cy=245+Math.sin(S.time*.10)*20+i*35;
gl.uniform4f(u('cranePose'),cx,cy,(i===0?72:59)/1536,i*.8);
gl.uniform1f(u('craneFade'),Math.min(1,Math.max(0,(cx-310)/100))*Math.min(1,Math.max(0,(1880-cx)/100)));
layer('crane-body',10);layer('crane-far-wing',8,[932,643,0,0]);layer('crane-near-wing',7,[875,680,0,0]);
}
layer('lettering',5);layer('tree-left',1);layer('tree-right',2);layer('boat',3);
layers.forEach((l,i)=>vegetation(l,i,true));if(S.insects>0)layer('lettering',6);
}else if(S.mode==='vegetation'){
gl.clearColor(.38,.43,.44,1);gl.clear(gl.COLOR_BUFFER_BIT);layers.forEach((l,i)=>vegetation(l,i,true));
}else{
if(S.mode!=='background'){gl.clearColor(.38,.43,.44,1);gl.clear(gl.COLOR_BUFFER_BIT)}
const li=layers.findIndex(l=>l.name===S.mode);
if(li>=0)vegetation(layers[li],li,true);else layer(S.mode,9);
}
S.frames++;
}
function resize(){if(!gl||lost)return;const d=Math.min(devicePixelRatio||1,2)*S.renderScale;canvas.width=Math.max(1,Math.round(innerWidth*d));canvas.height=Math.max(1,Math.round(innerHeight*d));gl.viewport(0,0,canvas.width,canvas.height);draw()}
function tick(now){raf=0;const dt=Math.min(.1,(now-last)/1000);last=now;acc+=dt;pending+=dt;const interval=1/S.fps;if(acc+1e-6>=interval){S.time+=pending*S.speed;pending=0;acc=Math.max(0,acc-interval);draw()}raf=requestAnimationFrame(tick)}
function sync(){cancelAnimationFrame(raf);raf=0;S.paused=hostPause||userPause||document.hidden||lost||S.speed===0;if(S.ready&&!S.paused){last=performance.now();acc=0;pending=0;raf=requestAnimationFrame(tick)}}
function update(p){
for(const k of ['wind','boat','sail','hullRipples','water','sky','birds','lettering','insects','fish','speed','renderScale'])if(Number.isFinite(+p[k]))S[k]=Math.max(k==='renderScale'?.5:0,Math.min(k==='renderScale'?1.5:2,+p[k]));
if(Array.isArray(p.paper)){S.paper=p.paper.map(v=>Math.max(0,Math.min(1,v)));document.documentElement.style.background=`rgb(${S.paper.map(v=>v*100+'%')})`}
if(['animated','original','background','tree-left','tree-right','boat','water-mask','sky-mask','vegetation','lettering',...layers.map(l=>l.name)].includes(p.mode))S.mode=p.mode;
if(typeof p.paused==='boolean')userPause=p.paused;
if('renderScale'in p)resize();else draw();sync();
}
window.wallpaperPropertyListener={applyUserProperties:applySliders,applyGeneralProperties(p){if(Number.isFinite(+p.fps)&&+p.fps>0)S.fps=Math.min(240,+p.fps);sync()},setPaused(p){hostPause=!!p;sync()}};
window.wallpaperDiagnostics={seek(t){S.time=t;draw()},update,controls(){return {...sliders}}};
// The tuning UI is a development hook, not part of the package.
addEventListener('resize',resize);document.addEventListener('visibilitychange',sync);
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;sync()});
canvas.addEventListener('webglcontextrestored',()=>{lost=false;init()});
Promise.all(Object.entries(window.LIVING_SUWA_ASSETS).map(([k,url])=>new Promise((ok,fail)=>{const img=new Image();img.onload=()=>{images[k]=img;ok()};img.onerror=fail;img.src=url}))).then(init).catch(e=>{document.querySelector('#error').hidden=false;document.querySelector('#error').textContent='Unable to load this print.';console.error(e)});

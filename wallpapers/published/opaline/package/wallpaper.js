'use strict';
(() => {
const canvas = document.querySelector('#nebula');
// The art sits next to this script, so pages elsewhere (research/opaline/preview.html) can load it too.
const ART = new URL('nebula.jpg', document.currentScript.src).href;
// Internal units; these match the project.json defaults (Motion speed 30, other sliders 50, render scale 100). See fromSlider.
const settings = {speed:1.2,motion:1.5,brightness:.95,quality:1,fps:30};
let hostPaused=false, ready=false, lost=false, raf=0, last=0, accumulator=0, time=0, frames=0, pendingTime=0;
const hostEvents=[];
function recordHost(type,value){const detail=type==="general"?{fps:value.fps}:type==="properties"?Object.fromEntries(Object.entries(value).filter(([key])=>key in weKeys)):value;hostEvents.push({type,value:detail,at:performance.now()});if(hostEvents.length>16)hostEvents.shift();}
let gl, program, texture, buffer, uniforms, image;
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
// 0 = still (speed, motion), 50 = 1.0.1 defaults, 100 = double. Render scale is a percentage.
// Brightness: 0 = .2, 50 = .95, 100 = 1.2 (the 1.0.1 maximum; the pastel art clips to white above that).
// 1.0.1 was run at its minimum (.4), so the low end goes further; .4 is now about 13.
// WE keys differ from 1.0.1 (speed, motion, brightness, quality) so values saved on the old fractional scale are ignored.
const weKeys={motionspeed:'speed',cloudmovement:'motion',brightnesslevel:'brightness',renderscale:'quality'};
const fromSlider={speed:v=>v/25,motion:v=>v*.03,brightness:v=>v<=50?.2+v*.015:.95+(v-50)*.005,quality:v=>clamp(v,35,100)/100};
function configure(key,value) {
 const n=Number(value); if(!Number.isFinite(n)) return;
 settings[key]=fromSlider[key](clamp(n,0,100));
 if(key==='quality') resize();
 if(ready) draw();
 if(key==='speed'||key==='motion')schedule();
}
window.wallpaperPropertyListener={
 applyUserProperties(properties) {recordHost("properties",properties);for(const [weKey,key] of Object.entries(weKeys)) if(properties[weKey]) configure(key,properties[weKey].value);},
 applyGeneralProperties(properties) {recordHost("general",properties);if(properties.fps!==undefined && Number.isFinite(Number(properties.fps))) settings.fps=clamp(Number(properties.fps),0,240);},
 setPaused(paused) {recordHost("pause",paused);hostPaused=Boolean(paused);schedule();}
};
const vertex=`
attribute vec2 position;
varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}
`;
const fragment=`
precision highp float;
varying vec2 uv;
uniform sampler2D art;
uniform vec2 resolution;
uniform float imageAspect;
uniform float time;
uniform float motion;
uniform float brightness;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
 vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
float fbm(vec2 p){
 float v=0.,a=.5;
 for(int i=0;i<4;i++){v+=a*noise(p);p=mat2(.8,-.6,.6,.8)*p*2.03+17.4;a*=.5;}
 return v;
}
void main(){
 vec2 p=uv;
 float aspect=resolution.x/resolution.y;
 // Cover fit without stretching. Extra margin keeps displaced samples inside the artwork.
 if(aspect>imageAspect)p.y=(p.y-.5)*imageAspect/aspect+.5;
 else p.x=(p.x-.5)*aspect/imageAspect+.5;
 p=(p-.5)*.88+.5;
 vec2 world=vec2(uv.x*aspect,uv.y);
 float t=time*.045;
 vec2 broad=vec2(fbm(world*2.4+vec2(t*.28,-t*.16)),fbm(world*2.4+vec2(8.-t*.19,t*.23)));
 vec2 fine=vec2(fbm(world*6.+broad*2.+vec2(t*.15,t*.12)),fbm(world*6.+broad*2.+vec2(3.1-t*.13,5.+t*.17)));
 vec2 flow=(broad-.5)*.054+(fine-.5)*.0035;
 flow+=vec2(sin(world.y*3.+t*.4),cos(world.x*2.4-t*.3))*.007;
 // Suppress displacement only near artwork edges; no clamped streaks at maximum motion.
 vec2 edge=smoothstep(vec2(0.),vec2(.15),p)*smoothstep(vec2(0.),vec2(.15),1.-p);
 flow*=edge;
 vec3 base=texture2D(art,p+flow*motion).rgb;
 // Keep one coherent image sample: blending independently displaced copies ghosts fine filaments.
 float density=fbm(world*3.2+vec2(t*.11,-t*.07));
 vec3 color=base;
 float light=sin(density*7.+t*.65)*.018*motion;
 color+=light*vec3(1.,.87,.76);
 // Sparse, soft dust points drifting across the cloud surface.
 vec2 stars=world*90.+vec2(time*.024,time*.009)*motion;
 vec2 cell=floor(stars),f=fract(stars)-.5;
 float seed=hash(cell);
 float star=exp(-dot(f,f)*190.)*step(.9965,seed);
 color+=star*(.022+.022*sin(time*.35+seed*40.))*motion;
 color*=brightness;
 color+=(hash(gl_FragCoord.xy)-.5)/255.;
 gl_FragColor=vec4(color,1.);
}`;
function compile(type,source){
 const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);
 if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));
 return s;
}
function setup(){
 const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
 program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(program);
 buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
 const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
 texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
 uniforms={};for(const key of ['art','resolution','imageAspect','time','motion','brightness'])uniforms[key]=gl.getUniformLocation(program,key);
 gl.uniform1i(uniforms.art,0);gl.uniform1f(uniforms.imageAspect,image.width/image.height);
 // The canvas fades in after its first frame (index.html CSS); an alpha:false canvas is black before it draws.
 lost=false;ready=true;resize();draw();canvas.classList.add('on');document.querySelector("#error").hidden=true;schedule();
}
function resize(){
 // isContextLost: a GPU reset can land before the webglcontextlost event, and getParameter then returns null.
 if(!gl || lost || gl.isContextLost())return;
 const dpr=Math.min(devicePixelRatio||1,2);
 let w=Math.max(1,Math.round(innerWidth*dpr*settings.quality)),h=Math.max(1,Math.round(innerHeight*dpr*settings.quality));
 const viewport=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
 const cap=Math.min(1,Math.sqrt(3840*2160/(w*h)),gl.getParameter(gl.MAX_TEXTURE_SIZE)/Math.max(w,h),viewport[0]/w,viewport[1]/h);
 w=Math.max(1,Math.floor(w*cap));h=Math.max(1,Math.floor(h*cap));
 if(canvas.width!==w || canvas.height!==h){canvas.width=w;canvas.height=h;}
 gl.viewport(0,0,w,h);if(ready)draw();
}
function draw(){
 if(!ready || lost)return;
 gl.useProgram(program);gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);
 gl.uniform1f(uniforms.time,time);gl.uniform1f(uniforms.motion,settings.motion);gl.uniform1f(uniforms.brightness,settings.brightness);
 gl.drawArrays(gl.TRIANGLES,0,6);frames++;
}
function stopped(){return hostPaused||document.hidden||lost||!ready||settings.speed===0||settings.motion===0;}
function schedule(){
 cancelAnimationFrame(raf);raf=0;last=0;accumulator=0;pendingTime=0;
 if(!stopped())raf=requestAnimationFrame(tick);
}
function tick(now){
 if(stopped()){raf=0;return;}
 const dt=last?Math.min((now-last)/1000,.1):0;last=now;accumulator+=dt;pendingTime+=dt;
 const interval=settings.fps>0?1/settings.fps:0;
 // Subtract, don't just take the remainder: timestamps are rounded to 0.1 ms, so 6 x 16.7 ms can come out as 0.0999999,
 // which passes the tolerance while % interval would leave almost a full interval and draw again on the next frame.
 if(accumulator+1e-6>=interval){time+=pendingTime*settings.speed;pendingTime=0;accumulator=interval>0?Math.max(0,(accumulator-interval)%interval):0;draw();}
 raf=requestAnimationFrame(tick);
}
function fail(error){ready=false;cancelAnimationFrame(raf);canvas.hidden=true;document.body.style.backgroundImage=`url('${ART}')`;const el=document.querySelector('#error');el.hidden=false;el.textContent='Animation unavailable — showing the still artwork. '+error.message;console.error(error);}
document.addEventListener('visibilitychange',schedule);window.addEventListener('resize',resize);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;ready=false;schedule();});
canvas.addEventListener('webglcontextrestored',()=>{try{setup();}catch(error){fail(error);}});
window.nebulaDiagnostics={get state(){return {ready,lost,time,frames,paused:stopped(),hostEvents:[...hostEvents],texture:[image?.width,image?.height],settings:{...settings},width:canvas.width,height:canvas.height};}};
try{
 gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,powerPreference:'low-power'});
 if(!gl)throw Error('WebGL is not available.');
 image=new Image();image.onload=()=>{try{setup();}catch(error){fail(error);}};
 image.onerror=()=>fail(Error('The local nebula texture could not be loaded.'));
 image.src=ART;
}catch(error){fail(error);}
})();

// Animated Workshop preview GIF for any web wallpaper package by real-time recording (optionally sped up). One way of making preview GIFs,
// not the only one: time-exact rendering through a wallpaper's own hook and seamless loops need per-wallpaper code. See
// docs/approaches/workshop-preview-gifs.md.
// usage (repo root):
//   node docs/tools/make_preview_gif.cjs <package-dir> <out.gif> [options]
// options (defaults in brackets):
//   --record 12        seconds of real-time recording
//   --skip 2           seconds dropped from the start (fade-ins, loading)
//   --speedup 4        time compression: 12 s recorded at 4x gives a 3 s GIF
//   --timewarp 1       runs the page's clock k times faster while recording (fast motion without long recordings; use with --speedup 1)
//   --fps 10           GIF frame rate
//   --size 256         output size, 256 or 640x360
//   --crop .5,.5,1     crop centre x, centre y (fractions of the frame) and crop height as a fraction of the frame height; width follows --size
//   --loop crossfade   crossfade | pingpong | none
//   --xfade .6         crossfade length in GIF seconds
//   --colors 128       palette size; lowered automatically to fit --max-kb
//   --dither bayer     bayer | sierra2_4a | none
//   --max-kb 900       Steam's limit is 1 MB
//   --props '{"motionspeed":60}'   WE user properties, applied before recording
//   --viewport 1920x1080
//   --capture auto     canvas (MediaRecorder on the largest canvas) | screencast (whole page, for DOM or multi-canvas scenes) | auto
//   --strip            also write <out>.strip.png (5 frames across the loop)
// Prints size, a seam score (last frame to first; a clean loop is no bigger than the largest ordinary step) and a motion score: mean pixel change from the first frame
// to the middle frame, 0-255. Only compare it between variants of the same wallpaper: full-frame flow scores high, a moving sun or boat scores
// low however visible it is. For reference, a calm full-frame nebula wallpaper's accepted GIF scored 9.
const {chromium}=require(process.env.WL_PLAYWRIGHT || require('os').homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawnSync}=require('child_process');
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os');
const FFMPEG=process.env.WL_FFMPEG || require('os').homedir() + '/AppData/Local/Programs/Python/Python313/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const MIME={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.wasm':'application/wasm','.glsl':'text/plain','.frag':'text/plain','.vert':'text/plain'};

const argv=process.argv.slice(2),pos=[],opt={};
for(let i=0;i<argv.length;i++)argv[i].startsWith('--')?opt[argv[i].slice(2)]=argv[i+1]===undefined||argv[i+1].startsWith('--')?true:argv[++i]:pos.push(argv[i]);
const [pkg,out]=pos;
if(!pkg||!out){console.log(fs.readFileSync(__filename,'utf8').split('\n').slice(0,22).join('\n'));process.exit(1);}
const num=(k,d)=>opt[k]!==undefined?Number(opt[k]):d;
const o={timewarp:num('timewarp',1),record:num('record',12),skip:num('skip',2),speedup:num('speedup',4),fps:num('fps',10),colors:num('colors',128),xfade:num('xfade',.6),maxKb:num('max-kb',900),
 loop:opt.loop||'crossfade',dither:opt.dither||'bayer',capture:opt.capture||'auto',props:JSON.parse(opt.props||'{}')};
const sz=String(opt.size||256).split('x').map(Number),W=sz[0],H=sz[1]||sz[0];
const [vw,vh]=(opt.viewport||'1920x1080').split('x').map(Number);
const [cx,cy,cf]=(opt.crop||'.5,.5,1').split(',').map(Number);
const ff=(args,input)=>{const r=spawnSync(FFMPEG,['-hide_banner','-loglevel','error','-y',...args],{input,maxBuffer:1<<30,stdio:[input?'pipe':'ignore','inherit','inherit']});if(r.status)throw Error('ffmpeg failed');};

function serve(dir){
 const srv=http.createServer((req,res)=>{
  const f=path.join(dir,decodeURIComponent(req.url.split('?')[0]));
  if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
 });
 return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r(srv)));
}

async function record(tmp){
 const dir=path.resolve(pkg),srv=await serve(dir);
 const browser=await chromium.launch({executablePath:process.env.WL_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:vw,height:vh}});
  // --timewarp: the page's clocks (performance.now, rAF timestamps, Date.now) run k times faster, so scenes whose speed sliders are capped
  // still move fast. Scenes clamp each frame's step (Opaline at 0.1 s), so every real frame replays the rAF callbacks in steps of at most
  // 1/30 s of page time; the scene renders several times per real frame, which is why a smaller --viewport helps. Timers are not scaled.
  if(o.timewarp!==1)await page.addInitScript(k=>{
   const pn=performance.now.bind(performance),p0=pn(),dn=Date.now,d0=dn(),raf=window.requestAnimationFrame.bind(window);
   const warp=t=>p0+(t-p0)*k;let cur=null,lastT=-1e9,pending=false,nextId=1,q=[];
   performance.now=()=>cur??warp(pn());Date.now=()=>d0+(dn()-d0)*k;
   function frame(t){
    // after a gap with no rAF (loading, paused scene) step one ordinary frame; catching up in one go crashed the GPU
    pending=false;const to=warp(t),from=t-lastT<100?warp(lastT):to-17*k;lastT=t;
    const n=Math.max(1,Math.ceil((to-from)/33));
    for(let i=1;i<=n&&q.length;i++){
     if(i<n)pending=true; // callbacks re-queued mid-frame wait for the next step, not a new real frame
     cur=from+(to-from)*i/n;const run=q;q=[];
     for(const e of run)try{e.cb(cur);}catch(err){setTimeout(()=>{throw err;});}
     cur=null;
    }
    pending=false;if(q.length){pending=true;raf(frame);}
   }
   window.requestAnimationFrame=cb=>{const id=nextId++;q.push({id,cb});if(!pending){pending=true;raf(frame);}return id;};
   window.cancelAnimationFrame=id=>{q=q.filter(e=>e.id!==id);};
  },o.timewarp);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>m.type()==='error'&&!m.text().startsWith('Failed to load resource')&&errors.push(m.text()));page.on('response',r=>r.status()>=400&&!r.url().endsWith('favicon.ico')&&errors.push(r.status()+' '+r.url()));
  await page.goto(`http://127.0.0.1:${srv.address().port}/index.html`);
  await page.waitForTimeout(1500);
  await page.evaluate(props=>{
   const l=window.wallpaperPropertyListener;if(!l)return;
   l.applyGeneralProperties?.({fps:30});
   const p=Object.fromEntries(Object.entries(props).map(([k,v])=>[k,{value:v}]));
   if(Object.keys(p).length)l.applyUserProperties?.(p);
  },o.props);
  const canvases=await page.evaluate(()=>[...document.querySelectorAll('canvas')].filter(c=>{const r=c.getBoundingClientRect();return r.width*r.height>innerWidth*innerHeight*.25&&getComputedStyle(c).visibility!=='hidden';}).length);
  const mode=o.capture==='auto'?(canvases===1?'canvas':'screencast'):o.capture;
  console.log(`capture: ${mode} (${canvases} large canvas${canvases===1?'':'es'})`);
  const total=o.skip+o.record;
  if(mode==='canvas'){
   const raw=path.join(tmp,'raw.webm'),fd=fs.openSync(raw,'w');
   await page.exposeFunction('saveChunk',b64=>{fs.writeSync(fd,Buffer.from(b64,'base64'));});
   await page.evaluate(async sec=>{
    const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    const mime=['video/webm;codecs=h264','video/webm;codecs=vp9'].find(m=>MediaRecorder.isTypeSupported(m));
    const rec=new MediaRecorder(c.captureStream(30),{mimeType:mime,videoBitsPerSecond:40e6});
    let chain=Promise.resolve();
    rec.ondataavailable=e=>{chain=chain.then(()=>new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(window.saveChunk(fr.result.split(',')[1]));fr.readAsDataURL(e.data);}));};
    const stopped=new Promise(r=>rec.onstop=r);
    rec.start(1000);await new Promise(r=>setTimeout(r,sec*1000+300));rec.stop();await stopped;await chain;
   },total);
   fs.closeSync(fd);
   return {input:['-i',raw],errors};
  }
  // screencast: JPEG frames with timestamps, turned into a variable-rate concat list
  const cdp=await page.context().newCDPSession(page),frames=[];
  cdp.on('Page.screencastFrame',f=>{frames.push({t:f.metadata.timestamp,data:f.data});cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,maxWidth:vw,maxHeight:vh,everyNthFrame:1});
  await page.waitForTimeout(total*1000+300);
  await cdp.send('Page.stopScreencast');
  if(frames.length<total*8)console.warn(`warning: only ${frames.length} screencast frames in ${total} s`);
  let list='';
  frames.forEach((f,i)=>{const n=`f${String(i).padStart(5,'0')}.jpg`;fs.writeFileSync(path.join(tmp,n),Buffer.from(f.data,'base64'));
   list+=`file '${n}'\nduration ${((frames[i+1]?.t??f.t+1/30)-f.t).toFixed(4)}\n`;});
  fs.writeFileSync(path.join(tmp,'list.txt'),list);
  return {input:['-f','concat','-safe','0','-i',path.join(tmp,'list.txt')],errors};
 }finally{await browser.close();srv.close();}
}

function encode(input,tmp,colors){
 const dur=o.record/o.speedup,a=W/H;
 const crop=`crop=w='min(iw,ih*${cf}*${a})':h='min(ih,ih*${cf})':x='max(0,min(iw-ow,iw*${cx}-ow/2))':y='max(0,min(ih-oh,ih*${cy}-oh/2))'`;
 let chain=`[0:v]trim=start=${o.skip}:duration=${o.record},setpts=(PTS-STARTPTS)/${o.speedup},fps=${o.fps},${crop},scale=${W}:${H}:flags=lanczos,setsar=1`;
 if(o.loop==='crossfade'){
  const x=Math.min(o.xfade,dur/3);
  chain+=`,split[h][m];[h]trim=duration=${x},setpts=PTS-STARTPTS,fps=${o.fps}[head];[m]trim=start=${x},setpts=PTS-STARTPTS,fps=${o.fps}[main];[main][head]xfade=transition=fade:duration=${x}:offset=${(dur-2*x).toFixed(3)}`;
 }else if(o.loop==='pingpong')chain+=`,split[f][b];[b]reverse,trim=start_frame=1[r];[f][r]concat=n=2:v=1`;
 const dither=o.dither==='bayer'?'dither=bayer:bayer_scale=4':`dither=${o.dither}`;
 chain+=`,split[c][d];[c]palettegen=max_colors=${colors}:stats_mode=full[p];[d][p]paletteuse=${dither}`;
 ff([...input,'-filter_complex',chain,'-loop','0',out]);
 return fs.statSync(out).size;
}

function report(){
 // motion score and loop seam from the decoded GIF; --strip also writes 5 frames side by side
 const raw=spawnSync(FFMPEG,['-loglevel','error','-i',out,'-vsync','0','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:1<<30}).stdout;
 const len=W*H*3,n=raw.length/len,fr=i=>raw.subarray(i*len,(i+1)*len);
 const diff=(a,b)=>{let s=0;for(let i=0;i<len;i++)s+=Math.abs(a[i]-b[i]);return s/len;};
 let maxStep=0;for(let i=0;i+1<n;i++)maxStep=Math.max(maxStep,diff(fr(i),fr(i+1)));
 if(opt.strip!==undefined){
  const pick=[0,.2,.4,.6,.8].map(f=>Math.floor(f*n));
  ff(['-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`,'-i','-','-vf',`select='${pick.map(i=>`eq(n\\,${i})`).join('+')}',tile=${pick.length}x1`,'-frames:v','1',out.replace(/\.gif$/,'')+'.strip.png'],raw);
 }
 return {frames:n,motion:+diff(fr(0),fr(Math.floor(n/2))).toFixed(1),seam:+diff(fr(n-1),fr(0)).toFixed(2),maxStep:+maxStep.toFixed(2)};
}

(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'previewgif-'));
 try{
  fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});
  const {input,errors}=await record(tmp);
  if(errors.length)console.warn('page errors:',errors.slice(0,5).join(' | '));
  let colors=o.colors,size=encode(input,tmp,colors);
  while(size>o.maxKb*1024&&colors>48){colors=Math.max(48,Math.round(colors*.75));console.log(`${(size/1024)|0} KB, retrying with ${colors} colours`);size=encode(input,tmp,colors);}
  if(size>o.maxKb*1024)console.warn('still over --max-kb at 48 colours: lower --fps or --record, or crop tighter');
  const r=report();
  console.log(`wrote ${out}: ${W}x${H}, ${r.frames} frames, ${(r.frames/o.fps).toFixed(1)} s, ${colors} colours, ${(size/1024)|0} KB${size>o.maxKb*1024?' (OVER LIMIT)':''}, motion ${r.motion}, seam ${r.seam} (largest step ${r.maxStep})`);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});

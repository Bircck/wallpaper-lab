'use strict';
// Minimal Wallpaper Engine web wallpaper runtime (batch 2026-10-22 kit). Copy the folder, then replace art + shader.
// Rules this file demonstrates: 0-100 sliders (50 = tuned, 0 = off), FPS limiter that subtracts the interval,
// setPaused stops rAF, rAF also stops when every motion slider is 0, render scale + DPR cap, fade-in over the
// average colour, plain image file next to index.html, context-loss recovery, still-art fallback, test hooks.
(() => {
const canvas = document.querySelector('#scene');
const ART = new URL('art.jpg', document.currentScript.src).href; // works from other pages (lab/preview) too
const FOCUS = [0.5, 0.5]; // art-space point that must stay on screen at 16:9 and 21:9 (cover fit crops around it)

// ---- settings: WE slider value (0-100) -> internal unit. 50 = tuned look.
const settings = { motion: 1, glow: 1, quality: 1, fps: 30 };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const fromSlider = {
  motion: v => v / 50,               // 0 = still, 1 = tuned, 2 = double
  glow: v => v / 50,                 // 0 = off
  quality: v => clamp(v, 35, 100) / 100,
};
// WE key -> internal key. Rename the WE key if you ever change a slider's meaning (WE replays saved values per key).
const weKeys = { motion: 'motion', glow: 'glow', renderscale: 'quality' };

let gl, program, uniforms, image;
let ready = false, lost = false, hostPaused = false;
let raf = 0, last = 0, acc = 0, pending = 0, time = 0, frames = 0, testMode = false;

window.wallpaperPropertyListener = {
  applyUserProperties(p) {
    for (const [weKey, key] of Object.entries(weKeys)) {
      if (!p[weKey]) continue;
      const n = Number(p[weKey].value);
      if (!Number.isFinite(n)) continue;
      settings[key] = fromSlider[key](clamp(n, 0, 100));
      if (key === 'quality') resize();
    }
    if (ready) draw();   // show the change even while frozen
    schedule();          // a slider may have frozen or unfrozen motion
  },
  applyGeneralProperties(p) {
    if (p.fps !== undefined && Number.isFinite(Number(p.fps))) settings.fps = clamp(Number(p.fps), 0, 240);
  },
  setPaused(paused) { hostPaused = Boolean(paused); schedule(); },
};

// ---- shader: replace. Keep it to a few texture reads + cheap maths per pixel (see council/tech-lead.md budgets).
const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const FS = `precision mediump float;
varying vec2 uv;uniform sampler2D art;uniform vec2 res;uniform float aspectArt,time,motion,glow;uniform vec2 focus;
void main(){
  float a=res.x/res.y; vec2 p=uv;
  // cover fit around FOCUS: wider screens crop top/bottom, narrower crop sides; never stretch
  // (clamp the crop centre, not the sample: the crop window must stay inside the art)
  if(a>aspectArt){float s=aspectArt/a;p.y=clamp(focus.y,.5*s,1.-.5*s)+(p.y-.5)*s;}
  else {float s=a/aspectArt;p.x=clamp(focus.x,.5*s,1.-.5*s)+(p.x-.5)*s;}
  vec2 w=vec2(sin(p.y*9.+time*.7),cos(p.x*7.-time*.5))*.002*motion;
  vec3 c=texture2D(art,p+w).rgb;
  float d=length((p-focus)*vec2(aspectArt,1.));
  c+=glow*.12*exp(-d*d*6.)*(.75+.25*sin(time*.9))*vec3(1.,.8,.55);
  gl_FragColor=vec4(c,1.);
}`;

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}
function setup() {
  program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one big triangle
  const loc = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  uniforms = {};
  for (const k of ['art', 'res', 'aspectArt', 'time', 'motion', 'glow', 'focus']) uniforms[k] = gl.getUniformLocation(program, k);
  gl.uniform1i(uniforms.art, 0); gl.uniform1f(uniforms.aspectArt, image.width / image.height); gl.uniform2f(uniforms.focus, FOCUS[0], FOCUS[1]);
  lost = false; ready = true; resize(); draw();
  canvas.classList.add('on'); // fade in over the average colour only after the first real frame
  schedule();
}
function resize() {
  if (!gl || lost || gl.isContextLost()) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.round(innerWidth * dpr * settings.quality), h = Math.round(innerHeight * dpr * settings.quality);
  // never render more than 4K worth of pixels, whatever the monitor (5120x1440, 8K, DPR 2 ...)
  const cap = Math.min(1, Math.sqrt(3840 * 2160 / Math.max(1, w * h)), gl.getParameter(gl.MAX_TEXTURE_SIZE) / Math.max(w, h, 1));
  w = Math.max(1, Math.floor(w * cap)); h = Math.max(1, Math.floor(h * cap));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  if (ready) draw();
}
function draw() {
  if (!ready || lost) return;
  gl.uniform2f(uniforms.res, canvas.width, canvas.height);
  gl.uniform1f(uniforms.time, time); gl.uniform1f(uniforms.motion, settings.motion); gl.uniform1f(uniforms.glow, settings.glow);
  gl.drawArrays(gl.TRIANGLES, 0, 3); frames++;
}
// Frozen = nothing would change between frames -> do not even request rAF.
function frozen() { return settings.motion === 0 && settings.glow === 0; }
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
  // Subtract the interval, never take the remainder (modulo): rAF timestamps are rounded, a sum just under the interval
  // passes the tolerance and the remainder would trigger a second draw on the very next frame.
  if (acc + 1e-4 >= interval) {
    acc = Math.max(0, acc - interval);
    if (acc > interval) acc = 0;           // after a stall, don't try to catch up
    time += pending; pending = 0;          // animate by real elapsed time, not by frame count
    draw();
  }
  raf = requestAnimationFrame(tick);
}
function fail(err) {
  ready = false; cancelAnimationFrame(raf); canvas.hidden = true;
  document.body.style.backgroundImage = `url('${ART}')`; // still art instead of a black screen
  console.warn('Animation unavailable, showing still art:', err && err.message);
}
document.addEventListener('visibilitychange', schedule);
window.addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; ready = false; schedule(); });
canvas.addEventListener('webglcontextrestored', () => { try { setup(); } catch (e) { fail(e); } });

// ---- test hooks used by kit/verify.cjs (harmless in WE; no panel, no keyboard shortcuts)
window.wallpaperDiagnostics = { get state() { return { ready, lost, time, frames, paused: stopped(), fps: settings.fps, settings: { ...settings }, width: canvas.width, height: canvas.height }; } };
window.wallpaperTest = {
  seek(t) { testMode = true; schedule(); time = t; draw(); }, // freeze at scene time t (seconds) and draw once
  resume() { testMode = false; schedule(); },
};

try {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) throw Error('WebGL is not available.');
  image = new Image();
  image.onload = () => { try { setup(); } catch (e) { fail(e); } };
  image.onerror = () => fail(Error('art.jpg could not be loaded'));
  image.src = ART;
} catch (e) { fail(e); }
})();

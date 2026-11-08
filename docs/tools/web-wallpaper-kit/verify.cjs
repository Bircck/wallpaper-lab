// Generic headless checker for a Wallpaper Engine web wallpaper folder (batch 2026-10-22 kit).
// Loads <folder>/index.html (or project.json "file") from file:// in headless Chrome on the real GPU, like WE does.
// No server and no port: any number of copies can run at once. The timing phase (FPS + cost) takes a lock file so
// parallel runs do not distort each other's numbers; captures and functional checks run concurrently.
//
// usage (any cwd):
//   node docs/tools/web-wallpaper-kit/verify.cjs <wallpaper-folder> [--out <dir>] [--times 0,5,20] [--quick] [--no-contact] [--no-lock]
//   --quick  = captures at 0 and 3 s only, shorter FPS windows (for iteration; run the full check before hand-off)
// output: <out>/verify.json (full), <out>/<W>x<H>_t<SS>.png, <out>/contact.png; compact JSON summary on stdout.
// exit code 0 = all hard checks pass, 1 = a hard check failed, 2 = crashed.
//
// Measurement is generic: an init script wraps WebGL/WebGL2/2D draw calls and window.requestAnimationFrame,
// so a "frame" = an animation frame in which the page issued at least one draw call. Pages can optionally expose
// window.wallpaperDiagnostics.state and window.wallpaperTest.seek(t) (see web-wallpaper-kit/TEMPLATE.md); they are reported if present.
'use strict';
// Playwright: set WL_PLAYWRIGHT to a playwright module folder; the default is the Codex runtime's copy.
const PW = process.env.WL_PLAYWRIGHT || require('os').homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const CHROME = process.env.WL_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = require(PW);
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');

// ---------- args
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const folderArg = argv.find((a, i) => !a.startsWith('--') && !['--out', '--times'].includes(argv[i - 1]));
if (!folderArg) { console.error('usage: node verify.cjs <wallpaper-folder> [--out dir] [--times 0,5,20] [--quick] [--no-contact] [--no-lock]'); process.exit(2); }
// Accepts wallpapers/<stage>/<slug> or its package/ folder (one-folder layout, 2026-10-25).
let folder = path.resolve(folderArg);
if (fs.existsSync(path.join(folder, 'package', 'index.html'))) folder = path.join(folder, 'package');
const isPkg = path.basename(folder) === 'package';
const slug = path.basename(isPkg ? path.dirname(folder) : folder);
const QUICK = flag('--quick');
const TIMES = (opt('--times', QUICK ? '0,3' : '0,5,20')).split(',').map(Number);
const OUT = path.resolve(opt('--out', isPkg ? path.join(path.dirname(folder), 'making-of', 'checks', 'verify')
                                            : path.join(__dirname, 'checks', slug)));
const SIZES = [[1920, 1080], [3440, 1440]];
const FPS_WINDOW_MS = QUICK ? 2000 : 3000;
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f));

const R = { folder: path.relative(process.cwd(), folder) || folder, hard: {}, warn: [], info: {} };
const hard = (name, pass, detail) => { R.hard[name] = detail === undefined ? !!pass : { pass: !!pass, detail }; };
const warn = msg => R.warn.push(msg);
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- static checks
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]); }
let proj = null, entry = 'index.html';
(function staticChecks() {
  const pj = path.join(folder, 'project.json');
  try { proj = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch (e) { hard('project.json parses', false, String(e.message)); return; }
  hard('project.json parses', true);
  entry = proj.file || 'index.html';
  hard('type web + file exists', proj.type === 'web' && fs.existsSync(path.join(folder, entry)), { type: proj.type, file: entry });
  hard('preview exists', proj.preview && fs.existsSync(path.join(folder, proj.preview)), proj.preview);
  const props = (proj.general && proj.general.properties) || {};
  const sliders = Object.entries(props).filter(([, p]) => p.type === 'slider');
  R.info.sliders = Object.fromEntries(sliders.map(([k, p]) => [k, [p.min, p.value, p.max]]));
  for (const [k, p] of sliders) {
    if (/render|scale|quality/i.test(k)) continue;
    if (!(p.min === 0 && p.max === 100 && !p.fraction)) warn(`slider ${k} is not an integer 0-100 slider`);
  }
  if (!sliders.some(([k]) => /render|scale|quality/i.test(k))) warn('no render-scale slider in project.json');
  if (Object.values(props).some(p => p.type === 'combo')) warn('combo property present: fine in WE UI, but never build a <select> in the page');
  const files = walk(folder);
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  R.info.folderMB = +(bytes / 1048576).toFixed(2);
  if (bytes > 60 * 1048576) warn(`folder is ${R.info.folderMB} MB`);
  const text = files.filter(f => /\.(html?|js|mjs|css)$/i.test(f)).map(f => [path.relative(folder, f), fs.readFileSync(f, 'utf8')]);
  hard('no <select> in page', !text.some(([, s]) => /<select[\s>]|createElement\(\s*['"]select/i.test(s)));
  const ext = [];
  for (const [f, s] of text) for (const m of s.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+|url\(\s*["']?https?:\/\/[^)'"]+|import[^;\n]*?from\s*["']https?:\/\/[^"']+|import\(\s*["']https?:\/\/[^"']+|fetch\(\s*["']https?:\/\/[^"']+/gi)) ext.push(f + ': ' + m[0].slice(0, 90));
  hard('no CDN/remote references in source', ext.length === 0, ext.slice(0, 8));
  const b64 = text.filter(([, s]) => /data:(image|font|audio|video)\/[a-z0-9+.-]+;base64,[A-Za-z0-9+/]{20000}/.test(s)).map(([f]) => f);
  if (b64.length) warn('large base64 assets embedded in ' + b64.join(', ') + ' (use plain files)');
  const dotdot = text.filter(([, s]) => /["'(]\.\.\//.test(s)).map(([f]) => f);
  if (dotdot.length) warn('"../" paths in ' + dotdot.join(', ') + ' (folder must be self-contained)');
  const mod = text.filter(([, s]) => /(acc\w*|elapsed|delta)\s*%=?\s*[\w(]|%\s*\(?\s*(\w*interval|1\s*\/\s*\w*fps)/i.test(s)).map(([f]) => f);
  if (mod.length) warn('possible modulo frame limiter in ' + mod.join(', ') + ': subtract the interval instead (headless 60 Hz cannot show this bug)');
  if (text.some(([, s]) => /keydown|keyup|keypress/.test(s))) warn('keyboard handlers in the shipped runtime (no shortcuts/panels in finals)');
})();
if (!proj) { finish(); }

// ---------- instrumentation injected before any page script
function instrument() {
  const W = window.__wlv = { frameId: 0, lastDrawFrame: -1, drawFrames: 0, drawCalls: 0, rafRegs: 0, cbMs: 0, cbFrames: 0,
    frameTimes: [], sync: false, syncMs: [], lastGl: null, contexts: {} };
  const origRaf = window.requestAnimationFrame.bind(window);
  (function loop() { W.frameId++; origRaf(loop); })();
  const mark = ctx => function () {
    W.drawCalls++;
    if (W.lastDrawFrame !== W.frameId) { W.lastDrawFrame = W.frameId; W.drawFrames++; W.frameTimes.push(performance.now()); if (W.frameTimes.length > 4000) W.frameTimes.splice(0, 2000); }
    if (ctx) W.lastGl = this;
  };
  const wrap = (proto, names, isGl, kind) => {
    if (!proto) return;
    for (const n of names) {
      const f = proto[n]; if (typeof f !== 'function') continue;
      const m = mark(isGl);
      proto[n] = function () { W.contexts[kind] = (W.contexts[kind] || 0) + 1; m.call(this); return f.apply(this, arguments); };
    }
  };
  const glNames = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype, glNames, true, 'webgl');
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, glNames, true, 'webgl2');
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ['drawImage', 'fillRect', 'putImageData', 'fill', 'stroke', 'fillText'], false, '2d');
  window.requestAnimationFrame = function (cb) {
    W.rafRegs++;
    return origRaf(function (ts) {
      const t0 = performance.now(), d0 = W.drawCalls;
      try { return cb(ts); } finally {
        if (W.drawCalls > d0) {
          W.cbMs += performance.now() - t0; W.cbFrames++;
          const g = W.lastGl;
          if (W.sync && g && !g.isContextLost()) { // 1 px readback forces the GPU to finish: CPU + GPU time of this frame
            try { const fb = g.getParameter(g.FRAMEBUFFER_BINDING); if (fb) g.bindFramebuffer(g.FRAMEBUFFER, null);
              g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4)); if (fb) g.bindFramebuffer(g.FRAMEBUFFER, fb); } catch (e) {}
            W.syncMs.push(performance.now() - t0);
          }
        }
      }
    });
  };
}

// ---------- perf lock (serialises the timing phase across parallel runs)
const LOCK = path.join(os.tmpdir(), 'wallpaper-lab-verify-perf.lock');
async function lock() {
  if (flag('--no-lock')) return () => {};
  const t0 = Date.now();
  for (;;) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); break; } catch {
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 90000) fs.unlinkSync(LOCK); } catch {}
      await sleep(500);
    }
  }
  R.info.perfLockWaitS = +((Date.now() - t0) / 1000).toFixed(1);
  return () => { try { fs.unlinkSync(LOCK); } catch {} };
}

// ---------- page helpers
const errors = [], remote = [], escapes = [], failed = [];
const folderUrl = fileUrl(folder).toLowerCase();
async function openPage(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${w}] pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${w}] console: ${m.text().slice(0, 300)}`); if (m.type() === 'warning') R.info.consoleWarnings = (R.info.consoleWarnings || 0) + 1; });
  page.on('request', r => {
    const u = r.url();
    if (/^(data|blob|about):/.test(u)) return;
    if (!u.startsWith('file:')) { remote.push(u.slice(0, 160)); return; }
    if (!decodeURIComponent(u).toLowerCase().replace(/\\/g, '/').startsWith(folderUrl)) escapes.push(u.slice(0, 160));
  });
  page.on('requestfailed', r => failed.push(r.url().slice(-120) + ' ' + (r.failure() || {}).errorText));
  await page.addInitScript(instrument);
  await page.goto(fileUrl(path.join(folder, entry)), { waitUntil: 'load' });
  // WE delivers properties after load: project.json defaults + general fps.
  const defaults = Object.fromEntries(Object.entries((proj.general && proj.general.properties) || {}).map(([k, p]) => [k, { value: p.value, type: p.type }]));
  const hasListener = await page.evaluate(d => {
    const L = window.wallpaperPropertyListener; if (!L) return false;
    try { L.applyUserProperties && L.applyUserProperties(d); L.applyGeneralProperties && L.applyGeneralProperties({ fps: 30 }); } catch (e) { console.error('listener threw: ' + e.message); }
    return { user: typeof L.applyUserProperties, general: typeof L.applyGeneralProperties, paused: typeof L.setPaused };
  }, defaults);
  const t0 = Date.now();
  await page.waitForFunction(() => window.__wlv.drawFrames > 0, null, { timeout: 20000 }).catch(() => {});
  const firstDrawMs = await page.evaluate(() => window.__wlv.frameTimes[0] ? Math.round(window.__wlv.frameTimes[0]) : null);
  return { ctx, page, hasListener, firstDrawMs, readyAt: Date.now(), waited: Date.now() - t0 };
}
const W = page => page.evaluate(() => { const w = window.__wlv; return { f: w.drawFrames, raf: w.rafRegs, t: performance.now(), cb: w.cbMs, cbf: w.cbFrames }; });
const L = (page, fn, arg) => page.evaluate(([fn, arg]) => { const l = window.wallpaperPropertyListener; return l && l[fn] ? (l[fn](arg), true) : false; }, [fn, arg]);

// capture frames at real time TIMES (seconds after the first draw)
async function captureRun(browser, w, h) {
  const p = await openPage(browser, w, h);
  for (const t of TIMES) {
    const due = p.readyAt + Math.max(t * 1000, 700); // t=0 shot waits out the 0.6 s fade-in
    if (due > Date.now()) await sleep(due - Date.now());
    await p.page.screenshot({ path: path.join(OUT, `${w}x${h}_t${String(t).padStart(2, '0')}.png`) });
  }
  const diag = await p.page.evaluate(() => window.wallpaperDiagnostics ? window.wallpaperDiagnostics.state : null).catch(() => null);
  const st = await W(p.page);
  return { p, diag, frames: st.f };
}

let browser;
(async () => {
  browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const runs = await Promise.all(SIZES.map(([w, h]) => captureRun(browser, w, h)));
  const main = runs[0].p, page = main.page;
  R.info.renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  hard('real GPU (not SwiftShader)', !/swiftshader|llvmpipe|basic render/i.test(R.info.renderer), R.info.renderer);
  R.info.firstDrawMs = main.firstDrawMs;
  R.info.contexts = await page.evaluate(() => window.__wlv.contexts);
  hard('draws frames', runs.every(r => r.frames > 0), runs.map(r => r.frames));
  hard('wallpaperPropertyListener with all 3 methods', main.hasListener && main.hasListener.user === 'function' && main.hasListener.general === 'function' && main.hasListener.paused === 'function', main.hasListener);
  if (runs[0].diag) R.info.diagnostics = runs[0].diag;
  for (const r of runs.slice(1)) await r.p.ctx.close();

  // ---- timing phase (locked)
  const unlock = await lock();
  try {
    const rate = async ms => { const a = await W(page); await sleep(ms); const b = await W(page); return { fps: (b.f - a.f) / ((b.t - a.t) / 1000), cbMs: b.cbf > a.cbf ? (b.cb - a.cb) / (b.cbf - a.cbf) : null, frames: b.f - a.f }; };
    const gaps = async () => page.evaluate(() => { const t = window.__wlv.frameTimes.slice(-60); const g = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b); return g.length ? { p50: +g[g.length >> 1].toFixed(1), p95: +g[Math.floor(g.length * .95)].toFixed(1), max: +g[g.length - 1].toFixed(1) } : null; });
    for (const fps of [30, 10]) {
      await L(page, 'applyGeneralProperties', { fps }); await sleep(400);
      const r = await rate(FPS_WINDOW_MS);
      R.info['fps' + fps] = +r.fps.toFixed(1); R.info['frameGapsMs_fps' + fps] = await gaps();
      hard(`fps ${fps} honoured (page clock)`, r.fps >= fps * 0.8 && r.fps <= fps * 1.08, +r.fps.toFixed(1));
    }
    await L(page, 'applyGeneralProperties', { fps: 30 }); await sleep(300);
    // cost at 30 fps: main-thread task time per drawn frame (CDP) + rAF callback time + synced CPU+GPU time
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const met = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const m0 = await met(); const a = await W(page); await sleep(FPS_WINDOW_MS); const b = await W(page); const m1 = await met();
    const df = Math.max(1, b.f - a.f);
    R.info.cost1080 = {
      mainThreadMsPerFrame: +(((m1.TaskDuration - m0.TaskDuration) * 1000) / df).toFixed(2),
      scriptMsPerFrame: +(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / df).toFixed(2),
      rafCallbackMs: b.cbf > a.cbf ? +((b.cb - a.cb) / (b.cbf - a.cbf)).toFixed(2) : null,
      mainThreadCpuPctOfCore: +(((m1.TaskDuration - m0.TaskDuration) / ((b.t - a.t) / 1000)) * 100).toFixed(1),
    };
    await page.evaluate(() => { window.__wlv.syncMs = []; window.__wlv.sync = true; }); await sleep(QUICK ? 1500 : 2500);
    const sync = await page.evaluate(() => { const w = window.__wlv; w.sync = false; return w.syncMs.slice().sort((a, b) => a - b); });
    if (sync.length) R.info.cost1080.syncedFrameMsMedian = +sync[sync.length >> 1].toFixed(2), R.info.cost1080.syncedFrameMsP90 = +sync[Math.floor(sync.length * .9)].toFixed(2);
    else warn('no WebGL frames in rAF callbacks: synced GPU time not measured');
    if (R.info.cost1080.syncedFrameMsMedian > 8) warn(`synced frame ${R.info.cost1080.syncedFrameMsMedian} ms at 1080p headless: over the 8 ms budget`);
    if (R.info.cost1080.mainThreadMsPerFrame > 4) warn(`main thread ${R.info.cost1080.mainThreadMsPerFrame} ms/frame: over the 4 ms CPU budget`);
    await cdp.detach();
  } finally { unlock(); }

  // ---- pause: setPaused(true) stops draws and (ideally) rAF requests
  await L(page, 'setPaused', false); await sleep(400);
  await L(page, 'setPaused', true); await sleep(150);
  const p0 = await W(page); const shot0 = await page.screenshot(); await sleep(1200); const p1 = await W(page); const shot1 = await page.screenshot();
  hard('setPaused(true) stops frames', p1.f - p0.f === 0, { frames: p1.f - p0.f, pixelsSame: shot0.equals(shot1) });
  R.info.pausedRafRequestsPerS = +((p1.raf - p0.raf) / ((p1.t - p0.t) / 1000)).toFixed(1);
  if (R.info.pausedRafRequestsPerS > 1) warn(`page keeps requesting rAF while paused (${R.info.pausedRafRequestsPerS}/s): cancel it instead`);
  await L(page, 'setPaused', false); await sleep(600);
  const q0 = await W(page); await sleep(600); const q1 = await W(page);
  hard('resumes after setPaused(false)', q1.f > q0.f, q1.f - q0.f);

  // ---- slider sweep: each slider at min/max must not throw; record which sliders at 0 stop rAF; render scale shrinks the canvas
  const props = (proj.general && proj.general.properties) || {};
  const defaults = Object.fromEntries(Object.entries(props).map(([k, p]) => [k, { value: p.value }]));
  const sweep = {};
  for (const [k, p] of Object.entries(props)) {
    if (p.type !== 'slider') continue;
    const canvasSize = () => page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => c.width * c.height).reduce((a, b) => Math.max(a, b), 0));
    const before = await canvasSize();
    await L(page, 'applyUserProperties', { [k]: { value: p.min } }); await sleep(500);
    const s0 = await W(page); await sleep(500); const s1 = await W(page);
    const atMin = { frames: s1.f - s0.f, rafPerS: +((s1.raf - s0.raf) / ((s1.t - s0.t) / 1000)).toFixed(0), canvasPx: await canvasSize() };
    await L(page, 'applyUserProperties', { [k]: { value: p.max } }); await sleep(250);
    await L(page, 'applyUserProperties', defaults); await sleep(250);
    sweep[k] = atMin;
    if (/render|scale|quality/i.test(k) && !(atMin.canvasPx < before * 0.8)) warn(`${k}=${p.min} did not shrink the canvas (${before} -> ${atMin.canvasPx} px)`);
  }
  R.info.sliderAtMin = sweep;
  if (await page.evaluate(() => !!(window.wallpaperTest && window.wallpaperTest.seek))) {
    await page.evaluate(() => window.wallpaperTest.seek(12)); await page.screenshot({ path: path.join(OUT, 'seek_t12_1920x1080.png') });
    await page.evaluate(() => window.wallpaperTest.resume && window.wallpaperTest.resume());
  }
  await main.ctx.close();
})().catch(e => { R.crash = String(e && e.stack || e).slice(0, 600); }).finally(async () => { try { await browser.close(); } catch {} finish(); });

function finish() {
  hard('0 console/page errors', errors.length === 0, errors.slice(0, 8));
  hard('0 non-local requests', remote.length === 0, [...new Set(remote)].slice(0, 8));
  hard('no file requests outside the folder', escapes.length === 0, [...new Set(escapes)].slice(0, 8));
  hard('no failed requests (missing assets)', failed.length === 0, [...new Set(failed)].slice(0, 8));
  if (!flag('--no-contact') && fs.readdirSync(OUT).some(f => /^\d+x\d+_t\d+\.png$/.test(f))) {
    const r = spawnSync('python', ['-I', path.join(__dirname, 'contact.py'), OUT], { encoding: 'utf8' });
    if (r.status === 0) R.info.contact = path.join(OUT, 'contact.png'); else warn('contact sheet failed: ' + (r.stderr || r.error || '').toString().slice(0, 200));
  }
  const failedChecks = Object.entries(R.hard).filter(([, v]) => !(v === true || (v && v.pass))).map(([k]) => k);
  R.pass = !R.crash && failedChecks.length === 0;
  R.note = 'Headless Chrome on the local GPU: timings are an upper bound, not a Wallpaper Engine host measurement.';
  fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify(R, null, 2));
  const I = R.info;
  console.log(JSON.stringify({ pass: R.pass, failed: failedChecks, crash: R.crash, warn: R.warn,
    fps30: I.fps30, fps10: I.fps10, cost1080: I.cost1080, pausedRafPerS: I.pausedRafRequestsPerS, firstDrawMs: I.firstDrawMs,
    renderer: I.renderer && I.renderer.slice(0, 60), folderMB: I.folderMB, out: OUT }));
  process.exit(R.crash ? 2 : R.pass ? 0 : 1);
}

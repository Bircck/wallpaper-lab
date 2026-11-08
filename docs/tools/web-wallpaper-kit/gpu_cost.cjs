// GPU frame cost from the graphics card's own timer (EXT_disjoint_timer_query), measured around the page's real
// requestAnimationFrame callbacks. verify.cjs reports a synced 1 px readback instead, which overstates the cost
// (Sunroom: readback 1.3-4.6 ms, GPU timer 0.56 ms), so quote that one only as an upper bound.
// Whole-card nvidia-smi is useless while other jobs run, and so is this if another job loads the card: run it
// under the GPU lock and repeat it on a quiet machine before comparing builds.
//
// usage (any cwd):
//   python docs/tools/gpu_lock.py --timeout 10 -- node docs/tools/web-wallpaper-kit/gpu_cost.cjs <wallpaper-folder>
//        [--sizes 1920x1080,2560x1440] [--rounds 3] [--frames 120]
//        [--props '{"slider":{"value":100}}']   repeat for more cases; applied with wallpaperPropertyListener.applyUserProperties
//        [--fps 60]                              applyGeneralProperties; default: leave the page's own setting
// Only rAF callbacks in which the page issued a draw call count, so a 30 FPS limiter does not dilute the median.
// Output: median and p95 ms per drawn frame for each size and case, plus the individual round medians.
// Env: WL_PLAYWRIGHT (playwright module folder), WL_CHROME (chrome.exe).
'use strict';
const PW = process.env.WL_PLAYWRIGHT || require('os').homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const CHROME = process.env.WL_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = require(PW);
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const opts = n => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]] : []));
const valueFlags = ['--sizes', '--rounds', '--frames', '--props', '--fps'];
const folderArg = argv.find((a, i) => !a.startsWith('--') && !valueFlags.includes(argv[i - 1]));
if (!folderArg) { console.error('usage: node gpu_cost.cjs <wallpaper-folder> [--sizes WxH,..] [--rounds n] [--frames n] [--props json]... [--fps n]'); process.exit(2); }
let folder = path.resolve(folderArg);
if (fs.existsSync(path.join(folder, 'package', 'project.json'))) folder = path.join(folder, 'package');
const proj = JSON.parse(fs.readFileSync(path.join(folder, 'project.json'), 'utf8'));
const entry = path.join(folder, proj.file || 'index.html');
const SIZES = opt('--sizes', '1920x1080,2560x1440').split(',').map(s => s.split('x').map(Number));
const ROUNDS = +opt('--rounds', 3), FRAMES = +opt('--frames', 120), FPS = opt('--fps', null);
const cases = [['default', {}], ...opts('--props').map(j => [j, JSON.parse(j)])];
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

// Runs before the page's own scripts: capture the GL context, wrap rAF callbacks in a timer query.
function installTimer() {
  const S = window.__gpuCost = { gl: null, ext: null, webgl2: false, drew: false, inQuery: false, pending: [], ms: [], disjoint: 0, error: null };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = getContext.call(this, type, ...rest);
    if (c && !S.gl && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
      S.gl = c; S.webgl2 = type === 'webgl2';
      S.ext = S.webgl2 ? c.getExtension('EXT_disjoint_timer_query_webgl2') : c.getExtension('EXT_disjoint_timer_query');
      if (!S.ext) S.error = 'EXT_disjoint_timer_query not available (launch Chrome with --enable-privileged-webgl-extensions)';
    }
    return c;
  };
  for (const P of [window.WebGLRenderingContext && WebGLRenderingContext.prototype, window.WebGL2RenderingContext && WebGL2RenderingContext.prototype]) {
    if (!P) continue;
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const orig = P[fn]; if (!orig) continue;
      P[fn] = function (...a) { S.drew = true; return orig.apply(this, a); };
    }
  }
  S.poll = () => {
    const { gl, ext } = S;
    while (S.pending.length) {
      const q = S.pending[0];
      const avail = S.webgl2 ? gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) : ext.getQueryObjectEXT(q, ext.QUERY_RESULT_AVAILABLE_EXT);
      if (!avail) break;
      S.pending.shift();
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) S.disjoint++;
      else S.ms.push((S.webgl2 ? gl.getQueryParameter(q, gl.QUERY_RESULT) : ext.getQueryObjectEXT(q, ext.QUERY_RESULT_EXT)) / 1e6);
      if (S.webgl2) gl.deleteQuery(q); else ext.deleteQueryEXT(q);
    }
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(ts => {
    if (!S.gl || !S.ext || S.inQuery) return cb(ts);
    S.poll();
    const { gl, ext } = S, q = S.webgl2 ? gl.createQuery() : ext.createQueryEXT();
    S.drew = false; S.inQuery = true;
    if (S.webgl2) gl.beginQuery(ext.TIME_ELAPSED_EXT, q); else ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, q);
    try { cb(ts); } finally {
      if (S.webgl2) gl.endQuery(ext.TIME_ELAPSED_EXT); else ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
      S.inQuery = false;
      if (S.drew) S.pending.push(q); else if (S.webgl2) gl.deleteQuery(q); else ext.deleteQueryEXT(q);
    }
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--enable-privileged-webgl-extensions', '--enable-webgl-draft-extensions'] });
  for (const [W, H] of SIZES) {
    const res = {};
    for (let r = 0; r < ROUNDS; r++) for (const [name, props] of cases) {
      const page = await browser.newPage({ viewport: { width: W, height: H } }), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.addInitScript(installTimer);
      await page.goto(pathToFileURL(entry).href);
      await page.waitForTimeout(1500);
      const out = await page.evaluate(async ([props, fps, frames]) => {
        const S = window.__gpuCost, L = window.wallpaperPropertyListener;
        if (!S.gl) return { error: 'no WebGL context created' };
        if (S.error) return { error: S.error };
        if (L && fps) L.applyGeneralProperties({ fps: +fps });
        if (L && Object.keys(props).length) L.applyUserProperties(props);
        await new Promise(r => setTimeout(r, 500));
        S.ms.length = 0;
        const t0 = performance.now();
        while (S.ms.length < frames + 10 && performance.now() - t0 < 60000) await new Promise(r => requestAnimationFrame(r));
        for (let i = 0; i < 20 && S.pending.length; i++) { await new Promise(r => requestAnimationFrame(r)); S.poll(); }
        return { ms: S.ms.slice(10), disjoint: S.disjoint };
      }, [props, FPS, FRAMES]);
      await page.close();
      if (errors.length) throw Error(name + ': ' + errors.join('; '));
      if (out.error) throw Error(out.error);
      if (!out.ms.length) throw Error(name + ': no timed frames (does the page draw? is it paused?)');
      (res[name] = res[name] || []).push({ med: median(out.ms), p95: pct(out.ms, .95) });
    }
    console.log(`--- ${W}x${H}: ms per drawn frame, GPU timer (median of round medians; p95 of the worst round)`);
    for (const n in res) console.log(n.slice(0, 40).padEnd(40), median(res[n].map(x => x.med)).toFixed(2).padStart(6), ' p95', Math.max(...res[n].map(x => x.p95)).toFixed(2).padStart(6), '  rounds', res[n].map(x => x.med.toFixed(2)).join(' '));
  }
  await browser.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });

// Asset audit for a web wallpaper package: which image files are loaded but never drawn, and which draw nothing visible.
// "Bound" is not "drawn", and "drawn" is not "visible": a texture can be bound every frame and change 0% of pixels
// (Luminous Streams' light.png, 727 KB, shipped anyway). Two tests, run at the default sliders and with every slider at 100:
//   1. bound/drawn: wraps texImage2D/texSubImage2D, bindTexture and the draw calls, and records which image files were
//      uploaded and which of them were bound when something was drawn, over a long stretch of scene time.
//   2. flat swap: serves each image file as a flat grey image of the same size and counts the pixels that change at a few
//      scene times, next to the noise of two identical renders. A file whose swap changes nothing is dead weight.
// Files that were never requested or never uploaded are listed too. Remove what the audit flags, then check frames are unchanged.
//
// usage (any cwd):
//   python docs/tools/gpu_lock.py --timeout 10 -- node docs/tools/web-wallpaper-kit/audit_assets.cjs <wallpaper-folder>
//        [--duration 3600] [--step 1]      scene seconds walked by the bound/drawn test (seek every <step> s)
//        [--times 60,240,600]              scene times compared by the swap test
//        [--levels default,100]            slider levels: "default" leaves the page alone, a number sets every slider to it
//        [--size 1280x720] [--tol 2]       viewport, and per-channel difference that counts as a changed pixel
//        [--skip bound|swap]               run only one of the tests
// Needs the test hook window.wallpaperTest.seek(t) (or window.wallpaperDiagnostics.seek) that freezes at scene time t and
// draws once (see TEMPLATE.md). Slider keys come from project.json (type "slider"). Textures built on the GPU or from a canvas
// have no file; they are counted as "drawn textures without a file". Only the largest WebGL canvas is compared.
// Env: WL_PLAYWRIGHT (playwright module folder), WL_CHROME (chrome.exe).
'use strict';
const PW = process.env.WL_PLAYWRIGHT || require('os').homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const CHROME = process.env.WL_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const { chromium } = require(PW);
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const valueFlags = ['--duration', '--step', '--times', '--levels', '--size', '--tol', '--skip'];
const folderArg = argv.find((a, i) => !a.startsWith('--') && !valueFlags.includes(argv[i - 1]));
if (!folderArg) { console.error('usage: node audit_assets.cjs <wallpaper-folder> [--duration s] [--step s] [--times a,b,c] [--levels default,100] [--size WxH] [--tol n] [--skip bound|swap]'); process.exit(2); }
let folder = path.resolve(folderArg);
if (fs.existsSync(path.join(folder, 'package', 'project.json'))) folder = path.join(folder, 'package');
const proj = JSON.parse(fs.readFileSync(path.join(folder, 'project.json'), 'utf8'));
const entry = path.join(folder, proj.file || 'index.html');
const DURATION = +opt('--duration', 3600), STEP = +opt('--step', 1);
const TIMES = opt('--times', '60,240,600').split(',').map(Number);
const LEVELS = opt('--levels', 'default,100').split(',').map(s => (s === 'default' ? s : +s));
const [VW, VH] = opt('--size', '1280x720').split('x').map(Number);
const TOL = +opt('--tol', 2), SKIP = opt('--skip', '');
const props = (proj.general && proj.general.properties) || {};
const KEYS = Object.entries(props).filter(([, p]) => p.type === 'slider').map(([k]) => k);
const levelProps = lv => (lv === 'default' ? {} : Object.fromEntries(KEYS.map(k => [k, { value: lv }])));

const IMG = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const rel = f => path.relative(folder, f).replace(/\\/g, '/');
const FILES = walk(folder).filter(f => IMG.test(f) && rel(f) !== proj.preview).map(rel);
const fileOf = url => { try { const u = new URL(url); if (u.protocol !== 'file:') return null; const r = path.relative(folder, decodeURIComponent(u.pathname.replace(/^\/([A-Za-z]:)/, '$1'))).replace(/\\/g, '/'); return FILES.includes(r) ? r : null; } catch (e) { return null; } };

// Init script: record texture sources, the textures bound at draw time, and expose the seek hook plus a frame grabber.
function installHooks() {
  const A = window.__audit = { src: new Map(), drawn: new Set(), recording: false, units: {}, unit: 0 };
  for (const P of [window.WebGLRenderingContext && WebGLRenderingContext.prototype, window.WebGL2RenderingContext && WebGL2RenderingContext.prototype]) {
    if (!P) continue;
    const bind = P.bindTexture, active = P.activeTexture;
    P.activeTexture = function (u) { A.unit = u; return active.call(this, u); };
    P.bindTexture = function (target, t) { (A.units[A.unit] = A.units[A.unit] || {})[target] = t; return bind.call(this, target, t); };
    for (const fn of ['texImage2D', 'texSubImage2D']) {
      const orig = P[fn]; if (!orig) continue;
      P[fn] = function (...a) {
        const s = a[a.length - 1];
        if (s instanceof HTMLImageElement && s.src) {
          const t = (A.units[A.unit] || {})[a[0]]; if (t) { const set = A.src.get(t) || new Set(); set.add(s.src); A.src.set(t, set); }
        }
        return orig.apply(this, a);
      };
    }
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const orig = P[fn]; if (!orig) continue;
      P[fn] = function (...a) {
        if (A.recording) for (const m of Object.values(A.units)) for (const t of Object.values(m)) if (t) A.drawn.add(t);
        return orig.apply(this, a);
      };
    }
  }
}

async function open(browser, route) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [], requested = new Set();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { const f = fileOf(r.url()); if (f) requested.add(f); });
  await page.addInitScript(installHooks);
  if (route) await page.route('**/*', route);
  await page.goto(pathToFileURL(entry).href);
  const ok = await page.waitForFunction(() => {
    const t = window.wallpaperTest || {}, d = window.wallpaperDiagnostics || {};
    return typeof (t.seek || d.seek) === 'function' && (!d.state || d.state.ready !== false);
  }, null, { timeout: 60000 }).then(() => true, () => false);
  if (!ok) throw Error('no seek hook: expose window.wallpaperTest.seek(t) (see TEMPLATE.md)');
  await page.waitForTimeout(800);
  return { ctx, page, errors, requested };
}

// ---------- test 1: bound / drawn
async function boundTest(browser) {
  const uploaded = new Set(), drawnFiles = new Set(), requested = new Set();
  let unmappedDrawn = 0;
  for (const lv of LEVELS) {
    const { ctx, page, requested: rq } = await open(browser);
    const r = await page.evaluate(([p, duration, step]) => {
      const A = window.__audit, L = window.wallpaperPropertyListener, seek = (window.wallpaperTest || window.wallpaperDiagnostics).seek;
      seek(0);
      if (L && Object.keys(p).length) L.applyUserProperties(p);
      if (L && L.setPaused) L.setPaused(true);
      A.drawn.clear(); A.recording = true;
      for (let t = 0; t < duration; t += step) seek(t);
      A.recording = false;
      const up = new Set(), dr = new Set(); let none = 0;
      for (const [t, set] of A.src) for (const s of set) up.add(s);
      for (const t of A.drawn) { const set = A.src.get(t); if (!set) none++; else for (const s of set) dr.add(s); }
      return { up: [...up], dr: [...dr], none };
    }, [levelProps(lv), DURATION, STEP]);
    r.up.map(fileOf).filter(Boolean).forEach(f => uploaded.add(f));
    r.dr.map(fileOf).filter(Boolean).forEach(f => drawnFiles.add(f));
    unmappedDrawn = Math.max(unmappedDrawn, r.none);
    rq.forEach(f => requested.add(f));
    await ctx.close();
  }
  console.log(`\n== bound/drawn over ${DURATION} s of scene time, levels ${LEVELS.join(', ')} (${FILES.length} image files in the package)`);
  const never = FILES.filter(f => !requested.has(f)), notUp = FILES.filter(f => requested.has(f) && !uploaded.has(f));
  const notDrawn = FILES.filter(f => uploaded.has(f) && !drawnFiles.has(f));
  console.log('  never requested (delete or find the code that should load it):', never.join(', ') || 'none');
  console.log('  requested but not uploaded as a texture (used by CSS, 2D canvas or a decoder? check by hand):', notUp.join(', ') || 'none');
  console.log('  uploaded but never bound during a draw (dead weight):', notDrawn.join(', ') || 'none');
  console.log('  drawn textures without a file (built on the GPU or from a canvas):', unmappedDrawn);
}

// ---------- test 2: flat swap
const grab = async (page, t) => page.evaluate(([t]) => {
  const seek = (window.wallpaperTest || window.wallpaperDiagnostics).seek; seek(t);
  const cs = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
  const c = cs[0], o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const x = o.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, o.width, o.height).data; let s = '';
  for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768));
  return btoa(s);
}, [t]);
const diff = (a, b) => {
  const A = Buffer.from(a, 'base64'), B = Buffer.from(b, 'base64'); let n = 0, max = 0;
  const len = Math.min(A.length, B.length);
  for (let i = 0; i < len; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d > TOL) n++; if (d > max) max = d; }
  return { pct: +(100 * n / (len / 4)).toFixed(4), max };
};
async function render(browser, lv, swap, dims) {
  let flat = null;
  if (swap) {
    const { w, h } = dims[swap];
    flat = await dims.helper.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h]);
  }
  const { ctx, page } = await open(browser, swap ? r => {
    if (fileOf(r.request().url()) === swap) return r.fulfill({ contentType: 'image/png', body: Buffer.from(flat, 'base64') });
    return r.continue();
  } : null);
  await page.evaluate(p => { const L = window.wallpaperPropertyListener; if (L && Object.keys(p).length) L.applyUserProperties(p); if (L && L.setPaused) L.setPaused(true); }, levelProps(lv));
  const out = []; for (const t of TIMES) out.push(await grab(page, t));
  await ctx.close(); return out;
}
async function swapTest(browser) {
  const helper = await browser.newPage();
  await helper.goto('about:blank');
  const dims = { helper };
  for (const f of FILES) {
    const d = await helper.evaluate(src => new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth || 1, h: i.naturalHeight || 1 }); i.onerror = () => res({ w: 1, h: 1 }); i.src = src; }), pathToFileURL(path.join(folder, f)).href);
    dims[f] = d;
  }
  console.log(`\n== flat-grey swap, pixels changed by more than ${TOL} levels at scene times ${TIMES.join(', ')} s (${VW}x${VH}); noise = two identical renders`);
  const flagged = new Set();
  for (const lv of LEVELS) {
    const base = await render(browser, lv, null, dims), again = await render(browser, lv, null, dims);
    const fmt = ds => ds.map(d => `${d.pct}%/max${d.max}`).join('  ');
    const noise = base.map((b, i) => diff(b, again[i]));
    console.log(`level ${lv}  noise: ${fmt(noise)}`);
    const noisePct = Math.max(...noise.map(n => n.pct));
    for (const f of FILES) {
      const r = await render(browser, lv, f, dims), ds = r.map((b, i) => diff(base[i], b));
      const worst = Math.max(...ds.map(d => d.pct));
      if (worst <= noisePct) flagged.add(f);
      console.log(`  ${f.padEnd(34)} ${fmt(ds)}${worst <= noisePct ? '   <- no change beyond noise' : ''}`);
    }
  }
  const everywhere = FILES.filter(f => flagged.has(f));
  console.log('\n  changes nothing at at least one level (a candidate to delete; confirm it is not needed at the other levels):', everywhere.join(', ') || 'none');
  await helper.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  if (!FILES.length) console.log('no image files found in', folder);
  if (SKIP !== 'bound') await boundTest(browser);
  if (SKIP !== 'swap') await swapTest(browser);
  await browser.close();
})().catch(e => { console.error(e.message || e); process.exit(1); });

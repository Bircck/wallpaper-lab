#!/usr/bin/env node
// wl: one shared toolkit for starting and releasing Wallpaper Engine web wallpapers. See tools/README.md.
// No npm dependencies: Playwright, Chrome and ffmpeg are found where the existing scripts find them.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process'), crypto = require('crypto');

// ---------- paths (env overrides exist so tests can run on scratch copies)
const REPO = path.resolve(__dirname, '..');
const WALL = path.resolve(process.env.WL_ROOT || path.join(REPO, 'wallpapers'));
const EXPORTS = path.resolve(process.env.WL_EXPORTS || (process.env.WL_ROOT ? path.join(WALL, '..', 'exports') : path.join(REPO, 'exports')));
const WE = (process.env.WL_WE || 'C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine').replace(/\\/g, '/');
const STAGES = ['in-progress', 'ready-to-publish', 'published'];
const KIT = path.join(REPO, 'docs/tools/web-wallpaper-kit');
const PW = process.env.WL_PLAYWRIGHT || require('os').homedir() + '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const CHROME = process.env.WL_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FFMPEG = process.env.WL_FFMPEG || require('os').homedir() + '/AppData/Local/Programs/Python/Python313/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe';
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'wl-defaults.json'), 'utf8'));

// ---------- small helpers
const die = m => { console.error('wl: ' + m); process.exit(1); };
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const MB = n => +(n / 1048576).toFixed(2);
const rel = p => path.relative(REPO, p).replace(/\\/g, '/');
function parseArgs(list) { // --flag, --key value, positionals
  const pos = [], opt = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (list[i + 1] !== undefined && !list[i + 1].startsWith('--')) opt[k] = list[++i]; else opt[k] = true; } else pos.push(a);
  }
  return { pos, opt };
}
function dirSize(dir) {
  let n = 0; const stack = [dir];
  while (stack.length) {
    const d = stack.pop(); let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) stack.push(p); else if (e.isFile()) { try { n += fs.statSync(p).size; } catch {} } }
  }
  return n;
}
function walkFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walkFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).replace(/\\/g, '/')]).sort();
}
function find(slug) {
  slug = path.basename(String(slug || '').replace(/[\\/]+$/, ''));
  if (!slug) die('missing <slug>');
  const hits = STAGES.map(s => ({ stage: s, dir: path.join(WALL, s, slug) })).filter(h => fs.existsSync(h.dir));
  if (hits.length > 1) die(`slug "${slug}" exists in several stages: ${hits.map(h => h.stage).join(', ')}`);
  if (!hits.length) die(`no wallpaper "${slug}" under ${WALL} (${STAGES.join(', ')})`);
  const { stage, dir } = hits[0];
  return { slug, stage, dir, pkg: path.join(dir, 'package'), mk: path.join(dir, 'making-of') };
}
function needPkg(w) { if (!fs.existsSync(path.join(w.pkg, 'project.json'))) die(`${rel(w.pkg)} has no project.json`); return w; }
function config(w) { const f = path.join(w.mk, 'wl.json'); try { return readJson(f); } catch (e) { if (fs.existsSync(f)) die('bad ' + f + ': ' + e.message); return {}; } }
function installFolder(w) { return config(w).installFolder || DEFAULTS.installFolders[w.slug] || `${w.slug}-wallpaper-lab`; }
const urlFor = w => { const p = path.relative(REPO, w.pkg).replace(/\\/g, '/'); return p.startsWith('..') ? '(wallpapers root is outside the repo: serve that folder yourself)' : `http://127.0.0.1:8861/${p}/index.html`; };

// ---------- running other programs
function runPlain(argv, opts = {}) {
  return new Promise(ok => { const p = cp.spawn(argv[0], argv.slice(1), { stdio: 'inherit', cwd: opts.cwd || REPO }); p.on('error', e => { console.error(e.message); ok(1); }); p.on('close', c => ok(c ?? 1)); });
}
// GPU work: python docs/tools/gpu_lock.py --timeout 10 -- <cmd>; if the lock times out, run without it (never queue). WL_NOLOCK=1 skips the lock.
async function runGpu(argv) {
  if (process.env.WL_NOLOCK) return runPlain(argv);
  const lock = path.join(REPO, 'docs/tools/gpu_lock.py');
  const r = await new Promise(ok => {
    let seen = '';
    const p = cp.spawn('python', [lock, '--timeout', '10', '--', ...argv], { cwd: REPO, stdio: ['inherit', 'pipe', 'pipe'] });
    p.stdout.on('data', d => { seen += d; process.stdout.write(d); }); p.stderr.on('data', d => { seen += d; process.stderr.write(d); });
    p.on('error', e => ok({ code: 1, seen: String(e) })); p.on('close', c => ok({ code: c ?? 1, seen }));
  });
  if (r.code !== 0 && /timeout waiting for the GPU lock/.test(r.seen) && !/acquired after/.test(r.seen)) {
    console.log('[wl] GPU lock busy for 10 s: running without the lock');
    return runPlain(argv);
  }
  return r.code;
}

// ---------- status
function cmdStatus() {
  const myprojects = path.join(WE, 'projects', 'myprojects'), weThere = fs.existsSync(WE);
  const rows = [];
  for (const stage of STAGES) {
    const sd = path.join(WALL, stage); if (!fs.existsSync(sd)) continue;
    for (const e of fs.readdirSync(sd, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const w = { slug: e.name, stage, dir: path.join(sd, e.name), pkg: path.join(sd, e.name, 'package'), mk: path.join(sd, e.name, 'making-of') };
      const pj = path.join(w.pkg, 'project.json'); if (!fs.existsSync(pj)) continue;
      let proj = {}; try { proj = readJson(pj); } catch {}
      const props = (proj.general && proj.general.properties) || {};
      const sliders = Object.values(props).filter(p => p && p.type === 'slider').length;
      let folder = installFolder(w), copy = '-';
      if (weThere) copy = fs.existsSync(path.join(myprojects, folder)) ? 'yes' : 'no';
      rows.push([w.slug, stage, MB(dirSize(w.pkg)).toFixed(1), fs.existsSync(w.mk) ? MB(dirSize(w.mk)).toFixed(1) : '-', String(sliders), String(proj.workshopid || '-'), copy]);
    }
  }
  const head = ['slug', 'stage', 'package MB', 'making-of MB', 'sliders', 'workshop id', 'in WE myprojects'];
  const all = [head, ...rows], w = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  for (const r of all) console.log(r.map((c, i) => /MB|sliders/.test(head[i]) && r !== head ? c.padStart(w[i]) : c.padEnd(w[i])).join('  ').trimEnd());
  if (!weThere) console.log(`\n(Wallpaper Engine not found at ${WE}; last column not checked)`);
  else if (!fs.existsSync(myprojects)) console.log('\n(<WE>/projects/myprojects does not exist; "wl install" creates it)');
}

// ---------- new
function copyDir(a, b) { fs.mkdirSync(b, { recursive: true }); for (const e of fs.readdirSync(a, { withFileTypes: true })) { const s = path.join(a, e.name), d = path.join(b, e.name); e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }
function cmdNew(pos, opt) {
  const slug = pos[0];
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('usage: wl new <slug> [--title "Name"]   (slug: lower-case letters, digits, dashes)');
  for (const s of STAGES) if (fs.existsSync(path.join(WALL, s, slug))) die(`"${slug}" already exists in ${s}`);
  const title = typeof opt.title === 'string' ? opt.title : slug.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
  const dir = path.join(WALL, 'in-progress', slug), pkg = path.join(dir, 'package');
  copyDir(path.join(KIT, 'skeleton'), pkg);
  const pjf = path.join(pkg, 'project.json'), pj = readJson(pjf);
  pj.title = title; pj.description = '';
  fs.writeFileSync(pjf, JSON.stringify(pj, null, 2) + '\n');
  const ih = path.join(pkg, 'index.html');
  fs.writeFileSync(ih, fs.readFileSync(ih, 'utf8').replace('<title>Skeleton</title>', `<title>${title.replace(/[<&]/g, '')}</title>`));
  fs.mkdirSync(path.join(dir, 'making-of'), { recursive: true });
  const w = { slug, dir, pkg };
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${title}\n\nOne line on what it is.\n\n![preview](package/preview.jpg)\n\n## Controls\n\n| Control | Default | What it does |\n| --- | --- | --- |\n| Motion | 50 | 0 = still. |\n| Glow | 50 | 0 = off. |\n| Render scale | 100 | Percent of screen resolution. |\n\nBrightness, contrast and colour are in Wallpaper Engine's own colour options.\n\n## How it was built\n\nTo write.\n\n## Run it\n\n- **Wallpaper Engine:** Create Wallpaper, then open \`package/project.json\`.\n- **Browser:** \`./wl serve\`, then open ${urlFor(w)}.\n- **Zip:** \`./wl package ${slug} <version>\` writes \`exports/${slug}-<version>.zip\`.\n\n## Credits and licences\n\nTo write. Personal, non-commercial project.\n\n## Known flaws\n\n- None recorded yet.\n`);
  fs.writeFileSync(path.join(dir, 'NOTES.md'), `# ${title}: working notes\n\nLocal working-notes file for this wallpaper (not part of the published package); the public summary is [README.md](README.md). An optional local release checklist may exist at wallpapers/RELEASE-CHECKLIST.md. Tools: \`./wl --help\`.\n\n## Where it stands (${new Date().toISOString().slice(0, 10)})\n\n- Started from the kit skeleton with \`wl new ${slug}\`. Nothing tuned yet.\n\n## Checks\n\n- \`./wl verify ${slug}\`\n\n## How the code works\n\nTo write.\n\n## History\n\nTo write.\n`);
  console.log(`created ${rel(dir)}\n  package/   skeleton copy, title "${title}"\n  README.md, NOTES.md, making-of/\nopen: ${urlFor(w)}   (start the server with: wl serve)`);
}

// ---------- serve
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.cjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.glsl': 'text/plain', '.frag': 'text/plain', '.vert': 'text/plain' };
function cmdServe(pos) {
  const port = Number(pos[0] || 8861);
  if (!Number.isInteger(port) || port < 1 || port > 65535) die('bad port');
  const server = http.createServer((req, res) => {
    let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    let f = path.join(REPO, p);
    if (path.relative(REPO, f).startsWith('..')) { res.writeHead(403).end(); return; }
    try {
      if (fs.statSync(f).isDirectory()) { if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }).end(); return; }
        // No index.html: send a python http.server style listing (the gallery page reads these).
        if (!fs.existsSync(path.join(f, 'index.html'))) {
          const li = fs.readdirSync(f, { withFileTypes: true }).map(e => { const n = e.name + (e.isDirectory() ? '/' : ''); return `<li><a href="${encodeURIComponent(e.name)}${e.isDirectory() ? '/' : ''}">${n.replace(/[<&]/g, '')}</a></li>`; }).join('\n');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(`<!doctype html><title>Directory listing for ${p.replace(/[<&]/g, '')}</title><ul>\n${li}\n</ul>`); return;
        }
        f = path.join(f, 'index.html'); }
      const st = fs.statSync(f), type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        const a = m[1] ? +m[1] : st.size - +m[2], b = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
        fs.createReadStream(f, { start: a, end: b }).pipe(res);
      } else { res.writeHead(200, { ...headers, 'Content-Length': st.size }); if (req.method === 'HEAD') res.end(); else fs.createReadStream(f).pipe(res); }
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); }
  });
  server.on('error', e => die(e.code === 'EADDRINUSE' ? `port ${port} is already in use (maybe another chat's server: use that one, or pick another port: wl serve ${port + 1})` : e.message));
  server.listen(port, '127.0.0.1', () => {
    console.log(`serving ${REPO} on http://127.0.0.1:${port}/ (no-store caching; Ctrl+C to stop)`);
    console.log(`gallery:       http://127.0.0.1:${port}/docs/tools/gallery/`);
    console.log(`one wallpaper: http://127.0.0.1:${port}/wallpapers/<stage>/<slug>/package/index.html`);
  });
}

// ---------- verify / gif
async function cmdVerify(pos, raw) {
  const w = needPkg(find(pos[0]));
  const extra = raw.slice(raw.indexOf(pos[0]) + 1);
  process.exitCode = await runGpu(['node', path.join(KIT, 'verify.cjs'), w.pkg, ...extra]);
}
async function cmdGif(pos, raw) {
  const w = needPkg(find(pos[0]));
  let extra = raw.slice(raw.indexOf(pos[0]) + 1), out;
  if (extra[0] && !extra[0].startsWith('--')) out = path.resolve(extra.shift());
  else { out = path.join(w.mk, 'checks', 'preview-gif', 'preview.gif'); fs.mkdirSync(path.dirname(out), { recursive: true }); console.log('[wl] output ' + rel(out) + ' (move it to package/preview.gif when chosen)'); }
  process.exitCode = await runGpu(['node', path.join(REPO, 'docs/tools/make_preview_gif.cjs'), w.pkg, out, ...extra]);
}

// ---------- package
async function cmdPackage(pos) {
  const w = needPkg(find(pos[0])), version = pos[1];
  if (!version) die('usage: wl package <slug> <version>');
  const zname = `exports/${w.slug}-${version}.zip`, zip = path.join(EXPORTS, `${w.slug}-${version}.zip`);
  const json = path.join(w.mk, 'checks', `release-${version}.json`);
  const code = await runPlain(['python', '-I', path.join(__dirname, 'wl_package.py'), w.pkg, zip, json, version, zname]);
  if (code) process.exitCode = code; else console.log('zip:       ' + zip + '\nchecksums: ' + json);
}

// ---------- media (worker runs in a child process, under the GPU lock)
function cmdMedia(pos, opt) {
  const w = needPkg(find(pos[0])), mode = pos[1], cfg = config(w).media || {};
  if (!['record', 'stills', 'thumb'].includes(mode)) die('usage: wl media <slug> record|stills|thumb [--out path] [--w N] [--h N] [--seconds N] [--t0 N] [--times 5,15,30] [--time N] [--version V]\n  one mode per command; run record first, on its own');
  const version = opt.version || String(config(w).version || readJson(path.join(w.pkg, 'project.json')).version || 'dev');
  const dir = path.join(EXPORTS, `${w.slug}-${version}-media`);
  const n = (k, d) => opt[k] !== undefined ? Number(opt[k]) : d;
  const job = { mode, pkg: w.pkg, slug: w.slug, props: cfg.props || {}, seekJs: cfg.seekJs, resumeJs: cfg.resumeJs, initJs: cfg.initJs,
    w: n('w', mode === 'record' ? 2560 : mode === 'thumb' ? 1280 : 1920), h: n('h', mode === 'record' ? 1440 : mode === 'thumb' ? 720 : 1080),
    seconds: n('seconds', cfg.seconds || 24), t0: n('t0', cfg.t0 || 0), times: String(opt.times || (cfg.stillTimes || [5, 15, 30]).join(',')).split(',').map(Number),
    time: n('time', cfg.thumbTime || 20),
    out: path.resolve(typeof opt.out === 'string' ? opt.out : mode === 'record' ? path.join(dir, `${w.slug}-showcase.mp4`) : mode === 'thumb' ? path.join(dir, `${w.slug}-thumbnail.png`) : path.join(dir, 'stills')) };
  return runGpu(['node', __filename, '__media', JSON.stringify(job)]).then(c => { process.exitCode = c; });
}
async function mediaWorker(job) {
  const { chromium } = require(PW);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const ffmpeg = fs.existsSync(FFMPEG) ? FFMPEG : 'ffmpeg';
  try {
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h } });
    const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await page.goto('file:///' + path.join(job.pkg, 'index.html').replace(/\\/g, '/'));
    await page.waitForFunction(() => !window.wallpaperDiagnostics || window.wallpaperDiagnostics.state.ready, {}, { timeout: 30000 })
      .catch(e => { throw Error('scene did not start: ' + (errors.join('; ') || e.message)); });
    await page.waitForTimeout(900); // the skeleton fades the canvas in over 0.6 s
    if (job.initJs) await page.evaluate(job.initJs);
    const props = Object.fromEntries(Object.entries(job.props).map(([k, v]) => [k, typeof v === 'object' ? v : { value: v }]));
    if (Object.keys(props).length) await page.evaluate(p => window.wallpaperPropertyListener.applyUserProperties(p), props);
    const hasSeek = await page.evaluate(([c]) => !!c || typeof (window.wallpaperTest && window.wallpaperTest.seek) === 'function', [job.seekJs]);
    const seek = (t) => page.evaluate(([t, js]) => new Promise(r => { if (js) new Function('t', js)(t); else window.wallpaperTest.seek(t); requestAnimationFrame(() => requestAnimationFrame(r)); }), [t, job.seekJs]);
    const resume = () => page.evaluate(js => { if (js) new Function(js)(); else if (window.wallpaperTest && window.wallpaperTest.resume) window.wallpaperTest.resume(); }, job.resumeJs);
    const toAt = async t => { if (hasSeek) await seek(t); else await page.waitForTimeout(Math.min(t, 10) * 1000); };
    if (!hasSeek) console.log('[wl] page has no wallpaperTest.seek and wl.json media.seekJs is not set: times are real-time waits (max 10 s), not exact scene times');
    if (errors.length) throw Error('page errors: ' + errors.join('; '));

    if (job.mode === 'stills') {
      fs.mkdirSync(job.out, { recursive: true });
      for (const t of job.times) {
        await toAt(t);
        const f = path.join(job.out, `${job.slug}-${job.w}x${job.h}-t${String(t).padStart(2, '0')}.jpg`);
        fs.writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 92 })); console.log('wrote', f);
      }
    } else if (job.mode === 'thumb') {
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      await toAt(job.time); fs.writeFileSync(job.out, await page.screenshot({ type: 'png' })); console.log('wrote', job.out);
    } else {
      // Real-time MediaRecorder on the live canvas at WE's 30 FPS in 1 s chunks, then one x264 pass with short fades (optional local release checklist, section 3).
      fs.mkdirSync(path.dirname(job.out), { recursive: true });
      const raw = job.out.replace(/\.mp4$/, '') + '.raw.webm', fd = fs.openSync(raw, 'w');
      await page.exposeFunction('saveChunk', b64 => { fs.writeSync(fd, Buffer.from(b64, 'base64')); });
      if (hasSeek && job.t0) await seek(job.t0);
      const t1 = Date.now();
      const mime = await page.evaluate(async ([sec, resumeJs]) => {
        window.wallpaperPropertyListener.applyGeneralProperties({ fps: 30 });
        if (resumeJs) new Function(resumeJs)(); else if (window.wallpaperTest && window.wallpaperTest.resume) window.wallpaperTest.resume();
        const canvases = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height);
        const mime = ['video/webm;codecs=h264', 'video/webm;codecs=vp9'].find(m => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(canvases[0].captureStream(30), { mimeType: mime, videoBitsPerSecond: 60e6 });
        let chain = Promise.resolve();
        rec.ondataavailable = e => { chain = chain.then(() => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(window.saveChunk(fr.result.split(',')[1])); fr.readAsDataURL(e.data); })); };
        const stopped = new Promise(r => rec.onstop = r);
        rec.start(1000); await new Promise(r => setTimeout(r, sec * 1000 + 300)); rec.stop(); await stopped; await chain;
        return mime;
      }, [job.seconds, job.resumeJs]);
      fs.closeSync(fd); console.log('recorded', mime, ((Date.now() - t1) / 1000).toFixed(1) + ' s');
      const code = await new Promise(ok => cp.spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-t', String(job.seconds), '-r', '30',
        '-vf', `fade=t=in:st=0:d=0.6,fade=t=out:st=${Math.max(0, job.seconds - 1)}:d=1`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', job.out], { stdio: 'inherit' }).on('close', ok));
      if (code) throw Error('ffmpeg exit ' + code);
      fs.unlinkSync(raw); console.log('wrote', job.out, MB(fs.statSync(job.out).size) + ' MB');
    }
    if (errors.length) console.log('page errors during run: ' + errors.join('; '));
  } finally { await browser.close(); }
}

// ---------- install (first run 2026-11-08, Summer Crossing)
async function weCommand(args) { return new Promise((ok, no) => cp.execFile(WE + '/wallpaper32.exe', args, { windowsHide: true, timeout: 15000 }, (e, out, err) => e ? no(e) : ok({ out, err }))); }
const baseTitle = t => String(t || '').split(/\s[-\u2013\u2014]\s/)[0].trim();
async function cmdInstall(pos, opt) {
  const w = needPkg(find(pos[0]));
  if (!fs.existsSync(WE)) die('Wallpaper Engine not found at ' + WE);
  const target = path.join(WE, 'projects', 'myprojects', installFolder(w)), backup = path.join(w.mk, 'checks', 'host', 'installed-backup');
  const files = walkFiles(w.pkg), pjNew = readJson(path.join(w.pkg, 'project.json'));
  const exists = fs.existsSync(target);
  if (exists) {
    const pjf = path.join(target, 'project.json');
    if (!fs.existsSync(pjf) && fs.readdirSync(target).length && !opt.force) die(target + ' exists without a project.json; not touching it (--force to override)');
    if (fs.existsSync(pjf)) {
      const old = readJson(pjf);
      if (baseTitle(old.title) !== baseTitle(pjNew.title) && !opt.force) die(`installed project is "${old.title}", package is "${pjNew.title}": wrong folder? (--force to override)`);
      if (old.workshopid && !pjNew.workshopid) console.log(`[wl] warning: the installed project has workshopid ${old.workshopid} but package/project.json does not. Installing would drop it; copy it into the repo copy first (optional local release checklist, section 6).`);
    }
  }
  const present = exists ? walkFiles(target) : [], gone = present.filter(f => !files.includes(f));
  console.log(`${exists ? 'update' : 'create'} ${target}\n  ${files.length} files from ${rel(w.pkg)}; ${gone.length} installed file(s) the package no longer has${gone.length ? ' (moved to ' + rel(backup) + ')' : ''}`);
  if (opt['dry-run']) { console.log('dry run: nothing written'); return; }
  fs.mkdirSync(target, { recursive: true }); // myprojects may be gone after publishing
  if (exists && !fs.existsSync(backup)) { for (const f of present) { const d = path.join(backup, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(target, f), d); } }
  for (const f of gone) { const d = path.join(backup, 'removed', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(target, f), d); fs.unlinkSync(path.join(target, f)); }
  for (const f of files) { const d = path.join(target, f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(w.pkg, f), d); }
  const rows = files.map(f => ({ file: f, match: sha(path.join(w.pkg, f)) === sha(path.join(target, f)) }));
  let reload = 'not applied: desktop wallpaper unchanged (pass --apply to open it on Monitor0)';
  if (opt.apply) try { await weCommand(['-control', 'openWallpaper', '-file', path.join(target, 'project.json').replace(/\//g, '\\'), '-monitor', '0']); reload = 'openWallpaper sent for Monitor0'; } catch (e) { reload = 'cli error: ' + e.message.split('\n')[0]; }
  const report = { installedTo: target, fresh: !exists, removedFromInstall: gone, files: rows.length, allMatch: rows.every(r => r.match), mismatches: rows.filter(r => !r.match).map(r => r.file), reload };
  fs.mkdirSync(path.join(w.mk, 'checks', 'host'), { recursive: true });
  fs.writeFileSync(path.join(w.mk, 'checks', 'host', 'install.json'), JSON.stringify({ at: new Date().toISOString(), ...report }, null, 1));
  console.log(JSON.stringify(report)); if (!report.allMatch) process.exitCode = 1;
}

// ---------- probe (first run 2026-11-08, Summer Crossing: passed once the capture stats were read from the capture's own sample)
// Generic host probe: a copy of package/ in its own WE window with an injected script that counts draw frames, wraps the property listener,
// pauses at 4 s, resumes at 9 s, grabs the canvas at 12 s (forcing preserveDrawingBuffer on the copy only) and checks it is not black.
function probeScript(port) {
  return `(()=>{const W={frameId:0,lastDraw:-1,frames:0,errors:[],glErrors:[],ctx:[],calls:{user:[],general:[],paused:[]}};
addEventListener('error',e=>W.errors.push(String(e.message)));addEventListener('unhandledrejection',e=>W.errors.push(String(e.reason)));
const raf=window.requestAnimationFrame.bind(window);(function loop(){W.frameId++;raf(loop)})();
const mark=function(){if(W.lastDraw!==W.frameId){W.lastDraw=W.frameId;W.frames++}};
for(const [C,names] of [[window.WebGLRenderingContext,['drawArrays','drawElements']],[window.WebGL2RenderingContext,['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements']],[window.CanvasRenderingContext2D,['drawImage','fillRect','putImageData','fill','stroke','fillText']]])
 if(C)for(const n of names){const f=C.prototype[n];if(typeof f==='function')C.prototype[n]=function(){mark();return f.apply(this,arguments)}}
const gc=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,a){if(/webgl/.test(t))a=Object.assign({},a,{preserveDrawingBuffer:true});const c=gc.call(this,t,a);if(c&&/webgl/.test(t)&&!W.ctx.includes(c))W.ctx.push(c);return c};
let L;const wrap=()=>{if(!L)return;const w=(n,f)=>{if(typeof L[n]==='function'&&!L[n].__wl){const o=L[n];const g=function(p){f(p);return o.apply(this,arguments)};g.__wl=1;L[n]=g}};
 w('applyUserProperties',p=>W.calls.user.push(Object.keys(p||{}).join(',')));w('applyGeneralProperties',p=>W.calls.general.push('fps:'+((p&&p.fps)??'-')));w('setPaused',v=>W.calls.paused.push(v))};
Object.defineProperty(window,'wallpaperPropertyListener',{configurable:true,get(){return L},set(v){L=v;wrap()}});setInterval(wrap,50);
const t0=performance.now();let phase='running';
const big=()=>[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
function stats(c){try{const s=document.createElement('canvas');s.width=s.height=32;const x=s.getContext('2d');x.drawImage(c,0,0,32,32);const d=x.getImageData(0,0,32,32).data;let sum=0,lit=0;for(let i=0;i<d.length;i+=4){const l=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2];sum+=l;if(l>8)lit++}return{meanLuma:+(sum/1024).toFixed(2),litFraction:+(lit/1024).toFixed(3)}}catch(e){return{error:String(e)}}}
function send(cap){const c=big();for(const g of W.ctx){try{let e;while((e=g.getError())&&!W.glErrors.includes(e))W.glErrors.push(e)}catch(_){}}
 const b={phase,t:performance.now()-t0,frames:W.frames,calls:W.calls,errors:W.errors,glErrors:W.glErrors,host:navigator.userAgent,viewport:[innerWidth,innerHeight],canvas:c?[c.width,c.height]:null,diag:window.wallpaperDiagnostics?window.wallpaperDiagnostics.state:undefined};
 if(cap&&c){b.capture=c.toDataURL('image/png');b.captureStats=stats(c)}
 fetch('http://127.0.0.1:${port}/p',{method:'POST',body:JSON.stringify(b)}).catch(()=>{})}
setInterval(()=>send(false),500);
setTimeout(()=>{send(false);phase='paused';L&&L.setPaused&&L.setPaused(true)},4000);
setTimeout(()=>{send(false);phase='resumed';L&&L.setPaused&&L.setPaused(false)},9000);
setTimeout(()=>send(true),12000);})();`;
}
async function cmdProbe(pos) {
  const w = needPkg(find(pos[0]));
  if (!fs.existsSync(WE)) die('Wallpaper Engine not found at ' + WE);
  const outDir = path.join(w.mk, 'checks', 'host'), probe = path.join(outDir, 'host-probe'), title = `${readJson(path.join(w.pkg, 'project.json')).title} - isolated check`;
  fs.mkdirSync(outDir, { recursive: true }); fs.rmSync(probe, { recursive: true, force: true }); fs.rmSync(path.join(outDir, 'native-capture.png'), { force: true });
  copyDir(w.pkg, probe);
  const rows = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') { res.end(); return; }
    let text = ''; req.on('data', x => text += x);
    req.on('end', () => { try { const d = JSON.parse(text); if (d.capture) { fs.writeFileSync(path.join(outDir, 'native-capture.png'), Buffer.from(d.capture.split(',')[1], 'base64')); delete d.capture; } rows.push(d); res.end('ok'); } catch { res.writeHead(400).end(); } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(probe, 'probe.js'), probeScript(server.address().port));
  const idx = path.join(probe, 'index.html'); let html = fs.readFileSync(idx, 'utf8');
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + '<script src="probe.js"></script>') : '<script src="probe.js"></script>' + html;
  fs.writeFileSync(idx, html);
  let launched = false;
  try {
    await weCommand(['-control', 'openWallpaper', '-file', path.join(probe, 'project.json'), '-playInWindow', title, '-width', '1920', '-height', '1080']); launched = true;
    for (let waited = 0; waited < 45000 && !fs.existsSync(path.join(outDir, 'native-capture.png')); waited += 500) await sleep(500);
    await sleep(1000);
  } finally {
    if (launched) await weCommand(['-control', 'closeWallpaper', '-location', title]).catch(() => {});
    await new Promise(r => server.close(r)); fs.rmSync(probe, { recursive: true, force: true });
  }
  const phase = p => rows.filter(r => r.phase === p), run = phase('running'), paused = phase('paused'), resumed = phase('resumed'), last = rows.at(-1) || {};
  const fps = run.length > 2 ? (run.at(-1).frames - run[0].frames) / ((run.at(-1).t - run[0].t) / 1000) : null;
  const s = { checkedAt: new Date().toISOString(), samples: rows.length, host: rows[0]?.host, viewport: rows[0]?.viewport, canvas: rows[0]?.canvas,
    userPropertyCalls: last.calls?.user, generalCalls: last.calls?.general, pausedCalls: last.calls?.paused, measuredFPS: fps && +fps.toFixed(1),
    pauseStable: paused.length >= 3 && paused.slice(1).every(r => r.frames === paused[1].frames),
    resumeAdvances: resumed.length >= 2 && resumed.at(-1).frames > (paused.at(-1)?.frames ?? Infinity),
    errors: [...new Set(rows.flatMap(r => r.errors || []))], glErrors: [...new Set(rows.flatMap(r => r.glErrors || []))],
    capture: fs.existsSync(path.join(outDir, 'native-capture.png')) ? rel(path.join(outDir, 'native-capture.png')) : null, captureStats: (rows.filter(r => r.captureStats).at(-1) || {}).captureStats,   // the capture's own sample: samples keep coming after it
    limits: 'Windowed probe copy (preserveDrawingBuffer forced on its WebGL contexts), not the installed desktop copy. Run under gpu_lock; open the capture yourself.' };
  s.pass = s.samples >= 10 && (s.userPropertyCalls || []).length >= 1 && s.pauseStable && s.resumeAdvances && s.errors.length === 0 && s.glErrors.length === 0 && !!s.capture && (s.captureStats?.meanLuma ?? 0) > 2;
  fs.writeFileSync(path.join(outDir, 'native-verification.json'), JSON.stringify({ ...s, rows }, null, 1));
  console.log(JSON.stringify(s)); if (!s.pass) process.exitCode = 1;
}

// ---------- main
const HELP = `wl: shared toolkit for Wallpaper Engine web wallpapers (details: tools/README.md)

  wl status                              every wallpaper with a package: stage, sizes, sliders, Workshop id, WE copy
  wl new <slug> [--title "Name"]         start a wallpaper from the kit skeleton in wallpapers/in-progress/<slug>/
  wl serve [port]                        serve the repo root on 127.0.0.1 (default 8861)
  wl verify <slug> [kit args]            docs/tools/web-wallpaper-kit/verify.cjs on package/
  wl gif <slug> [out.gif] [args]         docs/tools/make_preview_gif.cjs on package/ (default out: making-of/checks/preview-gif/preview.gif)
  wl package <slug> <version>            exports/<slug>-<version>.zip from package/ only, plus making-of/checks/release-<version>.json
  wl media <slug> record|stills|thumb    showcase video (real-time record), JPEG stills, 1280x720 thumbnail -> exports/<slug>-<version>-media/
  wl install <slug> [--dry-run] [--apply] [--force]
                                         Copy package/ into <WE>/projects/myprojects/<install folder>, SHA-256 check
  wl probe <slug>                        Windowed Wallpaper Engine host probe of a copy of package/

<slug> is found in whichever stage folder holds it. Env: WL_ROOT (wallpapers root), WL_EXPORTS, WL_WE, WL_NOLOCK=1.
GPU commands (verify, gif, media, probe) take the GPU lock for 10 s at most, then run without it.`;

(async () => {
  const raw = process.argv.slice(2), cmd = raw[0], rest = raw.slice(1);
  if (cmd === '__media') return mediaWorker(JSON.parse(raw[1]));
  if (cmd === '__probe') return cmdProbe([raw[1]]);
  const { pos, opt } = parseArgs(rest);
  switch (cmd) {
    case 'status': return cmdStatus();
    case 'new': return cmdNew(pos, opt);
    case 'serve': return cmdServe(pos);
    case 'verify': return cmdVerify(pos, rest);
    case 'gif': return cmdGif(pos, rest);
    case 'package': return cmdPackage(pos);
    case 'media': return cmdMedia(pos, opt);
    case 'install': return cmdInstall(pos, opt);
    case 'probe': return probeGpu(pos);
    case undefined: case 'help': case '--help': case '-h': return console.log(HELP);
    default: console.error(`wl: unknown command "${cmd}"\n`); console.log(HELP); process.exitCode = 1;
  }
})().catch(e => { console.error(e.stack || e); process.exit(1); });
function probeGpu(pos) { return runGpu(['node', __filename, '__probe', pos[0]]); }

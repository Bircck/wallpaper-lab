# Runtime skeleton for a web wallpaper

`./wl new <slug>` starts from `docs/tools/web-wallpaper-kit/skeleton/` (index.html, main.js, project.json, art.jpg, preview.jpg). It runs and passes `docs/tools/web-wallpaper-kit/verify.cjs` (1.3 ms synced frame at 1080p headless). Copy the folder, then replace the art, the shader and the sliders. The rules below come from the published wallpapers, Opaline 1.1 (`wallpapers/published/opaline/`) in particular.

## Folder

```
<slug>/                 self-contained; this exact folder is what WE loads (open its project.json in WE)
  project.json          type "web", file "index.html", preview "preview.jpg" (or .gif)
  index.html            CSS background = average colour of the art; one <canvas>; <script src="main.js">
  main.js               all runtime code; no panel, no keyboard shortcuts, no <select>
  *.jpg|png|webp        plain image files next to index.html (no base64 in JS, no ../ paths)
  README.md             (docs; keep it out of the package zip)
```

No CDN and no network: vendor any library (e.g. `three.module.min.js`) into the folder. `fetch()` of local JSON fails on file:// outside WE, so put data in JS or in images. Tuning panels go on a separate lab page outside `wallpapers/` that loads main.js and drives `wallpaperPropertyListener`.

## project.json

- 2-4 sliders, `"min":0,"max":100,"fraction":false`, default 50 = the tuned look, 0 = that effect off. Labels are just the name: `"Glow"`.
- One `renderscale` slider, 35-100, default 100.
- Never re-use a key with a new meaning: WE replays saved values per key. Rename the key instead.
- No `combo` unless needed. If you need one, the page must never build a `<select>` (it crashed WE); use cycling buttons in labs only.

## main.js contract

1. **Settings map.** `fromSlider[key](0..100)` gives internal units. Apply every key on `applyUserProperties`, call `draw()` once (so a frozen scene still shows the change), then call `schedule()`.
2. **FPS.** `applyGeneralProperties({fps})` sets `settings.fps`. The limiter in `tick(now)` is:
   ```js
   acc += dt; pending += dt;                       // dt from rAF timestamps, capped at 0.1 s
   if (acc + 1e-4 >= interval) {
     acc = Math.max(0, acc - interval);            // SUBTRACT, never acc % interval
     if (acc > interval) acc = 0;                  // no catch-up bursts after a stall
     time += pending * speed; pending = 0; draw();
   }
   raf = requestAnimationFrame(tick);
   ```
   Animate by elapsed time, not by frame count, so 10 FPS and 30 FPS move at the same speed.
3. **Stopping.** `stopped() = hostPaused || document.hidden || contextLost || !ready || frozen()`. `schedule()` cancels rAF and only requests a new one when not stopped, and `tick` returns without re-requesting when stopped. `setPaused(p)` sets `hostPaused` and calls `schedule()`. `frozen()` is true when every motion slider is 0. Then no rAF runs at all (verify reports `pausedRafPerS` and `sliderAtMin.<key>.rafPerS`).
4. **Fade-in.** `body{background:#avg}` and `canvas{opacity:0;transition:opacity .6s}`. Add `.on` after the first real draw. A WebGL `alpha:false` canvas is black until then. If WebGL or the art fails, hide the canvas and put the still art on `body` as a background (`fail()`).
5. **Resolution.** `w = innerWidth * min(devicePixelRatio, 2) * renderScale`, then cap the area at 3840x2160 and at `MAX_TEXTURE_SIZE`. Resize on `resize`. Use `antialias:false, depth:false, stencil:false, powerPreference:'low-power'`.
5b. **Shader cost: use explicit-LOD fetches.** In a big fragment shader with `if (mask > 0.) { ...texture2D... }` blocks, ANGLE/D3D can run every branch for every pixel (sampling with implicit derivatives is not allowed in non-uniform flow). Rain Lantern Alley went from 2.6 ms to 7.8 ms at 1080p, and the cost no longer fell when sliders went to 0. Fix: `gl.getExtension('EXT_shader_texture_lod')`, `#extension GL_EXT_shader_texture_lod : enable`, and `texture2DLodEXT(s, uv, 0.)` through one macro (fall back to `texture2D` when the extension is missing). Fine when no texture uses mip-maps. All sliders at 0 then cost 0.7 ms.
6. **Ultrawide.** Cover-fit the art, never stretch it. Crop around a focal point, and clamp the crop centre (not the sample coordinate) so the window stays inside the art. With 16:9 art, a 3440x1440 screen shows only the middle 74% of its height. With 21:9 art, 1920x1080 shows only the middle 74% of its width. Keep the subject and every moving part inside that safe area. Effects anchored to the art (water lines, lamps) must use art-space coordinates, not screen uv. Check both rows of the contact sheet.
7. **Context loss.** On `webglcontextlost` call `preventDefault()`, mark lost and call `schedule()`. On `webglcontextrestored` call `setup()` again.
8. **Test hooks (keep them in, they are inert in WE).** `window.wallpaperDiagnostics.state` returns `{ready, frames, time, paused, ...}`, and `window.wallpaperTest.seek(t)` freezes at scene time t and draws once (`resume()` undoes it). verify.cjs works without them but saves `seek_t12_1920x1080.png` when they exist.

## Before hand-off

`node docs/tools/web-wallpaper-kit/verify.cjs wallpapers/in-progress/<slug>` must print `"pass":true`. Read its `warn` list. Look at `contact.png`, because passing checks do not mean it looks good. Stay within the budgets: at most about 8 ms per synced frame at 1080p headless, and the file-size and GPU-memory limits in [headless-and-host-verification.md](../headless-and-host-verification.md).

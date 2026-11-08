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

Load art as plain image files next to `index.html`. WE lets WebGL use local images; base64 in JS adds a third to the size and a second copy of the art. Only plain Chrome on file:// blocks the loads, so headless checks pass `--allow-file-access-from-files`. Open a wallpaper in WE through its `project.json`: importing only `index.html` makes WE generate new metadata and the custom controls are lost. Keep one copy of each file and nothing unused (audit with [audit_assets.cjs](audit_assets.cjs)).

## project.json

- A few sliders (2-6; fewer is better), `"min":0,"max":100,"fraction":false`, default 50 = the tuned look, 0 = that effect off (motion: still). Labels are just the name, `"Glow"`, with no ranges or units in the text. Variants and many knobs belong in lab pages, not the release.
- A slider named for motion ("Waves") must scale every motion path. Measure the mean frame change per second at 0, 50 and 100, because a secondary effect that ignores the slider gets noticed. For an event-frequency slider, 0 = only the manual hook and 50 = the tuned pace; measure the real intervals over ten minutes of scene time.
- Do not add sliders that duplicate WE's own Brightness/Contrast/Saturation/Hue. WE applies those as a CSS filter on the page (`saturate()` and so on, saved as `wec_*` in its `config.json`). To bake in a look reached with them, use the same maths in the shader (a fixed saturation constant).
- One `renderscale` slider, 35-100, default 100.
- Never re-use a key with a new meaning or scale. WE saves slider values per key under `wproperties` in `<WE>/config.json` (keyed by the project path) and replays them into the new build; an old speed of 1 on a 0.1-3 scale would mean "nearly still" on 0-100. Rename the key instead.
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
   Animate by elapsed time, not by frame count, so 10 FPS and 30 FPS move at the same speed. WE rounds timestamps to 0.1 ms, so a sum of 0.0999999 s passes the tolerance; with `acc % interval` the remainder then triggers a second draw on the next frame (Opaline drew 11-16 FPS at a setting of 10 and 30.3-32 at 30; subtracting gives 30.0). Measure FPS with the page's own `performance.now()`, not the runner's wait.
3. **Stopping.** `stopped() = hostPaused || document.hidden || contextLost || !ready || frozen()`. `schedule()` cancels rAF and only requests a new one when not stopped, and `tick` returns without re-requesting when stopped. `setPaused(p)` sets `hostPaused` and calls `schedule()`. `frozen()` is true when every motion slider is 0. Then no rAF runs at all (verify reports `pausedRafPerS` and `sliderAtMin.<key>.rafPerS`).
4. **Fade-in.** `body{background:#avg}` and `canvas{opacity:0;transition:opacity .6s}`. Add `.on` after the first real draw. A WebGL `alpha:false` canvas is black until then, and a raw-art still under a cropped or displaced shader jumps when the canvas appears, so fade the canvas in rather than swapping. If WebGL or the art fails, hide the canvas and put the still art on `body` as a background (`fail()`).
   For a big fragment shader (WE's browser keeps no compiled-shader cache, so it compiles cold at every start) also show a poster `<img>` of the opening frame first, load the script after the poster has painted, and queue WE's property calls until it runs, then replay them. Make uniforms that never change in the release (debug views, legacy modes, fixed saturation) GLSL `const`s: Luminous Streams' compile fell from 3.4 s to 1.1 s with pixels differing by at most 1 level on under 0.004% of the image. Time it in a fresh browser per run, since a warm one hides it. More in [shrinking-a-finished-webgl-wallpaper](../../approaches/shrinking-a-finished-webgl-wallpaper.md).
5. **Resolution.** `w = innerWidth * min(devicePixelRatio, 2) * renderScale`, then cap the area at 3840x2160 and at `MAX_TEXTURE_SIZE`. Resize on `resize`. Use `antialias:false, depth:false, stencil:false, powerPreference:'low-power'`.
5b. **Shader cost: use explicit-LOD fetches.** In a big fragment shader with `if (mask > 0.) { ...texture2D... }` blocks, ANGLE/D3D can run every branch for every pixel (sampling with implicit derivatives is not allowed in non-uniform flow). Rain Lantern Alley went from 2.6 ms to 7.8 ms at 1080p, and the cost no longer fell when sliders went to 0. Fix: `gl.getExtension('EXT_shader_texture_lod')`, `#extension GL_EXT_shader_texture_lod : enable`, and `texture2DLodEXT(s, uv, 0.)` through one macro (fall back to `texture2D` when the extension is missing). Fine when no texture uses mip-maps. All sliders at 0 then cost 0.7 ms.
6. **Ultrawide.** Cover-fit the art, never stretch it. Crop around a focal point, and clamp the crop centre (not the sample coordinate) so the window stays inside the art. For a tall painting on a wide screen, put the window as low as it can go with the subject's top still in, and decide which events need which part of the picture so they can give way when it is cut off (at 32:9 only about 940 art px of height fit). With 16:9 art, a 3440x1440 screen shows only the middle 74% of its height. With 21:9 art, 1920x1080 shows only the middle 74% of its width. Keep the subject and every moving part inside that safe area. Effects anchored to the art (water lines, lamps) must use art-space coordinates, not screen uv. Check both rows of the contact sheet.
7. **Context loss.** On `webglcontextlost` call `preventDefault()`, mark lost and call `schedule()`. On `webglcontextrestored` call `setup()` again.
8. **Test hooks (keep them in, they are inert in WE).** `window.wallpaperDiagnostics.state` returns `{ready, frames, time, paused, ...}`, and `window.wallpaperTest.seek(t)` freezes at scene time t and draws once (`resume()` undoes it). verify.cjs works without them but saves `seek_t12_1920x1080.png` when they exist, and [audit_assets.cjs](audit_assets.cjs) needs `seek`.
   - Make the event schedule a pure function of scene time, so `seek` and pause are exact. Useful extras: `play(kind)` to force an event, a way to read its state, and a `textures` map for audits.
   - For exact frames, apply the sliders right after `seek(0)`: a slider move rescales events still to come, and seeking back rebuilds the timetable.
   - A frequency slider must never make anything jump: keep a piecewise clock per slider-driven motion so the integral of speed stays continuous, and let an event that has begun finish when the setting changes.
9. **Texture units.** WebGL2 guarantees only 16 per fragment shader. A scene with sky, sea, plants, road and trains used all 16, and every new sampler needed another merged away. Plan the sampler budget up front and delete rejected-look textures before adding new ones.

## Budgets

Numbers used to accept builds on a GTX 1070 Ti at 1080p and 30 FPS (headless, an upper bound):

- Synced frame (`verify.cjs`) 4 ms, warn at 8 ms (about 2.4x at 3440x1440). The GPU-timer figure from [gpu_cost.cjs](gpu_cost.cjs) is lower and the one to trust (see [headless-and-host-verification.md](../headless-and-host-verification.md)). Main thread 2 ms (limit 4).
- About 4 full-screen passes and 12 texture reads per output pixel. First draw 1.5 s or less. Folder under 60 MB (the Workshop wants about 15 MB), GPU textures about 256 MB.
- Noise and fbm at half or quarter resolution into an FBO, sampled bilinearly. Blur and bloom as a 1/2, 1/4, 1/8 downsample chain with a small separable kernel. At most about 20k point sprites (overdraw matters more than count). Bake static layers once and draw only the movers.
- Reference costs: skeleton 1.2-1.4 ms, Opaline 2.5 ms, typical layered painting scenes 0.7-2 ms.

## Before hand-off

`node docs/tools/web-wallpaper-kit/verify.cjs wallpapers/in-progress/<slug>` must print `"pass":true`. Read its `warn` list. Look at `contact.png`, because passing checks do not mean it looks good. Stay within the budgets above and the file-size and GPU-memory limits in [headless-and-host-verification.md](../headless-and-host-verification.md).

Also check:
- The look at shader time 1000 and 10000, not only at the start. Blending before a sine or before advection accumulates spatial frequency and shows as tight scanlines only after long uptime (reproduced and fixed once).
- Every slider at 0, 50 and 100 (slider audit in the headless page), and no slider left that does nothing.
- `audit_assets.cjs` for dead files and `gpu_cost.cjs` for the frame cost. `verify.cjs` warns about a missing render-scale slider; that is expected for a scene that deliberately has none (Sunroom).
- Timings taken while other jobs share the GPU are not comparable: the same build read 1.7-3 ms on a quiet card and 8-18 ms under load. Repeat timing runs on a quiet machine; the hard checks (errors, FPS, pause) are not affected.

Release steps after this: [releasing-a-wallpaper.md](../../approaches/releasing-a-wallpaper.md).

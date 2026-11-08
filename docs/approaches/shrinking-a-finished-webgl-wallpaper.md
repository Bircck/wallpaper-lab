# Shrinking a finished WebGL wallpaper

Status: worked ([Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md)), with one failed step listed below. The look stayed the same while GPU memory and startup nearly halved. Do this after the art is final, because it bakes layers together.

## What to aim for

The Wallpaper Engine "Read first" post with the rules for the Showcase ("Approved") tag: https://steamcommunity.com/app/431960/discussions/9/1697221160904462132/

- Scenes: 256 MB of GPU memory or less. Stats warn at 400 MB, and 512 MB is the absolute maximum. Files under about 15 MB, and over 100 MB is likely rejected. At least 1920x1080, and it must move when idle.
- Web wallpapers: low CPU, and they must work at 16:9, 4:3 and 21:9 without stretching or cutting off significant content.
- All: no text in the wallpaper, an accurate title, suitable for all audiences.

Use these as targets even when not submitting.

## Result

Headless Chrome, D3D11, GTX 1070 Ti test machine, 30 FPS. Same frames apart from thin edges against the sky.

| | Before | After |
|---|---|---|
| GPU memory, 1080p | 406 MB | 218 MB |
| GPU memory, 1440p | 453 MB | 259 MB |
| Files | 15.3 MB | 8.1 MB |
| Startup (shader link) | 6.1 s (5.3 s) | 3.6 s (3.0 s) |
| GPU per frame, 1080p | 3.3-4.2 ms | 2.5-2.8 ms |

CPU did not measurably change. See "Measuring" for why a single reading says nothing.

## What worked

**Textures** (done by a packing script):

- Find what is loaded but never drawn, and drop it. `plants.png`, an older cut, was still being loaded. "Bound" is not "drawn", and "drawn" is not "visible": Luminous Streams' `light.png` (727 KB) was bound every frame and changed 0% of pixels, and it shipped anyway. [`audit_assets.cjs`](../tools/web-wallpaper-kit/audit_assets.cjs) runs both tests: it records which image files are uploaded and bound during draws over an hour of scene time at the default sliders and at 100 on every slider, then swaps each file for a flat grey image and counts changed pixels at several scene times next to the noise of two identical renders. Moon Cat 1.0 dropped from 30 to 18 MB and about 90 MB of GPU memory this way. Run it before the first release, because removing a file later costs a re-publish.
- Merge data maps into few RGBA maps, keeping only the channels the shader reads (five files became `map-a`, `map-b` and `masks`).
- Crop to the rectangle in use. The seabed needs only the rows with water, the sky only the rows above the horizon, the cloth and vest only their own boxes. Align crops to 16 px so mipmaps stay on the same grid.
- Flatten layers that are only ever seen one way. Inside regions where a moving piece covers the plate, only the clean plate is ever seen, so one plate is enough.
- Bake the un-mix: above the horizon, store the foreground already un-mixed from the painted sky, with its colour pushed out over the sky pixels. Mipmaps then can't pull old sky back into leaf edges.
- Upload one-channel maps as R8: `gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img)`. Pixel-exact cuts beyond R8 (Summer Crossing, 287 to 217 MB total GPU process at 1080p and 412 to 342 MB at 4K, frames equal to within 2 levels from texture-coordinate rounding):
  - Two-channel maps (sea and grass masks stored as R and G) go up as RG8.
  - A colour+alpha atlas can be stored as one opaque image (premultiplied colour on top, alpha below, so the browser's alpha handling cannot change values) and split on the GPU into an RGBA8 texture and an R8 texture with `copyTexSubImage2D` from a temporary texture. Cut the art to the rows actually used (the top 480 of 941 art rows for clouds, trains and the far band).
  - Masks used in one region (sky matte above the horizon, land masks below, a signal matte in a small box) are exact crops of one big mask file, uploaded R8 or RG8.
  - An empty WebGL page alone costs about 130-210 MB at 4K, so 256 MB cannot hold there.
- Lazy-load art that is only drawn in rare states. The sharp paint of a fast train is only visible under 14 art px of blur (slow train speed or a very high FPS), so it loads the first time that state is reached. The cost is that the first slow pass after a slider change can show the blurred paint for one frame; list that as a known limit.
- Texture memory with 2x layers: RGBA8 is width x height x 4 bytes, times 4/3 for mipmapped layers above 1672 px. A 2x painted scene measured 296 MB against 96 MB at 1x.
- A lossy WebP re-pack moves pixels well outside a small edit, a few by up to 10 levels. To see what a bake changed, compare the source PNGs, then let a same-frame screen diff judge the result.
- Skip mipmaps on maps that are always read at level 0.
- Encode RGB layers with sharp (`webp({quality: 95, smartSubsample: true, effort: 6})`). PIL has no smart subsampling and gave frame-wide noise. Use lossless with `exact` where colour under alpha 0 matters.

**Context:** `{ antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false }`. Check nothing reads the canvas outside the task that drew it.

**Shader compile.** CEF keeps no shader cache, so the link runs at every start. D3D's compiler inlines every function and unrolls loops, so the size of the expanded code is what costs time.

- Measure first. Remove one effect at a time and time the link in a fresh context. On this scene, frost alone was 3.7 of 5.2 s, while the water everyone would have blamed was about 1.1 s.
- Fold repeated calls into a loop, so only one inlined copy is compiled.
- Start loops from a `uniform int` that is never set (always 0). The compiler can't unroll them then.
- Make uniforms that never change into GLSL `const`, and delete debug views and old variants. The compiler then drops those paths. On Luminous Streams (debug views, legacy modes, fixed saturation) the compile fell from 3.4 s to 1.1 s and the scene was ready at 1.8 s instead of 4.1 s, with pixels differing by at most 1 level on under 0.004%.
- Paint a poster `<img>` of the opening frame first and load the script only after the poster has painted (WE's calls are queued and replayed), then fade the canvas in after its first frame. [TEMPLATE.md](../tools/web-wallpaper-kit/TEMPLATE.md) has the contract.
- Plan the sampler budget: WebGL2 guarantees only 16 texture units per fragment shader, and one backdrop pass with sky, sea, plants, road and trains hit exactly 16. Merge two plates into one texture, and delete the textures of a rejected look before adding new ones.
- `WEBGL_debug_shaders` shows the HLSL it actually gets.

**Per frame:** set slider uniforms only when a slider or the size changed. Per frame, set only the clocks.

**Two-stage start (the biggest single gain).** A start-up breakdown per phase showed three things run one after the other: shader compile, then images, then the plant shaders. Cutting one effect at a time out of the shader showed that frost (1.4 s), cola (0.6 s) and cold vapour (0.3 s) were 2.3 of the 3 s compile, though they only touch two small spots.

- Compile with `KHR_parallel_shader_compile`: no status queries until `COMPLETION_STATUS_KHR` is true, polled on a timer. Frames keep running during the compile (longest gap 50 ms).
- Draw first with a copy of the shader that lacks those effects, made by a string replace on the same source, then swap to the full one when it is ready. Every frame after the swap comes from the same shader as before, so the frame diff stays at 0.
- Hold the poster over the left-out spots until the full shader draws them, then fade it out over 0.7 s. Choose spots where little moves, and keep moving things live on top. Effects over water can't work this way, because a frozen patch of water shows; keep those in the quick shader.
- Start the full compile after the quick one finishes. Starting both at once slowed both (first frame 1.7 s, full 4.6 s, against 1.5 s and 4.2 s).
- Upload each image as it arrives instead of after the compile (first frame 1.5 s to 1.2 s). `img.decode()` alone didn't shorten the upload.
- Tools that compare frames must wait for the full shader and drop the poster: `study.live` means something draws, `study.ready` means the full shader is in place, and `demo.seek` drops the poster.
- Without the extension it falls back to one blocking compile, as before.
- Wallpaper Engine's browser (Chrome 146) has the extension. In a WE window over two runs, the first moving frame came at 1.4-1.7 s and all effects at 4.7-6.3 s, slower and less steady than headless Chrome at 1.2 s and 4.1 s. In the run that timed it, the longest gap once frames were moving was 20 ms. Check the host before quoting a Chrome number.

**Then split the effects out (better than the two-stage start).** ANGLE links separate small programs in parallel. "Both at once is slower" was only true of two copies of the huge shader. Frost and vapour link in about 1.0 s and cola in about 0.35 s, next to about 0.95 s for the base shader without them, so all of it arrives with the first frame: all effects 4.3 s -> 1.2 s, and 1.2-1.5 s in WE. Each effect copies its small canvas rectangle with `copyTexSubImage2D`, reads that as its start colour and draws back with a scissor, about 3% cheaper per frame than the big shader. They now start from the 8-bit colour the base wrote, so frames aren't bit-identical: at most 13 pixels change by more than 3 levels at default settings. The poster hold stays as the fallback if an effect is late.

Also gained in that round:
- Frame cost: remove one thing at a time to find the cost. The caustic web was 1.2 of 2.3 ms, and skipping it where its fade is 0 saved 12% (`fwidth` has to stay outside the branch). A faster hash table, pruning the cell search and a constant table were all slower or no gain.
- Compare frame cost only with builds taken in turn. Single readings of one build ranged from 2.9 to 7.8 ms.
- Memory: the plants layer only needs the rows plants can reach, which took 1440p from 259 to 254 MB.
- Stress-test new start-up code at every stage, not only the normal path (slider, pause, resize, context loss, failed link, missing file). That found the unhandled context loss.

Result: first moving frame 3.6 s to 1.2 s. The full effects come slightly later, 3.5 s to about 4.1 s, because the base compile runs twice.

## What failed

**One loop for two call sites of a loop-heavy function.** Frost calls its crystal code for the ground and the shaft. Folding both into one loop, so the compiler keeps one copy, made the compile slower (full shader ready at 5.1 s instead of 4.2 s), with the frames unchanged. This fold helped earlier on simple repeated calls, so measure it each time.

**Moving texture reads out of branches.** A `texture()` read inside an `if` stops D3D from really branching, so `textureGrad` with gradients worked out at the top of `main` should let it skip water maths on non-water pixels. Measured: compile got slower (3.1 to 3.5 s), frame time did not improve, and about 90K pixels changed, because the caustic web's anti-aliasing width comes from `fwidth` of warped coordinates, which a gradient taken before the warp can't reproduce. Dropped.

## Measuring

- Frame cost: use the GPU's own timer ([`gpu_cost.cjs`](../tools/web-wallpaper-kit/gpu_cost.cjs)). A synced readback overstates it several times over (Sunroom: 1.3-4.6 ms by readback, 0.56 ms by timer, 0.23 ms on a quiet card).
- First frame: on the first 2x-layer audit, 6.5 s of first frame was 5.6 s of synchronous shader link plus 0.9 s of texture fetch, decode and upload. Split the two before optimising either.
- GPU memory: the Windows counter `\GPU Process Memory(pid_*)\Dedicated Usage`. Numbers from it were stable across runs.
- CPU: very noisy. The same build read 0.5% and 7.1% of one core. Never compare single readings, and alternate builds.
- Frames: a frame-diff script renders both builds at the same seek times and slider values, at each aspect ratio and every slider at 0 and 100. A build against itself gave 0, so any difference is real. A separate perf report covers the rest.
- Run long GPU tests with a hard time limit and send output to a file. A compile-timing test once hung while holding the GPU lock (cause not found), and piping it through `grep` hid that it had printed nothing.
- A full slider sweep can find old bugs. Here it showed that Wind = 0 used to swap the vest and hat for softer painted versions.

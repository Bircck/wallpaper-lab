# Tools that worked

How to run each tool this repo has actually used: where it lives, the exact command, inputs and outputs, and the pitfalls found the hard way. Anything marked "uncertain" was not confirmed from the repo. Techniques (as opposed to tools) are in [../approaches/](../approaches/README.md).

For day-to-day work use the [`wl` command](../../tools/README.md) (new, serve, verify, gif, package, media): it runs the kit, checker and GIF maker below for you.

- [cutout-segmenters.md](cutout-segmenters.md): Finegrain Box Segmenter, SAM2 / SAM2.1-L, HQ-SAM2, BiRefNet, ViTMatte, pymatting; which to use per object and where to get each model, and an example cut recipe.
- [python-environments.md](python-environments.md): how to rebuild the CPU venv and the GPU venv (PyTorch cu126 for the Pascal GTX 1070 Ti), the optional upscaler venv, sizes, GPU lock.
- [codex-image-generation.md](codex-image-generation.md): `codex exec` image generation and edits for concepts, clean plates, props, seabed and sky; prompt shape and scripts.
- [upscalers.md](upscalers.md): 4x-UltraSharp, Remacri and RealESRGAN anime 6B via spandrel, where to get the weights.
- [preview-server.md](preview-server.md): `wl serve` or `python -m http.server 8861`, the browser texture-cache problem and the localhost-only `?v=<time>` fix.
- [gallery/](gallery/index.html): one page with every wallpaper and a full-window live player. It reads `wallpapers/<stage>/<slug>/` and each `package/project.json`, so there is nothing to update when a wallpaper moves or ships. It needs directory listings, so serve the repo root with `./wl serve` (or `python -m http.server 8861 --bind 127.0.0.1`) and open `http://127.0.0.1:8861/docs/tools/gallery/`. Only `package/`, `project.json` and `README.md` are read, so it works on a fresh clone.
- [headless-and-host-verification.md](headless-and-host-verification.md): Playwright/Chrome checks, installing into and probing the Wallpaper Engine host .
- [make_preview_gif.cjs](make_preview_gif.cjs): `node docs/tools/make_preview_gif.cjs <package-dir> <out.gif> [--props '{...}'] [--timewarp 20] [--crop cx,cy,h]` records any web package in headless Chrome (MediaRecorder on the canvas, or a CDP screencast for DOM/multi-canvas scenes), speeds it up (`--timewarp` runs the page clock k times faster in small steps, so even scenes with capped speed sliders move fast), crossfades the loop and writes a Workshop preview GIF under 1 MB plus a frame strip. Prints loop seam and motion scores. One way to make preview GIFs, not the only one: see [workshop-preview-gifs](../approaches/workshop-preview-gifs.md).
- [web-wallpaper-kit/](web-wallpaper-kit/TEMPLATE.md): runtime skeleton and rules for a web wallpaper, plus `node docs/tools/web-wallpaper-kit/verify.cjs <wallpaper-folder>`, the headless GPU checker (errors, network, FPS 30/10, pause, frame cost, 1080p and 3440x1440 frames; output in a `checks/verify/` folder next to the package).
- [gpu_lock.py](gpu_lock.py): `python docs/tools/gpu_lock.py -- <command>` runs a GPU job while holding a machine-wide lock, so parallel jobs share the 8 GB card one at a time.
- [blender.md](blender.md): Blender 5.2.2 headless use, the blockout/ID pipeline, toon car loop, and what was rejected.
- [image-to-3d.md](image-to-3d.md): TripoSR (MIT) locally, one painting -> mesh in about 15 s; the transformers 5 key rename, the mesh frame, and why the other image-to-3D models were not used. First used for a small crab character.

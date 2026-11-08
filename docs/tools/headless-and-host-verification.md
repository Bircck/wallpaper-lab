# Headless verification and Wallpaper Engine host install/verify

Two layers of checking: a headless Chrome run driven by Playwright (fast, repeatable, an upper bound for performance), and a probe run inside the real Wallpaper Engine (WE) host in a small window. Both are wrapped by the [`wl` command](../../tools/README.md) (`wl verify`, `wl install`, `wl probe`); this page records what they check, how they run and what they do not cover.

**Status of the host commands.** `wl verify` is the tested path. `wl install` and `wl probe` were derived from the per-wallpaper `host.cjs` and `install_we.py` scripts that were actually used for the releases, and were not themselves run against Wallpaper Engine on the development PC (the install script was only tried on a throwaway folder). Treat them as a starting point: dry-run first, and read the output of the first real run.

## Paths and requirements

| Thing | Default | Override |
|---|---|---|
| Playwright (node module) | the Codex runtime's copy under `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`; there is no `node_modules` in the repo | `WL_PLAYWRIGHT` |
| Node | system `node` on PATH (v22 when checked) | - |
| Chrome | `C:/Program Files/Google/Chrome/Application/chrome.exe` | `WL_CHROME` |
| ffmpeg (GIF and video) | the `imageio_ffmpeg` binary in the Python 3.13 site-packages, else `ffmpeg` on PATH | `WL_FFMPEG` |
| Wallpaper Engine | the standard Steam install (`.../steamapps/common/wallpaper_engine`, `wallpaper32.exe`) | `WL_WE` |

Launch flags used for GL on the GTX 1070 Ti: `headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']`.

## Headless runs

```
./wl verify <slug> [--quick]
node docs/tools/web-wallpaper-kit/verify.cjs wallpapers/<stage>/<slug>      # the same checker, directly
```

`verify.cjs` loads the package from `file://` in headless Chrome with a real GPU and wraps WebGL/2D draw calls and `requestAnimationFrame`, so a "frame" is an animation frame in which the page issued at least one draw call. It reports:

| Check | Meaning |
|---|---|
| Console errors, non-local requests | Must be zero. A wallpaper may not use the network. |
| FPS 30 and 10 | `applyGeneralProperties({fps})` at 30 and 10; frames counted over a few seconds. |
| Pause | `setPaused(true)` gives 0 frames and no animation-frame requests; resume advances. |
| Sliders at 0 | Motion sliders at minimum should stop rendering entirely (`sliderAtMin.<key>.rafPerS`). |
| Frame cost | ms per frame (render plus 1 px synchronous readback) at 1080p and 3440x1440. Warns above 8 ms at 1080p. The readback overstates the GPU's work; see "Cost sampling". |
| Frames | Paused 1080p and 3440x1440 frames at fixed scene times, and a contact sheet. Look at it: passing checks do not mean it looks good. |

If the page exposes `window.wallpaperDiagnostics.state` and `window.wallpaperTest.seek(t)` (see [TEMPLATE.md](web-wallpaper-kit/TEMPLATE.md)) the checker uses them to pause, seek and screenshot deterministically. A new wallpaper needs similar hooks.

Results to expect from a healthy wallpaper: 0 console errors, 0 non-local requests, FPS 10 gives about a third of the frames of FPS 30, paused gives 0 frames, a few ms per frame at 1080p headless. **Headless timings are an upper bound and not a Wallpaper Engine measurement.**

Targets worth aiming for, from the Workshop's approval notes: about 256 MB GPU memory, files of roughly 15 MB or less, and a layout that works at 16:9, 4:3 and 21:9. They apply even if you never submit.

## WE host: install and probe

```
./wl install <slug> --dry-run        # show what would be copied
./wl install <slug>                  # copy package/ into <WE>/projects/myprojects/<install folder>, SHA-256 check
./wl install <slug> --apply          # also open it on Monitor0
./wl probe <slug>                    # windowed host probe of a copy
```

Only install when you want it on your desktop, and do not pop windows on the desktop to test things. Scripts and agents never publish to the Workshop or touch a Workshop item; publishing is a person's step in the WE editor ([releasing-a-wallpaper](../approaches/releasing-a-wallpaper.md)).

- `install` keeps the existing project folder name (see `tools/wl-defaults.json`) so WE keeps the same project and its saved slider values, backs up an existing install once, and compares SHA-256 of every file. Without `--apply` it does not change the desktop wallpaper.
- `probe` copies the package, injects a probe script before `</body>`, starts a local HTTP listener for telemetry and opens a uniquely titled 1920x1080 window with
  ```
  wallpaper32.exe -control openWallpaper -file <probe>/project.json -playInWindow "<title>" -width 1920 -height 1080
  wallpaper32.exe -control closeWallpaper -location "<title>"
  ```
  It checks that properties arrive, frames are counted, pause at 4 s is stable and resume advances, there are no GL errors, and a capture at 12 s exists. Output: `native-verification.json` and `native-capture.png`.

**Open the capture every time.** A "pass" only asks that the file exists. One release's capture was all black, because the probe patched a context line that had since changed and the page set `preserveDrawingBuffer: false`. Make the pass rule check for non-black content, and look at the image anyway.

What a healthy probe looked like for a four-train, plants, sea and sky scene in WE's Chrome 146: all properties arrived, 30.4 FPS, pause held, 0 GL errors.

### Cost sampling

- **GPU frame cost: use the card's own timer.** [`gpu_cost.cjs`](web-wallpaper-kit/gpu_cost.cjs) wraps the page's real animation frames in `EXT_disjoint_timer_query` (Chrome flags `--enable-privileged-webgl-extensions --enable-webgl-draft-extensions`), one real frame per rAF, and takes the median over several rounds. For Sunroom at 1080p the synced 1 px readback read 1.3-4.6 ms where the timer said 0.56 ms (0.23 ms on a quiet card).
- Whole-card `nvidia-smi` utilisation swings 2-25% with nothing changed and is unusable while other jobs run. In the host, the summed CPU-time delta of the `webwallpaper64` processes (the CEF processes that render web wallpapers) is steadier (Opaline: about 5% of one core at 30 FPS). Alternate builds when comparing.
- **Another GPU job spoils every reading.** With a competing job holding 7.4-7.8 of 8 GB GPU memory or 100% load, the host probe returned `samples: 0` with no error, headless frame cost read 50-121 ms instead of 1.6, and the same build measured 7 ms against 1.7 ms. Run GPU checks under [`gpu_lock.py`](gpu_lock.py) (`--timeout 10`, then without it if the lock stays busy), treat a sudden zero or huge frame time as contention before blaming the build, and do not read a difference as a speed-up unless the builds were measured in turn on a quiet machine.
- The desktop wallpaper is often paused (WE pauses when an app is maximised or fullscreen), so desktop samples can read as idle. Use a windowed run for A/B comparisons. A user's saved slider values and pause settings (`playbackmaximized`, `playbackfullscreen`, `fps`) are in `<WE>/config.json`.
- Parallel builders: `verify.cjs` needs no server, so any number can run. Serialise only the timing phase with a lock file (stale after 90 s), give each builder its own output folder and preview port, and let one agent own each shared file. Use `--quick` (about 25 s) while iterating and the full run (about 45 s) before hand-off. Parallel Chrome instances make first-draw and capture timings noisy.

### What the host check does not cover

- It is a windowed probe copy, not the installed copy on the desktop, and not sustained profiling on the target display.
- Automatic game/fullscreen pause was never verified.
- `-control applyProperties` (live property change from the CLI) returned a CLI error for both the window title and the project path, so live apply remains unverified. Properties are checked by calling the listener directly in headless runs.
- A person should still look at the wallpaper in WE before release: the project has several pages in the WE UI.

## Slider and scene audits

A slider audit that worked: for each slider at 0, 50 and 100, render the same frame at fixed times and report the share of pixels whose RGB sum moves by more than 6 against the slider-at-50 frame.

- 0 should be off or still, but expect residual edge motion (about 1-4k pixels at 1080p for wind and plant sway), so "still" is a threshold, not zero. A scene with every slider at 0 must stop drawing; the `frozen()` check has to include every slider that still moves something (swaying trees once kept a scene drawing at 30 FPS).
- Project keys equal mapped keys, and defaults equal the slider-50 mapping.
- Invalid input (null, strings, NaN, Infinity, bare numbers, unknown old keys) is ignored, out-of-range values clamp, and a partial callback changes only its own key.
- A framing slider that clamps its focus to `[0.5*IA/A, 1-0.5*IA/A]` moves the picture by under one source pixel at 16:9 and only matters on wider screens.
- Look at long uptime as well: render at shader time 1000 and 10000. Blending before a sine accumulates spatial frequency and shows as scanlines only late.
- Package against lab parity: same frames to within 2 levels at 16:9, 21:9 and 4:3 (1920x1080, 2560x1080, 1440x1080), nine moments including every event type, sliders all 0 and all 100.
- Hash-pinned manifest assertions in check scripts go stale after every art change; hash the current files at the start and re-check at the end instead. Debug query-parameter hooks left in the shipped script are harmless in WE but should be listed or removed at release.
- Dead assets: [`audit_assets.cjs`](web-wallpaper-kit/audit_assets.cjs) (bound/drawn and flat-swap tests; see [shrinking-a-finished-webgl-wallpaper](../approaches/shrinking-a-finished-webgl-wallpaper.md)).

## Pitfalls

- Never use `<select>` in WE controls (it crashed the renderer).
- WE saves slider values per property key under `wproperties` in `<WE>/config.json`, keyed by the project path, and replays them into a new build. Read that file first to see what is saved. If a slider's scale or meaning changes, rename its key.
- WE applies Brightness/Contrast/Saturation/Hue as a CSS filter on the page (stored as `wec_*` in `config.json`). To bake in a look reached with them, use the same maths in the shader; do not ship a duplicate slider.
- Before deleting a test project folder, switch the monitor to another project: WE can restore the old selection after a restart and the desktop goes black (check `selectedwallpapers` in `config.json`). After deleting a published project's local copy, restart WE or its library keeps a ghost tile.
- Load a wallpaper by opening its `project.json`; importing only `index.html` loses the custom controls.
- A wallpaper can reload itself in WE with `location.reload()`, but WE sends no properties to the reloaded page, so carry the settings across (one wallpaper uses `window.name`). With a `#hash` set on the URL first, the same reload did nothing.
- Screenshots of canvases need `preserveDrawingBuffer` or a paused frame; `verify.cjs` pauses first and renders its frames at a fixed scene time.
- A parity check against a snapshot of an approved look is useful after refactors: render both with new effects off at the same times; the diff should be 0 px.
- Serve over HTTP for anything that `fetch()`es local JSON ([preview-server](preview-server.md)); `file://` fails outside WE.

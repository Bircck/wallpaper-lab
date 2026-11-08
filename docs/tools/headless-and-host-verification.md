# Headless verification and Wallpaper Engine host install/verify

Two layers of checking: a headless Chrome run driven by Playwright (fast, repeatable, an upper bound for performance), and a probe run inside the real Wallpaper Engine (WE) host in a small window. Both are wrapped by the [`wl` command](../../tools/README.md) (`wl verify`, `wl install`, `wl probe`); this page records what they check, how they run and what they do not cover.

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
| Frame cost | ms per frame (render plus 1 px synchronous readback) at 1080p and 3440x1440. Warns above 8 ms at 1080p. |
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

Only install when you want it on your desktop. Never publish to the Workshop or touch a Workshop item from a script.

- `install` keeps the existing project folder name (see `tools/wl-defaults.json`) so WE keeps the same project and its saved slider values, backs up an existing install once, and compares SHA-256 of every file. Without `--apply` it does not change the desktop wallpaper.
- `probe` copies the package, injects a probe script before `</body>`, starts a local HTTP listener for telemetry and opens a uniquely titled 1920x1080 window with
  ```
  wallpaper32.exe -control openWallpaper -file <probe>/project.json -playInWindow "<title>" -width 1920 -height 1080
  wallpaper32.exe -control closeWallpaper -location "<title>"
  ```
  It checks that properties arrive, frames are counted, pause at 4 s is stable and resume advances, there are no GL errors, and a capture at 12 s is not black. Output: `native-verification.json` and `native-capture.png` (open it yourself).

Cost sampling (not in `wl`): nvidia-smi whole-GPU utilisation once a second, plus the CPU-time delta of the `webwallpaper64` processes (the CEF processes that render web wallpapers). The GPU number is noisy, so alternate builds. A user's saved slider values and pause settings (`playbackmaximized`, `playbackfullscreen`, `fps`) are in `<WE>/config.json`.

### What the host check does not cover

- It is a windowed probe copy, not the installed copy on the desktop, and not sustained profiling on the target display.
- Automatic game/fullscreen pause was never verified.
- `-control applyProperties` (live property change from the CLI) returned a CLI error for both the window title and the project path, so live apply remains unverified. Properties are checked by calling the listener directly in headless runs.
- A person should still look at the wallpaper in WE before release: the project has several pages in the WE UI.

## Pitfalls

- Never use `<select>` in WE controls (it crashed the renderer).
- A wallpaper can reload itself in WE with `location.reload()`, but WE sends no properties to the reloaded page, so carry the settings across (one wallpaper uses `window.name`). With a `#hash` set on the URL first, the same reload did nothing.
- Screenshots of canvases need `preserveDrawingBuffer` or a paused frame; `verify.cjs` pauses first and renders its frames at a fixed scene time.
- A parity check against a snapshot of an approved look is useful after refactors: render both with new effects off at the same times; the diff should be 0 px.
- Serve over HTTP for anything that `fetch()`es local JSON ([preview-server](preview-server.md)); `file://` fails outside WE.

# tools/wl

One command-line tool for starting and releasing a Wallpaper Engine web wallpaper, so nobody copies `verify.cjs`, `package.py` and friends into each new wallpaper.

Run it from the repo root: `./wl <command>` in Git Bash, `.\wl <command>` in PowerShell or cmd (those two don't search the current folder for plain `wl`; put the repo root on PATH to type `wl`). It is `tools/wl.cjs`, plain Node, using default Playwright, Chrome and ffmpeg locations for Windows that you can override with environment variables (see below).

A `<slug>` is looked up in `wallpapers/in-progress`, `ready-to-publish`, `published` and `ideas`, so you never type the stage.

## Commands

| Command | What it does | Example |
| --- | --- | --- |
| `status` | One table of every wallpaper with a `package/`: stage, package MB, making-of MB, slider count, Workshop id, and whether `<WE>/projects/myprojects` holds a copy. Read-only. (`making-of/` is a local working folder next to each package; it is not part of the public repo, so its size shows 0 on a fresh clone.) | `./wl status` |
| `new <slug> [--title]` | Copies the kit skeleton to `wallpapers/in-progress/<slug>/package/`, sets the title, writes a `README.md` stub, a local working-notes `NOTES.md` stub and an empty `making-of/` working folder. Refuses if the slug exists in any stage. | `./wl new misty-pier --title "Misty Pier"` |
| `serve [port]` | Static server for the repo root on 127.0.0.1, default 8861, no caching. Prints the gallery and wallpaper URLs. If the port is taken it stops and says so (it never kills anything). | `./wl serve` |
| `verify <slug> [args]` | Runs `docs/tools/web-wallpaper-kit/verify.cjs` on `package/`. Extra args go to it. Output lands in `making-of/checks/verify/`. | `./wl verify misty-pier --quick` |
| `gif <slug> [out.gif] [args]` | Runs `docs/tools/make_preview_gif.cjs` on `package/`. Default output is `making-of/checks/preview-gif/preview.gif`. | `./wl gif misty-pier --speedup 3` |
| `package <slug> <version>` | Zips `package/` only (sub-folders included) to `exports/<slug>-<version>.zip` and writes `making-of/checks/release-<version>.json` with sizes and SHA-256, in a simple JSON format. | `./wl package sunroom 1.0` |
| `media <slug> record\|stills\|thumb` | `record`: 2560x1440, 30 FPS, 24 s real-time canvas recording, one x264 pass with fades (never frame-by-frame). `stills`: 1920x1080 JPEGs at the given times. `thumb`: 1280x720 PNG. Output in `exports/<slug>-<version>-media/`. Options: `--out --w --h --seconds --t0 --times 5,15,30 --time 20 --version`. Run `record` first and as its own command. | `./wl media misty-pier record --seconds 20` |
| `install <slug> [--dry-run] [--apply] [--force]` | Copies `package/` into `<WE>/projects/myprojects/<install folder>`, creating `myprojects` if it is gone, backs up an existing install once to `making-of/checks/host/installed-backup/`, moves files the package no longer has into that backup, then SHA-256-checks every file. `--apply` also opens it on Monitor0; without it the desktop is left alone. | `./wl install sunroom --dry-run` |
| `probe <slug>` | Opens a copy of `package/` in its own 1920x1080 Wallpaper Engine window with an injected probe: properties arrive, frames counted, pause at 4 s and resume at 9 s, GL errors, and a capture at 12 s that must not be black. Writes `making-of/checks/host/native-verification.json` and `native-capture.png` (open it). | `./wl probe sunroom` |

GPU work (`verify`, `gif`, `media`, `probe`) runs under `docs/tools/gpu_lock.py --timeout 10`; if the lock is still busy after 10 s it runs without it (`wallpapers/RELEASE-CHECKLIST.md` section 3, an optional local checklist). `WL_NOLOCK=1` skips the lock.

## Notes

`wl` GPU commands take the GPU lock themselves, so don't wrap them in `gpu_lock.py`. `install` and `probe` were derived from per-wallpaper `host.cjs` / `install_we.py` scripts; `probe` counts draw calls and forces `preserveDrawingBuffer` on the copy's WebGL contexts. `media` with `wl.json` options has had little use outside the skeleton.

## Config it reads

- `tools/wl-defaults.json`: the install folder names that already exist (living-print `living-suwa-wallpaper-lab`, straw-hat-cove `straw-hat-a1-live-wallpaper-lab`, the rest `<slug>-wallpaper-lab`). Keep them so WE keeps the project and its saved slider values.
- `<wallpaper>/making-of/wl.json`, optional:

```json
{
  "installFolder": "my-name-wallpaper-lab",
  "version": "1.0",
  "media": {
    "props": { "motion": 50, "plant": { "value": 2 } },
    "t0": 0, "seconds": 24, "stillTimes": [5, 15, 30], "thumbTime": 20,
    "seekJs": "window.seek(t)", "resumeJs": "", "initJs": ""
  }
}
```

  `media.props` are applied through `wallpaperPropertyListener.applyUserProperties` before recording. By default `media` moves scene time with `window.wallpaperTest.seek(t)` / `resume()` (the skeleton's hooks). Set `seekJs` (function body using `t`) for another hook.

- Environment: `WL_ROOT` (wallpapers folder, default `wallpapers/`; exports then go to `<WL_ROOT>/../exports`), `WL_EXPORTS`, `WL_WE` (Wallpaper Engine folder), `WL_PLAYWRIGHT`, `WL_CHROME`, `WL_FFMPEG`, `WL_NOLOCK`.

## What does not generalise

- Some wallpapers rewrite `wallpaper.js` on the fly in their own capture scripts to get a `seek(t)`, and one GIF mode bends sines into seamless loops. A wallpaper without `wallpaperTest.seek` gets real-time waits (up to 10 s) for stills instead of exact scene times; give it a hook or `seekJs`.
- Event-driven scenes may need their own hooks for stills, and exact-loop GIF code is per-wallpaper. Seamless GIFs stay per-wallpaper (`wl gif` is the quick real-time version).
- Per-wallpaper cost measurement (GPU utilisation and CPU time of the Wallpaper Engine web renderer) is not in `wl`.

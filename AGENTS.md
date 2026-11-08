# Working on Wallpaper Lab

Guide for anyone (person or coding agent) building or changing a wallpaper here. Start with [README.md](README.md).

## Read before you build

Most problems here have been solved or failed before. Before writing a new approach, read the page for it:

| Doing this | Read |
|---|---|
| Deciding what a scene should look like and how it moves | [look-and-motion-rules](docs/approaches/look-and-motion-rules.md) |
| Starting a wallpaper | `./wl new <slug>`, then [the kit's TEMPLATE.md](docs/tools/web-wallpaper-kit/TEMPLATE.md) (Wallpaper Engine runtime rules) |
| Art: plates, cut-outs, upscaling | [cutting out a painted prop](docs/approaches/cutting-out-a-painted-prop.md), [clean plates](docs/approaches/clean-plates-and-edge-unmixing.md), [upscaling](docs/approaches/upscaling-a-finished-painting.md), [Codex image generation](docs/tools/codex-image-generation.md), [segmenters](docs/tools/cutout-segmenters.md) |
| Motion: water, plants, wind, characters, trains | the matching page in [docs/approaches/](docs/approaches/README.md) |
| Checking a build | `./wl verify <slug>`, [headless and host verification](docs/tools/headless-and-host-verification.md) |
| Making it small and fast | [shrinking a finished WebGL wallpaper](docs/approaches/shrinking-a-finished-webgl-wallpaper.md) |
| Releasing | [releasing a wallpaper](docs/approaches/releasing-a-wallpaper.md), [preview GIFs](docs/approaches/workshop-preview-gifs.md), `./wl package`, `./wl media`, `./wl gif` |

All `wl` commands are in [tools/README.md](tools/README.md). If something is missing from `wl` or the kit, add it there; don't copy scripts into a wallpaper.

## Layout

- `wallpapers/<stage>/<slug>/`: `README.md` for users and `package/`, the folder Wallpaper Engine loads and the Workshop uploads. Stages: `in-progress/`, `ready-to-publish/`, `published/`.
- `making-of/` next to a package is a scratch folder for one build (art sources, experiments, checks). Git ignores it.
- `tools/`: the `wl` command. `docs/tools/`: shared scripts and setup notes (kit, gallery, upscale, cut-out, Codex, GPU lock).
- `docs/approaches/`: what worked and what failed, one page per technique.
- Python environments and model weights are never committed. [python-environments](docs/tools/python-environments.md) and the model pages say how to rebuild and download them.

## When a wallpaper ships

The repo keeps the result and the lessons, not the diary.
1. Put every lesson that would help the next wallpaper into the matching `docs/approaches/` or `docs/tools/` page (or a new page if three or more belong together), and update [the index](docs/approaches/README.md). Correct pages that turned out wrong.
2. Move any reusable script into `docs/tools/` or `wl`, made generic.
3. Put user-facing facts (controls, cost, tested aspect ratios, known flaws) in the wallpaper's README.
4. Delete `making-of/`.

## Rules

- `package/` loads everything locally, honours Wallpaper Engine's FPS limit, stops on pause and offers few 0-100 sliders (50 = the tuned look, 0 = off). Verify pause and resume in the real host before a release.
- Measure at the target resolution and hardware before claiming performance. Headless numbers are an upper bound. Check 16:9, 21:9 and 4:3.
- Passing checks doesn't mean it looks good: look at full frames, and judge motion over seconds, not single frames.
- Before changing an approved look, snapshot it and compare afterwards.
- Never overwrite a Workshop item while experimenting. Publishing to the Workshop is always done by a person.
- No personal names, user paths or private links in committed files. Look up home folders in code (`os.homedir()`, `os.path.expanduser('~')`).
- The GPU may be shared: `python docs/tools/gpu_lock.py --timeout 10 -- <command>`, then run without the lock if it times out.

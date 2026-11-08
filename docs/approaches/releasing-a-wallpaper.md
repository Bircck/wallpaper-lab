# Releasing a web wallpaper

Status: worked. This is the generic path from a finished scene to an installable, published Wallpaper Engine (WE) wallpaper, written from the releases of Opaline, Luminous Streams, Moon Cat, Golden Shallows, Sunroom, Living Print and Summer Crossing. Adapt it; the scenes differed a lot.

**Publishing to the Workshop is always done by a person** in the WE editor. Scripts and agents prepare the package, the media and the text, and never publish or touch a Workshop item.

Related pages: the runtime contract in [TEMPLATE.md](../tools/web-wallpaper-kit/TEMPLATE.md), checks in [headless-and-host-verification.md](../tools/headless-and-host-verification.md), size and startup in [shrinking-a-finished-webgl-wallpaper.md](shrinking-a-finished-webgl-wallpaper.md), the GIF in [workshop-preview-gifs.md](workshop-preview-gifs.md), sharpness in [upscaling-a-finished-painting.md](upscaling-a-finished-painting.md).

## Which tools were really used

`wl verify`, `wl media`, `wl gif` and `wl package` cover the checks, media and zip. `wl install` and `wl probe` were derived from per-wallpaper `host.cjs` and `install_we.py` scripts; those per-wallpaper scripts are what actually ran for the releases, and `wl install` / `wl probe` have not been run against WE on the development PC. Dry-run them first and read what the first real run does. New wallpapers do not need copied scripts otherwise.

## 1. Finish pass

- A few 0-100 sliders with plain labels: 50 = the tuned look, 0 = off or still. A slider at 0 that freezes all motion should also stop requesting frames. No slider that duplicates WE's Brightness/Contrast/Saturation/Hue. Rename a key when its scale or meaning changes, because WE replays saved values per key.
- No tuning panel, no `<select>` (it crashed WE's renderer; use cycling buttons in labs) and no keyboard shortcuts in the package. The tuning page lives outside the package.
- Plain asset files, one copy of each, no base64 in JS, no CDN, no `../` outside the folder, nothing unused. Run [`audit_assets.cjs`](../tools/web-wallpaper-kit/audit_assets.cjs): "bound" is not "drawn" and "drawn" is not "visible". Do it before the first release; removing a file later means a re-publish.
- Sharp on big screens: paint layers at 2x (a 4x upscale model, then Lanczos to exactly 2x), data maps and masks stay at 1x, mipmap the 2x textures. Any offscreen pass that holds the painting must also render near screen resolution, or the 2x art is lost there. Check by numbers at 1080p: crop a detailed area from a rendered frame and from the art and compare the Laplacian variance. Golden Shallows kept only 0.4 of it because its pass was 1920x1081. Pick the upscale model per scene on a full-frame swap page (UltraSharp won on some, Remacri on others) and look for a woven mesh in dark areas. Where 2x cannot work, use a light sharpening pass in the last shader. Check frame cost before and after.
- Shrink and speed up start: [shrinking-a-finished-webgl-wallpaper.md](shrinking-a-finished-webgl-wallpaper.md) (merged and cropped textures, shader `const`s, split programs, parallel compile, poster, canvas fade-in).
- README with Controls, How it was built, Run it, Credits and licences, Known flaws.

## 2. Approval targets

From the Workshop's "Read first" post for the Showcase tag, useful even when not submitting:

- Scenes: 256 MB GPU memory (stats warn at 400, 512 is the hard maximum), files under about 15 MB (over 100 MB is likely rejected), at least 1920x1080, and it must move when idle.
- Web wallpapers: low CPU, and they work at 16:9, 4:3 and 21:9 without stretching or cutting off significant content.
- No text in the wallpaper, an accurate title, suitable for all audiences.

## 3. Checks

1. `wl verify <slug>` (or `verify.cjs` directly): 0 console errors, 0 non-local requests, FPS 10 and 30 honoured, pause stops time, frames at 1920x1080 and 3440x1440, first-frame time, a preview under 1 MB.
2. Cost: the GPU timer ([`gpu_cost.cjs`](../tools/web-wallpaper-kit/gpu_cost.cjs)) for the frame, and the CPU of the `webwallpaper64` processes in the host. Headless timings are an upper bound. Run GPU jobs under the GPU lock with a short timeout, and repeat timings on a quiet machine.
3. Host: install into `<WE>/projects/myprojects/<folder>` keeping the existing folder name (WE then keeps the same project and its saved values), compare SHA-256 of the files, and run the windowed probe: properties arrive, FPS delivered, pause and resume, no GL errors. **Open the capture** because the pass rule only asks that a file exists, and one was all black. Only install when asked, and do not open windows on the desktop to test.
4. A person looks at the wallpaper in WE. Automatic game/fullscreen pause and the live `applyProperties` CLI were never verified.

## 4. Media

- `preview.gif` in the package and `"preview": "preview.gif"` in `project.json`: animated, looped, 256 px square, under 1 MB. Make a few variants and compare at 256/128/96 px; the method depends on the scene ([workshop-preview-gifs.md](workshop-preview-gifs.md)).
- Stills at 1920x1080 (JPEG), three to pick from.
- Showcase video: 10-30 s at 2560x1440 and 30 FPS (YouTube then uses its better codec), default settings, short fades. Make it with the real-time canvas `record` mode, which takes about a minute for a 30 s clip (38 s at 1440p including one x264 pass). Frame-by-frame mode costs about 1 s per frame; do not use it unless a stutter is visible in the clip. Duplicate-frame counts (`mpdecimate=hi=64:lo=0:frac=0`) are only a hint.
- Do not queue behind the GPU lock for media: `gpu_lock.py --timeout 10 -- <command>`, then run unlocked if it times out (queues of 4-10 minutes happened for jobs that take seconds). Run the recording on its own, first, not chained after stills.
- A YouTube thumbnail at 1280x720.
- Review the video before anything is uploaded.

## 5. Listing

- Title `Name - short hook`, genre tags, age rating, visibility.
- Put the final title and description in `package/project.json` (`title`, `description`); the WE publish dialog fills itself from there.
- The description is Steam BBCode: one short, human line for what it is and the one nice thing about it, plus the video link. Keep it short; no tour of the scene's techniques. Credits and licences belong in the README, not the listing.
- YouTube title `<Name> - Wallpaper`, with description, tags and thumbnail.

## 6. Publish (a person does this)

1. YouTube: upload with the prepared text and thumbnail, not made for kids. Leave out the Workshop link until it exists.
2. Workshop, in the WE editor: open the installed project, **Workshop - Prepare for publishing**, paste title and description, set genre, age rating, visibility and preview, then **Publish** (this accepts the Steam Workshop terms). A new upload shows an orange "incompatible" banner on the item page for a few hours; it is an anti-spam check, ignore it.
3. On the new Steam item page, **Add/edit images & videos**: add the YouTube link and the stills.
4. Put the Workshop link in the YouTube description.

## 7. Record and move

- Write the Workshop item id and the YouTube URL into the README, and copy WE's `workshopid` from the installed `project.json` back into the repo copy.
- `wl package <slug> <version>` writes the zip and checksums.
- Move the folder to `wallpapers/published/<slug>` and update path references.
- Remove the local `myprojects` copy and restart WE (its library keeps a ghost tile until it rescans). Before deleting a test project folder, switch the monitor to another project, or a restored selection leaves the desktop black (`selectedwallpapers` in `config.json`).
- Later updates: recreate the local project from `package/`. Its `project.json` carries the `workshopid`, so publishing it from the editor updates the same item. Never overwrite the item while experimenting.

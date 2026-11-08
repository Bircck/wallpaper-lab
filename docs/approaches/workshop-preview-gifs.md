# Workshop preview GIFs

Status: mixed. Learned on [Opaline](../../wallpapers/published/opaline/README.md), then refined on Sunroom and Summer Crossing. Treat this as a menu, not a recipe: scenes differ (full-frame flow, small moving details, events, DOM layers), and so will the right way to make and loop each GIF. An animated preview makes a wallpaper far more inviting to click.

## What's fixed

- `package/preview.gif` plus `"preview": "preview.gif"` in `project.json`; the WE publish dialog picks it up. Steam's limit is 1 MB.
- Steam serves the GIF animated as the item-page preview (checked by downloading Opaline's: 48 frames at 256 px and 268 px). Whether it also animates in the Workshop browse grid and WE's library was not checked.
- Judge it at the sizes it is actually seen: about 256 px on the item page, WE library tiles about 180 px, Steam lists about 96 px. Put the candidates side by side at 256/128/96 px, next to the current one, on a small comparison page.
- To compare candidates inside WE's own library, make one temporary project per GIF in WE's `myprojects` (a full copy of the package with its own `title` and `preview.gif`) and remove them afterwards, once `config.json` shows none is selected.

## What was preferred so far (a few wallpapers, so re-check each time)

- Opaline: the 1.2 GIF's pace (default speed, 3x time compression) was close to right, but wanted to be a bit more alive and to loop without a visible transition. Motion speed 100 and 10-40x warps were rejected outright. The pick was the same pace at 12 FPS instead of 8, with a seamless loop.
- Smoothness and a clean loop counted for more than speed. That may differ for a scene where the interesting motion is small (a sun, boats, lightning).
- [Sunroom](../../wallpapers/published/sunroom/README.md): whole-scene colour changes. A slow continuous day sweep was passed over and hard cuts were a bit abrupt. The pick was 1 s fades between five looks, the sun held at one size and height, and dunes moving a bit more than default.
- [Summer Crossing](../../wallpapers/published/summer-crossing/README.md): event loops where the crossing lamps blink most of the time were rejected, because the attraction of the scene is its tranquility. The pick was the whole scene with about half the loop calm (calm, lamps and gate, a short express, gate up, calm; 15.4 s), the express cut to 2 cars and a shorter lead-in only in the GIF, through the package's own `seek`/`play` hooks.
- Recipes that passed: Luminous Streams at 4x pace, 16 FPS, a seamless blend loop, centre square, 64 frames; Living Print a 12 s loop of the whole print (593 KB); Sunroom 14 s at 9 FPS, 96 colours (40 for the fades), 1 s fades between five looks (under 1 MB).
- Show variants and let the reviewer pick. When feedback can be read two opposite ways (slower than variant A, or slower than the current one), ask.

## Ways to capture frames

| Approach | Good for | Cost and limits |
|---|---|---|
| Real-time canvas recording: [`docs/tools/make_preview_gif.cjs`](../tools/make_preview_gif.cjs) | Any package, no code changes; first look at a new wallpaper | About 10-20 s per GIF. MediaRecorder on the largest canvas; `--capture screencast` for DOM or multi-canvas scenes (less even frame timing). Can't loop seamlessly by itself. |
| Time compression (`--speedup`) | Slow scenes | Needs a recording `speedup` times longer than the GIF. |
| Clock warp (`--timewarp k`) | Scenes whose speed slider is capped | Replays rAF in small steps per real frame, because scenes clamp each step (Opaline at 0.1 s; a plain clock scale was silently capped near 6x). Renders several times per frame, so use a smaller `--viewport`. Works technically; the fast look was rejected for Opaline. |
| Time-exact frames through the wallpaper's own hook | Exact timing, seamless loops, reproducible GIFs | Per-wallpaper code. a capture script patches `wallpaper.js` on the fly to add `testFrame(t)`, then screenshots each frame. At a 512x512 viewport it took about 7 s for 48 frames; at 1080p it's about 1 s per frame. For a cover-fit scene, a square viewport shows the same centre square as cropping a 16:9 frame. |

## Ways to loop

| Loop | Result | Notes |
|---|---|---|
| Ping-pong (play forward, then reversed) | Opaline 1.2 | No seam, but the motion visibly reverses. |
| Short crossfade at the end (`--loop crossfade`) | Rejected for Opaline: the transition was visible | Generic. Shows as a spike in the tool's seam check (3.3 against ordinary steps of about 1). |
| Mix the drifting fields at `time` and `time-L` by `time/L` | Chosen for Opaline | Frame L equals frame 0. Mix the displacement/light/dust inputs, not two rendered images, so there's still one texture sample and nothing ghosts. A `1/sqrt(w²+(1-w)²)` factor keeps the mixed displacement as strong as a single one mid-loop. Needs a GIF-only copy of the shader's time terms, which has to be kept in step with the package. |
| Use the scene's natural period | Not tried | For motion built from sines, rotations or repeating cycles (beams, sky rotation, bobbing), choose L as a common period and no mixing is needed. |
| Loop through a circle in noise space | Not tried | Replace linear drift `v*t` with a small circle; changes the character of the motion (swirl instead of drift). |
| Wave frequencies adjusted so each sine completes whole cycles per loop | Golden Shallows | Patch the wave frequencies in memory (time-exact frames needed) so every travelling sine completes a whole number of cycles over the loop. Speed changes were -7 to +12% for big waves and up to -22% for slow swell. |
| Cloud layer mixed with a copy shifted by one cycle of drift | Golden Shallows | For faster clouds, show the layer mixed (premultiplied, smoothstep weight) with a copy shifted by exactly one cycle of drift, so each cycle ends where it began (no reversal, no jump; mid-cycle slightly softer). |
| Blend the last 12 frames with the lead-in frames, in the GIF's own pixels | Golden Shallows | Only while any event is hidden at both ends. Pick the start time by scanning many start times for the smallest end-to-end difference (seam 0.40 against a typical step of 0.39). |
| Events (boats, lightning, birds, trains) | Partly: Summer Crossing used its own `seek`/`play` hooks (see above) | Pick a window where an event happens, or force one inside the loop; a seamless field loop alone won't repeat a one-off event. |

## Checks

- Seam: the last-to-first frame difference should be no bigger than the largest ordinary step. `make_preview_gif.cjs` prints both (`seam ... (largest step ...)`); for other outputs, decode the GIF and compare the same way.
- Size: fast or detailed motion compresses badly. The levers are frames per second, colours (the tool lowers them automatically down to 48), length, and a tighter crop. Rough costs: about 15 KB per frame for busy water at 128 colours, 5 KB for a resting frame, about 24 KB while a camera zoom changes every pixel. A zoom variant was 2.8 MB at 12 FPS and nothing got it under 1 MB without posterising. A "hold" filter (keep the previous pixel until it moves more than 3 levels) with an ordered Bayer dither beat error diffusion, which was twice as big.
- A small event is a speck at 256 px (and still at 96 px). A 104 px inset of it at 3.7x makes it readable; calmer water in the inset (14 against 50) and 64 colours kept one such GIF at 953 KB.
- Colour changes across the whole frame: one shared palette leaves bands in the sky, and per-frame palettes (`stats_mode=single`) cost half a megabyte more because ffmpeg then stops storing only the changed pixels. What worked on Sunroom: encode each held look and each fade frame as its own GIF, then join them, moving each global palette into a local one. Leaving out grain and fine lines that can't be seen at 256 px also saved a third.
- The tool's motion score (first frame against the middle frame) only compares variants of the same wallpaper: full-frame flow scores high, small moving details score low however visible they are.

## Pitfalls hit

- A first warped frame after a gap in rAF (while loading) tried to catch up with hundreds of draws and crashed the GPU process; catch-up is now capped to one ordinary frame.
- Patching shader source by string: the vertex shader's `void main(){` comes first. Patch the fragment shader's (the last one).
- `Failed to load resource` console lines hide which file failed; log failed responses with their URL instead.

## Not explored yet

Larger GIFs or video in the Workshop description and screenshots, animated WebP or video previews (whether Steam or WE accept them was not checked), a separate GIF crop per wallpaper on the busiest area, and GIFs for the README gallery.


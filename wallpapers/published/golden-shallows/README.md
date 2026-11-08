# Golden Shallows

A painted golden-hour cove: a rock arch with pines standing in calm, clear shallow water, a wooded headland with a small lit shrine, a pebble beach and wet boulders in front. Clouds drift and mirror in the water, slow waves run through the reflections, the sandy seabed shows through near the shore, the pines bend when a gust comes in from the sea, and a small crab climbs over the rocks.

Inspired by the last scene of the last episode of the anime *Sparks of Tomorrow*, for the water and the mood, not the layout.

**Status:** published 1.0 on 2026-11-02: [Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3832664548), [video](https://youtu.be/m6V0bxouHUc).

## Controls

All sliders are 0-100, and 50 is the tuned look.

| Slider | What it does |
|---|---|
| Waves | All the movement on the water at once: waves, swell, gust patches, ripple lines, foam and shore wash. 0 = a glassy mirror, 100 = double. |
| Seabed | How much of the sandy bottom shows through near the shore. 0 = none, 100 = very clear water. |
| Trees | The wind in the tree crowns: rare gusts from the sea and a light breeze. 0 = still, 100 = stormy. |
| Clouds | Cloud drift speed. 0 = still, 100 = double. |
| Crab | How often the crab comes out (it takes turns between the low front rock and the big boulder). 50 = a 5-10 s pause between crabs, 100 = almost continuous, 25 = about one a minute, 0 = never. |

Brightness, contrast and colour are Wallpaper Engine's own options. The frame rate follows WE's FPS setting and pause.

## How it was built

- One Codex painting (concept d2), cut into layers: a clean sky plate and a drifting cloud layer, a land matte, a water mask from SAM 2.1, and 13 tree crowns cut out with Finegrain and SAM 2 on upscaled crops so they can bend about their trunks over a clean background.
- The water is a shader: a perspective mirror of the scene above it, near rocks mirrored about their own waterline, a Codex-painted sand seabed showing through near the viewer with a slow caustic web (Straw Hat Cove's light layer), the cove's distant ripple lines, gust patches and a shore wash. Its look was tuned by hand on live sliders.
- The crab is a Codex parts sheet (body, claws, two-segment legs), cut out and rigged in code: each leg is an IK chain with its foot planted on the painted rock's silhouette, walking in a gait that follows the distance travelled.
- Two passes per frame: the scene above the water at about screen resolution, then the water in screen space, then the crab. Headless on the GTX 1070 Ti: about 1.1 ms per frame at 1080p and 1.6 ms at 1440p (an upper bound); in Wallpaper Engine about 7 % of one CPU core at 30 FPS. Screens above 2560x1440 render at 2560x1440 and are scaled up.

## Run it

- **Wallpaper Engine:** subscribe on the [Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3832664548). To load it from the repo instead, open `package/project.json` in the WE editor.
- **Browser:** serve the repo root (`python -m http.server 8861`) and open `wallpapers/published/golden-shallows/package/index.html`.

## Credits and licences

Art generated with OpenAI image models via Codex (concept d2), upscaled with 4x-UltraSharp (Kim2091, CC BY-NC-SA 4.0). Water mask and sky cut-out with SAM 2.1 and PyMatting, tree and crab cut-outs with Finegrain Box Segmenter and SAM 2, all offline. No model ships with the wallpaper. Personal, non-commercial project.

Made with AI image generation: the painting was generated with OpenAI image models through Codex, then edited and animated by hand and in code.

## Known flaws

- At the very bottom of the frame the sky reflection runs out of sky and smears into faint vertical streaks (the seabed hides some of it).
- The water outline along the big boulder's left edge can sit 1-2 px off the painted rock.
- At 4:3 the crop keeps the arch but loses the shrine and the big boulder, where the crab's second act plays. 21:9 keeps everything.
- The far sea strip near the horizon uses a colour-based mask extension.
- Painted sky specks inside the tree crowns move with the trees.
- The lit shrine trees and the dark crowns in the top-right corner stay still (they would need a painted forest behind them).

## Folder

- `package/` is what Wallpaper Engine loads.

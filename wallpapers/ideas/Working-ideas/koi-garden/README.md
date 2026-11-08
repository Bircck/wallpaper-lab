# Koi Garden

**Shelved 2026-11-03.** It was shelved before a finish pass. Weakest points: the right half of the pond is still a calm dark expanse and the deep koi can read as ghosts. A rough self-assessment was about 7.5/10, not re-judged. `package/` still runs.


A quiet temple-garden pond at dusk in Japanese ink-and-colour (nihonga) style, seen from steeply above. A stone lantern glows warm on the mossy bank and its light spills onto the stones and the shallow pebble bed. Five painted koi swim under the surface of dark, moonlit water and pass beneath the lily pads, which are pushed a little as they go. The cherry branch is still in calm air and sways in a rare gust, shedding petals that drift out across the pond, and fireflies drift over the water and near the light.

## Controls

| Slider | 0 | 50 (default) | 100 |
|---|---|---|---|
| Koi | no koi | five calm koi | eight koi, a little livelier |
| Water | still: no rings, pads do not move | rings from surfacing koi, petals and pads; a koi passing under a pad pushes it a few pixels; a cool moonlit lift and a slow reflected-sky film over the open water | stronger and more frequent |
| Wind | branch still, petals fall straight | calm spells, then a gust every 15-37 s that builds over 2-3 s and rings down (tips follow the root) | stronger |
| Petals | off | a few in the calm, a shower in a gust, drifting out across the water for a minute or two | twice as often |
| Glow | lantern steady, no fireflies | the lantern's light breathes slowly, fourteen larger fireflies (glow cycle 8-20 s) | brighter, up to twenty |
| Render scale | | 100% | 35-100% |

With every motion slider at 0 the wallpaper stops requesting frames. It also honours Wallpaper Engine's FPS setting and pause.

## How it was built

- **Plate.** A Codex concept was re-lit to dusk by a Codex edit, upscaled 2x with 4x-UltraSharp and registered back onto the original plate's pixel grid. Two more Codex edits removed the cherry branch and then the lily pads, giving a clean plate (`package/plate.jpg`). Nothing in the painting is warped.
- **Layers**, all cut from the painting:
  - 21 lily pads, one cut-out each (each with its drop shadow), in `layers.png`
  - the cherry branch in one piece, `branch.png`
  - koi, five painted varieties split into rigid pieces (head, two body pieces, peduncle, tail fin, four fins) that follow a spine path, `koi-atlas.png`. In the shader they are graded to sit under dusk water: cool and dim, warm only where the lantern light reaches the shallows, a thin dark ink rim like the pads' outline, a slow 1 px refraction wobble and drifting light bands over them.
- **Masks** (`masks.png`): R = water, G = warm light of the lantern, B = shallowness. `field.js` is the steering field the koi follow (swim area as a signed distance, open-surface grid, blossom points petals fall from).
- **Behaviour** (a deterministic sim):
  - koi wander around a home area each, keep a body length or so apart at every depth, steer clear of the banks, sometimes burst, hover, or rise to the surface and leave a ring
  - each pad is still until touched: a koi swimming under it, or a passing ring, pushes it up to about 6 px and turns it a degree or two, a slow critically damped spring (about 5 s) brings it back, and a firm push sends one ring from its rim
  - the branch is driven by a rare, deterministic gust (rise 1.5-3 s, hold, fall 1.6-3.6 s) through three damped modes (limb, strands, loose tips). Each part lags the root, so the tips follow it and nothing ticks at a fixed period. Petals leave from where the blossoms are at that moment and shed mostly in gusts
  - the lantern's warm light (a mask of the painting's lit areas) breathes by a few percent over 5-17 s; fireflies follow slow closed-form paths with a glow cycle of 8-20 s, about 2.5x larger than in the first dusk version
- **Water.** Ripple rings refract only locally. Over the open water a cool moonlit lift (a few tens of levels toward the upper right) and two slow bands of reflected sky drift across the surface. The pebble bed never warps globally.


## Run it

Open `project.json` in Wallpaper Engine (not `index.html`, or the controls are lost). To view it in a browser without WE, serve the repo root and open `package/index.html` (or use `file://` with Chrome's `--allow-file-access-from-files`). Check it with `node docs/tools/web-wallpaper-kit/verify.cjs wallpapers/ideas/Working-ideas/koi-garden/package`.

## Credits

- Painting and koi sprites: generated with OpenAI Codex image generation for this project (AI-generated art; non-commercial).
- Upscaling: 4x-UltraSharp by Kim2091 (CC BY-NC-SA 4.0).

## Known flaws

- The right half is still mostly dark water. After the fix round it has a lift, a drifting film, three koi, bigger fireflies and drifting petals, but it stays calm rather than busy.
- The koi are still sprite fish: under the dusk grade they read as fish under the surface, but the ink rim is thin and the soft deep ones can look like ghosts next to the sharp painting.
- The lantern light drifting on the pebbles and the warm ring crests (variant) are too faint to see in a still.
- At 21:9 the crop keeps the top (branch, top pads) in view; the lantern's plinth and the bottom stones are partly cut.
- The ripple rings are thin, uneven ink-like lines but stay procedural; up close they are more regular than a brush ring.
- Koi still cross each other at different depths now and then; a stack no longer happens.
- Fin and joint rotations are rigid. At a very tight turn you can see a soft crossfade at a joint at 2x zoom.
- Under the swaying branch the bank rock and water come from a Codex clean plate, so they differ slightly from the painting they replaced.

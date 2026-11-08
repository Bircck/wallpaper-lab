# Rain Lantern Alley

**Shelved 2026-11-03.** It was shelved before a finish pass. A review gave it 6.5 before a fix round, not re-judged after. Weakest points: a gust is the only event that changes the whole frame, the steam is short and the puddle's cloud reflections last only about a minute. `package/` still runs.


A narrow Japanese back alley at night in light rain, painted in an anime-background style from a low camera. The painting itself is never warped: every motion is a rain layer, a cut-out or a masked effect on one part.

What lives in it (version 2, round 2026-10-26):

- **Rain** in three depths plus a faint near layer, splash ticks on the paving, rings spreading across the mirror puddle (more of them beside the two lantern reflections), and drips from the stall's eave: a bead swells at the tip, catches the lantern light, lets go and lands with a ring.
- **Two lanterns** that glow and breathe. The hanging one always sways gently on its hook (about 4 degrees, one swing every 4 s), and both puddle reflections are true mirrors of the scene, so they swing and flicker with it. A soft warm bloom follows each lamp, in the air and, separately, in the puddle.
- **The stall**: steam rises from the pot as soft wisps that widen and dissolve before they reach the curtain; the five noren panels are cut-outs that sway from the rod, each on its own phase, with a wave that runs down the cloth and a hem that ripples.
- **The sky**: the painted clouds are a cut-out strip that drifts slowly left over a clean sky gradient and goes behind the roofs. Their painted reflections in the puddle are a second strip on the same drift. Very rarely (about every two minutes) a soft sheet lightning lights the clouds and the mountain, and the puddle shows it too.
- **Mist** drifts behind the far end wall of the alley and along the foot of the mountain, and stays out of the houses in front of it.
- **Small lives**: the leaves stir, the lantern light on the wet stones breathes with the lamps, and now and then one of the lit windows dims like a lamp turned down and comes back.
- **One cause: wind. A gust every 30-90 s and a weaker breeze about halfway between.** The rain slants and thickens into a sheet that sweeps through, the hanging lantern swings, the noren and the leaves stir, the steam and mist lean away, the clouds speed up and the lamps dip. Then it all settles. A breeze does the same at about a third of the strength.

## Controls

| Slider | 0 | 50 (default) | 100 |
|---|---|---|---|
| Rain | off (streaks, splash ticks, rings, drips) | light rain | denser and brighter |
| Wind | still (lantern, noren, leaves, steam lean, cloud drift, gusts) | tuned: a breath of air and a gust every minute or so | double |
| Mist | off (mist and steam) | tuned | thicker |
| Lights | steady lamps, no bloom, no window life, no stone shimmer | tuned | double |
| Lightning | off | one soft flash about every two minutes | brighter |
| Render scale (%) | 35 to 100 | 100 | |

When all five effect sliders are at 0 the wallpaper stops requesting frames. It also honours Wallpaper Engine's FPS limit and pause.

## How it was built

- **Painting.** Codex generated the scene (concept B), upscaled with 4x-UltraSharp to a 2x master (3344x1882). One Codex edit outpainted 140 art px on each side for ultrawide; only those outer bands are used. No new Codex edits in version 2.
- **Lantern and reflections** (version 1): a cut-out over a fitted-gradient plate, rotated about its hook; both puddle reflections replaced by vertical mirrors of the scene inside the puddle mask.
- **Noren**: the cloth is the only blue thing in its box, so a colour score gives a clean matte with a natural anti-aliased edge and its lit selvedge; edge colours are un-mixed against an inpainted interior fill. Each panel is moved by a lean that grows with its height below the rod, a wave that runs down the cloth on its own phase, and a rippling hem (the cloth is sampled from a shifted row). The top stays fixed at the rod. At rest the frame equals the painting (mean difference 0.03 levels).
- **Clouds**: the sky is a cubic gradient fitted to the cloud-free sky pixels, and the clouds are un-mixed against it into an RGBA strip. The painted sky reflection in the puddle gets its own low-order fit and strip in the same atlas. The strip wraps every 1000 art px and is clipped to the sky, so it slides behind roofs. The cloud that runs behind the right roof gets a mirrored hidden end so it emerges softly.
- **Masks** (`masks.png` from version 1: puddle, glow, rain shelter, ground; `masks2.png`: foliage, sky, lit windows, warm paving highlights).
- **Everything else is procedural in one fragment pass**: rain, rings, steam strands, mist, leaf stir (a coherent branch-scale field inside the foliage mask), lightning (a multiplicative lift of the sky mask), window and stone-light gains. All of it is a function of the clock, so a gust, a flash or a drifted cloud is the same at any FPS.
- **Cost**: about 1.2 ms per frame at 1080p and 2.6 ms at 3440x1440 on a GTX 1070 Ti (version 1: 0.8 and 1.7 ms). Texture fetches use explicit LOD, because otherwise ANGLE ran every branch for every pixel (7.8 ms).


## Run it

- In Wallpaper Engine, open `project.json` from the `package/` folder.
- In a browser, open `package/index.html`.

## Credits

- Painting: generated with Codex (OpenAI image tool) for this project.
- Upscaler: 4x-UltraSharp (CC BY-NC-SA 4.0).
- Code: original.

## Known flaws

- The effects are quiet by design (calm, slow, rare). Between gusts what moves is the lantern's sway, the rain, the rings and drips, the steam, the noren's breath, the glow, the clouds and the mist, and much of that is subtle at a glance.
- The reflected clouds fade out before they reach the mirrored zone of the hanging lantern's reflection (that zone shows the real, drifting sky instead), so they last about a minute on screen; the real clouds travel on.
- The steam is short: only about 45 art px of it is visible between the lid and the hem of the noren.
- The reflection water lines follow the painting's own (artistic) reflection placement, not a strict perspective construction.
- Rain is easy to see against the sky and the puddle, but faint over the dark walls.
- At 3440x1440 the bracket the lantern hangs from touches the top edge. The lantern itself is fully visible.
- Rings sample a few px of displaced reflection. Right at the puddle rim, that can pull a sliver of stone colour into the water.
- Not done: runoff trickles along the paving joints (no clean way to place them on the painted stones).

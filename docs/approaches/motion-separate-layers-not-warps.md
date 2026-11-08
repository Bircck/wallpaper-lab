# Motion: separate layers with their own motion, not warps of a flat image

Status: worked for layers, failed for warps. This is the main lesson across the wallpaper work.

## Problem

Making a painted image move without it looking like a pixel shuffle. Warped or morphed paintings were rejected in every project where they were tried.

## What worked

- **Cut the image into layers that each move on their own, over a filled plate.** Each layer is a real cut-out of original pixels with its hidden background filled, and it gets motion that fits the material.
  - Straw Hat Cove plants: seven cut-out groups, then 361 rigid SAM pieces drawn in a separate pass with a tip bend. Sway is anchored at the roots through a root map, so the ground contact is still. Shared gust envelope with occasional stronger breezes. Props stay rigid. See [water-on-painted-scenes.md](water-on-painted-scenes.md) for the water.
  - Straw Hat Cove cloth and hats: vest, bandana, straw hat and Chopper's hat each swing about a pivot (hook, knot, brim) with the exact clean plate behind. See [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md) and [cutting-out-a-painted-prop.md](cutting-out-a-painted-prop.md).
  - Living Print: pines, reeds, bushes and the boat cut from the original Hokusai pixels, with Telea fill and clean-source donor patches for hidden areas, anchored bending driven by one gust signal with depth-based amplitude.
  - Clouds as a real RGBA strip drifting one way over a clean sky plate ([sky-matte-at-a-fitted-horizon.md](sky-matte-at-a-fitted-horizon.md)).
  - Rain Lantern Alley (an unreleased idea, no Codex edits): a 5-panel noren curtain cut by colour (only blue thing in its box) and sheared from the rod, with an inpainted interior fill that shows only in the strips a swaying panel uncovers; the painted clouds cut against a cubic sky-gradient fit into a wrapping RGBA strip clipped to the sky mask (a cloud cut by a roof gets a mirrored hidden end). One gust signal drives rain slant, lantern pendulum, curtain, leaves, steam, mist and cloud speed.
- **Procedural effects confined to a mask** where there is nothing to cut: smoke, cola fizz, lens shine, Log Pose glints, frost. Each has its own slider.
- **Real animation from a real model** when a character must move: the illustrated driving loop (Blender car, toon materials, true wheel exposure) was strongly approved. The wheel was the only complaint (see [other-recorded-approaches.md](other-recorded-approaches.md)).
- Tune with exaggerated motion first: it exposes bad fills and halos. Then pick the shipped default (50 on a 0-100 slider = the tuned look).

## What failed

| Approach | Where | Why it was rejected |
|---|---|---|
| Phase crossfades between displaced copies of the painted water | Straw Hat Cove v0.2 | Static and blurry water. |
| World-space wave heightfield with a generated seabed that replaced the painted water | Straw Hat Cove v0.3 | Morphing water, and the painted look was lost. |
| Four replacement water options (flat cel waves, ribbons, sheltered cove) | Straw Hat Cove options study | All rejected. Direction: keep the original painted art, layer it. |
| Three custom shader water experiments (rolling swells, optical light, graphic foam) | Straw Hat Cove shader studies | Rejected for losing the original aesthetic. |
| Translated residual water layers with a 0.6.1 GrabCut foreground | Straw Hat Cove foreground study | Layers lack changing crest shapes, dominant near-water caustics stayed frozen, and rough-mask-seeded GrabCut kept tracing mistakes. |
| Texture advection of painted water detail (crop test) | Straw Hat Cove crop test | A recurring blur at the crossfade (08.1 removed the phase cycle and used one displaced sample), but the texture-warp look was never approved. |
| Plant motion as in-place texture warping | Veranda | Read as pixels and colours shifting. Replaced by real cut-outs with filled backgrounds. |
| Weak local-mask cloud and filament movement; generated replacement cloud cut-outs that drift | Luminous 0.3, 0.4 | Too weak, or generated art rejected. Effects of 0.5 were nearly invisible even at maximum. |
| Global UV warp of cloud density ("jelly deformation") | Luminous 0.8 | Rejected. Stopped rather than iterating the same technique. Alternatives tried (volume, fluid transport, wisps) each had their own flaw: volume loses detail, fluid looks like haze, wisps leave the main shapes static. |
| 2D puppet warp of Sonic from a flat painting | Sonic dock | Read as a warp, not acceptable as the baseline. See [animated-characters.md](animated-characters.md). |
| Sliding sprites and a frozen car/road composite as "driving" | Cloudsea tracking | Poor art and not enough perceived speed. Replaced by the Blender-to-toon route. |
| A geometric cyclist | Summer Cycle 0.1 | Rejected. Replaced by fixed rider art and two rotating wheel sprites. |

## Notes

- Layer count is not an acceptance criterion. Technical checks (offline, FPS, pause) passing does not mean the look was accepted. Several rejected builds passed all of them.
- Parallax or translation of cut-outs is not "alive" by itself. Give each layer motion that matches what it is.
- Characters ([Moon Cat](../../wallpapers/published/moon-cat/README.md) head; Moon Cat was published 2026-10-29, but the big head moves never worked, only blink and lick patches): animate the head as cel animation does it. Swap complete drawings (Codex edits of the same enlarged head crop, so they register), and put a drawn in-between held for 2-4 frames between poses (the first pass held 4 frames with a 0.8 degree settle; the later round held 2 frames, 67 ms, with a 2 degree settle overshoot). A 200 ms cross-dissolve between poses showed ghosted double ears and read as a morph. Put the neck seam where every drawing's contour meets the body within about 2 px. Patch blinks into the rest drawing only where they differ, so the fur doesn't boil.
- Scene life on a painted night town (Moon Cat; the trees, the lake as a soft mirror, the leaf and the witch were accepted and shipped): trees swayed as cut-outs over an inpainted plate (mask by darkness plus the olive rim colour, small fragments next to the tree joined, two inpaint passes; pixels carry a sway weight = height above the root, so one gust signal moves every tree and the root stays put); the lake as a masked region whose reflection rows wander sideways and where thin strokes live 6-12 s; windows switched off and on by a per-window multiplier texture (panes of one window grouped, a warm fade); a falling leaf (see Falling leaf below). A quasi-steady lift/drag plate without added mass fell straight down and never fluttered. Pitfall: if the removal mask grows after the sway weights are computed, the grown fringe keeps weight 0 and stays behind as a thin wire next to the swaying tree; build the weights from the final mask (nearest tree label) and blur them where neighbours meet.
- Wallpaper Engine: dropdown (`<select>`) controls crashed its embedded renderer in one build, so variants were switched with cycling buttons. The convention for final wallpapers is a few 0-100 sliders (50 = tuned look, 0 = off); not every released wallpaper follows it yet.

- Moving painted shadows ([Summer Crossing](../../wallpapers/published/summer-crossing/README.md) road): shifting a luminance map moved the ground with it, because the map held the cracks and stones, which was obvious on screen. Keep the ground still: a clean plate times `mix(1, R, M moved)`, where M is a texture-free shape from "darker AND bluer than the same material in open sun" and R is the colour drop per material. M has to carry on under the plant edges, or a pale ring appears where the shadow is cut off. Dividing the shadow out of the painting gives pink and green blotches, so that plate takes its colour from the same material in open sun and only local detail from the painting.
- Plants cut from a finished painting (same wallpaper): the pieces are a partition of what's visible, so many have no foot and rotating them about their own pivot reads as spinning in mid-air. Giving each piece a ground line, found by walking down through the pieces under it, and bending it from there fixed that without new art; the cut-off edges still need whole plants drawn.

## Tree crowns as cut-out layers

Skyline pines and similar crowns against a sky (Golden Shallows, Moon Cat):

- **Cut each crown on a 2x upscaled crop resized to 1024.** SAM2 for crowns Finegrain faded or merged with a bush, Finegrain where SAM leaked, the union for two (see [cutout-segmenters.md](../tools/cutout-segmenters.md)).
- **Alpha = segmenter membership x the existing sky matte.** The sky edge is then the proven one, and the rest frame equals the painting (0 of 2.07M pixels differ at wind 0). Edge pixels between model and matte go to the nearest seed; needle specks within 8 px join the crown; cut at the trunk base. Where the crown overlapped canopy, continue matte and colour by normalised convolution (only a 1-3 px sliver ever shows).
- **Lit trees in a dense canopy** (a darker forest behind them): a Codex edit "remove the lit trees, paint the darker forest behind" on a 3.2x crop with a magenta-tinted guide image gave a usable plate on the first try (two groups of 1 and 3 regions; removing everything at once was not tried). Tone-match the plate to the painting at low frequency (sigma 14), then take membership as the Lab difference between painting and plate (threshold 24, inside a hand polygon grown 8-10 px), so no segmenter is needed. Thresholding alone gave holey silhouettes; a 13.5 px closing plus hole fill fixes it at the price of blobby edges that show only against the plate. Pale masses with no readable outline (blocky brush patches) cut badly: only real leaf edges worked. A polygon edge that cut a trunk in two let a pale fragment slide off the trunk; add an exclusion box after the closing.
- **Motion.** One damped spring per crown (0.38-0.85 Hz, bigger crowns slower, damping 0.22; heavier tree masses 0.2-0.32 Hz). Gusts about every 17 s (8-26 s apart) arriving from the sea side with a 2-4 s travel delay, one in three 2.3x stronger. Integrate at 240 Hz, with `seek(t)` re-integrating the last 25 s so frames stay deterministic. Bend angle grows as height^1.5 (the top moves most), with a soft tanh cap at 0.4 rad: past about 20 degrees a bend smears a crown into streaks.
- **Amplitude.** Tips moving 1.5-4.5 px were reported as barely moving; a 3x scale (tips 4-8 px in a normal gust at 1080p) was accepted.
- **Known flaws.** The crown edge in the lee shows only a 3-10 px plate strip; sky specks inside crowns keep moving with the tree.

## Falling leaf

The leaf is the real vine leaf, hidden while it falls and for 12-20 s after, then grown back.

- A plate model needs added mass and circulation (Pesavento-Wang). The rotational-circulation term (CR = 2 pi) is what made the plate flutter; add rotational and viscous drag.
- Blender rigid body or cloth has no aerodynamic lift or torque, so a leaf falls like a stone or a rag. Use the plate model instead.
- Scan chaotic paths and pick tracks by eye (6 drops, 5 glides), then stretch time 9x (5x for glides), with a 9 cm leaf mapped to 110 art px.
- Project the leaf's two axes with a camera looking down 48 degrees into a 2x2 matrix, flooring the smaller singular value at 25 % of the larger (keeping its sign) to avoid a 1 px line when edge-on, and tint through the middle on turn-over.

## Witch rig: a drawing moved by simulated chains

Moon Cat witch (shipped). One drawing, with parts moved by simulated chains:

- Each moving part (head with hat and hair, hat cone, hair, skirt hem with boots, cat tail, broom straw) is its own layer with its own transform, stacked as a union. Blending neighbouring parts' motions in one warp folded where they moved toward each other, and half-owned joins drew grey doubles.
- The still base must keep seams at full strength plus an underlay of parts within 12 px of the body, or a crack opens when hair lifts. This was the one defect reported.
- Bake the 240 Hz chains to 15 fps frames, 2x supersampled, into a 2048x4096 atlas of 2 MB, so runtime is one sprite.
- Run a hole finder afterwards: frames where solid still-drawing pixels turn to background. 2 of 405 frames kept a 1 px seam.
- Primitive 3D humans were rejected for this character; see [animated-characters.md](animated-characters.md).

## Framing a tall painting on wide screens

For any screen wider than the painting, put the window as low as it can go with the subject's top (the cat's ears) still in. At 21:9 that keeps the cat, tail tip, lake and town and cuts the moon top. At 32:9 only 940 art px of height fit (ears, moon, roof, horizon), so the lake, town and anything that lives there (a ghost's peek spot, windows) are not seen. Decide which events need which area and let them yield when the shape does not fit. Golden Shallows at 4:3 kept the arch and lost the shrine and the boulder act's rock.

## Extras that were rejected on finished paintings

Recorded so the next scene does not repeat them:

- Extra characters nobody asked for: beach walkers, a distant boat, small people.
- Light beams and shore light drawn above the horizon (read as wavy lines).
- Rock effects, too strong (read as melting; keep them subtle), and swell sets over rocks.
- Floating and sky lanterns, shrine glow and incense, egrets, gust leaves, and a gust-light band through a canopy (judged "makes a little sense, but bad").
- Moon Cat ghost ideas: a ghost cat on the chimney (Codex frames plus RIFE), a ghost in the pumpkin and a ghost ferry were rejected. Ghosts blowing out 10 px windows did not read, and ghost geese looked like clones.
- Kept: one rare, rock-tied painted crab ([painted-cutout-creature-rig.md](painted-cutout-creature-rig.md)), the cloth-sim sheet ghost, a lantern procession and wisps on the lake as background events.

Rule of thumb: a rare event tied to something in the painting beats a new gag.

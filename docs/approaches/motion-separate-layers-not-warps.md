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
  - [Rain Lantern Alley](../../wallpapers/ideas/Working-ideas/rain-lantern-alley/README.md) (no Codex edits): a 5-panel noren curtain cut by colour (only blue thing in its box) and sheared from the rod, with an inpainted interior fill that shows only in the strips a swaying panel uncovers; the painted clouds cut against a cubic sky-gradient fit into a wrapping RGBA strip clipped to the sky mask (a cloud cut by a roof gets a mirrored hidden end). One gust signal drives rain slant, lantern pendulum, curtain, leaves, steam, mist and cloud speed.
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
| 2D puppet warp of Sonic from a flat painting | Sonic dock | Read as a warp, not acceptable as the baseline. See the [Sonic Dock note](../../wallpapers/ideas/stopped-projects.md). |
| Sliding sprites and a frozen car/road composite as "driving" | Cloudsea tracking | Poor art and not enough perceived speed. Replaced by the Blender-to-toon route. |
| A geometric cyclist | Summer Cycle 0.1 | Rejected. Replaced by fixed rider art and two rotating wheel sprites. |

## Notes

- Layer count is not an acceptance criterion. Technical checks (offline, FPS, pause) passing does not mean the look was accepted. Several rejected builds passed all of them.
- Parallax or translation of cut-outs is not "alive" by itself. Give each layer motion that matches what it is.
- Characters ([Moon Cat](../../wallpapers/published/moon-cat/README.md) head, not yet judged): animate the head as cel animation does it. Swap complete drawings (Codex edits of the same enlarged head crop, so they register), and put a drawn in-between held for about 4 frames between poses. A 200 ms cross-dissolve between poses showed ghosted double ears and read as a morph. Put the neck seam where every drawing's contour meets the body within about 2 px. Patch blinks into the rest drawing only where they differ, so the fur doesn't boil.
- Scene life on a painted night town (Moon Cat night-town scene, not yet judged): trees swayed as cut-outs over an inpainted plate (mask by darkness plus the olive rim colour, small fragments next to the tree joined, two inpaint passes; pixels carry a sway weight = height above the root, so one gust signal moves every tree and the root stays put); the lake as a masked region whose reflection rows wander sideways and where thin strokes live 6-12 s; windows switched off and on by a per-window multiplier texture (panes of one window grouped, a warm fade); a falling leaf from a plate model with added mass and circulation (Pesavento-Wang) baked to tracks and projected with a camera looking down, so it flips and foreshortens in 3D. A quasi-steady lift/drag plate without added mass fell straight down and never fluttered. Pitfall: if the removal mask grows after the sway weights are computed, the grown fringe keeps weight 0 and stays behind as a thin wire next to the swaying tree; build the weights from the final mask (nearest tree label) and blur them where neighbours meet.
- Wallpaper Engine: dropdown (`<select>`) controls crashed its embedded renderer in one build, so variants were switched with cycling buttons. The convention for final wallpapers is a few 0-100 sliders (50 = tuned look, 0 = off); not every released wallpaper follows it yet.

- Moving painted shadows ([Summer Crossing](../../wallpapers/published/summer-crossing/README.md) road): shifting a luminance map moved the ground with it, because the map held the cracks and stones, which was obvious on screen. Keep the ground still: a clean plate times `mix(1, R, M moved)`, where M is a texture-free shape from "darker AND bluer than the same material in open sun" and R is the colour drop per material. M has to carry on under the plant edges, or a pale ring appears where the shadow is cut off. Dividing the shadow out of the painting gives pink and green blotches, so that plate takes its colour from the same material in open sun and only local detail from the painting.
- Plants cut from a finished painting (same wallpaper): the pieces are a partition of what's visible, so many have no foot and rotating them about their own pivot reads as spinning in mid-air. Giving each piece a ground line, found by walking down through the pieces under it, and bending it from there fixed that without new art; the cut-off edges still need whole plants drawn.

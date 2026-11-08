# Approaches: what worked and what failed

One page per technique, with the recipe, the numbers and the dead ends. Read the relevant page before repeating work. Wallpaper names link to their public READMEs.

Status: worked, failed or mixed (shipped with caveats, or part of it failed).

| Page | Status | One line |
|---|---|---|
| [cutting-out-a-painted-prop.md](cutting-out-a-painted-prop.md) | worked | Segment an upscaled crop, never the full scene. Finegrain plus SAM2 only where Finegrain drops a part, colour-guided edge at 4x. BiRefNet-matting, SAM2.1-L, HQ-SAM2, ToonOut, Lucida and ViTMatte were worse. |
| [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md) | worked | Use the generation step before a prop as the exact plate under it, and un-mix edge colours against that plate so the ink outline moves with the prop. |
| [sky-matte-at-a-fitted-horizon.md](sky-matte-at-a-fitted-horizon.md) | worked | A matte stored only above the horizon must count texels below it as foreground, or bilinear filtering lets clouds leak as white dashes. |
| [local-preview-caching.md](local-preview-caching.md) | worked | `python -m http.server` lets browsers cache textures. Add `?v=<time>` on localhost only; Wallpaper Engine loads plain paths. |
| [3d-cloth-sim-to-cel-sprite.md](3d-cloth-sim-to-cel-sprite.md) | worked | A Blender cloth sim of a whole character act along the real screen path, toon-rendered (ShaderToRGB ramp, Freestyle ink) into a frame atlas: the Moon Cat sheet ghost, which beat Codex-drawn cycles by a wide margin. |
| [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md) | mixed | Separate cut-out layers with their own motion worked. Warping, morphing or crossfading a flat image was rejected every time. |
| [water-on-painted-scenes.md](water-on-painted-scenes.md) | mixed | Layered lagoon water over a caustic-free seabed worked on A1. Water replacements and warps failed. A busy painted sea cannot carry added water effects. |
| [animated-characters.md](animated-characters.md) | mixed | Every moving character so far and what happened, and the order to try next time: cut-out rig if it never turns, otherwise a real or generated model first, and test the character before mechanics. |
| [Sonic Dock note](../../wallpapers/ideas/stopped-projects.md) | failed | Image-to-video Sonic (blurry, morphing), 3D Sonic and puppet warp were rejected, and added water muddied a painted sea. Stopped. |
| [Golden Boy note](../../wallpapers/ideas/stopped-projects.md) | failed | Pedalling mechanics solved (contacts under 1 mm, exact geared loop), but no version of the rider looked right. Cut-out hybrid rejected; the paid mesh test never ran. Stopped. |
| [upscaling-a-finished-painting.md](upscaling-a-finished-painting.md) | mixed | 4x-UltraSharp to 2x plus mipmaps worked (same frame cost, 3x texture memory); the sharper art exposed AI-garbled props whose repaints took ~50 rounds. Measure colour in Lab, paste repaints whole, fix pointed pixels only. |
| [shrinking-a-finished-webgl-wallpaper.md](shrinking-a-finished-webgl-wallpaper.md) | worked | Merge, crop and flatten textures and cut shader compile at the end of a build: GPU memory 406 to 218 MB, startup 6.1 to 3.6 s, same look. Also Wallpaper Engine's targets, and how to measure without fooling yourself. |
| [workshop-preview-gifs.md](workshop-preview-gifs.md) | mixed | Animated Workshop preview GIFs: ways to capture (real-time recording, clock warp, time-exact hook) and to loop (ping-pong, crossfade, field mixing, natural period). Opaline: calm pace, seamless loop. |
| [fast-train-on-a-painting.md](fast-train-on-a-painting.md) | mixed | A train that's really quick: speed worked out from the painting's scale, blur over one frame of travel, tiled cars, see-through windows, one wake for the reaction. Worked on the Summer Crossing express; too blurry on the slow local, and a slow code-drawn freight was rejected. |
| [whole-plants-from-a-painting.md](whole-plants-from-a-painting.md) | worked | Codex repaints whole plants on magenta; the repaint decides shape and hidden parts, the painting every pixel visible at rest. Bent from a ground line by one wind. Not yet judged. |
| [other-recorded-approaches.md](other-recorded-approaches.md) | mixed | Short entries: parity snapshots (worked), Living Print original-pixel cut-outs (worked), Luminous reveal and fog (mixed), variants then lock-in (worked), Blender block-out plus ID-guided SAM (mixed), depth split (worked), illustrated driving (worked). |

Related: shared tools and setup notes are in [../tools/](../tools/README.md).

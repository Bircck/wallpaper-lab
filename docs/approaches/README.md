# Approaches: what worked and what failed

One page per technique, with the recipe, the numbers and the dead ends. Read the relevant page before repeating work. Wallpaper names link to their public READMEs.

Status: worked, failed or mixed (shipped with caveats, or part of it failed).

| Page | Status | One line |
|---|---|---|
| [look-and-motion-rules.md](look-and-motion-rules.md) | worked | Start here. Taste and motion rules learned across all the wallpapers: base art, motion, sliders, rare events, rejected extras, framing, review habits. |
| [cutting-out-a-painted-prop.md](cutting-out-a-painted-prop.md) | worked | Segment an upscaled crop, never the full scene. Finegrain plus SAM2 only where Finegrain drops a part, colour-guided edge at 4x. BiRefNet-matting, SAM2.1-L, HQ-SAM2, ToonOut, Lucida and ViTMatte were worse. |
| [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md) | worked | Use the generation step before a prop as the exact plate under it, and un-mix edge colours against that plate so the ink outline moves with the prop. |
| [sky-matte-at-a-fitted-horizon.md](sky-matte-at-a-fitted-horizon.md) | worked | A matte stored only above the horizon must count texels below it as foreground, or bilinear filtering lets clouds leak as white dashes. |
| [local-preview-caching.md](local-preview-caching.md) | worked | `python -m http.server` lets browsers cache textures. Add `?v=<time>` on localhost only; Wallpaper Engine loads plain paths. |
| [3d-cloth-sim-to-cel-sprite.md](3d-cloth-sim-to-cel-sprite.md) | worked | A Blender cloth sim of a whole character act along the real screen path, toon-rendered (ShaderToRGB ramp, Freestyle ink) into a frame atlas: the Moon Cat sheet ghost, which beat Codex-drawn cycles by a wide margin. |
| [motion-separate-layers-not-warps.md](motion-separate-layers-not-warps.md) | mixed | Separate cut-out layers with their own motion worked: tree crowns, falling leaves, the Moon Cat witch rig. Warping, morphing or crossfading a flat image was rejected every time. |
| [water-on-painted-scenes.md](water-on-painted-scenes.md) | mixed | Layered lagoon water over a caustic-free seabed worked on Straw Hat Cove, faint crests on a calm sea plate on Summer Crossing. Water replacements and warps failed. A busy painted sea cannot carry added water effects. |
| [painted-cutout-creature-rig.md](painted-cutout-creature-rig.md) | worked | The Golden Shallows crab: a Codex parts sheet, per-piece cut, two-segment IK legs whose gait follows distance walked, walking in and out behind the rock's silhouette. |
| [animated-characters.md](animated-characters.md) | mixed | Every moving character so far and what happened (including the stopped Sonic Dock and Golden Boy projects), and the order to try next time: cut-out rig if it never turns, otherwise a real or generated model first, and test the character before mechanics. |
| [upscaling-a-finished-painting.md](upscaling-a-finished-painting.md) | mixed | 4x-UltraSharp to 2x plus mipmaps worked (same frame cost, 3x texture memory); the sharper art exposed AI-garbled props whose repaints took ~50 rounds. Measure colour in Lab, paste repaints whole, fix pointed pixels only. |
| [shrinking-a-finished-webgl-wallpaper.md](shrinking-a-finished-webgl-wallpaper.md) | worked | Merge, crop and flatten textures and cut shader compile at the end of a build: GPU memory 406 to 218 MB, startup 6.1 to 3.6 s, same look. Also Wallpaper Engine's targets, and how to measure without fooling yourself. |
| [releasing-a-wallpaper.md](releasing-a-wallpaper.md) | worked | Finish pass, Wallpaper Engine approval targets, checks, preview GIF, media, listing and publishing, as done for the eight released wallpapers. |
| [workshop-preview-gifs.md](workshop-preview-gifs.md) | mixed | Animated Workshop preview GIFs: ways to capture (real-time recording, clock warp, time-exact hook) and to loop (ping-pong, crossfade, field mixing, natural period). Opaline: calm pace, seamless loop. |
| [wind-weather-and-ambient-life.md](wind-weather-and-ambient-life.md) | mixed | Gust schedules, branch and crown sway, steam, mist, lightning, a lighthouse beam, koi and falling leaves: amplitudes that read and ones too small to see. |
| [fast-train-on-a-painting.md](fast-train-on-a-painting.md) | mixed | A train that's really quick: speed worked out from the painting's scale, blur over one frame of travel, tiled cars, see-through windows, one wake for the reaction. Worked on the Summer Crossing express. The slow local shipped with a tiny blur, a soft bob and turning wheels; a slow code-drawn freight was rejected. |
| [whole-plants-from-a-painting.md](whole-plants-from-a-painting.md) | worked | Shipped in Summer Crossing: a clean Codex ground plate plus whole Codex plants on magenta, bent from their roots by one wind. Far trees as leaf clumps, flowers redrawn per head. Leaving painting pixels in the ground doubled the plants. |
| [other-recorded-approaches.md](other-recorded-approaches.md) | mixed | Short entries: parity snapshots (worked), Living Print original-pixel cut-outs (worked), Luminous reveal and fog (mixed), variants then lock-in (worked), Blender block-out plus ID-guided SAM (mixed), depth split (worked), illustrated driving (worked). |

Related: shared tools and setup notes are in [../tools/](../tools/README.md).

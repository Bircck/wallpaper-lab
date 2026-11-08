# Upscaling a finished painted wallpaper

Status: mixed. Worked for the art, but cost about 50 repaint rounds on one prop. Done on [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md), with later lessons from [Golden Shallows](../../wallpapers/published/golden-shallows/README.md).

## Recipe that worked

- Upscale every painted layer with a spandrel 4x model, then Lanczos down to exactly 2x, so textures keep a 2:1 mapping
  onto the data grid the shader measures in (sample painted art by normalised UV, data by the 1x grid). Cut-outs get
  their colour bled into alpha 0 first (push-pull). Data textures are never upscaled.
- Pick the model on a full-frame swap page. 4x-UltraSharp won over Remacri and anime ESRGAN.
- Mipmap the upscaled painted textures: without them frame cost rose from 2.2 to 5.5 ms at 1080p.
- Check water motion numerically (frame-to-frame change in a few regions): unchanged.
- Cost on the 1070 Ti, headless: GPU ms/frame unchanged, texture memory 96 -> 296 MB, start-up
  +0.4 s warm (cold start is shader compilation, ~6 s either way).

## The catch: sharper art exposes AI-garbled props

The upscaler sharpened garbled katana handles and a blob cigarette. Codex edits of enlarged 2x crops, aligned (phase
correlation) and pasted only inside each prop, fixed them. But:

- Repaints drift to more chroma and contrast than the scene. Measure each material in CIE Lab against the painting's
  own version of the prop and nearby references ; the "too shiny / vibrant" complaint was exactly
  that. A Codex "rough" repaint got the matte look; its dirt was removed by colour (warm spots on neutral lacquer).
- Asking only for "clean" gives glossy vector shapes (Luffy's vest buttons: much better, but not matching the style of
  the scene). A second Codex pass on the clean result fixed it in one round: matte, the palette of a nearby prop (the
  straw hat), the scene's leaf shadows falling across them, soft line art in the cloth's dark red instead of black.
  Put those words in the first prompt. Count and size are a taste call: show 2-3 versions (5 buttons won over 4 or 9).
- Under moving cloth the repaint goes into the clean plate too, or the swing reveals the old paint.
- Masks built from another version's colours miss slivers (an emblem's edge, a rim strip) that then survive every fix.
  Pasting the repaint whole, outline to outline, avoided seams near the emblems.
- When a reviewer circles a small spot: zoom their crop with a pixel grid, find exactly those pixels, change only them and fill
  from their own neighbours. Widening the fix (all emblems, outlines, black bands, darker-of-two blends) made it worse
  every time and cost a dozen rounds.
- Compare against the earlier liked versions at the reviewer's screen size before showing a new one; after ~30 rounds the
  result was judged barely better than an early version until its one real flaw was fixed by hand.

## UltraSharp hardens soft smudges (Straw Hat Cove)

On the last check a weird border showed beside the white sword and the crate. Each prop's Codex edit had left a soft smudge on the ground, harmless at 1x, and the upscaler gave those smudges hard edges, so they read as a pane of glass. A repaint can also leave the old outline just outside the new one. Look at the step before the upscale to tell which you have.

- A soft band or smudge on open ground: a Laplace fill from the sand around it, with no flux from the props beside it so their colour can't leak in, plus the sand's own high-pass so it doesn't read as a smooth stripe. The edges came out clean.
- A shape that has to read as painted, such as a strip of ground between two props: the same fill was a flat smear (rejected). Sample real painted pixels from a similar spot, mapped row by row onto the strip's width, and match tone only at the ends. If the source has a bright or dark mark, shift the rows until it falls outside the strip.
- A whole new backplate is possible without Codex: the prop-free plate softened by a 0.9 px Gaussian, then upscaled, gets close to the upscaled plate's soft brush shapes (unsoftened it came out as chunky broken pieces). Rebuild each prop with fitted edges and add soft contact shadows. It was the most coherent with the background, but the patched plate was kept, because its ground shadows suit the props better. Show both.
- A prop edge that runs through clutter: read it off the art row by row and hard-code it. Automatic edge searches kept cutting into the sheath or stopping at twigs. Where the edges are clean, a robust cubic through the darkest pixel per row followed each ink line well.
- "Too clean" next to rougher neighbours: chips and patches transferred from other repaints did not work well. Monochrome noise worked: grain plus streaks stretched along the prop's curve, at about 1.2 texels wide, because finer grain averages away at 1080p. Show levels and kinds on a swap page.
- Pure black ink next to soft grey on the same prop looks harsh. Lift only the dark pixels toward a soft colour, which keeps the line's shape.

## Raising an offscreen pass above its mask grid (Golden Shallows)

Golden Shallows drew the land and sky into a 1672x941 FBO (its mask grid) and stretched that to the screen, so even a sharper art file couldn't show. Rendering that pass at about screen resolution made the land and sky visibly crisper at 1080p (cost 0.86 -> 1.14 ms), and the existing 1x art then looked fine, so no 2x layers shipped. The catch: data maps sampled bilinearly between their texels. The tree-crown layer kept its "matte behind" and fill colour only inside the crowns and zeros outside, so the edge texels blended toward empty and thin light lines appeared along the crowns (a visible cut-out edge artefact). Give such maps the painting's own values in a few-pixel ring outside their region (or sample them at texel centres). Images bigger than the target are resampled once at load with a high-quality canvas draw instead of mipmaps, because the clouds wrap with `fract()` and the crowns are sampled inside branches, both of which break mip LOD.

## An offscreen pass must be exactly 1:1, and UltraSharp can weave a mesh (Golden Shallows)

"Near" screen resolution was not enough. The arch's rock looked not sharp, as if it had a grid or pattern on it. There were two causes, and the first was hiding the second.

- **An off-by-one pass.** Its height came from the mask grid's aspect (1672/941) while the art is 1920x1080, so at 1080p the pass was 1920x1081. Rows drift by up to half a pixel mid-frame, in both passes, and the rendered rock kept 0.4 of the art's detail (Laplacian variance). Take the aspect from the art, make the pass exactly the size of the part on screen, and start it on a whole texel. A pass with a fixed floor above the window size beats against fine detail the same way. Measure a rendered frame against the art; looking at the art alone shows nothing wrong.
- **A mesh in the art.** UltraSharp sharpened a fine pattern in the original into a woven dot mesh on rock. Running it on the original softened by a 0.9 px Gaussian kept crisp brush edges with no mesh; 0.6 px left the mesh, Remacri was clean but added a dark rim, and Lanczos was soft. Replacing only a masked area needs nothing else: lock the colour to the master with a 3 px blur and stay well inside the land matte, so the silhouette can't change.
- **The blur was the real complaint.** Shown all four full frames at 1:1, the blur fix with the art unchanged won over the mesh-free versions. A mesh that shows at 2x may not matter at the real screen size, so check at 1:1 before reworking the art.


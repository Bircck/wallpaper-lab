# Sky matte at a fitted horizon

Status: worked (one bug found and fixed in review). Used in [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md) (`package/scene.js`).

## Problem

The clouds drift over a clean sky plate, and the foreground (jungle, leaves) is drawn over them through a matte. The matte is stored only above the fitted horizon line. Below the line the same channel (`fx-c.r`) holds another mask (the cloth water weight, which is 0 behind the jungle).

The fitted horizon is tilted and runs behind the jungle on the right. A plain bilinear tap near the line mixed in the 0 texels below it. The matte then read as "background" for the bottom of the cloud strip, so clouds showed through along that row as white dashes about 100 px below the top on the right.

## What worked

In `skyMatte` (`mtTexel` and `skyMatte` in `wallpapers/published/straw-hat-cove/package/scene.js`):

- Sample the matte by hand with four `texelFetch` taps and the same bilinear weights.
- For each tap, compute the horizon row at that texel's x (`uHorA + uHorB * x`). If the texel is on or below the line, or in the last row above it, return 1 (foreground) instead of reading the texture.
- Everything below the horizon is foreground by definition, so no stored value is needed there.

Edge colours of the foreground over the cloud are un-mixed in the shader as `F = (I - (1-m)*B0) / m`, where B0 is the sky as painted behind the foreground, baked into `fx-a` rows 0-139. At zero cloud drift this reproduces the source exactly.

Result: 0 dash pixels at 5 test times. The frame changed only within 2 px of the horizon (left sea horizon at most 25/255 on 21 px).

## What failed

- Plain bilinear filtering of a matte that is stored only on one side of a boundary, where the other side holds unrelated data. The same bug appears for any packed channel: a filter across a region edge mixes in the neighbour's meaning.
- The matte itself was fine above the line. Only the lookup at the boundary was wrong.

## Rule of thumb

If a mask is stored on only part of the image, the filtered lookup must substitute the known value for texels outside that part (here, foreground = 1) before filtering. Check the lookup at the boundary at several times with the clouds moving.

## Related

Clouds are a long RGBA strip drifting one way over the clean sky plate (Codex-painted real RGBA clouds with soft alpha, no segmentation). The sine-sway clouds of the first build and the "behind foliage" variant were replaced by it.

Code: [scene.js](../../wallpapers/published/straw-hat-cove/package/scene.js) (search `skyMatte`).

## Making a drifting cloud layer from a finished sky (Golden Shallows)

- Sky plate: a Codex "clear sky" edit is used only for its sky pixels (4 px clear of the matte), filled behind the foreground by multi-scale normalised convolution and colour-matched at low frequency. The usual "blue-dominant" sky test fails on a warm sunset sky, so classify with a tiny MLP trained on confident pixels.
- In the unknown band take alpha as the pixel's projection on the line between the nearest pure-sky and pure-foreground colour (no 3-4 px halo). Closed-form matting is only the fallback where the two colours are within 40 levels. Move painted rim-light pixels that hug the foreground (703 px there) into the foreground so they travel with the trees.
- Solve the cloud layer as `a = max(a_min, |source - plate| / 85)`, `C = plate + (source - plate) / a`.
- A layer that reproduces the still also carries the painting's quirks, and they travel when it drifts: an empty disc at the sun, the glow column under it, smeared fill behind headlands, a visible line where tile bands joined (cross-fading the ends of a wrapping tile cannot work, nothing exists past the last column).
  - Fix: keep only directly solved visible sky and refill the rest by quilting real texture from the same layer on a cylinder. Source at least 300 px away, never copies of copies, candidates scored with `cv2.matchTemplate` on the overlap band, min-cut seam, ~2 px premultiplied feather, per-patch colour gain at most 1.65, alpha shapes never changed, fixed seed. Refill 44 px either side of the wrap.
  - Make the sun glow a fixed screen-space rule in the shader (clouds in a column under the sun lose 35 % alpha and are warmed 20 %). Known residue: repeated cloud shapes where real sky is scarce (low rows).

## Wrapping cloud strips (Summer Crossing)

- A Codex-extended strip section that comes with its own sky (semi-opaque canvas, mean alpha .23-.81 over open sky rows against .005 on the painted part) gives colour steps and pale ghost clouds. Key the whole strip against one sky per row (each section's own sky on its section), quilt real cloud over the pole column and the joins, and check six or more positions across the full cycle (706 s) for vertical lines or fades.
- Matte holes over far hills let sky draw over them; check what surrounds a fixed spot. Sky plates cannot be rebuilt byte-exactly if the mask inputs changed, so keep the shipped plates.
- Wires redrawn live (not painted into the matte) removed the fringe and let them sag and ring. A contrail crossing the wires (not parallel to them) is not read as a third wire.

## A night sky with a moon

- Do not store clouds as a signed additive delta with a special over-composite inside the moon disc: that gave grey outlines and moon fragments drifting with the clouds. Use a real premultiplied RGBA cloud layer over a cloud-free plate with the moon baked into the plate (upload without premultiplication or colour conversion).
- Where alpha is 0 the plate is the painting and the layer must be zero, or a non-cloud residual (lamp glow minus the smooth sky estimate) drifts away as a ghost lamp room with a dark halo.
- A thin moon rim followed the cloud because the edited disc differed from the painted one by a hair: open the cloud membership in a ring around the rim and allow only core alpha there. If a cloud overlaps the moon in the concept, one crop edit removing clouds around it supplies the plate.
- Extraction recipes for the layer itself: [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md#4-soft-layers-painted-on-a-plain-canvas).

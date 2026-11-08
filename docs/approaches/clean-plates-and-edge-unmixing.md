# Exact clean plates and edge un-mixing

Status: worked. Used for the moving hats, vest, bandana and leaves in [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md).

## Problem

A prop that moves must not carry or reveal anything but itself. If the cut-out contains a band of ground, the ground moves with it. If the layer behind it is inpainted, the hole shows smeared fill. And if the cut-out's edge pixels are a mix of prop and old background, the old background rides along and shows as a fringe on the new one.

## What worked

### 1. Use the generation steps as exact plates

The A1 scene was built by adding one prop at a time with Codex image edits, and each step's composite was kept. The composite of the step before a prop is the scene without that prop, pixel-aligned with the painting. For Chopper's hat that was the composite of the step just before the hat was added.

- Put that step behind the moving prop, and only where the prop layer's alpha > 0. Everywhere else the painting stays, so painted contact shading and shadows do not move.
- Do not trust the plate outside the prop. The hat step repainted shading around the hat and parts of the crate, so the plate differs from the painting there. Using it only under the prop avoids that.
- Keep alpha, shadow and the step's "before" image together for every prop.

### 2. Un-mix edge colours against the plate

For an edge pixel with painting colour S and plate colour B, the prop colour F satisfies S = a*F + (1-a)*B. Solve for F, and raise alpha only as far as is needed to keep F inside 0..255 (per channel a >= 1 - S/B and a >= (S-B)/(255-B)):

```
amin = max(1 - S/B, (S-B)/(255-B)) over channels
a    = max(a_cut, clip(amin, 0, 1) + 1/255)   where a_cut > 0
F    = clip((S - (1-a)*B) / a, 0, 255);  F = S where a > 0.995
```

Outside alpha 0 the colours are bled outward (push-pull). Result: the dark ink outline keeps its weight and moves with the prop, the resting frame equals the painting, and no old background shows when the prop moves. The rest frame differs from the painting in 18 px above 24/255 (the first hat build had 83).

### 3. Composite only the changed region when making the plates

Codex re-renders the whole frame on every edit (median Lab drift outside the target about 3.4-5). Composite the changed region back onto the source and feed that composite, not the raw output, into the next step. Check alignment before building on a plate, and resize if the output is off by 1 px in width.

For added props, a difference matte (before vs after the edit) plus SAM refinement on the changed region gave the cut-out, with a convex-hull option for solid convex props such as hats, bottle and book. Check the alpha holds only the object, with the contact shadow in a separate file.

## What failed

- Forcing the resting frame to equal the painting with a cut that carried the mixed edge pixels and the hat step's repainted surroundings. The hat layer then included crate and ground and visibly moved part of the background.
- A hat layer from the painting's hat pixels only with the plate behind it. Better, but the mask came from low-res SAM output (see [cutting-out-a-painted-prop.md](cutting-out-a-painted-prop.md)), and the layer was still rejected.
- Falling back to the painting in the plate where un-mixing clipped: it caused pink and blue specks.
- Telea inpainting under the hat: removed after a brief try.
- Using the plate difference as the mask. Inside the hat the difference is exact (only 3 pixels had |painting - plate| <= 3), but in a 1-3 px ring outside it the hat step's repainting gives a median max-channel difference of 8-9 and a 90th percentile near 33, as large as the ink outline against a dark plate. It also fails where the brown antler lies on the brown scroll. Use the plate to remove plate-identical gaps (ground between crown and antler) and as a sanity score, not to place the edge.
- Independently generated empty plates for a whole scene: one reframed the scene and moved rocks, another drifted the furniture. Neither could be used for difference matting or hidden fill.
- Per-object compositing of independently generated props: style and perspective mismatch. One cohesive scene plus one-edit-at-a-time props worked.
- Contact shadow inside a prop's alpha (the bottle once had it). Shadows go in their own file.

## Other points recorded

- Moving cut-outs need a filled plate behind them. Keep roots and contact points fixed with a root map, or plants "glow" and drag neighbours.
- Binary alpha cannot represent glass. Keep shine on lens pixels only and fizz inside the liquid mask.
- `codex exec`: a trailing `-` after `-i <img>` is read as another image. Write prompts as UTF-8 (a CP1252 "é" once broke a run). Create log folders before redirecting into them (the "step 1 error" was a shell redirect into a missing `steps/` folder).

- Koi Garden: one Codex edit re-lit the whole plate (day to dusk) and two chained edits removed the branch, then the pads, from it. A Codex re-render drifts up to about 1 px and shifts tone, so each output was registered back onto the old plate's pixel grid (DIS optical flow on local-contrast-normalised high-pass luminance, flow smoothed hard, structure under the removed object excluded), which kept every mask and the steering field valid. Only the removed object's neighbourhood came from the clean render, feathered and tone-matched, so the rest stays the registered re-light. Pad drop shadows were rebuilt as an alpha from painting vs clean plate and baked under each pad.

- [Summer Crossing](../../wallpapers/published/summer-crossing/README.md) road: moving shadows over a clean plate. A luminance map holds the ground's own cracks and stones, so moving it moves the ground (the ground moved instead of the shadows). Paint the plate in even sun and the shadows alone with Codex, then take the shape as how shaded the painting is against the plate: texture cancels because it's in both. Runtime is `plate * mix(warm, shadow colour, shape)`. Measure stillness with shadow strength 0: the ground must change 0.0000.

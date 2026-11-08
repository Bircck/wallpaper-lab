# Cutting out a painted prop

Status: worked (after several failures). Test case: Chopper's hat in the [Straw Hat Cove](../../wallpapers/published/straw-hat-cove/README.md) scene (1672x941).

## Problem

A moving cut-out has to be as clean as a manual cut. The bar: as clean as a 10-second manual cut. Every earlier hat layer failed it: it carried crate and ground, lost an antler, or had blobby edges, and the hat visibly moved part of the background. The usual cause was running a segmenter on the whole scene.

## What worked

Result: `c6-guided-r4e3` (alpha) and `c6-final-defringed` (edge colours cleaned), installed in the A1 wallpaper.

1. Pick a box around the object. Crop it and upscale the crop (Lanczos). Run every segmenter on the crop, never on the full scene.
   - SAM2 resizes its input to 1024 and decodes 256x256 logits. On a 1672 px scene that is about 6.5 source px per logit cell. That gives blobby edges and leaks, and it was the root cause of the rejected hat layer.
   - On a square crop of about 210 px the same 256 logits cover about 0.8 px per cell. With the crop at 288 px it is about 1.1 px per cell.
   - Map every prompt (box, points) into crop coordinates, and use the same crop for all models.
2. Run Finegrain Box Segmenter on the upscaled crop (box plus about 8 px margin, Lanczos pre-resize). It follows the dark ink outline and the left antler exactly. It drops the right antler (faint alpha only) and leaves a 2-3 px slit between crown and antler.
3. Union with SAM2 (also on an upscaled crop, box plus points, single-mask output) only inside a window around the part Finegrain drops. Here that was the right antler, window x 862-915, y 750-820. Do the union at 4x and area-downsample, which gives an anti-aliased edge. SAM2 alone drops the ink outline and bites a notch where the band meets the left antler, so it is only used where needed.
4. Snap the edge to the painting: at 4x, run a colour-guided filter (guide = Lanczos 4x painting), smoothstep, then area-downsample. This closed the small holes and the slit and removed leaks.
5. Replace the RGB of edge pixels (alpha < 0.98) with the nearest solid hat colour to remove tan/grey fringe on other backgrounds (`c6-final-defringed`).
6. Look at the result at 4x on checker and on magenta, next to what a 10-second manual cut would give, before building on it. Check both antlers.
7. In the wallpaper the cut is used with edge colours un-mixed against the known clean plate. See [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md).

Choose per object. The earlier survey (eight objects, two scenes) found Finegrain best first for small props (straw hat, slingshot, vest, sword bundle, hanging hat), and SAM2 better for Chopper's hat because Finegrain dropped an antler (for the veranda straw hat it was Finegrain or SAM2). A neat silhouette can still be the wrong object, so check that every attached part is in. Decide up front whether attached parts (antlers, strings, cast shadow) belong in the layer.

Scripts: the Finegrain and SAM helpers are in [docs/tools/cutout/segment.py](../tools/cutout/segment.py) (`finegrain(bgr, box, margin)`, `sam(bgr, points, box)`); the difference matte and SAM refinement for props added by a Codex edit are `diff_matte.py` and `sam_refine.py` in the same folder. Setup and run times: [cutout-segmenters.md](../tools/cutout-segmenters.md).

## When the models keep missing

- Fix membership first with a mask brush or path (Krita magnetic selection, Photopea Magic Cut, GrabCut scribbles), and only then soften edges. A segmenter that keeps picking the wrong part will not be fixed by a better matting pass.
- Thin rigid parts (swords, straps) are often quicker with a manual path than with another model.
- A flat woodblock print: rembg and GrabCut failed; polygons plus ink-colour thresholds and donor patches taken from the print's own pixels worked.
- Useful minimum tool: box selector, model switch, positive/negative clicks, editable mask, background toggles (checker, black, white, magenta), aligned RGBA export with bounds and pivot.
- Pixels exposed by motion (background and the occluded part of the object) need a clean plate or a repaint; a perfect mask cannot supply them.
- Glass keeps the scene seen through it as opaque RGB with every segmenter. It needs a lens/liquid mask or a repaint, not alpha.

## Cut-outs that sit against the sky (tree crowns)

Used for the skyline pines in [Golden Shallows](../../wallpapers/published/golden-shallows/README.md).

- Segment each crown on a 2x upscaled crop resized to 1024: SAM2 for crowns Finegrain faded or merged with a bush, Finegrain where SAM leaked, union for two.
- Alpha = segmenter membership x the existing sky matte. The sky edge is then the proven one, and the rest frame equals the painting (0 of 2.07M pixels differed at wind 0).
- Edge pixels between model and matte go to the nearest seed; needle specks within 8 px join the crown; cut at the trunk base. Where the crown overlapped canopy, continue matte and colour by normalised convolution (only a 1-3 px sliver ever shows).
- Lit trees inside a dense canopy need no segmenter: a Codex edit "remove the lit trees, paint the darker forest behind" on a 3.2x crop with a magenta-tinted guide image (two groups of 1 and 3 regions) gave a plate on the first try (drift outside the regions 4.8-7.3 levels, registration under 0.5 px). Tone-match the plate to the painting at low frequency (sigma 14), then take membership as a Lab difference between painting and plate (threshold 24, inside a hand polygon grown 8-10 px). Thresholding alone gives holey silhouettes; a 13.5 px closing plus hole fill fixes it at the price of blobby edges that only show against the plate. Pale masses with no readable outline cut badly. A polygon edge that cuts a trunk in two lets a pale fragment slide off: add an exclusion box after the closing.

## What failed or was worse

| Attempt | Result |
|---|---|
| SAM2.1-Tiny on the full scene | 256x256 logits at 6.5 px per cell. Blobby edges, background leaks. |
| SAM2.1-Tiny crop, multimask or no box | Leaks into crate and scroll, or speckle. Use box plus points with multimask off. |
| SAM2.1-Large on a crop (320 px, multimask index 1) | Both antlers complete, but a stair-stepped hard edge, black ink outline cut, scroll specks on the antler, pinholes. |
| HQ-SAM2 on a crop | Emits 1024x1024 logits, so edges are smoother, but it leaks a chunk of scroll above the right antler. |
| BiRefNet (ONNX or HR-matting) | Drops the outer ink line, and HR-matting drops the right antler completely at every crop size. |
| BiRefNet_HR-matting + plate gating + pymatting (candidate D) | Cleanest of the new-model tries, but loses the dark ink outline at the brim and has softer antler edges. Not installed. Side by side with c6 the brim outline is visibly missing. |
| ToonOut, Lucida | Pull in the scroll above the right antler (+900 px). Rejected. In the first survey ToonOut also kept neighbouring objects, and Lucida gave haze or near-empty results on some targets. |
| ViTMatte (trimap from the mask) | Softer edges, halo, 40-100 px of hat shaved, ink line partly lost. It refines an uncertain edge, it does not fix membership. |
| pymatting closed-form, 2 px trimap band | Treats the dark ink outline as shadow background and eats it. A 1 px band keeps it. |
| Plate difference as the mask | The hat step repainted shading around the hat (halo of difference 8-33 levels in a 1-3 px ring), so the difference cannot place the edge. See the plate note in [clean-plates-and-edge-unmixing.md](clean-plates-and-edge-unmixing.md). |
| Known-background alpha solve (`alpha = <I-B, F-B>/|F-B|^2`) | Speckled, pulled in the repainted shading. |
| Neutralising plate-identical pixels to grey before BiRefNet | The grey patches became the salient object and flooded crate and scroll. |
| 2-of-3 vote of BiRefNet, HQ-SAM2, SAM2 | Pulled dark scroll shadow onto the antler. |
| Earlier in-wallpaper cuts (SAM full-scene mask plus "within 14 px that differs from the plate") | Included a band of crate and ground, so it moved with the hat. |

Not run, only researched: SAM3, SDMatte, Qwen-Image-Layered, See-through, LayerD, BEN2. The web report judges them a poor fit (size, Pascal GPU support, generative layers instead of source pixels).

Note: the candidate notes call D the best of the new-model tries, with its ink outline kept at a 1 px trimap band. The side-by-side comparison shows the brim outline missing in D, so c6 is the installed winner. Trust the comparison image.

## Remaining flaws of c6

- A 1-2 px dark strip between the crown and the right antler stays in the mask.
- A small pale speck at the left antler and brim junction (about x 790, y 830).
- The antler window is hand placed and tied to this box. No ground truth exists, so judgement is visual plus the plate leak/miss score.

## Environments

- CPU (SAM2.1-Tiny, Finegrain ONNX, BiRefNet ONNX): a plain Python venv with onnxruntime, run with `python -I`.
- GPU (GTX 1070 Ti, Pascal sm_61): PyTorch cu126 wheels, because cu128 and newer dropped sm_61. A venv with BiRefNet, SAM2.1-L, HQ-SAM2, pymatting and ViTMatte came to 4.9 GB plus 2.9 GB of models; keep it out of git. See [cutout-segmenters.md](../tools/cutout-segmenters.md) and [python-environments.md](../tools/python-environments.md).
- On Pascal use fp32 or fp16, not bf16.

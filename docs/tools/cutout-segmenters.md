# Cut-out segmenters and matting

Cutting a moving prop (hat, vest, bottle, plant) out of a painted 1672 x 941 scene. Pick the tool per object. Nothing here was scored against ground truth; every verdict is a visual judgement on crops of one painted pirate-cove scene.

Approach summary (what to combine and why): [cutting-out-a-painted-prop](../approaches/cutting-out-a-painted-prop.md). Environments: [python-environments](python-environments.md).

## Which tool for what (as tested)

| Tool | Use it for | Verdict on this artwork |
|---|---|---|
| Finegrain Box Segmenter (ONNX, CPU) | First pass on a small prop: draw one box | Best silhouette and ink outline on most props (hanging hat, vest, swords, slingshot). Dropped one of a reindeer character's antlers. Foliage: some leaves fade. |
| SAM2.1 Hiera-Tiny (ONNX, CPU) | Corrections, parts Finegrain drops (the missing antler), water/sky/cliff masses | Fine with positive/negative points. On the full 1672 px image the mask is blobby (see pitfalls). |
| SAM2.1 Hiera-Large (GPU, transformers `Sam2Model`) | Same, on an upscaled square crop | `multimask_output=True`, index 1 ("whole object") on a 288-320 px crop got both antlers. Edge is stair-stepped (1 px, no anti-aliasing). Not usable alone. |
| HQ-SAM2 (GPU, vendored code) | Tried as a sharper SAM | Logits are 1024x1024, so smoother than SAM2.1, but it leaked a neighbouring scroll over the antler. Second tier after plate cleanup. |
| BiRefNet (general ONNX, CPU) | Hanging hat, slingshot | Credible, not a winner. Drops an antler. |
| BiRefNet_HR-matting / dynamic-matting (GPU, `trust_remote_code`) | Soft alpha with fine edges | Cleanest edge of all models, but HR-matting drops the right antler entirely; needed a second pass with `dynamic-matting` on a tight antler crop. Lost the dark ink outline against the guided Finegrain cut. |
| ToonOut, Lucida v7 (GPU) | Anime-character foreground removal | Group neighbours together, leak the scroll; Lucida lost several targets. Reject for props. |
| ISNet-Anime (ONNX) | - | Empty output on several props. Skip. |
| ViTMatte base (GPU) | Edge refinement from a trimap | Softens hard painted edges and shaves 40-100 px off the hat. Cannot fix wrong membership. Equivalent to pymatting in the hands-on test, no gain. |
| pymatting (CPU, closed-form + `estimate_foreground_ml`) | 1 px alpha band around an already correct binary mask, and colour decontamination | Works with a trimap band of erode 1 / dilate 1. A 2 px band eats the dark ink outline. Wide bands add purple haze. |

Not run (documented only): SAM3/3.1, SDMatte, Matte Anything, Background Matting V2, Qwen-Image-Layered, See-through, LayerD. Do not treat survey text as test evidence for them.

## Where to get the models

All weights are local-only (gitignored, kept under `docs/tools/models/` or in your own cache). Downloads are large; fetch only what you need. Licences are as stated on the hosting page when checked (2026-11-08); re-check before shipping anything derived from them.

| Model | Get it from | File | Licence |
|---|---|---|---|
| Finegrain Box Segmenter (ONNX) | Hugging Face [`MarcinEU/finegrain-box-segmenter-ONNX`](https://huggingface.co/MarcinEU/finegrain-box-segmenter-ONNX), revision `544d5cc37109d3e8d318e9368a2467fcd99ac8c5` (export of [`finegrain/finegrain-box-segmenter`](https://huggingface.co/finegrain/finegrain-box-segmenter)) | `onnx/model.onnx`, 396,227,663 bytes, SHA-256 `a7db4845ed4a557ccb285048e3562c611b762b836d2bd5b809100c34f79a3c1e`. Saved locally as `docs/tools/models/finegrain/finegrain.onnx` | MIT |
| SAM 2.1 Hiera-Tiny | Hugging Face [`facebook/sam2.1-hiera-tiny`](https://huggingface.co/facebook/sam2.1-hiera-tiny); original checkpoint `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt` (from [facebookresearch/sam2](https://github.com/facebookresearch/sam2)) | `model.safetensors` (155,908,064 bytes) or `sam2.1_hiera_tiny.pt` (156,008,466 bytes). The ONNX encoder/decoder used here were exported from the `.pt` with Microsoft's onnxruntime SAM2 exporter | Apache-2.0 (as tagged on Hugging Face) |
| SAM 2.1 Hiera-Large | Hugging Face [`facebook/sam2.1-hiera-large`](https://huggingface.co/facebook/sam2.1-hiera-large) | `model.safetensors` (897,897,416 bytes), loaded with `transformers.Sam2Model` | Apache-2.0 (as tagged) |
| HQ-SAM2 | Hugging Face [`lkeab/hq-sam`](https://huggingface.co/lkeab/hq-sam) plus code from [SysCV/sam-hq](https://github.com/SysCV/sam-hq) (used at commit `e696978d`) | `sam2.1_hq_hiera_large.pt` (898,844,313 bytes) | Apache-2.0 (code and HF tag); the repo calls the SAM 2 checkpoints "beta" |
| BiRefNet | Hugging Face [`ZhengPeng7/BiRefNet`](https://huggingface.co/ZhengPeng7/BiRefNet), plus the matting variants [`BiRefNet_HR-matting`](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting) and [`BiRefNet_dynamic-matting`](https://huggingface.co/ZhengPeng7/BiRefNet_dynamic-matting) | `model.safetensors` (444,473,596 bytes each) plus the repo's remote code (`trust_remote_code=True`) | MIT |
| ViTMatte (base, composition-1k) | Hugging Face [`hustvl/vitmatte-base-composition-1k`](https://huggingface.co/hustvl/vitmatte-base-composition-1k) | `pytorch_model.bin` (386,836,309 bytes) | Apache-2.0 (as tagged) |

The upscalers and TripoSR have their own notes: [upscalers.md](upscalers.md), [image-to-3d.md](image-to-3d.md).

## Example recipe: a hanging hat with a missing antler

This was the cut that went into the finished cove wallpaper:

1. Finegrain on a box + 8/6 px crop, Lanczos pre-resize to 1024.
2. Union with SAM2.1-Tiny on an upscaled square crop, only inside a hand-placed window around the missing antler.
3. Do the union at 4x supersampling, then a colour-guided filter (guide = Lanczos 4x painting), smoothstep, area-downsample. A de-fringed copy (same alpha, edge colour cleaned for other backgrounds) is handy for compositing on other plates.

A BiRefNet candidate (8-view test-time augmentation, dynamic-matting antler, plate gating, pymatting 1/1) was clean but lost the ink outline on the brim and had softer antler edges, so the Finegrain + SAM recipe stayed.

## How to run

Commands run from the repo root. `PY` is a CPU venv with onnxruntime and OpenCV, `GPU` the GPU venv ([python-environments.md](python-environments.md)).

```
PY=<path to the CPU venv's python>
GPU=docs/tools/gpu-venv/Scripts/python.exe
```

### Finegrain in a pipeline
The ONNX file has no box input: the box is the crop. Preprocessing, common to all ONNX segmenters here: crop, RGB, resize to 1024 x 1024 (bilinear; Lanczos for upscaled crops), divide by 255, ImageNet mean/std, NCHW float32, run, apply sigmoid once to the logits, resize the probability back to the crop size. Keep this in one helper (`finegrain(bgr, box, margin)`, `sam(bgr, points, box)`) instead of rewriting it per script.

### SAM2.1-Large and HQ-SAM2 (GPU)
Run on an upscaled square crop of 288-320 px (see pitfalls). SAM2.1 loads through `transformers.Sam2Model`; HQ-SAM2 needs the SysCV code on `sys.path`. Use fp32 on Pascal (see python-environments).

## Pitfalls found the hard way

- SAM2 emits 256x256 logits per 1024 input. On the full 1672 px scene that is about 6.5 source px per cell: blobby edges and background leaks. Always run on an upscaled square crop (224-320 px to 1024), map every box and point into crop coordinates (`(x - x0) * 1024 / S`), upsample logits (not the thresholded mask), threshold at 0.
- A square crop of about 210 px gives about 0.8 px per cell. Crop size S=224 left holes in the band, 320 was best for SAM2.1-L.
- Multimask outputs and no-box configs of SAM2.1-Tiny leak into neighbours or turn to speckle. Use box + points, single mask.
- Check both antlers. A neat silhouette can still be the wrong object (Finegrain, BiRefNet).
- Cropping SAM is not an automatic upgrade: in the survey it hurt the slingshot, swords and red band.
- More margin for Finegrain is not always better; compare 0% and 5%.
- The generated clean plate is exact inside the object but repainted around it (a 1-3 px halo, contact shadow). It cannot place the edge. Use it to remove plate-identical gaps (ground seen between crown and antler) and as a leak/miss score, not as a matte.
- Flattening plate-identical pixels to grey before BiRefNet makes it select the grey patches. Do not.
- pymatting colour decontamination matters: the same alpha with raw painting colour shows a grey halo on white and magenta.
- Hard-edged painting: a snapped binary mask plus a guided-filter edge beat ViTMatte and plate-projection alpha.
- Binary alpha cannot represent glass; keep shine and fizz on lens/liquid masks.
- Hand-placed windows (an antler window, two grey-gap touch-ups) are tied to that hat. A different object needs new ones.
- Keep original RGB: write only alpha, and validate that the RGB is unchanged.
- Always inspect a cut on checker and magenta at 4x before building motion on it. A SAM-Tiny cut made on the full image was rejected for blobby edges.

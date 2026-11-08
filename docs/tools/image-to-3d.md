# Image-to-3D (TripoSR locally, hosted services)

One painted image of a small creature or prop -> a closed mesh with vertex colours, locally, in about 15 s on the GTX 1070 Ti. First used for a small crab character: it worked end to end (Codex painting -> TripoSR mesh -> Blender rig with IK legs -> flat sprite frames with the painting projected back on), and the look held at 1080p. A painted 2D cut-out rig was still preferred for that wallpaper: at about 37 px the crab never turns, so 3D added nothing, and the claw wave hardly read. The reusable scripts are in `image-to-3d/` next to this file.

## Where to get it (all gitignored under `docs/tools/models/`)

| What | Where | Size | Source |
|---|---|---|---|
| TripoSR code | `docs/tools/models/triposr/code` | 64 MB (mostly `.git` and example images) | `git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR`, commit `107cefdc244c39106fa830359024f6a2f1c78871` |
| Weights | `docs/tools/models/triposr/weights/model.ckpt`, `config.yaml` | 1,677,246,742 bytes, SHA-256 `429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee` | Hugging Face `stabilityai/TripoSR`, revision `5b521936b01fbe1890f6f9baed0254ab6351c04a`, not gated |
| DINO config | `docs/tools/models/triposr/hf/` (HF_HOME for the runs) | 147 KB | `facebook/dino-vitb16` `config.json` only (TripoSR builds the ViT from it; the weights are in TripoSR's checkpoint) |

Official pages: code [github.com/VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR), weights [huggingface.co/stabilityai/TripoSR](https://huggingface.co/stabilityai/TripoSR) (files `model.ckpt` and `config.yaml`). Licence: TripoSR code and weights are MIT (VAST-AI-Research and Stability AI).

Python: the GPU venv (`docs/tools/gpu-venv`, see [python-environments.md](python-environments.md) for how to rebuild it). Added for this: `trimesh` (pip, pure Python). Not installed, replaced by shims (`image-to-3d/shim/`, put it on `PYTHONPATH`): `torchmcubes` (a CUDA extension; the shim runs scikit-image marching cubes on CPU) and `rembg` (inputs are already cut to RGBA).

## How to run

```
python docs/tools/gpu_lock.py -- <absolute path to repo>/docs/tools/gpu-venv/Scripts/python.exe -I <your folder>/triposr_run.py <id> [--res 256]
```

Copy the scripts (and `shim/`) from `image-to-3d/` into the subject's folder first: they work relative to their own folder. `triposr_run.py` finds the TripoSR folder by walking up to `docs/tools/models/triposr`, or from `TRIPOSR_DIR`; `cut_ref.py` needs the Finegrain ONNX (`FINEGRAIN_ONNX`, see [cutout-segmenters.md](cutout-segmenters.md)). Input `ref/<id>.png` (RGBA, `cut_ref.py`). Output `mesh/<id>-r256.obj` (vertex colours), plus the exact framing the model saw (`<id>-input-rgba.png`), which is what to project back onto the mesh (`make_proj.py`). The rest of the crab pipeline: `analyse_parts.py` finds legs and claws on the fused mesh and writes a rig; `crab_blender.py` (was `blender/crab.py`) cleans, levels, projects, grades, rigs, animates and renders; `preview_mesh.py` makes six-view sheets. `crab_blender.py` is a worked example with scene constants for one wallpaper; adapt it.

- 12-15 s per mesh at resolution 256 (33k vertices); peak 2.4 GB VRAM (4.2 GB at 384). The desktop and Wallpaper Engine already held about 5.5 GB of the 8 GB, so 384 is about the limit while they run.
- `gpu_lock.py` needs the absolute python path (a relative `docs/tools/...` path failed with WinError 2).

## Gotchas

- **transformers 5 renamed the ViT layers** (`encoder.layer.N.attention.attention.query` -> `layers.N.attention.q_proj`, `intermediate.dense` -> `mlp.fc1`, `output.dense` -> `mlp.fc2`). TripoSR's checkpoint has the 4.35 names, so `TSR.from_pretrained` fails. The runner builds the model from the config and renames the keys (`REN` in `triposr_run.py`), then checks nothing is missing.
- **Frame:** the mesh is in TripoSR's own frame: z up, input camera on +x (distance 1.9, fovy 40, elevation 0). Import into Blender with `forward_axis='Y', up_axis='Z'` to keep it. The input view is assumed level, so a reference painted from 20 degrees above comes out tilted 20 degrees toward the camera; rotate about y by -20 degrees to level it.
- **The mesh is one surface:** touching legs, and front legs and claws, are fused, and a thin leg can be its own island. Fine for a still; for a rig, cut the faces that span two parts (`crab_blender.py`, "cut every face that spans two appendages").
- **Colours are blurry** (vertex colours from the NeRF). Project the painting back on from the input camera instead and keep the vertex colours only where the painting can't reach (`crab_blender.py` `build()`). Bleed the painting's colours outward from its clean interior first: Finegrain's alpha is 1.0 a pixel or two into the grey around thin legs, and those halo pixels became pale bands on the legs (`make_proj.py`).

## Not used, and why

| Model | Why not |
|---|---|
| Stable Fast 3D (`stabilityai/stable-fast-3d`, Stability community licence, 4.0 GB) | Gated on Hugging Face (accept terms while logged in), so it needs your own account. Not downloaded. |
| TripoSG (`VAST-AI/TripoSG`, MIT, 7.95 GB) | Not needed once TripoSR worked; states 8 GB VRAM and needs a compiled marching-cubes extension. Not downloaded. |
| Hunyuan3D | Licence excludes the EU. |
| TRELLIS | 24 GB VRAM. |
| Tripo, Meshy, Rodin, fal | Hosted; need accounts. See below. |

## Hosted services (checked 2026-11-02, none tried)

For a character that must turn or deform, try one of these before hand-building: [animated-characters](../approaches/animated-characters.md). Prices move and sources disagree, so check the service's own page before paying. USD list prices are shown only to compare tiers.

| Service | Price seen | Free tier | Rigging | Notes |
|---|---|---|---|---|
| [Meshy](https://www.meshy.ai/pricing) | Pro USD 20 a month, 1,000 credits; about 20-35 credits per attempt | 100 credits a month, about 10 Lite downloads, CC BY. Multi-view and A/T-pose options locked | Humanoid auto-rig, GLB/FBX | Clearest terms and docs, and the most often recommended for auto-rigging. |
| [Tripo](https://toolradar.com/tools/tripo-ai/pricing) | Pro about USD 20 a month | 200-300 credits a month, about 15 per model (sources differ) | Auto-rig for bipeds and multi-legged creatures; one review calls it beta quality | Figures are from third-party listings |
| [Rodin / Hyper3D](https://hyper3d.ai/pricing) | Creator about USD 24-30 a month; about 40 credits per high-density model | A few credits, likely not enough for one high-density download | Reported "coming soon" in April 2026; unconfirmed since | Reported quad topology and enforced T/A pose. One guide says it suits scan-style work over stylized art |
| [Higgsfield](https://higgsfield.ai/pricing) | Starter USD 19 a month | - | Via its Meshy model | Starter's mesh access and per-asset cost are unverified |
| [Mixar](https://mixar.app) | Unknown; third-party listing from USD 29.99 a month | Reported free credits, unverified | Tripo auto-rig | A Blender fork over Tripo and Hunyuan. No generation was run. |

No head-to-head test on anime characters turned up, and most comparisons online are vendor blogs. Test with your own reference image and check hair, eyes and limb bending after rigging.

How to use them:
- Upload a clean A-pose or T-pose image with the limbs apart. Make it with Codex first.
- Generate characters and vehicles separately.
- A completed but poor result still costs credits. Budget for attempts, not assets.
- Judge a toon-shaded still at the wallpaper's real camera and size before rigging.
- Local TripoSR stays the free option for small creatures and props seen from one side.

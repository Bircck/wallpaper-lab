# Python environments

Two Python environments do the image work, plus an optional third for upscaling. Test machine: Windows 10, Ryzen 7 7800X3D, GTX 1070 Ti 8 GB (Pascal, sm_61, no bf16). None is tracked in git; `.gitignore` covers `.venv/`, `venv/`, `docs/tools/gpu-venv/` and `docs/tools/models/`. Rebuild them from the lists below.

| Name | Python | Use |
|---|---|---|
| CPU venv (your own `.venv`) | 3.12 | numpy, OpenCV, onnxruntime, PIL; Finegrain and SAM2-Tiny on ONNX CPU; wallpaper build scripts |
| GPU venv `docs/tools/gpu-venv` | 3.13 | torch cu126, transformers, OpenCV, scipy, pymatting; mask and layer scripts, TripoSR |
| Upscaler venv (optional) | 3.13 | torch + CUDA + `spandrel`, for [upscalers.md](upscalers.md); can be the GPU venv plus `pip install spandrel` |

## GPU venv: rebuild

Pascal needs PyTorch **cu126** wheels: PyTorch 2.8's release notes say the CUDA 12.8 and 12.9 builds dropped Maxwell, Pascal and Volta. Verify with `torch.cuda.get_arch_list()`; the working venv lists `sm_50 sm_60 sm_61 sm_70 sm_75 sm_80 sm_86 sm_90`. Newer cards can use the default wheels.

```
py -3.13 -m venv docs/tools/gpu-venv
docs/tools/gpu-venv/Scripts/python.exe -m pip install --upgrade pip
docs/tools/gpu-venv/Scripts/python.exe -m pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cu126
docs/tools/gpu-venv/Scripts/python.exe -m pip install transformers==5.19.0 huggingface_hub pymatting==1.1.16 opencv-python==5.0.0.93 scikit-image==0.26.0 scipy==1.18.1 numpy==2.5.2 safetensors timm==1.0.30 einops kornia==0.8.3 accelerate matplotlib hydra-core==1.3.7 iopath tqdm omegaconf trimesh==5.2.0
```

Versions of the working environment (`python -m pip freeze`, key packages): torch 2.14.1+cu126, torchvision 0.29.1+cu126, transformers 5.19.0, huggingface_hub 2.2.0, numpy 2.5.2, scipy 1.18.1, scikit-image 0.26.0, opencv-python 5.0.0.93, pymatting 1.1.16, numba 0.68.0, llvmlite 0.50.0, timm 1.0.30, kornia 0.8.3, hydra-core 1.3.7, omegaconf 2.3.1, einops 0.8.2, accelerate 1.15.0, safetensors 0.8.0, iopath 0.1.10, matplotlib 3.11.2, pillow 12.3.0, trimesh 5.2.0, networkx 3.6.1, ImageIO 2.38.1, tifffile 2026.9.20. Full freeze (everything else is a dependency of these): accelerate, annotated-doc, antlr4-python3-runtime 4.9.3, anyio, click, colorama, contourpy, cycler, einops, filelock, fonttools, fsspec, h11, hf-xet, httpcore2, httpx2, huggingface_hub, hydra-core, idna, ImageIO, iopath, Jinja2 3.1.6, kiwisolver, kornia, kornia_rs, lazy-loader, llvmlite, markdown-it-py, MarkupSafe, matplotlib, mdurl, mpmath, networkx, numba, numpy, omegaconf, opencv-python, packaging, pillow, portalocker, psutil, Pygments, PyMatting, pyparsing, python-dateutil, PyYAML, regex, rich, safetensors, scikit-image, scipy, setuptools 78.1.0, shellingham, six, sympy 1.14.0, tifffile, timm, tokenizers 0.23.3, torch, torchvision, tqdm, transformers, trimesh, truststore, typer, typing_extensions. No onnxruntime in this venv; Finegrain runs in the CPU venv.

Notes:
- Precision: fp16 for BiRefNet, fp32 for SAM2, HQ-SAM2 and ViTMatte. No bf16 on Pascal, so skip the `torch.autocast(..., bfloat16)` lines in upstream READMEs.
- SAM2.1 runs through `transformers.Sam2Model` (no `sam2` pip package; a warning that the checkpoint is `sam2_video` type is harmless, 741 tensors load). HQ-SAM2 needs its own code: a clone of `https://github.com/SysCV/sam-hq` (commit `e696978d`, 152 MB) on `sys.path`. BiRefNet loads with `trust_remote_code=True`.
- If you move a venv folder, `python.exe` keeps working but the `pip.exe` launcher still has the old path baked in, so use `python -m pip`.
- Model files and where to get them: [cutout-segmenters.md](cutout-segmenters.md#where-to-get-the-models), [upscalers.md](upscalers.md), [image-to-3d.md](image-to-3d.md).
- Size of the venv: about 4.9 GB. Peak memory seen: BiRefNet HR 2048 on a 288 px crop used about 5.8 GB in fp16 and took about 11 s; SAM2.1-L about 0.66 s per prompt after 0.9 s first call. Authoring numbers only.

## CPU venv: rebuild

Used for the ONNX models (Finegrain, SAM2.1-Tiny ONNX) and the wallpaper build scripts.

```
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python.exe -m pip install onnx==1.23.2 onnxruntime==1.31.0 onnxscript==0.7.2 opencv-python-headless==5.0.0.93 numpy==2.5.2 pillow hydra-core iopath
```

- Not in it: scipy, pymatting, transformers, numba. If a script needs them, use the GPU venv.
- SAM2.1-Tiny ONNX: export the original `sam2.1_hiera_tiny.pt` with Microsoft's onnxruntime SAM2 exporter (the `SAM2ImageOnnxPredictor` in `onnxruntime`'s repo); `sam_2` was installed editable from a clone of `facebookresearch/sam2`. Finegrain is a ready-made ONNX file ([cutout-segmenters.md](cutout-segmenters.md#where-to-get-the-models)). The CPU index above was not recorded originally; it is PyTorch's standard CPU wheel index.
- Size: about 1 GB.
- Call scripts from the repo root with `-I` where their header says so. `-I` drops the script's own folder from `sys.path`, so a script that does `import util` from its folder breaks unless it inserts the path itself. Check the script header.

## Upscaler venv

Needs torch 2.9+ with CUDA and `spandrel` 0.4.2 (tested with torch 2.9.1+cu126, transformers 5.16.1, onnxruntime 1.29.0, pymatting 1.1.15). Adding `pip install spandrel==0.4.2` to the GPU venv is enough for `docs/tools/upscale/upscale.py`. The ComfyUI install that originally held the weights is not needed: only the `.pth` files. ComfyUI, if you use it, was started with `--force-fp32` because fp32 measured faster than fp16 on this card.

## Sharing the GPU

Several jobs on one 8 GB card can be serialised with `docs/tools/gpu_lock.py`:
```
python docs/tools/gpu_lock.py -- <command...>
```
It waits for an exclusive machine-wide lock, runs the command and releases it. CPU work needs no lock.

## Other things worth knowing

- numba (pymatting) JIT-compiles on first call (a few seconds); later calls take 0.02-0.05 s on a 288 px crop.
- No ffmpeg on PATH on the test machine. Write animated WebP with PIL (`save_all`, `duration`, `loop=0`), or use Blender's FFMPEG output.
- Set `HF_HOME` / `HF_MODULES_CACHE` inside the study folder when a script downloads Hugging Face remote code, so nothing lands in your user profile.

## Links

[cutout-segmenters](cutout-segmenters.md), [upscalers](upscalers.md), [image-to-3d](image-to-3d.md)

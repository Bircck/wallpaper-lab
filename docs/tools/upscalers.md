# Upscalers (4x-UltraSharp, Remacri, RealESRGAN anime 6B)

Used to make a sharp 2x master of a painted frame (a 1672 x 941 concept to 3344 x 1882). One shipped wallpaper (Opaline 1.1) uses an UltraSharp master: the 2x output was downscaled to 2200 px wide, about 1:1 for its 1080p crop, and embedded as JPEG. UltraSharp was preferred; anime_6B was also liked.

## Where to get the models

Download the `.pth` files into any folder (this repo's scripts take the path as an argument; a ComfyUI `models/upscale_models` folder works too). ComfyUI itself is not needed.

| Model | Source | File | Licence |
|---|---|---|---|
| 4x-UltraSharp (Kim2091) | [OpenModelDB](https://openmodeldb.info/models/4x-UltraSharp); the page links a shared download folder | `4x-UltraSharp.pth` (67.0 MB locally; the exact file name is not stated on the page) | CC BY-NC-SA 4.0 |
| 4x_foolhardy_Remacri | [OpenModelDB](https://openmodeldb.info/models/4x-Remacri); links a third-party Hugging Face mirror, `https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth` | `4x_foolhardy_Remacri.pth` (67.0 MB locally) | CC BY-NC-SA 4.0 as listed on OpenModelDB |
| RealESRGAN x4plus anime 6B | [xinntao/Real-ESRGAN release v0.2.2.4](https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.2.4), asset `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth` | `RealESRGAN_x4plus_anime_6B.pth` (17.9 MB locally) | BSD-3-Clause (the repository) |

Licences checked 2026-11-08 on the hosting pages. The two community models are non-commercial and share-alike: credit them when their output ships.

## How to run

- Python: a Python with torch + CUDA and `spandrel` 0.4.2 (torch 2.9.1+cu126 tested). See [python-environments](python-environments.md#upscaler-venv).
- Script: `docs/tools/upscale/upscale.py`. It uses `spandrel.ModelLoader` directly.

```
python -I docs/tools/upscale/upscale.py <path to>/4x-UltraSharp.pth <out.png> <source.png>
```

- Output: the 4x result processed in 320 px tiles with 24 px padding (fits 8 GB), then downscaled to 2x. 4x models use `Image.BOX`, 2x models Lanczos.
- Other scripts in the folder: `baseline.py <source.png>` (Lanczos 2x and Lanczos plus unsharp baselines, ultrawide framing check, writes `crops.json`), `sheet.py <source.png> <out.jpg> label=path.png ...` (1:1 crop sheet for comparison, using `crops.json`).

## Pitfalls

- A 2x master is larger than a 1080p screen needs. WebGL1 has no mipmaps for non-power-of-two textures, so a master much bigger than its on-screen size gets minified with aliasing. Downscale it to the size the shader actually shows.
- The script needs CUDA (`.cuda()`); it is not CPU-ready as written.
- It upscales the whole painted frame, so painted waves and light lines are sharpened too.
- Compare at 1:1 crops, not whole frames (`sheet.py`), against the Lanczos and Lanczos-plus-unsharp baselines from `baseline.py`.
- UltraSharp can weave a fine grid mesh into dark foliage, rock or a nebula. Fix: run it on the 1x original softened by a 0.9 px Gaussian (0.6 px left the mesh). Remacri was clean on a nebula but added a dark rim on rock. Choose the model per scene on a full-frame swap page ([upscaling-a-finished-painting](../approaches/upscaling-a-finished-painting.md)).

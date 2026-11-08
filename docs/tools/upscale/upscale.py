"""Run a spandrel upscaler on a painting in overlapping tiles, then area-downscale to the 2x master.

usage: upscale.py <model.pth> <out.png> <source.png>
Run with a Python that has torch + CUDA + spandrel (see ../python-environments.md).
"""
import sys

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

TILE, PAD = 320, 24


def run(model_path, out_path, src):
    model = ModelLoader().load_from_file(model_path).cuda().eval()
    s = model.scale
    img = np.asarray(Image.open(src).convert("RGB"), np.float32) / 255.0
    h, w = img.shape[:2]
    out = np.zeros((h * s, w * s, 3), np.float32)
    with torch.no_grad():
        for y in range(0, h, TILE):
            for x in range(0, w, TILE):
                y0, x0 = max(y - PAD, 0), max(x - PAD, 0)
                y1, x1 = min(y + TILE + PAD, h), min(x + TILE + PAD, w)
                t = torch.from_numpy(img[y0:y1, x0:x1]).permute(2, 0, 1)[None].cuda()
                r = model(t)[0].clamp(0, 1).permute(1, 2, 0).cpu().numpy()
                ty, tx = (y - y0) * s, (x - x0) * s
                th, tw = (min(y + TILE, h) - y) * s, (min(x + TILE, w) - x) * s
                out[y * s:y * s + th, x * s:x * s + tw] = r[ty:ty + th, tx:tx + tw]
    full = Image.fromarray((out * 255 + 0.5).astype(np.uint8))
    full.resize((w * 2, h * 2), Image.LANCZOS if s == 2 else Image.BOX if s % 2 == 0 else Image.LANCZOS).save(out_path)
    print(out_path, "scale", s, "->", w * 2, h * 2)


if __name__ == "__main__":
    run(*sys.argv[1:4])

"""Projection texture for the crab mesh: the painting the model saw (mesh/<id>-input-rgba.png), with every edge pixel replaced
by colour bled out from the clean interior. The TripoSR outline is not exactly the painted outline, so the projection samples
up to a few px outside the painted crab; those pixels must be crab colour, not the grey background or the grey halo.
Finegrain's alpha is 1.0 a pixel or two into the grey around the thin legs (no un-mixing happened there), so "clean" =
alpha 1, at least 3 px inside, and not grey-ish. Without this the legs got pale bands.
usage (from the working folder): <python with opencv> -I make_proj.py [id]   -> mesh/<id>-proj.png"""
import sys
from pathlib import Path
import numpy as np, cv2
HERE = Path(__file__).resolve().parent
vid = sys.argv[1] if len(sys.argv) > 1 else 'front'
im = cv2.imread(str(HERE / 'mesh' / f'{vid}-input-rgba.png'), cv2.IMREAD_UNCHANGED)
rgb = im[..., :3].astype(np.float32); a = im[..., 3]
grey = np.array([193, 193, 193], np.float32)
sat = rgb.max(2) - rgb.min(2)
known = (a >= 250) & ((sat > 40) | (rgb.max(2) < 110))      # coloured, or dark (eyes, shadow lines); the halo is light grey
known = cv2.erode(known.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
# push-pull fill: average of known colours at growing radii, nearest radius wins
out = rgb.copy(); filled = known.copy()
w = known.astype(np.float32); acc = rgb * w[..., None]
for r in [1, 2, 4, 8, 16, 32, 64, 128]:
    k = 2 * r + 1
    num = cv2.blur(acc, (k, k)); den = cv2.blur(w, (k, k))
    new = (~filled) & (den > 1e-3)
    out[new] = num[new] / den[new][..., None]
    filled |= new
out[~filled] = rgb[known].mean(0)
cv2.imwrite(str(HERE / 'mesh' / f'{vid}-proj.png'), np.clip(out, 0, 255).astype(np.uint8))
print('known', int(known.sum()), 'of alpha>0', int((a > 0).sum()))

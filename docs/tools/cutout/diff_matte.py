"""Difference matte for the additive method (one Codex "add one prop" edit at a time).
Additive pipeline: before/after Codex 'add one prop' edit -> prop matte + aligned composite.
The 'before' image IS the clean plate behind the prop. Codex re-renders the whole frame, so only the changed
region (the new prop and its contact shadow) is taken from 'after'; everything else stays 'before'.
Usage: python diff_matte.py before.png after.png out_prefix [box x0,y0,x1,y1]
Writes <out>-alpha.png (prop, soft), <out>-shadow.png (darkening outside the prop), <out>-composite.png,
<out>-review.png and metrics in <out>.json."""
import sys, json, cv2, numpy as np
from scipy import ndimage as ndi
before_p, after_p, out = sys.argv[1:4]
B = cv2.imread(before_p); A = cv2.imread(after_p)
if A.shape != B.shape: A = cv2.resize(A, (B.shape[1], B.shape[0]), interpolation=cv2.INTER_LANCZOS4)
H, W = B.shape[:2]
box = [int(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 else [0, 0, W, H]

# global drift check: how different are the images where nothing was supposed to change?
Lb = cv2.cvtColor(B, cv2.COLOR_BGR2LAB).astype(np.float32); La = cv2.cvtColor(A, cv2.COLOR_BGR2LAB).astype(np.float32)
d = np.sqrt(((cv2.GaussianBlur(La, (0, 0), 1.2) - cv2.GaussianBlur(Lb, (0, 0), 1.2)) ** 2).sum(-1))
inbox = np.zeros((H, W), bool); inbox[box[1]:box[3], box[0]:box[2]] = True
outside_mad = float(np.median(d[~inbox])) if (~inbox).any() else 0.

# changed region: strong difference, inside the box, largest blobs
thr = max(14., outside_mad * 3 + 8)
ch = (d > thr) & inbox
ch = ndi.binary_opening(ch, iterations=1); ch = ndi.binary_closing(ch, iterations=3)
lab, n = ndi.label(ch)
if n:
    sizes = ndi.sum(ch, lab, range(1, n + 1)); keep = sizes >= max(150, sizes.max() * .08)
    ch = np.isin(lab, 1 + np.flatnonzero(keep))
ch = ndi.binary_fill_holes(ch)

# split prop vs contact shadow: a shadow is darker but similar in hue/chroma to 'before'
dl = La[..., 0] - Lb[..., 0]; dab = np.sqrt(((La[..., 1:] - Lb[..., 1:]) ** 2).sum(-1))
shadowish = ch & (dl < -6) & (dab < 9)
prop = ch & ~shadowish
prop = ndi.binary_opening(prop, iterations=1); lab, n = ndi.label(prop)
if n:
    sizes = ndi.sum(prop, lab, range(1, n + 1)); prop = np.isin(lab, 1 + np.flatnonzero(sizes >= max(120, sizes.max() * .1)))
prop = ndi.binary_fill_holes(prop)

def guided(I, p, r, eps):
    I = I.astype(np.float32) / 255; p = p.astype(np.float32)
    bx = lambda x: cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1))
    mI = bx(I); mp = bx(p); cov = bx(I * p[..., None]) - mI * mp[..., None]
    var = np.empty(I.shape[:2] + (3, 3), np.float32)
    for i in range(3):
        for j in range(3): var[..., i, j] = bx(I[..., i] * I[..., j]) - mI[..., i] * mI[..., j]
    var += eps * np.eye(3, dtype=np.float32)
    a = np.linalg.solve(var, cov[..., None])[..., 0]; b = mp - (a * mI).sum(-1)
    return (bx(a) * I).sum(-1) + bx(b)
alpha = np.clip((guided(A, prop, 2, 1e-3) - .5) * 1.3 + .5, 0, 1) * ndi.binary_dilation(prop, iterations=3)
shadow = np.clip(-dl / 60, 0, 1) * cv2.GaussianBlur(shadowish.astype(np.float32), (0, 0), 1.5) * (1 - alpha)

comp = B.astype(np.float32) * (1 - shadow[..., None] * .9)
comp = comp * (1 - alpha[..., None]) + A.astype(np.float32) * alpha[..., None]
cv2.imwrite(f'{out}-alpha.png', (alpha * 255).astype(np.uint8))
cv2.imwrite(f'{out}-shadow.png', (shadow * 255).astype(np.uint8))
cv2.imwrite(f'{out}-composite.png', comp.clip(0, 255).astype(np.uint8))
# review: crop around the prop: before | after | cut-out on checkerboard | composite
ys, xs = np.nonzero(alpha > .05)
if len(xs):
    x0, y0, x1, y1 = max(0, xs.min() - 30), max(0, ys.min() - 30), min(W, xs.max() + 30), min(H, ys.max() + 30)
    chk = (((np.indices((y1 - y0, x1 - x0)).sum(0) // 8) % 2) * 110 + 70).astype(np.float32)[..., None].repeat(3, 2); chk[..., 1] += 70
    a = alpha[y0:y1, x0:x1, None]
    tiles = [B[y0:y1, x0:x1], A[y0:y1, x0:x1], (A[y0:y1, x0:x1] * a + chk * (1 - a)).astype(np.uint8), comp[y0:y1, x0:x1].clip(0, 255).astype(np.uint8)]
    s = 300 / max(1, (y1 - y0)); tiles = [cv2.resize(t, None, fx=s, fy=s) for t in tiles]
    cv2.imwrite(f'{out}-review.png', np.hstack(tiles))
m = {'outside_median_lab_diff': round(outside_mad, 2), 'threshold': round(thr, 1), 'prop_px': int(prop.sum()), 'shadow_px': int(shadowish.sum()),
     'bbox': [int(v) for v in (xs.min(), ys.min(), xs.max(), ys.max())] if len(xs) else None}
json.dump(m, open(f'{out}.json', 'w'), indent=1); print(json.dumps(m))

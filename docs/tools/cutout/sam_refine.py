"""Refine a diff matte with SAM2.1: the before/after change region gives the box and interior points;
SAM decides the object silhouette (so shaded parts of the prop are not mistaken for shadow).
Usage: python -I sam_refine.py before.png after.png prefix   (expects prefix.json from diff_matte.py)
Set CONVEX=1 for solid convex props (hat, bottle, book): the outline becomes the convex silhouette.
SAM runs in-process through segment.py (same folder; see its header for WL_SAM_DIR)."""
import sys, json, os, cv2, numpy as np
from scipy import ndimage as ndi
before_p, after_p, pre = sys.argv[1:4]
B = cv2.imread(before_p); A = cv2.imread(after_p); H, W = B.shape[:2]
Lb = cv2.cvtColor(B, cv2.COLOR_BGR2LAB).astype(np.float32); La = cv2.cvtColor(A, cv2.COLOR_BGR2LAB).astype(np.float32)
d = np.sqrt(((cv2.GaussianBlur(La, (0, 0), 1.2) - cv2.GaussianBlur(Lb, (0, 0), 1.2)) ** 2).sum(-1))
m = json.load(open(pre + '.json')); thr = m['threshold']
x0, y0, x1, y1 = m['bbox']
inbox = np.zeros((H, W), bool); inbox[max(0, y0 - 40):y1 + 40, max(0, x0 - 40):x1 + 40] = True
ch = ndi.binary_closing(ndi.binary_opening((d > thr) & inbox, iterations=1), iterations=3)
lab, n = ndi.label(ch); sizes = ndi.sum(ch, lab, range(1, n + 1)); ch = lab == 1 + int(np.argmax(sizes)); ch = ndi.binary_fill_holes(ch)
ys, xs = np.nonzero(ch); box = [int(xs.min()) - 4, int(ys.min()) - 4, int(xs.max()) + 4, int(ys.max()) + 4]
dist = ndi.distance_transform_edt(ch); pts = []; dd = dist.copy()
for _ in range(4):
    y, x = np.unravel_index(np.argmax(dd), dd.shape); pts.append([int(x), int(y), 1]); cv2.circle(dd, (int(x), int(y)), int(dist[y, x] * 1.6), 0, -1)
for (x, y) in [(box[0] - 25, box[1] - 25), (box[2] + 25, box[1] - 25), (box[0] - 25, box[3] + 10), (box[2] + 25, box[3] + 10)]:
    if 0 <= x < W and 0 <= y < H: pts.append([int(x), int(y), 0])
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import segment
cands = [segment.sam(A, points=pts, box=box, pick=c)[0] for c in range(3)]
# pick the SAM candidate that best covers the changed region without spilling outside it
best, bs = None, -1
for s in cands:
    score = (s & ch).sum() / max(1, ch.sum()) - 2 * (s & ~ndi.binary_dilation(ch, iterations=6)).sum() / max(1, s.sum())
    if score > bs: best, bs = s, score
prop = ndi.binary_fill_holes(best & ndi.binary_dilation(ch, iterations=6))
# solid props: close bites where SAM followed a shadow edge; anything that changed inside the silhouette's hull belongs to the prop
pts_ = cv2.findNonZero(prop.astype(np.uint8))
if pts_ is not None:
    hull = np.zeros((H, W), np.uint8); cv2.fillConvexPoly(hull, cv2.convexHull(pts_), 1)
    prop = ndi.binary_fill_holes(prop | (ch & hull.astype(bool) & ~(ndi.binary_erosion(hull.astype(bool), iterations=0) & False)))
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
if os.environ.get('CONVEX'):   # convex props (hat, bottle): the outline is the convex silhouette; shaded areas that match the background still belong to the prop
    hull = np.zeros((H, W), np.uint8); cv2.fillConvexPoly(hull, cv2.convexHull(cv2.findNonZero(best.astype(np.uint8))), 1)
    prop = hull.astype(bool) & ndi.binary_dilation(best | ch, iterations=4)
    prop = ndi.binary_fill_holes(prop)
alpha = np.maximum(np.clip((guided(A, prop, 2, 1e-3) - .5) * 1.3 + .5, 0, 1) * ndi.binary_dilation(prop, iterations=2), ndi.binary_erosion(prop, iterations=2))
# contact shadow: darkening that changed outside the prop
dl = La[..., 0] - Lb[..., 0]
sh_region = ndi.binary_dilation(ch, iterations=8) & ~ndi.binary_dilation(prop, iterations=1)
shadow = np.clip(-dl / 60, 0, 1) * sh_region * (1 - alpha)
shadow = cv2.GaussianBlur(shadow, (0, 0), 1.2)
comp = B.astype(np.float32) * (1 - shadow[..., None] * .7)
comp = comp * (1 - alpha[..., None]) + A.astype(np.float32) * alpha[..., None]
cv2.imwrite(f'{pre}-alpha.png', (alpha * 255).astype(np.uint8)); cv2.imwrite(f'{pre}-shadow.png', (shadow * 255).astype(np.uint8))
cv2.imwrite(f'{pre}-composite.png', comp.clip(0, 255).astype(np.uint8))
ys, xs = np.nonzero(alpha > .05)
x0, y0, x1, y1 = max(0, xs.min() - 30), max(0, ys.min() - 30), min(W, xs.max() + 30), min(H, ys.max() + 30)
chk = (((np.indices((y1 - y0, x1 - x0)).sum(0) // 8) % 2) * 110 + 70).astype(np.float32)[..., None].repeat(3, 2); chk[..., 1] += 70
a = alpha[y0:y1, x0:x1, None]
tiles = [B[y0:y1, x0:x1], A[y0:y1, x0:x1], (A[y0:y1, x0:x1] * a + chk * (1 - a)).astype(np.uint8), comp[y0:y1, x0:x1].clip(0, 255).astype(np.uint8)]
s = 300 / max(1, (y1 - y0)); cv2.imwrite(f'{pre}-review.png', np.hstack([cv2.resize(t, None, fx=s, fy=s) for t in tiles]))
# residual: how far the composite is from 'after' inside the changed area (should be small)
print(json.dumps({'prop_px': int(prop.sum()), 'composite_vs_after_in_change': round(float(np.abs(comp - A.astype(np.float32))[ch].mean()), 2)}))

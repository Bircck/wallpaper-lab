"""Cut Codex-generated subject references (small creature or prop on a flat grey background) to RGBA.
usage (from your working folder, with gen/ref-<id>.png present): <python with opencv + onnxruntime> -I cut_ref.py [ids...]
Needs the Finegrain ONNX (docs/tools/cutout-segmenters.md says where to get it): set FINEGRAIN_ONNX, or keep it at
docs/tools/models/finegrain/finegrain.onnx in the repo. Finegrain first (see docs/tools/cutout-segmenters.md), plus a colour key against the flat #c8c8c8 background; the two are compared in
ref/cut-<id>.jpg. Alpha = max(Finegrain, key) inside the Finegrain hull, so thin spines the model drops come back from the key.
Edges are un-mixed from the grey. Writes ref/<id>.png (RGBA, 1024) and ref/cut-<id>.jpg (sheet)."""
import sys, os
from pathlib import Path
import numpy as np, cv2
HERE = Path.cwd()   # working folder: gen/ in, ref/ out
_SCRIPT = Path(__file__).resolve().parent

def _onnx_path():
    if os.environ.get('FINEGRAIN_ONNX'): return os.environ['FINEGRAIN_ONNX']
    for d in [_SCRIPT, *_SCRIPT.parents]:
        p = d / 'docs/tools/models/finegrain/finegrain.onnx'
        if p.exists(): return str(p)
    raise SystemExit('Finegrain ONNX not found: set FINEGRAIN_ONNX')

_sess = None
def finegrain(bgr, box):
    """Probability map (full image size, 0 outside box) from the Finegrain Box Segmenter; the box is the crop."""
    global _sess
    import onnxruntime as ort
    if _sess is None: _sess = ort.InferenceSession(_onnx_path(), providers=['CPUExecutionProvider'])
    x0, y0, x1, y1 = [int(v) for v in box]
    crop = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    im = cv2.resize(crop, (1024, 1024), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    im = (im - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    out = _sess.run(None, {_sess.get_inputs()[0].name: im.transpose(2, 0, 1)[None].astype(np.float32)})[0]
    prob = 1.0 / (1.0 + np.exp(-np.squeeze(out).astype(np.float32)))
    full = np.zeros(bgr.shape[:2], np.float32)
    full[y0:y1, x0:x1] = cv2.resize(prob, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
    return full

def cut(vid):
    src = cv2.imread(str(HERE / 'gen' / f'ref-{vid}.png'))
    H, W = src.shape[:2]
    f = src.astype(np.float32)
    bg = np.median(np.concatenate([f[:20].reshape(-1, 3), f[-20:].reshape(-1, 3), f[:, :20].reshape(-1, 3), f[:, -20:].reshape(-1, 3)]), 0)
    d = np.linalg.norm(f - bg, axis=2)
    key = np.clip((d - 10) / 30, 0, 1)
    ys, xs = np.nonzero(key > .5)
    box = (max(0, xs.min() - 20), max(0, ys.min() - 20), min(W, xs.max() + 20), min(H, ys.max() + 20))
    fg = finegrain(src, box)
    hull = cv2.dilate((fg > .5).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    a = np.where(hull, np.maximum(fg, key), 0).astype(np.float32)
    # drop specks: keep components touching the main body
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > .2).astype(np.uint8))
    keep = np.zeros(n, bool); keep[1 + np.argmax(st[1:, cv2.CC_STAT_AREA])] = True
    keep |= st[:, cv2.CC_STAT_AREA] > 400; keep[0] = False
    a *= keep[lab]
    am = np.maximum(a, 1e-3)[..., None]
    un = np.clip((f - (1 - a[..., None]) * bg) / am, 0, 255)
    rgb = np.where(a[..., None] > .02, un, f)
    rgba = np.dstack([rgb, a * 255]).astype(np.uint8)
    cv2.imwrite(str(HERE / 'ref' / f'{vid}.png'), rgba)
    def over(col, alpha):
        return (rgb * alpha[..., None] + np.array(col, np.float32) * (1 - alpha[..., None])).astype(np.uint8)
    mag = (255, 0, 255); dark = (30, 40, 30)
    tiles = [src, over(mag, fg), over(mag, key), over(mag, a), over(dark, a)]
    sheet = np.concatenate([cv2.resize(t, (512, 512), interpolation=cv2.INTER_AREA) for t in tiles], 1)
    for i, t in enumerate(['source', 'Finegrain', 'colour key', 'final', 'final on dark']):
        cv2.putText(sheet, t, (8 + 512 * i, 24), cv2.FONT_HERSHEY_SIMPLEX, .7, (255, 255, 255), 2)
    cv2.imwrite(str(HERE / 'ref' / f'cut-{vid}.jpg'), sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(vid, 'bg', bg.round(1), 'box', box, 'fg>.5', int((fg > .5).sum()), 'key>.5', int((key > .5).sum()), 'final>.5', int((a > .5).sum()))

for vid in sys.argv[1:] or ['front', 'three-quarter', 'front-high']:
    cut(vid)

"""Register a Codex re-render (dusk plate, clean plates) back onto the day plate's pixel grid.

Codex re-renders the whole frame, so every edit drifts by up to ~1 px (measured with phase correlation, dusk2: -0.3..-1.15 px).
The masks, steering field and koi geometry were all built on the day plate, so a drop-in plate has to line up with it.
Method: local-contrast-normalised high-pass luminance of both images, DIS optical flow, flow smoothed hard (the drift is smooth),
weights from local structure (and an optional exclusion mask for regions an edit really changed). Applied at any scale with cubic remap.

Usage as a module:  sys.path.insert(0, 'docs/tools/codex'); from register_plate import flow_to, apply_flow
    f = flow_to(ref_bgr, render_bgr, exclude=really_edited_mask)   # flow at the ref grid, in px
    aligned = apply_flow(render_bgr, f)                            # a render at 2x the ref grid: apply_flow(img, f, scale=2)
CLI:  python -I register_plate.py ref.png render.png out.png [exclude_mask.png]
    Writes the render resampled onto the ref's pixel grid (resized to the ref size first), prints the mean/max shift.
Needs numpy and opencv-python (cv2.DISOpticalFlow).
"""
import cv2
import numpy as np


def _prep(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hp = g - cv2.GaussianBlur(g, (0, 0), 5)
    sd = np.sqrt(cv2.GaussianBlur(hp * hp, (0, 0), 14)) + 2.0
    return hp / sd, sd


def flow_to(ref_bgr, img_bgr, exclude=None, smooth=24):
    """Flow f (HxWx2, px at ref scale) with img(x + f(x)) ~ ref(x). exclude = bool mask where the images really differ."""
    a, _ = _prep(ref_bgr)
    b, sd = _prep(img_bgr)
    a8 = cv2.normalize(a, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    b8 = cv2.normalize(b, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    f = dis.calc(a8, b8, None)
    w = np.clip((_prep(ref_bgr)[1] - 2.0) / 6.0, 0, 1)
    if exclude is not None:
        w = w * (~cv2.dilate(exclude.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool))
    w = w.astype(np.float32)
    # robust: ignore wild vectors (> 4 px) when averaging
    w = w * (np.hypot(f[..., 0], f[..., 1]) < 4)
    out = np.zeros_like(f)
    den = cv2.GaussianBlur(w, (0, 0), smooth) + 1e-4
    for c in range(2):
        out[..., c] = cv2.GaussianBlur(f[..., c] * w, (0, 0), smooth) / den
    # where there is no structure anywhere near, fall back to a global mean
    gm = [float((f[..., c] * w).sum() / (w.sum() + 1e-4)) for c in range(2)]
    conf = np.clip(den * 8, 0, 1)
    for c in range(2):
        out[..., c] = out[..., c] * conf + gm[c] * (1 - conf)
    return out.astype(np.float32)


def apply_flow(img, f, scale=1.0):
    """img at `scale` x the ref grid; f at ref grid. Returns img resampled so it lines up with the ref."""
    H, W = img.shape[:2]
    fs = cv2.resize(f, (W, H), interpolation=cv2.INTER_CUBIC) * scale
    xx, yy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    return cv2.remap(img, xx + fs[..., 0], yy + fs[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    ref = cv2.imread(sys.argv[1])
    img = cv2.imread(sys.argv[2])
    if img.shape[:2] != ref.shape[:2]:
        img = cv2.resize(img, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    ex = cv2.imread(sys.argv[4], 0) > 127 if len(sys.argv) > 4 else None
    fl = flow_to(ref, img, exclude=ex)
    cv2.imwrite(sys.argv[3], apply_flow(img, fl))
    mag = np.hypot(fl[..., 0], fl[..., 1])
    print('shift px: mean %.2f max %.2f' % (mag.mean(), mag.max()))

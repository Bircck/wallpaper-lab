"""Soft layer (cloud, mist, steam, smoke) painted by Codex on a plain canvas -> straight-alpha RGBA tile. No segmenter.

Ask Codex for the soft layer on a plain flat canvas in the plate's colours, with about 12% clear margin at each end
(style crop attached as reference only). Then:
    python -I extract_soft_layer.py canvas.png out.png [--mode mist|steam] [--rotate] [--scale 0.75]
                                    [--cool R,G,B] [--margin 0.08] [--no-wrap]
Method:
  - mist mode: background per row = median of the plain left/right margins, smoothed and interpolated across x;
    steam mode: one flat colour from the four margins plus a smooth 2-D correction from clearly empty pixels;
  - alpha = projection of (P - bg) onto (Cwhite - bg), Cwhite = median of the brightest 0.3% of pixels; colour = bg + (P - bg) / alpha;
    steam mode un-mixes against two end members instead (lit white and a cool shade, --cool) so painted feathering is kept;
  - alpha floored at 0.03, the ends faded with a smoothstep so the tile wraps; colour under alpha ~0 is blur-propagated so
    bilinear filtering never pulls a dark fringe;
  - --rotate turns the band 90 degrees so it can scroll as a vertical, vertically tiling column (steam).
It prints the margin std per channel: below about 0.7 the canvas was truly flat; above that, ask Codex again.
Writes out.png and out-debug.png (source / over the background / alpha, stacked) next to it.
Needs numpy and opencv-python.
"""
import argparse, os
import numpy as np, cv2


def smooth_rows(a, n=31):
    k = np.ones(n) / n
    return np.stack([np.convolve(np.pad(a[:, c], n // 2, mode='edge'), k, 'valid') for c in range(3)], 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('canvas')
    ap.add_argument('out')
    ap.add_argument('--mode', choices=['mist', 'steam'], default='mist')
    ap.add_argument('--rotate', action='store_true', help='rotate the band 90 degrees (vertical tile)')
    ap.add_argument('--scale', type=float, default=0.75, help='output scale (soft layers need little resolution)')
    ap.add_argument('--cool', default='128,128,140', help='steam mode: shade end member R,G,B')
    ap.add_argument('--margin', type=float, default=0.08, help='fraction of the width that is plain canvas at each end')
    ap.add_argument('--no-wrap', action='store_true', help='do not fade the ends (the layer is not a tile)')
    a = ap.parse_args()

    P = cv2.imread(a.canvas)[:, :, ::-1].astype(np.float64)
    H, W = P.shape[:2]
    m = int(W * a.margin)
    marg = np.concatenate([P[:, :m].reshape(-1, 3), P[:, -m:].reshape(-1, 3),
                           P[:int(H * .12)].reshape(-1, 3), P[-int(H * .12):].reshape(-1, 3)])
    print('margin std per channel', marg.std(0).round(2), '(below 0.7 = flat canvas)')

    if a.mode == 'mist':
        left = smooth_rows(np.median(P[:, :m], axis=1))
        right = smooth_rows(np.median(P[:, -m:], axis=1))
        t = np.linspace(0, 1, W)[None, :, None]
        bg = left[:, None, :] * (1 - t) + right[:, None, :] * t
        d = P - bg
        lum = d.sum(2)
        Cw = np.median(P.reshape(-1, 3)[lum.reshape(-1) > np.percentile(lum, 99.7)], axis=0)
        v = Cw[None, None, :] - bg
        alpha = np.clip((d * v).sum(2) / np.maximum((v * v).sum(2), 1), 0, 1)
        alpha = np.clip((alpha - .03) / .97, 0, 1)
        col = np.clip(bg + d / np.maximum(alpha, .08)[..., None], 0, 255)
    else:
        b0 = np.median(marg, 0)
        clear = (np.abs(P - b0).max(-1) < 6).astype(np.float64)
        num = cv2.GaussianBlur(P * clear[..., None], (0, 0), 60)
        den = cv2.GaussianBlur(clear, (0, 0), 60)
        bg = np.where(den[..., None] > .05, num / np.maximum(den[..., None], 1e-6), b0)
        lum = P.mean(2)
        Cw = P[lum > np.percentile(lum, 99.7)].mean(0)
        Csh = np.array([float(v) for v in a.cool.split(',')])
        A = np.stack([Cw[None, None] - bg, Csh[None, None] - bg], -1)
        D = P - bg
        ATA = np.einsum('hwci,hwcj->hwij', A, A) + np.eye(2) * 1e-3
        ATb = np.einsum('hwci,hwc->hwi', A, D)
        w = np.clip(np.linalg.solve(ATA, ATb[..., None])[..., 0], 0, None)
        tot = w.sum(-1)
        w *= np.where(tot > 1, 1 / np.maximum(tot, 1e-6), 1.)[..., None]
        alpha = np.clip(w.sum(-1), 0, 1)
        alpha = np.clip((alpha - .03) / .97, 0, 1)
        col = (w[..., :1] * Cw + w[..., 1:] * Csh) / np.maximum(w.sum(-1, keepdims=True), 1e-4)
        col[alpha < .01] = Cw
    print('white end member', Cw.round(1))

    rows = np.where(alpha.max(1) > .04)[0]
    r0, r1 = max(rows.min() - 10, 0), min(rows.max() + 10, H)
    alpha, col, P, bg = alpha[r0:r1], col[r0:r1], P[r0:r1], bg[r0:r1]
    h = r1 - r0
    if not a.no_wrap:
        x = np.arange(W)
        win = np.clip(np.minimum(x, W - 1 - x) / (W * .1), 0, 1)
        win = win * win * (3 - 2 * win)
        y = np.arange(h)
        vw = np.clip(np.minimum(y, h - 1 - y) / 10, 0, 1)
        alpha = alpha * win[None, :] * vw[:, None]
    wgt = cv2.GaussianBlur(alpha, (0, 0), 6)
    cb = cv2.GaussianBlur(col * alpha[..., None], (0, 0), 6) / np.maximum(wgt[..., None], 1e-4)
    col = np.where((alpha < .05)[..., None], cb, col)
    rgba = np.dstack([np.clip(col, 0, 255), alpha * 255]).round().astype(np.uint8)
    if a.rotate:
        rgba = np.ascontiguousarray(np.rot90(rgba, 1))
    if a.scale != 1:
        rgba = cv2.resize(rgba, (int(rgba.shape[1] * a.scale), int(rgba.shape[0] * a.scale)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(a.out, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    dbg = np.vstack([P, bg * (1 - alpha[..., None]) + col * alpha[..., None], np.repeat(alpha[..., None] * 255, 3, 2)])
    cv2.imwrite(os.path.splitext(a.out)[0] + '-debug.png', np.clip(dbg, 0, 255).astype(np.uint8)[:, :, ::-1])
    print('rows', r0, r1, 'tile', rgba.shape, 'max alpha', alpha.max().round(2))


if __name__ == '__main__':
    main()

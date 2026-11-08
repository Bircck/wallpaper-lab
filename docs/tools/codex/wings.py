"""Ultrawide side wings for a 16:9 painting: one Codex edit outpaints the edges, the centre stays byte-exact.

At 21:9 a cover crop of a 16:9 painting cuts focal features at the top and bottom. With ~120 art px of wing on each
side the art is wider and 3440x1440 shows more rows. Staged CLI (work folder default ./wings):

  python -I wings.py prep  base.png --extra "what continues outward on the left and right"
        -> wings/ext-src.png (1x base with replicated edges, the outer E px blurred as placeholders),
           wings/center-1x.png, wings/prompt.txt (edit it if the wing content needs to be described better)
  python -I wings.py codex            -> wings/out.png (one Codex edit, retried once)
  python -I wings.py merge            -> wings/ext-1x.png: only the outer E px bands are kept, shifted by a per-row colour
                                         offset measured at the seam (smoothed along the rows, fading to ~40% outward)
                                         and cross-faded over a few px inside the wing
  (upscale wings/ext-1x.png to 2x with an upscaler -> wings/ext-x2.png)
  python -I wings.py hires base-2x.png out.png
        -> the exact 2x base with the upscaled wings attached (JPEG quality 92 if out ends in .jpg)

Options: --dir wings  --edge 120 (wing width in 1x art px)  --size 1672x941 (1x art size).
Notes: a mirrored wing was tried first and read as obviously symmetric. Keep clouds and boats out of the wing prompt.
Masks that cover the wings should repeat the painting's edge column. Needs numpy, opencv-python, Pillow and the codex CLI.
"""
import argparse, os, shutil, subprocess, sys, time
import numpy as np, cv2
from PIL import Image

PROMPT = ("Use your built-in image generation tool to make a precise EDIT of the FIRST attached image (`ext-src.png`). "
          "The left-most {E} pixels and the right-most {E} pixels of the image are blurry placeholders. "
          "REPAINT ONLY those two outer bands so the scene continues naturally outward: {extra} "
          "Paint them sharp, in the same hand-painted style, line weight, lighting and level of detail as the rest of the image, "
          "with no mirror symmetry and no blur. No clouds, no new buildings, no boats. "
          "Change NOTHING else: keep every other pixel, the canvas size, framing, camera, perspective, all other objects, "
          "the sky, water and light identical. No other new objects, no text. "
          "After generating, copy the generated PNG file to `out.png` in the current working directory and print its pixel size.")


def attach(center, wingsrc, e, feather):
    H, W = center.shape[:2]
    out = np.zeros((H, W + 2 * e, 3), np.float64)
    out[:, e:e + W] = center
    for side in ('L', 'R'):
        if side == 'L':
            wing = wingsrc[:, :e].copy()
            ref_c, ref_w = center[:, :feather * 2], wingsrc[:, e:e + feather * 2]
        else:
            wing = wingsrc[:, -e:].copy()
            ref_c, ref_w = center[:, -feather * 2:], wingsrc[:, -e - feather * 2:-e]
        delta = (ref_c - ref_w).mean(1)
        delta = cv2.GaussianBlur(delta[:, None, :], (0, 0), sigmaX=0.1, sigmaY=feather)[:, 0, :]
        x = np.arange(e) if side == 'R' else np.arange(e)[::-1]
        wfade = np.clip(1 - x / e * 0.6, 0.4, 1)
        wing = wing + delta[:, None, :] * wfade[None, :, None]
        if side == 'L':
            out[:, :e] = wing
        else:
            out[:, e + W:] = wing
    for side in ('L', 'R'):
        for i in range(feather):
            t = (i + 1) / (feather + 1)
            if side == 'L':
                xw, xc = e - feather + i, e
            else:
                xw, xc = e + W + feather - 1 - i, e + W - 1
            out[:, xw] = out[:, xw] * (1 - t * .5) + out[:, xc] * (t * .5)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['prep', 'codex', 'merge', 'hires'])
    ap.add_argument('files', nargs='*')
    ap.add_argument('--dir', default='wings')
    ap.add_argument('--edge', type=int, default=120)
    ap.add_argument('--size', default='1672x941')
    ap.add_argument('--extra', default='continue the sky, horizon, water and foreground outward on both sides in the same way.')
    a = ap.parse_args()
    E = a.edge
    W0, H0 = (int(v) for v in a.size.split('x'))
    d = a.dir
    os.makedirs(d, exist_ok=True)
    p = lambda n: os.path.join(d, n)

    if a.cmd == 'prep':
        base = np.asarray(Image.open(a.files[0]).convert('RGB').resize((W0, H0), Image.LANCZOS))
        src = cv2.copyMakeBorder(base, 0, 0, E, E, cv2.BORDER_REPLICATE)
        blur = cv2.GaussianBlur(src, (0, 0), 12)
        src[:, :E] = blur[:, :E]
        src[:, -E:] = blur[:, -E:]
        Image.fromarray(src).save(p('ext-src.png'))
        Image.fromarray(base).save(p('center-1x.png'))
        open(p('prompt.txt'), 'w', encoding='utf-8').write(PROMPT.format(E=E, extra=a.extra) + '\n')
        print(p('ext-src.png'), src.shape)
    elif a.cmd == 'codex':
        codex = shutil.which('codex') or 'codex'
        for attempt in range(2):
            t = time.time()
            with open(p('prompt.txt'), 'rb') as fin, open(p('codex.log'), 'wb') as fout:
                rc = subprocess.run([codex, 'exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-i', 'ext-src.png'],
                                    stdin=fin, stdout=fout, stderr=subprocess.STDOUT, cwd=d).returncode
            print(f'attempt {attempt + 1} exit {rc} {time.time() - t:.0f}s out={os.path.exists(p("out.png"))}', flush=True)
            if os.path.exists(p('out.png')):
                break
    elif a.cmd == 'merge':
        src = np.asarray(Image.open(p('out.png')).convert('RGB').resize((W0 + 2 * E, H0), Image.LANCZOS)).astype(np.float64)
        center = np.asarray(Image.open(p('center-1x.png')).convert('RGB')).astype(np.float64)
        print('centre MAD vs base', round(np.abs(src[:, E:E + W0] - center).mean(), 2))
        ext = attach(center, src, E, 6)
        Image.fromarray(ext.round().clip(0, 255).astype(np.uint8)).save(p('ext-1x.png'))
        print(p('ext-1x.png'), ext.shape)
    elif a.cmd == 'hires':
        S = 2
        base = np.asarray(Image.open(a.files[0]).convert('RGB')).astype(np.float64)
        up = np.asarray(Image.open(p('ext-x2.png')).convert('RGB')).astype(np.float64)
        assert up.shape[1] == base.shape[1] + 2 * E * S, (up.shape, base.shape)
        ext = attach(base, up, E * S, 12)
        img = ext.round().clip(0, 255).astype(np.uint8)
        out = a.files[1]
        if out.lower().endswith(('.jpg', '.jpeg')):
            cv2.imwrite(out, img[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 92])
        else:
            Image.fromarray(img).save(out)
        print(out, ext.shape)


if __name__ == '__main__':
    main()

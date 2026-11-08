"""Crop sheet at 1:1 of the 2x masters. usage: sheet.py source.png out.jpg label=path.png [label=path.png ...]"""
import sys, json, cv2, numpy as np
from pathlib import Path
HERE = Path(__file__).parent
SRC = cv2.imread(sys.argv[1])
CROPS = json.loads((HERE / "crops.json").read_text())
out, cols = sys.argv[2], [a.split("=", 1) for a in sys.argv[3:]]
ims = [("source pixel-doubled", cv2.resize(SRC, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST))]
ims += [(l, cv2.imread(p)) for l, p in cols]
pick = [k for k in CROPS if k in (HERE / "rows.txt").read_text().split()] if (HERE / "rows.txt").exists() else list(CROPS)
rows = []
for k in pick:
    x, y, w, h = CROPS[k]
    tiles = []
    for l, im in ims:
        t = im[2*y:2*(y+h), 2*x:2*(x+w)].copy()
        cv2.rectangle(t, (0, 0), (len(l) * 11 + 110, 26), (0, 0, 0), -1)
        cv2.putText(t, f"{k}: {l}", (6, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(t); tiles.append(np.full((2*h, 6, 3), 30, np.uint8))
    rows.append(np.hstack(tiles[:-1])); rows.append(np.full((6, rows[-1].shape[1], 3), 30, np.uint8))
cv2.imwrite(out, np.vstack(rows[:-1]), [cv2.IMWRITE_JPEG_QUALITY, 92])

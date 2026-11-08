"""Step 1 baseline: Lanczos 2x + light unsharp, crop list, and screen framing overlay.
usage: baseline.py <source.png>   (writes master-lanczos*.png, crops.json, framing-ultrawide.jpg next to this script)"""
import sys, cv2, numpy as np
from pathlib import Path
HERE = Path(__file__).parent
SRC = Path(sys.argv[1])
img = cv2.imread(str(SRC))
h, w = img.shape[:2]

def lanczos2x(im):
    return cv2.resize(im, (im.shape[1]*2, im.shape[0]*2), interpolation=cv2.INTER_LANCZOS4)

def unsharp(im, sigma=1.2, amount=0.35):
    blur = cv2.GaussianBlur(im, (0, 0), sigma)
    return cv2.addWeighted(im, 1 + amount, blur, -amount, 0)

up = lanczos2x(img)
cv2.imwrite(str(HERE / "master-lanczos.png"), up)
cv2.imwrite(str(HERE / "master-lanczos-usm.png"), unsharp(up))

# crops in source coords (x, y, w, h)
CROPS = {"sea": (180, 560, 320, 220), "island": (560, 170, 320, 220),
         "pier": (1220, 400, 320, 220), "palm": (800, 0, 320, 220),
         "subject": (1110, 140, 320, 220), "shoe": (960, 420, 320, 220)}
if __name__ == "__main__":
    import json; (HERE / "crops.json").write_text(json.dumps(CROPS, indent=1))
    # framing: 16:9 is full frame; ultrawide 3440x1440 cover-fit crops rows
    uw_h = round(w / (3440 / 1440)); y0 = (h - uw_h) // 2
    fr = img.copy(); ov = fr.copy()
    ov[:y0] = 0; ov[y0 + uw_h:] = 0
    fr = cv2.addWeighted(fr, 0.45, ov, 0.55, 0)
    cv2.rectangle(fr, (0, y0), (w - 1, y0 + uw_h), (0, 255, 255), 2)
    cv2.putText(fr, f"ultrawide 3440x1440 centre crop: rows {y0}-{y0+uw_h} of {h}", (20, y0 + 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
    cv2.imwrite(str(HERE / "framing-ultrawide.jpg"), fr, [cv2.IMWRITE_JPEG_QUALITY, 88])

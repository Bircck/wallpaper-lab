"""Contact sheet from verify.cjs captures: one row per resolution, one column per time.

usage: python -I docs/tools/web-wallpaper-kit/contact.py <dir-with-WxH_tSS.png> [out.png] [--width 2400]
Each row keeps its aspect ratio (16:9 and 21:9 rows differ in height), so ultrawide cropping is visible.
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

args = [a for a in sys.argv[1:] if not a.startswith('--')]
src = Path(args[0])
out = Path(args[1]) if len(args) > 1 else src / 'contact.png'
sheet_w = int(sys.argv[sys.argv.index('--width') + 1]) if '--width' in sys.argv else 2400

pat = re.compile(r'^(\d+)x(\d+)_t(\d+)\.png$')
shots = {}
for f in sorted(src.iterdir()):
    m = pat.match(f.name)
    if m:
        shots.setdefault((int(m[1]), int(m[2])), {})[int(m[3])] = f
if not shots:
    sys.exit(f'no WxH_tSS.png files in {src}')

times = sorted({t for row in shots.values() for t in row})
pad, label_h = 8, 26
cell_w = (sheet_w - pad * (len(times) + 1)) // len(times)
rows = sorted(shots)
row_h = [round(cell_w * h / w) for (w, h) in rows]
H = pad + sum(rh + label_h + pad for rh in row_h)
sheet = Image.new('RGB', (sheet_w, H), (24, 24, 28))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('arial.ttf', 16)
except OSError:
    font = ImageFont.load_default()

y = pad
for (w, h), rh in zip(rows, row_h):
    for i, t in enumerate(times):
        x = pad + i * (cell_w + pad)
        draw.text((x, y + 4), f'{w}x{h}  t={t}s  ({src.name})', fill=(220, 220, 220), font=font)
        f = shots[(w, h)].get(t)
        if f:
            im = Image.open(f).convert('RGB').resize((cell_w, rh), Image.LANCZOS)
            sheet.paste(im, (x, y + label_h))
        else:
            draw.rectangle((x, y + label_h, x + cell_w, y + label_h + rh), outline=(90, 90, 90))
    y += rh + label_h + pad
sheet.save(out)
print(out)

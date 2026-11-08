"""Image -> mesh with TripoSR (MIT, VAST-AI-Research + Stability AI), local.
usage: copy this folder's scripts (and shim/) into a working folder, then from the repo root:
  python docs/tools/gpu_lock.py -- <absolute path to docs/tools/gpu-venv python> -I <working folder>/triposr_run.py <id> [--res 256] [--cpu] [--fg 0.85]
(gpu_lock needs the absolute python path.) Input ref/<id>.png (RGBA from cut_ref.py). Writes mesh/<id>-r<res>.obj (vertex
colours) and mesh/<id>-input.png. Code: docs/tools/models/triposr/code (git clone, commit in docs/tools/image-to-3d.md),
weights: docs/tools/models/triposr/weights. torchmcubes and rembg are replaced by shim/ (scikit-image marching cubes;
inputs are already RGBA)."""
import sys, os, re, time, argparse
from pathlib import Path
HERE = Path(__file__).resolve().parent
def _find_tsr():
    if os.environ.get('TRIPOSR_DIR'): return Path(os.environ['TRIPOSR_DIR'])
    for base in (HERE, Path.cwd()):
        for d in [base, *base.parents]:
            if (d / 'docs/tools/models/triposr').exists(): return d / 'docs/tools/models/triposr'
    raise SystemExit('TripoSR folder not found: set TRIPOSR_DIR (see docs/tools/image-to-3d.md)')
TSR = _find_tsr()
os.environ.setdefault('HF_HOME', str(TSR / 'hf'))
sys.path.insert(0, str(HERE / 'shim')); sys.path.insert(0, str(TSR / 'code'))
import numpy as np, torch
from PIL import Image
from omegaconf import OmegaConf
from tsr.system import TSR as Model
from tsr.utils import resize_foreground

ap = argparse.ArgumentParser()
ap.add_argument('id'); ap.add_argument('--res', type=int, default=256); ap.add_argument('--cpu', action='store_true')
ap.add_argument('--fg', type=float, default=.85); ap.add_argument('--thresh', type=float, default=25.)
a = ap.parse_args()
dev = 'cpu' if a.cpu or not torch.cuda.is_available() else 'cuda:0'
t0 = time.time()
# transformers 5 renamed the ViT layers (encoder.layer.N.attention.attention.query -> layers.N.attention.q_proj, ...);
# the checkpoint has the transformers 4.35 names, so build the model from the config and rename the keys
cfg = OmegaConf.load(TSR / 'weights/config.yaml'); OmegaConf.resolve(cfg)
model = Model(cfg)
REN = [(r'\.encoder\.layer\.(\d+)\.', r'.layers.\1.'), (r'\.attention\.attention\.query\.', '.attention.q_proj.'),
       (r'\.attention\.attention\.key\.', '.attention.k_proj.'), (r'\.attention\.attention\.value\.', '.attention.v_proj.'),
       (r'\.attention\.output\.dense\.', '.attention.o_proj.'), (r'\.intermediate\.dense\.', '.mlp.fc1.'),
       (r'(layers\.\d+)\.output\.dense\.', r'\1.mlp.fc2.')]
ck = torch.load(TSR / 'weights/model.ckpt', map_location='cpu')
want = set(model.state_dict())
sd = {}
for k, v in ck.items():
    if k not in want and k.startswith('image_tokenizer.'):
        for pat, rep in REN: k = re.sub(pat, rep, k)
    sd[k] = v
missing, unexpected = model.load_state_dict(sd, strict=False)
if missing or unexpected: sys.exit(f'state dict mismatch: missing {missing[:6]} ({len(missing)}), unexpected {unexpected[:6]} ({len(unexpected)})')
model.renderer.set_chunk_size(8192)
model.to(dev)
im = resize_foreground(Image.open(HERE / 'ref' / f'{a.id}.png').convert('RGBA'), a.fg)
im.save(HERE / 'mesh' / f'{a.id}-input-rgba.png')   # the exact framing the model saw, for projecting the painting back on
x = np.asarray(im).astype(np.float32) / 255
x = x[..., :3] * x[..., 3:4] + (1 - x[..., 3:4]) * .5
inp = Image.fromarray((x * 255).astype(np.uint8))
inp.save(HERE / 'mesh' / f'{a.id}-input.png')
with torch.no_grad():
    codes = model([inp], device=dev)
    print(f'{dev}: scene codes in {time.time() - t0:.1f}s', flush=True)
    mesh = model.extract_mesh(codes, True, resolution=a.res, threshold=a.thresh)[0]
out = HERE / 'mesh' / f'{a.id}-r{a.res}.obj'
mesh.export(str(out))
print(f'wrote {out.name}: {len(mesh.vertices)} verts, {len(mesh.faces)} faces, bounds {np.round(mesh.bounds, 3).tolist()}, {time.time() - t0:.1f}s')
if dev != 'cpu': print(f'peak VRAM {torch.cuda.max_memory_allocated() / 2**20:.0f} MiB')

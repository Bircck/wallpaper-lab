"""Export SAM 2.1 Hiera Tiny to ONNX for segment.py and sam_refine.py, with parity checks against PyTorch.

Folder layout (the same one segment.py reads through WL_SAM_DIR, default docs/tools/models/sam2-onnx):
  <dir>/sam2-src/          git clone https://github.com/facebookresearch/sam2  (tested at 2b90b9f5ceec907a1c18123530e92e794ad901a4)
  <dir>/sam2-src/checkpoints/sam2.1_hiera_tiny.pt
                           https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt (156,008,466 bytes, Apache 2.0)
  <dir>/onnxruntime-src/   git clone https://github.com/microsoft/onnxruntime  (tested at 8fc9fd597453baae1ad73379c313f0586d812867;
                           only onnxruntime/python/tools/transformers/models/sam2 is used)
  <dir>/models/            written by this script

Run (CPU is enough; tested with Python 3.12, PyTorch 2.14.1 CPU, torchvision 0.29.1, ONNX 1.23.2, ONNX Runtime 1.31.0,
ONNX Script 0.7.2, OpenCV 5.0.0.93, and the sam2 package installed from sam2-src):
  python docs/tools/cutout/export_sam2_onnx.py [<dir>]

The encoder and the multimask decoder passed parity. The single-mask decoder failed it for this checkpoint and runtime
(48% of outputs over tolerance), so segment.py uses only the multimask decoder. A failed single-mask check is expected.
"""
from pathlib import Path
import os, sys
import torch

base = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('WL_SAM_DIR', Path(__file__).resolve().parents[1] / 'models' / 'sam2-onnx')).resolve()
checkpoint = base / 'sam2-src' / 'checkpoints' / 'sam2.1_hiera_tiny.pt'
orthome = base / 'onnxruntime-src' / 'onnxruntime' / 'python' / 'tools' / 'transformers' / 'models' / 'sam2'
for need in (checkpoint, orthome):
    if not need.exists():
        sys.exit(f'missing {need} (see the layout at the top of this file)')
sys.path.insert(0, str(orthome))

from sam2.build_sam import build_sam2
from image_encoder import export_image_encoder_onnx, test_image_encoder_onnx
from image_decoder import export_decoder_onnx, test_decoder_onnx

_original_export = torch.onnx.export
def _legacy_export(*args, **kwargs):
    kwargs.setdefault('dynamo', False)
    return _original_export(*args, **kwargs)
torch.onnx.export = _legacy_export

out = base / 'models'
out.mkdir(exist_ok=True)
encoder = out / 'sam2.1_hiera_tiny_image_encoder.onnx'
decoder = out / 'sam2.1_hiera_tiny_image_decoder.onnx'
decoder_multi = out / 'sam2.1_hiera_tiny_image_decoder_multi.onnx'
torch.set_num_threads(max(1, min(8, torch.get_num_threads())))
print(f'PyTorch {torch.__version__}; threads={torch.get_num_threads()}; device=CPU', flush=True)
model = build_sam2('configs/sam2.1/sam2.1_hiera_t.yaml', str(checkpoint), device='cpu')
print('Export + verify image encoder...', flush=True)
export_image_encoder_onnx(model, str(encoder))
with torch.no_grad():
    test_image_encoder_onnx(model, str(encoder))
print('Export + verify single-mask decoder (its check may fail; it is not used)...', flush=True)
export_decoder_onnx(model, str(decoder), False)
try:
    with torch.no_grad():
        test_decoder_onnx(model, str(decoder), False)
except Exception as e:
    print('single-mask decoder check failed, as expected:', e, flush=True)
print('Export + verify multimask decoder...', flush=True)
export_decoder_onnx(model, str(decoder_multi), True)
with torch.no_grad():
    test_decoder_onnx(model, str(decoder_multi), True)
print('Done:', out, flush=True)

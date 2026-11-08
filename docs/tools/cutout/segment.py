"""Cut-out helpers: Finegrain Box Segmenter (first pass) and SAM2.1 Tiny (corrections), both local ONNX on CPU.

Import it from a script next to it (`sys.path.insert(0, 'docs/tools/cutout'); import segment`):
    alpha = segment.finegrain(bgr, (x0, y0, x1, y1), margin=0.05)      # soft alpha, full canvas, float 0..1
    mask, scores = segment.sam(bgr, points=[(x, y, 1), (x2, y2, 0)], box=None, pick=None)   # binary mask

Run it on an upscaled crop of the object, not the whole scene (see docs/approaches/cutting-out-a-painted-prop.md).
Models are read, never written. Where they live (see docs/tools/cutout-segmenters.md for downloads):
    WL_FINEGRAIN  folder with finegrain.onnx      (default: docs/tools/models/finegrain)
    WL_SAM_DIR    folder for SAM2.1-Tiny ONNX, containing onnxruntime-src/ (Microsoft's SAM2 exporter code),
                  sam2-src/checkpoints/sam2.1_hiera_tiny.pt and models/sam2.1_hiera_tiny_image_{encoder,decoder,decoder_multi}.onnx
                  (only needed for sam(); the exports are described in cutout-segmenters.md)
Needs numpy, opencv-python, onnxruntime (and torch for sam()). Run with `python -I` from a venv, not from the models folder.
"""
import os
from pathlib import Path
import sys
import numpy as np, cv2

_TOOLS = Path(__file__).resolve().parents[1]
FINEGRAIN = Path(os.environ.get('WL_FINEGRAIN', _TOOLS / 'models' / 'finegrain'))
TRIAL = Path(os.environ.get('WL_SAM_DIR', _TOOLS / 'models' / 'sam2-onnx'))
_fg = None
_sam = None
_sam_img = None


def finegrain(bgr, box, margin=0.0):
    """Soft alpha (float HxW, full canvas) for the object inside box=(x0,y0,x1,y1)."""
    global _fg
    import onnxruntime as ort
    if _fg is None:
        o = ort.SessionOptions(); o.intra_op_num_threads = 4
        _fg = ort.InferenceSession(str(FINEGRAIN / 'finegrain.onnx'), sess_options=o, providers=['CPUExecutionProvider'])
    H, W = bgr.shape[:2]
    x0, y0, x1, y1 = box
    mx, my = int((x1 - x0) * margin), int((y1 - y0) * margin)
    x0, y0, x1, y1 = max(0, x0 - mx), max(0, y0 - my), min(W, x1 + mx), min(H, y1 + my)
    crop = cv2.cvtColor(bgr[y0:y1, x0:x1], cv2.COLOR_BGR2RGB)
    size = 1024
    x = cv2.resize(crop, (size, size), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    x = ((x - [.485, .456, .406]) / [.229, .224, .225]).transpose(2, 0, 1)[None].astype(np.float32)
    pred = _fg.run(None, {_fg.get_inputs()[0].name: x})[0][0, 0]
    pred = 1 / (1 + np.exp(-np.clip(pred, -80, 80)))
    out = np.zeros((H, W), np.float32)
    out[y0:y1, x0:x1] = cv2.resize(pred, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
    return out


def sam(bgr, points=None, box=None, pick=None):
    """Binary mask from SAM2.1 Tiny; returns (mask, scores)."""
    global _sam, _sam_img
    if _sam is None:
        sys.path.insert(0, str(TRIAL / 'onnxruntime-src/onnxruntime/python/tools/transformers/models/sam2'))
        import torch; torch.set_num_threads(4)
        from sam2.build_sam import build_sam2
        from sam2_image_onnx_predictor import SAM2ImageOnnxPredictor
        m = build_sam2('configs/sam2.1/sam2.1_hiera_t.yaml', str(TRIAL / 'sam2-src/checkpoints/sam2.1_hiera_tiny.pt'), device='cpu')
        _sam = SAM2ImageOnnxPredictor(m, image_encoder_onnx_path=str(TRIAL / 'models/sam2.1_hiera_tiny_image_encoder.onnx'),
                                      image_decoder_onnx_path=str(TRIAL / 'models/sam2.1_hiera_tiny_image_decoder.onnx'),
                                      image_decoder_multi_onnx_path=str(TRIAL / 'models/sam2.1_hiera_tiny_image_decoder_multi.onnx'),
                                      provider='CPUExecutionProvider', device='cpu')
    key = (bgr.shape, int(bgr[::37, ::41].sum()))
    if _sam_img != key:
        _sam.set_image(np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
        _sam_img = key
    kw = dict(multimask_output=True)
    if points:
        kw['point_coords'] = np.asarray([p[:2] for p in points], np.float32)
        kw['point_labels'] = np.asarray([p[2] for p in points], np.int32)
    if box is not None:
        kw['box'] = np.asarray(box, np.float32)
    masks, scores, _ = _sam.predict(**kw)
    masks = np.asarray(masks); scores = np.asarray(scores).reshape(-1)
    if masks.ndim == 4:
        masks = masks[:, 0]
    i = int(np.argmax(scores)) if pick is None else pick
    return masks[i] > 0, scores

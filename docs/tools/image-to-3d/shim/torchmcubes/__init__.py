"""Stand-in for torchmcubes (a CUDA extension TripoSR wants; not built here): scikit-image marching cubes on CPU.
torchmcubes returns vertices in (z, y, x) index order, which TripoSR flips back, so do the same."""
import numpy as np, torch
from skimage.measure import marching_cubes as _mc

def marching_cubes(vol, thresh):
    v, f, _, _ = _mc(vol.detach().cpu().numpy().astype(np.float32), level=thresh)
    return torch.from_numpy(np.ascontiguousarray(v[:, ::-1]).astype(np.float32)), torch.from_numpy(f[:, ::-1].astype(np.int64).copy())

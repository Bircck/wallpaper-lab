"""Find the crab's legs and claws in the leveled TripoSR mesh and write the rig.
usage (from the working folder): <gpu-venv python> -I analyse_parts.py     (needs work/leveled.npz from `crab.py -- export`)
The image-to-3D mesh is one surface: the legs touch each other and the front legs touch the claws. So:
1. body = an ellipsoid round the carapace; geodesic distance d from it over the mesh (Dijkstra on the edge graph).
2. tips = greedy local maxima of d (no two within 3 art px); each tip's shortest path back to the body is its chain,
   re-centred inside the leg (mean of the surface points round each path point).
3. every vertex goes to the nearest chain point (chain id, s = 0 at the body .. 1 at the tip); the weight to the chain
   fades in over the first 1.5 art px of d, so the joint to the body bends softly.
Writes work/rig.npz (chain id, s, w per vertex), rig.json (chains: points in BU, kind) and work/rig.png (check)."""
import json
import numpy as np
from pathlib import Path
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
HERE = Path(__file__).resolve().parent
d = np.load(HERE / 'work' / 'leveled.npz'); P = d['P'].astype(np.float64); F = d['F']
n = len(P)
E = np.unique(np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1), axis=0)
L = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
# one leg is its own island (TripoSR left a hair-thin gap at its base): bridge points of different islands closer than 0.6 art px
from scipy.sparse.csgraph import connected_components
G0 = coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n))
_, isl = connected_components(G0, directed=False)
pairs = np.array(sorted(cKDTree(P).query_pairs(.006)))
pairs = pairs[isl[pairs[:, 0]] != isl[pairs[:, 1]]]
print('islands', np.bincount(isl).tolist()[:6], 'bridges', len(pairs))
E = np.r_[E, pairs]; L = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
G = coo_matrix((np.r_[L, L], (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(n, n)).tocsr()
C0, R0 = np.array([-.02, 0, .095]), np.array([.068, .078, .05])
body = (((P - C0) / R0) ** 2).sum(1) < 1
src = np.nonzero(body)[0]
dist, pred, srcs = dijkstra(G, indices=src, min_only=True, return_predecessors=True)
dist[body] = 0
# tips: local maxima of d (nothing farther out within 2 art px), at least 3.5 art px out; merge tips closer than 2.5 art px
tree = cKDTree(P)
cand = [v for v in np.nonzero(dist > .035)[0] if dist[v] >= dist[tree.query_ball_point(P[v], .02)].max() - 1e-12]
tips = []
for v in sorted(cand, key=lambda v: -dist[v]):
    if all(np.linalg.norm(P[v] - P[t]) > .025 for t in tips): tips.append(v)
print('tips', len(tips))
chains = []
for t in tips:
    path = [t]
    while pred[path[-1]] >= 0: path.append(pred[path[-1]])
    path = path[::-1]                                     # body -> tip
    pts = P[path]
    cen = np.array([P[tree.query_ball_point(p, .012)].mean(0) for p in pts])
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(cen, axis=0), axis=1))]
    # resample to 12 points
    s = np.linspace(0, seg[-1], 12)
    cen = np.stack([np.interp(s, seg, cen[:, k]) for k in range(3)], 1)
    raw = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    chains.append(dict(tip=int(t), length=float(seg[-1]), pts=cen, path=np.array(path), ps=raw / max(raw[-1], 1e-9)))
# kind: claws are the chains whose tips are in front (x > .035) and inside the leg span (|y| < .1) and above the ground
for c in chains:
    tp = c['pts'][-1]
    c['side'] = 'L' if tp[1] < 0 else 'R'
    c['kind'] = 'claw' if tp[0] > .03 and abs(tp[1]) < .1 and tp[2] > .015 else 'leg'
# assign vertices: geodesically nearest path point (a straight-line nearest point jumped between touching legs, and one
# leg vertex that followed the claw drew a long spike when the claw rose)
pv = np.concatenate([c['path'] for c in chains]); pc = np.concatenate([[i] * len(c['path']) for i, c in enumerate(chains)])
ps = np.concatenate([c['ps'] for c in chains])
pv, first = np.unique(pv, return_index=True); pc, ps = pc[first], ps[first]
dg, _, srcv = dijkstra(G, indices=pv, min_only=True, return_predecessors=True)
lut = {v: k for k, v in enumerate(pv)}
src_idx = np.array([lut.get(v, -1) for v in srcv])
chain = np.where(src_idx >= 0, pc[np.maximum(src_idx, 0)], -1); spar = np.where(src_idx >= 0, ps[np.maximum(src_idx, 0)], 0.)
w = np.clip(dist / .015, 0, 1); w = w * w * (3 - 2 * w)
chain[body & (w == 0)] = -1
np.savez(HERE / 'work' / 'rig.npz', chain=chain, s=spar, w=w)
out = [dict(id=i, side=c['side'], kind=c['kind'], length=round(c['length'], 4), tip=np.round(c['pts'][-1], 4).tolist(),
            pts=np.round(c['pts'], 4).tolist()) for i, c in enumerate(chains)]
(HERE / 'rig.json').write_text(json.dumps(dict(body=dict(centre=C0.tolist(), radii=R0.tolist()), chains=out), indent=1))
for c in out: print(c['id'], c['side'], c['kind'], 'len', c['length'], 'tip', c['tip'], 'verts', int((chain == c['id']).sum()))
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig, ax = plt.subplots(1, 3, figsize=(24, 8))
for a, (i, j, t) in zip(ax, [(1, 0, 'top (Y, X)'), (1, 2, 'front (Y, Z)'), (0, 2, 'side (X, Z)')]):
    a.scatter(P[chain < 0, i], P[chain < 0, j], s=.2, c='lightgrey')
    m = chain >= 0
    a.scatter(P[m, i], P[m, j], s=.3, c=chain[m] % 20, cmap='tab20', vmin=0, vmax=19)
    for c in out:
        q = np.array(c['pts']); a.plot(q[:, i], q[:, j], 'k-', lw=1.5); a.text(q[-1, i], q[-1, j], f"{c['id']}{c['kind'][0]}", fontsize=13, weight='bold')
    a.set_aspect('equal'); a.grid(True); a.set_title(t)
plt.tight_layout(); plt.savefig(HERE / 'work' / 'rig.png', dpi=70)

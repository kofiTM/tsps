"""Build Vorago's OSRS model with General Graardor's vertex labels (skinning transfer).

Vorago's own RS3 animation frames are not in the build-950 cache, so he borrows Graardor's
animations: Graardor's two body models are stretched over Vorago's bounding box and every
Vorago vertex takes the label of the nearest Graardor vertex. Graardor's animations then bend
Vorago's arms, legs and torso instead of moving him as one block.

    python3 vorago.py <rs3 cache dir>
"""
import os, sys
import numpy as np
from js5 import Cache
from osrscache import OsrsCache, model_vertices, model_labels
import convert, osrsmodel

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'models', 'vorago')
VORAGO_MODEL = 86771
GRAARDOR_MODELS = (27660, 27665)


RIGID_PIECES = False   # tried: rigid plates + smoothed body looked worse in game


def main():
    rs3 = Cache(sys.argv[1])
    osrs = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    data, info = convert.convert(rs3, VORAGO_MODEL, False, None, tint=True)
    m = osrsmodel.decode(data)
    gv, gl = [], []
    for mid in GRAARDOR_MODELS:
        d = osrs.group(7, mid)
        gv.append(model_vertices(d)); gl.append(np.array(model_labels(d)))
    gv = np.concatenate(gv).astype(float); gl = np.concatenate(gl)
    v = m['verts'].astype(float)
    # normalise both into a unit box so the stretch matches Vorago's proportions
    def norm(a):
        lo, hi = a.min(0), a.max(0)
        return (a - lo) / np.maximum(hi - lo, 1)
    nv, ng = norm(v), norm(gv)
    labels = np.empty(len(v), dtype=np.int64)
    for s in range(0, len(v), 512):
        d2 = ((nv[s:s + 512, None, :] - ng[None, :, :]) ** 2).sum(2)
        labels[s:s + 512] = gl[d2.argmin(1)]
    # Each connected piece of the mesh (rock plate, spike, limb segment) takes the label most
    # of its vertices got, so one piece never straddles two bones and tears when they move apart.
    parent = list(range(len(v)))
    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a, b, c in m['faces']:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra; parent[find(rc)] = ra
    nbrs = [set() for _ in range(len(v))]
    for a, b, c in m['faces']:
        nbrs[a].update((b, c)); nbrs[b].update((a, c)); nbrs[c].update((a, b))

    def smooth(members, passes=4):
        for _ in range(passes):
            new = labels.copy()
            for i in members:
                vals, counts = np.unique([labels[j] for j in nbrs[i]] + [labels[i]], return_counts=True)
                new[i] = vals[counts.argmax()]
            labels[:] = new

    comps = {}
    for i in range(len(v)):
        comps.setdefault(find(i), []).append(i)
    big = 0
    for members in (comps.values() if RIGID_PIECES else []):
        if len(members) > len(v) // 4:
            big += 1
            smooth(members)               # the main body: majority of each vertex's neighbours
            continue
        vals, counts = np.unique(labels[members], return_counts=True)
        labels[members] = vals[counts.argmax()]
    print('pieces', len(comps), 'kept per-vertex in', big, 'large piece(s)')
    body = osrsmodel.encode(m['verts'], m['faces'], m['colours'], vskins=labels)
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'body.dat'), 'wb').write(body)
    # one fully transparent triangle: fills Graardor's second model slot
    empty = osrsmodel.encode([[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 2]], [0], alphas=[255])
    open(os.path.join(OUT, 'empty.dat'), 'wb').write(empty)
    print('vorago body', len(body), 'bytes', len(v), 'verts', len(m['faces']), 'tris',
          'labels used', len(set(labels.tolist())), 'of', len(set(gl.tolist())))


if __name__ == '__main__':
    main()

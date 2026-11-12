"""Angel of Death pass 2: layered armour plates on her recoloured Nex model (aod_model.py).

    python3 aod_armour.py    ->  data/models/aod/1000449.dat (npc 17000's model, angel_of_death.py)

Each armoured area (breastplate, pauldrons, gauntlets, shins/ankles, front and outer thighs, knees)
is cut into horizontal bands; each band is a plate lifted off the skin (lower bands further out, so
they overlap like RS3's layers) with a one-sided rim for thickness. Every plate vertex has the label
of the skin vertex under it, so a plate moves exactly as the skin does: it can't stretch more than
Nex herself. An animation origin is the mean of its labels' vertices, so hidden helper vertices (no
faces) keep every origin exactly where it was; aod_check.py proves it on all of her animations.
"""
import os, sys
import numpy as np
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aod_model as P
import osrsanim as A

MODEL_ID = 1000449
BAND = 16           # band height (model units, rest pose)
BASE = 3.0          # plate lift off the skin
STEP = 0.9          # each lower band sits this much further out (overlapping layers)

def H(h, s, l): return (int(h) << 10) | (int(s) << 7) | int(max(0, min(127, l)))
def is_silver(c): return (c >> 10) == 10 and ((c >> 7) & 7) == 0

PAINT_STRETCH = 1.5   # model units: the most a silver-painted joint face may stretch in any animation

def armour_build(m, flab, cols, origin_groups, joint_stretch):
    V = m['verts'].astype(float); F = m['faces']; nv0 = len(V)
    P3 = V[F]; fn = np.cross(P3[:, 1] - P3[:, 0], P3[:, 2] - P3[:, 0])
    area = 0.5 * np.linalg.norm(fn, axis=1); fnu = fn / np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-9)
    cen = P3.mean(1)
    # outward sign: the face's front points away from the body's vertical axis / forward for the face
    head = np.isin(flab, [165]); sign = -1.0 if fnu[head][:, 2].mean() > 0 else 1.0
    fnu *= sign; fn *= sign
    vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, F[:, k], fn)
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    lab = lambda i: int(flab[i])
    touch = P.wing_touch(m, flab)
    rigid = np.array([len(set(int(m['vskins'][v]) for v in f)) == 1 for f in F])
    hsl0 = [P.hsl(int(x)) for x in m['colours']]
    claw = np.array([(s_ == 0 or l_ >= 80) and area[j] < 40 for j, (h_, s_, l_) in enumerate(hsl0)])   # Nex's bone claws
    # The RS3 pieces, separate with red skin between them (kofi's reference, 2026-11-11). Each piece:
    # its labels, which faces of them (rest pose: y is up-negative, front is -z), and how many bands.
    nz, ny = fnu[:, 2], fnu[:, 1]
    ax = np.abs(cen[:, 0]); y = cen[:, 1]
    outward = np.sign(cen[:, 0]) * fnu[:, 0]
    front, back = nz < -0.25, nz > 0.25
    PIECES = [
        ('collar',    P.CHEST,              lambda i: y[i] < -248, 1),
        ('bust',      P.CHEST,              lambda i: front[i] and -246 < y[i] < -215, 1),
        ('backplate', P.CHEST,              lambda i: back[i] and -246 < y[i] < -218, 1),
        ('belly',     P.CHEST | P.TORSO,    lambda i: front[i] and -207 < y[i] < -166 and ax[i] < 16 - (y[i] + 207) * 0.33, 2),
        ('pauldron',  P.SHOULDER,           lambda i: y[i] < -221, 2),
        ('vambrace',  P.ARM,                lambda i: ax[i] >= 90, 1),
        ('gauntlet',  P.HAND,               lambda i: ax[i] >= 122 and not claw[i], 1),
        ('tasset',    P.THIGH,              lambda i: outward[i] > 0.45 and y[i] < -140, 1),
        ('thigh',     P.THIGH,              lambda i: front[i] and -134 < y[i] < -103, 1),
        ('kneecap',   P.KNEE,               lambda i: front[i] or outward[i] > 0.4, 1),
        ('greave',    P.SHIN,               lambda i: (front[i] or outward[i] > 0.3) and -80 < y[i] < -40, 2),
        ('foot',      P.FOOT,               lambda i: (ny[i] < -0.3 or front[i]) and y[i] < -15, 1),
    ]
    pick = {}; painted = []
    for name, labs, keep, bands in PIECES:
        # Only faces whose three vertices share one label: such a plate moves as one rigid piece and
        # can't stretch in any animation. A face across a joint (two labels) stretches as the skin does;
        # plated it showed as a silver sliver between her legs (kofi saw it) - it stays red skin.
        inside = [i for i in range(len(F)) if lab(i) in labs and not touch[i] and area[i] >= 3 and int(cols[i]) != 20288 and keep(i)]
        faces = [i for i in inside if rigid[i]]
        # The piece's faces across a joint are painted silver on the skin itself (no lift): skin
        # bends exactly as Nex's does, so the piece is whole (gauntlets, knee caps) and nothing stretches.
        for i in inside:
            # ...but only a joint face that holds its shape in every animation (kofi saw a grey
            # stretch at her knee): one that bends more stays red skin, a red gap as in RS3.
            if not rigid[i] and joint_stretch[i] <= PAINT_STRETCH: painted.append(i)
        if faces: pick[name] = (faces, bands)
    nV = [tuple(v) for v in V.tolist()]; nL = list(m['vskins'].tolist())
    nF = [tuple(f) for f in F.tolist()]; nC = list(cols.tolist())
    for i in painted: nC[i] = P.silver(min((int(m['colours'][i]) & 127) + 8, 92))
    nFS = list(m['fskins'].tolist()); nA = list(m['alphas'].tolist())
    added = []; stats = {}
    for name, (faces, bands) in pick.items():
        faces = np.array(faces); yy = cen[faces, 1]
        band = np.minimum(((yy - yy.min()) / max(1e-9, yy.max() - yy.min() + 1e-6) * bands).astype(int), bands - 1)
        for b in sorted(set(band.tolist())):
            bf = faces[band == b]; lift = BASE + STEP * b
            mp = {}
            for v in np.unique(F[bf]):
                p = np.rint(V[v] + vn[v] * lift).astype(int)
                mp[int(v)] = len(nV); nV.append(tuple(p)); nL.append(int(m['vskins'][v])); added.append(int(v))
            ecount = Counter()
            for i in bf:
                a, bb, cc = (int(x) for x in F[i])
                nF.append((mp[a], mp[bb], mp[cc]))
                c0 = int(cols[i]); l0 = c0 & 127
                col = P.silver(min((m['colours'][i] & 127) + 8, 92))   # plate silver, keeping Nex's shading
                col = (col & ~127) | max(0, min(127, (col & 127) + (6 if b % 2 == 0 else -4)))  # alternate the layers
                nC.append(col); nFS.append(int(m['fskins'][i])); nA.append(0)
                for e in ((a, bb), (bb, cc), (cc, a)): ecount[e] += 1
            # rims: an edge only this band's faces use (in either direction) gets a strip down to the skin
            rim = H(10, 0, 34)                                   # dark steel edge (RS3)
            fs0 = int(m['fskins'][bf[0]])
            for (a, bb), n in ecount.items():
                if ecount[(bb, a)] or n != 1: continue
                sa, sb, ta, tb = a, bb, mp[a], mp[bb]
                # one-sided, facing out of the band: the rim's normal points away from the band's faces
                inside = cen[bf].mean(0) - (V[a] + V[bb]) / 2
                q = [np.array(nV[x], float) for x in (sa, sb, tb)]
                nrm = np.cross(q[1] - q[0], q[2] - q[0]) * sign
                tris = ((sa, sb, tb), (sa, tb, ta)) if np.dot(nrm, inside) < 0 else ((sb, sa, ta), (sb, ta, tb))
                for tri in tris:
                    nF.append(tri); nC.append(rim); nFS.append(fs0); nA.append(0)
        stats[name] = (len(faces), int(bands))
    # ---------------------------------------------------------- pivot balancing
    # An animation origin is the mean of the vertices of the labels it lists. A label no origin lists
    # needs nothing; labels that share an origin (a component) must all grow by the same factor k with
    # their sums growing by k as well; a label alone needs its own mean kept. Exact in the client's
    # fractional NPC path: helper sums are exact integers.
    nL = np.array(nL); base_l = m['vskins']; Vi = np.array(nV, dtype=np.int64)
    n_l = Counter(base_l.tolist()); a_l = Counter(nL[nv0:].tolist())
    comp = {l: l for l in n_l}
    def root(x):
        while comp[x] != x: comp[x] = comp[comp[x]]; x = comp[x]
        return x
    used = set()
    for g in origin_groups:
        g = [l for l in g if l in n_l]; used |= set(g)
        for l in g[1:]: comp[root(l)] = root(g[0])
    comps = defaultdict(list)
    for l in used: comps[root(l)].append(l)
    helpers = []; far = 0.0; ks = []
    for members in comps.values():
        if not any(a_l.get(l, 0) for l in members): continue
        for k in range(2, 40):
            plan = []; ok = True
            for l in members:
                mc = (k - 1) * n_l[l] - a_l.get(l, 0)
                if mc < 0 or (a_l.get(l, 0) and mc == 0): ok = False; break
                if mc == 0: continue
                S = Vi[:nv0][base_l == l].sum(0); A_ = Vi[nv0:][nL[nv0:] == l].sum(0) if a_l.get(l, 0) else np.zeros(3, np.int64)
                T = (k - 1) * S - A_
                q, r = np.floor_divide(T, mc), np.mod(T, mc)
                mean = S / n_l[l]
                reach = float(np.abs(q - mean).max()) + 1
                # same-position runs (cheap to store): all helpers at q, the first r per axis at q+1
                pts = [q + (j < r).astype(np.int64) for j in range(mc)]
                plan.append((l, pts, reach))
            if not ok: continue
            worst = max((p[2] for p in plan), default=0)
            if worst < 40 or k == 39:
                for l, pts, reach in plan:
                    helpers += [(l, p) for p in pts]; far = max(far, reach)
                ks.append(k); break
    for l, p in helpers:
        nV.append(tuple(int(x) for x in p)); nL = np.append(nL, l)
    k = max(ks) if ks else 1
    out = dict(m)
    out.update(verts=np.array(nV, np.int64), faces=np.array(nF, np.int64), colours=np.array(nC, np.int64),
               vskins=np.array(nL, np.int64), fskins=np.array(nFS, np.int64), alphas=np.array(nA, np.int64))
    out['_sources'] = np.array(added, np.int64)
    out['_info'] = dict(painted=len(painted), regions=stats, plate_verts=len(added), helpers=len(helpers), k=k, helper_reach=float(far), nv0=nv0, nf0=len(F))
    return out


# ---------------------------------------------------------------- cache access and build
def cache():
    from osrscache import OsrsCache
    from aod import ROOT
    return ROOT, OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))

class Anims:
    """Nex's seqs, frames and frame bases from the OSRS cache."""
    def __init__(self, c):
        self.c, self._f, self._b, self._s = c, {}, {}, None
    def base(self, i):
        if i not in self._b: self._b[i] = A.decode_base(list(self.c.files(1, i).values())[0])
        return self._b[i]
    def frame(self, fid):
        g = fid >> 16
        if g not in self._f: self._f[g] = self.c.files(0, g)
        return A.decode_frame(self._f[g][fid & 0xffff], self.base)
    def seq(self, sid):
        if self._s is None: self._s = self.c.files(2, 12)
        return A.decode_seq(self._s[sid])
    def origin_groups(self, sid=9177):
        fb = self.frame(self.seq(sid)['frames'][0])['base']
        return [fb['labels'][i] for i, t in enumerate(fb['types']) if t == A.ORIGIN]

NEX_SEQS = [9175, 9176, 9177, 9178, 9179, 9180, 9181, 9182, 9183, 9184, 9185, 9186, 9187, 9188, 9189]

def face_stretch(m, anims):
    """The most each of Nex's faces' edges change length in any frame of her animations."""
    F = m['faces']; G = A.label_groups(m['vskins'])
    def edges(Vx): return np.stack([np.linalg.norm(Vx[F[:, a]] - Vx[F[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))], 1)
    rest = edges(m['verts'].astype(float)); worst = np.zeros(len(F))
    for sid in NEX_SEQS:
        for fid in anims.seq(sid)['frames']:
            worst = np.maximum(worst, np.abs(edges(A.animate_fractional(m['verts'], G, anims.frame(fid))) - rest).max(1))
    return worst

def armoured(c=None):
    root, c = cache() if c is None else (None, c)
    m = A.decode_v3(c.group(7, 43209))
    flab = P.face_labels(m); anims = Anims(c)
    return m, armour_build(m, flab, P.paint(m, flab), anims.origin_groups(), face_stretch(m, anims))

def main():
    root, c = cache()
    m, a = armoured(c)
    data = A.encode_v3(a)
    out = os.path.join(root, 'data', 'models', 'aod', '%d.dat' % MODEL_ID)
    open(out, 'wb').write(data)
    print('wrote', out, len(data), 'bytes;', a['_info'])

if __name__ == '__main__':
    main()

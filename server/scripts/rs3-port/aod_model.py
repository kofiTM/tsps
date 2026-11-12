"""Angel of Death look (npc 17000): RS3 AoD colours on OSRS Nex: red skin everywhere her armour goes
(aod_armour.py lays the silver plates on top, with red showing between them as in RS3). Build at the end."""
"""AoD palette on OSRS Nex (model 43209): every face keeps its own lightness (Nex's shading), with
the hue/saturation of its RS3 region. Regions come from the face's body-part label."""
import numpy as np
from collections import Counter

def H(h, s, l): return (int(h) << 10) | (int(s) << 7) | int(max(0, min(127, l)))
def hsl(c): return (c >> 10) & 63, (c >> 7) & 7, c & 127

R = lambda *ls: set(ls)
def rng(a, b): return set(range(a, b + 1))
WING = rng(0, 8) | rng(11, 29) | rng(31, 38) | rng(40, 40) | rng(42, 45) | rng(47, 59)
HAND = rng(61, 88) | rng(107, 134)
ARM = rng(89, 96) | rng(135, 142) | R(150)
SHOULDER = rng(97, 106) | R(143, 144, 147, 148, 157, 161) | rng(206, 209)
HEAD_SKIN = R(162, 163, 164, 165, 168, 167)
FACE = R(166)
BRAIDS = rng(169, 175)
CHEST = R(205)
TORSO = rng(210, 213) | R(176, 177, 180, 190, 195, 196, 198, 199)
HIPS = R(178, 185, 187, 189, 201)                   # her tail
THIGH = R(182, 204)
KNEE = R(186, 200)
SHIN = R(179, 197)
ANKLE = R(183, 193)
FOOT = R(184, 188)
TOES = R(181, 192, 194, 203)

PURPLE = lambda h, s: h in (46, 47, 48, 49, 50)          # Nex's skin family
TAN = lambda h, s: h in (5, 6) and s >= 1                # tan plates / membrane
WHITE = lambda h, s, l: s == 0 or l >= 80                # bone / ivory
DARKRED = lambda h, s: h in (0, 1) and s >= 1            # dark red feathers / guards

def skin(l): return H(0, 6, l * 0.95)                    # crimson skin
def feet(l): return skin(l)                              # red like her skin (kofi: no purple)
def wingtop(l): return H(0, 6, 22 + l * 0.45)            # red wing top
def feather(l): return H(51, 2, 10 + l * 0.35)           # dark purple-black feathers
def silver(l): return H(10, 0, 58 + l * 0.30)            # silver plate
def silver_dark(l): return H(10, 0, 40 + l * 0.30)
def gold(l): return H(8, 5, 52 + l * 0.12)               # gold trim
def hair(l): return H(0, 6, 14 + l * 0.30)               # dark crimson hair (kofi: no purple)
def horn(l): return H(7, 3, 70 + l * 0.15)               # pale horn / tusk
def claw(l): return H(7, 1, 92 + l * 0.12)               # bone-white claws (RS3)
def eye(l): return H(30, 7, 95)                          # cyan glow

HEAD = {47155: 'horn', 48315: 'horn', 6466: 'hair', 6447: 'collar', 6455: 'skin', 6453: 'skin',
        0: 'mouth', 50343: 'brow', 50372: 'brow', 6245: 'eye', 1139: 'eye', 1226: 'eye', 1209: 'eye',
        1319: 'gem', 6261: 'collar', 6241: 'collar', 50368: 'brow'}
def head(c, l):
    k = HEAD.get(c, 'skin')
    if k == 'horn': return horn(l)
    if k == 'hair': return hair(l)
    if k == 'collar': return skin(l)                     # her neck is red; the collar is a plate (aod_armour.py)
    if k == 'mouth': return H(0, 4, 8)
    if k == 'brow': return H(0, 5, 14 + l * 0.2)
    if k == 'eye': return eye(l)
    if k == 'gem': return gold(l)
    return skin(l)

def wing_touch(m, flab):
    """Faces touching the wing (a wing vertex, or an edge shared with a wing face): wing, never armour."""
    F_, L_ = m['faces'], m['vskins']
    wingface = np.array([int(x) in WING for x in flab])
    by_edge = {}
    for j, f in enumerate(F_.tolist()):
        for a, b in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0])): by_edge.setdefault((min(a, b), max(a, b)), []).append(j)
    touch = np.array([any(int(L_[v]) in WING for v in f) for f in F_])
    for js in by_edge.values():
        if any(wingface[j] for j in js):
            for j in js: touch[j] = True
    return touch

def wing_depth(m, flab):
    """How far each wing face hangs below the wing's top edge at its x (tiles of 128 units)."""
    V, F = m['verts'], m['faces']
    wing = np.array([int(l) in WING for l in flab])
    cen = V[F].mean(1)
    xs = cen[:, 0]; top = {}
    for i in np.where(wing)[0]:
        b = int(xs[i] // 8); top[b] = min(top.get(b, 1e9), cen[i, 1])
    d = np.zeros(len(F))
    for i in np.where(wing)[0]:
        b = int(xs[i] // 8)
        t = min(top.get(b + k, 1e9) for k in (-1, 0, 1))
        d[i] = cen[i, 1] - t
    return d

def paint(m, flab):
    out = m['colours'].copy(); depth = wing_depth(m, flab)
    P = m['verts'][m['faces']].astype(float)
    normal = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    area = 0.5 * np.linalg.norm(normal, axis=1)
    yext = P[:, :, 1].max(1) - P[:, :, 1].min(1)
    cen = P.mean(1)
    # Faces of the arm, hand or shoulder that touch the wing (a wing vertex, or an edge shared with a
    # wing face) are the wing's leading edge, not armour (kofi: grey only on the arm itself).
    wingtouch = wing_touch(m, flab)
    for i, c in enumerate(m['colours'].tolist()):
        h, s, l = hsl(c); lab = int(flab[i])
        if c == 20288: continue                          # transparent green markers: untouched
        if lab in WING:
            d = depth[i]
            if DARKRED(h, s): out[i] = feather(l) if d > 12 else H(0, 6, 16 + l * 0.3)
            elif d < 14: out[i] = wingtop(min(l, 70))
            elif d < 28: out[i] = H(62, 4, 10 + min(l, 70) * 0.35)   # red fading into the feathers
            else: out[i] = feather(min(l, 70))
        elif lab in HAND:
            if area[i] > 120 or yext[i] > 14 or wingtouch[i]: out[i] = wingtop(min(l, 70))   # wing panels at the wrist: wing, not armour (kofi)
            else: out[i] = claw(l) if WHITE(h, s, l) and area[i] < 40 else skin(l)
        elif lab in ARM:
            if area[i] > 120 or yext[i] > 14 or wingtouch[i]: out[i] = wingtop(min(l, 70))
            else: out[i] = skin(l)
        elif lab in SHOULDER:
            if wingtouch[i]: out[i] = wingtop(min(l, 70))
            else: out[i] = skin(l)
        elif lab in FACE or lab in HEAD_SKIN or lab in BRAIDS:
            out[i] = head(c, l)
        elif lab in CHEST:
            out[i] = skin(l)
        elif lab in TORSO:
            out[i] = skin(l)
        elif lab in HIPS:
            out[i] = H(0, 6, l * 0.75) if h in (0, 1) else skin(l)   # her tail: red, no armour (kofi)
        elif lab in THIGH or lab in KNEE:
            out[i] = skin(l)
        elif lab in SHIN or lab in ANKLE:
            out[i] = skin(l)
        elif lab in FOOT:
            out[i] = feet(l)
        elif lab in TOES:
            out[i] = claw(l) if WHITE(h, s, l) else feet(l)
        else:
            out[i] = skin(l) if PURPLE(h, s) else c
    # Her tail and the small of her back carry no armour (kofi): back-facing silver below the waist -> skin.
    back = (normal[:, 2] / np.maximum(area * 2, 1e-9)) > 0.2
    for i in np.where(back & (cen[:, 1] > -205) & (np.abs(cen[:, 0]) < 40) & (cen[:, 1] < -100))[0]:
        c = int(out[i])
        if (c >> 10) == 10 and ((c >> 7) & 7) == 0: out[i] = skin(m['colours'][i] & 127)
    return out


# ---------------------------------------------------------------- build
# python3 aod_model.py   ->  data/models/aod/1000448.dat (npc 17000's model, see angel_of_death.py)
# Nex's model 43209 with only its face colours changed (every other byte identical), so her
# animations play exactly as on Nex.
MODEL_ID = 1000448

def face_labels(m):
    from collections import Counter
    return np.array([Counter(m['vskins'][f].tolist()).most_common(1)[0][0] for f in m['faces']])

def build():
    import os, struct
    from osrscache import OsrsCache
    from aod import ROOT
    import osrsanim
    c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    raw = bytearray(c.group(7, 43209))
    m = osrsanim.decode_v3(bytes(raw))
    cols = paint(m, face_labels(m))
    for i, v in enumerate(cols.tolist()): struct.pack_into('>H', raw, m['colour_offset'] + 2 * i, v)
    m2 = osrsanim.decode_v3(bytes(raw))
    assert all(np.array_equal(m[k], m2[k]) for k in ('verts', 'faces', 'vskins', 'fskins', 'alphas'))
    out = os.path.join(ROOT, 'data', 'models', 'aod', '%d.dat' % MODEL_ID)
    open(out, 'wb').write(bytes(raw))
    print('wrote', out, len(raw), 'bytes;', int((m2['colours'] != m['colours']).sum()), 'faces recoloured')

if __name__ == '__main__':
    build()

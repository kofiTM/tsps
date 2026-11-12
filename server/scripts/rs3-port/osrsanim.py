"""OSRS (rev 241) model v3 decoder, seq/frame/framemap decoders and the classic vertex-label
animation player, mirroring the TSPS client (client/rs/model/ModelData.ts decodeV3, Model.ts
transform0, seq/SeqFrame.ts Dat2SeqFrame, seq/SeqBase.ts Dat2SeqBase, config/seqtype/SeqType.ts)."""
import math, struct
import numpy as np

SINE = [int(65536.0 * math.sin(i * 0.0030679615)) for i in range(2048)]
COSINE = [int(65536.0 * math.cos(i * 0.0030679615)) for i in range(2048)]


class Buf:
    def __init__(self, b, p=0): self.b, self.p = b, p
    def u8(self): v = self.b[self.p]; self.p += 1; return v
    def s8(self): v = self.u8(); return v - 256 if v > 127 else v
    def u16(self): v = (self.b[self.p] << 8) | self.b[self.p + 1]; self.p += 2; return v
    def u24(self): v = (self.b[self.p] << 16) | (self.b[self.p + 1] << 8) | self.b[self.p + 2]; self.p += 3; return v
    def i32(self): v = struct.unpack_from('>i', self.b, self.p)[0]; self.p += 4; return v
    def smart2(self):
        if self.b[self.p] < 128: return self.u8() - 64
        return self.u16() - 49152
    def string(self):
        e = self.b.index(0, self.p); s = self.b[self.p:e].decode('latin-1'); self.p = e + 1; return s


def decode_v3(b):
    assert b[-1] == 0xfd and b[-2] == 0xff, 'not a v3 model'
    h = Buf(b, len(b) - 26)
    nv, nf, ntex = h.u16(), h.u16(), h.u8()
    rtypes_f, prio_f, alpha_f, fskin_f, tex_f, vskin_f, maya_f = [h.u8() for _ in range(7)]
    lx, ly, lz, lidx, ltc, lvsk = [h.u16() for _ in range(6)]
    assert ntex == 0 and tex_f == 0 and maya_f == 0, 'textured / maya models not handled'
    o = ntex + nv
    o_rt = o
    if rtypes_f == 1: o += nf
    o_ct = o; o += nf
    o_pr = o
    if prio_f == 255: o += nf
    o_fs = o
    if fskin_f == 1: o += nf
    o_vs = o; o += lvsk
    o_al = o
    if alpha_f == 1: o += nf
    o_ix = o; o += lidx
    o_tx = o
    if tex_f == 1: o += nf * 2
    o_tc = o; o += ltc
    o_col = o; o += nf * 2
    o_x = o; o += lx
    o_y = o; o += ly
    o_z = o; o += lz
    fl, bx, by, bz, bs = Buf(b, ntex), Buf(b, o_x), Buf(b, o_y), Buf(b, o_z), Buf(b, o_vs)
    verts = np.zeros((nv, 3), np.int64); vskins = np.zeros(nv, np.int64) if vskin_f == 1 else None
    last = [0, 0, 0]
    for i in range(nv):
        f = fl.u8()
        d = [bx.smart2() if f & 1 else 0, by.smart2() if f & 2 else 0, bz.smart2() if f & 4 else 0]
        last = [last[k] + d[k] for k in range(3)]; verts[i] = last
        if vskins is not None: vskins[i] = bs.u8()
    cols = np.frombuffer(b, '>u2', nf, o_col).astype(np.int64)
    rtypes = np.frombuffer(b, 'i1', nf, o_rt).astype(np.int64) if rtypes_f == 1 else None
    prios = np.frombuffer(b, 'i1', nf, o_pr).astype(np.int64) if prio_f == 255 else None
    alphas = np.frombuffer(b, 'u1', nf, o_al).astype(np.int64) if alpha_f == 1 else None
    fskins = np.frombuffer(b, 'u1', nf, o_fs).astype(np.int64) if fskin_f == 1 else None
    faces = np.zeros((nf, 3), np.int64)
    ct, ix = Buf(b, o_ct), Buf(b, o_ix)
    a = bb = c = lst = 0
    for i in range(nf):
        t = ct.u8()
        if t == 1:
            a = ix.smart2() + lst; bb = ix.smart2() + a; c = ix.smart2() + bb; lst = c; faces[i] = (a, bb, c)
        elif t == 2:
            bb = c; c = ix.smart2() + lst; lst = c; faces[i] = (a, bb, c)
        elif t == 3:
            a = c; c = ix.smart2() + lst; lst = c; faces[i] = (a, bb, c)
        elif t == 4:
            t0 = a; a = bb; bb = t0; c = ix.smart2() + lst; lst = c; faces[i] = (a, t0, c)
    return {'colour_offset': o_col, 'verts': verts, 'faces': faces, 'colours': cols, 'vskins': vskins, 'fskins': fskins,
            'alphas': alphas, 'rtypes': rtypes, 'prios': prios, 'priority': prio_f if prio_f != 255 else 0}


def decode_seq(d):
    b = Buf(d); s = {'frames': None, 'lengths': None, 'skeletal': -1}
    while True:
        op = b.u8()
        if op == 0: break
        if op == 1:
            n = b.u16(); s['lengths'] = [b.u16() for _ in range(n)]
            lo = [b.u16() for _ in range(n)]; hi = [b.u16() for _ in range(n)]
            s['frames'] = [(h << 16) | l for l, h in zip(lo, hi)]
        elif op == 2: b.u16()
        elif op == 3: n = b.u8(); [b.u8() for _ in range(n)]
        elif op == 4: pass
        elif op in (5, 9, 10, 11, 8): b.u8()
        elif op in (6, 7): b.u16()
        elif op == 12:
            n = b.u8(); [b.u16() for _ in range(n)]; [b.u16() for _ in range(n)]
        elif op == 13: s['skeletal'] = b.i32()
        elif op == 14:
            for _ in range(b.u16()): b.u16(); b.u16(); b.u8(); b.u8(); b.u8(); b.u8()
        elif op == 15: b.u16(); b.u16()
        elif op == 16: b.u8()
        elif op == 17:
            for _ in range(b.u8()): b.u8()
        elif op == 18: b.string()
        elif op == 19: pass
        else: raise ValueError('seq opcode %d' % op)
    return s


ORIGIN, TRANSLATE, ROTATE, SCALE, ALPHA = 0, 1, 2, 3, 5


def decode_base(d):
    b = Buf(d); n = b.u8()
    types = [b.u8() for _ in range(n)]
    types = [ROTATE if t == 6 else t for t in types]
    counts = [b.u8() for _ in range(n)]
    labels = [[b.u8() for _ in range(k)] for k in counts]
    return {'types': types, 'labels': labels}


def decode_frame(d, bases):
    b = Buf(d); base_id = b.u16(); base = bases(base_id)
    n = b.u8(); data = Buf(d, b.p + n)
    out = []; reset = -1; last_reset = -1
    for i in range(n):
        t = base['types'][i]
        if t == ORIGIN: reset = i
        f = b.u8()
        if f == 0: continue
        if t == ORIGIN: last_reset = i
        dv = 128 if t in (SCALE, 10) else 0
        x = data.smart2() if f & 1 else dv
        y = data.smart2() if f & 2 else dv
        z = data.smart2() if f & 4 else dv
        r = -1
        if t in (TRANSLATE, ROTATE, SCALE) and reset > last_reset:
            r = reset; last_reset = reset
        out.append((i, x, y, z, r))
    return {'base_id': base_id, 'base': base, 'ops': out}


def label_groups(vskins):
    groups = {}
    for v, l in enumerate(vskins.tolist()): groups.setdefault(l, []).append(v)
    return {k: np.array(v, np.int64) for k, v in groups.items()}


def animate(verts, groups, frame):
    """Classic OSRS frame on integer vertices (Model.transform0), returns a new array."""
    V = verts.copy(); org = [0, 0, 0]; base = frame['base']

    def members(labels):
        idx = [groups[l] for l in labels if l in groups]
        return np.concatenate(idx) if idx else np.zeros(0, np.int64)

    def do(t, labels, x, y, z):
        nonlocal org
        m = members(labels)
        if t == ORIGIN:
            if len(m):
                s = V[m].sum(0); c = len(m)
                org = [x + int(s[0] / c), y + int(s[1] / c), z + int(s[2] / c)]  # |0 truncates toward 0
            else:
                org = [x, y, z]
        elif t == TRANSLATE:
            V[m] += [x, y, z]
        elif t == ROTATE:
            if not len(m): return
            p = V[m] - org
            ax, ay, az = (x & 0xff) * 8, (y & 0xff) * 8, (z & 0xff) * 8
            px, py, pz = p[:, 0].copy(), p[:, 1].copy(), p[:, 2].copy()
            if az:
                s, c = SINE[az], COSINE[az]
                t2 = (s * py + c * px) >> 16; py = (c * py - s * px) >> 16; px = t2
            if ax:
                s, c = SINE[ax], COSINE[ax]
                t2 = (c * py - s * pz) >> 16; pz = (s * py + c * pz) >> 16; py = t2
            if ay:
                s, c = SINE[ay], COSINE[ay]
                t2 = (s * pz + c * px) >> 16; pz = (c * pz - s * px) >> 16; px = t2
            V[m] = np.stack([px, py, pz], 1) + org
        elif t == SCALE:
            if not len(m): return
            p = V[m] - org
            p = np.trunc(p * np.array([x, y, z]) / 128).astype(np.int64)
            V[m] = p + org

    for i, x, y, z, r in frame['ops']:
        if r >= 0: do(ORIGIN, base['labels'][r], 0, 0, 0)
        do(base['types'][i], base['labels'][i], x, y, z)
    return V


def _smart2(v):
    v = int(v)
    if -64 <= v < 64: return bytes([v + 64])
    if -16384 <= v < 16384: return struct.pack('>H', v + 49152)
    raise ValueError('delta out of range: %d' % v)


def encode_v3(m):
    """Writes the v3 (0xff 0xfd) format the client's decodeV3 reads: positions, triangles, colours,
    vertex labels, face labels, alphas, one global priority; no textures, render types or maya groups.
    v3 keeps every vertex (usedVertexCount = vertex count), so unused helper vertices survive."""
    V = np.asarray(m['verts'], np.int64); F = np.asarray(m['faces'], np.int64)
    nv, nf = len(V), len(F)
    assert nv <= 65535 and nf <= 65535
    vflags, xs, ys, zs = bytearray(), bytearray(), bytearray(), bytearray()
    last = np.zeros(3, np.int64)
    for v in V:
        d = v - last; f = 0
        if d[0]: f |= 1; xs += _smart2(d[0])
        if d[1]: f |= 2; ys += _smart2(d[1])
        if d[2]: f |= 4; zs += _smart2(d[2])
        vflags.append(f); last = v
    idx = bytearray(); ctypes = bytearray(); lst = 0
    pa = pb = pc = -1
    for f in F.tolist():
        done = False
        for x, y, z in ((f[0], f[1], f[2]), (f[1], f[2], f[0]), (f[2], f[0], f[1])):
            # decodeV3: type 2 -> (a, c, new); type 3 -> (c, b, new); type 4 -> (b, a, new)
            if pa >= 0 and x == pa and y == pc: t = 2
            elif pa >= 0 and x == pc and y == pb: t = 3
            elif pa >= 0 and x == pb and y == pa: t = 4
            else: continue
            ctypes.append(t); idx += _smart2(z - lst); lst = z; pa, pb, pc = x, y, z; done = True; break
        if not done:
            a, b, c = f
            ctypes.append(1); idx += _smart2(a - lst) + _smart2(b - a) + _smart2(c - b); lst = c; pa, pb, pc = a, b, c
    vsk = bytes(int(s) & 0xff for s in m['vskins'])
    fsk = bytes(int(s) & 0xff for s in m['fskins']) if m.get('fskins') is not None else None
    alp = bytes(int(a) & 0xff for a in m['alphas']) if m.get('alphas') is not None else None
    cols = b''.join(struct.pack('>H', int(c) & 0xffff) for c in m['colours'])
    out = bytearray()
    out += vflags                       # (no texture render types)
    out += ctypes                       # face compression types (no render types block)
    if fsk is not None: out += fsk
    out += vsk
    if alp is not None: out += alp
    out += idx
    out += cols
    out += xs + ys + zs
    out += b'\x00'                      # no ModelData0 trailer
    out += struct.pack('>HHB', nv, nf, 0)
    out += bytes([0, m.get('priority', 0) & 0xff, 1 if alp is not None else 0, 1 if fsk is not None else 0, 0, 1, 0])
    out += struct.pack('>HHHHHH', len(xs), len(ys), len(zs), len(idx), 0, len(vsk))
    out += b'\xff\xfd'
    return bytes(out)


def animate_fractional(verts, groups, frame):
    """The client's fractional path (Model.transformFractional), as NPCs are animated in the TSPS
    client: float origins (no truncation), float sin/cos of value * 2pi/256, float scales."""
    V = verts.astype(float).copy(); org = np.zeros(3); base = frame['base']
    rad = math.pi * 2 / 256

    def members(labels):
        idx = [groups[l] for l in labels if l in groups]
        return np.concatenate(idx) if idx else np.zeros(0, np.int64)

    def do(t, labels, x, y, z):
        nonlocal org
        m = members(labels)
        if t == ORIGIN:
            org = np.array([x, y, z], float) + (V[m].mean(0) if len(m) else 0)
            return
        if not len(m): return
        if t == TRANSLATE: V[m] += [x, y, z]; return
        p = V[m] - org
        px, py, pz = p[:, 0].copy(), p[:, 1].copy(), p[:, 2].copy()
        if t == ROTATE:
            sx, cx, sy, cy, sz, cz = math.sin(x * rad), math.cos(x * rad), math.sin(y * rad), math.cos(y * rad), math.sin(z * rad), math.cos(z * rad)
            t2 = sz * py + cz * px; py = cz * py - sz * px; px = t2
            t2 = cx * py - sx * pz; pz = sx * py + cx * pz; py = t2
            t2 = sy * pz + cy * px; pz = cy * pz - sy * px; px = t2
        elif t == SCALE:
            px, py, pz = px * x / 128, py * y / 128, pz * z / 128
        else:
            return
        V[m] = np.stack([px, py, pz], 1) + org

    for i, x, y, z, r in frame['ops']:
        if r >= 0: do(ORIGIN, base['labels'][r], 0, 0, 0)
        do(base['types'][i], base['labels'][i], x, y, z)
    return V

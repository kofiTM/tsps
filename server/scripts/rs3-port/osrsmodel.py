"""Read/write the original (footerless, 18-byte trailer) OSRS model format,
matching ModelData.decodeOld in the TSPS client."""
import struct
import numpy as np


def _smart2(v):
    if -64 <= v < 64:
        return bytes([v + 64])
    if -16384 <= v < 16384:
        return struct.pack('>H', v + 49152)
    raise ValueError('delta out of range: %d' % v)


def encode(verts, faces, colours, alphas=None, vskins=None, priority=0, fskins=None):
    """verts: (N,3) int, faces: (F,3) int, colours: (F,) OSRS HSL16,
    alphas: (F,) 0=opaque..255=invisible or None, vskins: (N,) labels or None."""
    verts = np.asarray(verts, dtype=np.int64)
    faces = np.asarray(faces, dtype=np.int64)
    nv, nf = len(verts), len(faces)
    if nv > 65535 or nf > 65535:
        raise ValueError('too many vertices/faces for OSRS format')
    vflags, xs, ys, zs = bytearray(), bytearray(), bytearray(), bytearray()
    last = np.zeros(3, dtype=np.int64)
    for v in verts:
        d = v - last
        f = 0
        if d[0]: f |= 1; xs += _smart2(int(d[0]))
        if d[1]: f |= 2; ys += _smart2(int(d[1]))
        if d[2]: f |= 4; zs += _smart2(int(d[2]))
        vflags.append(f)
        last = v
    ftypes = bytes([1]) * nf
    idx = bytearray()
    lasti = 0
    for a, b, c in faces:
        idx += _smart2(int(a - lasti)) + _smart2(int(b - a)) + _smart2(int(c - b))
        lasti = c
    cols = b''.join(struct.pack('>H', int(c) & 0xffff) for c in colours)
    has_alpha = alphas is not None and np.any(np.asarray(alphas) != 0)
    has_vskin = vskins is not None
    has_fskin = fskins is not None
    out = bytearray()
    out += vflags                                   # vertex flags
    out += ftypes                                   # face types
    # (no per-face priorities: global priority byte)
    if has_fskin: out += bytes(int(s) & 0xff for s in fskins)
    # (no textures)
    if has_vskin: out += bytes(int(s) & 0xff for s in vskins)
    if has_alpha: out += bytes(int(a) & 0xff for a in alphas)
    out += idx
    out += cols
    # (no texture triangles)
    out += xs + ys + zs
    out += struct.pack('>HHBBBBBBHHHH', nv, nf, 0, 0, priority, 1 if has_alpha else 0,
                       1 if has_fskin else 0, 1 if has_vskin else 0,
                       len(xs), len(ys), len(zs), len(idx))
    return bytes(out)


def _rsmart2(b, p):
    if b[p] < 128:
        return b[p] - 64, p + 1
    return ((b[p] << 8) | b[p + 1]) - 49152, p + 2


def decode(b):
    """Decode positions, faces, colours and vertex skins (old format only)."""
    nv, nf, ntex, usestex, prio, ha, hfs, hvs, lx, ly, lz, lidx = struct.unpack('>HHBBBBBBHHHH', b[-18:])
    o = 0
    o_vflags = o; o += nv
    o_ftype = o; o += nf
    if prio == 255: o += nf
    if hfs == 1: o += nf
    o_rtype = o
    if usestex == 1: o += nf
    o_vskin = o
    if hvs == 1: o += nv
    o_alpha = o
    if ha == 1: o += nf
    o_idx = o; o += lidx
    o_col = o; o += nf * 2
    o += ntex * 6
    o_x = o; o += lx
    o_y = o; o += ly
    o_z = o
    verts = np.zeros((nv, 3), dtype=np.int64)
    px, py, pz = o_x, o_y, o_z
    last = [0, 0, 0]
    for i in range(nv):
        f = b[o_vflags + i]
        d = [0, 0, 0]
        if f & 1: d[0], px = _rsmart2(b, px)
        if f & 2: d[1], py = _rsmart2(b, py)
        if f & 4: d[2], pz = _rsmart2(b, pz)
        last = [last[k] + d[k] for k in range(3)]
        verts[i] = last
    vskins = np.frombuffer(b, 'u1', nv, o_vskin).copy() if hvs == 1 else None
    cols = np.frombuffer(b, '>u2', nf, o_col).copy()
    faces = np.zeros((nf, 3), dtype=np.int64)
    p = o_idx
    i1 = i2 = i3 = last = 0
    for i in range(nf):
        t = b[o_ftype + i]
        if t == 1:
            d, p = _rsmart2(b, p); i1 = d + last
            d, p = _rsmart2(b, p); i2 = d + i1
            d, p = _rsmart2(b, p); i3 = d + i2
            last = i3
        elif t == 2:
            i2 = i3; d, p = _rsmart2(b, p); i3 = d + last; last = i3
        elif t == 3:
            i1 = i3; d, p = _rsmart2(b, p); i3 = d + last; last = i3
        elif t == 4:
            i1, i2 = i2, i1; d, p = _rsmart2(b, p); i3 = d + last; last = i3
        faces[i] = (i1, i2, i3)
    return {'verts': verts, 'faces': faces, 'colours': cols, 'vskins': vskins, 'priority': prio}

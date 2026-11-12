"""Read-only OSRS dat2/idx cache reader (enough to look up item defs and models)."""
import os, struct
import js5


class OsrsCache(js5.Cache):
    def __init__(self, root):
        super().__init__(root)
        self.dat = open(os.path.join(root, 'main_file_cache.dat2'), 'rb')

    def raw(self, index, group):
        path = os.path.join(self.root, 'main_file_cache.idx%d' % index)
        if not os.path.exists(path):
            return None
        with open(path, 'rb') as f:
            f.seek(group * 6)
            e = f.read(6)
        if len(e) < 6:
            return None
        size = int.from_bytes(e[:3], 'big'); sector = int.from_bytes(e[3:], 'big')
        if size == 0 or sector == 0:
            return None
        big = group > 0xffff
        hdr = 10 if big else 8
        out = bytearray(); chunk = 0
        while len(out) < size:
            self.dat.seek(sector * 520)
            blk = self.dat.read(520)
            nxt = int.from_bytes(blk[hdr - 4:hdr - 1], 'big')
            n = min(size - len(out), 520 - hdr)
            out += blk[hdr:hdr + n]
            sector = nxt; chunk += 1
        return bytes(out)


def obj_models(d):
    """Minimal OSRS obj decoder: returns name and worn/ground model ids."""
    b = js5.Buf(d); o = {}
    while b.left():
        op = b.u8()
        if op == 0: break
        if op == 1: o['model'] = b.u16()
        elif op == 2: o['name'] = b.string()
        elif op in (4, 5, 6, 7, 8, 75, 94, 95, 97, 98, 110, 111, 112, 139, 140, 148, 149): b.u16()
        elif op in (3, 9): b.string()
        elif op in (10, 99, 66, 67, 68, 70, 71, 72, 76, 77, 80, 81, 82, 83, 84, 85, 86, 87, 116, 117, 118, 119): b.u16()
        elif op in (11, 15, 16, 65, 160, 251): pass
        elif op in (69, 74, 88): b.u8()
        elif op == 44: o['model'] = b.i32()
        elif op == 45: o['male'] = b.i32(); b.u8()
        elif op == 48: o['female'] = b.i32(); b.u8()
        elif op in (46, 47, 49, 50, 51, 52, 53, 54): b.i32()
        elif op == 161:
            for _ in range(b.u16()): b.u16()
        elif op in (121, 122): b.u16()
        elif op in (125, 126): b.p += 3
        elif op in (127, 128, 129, 130): b.u8(); b.u16()
        elif op == 132:
            for _ in range(b.u8()): b.u16()
        elif op == 12: b.i32()
        elif op in (13, 14, 27, 113, 114, 115, 96, 42): b.u8()
        elif op == 23: o['male'] = b.u16(); b.u8()
        elif op == 24: o['male1'] = b.u16()
        elif op == 25: o['female'] = b.u16(); b.u8()
        elif op == 26: o['female1'] = b.u16()
        elif 30 <= op <= 39: b.string()
        elif op in (40, 41):
            for _ in range(b.u8()): b.u16(); b.u16()
        elif op == 43:
            b.u8()
            while True:
                s = b.u8() - 1
                if s == -1: break
                b.string()
        elif op in (78, 79, 90, 91, 92, 93): b.u16()
        elif 100 <= op <= 109: b.u16(); b.u16()
        elif op == 249:
            for _ in range(b.u8()):
                isstr = b.u8(); b.u24()
                b.string() if isstr else b.i32()
        else:
            o['stopped'] = op; break
    return o


def model_labels(d):
    """Vertex labels (vertexSkins) of an OSRS model in any format, or None."""
    if d[-2] == 0xff and d[-1] == 0xfd:
        t = d[-26:]
        vc, fc = struct.unpack('>HH', t[0:4]); tt = t[4]
        f12, f13, f14, f15, f16, f17 = t[5:11]
        types = d[:tt]
        off = tt + vc + (fc if f12 == 1 else 0) + fc + (fc if f13 == 255 else 0) + (fc if f15 == 1 else 0)
        return list(d[off:off + vc]) if f17 == 1 else None
    if d[-2] == 0xff and d[-1] == 0xfe:
        t = d[-23:]
        vc, fc = struct.unpack('>HH', t[0:4]); f12, f13, f14, f15, hvs = t[5:10]
        off = vc + fc + (fc if f13 == 255 else 0) + (fc if f15 == 1 else 0) + (fc if f12 == 1 else 0)
        return list(d[off:off + vc]) if hvs == 1 else None
    if d[-2] == 0xff and d[-1] == 0xff:
        return 'v1'
    t = d[-18:]
    vc, fc = struct.unpack('>HH', t[0:4]); usestex, prio, ha, hfs, hvs = t[5], t[6], t[7], t[8], t[9]
    off = vc + fc + (fc if prio == 255 else 0) + (fc if hfs == 1 else 0) + (fc if usestex == 1 else 0)
    return list(d[off:off + vc]) if hvs == 1 else None


def _s2(b, p):
    if b[p] < 128:
        return b[p] - 64, p + 1
    return ((b[p] << 8) | b[p + 1]) - 49152, p + 2


def model_vertices(d):
    """Vertex positions of an OSRS model in old/V2/V3 format."""
    import numpy as np
    import osrsmodel
    if d[-2:] == b'\xff\xfd':
        t = d[-26:]
        vc, fc = struct.unpack('>HH', t[0:4]); tt = t[4]
        f12, f13, f14, f15, f16, f17 = t[5:11]
        v19, v20, v21, v22, v23, v24 = struct.unpack('>6H', t[12:24])
        flags = tt
        o = tt + vc + (fc if f12 == 1 else 0) + fc + (fc if f13 == 255 else 0) + (fc if f15 == 1 else 0)
        o += v24 + (fc if f14 == 1 else 0) + v22 + (fc * 2 if f16 == 1 else 0) + v23 + fc * 2
        ox, oy, oz = o, o + v19, o + v19 + v20
    elif d[-2:] == b'\xff\xfe':
        t = d[-23:]
        vc, fc = struct.unpack('>HH', t[0:4]); tt = t[4]
        f12, f13, f14, f15, hvs, hm = t[5:11]
        v18, v19, v20, v21, v22 = struct.unpack('>5H', t[11:21])
        flags = 0
        o = vc + fc + (fc if f13 == 255 else 0) + (fc if f15 == 1 else 0) + (fc if f12 == 1 else 0)
        o += v22 + (fc if f14 == 1 else 0) + v21 + fc * 2 + tt * 6
        ox, oy, oz = o, o + v18, o + v18 + v19
    else:
        return osrsmodel.decode(d)['verts']
    v = np.zeros((vc, 3), dtype=np.int64); last = [0, 0, 0]; p = [ox, oy, oz]
    for i in range(vc):
        f = d[flags + i]
        for k in range(3):
            if f & (1 << k):
                dv, p[k] = _s2(d, p[k]); last[k] += dv
        v[i] = last
    return v


def npc_def(d):
    """Minimal OSRS npc decoder (rev 241): name, size, models, idle/walk."""
    b = js5.Buf(d); o = {}
    while b.left():
        op = b.u8()
        if op == 0: break
        if op == 1: o['models'] = [b.u16() for _ in range(b.u8())]
        elif op == 61: o['models'] = [b.i32() for _ in range(b.u8())]
        elif op == 60: [b.u16() for _ in range(b.u8())]
        elif op == 62: [b.i32() for _ in range(b.u8())]
        elif op in (2, 3): o['name' if op == 2 else 'desc'] = b.string()
        elif op == 12: o['size'] = b.u8()
        elif op == 13: o['idle'] = b.u16()
        elif op == 14: o['walk'] = b.u16()
        elif op in (15, 16, 18, 42, 44, 45, 95, 97, 98, 103, 114, 116, 124, 126) or 74 <= op <= 79: b.u16()
        elif op in (17, 115, 117): o.setdefault('walk', None); [b.u16() for _ in range(4)]
        elif 30 <= op < 35: b.string()
        elif op in (40, 41):
            for _ in range(b.u8()): b.u16(); b.u16()
        elif op in (93, 99, 107, 109, 111, 122, 123): pass
        elif op in (100, 101, 125): b.s8()
        elif op == 102:
            mask = b.u8(); n = bin(mask).count('1')
            for _ in range(n): b.smart32(); b.smart()
        elif op in (106, 118):
            b.u16(); b.u16()
            if op == 118: b.u16()
            for _ in range(b.u8() + 1): b.u16()
        elif op == 249:
            for _ in range(b.u8()):
                s = b.u8(); b.u24(); b.string() if s else b.i32()
        else:
            o['stop'] = op; break
    return o

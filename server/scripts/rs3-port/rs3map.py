"""RS3 (build 950) map reading: index 5 groups are regions (id = regionX + regionY * 128);
file 0 holds the locs, file 3 the terrain."""
from js5 import Buf


def usmart_int(b):
    """'Extended' unsigned smart: chains of 32767 for big values."""
    total = 0
    v = b.smart_u()
    while v == 32767:
        total += 32767
        v = b.smart_u()
    return total + v


def _smart_u(self):
    if self.b[self.p] < 128:
        return self.u8()
    return self.u16() - 32768
Buf.smart_u = _smart_u


def locs(data):
    """Yield (id, localX, localY, plane, type, rotation, extra) for a region's loc file."""
    b = Buf(data)
    lid = -1
    while True:
        d = usmart_int(b)
        if d == 0:
            break
        lid += d
        pos = 0
        while True:
            dp = b.smart_u()
            if dp == 0:
                break
            pos += dp - 1
            attrs = b.u8()
            extra = None
            if attrs & 0x80:          # RS3: per-placement scale/offset/recolour data
                flags = b.u8()
                extra = {'flags': flags}
                if flags & 0x01:       # rotation quaternion
                    b.p += 8
                if flags & 0x02: extra['ox'] = b.s16()
                if flags & 0x04: extra['oy'] = b.s16()
                if flags & 0x08: extra['oz'] = b.s16()
                if flags & 0x10: extra['scale'] = b.u16()
                if flags & 0x20: extra['sx'] = b.u16()
                if flags & 0x40: extra['sy'] = b.u16()
                if flags & 0x80: extra['sz'] = b.u16()
            yield lid, (pos >> 6) & 63, pos & 63, (pos >> 12) & 3, (attrs & 0x7f) >> 2, attrs & 3, extra


def terrain(data):
    """Tiles of a region's terrain file (2016 format, or 950 'jagx' v1 with 16-bit heights).
    Returns {(plane, x, y): {'f', 'shape', 'ov', 'set', 'un', 'h'}}."""
    jagx = data[:4] == b'jagx'
    b = Buf(data, 5 if jagx else 0)
    us = lambda: b.u8() if b.b[b.p] < 128 else b.u16() - 32768
    tiles = {}
    for z in range(4):
        for x in range(64):
            for y in range(64):
                f = b.u8(); t = {'f': f}
                if f & 1: t['shape'] = b.u8(); t['ov'] = us()
                if f & 2: t['set'] = b.u8()
                if f & 4: t['un'] = us()
                if f & 8: t['h'] = b.u16() if jagx else b.u8()
                tiles[(z, x, y)] = t
    return tiles

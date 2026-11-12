"""RS3 classic (frame-based) animations from a 2016-era RS3 dat2/idx cache, converted for the TSPS client.

RS3 kept the 2007 animation system next to NXT skeletal animation: seqs (index 20, group = id >> 7)
list frames (index 0, group << 16 | file) that move vertex-label groups of a frame base (index 1).
The formats are the OSRS ones with small changes, all verified on Vorago (base 3855):

  seq     opcodes until 1, then u16 n, n x u16 length (20 ms cycles), n x u16 file, n x u16 group
  frame   u8 version (2), u16 base, u16 count (OSRS: u8), count x u8 flags, smart2 values
  base    u16 count (OSRS: u8), count x u8 type, count x u8 actor flag, count x u16 mask,
          count x smart label count, then the labels as smarts (OSRS: u8 everywhere)

Units: RS3 rotations are 16384 steps per turn (OSRS 256): they are kept at full precision and the
client divides them (custom base `rotationDivisor` 64, client/custom/seqs). Translations and origin
offsets are in the old model units, the same units convert.py's models end up in: kept as they are. No axis
flips are needed: convert.py's Y flip already puts the model in the frames' frame of reference.
Type 10 (an RS3-only transform) is written as an unused alpha (5) and never set by frames.
"""
import base64, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osrscache import OsrsCache
from js5 import Buf
import osrsanim as A

ROTATION_DIVISOR = 64          # 16384 / 256
UNIT = 1.0                     # frames are in the old (2007-format) model units, which is what
                               # convert.py turns NXT models into (/4): no scaling. 0.25 made his
                               # walk move 85 units on a 1229-tall model (kofi: "barely moving").


class Rs3Anims:
    def __init__(self, cache_dir):
        self.c = OsrsCache(cache_dir)
        self._frames, self._seqs, self._bases = {}, {}, {}

    def seq(self, sid):
        g = sid >> 7
        if g not in self._seqs: self._seqs[g] = self.c.files(20, g)
        d = self._seqs[g].get(sid & 127)
        if d is None: return None
        b = Buf(d)
        while b.u8() != 1: pass          # opcodes before 1 carry no data in these seqs (0x0f)
        n = b.u16()
        lengths = [b.u16() for _ in range(n)]; lo = [b.u16() for _ in range(n)]; hi = [b.u16() for _ in range(n)]
        return {'lengths': lengths, 'frames': [(h << 16) | l for h, l in zip(hi, lo)]}

    def frame(self, fid):
        g = fid >> 16
        if g not in self._frames: self._frames[g] = self.c.files(0, g)
        return self._frames[g][fid & 0xffff]

    def frame_base_id(self, fid):
        d = self.frame(fid); return (d[1] << 8) | d[2]

    def base(self, bid):
        if bid in self._bases: return self._bases[bid]
        d = self.c.group(1, bid); b = Buf(d); n = b.u16()
        types = [b.u8() for _ in range(n)]; [b.u8() for _ in range(n)]; [b.u16() for _ in range(n)]
        counts = [b.smart() for _ in range(n)]
        labels = [[b.smart() for _ in range(k)] for k in counts]
        assert b.p == len(d), 'frame base %d: %d bytes left' % (bid, len(d) - b.p)
        self._bases[bid] = {'types': types, 'labels': labels}
        return self._bases[bid]

    def seqs_on_base(self, bid, groups):
        """Seq ids in seq groups `groups` whose first frame uses frame base `bid`."""
        out = []
        for g in groups:
            for f, d in self.c.files(20, g).items():
                sid = (g << 7) | f
                try: s = self.seq(sid)
                except Exception: continue
                if s and s['frames']:
                    try:
                        if self.frame_base_id(s['frames'][0]) == bid: out.append(sid)
                    except Exception: pass
        return out


def osrs_base(base):
    """An RS3 frame base in the OSRS (Dat2SeqBase) format. Needs <= 255 transforms and labels."""
    n = len(base['types'])
    assert n <= 255 and all(len(l) <= 255 and max(l, default=0) <= 255 for l in base['labels'])
    out = bytearray([n]) + bytes(5 if t == 10 else t for t in base['types'])
    out += bytes(len(l) for l in base['labels'])
    for l in base['labels']: out += bytes(l)
    return bytes(out)


def osrs_frame(d, base, base_id):
    """An RS3 frame in the OSRS frame format on custom base `base_id`: rotations raw (the client
    divides them by ROTATION_DIVISOR), translations and origins x UNIT."""
    b = Buf(d, 1); b.u16(); n = b.u16(); flags = [b.u8() for _ in range(n)]; v = Buf(d, b.p)
    head = bytearray([base_id >> 8, base_id & 0xff, n]); vals = bytearray()
    for i, f in enumerate(flags):
        xyz = [v.usmart_s() if f & bit else None for bit in (1, 2, 4)]
        t = base['types'][i]
        if t == 10: f = 0
        if t in (0, 1): xyz = [None if a is None else int(round(a * UNIT)) for a in xyz]
        head.append(f)
        for bit, a in zip((1, 2, 4), xyz):
            if f & bit: vals += A._smart2(a)
    return bytes(head + vals)


def b64(data): return base64.b64encode(data).decode()

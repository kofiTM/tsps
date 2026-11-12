"""Minimal read-only reader for an OpenRS2 flat-file RS3 cache (cache/<index>/<group>.dat)."""
import bz2, gzip, lzma, os, struct, zlib


def decompress(data):
    ctype = data[0]
    clen = struct.unpack('>I', data[1:5])[0]
    if ctype == 0:
        return data[5:5 + clen]
    ulen = struct.unpack('>I', data[5:9])[0]
    body = data[9:9 + clen]
    if ctype == 1:
        return bz2.decompress(b'BZh1' + body)
    if ctype == 2:
        return gzip.decompress(body)
    if ctype == 3:
        props = body[:5]
        hdr = props + struct.pack('<Q', ulen)
        return lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(hdr + body[5:])
    raise ValueError('unknown compression %d' % ctype)


def raw_decompress(data):
    if data[:3] == b'ZLB':  # RS3 zlib container
        return zlib.decompress(data[8:])
    return decompress(data)


class Buf:
    def __init__(self, b, p=0):
        self.b, self.p = b, p
    def u8(self):
        v = self.b[self.p]; self.p += 1; return v
    def s8(self):
        v = self.u8(); return v - 256 if v > 127 else v
    def u16(self):
        v = (self.b[self.p] << 8) | self.b[self.p + 1]; self.p += 2; return v
    def s16(self):
        v = self.u16(); return v - 65536 if v > 32767 else v
    def u24(self):
        v = int.from_bytes(self.b[self.p:self.p + 3], 'big'); self.p += 3; return v
    def i32(self):
        v = struct.unpack('>i', self.b[self.p:self.p + 4])[0]; self.p += 4; return v
    def u32(self):
        v = struct.unpack('>I', self.b[self.p:self.p + 4])[0]; self.p += 4; return v
    def smart32(self):  # "big smart": u16 if top bit clear, else u31
        if self.b[self.p] & 0x80:
            return self.u32() & 0x7fffffff
        return self.u16()
    def smart(self):
        if self.b[self.p] < 128:
            return self.u8()
        return self.u16() - 32768
    def usmart_s(self):
        if self.b[self.p] < 128:
            return self.u8() - 64
        return self.u16() - 49152
    def bigsmart_null(self):
        if self.b[self.p] & 0x80:
            return self.u32() & 0x7fffffff
        v = self.u16()
        return -1 if v == 32767 else v
    def string(self):
        e = self.b.index(0, self.p); s = self.b[self.p:e].decode('cp1252', 'replace'); self.p = e + 1; return s
    def jstr(self):  # versioned string (leading 0 byte)
        self.u8(); return self.string()
    def left(self):
        return len(self.b) - self.p


class Cache:
    def __init__(self, root):
        self.root = root
        self.tables = {}

    def raw(self, index, group):
        path = os.path.join(self.root, str(index), '%d.dat' % group)
        if not os.path.exists(path):
            return None
        with open(path, 'rb') as f:
            return f.read()

    def group(self, index, group):
        d = self.raw(index, group)
        return None if d is None else raw_decompress(d)

    def table(self, index):
        if index in self.tables:
            return self.tables[index]
        b = Buf(raw_decompress(self.raw(255, index)))
        fmt = b.u8()
        if fmt >= 6:
            b.i32()
        flags = b.u8()
        named, whirl, sizes, hashed = flags & 1, flags & 2, flags & 4, flags & 8
        cnt = (lambda: b.smart32()) if fmt >= 7 else (lambda: b.u16())
        n = cnt()
        ids, last = [], 0
        for _ in range(n):
            last += cnt(); ids.append(last)
        if named:
            for _ in ids: b.i32()
        for _ in ids: b.i32()            # crc
        if hashed:
            for _ in ids: b.i32()
        if whirl:
            b.p += 64 * n
        if sizes:
            b.p += 8 * n
        for _ in ids: b.i32()            # version
        counts = [cnt() for _ in ids]
        files = {}
        for gid, c in zip(ids, counts):
            fl, last = [], 0
            for _ in range(c):
                last += cnt(); fl.append(last)
            files[gid] = fl
        self.tables[index] = files
        return files

    def files(self, index, group):
        """Return {fileId: bytes} for a multi-file group."""
        data = self.group(index, group)
        if data is None:
            return {}
        fids = self.table(index).get(group, [0])
        if len(fids) == 1:
            return {fids[0]: data}
        chunks = data[-1]
        n = len(fids)
        p = len(data) - 1 - chunks * n * 4
        sizes = [[0] * n for _ in range(chunks)]
        tot = [0] * n
        b = Buf(data, p)
        for c in range(chunks):
            s = 0
            for f in range(n):
                s += b.i32(); sizes[c][f] = s; tot[f] += s
        out = [bytearray() for _ in range(n)]
        off = 0
        for c in range(chunks):
            for f in range(n):
                out[f] += data[off:off + sizes[c][f]]; off += sizes[c][f]
        return {fids[i]: bytes(out[i]) for i in range(n)}

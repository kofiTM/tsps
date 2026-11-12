"""Decoder for RS3 (NXT, build ~950) models from index 47.

Layout (format 2; versions 0x0f, 0x11, 0x13, 0x14, 0x17 seen; 0x17 stores pos as 3 x f32be):
  header      u8 format, u8 ?, u8 version, u8 meshCount, 4 x u8 extra-section counts
              (emitters/effectors/billboards...; their data trails the meshes and is skipped)
  vertex blk  u8 ?, u8 flags, 3 x u8 ?, u32le vertexCount
              per vertex, each as one array:
                pos      3 x s16le      (RS3 units: 512 per tile, +Y up)
                normal   3 x s8
                tangent  4 x s8
                uv       2 x f16be
                label    u16le          (flags & 0x04) legacy 2007-style vertex label
                skin     u16le n + n x u16le bone + u16le m + m x u8 weight   (flags & 0x20)
              colour   u16le HSL per vertex
              alpha    u8 per vertex (0xff = opaque)
              bone     u16le per vertex (flags & 0x08) NXT skeleton bone
  per mesh    u8 flags (0x10 = hidden helper), 4 x u8, u16le materialId+1, u8 ?,
              u16le indexCount, indexCount x u16le (triangle list)
"""
import struct
import numpy as np


class RS3Model:
    pass


def decode(data):
    if data[0] != 2:
        raise ValueError('unsupported RS3 model format %d' % data[0])
    m = RS3Model()
    m.version = data[2]
    mesh_count = data[3]
    extra = sum(data[4:8])
    m.vflags = f = data[9]
    vc = struct.unpack_from('<I', data, 13)[0]
    p = 17

    def take(n, dtype, width):
        nonlocal p
        a = np.frombuffer(data, dtype=dtype, count=n * width, offset=p)
        p += a.nbytes
        return a.reshape(n, width) if width > 1 else a

    if m.version >= 0x17:                     # v0x17: positions are 3 x f32be
        m.pos = np.round(take(vc, '>f4', 3)).astype(np.int32)
    else:
        m.pos = take(vc, '<i2', 3).astype(np.int32)
    m.normal = take(vc, 'i1', 3).astype(np.int32)
    m.tangent = take(vc, 'i1', 4)
    m.uv = take(vc, '>f2', 2).astype(np.float32)
    m.label = take(vc, '<u2', 1).astype(np.int32) if f & 0x04 else np.full(vc, 0xffff)
    if f & 0x20:
        for _ in range(vc):                   # skin: u16 n, n x u16 bone, u16 m, m x u8 weight
            n = struct.unpack_from('<H', data, p)[0]
            p += 2 + 2 * n
            n = struct.unpack_from('<H', data, p)[0]
            p += 2 + n
    m.colour = take(vc, '<u2', 1).astype(np.int32)
    m.alpha = take(vc, 'u1', 1).astype(np.int32)
    m.bone = take(vc, '<u2', 1).astype(np.int32) if f & 0x08 else np.full(vc, 0xffff)
    m.meshes = []
    for _ in range(mesh_count):
        flags = data[p]
        material = struct.unpack_from('<H', data, p + 5)[0] - 1   # stored +1, 0 = none
        n = struct.unpack_from('<H', data, p + 8)[0]
        p += 10
        idx = np.frombuffer(data, dtype='<u2', count=n, offset=p).astype(np.int32).reshape(-1, 3)
        p += n * 2
        if idx.size and idx.max() >= vc:
            raise ValueError('index out of range in mesh')
        m.meshes.append({'flags': flags, 'material': material, 'tris': idx,
                         'hidden': bool(flags & 0x10)})
    if p > len(data) or (p != len(data) and extra == 0):
        raise ValueError('layout mismatch (%d bytes left)' % (len(data) - p))
    return m

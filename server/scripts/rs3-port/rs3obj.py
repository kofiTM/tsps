"""Partial RS3 (build 950) item definition decoder: reads opcodes up to and including
the name, which covers the model ids, worn slot and inventory-icon angles."""
from js5 import Buf

NONE = {9, 11, 15, 16, 65, 156, 157, 165, 167, 168, 178}


def decode(d):
    b = Buf(d)
    o = {'model': -1, 'male': -1, 'female': -1, 'male1': -1, 'female1': -1,
         'recolor': [], 'retexture': []}
    while b.left():
        op = b.u8()
        if op == 0:
            break
        if op in NONE: continue
        if op == 1: o['model'] = b.smart32()
        elif op == 2: o['name'] = b.string(); break
        elif op == 4: o['zoom2d'] = b.u16()
        elif op == 5: o['xan2d'] = b.u16()
        elif op == 6: o['yan2d'] = b.u16()
        elif op == 7: o['offsetX2d'] = b.s16()
        elif op == 8: o['offsetY2d'] = b.s16()
        elif op == 12: o['cost'] = b.i32()
        elif op == 13: o['slot'] = b.u8()
        elif op == 14: o['type'] = b.u8()
        elif op in (18, 94, 97, 98, 110, 111, 112, 121, 122, 139, 140, 142, 143, 144, 145, 146,
                    150, 151, 152, 153, 154, 161, 162, 163):
            b.u16()
        elif op == 23: o['male'] = b.smart32()
        elif op == 24: o['male1'] = b.smart32()
        elif op == 25: o['female'] = b.smart32()
        elif op == 26: o['female1'] = b.smart32()
        elif op == 27: b.u8()
        elif 30 <= op <= 39: b.string()
        elif op == 40:
            for _ in range(b.u8()): o['recolor'].append((b.u16(), b.u16()))
        elif op == 41:
            for _ in range(b.u8()): o['retexture'].append((b.u16(), b.u16()))
        elif op == 42:
            b.p += b.u8()
        elif op == 43: b.i32()
        elif op in (44, 45): b.u16()
        elif op == 69: b.i32()
        elif op in (78, 79, 90, 91, 92, 93): b.smart32()
        elif op == 95: o['zan2d'] = b.u16()
        elif op == 96: b.u8()
        elif 100 <= op <= 109: b.u16(); b.u16()
        elif op in (113, 114): b.s8()
        elif op == 115: b.u8()
        elif op in (125, 126, 127, 128): b.p += 3
        elif op == 129 or op == 130: b.p += 2
        elif op == 132:
            b.p += 2 * b.u8()
        elif op == 134: b.u8()
        elif op == 164: b.string()
        elif op == 181: b.p += 8
        else:
            o['stopped_at'] = op
            break
    return o

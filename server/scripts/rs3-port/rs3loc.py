"""RS3 (build ~950) loc definition decode: models per type, size and a few flags."""
from js5 import Buf


def decode(data):
    b = Buf(data); out = {'models': {}, 'sx': 1, 'sy': 1, 'name': None, 'ops': []}
    while b.p < len(data):
        op = b.u8(); out['ops'].append(op)
        if op == 0: return out
        if op == 1:
            for _ in range(b.u8()):
                t = b.s8(); out['models'][t] = [b.smart32() for _ in range(b.u8())]
        elif op == 2 or 30 <= op <= 34 or 150 <= op <= 154: s = b.string(); out['name'] = s if op == 2 else out['name']
        elif op == 14: out['sx'] = b.u8()
        elif op == 15: out['sy'] = b.u8()
        elif op in (17, 18, 21, 22, 23, 27, 62, 64, 73, 74, 82, 88, 89, 91, 97, 98, 103, 105, 168, 169, 177, 188, 189): pass
        elif op in (19, 28, 29, 39, 69, 75, 81, 101, 104, 178, 186): b.u8()
        elif op == 24: b.smart32()
        elif op in (40, 41): b.p += b.u8() * 4
        elif op == 42: b.p += b.u8()
        elif op in (44, 45, 65, 66, 67, 70, 71, 72, 102, 107, 167, 190, 191, 192, 193, 194, 195, 93, 95): b.u16()
        elif op in (77, 92):
            b.u16(); b.u16()
            if op == 92: b.smart32()
            n = b.u8(); [b.smart32() for _ in range(n + 1)]
        elif op == 78: b.u16(); b.u8(); b.u8()
        elif op == 136: pass
        elif op == 80: b.u16()
        elif op == 79: b.u16(); b.u16(); b.u8(); b.p += b.u8() * 2
        elif op in (99, 100): b.u8(); b.u16()
        elif op == 106: [(b.smart32(), b.u8()) for _ in range(b.u8())]
        elif op == 160: b.p += b.u8() * 2
        elif op == 162: b.i32()
        elif op == 163: b.p += 4
        elif op in (164, 165, 166): b.u16()
        elif op in (170, 171): b.smart_u() if hasattr(b, 'smart_u') else b.smart()
        elif op == 173: b.u16(); b.u16()
        elif op == 249:
            for _ in range(b.u8()):
                s = b.u8(); b.u24()
                if s: b.string()
                else: b.i32()
        else:
            out['unknown'] = op; return out
    return out

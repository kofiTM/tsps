"""Nex: Angel of Death's fall from the sky (her spawn, kofi: RS3's "she falls from the sky").

    python3 aod_fall.py   ->  data/definitions/custom-seqs.json (seqs 60100 and 60101, sent by NexAod.plugin.js)

Seq 60100, on Nex's frame base (1980): 12 frames of 9182's mid-air pose (its frame 19) dropping from
FALL_HEIGHT above the ground, faster and faster (her whole body moved by the root translate, group
171: nothing bends), then 9182's own drop and slam (its frames 20-35). Frames are written in the
cache's own frame format, so the client decodes them as cache frames (client/custom/seqs).

Seq 60101, her jump (Elemental Lockdown, kofi: "jump up and land back down in the middle"): 9182's own
crouch and leap (frames 0-19), then that top pose rising FALL_HEIGHT out of sight, faster and faster,
then held up there until the fall (60100) takes over: she is moved while nobody can see her.
"""
import base64, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osrsanim as A
import aod_armour

SEQ_ID = 60100
TEMPLATE = 9182
ROOT_TRANSLATE = 171        # a TRANSLATE group listing every one of her labels
FALL_HEIGHT = -2400         # model units above her landing (y is down-positive): ~19 tiles
FALL_FRAMES = 12
FALL_FRAME_CYCLES = 4       # client cycles (20 ms): the drop takes 48
FROM_FRAME = 19             # 9182: the top of its leap, then its drop and slam
JUMP_ID = 60101
RISE_FRAMES = 10
RISE_FRAME_CYCLES = 3       # the rise takes 30 cycles; with the leap (50) she is gone after 80 (2.7 ticks)
HOLD_CYCLES = 600           # up there until 60100 replaces it (Lockdown plays it 3 ticks in)

def parse_frame(d):
    """A cache frame as [base id, [(flag, [values]) per group]]."""
    b = A.Buf(d); base = b.u16(); n = b.u8()
    flags = [b.u8() for _ in range(n)]
    vals = A.Buf(d, b.p); groups = []
    for f in flags:
        groups.append((f, [vals.smart2() if f & bit else None for bit in (1, 2, 4)]))
    return base, groups

def write_frame(base, groups):
    out = bytearray(); out += bytes([base >> 8, base & 0xff, len(groups)])
    data = bytearray()
    for f, vs in groups:
        out.append(f)
        for bit, v in zip((1, 2, 4), vs):
            if f & bit: data += A._smart2(v)
    return bytes(out + data)

def lifted(base, groups, dy, base_types):
    """The same frame with her whole body `dy` higher (TRANSLATE y += dy on the root group)."""
    g = [list(x) for x in groups]
    assert base_types[ROOT_TRANSLATE] == A.TRANSLATE
    f, vs = g[ROOT_TRANSLATE]; vs = list(vs)
    vs[1] = (vs[1] or 0) + dy
    g[ROOT_TRANSLATE] = (f | 2, vs)
    return write_frame(base, [tuple(x) for x in g])

def build(c):
    anims = aod_armour.Anims(c)
    s = anims.seq(TEMPLATE)
    raw = lambda fid: anims._f.setdefault(fid >> 16, c.files(0, fid >> 16))[fid & 0xffff]
    base_id, top = parse_frame(raw(s['frames'][FROM_FRAME]))
    base_types = anims.base(base_id)['types']
    frames, lengths = [], []
    for k in range(FALL_FRAMES):
        t = (k + 1) / FALL_FRAMES
        frames.append(lifted(base_id, top, int(round(FALL_HEIGHT * (1 - t * t))), base_types))
        lengths.append(FALL_FRAME_CYCLES)
    for i in range(FROM_FRAME + 1, len(s['frames'])):
        frames.append(raw(s['frames'][i])); lengths.append(s['lengths'][i])
    return {"id": SEQ_ID, "template": TEMPLATE, "frameLengths": lengths,
            "frames": [base64.b64encode(f).decode() for f in frames]}, frames, base_id

def build_jump(c):
    anims = aod_armour.Anims(c)
    s = anims.seq(TEMPLATE)
    raw = lambda fid: anims._f.setdefault(fid >> 16, c.files(0, fid >> 16))[fid & 0xffff]
    frames, lengths = [], []
    for i in range(FROM_FRAME + 1):
        frames.append(raw(s['frames'][i])); lengths.append(s['lengths'][i])
    base_id, top = parse_frame(raw(s['frames'][FROM_FRAME]))
    base_types = anims.base(base_id)['types']
    for k in range(RISE_FRAMES):
        t = (k + 1) / RISE_FRAMES
        frames.append(lifted(base_id, top, int(round(FALL_HEIGHT * t * t)), base_types))
        lengths.append(RISE_FRAME_CYCLES)
    frames.append(lifted(base_id, top, FALL_HEIGHT, base_types)); lengths.append(HOLD_CYCLES)
    return {"id": JUMP_ID, "template": TEMPLATE, "frameLengths": lengths,
            "frames": [base64.b64encode(f).decode() for f in frames]}, frames

def main():
    root, c = aod_armour.cache()
    row, frames, base_id = build(c)
    jump, jframes = build_jump(c)
    out = os.path.join(root, 'data', 'definitions', 'custom-seqs.json')
    rows = [r for r in (json.load(open(out)) if os.path.exists(out) else []) if r.get('id') not in (SEQ_ID, JUMP_ID)] + [row, jump]
    json.dump(rows, open(out, 'w'), indent=1)
    for r, f in ((row, frames), (jump, jframes)):
        print('wrote', out, '- seq %d: %d frames, %d client cycles (%.1f ticks)' % (r['id'], len(f), sum(r['frameLengths']), sum(r['frameLengths']) / 30))

if __name__ == '__main__':
    main()

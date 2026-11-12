"""Nex: Angel of Death's Elemental Lockdown channel (kofi, 2026-11-11): after she lands, she faces the
faced quadrant's pillar and plays the first half of her mage attack, then holds it with her arms out,
taking the pillar's power while it throws its spell at the players in that quadrant.

    python3 aod_hold.py   ->  data/definitions/custom-seqs.json (seqs 60102 and 60103, sent by NexAod.plugin.js)

Seq 60102: Nex's 9188 (her blood and ice cast) frames 0-HOLD_9188, the last one held.
Seq 60103: Nex's 9189 (her smoke and shadow cast) frames 0-HOLD_9189, the last one held.
Seq 60104: Nex's siphon (9183) fitted to SIPHON_TICKS: its kneel (frames 0-4) and stand-up (24-28) as
they are, its kneeling frames (5-23) stretched or squeezed to fill the rest (kofi: a longer siphon in
Elemental Lockdown, lockdown.channel.siphonTicks in aod.json).
The hold frames are where her arms reach furthest out (measured on her armoured model: 9188 holds
its arms-out pose over frames 17-22, 9189 peaks at frame 20-21). Each is templated on its own cast,
so the client keeps that seq's priorities. Lockdown releases the hold itself (data/aod.json).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aod_armour

HOLDS = {60102: (9188, 19), 60103: (9189, 20)}   # seq id: (cast seq, frame to hold)
HOLD_CYCLES = 900                                 # 30 ticks: longer than any channel; Lockdown ends it
SIPHON_ID, SIPHON, SIPHON_TICKS = 60104, 9183, 14  # keep SIPHON_TICKS = lockdown.channel.siphonTicks

def build(c, seq_id, template, hold):
    anims = aod_armour.Anims(c)
    s = anims.seq(template)
    raw = lambda fid: anims._f.setdefault(fid >> 16, c.files(0, fid >> 16))[fid & 0xffff]
    frames = [raw(s['frames'][i]) for i in range(hold + 1)]
    lengths = list(s['lengths'][:hold]) + [HOLD_CYCLES]
    import base64
    return {"id": seq_id, "template": template, "frameLengths": lengths,
            "frames": [base64.b64encode(f).decode() for f in frames]}

def build_siphon(c):
    import base64
    anims = aod_armour.Anims(c)
    s = anims.seq(SIPHON)
    raw = lambda fid: anims._f.setdefault(fid >> 16, c.files(0, fid >> 16))[fid & 0xffff]
    lengths = list(s['lengths'])
    kneel, stand = sum(lengths[:5]), sum(lengths[24:])
    hold = SIPHON_TICKS * 30 - kneel - stand - 2              # 2 cycles spare so it ends inside the tick
    n = 19
    for i in range(5, 24): lengths[i] = hold // n + (1 if i - 5 < hold % n else 0)
    return {"id": SIPHON_ID, "template": SIPHON, "frameLengths": lengths,
            "frames": [base64.b64encode(raw(f)).decode() for f in s['frames']]}

def main():
    root, c = aod_armour.cache()
    out = os.path.join(root, 'data', 'definitions', 'custom-seqs.json')
    rows = [r for r in (json.load(open(out)) if os.path.exists(out) else []) if r.get('id') not in HOLDS and r.get('id') != SIPHON_ID]
    for seq_id, (template, hold) in HOLDS.items():
        row = build(c, seq_id, template, hold); rows.append(row)
        print('seq %d: %d frames of %d, frame %d held (%d cycles to the hold)' % (seq_id, len(row['frames']), template, hold, sum(row['frameLengths'][:-1])))
    sip = build_siphon(c); rows.append(sip)
    print('seq %d: %d (siphon) at %d cycles (%.1f ticks)' % (SIPHON_ID, SIPHON, sum(sip['frameLengths']), sum(sip['frameLengths']) / 30))
    json.dump(sorted(rows, key=lambda r: r['id']), open(out, 'w'), indent=1)
    print('wrote', out)

if __name__ == '__main__':
    main()

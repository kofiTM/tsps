"""Plays every Nex animation (the 15 seqs on her frame base) on plain Nex (43209) and on the
Angel of Death's armoured model, frame by frame, the way the TSPS client animates NPCs (fractional:
Model.transformFractional). Her own vertices must land where plain Nex's do; every plate vertex must
keep its distance from the skin vertex under it.    python3 aod_check.py [--integer]"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osrsanim as A
import aod_armour

NEX_SEQS = aod_armour.NEX_SEQS

def main():
    root, c = aod_armour.cache()
    anims = aod_armour.Anims(c)
    plain, arm = aod_armour.armoured(c)
    built = A.decode_v3(open(os.path.join(root, 'data', 'models', 'aod', '%d.dat' % aod_armour.MODEL_ID), 'rb').read())
    assert np.array_equal(built['verts'], arm['verts']), 'data/models/aod/1000449.dat is not the current build (run aod_armour.py)'
    animate = A.animate if '--integer' in sys.argv else A.animate_fractional
    nv0 = len(plain['verts']); src = arm['_sources']; plates = np.arange(nv0, nv0 + len(src))
    G0, G1 = A.label_groups(plain['vskins']), A.label_groups(built['vskins'])
    rest = np.linalg.norm(built['verts'][plates] - built['verts'][src], axis=1)
    # every plate face (all of its vertices are added ones) must keep its edge lengths: no stretching
    nf0 = len(plain['faces'])
    pf = np.array([f for f in built['faces'][nf0:] if min(f) >= nv0 and max(f) < nv0 + len(src)])
    def edges(Vx): return np.stack([np.linalg.norm(Vx[pf[:, a]] - Vx[pf[:, b]], axis=1) for a, b in ((0, 1), (1, 2), (2, 0))], 1)
    rest_e = edges(built['verts'].astype(float))
    worst_body = worst_plate = worst_stretch = 0.0
    for sid in NEX_SEQS:
        s = anims.seq(sid); body = plate = stretch = 0.0
        for fid in s['frames']:
            fr = anims.frame(fid)
            a, b = animate(plain['verts'], G0, fr), animate(built['verts'], G1, fr)
            body = max(body, float(np.abs(a - b[:nv0]).max()))
            plate = max(plate, float(np.abs(np.linalg.norm(b[plates] - b[src], axis=1) - rest).max()))
            stretch = max(stretch, float(np.abs(edges(b) - rest_e).max()))
        print('seq %d  %2d frames  body off plain Nex %.3f  plate drift %.3f  plate stretch %.3f' % (sid, len(s['frames']), body, plate, stretch))
        worst_body, worst_plate, worst_stretch = max(worst_body, body), max(worst_plate, plate), max(worst_stretch, stretch)
    sil = np.array([(int(c) >> 10) == 10 and ((int(c) >> 7) & 7) == 0 for c in built['colours'][:nf0]])
    js = aod_armour.face_stretch(plain, anims)
    painted = float(js[sil].max()) if sil.any() else 0.0
    print('silver painted on her own skin: %d faces, worst stretch %.2f (limit %.1f)' % (int(sil.sum()), painted, aod_armour.PAINT_STRETCH))
    ok = worst_body < 0.01 and worst_plate < 0.01 and worst_stretch < 0.01 and painted <= aod_armour.PAINT_STRETCH + 1e-9
    print('%s: body %.3f, plate drift %.3f, plate stretch %.3f (model units)' % ('PASS' if ok else 'FAIL', worst_body, worst_plate, worst_stretch))
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()

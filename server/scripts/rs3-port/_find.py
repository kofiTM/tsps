import sys, re
from js5 import Cache
import rs3obj
c = Cache(sys.argv[1])
keys = ['virtus wand','virtus book','chaotic staff','second-age staff','second age','inquisitor staff','staff of darkness',
 'cywir elders','obliteration','zuriel','noxious staff','masterwork','eternal magic staff','saturated',
 'noxious scythe','shard of leng','sliver of leng','abyssal scourge','ice sliver','ice shard','spear of annihilation',
 'avaryss','nymora','dragonrider lance','lance']
for g in sorted(c.table(19)):
    for fid, d in c.files(19, g).items():
        try: o = rs3obj.decode(d)
        except Exception: continue
        n = (o.get('name') or '')
        nl = n.lower()
        if any(k in nl for k in keys) and o.get('male', -1) != -1:
            print((g << 8) | fid, n, o['model'], o['male'])

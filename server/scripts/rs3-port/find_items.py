import sys, re
from js5 import Cache
cache = Cache(sys.argv[1])
pats = [p.lower().encode('cp1252') for p in sys.argv[2:]]
tbl = cache.table(19)
for g in sorted(tbl):
    for fid, d in cache.files(19, g).items():
        low = d.lower()
        for p in pats:
            i = low.find(p)
            if i >= 0:
                e = d.index(0, i)
                print(g * 256 + fid, d[max(0, i - 1):e].decode('cp1252', 'replace'), len(d))

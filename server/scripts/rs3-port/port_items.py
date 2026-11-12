"""Batch-port RS3 weapons, their dyed versions and the dyes into custom-items.json.

    python3 port_items.py <rs3 cache dir> [--write]

Without --write it only converts and reports. With --write it writes the model files and
updates custom-items.json (re-runs reuse each item's existing model ids).
"""
import json, os, re, sys, zlib
from js5 import Cache
import convert, icon, osrsmodel, rs3obj

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'data', 'models')
ITEMS = os.path.join(ROOT, 'data', 'definitions', 'custom-items.json')
DYE_DATA = os.path.join(ROOT, 'plugins', 'items', 'data', 'rs3-dyes.json')

STAFF_ANIMS = {'doubleHanded': True, 'blockAnim': 424, 'standAnim': 813, 'walkAnim': 1146,
               'runAnim': 1210, 'standTurnAnim': 823, 'turn180Anim': 820, 'turn90CWAnim': 821,
               'turn90CCWAnim': 821}

# OSRS keeps bows on the right-hand side in the base pose (bow animations carry them to the
# left hand); RS3 bows sit in the left hand, so bows are moved onto their base bow's position.
FAERDHINEN_CENTRE, TBOW_CENTRE = (-30, -111), (-31, -98)

# id: TSPS item id. rs3: plain RS3 item. base: OSRS item it behaves as. keep: entry already
# hand-tuned in custom-items.json (only its dyed versions are generated). tint: colour greyscale
# RS3 detail textures from the vertex colours.
WEAPONS = [
    dict(id=50007, rs3=52511, name='Ek-ZekKil', keep=True),
    dict(id=50005, rs3=51772, name='Fractured staff of Armadyl', keep=True),
    dict(id=50010, rs3=37640, name='Zaros godsword', base=26233,
         examine='A godsword forged in the name of Zaros.'),
    dict(id=50011, rs3=37636, name='Staff of Sliske', base=21006, itemDef=STAFF_ANIMS,
         examine='A staff once wielded by Sliske, the Mahjarrat trickster.'),
    dict(id=50012, rs3=37632, name='Seren godbow', base=25865, label=27, centre=FAERDHINEN_CENTRE,
         examine='A bow blessed by Seren, goddess of the elves.'),
    dict(id=50013, rs3=28617, name='Seismic wand', base=21006, tint=True,
         examine='A wand that shakes with the force of the earth.'),
    dict(id=50014, rs3=28621, name='Seismic singularity', base=12825, tint=True,
         examine='A rumbling off-hand orb.'),
    dict(id=50015, rs3=39574, name='Wand of the praesul', base=21006,
         examine='A wand once wielded by the praesul of Zaros.'),
    dict(id=50016, rs3=39579, name='Imperium core', base=27251,
         examine='An off-hand core that pulses with ancient power.'),
    dict(id=50017, rs3=53338, name='Bow of the Last Guardian', base=20997, label=50, centre=TBOW_CENTRE,
         examine='The bow of the Last Guardian of Seren.'),
    dict(id=50018, rs3=47470, name='Eldritch crossbow', base=26374,
         examine='A crossbow fashioned from eldritch power.'),
    dict(id=50019, rs3=42770, name='Blightbound crossbow', base=11785, tint=True,
         examine='A crossbow steeped in blight.'),
    dict(id=50020, rs3=42774, name='Off-hand Blightbound crossbow', base=21000, tint=True,
         examine='An off-hand crossbow steeped in blight.'),
    # second batch (user list, 10 Nov): new plain ids from 50300; their dyed versions continue after 50118
    dict(id=50300, rs3=25654, name='Virtus wand', base=21006, examine='A wand imbued with the power of Zaros.'),
    dict(id=50301, rs3=25664, name='Virtus book', base=20714, examine='An off-hand book of ancient Zarosian magic.'),
    dict(id=50302, rs3=18355, name='Chaotic staff', base=21006, itemDef=STAFF_ANIMS, examine='A staff forged in the depths of Daemonheim.'),
    dict(id=50303, rs3=41875, name='Second-Age staff', base=21006, itemDef=STAFF_ANIMS, examine='A staff from the Second Age.'),
    dict(id=50304, rs3=49982, name='Inquisitor staff', base=21006, itemDef=STAFF_ANIMS, examine='A staff wielded by the inquisitors of old.'),
    dict(id=50305, rs3=34155, name='Staff of darkness', base=21006, examine='A staff that swallows the light.'),
    dict(id=50306, rs3=37085, name='Wand of the Cywir elders', base=21006, examine='A wand carved for the Cywir elders.'),
    dict(id=50307, rs3=40600, name='Orb of the Cywir elders', base=12825, examine='An orb made for the Cywir elders.'),
    dict(id=50308, rs3=39057, name='Obliteration', base=21006, itemDef=STAFF_ANIMS, examine='A staff of terrible destructive power.'),
    dict(id=50309, rs3=39095, name="Superior Zuriel's staff", base=21006, itemDef=STAFF_ANIMS, examine="Zuriel's staff, restored to its full power."),
    dict(id=50310, rs3=31729, name='Noxious staff', base=21006, itemDef=STAFF_ANIMS, examine='A staff made from the remains of Araxxor.'),
    dict(id=50311, rs3=58486, name='Masterwork staff', base=21006, itemDef=STAFF_ANIMS, examine='A masterfully crafted staff.'),
    dict(id=50312, rs3=58502, name='Eternal magic staff', base=21006, itemDef=STAFF_ANIMS, examine='An eternal magic staff, saturated with power.'),
    dict(id=50313, rs3=31725, name='Noxious scythe', base=22325, examine='A scythe made from the remains of Araxxor.'),
    dict(id=50314, rs3=52053, name='Dark Shard of Leng', base=22324, examine='A blade of dark ice from Leng.'),
    dict(id=50315, rs3=52057, name='Dark Sliver of Leng', base=22322, examine='An off-hand blade of dark ice from Leng.'),
    dict(id=50316, rs3=52931, name='Abyssal scourge', base=12006, examine='A whip of abyssal power, with a sting.'),
    dict(id=50317, rs3=52045, name='Dark ice sliver', base=22322, examine='An off-hand blade of dark ice.'),
    dict(id=50318, rs3=49970, name='Masterwork Spear of Annihilation', base=11824, examine='The Spear of Annihilation, reforged by a master.'),
    dict(id=50319, rs3=37095, name='Blade of Avaryss', base=22324, examine='The blade of Avaryss, one of the Twin Furies.'),
    dict(id=50320, rs3=37090, name='Blade of Nymora', base=22322, label=161, examine='The off-hand blade of Nymora, one of the Twin Furies.'),
    dict(id=50321, rs3=37070, name='Dragon Rider lance', base=22978, examine='A lance wielded by the dragon riders.'),
    dict(id=50323, rs3=55480, name='Omni guard', base=21006, necro=True, examine='A necromantic guard that commands the dead.'),
    dict(id=50324, rs3=55482, name='Soulbound lantern', base=12825, necro=True, examine='An off-hand lantern that holds bound souls.'),
    dict(id=50325, rs3=52504, name='Igneous Kal-Zuk', base=21295, cape=True, degrey=True, actions=['Wear', None, None, None, 'Drop'],
         examine="A cape forged from the obsidian armour of TzKal-Zuk."),
    # RS3 TokHaar and Igneous capes (11 Nov); all play as the Infernal cape. Kal-Ket/Xil/Mej/Mor share one
    # model and differ only by their RS3 recolours/retextures, which are applied.
    dict(id=50326, rs3=23659, name='TokHaar-Kal-Ket', base=21295, cape=True, tint=True, actions=['Wear', None, None, None, 'Drop'],
         examine='A cape made from the obsidian of the Fight Kiln.'),
    dict(id=50327, rs3=52501, name='Igneous Kal-Ket', base=21295, cape=True, actions=['Wear', None, None, None, 'Drop'],
         examine='An igneous cape attuned to melee.'),
    dict(id=50328, rs3=52502, name='Igneous Kal-Xil', base=21295, cape=True, actions=['Wear', None, None, None, 'Drop'],
         examine='An igneous cape attuned to ranged.'),
    dict(id=50329, rs3=52503, name='Igneous Kal-Mej', base=21295, cape=True, actions=['Wear', None, None, None, 'Drop'],
         examine='An igneous cape attuned to magic.'),
    dict(id=50330, rs3=55189, name='Igneous Kal-Mor', base=21295, cape=True, actions=['Wear', None, None, None, 'Drop'],
         examine='An igneous cape attuned to necromancy.'),
    dict(id=50322, rs3=58113, name='Masterwork bow', base=20997, label=50, centre=TBOW_CENTRE, examine='A masterfully crafted bow.'),
]

# RS3 weapon dyes: (display suffix, name of the dye item, RS3 dye item)
DYES = [('Barrows', 'Barrows dye', 33294), ('shadow', 'Shadow dye', 33296), ('blood', 'Blood dye', 36274),
        ('ice', 'Ice dye', 41887), ('Third Age', 'Third Age dye', 33298), ('Aurora', 'Aurora dye', 54138),
        ('Soul', 'Soul dye', 54939)]
FIRST_DYE_ID, FIRST_DYED_ID = 50021, 50028
DYE_BASE = 1763   # OSRS Red dye


def slug(name):
    return re.sub('-+', '-', ''.join(ch if ch.isalnum() else '-' for ch in name.lower())).strip('-')


def rs3_def(cache, iid):
    return rs3obj.decode(cache.files(19, iid >> 8)[iid & 255])


def find_dyed(cache):
    """{(plain RS3 item name lower, dye suffix lower): first matching RS3 item def}"""
    names = {rs3_def(cache, w['rs3'])['name'].lower() for w in WEAPONS}
    out = {}
    for g in sorted(cache.table(19)):
        for fid, d in cache.files(19, g).items():
            try:
                o = rs3obj.decode(d)
            except Exception:
                continue
            m = re.match(r'^(.*) \(([^()]+)\)$', o.get('name') or '')
            if m and m.group(1).lower() in names and o['male'] != -1:
                out.setdefault((m.group(1).lower(), m.group(2).lower()), o)
    return out


def cape_labels(data, osrs_item):
    """A worn cape bends with the body: every vertex takes the label (bone) of the nearest vertex of
    the OSRS cape it plays as (its male worn model)."""
    import numpy as np
    from osrscache import OsrsCache, obj_models, model_vertices, model_labels
    osrs = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    ref = osrs.group(7, obj_models(osrs.files(2, 10)[osrs_item])['male'])
    rv = np.asarray(model_vertices(ref), float); rl = np.asarray(model_labels(ref))
    m = osrsmodel.decode(data)
    v = np.asarray(m['verts'], float)
    near = np.array([int(((rv - p) ** 2).sum(1).argmin()) for p in v])
    return osrsmodel.encode(m['verts'], m['faces'], m['colours'], vskins=rl[near])


def degrey(data, min_light=48):
    """Light grey faces (an RS3 greyscale detail texture with no tint) take the average colour of the
    coloured faces they touch, spreading inward until none are left. Dark low-saturation faces stay."""
    import numpy as np
    m = osrsmodel.decode(data)
    v = np.asarray(m['verts']); f = np.asarray(m['faces']); c = np.asarray(m['colours']).astype(int)
    grey = (((c >> 7) & 7) <= 1) & ((c & 127) >= min_light)
    _, pos = np.unique(v, axis=0, return_inverse=True)        # touching = sharing a vertex position
    pf = pos.reshape(-1)[f]
    by_vert = {}
    for i, tri in enumerate(pf):
        for p in tri: by_vert.setdefault(int(p), []).append(i)
    rgb = np.array([convert.hsl16_to_rgb(int(x)) for x in c])
    while grey.any():
        done = []
        for i in np.where(grey)[0]:
            near = {j for p in pf[i] for j in by_vert[int(p)]} - {i}
            near = [j for j in near if not grey[j]]
            if near:
                done.append((i, rgb[near].mean(0)))
        if not done:   # pieces that touch no coloured face: take the nearest coloured face's colour
            cen = v[f].mean(1); ok = np.where(~grey)[0]
            for i in np.where(grey)[0]:
                j = ok[((cen[ok] - cen[i]) ** 2).sum(1).argmin()]
                done.append((i, rgb[j]))
        for i, col in done:
            rgb[i] = col; c[i] = convert.rgb_to_hsl16(col); grey[i] = False
    return osrsmodel.encode(m['verts'], m['faces'], c, vskins=m['vskins'], priority=m['priority'])


def transport_size(rows):
    js = json.dumps({'gamemodeId': 'server', 'datasets': [{'key': 'customItems', 'rows': rows}]},
                    separators=(',', ':'), ensure_ascii=False).encode()
    return 5 + len(zlib.compress(js))


def main():
    cache = Cache(sys.argv[1])
    write = '--write' in sys.argv
    src = open(ITEMS, encoding='utf-8').read()
    items = json.loads(src)
    by_id = {i['id']: i for i in items}
    used = {int(k) for i in items for k in (i.get('models') or {})}
    # model ids in data/definitions/custom-models.json (Vorago, the AoD arena) are not item models:
    # never reuse or allocate them. New item models come from 1100000 up.
    reserved = {int(k) for k in json.load(open(os.path.join(ROOT, 'data', 'definitions', 'custom-models.json')))}
    state = {'next': max([1100000] + [u for u in used if u >= 1100000]) + 1}
    files = {}

    def model_ids(iid, n):
        ex = by_id.get(iid)
        if ex and ex.get('models') and len(ex['models']) == n and not reserved & {int(k) for k in ex['models']}:
            return sorted(int(k) for k in ex['models'])
        ids = []
        while len(ids) < n:
            if state['next'] not in reserved: ids.append(state['next'])
            state['next'] += 1
        return ids

    def put(iid, row):
        if iid in by_id:
            by_id[iid].clear(); by_id[iid].update(row)
        else:
            items.append(row); by_id[iid] = row

    def weapon_row(w, name, rs3, ground, worn, recolor=(), retexture=(), tint=False):
        folder = slug(name)
        gdata, ginfo = convert.convert(cache, ground, False, 1000, recolor=recolor, retexture=retexture, tint=tint)
        wdata, winfo = convert.convert(cache, worn, True, 1000, w.get('label'), w.get('centre'),
                                       recolor=recolor, retexture=retexture, tint=tint)
        if w.get('cape'):
            wdata = cape_labels(wdata, w['base']); winfo['labels'] = 'from OSRS item %d' % w['base']
        if w.get('degrey'):
            gdata, wdata = degrey(gdata), degrey(wdata)
        xan, yan, zan = rs3.get('xan2d', 0), rs3.get('yan2d', 0), rs3.get('zan2d', 0)
        zoom, ox, oy = icon.fit(osrsmodel.decode(gdata), xan, yan, zan)
        gid, wid = model_ids(w['row_id'], 2)
        files[os.path.join(folder, 'drop.dat')] = gdata
        files[os.path.join(folder, 'equip.dat')] = wdata
        print(w['row_id'], name.ljust(40), 'tris', ginfo['tris'], winfo['tris'], 'labels', winfo['labels'])
        return {
            'id': w['row_id'], 'baseItemId': w['base'], 'aliasBase': True,
            'objType': {
                'name': name, 'examine': w['examine'],
                'inventoryActions': w.get('actions', ['Wield', None, None, None, 'Drop']), 'isTradable': True,
                'model': gid, 'maleModel': wid, 'femaleModel': wid,
                'maleModel1': -1, 'femaleModel1': -1, 'maleModel2': -1, 'femaleModel2': -1,
                'recolorFrom': [], 'recolorTo': [], 'retextureFrom': [], 'retextureTo': [],
                'zoom2d': zoom, 'xan2d': xan, 'yan2d': yan, 'zan2d': zan, 'offsetX2d': ox, 'offsetY2d': oy,
            },
            'itemDef': {'tradeable': True, 'dropable': True, **w.get('itemDef', {})},
            'models': {str(gid): folder + '/drop.dat', str(wid): folder + '/equip.dat'},
        }

    # 1. plain weapons (hand-tuned entries are left alone)
    for w in WEAPONS:
        if w.get('keep'):
            ex = by_id[w['id']]
            w['base'] = ex['baseItemId']; w['examine'] = ex['objType'].get('examine', '')
            w['itemDef'] = {k: v for k, v in (ex.get('itemDef') or {}).items() if k not in ('tradeable', 'dropable')}
            continue
        rs3 = rs3_def(cache, w['rs3'])
        w['row_id'] = w['id']
        cols = (rs3['recolor'], rs3['retexture']) if w.get('cape') else ((), ())
        put(w['id'], weapon_row(w, w['name'], rs3, rs3['model'], rs3['male'], *cols, tint=w.get('tint', False)))

    # 2. dye items
    dye_rows = []
    for n, (suffix, dname, rs3id) in enumerate(DYES):
        iid = FIRST_DYE_ID + n
        o = rs3_def(cache, rs3id)
        data, info = convert.convert(cache, o['model'], False, 1000, recolor=o['recolor'], retexture=o['retexture'], tint=True)
        xan, yan, zan = o.get('xan2d', 0), o.get('yan2d', 0), o.get('zan2d', 0)
        zoom, ox, oy = icon.fit(osrsmodel.decode(data), xan, yan, zan, target=24)
        (gid,) = model_ids(iid, 1)
        folder = slug(dname)
        files[os.path.join(folder, 'drop.dat')] = data
        print(iid, dname.ljust(40), 'tris', info['tris'])
        put(iid, {'id': iid, 'baseItemId': DYE_BASE,
                  'objType': {'name': dname, 'examine': 'Use it on an RS3 weapon to dye it.',
                              'inventoryActions': [None, None, None, None, 'Drop'], 'isTradable': True,
                              'model': gid, 'recolorFrom': [], 'recolorTo': [], 'retextureFrom': [], 'retextureTo': [],
                              'zoom2d': zoom, 'xan2d': xan, 'yan2d': yan, 'zan2d': zan, 'offsetX2d': ox, 'offsetY2d': oy},
                  'itemDef': {'tradeable': True, 'dropable': True},
                  'models': {str(gid): folder + '/drop.dat'}})
        dye_rows.append({'dye': iid, 'name': dname})

    # 3. dyed weapons
    dyed = find_dyed(cache)
    necro = [w['id'] for w in WEAPONS if w.get('necro')]
    pairs = []
    next_id = FIRST_DYED_ID
    for w in WEAPONS:
        if w.get('cape'):   # capes have no dyed versions and take no dyed ids
            continue
        plain = rs3_def(cache, w['rs3'])
        for n, (suffix, dname, _) in enumerate(DYES):
            o = dyed.get((plain['name'].lower(), suffix.lower()))
            iid = next_id; next_id += 1
            if o is None:
                print('missing', plain['name'], suffix); continue
            dw = dict(w, row_id=iid)
            name = '%s (%s)' % (w['name'], suffix)
            ground = o['model'] if o['model'] != -1 else plain['model']
            put(iid, weapon_row(dw, name, plain, ground, o['male'], o['recolor'], o['retexture'], tint=True))
            pairs.append({'dye': FIRST_DYE_ID + n, 'base': w['id'], 'result': iid})
            if w.get('necro'): necro.append(iid)

    items.sort(key=lambda r: r['id'])
    size = transport_size(items)
    print('rows', len(items), 'definition packet', size, 'bytes (limit 65535)')
    if size > 0xffff:
        sys.exit('definition packet too large - not writing')
    if not write:
        return
    for rel, data in files.items():
        os.makedirs(os.path.dirname(os.path.join(MODELS, rel)), exist_ok=True)
        open(os.path.join(MODELS, rel), 'wb').write(data)
    os.makedirs(os.path.dirname(DYE_DATA), exist_ok=True)
    json.dump({'dyes': dye_rows, 'pairs': pairs,
               'spawn': [w['id'] for w in WEAPONS] + [d['dye'] for d in dye_rows], 'necro': necro},
              open(DYE_DATA, 'w'), indent=2)
    open(ITEMS, 'w', encoding='utf-8').write(
        json.dumps(items, indent=2, ensure_ascii=False) + ('\n' if src.endswith('\n') else ''))
    print('wrote', ITEMS, 'and', DYE_DATA)


if __name__ == '__main__':
    main()

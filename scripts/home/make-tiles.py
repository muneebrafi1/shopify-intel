#!/usr/bin/env python3
"""Small gallery tiles for the home page: the top of each chosen store's home capture, cut from
the local capture objects (.data/captures/objects) as <key>.tile.webp (desktop 480x300, phone
280x448), plus data/curation/home-gallery.json listing them. Upload with the r2 put lines it prints.
Usage: make-tiles.py domain [domain ...]   (domains in display order)"""
import json, os, sys, sqlite3, glob
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OBJ = f'{ROOT}/.data/captures/objects'
db = glob.glob(f'{ROOT}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2*.sqlite')[0]
c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
out = {'tiles': []}
for dom in sys.argv[1:]:
    entry = {'domain': dom}
    for dev, (w, h) in {'desktop': (480, 300), 'mobile': (280, 448)}.items():
        r = c.execute("""select sh.r2_key,sh.width from screenshots sh join stores s on s.id=sh.store_id
          where s.domain=? and sh.page_type='home' and sh.device=? and sh.is_current=1 and sh.is_placeholder=0""", (dom, dev)).fetchone()
        if not r or not os.path.exists(f'{OBJ}/{r[0]}'):
            entry = None; break
        im = Image.open(f'{OBJ}/{r[0]}').convert('RGB')
        src_w = im.width
        crop_h = round(src_w * h / w)
        im = im.crop((0, 0, src_w, min(crop_h, im.height)))
        im = im.resize((w, round(w * im.height / src_w)), Image.LANCZOS)
        key = r[0].replace('.webp', '.tile.webp')
        im.save(f'{OBJ}/{key}', 'WEBP', quality=72, method=6)
        entry[dev] = {'key': key, 'src': r[0], 'w': w, 'h': im.height, 'kb': round(os.path.getsize(f'{OBJ}/{key}') / 1024, 1)}
    if entry: out['tiles'].append(entry)
    else: print('skip', dom, file=sys.stderr)
json.dump(out, open(f'{ROOT}/data/curation/home-gallery.json', 'w'), indent=1)
print(len(out['tiles']), 'stores;', 'avg KB', round(sum(t[d]['kb'] for t in out['tiles'] for d in ('desktop', 'mobile')) / max(1, 2 * len(out['tiles'])), 1))

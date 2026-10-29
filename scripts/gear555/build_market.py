"""Pack Gali Gear 555 for the game's Market.

Writes to OUT (default gear/market/):
  gear-thumbs.png  every item on a silhouette miner (pets alone), 40x56 cells, 24 per row
  gear-anim.png    Legendary items, 8 frames each (40x56 cells), one item per row
  gear555.json     catalogue for the app: id, name, cat, sub, rarity, set, flavor, supply, thumb, anim
"""
import importlib
import json
import math
import os
import sys

from PIL import Image

HERE = __import__('os').path.dirname(__import__('os').path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, HERE)
import kit  # noqa: E402

kit.OY = 26
kit.CH = kit.AM.H + kit.OY + 4
CELL = 40
CW, CHH = CELL, CELL
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'app', 'assets', 'market')
os.makedirs(OUT, exist_ok=True)
COLS = 24

cat = json.load(open(f'{HERE}/catalogue.json'))
MODS = {'Head': ('heads_all', 'head'), 'Top': ('tops', 'top'), 'Bottom': ('bottoms', 'bottom'),
        'Shoes': ('shoes', 'shoe'), 'Axes & Weapons': ('weapons', 'weapon'), 'Pet': ('pets', 'pet')}
fns = {}
for slot, (m, key) in MODS.items():
    mod = importlib.import_module(m)
    for (gid, name, rar, fn) in mod.ITEMS:
        fns[gid] = (key, fn)


def piece(key, fn):
    v = fn()
    if key == 'head' and hasattr(v, 'finish'):
        img, ax, ay = v.finish()
        return (img, ax, ay)
    return v


CROP = {  # (x0, y0, size) in the 40x56 render, scaled to a 40x40 cell
    'head': (0, 4, 40), 'top': (10, 30, 20), 'bottom': (10, 32, 20), 'shoe': (10, 38, 20), 'weapon': (-1, 25, 22)}


def wear(key, fn, pose, t):
    gear = {'head': 'none'}
    gear[key] = piece(key, fn)
    img, _ = kit.render(gear, pose, t, sil=True)
    x0, y0, n = CROP[key]
    if key == 'head':
        hat = gear['head'][0]
        if hat.width <= 20 and hat.height <= 16:
            x0, y0, n = 10, 18, 20
    if n == 22:  # weapons: 22px window shown at 2x, centred in the cell (a 4px margin hides at the edges)
        out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        pad = Image.new('RGBA', (img.width + 4, img.height), (0, 0, 0, 0))
        pad.alpha_composite(img, (2, 0))
        out.alpha_composite(pad.crop((x0 + 2, y0, x0 + 22, y0 + 20)).resize((CELL, CELL), Image.NEAREST))
        return out
    return img.crop((x0, y0, x0 + n, y0 + n)).resize((CELL, CELL), Image.NEAREST)


def pet_cell(img):
    """Pet centred on the floor line of a cell, scaled up 2x when it's small."""
    cell = Image.new('RGBA', (CW, CHH), (0, 0, 0, 0))
    if img.width <= 20 and img.height <= 20:
        img = img.resize((img.width * 2, img.height * 2), Image.NEAREST)
    x = (CW - img.width) // 2
    y = (CHH - img.height) // 2
    cell.alpha_composite(img, (max(0, x), max(0, y)))
    return cell


def sparkle(img, k, seed):
    """Two twinkles that walk round the item, for animated Legendaries."""
    px = img.load()
    pts = []
    for i in range(2):
        a = (k / 8 + i / 2 + seed * 0.13) * 2 * math.pi
        x = int(CW / 2 + math.cos(a) * 15)
        y = int(CHH / 2 + math.sin(a) * 15)
        s = (1, 2, 1, 0)[(k + i * 2) % 4]
        for d in range(-s, s + 1):
            for (xx, yy) in ((x + d, y), (x, y + d)):
                if 0 <= xx < CW and 0 <= yy < CHH and px[xx, yy][3] == 0:
                    px[xx, yy] = (255, 236, 160, 255) if d else (255, 255, 255, 255)
    return img


items = []
thumbs = Image.new('RGBA', (CW * COLS, CHH * math.ceil(len(cat) / COLS)), (0, 0, 0, 0))
legends = [x for x in cat if x['rarity'] == 'Legendary']
anim = Image.new('RGBA', (CW * 8, CHH * len(legends)), (0, 0, 0, 0))
ai = 0
CAT = {'Head': ('head', 'Head'), 'Top': ('clothes', 'Top'), 'Bottom': ('clothes', 'Bottom'),
       'Shoes': ('shoes', 'Shoes'), 'Axes & Weapons': ('weapons', 'Weapon'), 'Pet': ('pets', 'Pet')}
for i, x in enumerate(cat):
    key, fn = fns[x['id']]
    if key == 'pet':
        cell = pet_cell(fn(0))
    else:
        cell = wear(key, fn, 'idle', 0)
    thumbs.alpha_composite(cell, ((i % COLS) * CW, (i // COLS) * CHH))
    a = None
    if x['rarity'] == 'Legendary':
        for k in range(8):
            if key == 'pet':
                fr = pet_cell(fn(k % 4))
            else:
                pose, t = [('idle', 0), ('idle', 1), ('idle', 2), ('idle', 3), ('cheer', 0), ('cheer', 1), ('cheer', 2), ('cheer', 3)][k]
                fr = wear(key, fn, pose, t)
            anim.alpha_composite(sparkle(fr, k, ai), (k * CW, ai * CHH))
        a = ai
        ai += 1
    c, sub = CAT[x['slot']]
    items.append(dict(id=x['id'], name=x['name'], cat=c, sub=sub, rarity=x['rarity'], set=x['set'],
                      flavor=x['flavor'], supply=x['supply'], thumb=i, anim=a, status=x['status']))
    if i % 50 == 0:
        print(i, x['id'], flush=True)

thumbs.save(f'{OUT}/gear-thumbs.png', optimize=True)
anim.save(f'{OUT}/gear-anim.png', optimize=True)
json.dump(dict(cell=[CW, CHH], cols=COLS, animFrames=8, items=items), open(f'{OUT}/gear555.json', 'w'), separators=(',', ':'))
print('done', len(items), 'legend rows', ai, thumbs.size, anim.size)

"""Miner parts for the BAG preview: the idle miner cut into layers, one 40x40 cell each, so the app can stack
them (base, outfit, helmet, pick) without a canvas. Every gear colour the game has today is baked in.

Writes app/assets/market/miner-parts.png and prints the cell order (keep it in step with game/minerParts.ts).
"""
import json
import os

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
art = json.load(open(os.path.join(REPO, 'app/src/engine/art.json')))
atlas = Image.open(os.path.join(REPO, 'app/public/pixel/atlas.png')).convert('RGBA')
R = art['atlas']['rects']
M = art['actors']['miner']
H = art['actors']['hats']
PX, PT, C = 10, 12, 40
HEAD = M['head']['idle'][0]

OUTFITS = ['#2f5fd0', '#8a7a4a', '#7a2f5c', '#ff7a00', '#e0a92a']  # fit-blue khaki batik hazard gold
PICKS = ['#c9c9c9', '#b8c4d6', '#ffc83d', '#3de0c8', '#ff4fd8', '#c7f284']  # GEAR pickaxe accents 0-5
HATS = ['hat-yellow', 'hat-red', 'hat-teal', 'hat-songkok', 'hat-crown', 'hat-astro']
PETS = ['pet-mole', 'pet-bat', 'pet-sprite', 'pet-firefly']


def crop(name):
    r = R[name]
    return atlas.crop((r[0], r[1], r[0] + r[2], r[1] + r[3]))


def tint(img, hexcol):
    c = tuple(int(hexcol[i:i + 2], 16) for i in (1, 3, 5))
    flat = Image.new('RGBA', img.size, (*c, 255))
    flat.putalpha(img.getchannel('A'))
    return flat


def cell():
    return Image.new('RGBA', (C, C), (0, 0, 0, 0))


cells = []
for nm in ('miner-idle-0-base', 'minerf-idle-0-base'):
    c = cell()
    c.alpha_composite(crop(nm), (PX, PT - 8))
    cells.append(c)
for col in OUTFITS:
    c = cell()
    c.alpha_composite(tint(crop('miner-idle-0-fit'), col), (PX, PT - 8))
    c.alpha_composite(crop('miner-idle-0-fit-shade'), (PX, PT - 8))
    cells.append(c)
for h in HATS:
    c = cell()
    c.alpha_composite(crop(h), (PX + HEAD[0] - H[h]['ax'], PT - 8 + HEAD[1] - H[h]['ay']))
    cells.append(c)
for col in PICKS:
    c = cell()
    c.alpha_composite(tint(crop('miner-idle-0-pick'), col), (PX, PT - 8))
    c.alpha_composite(crop('miner-idle-0-pick-shade'), (PX, PT - 8))
    cells.append(c)
for p in PETS:
    c = cell()
    im = crop(f'{p}-0')
    c.alpha_composite(im, ((C - im.width) // 2, C - 2 - im.height if p == 'pet-mole' else (C - im.height) // 2))
    cells.append(c)

# row 2: the same items as icons, cropped and scaled up to fill the cell, for slots and item cards
out = Image.new('RGBA', (C * len(cells), C * 2), (0, 0, 0, 0))
for i, c in enumerate(cells):
    out.alpha_composite(c, (i * C, 0))
    bb = c.getbbox()
    if not bb:
        continue
    it = c.crop(bb)
    k = max(1, min(34 // it.width, 34 // it.height))
    it = it.resize((it.width * k, it.height * k), Image.NEAREST)
    out.alpha_composite(it, (i * C + (C - it.width) // 2, C + (C - it.height) // 2))
path = os.path.join(REPO, 'app/assets/market/miner-parts.png')
out.save(path, optimize=True)
print(path, out.size, 'cells:', len(cells))

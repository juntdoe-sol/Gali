#!/usr/bin/env python3
"""Cuts the TV's sprites out of app/public/pixel/atlas.png, nearest-neighbour scaled to whole pixels.

React Native's Image smooths when it scales, which ruins pixel art, so every sprite the TV shows is
scaled here once and shipped at its final size. Miners are composed the way src/engine/actors.ts
does it (base, tinted overalls, shade, helmet, tinted pick head, pick shade).

Run from the repo root:  python3 tv/scripts/make-sprites.py
"""
import json
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
ART = json.load(open(os.path.join(ROOT, 'app/src/engine/art.json')))
SHEET = Image.open(os.path.join(ROOT, 'app/public/pixel/atlas.png')).convert('RGBA')
RECTS = ART['atlas']['rects']
MINER = ART['actors']['miner']
HATS = ART['actors']['hats']
OUT = os.path.join(ROOT, 'tv/assets/sprites')
os.makedirs(OUT, exist_ok=True)

MINER_SCALE = 6
PROP_SCALE = 5
FX_SCALE = 4


def cut(name):
    x, y, w, h = RECTS[name][:4]
    return SHEET.crop((x, y, x + w, y + h))


def tint(img, colour):
    """source-in: keep the alpha, replace the colour."""
    r, g, b = int(colour[1:3], 16), int(colour[3:5], 16), int(colour[5:7], 16)
    out = Image.new('RGBA', img.size, (r, g, b, 0))
    out.putalpha(img.getchannel('A'))
    return out


def save(img, name, scale):
    img.resize((img.width * scale, img.height * scale), Image.NEAREST).save(os.path.join(OUT, name + '.png'))


# Three miners: same boy, different helmets and overalls, like the reference.
LOOKS = [
    ('a', 'hat-yellow', '#2f5fd0', '#9aa6b8'),
    ('b', 'hat-yellow', '#2f5fd0', '#9aa6b8'),
    ('c', 'hat-teal', '#2f5fd0', '#9aa6b8'),
]
POSES = {'swing': 6, 'cheer': 4, 'idle': 4}
PAD_X, PAD_T = 10, 12


def miner_frame(hat, fit, pick, pose, f):
    img = Image.new('RGBA', (MINER['w'] + PAD_X * 2, MINER['h'] + PAD_T + 2), (0, 0, 0, 0))
    base = f'miner-{pose}-{f}'
    for layer in MINER['order']:
        if layer == 'hat':
            h = HATS[hat]
            hx, hy = MINER['head'][pose][f]
            img.alpha_composite(cut(hat), (PAD_X + hx - h['ax'], PAD_T + hy - h['ay']))
        elif layer == 'fit':
            img.alpha_composite(tint(cut(f'{base}-fit'), fit), (PAD_X, PAD_T))
        elif layer == 'pick':
            img.alpha_composite(tint(cut(f'{base}-pick'), pick), (PAD_X, PAD_T))
        else:
            img.alpha_composite(cut(f'{base}-{layer}'), (PAD_X, PAD_T))
    return img


for key, hat, fit, pick in LOOKS:
    for pose, n in POSES.items():
        for f in range(n):
            save(miner_frame(hat, fit, pick, pose, f), f'miner-{key}-{pose}-{f}', MINER_SCALE)

for name in ['prop-rock-a-0', 'prop-rock-b-0', 'prop-stone-a-0', 'prop-stone-b-0', 'ui-cart', 'ui-gem']:
    save(cut(name), name, PROP_SCALE)
for name in ['fx-sparkle-0', 'fx-sparkle-1', 'fx-sparkle-2', 'fx-dust-0', 'fx-dust-1', 'fx-dust-2', 'fx-rock-0']:
    save(cut(name), name, FX_SCALE)

# The island: the atlas's 720x420 ground, 2x (1440x840).
save(cut('ground'), 'island', 2)

# Launcher banner, 320x180: the wordmark on the dark ocean.
wm = Image.open(os.path.join(ROOT, 'app/assets/brand/wordmark.png')).convert('RGBA')
banner = Image.new('RGBA', (320, 180), (9, 19, 48, 255))
scale = min(280 / wm.width, 150 / wm.height)
wm = wm.resize((max(1, int(wm.width * scale)), max(1, int(wm.height * scale))), Image.NEAREST)
banner.alpha_composite(wm, ((320 - wm.width) // 2, (180 - wm.height) // 2))
os.makedirs(os.path.join(ROOT, 'tv/assets'), exist_ok=True)
banner.convert('RGB').save(os.path.join(ROOT, 'tv/assets/banner.png'))
print('sprites:', len(os.listdir(OUT)))

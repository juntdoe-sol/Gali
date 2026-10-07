"""Draws Gali's pixel art (all original, procedural) into one atlas.

    python3 scripts/pixel-art.py

Writes app/assets/pixel/atlas.png and app/src/engine/art.json. Needs Pillow + numpy.
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import actors  # noqa: E402
import island  # noqa: E402  the board itself; see scripts/island.py
import ui_icons  # noqa: E402
from atlas import Atlas  # noqa: E402
from font import font_sprites  # noqa: E402
from pixkit import *  # noqa: E402,F401,F403

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app/assets/pixel')
ART_JSON = os.path.join(ROOT, 'app/src/engine/art.json')

# ---------------- effect sprites ----------------
# The old square spots are gone; these are the overlays the scene still draws on
# top of a claim, and 28x36 is the box they are composed in.
SW, SH = 28, 36
PAD_Y = 10


def rock(cv, cx, cy, rx, ry, pal, rng, noise=0.25):
    cv.ellipse(cx, cy, rx, ry, None, lambda x, y, d: shade(pal, x, y, cx, cy - 1, max(rx, ry), rng, noise))



def flag_frames():
    out = []
    for f in range(2):
        cv = Canvas(14, 16, 2)
        cv.rect(3, 2, 1, 14, WOOD[1])
        wave = [0, 1, 1, 0] if f == 0 else [1, 0, 0, 1]
        for i in range(7):
            h = 5
            yo = wave[i % 4]
            for j in range(h):
                cv.set(4 + i, 2 + j + yo, (20, 241, 149) if j < 4 else (10, 160, 100))
        cv.set(6, 4 + wave[2], (255, 255, 255))
        cv.set(7, 4 + wave[3], (255, 255, 255))
        cv.outline()
        out.append(cv)
    return out


def sparkle_frames():
    out = []
    for f in range(3):
        cv = Canvas(SW, SH, 3 + f)
        rng = random.Random(9 + f)
        for _ in range(7):
            x, y = rng.randint(2, 25), rng.randint(2, 30)
            r = 1 + (f + x) % 2
            col = rng.choice([GOLD[4], GOLD[3], (255, 255, 255)])
            cv.set(x, y, col)
            for k in range(1, r + 1):
                for dx, dy in ((k, 0), (-k, 0), (0, k), (0, -k)):
                    cv.set(x + dx, y + dy, c(col, 200 if k == 1 else 120))
        out.append(cv)
    return out


def glow():
    cv = Canvas(SW, SH, 5)
    cv.ellipse(14, PAD_Y + 10, 16, 14, None, lambda x, y, d: (255, 210, 80, int(150 * (1 - d))))
    return cv


def beam():
    cv = Canvas(20, 90, 6)
    for y in range(90):
        for x in range(20):
            e = 1 - abs(x - 9.5) / 10
            a = int(170 * e * e * (0.4 + 0.6 * y / 90))
            cv.set(x, y, (255, 226, 120, a))
    return cv


def dust_frames():
    out = []
    for f in range(3):
        cv = Canvas(20, 12, 8)
        rng = random.Random(3)
        for _ in range(8):
            a = rng.random() * math.pi
            d = 2 + f * 3
            x, y = 10 + math.cos(a) * d * 1.3, 9 - math.sin(a) * d * 0.7
            r = 2 - f * 0.5
            cv.ellipse(x, y, r, r, c((232, 204, 168), 230 - f * 60))
        out.append(cv)
    return out


def falling_rock():
    cv = Canvas(8, 8, 4)
    rock(cv, 4, 4, 3, 3, STONE, cv.rng)
    cv.outline()
    return cv




def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.png') or f.endswith('.json'):
            os.remove(os.path.join(OUT, f))
    atlas = Atlas()
    island_meta = island.build_atlas(atlas)
    actor_meta = actors.build(atlas)
    for i, cv in enumerate(flag_frames()):
        atlas.add(f'fx-flag-{i}', cv.img, 3, 15)
    for i, cv in enumerate(sparkle_frames()):
        atlas.add(f'fx-sparkle-{i}', cv.img, SW // 2, SH // 2)
    for i, cv in enumerate(dust_frames()):
        atlas.add(f'fx-dust-{i}', cv.img, 10, 9)
    atlas.add('fx-beam-0', beam().img, 10, 90)
    atlas.add('fx-rock-0', falling_rock().img, 4, 4)
    ui_icons.build(atlas, ROOT)
    font_meta = font_sprites(atlas)
    rects, size = atlas.pack(os.path.join(OUT, 'atlas.png'))
    # the web build serves a copy from /pixel/atlas.png so index.html can preload it
    # before the JavaScript has even arrived
    pub = os.path.join(ROOT, 'app/public/pixel')
    os.makedirs(pub, exist_ok=True)
    import shutil
    shutil.copyfile(os.path.join(OUT, 'atlas.png'), os.path.join(pub, 'atlas.png'))
    art = {'atlas': {'size': size, 'rects': rects}, 'island': island_meta, 'actors': actor_meta, 'font': font_meta}
    os.makedirs(os.path.dirname(ART_JSON), exist_ok=True)
    with open(ART_JSON, 'w') as f:
        json.dump(art, f, separators=(',', ':'))
    kb = os.path.getsize(os.path.join(OUT, 'atlas.png')) / 1024
    print(f'atlas {size[0]}x{size[1]}, {len(rects)} sprites, {kb:.0f} KB; art.json {os.path.getsize(ART_JSON) // 1024} KB')


if __name__ == '__main__':
    main()

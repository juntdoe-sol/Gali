#!/usr/bin/env python3
"""Pixel art for the dig game: rock tiles, cracks, the dug hole and what is found.

Drawn on a 24x24 grid and saved 4x (96 px) with hard edges, so React Native can
show them at tile size without blurring. Run: python3 scripts/dig-art.py
"""
import os
import random
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'assets', 'dig')
N, S = 24, 4


def save(px, name):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    im.putdata([px[y][x] for y in range(N) for x in range(N)])
    im.resize((N * S, N * S), Image.NEAREST).save(os.path.join(OUT, name))


def blank():
    return [[(0, 0, 0, 0)] * N for _ in range(N)]


def hexc(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def rock(seed, base, light, dark, speck):
    """A chunky block: lit top-left edge, shaded bottom-right, a few facets and specks."""
    r = random.Random(seed)
    px = blank()
    for y in range(N):
        for x in range(N):
            corner = (x in (0, N - 1) and y in (0, N - 1)) or (x + y == 1) or (x + y == 2 * N - 3) or (x == N - 1 and y == 1) or (x == N - 2 and y == 0) or (x == 0 and y == N - 2) or (x == 1 and y == N - 1)
            if corner:
                continue
            c = base
            if y <= 1 or x <= 1:
                c = light
            if y >= N - 3 or x >= N - 2:
                c = dark
            if y == 0 or x == 0 or y == N - 1 or x == N - 1:
                c = hexc('#1a1410') if (y == N - 1 or x == N - 1) else light
            px[y][x] = c
    # facets: short diagonal shade lines
    for _ in range(5):
        x, y = r.randrange(4, N - 8), r.randrange(4, N - 6)
        ln = r.randrange(3, 7)
        for k in range(ln):
            if 2 < x + k < N - 3 and 2 < y + k // 2 < N - 3:
                px[y + k // 2][x + k] = dark
                if y + k // 2 - 1 > 2:
                    px[y + k // 2 - 1][x + k] = light
    for _ in range(14):
        x, y = r.randrange(3, N - 3), r.randrange(3, N - 3)
        px[y][x] = speck
    return px


def crack(stage):
    """A crack that spreads from the middle. Stage 1 is a hairline, stage 2 nearly splits the block."""
    px = blank()
    ink = hexc('#120d0a')
    hi = hexc('#ffffff', 70)
    paths = [[(12, 4), (11, 7), (13, 9), (12, 12), (10, 14), (11, 17), (12, 20)]]
    if stage >= 2:
        paths += [[(12, 12), (15, 11), (17, 13), (20, 12)], [(11, 14), (8, 15), (6, 14), (4, 16)], [(13, 9), (16, 7), (18, 8)]]
    for path in paths:
        for (x0, y0), (x1, y1) in zip(path, path[1:]):
            steps = max(abs(x1 - x0), abs(y1 - y0))
            for i in range(steps + 1):
                x = round(x0 + (x1 - x0) * i / steps)
                y = round(y0 + (y1 - y0) * i / steps)
                px[y][x] = ink
                if stage >= 2 and x + 1 < N:
                    px[y][x + 1] = ink if (x + y) % 3 == 0 else px[y][x + 1]
                if x - 1 >= 0 and px[y][x - 1][3] == 0:
                    px[y][x - 1] = hi
    return px


def hole():
    """What is left when a block breaks: a dark cavity with a rough rim."""
    r = random.Random(7)
    px = blank()
    rim, deep, mid = hexc('#2a2136'), hexc('#070a16'), hexc('#10142a')
    for y in range(N):
        for x in range(N):
            d = ((x - 11.5) ** 2 + (y - 11.5) ** 2) ** 0.5 + r.uniform(-0.8, 0.8)
            if d < 8.2:
                px[y][x] = deep
            elif d < 9.6:
                px[y][x] = mid
            elif d < 11.2:
                px[y][x] = rim
    for _ in range(8):
        x, y = r.randrange(5, N - 5), r.randrange(14, N - 5)
        px[y][x] = hexc('#3a3350')
    return px


def blob(shape, pal):
    px = blank()
    for y, row in enumerate(shape):
        for x, ch in enumerate(row):
            if ch != '.':
                px[y + (N - len(shape)) // 2][x + (N - len(row)) // 2] = pal[ch]
    return px


NUGGET = [
    '....oooooo....',
    '..ooHHHHggoo..',
    '.oHHHWHgggggo.',
    'oHHWWHggggggdo',
    'oHHHHgggggddDo',
    'oHggggggWgddDo',
    'ogggggggggdDDo',
    'oggggdggggdDDo',
    '.ogdddddddDDo.',
    '..ooDDDDDDoo..',
    '....oooooo....',
]
GEM = [
    '.....oooo.....',
    '....oWWHHo....',
    '...oWWHHhho...',
    '..oWHHHhhhho..',
    '.oHHHhhhhhddo.',
    'oHHhhhhWhhdddo',
    'ohhhhhhhhdddDo',
    '.ohhhhhhdddDo.',
    '..ohhhhdddDo..',
    '...ohhdddDo...',
    '....ohddDo....',
    '.....odDo.....',
    '......oo......',
]
PEBBLES = [
    '...........oo.',
    '..ooo.....oHdo',
    '.oHHdo....odDo',
    'oHHdddo....oo.',
    'oHdddDo.......',
    '.odDDo...ooo..',
    '..ooo...oHHdo.',
    '........oHdDo.',
    '.........ooo..',
]
SPARK = [
    '....W....',
    '....W....',
    '...WWW...',
    '..WWWWW..',
    'WWWWWWWWW',
    '..WWWWW..',
    '...WWW...',
    '....W....',
    '....W....',
]

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save(rock(1, hexc('#8a6644'), hexc('#b88a5c'), hexc('#5c4129'), hexc('#a87c52')), 'rock-1.png')
    save(rock(2, hexc('#6b7388'), hexc('#98a2b8'), hexc('#454c5e'), hexc('#8590a6')), 'rock-2.png')
    save(rock(3, hexc('#3b4263'), hexc('#5f6a96'), hexc('#232843'), hexc('#4f5a86')), 'rock-3.png')
    save(crack(1), 'crack-1.png')
    save(crack(2), 'crack-2.png')
    save(hole(), 'hole.png')
    o = hexc('#2a1a00')
    save(blob(NUGGET, {'o': o, 'H': hexc('#ffe58a'), 'W': hexc('#fffbe0'), 'g': hexc('#ffcf4a'), 'd': hexc('#e08a1e'), 'D': hexc('#a85a10')}), 'nugget.png')
    o2 = hexc('#062a33')
    save(blob(GEM, {'o': o2, 'W': hexc('#f0ffff'), 'H': hexc('#a8f6ff'), 'h': hexc('#3ee6ff'), 'd': hexc('#1aa6c4'), 'D': hexc('#0d6c86')}), 'gem.png')
    o3 = hexc('#151923')
    save(blob(PEBBLES, {'o': o3, 'H': hexc('#98a2b8'), 'd': hexc('#6b7388'), 'D': hexc('#454c5e')}), 'pebbles.png')
    save(blob(SPARK, {'W': hexc('#ffffff')}), 'spark.png')
    print('wrote', sorted(os.listdir(OUT)))

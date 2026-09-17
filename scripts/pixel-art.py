"""Draws Gali's pixel art (all original, procedural) into app/assets/pixel/.

    python3 scripts/pixel-art.py

Everything is drawn at 1x on a small canvas, then scaled up with nearest-neighbour (SCALE)
so it stays crisp on phones. Needs Pillow.
Sprites that the app tints (helmet, overalls, pickaxe head, pets) come in two layers:
`*-tint.png` (flat white, the app colours it) and `*-shade.png` (shading drawn on top).
"""
import json
import math
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app/assets/pixel')
SCALE = 4

# ---------------- palette ----------------
INK = (42, 28, 20, 255)
GRASS = [(77, 122, 51), (95, 143, 62), (111, 163, 69), (140, 188, 85)]
DIRT = [(107, 70, 48), (132, 90, 56), (155, 107, 67), (176, 124, 79), (196, 146, 98)]
YARD = [(150, 114, 76), (170, 132, 88), (188, 150, 104), (206, 170, 122)]
STONE = [(62, 64, 74), (86, 90, 101), (120, 125, 136), (160, 166, 176), (200, 205, 212)]
COAL = [(24, 25, 32), (40, 43, 54), (60, 64, 80), (92, 98, 118)]
GOLD = [(150, 96, 22), (200, 132, 32), (242, 182, 50), (255, 215, 74), (255, 243, 168)]
BLUE = [(34, 90, 170), (47, 143, 214), (88, 200, 255), (168, 232, 255), (235, 250, 255)]
PURPLE = [(86, 40, 150), (122, 63, 209), (179, 108, 255), (224, 184, 255)]
WOOD = [(78, 48, 28), (110, 68, 40), (138, 90, 54), (168, 116, 74)]
RED = [(120, 36, 30), (170, 52, 42), (217, 72, 59), (240, 120, 96)]
LEAF = [(40, 78, 40), (58, 104, 52), (80, 134, 62), (116, 168, 80)]
AUTUMN = [(122, 50, 24), (170, 74, 30), (214, 110, 40), (240, 156, 60)]
WATER = [(38, 92, 128), (52, 126, 160), (84, 168, 196), (160, 216, 232)]
SKIN = [(178, 110, 80), (222, 156, 118), (242, 194, 155)]
BEARD = [(90, 44, 24), (130, 66, 34), (168, 92, 48)]
BOOT = [(58, 38, 28), (86, 58, 40)]
SHIRT = [(214, 120, 48), (240, 156, 72)]
CLEAR = (0, 0, 0, 0)


def c(rgb, a=255):
    return (*rgb[:3], a)


class Canvas:
    def __init__(self, w, h, seed=1):
        self.w, self.h = w, h
        self.img = Image.new('RGBA', (w, h), CLEAR)
        self.px = self.img.load()
        self.rng = random.Random(seed)

    def set(self, x, y, col):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < self.w and 0 <= y < self.h:
            if len(col) == 4 and col[3] < 255:
                if col[3] == 0:
                    return
                bx = self.px[x, y]
                a = col[3] / 255
                self.px[x, y] = (
                    int(bx[0] * (1 - a) + col[0] * a),
                    int(bx[1] * (1 - a) + col[1] * a),
                    int(bx[2] * (1 - a) + col[2] * a),
                    max(bx[3], col[3]),
                )
            else:
                self.px[x, y] = c(col)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return CLEAR

    def rect(self, x, y, w, h, col):
        for j in range(int(h)):
            for i in range(int(w)):
                self.set(x + i, y + j, col)

    def ellipse(self, cx, cy, rx, ry, col, fn=None):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                d = ((x - cx) / max(rx, 0.01)) ** 2 + ((y - cy) / max(ry, 0.01)) ** 2
                if d <= 1:
                    self.set(x, y, fn(x, y, d) if fn else col)

    def line(self, x0, y0, x1, y1, col):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for k in range(n + 1):
            t = k / max(n, 1)
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, col)

    def poly(self, pts, col):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                if inside(pts, x + 0.5, y + 0.5):
                    self.set(x, y, col if not callable(col) else col(x, y))

    def outline(self, col=INK, only_below=None):
        src = self.img.copy().load()
        for y in range(self.h):
            for x in range(self.w):
                if src[x, y][3] > 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and src[nx, ny][3] > 200:
                        if only_below is None or y < only_below:
                            self.px[x, y] = col
                        break

    def paste(self, other, x, y):
        self.img.alpha_composite(other.img, (int(x), int(y)))

    def save(self, name, scale=SCALE):
        img = self.img.resize((self.w * scale, self.h * scale), Image.NEAREST)
        img.save(os.path.join(OUT, name), optimize=True)


def inside(pts, x, y):
    n = len(pts)
    ok = False
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
            ok = not ok
        j = i
    return ok


def shade(pal, x, y, cx, cy, r, rng=None, noise=0.0):
    """Top-left lit sphere shading picked from a palette."""
    dx, dy = (x - cx) / max(r, 1), (y - cy) / max(r, 1)
    v = 0.55 - 0.45 * dx - 0.55 * dy
    if rng is not None:
        v += (rng.random() - 0.5) * noise
    k = max(0, min(len(pal) - 1, int(v * len(pal))))
    return pal[k]


# ---------------- spot sprites (28x36; pad is the bottom 28 rows) ----------------
SW, SH = 28, 36
PAD_Y = 10


def pad(cv, kind):
    """A dug-out claim pad with a 3/4 cliff face."""
    top = PAD_Y
    rng = cv.rng
    # cliff face
    for x in range(1, 27):
        for y in range(top + 20, top + 25):
            if (x in (1, 26) and y > top + 22):
                continue
            cv.set(x, y, DIRT[1] if y < top + 22 else DIRT[0])
    for x in range(2, 26, 3):
        cv.set(x + rng.randint(0, 1), top + 21 + rng.randint(0, 2), DIRT[0])
    # rim (grass lip) + floor
    base = {0: DIRT, 1: STONE, 2: DIRT, 3: STONE, 4: STONE, 5: DIRT, 6: STONE, 7: DIRT, 8: DIRT}[kind]
    for y in range(top, top + 21):
        for x in range(1, 27):
            corner = (x in (1, 26) and y in (top, top + 20))
            if corner:
                continue
            edge = x in (1, 26) or y in (top, top + 20)
            if edge:
                cv.set(x, y, GRASS[1] if y == top else GRASS[0] if y < top + 20 else DIRT[1])
            else:
                if base is STONE:
                    col = STONE[2] if rng.random() > 0.2 else STONE[1]
                    if rng.random() < 0.08:
                        col = STONE[3]
                else:
                    col = DIRT[3] if rng.random() > 0.25 else DIRT[2]
                    if rng.random() < 0.06:
                        col = DIRT[4]
                cv.set(x, y, col)
    # inner shadow under the rim
    for x in range(2, 26):
        cv.set(x, top + 1, (0, 0, 0, 60))
    for y in range(top + 1, top + 20):
        cv.set(2, y, (0, 0, 0, 40))
    # grass tufts on the lip
    for x in (3, 9, 17, 23):
        cv.set(x + rng.randint(0, 2), top - 1, GRASS[2])
    # pebbles
    for _ in range(4):
        px, py = rng.randint(4, 23), rng.randint(top + 14, top + 18)
        cv.set(px, py, STONE[3])
        cv.set(px + 1, py, STONE[2])


def rock(cv, cx, cy, rx, ry, pal, rng, noise=0.25):
    cv.ellipse(cx, cy, rx, ry, None, lambda x, y, d: shade(pal, x, y, cx, cy - 1, max(rx, ry), rng, noise))


def prop_coal(cv):
    rng = cv.rng
    s = Canvas(SW, SH, cv.rng.random())
    rock(s, 13, 22, 9, 7, COAL, rng)
    rock(s, 19, 25, 5, 4, COAL, rng)
    rock(s, 8, 26, 4, 3, COAL, rng)
    for _ in range(9):  # glints
        s.set(rng.randint(7, 19), rng.randint(17, 26), COAL[3])
    # pickaxe stuck in the heap
    s.line(18, 10, 13, 19, WOOD[2])
    s.line(19, 10, 14, 19, WOOD[1])
    s.line(15, 9, 22, 12, STONE[3])
    s.line(15, 10, 22, 13, STONE[2])
    s.set(22, 11, STONE[4])
    s.outline()
    cv.paste(s, 0, 0)
    for x, y in ((11, 16), (12, 16), (12, 15)):  # gold nugget on top
        cv.set(x, y, GOLD[3])
    cv.set(11, 15, GOLD[4])


def prop_boulder(cv):
    rng = cv.rng
    s = Canvas(SW, SH, rng.random())
    rock(s, 14, 20, 10, 9, STONE, rng, 0.2)
    rock(s, 6, 26, 4, 3, STONE, rng)
    # cracks
    s.line(10, 14, 13, 19, STONE[0])
    s.line(13, 19, 12, 23, STONE[0])
    s.line(13, 19, 17, 21, STONE[0])
    for x, y in ((18, 16), (19, 17), (17, 17)):  # copper speckles
        s.set(x, y, AUTUMN[2])
    s.outline()
    cv.paste(s, 0, 0)


def prop_gold(cv):
    rng = cv.rng
    s = Canvas(SW, SH, rng.random())
    rock(s, 13, 21, 10, 8, STONE, rng, 0.2)
    for gx, gy, r in ((10, 19, 2.6), (16, 22, 2.2), (13, 16, 1.8), (18, 17, 1.5)):
        s.ellipse(gx, gy, r, r, None, lambda x, y, d, gx=gx, gy=gy, r=r: shade(GOLD, x, y, gx, gy, r))
    s.outline()
    cv.paste(s, 0, 0)
    for x, y in ((9, 18), (12, 15), (17, 16)):
        cv.set(x, y, GOLD[4])


def prop_crystal(cv, pal):
    rng = cv.rng
    s = Canvas(SW, SH, rng.random())
    rock(s, 14, 26, 9, 4, STONE, rng)

    def shard(x, base, h, w, lean):
        pts = [(x - w, base), (x - w + lean * 0.5, base - h * 0.7), (x + lean, base - h), (x + w + lean * 0.5, base - h * 0.7), (x + w, base)]
        s.poly(pts, lambda px, py: pal[2] if px < x + lean * (base - py) / h else pal[1])
        s.line(x + lean * 0.3, base - 1, x + lean * 0.9, base - h + 2, pal[3])

    shard(14, 26, 17, 3, 0)
    shard(9, 26, 11, 2.5, -2)
    shard(19, 26, 12, 2.5, 2)
    shard(12, 27, 7, 2, -1)
    s.outline()
    cv.paste(s, 0, 0)
    cv.set(14, 11, pal[-1])
    cv.set(8, 17, pal[-1])


def prop_shaft(cv):
    s = Canvas(SW, SH, cv.rng.random())
    # dark hole
    s.ellipse(14, 22, 8, 5, COAL[0])
    s.ellipse(14, 21, 7, 3.5, (10, 10, 14))
    # timber frame
    s.rect(5, 8, 3, 17, WOOD[2])
    s.rect(20, 8, 3, 17, WOOD[2])
    s.rect(5, 8, 1, 17, WOOD[3])
    s.rect(20, 8, 1, 17, WOOD[3])
    s.rect(3, 6, 22, 3, WOOD[1])
    s.rect(3, 6, 22, 1, WOOD[3])
    # lantern
    s.rect(13, 9, 2, 3, GOLD[3])
    s.set(13, 9, GOLD[4])
    s.line(14, 8, 14, 9, STONE[1])
    # ladder
    for y in (18, 21, 24):
        s.line(11, y, 17, y, WOOD[3])
    s.line(11, 16, 11, 25, WOOD[2])
    s.line(17, 16, 17, 25, WOOD[2])
    s.outline()
    cv.paste(s, 0, 0)


def prop_drill(cv):
    s = Canvas(SW, SH, cv.rng.random())
    # base
    s.rect(6, 24, 16, 4, STONE[1])
    s.rect(6, 24, 16, 1, STONE[3])
    # tower legs
    s.line(8, 24, 12, 3, GOLD[2])
    s.line(20, 24, 16, 3, GOLD[2])
    for y in (8, 13, 18):
        k = (y - 3) / 21
        s.line(12 - 4 * k, y, 16 + 4 * k, y, GOLD[1])
    s.line(9, 19, 15, 9, GOLD[1])
    s.rect(11, 1, 7, 3, RED[2])
    s.rect(11, 1, 7, 1, RED[3])
    # drill bit
    s.poly([(12, 16), (16, 16), (15, 25), (14, 29), (13, 25)], lambda x, y: STONE[3] if (x + y) % 3 else STONE[2])
    s.line(12, 18, 16, 19, STONE[1])
    s.line(12, 21, 16, 22, STONE[1])
    s.outline()
    cv.paste(s, 0, 0)
    # spoil heaps
    rock(cv, 4, 29, 3, 2, DIRT, cv.rng)
    rock(cv, 24, 29, 3, 2, DIRT, cv.rng)


def prop_cart(cv):
    s = Canvas(SW, SH, cv.rng.random())
    # rails
    for y in (26, 29):
        s.line(1, y, 26, y, STONE[3])
    for x in range(2, 26, 4):
        s.rect(x, 25, 2, 6, WOOD[1])
    for y in (26, 29):
        s.line(1, y, 26, y, STONE[3])
    # cart
    s.poly([(6, 14), (22, 14), (20, 25), (8, 25)], lambda x, y: WOOD[2] if y < 20 else WOOD[1])
    s.line(6, 14, 22, 14, WOOD[3])
    s.line(7, 19, 21, 19, STONE[1])
    for wx in (10, 18):
        s.ellipse(wx, 26, 2, 2, STONE[0])
        s.set(wx, 26, STONE[3])
    # ore load
    rng = cv.rng
    for i in range(7, 22):
        h = 2 + int(2 * math.sin(i * 0.9) + rng.random() * 2)
        for y in range(14 - h, 14):
            s.set(i, y, COAL[1] if rng.random() > 0.3 else COAL[2])
    for x, y in ((10, 11), (15, 10), (18, 12)):
        s.set(x, y, GOLD[3])
    s.outline()
    cv.paste(s, 0, 0)


def prop_pit(cv):
    s = Canvas(SW, SH, cv.rng.random())
    # terraces
    s.ellipse(14, 20, 11, 8, DIRT[2])
    s.ellipse(14, 20, 8.5, 6, DIRT[1])
    s.ellipse(14, 20, 6, 4, DIRT[0])
    s.ellipse(14, 20, 3.5, 2.2, (20, 14, 10))
    # tiny dump truck on the ramp
    s.rect(18, 12, 6, 3, GOLD[3])
    s.rect(18, 12, 6, 1, GOLD[4])
    s.rect(22, 10, 2, 2, GOLD[2])
    s.set(19, 15, COAL[0])
    s.set(23, 15, COAL[0])
    # warning flag
    s.line(4, 7, 4, 16, WOOD[2])
    s.rect(5, 7, 4, 3, RED[2])
    s.outline()
    cv.paste(s, 0, 0)


def prop_sluice(cv):
    """Water sluice box for panning gold."""
    s = Canvas(SW, SH, cv.rng.random())
    s.poly([(3, 12), (25, 18), (25, 24), (3, 18)], lambda x, y: WOOD[2] if y < (x * 6 / 22 + 15) else WOOD[1])
    s.poly([(5, 13), (23, 18), (23, 20), (5, 15)], lambda x, y: WATER[2] if (x + y) % 4 else WATER[3])
    for x in range(7, 23, 4):
        s.line(x, 13 + (x - 3) * 6 // 22, x, 16 + (x - 3) * 6 // 22, WOOD[0])
    s.rect(3, 18, 2, 9, WOOD[1])
    s.rect(23, 23, 2, 5, WOOD[1])
    # bucket + pan
    s.rect(18, 25, 5, 4, STONE[2])
    s.rect(18, 25, 5, 1, STONE[3])
    s.ellipse(8, 27, 3, 1.5, STONE[1])
    s.set(8, 27, GOLD[3])
    s.outline()
    cv.paste(s, 0, 0)


KINDS = ['coal', 'boulder', 'gold', 'crystal-blue', 'crystal-purple', 'shaft', 'drill', 'cart', 'pit', 'sluice']
# neighbours differ; gold and crystals are spread out
LAYOUT = [0, 6, 1, 7, 3,
          5, 2, 8, 0, 9,
          1, 4, 6, 5, 2,
          7, 0, 9, 3, 8,
          3, 8, 2, 1, 6]


def draw_spot(kind, seed):
    cv = Canvas(SW, SH, seed)
    padkind = {'coal': 0, 'boulder': 1, 'gold': 2, 'crystal-blue': 3, 'crystal-purple': 4, 'shaft': 5, 'drill': 6, 'cart': 7, 'pit': 8, 'sluice': 7}[kind]
    pad(cv, padkind)
    {
        'coal': prop_coal,
        'boulder': prop_boulder,
        'gold': prop_gold,
        'crystal-blue': lambda v: prop_crystal(v, BLUE),
        'crystal-purple': lambda v: prop_crystal(v, PURPLE),
        'shaft': prop_shaft,
        'drill': prop_drill,
        'cart': prop_cart,
        'pit': prop_pit,
        'sluice': prop_sluice,
    }[kind](cv)
    return cv


# ---------------- map background ----------------
# The map is much bigger than the grid so the world fills any screen shape around it.
MW, MH = 360, 440
STEP = 32
GRID_W, GRID_H = 4 * STEP + SW, 4 * STEP + SH
GRID_X, GRID_Y = (MW - GRID_W) // 2, (MH - GRID_H) // 2 - 6   # spot sprite (0,0) top-left


def tree(cv, x, y, pal, seed):
    rng = random.Random(seed)
    s = Canvas(22, 28, seed)
    s.rect(9, 18, 4, 9, WOOD[1])
    s.rect(9, 18, 1, 9, WOOD[2])
    for bx, by, r in ((11, 11, 8), (6, 14, 5), (16, 14, 5), (11, 6, 6)):
        s.ellipse(bx, by, r, r * 0.9, None, lambda px, py, d, bx=bx, by=by, r=r: shade(pal, px, py, bx, by, r, rng, 0.35))
    s.outline()
    shadow(cv, x + 11, y + 27, 8, 2)
    cv.paste(s, x, y)


def pine(cv, x, y, seed):
    s = Canvas(16, 28, seed)
    s.rect(7, 22, 2, 5, WOOD[1])
    for k, (w, yy) in enumerate(((7, 16), (6, 10), (4, 4))):
        s.poly([(8 - w, yy + 7), (8, yy - 3), (8 + w, yy + 7)], lambda px, py, k=k: LEAF[1] if px < 8 else LEAF[0])
        s.line(8, yy - 2, 8 - w + 2, yy + 5, LEAF[2])
    s.outline()
    shadow(cv, x + 8, y + 27, 6, 2)
    cv.paste(s, x, y)


def bush(cv, x, y, pal, seed):
    rng = random.Random(seed)
    s = Canvas(12, 9, seed)
    s.ellipse(6, 5, 5, 3.5, None, lambda px, py, d: shade(pal, px, py, 6, 5, 5, rng, 0.35))
    s.outline()
    cv.paste(s, x, y)


def boulder(cv, x, y, r, seed):
    s = Canvas(2 * r + 4, 2 * r + 4, seed)
    rock(s, r + 2, r + 2, r, r * 0.8, STONE, s.rng)
    s.outline()
    shadow(cv, x + r + 2, y + r * 1.8 + 2, r, 1.5)
    cv.paste(s, x, y)


def shadow(cv, cx, cy, rx, ry):
    cv.ellipse(cx, cy, rx, ry, (20, 30, 10, 70))


def house(cv, x, y, roof, seed, w=40):
    s = Canvas(w, 32, seed)
    s.rect(4, 13, w - 8, 17, WOOD[2])
    for yy in range(14, 30, 3):
        s.line(4, yy, w - 5, yy, WOOD[1])
    s.poly([(1, 14), (w // 2, 2), (w - 1, 14)], lambda px, py: roof[2] if (px + py) % 4 else roof[1])
    s.line(1, 14, w // 2, 2, roof[3])
    s.rect(w // 2 - 3, 19, 6, 11, WOOD[0])
    s.set(w // 2 + 1, 24, GOLD[3])
    s.rect(7, 17, 6, 5, GOLD[4])
    s.rect(w - 13, 17, 6, 5, GOLD[4])
    s.line(7, 19, 12, 19, WOOD[1])
    s.line(w - 13, 19, w - 8, 19, WOOD[1])
    s.rect(9, 5, 3, 6, STONE[2])
    s.outline()
    shadow(cv, x + w // 2, y + 31, w // 2 - 2, 2)
    cv.paste(s, x, y)


def tent(cv, x, y, col, seed):
    s = Canvas(22, 16, seed)
    s.poly([(1, 15), (11, 1), (21, 15)], lambda px, py: col[2] if px < 11 else col[1])
    s.poly([(8, 15), (11, 7), (14, 15)], lambda px, py: (40, 26, 18))
    s.line(11, 1, 11, 0, WOOD[2])
    s.outline()
    shadow(cv, x + 11, y + 15, 10, 2)
    cv.paste(s, x, y)


def lamp(cv, x, y):
    cv.rect(x, y, 1, 9, STONE[0])
    cv.rect(x - 1, y - 2, 3, 3, GOLD[3])
    cv.set(x, y - 1, GOLD[4])
    cv.set(x, y - 3, STONE[0])
    cv.ellipse(x, y - 1, 4, 4, (255, 220, 120, 40))


def barrel(cv, x, y):
    s = Canvas(7, 8, 3)
    s.rect(1, 0, 5, 8, WOOD[2])
    s.rect(1, 0, 1, 8, WOOD[3])
    s.line(0, 2, 6, 2, STONE[1])
    s.line(0, 5, 6, 5, STONE[1])
    s.outline()
    cv.paste(s, x, y)


def crates(cv, x, y):
    s = Canvas(14, 11, 4)
    for bx, by in ((0, 4), (7, 4), (3, 0)):
        s.rect(bx, by, 7, 7, WOOD[2])
        s.line(bx, by, bx + 6, by + 6, WOOD[1])
        s.rect(bx, by, 7, 1, WOOD[3])
    s.outline()
    cv.paste(s, x, y)


def cart(cv, x, y):
    s = Canvas(16, 12, 5)
    s.poly([(1, 1), (15, 1), (13, 9), (3, 9)], WOOD[2])
    s.line(1, 1, 15, 1, WOOD[3])
    for i in range(2, 14):
        s.set(i, 0, COAL[1] if i % 3 else GOLD[3])
    for wx in (4, 12):
        s.ellipse(wx, 10, 1.5, 1.5, STONE[0])
    s.outline()
    cv.paste(s, x, y)


def mountain(cv, x, y, w, h, seed):
    """Rocky hill with a timbered tunnel mouth."""
    rng = random.Random(seed)
    s = Canvas(w, h, seed)
    s.poly([(0, h - 1), (w * 0.08, h * 0.55), (w * 0.2, h * 0.32), (w * 0.33, h * 0.22), (w * 0.45, h * 0.08), (w * 0.58, 2),
            (w * 0.7, h * 0.14), (w * 0.82, h * 0.3), (w * 0.93, h * 0.55), (w - 1, h - 1)],
           lambda px, py: STONE[3] if px < w * 0.55 - (py * 0.2) and rng.random() > 0.15 else STONE[2] if rng.random() > 0.1 else STONE[1])
    for _ in range(18):
        px, py = rng.randint(4, w - 5), rng.randint(int(h * 0.3), h - 4)
        if s.get(px, py)[3]:
            s.line(px, py, px + 3, py + 1, STONE[1])
    tx = w // 2
    s.ellipse(tx, h - 6, 7, 8, (14, 12, 16))
    s.rect(tx - 9, h - 16, 3, 16, WOOD[2])
    s.rect(tx + 7, h - 16, 3, 16, WOOD[2])
    s.rect(tx - 10, h - 17, 21, 3, WOOD[1])
    s.rect(tx - 1, h - 14, 2, 3, GOLD[3])
    s.outline()
    cv.paste(s, x, y)


def bridge(cv, x, y):
    s = Canvas(20, 12, 6)
    for i in range(0, 20, 3):
        s.rect(i, 2, 2, 8, WOOD[2])
        s.set(i, 2, WOOD[3])
    s.line(0, 1, 19, 1, WOOD[1])
    s.line(0, 10, 19, 10, WOOD[1])
    s.outline()
    cv.paste(s, x, y)


def draw_map():
    cv = Canvas(MW, MH, 42)
    rng = cv.rng
    for y in range(MH):
        for x in range(MW):
            v = rng.random()
            cv.set(x, y, GRASS[2] if v > 0.3 else GRASS[1] if v > 0.05 else GRASS[3])
    for _ in range(900):
        x, y = rng.randint(0, MW - 1), rng.randint(0, MH - 1)
        cv.set(x, y, GRASS[0])
        cv.set(x, y - 1, GRASS[1])

    # quarry yard behind the grid
    x0, y0 = GRID_X - 8, GRID_Y + 2
    x1, y1 = GRID_X + GRID_W + 8, GRID_Y + GRID_H + 6

    def yard(px, py):
        v = rng.random()
        return YARD[2] if v > 0.35 else YARD[1] if v > 0.08 else YARD[3]

    cv.poly([(x0 + 5, y0), (x1 - 5, y0), (x1, y0 + 6), (x1 + 1, y1 - 7), (x1 - 6, y1), (x0 + 6, y1), (x0, y1 - 6), (x0 - 1, y0 + 7)], yard)

    # dirt road from the yard down to the bottom edge, and one to the left village
    road_x = MW // 2 - 6

    def road(px, py):
        v = rng.random()
        return DIRT[3] if v > 0.3 else DIRT[2] if v > 0.05 else DIRT[4]

    cv.poly([(road_x, y1 - 2), (road_x + 12, y1 - 2), (road_x + 16, MH), (road_x - 4, MH)], road)
    cv.poly([(0, GRID_Y + 70), (x0 + 2, GRID_Y + 66), (x0 + 2, GRID_Y + 78), (0, GRID_Y + 82)], road)
    # edge rims
    src = cv.img.copy().load()
    for y in range(1, MH - 1):
        for x in range(1, MW - 1):
            if src[x, y][:3] in GRASS and any(src[x + dx, y + dy][:3] in YARD + DIRT for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                cv.set(x, y, GRASS[0])
    # wheel ruts in the yard between rows
    for r in range(5):
        yy = GRID_Y + r * STEP + SH + 1
        if yy < y1 - 1:
            for x in range(x0 + 3, x1 - 3):
                if rng.random() > 0.35:
                    cv.set(x, yy, YARD[0])

    # rails: from the tunnel at the top right, down the right side of the yard, with a cart
    rx = x1 + 6
    for y in range(40, y1 + 20):
        if y % 4 == 0:
            cv.rect(rx - 1, y, 9, 1, WOOD[1])
    for y in range(40, y1 + 20):
        cv.set(rx, y, STONE[3])
        cv.set(rx + 6, y, STONE[3])
    for y in range(y1 + 20, y1 + 24):
        cv.rect(rx - 1, y, 9, 1, WOOD[0])  # buffer stop
    cart(cv, rx - 4, y1 - 4)

    # creek across the bottom with a bridge where the road crosses
    cy0 = MH - 34
    for x in range(MW):
        mid = cy0 + int(4 * math.sin(x / 17.0))
        for y in range(mid - 5, mid + 6):
            edge = y in (mid - 5, mid + 5)
            cv.set(x, y, STONE[2] if edge else (WATER[2] if (x * 3 + y * 5) % 11 else WATER[3]))
        if x % 9 == 0:
            cv.set(x, mid, WATER[3])
    bmid = cy0 + int(4 * math.sin((road_x + 6) / 17.0))
    bridge(cv, road_x - 4, bmid - 6)

    # north: tunnel hill, buildings, trees
    mountain(cv, x1 - 30, 2, 78, 52, 70)
    house(cv, x0 - 6, GRID_Y - 44, RED, 71)
    house(cv, x0 + 40, GRID_Y - 40, BLUE, 72, w=34)
    crates(cv, x0 + 80, GRID_Y - 16)
    barrel(cv, x0 + 96, GRID_Y - 14)
    barrel(cv, x0 + 103, GRID_Y - 12)
    lamp(cv, x0 + 36, GRID_Y - 8)
    lamp(cv, x1 - 4, GRID_Y + 2)
    lamp(cv, x0 - 3, GRID_Y + 2)
    lamp(cv, road_x - 6, y1 + 6)
    lamp(cv, road_x + 17, y1 + 6)
    # west: camp
    tent(cv, 8, GRID_Y + 30, RED, 73)
    tent(cv, 30, GRID_Y + 44, BLUE, 74)
    crates(cv, 14, GRID_Y + 96)
    barrel(cv, 36, GRID_Y + 100)
    # campfire
    cv.ellipse(24, GRID_Y + 70, 3, 2, STONE[1])
    cv.rect(23, GRID_Y + 67, 3, 3, GOLD[3])
    cv.set(24, GRID_Y + 66, GOLD[4])

    # trees and rocks scattered outside the busy areas
    keep_out = [
        (x0 - 12, y0 - 16, x1 + 20, y1 + 12),         # yard, rails
        (road_x - 10, y1 - 4, road_x + 22, MH),      # road
        (x1 - 32, 0, x1 + 50, 56),                   # hill
        (x1, 36, x1 + 16, y1 + 26),                  # rails
        (x0 - 8, GRID_Y - 48, x0 + 112, GRID_Y),     # houses
        (0, GRID_Y + 24, 60, GRID_Y + 112),          # camp
        (0, GRID_Y + 60, x0, GRID_Y + 86),           # west road
        (0, cy0 - 12, MW, cy0 + 10),                 # creek
    ]

    def free(x, y, w, h):
        return all(x + w < a or x > c2 or y + h < b or y > d for a, b, c2, d in keep_out)

    placed = []
    for k in range(260):
        x, y = rng.randint(-10, MW - 10), rng.randint(-14, MH - 20)
        w, h = 22, 28
        if not free(x, y, w, h) or any(abs(x - px) < 16 and abs(y - py) < 14 for px, py in placed):
            continue
        placed.append((x, y))
    placed.sort(key=lambda p: p[1])
    for n, (x, y) in enumerate(placed):
        pick = n % 7
        if pick in (0, 3):
            tree(cv, x, y, AUTUMN, 200 + n)
        elif pick in (1, 5):
            tree(cv, x, y, LEAF, 200 + n)
        elif pick == 2:
            pine(cv, x + 3, y, 200 + n)
        elif pick == 4:
            boulder(cv, x + 4, y + 14, 4 + n % 3, 200 + n)
        else:
            bush(cv, x + 5, y + 16, LEAF if n % 2 else AUTUMN, 200 + n)
    for _ in range(90):
        x, y = rng.randint(0, MW - 1), rng.randint(0, MH - 1)
        if cv.get(x, y)[:3] in GRASS:
            cv.set(x, y, rng.choice([(255, 220, 90), (255, 140, 120), (240, 240, 255), (200, 160, 255)]))
    return cv


# ---------------- overlays ----------------
def select_frames():
    out = []
    for f in range(2):
        cv = Canvas(SW, SH, 1)
        o = f
        col = (62, 230, 255)
        top, bot, left, right = PAD_Y - 1 - o, PAD_Y + 21 + o, 0 - o + 1, 27 + o - 1
        for (x, y, dx, dy) in ((left, top, 1, 1), (right, top, -1, 1), (left, bot, 1, -1), (right, bot, -1, -1)):
            for k in range(5):
                cv.set(x + dx * k, y, col)
                cv.set(x, y + dy * k, col)
                cv.set(x + dx * k, y + dy, (255, 255, 255))
        out.append(cv)
    return out


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


def dim():
    cv = Canvas(SW, SH, 1)
    top = PAD_Y
    cv.rect(1, top, 26, 25, (10, 8, 16, 255))
    return cv


# ---------------- miner (16x22) ----------------
MNW, MNH = 18, 24


def miner_frame(pose, t):
    """pose: idle|walk|swing; t: frame index. Returns (body, helmet, outfit, pick) canvases."""
    body = Canvas(MNW, MNH, 11)
    hat = Canvas(MNW, MNH, 12)
    fit = Canvas(MNW, MNH, 13)
    pick = Canvas(MNW, MNH, 14)
    bob = 0
    legs = (0, 0)
    arm = 0  # swing angle index
    if pose == 'idle':
        bob = 1 if t == 1 else 0
    elif pose == 'walk':
        bob = 1 if t in (1, 3) else 0
        legs = [(0, 0), (1, -1), (0, 0), (-1, 1)][t]
    elif pose == 'swing':
        arm = t
    oy = 1 + bob
    # boots and legs
    body.rect(5, 19 + legs[0], 3, 3 - max(0, legs[0]), BOOT[0])
    body.rect(10, 19 + legs[1], 3, 3 - max(0, legs[1]), BOOT[0])
    body.set(5, 19 + legs[0], BOOT[1])
    body.set(10, 19 + legs[1], BOOT[1])
    # overalls (tinted)
    fit.rect(5, 11 + oy, 8, 8 - bob, (255, 255, 255))
    fit.rect(5, 17, 3, 3 + legs[0] - (1 if legs[0] < 0 else 0), (255, 255, 255))
    fit.rect(10, 17, 3, 3 + legs[1] - (1 if legs[1] < 0 else 0), (255, 255, 255))
    # shirt + arms
    body.rect(4, 10 + oy, 10, 3, SHIRT[0])
    body.rect(5, 10 + oy, 8, 1, SHIRT[1])
    body.rect(3, 11 + oy, 2, 5, SHIRT[0])
    # head
    body.rect(5, 3 + oy, 8, 7, SKIN[1])
    body.rect(5, 3 + oy, 1, 7, SKIN[0])
    body.set(7, 6 + oy, INK)
    body.set(11, 6 + oy, INK)
    body.set(12, 7 + oy, SKIN[2])
    # beard
    body.rect(5, 8 + oy, 8, 3, BEARD[1])
    body.rect(6, 10 + oy, 6, 2, BEARD[1])
    body.set(8, 9 + oy, BEARD[2])
    body.set(9, 9 + oy, SKIN[0])
    body.rect(7, 12 + oy, 4, 1, BEARD[0])
    # helmet (tinted) + lamp
    hat.rect(4, 1 + oy, 10, 3, (255, 255, 255))
    hat.rect(3, 4 + oy, 12, 1, (255, 255, 255))
    hat.rect(5, 0 + oy, 8, 1, (255, 255, 255))
    body.rect(8, 1 + oy, 2, 2, GOLD[4])
    # right arm + pickaxe by swing frame
    handle = [((13, 13), (17, 4)), ((13, 11), (16, 2)), ((13, 13), (17, 17))][arm] if pose == 'swing' else ((13, 14), (16, 7))
    (hx0, hy0), (hx1, hy1) = handle
    hy0 += oy
    hy1 += oy if pose != 'swing' else 0
    body.rect(13, 11 + oy, 2, 4, SHIRT[0])
    body.line(hx0, hy0, hx1, hy1, WOOD[2])
    body.set(hx0, hy0, SKIN[1])
    # pick head perpendicular to the handle end
    dx, dy = hx1 - hx0, hy1 - hy0
    n = math.hypot(dx, dy) or 1
    px, py = -dy / n, dx / n
    for k in range(-3, 4):
        pick.set(hx1 + px * k, hy1 + py * k, (255, 255, 255))
    # shading layers
    hat_s = Canvas(MNW, MNH, 15)
    for x in range(4, 14):
        hat_s.set(x, 3 + oy, (0, 0, 0, 70))
    hat_s.set(5, 1 + oy, (255, 255, 255, 140))
    hat_s.set(6, 1 + oy, (255, 255, 255, 110))
    for x in range(3, 15):
        hat_s.set(x, 4 + oy, (0, 0, 0, 90))
    fit_s = Canvas(MNW, MNH, 16)
    for y in range(11 + oy, 21):
        if fit.get(12, y)[3]:
            fit_s.set(12, y, (0, 0, 0, 70))
    fit_s.set(6, 12 + oy, (60, 40, 20, 200))  # strap buttons
    fit_s.set(11, 12 + oy, (60, 40, 20, 200))
    fit_s.rect(7, 14 + oy, 4, 2, (0, 0, 0, 50))  # pocket
    pick_s = Canvas(MNW, MNH, 17)
    pick_s.set(hx1 + px * -3, hy1 + py * -3, (255, 255, 255, 160))
    pick_s.set(hx1 + px * 3, hy1 + py * 3, (0, 0, 0, 90))
    # outline the combined silhouette on the body layer
    combo = Canvas(MNW, MNH, 18)
    for layer in (body, fit, hat, pick):
        combo.paste(layer, 0, 0)
    combo.outline()
    ol = Canvas(MNW, MNH, 19)
    for y in range(MNH):
        for x in range(MNW):
            p = combo.get(x, y)
            if p == INK and not any(l.get(x, y)[3] for l in (body, fit, hat, pick)):
                ol.set(x, y, INK)
    body.paste(ol, 0, 0)
    return body, hat, hat_s, fit, fit_s, pick, pick_s


def mole_frames():
    out = []
    for f, h in enumerate((3, 7, 10)):
        cv = Canvas(16, 16, 20)
        cv.ellipse(8, 13, 7, 2.5, (40, 26, 18))
        body = Canvas(16, 16, 21)
        top = 13 - h
        body.ellipse(8, top + 5, 5, 5, None, lambda x, y, d, top=top: (122, 84, 60) if x > 5 else (98, 66, 46))
        body.rect(3, 13, 11, 3, CLEAR)
        body.set(6, top + 4, INK)
        body.set(10, top + 4, INK)
        body.rect(7, top + 6, 3, 2, (255, 150, 170))
        body.set(8, top + 5, (255, 190, 200))
        for x in range(0, 16):
            for y in range(13, 16):
                body.px[x, y] = CLEAR
        body.outline(only_below=13)
        cv.paste(body, 0, 0)
        cv.rect(1, 13, 14, 1, DIRT[1])
        out.append(cv)
    # bonked: squished with stars
    cv = Canvas(16, 16, 22)
    cv.ellipse(8, 13, 7, 2.5, (40, 26, 18))
    cv.ellipse(8, 11, 5, 2.5, (122, 84, 60))
    cv.line(5, 11, 7, 11, INK)
    cv.line(9, 11, 11, 11, INK)
    for sx, sy in ((3, 4), (8, 2), (13, 5)):
        cv.set(sx, sy, GOLD[4])
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv.set(sx + dx, sy + dy, GOLD[3])
    out.append(cv)
    return out


def pet_frames():
    """A round critter (tinted) that bobs; 2 frames of tint + shade."""
    tints, shades = [], []
    for f in range(2):
        t = Canvas(12, 12, 30)
        s = Canvas(12, 12, 31)
        y = 6 + f
        t.ellipse(6, y, 4, 3.5, (255, 255, 255))
        t.set(2, y - 3 - f, (255, 255, 255))  # ears / wings
        t.set(10, y - 3 - f, (255, 255, 255))
        s.ellipse(6, y + 1.5, 3.5, 1.5, (0, 0, 0, 70))
        s.set(4, y - 2, (255, 255, 255, 150))
        s.set(5, y, INK)
        s.set(8, y, INK)
        tints.append(t)
        shades.append(s)
    for t in tints:
        t.outline()
    return tints, shades


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(os.path.join(OUT, f))
    draw_map().save('map.png')
    for i, k in enumerate(KINDS):
        draw_spot(k, 100 + i).save(f'spot-{k}.png')
    for i, cv in enumerate(select_frames()):
        cv.save(f'select-{i}.png')
    for i, cv in enumerate(flag_frames()):
        cv.save(f'flag-{i}.png')
    for i, cv in enumerate(sparkle_frames()):
        cv.save(f'sparkle-{i}.png')
    for i, cv in enumerate(dust_frames()):
        cv.save(f'dust-{i}.png')
    glow().save('glow.png')
    beam().save('beam.png')
    falling_rock().save('rock.png')
    dim().save('dim.png')
    for i, cv in enumerate(mole_frames()):
        cv.save(f'mole-{i}.png')
    tints, shades = pet_frames()
    for i in range(2):
        tints[i].save(f'pet-{i}-tint.png')
        shades[i].save(f'pet-{i}-shade.png')
    poses = {'idle': 2, 'walk': 4, 'swing': 3}
    for pose, n in poses.items():
        for t in range(n):
            body, hat, hat_s, fit, fit_s, pick, pick_s = miner_frame(pose, t)
            body.save(f'miner-{pose}-{t}.png')
            hat.save(f'miner-{pose}-{t}-hat.png')
            hat_s.save(f'miner-{pose}-{t}-hat-shade.png')
            fit.save(f'miner-{pose}-{t}-fit.png')
            fit_s.save(f'miner-{pose}-{t}-fit-shade.png')
            pick.save(f'miner-{pose}-{t}-pick.png')
            pick_s.save(f'miner-{pose}-{t}-pick-shade.png')
    meta = {
        'scale': SCALE,
        'map': [MW, MH],
        'spot': [SW, SH, PAD_Y],
        'grid': [GRID_X, GRID_Y, STEP, GRID_W, GRID_H],
        'miner': [MNW, MNH],
        'kinds': KINDS,
        'layout': LAYOUT,
        'poses': poses,
    }
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    # static requires for the app (React Native bundles images by literal path)
    names = sorted(f[:-4] for f in os.listdir(OUT) if f.endswith('.png'))
    ts = ['// Generated by scripts/pixel-art.py. Do not edit.', 'export const SPRITES = {']
    ts += [f"  '{n}': require('../../assets/pixel/{n}.png')," for n in names]
    ts += ['} as const;', '', 'export type SpriteName = keyof typeof SPRITES;', '']
    ts += ['export const META = ' + json.dumps(meta) + ' as const;', '']
    os.makedirs(os.path.join(ROOT, 'app/src/pixel'), exist_ok=True)
    with open(os.path.join(ROOT, 'app/src/pixel/sprites.ts'), 'w') as f:
        f.write('\n'.join(ts))
    print('wrote', len(os.listdir(OUT)), 'files to', OUT)


if __name__ == '__main__':
    main()

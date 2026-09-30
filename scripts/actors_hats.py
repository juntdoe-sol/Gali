"""Helmets, one full-colour sprite per helmet gear key.

Each hat is drawn around its anchor (0, 0) = the top-centre of the miner's skull
(the per-frame `head` point). Side view facing right, lamp at the front. The
sprite includes a soft brim shadow that falls on the forehead.

build_hats() -> {key: (img, ax, ay, lamp)} where lamp is the lamp's lens centre
relative to the anchor, or None.
"""
import math

from PIL import Image

from actors_kit import INK, hexrgb, mix, outline_img

PAD = 12  # working canvas is centred on the anchor with this much room


class Hat:
    def __init__(self):
        self.S = PAD * 2 + 4
        self.img = Image.new('RGBA', (self.S, self.S), (0, 0, 0, 0))
        self.px = self.img.load()
        self.soft = []  # translucent pixels added after the outline

    def set(self, x, y, col, a=255):
        X, Y = int(x) + PAD, int(y) + PAD
        if 0 <= X < self.S and 0 <= Y < self.S:
            self.px[X, Y] = (*col[:3], a)

    def get(self, x, y):
        X, Y = int(x) + PAD, int(y) + PAD
        if 0 <= X < self.S and 0 <= Y < self.S:
            return self.px[X, Y]
        return (0, 0, 0, 0)

    def span(self, y, x0, x1, col):
        for x in range(x0, x1 + 1):
            self.set(x, y, col)

    def finish(self, outline=True):
        img = outline_img(self.img) if outline else self.img
        px = img.load()
        for (x, y, col) in self.soft:
            X, Y = x + PAD, y + PAD
            if px[X, Y][3] == 0:
                px[X, Y] = col
        bbox = img.getbbox()
        crop = img.crop(bbox)
        return crop, PAD - bbox[0], PAD - bbox[1]


def ramp5(hexcol, dark=(40, 20, 50), light=(255, 252, 235)):
    c = hexrgb(hexcol)
    return [mix(c, dark, 0.55), mix(c, dark, 0.28), c, mix(c, light, 0.45), mix(c, light, 0.8)]


# Dome rows relative to the anchor: (y, x0, x1)
DOME = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 4), (2, -6, 5)]


def shade_dome(h, rows, R, cx=-0.8, cy=0.8, rx=6.2, ry=4.6):
    for (y, x0, x1) in rows:
        for x in range(x0, x1 + 1):
            nx, ny = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            v = -(nx * -0.62 + ny * -0.78)
            k = 0 if v < -0.55 else 1 if v < -0.05 else 2 if v < 0.55 else 3
            h.set(x, y, R[k])


def brim_shadow(h, x0=-5, x1=4, y=4, a=70):
    for x in range(x0, x1 + 1):
        h.soft.append((x, y, (30, 16, 30, a)))


def lamp(h, x, y, lens=(255, 246, 200), house=(150, 108, 52), glow=(255, 255, 255)):
    """Headlamp on the front of the dome; lens faces right. Returns lens centre."""
    for yy in (y - 1, y, y + 1):
        h.set(x, yy, mix(house, (0, 0, 0), 0.25))
        h.set(x + 1, yy, house)
    h.set(x + 1, y - 1, mix(house, (255, 255, 255), 0.35))
    h.set(x + 2, y - 1, lens)
    h.set(x + 2, y, glow)
    h.set(x + 2, y + 1, mix(lens, (180, 120, 40), 0.35))
    return [x + 2, y]


def hardhat(color, lamp_lens, stripe=None, ridge=True, goggles=None):
    h = Hat()
    R = ramp5(color)
    shade_dome(h, DOME, R)
    # ridge along the crown
    if ridge:
        for x in range(-2, 2):
            h.set(x, -3, R[3])
        h.set(-3, -3, R[2])
        h.set(2, -3, R[2])
    # specular streak top-left
    for (x, y) in ((-3, -2), (-4, -1), (-2, -2)):
        h.set(x, y, R[4])
    if stripe is not None:
        S = ramp5(stripe)
        for x in range(-6, 5):
            h.set(x, 1, S[3] if x < -1 else S[2])
        h.set(5, 1, S[1])
    # brim: long at the front, short at the back; top face lit, lip darker
    h.span(3, -7, 7, R[2])
    h.span(3, -7, -5, R[1])
    h.set(6, 2, R[3])
    h.set(7, 2, R[3])
    h.set(7, 3, R[1])
    h.set(6, 3, R[2])
    for x in range(-4, 5):
        h.set(x, 2, R[1] if x > 2 else h.get(x, 2)[:3])
    if goggles is not None:
        # dive goggles pushed up on the helmet: strap round the dome, lens at the side
        Gs = ramp5(goggles, dark=(10, 10, 20))
        for x in range(-6, 5):
            h.set(x, 1, Gs[1] if x > 0 else Gs[2])
        for (x, y, c) in ((-3, 0, (20, 40, 60)), (-2, 0, (120, 230, 255)), (-3, 1, (60, 150, 190)),
                          (-2, 1, (30, 80, 120)), (-4, 0, Gs[0]), (-4, 1, Gs[0]), (-1, 0, Gs[0]), (-1, 1, Gs[0]),
                          (-3, -1, Gs[0]), (-2, -1, Gs[0])):
            h.set(x, y, c)
        h.set(-2, 0, (230, 255, 255))
    brim_shadow(h)
    lp = lamp(h, 3, -1, lens=hexrgb(lamp_lens))
    return h, lp


def songkok(color, gold):
    """Black velvet songkok with a gold band and a little clip-on lamp."""
    h = Hat()
    K = ramp5(color, dark=(0, 0, 0), light=(120, 120, 170))
    G = ramp5(gold)
    rows = [(-3, -5, 4), (-2, -6, 4), (-1, -6, 5), (0, -6, 5), (1, -6, 5), (2, -7, 5), (3, -7, 5)]
    for (y, x0, x1) in rows:
        for x in range(x0, x1 + 1):
            k = 2
            if y == -3:
                k = 3 if x < 0 else 2
            if x == x1:
                k = 1
            if x == x0:
                k = 3 if y < 0 else 2
            h.set(x, y, K[k])
    # velvet sheen: a soft vertical band on the lit side
    for y in (-2, -1, 0):
        h.set(-4, y, K[3])
    h.set(-3, -2, K[4])
    # gold band round the base with a diamond motif
    for x in range(-7, 6):
        h.set(x, 2, G[2] if x % 3 else G[3])
        h.set(x, 3, G[1] if x % 3 else G[2])
    h.set(5, 2, G[1])
    h.set(5, 3, G[0])
    for x in range(-5, 5, 3):
        h.set(x, 0, G[3])
    # the flat top reads as a thin lighter line
    h.span(-4, -4, 3, K[3])
    brim_shadow(h, y=4, a=60)
    lp = lamp(h, 5, 0, lens=(255, 240, 180), house=G[1])
    return h, lp


def crown(color, gem):
    h = Hat()
    G = ramp5(color)
    M = ramp5(gem)
    # band
    for y in (1, 2, 3):
        for x in range(-6, 6):
            k = 2 if y != 3 else 1
            if x == -6:
                k = 3
            if x == 5:
                k = 1
            h.set(x, y, G[k])
    for x in range(-6, 6):
        h.set(x, 1, G[3] if x < 3 else G[2])
    # points
    for (px, top) in ((-5, -3), (-2, -4), (1, -4), (4, -3)):
        for y in range(top, 1):
            h.set(px, y, G[3] if px < 0 else G[2])
            h.set(px + 1, y, G[2] if px < 0 else G[1])
        h.set(px, top - 1, G[4])  # ball tip
        h.set(px + 1, top - 1, G[3])
    # velvet cap between the points
    for y in (-1, 0):
        for x in range(-5, 6):
            if h.get(x, y)[3] == 0:
                h.set(x, y, M[1] if x > 1 else M[2])
    # jewels on the band
    for x in (-4, -1):
        h.set(x, 2, (120, 220, 255))
    # the gem lamp at the front
    h.set(4, 2, M[3])
    h.set(5, 2, M[4])
    h.set(5, 1, M[3])
    h.set(6, 2, (255, 255, 255))
    h.set(6, 1, M[3])
    h.set(6, 3, M[1])
    brim_shadow(h, y=4, a=55)
    return h, [6, 2]


def astro(color, glow):
    """Deep-core glass bubble over the whole head, metal collar, lamp on the rim."""
    h = Hat()
    C = ramp5(color, dark=(40, 50, 90))
    Gl = hexrgb(glow)
    cx, cy, r = -0.5, 3.6, 7.7
    ins = set()
    for y in range(-6, 12):
        for x in range(-10, 10):
            if math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.04) <= r and y <= 10:
                ins.add((x, y))
    for (x, y) in ins:
        edge = any((x + dx, y + dy) not in ins for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            lit = (x + 0.5 - cx) + (y + 0.5 - cy) < 0
            h.set(x, y, mix(Gl, (255, 255, 255), 0.55 if lit else 0.1), 235)
        else:
            h.soft.append((x, y, (*mix(Gl, (255, 255, 255), 0.6), 28)))
    # glass reflections: a curved streak top-left and a glint bottom-right
    for (x, y) in ((-6, 1), (-6, 2), (-5, 0), (-5, -1), (-4, -2), (-6, 3)):
        h.set(x, y, (255, 255, 255), 225)
    h.set(-3, -2, (255, 255, 255), 150)
    h.set(4, 7, (255, 255, 255), 150)
    h.set(5, 6, (255, 255, 255), 110)
    # collar ring
    for x in range(-6, 6):
        h.set(x, 11, C[3] if x < -2 else C[2] if x < 3 else C[1])
        h.set(x, 12, C[1] if x < 3 else C[0])
    h.set(-3, 11, (255, 255, 255))
    for x in (-4, 0):
        h.set(x, 12, mix(Gl, (255, 255, 255), 0.2))
    # rim lamp at the front, a little above the eyes
    for (x, y, col) in ((7, 0, C[1]), (7, 1, C[1]), (8, 0, Gl), (8, 1, mix(Gl, (255, 255, 255), 0.7)),
                        (7, -1, C[2])):
        h.set(x, y, col)
    return h, [8, 1]


HATS = {
    'hat-yellow': lambda: hardhat('#ffc83d', '#fff6c9'),
    'hat-red': lambda: hardhat('#ff5a4f', '#fff0c0', stripe='#f4f1ea'),
    'hat-teal': lambda: hardhat('#3de0c8', '#e8fffb', goggles='#35405a'),
    'hat-songkok': lambda: songkok('#1d1b2e', '#ffd84d'),
    'hat-crown': lambda: crown('#ffd84d', '#ff4fd8'),
    'hat-astro': lambda: astro('#dfe7ff', '#7ad7ff'),
}


def build_hats():
    out = {}
    for key, fn in HATS.items():
        h, lp = fn()
        img, ax, ay = h.finish()
        out[key] = (img, ax, ay, lp)
    return out

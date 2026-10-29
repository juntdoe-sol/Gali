"""Legendary warrior helmets for the Gali closed-beta reward.

Same conventions as scripts/actors_hats.py: anchor (0, 0) is the top-centre of
the skull, side view facing right (+x is the front), light from the top left.
Head reference (anchor coords): hair/back of skull x -5..-3, face x -2..5 from
y 4, eye at x 2..3, y 6..7. A helmet may wrap the back and cheek but must keep
the eye clear.
"""
from PIL import Image

WHITE = (255, 255, 255)
INK = (42, 28, 20)
PAD = 12


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def outline_img(img, col=INK):
    out = img.copy()
    src, dst = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            if src[x, y][3] > 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < img.width and 0 <= ny < img.height and src[nx, ny][3] > 160:
                    dst[x, y] = (*col, 255)
                    break
    return out


class Hat:
    def __init__(self):
        self.S = PAD * 2 + 4
        self.img = Image.new('RGBA', (self.S, self.S), (0, 0, 0, 0))
        self.px = self.img.load()
        self.soft = []

    def set(self, x, y, col, a=255):
        X, Y = int(x) + PAD, int(y) + PAD
        if 0 <= X < self.S and 0 <= Y < self.S:
            self.px[X, Y] = (*col[:3], a)

    def get(self, x, y):
        X, Y = int(x) + PAD, int(y) + PAD
        if 0 <= X < self.S and 0 <= Y < self.S:
            return self.px[X, Y]
        return (0, 0, 0, 0)

    def finish(self):
        img = outline_img(self.img)
        px = img.load()
        for (x, y, col) in self.soft:
            X, Y = x + PAD, y + PAD
            if px[X, Y][3] == 0:
                px[X, Y] = col
        bbox = img.getbbox()
        return img.crop(bbox), PAD - bbox[0], PAD - bbox[1]


def ramp5(hexcol, dark=(40, 20, 50), light=(255, 252, 235)):
    c = hexrgb(hexcol)
    return [mix(c, dark, 0.55), mix(c, dark, 0.28), c, mix(c, light, 0.45), mix(c, light, 0.8)]


def brim_shadow(h, x0=-5, x1=4, y=4, a=70):
    for x in range(x0, x1 + 1):
        h.soft.append((x, y, (30, 16, 30, a)))


def fill_rows(h, rows, R, cx=-0.8, cy=0.8, rx=6.2, ry=4.6):
    """Dome-shaded fill: rows = [(y, x0, x1)], R = 5-step ramp."""
    for (y, x0, x1) in rows:
        for x in range(x0, x1 + 1):
            nx, ny = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            v = -(nx * -0.62 + ny * -0.78)
            k = 0 if v < -0.6 else 1 if v < -0.1 else 2 if v < 0.5 else 3
            h.set(x, y, R[k])


def gem(h, x, y, col):
    """2x2 cut gem with a white glint; returns its centre for the night light."""
    G = ramp5(col, dark=(20, 10, 40))
    h.set(x, y, G[3])
    h.set(x + 1, y, WHITE)
    h.set(x, y + 1, G[1])
    h.set(x + 1, y + 1, G[2])
    return [x + 1, y]


# ---------------------------------------------------------------- A: Gladiator
def gladiator(metal='#f2b632', crest='#d8263a', gemc='#59f0ff'):
    """Gold war helm with a tall crimson horsehair crest, cheek guard and neck plate."""
    h = Hat()
    G = ramp5(metal)
    C = ramp5(crest, dark=(40, 0, 20))
    dome = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 5), (1, -6, 5), (2, -6, 5), (3, -6, 5)]
    fill_rows(h, dome, G)
    # neck plate flaring out at the back
    for (y, x0, x1) in ((4, -6, -3), (5, -6, -3), (6, -7, -4), (7, -7, -5)):
        for x in range(x0, x1 + 1):
            h.set(x, y, G[2] if x == x0 else G[1])
    # cheek guard hanging in front of the ear, stops short of the eye
    for (y, x0, x1) in ((4, -1, 1), (5, -1, 1), (6, -1, 0), (7, -1, 0)):
        for x in range(x0, x1 + 1):
            h.set(x, y, G[3] if x == x0 else G[2])
    h.set(0, 5, G[4])
    # brow ridge with a forward peak
    for x in range(-2, 7):
        h.set(x, 3, G[1] if x > 3 else G[2])
    h.set(6, 2, G[2])
    h.set(7, 3, G[1])
    # engraved band
    for x in range(-6, 6):
        h.set(x, 1, G[3] if x % 2 else G[1])
    # specular streak
    for (x, y) in ((-3, -2), (-4, -1), (-2, -2), (-5, 0)):
        h.set(x, y, G[4])
    # crest: a tall fan of horsehair from front to back, sweeping into a tail
    crest = [(-4, -5, 3), (-5, -6, 3), (-6, -7, 2), (-7, -7, 1), (-8, -6, -1),
             (-3, -6, 4)]
    for (y, x0, x1) in crest:
        for x in range(x0, x1 + 1):
            k = 2 if y <= -6 and x < 0 else 1 if x < 2 else 0
            if y == -7 and x < 0:
                k = 3
            h.set(x, y, C[k])
    # tail of the crest down the back
    for (x, y) in ((-7, -2), (-8, -1), (-8, 0), (-8, 1), (-9, 2), (-8, 2), (-7, -1), (-7, 0)):
        h.set(x, y, C[1] if y > 0 else C[2])
    # strands
    for (x, y) in ((-4, -6), (-1, -7), (2, -5), (-6, -4)):
        h.set(x, y, C[3])
    # crest holder
    for x in range(-2, 3):
        h.set(x, -3, G[3])
    brim_shadow(h, x0=-2, x1=5, y=4, a=60)
    lp = gem(h, 4, 0, gemc)
    return h, lp


# ---------------------------------------------------------------- B: Jarl
def jarl(metal='#c9d2de', trim='#f2b632', horn='#f4ead2', gemc='#59f0ff'):
    """Steel spangenhelm with gold rivets, two great curved horns and a nose guard."""
    h = Hat()
    S = ramp5(metal, dark=(30, 30, 60))
    T = ramp5(trim)
    Hn = ramp5(horn, dark=(90, 60, 40))
    dome = [(-4, -2, 1), (-3, -4, 3), (-2, -5, 4), (-1, -6, 5), (0, -6, 5), (1, -6, 5), (2, -6, 5)]
    fill_rows(h, dome, S)
    # gold spangen: a band around and a strap over the top
    for x in range(-6, 6):
        h.set(x, 2, T[2] if x % 3 else T[3])
        h.set(x, 3, T[1])
    for y in range(-4, 2):
        h.set(-1, y, T[3] if y < -1 else T[2])
    for (x, y) in ((-5, 2), (-2, 2), (1, 2), (4, 2)):
        h.set(x, y, T[4])
    # nose guard down the front
    for y in range(3, 7):
        h.set(5, y, S[2] if y < 6 else S[1])
    h.set(6, 3, S[1])
    # horns: from the side of the dome, sweep back and up / forward and up
    back = [(-6, -1), (-7, -2), (-8, -3), (-9, -4), (-9, -5), (-9, -6), (-8, -7), (-7, -8)]
    front = [(5, -1), (6, -2), (7, -3), (8, -4), (8, -5), (8, -6), (7, -7), (6, -8)]
    for i, (x, y) in enumerate(back):
        k = 3 if i < 5 else 4
        h.set(x, y, Hn[k])
        if i < 6:
            h.set(x + 1, y, Hn[2])
            h.set(x - 1 if i < 3 else x, y + 1, Hn[1])
    for i, (x, y) in enumerate(front):
        k = 2 if i < 5 else 3
        h.set(x, y, Hn[k])
        if i < 6:
            h.set(x - 1, y, Hn[3])
    # gold horn caps at the base
    for (x, y) in ((-6, 0), (-7, -1), (5, 0), (6, -1)):
        h.set(x, y, T[2])
    # specular
    for (x, y) in ((-3, -2), (-4, -1), (-2, -3)):
        h.set(x, y, S[4])
    brim_shadow(h, x0=-5, x1=4, y=4, a=60)
    lp = gem(h, 2, -1, gemc)
    return h, lp


# ---------------------------------------------------------------- C: Shogun
def shogun(lacq='#262040', gold='#f2b632', cord='#d8263a', gemc='#59f0ff'):
    """Black lacquer kabuto, gold crescent crest, flared layered neck guard."""
    h = Hat()
    K = ramp5(lacq, dark=(0, 0, 0), light=(170, 160, 230))
    G = ramp5(gold)
    Rd = ramp5(cord, dark=(40, 0, 20))
    dome = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 5), (2, -6, 5)]
    fill_rows(h, dome, K)
    # ribs on the bowl
    for x in (-4, -1, 2):
        for y in range(-2, 2):
            if h.get(x, y)[3]:
                h.set(x, y, K[3])
    # gold peak (mabizashi) at the front
    for x in range(-1, 8):
        h.set(x, 3, G[2] if x < 6 else G[1])
    h.set(6, 2, G[3])
    h.set(7, 2, G[2])
    # layered neck guard (shikoro), three lames flaring down the back
    lames = [(3, -7, -2), (4, -8, -3), (5, -8, -4), (6, -9, -4), (7, -9, -5)]
    for i, (y, x0, x1) in enumerate(lames):
        for x in range(x0, x1 + 1):
            h.set(x, y, K[2] if x > x0 else K[3])
        if i % 2 == 1:
            for x in range(x0, x1 + 1):
                h.set(x, y, G[1] if x == x0 else K[1])
    # red silk lacing on the lames
    for (x, y) in ((-6, 4), (-5, 6), (-7, 6), (-4, 4)):
        h.set(x, y, Rd[2])
    # fukigaeshi: turned-back wing at the side, gold edged
    for (x, y) in ((-1, 4), (0, 4), (-1, 5), (0, 5), (-1, 6)):
        h.set(x, y, K[2])
    h.set(0, 4, G[3])
    h.set(0, 5, G[2])
    # crescent crest (kuwagata) rising from the front
    crest = [(3, -4), (2, -5), (2, -6), (2, -7), (3, -8), (4, -9),
             (5, -4), (6, -5), (7, -6), (7, -7), (8, -8), (8, -9)]
    for (x, y) in crest:
        h.set(x, y, G[3] if y < -6 else G[2])
    for (x, y) in ((3, -9), (9, -9), (3, -5), (6, -6)):
        h.set(x, y, G[4])
    # crest mount
    for (x, y) in ((3, -3), (4, -3), (5, -3), (4, -4)):
        h.set(x, y, G[1])
    # specular
    for (x, y) in ((-3, -2), (-4, -1)):
        h.set(x, y, K[4])
    brim_shadow(h, x0=-2, x1=6, y=4, a=60)
    lp = gem(h, 3, -1, gemc)
    return h, lp


LEGENDS = {
    'hat-legend-gladiator': gladiator,
    'hat-legend-jarl': jarl,
    'hat-legend-shogun': shogun,
}


def build():
    out = {}
    for k, fn in LEGENDS.items():
        h, lp = fn()
        img, ax, ay = h.finish()
        out[k] = (img, ax, ay, lp)
    return out

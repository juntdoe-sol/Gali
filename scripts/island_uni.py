"""The University of ORE: a campus on new land in the north-east sea of the wider map.

island_ext.py calls in here. The campus is an oval of land joined to the north
beach and the helipad's peninsula: a sandy rim, a mown lawn, stone paths in a
cross with a round plaza and a pickaxe statue, the University itself at the head
of the main path, a library and an observatory either side, trees, hedges,
benches, lamps and a gate where the path meets the beach.

Hardhat Chad stands at the foot of the steps, smoking. Tapping him (or the
University's door) opens the lessons panel in the app; the engine reads where
he is from meta['uni'].

All coordinates here are in the wider map's pixels (720x420).
"""
import math

import numpy as np

import island_props as IP
from island_props import Spr, rgb

# the campus oval
CX, CY, RX, RY = 600, 122, 94, 66
# the University's foot (centre of the bottom step), the plaza, Chad
UNI = (600, 100)
PLAZA = (600, 141, 15)
CHAD = (617, 112)
LIB = (546, 108)
OBS = (655, 108)
GATE = (600, 186)

STONE = ['#3e3a44', '#6a6470', '#9a94a0', '#c8c2cc', '#ece6ee']
COP = ['#1e4a4a', '#2e7470', '#46a69a', '#7cd8c4']
GLOW = ['#a84a10', '#ff8a2a', '#ffc04a', '#fff2b0']
WIN = ['#3a2a1a', '#ffb45a', '#ffe0a0']
SK = ['#8a5a3a', '#c08a62', '#e0ac80']
BE = ['#4a3020', '#6e4a30', '#8e6440']
HAT = ['#a07a10', '#e8b820', '#ffd84a', '#fff2a0']
SH = ['#1e3a6a', '#2e5aa0', '#4a7ac8']


# ---------------------------------------------------------------- sprites
def university():
    w, h = 56, 50
    s = Spr(w, h)
    s.shadow(28, 49, 27, 1.5)
    for i, y in enumerate(range(44, 49)):
        x0, x1 = 10 - i * 2, 45 + i * 2
        s.hline(x0, x1, y, STONE[3] if i % 2 == 0 else STONE[2])
        s.set(x0, y, STONE[1])
        s.set(x1, y, STONE[1])
    for side in (0, 1):
        bx = 2 if side == 0 else 42
        s.rect(bx, 24, 12, 20, STONE[2])
        s.vline(bx, 24, 43, STONE[1])
        s.vline(bx + 11, 24, 43, STONE[1])
        for wy in (28, 35):
            for wx in (bx + 3, bx + 7):
                s.rect(wx, wy, 2, 4, WIN[1])
                s.set(wx, wy, WIN[2])
        s.hline(bx - 1, bx + 12, 23, STONE[4])
        s.hline(bx - 1, bx + 12, 24, STONE[1])
        tx = bx + 3
        s.rect(tx, 12, 6, 11, STONE[3])
        s.vline(tx, 12, 22, STONE[1])
        s.rect(tx + 2, 15, 2, 3, WIN[1])
        for k in range(6):
            s.hline(tx + k // 2, tx + 5 - k // 2, 11 - k, COP[2] if k % 2 else COP[1])
        s.set(tx + 2, 4, GLOW[2])
        s.set(tx + 3, 4, GLOW[1])
    s.rect(14, 26, 28, 18, STONE[1])
    for cx in range(15, 42, 5):
        s.rect(cx, 27, 2, 16, STONE[4])
        s.vline(cx + 1, 27, 42, STONE[3])
        s.hline(cx - 1, cx + 2, 26, STONE[3])
        s.hline(cx - 1, cx + 2, 43, STONE[3])
    for gx in range(17, 40, 5):
        s.rect(gx, 30, 3, 6, WIN[1])
        s.hline(gx, gx + 2, 30, WIN[2])
    s.rect(26, 35, 4, 8, '#4a2e1a')
    s.rect(27, 36, 2, 7, '#6a4426')
    s.set(28, 39, GLOW[2])
    s.hline(12, 43, 25, STONE[4])
    s.hline(12, 43, 24, STONE[2])
    for k in range(7):
        s.hline(13 + k * 2, 42 - k * 2, 23 - k, STONE[3] if k < 6 else STONE[4])
    s.hline(13, 42, 23, STONE[4])
    for dx, dy, c in ((0, -1, GLOW[2]), (-1, 0, GLOW[1]), (1, 0, GLOW[1]), (0, 0, GLOW[3]), (0, 1, GLOW[0])):
        s.set(27 + dx, 20 + dy, c)
        s.set(28 + dx, 20 + dy, c)
    s.rect(21, 10, 14, 7, STONE[3])
    s.vline(21, 10, 16, STONE[1])
    s.vline(34, 10, 16, STONE[1])
    s.ellipse(28, 13.5, 2.6, 2.6, '#f4eed8')
    for x, y in ((28, 12), (28, 13), (29, 13)):
        s.set(x, y, '#222222')
    s.rect(23, 12, 2, 3, WIN[1])
    s.rect(31, 12, 2, 3, WIN[1])
    for y in range(3, 10):
        r = math.sqrt(max(0, 49 - (10 - y) ** 2))
        x0, x1 = round(28 - r), round(27 + r)
        for x in range(x0, x1 + 1):
            t = (x - x0) / max(1, x1 - x0)
            c = COP[3] if t < 0.25 else COP[2] if t < 0.55 else COP[1]
            if (x + y) % 5 == 0 and t > 0.3:
                c = COP[0]
            s.set(x, y, c)
    s.hline(20, 35, 10, STONE[4])
    for y, (a, b) in zip(range(0, 7), ((28, 28), (27, 28), (27, 29), (26, 29), (27, 29), (27, 28), (28, 28))):
        for x in range(a, b + 1):
            s.set(x, y, GLOW[3] if x == a else GLOW[2] if x < b else GLOW[1])
    s.outline(rgb('#1c1820'))
    return [s], 28, 49


def library():
    w, h = 30, 27
    s = Spr(w, h)
    s.shadow(15, 26, 14, 1.2)
    brick = ['#5e2a1c', '#8a3e28', '#a8523a', '#c06a4a']
    for y in range(12, 26):
        for x in range(2, 28):
            c = brick[1] if (y + (x // 4 + (y // 2) % 2 * 2)) % 6 else brick[0]
            if x < 4:
                c = brick[2]
            s.set(x, y, c)
    for k in range(9):          # slate roof
        s.hline(1 + k, 28 - k, 12 - k, '#3a414d' if k % 2 else '#4a5260')
    s.hline(0, 29, 12, '#2a2f3a')
    s.hline(10, 19, 4, '#5c6676')
    for wx in (5, 20):          # tall windows with shelves of books inside
        s.rect(wx, 15, 5, 7, '#2a1a14')
        for by, cols in ((16, ('#c0392b', '#2e5aa0', '#e8b820', '#46a69a')), (19, ('#46a69a', '#c06a4a', '#2e5aa0', '#ffd84a'))):
            for i, c in enumerate(cols):
                s.vline(wx + i + (i > 1), by, by + 1, c)
        s.rect(wx, 15, 5, 7, (255, 190, 100, 70))
        s.hline(wx - 1, wx + 5, 22, STONE[3])
    s.rect(13, 17, 4, 9, '#4a2e1a')           # door
    s.rect(14, 18, 2, 8, '#6a4426')
    s.hline(12, 17, 16, STONE[3])
    # an open book over the door
    s.hline(12, 17, 8, '#f4eed8')
    s.hline(12, 17, 9, '#d8d0b8')
    s.set(14, 8, '#8a7a5a')
    s.set(15, 8, '#8a7a5a')
    s.outline(rgb('#1c1418'))
    return [s], 15, 26


def observatory():
    w, h = 26, 31
    s = Spr(w, h)
    s.shadow(13, 30, 12, 1.2)
    for y in range(14, 30):                    # round stone tower
        for x in range(4, 22):
            t = (x - 4) / 17
            s.set(x, y, STONE[3] if t < 0.3 else STONE[2] if t < 0.75 else STONE[1])
        if y % 4 == 0:
            s.hline(5, 20, y, STONE[1])
    s.rect(11, 22, 4, 8, '#3a3048')
    s.rect(12, 23, 2, 7, '#5a4a6e')
    s.rect(7, 17, 2, 3, WIN[1])
    s.rect(17, 17, 2, 3, WIN[1])
    s.hline(3, 22, 14, STONE[4])
    for y in range(4, 14):                     # white dome with a slit
        r = math.sqrt(max(0, 100 - (14 - y) ** 2))
        for x in range(round(13 - r), round(12 + r) + 1):
            t = (x - (13 - r)) / max(1, 2 * r)
            s.set(x, y, '#ffffff' if t < 0.3 else '#dfe4ee' if t < 0.7 else '#aeb6c6')
    s.vline(12, 5, 13, '#2a2f3a')
    s.vline(13, 5, 13, '#2a2f3a')
    s.line(14, 7, 20, 2, '#8a919e')            # the telescope poking out
    s.line(14, 8, 20, 3, '#5c6270')
    s.set(21, 2, '#c8f0ff')
    s.outline(rgb('#1c1820'))
    return [s], 13, 30


def statue():
    s = Spr(12, 16)
    s.shadow(6, 15, 5.5, 1)
    s.rect(2, 11, 8, 4, STONE[2])
    s.hline(1, 10, 11, STONE[3])
    s.hline(1, 10, 14, STONE[1])
    s.line(4, 10, 8, 3, '#8a5a2a')
    s.line(5, 10, 9, 3, '#6a4420')
    for x, y in ((5, 2), (6, 1), (7, 1), (8, 1), (9, 1), (10, 2), (11, 3), (4, 3)):
        s.set(x, y, '#c8ccd4')
    s.set(10, 1, '#ffffff')
    s.set(6, 12, GLOW[2])
    s.outline(rgb('#1c1820'))
    return [s], 6, 15


def gate():
    s = Spr(36, 26)
    s.shadow(4, 25, 3.5, 1)
    s.shadow(31, 25, 3.5, 1)
    for px in (1, 29):
        s.rect(px, 8, 6, 17, STONE[2])
        s.vline(px, 8, 24, STONE[3])
        s.vline(px + 5, 8, 24, STONE[1])
        s.hline(px - 1, px + 6, 7, STONE[4])
        s.hline(px - 1, px + 6, 8, STONE[1])
        s.set(px + 2, 5, GLOW[2])
        s.set(px + 3, 5, GLOW[1])
        s.set(px + 2, 6, GLOW[1])
        s.set(px + 3, 6, GLOW[0])
        s.set(px + 2, 4, GLOW[3])
    for x in range(7, 29):                     # iron arch
        y = 7 - round(math.sin((x - 7) / 21 * math.pi) * 5)
        s.set(x, y, '#2a2f3a')
        s.set(x, y + 1, '#4a5260')
        if x % 3 == 0:
            s.vline(x, y + 2, 8, '#2a2f3a')
    s.hline(7, 28, 8, '#2a2f3a')
    for dx, dy, c in ((0, -1, GLOW[3]), (-1, 0, GLOW[2]), (1, 0, GLOW[1]), (0, 0, GLOW[2]), (0, 1, GLOW[0])):
        s.set(17 + dx, 1 + dy, c)
        s.set(18 + dx, 1 + dy, c)
    s.outline(rgb('#1c1820'))
    return [s], 18, 25


def bench():
    s = Spr(13, 8)
    s.shadow(6.5, 7, 6, 0.8)
    s.hline(1, 11, 2, '#7a5634')
    s.hline(1, 11, 4, '#9a7248')
    s.hline(1, 11, 5, '#7a5634')
    s.vline(2, 5, 7, '#2a2f3a')
    s.vline(10, 5, 7, '#2a2f3a')
    s.vline(2, 1, 4, '#2a2f3a')
    s.vline(10, 1, 4, '#2a2f3a')
    s.outline(rgb('#241a12'))
    return [s], 6, 7


def hedge(w=12):
    s = Spr(w + 2, 8)
    s.shadow(w / 2 + 1, 7, w / 2, 0.8)
    for y in range(1, 7):
        for x in range(1, w + 1):
            c = '#2e6a2c' if y > 4 else '#3f8a36' if (x + y) % 3 else '#55a646'
            if y == 1 and (x % 3 == 0):
                continue
            s.set(x, y, c)
    s.outline(rgb('#14280f'))
    return [s], w // 2 + 1, 7


def lamp_post():
    s = Spr(7, 15)
    s.shadow(3.5, 14, 2.5, 0.8)
    s.vline(3, 4, 14, '#2a2f3a')
    s.hline(2, 4, 14, '#1a1e26')
    s.rect(2, 1, 3, 3, '#ffd27a')
    s.set(3, 1, '#fff2c0')
    s.hline(1, 5, 0, '#2a2f3a')
    s.hline(2, 4, 4, '#2a2f3a')
    s.outline(rgb('#1a1612'))
    return [s], 3, 14


def notice_board():
    s = Spr(14, 13)
    s.shadow(7, 12, 6, 0.8)
    s.vline(2, 6, 12, '#5a3c24')
    s.vline(11, 6, 12, '#5a3c24')
    s.rect(1, 1, 12, 7, '#8a5a32')
    s.rect(2, 2, 10, 5, '#c89a5a')
    for x, y, c in ((3, 3, '#f4eed8'), (4, 3, '#f4eed8'), (3, 4, '#f4eed8'), (7, 2, '#ffd84a'), (8, 3, '#ffd84a'), (9, 4, '#f4eed8'), (10, 4, '#f4eed8'), (6, 5, '#7cd8c4')):
        s.set(x, y, c)
    s.outline(rgb('#241a12'))
    return [s], 7, 12


def chad(frame):
    """Hardhat Chad on the island, smoking: the ember glows on frame 0 and 2, a puff on 1."""
    s = Spr(13, 18)
    s.shadow(5.5, 17, 4, 1)
    s.rect(3, 13, 2, 4, '#3a3a48')
    s.rect(6, 13, 2, 4, '#3a3a48')
    s.set(3, 16, '#2a1a10')
    s.set(4, 16, '#2a1a10')
    s.set(6, 16, '#2a1a10')
    s.set(7, 16, '#2a1a10')
    s.rect(2, 8, 7, 6, SH[1])
    s.vline(8, 8, 13, SH[0])
    s.vline(1, 9, 12, SH[1])
    s.vline(9, 9, 12, SH[0])
    s.set(5, 9, SH[2])
    s.set(1, 13, SK[1])
    s.set(9, 13, SK[1])
    s.rect(3, 3, 5, 4, SK[1])
    s.rect(3, 6, 5, 3, BE[1])
    s.hline(4, 6, 9, BE[0])
    s.set(3, 6, BE[0])
    for x in (3, 4, 6, 7):
        s.set(x, 4, '#f0c020')
    s.set(5, 4, '#2a2410')
    s.hline(3, 7, 0, HAT[2])
    s.hline(2, 8, 1, HAT[2])
    s.hline(1, 9, 2, HAT[1])
    s.set(3, 1, HAT[3])
    # the cigarette, out of the corner of his mouth
    s.hline(8, 9, 6, '#f4f0e6')
    ember = ('#ff8a2a', '#c04a1a', '#ffd060')[frame % 3]
    s.set(10, 6, ember)
    s.outline(rgb('#16120e'))
    if frame == 1:
        s.set(11, 4, (232, 232, 232, 150))
        s.set(12, 3, (232, 232, 232, 100))
    return s


def sprites():
    out = {}

    def add(name, res, ms=0, sway=0):
        frames, ax, ay = res
        out[name] = dict(frames=frames, ax=ax, ay=ay, ms=ms, sway=sway)

    add('university', university())
    add('library', library())
    add('observatory', observatory())
    add('uni-statue', statue())
    add('uni-gate', gate())
    add('bench', bench())
    add('hedge', hedge())
    add('lamp-post', lamp_post())
    add('notice', notice_board())
    add('chad', ([chad(f) for f in range(3)], 5, 17), ms=420)
    return out


# ---------------------------------------------------------------- the land
def mask(xx, yy, noise):
    """The campus oval, with a little wobble so it reads as coast."""
    e = ((xx - CX) / RX) ** 2 + ((yy - CY) / RY) ** 2 + 0.35 * (noise - 0.5)
    # a neck of land under the gate, so the main walk runs on down to the beach and the helipad
    neck = ((xx - 588) / 70) ** 2 + ((yy - 196) / 22) ** 2 + 0.3 * (noise - 0.5)
    return (e < 1) | (neck < 1), e


def keep_clear(xx, yy):
    """Where the beach props (palms, umbrellas) must not go: the lawn and a bit round it."""
    return ((xx - CX) / (RX + 6)) ** 2 + ((yy - CY) / (RY + 6)) ** 2 < 1


LAWN = [rgb(c)[:3] for c in ('#3f7a30', '#4c8a38', '#58983f', '#66a849', '#7cbc58')]
PATH = [rgb(c)[:3] for c in ('#8f8676', '#aaa08e', '#c4baa6', '#d8cfbb')]


def _paths(xx, yy):
    """The stone paths: the main walk, the cross walk, the plaza, the walks to the side buildings."""
    px, py, pr = PLAZA
    main = (np.abs(xx - UNI[0]) <= 6) & (yy >= UNI[1] - 2) & (yy <= GATE[1] + 16)
    cross = (np.abs(yy - py) <= 3) & (np.abs(xx - CX) <= 78)
    plaza = np.hypot(xx - px, (yy - py) * 1.15) <= pr
    lib = (np.abs(xx - LIB[0]) <= 3) & (yy >= LIB[1] - 1) & (yy <= py)
    obs = (np.abs(xx - OBS[0]) <= 3) & (yy >= OBS[1] - 1) & (yy <= py)
    front = (np.abs(yy - (UNI[1] + 1)) <= 3) & (np.abs(xx - UNI[0]) <= 30)
    return main | cross | plaza | lib | obs | front


def paint(out, xx, yy, land, sd, hv, bay):
    """Paint the lawn, the paths and the flower beds over the sand the campus was given."""
    inner = land & (sd > 6)
    # mown stripes, dithered at the edge of each band
    band = ((xx + yy * 0.35) // 9) % 2
    v = 2 + band * 0.9 + (hv - 0.5) * 0.9 + (bay - 0.5) * 0.6
    v = v - np.where(sd <= 9, 1.1, 0)
    idx = np.clip(np.floor(v), 0, 4).astype(int)
    cols = np.array(LAWN)[idx]
    out[inner, :3] = cols[inner].round().astype(np.uint8)
    out[inner, 3] = 255
    path = _paths(xx, yy) & inner
    k = np.clip(np.floor(1.6 + (hv - 0.5) * 1.6 + ((xx // 4 + yy // 3) % 2) * 0.6), 0, 3).astype(int)
    pc = np.array(PATH)[k]
    # path edges a shade darker
    edge = path & ~(np.roll(path, 1, 0) & np.roll(path, -1, 0) & np.roll(path, 1, 1) & np.roll(path, -1, 1))
    pc[edge] = PATH[0]
    out[path, :3] = pc[path].round().astype(np.uint8)
    # flower beds in a ring round the plaza, broken where the paths cross
    px, py, pr = PLAZA
    ring = (np.abs(np.hypot(xx - px, (yy - py) * 1.15) - (pr + 3)) <= 1.6) & inner & ~path
    bloom = ring & (hv > 0.55)
    palette = np.array([rgb(c)[:3] for c in ('#ff5fa2', '#ffd84a', '#ffffff', '#ff8a2a')])
    pick = (hv * 97).astype(int) % 4
    out[ring, :3] = np.array(rgb('#2e5a24')[:3], np.uint8)
    out[bloom, :3] = palette[pick][bloom].astype(np.uint8)
    return path


def place(add, light, smoke, sprites):
    """Everything that stands on the campus. `add(name, x, y)` places a prop."""
    add('university', *UNI)
    add('library', *LIB)
    add('observatory', *OBS)
    add('uni-statue', PLAZA[0], PLAZA[1] + 2)
    add('uni-gate', *GATE)
    add('chad', *CHAD)
    add('notice', CHAD[0] + 13, CHAD[1] - 2)
    for dx in (-22, 22):
        add('bench', PLAZA[0] + dx, PLAZA[1] + 12)
    # lamp posts along the main walk and the cross walk
    for x, y in ((591, 120), (609, 120), (591, 168), (609, 168), (562, 136), (638, 136), (530, 136), (670, 136)):
        add('lamp-post', x, y)
        light(x, y - 12, 22, '#ffd98a', 0.15)
    # hedges framing the front lawn
    for x, y in ((572, 124), (628, 124), (572, 160), (628, 160)):
        add('hedge', x, y)
    # trees: an avenue of oaks down the cross walk and a few pines at the back
    for i, (x, y) in enumerate(((538, 128), (556, 152), (520, 150), (644, 152), (662, 128), (680, 150),
                                (540, 168), (660, 168), (575, 178), (625, 178))):
        add('oak-' + 'abc'[i % 3], x, y)
    for i, (x, y) in enumerate(((524, 96), (528, 112), (676, 96), (672, 114), (566, 78), (634, 78))):
        add('pine-' + 'abc'[i % 3], x, y)
    for i, (x, y) in enumerate(((548, 160), (652, 160), (585, 154), (615, 154), (530, 160), (668, 160))):
        add('flower-' + 'abc'[i % 3], x, y)
    # what glows at night: the hall's windows and its crystal, the side buildings, the gate
    light(UNI[0], UNI[1] - 16, 46, '#ffc98a', 0.08)
    light(UNI[0], UNI[1] - 46, 30, '#ffb040', 0.3)
    light(LIB[0], LIB[1] - 8, 20, '#ffc98a', 0.1)
    light(OBS[0], OBS[1] - 12, 18, '#c8f0ff', 0.1)
    light(GATE[0], GATE[1] - 22, 16, '#ffb040', 0.3)
    light(CHAD[0] + 5, CHAD[1] - 11, 5, '#ff8a2a', 0.7)


def meta():
    return {
        'chad': [CHAD[0], CHAD[1]],
        'cig': [CHAD[0] + 5, CHAD[1] - 11],
        'door': [UNI[0], UNI[1] - 4],
        'label': ['UNIVERSITY OF ORE', CX, CY - 72],
    }


def portrait():
    """Hardhat Chad's portrait for the lessons panel (32x36 at 1x), cigarette and all."""
    s = Spr(36, 36)
    for y in range(26, 36):
        x0, x1 = max(2, 9 - (y - 26)), min(29, 22 + (y - 26))
        for x in range(x0, x1 + 1):
            s.set(x, y, SH[1] if x < x1 - 3 else SH[0])
    s.line(13, 26, 16, 32, SH[2])
    s.line(18, 26, 16, 32, SH[0])
    for y in (30, 33):
        s.set(16, y, '#d8d8e0')
    s.rect(21, 29, 4, 3, SH[0])
    s.set(22, 30, '#ffd84a')
    s.ellipse(16, 17, 7.5, 8, SK[1])
    s.rect(7, 16, 2, 3, SK[0])
    s.rect(23, 16, 2, 3, SK[0])
    for y in range(18, 29):
        half = 7.8 - max(0, (y - 24)) * 1.3
        for x in range(round(16 - half), round(16 + half) + 1):
            c = BE[1] if (x + y) % 4 else BE[2]
            if x < 16 - half + 1.5 or y > 26:
                c = BE[0]
            s.set(x, y, c)
    s.rect(12, 21, 9, 1, BE[0])
    s.hline(14, 18, 23, '#5a2a20')
    s.rect(15, 18, 2, 2, SK[2])
    s.set(16, 20, SK[0])
    for cx in (12.5, 19.5):
        s.ellipse(cx, 16, 2.7, 2.4, '#2a2410')
        s.ellipse(cx, 16, 2.0, 1.7, '#f0c020')
        s.set(int(cx) - 1, 15, '#fff6c0')
    s.hline(14, 17, 15, '#2a2410')
    for y in range(4, 12):
        r = math.sqrt(max(0, 64 - (12 - y) ** 2 * 1.1))
        for x in range(round(16 - r), round(16 + r) + 1):
            t = (x - (16 - r)) / max(1, 2 * r)
            s.set(x, y, HAT[3] if t < 0.18 else HAT[2] if t < 0.6 else HAT[1])
    s.rect(15, 4, 3, 8, HAT[3])
    s.vline(18, 4, 11, HAT[1])
    s.hline(4, 28, 12, HAT[1])
    s.hline(5, 27, 11, HAT[2])
    s.hline(4, 28, 13, HAT[0])
    s.set(22, 8, GLOW[1])
    s.set(23, 8, GLOW[2])
    s.set(22, 9, GLOW[2])
    # the cigarette, hanging off the right corner of his mouth
    s.hline(19, 25, 23, '#f4f0e6')
    s.hline(19, 25, 24, '#d8d2c4')
    s.hline(19, 20, 23, '#d89a5a')
    s.set(26, 23, '#ff8a2a')
    s.set(26, 24, '#c04a1a')
    s.set(27, 23, '#ffd060')
    s.outline(rgb('#16120e'))
    for x, y, a in ((28, 21, 170), (29, 20, 150), (29, 19, 130), (30, 18, 120), (31, 17, 100), (31, 16, 90), (32, 15, 70), (31, 14, 60)):
        s.set(x, y, (236, 235, 230, a))
    return s


if __name__ == '__main__':
    import os
    from PIL import Image
    here = os.path.dirname(os.path.abspath(__file__))
    p = portrait().img()
    p.resize((p.width * 6, p.height * 6), Image.NEAREST).save(os.path.join(here, '..', 'app', 'assets', 'ui', 'chad.png'), optimize=True)
    print('app/assets/ui/chad.png')

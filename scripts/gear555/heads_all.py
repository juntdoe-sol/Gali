"""Gali Gear 555, HEAD slot: all 93 head items in catalogue order.

Anchor (0,0) = top-centre of the miner's skull, facing right, light top-left.
Head reference: hair x -5..4 rows 0..3, face x -2..5 from y 4, eye x 1..2 y 6..7,
beard y 8..11. Hardhat dome y -3..3.

Reuses the 16 finished sprites in heads.py (durian and gas mask redrawn here),
the game's own atlas sprites for the stock hats and the Jarl helmet.
"""
import json
import math
import sys

from PIL import Image

HERE = __import__('os').path.dirname(__import__('os').path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, HERE)
import legend_hats as L  # noqa: E402
import heads as HD  # noqa: E402  (sets L.PAD = 20)

L.PAD = 20
SLOT = 'head'
Hat, ramp5, mix, hexrgb = L.Hat, L.ramp5, L.mix, L.hexrgb
rows, ell, spark, soft = HD.rows, HD.ell, HD.spark, HD.soft
WHITE = (255, 255, 255)
BLACK = (24, 16, 28)
CREAM = (246, 238, 214)


def R5(c, dark=(40, 20, 50), light=(255, 252, 235)):
    return ramp5(c, dark=dark, light=light)


def px(h, pts, col, a=255):
    for (x, y) in pts:
        h.set(x, y, col, a)


def glint(h, x, y):
    """Rare+ sparkle: a white pixel with a soft cross."""
    h.set(x, y, WHITE)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        soft(h, x + dx, y + dy, (255, 255, 240), 150)


def glow(h, x, y, col, r=2.5, a=90):
    for yy in range(int(y - r - 1), int(y + r + 2)):
        for xx in range(int(x - r - 1), int(x + r + 2)):
            d = math.hypot(xx + 0.5 - x, yy + 0.5 - y)
            if d <= r:
                soft(h, xx, yy, col, int(a * (1 - d / (r + 0.5))))


# ---------------------------------------------------------------- tiny fonts
F3 = {
    'A': ['.x.', 'xxx', 'x.x'], 'F': ['xxx', 'xx.', 'x..'], 'K': ['x.x', 'xx.', 'x.x'],
    'W': ['x.x', 'xxx', 'x.x'], 'G': ['xx.', 'x.x', 'xxx'], 'M': ['xxx', 'xxx', 'x.x'],
    'I': ['x', 'x', 'x'], '0': ['xxx', 'x.x', 'xxx'], ':': ['.', 'x', '.'],
    'E': ['xxx', 'xx.', 'xxx'], 'X': ['x.x', '.x.', 'x.x'], 'T': ['xxx', '.x.', '.x.'],
    'P': ['xxx', 'xxx', 'x..'], 'D': ['xx.', 'x.x', 'xx.'], 'Z': ['xxx', '.x.', 'xxx'],
}
F4 = {
    'G': ['xxx', 'x..', 'x.x', 'xxx'],
    'M': ['x...x', 'xx.xx', 'x.x.x', 'x...x'],
    '0': ['xxx', 'x.x', 'x.x', 'xxx'],
    'Z': ['xxx', '..x', '.x.', 'xxx'],
}


def text(h, s, x, y, col, font=F3, gap=1, col2=None):
    for ch in s:
        g = font[ch]
        for j, r in enumerate(g):
            for i, c in enumerate(r):
                if c == 'x':
                    h.set(x + i, y + j, col2 if (col2 and j == len(g) - 1) else col)
        x += len(g[0]) + gap
    return x


def twidth(s, font=F3, gap=1):
    return sum(len(font[c][0]) for c in s) + gap * (len(s) - 1)


# ---------------------------------------------------------------- families
HH_DOME = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 4), (2, -6, 5)]


def lamp(h, x, y, lens=(255, 246, 200), house=(150, 108, 52), glow_=WHITE):
    for yy in (y - 1, y, y + 1):
        h.set(x, yy, mix(house, (0, 0, 0), 0.25))
        h.set(x + 1, yy, house)
    h.set(x + 1, y - 1, mix(house, WHITE, 0.35))
    h.set(x + 2, y - 1, lens)
    h.set(x + 2, y, glow_)
    h.set(x + 2, y + 1, mix(lens, (180, 120, 40), 0.35))


def hardhat(col, lamp_on=True, ridge=True, dark=(40, 20, 50), spec=True, house=(150, 108, 52)):
    """The game's hardhat shape. Returns (hat, ramp)."""
    h = Hat()
    R = R5(col, dark=dark)
    L.fill_rows(h, HH_DOME, R)
    if ridge:
        for x in range(-2, 2):
            h.set(x, -3, R[3])
    if spec:
        px(h, ((-3, -2), (-4, -1), (-2, -2)), R[4])
    for x in range(-7, 8):
        h.set(x, 3, R[2])
    for x in (-7, -6, -5):
        h.set(x, 3, R[1])
    h.set(6, 2, R[3])
    h.set(7, 2, R[3])
    h.set(7, 3, R[1])
    for x in range(3, 6):
        h.set(x, 2, R[1])
    L.brim_shadow(h)
    if lamp_on:
        lamp(h, 3, -1, house=house)
    return h, R


BEANIE = [(-4, -3, 2), (-3, -5, 3), (-2, -6, 4), (-1, -6, 5), (0, -6, 5), (1, -6, 5)]


def beanie(col, cuff=None, dark=(40, 20, 50), rib=True, light=(255, 252, 235)):
    """Knit beanie: dome plus a ribbed fold-up cuff on rows 2..3."""
    h = Hat()
    R = R5(col, dark=dark, light=light)
    rows(h, BEANIE, R, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    C = R5(cuff, dark=dark, light=light) if cuff else R
    for x in range(-7, 7):
        lit = x < 2
        for y in (2, 3):
            k = (2 if lit else 1) if y == 2 else (1 if lit else 0)
            if rib and x % 2:
                k = max(0, k - 1) if y == 3 else k + 1
            h.set(x, y, C[min(4, k)])
    h.set(-7, 2, C[3])
    if rib:
        for y in (-2, 0):
            for x in range(-5, 5, 2):
                if h.get(x, y)[3]:
                    sh = h.get(x, y)[:3]
                    h.set(x, y, mix(sh, R[0], 0.25))
    px(h, ((-3, -2), (-4, -1)), R[4])
    L.brim_shadow(h, x0=-5, x1=5)
    return h, R, C


CAP = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 5), (2, -6, 5)]


def cap(col, back=False, brim=None, dark=(40, 20, 50), flat=False, light=(255, 252, 235)):
    """Baseball cap: six-panel crown, button, brim forward (or backwards)."""
    h = Hat()
    R = R5(col, dark=dark, light=light)
    B = R5(brim, dark=dark, light=light) if brim else R
    rows(h, CAP, R, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    # panel seam
    for (x, y) in ((0, -2), (1, -1), (1, 0), (2, 1)):
        h.set(x, y, R[1])
    h.set(-1, -4, R[3])
    h.set(0, -4, R[2])
    for x in range(-6, 6):
        h.set(x, 3, R[1] if x < 3 else R[0])
    if not back:
        if flat:
            for x in range(4, 11):
                h.set(x, 2, B[3] if x < 9 else B[2])
                h.set(x, 3, B[0])
        else:
            for x in range(5, 10):
                h.set(x, 2, B[3] if x < 8 else B[2])
            for x in range(5, 11):
                h.set(x, 3, B[1] if x < 9 else B[0])
            h.set(10, 3, B[0])
        L.brim_shadow(h, x0=-3, x1=6)
    else:
        for x in range(-11, -5):
            h.set(x, 2, B[3] if x > -9 else B[2])
            h.set(x, 3, B[1])
        h.set(-11, 2, B[3])
        # snap strap opening at the front
        px(h, ((3, 1), (4, 1), (3, 2)), (110, 74, 50))
        h.set(4, 2, R[0])
        L.brim_shadow(h, x0=-5, x1=4)
    return h, R, B


BUCKET = [(-4, -3, 2), (-3, -5, 3), (-2, -5, 4), (-1, -5, 4), (0, -5, 4), (1, -6, 4)]


def bucket(col, band=None, dark=(40, 20, 50), colour=None):
    """Bucket hat: soft crown, drooping brim all round. colour(x,y,k)->rgb overrides."""
    h = Hat()
    R = R5(col, dark=dark)
    rows(h, BUCKET, R, cx=-0.8, cy=0.0, rx=6.0, ry=4.0)
    for x in range(-8, 8):
        h.set(x, 2, R[3] if x < -2 else R[2] if x < 4 else R[1])
        h.set(x, 3, R[1] if x < 4 else R[0])
    for (x, y) in ((-9, 3), (-9, 4), (-8, 4), (8, 3), (8, 4), (7, 4)):
        h.set(x, y, R[1] if x < 0 else R[0])
    if band:
        Bd = R5(band)
        for x in range(-6, 5):
            h.set(x, 1, Bd[2] if x < 2 else Bd[1])
    if colour:
        for y in range(-6, 6):
            for x in range(-10, 10):
                p = h.get(x, y)
                if p[3]:
                    k = min(range(5), key=lambda i: sum(abs(R[i][j] - p[j]) for j in range(3)))
                    c = colour(x, y, k)
                    if c:
                        h.set(x, y, c)
    L.brim_shadow(h, x0=-4, x1=6, y=5, a=55)
    return h, R


def headband(col, top=1, bot=3, dark=(40, 20, 50), x1=5):
    """Band round the forehead from row top to bot."""
    h = Hat()
    R = R5(col, dark=dark)
    for y in range(top, bot + 1):
        for x in range(-6, x1 + 1):
            k = 3 if y == top and x < 2 else 2 if x < 3 else 1
            if y == bot:
                k -= 1
            h.set(x, y, R[k])
    for y in range(top, bot + 1):
        h.set(x1, y, R[0])
        h.set(-6, y, R[2])
    L.brim_shadow(h, x0=-2, x1=4, y=bot + 1, a=45)
    return h, R


BANDANA = [(-1, -3, 2), (0, -5, 3), (1, -6, 4), (2, -6, 5), (3, -6, 5)]


def bandana(col, dark=(40, 20, 50)):
    """Pirate-style bandana over the skull, knot and tails at the back."""
    h = Hat()
    R = R5(col, dark=dark)
    rows(h, BANDANA, R, cx=-0.8, cy=1.5, rx=6.2, ry=3.5)
    for x in range(-6, 6):
        h.set(x, 3, R[1] if x < 3 else R[0])
    # knot and tails
    px(h, ((-7, 1), (-7, 2), (-8, 1), (-8, 2)), R[2])
    h.set(-8, 1, R[3])
    for (x, y, k) in ((-8, 3, 1), (-9, 3, 2), (-9, 4, 1), (-10, 5, 1), (-8, 4, 0), (-9, 5, 0), (-10, 4, 2),
                      (-11, 6, 0)):
        h.set(x, y, R[k])
    # fold creases
    px(h, ((-3, 0), (-2, 1), (1, 1), (2, 2)), R[1])
    L.brim_shadow(h, x0=-3, x1=5)
    return h, R


def visor(col, dark=(40, 20, 50), bill=None):
    """Open-top sun visor: band plus a long bill."""
    h = Hat()
    R = R5(col, dark=dark)
    B = R5(bill, dark=dark) if bill else R
    for x in range(-6, 5):
        h.set(x, 2, R[3] if x < 1 else R[2])
        h.set(x, 3, R[1] if x < 1 else R[1])
    for x in range(4, 11):
        h.set(x, 2, B[3] if x < 8 else B[2])
        h.set(x, 3, B[1] if x < 9 else B[0])
    h.set(11, 3, B[0])
    L.brim_shadow(h, x0=-3, x1=6)
    return h, R, B


HELM = [(-4, -3, 2), (-3, -5, 4), (-2, -6, 5), (-1, -7, 5), (0, -7, 6), (1, -7, 6), (2, -7, 6), (3, -7, 6),
        (4, -7, -2), (5, -7, -3), (6, -6, -3)]


def helmet(col, dark=(40, 20, 50), light=(255, 252, 235)):
    """Full shell helmet: dome, brow at row 3, wraps down the back of the head."""
    h = Hat()
    R = R5(col, dark=dark, light=light)
    rows(h, HELM, R, cx=-1.0, cy=0.5, rx=6.8, ry=5.5)
    for x in range(-2, 7):
        h.set(x, 3, R[1] if x < 5 else R[0])
    h.set(6, 2, R[2])
    px(h, ((-4, -2), (-5, -1), (-3, -3)), R[4])
    L.brim_shadow(h, x0=-2, x1=5)
    return h, R


BOWL = [(-4, -3, 1), (-3, -4, 2), (-2, -5, 3), (-1, -5, 3), (0, -5, 3), (1, -5, 3)]


def bowler(col, band=(40, 30, 30), dark=(30, 10, 10), light=(255, 252, 235)):
    h = Hat()
    R = R5(col, dark=dark, light=light)
    rows(h, BOWL, R, cx=-1.0, cy=-1.0, rx=4.8, ry=4.0)
    for x in range(-5, 4):
        h.set(x, 1, band)
    for x in range(-8, 8):
        h.set(x, 2, R[2] if x < 4 else R[1])
        h.set(x, 3, R[0])
    h.set(-8, 1, R[3])
    h.set(7, 1, R[2])
    h.set(-3, -2, R[4])
    h.set(-3, -3, R[3])
    L.brim_shadow(h, x0=-5, x1=5)
    return h, R


def wide_hat(col, band, dark=(60, 30, 10), crown_h=4, weave=True):
    """Wide-brim straw hat."""
    h = Hat()
    R = R5(col, dark=dark)
    top = -crown_h
    spec = [(top, -3, 2)] + [(y, -4, 3) for y in range(top + 1, 2)]
    rows(h, spec, R, cx=-1.0, cy=-1.0, rx=4.5, ry=4.0)
    B = R5(band, dark=(40, 0, 20))
    for x in range(-4, 4):
        h.set(x, 0, B[2] if x < 1 else B[1])
        h.set(x, 1, B[1] if x < 1 else B[0])
    for x in range(-11, 11):
        h.set(x, 2, R[3] if x < -3 else R[2] if x < 5 else R[1])
        h.set(x, 3, R[1] if abs(x) < 9 else R[0])
    for x in (-12, 11):
        h.set(x, 3, R[1])
    if weave:
        for y in range(top, 4):
            for x in range(-12, 12):
                p = h.get(x, y)
                if p[3] and (x + y) % 3 == 0 and not (0 <= y <= 1 and -4 <= x < 4):
                    h.set(x, y, mix(p[:3], R[0], 0.35))
    L.brim_shadow(h, x0=-6, x1=7, y=4, a=60)
    return h, R


def recolour(h, fn, box=(-20, -20, 24, 24)):
    for y in range(box[1], box[3]):
        for x in range(box[0], box[2]):
            p = h.get(x, y)
            if p[3] == 255:
                c = fn(x, y, p[:3])
                if c:
                    h.set(x, y, c)


# ---------------------------------------------------------------- atlas sprites
_ART = {}


def atlas(key):
    if not _ART:
        _ART['art'] = json.load(open(__import__('os').path.join(__import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..')), 'app/src/engine/art.json')))
        _ART['img'] = Image.open(__import__('os').path.join(__import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..')), 'app/public/pixel/atlas.png')).convert('RGBA')
    art, at = _ART['art'], _ART['img']
    r = art['atlas']['rects'][key]
    a = art['actors']['hats'][key]
    return at.crop((r[0], r[1], r[0] + r[2], r[1] + r[3])), a['ax'], a['ay']


def red_hardhat():
    return atlas('hat-red')


def teal_hardhat():
    return atlas('hat-teal')


def yellow_hardhat():
    return atlas('hat-yellow')


def songkok_lampu():
    return atlas('hat-songkok')


def raja_crown():
    return atlas('hat-crown')


def deep_core_dome():
    return atlas('hat-astro')


def jarl_helmet():
    img, ax, ay, _ = L.build()['hat-legend-jarl']
    return img, ax, ay


# ================================================================ COMMON
def straw_farmer():
    h, R = wide_hat('#d8b060', '#d8283a')
    # a wheat stalk tucked in the band
    W = R5('#f0c850')
    for (x, y, k) in ((-3, 0, 1), (-4, -1, 2), (-5, -2, 2), (-6, -3, 3), (-6, -4, 3), (-7, -4, 2), (-5, -4, 3)):
        h.set(x, y, W[k])
    return h


def charred_beanie():
    h, R, C = beanie('#3a3040', dark=(10, 5, 15), light=(200, 180, 210))
    Em = (255, 140, 40)
    for (x, y) in ((-2, -3), (1, -2), (-4, 0), (3, 0), (-1, 1), (0, -4)):
        h.set(x, y, Em)
    h.set(1, -2, (255, 220, 120))
    # singed ragged cuff edge
    for (x, y) in ((-6, 3), (-3, 3), (0, 3), (4, 3)):
        h.set(x, y, (0, 0, 0, 0)[:3], 0)
    px(h, ((-5, 3), (-1, 3), (3, 3)), (200, 80, 30))
    # smoke wisp
    for (x, y, a) in ((1, -6, 150), (2, -7, 120), (1, -8, 90), (2, -9, 60)):
        h.set(x, y, (170, 165, 175), a)
    return h


def broom_cap():
    h, R, B = cap('#2f6fe0', back=True)
    # broom patch on the side panel
    St = (150, 100, 50)
    for (x, y) in ((-4, -2), (-3, -1), (-2, 0)):
        h.set(x, y, St)
    Y = R5('#ffd84a')
    px(h, ((-1, 0), (-1, 1), (0, 1), (-2, 1)), Y[2])
    h.set(-1, 1, Y[1])
    h.set(0, 1, Y[1])
    return h


def gm_sweatband():
    h, R = headband('#ffd23a', top=1, bot=4)
    # terry loops
    for y in range(1, 5):
        for x in range(-6, 6):
            if (x + y) % 2 == 0 and h.get(x, y)[3]:
                h.set(x, y, mix(h.get(x, y)[:3], R[0], 0.18))
    text(h, 'GM', -4, 1, (238, 104, 24), font=F4)
    return h


def green_candle_cap():
    h, R, B = cap('#33b84a', dark=(10, 40, 20))
    # white wick poking from the button
    px(h, ((-1, -5), (-1, -6), (0, -7)), (244, 240, 230))
    h.set(0, -8, (255, 220, 120))
    soft(h, 0, -9, (255, 200, 80), 120)
    soft(h, 1, -8, (255, 200, 80), 80)
    return h


def hat_dog_beanie():
    h, R, C = beanie('#ff86b8', dark=(90, 20, 50))
    ell(h, -1, -5.5, 2.3, 2.1, R5('#f6ecd4', dark=(110, 90, 70)))
    px(h, ((-2, -7), (-1, -7)), WHITE)
    return h


def jeet_visor():
    h, R, B = visor('#a6e22e', dark=(20, 60, 10))
    # price tag on a string off the bill
    S = (230, 230, 220)
    px(h, ((10, 4), (10, 5)), S)
    T = R5('#f6f2ea', dark=(120, 100, 80))
    for y in range(6, 10):
        for x in range(9, 12):
            h.set(x, y, T[3] if x == 9 else T[2])
    h.set(10, 6, (120, 110, 100))
    px(h, ((10, 8), (11, 8)), (220, 50, 50))
    h.set(9, 8, (220, 50, 50))
    return h


def mint_party_hat():
    h = Hat()
    Gd = R5('#ffc83d')
    Tl = R5('#2fd0c0', dark=(10, 40, 50))
    for y in range(-11, 3):
        t = (y + 11) / 13
        half = 0.5 + t * 5.0
        cx = -0.5 + (2 - y) * 0.08
        for x in range(int(cx - half), int(cx + half) + 1):
            band = ((y + x // 2) // 2) % 2
            R = Gd if band else Tl
            k = 3 if x < cx - half * 0.3 else 2 if x < cx + half * 0.45 else 1
            h.set(x, y, R[k])
    for x in range(-6, 6):
        h.set(x, 3, Tl[0])
    # pom
    P = R5('#ff5ab0')
    px(h, ((0, -13), (1, -13), (0, -12), (1, -12)), P[2])
    h.set(0, -13, P[4])
    # elastic
    for (x, y) in ((4, 4), (5, 5), (5, 6), (5, 7), (5, 8)):
        h.set(x, y, (240, 230, 220), 200)
    L.brim_shadow(h, x0=-5, x1=5)
    return h


def monke_beanie():
    h, R, C = beanie('#7a4a2a', dark=(30, 10, 5))
    T = R5('#e8b880', dark=(90, 50, 20))
    for ex in (-5, 2):
        ell(h, ex + 0.5, -4.5, 2.1, 2.1, R)
        px(h, ((ex, -5), (ex + 1, -5), (ex, -4)), T[2])
        h.set(ex + 1, -4, T[1])
        h.set(ex - 1, -5, R[4])
    return h


def nightcap():
    h = Hat()
    N = R5('#2a3a8a', dark=(5, 5, 30), light=(200, 210, 255))
    rows(h, BEANIE, N, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    # floppy tail drooping back
    tail = [(-5, -4, 1), (-6, -5, 1), (-7, -5, 2), (-8, -4, 2), (-9, -3, 2), (-10, -2, 1), (-10, -1, 1), (-10, 0, 1),
            (-6, -4, 2), (-7, -4, 1), (-8, -3, 1), (-9, -2, 1)]
    for (x, y, k) in tail:
        h.set(x, y, N[k + 1] if y < -3 else N[k])
    for x in range(-7, 7):
        h.set(x, 2, CREAM if x < 2 else (220, 210, 190))
        h.set(x, 3, (220, 210, 190) if x < 2 else (190, 180, 165))
    ell(h, -10.5, 2.0, 1.6, 1.6, R5('#f6f2ea', dark=(120, 110, 140)))
    # moon dot
    Y = (255, 220, 80)
    px(h, ((0, -2), (1, -2), (0, -1)), Y)
    h.set(1, -1, N[2])
    px(h, ((-3, -2), (-4, -1)), N[4])
    L.brim_shadow(h, x0=-5, x1=5)
    return h


def tinfoil_cap():
    h = Hat()
    S = R5('#c8ccd8', dark=(50, 50, 80))
    rows(h, BEANIE[:-1] + [(1, -6, 5), (2, -6, 5), (3, -6, 5)], S, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    # crinkle facets
    for (x, y) in ((-4, -2), (-1, -3), (2, -1), (-5, 1), (0, 0), (3, 2), (-2, 2), (4, 0)):
        h.set(x, y, S[4])
        h.set(x + 1, y, S[1])
    for (x, y) in ((-3, 0), (1, 1), (-1, -1), (3, -2)):
        h.set(x, y, S[0])
    # jagged rim
    px(h, ((-6, 4), (-3, 4), (2, 4)), S[1])
    # bent antenna with a ball
    for (x, y) in ((0, -4), (0, -5), (0, -6), (1, -7), (2, -7), (3, -8)):
        h.set(x, y, S[1] if y > -7 else S[2])
    px(h, ((3, -9), (4, -9), (4, -8)), (255, 90, 90))
    h.set(3, -9, (255, 200, 200))
    L.brim_shadow(h, x0=-5, x1=5, y=4)
    return h


def red_candle_cap():
    h, R, B = cap('#e0303a', dark=(60, 0, 10))
    # wick drooping over the brim
    W = (60, 50, 60)
    for (x, y) in ((-1, -5), (0, -6), (1, -6), (2, -6), (3, -6), (4, -5), (5, -5), (6, -4), (7, -3), (8, -2),
                   (9, -1), (10, 0), (10, 1)):
        h.set(x, y, W)
    h.set(10, 2, (230, 220, 210))
    return h


def flat_cap():
    h = Hat()
    G = R5('#8a8a94', dark=(30, 25, 40))
    spec = [(-2, -4, 1), (-1, -6, 3), (0, -6, 4), (1, -6, 5), (2, -6, 6)]
    rows(h, spec, G, cx=-1.0, cy=0.0, rx=6.0, ry=3.5)
    for x in range(5, 9):
        h.set(x, 2, G[2])
        h.set(x, 3, G[0])
    h.set(-6, 3, G[1])
    for x in range(-6, 5):
        h.set(x, 3, G[0])
    # tweed flecks
    for (x, y) in ((-3, -1), (0, 0), (2, 1), (-5, 1), (-1, 2), (4, 1), (1, -1), (-2, 1)):
        h.set(x, y, (180, 150, 110))
    for (x, y) in ((-4, 0), (3, 2), (-1, -1)):
        h.set(x, y, G[0])
    h.set(-3, -2, G[4])
    L.brim_shadow(h, x0=-3, x1=7)
    return h


def shrimp_bucket():
    h, R = bucket('#ff8aa8', dark=(90, 20, 40))
    # antenna whiskers
    W = (255, 130, 140)
    for (x, y) in ((1, -5), (2, -6), (3, -7), (5, -8), (6, -8), (7, -8), (4, -8), (8, -7), (9, -6)):
        h.set(x, y, W)
    for (x, y) in ((0, -5), (0, -6), (1, -7), (1, -8), (2, -9), (3, -10), (4, -10), (5, -10)):
        h.set(x, y, (240, 110, 130))
    return h


def afk_beanie():
    h, R, C = beanie('#2fbfb0', dark=(10, 40, 50))
    text(h, 'AFK', -5, -1, (250, 250, 250))
    return h


def arena_bandana():
    h, R = bandana('#e0282e', dark=(70, 0, 10))
    for (x, y) in ((-4, 1), (-1, 0), (2, 1), (-2, 2), (4, 3), (0, 2), (-5, 3), (1, -1), (-3, -1), (-9, 4)):
        h.set(x, y, (250, 246, 240))
    return h


def batik_bandana():
    h, R = bandana('#8a4a24', dark=(40, 10, 0))
    Gd = (240, 190, 70)
    # little swirls
    for (cx, cy) in ((-3, 0), (1, 1), (-5, 2), (3, 3)):
        px(h, ((cx, cy), (cx + 1, cy), (cx + 1, cy + 1)), Gd)
        h.set(cx, cy + 1, mix(Gd, R[1], 0.5))
    px(h, ((-1, -2), (0, -2), (-9, 4)), Gd)
    return h


def brain_beanie():
    h, R, C = beanie('#ff8ab8', dark=(110, 20, 60), rib=False)
    D = R[0]
    for (x, y) in ((-4, -2), (-3, -1), (-2, -2), (-1, -3), (0, -2), (1, -1), (2, -2), (3, -1),
                   (-5, 0), (-3, 1), (-2, 0), (0, 0), (1, 1), (3, 1), (4, 0), (-1, 1)):
        h.set(x, y, D if (x + y) % 2 else R[1])
    return h


def blackout_hardhat():
    h, R = hardhat('#33303c', dark=(5, 0, 10), house=(50, 46, 56))
    # lamp lens dark, tiny red standby light
    px(h, ((5, -2), (5, -1), (5, 0)), (40, 38, 46))
    h.set(5, -1, (255, 40, 40))
    soft(h, 6, -1, (255, 40, 40), 110)
    return h


def bubblegum_hardhat():
    h, R = hardhat('#ff7ac0', dark=(100, 20, 60))
    for (x, y) in ((-4, -1), (-1, -2), (-2, 1), (1, 0), (-5, 1), (0, -2), (-3, 2)):
        h.set(x, y, (255, 250, 252))
    # a gum bubble on the brim
    ell(h, 8.5, 0.0, 1.8, 1.8, R5('#ffb0d8', dark=(140, 40, 90)))
    h.set(8, -1, WHITE)
    return h


def coconut_hardhat():
    h = Hat()
    B = R5('#7a4a26', dark=(25, 10, 5))
    rows(h, HH_DOME[:-1] + [(2, -6, 5)], B, cx=-0.8, cy=0.8, rx=6.2, ry=4.6)
    # hairy fibres
    for (x, y) in ((-4, -2), (-2, -3), (0, -2), (2, -1), (-5, 0), (-1, 0), (3, 1), (-3, 1), (1, -3)):
        h.set(x, y, B[3] if x < 0 else B[1])
    # three eye dots at the top
    px(h, ((-1, -1), (1, -1), (0, 0)), B[0])
    # cracked rim with white flesh
    for x in range(-7, 7):
        h.set(x, 3, (246, 240, 226) if x % 3 else B[1])
    for x in (-7, -4, -1, 2, 5):
        h.set(x, 2, (246, 240, 226))
    # rope chin strap down the back of the jaw
    Rp = [(222, 190, 130), (180, 140, 80)]
    for i, (x, y) in enumerate(((-3, 4), (-3, 5), (-2, 6), (-2, 7), (-1, 8), (-1, 9), (0, 10))):
        h.set(x, y, Rp[i % 2])
    L.brim_shadow(h)
    return h


def coin_slot_cap():
    h, R, B = cap('#e0303a', dark=(60, 0, 10))
    Gd = R5('#ffc83d')
    for x in range(-3, 2):
        h.set(x, -4, Gd[3] if x < 0 else Gd[2])
        h.set(x, -3, Gd[1])
    # slot and a coin half in it
    px(h, ((-2, -4), (-1, -4), (0, -4)), (40, 30, 30))
    for (x, y, k) in ((-2, -7, 3), (-1, -7, 3), (0, -7, 2), (-2, -6, 3), (-1, -6, 4), (0, -6, 1), (-2, -5, 2),
                      (-1, -5, 2), (0, -5, 1), (-3, -6, 3), (1, -6, 1), (-3, -5, 2), (1, -5, 1)):
        h.set(x, y, Gd[k])
    h.set(-1, -6, Gd[1])
    return h


def headlamp_strap():
    h = Hat()
    K = R5('#2a2633', dark=(0, 0, 0), light=(160, 150, 190))
    for x in range(-6, 5):
        h.set(x, 2, K[2] if x < 1 else K[1])
        h.set(x, 3, K[1])
    # elastic over the top
    for (x, y) in ((-2, 0), (-1, -1), (0, -1), (1, 0)):
        h.set(x, y, K[1])
    Y = R5('#ffd23a')
    for y in (1, 2, 3, 4):
        h.set(5, y, Y[2] if y < 3 else Y[1])
        h.set(6, y, Y[3] if y < 3 else Y[2])
    h.set(5, 1, Y[3])
    h.set(7, 2, (255, 252, 220))
    h.set(7, 3, (255, 240, 180))
    for i in range(1, 7):
        for dy in (-1, 0, 1, 2):
            if dy in (-1, 2) and i < 2:
                continue
            soft(h, 7 + i, 2 + dy + (i // 3 if dy == 2 else -(i // 3) if dy == -1 else 0), (255, 240, 160), 120 - i * 14)
    return h


def hopium_headband():
    h, R = headband('#5ab8ff', top=1, bot=3, dark=(10, 30, 80))
    for (cx, cy) in ((-5, 2), (-1, 1), (2, 2)):
        px(h, ((cx, cy), (cx + 1, cy), (cx + 1, cy - 1) if cy > 1 else (cx + 1, cy)), WHITE)
        h.set(cx + 2, cy, (230, 240, 255))
    return h


def island_sun_hat():
    h, R = wide_hat('#ffd84a', '#20c0b0', dark=(80, 50, 0), crown_h=3)
    # ribbon tails fluttering behind
    T = R5('#20c0b0', dark=(0, 40, 50))
    for (x, y, k) in ((-5, 1, 2), (-6, 2, 2), (-6, 3, 1), (-7, 4, 2), (-8, 4, 1), (-7, 5, 1)):
        h.set(x, y, T[k])
    return h


def orange_hardhat():
    h, R = hardhat('#ff8a1c')
    for x in range(-6, 5):
        h.set(x, 1, (250, 248, 240) if x < 0 else (214, 214, 220))
    h.set(5, 1, (190, 190, 200))
    return h


def purple_hardhat():
    h, R = hardhat('#8a4ae0', dark=(30, 10, 60))
    a, b = hexrgb('#2fe0c8'), hexrgb('#ff5ab8')
    for x in range(-6, 6):
        h.set(x, 1, mix(a, b, (x + 6) / 11))
    return h


def rug_fringe_beanie():
    h, R, C = beanie('#c42a3a', dark=(50, 0, 20), rib=False)
    Cr = (240, 220, 170)
    for (x, y) in ((-4, -2), (-2, -1), (0, -2), (2, -1), (-3, 0), (1, 0), (-5, 1), (3, 1), (-1, 1)):
        if (x + y) % 2 == 0:
            h.set(x, y, Cr)
        else:
            h.set(x, y, (240, 170, 60))
    for x in range(-7, 7):
        h.set(x, 2, (40, 40, 90))
    # tassel fringe from the cuff (back half only, eye stays clear)
    for x in range(-7, 1, 2):
        h.set(x, 4, Cr)
        h.set(x, 5, (210, 190, 140))
    for x in range(-6, 1, 2):
        h.set(x, 4, (210, 190, 140))
    return h


def zero_bucket():
    h, R = bucket('#8f96a8', dark=(30, 30, 50))
    Z = (40, 36, 52)
    text(h, '0', -1, -3, Z, font=F4)
    h.set(0, -1, R[1])
    # little red minus below on the brim
    return h


def touch_grass_cap():
    h, R, B = cap('#2fa040', dark=(10, 40, 10))
    G = R5('#6ad04a', dark=(10, 50, 10))
    for (x, top) in ((-5, -4), (-4, -5), (-3, -6), (-2, -4), (-1, -7), (0, -5), (1, -6), (2, -4), (3, -3)):
        base = -2 if abs(x) > 2 else -3
        if x == -5:
            base = -1
        for y in range(top, base + 1):
            h.set(x, y, G[3] if y == top else G[2] if (x % 2) else G[1])
    h.set(-1, -8, G[4])
    return h


def validator_cap():
    h, R, B = cap('#8a90a0', dark=(30, 30, 50))
    h.set(2, -1, (60, 255, 120))
    h.set(3, -1, (40, 200, 90))
    h.set(2, 0, (40, 200, 90))
    h.set(3, 0, (20, 150, 60))
    soft(h, 2, -2, (60, 255, 120), 0)
    return h


def wagmi_snapback():
    h = Hat()
    P = R5('#7a3ae0', dark=(30, 0, 60))
    spec = [(-5, -3, 3), (-4, -5, 4), (-3, -6, 5), (-2, -6, 5), (-1, -6, 5), (0, -6, 5), (1, -6, 5), (2, -6, 5)]
    rows(h, spec, P, cx=-1.0, cy=-1.0, rx=6.0, ry=5.0)
    for x in range(-6, 6):
        h.set(x, 3, P[0])
    for x in range(4, 11):
        h.set(x, 2, P[2] if x < 9 else P[1])
        h.set(x, 3, P[0])
    h.set(10, 2, P[1])
    # gold sticker under brim edge
    h.set(9, 3, (240, 200, 60))
    W = (250, 248, 255)
    text(h, 'WAG', -5, -3, W)
    text(h, 'MI', -1, 1, W)
    h.set(-1, -5, P[4])
    h.set(-2, -5, P[3])
    L.brim_shadow(h, x0=-3, x1=7)
    return h


# ================================================================ UNCOMMON
def stopwatch_cap():
    h, R, B = cap('#2a2633', dark=(0, 0, 0), light=(160, 150, 200))
    Wt = R5('#f2f2f6', dark=(90, 90, 120))
    ell(h, 1.5, -0.5, 2.6, 2.6, Wt)
    h.set(1, -4, Wt[2])
    h.set(2, -4, Wt[3])
    px(h, ((1, -5), (2, -5)), (220, 60, 60))
    px(h, ((1, -1), (1, -2), (2, -1)), (30, 26, 36))
    h.set(3, 0, (220, 60, 60))
    for (x, y) in ((1, 2), (-1, 0), (3, -2)):
        h.set(x, y, Wt[1])
    return h


def anon_hood():
    h = Hat()
    K = R5('#2a2633', dark=(5, 0, 10), light=(150, 140, 180))
    spec = [(-4, -3, 2), (-3, -5, 4), (-2, -6, 5), (-1, -7, 6), (0, -7, 6), (1, -7, 6), (2, -7, 7), (3, -7, 7),
            (4, -7, 7), (5, -7, 7), (6, -7, 7), (7, -7, 7), (8, -7, 7), (9, -7, 7), (10, -6, 7), (11, -6, 6),
            (12, -5, 6), (13, -4, 4)]
    rows(h, spec, K, cx=-1.5, cy=2.0, rx=7.0, ry=9.0)
    # face opening in shadow
    S = (14, 10, 20)
    for y in range(3, 12):
        for x in range(-1, 7):
            if h.get(x + 1, y)[3] and x >= 0 + (y > 9) and not (y in (3,) and x < 1):
                h.set(x, y, S)
    # hood rim lit
    for (x, y) in ((-1, 3), (-1, 4), (-1, 5), (-1, 6), (-1, 7), (-1, 8), (0, 2), (1, 2), (2, 2), (3, 2), (4, 2),
                   (5, 3), (6, 3)):
        h.set(x, y, K[3])
    for (x, y) in ((0, 10), (1, 11), (2, 11), (3, 11), (4, 11)):
        h.set(x, y, K[1])
    # two white dot eyes
    px(h, ((2, 6), (5, 6)), WHITE)
    px(h, ((-4, -2), (-5, -1), (-3, -3)), K[4])
    return h


def expired_cap():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (220, 40, 50)
    for x in range(-4, 4):
        h.set(x, -2 + (x + 4) // 4, Rd)
        h.set(x, 2 + (x + 4) // 4 - 1, Rd)
    px(h, ((-4, -1), (-4, 0), (3, 0), (3, 1)), Rd)
    for (x, y) in ((-3, 0), (-1, 1), (0, 0), (2, 1), (1, 1), (-2, 0)):
        h.set(x, y, Rd)
    return h


def curve_headband():
    h, R = headband('#33c060', top=1, bot=3, dark=(10, 40, 20))
    # bonding-curve antenna: flat at the back, steep at the front
    W = R5('#9af06a', dark=(20, 60, 20))
    pts = []
    for i in range(0, 60):
        t = i / 59
        x = -6 + t * 13
        y = 1 - (math.exp(t * 2.6) - 1) / (math.exp(2.6) - 1) * 12 - t * 1.5
        pts.append((int(round(x)), int(round(y))))
    for (x, y) in pts:
        if y < 1:
            h.set(x, y, W[3] if y > -6 else W[2])
    x, y = pts[-1]
    px(h, ((x, y - 1), (x + 1, y - 1), (x, y - 2), (x + 1, y - 2)), (255, 230, 90))
    h.set(x, y - 2, WHITE)
    # post where it meets the band
    h.set(-6, 0, W[1])
    return h


def pickaxe_headguard():
    h = Hat()
    R = R5('#d8303a', dark=(60, 0, 10))
    spec = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 5), (1, -6, 5), (2, -6, 5), (3, -6, 4),
            (4, -6, 0), (5, -6, 0), (6, -5, 0), (7, -5, 0), (8, -4, 0)]
    rows(h, spec, R, cx=-1.0, cy=1.5, rx=6.2, ry=6.0)
    # padded quilting seams
    for (x, y) in ((-2, -1), (-2, 0), (1, -1), (1, 0), (-5, 2), (-4, 2), (-3, 2)):
        h.set(x, y, R[0])
    for x in range(-1, 6):
        h.set(x, 3, R[1])
    # cheek pad edge
    for y in range(4, 9):
        h.set(0, y, R[1])
    h.set(-1, 9, R[0])
    # crossed pickaxe badge
    Wt = (240, 240, 245)
    for (x, y) in ((-4, 4), (-3, 5), (-2, 6), (-2, 4), (-4, 6)):
        h.set(x, y, (200, 150, 90))
    px(h, ((-5, 3), (-4, 3), (-1, 3), (-2, 3)), Wt)
    h.set(-3, 5, (200, 150, 90))
    px(h, ((-4, -3), (-5, -2), (-3, -3)), R[4])
    return h


def badge_visor():
    h, R, B = visor('#f2f0ea', dark=(110, 100, 130))
    Pu = R5('#8a4ae0', dark=(30, 0, 60))
    # lanyard down from the bill, badge dangling
    for (x, y) in ((9, 4), (9, 5), (10, 6)):
        h.set(x, y, Pu[2])
    for y in range(7, 11):
        for x in range(8, 12):
            h.set(x, y, Pu[3] if x == 8 or y == 7 else Pu[2])
    px(h, ((9, 8), (10, 8)), WHITE)
    px(h, ((9, 9), (10, 9)), (230, 220, 255))
    h.set(11, 10, Pu[1])
    return h


def clan_banner_helm():
    h, R = helmet('#9aa2b4', dark=(30, 30, 60))
    # rivets
    for (x, y) in ((-6, 2), (-3, 2), (0, 2), (3, 2)):
        h.set(x, y, R[4])
    # flag pole and blue pennant
    for y in range(-13, -4):
        h.set(-1, y, (190, 150, 90))
    h.set(-1, -14, (255, 220, 90))
    Bl = R5('#3a6aff', dark=(10, 10, 60))
    flag = [(0, -13, 3), (1, -13, 3), (2, -13, 3), (3, -13, 2), (4, -12, 2), (0, -12, 2), (1, -12, 2), (2, -12, 2),
            (3, -12, 2), (0, -11, 2), (1, -11, 1), (2, -11, 1), (3, -11, 1), (4, -11, 1), (0, -10, 1), (1, -10, 1)]
    for (x, y, k) in flag:
        h.set(x, y, Bl[k])
    px(h, ((1, -12), (2, -12)), (255, 255, 255))
    return h


def squished_top_hat():
    h = Hat()
    K = R5('#2a2533', dark=(0, 0, 0), light=(160, 150, 200))
    for x in range(-6, 6):
        h.set(x, 0, K[3] if x < 1 else K[2])
        h.set(x, 1, K[1])
    for x in range(-6, 6):
        h.set(x, 1, (230, 180, 50) if x < 3 else (190, 140, 30))
    for x in range(-9, 9):
        h.set(x, 2, K[2])
        h.set(x, 3, K[1] if x < 7 else K[0])
    px(h, ((-9, 1), (8, 1)), K[2])
    # squish lines
    for (x, y) in ((-9, -2), (-8, -3), (8, -2), (7, -3), (0, -3), (-1, -3)):
        h.set(x, y, (200, 200, 220), 200)
    L.brim_shadow(h, x0=-5, x1=6)
    return h


def diamond_tiara():
    h = Hat()
    S = R5('#d8dce8', dark=(50, 50, 90))
    for x in range(-6, 5):
        h.set(x, 2, S[3] if x < 1 else S[2])
        h.set(x, 1, S[2] if x % 2 else S[3])
    for x in (-5, -3, -1):
        h.set(x, 0, S[3])
    # big diamond at the front
    C = R5('#4ae8ff', dark=(10, 40, 90))
    dia = [(3, -3, 3), (4, -3, 4), (5, -3, 3), (2, -2, 3), (3, -2, 4), (4, -2, 3), (5, -2, 2), (6, -2, 1),
           (2, -1, 2), (3, -1, 3), (4, -1, 2), (5, -1, 1), (6, -1, 1), (3, 0, 2), (4, 0, 1), (5, 0, 0), (4, 1, 0)]
    for (x, y, k) in dia:
        h.set(x, y, C[k])
    h.set(3, -2, WHITE)
    L.brim_shadow(h, x0=-2, x1=4, y=3, a=40)
    return h


def scooter_goggles():
    h = Hat()
    Br = R5('#8a5430', dark=(30, 10, 5))
    spec = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 5), (2, -6, 5), (3, -6, 5), (4, -6, -3),
            (5, -6, -3), (6, -5, -4)]
    rows(h, spec, Br, cx=-1.0, cy=1.0, rx=6.0, ry=5.5)
    for (x, y) in ((-4, -1), (-1, -2), (-5, 2)):
        h.set(x, y, Br[0])
    # strap and two round amber goggles sitting on the brow
    for x in range(-6, 1):
        h.set(x, 1, (60, 40, 30))
    Am = R5('#ffb030', dark=(90, 40, 0))
    Ch = R5('#c8ccd8', dark=(50, 50, 80))
    for gx in (0, 4):
        for (x, y) in ((gx, 0), (gx + 1, 0), (gx + 2, 0), (gx - 0, 1), (gx + 2, 1), (gx, 2), (gx + 1, 2),
                       (gx + 2, 2)):
            h.set(x, y, Ch[2])
        h.set(gx + 1, 1, Am[3])
        h.set(gx, 0, Ch[3])
    h.set(3, 1, Ch[1])
    h.set(5, 1, WHITE)
    h.set(1, 1, Am[2])
    L.brim_shadow(h, x0=-2, x1=6, y=3, a=45)
    return h


def nugget_ear_hardhat():
    h = Hat()
    Y = R5('#ffc83d')
    Br = R5('#7a4a2a', dark=(30, 10, 5))
    for ex in (-5, 1):
        ell(h, ex + 1, -3.5, 1.8, 1.9, Br)
        h.set(ex + 1, -3, (230, 160, 150))
    rows(h, [(-2, -3, 2), (-1, -5, 3), (0, -5, 3), (1, -5, 4)], Y, cx=-0.8, cy=1.0, rx=5.5, ry=4.0)
    for x in range(-6, 7):
        h.set(x, 2, Y[2] if x < 4 else Y[1])
        h.set(x, 3, Y[1] if x > -5 else Y[0])
    px(h, ((-3, -1), (-4, 0)), Y[4])
    lamp(h, 3, 0)
    L.brim_shadow(h)
    return h


def ore_mark_hardhat():
    h, R = hardhat('#ffc83d', lamp_on=False)
    K = (36, 30, 40)
    # a chunky generic mined-rock mark on the front
    for (x, y) in ((1, -2), (2, -2), (0, -1), (1, -1), (2, -1), (3, -1), (0, 0), (3, 0), (0, 1), (1, 1), (2, 1),
                   (3, 1), (2, 0)):
        h.set(x, y, K)
    h.set(1, 0, R[2])
    # scuffs
    for (x, y) in ((-4, 0), (-2, -2), (-5, 2), (5, 2), (-1, 1)):
        h.set(x, y, R[0])
    h.set(-3, 0, (240, 230, 210))
    return h


def welding_cap():
    h = Hat()
    G = R5('#80889a', dark=(30, 30, 50))
    spec = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 5), (2, -6, 5)]
    rows(h, spec, G, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    for x in range(5, 8):
        h.set(x, 2, G[1])
    for x in range(-6, 8):
        h.set(x, 3, G[0])
    # flip-up dark lens on the front, hinged up
    D = R5('#304050', dark=(5, 10, 20), light=(160, 220, 255))
    for y in range(-5, -1):
        for x in range(3, 7):
            h.set(x, y, D[2] if x < 6 else D[1])
    px(h, ((3, -5), (4, -5), (5, -5), (6, -5)), (60, 60, 70))
    h.set(4, -4, D[4])
    h.set(4, -3, D[3])
    px(h, ((3, -1), (4, -1)), (60, 60, 70))
    # orange spark patch
    O = (255, 130, 30)
    px(h, ((-3, 0), (-2, -1), (-2, 1), (-1, 0), (-2, 0)), O)
    h.set(-2, 0, (255, 230, 120))
    L.brim_shadow(h, x0=-3, x1=6)
    return h


def fast_lane_visor():
    h, R, B = visor('#2a2633', dark=(0, 0, 0), bill='#2a2633')
    Y = (255, 214, 40)
    for x in range(4, 11):
        h.set(x, 2, Y if x % 3 else B[3])
    for x in range(-6, 4, 2):
        h.set(x, 2, Y)
    # speed lines streaming back
    for (y, x0, x1) in ((1, -12, -8), (3, -13, -9), (5, -11, -8)):
        for x in range(x0, x1 + 1):
            soft(h, x, y, (255, 214, 40), 60 + (x - x0) * 30)
    return h


def paid_bowler():
    h, R = bowler('#2a2533', band=(70, 60, 80), dark=(0, 0, 0), light=(160, 150, 200))
    G = R5('#3acb5a', dark=(0, 40, 10))
    for y in range(-3, 2):
        for x in range(1, 5):
            h.set(x, y, G[3] if x == 1 or y == -3 else G[2])
    px(h, ((2, -2), (3, -2), (2, -1), (2, 0)), (240, 255, 240))
    h.set(3, -1, (240, 255, 240))
    h.set(4, 1, G[1])
    return h


def earbuds_band():
    h = Hat()
    K = R5('#2a2633', dark=(0, 0, 0), light=(160, 150, 190))
    # slim arc band over the skull down to the ear
    for (x, y) in ((-2, -1), (-1, -1), (0, -1), (-3, 0), (1, 0), (-4, 1), (-4, 2), (-3, 3), (-3, 4)):
        h.set(x, y, K[2] if y < 1 else K[1])
    T = R5('#2fe0c8', dark=(0, 40, 50))
    px(h, ((-3, 5), (-2, 5), (-3, 6), (-2, 6)), T[2])
    h.set(-3, 5, T[4])
    h.set(-2, 6, T[1])
    h.set(-1, 6, T[1])
    h.set(-1, -1, K[4])
    return h


def gradient_bucket():
    a, b = hexrgb('#8a3ae0'), hexrgb('#2fd8c8')

    def colour(x, y, k):
        t = max(0, min(1, (y + 6) / 10))
        c = mix(a, b, t)
        return R5('#%02x%02x%02x' % c)[k]
    h, R = bucket('#8a3ae0', colour=colour)
    return h


def bat_wing_hardhat():
    h, R = hardhat('#8a5430', dark=(30, 10, 5))
    K = R5('#3a2a48', dark=(5, 0, 15), light=(160, 140, 200))
    back = [(-7, -1, 2), (-8, -2, 2), (-9, -3, 3), (-10, -2, 2), (-11, -3, 2), (-11, -1, 1), (-9, -1, 1),
            (-8, -1, 1), (-10, -1, 1), (-12, -2, 1), (-9, 0, 0), (-11, 0, 0)]
    for (x, y, k) in back:
        h.set(x, y, K[k])
    top = [(-3, -4, 2), (-4, -5, 2), (-5, -6, 3), (-4, -6, 2), (-3, -5, 1), (-2, -4, 1), (-6, -6, 2), (-5, -5, 1),
           (-6, -7, 3)]
    for (x, y, k) in top:
        h.set(x, y, K[k])
    return h


def countdown_headband():
    h, R = headband('#f2f0ea', top=1, bot=3, dark=(110, 100, 130))
    D = (36, 28, 40)
    for y in range(0, 5):
        for x in range(-6, 7):
            h.set(x, y, D)
    Rd = (255, 60, 60)
    text(h, '0', -5, 1, Rd)
    h.set(-1, 1, Rd)
    h.set(-1, 3, Rd)
    text(h, '00', 0, 1, Rd)
    for x in range(-6, 7):
        h.set(x, 0, (80, 70, 90))
    return h


def crosshair_beanie():
    h, R, C = beanie('#8890a4', dark=(30, 30, 60))
    Rd = R5('#ff3040', dark=(80, 0, 10))
    # arm from the cuff to a scope ring around the eye
    px(h, ((4, 3), (5, 3)), (60, 56, 70))
    ring = [(0, 5), (0, 6), (0, 7), (0, 8), (1, 4), (2, 4), (3, 4), (4, 5), (4, 6), (4, 7), (4, 8), (1, 9), (2, 9),
            (3, 9)]
    for (x, y) in ring:
        h.set(x, y, Rd[2])
    h.set(1, 4, Rd[4])
    for (x, y) in ((2, 5), (2, 8)):
        h.set(x, y, Rd[1], 230)
    soft(h, 3, 6, (255, 60, 60), 60)
    return h


def exit_helmet():
    h, R = helmet('#2fb050', dark=(0, 40, 10))
    # white sign on a post with a green running man arrow
    for y in (-8, -7):
        h.set(-1, y, (180, 180, 190))
    for y in range(-13, -8):
        for x in range(-5, 4):
            h.set(x, y, (250, 250, 248) if y in (-13, -9) or x in (-5, 3) else (40, 170, 70))
    text(h, 'EX', -4, -12, (250, 250, 248))
    h.set(3, -11, (250, 250, 248))
    return h


def gem_hardhat():
    h, R = hardhat('#ffc83d', ridge=False)
    for (x, y, c) in ((-4, -3, '#ff3a6a'), (-1, -4, '#3ad0ff'), (2, -3, '#5ae060')):
        L.gem(h, x, y, c)
    return h


def dog_ear_flaps():
    h, R, C = beanie('#ff86b8', dark=(90, 20, 50))
    Br = R5('#8a5430', dark=(30, 10, 5))
    ear = [(-6, 1, 3), (-7, 2, 2), (-6, 2, 2), (-7, 3, 2), (-6, 3, 1), (-7, 4, 1), (-6, 4, 1), (-7, 5, 1),
           (-6, 5, 0), (-7, 6, 0), (-6, 6, 0), (-5, 1, 2)]
    for (x, y, k) in ear:
        h.set(x, y, Br[k])
    ear2 = [(2, 1, 2), (3, 1, 2), (3, 2, 1), (4, 2, 1), (4, 3, 0)]
    for (x, y, k) in ear2:
        h.set(x, y, Br[k])
    return h


def smouldering_bowler():
    h, R = bowler('#7a4a2a')
    Fo, Fy, Fr = (255, 140, 30), (255, 230, 90), (220, 60, 30)
    for (x, y, c) in ((6, 1, Fr), (7, 0, Fo), (6, 0, Fo), (7, -1, Fy), (6, -1, Fo), (7, -2, Fo), (8, 0, Fr)):
        h.set(x, y, c)
    for (x, y, a) in ((7, -4, 180), (6, -5, 150), (7, -6, 120), (8, -7, 90), (7, -8, 60)):
        h.set(x, y, (160, 156, 168), a)
    return h


def witch_hardhat():
    h, R = hardhat('#ffc83d')
    P = R5('#8a3ae0', dark=(30, 0, 60))
    cone = [(-2, -3, 1), (-2, -4, 1), (-3, -5, 1), (-3, -6, 0), (-3, -7, 0), (-4, -8, 0), (-5, -9, 0), (-6, -9, -1)]
    for i, (y, x0, w) in enumerate(cone):
        for x in range(x0 - w, x0 + w + 1 + (1 if i < 3 else 0)):
            h.set(x, y if i < 7 else y, P[3] if x == x0 - w else P[2] if x <= x0 else P[1])
    for x in range(-4, 2):
        h.set(x, -3, P[1])
    h.set(-7, -9, P[2])
    h.set(-8, -8, P[1])
    h.set(-1, -4, (255, 220, 90))
    return h


def whale_tail_beanie():
    h, R, C = beanie('#25306a', dark=(5, 5, 30), light=(190, 200, 255))
    B = R5('#3a8ae8', dark=(10, 20, 60))
    tail = [(-1, -4, 2), (-1, -5, 2), (-1, -6, 3), (-2, -7, 3), (-3, -8, 3), (-4, -8, 4), (0, -7, 2), (1, -8, 2),
            (2, -8, 1), (-2, -6, 2), (0, -6, 1), (-5, -9, 4), (3, -9, 1)]
    for (x, y, k) in tail:
        h.set(x, y, B[k])
    return h


def durian_v2():
    """Spiky green husk split open at the front with creamy yellow flesh."""
    h = Hat()
    G = R5('#86a83a', dark=(30, 40, 10))
    rows(h, [(-4, -3, 2), (-3, -5, 4), (-2, -6, 5), (-1, -7, 5), (0, -7, 6), (1, -7, 6), (2, -7, 6), (3, -7, 6)],
         G, cx=-0.8, cy=0.0, rx=6.5, ry=4.5)
    # thorny spikes all round the silhouette, each a lit triangle
    spikes = [(-3, -6), (0, -7), (3, -5), (-6, -4), (5, -3), (-8, -1), (-8, 2), (7, 0)]
    for (x, y) in spikes:
        h.set(x, y, G[3])
    for (x, y) in ((-2, -5), (-1, -5), (1, -5), (2, -4), (-5, -3), (-4, -4), (4, -3), (-7, -1), (-7, 0), (6, -1),
                   (-7, 2), (6, 0)):
        h.set(x, y, G[2])
    # rows of thorn bumps on the husk
    for (x, y) in ((-4, -2), (-1, -3), (2, -2), (-6, 0), (-3, 0), (0, 0), (-5, 2), (-2, 2)):
        h.set(x, y, G[4])
        h.set(x + 1, y + 1, G[0])
        h.set(x + 1, y, G[1])
    # the split: a wedge opening at the front showing yellow flesh pods
    Y = R5('#ffe060', dark=(120, 70, 0))
    for (x, y, k) in ((3, -1, 3), (4, -1, 2), (3, 0, 2), (4, 0, 3), (5, 0, 2), (4, 1, 2), (5, 1, 2), (6, 1, 1),
                      (3, 1, 1), (4, 2, 1), (5, 2, 2), (6, 2, 1), (3, 2, 2), (2, 3, 1)):
        h.set(x, y, Y[k])
    h.set(4, -1, Y[4])
    h.set(4, 0, WHITE)
    px(h, ((2, -1), (2, 0), (2, 1), (2, 2)), G[0])
    px(h, ((7, 1), (7, 2), (6, 3), (5, 3)), G[1])
    # husk lip at the brow
    for x in range(-7, 2):
        h.set(x, 3, G[1] if x % 2 else G[0])
    L.brim_shadow(h, x0=-5, x1=5)
    return h


# ================================================================ RARE
def crash_helmet():
    h = Hat()
    R = R5('#e0283a', dark=(60, 0, 15))
    spec = [(-4, -3, 2), (-3, -5, 4), (-2, -6, 5), (-1, -7, 6), (0, -7, 6), (1, -7, 7), (2, -7, 7), (3, -7, 7),
            (4, -7, 7), (5, -7, 7), (6, -7, 7), (7, -7, 6), (8, -6, 6), (9, -6, 5), (10, -5, 4), (11, -4, 2)]
    rows(h, spec, R, cx=-1.5, cy=2.0, rx=7.5, ry=8.0)
    # checkered stripe over the top and down the back
    for (x, y) in ((-3, -3), (-2, -3), (-4, -2), (-3, -2), (-5, -1), (-4, -1), (-6, 0), (-5, 0), (-7, 1), (-6, 1),
                   (-7, 2), (-6, 2)):
        h.set(x, y, WHITE if (x + y) % 2 else (30, 26, 40))
    # visor: flashing chrome-cyan on cheer
    V = R5('#5ad8ff', dark=(10, 40, 90))
    for y in range(4, 9):
        for x in range(1, 8):
            if h.get(x, y)[3]:
                h.set(x, y, V[2] if y > 5 else V[3])
    px(h, ((2, 4), (3, 4), (4, 4), (2, 5)), WHITE)
    for x in range(1, 8):
        h.set(x, 3, R[0])
    for y in range(4, 9):
        h.set(0, y, R[0])
    for x in range(1, 7):
        h.set(x, 9, R[0])
    # chin bar
    for (x, y) in ((1, 10), (2, 10), (3, 10), (4, 10), (5, 10), (6, 9), (7, 9)):
        h.set(x, y, R[1])
    glint(h, 3, 5)
    for (x, y) in ((9, 3), (10, 5), (9, 7)):
        soft(h, x, y, (200, 240, 255), 140)
    px(h, ((-4, -2), (-5, -1)), R[4])
    return h


def mole_king_crown():
    h = Hat()
    G = R5('#e8b030')
    for y in (1, 2, 3):
        for x in range(-6, 6):
            k = 3 if y == 1 and x < 2 else 2 if x < 3 else 1
            h.set(x, y, G[k])
    pts = ((-6, -2), (-3, -4), (0, -3), (3, -4))
    for (px_, top) in pts:
        for y in range(top, 1):
            h.set(px_, y, G[3] if px_ < 0 else G[2])
            h.set(px_ + 1, y, G[2] if px_ < 0 else G[1])
            h.set(px_ + 2, y, G[1])
    # dents
    px(h, ((-2, 2), (1, 1), (-5, 3), (4, 2)), G[0])
    h.set(0, -3, (0, 0, 0)[:3], 0)
    # two painted red eyes on the front points
    Rd = (240, 40, 40)
    px(h, ((-2, -1), (3, -1)), Rd)
    px(h, ((-2, -2), (3, -2)), (255, 180, 170))
    glint(h, -5, 1)
    L.brim_shadow(h, x0=-5, x1=5)
    return h


def lily_pad_crown():
    h = Hat()
    G = R5('#4ab84a', dark=(10, 40, 20))
    for y in range(0, 4):
        w = [6, 8, 9, 8][y]
        for x in range(-w, w):
            if y == 0 and x > 2:
                continue  # notch
            k = 3 if y == 0 else 2 if y == 1 else 1 if y == 2 else 0
            h.set(x, y, G[k])
    px(h, ((-5, 1), (-2, 1), (1, 2), (-6, 2), (5, 2)), G[4] if True else G[3])
    # veins
    px(h, ((-3, 2), (0, 2), (3, 2)), G[0])
    # pink water lily at the back
    P = R5('#ff7ac0', dark=(100, 20, 60))
    for (x, y, k) in ((-6, -1, 3), (-5, -2, 4), (-4, -1, 3), (-5, -1, 2), (-7, 0, 2), (-3, 0, 2), (-5, 0, 1),
                      (-6, 0, 2), (-4, 0, 1)):
        h.set(x, y, P[k])
    h.set(-5, -1, (255, 230, 90))
    # tiny frog on top, mid-blink
    F = R5('#7ae050', dark=(10, 50, 20))
    for (x, y, k) in ((0, -1, 2), (1, -1, 2), (2, -1, 2), (3, -1, 1), (0, -2, 3), (1, -2, 2), (2, -2, 2),
                      (3, -2, 1), (0, -3, 3), (2, -3, 3), (4, -1, 1)):
        h.set(x, y, F[k])
    h.set(0, -3, WHITE)
    h.set(2, -3, (30, 40, 30))
    px(h, ((1, -1), (2, -1)), F[1])
    glint(h, -3, -3)
    return h


def vr_visor():
    h = Hat()
    W = R5('#eef0f6', dark=(80, 80, 120))
    K = R5('#2a2633', dark=(0, 0, 0))
    # strap round the head
    for x in range(-6, 0):
        h.set(x, 4, K[2])
        h.set(x, 5, K[1])
    for (x, y) in ((-2, -1), (-1, -1), (0, -1), (-3, 0), (1, 0), (-4, 1), (-4, 2), (-5, 3)):
        h.set(x, y, K[2])
    # chunky headset box
    for y in range(3, 9):
        for x in range(0, 9):
            k = 3 if y == 3 or x == 0 else 1 if y == 8 or x == 8 else 2
            h.set(x, y, W[k])
    # lens with candles
    for y in range(4, 8):
        for x in range(1, 8):
            h.set(x, y, (20, 26, 40))
    Gn, Rd = (80, 240, 120), (255, 70, 80)
    for (x, y0, y1, c) in ((1, 6, 7, Rd), (2, 5, 6, Gn), (3, 6, 7, Rd), (4, 4, 6, Gn), (5, 5, 5, Gn), (6, 4, 5, Gn),
                           (7, 6, 7, Rd)):
        for y in range(y0, y1 + 1):
            h.set(x, y, c)
    h.set(1, 4, (120, 200, 255))
    for (x, y) in ((9, 4), (9, 6)):
        soft(h, x, y, (120, 255, 160), 120)
    glint(h, 1, 3)
    return h


def lighthouse_helm():
    h, R = helmet('#e0303a', dark=(60, 0, 15))
    # white stripes
    for y in (-2, 1):
        for x in range(-8, 8):
            p = h.get(x, y)
            if p[3]:
                h.set(x, y, (250, 248, 244) if x < 2 else (214, 214, 224))
    for x in range(-7, 7):
        p = h.get(x, 5)
        if p[3]:
            h.set(x, 5, (230, 230, 240))
    # gallery and the beacon lamp on top
    for x in range(-3, 2):
        h.set(x, -5, (40, 36, 46))
    Y = R5('#ffd84a')
    for y in (-8, -7, -6):
        for x in range(-2, 1):
            h.set(x, y, Y[3] if x == -2 else Y[2])
    h.set(-1, -7, WHITE)
    for x in range(-3, 2):
        h.set(x, -9, (180, 30, 40))
    h.set(-1, -10, (180, 30, 40))
    # beams
    for i in range(1, 9):
        a = 170 - i * 18
        for dy in range(-(i // 3), i // 3 + 1):
            soft(h, 1 + i, -7 + dy, (255, 240, 140), a)
            soft(h, -3 - i, -7 + dy, (255, 240, 140), a // 2)
    glint(h, -2, -8)
    return h


def lantern_cap():
    h = Hat()
    K = R5('#3a3a50', dark=(5, 5, 20), light=(170, 170, 210))
    rows(h, CAP, K, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    for x in range(-6, 9):
        h.set(x, 3, K[1] if x < 4 else K[0])
    for x in range(5, 9):
        h.set(x, 2, K[2])
    # brass lantern on the front
    B = R5('#d8a040', dark=(70, 30, 0))
    for x in range(1, 6):
        h.set(x, -5, B[3] if x < 3 else B[2])
    h.set(3, -6, B[2])
    h.set(3, -7, B[1])
    for y in range(-4, 1):
        h.set(1, y, B[3])
        h.set(5, y, B[1])
    for y in range(-4, 1):
        for x in range(2, 5):
            h.set(x, y, (255, 214, 120))
    # flame
    px(h, ((3, -3), (3, -2), (2, -2), (3, -1)), (255, 150, 40))
    h.set(3, -2, (255, 255, 220))
    for x in range(1, 6):
        h.set(x, 1, B[1])
    glow(h, 3, -2, (255, 200, 90), r=5.0, a=110)
    glint(h, 2, -5)
    L.brim_shadow(h, x0=-3, x1=6)
    return h


def rent_halo():
    h = Hat()
    G = R5('#ffc83d')
    cx, cy, rx, ry = -0.5, -6.0, 6.5, 2.0
    for y in range(-9, -2):
        for x in range(-8, 8):
            d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
            if 0.45 <= d <= 1.05:
                front = y + 0.5 > cy
                k = 3 if (x < 0 and not front) else 2 if not front else 1 if x > 2 else 2
                if front:
                    k = 2 if x < 2 else 1
                h.set(x, y, G[k])
    # engraved letters on the front of the ring (dark ticks)
    for x in (-4, -3, -1, 1, 2, 4):
        h.set(x, -4, G[0])
    glow(h, -0.5, -6, (255, 230, 120), r=8.0, a=60)
    glint(h, -5, -7)
    glint(h, 6, -9)
    return h


def bot_helmet():
    h, R = helmet('#c8ccd8', dark=(40, 40, 70))
    # bolts and a vent grille
    for (x, y) in ((-6, 3), (-6, 0), (-2, -4)):
        h.set(x, y, R[4])
        h.set(x + 1, y + 1, R[0])
    for y in (0, 2):
        for x in range(-4, -1):
            h.set(x, y, R[0])
    # eye scanner strip on the brow
    for x in range(1, 7):
        h.set(x, 2, (30, 26, 40))
    px(h, ((4, 2), (5, 2)), (255, 60, 60))
    # antenna with a red light
    for y in range(-11, -6):
        h.set(-1, y, R[1])
    ell(h, -0.5, -12.5, 1.6, 1.6, R5('#ff3040', dark=(80, 0, 10)))
    h.set(-1, -13, WHITE)
    glow(h, -0.5, -12.5, (255, 60, 60), r=3.5, a=110)
    glint(h, -4, -2)
    return h


def sleep_mask():
    h = Hat()
    P = R5('#8a4ae0', dark=(30, 0, 60))
    # elastic round the head
    for x in range(-6, -1):
        h.set(x, 2, (60, 40, 80))
    # padded mask pushed up onto the forehead
    spec = [(-1, -2, 5), (0, -3, 6), (1, -3, 6), (2, -3, 6), (3, -2, 5)]
    rows(h, spec, P, cx=1.0, cy=0.0, rx=5.0, ry=3.0)
    # stitched closed-eye lashes
    px(h, ((1, 1), (2, 2), (3, 2), (4, 1)), (250, 240, 255))
    h.set(-1, 0, P[4])
    # Zzz floating up
    Wt = (250, 250, 255)
    text(h, 'Z', 5, -5, Wt)
    px(h, ((8, -9), (9, -9), (8, -8), (9, -8)), (230, 220, 255))
    text(h, 'Z', 9, -13, Wt, font=F4)
    glint(h, 0, -1)
    return h


def loading_helm():
    h, R = helmet('#9098a8', dark=(30, 30, 60))
    # dark visor across the face front
    for y in range(3, 8):
        for x in range(1, 7):
            h.set(x, y, (24, 30, 44))
    for x in range(1, 7):
        h.set(x, 8, R[1])
    for y in range(3, 9):
        h.set(0, y, R[1])
    h.set(7, 4, R[1])
    # loading ring: dots fading round the circle
    ring = [(3, 3), (4, 3), (5, 4), (5, 5), (4, 6), (3, 6), (2, 5), (2, 4)]
    for i, (x, y) in enumerate(ring):
        a = int(255 * (1 - i / 9))
        h.set(x, y + 0, mix((24, 30, 44), WHITE, 1 - i / 8.5))
    glint(h, -4, -2)
    return h


def validator_headset():
    h = Hat()
    K = R5('#2a2633', dark=(0, 0, 0), light=(160, 150, 200))
    # band over the head
    for (x, y) in ((-3, -1), (-2, -1), (-1, -1), (0, -1), (-4, 0), (1, 0), (-4, 1), (-4, 2)):
        h.set(x, y, K[2] if y < 0 else K[1])
    # over-ear cup
    ell(h, -2.5, 5.5, 2.4, 2.8, K)
    h.set(-3, 4, K[4])
    # green mic boom forward to the mouth
    G = R5('#3ae070', dark=(0, 50, 20))
    for (x, y) in ((-1, 7), (0, 8), (1, 8), (2, 9), (3, 9), (4, 9)):
        h.set(x, y, K[1])
    px(h, ((5, 9), (6, 9), (5, 10), (6, 10)), G[2])
    h.set(5, 9, G[4])
    # status LED blinking green
    h.set(-2, 5, (90, 255, 140))
    glow(h, -2, 5, (90, 255, 140), r=2.0, a=120)
    glint(h, -1, -1)
    return h


def gas_mask_v2():
    """Clean gas mask: rubber face piece, one round lens, one filter, a hose to the tank."""
    h = Hat()
    G = R5('#7c8696', dark=(30, 30, 50))
    # head harness strap
    for (x, y) in ((-5, 2), (-4, 2), (-3, 3), (-2, 3), (-1, 4), (-5, 6), (-4, 6), (-3, 7), (-2, 7)):
        h.set(x, y, (60, 52, 66))
    # face piece
    spec = [(4, 0, 4), (5, 0, 5), (6, 0, 5), (7, 0, 5), (8, 0, 6), (9, 1, 6), (10, 2, 5)]
    rows(h, spec, G, cx=1.5, cy=5.0, rx=4.5, ry=5.0)
    # lens ring with the eye behind glass
    Ln = (150, 230, 250)
    for (x, y) in ((1, 5), (2, 5), (1, 6), (2, 6), (1, 7), (2, 7)):
        h.set(x, y, mix(Ln, (40, 120, 160), 0.3 if y > 5 else 0))
    h.set(1, 5, WHITE)
    h.set(2, 6, (30, 50, 70))
    h.set(2, 7, (30, 50, 70))
    for (x, y) in ((0, 4), (1, 4), (2, 4), (3, 5), (3, 6), (3, 7), (0, 8), (1, 8), (2, 8), (0, 5), (0, 6), (0, 7)):
        h.set(x, y, G[0])
    # filter canister on the snout
    F = R5('#4a5260', dark=(10, 10, 20))
    for y in range(7, 11):
        for x in range(6, 9):
            h.set(x, y, F[3] if x == 6 else F[2] if x == 7 else F[1])
    for x in range(6, 9):
        h.set(x, 8, F[0])
    h.set(9, 9, F[1])
    # hose to a green tank on the back
    Hs = (90, 96, 110)
    for (x, y) in ((5, 11), (4, 12), (3, 12), (2, 12), (1, 12), (0, 12), (-1, 11), (-2, 11), (-3, 11), (-4, 10),
                   (-5, 9), (-6, 8)):
        h.set(x, y, Hs if (x + y) % 2 else (130, 136, 150))
    Gr = R5('#3fae55', dark=(10, 40, 20))
    rows(h, [(y, -9, -7) for y in range(3, 10)], Gr, cx=-8, cy=5, rx=2, ry=4)
    h.set(-8, 2, (190, 190, 200))
    h.set(-9, 4, Gr[4])
    # copium bubbles
    for (x, y, a) in ((10, 7, 220), (11, 5, 170), (10, 3, 120)):
        h.set(x, y, (190, 255, 210), a)
    return h


# ================================================================ LEGENDARY
def headless_flame():
    h = Hat()
    # green ghost flame replacing the whole head
    Gf = [(30, 120, 60), (60, 200, 90), (130, 255, 140), (220, 255, 200)]
    for y in range(-4, 13):
        for x in range(-7, 8):
            # tongue profile: wide at the base (neck), flicking up
            w = 6.2 if y > 2 else 6.2 - (2 - y) * 0.7
            cxo = -0.5 + (math.sin(y * 0.9) * 0.8 if y < 3 else 0)
            d = abs(x + 0.5 - cxo) / max(0.5, w)
            if d <= 1 and y <= 11:
                k = 3 if d < 0.25 and y > 2 else 2 if d < 0.55 else 1 if d < 0.85 else 0
                h.set(x, y, Gf[k])
    # extra tongues
    for (x, y, k) in ((-4, -5, 1), (-4, -6, 0), (2, -6, 1), (2, -7, 1), (3, -8, 0), (-1, -6, 2), (-1, -7, 1),
                      (5, -4, 0), (-6, -3, 0)):
        h.set(x, y, Gf[k])
    # hollow eye sockets glowing and a grin
    px(h, ((1, 5), (2, 5), (4, 5), (5, 5)), (10, 40, 20))
    px(h, ((1, 6), (4, 6)), (220, 255, 210))
    for (x, y) in ((1, 9), (2, 10), (3, 10), (4, 9)):
        h.set(x, y, (10, 40, 20))
    # embers rising
    for (x, y, a) in ((-5, -10, 220), (4, -12, 200), (0, -15, 160), (-3, -14, 140)):
        h.set(x, y, (170, 255, 150), a)
    glow(h, 0, 4, (90, 255, 120), r=9.0, a=70)
    # hardhat floating above
    Y = R5('#ffc83d')
    hy = -14
    rows(h, [(hy - 3, -3, 2), (hy - 2, -5, 3), (hy - 1, -6, 4), (hy, -6, 4)], Y, cx=-0.8, cy=hy + 0.5, rx=6.2,
         ry=4.0)
    for x in range(-7, 8):
        h.set(x, hy + 1, Y[1] if x > 3 else Y[2])
    h.set(-3, hy - 2, Y[4])
    lamp(h, 3, hy - 1)
    for x in range(-4, 5):
        soft(h, x, hy + 3, (90, 255, 120), 60)
    glint(h, -4, hy - 1)
    return h


# ================================================================ items
ITEMS = [
    ('G001', 'Red Hardhat', 'Common', red_hardhat),
    ('G002', 'Teal Hardhat', 'Common', teal_hardhat),
    ('G003', 'Yellow Hardhat', 'Common', yellow_hardhat),
    ('G004', 'Straw Farmer Hat', 'Common', straw_farmer),
    ('G005', 'Charred Beanie', 'Common', charred_beanie),
    ('G006', 'Backwards Broom Cap', 'Common', broom_cap),
    ('G007', 'Frog Eye Beanie', 'Common', HD.frog_beanie),
    ('G008', 'GM Sweatband', 'Common', gm_sweatband),
    ('G009', 'Green Candle Cap', 'Common', green_candle_cap),
    ('G010', 'Hat Dog Beanie', 'Common', hat_dog_beanie),
    ('G011', 'Jeet Sun Visor', 'Common', jeet_visor),
    ('G012', 'Mint Party Hat', 'Common', mint_party_hat),
    ('G013', 'Monke Ear Beanie', 'Common', monke_beanie),
    ('G014', 'Night Shift Nightcap', 'Common', nightcap),
    ('G015', 'Paper Dunce Cap', 'Common', HD.dunce_cap),
    ('G016', 'Tinfoil Thinking Cap', 'Common', tinfoil_cap),
    ('G017', 'Red Candle Cap', 'Common', red_candle_cap),
    ('G018', 'Ser Flat Cap', 'Common', flat_cap),
    ('G019', 'Shrimp Bucket Hat', 'Common', shrimp_bucket),
    ('G020', 'AFK Beanie', 'Common', afk_beanie),
    ('G021', 'Arena Bandana', 'Common', arena_bandana),
    ('G022', 'Batik Bandana', 'Common', batik_bandana),
    ('G023', 'Big Brain Beanie', 'Common', brain_beanie),
    ('G024', 'Blackout Hardhat', 'Common', blackout_hardhat),
    ('G025', 'Bubblegum Hardhat', 'Common', bubblegum_hardhat),
    ('G026', 'Coconut Hardhat', 'Common', coconut_hardhat),
    ('G027', 'Coin Slot Cap', 'Common', coin_slot_cap),
    ('G028', 'Headlamp Strap', 'Common', headlamp_strap),
    ('G029', 'Hopium Headband', 'Common', hopium_headband),
    ('G030', 'Island Sun Hat', 'Common', island_sun_hat),
    ('G031', 'Orange Hardhat', 'Common', orange_hardhat),
    ('G032', 'Purple Hardhat', 'Common', purple_hardhat),
    ('G033', 'Rug Fringe Beanie', 'Common', rug_fringe_beanie),
    ('G034', 'Zero Balance Bucket', 'Common', zero_bucket),
    ('G035', 'Touch Grass Cap', 'Common', touch_grass_cap),
    ('G036', 'Validator Cap', 'Common', validator_cap),
    ('G037', 'WAGMI Snapback', 'Common', wagmi_snapback),
    ('G038', 'Stopwatch Cap', 'Uncommon', stopwatch_cap),
    ('G039', 'Anon Shadow Hood', 'Uncommon', anon_hood),
    ('G040', 'Expired Stamp Cap', 'Uncommon', expired_cap),
    ('G041', 'Curve Arc Headband', 'Uncommon', curve_headband),
    ('G042', 'Pickaxe Headguard', 'Uncommon', pickaxe_headguard),
    ('G043', 'Conference Badge Visor', 'Uncommon', badge_visor),
    ('G044', 'Clan Banner Helm', 'Uncommon', clan_banner_helm),
    ('G045', 'Squished Top Hat', 'Uncommon', squished_top_hat),
    ('G046', 'Diamond Tiara', 'Uncommon', diamond_tiara),
    ('G047', 'Scooter Goggles', 'Uncommon', scooter_goggles),
    ('G048', 'Nugget Ear Hardhat', 'Uncommon', nugget_ear_hardhat),
    ('G049', 'ORE Mark Hardhat', 'Uncommon', ore_mark_hardhat),
    ('G050', 'Traffic Cone Hat', 'Uncommon', HD.traffic_cone),
    ('G051', 'Refinery Welding Cap', 'Uncommon', welding_cap),
    ('G052', 'Fast Lane Visor', 'Uncommon', fast_lane_visor),
    ('G053', 'Paid Up Bowler', 'Uncommon', paid_bowler),
    ('G054', 'Seeker Earbuds Band', 'Uncommon', earbuds_band),
    ('G055', 'Gradient Bucket Hat', 'Uncommon', gradient_bucket),
    ('G056', 'Bat Wing Hardhat', 'Uncommon', bat_wing_hardhat),
    ('G057', 'Countdown Headband', 'Uncommon', countdown_headband),
    ('G058', 'Crosshair Beanie', 'Uncommon', crosshair_beanie),
    ('G059', 'Durian Helmet', 'Uncommon', durian_v2),
    ('G060', 'Exit Sign Helmet', 'Uncommon', exit_helmet),
    ('G061', 'Gem Studded Hardhat', 'Uncommon', gem_hardhat),
    ('G062', 'Hat Dog Ear Flaps', 'Uncommon', dog_ear_flaps),
    ('G063', 'Smouldering Bowler', 'Uncommon', smouldering_bowler),
    ('G064', 'Witch Cone Hardhat', 'Uncommon', witch_hardhat),
    ('G065', 'Whale Tail Beanie', 'Uncommon', whale_tail_beanie),
    ('G066', 'Songkok Lampu', 'Rare', songkok_lampu),
    ('G067', 'Crash Cart Helmet', 'Rare', crash_helmet),
    ('G068', 'Mole King Crown Replica', 'Rare', mole_king_crown),
    ('G069', 'Laser Eyes Visor', 'Rare', HD.laser_eyes),
    ('G070', 'Lily Pad Crown', 'Rare', lily_pad_crown),
    ('G071', 'VR Chart Visor', 'Rare', vr_visor),
    ('G072', 'Hollow Pumpkin Head', 'Rare', HD.pumpkin),
    ('G073', 'Copium Gas Mask', 'Rare', gas_mask_v2),
    ('G074', 'Lighthouse Beacon Helm', 'Rare', lighthouse_helm),
    ('G075', 'Old Glow Lantern Cap', 'Rare', lantern_cap),
    ('G076', 'Tengkolok', 'Rare', HD.tengkolok),
    ('G077', 'Rent Exempt Halo', 'Rare', rent_halo),
    ('G078', 'Ser Monocle Top Hat', 'Rare', HD.ser_top_hat),
    ('G079', 'Bot Antenna Helmet', 'Rare', bot_helmet),
    ('G080', 'Jet Lag Sleep Mask', 'Rare', sleep_mask),
    ('G081', 'Loading Wheel Helm', 'Rare', loading_helm),
    ('G082', 'Validator Headset', 'Rare', validator_headset),
    ('G083', 'Whale Spout Hat', 'Rare', HD.whale_hat),
    ('G084', 'Jarl Helmet', 'Legendary', jarl_helmet),
    ('G085', 'Raja Crown', 'Legendary', raja_crown),
    ('G086', 'Deep Core Dome', 'Legendary', deep_core_dome),
    ('G087', 'Devs Do Something Siren', 'Legendary', HD.siren),
    ('G088', 'Galaxy Brain Dome', 'Legendary', HD.galaxy_brain),
    ('G089', 'Headless Miner Flame', 'Legendary', headless_flame),
    ('G090', 'Liquidation Storm Cloud', 'Legendary', HD.storm_cloud),
    ('G091', 'Motherlode Geyser Crown', 'Legendary', HD.geyser_crown),
    ('G092', 'Rug Toupee', 'Legendary', HD.rug_toupee),
    ('G093', 'This Is Fine Inferno Hat', 'Legendary', HD.inferno_bowler),
]


# ================================================================ revisions
F5 = {
    'W': ['x...x', 'x.x.x', '.x.x.'],
    'A': ['.x.', 'x.x', 'xxx', 'x.x'],
    'M': ['x...x', 'xx.xx', 'x.x.x'],
}
D5 = ['xxx', 'x.x', 'x.x', 'x.x', 'xxx']


def gm_sweatband2():
    h, R = headband('#ffd23a', top=0, bot=4, x1=6)
    O = (226, 92, 20)
    for (x, y) in ((-5, 1), (-4, 1), (-3, 1), (-5, 2), (-5, 3), (-4, 3), (-3, 3), (-3, 2)):
        h.set(x, y, O)
    text(h, 'M', -1, 1, O, font=F5)
    return h


def monke_beanie2():
    h, R, C = beanie('#7a4a2a', dark=(30, 10, 5))
    T = R5('#e8b880', dark=(90, 50, 20))
    # big round ear on the side of the head, tan inside
    ell(h, -2.0, 5.5, 2.3, 2.4, R)
    px(h, ((-3, 5), (-2, 5), (-3, 6), (-2, 6)), T[2])
    h.set(-3, 5, T[3])
    h.set(-2, 6, T[1])
    # far ear peeking out behind
    ell(h, -7.5, 1.0, 1.8, 2.0, R)
    h.set(-8, 1, T[1])
    return h


def shrimp_bucket2():
    h, R = bucket('#ff8aa8', dark=(90, 20, 40))
    W = (255, 120, 140)
    for (x, y) in ((3, -3), (4, -4), (5, -5), (6, -6), (7, -6), (8, -6), (9, -5), (10, -4), (11, -3)):
        h.set(x, y, W)
    for (x, y) in ((2, -4), (3, -5), (3, -6), (4, -7), (5, -8), (6, -9), (7, -9), (8, -9), (9, -9), (10, -8)):
        h.set(x, y, (232, 96, 120))
    # band of shrimp segments
    for x in range(-6, 5):
        h.set(x, 1, R[1] if x % 2 else R[3])
    return h


def arena_bandana2():
    h, R = bandana('#e0282e', dark=(70, 0, 10))
    for (x, y) in ((-4, 0), (-1, -1), (2, 1), (-2, 2), (1, 3), (-5, 2), (-9, 4)):
        h.set(x, y, (250, 246, 240))
    return h


def wagmi_snapback2():
    h = Hat()
    P = R5('#7a3ae0', dark=(30, 0, 60))
    spec = [(-6, -4, 3), (-5, -6, 5), (-4, -7, 6), (-3, -7, 6), (-2, -7, 6), (-1, -7, 6), (0, -7, 6), (1, -7, 6),
            (2, -7, 6)]
    rows(h, spec, P, cx=-1.0, cy=-2.0, rx=6.5, ry=6.0)
    for x in range(-7, 7):
        h.set(x, 3, P[0])
    for x in range(5, 12):
        h.set(x, 2, P[2] if x < 10 else P[1])
        h.set(x, 3, P[0])
    h.set(11, 3, P[0])
    W = (250, 248, 255)
    text(h, 'WA', -4, -5, W, font=F5)
    x = text(h, 'G', -5, 0, W, font={'G': ['xxx', 'x..', 'xxx']})
    x = text(h, 'M', x, 0, W, font=F5)
    text(h, 'I', x, 0, W)
    h.set(-6, -5, P[4])
    h.set(-5, -6, P[3])
    L.brim_shadow(h, x0=-3, x1=8)
    return h


def expired_cap2():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (214, 34, 46)
    for x in range(-6, 6):
        h.set(x, -3, Rd)
        h.set(x, 1, Rd)
    for y in range(-3, 2):
        h.set(-6, y, Rd)
        h.set(5, y, Rd)
    text(h, 'EXP', -5, -2, Rd, gap=0)
    for x in range(-5, 5):
        h.set(x, 0, (200, 60, 70) if x % 3 else R[2])
    text(h, 'EXP', -5, -2, Rd, gap=0)
    for (x, y) in ((-5, -1), (-2, -1)):
        h.set(x, y, Rd)
    return h


def earbuds_band2():
    h = Hat()
    K = R5('#2a2633', dark=(0, 0, 0), light=(160, 150, 190))
    for (x, y) in ((-3, -1), (-2, -1), (-1, -1), (0, -1), (-4, 0), (1, 0), (-5, 1), (-5, 2), (-5, 3)):
        h.set(x, y, K[2] if y < 1 else K[1])
    h.set(-2, -1, K[4])
    T = R5('#2fe0c8', dark=(0, 40, 50))
    for (x, y, k) in ((-6, 4, 3), (-5, 4, 4), (-4, 4, 2), (-6, 5, 2), (-5, 5, 2), (-4, 5, 1), (-5, 6, 1),
                      (-5, 7, 0)):
        h.set(x, y, T[k])
    # second bud dangling from its cord
    for (x, y) in ((-4, 6), (-4, 7), (-3, 8), (-3, 9)):
        h.set(x, y, (70, 66, 80))
    px(h, ((-3, 10), (-2, 10)), T[2])
    h.set(-3, 10, T[4])
    return h


BATWING = ['......x',
           '.....xx',
           '...xxxx',
           '.xxxxxx',
           'xxxxxxx',
           'x.x.xx.',
           ]


def bat_wing_hardhat2():
    h, R = hardhat('#8a5430', dark=(30, 10, 5))
    K = R5('#40305a', dark=(5, 0, 15), light=(190, 170, 230))
    # back wing (mirrored), sticking out behind
    for j, r in enumerate(BATWING):
        for i, c in enumerate(r):
            if c == 'x':
                x, y = -6 - (6 - i), -4 + j
                h.set(x - 1, y, K[3] if j < 3 else K[2] if j < 5 else K[1])
    for (x, y) in ((-8, -2), (-10, -1), (-12, 0)):
        h.set(x, y, K[0])
    # near wing folded up off the dome top
    W2 = ['x.....', 'xx....', 'xxxx..', 'xxxxx.', '.xxxxx', '..x.xx']
    for j, r in enumerate(W2):
        for i, c in enumerate(r):
            if c == 'x':
                h.set(-5 + i, -9 + j, K[3] if j < 2 else K[2] if j < 4 else K[1])
    for (x, y) in ((-4, -7), (-3, -6), (-2, -5)):
        h.set(x, y, K[0])
    return h


def countdown_headband2():
    h, R = headband('#f2f0ea', top=1, bot=3, dark=(110, 100, 130))
    Kd = R5('#3a3446', dark=(5, 0, 10), light=(170, 160, 200))
    for y in range(-2, 5):
        for x in range(-7, 10):
            edge = y in (-2, 4) or x in (-7, 9)
            h.set(x, y, Kd[3] if (edge and (y == -2 or x == -7)) else Kd[1] if edge else (30, 22, 30))
    Rd = (255, 60, 60)
    xx = -6
    for k, ch in enumerate('00:00'):
        if ch == ':':
            h.set(xx, 0, Rd)
            h.set(xx, 2, Rd)
            xx += 1
            continue
        for j, r in enumerate(D5):
            for i, c in enumerate(r):
                if c == 'x':
                    h.set(xx + i, -1 + j, Rd)
        xx += 3
    soft(h, 10, 1, (255, 60, 60), 60)
    glint(h, -6, -2)
    return h


def durian_v3():
    """Spiky green husk, split open at the front showing yellow flesh."""
    h = Hat()
    G = R5('#78a028', dark=(30, 40, 0))
    ell(h, -0.5, -0.5, 7.0, 4.6, G, only=lambda x, y: y <= 3)
    # grid of pyramid thorns: lit top-left, dark bottom-right
    for (x, y) in ((-4, -4), (0, -4), (-6, -1), (-2, -1), (2, -1), (-4, 2), (0, 2), (-7, 2)):
        h.set(x, y, G[4])
        h.set(x + 1, y, G[3])
        h.set(x, y + 1, G[2])
        h.set(x + 1, y + 1, G[0])
    # spikes sticking out round the edge
    for (x, y) in ((-5, -5), (-2, -6), (1, -6), (4, -5), (-7, -3), (6, -3), (-8, 0), (7, 0), (-9, 2)):
        h.set(x, y, G[3] if x < 1 else G[2])
    for (x, y) in ((-5, -6), (-2, -7), (1, -7), (4, -6), (-8, -3), (7, -3), (-9, 0), (8, 0), (-10, 2)):
        h.set(x, y, G[4] if x < 1 else G[3])
    # the split at the front: dark husk edges framing creamy flesh pods
    Y = R5('#ffd84a', dark=(140, 80, 0))
    for (x, y) in ((3, -3), (3, -2), (2, -1), (2, 0), (2, 1), (2, 2), (2, 3)):
        h.set(x, y, G[0])
    for (x, y) in ((6, -2), (7, -1), (7, 1), (7, 2), (6, 3)):
        h.set(x, y, G[0])
    for (x, y, k) in ((4, -3, 3), (5, -3, 2), (4, -2, 4), (5, -2, 3), (6, -1, 2), (3, -1, 3), (4, -1, 3),
                      (5, -1, 2), (3, 0, 2), (4, 0, 1), (5, 0, 1), (6, 0, 1), (3, 1, 3), (4, 1, 4), (5, 1, 3),
                      (6, 1, 2), (3, 2, 2), (4, 2, 2), (5, 2, 1), (6, 2, 1), (3, 3, 1), (4, 3, 1), (5, 3, 0)):
        h.set(x, y, Y[k])
    h.set(4, -2, WHITE)
    L.brim_shadow(h, x0=-5, x1=5)
    return h


def exit_helmet2():
    h, R = helmet('#2fb050', dark=(0, 40, 10))
    for y in (-8, -7):
        h.set(-1, y, (180, 180, 190))
    Gx = (36, 160, 70)
    for y in range(-14, -8):
        for x in range(-8, 7):
            h.set(x, y, Gx if y in (-14, -9) or x in (-8, 6) else (250, 250, 246))
    for y in range(-13, -9):
        for x in range(-7, 6):
            h.set(x, y, Gx)
    text(h, 'EXIT', -6, -13, (250, 250, 246))
    return h


def dog_ear_flaps2():
    h, R, C = beanie('#ff86b8', dark=(90, 20, 50))
    Br = R5('#8a5430', dark=(30, 10, 5))
    ear = ['xxx.', 'xxxx', 'xxxx', 'xxxx', 'xxxx', '.xxx', '.xx.']
    for j, r in enumerate(ear):
        for i, c in enumerate(r):
            if c == 'x':
                k = 3 if j == 0 else 2 if i < 2 else 1
                if j > 4:
                    k = 1
                h.set(-8 + i, 1 + j, Br[k])
    px(h, ((-6, 3), (-6, 4), (-6, 5)), Br[0])
    # near ear flopping forward over the cuff
    ear2 = ['xxx', 'xxx', 'xxx', '.x.']
    for j, r in enumerate(ear2):
        for i, c in enumerate(r):
            if c == 'x':
                h.set(-2 + i, 1 + j, Br[2] if i == 0 else Br[1])
    h.set(-2, 1, Br[3])
    return h


def witch_hardhat2():
    h, R = hardhat('#ffc83d')
    P = R5('#8a3ae0', dark=(30, 0, 60))
    cone = [(-4, -3, 2), (-5, -3, 1), (-6, -2, 1), (-7, -2, 0), (-8, -2, 0), (-9, -2, -1), (-10, -3, -2),
            (-11, -4, -3), (-11, -5, -5)]
    for (y, x0, x1) in cone:
        for x in range(x0, x1 + 1):
            k = 3 if x == x0 else 2 if x < x1 else 1
            h.set(x, y, P[k])
    for x in range(-4, 3):
        h.set(x, -3, P[1])
        h.set(x, -4, P[2] if x > -4 else P[3])
    h.set(-6, -12, P[3])
    # little gold star
    px(h, ((-1, -6), (0, -7), (0, -6), (1, -6), (0, -5)), (255, 220, 90))
    h.set(0, -6, (255, 250, 210))
    return h


def loading_helm2():
    h, R = helmet('#9098a8', dark=(30, 30, 60))
    V = (22, 28, 44)
    for y in range(2, 10):
        for x in range(0, 8):
            h.set(x, y, V)
    for x in range(0, 8):
        h.set(x, 10, R[1])
        h.set(x, 1, R[1])
    for y in range(1, 11):
        h.set(-1, y, R[2])
        h.set(8, y, R[0])
    ring = [(3, 3), (4, 3), (5, 4), (5, 5), (5, 6), (4, 7), (3, 7), (2, 6), (2, 5), (2, 4)]
    for i, (x, y) in enumerate(ring):
        t = i / (len(ring) - 1)
        h.set(x + 0, y + 0, mix(WHITE, (60, 70, 100), t) if i < 8 else V)
    glint(h, 1, 2)
    soft(h, 9, 5, (200, 220, 255), 90)
    return h


def headless_flame2():
    h = Hat()
    Gf = [(24, 110, 60), (50, 190, 90), (120, 250, 140), (225, 255, 210)]
    # flame silhouette: rounded skull-sized base, tongues licking up and back
    prof = {12: (-3, 3), 11: (-4, 4), 10: (-5, 5), 9: (-5, 6), 8: (-6, 6), 7: (-6, 6), 6: (-6, 6), 5: (-6, 6),
            4: (-6, 5), 3: (-6, 5), 2: (-6, 4), 1: (-5, 4), 0: (-5, 3), -1: (-4, 3), -2: (-4, 2), -3: (-4, 1),
            -4: (-4, 0), -5: (-5, -1), -6: (-6, -2), -7: (-7, -3), -8: (-8, -5)}
    for y, (x0, x1) in prof.items():
        for x in range(x0, x1 + 1):
            c = (x0 + x1) / 2
            d = abs(x + 0.5 - c - 0.5) / max(1, (x1 - x0 + 1) / 2)
            k = 3 if d < 0.3 and 2 < y < 10 else 2 if d < 0.6 else 1 if d < 0.9 else 0
            h.set(x, y, Gf[k])
    # second, smaller tongue at the front
    for (x, y, k) in ((2, -2, 1), (3, -3, 1), (3, -4, 0), (4, -5, 0), (1, -1, 2), (2, -1, 2), (0, -5, 1),
                      (1, -6, 0)):
        h.set(x, y, Gf[k])
    # hollow eyes and grin
    px(h, ((1, 5), (2, 5), (1, 6), (2, 6)), (8, 40, 20))
    h.set(2, 5, (220, 255, 210))
    for (x, y) in ((0, 9), (1, 10), (2, 10), (3, 10), (4, 9)):
        h.set(x, y, (8, 40, 20))
    for (x, y, a) in ((-6, -11, 220), (3, -9, 200), (-2, -12, 160), (5, -12, 120)):
        h.set(x, y, (170, 255, 150), a)
    glow(h, 0, 3, (90, 255, 120), r=9.0, a=70)
    # hardhat floating above
    Y = R5('#ffc83d')
    hy = -15
    rows(h, [(hy - 3, -3, 2), (hy - 2, -5, 3), (hy - 1, -6, 4), (hy, -6, 4)], Y, cx=-0.8, cy=hy + 0.5, rx=6.2,
         ry=4.0)
    for x in range(-7, 8):
        h.set(x, hy + 1, Y[1] if x > 3 else Y[2])
    h.set(-3, hy - 2, Y[4])
    lamp(h, 3, hy - 1)
    for x in range(-4, 5):
        soft(h, x, hy + 3, (90, 255, 120), 70)
    glint(h, -4, hy - 1)
    return h


def pickaxe_headguard2():
    h = Hat()
    R = R5('#d8303a', dark=(60, 0, 10))
    spec = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 5), (1, -6, 5), (2, -6, 5), (3, -6, 4),
            (4, -6, -1), (5, -6, -1), (6, -5, -1), (7, -5, -1), (8, -4, -1)]
    rows(h, spec, R, cx=-1.0, cy=1.5, rx=6.2, ry=6.0)
    for x in range(-1, 6):
        h.set(x, 3, R[1])
    for y in range(4, 9):
        h.set(-1, y, R[0])
    # quilting
    px(h, ((-4, 5), (-3, 5), (-2, 5), (-4, 0), (-3, 1)), R[1])
    # crossed pickaxe badge on the crown side
    Wt, Hd = (240, 240, 245), (210, 160, 90)
    for (x, y) in ((-3, -2), (-2, -1), (-1, 0), (0, 1)):
        h.set(x, y, Hd)
    for (x, y) in ((0, -2), (-1, -1), (-3, 0), (-4, 1)):
        h.set(x, y, Hd)
    px(h, ((-4, -2), (-3, -3), (-2, -3), (1, -2), (0, -3), (-1, -3)), Wt)
    px(h, ((-4, -3), (-5, -2)), R[4])
    return h


def validator_headset2():
    h = Hat()
    K = R5('#2a2633', dark=(0, 0, 0), light=(160, 150, 200))
    for (x, y) in ((-3, -2), (-2, -2), (-1, -2), (0, -2), (1, -1), (-4, -1), (-5, 0), (-5, 1), (-5, 2)):
        h.set(x, y, K[2] if y < -1 else K[1])
    for (x, y) in ((-3, -1), (-2, -1), (-1, -1), (0, -1), (-4, 0)):
        h.set(x, y, K[1])
    h.set(-2, -2, K[4])
    ell(h, -3.5, 5.0, 2.6, 3.0, K)
    px(h, ((-4, 3), (-5, 4)), K[4])
    G = R5('#3ae070', dark=(0, 50, 20))
    for (x, y) in ((-1, 7), (0, 8), (1, 9), (2, 9), (3, 9)):
        h.set(x, y, K[1])
    px(h, ((4, 9), (5, 9), (4, 10), (5, 10)), G[2])
    h.set(4, 9, G[4])
    h.set(-4, 5, (90, 255, 140))
    glow(h, -4, 5, (90, 255, 140), r=2.2, a=130)
    glint(h, -3, -2)
    return h


_REPL = {
    'G008': gm_sweatband2, 'G013': monke_beanie2, 'G019': shrimp_bucket2, 'G021': arena_bandana2,
    'G037': wagmi_snapback2, 'G040': expired_cap2, 'G054': earbuds_band2, 'G056': bat_wing_hardhat2,
    'G057': countdown_headband2, 'G059': durian_v3, 'G060': exit_helmet2, 'G062': dog_ear_flaps2,
    'G064': witch_hardhat2, 'G081': loading_helm2, 'G089': headless_flame2, 'G042': pickaxe_headguard2,
    'G082': validator_headset2,
}
ITEMS = [(g, n, r, _REPL.get(g, f)) for (g, n, r, f) in ITEMS]


def gm_sweatband3():
    h, R = headband('#ffd23a', top=0, bot=4, x1=6)
    for y in range(0, 5):
        for x in range(-6, 7):
            if (x + y) % 2 == 0:
                h.set(x, y, mix(h.get(x, y)[:3], R[0], 0.15))
    O = (226, 84, 16)
    x = text(h, 'G', -5, 0, O, font={'G': ['xxx', 'x..', 'x.x', 'x.x', 'xxx']})
    text(h, 'M', x, 0, O, font={'M': ['x...x', 'xx.xx', 'x.x.x', 'x...x', 'x...x']})
    return h


def monke_beanie3():
    h, R, C = beanie('#7a4a2a', dark=(30, 10, 5))
    T = R5('#f0c088', dark=(90, 50, 20))
    ear = ['.xxx.', 'xTTTx', 'xTtTx', 'xTTxx', '.xxx.']
    for j, r in enumerate(ear):
        for i, c in enumerate(r):
            if c == '.':
                continue
            col = R[2] if c == 'x' else T[2] if c == 'T' else T[1]
            if c == 'x' and (i == 0 or j == 0):
                col = R[3]
            h.set(-6 + i, 3 + j, col)
    # far ear peeking out on top behind
    ell(h, -5.5, -4.0, 1.8, 1.8, R)
    h.set(-6, -4, T[1])
    return h


def countdown_headband3():
    h, R = headband('#f2f0ea', top=1, bot=3, dark=(110, 100, 130))
    Kd = R5('#3a3446', dark=(5, 0, 10), light=(170, 160, 200))
    x0, x1, y0, y1 = -8, 10, -2, 4
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            edge = y in (y0, y1) or x in (x0, x1)
            h.set(x, y, (Kd[3] if (y == y0 or x == x0) else Kd[1]) if edge else (30, 22, 30))
    Rd = (255, 60, 60)
    xx = x0 + 1
    for ch in '00:00':
        if ch == ':':
            h.set(xx, 0, Rd)
            h.set(xx, 2, Rd)
            xx += 2
            continue
        for j, r in enumerate(D5):
            for i, c in enumerate(r):
                if c == 'x':
                    h.set(xx + i, y0 + 1 + j, Rd)
        xx += 4
    glow(h, 1, 1, (255, 60, 60), r=10, a=40)
    glint(h, x0, y0)
    return h


_REPL2 = {'G008': gm_sweatband3, 'G013': monke_beanie3, 'G040': expired_cap, 'G057': countdown_headband3}
ITEMS = [(g, n, r, _REPL2.get(g, f)) for (g, n, r, f) in ITEMS]


def gm_sweatband4():
    h, R = headband('#ffd23a', top=0, bot=4, x1=6)
    O = (220, 76, 12)
    x = text(h, 'G', -5, 0, O, font={'G': ['xxx', 'x..', 'x.x', 'x.x', 'xxx']})
    text(h, 'M', x, 0, O, font={'M': ['x...x', 'xx.xx', 'x.x.x', 'x...x', 'x...x']})
    # terry texture only on the band ends
    for y in range(0, 5):
        h.set(-6, y, R[3] if y % 2 else R[2])
        h.set(6, y, R[1] if y % 2 else R[0])
    return h


def monke_beanie4():
    h, R, C = beanie('#8a5432', dark=(30, 10, 5))
    T = R5('#f4c890', dark=(90, 50, 20))
    D = R[0]
    ear = ['.ddd.', 'dTTTd', 'dTttd', 'dTttd', '.ddd.']
    for j, r in enumerate(ear):
        for i, c in enumerate(r):
            if c == '.':
                continue
            col = D if c == 'd' else T[3] if c == 'T' else T[1]
            h.set(-5 + i, -3 + j, col)
    # far ear behind the crown
    for (x, y, c) in ((-7, -4, R[2]), (-8, -3, R[2]), (-7, -3, T[1]), (-8, -2, R[1]), (-7, -2, R[1]),
                      (-6, -5, R[3])):
        h.set(x, y, c)
    return h


_REPL3 = {'G008': gm_sweatband4, 'G013': monke_beanie4}
ITEMS = [(g, n, r, _REPL3.get(g, f)) for (g, n, r, f) in ITEMS]


def gm_sweatband5():
    h, R = headband('#ffd23a', top=0, bot=4, x1=6)
    O = (214, 70, 10)
    x = text(h, 'G', -5, 1, O, font={'G': ['xxx', 'x..', 'xxx']}, col2=None)
    h.set(-3, 1, R[2])
    h.set(-3, 2, O)
    text(h, 'M', x, 1, O, font=F5)
    return h


def monke_beanie5():
    h, R, C = beanie('#8a5432', dark=(30, 10, 5))
    T = R5('#f4c890', dark=(90, 50, 20))
    for (cx, cy) in ((-8.0, -1.0), (3.5, -5.5)):
        ell(h, cx, cy, 2.3, 2.3, R)
    for (x, y, k) in ((-9, -2, 3), (-8, -2, 2), (-9, -1, 2), (-8, -1, 1), (3, -6, 3), (4, -6, 2), (3, -5, 2),
                      (4, -5, 1)):
        h.set(x, y, T[k])
    # restore the dome over the front ear's base
    rows(h, [(-4, 1, 2), (-3, 1, 3)], R, cx=-0.8, cy=0.5, rx=6.2, ry=4.6)
    return h


_REPL4 = {'G008': gm_sweatband5, 'G013': monke_beanie5}
ITEMS = [(g, n, r, _REPL4.get(g, f)) for (g, n, r, f) in ITEMS]


def wagmi_snapback3():
    h = Hat()
    P = R5('#7a3ae0', dark=(30, 0, 60))
    spec = [(-7, -4, 3), (-6, -6, 5), (-5, -7, 6), (-4, -7, 6), (-3, -7, 6), (-2, -7, 6), (-1, -7, 6), (0, -7, 6),
            (1, -7, 6), (2, -7, 6)]
    rows(h, spec, P, cx=-1.0, cy=-2.0, rx=6.5, ry=6.0)
    for x in range(-7, 7):
        h.set(x, 3, P[0])
    for x in range(5, 12):
        h.set(x, 2, P[2] if x < 10 else P[1])
        h.set(x, 3, P[0])
    W = (250, 248, 255)
    text(h, 'WA', -4, -6, W, font={'W': ['x...x', 'x.x.x', '.x.x.'], 'A': ['.x.', 'x.x', 'xxx']})
    x = text(h, 'G', -6, -2, W, font={'G': ['xxx', 'x..', 'x.x', 'xxx']})
    x = text(h, 'M', x, -2, W, font={'M': ['x...x', 'xx.xx', 'x.x.x', 'x...x']})
    text(h, 'I', x, -2, W, font={'I': ['x', 'x', 'x', 'x']})
    h.set(-6, -6, P[4])
    L.brim_shadow(h, x0=-3, x1=8)
    return h


def expired_cap3():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (214, 34, 46)
    for x in range(-6, 5):
        h.set(x, -2, Rd)
        h.set(x, 2, Rd)
    for y in range(-2, 3):
        h.set(-6, y, Rd)
        h.set(4, y, Rd)
    for y in range(-1, 2):
        for x in range(-5, 4):
            h.set(x, y, R[3] if x < 0 else R[2])
    text(h, 'EXP', -5, -1, Rd, gap=0)
    return h


def coconut_hardhat2():
    h = coconut_hardhat()
    for y in range(4, 12):
        for x in range(-4, 2):
            p = h.get(x, y)
            if p[3] and p[:3] in ((222, 190, 130), (180, 140, 80)):
                h.set(x, y, (0, 0, 0), 0)
    Rp = [(222, 190, 130), (180, 140, 80)]
    for i, (x, y) in enumerate(((-5, 4), (-5, 5), (-4, 6), (-4, 7), (-4, 8), (-3, 9))):
        h.set(x, y, Rp[i % 2])
    return h


def headless_flame3():
    h = headless_flame2()
    # rebuild with the hat lower so it stays inside the frame
    g = Hat()
    for y in range(-30, 30):
        for x in range(-25, 25):
            p = h.get(x, y)
            if p[3] and y >= -9:
                g.set(x, y, p[:3], p[3])
    g.soft = [s for s in h.soft if s[1] >= -9]
    Y = R5('#ffc83d')
    hy = -12
    rows(g, [(hy - 3, -3, 2), (hy - 2, -5, 3), (hy - 1, -6, 4), (hy, -6, 4)], Y, cx=-0.8, cy=hy + 0.5, rx=6.2,
         ry=4.0)
    for x in range(-7, 8):
        g.set(x, hy + 1, Y[1] if x > 3 else Y[2])
    g.set(-3, hy - 2, Y[4])
    lamp(g, 3, hy - 1)
    glint(g, -4, hy - 1)
    for (x, y, a) in ((-8, -6, 200), (6, -8, 160)):
        g.set(x, y, (170, 255, 150), a)
    return g


_REPL5 = {'G037': wagmi_snapback3, 'G040': expired_cap3, 'G026': coconut_hardhat2, 'G089': headless_flame3}
ITEMS = [(g, n, r, _REPL5.get(g, f)) for (g, n, r, f) in ITEMS]


def expired_cap4():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (214, 34, 46)
    for y in range(-3, 3):
        for x in range(-6, 3):
            edge = y in (-3, 2) or x in (-6, 2)
            h.set(x, y, Rd if edge else (R[3] if x < -1 else R[2]))
    text(h, 'EX', -5, -2, Rd, font={'E': ['xxx', 'xx.', 'x..', 'xxx'], 'X': ['x.x', '.x.', 'x.x', 'x.x']})
    h.set(1, 1, R[2])
    h.set(1, 0, Rd)
    return h


ITEMS = [(g, n, r, expired_cap4 if g == 'G040' else f) for (g, n, r, f) in ITEMS]


def expired_cap5():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (214, 34, 46)
    for y in range(-4, 2):
        for x in range(-7, 4):
            edge = y in (-4, 1) or x in (-7, 3)
            h.set(x, y, Rd if edge else (R[3] if x < -1 else R[2]))
    text(h, 'EXP', -6, -3, Rd, gap=0, font={'E': ['xxx', 'x..', 'xx.', 'xxx'][:3] and ['xx', 'x.', 'xx'],
                                           'X': ['x.x', '.x.', 'x.x'], 'P': ['xx', 'xx', 'x.']})
    return h


ITEMS = [(g, n, r, expired_cap5 if g == 'G040' else f) for (g, n, r, f) in ITEMS]


def expired_cap6():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (214, 34, 46)
    for y in range(-5, 2):
        for x in range(-8, 4):
            if not h.get(x, y)[3] and y > -4:
                continue
            edge = y in (-5, 1) or x in (-8, 3)
            if edge:
                h.set(x, y, Rd)
    text(h, 'EXP', -6, -3, Rd, gap=1, font={'E': ['xx', 'x.', 'xx'], 'X': ['x.x', '.x.', 'x.x'],
                                           'P': ['xx', 'xx', 'x.']})
    return h


ITEMS = [(g, n, r, expired_cap6 if g == 'G040' else f) for (g, n, r, f) in ITEMS]


def expired_cap7():
    h, R, B = cap('#f2f0ea', dark=(110, 100, 120))
    Rd = (214, 34, 46)
    for y in range(-2, 3):
        for x in range(-6, 5):
            if h.get(x, y)[3]:
                h.set(x, y, Rd)
    W = (250, 244, 236)
    text(h, 'EXP', -5, -1, W, gap=1, font={'E': ['xx', 'x.', 'xx'], 'X': ['x.x', '.x.', 'x.x'],
                                          'P': ['xx', 'xx', 'x.']})
    h.set(-4, 0, Rd)
    return h


ITEMS = [(g, n, r, expired_cap7 if g == 'G040' else f) for (g, n, r, f) in ITEMS]

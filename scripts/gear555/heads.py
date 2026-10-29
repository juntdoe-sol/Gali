"""Gali Gear 555, head slot: hand-pixelled sprites in the same format as the
Jarl Helmet (anchor (0,0) = top-centre of the skull, facing right, light from
the top left). Head reference: hair x -5..-3, face x -2..5 from y 4, eye at
x 2..3, y 6..7, beard y 8..11.
"""
import math
import sys

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import legend_hats as L  # noqa: E402

L.PAD = 20  # room for effects above the head
Hat, ramp5, mix, hexrgb, gem = L.Hat, L.ramp5, L.mix, L.hexrgb, L.gem
WHITE = (255, 255, 255)
BLACK = (24, 16, 28)


def shade_k(nx, ny, bias=0.0):
    v = -(nx * -0.62 + ny * -0.78) + bias
    return 0 if v < -0.6 else 1 if v < -0.1 else 2 if v < 0.5 else 3


def ell(h, cx, cy, rx, ry, R, only=None, bias=0.0):
    """Lit ellipse. only(x, y) -> bool can clip it."""
    for y in range(int(cy - ry - 1), int(cy + ry + 2)):
        for x in range(int(cx - rx - 1), int(cx + rx + 2)):
            nx, ny = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            if nx * nx + ny * ny <= 1 and (only is None or only(x, y)):
                h.set(x, y, R[shade_k(nx, ny, bias)])


def rows(h, spec, R, cx=-0.5, cy=0.0, rx=6.0, ry=5.0):
    for (y, x0, x1) in spec:
        for x in range(x0, x1 + 1):
            h.set(x, y, R[shade_k((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)])


def spark(h, x, y, s=1, col=WHITE):
    for k in range(-s, s + 1):
        h.set(x + k, y, col)
        h.set(x, y + k, col)


def soft(h, x, y, col, a):
    h.soft.append((x, y, (*col, a)))


DOME = [(-3, -3, 2), (-2, -5, 3), (-1, -6, 4), (0, -6, 4), (1, -6, 5), (2, -6, 5)]


# ---------------------------------------------------------------- Common
def frog_beanie():
    h = Hat()
    G = ramp5('#5cc644', dark=(20, 40, 30))
    rows(h, DOME, G)
    for x in range(-6, 6):
        h.set(x, 2, G[1] if x % 2 else G[2])
        h.set(x, 3, G[1] if x % 2 else G[0])
    # two bulging eyes on top, looking forward
    for ex in (-4, 0):
        ell(h, ex + 1.5, -4.5, 2.2, 2.0, ramp5('#5cc644', dark=(20, 40, 30)))
        for (x, y, c) in ((ex, -5, WHITE), (ex + 1, -5, WHITE), (ex + 2, -5, (220, 230, 240)),
                          (ex, -4, (230, 236, 240)), (ex + 1, -4, WHITE), (ex + 2, -4, BLACK),
                          (ex + 2, -5, BLACK)):
            h.set(x, y, c)
        h.set(ex + 1, -5, WHITE)
    h.set(-3, -2, G[4])
    # little smile stitched on the side
    for (x, y) in ((1, 0), (2, 1), (3, 1), (4, 0)):
        h.set(x, y, G[0])
    L.brim_shadow(h)
    return h


def dunce_cap():
    h = Hat()
    P = ramp5('#f4f0e6', dark=(110, 100, 120))
    for y in range(-13, 4):
        t = (y + 13) / 16
        half = 0.4 + t * 6.2
        cx = -1.5 + (3 - y) * -0.12  # tip leans back
        for x in range(int(cx - half), int(cx + half) + 1):
            k = 3 if x < cx - half * 0.3 else 2 if x < cx + half * 0.5 else 1
            h.set(x, y, P[k])
    # crumple seams
    for (x, y) in ((-3, -3), (-2, -4), (-2, -5), (0, -1), (1, -2), (-4, 1), (2, 1), (3, 2), (-1, -8)):
        h.set(x, y, P[0])
    # red PH scrawl
    R = (214, 40, 52)
    for (x, y) in ((0, -2), (0, -1), (0, 0), (1, -2), (1, -1), (3, -2), (3, -1), (3, 0), (4, -1), (5, -2), (5, 0)):
        h.set(x, y, R)
    h.set(-1, -14, P[3])
    L.brim_shadow(h, x0=-6, x1=5)
    return h


# ---------------------------------------------------------------- Uncommon
def traffic_cone():
    h = Hat()
    O = ramp5('#ff7a1a')
    for y in range(-11, 2):
        t = (y + 11) / 13
        half = 1.0 + t * 4.6
        for x in range(int(-0.5 - half), int(-0.5 + half) + 1):
            k = 3 if x < -2 else 2 if x < 2 else 1
            h.set(x, y, O[k])
    for y in (-6, -5, -1, 0):
        for x in range(-8, 8):
            if h.get(x, y)[3]:
                h.set(x, y, (250, 250, 245) if x < 1 else (200, 206, 214))
    # square base
    for x in range(-8, 8):
        h.set(x, 2, O[1] if x > -6 else O[2])
        h.set(x, 3, O[0])
    h.set(-1, -12, O[3])
    L.brim_shadow(h, x0=-6, x1=6)
    return h


def durian():
    h = Hat()
    G = ramp5('#7aa832', dark=(30, 40, 10))
    rows(h, [(-4, -3, 2), (-3, -5, 4), (-2, -6, 5), (-1, -7, 5), (0, -7, 6), (1, -7, 6), (2, -7, 6)], G)
    # spikes: little lit pyramids on a grid, plus spikes poking past the edge
    for y in range(-3, 2, 2):
        for x in range(-6 + (y % 4 == 1), 6, 3):
            if h.get(x, y)[3]:
                h.set(x, y, G[4])
                h.set(x + 1, y, G[1])
                h.set(x, y + 1, G[0])
    for (x, y) in ((-4, -5), (0, -6), (3, -5), (-7, -2), (6, -2), (-8, 0), (7, 0), (-2, -5)):
        h.set(x, y, G[3])
    # creamy flesh at the brim
    Y = ramp5('#ffd84a')
    for x in range(-7, 7):
        h.set(x, 3, Y[2] if x < 3 else Y[1])
    h.set(-6, 3, Y[3])
    L.brim_shadow(h, x0=-6, x1=6, y=4)
    return h


# ---------------------------------------------------------------- Rare
def ser_top_hat():
    h = Hat()
    K = ramp5('#2a2533', dark=(0, 0, 0), light=(160, 150, 200))
    Gd = ramp5('#f2b632')
    for y in range(-10, 2):
        for x in range(-5, 5):
            k = 3 if x == -5 else 2 if x < 1 else 1
            if x == 4:
                k = 0
            h.set(x, y, K[k])
    for x in range(-5, 5):
        h.set(x, -10, K[3] if x < 2 else K[2])
    for y in (-1, 0):
        for x in range(-5, 5):
            h.set(x, y, Gd[3 if y == -1 else 2] if x < 3 else Gd[1])
    for x in range(-8, 8):
        h.set(x, 2, K[2])
        h.set(x, 3, K[1] if x < 6 else K[0])
    h.set(-8, 2, K[3])
    h.set(7, 2, K[3])
    for y in (-8, -7, -6):
        h.set(-4, y, K[4])
    # monocle round the eye, chain down to the collar
    for (x, y) in ((2, 4), (3, 4), (1, 5), (4, 5), (1, 6), (4, 6), (1, 7), (4, 7), (2, 8), (3, 8)):
        h.set(x, y, Gd[3])
    for (x, y) in ((2, 5), (3, 5)):
        soft(h, x, y, (220, 240, 255), 90)
    for (x, y) in ((5, 8), (5, 9), (6, 10), (6, 11)):
        h.set(x, y, Gd[2])
    h.set(4, 4, WHITE)
    return h


def pumpkin():
    h = Hat()
    O = ramp5('#ff8a1c', dark=(90, 20, 10))
    ell(h, -0.5, 3.0, 7.4, 6.6, O)
    for x in (-4, -1, 2):
        for y in range(-3, 10):
            if h.get(x, y)[3]:
                h.set(x, y, mix(h.get(x, y)[:3], O[0], 0.45))
    # carved face, lit from inside
    Yl = (255, 230, 90)
    Yd = (230, 150, 30)
    for (x, y) in ((2, 1), (3, 1), (3, 0), (2, 2), (5, 1), (5, 0)):
        h.set(x, y, Yl)
    for (x, y) in ((0, 5), (1, 6), (2, 5), (3, 6), (4, 5), (5, 6), (1, 5), (3, 5), (5, 5)):
        h.set(x, y, Yd if y == 6 else Yl)
    # stem and a curly vine
    S = ramp5('#4f8a2a', dark=(20, 30, 10))
    for (x, y, k) in ((-1, -4, 2), (0, -4, 1), (-1, -5, 3), (0, -5, 2), (0, -6, 2), (1, -6, 1),
                      (-2, -4, 3), (-3, -5, 3), (-4, -5, 2), (-4, -4, 1)):
        h.set(x, y, S[k])
    soft(h, 6, 1, (255, 200, 80), 70)
    soft(h, 7, 5, (255, 200, 80), 60)
    return h


def gas_mask():
    h = Hat()
    G = ramp5('#8a92a0', dark=(30, 30, 50))
    Gr = ramp5('#4fae55', dark=(10, 40, 20))
    # strap over the skull
    for x in range(-5, 2):
        h.set(x, 1, (60, 52, 66))
    # mask body over the face
    rows(h, [(3, -1, 4), (4, -1, 5), (5, -1, 5), (6, -1, 5), (7, 0, 6), (8, 1, 6), (9, 2, 5)], G, cx=1.5, cy=5, rx=4, ry=4)
    # goggle lens over the eye
    for (x, y, c) in ((2, 5, (60, 200, 230)), (3, 5, (200, 250, 255)), (2, 6, (40, 140, 180)), (3, 6, (60, 200, 230))):
        h.set(x, y, c)
    for (x, y) in ((1, 4), (2, 4), (3, 4), (4, 4), (1, 5), (4, 5), (1, 6), (4, 6), (1, 7), (2, 7), (3, 7), (4, 7)):
        if (x, y) not in ((2, 5), (3, 5), (2, 6), (3, 6)):
            h.set(x, y, G[1])
    # round filter canister at the snout
    ell(h, 6.5, 8.5, 1.8, 1.8, ramp5('#5d6470', dark=(20, 20, 30)))
    h.set(7, 8, (40, 40, 50))
    h.set(6, 9, (40, 40, 50))
    # hose curling back to a green tank behind the head
    for (x, y) in ((5, 10), (4, 11), (2, 11), (0, 11), (-2, 10), (-4, 10), (-5, 9), (-6, 8)):
        h.set(x, y, (70, 74, 84))
        h.set(x + 1, y, (110, 116, 128)) if (x + 1, y) != (6, 10) else None
    rows(h, [(y, -9, -7) for y in range(2, 9)], Gr, cx=-8, cy=4, rx=2, ry=4)
    for x in (-9, -8, -7):
        h.set(x, 1, Gr[3] if x < -7 else Gr[2])
    h.set(-8, 0, (190, 190, 200))
    h.set(-8, 4, Gr[4])
    # copium bubbles drifting up from the filter
    for (x, y, a) in ((8, 5, 200), (9, 3, 150), (8, 1, 110)):
        h.set(x, y, (200, 255, 210), a)
    return h


def laser_eyes():
    h = Hat()
    K = ramp5('#2c2834', dark=(0, 0, 0), light=(140, 130, 170))
    for x in range(-4, 7):
        for y in (5, 6, 7):
            h.set(x, y, K[1] if y == 7 else K[2])
    for x in range(-4, 7):
        h.set(x, 4, K[3] if x < 2 else K[2])
    h.set(-4, 5, K[3])
    # slit glowing red over the eye
    for x in (1, 2, 3, 4):
        h.set(x, 6, (255, 60, 60))
    h.set(2, 6, (255, 220, 200))
    # beam forward, core plus glow
    for x in range(7, 20):
        a = max(40, 255 - (x - 7) * 14)
        h.set(x, 6, (255, 230, 220), a)
        h.soft.append((x, 5, (255, 60, 60, a // 3)))
        h.soft.append((x, 7, (255, 60, 60, a // 3)))
    spark(h, 19, 6, 1, (255, 120, 120))
    return h


def tengkolok():
    h = Hat()
    R = ramp5('#b81d34', dark=(40, 0, 20))
    Gd = ramp5('#f2c040')
    rows(h, [(-1, -6, 4), (0, -6, 5), (1, -6, 5), (2, -6, 5), (3, -6, 5)], R)
    # tall folded peak sweeping up and back
    peak = [(-2, -5, 3), (-3, -4, 3), (-4, -4, 2), (-5, -3, 2), (-6, -3, 1), (-7, -2, 1), (-8, -2, 0), (-9, -1, 0)]
    rows(h, peak, R, cx=-1, cy=-4, rx=4, ry=6)
    # gold songket diagonals and an edged rim
    for (y, x0, x1) in peak + [(-1, -6, 4), (0, -6, 5), (1, -6, 5), (2, -6, 5)]:
        for x in range(x0, x1 + 1):
            if (x + y) % 3 == 0:
                h.set(x, y, Gd[2] if x < 1 else Gd[1])
    for x in range(-6, 6):
        h.set(x, 3, Gd[3] if x < 2 else Gd[2])
    for y in range(-9, -1):
        x = [r for r in peak if r[0] == y]
        if x:
            h.set(x[0][2], y, Gd[3])
    h.set(0, -10, Gd[4])
    h.set(-1, -10, Gd[3])
    L.brim_shadow(h, x0=-5, x1=5)
    return h


def whale_hat():
    h = Hat()
    B = ramp5('#3a7bd5', dark=(10, 20, 60))
    rows(h, [(-4, -2, 3), (-3, -5, 5), (-2, -6, 6), (-1, -6, 7), (0, -6, 7), (1, -6, 7), (2, -6, 6)], B, cx=0, cy=-1, rx=7, ry=4)
    # white belly stripes along the lower front
    for (x, y) in ((1, 2), (2, 2), (3, 2), (4, 2), (5, 1), (6, 1), (7, 0), (2, 1), (4, 1)):
        h.set(x, y, (232, 240, 250) if y < 2 or x % 2 else (200, 214, 230))
    # eye and smile
    h.set(4, -1, BLACK)
    h.set(4, -2, WHITE)
    h.set(6, 0, B[0])
    # tail sticking out the back
    for (x, y, k) in ((-7, -1, 2), (-8, -2, 2), (-9, -3, 3), (-10, -4, 3), (-8, -3, 2), (-9, -1, 1),
                      (-10, 0, 1), (-11, -5, 3), (-11, 1, 0)):
        h.set(x, y, B[k])
    # spout
    C = (170, 230, 255)
    for (x, y) in ((1, -5), (1, -6), (1, -7), (0, -8), (2, -8), (-1, -9), (3, -9), (-2, -9), (4, -10)):
        h.set(x, y, C if y > -9 else WHITE)
    for x in range(-6, 7):
        h.set(x, 3, B[1])
    L.brim_shadow(h, x0=-5, x1=5)
    return h


# ---------------------------------------------------------------- Legendary
def siren():
    h = Hat()
    C = ramp5('#c8ccd8', dark=(40, 40, 60))
    R = ramp5('#ff2a2a', dark=(80, 0, 10))
    # chrome base clamp
    for y in (1, 2, 3):
        for x in range(-6, 6):
            h.set(x, y, C[3 if y == 1 else 2 if y == 2 else 1] if x < 3 else C[1])
    for x in (-4, -1, 2):
        h.set(x, 2, C[4])
    # red glass dome with a hot spot
    ell(h, -0.5, -1.5, 4.6, 5.2, R, only=lambda x, y: y <= 0)
    for (x, y) in ((-3, -4), (-2, -5), (-3, -3)):
        h.set(x, y, R[4])
    for (x, y) in ((-1, -2), (0, -2), (-1, -1), (0, -1)):
        h.set(x, y, (255, 240, 200))
    h.set(-1, -7, C[3])
    h.set(0, -7, C[2])
    # beams thrown left and right
    for i in range(3, 13):
        a = max(30, 200 - i * 16)
        for dy in (-1, 0, 1):
            h.soft.append((4 + i, -2 + dy - (i // 3) * (1 if dy < 0 else 0), (255, 80, 60, a // (2 if dy else 1))))
            h.soft.append((-5 - i, -2 + dy - (i // 3) * (1 if dy < 0 else 0), (255, 80, 60, a // (2 if dy else 1))))
    # chin strap
    for (x, y) in ((-5, 4), (-5, 5), (-4, 6), (-4, 7)):
        h.set(x, y, (70, 60, 70))
    return h


def galaxy_brain():
    h = Hat()
    P = ramp5('#ff7ab8', dark=(90, 20, 60))
    # pink brain bulging out of the skull
    ell(h, -0.5, -1.0, 6.2, 4.6, P, only=lambda x, y: y <= 2)
    for (x, y) in ((-4, -2), (-3, -3), (-2, -2), (-1, -3), (0, -2), (1, -3), (2, -2), (-5, 0), (-3, 0), (-2, 1),
                   (0, 0), (1, 1), (3, 0), (-1, -5), (1, -4), (3, -3)):
        h.set(x, y, P[0] if (x + y) % 2 else P[1])
    for (x, y) in ((-3, -4), (-4, -3), (-2, -5)):
        h.set(x, y, P[4])
    # glass dome over everything
    cx, cy, r = -0.5, 0.5, 9.0
    for y in range(-10, 4):
        for x in range(-11, 11):
            d = math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.05)
            if r - 1 < d <= r:
                lit = (x + 0.5 - cx) + (y + 0.5 - cy) < 0
                h.set(x, y, (230, 220, 255) if lit else (150, 130, 220), 230)
            elif d < r - 1 and not h.get(x, y)[3]:
                h.soft.append((x, y, (180, 160, 255, 30)))
    for (x, y) in ((-6, -5), (-5, -6), (-4, -7), (-7, -3)):
        h.set(x, y, WHITE, 230)
    for x in range(-9, 9):
        h.set(x, 3, (120, 110, 160) if x > 2 else (170, 160, 210))
    # orbiting stars
    for (x, y, s, c) in ((10, -8, 1, (255, 240, 160)), (-11, -6, 1, (200, 170, 255)), (7, -12, 0, WHITE),
                         (-8, -12, 0, (255, 200, 255)), (12, -2, 0, (200, 170, 255))):
        spark(h, x, y, s, c)
    return h


def storm_cloud():
    h = Hat()
    G = ramp5('#8a8fa6', dark=(30, 30, 50))
    for (cx, cy, rx, ry) in ((-4, -13, 3.6, 3.0), (0.5, -15, 4.2, 3.6), (5, -13, 3.4, 2.8), (0.5, -12, 7.6, 2.6)):
        ell(h, cx, cy, rx, ry, G)
    for x in range(-8, 9):
        if h.get(x, -10)[3]:
            h.set(x, -10, G[0])
    # lightning bolt
    Yb = (255, 238, 90)
    for (x, y) in ((2, -10), (1, -9), (2, -8), (1, -7), (0, -6), (1, -5), (0, -4)):
        h.set(x, y, Yb)
    h.set(0, -3, WHITE)
    # red numbers raining down
    Rd = (240, 60, 70)
    for (x, y) in ((-6, -8), (-6, -7), (-3, -6), (-3, -5), (4, -8), (4, -7), (6, -5), (6, -4), (-5, -3), (3, -3)):
        h.set(x, y, Rd)
    for (x, y) in ((-6, -9), (4, -9), (-3, -7), (6, -6)):
        h.set(x, y, (255, 150, 150))
    # damp hair: drops on the skull
    for (x, y) in ((-3, -1), (2, -1)):
        h.set(x, y, (120, 180, 255))
    return h


def geyser_crown():
    h = Hat()
    Gd = ramp5('#ffcf3d')
    for y in (1, 2, 3):
        for x in range(-6, 6):
            h.set(x, y, Gd[3] if y == 1 and x < 3 else Gd[2] if x < 4 else Gd[1])
    for (px, top) in ((-5, -2), (-2, -3), (1, -3), (4, -2)):
        for y in range(top, 1):
            h.set(px, y, Gd[3] if px < 0 else Gd[2])
            h.set(px + 1, y, Gd[2] if px < 0 else Gd[1])
        h.set(px, top - 1, Gd[4])
    for x in (-4, 2):
        h.set(x, 2, (255, 60, 90))
    h.set(-1, 2, (90, 220, 255))
    # nuggets fountaining up from the crown
    Ng = ramp5('#f0a020')
    for i, (x, y) in enumerate(((-1, -6), (-2, -9), (-1, -12), (1, -14), (3, -13), (5, -11), (6, -8), (7, -5),
                                (-4, -11), (-6, -9), (-7, -6))):
        h.set(x, y, Ng[3])
        h.set(x + 1, y, Ng[2])
        h.set(x, y + 1, Ng[1])
        h.set(x + 1, y + 1, Ng[0])
        if i % 3 == 0:
            h.set(x, y, WHITE)
    spark(h, 0, -16, 1, (255, 250, 200))
    spark(h, 9, -9, 1, (255, 250, 200))
    return h


def inferno_bowler():
    h = Hat()
    Br = ramp5('#6b4228', dark=(30, 10, 10))
    rows(h, [(-3, -3, 2), (-2, -4, 3), (-1, -5, 4), (0, -5, 4), (1, -5, 4)], Br)
    for x in range(-5, 5):
        h.set(x, 1, (40, 30, 30))
    for x in range(-8, 8):
        h.set(x, 2, Br[2] if x < 4 else Br[1])
        h.set(x, 3, Br[0])
    # flames licking up from the crown and brim
    flame = [
        (-9, -6, 0), (-5, -12, 0), (-1, -14, 0), (3, -12, 0), (7, -8, 0), (-7, -9, 0), (1, -10, 0), (6, -4, 1)]
    Fo, Fy, Fr = (255, 130, 30), (255, 230, 80), (220, 50, 30)
    for (tx, ty, _) in flame:
        for y in range(ty, 3):
            w = (y - ty) * 0.45
            for x in range(int(tx - w), int(tx + w) + 1):
                if not h.get(x, y)[3] or y < -2:
                    d = abs(x - tx) / max(0.6, w)
                    c = Fy if d < 0.35 and y > ty + 2 else Fo if d < 0.75 else Fr
                    if h.get(x, y)[3] and y >= -3:
                        continue
                    h.set(x, y, c)
    # the hat itself stays visible on top of the fire
    rows(h, [(-3, -3, 2), (-2, -4, 3), (-1, -5, 4), (0, -5, 4), (1, -5, 4)], Br)
    for x in range(-5, 5):
        h.set(x, 1, (40, 30, 30))
    for x in range(-8, 8):
        h.set(x, 2, Br[2] if x < 4 else Br[1])
        h.set(x, 3, Br[0])
    h.set(-3, -2, Br[4])
    for (x, y) in ((-6, -15), (2, -16), (5, -14)):
        h.set(x, y, (255, 180, 60), 200)
    return h


def rug_toupee():
    h = Hat()
    R = ramp5('#c0283a', dark=(50, 0, 20))
    Cr = (240, 220, 170)
    Nv = (40, 40, 90)
    # rug draped on the skull, front corner flipping up
    spec = [(-3, -5, 3), (-2, -6, 4), (-1, -7, 5), (0, -7, 5), (1, -7, 4), (-4, 2, 6), (-5, 4, 7)]
    rows(h, spec, R)
    # border and diamond pattern
    for (y, x0, x1) in spec:
        for x in range(x0, x1 + 1):
            if x in (x0, x1):
                h.set(x, y, Nv)
            elif (x + y) % 4 == 0:
                h.set(x, y, Cr)
            elif (x - y) % 4 == 0:
                h.set(x, y, (240, 180, 60))
    # tassels hanging off the back and front
    for (x, y) in ((-7, 2), (-7, 3), (-6, 2), (-6, 4), (-8, 1), (-8, 3)):
        h.set(x, y, Cr)
    for (x, y) in ((7, -6), (8, -6), (8, -7), (6, 2), (5, 3)):
        h.set(x, y, Cr)
    # dust puff where it lifts
    for (x, y) in ((9, -3), (10, -4), (9, -5), (11, -3)):
        h.soft.append((x, y, (230, 210, 180, 120)))
    return h


HEADS = [
    ('G007', 'Frog Eye Beanie', 'Common', frog_beanie),
    ('G015', 'Paper Dunce Cap', 'Common', dunce_cap),
    ('G050', 'Traffic Cone Hat', 'Uncommon', traffic_cone),
    ('G059', 'Durian Helmet', 'Uncommon', durian),
    ('G078', 'Ser Monocle Top Hat', 'Rare', ser_top_hat),
    ('G072', 'Hollow Pumpkin Head', 'Rare', pumpkin),
    ('G073', 'Copium Gas Mask', 'Rare', gas_mask),
    ('G069', 'Laser Eyes Visor', 'Rare', laser_eyes),
    ('G076', 'Tengkolok', 'Rare', tengkolok),
    ('G083', 'Whale Spout Hat', 'Rare', whale_hat),
    ('G087', 'Devs Do Something Siren', 'Legendary', siren),
    ('G088', 'Galaxy Brain Dome', 'Legendary', galaxy_brain),
    ('G090', 'Liquidation Storm Cloud', 'Legendary', storm_cloud),
    ('G091', 'Motherlode Geyser Crown', 'Legendary', geyser_crown),
    ('G093', 'This Is Fine Inferno Hat', 'Legendary', inferno_bowler),
    ('G092', 'Rug Toupee', 'Legendary', rug_toupee),
]


def build():
    out = []
    for (gid, name, rar, fn) in HEADS:
        h = fn()
        img, ax, ay = h.finish()
        out.append((gid, name, rar, img, ax, ay))
    return out

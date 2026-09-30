"""Pets and the wild mole. All full colour, 1px ink outline, lit from the top left.

build_pets()  -> {key: {'frames': [img...], 'ms', 'fly', 'ax', 'ay', 'light'}}
build_mole()  -> {'frames': [img...] (0-2 pop up, 3-4 peek), 'bonk': img, 'ax', 'ay'}
"""
import math

from PIL import Image

from actors_kit import INK, RAMPS, Frame, hexrgb, mix, outline_img

RAMPS['mole'] = [(66, 40, 30), (98, 62, 44), (138, 90, 60), (172, 122, 86), (204, 160, 120)]
RAMPS['pink'] = [(186, 70, 100), (236, 110, 140), (255, 150, 176), (255, 204, 216)]
RAMPS['bat'] = [(34, 24, 52), (52, 40, 82), (74, 58, 102), (104, 88, 138), (140, 124, 174)]
RAMPS['batwing'] = [(48, 30, 66), (78, 52, 100), (112, 80, 132), (150, 116, 170)]
RAMPS['gem'] = [(16, 96, 110), (30, 160, 160), (61, 224, 200), (150, 250, 230), (235, 255, 250)]
RAMPS['amethyst'] = [(90, 40, 150), (140, 80, 220), (184, 107, 255), (220, 170, 255)]
RAMPS['bug'] = [(30, 26, 34), (52, 46, 56), (80, 74, 84), (116, 110, 118)]
RAMPS['glow'] = [(120, 170, 60), (170, 220, 90), (199, 242, 132), (236, 255, 190), (255, 255, 235)]
RAMPS['hat'] = [(176, 112, 24), (230, 160, 40), (255, 200, 61), (255, 232, 140)]
RAMPS['dirt'] = [(60, 38, 26), (92, 60, 40), (126, 86, 56), (160, 116, 76), (192, 150, 104)]
RAMPS['hole'] = [(24, 14, 12), (38, 24, 18), (54, 36, 26)]
RAMPS['mask'] = [(26, 20, 30), (44, 36, 50)]
RAMPS['star'] = [(214, 150, 30), (255, 214, 74), (255, 248, 196)]


def finish(f):
    return f.render()['base']


def halo(img, rgb, cx, cy, r, amax):
    """Soft light baked behind a sprite (only where it is transparent)."""
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    px = out.load()
    for y in range(img.height):
        for x in range(img.width):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
            if d < 1:
                # banded falloff reads as pixel art rather than a smooth gradient
                a = amax * (1 - d) ** 1.4
                a = int(round(a / 18) * 18)
                if a > 0:
                    px[x, y] = (*rgb, min(255, a))
    out.alpha_composite(img)
    return out


# ---------------- baby mole ----------------
def pet_mole(t):
    f = Frame(15, 12)
    bob = (0, -1, 0, -1)[t]
    cy = 7.2 + bob
    f.blob(6.4, cy, 5.0, 3.6, 'mole', (1, 2, 2, 3), 'body')
    # snout
    f.blob(11.0, cy + 0.6, 1.8, 1.3, 'mole', (2, 3, 3), 'body')
    f.put(12, int(cy), 'pink', 2, 'nose')
    f.put(13, int(cy), 'pink', 1, 'nose')
    f.put(12, int(cy) - 1, 'pink', 3, 'nose')
    # belly
    for x in range(5, 10):
        f.put(x, int(cy + 2.4), 'mole', 3, 'body')
    # eye (tiny, happy)
    f.put(9, int(cy) - 1, 'eye', 0, 'face')
    f.put(8, int(cy), 'pink', 3, 'face')  # blush
    # paws: scurry cycle
    fx = ((10, 4), (9, 5), (10, 4), (11, 3))[t]
    for x in fx:
        f.put(x, 11 if x in (10, 11, 9) else 11, 'pink', 2, 'paw')
    f.put(fx[0], 10, 'pink', 3, 'paw')
    f.put(fx[1], 10, 'mole', 1, 'paw')
    # tail flick
    f.put(1, int(cy) - (1 if t % 2 else 0), 'mole', 1, 'tail')
    # tiny hardhat
    hx, hy = 7, int(cy) - 5
    for x in range(hx - 1, hx + 3):
        f.put(x, hy + 1, 'hat', 2, 'hat')
    for x in range(hx, hx + 2):
        f.put(x, hy, 'hat', 3, 'hat')
    for x in range(hx - 2, hx + 5):
        f.put(x, hy + 2, 'hat', 1 if x > hx + 2 else 2, 'hat')
    f.put(hx + 3, hy + 1, 'white', 1, 'hat')
    return finish(f)


# ---------------- cave bat (front view, flapping) ----------------
WING = {
    # per frame: list of (x, y) for the left wing membrane tip path; mirrored
    0: [(1, 1), (2, 2), (3, 3), (4, 4)],     # up
    1: [(0, 5), (1, 5), (2, 5), (3, 5)],     # level
    2: [(1, 9), (2, 8), (3, 7), (4, 6)],     # down
    3: [(0, 5), (1, 5), (2, 5), (3, 5)],
}


def pet_bat(t):
    W, H = 17, 13
    f = Frame(W, H)
    cx = 8
    by = (1, 0, 0, 0)[t] + 5
    # wings: a filled fan from the shoulder to the tip line, scalloped bottom
    tips = {0: (1, 0), 1: (0, 4), 2: (1, 9), 3: (0, 5)}[t]
    for side in (-1, 1):
        sx, sy = cx + side * 2, by + 1
        tx, ty = cx + side * (cx - tips[0]), tips[1] + (by - 5)
        # membrane polygon: shoulder, tip, lower scallops back to the hip
        pts = [(sx, sy - 1), (tx, ty), (tx - side * 1, ty + 3), (sx + side * 3, sy + 3), (sx, sy + 3)]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        for y in range(min(ys), max(ys) + 1):
            for x in range(min(xs), max(xs) + 1):
                from actors_kit import bresenham  # noqa
                if _inside(pts, x + 0.5, y + 0.5):
                    tone = 2 if y < sy + 1 else 1
                    f.put(x, y, 'batwing', tone, 'wing')
        # finger bones
        for (x, y) in _line((sx, sy), (tx, ty)):
            f.put(x, y, 'batwing', 3, 'bone')
    # body + head
    f.blob(cx + 0.5, by + 2.2, 2.6, 3.0, 'bat', (1, 2, 3), 'body')
    f.blob(cx + 0.5, by - 0.4, 2.8, 2.4, 'bat', (1, 2, 3, 4), 'body')
    # ears
    for side in (-1, 1):
        ex = cx + (2 if side > 0 else -1)
        f.put(ex, by - 3, 'bat', 3, 'body')
        f.put(ex, by - 4, 'bat', 2, 'body')
        f.put(ex + (1 if side > 0 else 0) - (0 if side > 0 else 0), by - 3, 'pink', 1, 'body')
    # eyes, fangs
    f.put(cx - 1, by - 1, 'star', 1, 'face')
    f.put(cx + 2, by - 1, 'star', 1, 'face')
    f.put(cx - 1, by - 2, 'star', 2, 'face')
    f.put(cx + 2, by - 2, 'star', 2, 'face')
    f.put(cx, by + 1, 'white', 1, 'face')
    f.put(cx + 1, by + 1, 'white', 1, 'face')
    return finish(f)


def _inside(pts, x, y):
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


def _line(a, b):
    from actors_kit import bresenham
    return bresenham(a, b)


# ---------------- gem sprite ----------------
def pet_sprite(t):
    W, H = 15, 17
    f = Frame(W, H)
    bob = (0, -1, -1, 0)[t]
    cx, top = 7, 2 + bob
    # an elongated octahedron: rows of (half width) from the top point down
    widths = [0, 1, 2, 3, 4, 4, 3, 3, 2, 2, 1, 0]
    for j, hw in enumerate(widths):
        y = top + j
        for x in range(cx - hw, cx + hw + 1):
            left = x < cx
            upper = j < 5
            tone = 3 if (left and upper) else 2 if (upper or left) else 1
            if x == cx:
                tone = 2 if upper else 1
            f.put(x, y, 'gem', tone, 'gem')
    # girdle line
    for x in range(cx - 4, cx + 5):
        f.put(x, top + 5, 'gem', 4 if x < cx else 3, 'gem')
    # amethyst heart
    f.put(cx, top + 6, 'amethyst', 2, 'core')
    f.put(cx - 1, top + 7, 'amethyst', 1, 'core')
    f.put(cx + 1, top + 7, 'amethyst', 1, 'core')
    f.put(cx, top + 7, 'amethyst', 3, 'core')
    f.put(cx, top + 8, 'amethyst', 1, 'core')
    # face
    f.put(cx - 2, top + 4, 'eye', 0, 'face')
    f.put(cx + 2, top + 4, 'eye', 0, 'face')
    # shimmer: a bright facet stripe sweeping left to right
    sx = cx - 3 + t * 2
    for k in range(3):
        x, y = sx + k - 1, top + 2 + k
        p = f.get(x, y)
        if p and p[3] == 'gem':
            f.put(x, y, 'white', 1, 'gem')
    img = finish(f)
    # orbiting sparkle
    px = img.load()
    ox, oy = [(1, 6), (4, 1), (13, 4), (12, 12)][t]
    oy += bob
    for (dx, dy, a) in ((0, 0, 255), (1, 0, 150), (-1, 0, 150), (0, 1, 150), (0, -1, 150)):
        X, Y = ox + dx, oy + dy
        if 0 <= X < W and 0 <= Y < H and px[X, Y][3] == 0:
            px[X, Y] = (220, 190, 255, a)
    return halo(img, (61, 224, 200), cx + 0.5, top + 6, 8.5, 70)


# ---------------- firefly ----------------
RAMPS['ember'] = [(150, 52, 30), (214, 92, 44), (250, 140, 70)]
RAMPS['wingglass'] = [(170, 200, 220), (214, 236, 246), (250, 255, 255)]


def pet_firefly(t):
    W, H = 19, 19
    f = Frame(W, H)
    bob = (0, -1, 0, 1)[t]
    cy = 10 + bob
    # glowing abdomen at the back, lit from inside (brightest at its core)
    f.blob(6.4, cy + 0.8, 3.1, 2.6, 'glow', (2, 3, 3, 4), 'abdomen', light=(0.3, -0.2))
    f.put(5, int(cy) + 1, 'glow', 4, 'abdomen')
    f.put(6, int(cy) + 1, 'glow', 4, 'abdomen')
    f.put(6, int(cy), 'glow', 4, 'abdomen')
    # banded segments
    for y in range(int(cy) - 1, int(cy) + 3):
        p = f.get(8, y)
        if p and p[3] == 'abdomen':
            f.put(8, y, 'glow', 1, 'abdomen')
    # thorax with the firefly's orange collar, then the head
    f.blob(10.0, cy - 0.2, 1.7, 1.7, 'bug', (1, 2, 3), 'thorax')
    f.blob(12.6, cy - 0.9, 2.1, 2.0, 'bug', (1, 2, 3), 'head')
    for (x, y, t2) in ((10, -2, 2), (11, -2, 1), (9, -1, 1)):
        f.put(x, int(cy) + y, 'ember', t2, 'thorax')
    # big friendly eye
    f.put(13, int(cy) - 2, 'white', 1, 'eye')
    f.put(14, int(cy) - 2, 'white', 0, 'eye')
    f.put(14, int(cy) - 1, 'eye', 0, 'eye')
    f.put(13, int(cy) - 1, 'white', 0, 'eye')
    # antennae curling forward
    for (x, y) in ((13, -4), (14, -5), (15, -5), (12, -4), (12, -5)):
        f.put(x, int(cy) + y, 'bug', 2, 'ant')
    f.put(16, int(cy) - 4, 'glow', 3, 'ant')
    # legs
    for x in (9, 11):
        f.put(x, int(cy) + 2, 'bug', 1, 'leg')
    # wings flick between up and back
    wy = int(cy) - 3
    if t % 2 == 0:
        cells = [(8, wy - 2), (9, wy - 2), (7, wy - 1), (8, wy - 1), (9, wy - 1), (10, wy - 1), (8, wy), (9, wy)]
    else:
        cells = [(4, wy + 1), (5, wy), (6, wy), (7, wy), (8, wy), (5, wy + 1), (6, wy + 1), (7, wy + 1)]
    for (x, y) in cells:
        f.put(x, y, 'wingglass', 1, 'wing')
    f.put(cells[0][0], cells[0][1], 'wingglass', 2, 'wing')
    img = finish(f)
    pulse = (110, 140, 170, 140)[t]
    return halo(img, (199, 242, 132), 6.5, cy + 1.3, 9.5, pulse)


PETS = {
    'pet-mole': dict(fn=pet_mole, ms=120, fly=False, light=None),
    'pet-bat': dict(fn=pet_bat, ms=90, fly=True, light=None),
    'pet-sprite': dict(fn=pet_sprite, ms=160, fly=True, light='#3de0c8'),
    'pet-firefly': dict(fn=pet_firefly, ms=130, fly=True, light='#c7f284'),
}


def build_pets():
    out = {}
    for key, spec in PETS.items():
        frames = [spec['fn'](t) for t in range(4)]
        w, h = frames[0].size
        # ground pets stand on their feet; flyers hover about their middle
        ax = w // 2
        ay = h - 1 if not spec['fly'] else h // 2
        out[key] = dict(frames=frames, ms=spec['ms'], fly=spec['fly'], ax=ax, ay=ay, light=spec['light'])
    return out


# ---------------- wild mole (whack-a-mole) ----------------
MW, MH = 22, 20
HOLE = (11, 16)  # anchor: centre of the hole


def mole_body(f, rise, eyes='open', look=0, squash=0.0):
    """Paint the mole with its head `rise` px above the hole line."""
    hx, hy = HOLE
    cy = hy - rise + 2
    rx = 5.2 + squash * 2.2
    ry = 5.6 - squash * 2.6
    f.blob(hx + 0.5, cy, rx, ry, 'mole', (1, 2, 2, 3, 4), 'body')
    top = cy - ry
    # pale muzzle
    f.blob(hx + 0.5 + look, cy + 1.2 - squash, 2.6 + squash, 1.8 - squash * 0.6, 'mole', (3, 4, 4), 'muzzle')
    # bandit mask across the eyes
    my = int(round(cy - 1.6 + squash))
    for x in range(int(hx - rx + 1.2), int(hx + rx + 0.2)):
        p = f.get(x, my)
        if p and p[3] in ('body', 'muzzle'):
            f.put(x, my, 'mask', 1 if x < hx else 0, 'mask')
    for x in range(int(hx - 3 + look), int(hx + 5 + look)):
        p = f.get(x, my - 1)
        if p and p[3] in ('body',):
            f.put(x, my - 1, 'mask', 1, 'mask')
    # eyes in the mask
    ex1, ex2 = hx - 2 + look, hx + 3 + look
    if eyes == 'open':
        f.put(ex1, my, 'white', 1, 'eye')
        f.put(ex2, my, 'white', 1, 'eye')
        f.put(ex1, my - 1, 'white', 0, 'eye')
        f.put(ex2, my - 1, 'white', 0, 'eye')
    elif eyes == 'blink':
        f.put(ex1, my, 'white', 0, 'eye')
        f.put(ex2, my, 'white', 0, 'eye')
    elif eyes == 'x':
        for ex in (ex1, ex2):
            for (dx, dy) in ((-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)):
                f.put(ex + dx, my + dy, 'white', 1, 'eye')
    # nose + teeth
    ny = int(round(cy + 0.2 - squash))
    f.put(hx + look, ny, 'pink', 2, 'nose')
    f.put(hx + 1 + look, ny, 'pink', 1, 'nose')
    f.put(hx + look, ny - 1, 'pink', 3, 'nose')
    if squash < 0.5:
        f.put(hx + look, ny + 2, 'white', 1, 'teeth')
        f.put(hx + 1 + look, ny + 2, 'white', 0, 'teeth')
    # ears / tufts
    f.put(hx - 3, int(top) + 1, 'mole', 3, 'body')
    f.put(hx + 4, int(top) + 1, 'mole', 2, 'body')
    return cy


def hole_back(f):
    hx, hy = HOLE
    f.blob(hx + 0.5, hy + 0.2, 7.4, 2.4, 'hole', (0, 1, 1), 'hole')
    # back rim of the mound
    for x in range(hx - 7, hx + 9):
        d = abs(x + 0.5 - hx - 0.5) / 8
        y = int(round(hy - 2.2 + d * d * 1.6))
        f.put(x, y, 'dirt', 3 if x < hx else 2, 'rim-b')


def hole_front(f):
    hx, hy = HOLE
    for x in range(hx - 8, hx + 10):
        d = (x + 0.5 - hx - 0.5) / 8.6
        if abs(d) > 1:
            continue
        y0 = int(round(hy + 1.2 + (1 - d * d) * 1.0))
        top = int(round(hy + 0.4 + d * d * 0.8))
        for y in range(top, y0 + 1):
            tone = 3 if y == top else 2 if y < y0 else 1
            if x > hx + 4:
                tone -= 1
            f.put(x, y, 'dirt', tone, 'rim')
    # a few clods on the rim
    for (x, y, t) in ((hx - 6, hy + 1, 4), (hx - 2, hy + 2, 1), (hx + 4, hy + 1, 3), (hx + 7, hy + 2, 1)):
        f.put(x, y, 'dirt', t, 'rim')


def claws(f, rise):
    hx, hy = HOLE
    if rise < 6:
        return
    for x0 in (hx - 4, hx + 3):
        for k in range(3):
            f.put(x0 + k, hy + 1, 'pink', 3 if k == 0 else 2, 'claw')
        f.put(x0 + 1, hy, 'pink', 2, 'claw')


def clip_below(f, y):
    for yy in range(y, f.h):
        for x in range(f.w):
            p = f.get(x, yy)
            if p and p[3] in ('body', 'muzzle', 'mask', 'eye', 'nose', 'teeth'):
                f.erase(x, yy)


def mole_frame(rise, eyes='open', look=0, dirt=False):
    f = Frame(MW, MH)
    hole_back(f)
    mole_body(f, rise, eyes, look)
    clip_below(f, HOLE[1] + 1)
    hole_front(f)
    claws(f, rise)
    img = finish(f)
    if dirt:
        px = img.load()
        for (x, y, t) in ((3, 9, 3), (19, 8, 2), (5, 5, 2), (17, 4, 3), (2, 12, 1), (20, 11, 1)):
            px[x, y] = (*RAMPS['dirt'][t], 255)
    return img


def mole_bonk():
    f = Frame(MW, MH)
    hole_back(f)
    mole_body(f, 5, 'x', 0, squash=0.8)
    clip_below(f, HOLE[1] + 1)
    hole_front(f)
    claws(f, 8)
    img = finish(f)
    px = img.load()
    # stars circling above, and a bump
    for (sx, sy) in ((5, 4), (11, 2), (17, 5)):
        for (dx, dy, t) in ((0, 0, 2), (1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1)):
            px[sx + dx, sy + dy] = (*RAMPS['star'][t], 255)
    img = outline_img(img)
    return img


def build_mole():
    frames = [
        mole_frame(3, 'open', 0, dirt=True),   # 0 nose breaks the surface
        mole_frame(7, 'open', 0),              # 1 half out
        mole_frame(11, 'open', 0),             # 2 fully up (a touch of stretch)
        mole_frame(10, 'open', -1),            # 3 peek: look back
        mole_frame(10, 'blink', 1),            # 4 peek: blink, look forward
    ]
    return dict(frames=frames, bonk=mole_bonk(), ax=HOLE[0], ay=HOLE[1])

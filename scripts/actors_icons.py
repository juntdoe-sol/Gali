"""Shop icons for every gear item (React Native UI, not the atlas).

Each icon is drawn at 20x20 with a 1px ink outline and saved 4x nearest
neighbour to app/assets/gear/<key>.png. app/src/ui/gearIcons.ts maps each key to
a static require() because React Native needs literal asset paths.
"""
import math
import os

from PIL import Image

from actors_kit import INK, hexrgb, mix, outline_img

N = 20
SCALE = 4


def ramp(hexcol, n=5, dark=(24, 14, 40), light=(255, 252, 236)):
    c = hexrgb(hexcol) if isinstance(hexcol, str) else hexcol
    return [mix(c, dark, 0.62), mix(c, dark, 0.32), c, mix(c, light, 0.42), mix(c, light, 0.78)][:n]


class Icon:
    def __init__(self):
        self.img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        self.px = self.img.load()
        self.part = {}

    def set(self, x, y, col, part=None, a=255):
        x, y = int(math.floor(x)), int(math.floor(y))
        if 0 <= x < N and 0 <= y < N:
            self.px[x, y] = (*col[:3], a)
            if part:
                self.part[(x, y)] = part

    def get(self, x, y):
        if 0 <= x < N and 0 <= y < N:
            return self.px[x, y]
        return (0, 0, 0, 0)

    def bevel(self, part, R, base=2):
        cells = [k for k, v in self.part.items() if v == part]
        S = set(cells)
        for (x, y) in cells:
            tl = ((x - 1, y) in S) + ((x, y - 1) in S)
            br = ((x + 1, y) in S) + ((x, y + 1) in S)
            t = base + (1 if tl < 2 and br == 2 else -1 if br < 2 and tl == 2 else 0)
            self.set(x, y, R[max(0, min(len(R) - 1, t))], part)

    def done(self, glow=None):
        img = outline_img(self.img)
        if glow:
            g = Image.new('RGBA', img.size, (0, 0, 0, 0))
            gp, ip = g.load(), img.load()
            for y in range(N):
                for x in range(N):
                    if ip[x, y][3]:
                        continue
                    best = 9
                    for yy in range(max(0, y - 2), min(N, y + 3)):
                        for xx in range(max(0, x - 2), min(N, x + 3)):
                            if ip[xx, yy][3] and ip[xx, yy][:3] != INK:
                                best = min(best, math.hypot(xx - x, yy - y))
                    if best <= 2.3:
                        gp[x, y] = (*glow, 110 if best < 1.5 else 55)
            g.alpha_composite(img)
            img = g
        return img


# ---------------- pickaxes ----------------
D = (0.7071, -0.7071)      # handle direction, butt (bottom left) to head (top right)
PV = (0.7071, 0.7071)      # across the head
J = (13.2, 6.8)


def handle(ic, color, wrap=None, ferrule=None, r=0.95, start=(3.2, 16.8), J=J):
    W = ramp(color, 4)
    for y in range(N):
        for x in range(N):
            px, py = x + 0.5, y + 0.5
            ax, ay = start
            bx, by = J[0] - D[0] * 0.6, J[1] - D[1] * 0.6
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            qx, qy = ax + dx * t, ay + dy * t
            if math.hypot(px - qx, py - qy) <= r:
                side = (px - qx) * -0.7 + (py - qy) * -0.7
                col = W[3] if side > 0.25 else W[1] if side < -0.25 else W[2]
                if wrap and 0.08 < t < 0.3 and int((t * 30)) % 2 == 0:
                    col = wrap
                if ferrule and 0.9 < t:
                    col = ferrule
                ic.set(x, y, col, 'handle')


def head_mask(fn, R, J=J):
    cells = []
    for y in range(N):
        for x in range(N):
            qx, qy = x + 0.5 - J[0], y + 0.5 - J[1]
            u = qx * D[0] + qy * D[1]
            v = qx * PV[0] + qy * PV[1]
            if fn(u, v):
                cells.append((x, y, u, v))
    return cells


def paint_head(ic, cells, R, spec=None):
    for (x, y, u, v) in cells:
        ic.set(x, y, R[2], 'head')
    ic.bevel('head', R)
    if spec:
        for (x, y) in spec:
            ic.set(x, y, R[4], 'head')


def pick_std(ic, accent, reach=6.0, th0=1.35, curve=0.055, blunt=0.0):
    R = ramp(accent)

    def inside(u, v):
        k = abs(v) / reach
        mid = -curve * v * v + 0.4
        th = th0 * (1 - k) + blunt * k + 0.25
        return abs(u - mid) <= th and abs(v) <= reach
    cells = head_mask(inside, R)
    paint_head(ic, cells, R)
    return R


def icon_pick_wood(g):
    ic = Icon()
    handle(ic, g['color'], wrap=None)
    R = pick_std(ic, g['accent'], reach=5.3, th0=1.55, curve=0.07, blunt=0.35)
    # speckled stone + rope lashing across the joint
    for (x, y) in ((11, 5), (14, 8), (10, 3), (15, 10)):
        if ic.get(x, y)[3]:
            ic.set(x, y, R[1], 'head')
    rope = [(196, 160, 100), (150, 116, 66)]
    for (x, y, k) in ((12, 8, 0), (13, 9, 1), (11, 7, 1), (12, 7, 1), (13, 8, 0)):
        ic.set(x, y, rope[k], 'rope')
    return ic.done()


def icon_pick_iron(g):
    ic = Icon()
    handle(ic, g['color'], ferrule=ramp(g['accent'])[1])
    R = pick_std(ic, g['accent'], reach=6.3, th0=1.35, curve=0.05)
    ic.set(10, 5, R[4], 'head')
    ic.set(9, 4, R[4], 'head')
    return ic.done()


def icon_pick_gold(g):
    ic = Icon()
    handle(ic, g['color'], ferrule=(255, 214, 74), wrap=(255, 200, 61))
    R = pick_std(ic, g['accent'], reach=6.2, th0=1.7, curve=0.06)
    ic.set(10, 4, R[4], 'head')
    ic.set(11, 4, R[4], 'head')
    img = ic.done()
    return sparkle(img, [(4, 4), (17, 14)], (255, 244, 180))


def icon_pick_gem(g):
    ic = Icon()
    handle(ic, g['color'], wrap=ramp(g['accent'])[1])
    R = ramp(g['accent'])
    reach = 6.4

    def inside(u, v):
        # faceted: straight edges, widest a little off centre, sharp tips
        k = abs(v) / reach
        th = 2.2 * (1 - k) + 0.35
        return abs(v) <= reach and abs(u - 0.5 + 0.03 * v * v) <= th
    cells = head_mask(inside, R)
    for (x, y, u, v) in cells:
        facet = (u - 0.5 + 0.03 * v * v) < 0
        band = int((v + 8) // 2.6) % 2
        t = 3 if not facet else 1
        if band and t == 3:
            t = 4
        ic.set(x, y, R[t], 'head')
    # amethyst core at the joint
    for (x, y) in ((13, 6), (12, 7)):
        ic.set(x, y, (184, 107, 255), 'head')
    img = ic.done()
    return sparkle(img, [(16, 3), (5, 11)], (230, 255, 250))


def icon_pick_neon(g):
    ic = Icon()
    handle(ic, g['color'], wrap=(255, 79, 216), start=(2.6, 17.4))
    P = ramp(g['accent'])
    B = ramp(g['color'])
    # drill housing: a chunky collar across the joint
    for y in range(N):
        for x in range(N):
            qx, qy = x + 0.5 - J[0], y + 0.5 - J[1]
            u = qx * D[0] + qy * D[1]
            v = qx * PV[0] + qy * PV[1]
            if -1.6 <= u <= 0.8 and abs(v) <= 2.6:
                ic.set(x, y, B[3] if v < 0 else B[2], 'body')
                if abs(u + 0.4) < 0.5:
                    ic.set(x, y, P[3], 'body')
            # the bit: a cone with a glowing spiral
            if 0.8 < u <= 7.6:
                rad = 2.3 * (1 - (u - 0.8) / 7.0) + 0.2
                if abs(v) <= rad:
                    stripe = (u * 1.3 + v * 0.9) % 2.0 < 1.0
                    col = P[3] if stripe else P[1]
                    if v < -rad + 0.8 and stripe:
                        col = P[4]
                    ic.set(x, y, col, 'bit')
    img = ic.done(glow=hexrgb(g['accent']))
    return sparkle(img, [(3, 5), (17, 16)], (255, 190, 240))


def icon_pick_seeker(g):
    ic = Icon()
    Js = (12.0, 8.2)
    handle(ic, g['color'], wrap=hexrgb(g['accent']), ferrule=ramp(g['accent'])[1], start=(2.8, 17.4), J=Js)
    L = ramp(g['accent'])

    def inside(u, v):
        if v < 0:   # the splitter blade: a flared axe bit with a curved edge
            k = -v / 6.4
            if k > 1.0 + 0.08 * (u * u) * -1 + 0.0:
                return False
            edge = 6.4 - 0.18 * u * u        # convex cutting edge
            if -v > edge:
                return False
            return -0.8 - 3.2 * k * k <= u <= 0.8 + 2.6 * k * k
        else:       # the back spike, long and sharp
            return v <= 5.0 and abs(u - 0.1) <= 0.85 * (1 - v / 5.0) + 0.2
    cells = head_mask(inside, L, J=Js)
    for (x, y, u, v) in cells:
        ic.set(x, y, L[2], 'head')
    ic.bevel('head', L)
    # the split: a dark notch down the middle of the blade
    for (x, y, u, v) in cells:
        if -5.0 < v < -1.6 and abs(u + 0.1) < 0.45:
            ic.set(x, y, L[0], 'head')
        if -v > 6.4 - 0.18 * u * u - 1.0:
            ic.set(x, y, L[4], 'head')
    img = ic.done(glow=hexrgb(g['accent']))
    return sparkle(img, [(3, 3), (17, 17)], (230, 255, 190))


def sparkle(img, pts, col):
    px = img.load()
    for (sx, sy) in pts:
        for (dx, dy, a) in ((0, 0, 255), (1, 0, 170), (-1, 0, 170), (0, 1, 170), (0, -1, 170)):
            x, y = sx + dx, sy + dy
            if 0 <= x < N and 0 <= y < N and px[x, y][3] == 0:
                px[x, y] = (*col, a)
    return img


# ---------------- outfits (front view overalls) ----------------
def icon_outfit(g):
    ic = Icon()
    R = ramp(g['color'])
    A = hexrgb(g['accent'])
    key = g['key']
    # straps
    for y in range(1, 7):
        for x in (5, 6, 13, 14):
            ic.set(x, y, R[3] if x in (5, 13) else R[2], 'fit')
    # bib, waist, legs
    for y in range(5, 11):
        for x in range(6, 14):
            ic.set(x, y, R[2], 'fit')
    for y in range(10, 13):
        for x in range(4, 16):
            ic.set(x, y, R[2], 'fit')
    for y in range(13, 19):
        for x in list(range(4, 9)) + list(range(11, 16)):
            ic.set(x, y, R[2], 'fit')
    for x in (9, 10):
        ic.set(x, 13, R[2], 'fit')
    ic.bevel('fit', R)
    # cuffs
    for x in list(range(4, 9)) + list(range(11, 16)):
        ic.set(x, 18, R[1])
    # pocket on the bib
    for x in range(8, 12):
        ic.set(x, 7, R[1])
    ic.set(8, 8, R[1])
    ic.set(11, 8, R[1])
    stitch = A
    if key == 'fit-batik':
        # batik: little accent flowers and dots on a grid
        for (cx, cy) in ((7, 11), (12, 11), (6, 15), (13, 15), (9, 9), (6, 17), (13, 17), (10, 6)):
            ic.set(cx, cy, A)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if ic.get(cx + dx, cy + dy)[3]:
                    ic.set(cx + dx, cy + dy, mix(A, R[1], 0.45))
        for (x, y) in ((9, 12), (10, 12), (4, 13), (15, 13), (8, 16), (11, 16)):
            ic.set(x, y, mix(A, R[2], 0.3))
    elif key == 'fit-hazard':
        # reflective bands: lime-yellow with a silver core
        for y in (11, 16):
            for x in range(4, 16):
                if ic.get(x, y)[3]:
                    ic.set(x, y, A)
                    if (x + y) % 3 == 0:
                        ic.set(x, y, (240, 250, 255))
        for y in range(1, 7):
            ic.set(5, y, A)
            ic.set(13, y, A)
    elif key == 'fit-gold':
        # polished gold: diagonal shine streaks
        for k in range(0, 3):
            for t in range(6):
                x, y = 5 + k * 4 + t, 5 + t * 2 - k
                for yy in (y, y + 1):
                    p = ic.get(x, yy)
                    if p[3]:
                        ic.set(x, yy, R[4] if t % 3 else R[3])
    elif key == 'fit-khaki':
        # field pockets on the thighs
        for (x0, y0) in ((5, 14), (12, 14)):
            for x in range(x0, x0 + 3):
                ic.set(x, y0, R[1])
            ic.set(x0, y0 + 1, R[1])
            ic.set(x0 + 2, y0 + 1, R[1])
            ic.set(x0 + 1, y0 + 1, stitch)
    else:
        # contrast stitching down the legs
        for y in range(14, 18, 2):
            ic.set(6, y, stitch)
            ic.set(13, y, stitch)
    # buttons
    for x in (6, 13):
        ic.set(x, 5, (255, 214, 90))
    return ic.done()


# ---------------- helmets / pets reuse the game sprites ----------------
def centred(img):
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    bbox = img.getbbox()
    img = img.crop(bbox)
    if img.width > N or img.height > N:
        img = img.resize((min(N, img.width), min(N, img.height)), Image.NEAREST)
    out.alpha_composite(img, ((N - img.width) // 2, (N - img.height) // 2))
    return out


PICKS = {
    'pick-wood': icon_pick_wood, 'pick-iron': icon_pick_iron, 'pick-gold': icon_pick_gold,
    'pick-gem': icon_pick_gem, 'pick-neon': icon_pick_neon, 'pick-seeker': icon_pick_seeker,
}


def build_icons(gear, hats, pets):
    """gear: list of dicts (key, kind, color, accent). Returns {key: 20x20 img}."""
    out = {}
    for g in gear:
        k = g['key']
        if g['kind'] == 'pickaxe':
            out[k] = PICKS[k](g)
        elif g['kind'] == 'helmet':
            out[k] = centred(hats[k][0])
        elif g['kind'] == 'outfit':
            out[k] = icon_outfit(g)
        elif g['kind'] == 'pet':
            out[k] = centred(pets[k]['frames'][0])
    return out


def write_icons(icons, root):
    d = os.path.join(root, 'app/assets/gear')
    os.makedirs(d, exist_ok=True)
    for k, img in icons.items():
        img.resize((N * SCALE, N * SCALE), Image.NEAREST).save(os.path.join(d, f'{k}.png'), optimize=True)
    lines = [
        '// Generated by scripts/actors.py (scripts/pixel-art.py). Do not edit by hand.',
        '// Pixel-art shop icons, one per gear key. React Native needs literal require() paths.',
        'export const GEAR_ICON: Record<string, number> = {',
    ]
    for k in icons:
        lines.append(f"  '{k}': require('../../assets/gear/{k}.png'),")
    lines.append('};')
    ts = os.path.join(root, 'app/src/ui/gearIcons.ts')
    with open(ts, 'w') as f:
        f.write('\n'.join(lines) + '\n')


def read_gear(root):
    """Parse the GEAR list out of app/src/game/constants.ts (key/kind/color/accent)."""
    import re
    src = open(os.path.join(root, 'app/src/game/constants.ts')).read()
    body = src[src.index('export const GEAR: Gear[]'):]
    body = body[:body.index('];')]
    out = []
    for m in re.finditer(r"\{[^{}]*key: '([^']+)'[^{}]*kind: '([^']+)'[^{}]*color: '(#[0-9a-fA-F]{6})'[^{}]*accent: '(#[0-9a-fA-F]{6})'", body):
        out.append(dict(key=m.group(1), kind=m.group(2), color=m.group(3), accent=m.group(4)))
    return out

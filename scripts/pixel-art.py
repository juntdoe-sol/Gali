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
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import island  # noqa: E402  the board itself; see scripts/island.py

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app/assets/pixel')
SCALE = 4

# ---------------- palette ----------------
INK = (42, 28, 20, 255)
DIRT = [(107, 70, 48), (132, 90, 56), (155, 107, 67), (176, 124, 79), (196, 146, 98)]
STONE = [(62, 64, 74), (86, 90, 101), (120, 125, 136), (160, 166, 176), (200, 205, 212)]
GOLD = [(150, 96, 22), (200, 132, 32), (242, 182, 50), (255, 215, 74), (255, 243, 168)]
WOOD = [(78, 48, 28), (110, 68, 40), (138, 90, 54), (168, 116, 74)]
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
    island_meta = island.build(OUT, SCALE)
    for i, cv in enumerate(flag_frames()):
        cv.save(f'flag-{i}.png')
    for i, cv in enumerate(sparkle_frames()):
        cv.save(f'sparkle-{i}.png')
    for i, cv in enumerate(dust_frames()):
        cv.save(f'dust-{i}.png')
    glow().save('glow.png')
    beam().save('beam.png')
    falling_rock().save('rock.png')
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
        'map': island_meta['size'],
        'miner': [MNW, MNH],
        'poses': poses,
        'island': island_meta,
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

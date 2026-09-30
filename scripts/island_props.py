"""Props for Gali Island: the trees, rocks and buildings that stand on the ground.

They are objects rather than paint so the engine can depth-sort them against the
characters, sway the trees in the wind, turn the windmill and light the windows
at night. Every sprite is drawn at 1x and anchored at its foot (base centre),
except the pier, which lies flat and is anchored at its landward end.

sprites() returns {name: (frames, ax, ay, ms, sway)}; island.py adds each frame
to the atlas as prop-<name>-<f> and places them.
"""
import math

import numpy as np
from PIL import Image


def rgb(s, a=255):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


def h1(*v):
    x = math.sin(sum(float(a) * k for a, k in zip(v, (12.9898, 78.233, 37.719, 11.13)))) * 43758.5453
    return x - math.floor(x)


class Spr:
    """A small RGBA canvas. Colours are '#rrggbb' strings or tuples."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.a = np.zeros((h, w, 4), np.uint8)

    def copy(self):
        s = Spr(self.w, self.h)
        s.a = self.a.copy()
        return s

    def set(self, x, y, col, alpha=None):
        x, y = int(round(x)), int(round(y))
        if not (0 <= x < self.w and 0 <= y < self.h):
            return
        c = rgb(col) if isinstance(col, str) else tuple(int(v) for v in col) + ((255,) if len(col) == 3 else ())
        if alpha is not None:
            c = c[:3] + (alpha,)
        if c[3] >= 255:
            self.a[y, x] = c
        elif c[3] > 0:
            base = self.a[y, x].astype(float)
            t = c[3] / 255
            out = base[:3] * (1 - t) + np.array(c[:3]) * t if base[3] else np.array(c[:3], float)
            self.a[y, x, :3] = out.round()
            self.a[y, x, 3] = max(int(base[3]), c[3])

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return tuple(int(v) for v in self.a[y, x])
        return (0, 0, 0, 0)

    def solid(self, x, y):
        return self.get(x, y)[3] > 200

    def rect(self, x, y, w, h, col):
        for j in range(int(h)):
            for i in range(int(w)):
                self.set(x + i, y + j, col)

    def hline(self, x0, x1, y, col):
        for x in range(int(x0), int(x1) + 1):
            self.set(x, y, col)

    def vline(self, x, y0, y1, col):
        for y in range(int(y0), int(y1) + 1):
            self.set(x, y, col)

    def line(self, x0, y0, x1, y1, col):
        n = int(max(abs(x1 - x0), abs(y1 - y0)))
        for k in range(n + 1):
            t = k / max(n, 1)
            self.set(round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t), col)

    def ellipse(self, cx, cy, rx, ry, col):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.set(x, y, col)

    def shadow(self, cx, cy, rx, ry=1.2, a=70):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 and not self.solid(x, y):
                    self.set(x, y, (20, 28, 16), a)

    def outline(self, col, where=None):
        """Colour transparent pixels next to solid ones (4-neighbour)."""
        src = self.a[:, :, 3] > 200
        c = rgb(col) if isinstance(col, str) else col
        for y in range(self.h):
            for x in range(self.w):
                if self.a[y, x, 3] > 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < self.w and 0 <= ny < self.h and src[ny, nx]:
                        if where is None or where(x, y):
                            self.a[y, x] = c
                        break

    def paste(self, other, dx=0, dy=0):
        for y in range(other.h):
            for x in range(other.w):
                p = other.a[y, x]
                if p[3]:
                    self.set(x + dx, y + dy, tuple(int(v) for v in p))

    def img(self):
        return Image.fromarray(self.a, 'RGBA')


def sway_frames(trunk, canopy, top, bottom, n=3):
    """Wind frames: the canopy leans a pixel, more of it each frame, from the top
    down; the trunk never moves. Rows above `bottom` can move, `top` is the
    canopy's first row."""
    frames = []
    span = max(1, bottom - top)
    for f in range(n):
        out = trunk.copy()
        cut = top + span * (f / (n - 1)) * 0.95 if f else top - 1
        c = Spr(canopy.w, canopy.h)
        for y in range(canopy.h):
            s = 1 if (f and y <= cut) else 0
            if s:
                c.a[y, 1:] = canopy.a[y, :-1]
            else:
                c.a[y] = canopy.a[y]
        out.paste(c)
        frames.append(out)
    return frames


# ---------------- trees ----------------
LEAF = ['#173a1c', '#24522a', '#336b2f', '#468a38', '#62a845', '#86c35a']
LEAF_AUTUMN = ['#3a2a10', '#5e3a14', '#8a5a1c', '#b07a26', '#d49a36', '#ecc25a']
BARK = ['#2e1d12', '#4a3122', '#6b4a32', '#8a6444']


def blob_canopy(w, h, blobs, pal, seed, outline=True):
    """Leaves as a few overlapping spheres, lit from the top left, clumped."""
    c = Spr(w, h)
    val = np.full((h, w), -9.0)
    for bx, by, rx, ry in blobs:
        for y in range(h):
            for x in range(w):
                dx, dy = (x + 0.5 - bx) / rx, (y + 0.5 - by) / ry
                d = dx * dx + dy * dy
                if d <= 1:
                    v = 0.62 - 0.42 * dx - 0.55 * dy - 0.25 * d
                    val[y, x] = max(val[y, x], v)
    for y in range(h):
        for x in range(w):
            v = val[y, x]
            if v < -5:
                continue
            v += (h1(x // 2, y // 2, seed) - 0.5) * 0.35 + (h1(x, y, seed + 1) - 0.5) * 0.12
            k = int(np.clip(1 + v * 3.4, 1, 5))
            c.set(x, y, pal[k])
    # leaf clumps: a highlight arc with a shadow under it
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if val[y, x] > 0.55 and h1(x, y, seed + 2) > 0.8 and val[y + 1, x] > -5:
                c.set(x, y, pal[5])
                c.set(x, y + 1, pal[2])
    if outline:
        c.outline(pal[0])
    return c


def trunk(s, x, y0, y1, pal=BARK, w=2):
    for y in range(y0, y1 + 1):
        s.set(x, y, pal[3] if w > 1 else pal[2])
        if w > 1:
            s.set(x + 1, y, pal[1])
    s.set(x - 1, y1, pal[1])
    s.set(x + w, y1, pal[0])


def broadleaf(variant):
    w, h = 13, 16
    ax, ay = 6, 15
    pal = LEAF if variant != 2 else LEAF[:1] + ['#2a5626', '#3c7230', '#548f3a', '#72ad48', '#99c85e']
    t = Spr(w, h)
    t.shadow(6.5, 15, 5.5, 1.3)
    trunk(t, 6, 10, 15)
    t.set(5, 12, BARK[2])
    blobs = [
        [(6.5, 6.5, 5.6, 4.6), (3.6, 8.2, 3.2, 2.6), (9.6, 8.0, 3.2, 2.7), (6.2, 3.4, 3.8, 2.8)],
        [(6.5, 6.0, 5.2, 5.0), (4.0, 9.0, 3.4, 2.4), (9.2, 9.2, 3.0, 2.2), (7.4, 3.0, 3.2, 2.6)],
        [(6.5, 7.0, 6.0, 4.0), (3.0, 8.5, 2.8, 2.3), (10.0, 8.5, 2.8, 2.3), (5.5, 4.0, 3.5, 2.6), (8.5, 4.2, 3.2, 2.6)],
    ][variant]
    canopy = blob_canopy(w, h, blobs, pal, 11 + variant)
    return sway_frames(t, canopy, 0, 11), ax, ay


def small_oak(variant):
    """A young broadleaf, for the narrow strips between claims."""
    w, h = 9, 12
    ax, ay = 4, 11
    t = Spr(w, h)
    t.shadow(4.5, 11, 3.8, 1.0)
    t.set(4, 8, BARK[3])
    t.set(4, 9, BARK[3])
    t.set(4, 10, BARK[2])
    t.set(4, 11, BARK[1])
    t.set(5, 11, BARK[0])
    t.set(5, 9, BARK[1])
    blobs = [[(4.5, 4.6, 4.0, 3.6), (2.6, 6.0, 2.2, 1.8), (6.6, 6.0, 2.2, 1.9)],
             [(4.5, 4.2, 3.6, 3.8), (4.5, 6.6, 3.9, 1.8)]][variant]
    canopy = blob_canopy(w, h, blobs, LEAF, 51 + variant)
    return sway_frames(t, canopy, 0, 8), ax, ay


def small_pine(variant):
    w, h = 7, 13
    ax, ay = 3, 12
    pal = ['#0f2a1c', '#173d27', '#1f5231', '#2c6a3b', '#3f8547', '#5aa35a']
    t = Spr(w, h)
    t.shadow(3.5, 12, 3, 0.9)
    t.set(3, 11, BARK[2])
    t.set(3, 12, BARK[1])
    c = Spr(w, h)
    tiers = [[(0, 4, 1.8), (2, 7, 2.6), (5, 10, 3.4)], [(0, 3, 1.5), (2, 6, 2.4), (4, 8, 3.0), (7, 10, 3.5)]][variant]
    for n, (y0, y1, hw) in reversed(list(enumerate(tiers))):
        for y in range(y0, y1 + 1):
            f = (y - y0 + 1) / (y1 - y0 + 1)
            half = 0.6 + f * (hw - 0.6)
            for x in range(w):
                d = x + 0.5 - 3.5
                if abs(d) <= half:
                    u = d / max(half, 0.5)
                    v = 0.62 - 0.55 * u - 0.2 * f + (h1(x, y, variant + 7) - 0.5) * 0.22
                    k = int(np.clip(1 + v * 3.3, 1, 5))
                    if y == y1:
                        k = max(1, k - 2)
                    c.set(x, y, pal[k])
    c.outline(pal[0])
    return sway_frames(t, c, 0, 9), ax, ay


def pine(variant, snowy=False):
    w, h = 11, 18
    ax, ay = 5, 17
    pal = ['#0f2a1c', '#173d27', '#1f5231', '#2c6a3b', '#3f8547', '#5aa35a']
    t = Spr(w, h)
    t.shadow(5.5, 17, 4.5, 1.1)
    t.set(5, 16, BARK[2])
    t.set(5, 17, BARK[1])
    t.set(4, 17, BARK[0])
    t.set(6, 17, BARK[0])
    c = Spr(w, h)
    # (top row, bottom row, half width at the bottom); drawn bottom tier first so
    # each tier's skirt overhangs the one below and the outline comes out sawtoothed
    tiers = [
        [(0, 5, 2.4), (3, 9, 3.6), (6, 12, 4.6), (9, 15, 5.4)],
        [(0, 4, 2.0), (2, 7, 3.0), (5, 10, 4.0), (8, 13, 4.8), (11, 15, 5.4)],
        [(0, 6, 2.6), (4, 11, 4.0), (8, 15, 5.2)],
    ][variant]
    for n, (y0, y1, hw) in reversed(list(enumerate(tiers))):
        for y in range(y0, y1 + 1):
            f = (y - y0 + 1) / (y1 - y0 + 1)
            half = 0.6 + f * (hw - 0.6)
            for x in range(w):
                d = x + 0.5 - 5.5
                if abs(d) <= half:
                    u = d / max(half, 0.5)
                    v = 0.62 - 0.55 * u - 0.2 * f + (h1(x, y, variant) - 0.5) * 0.22
                    k = int(np.clip(1 + v * 3.3, 1, 5))
                    if y == y1:
                        k = max(1, k - 2)      # the skirt of each tier is in shadow
                    c.set(x, y, pal[k])
    if snowy:
        # snow lying along the top of each branch tier, on the sunny side
        for n, (y0, y1, hw) in enumerate(tiers):
            for y in (y1 - 1, y1):
                for x in range(w):
                    d = x + 0.5 - 5.5
                    top_open = not c.solid(x, y - 1) or y == y1 - 1 and not c.solid(x - 1, y - 1)
                    if c.solid(x, y) and d < 1 and (top_open or (y == y1 - 1 and h1(x, y, 9) > 0.55)):
                        c.set(x, y - (1 if y == y1 else 0) if False else y, '#eef4fb' if d < -1 else '#c6d6e8')
        c.set(5, 0, '#ffffff')
        c.set(5, 1, '#eef4fb')
    c.outline(pal[0])
    return sway_frames(t, c, 0, 13), ax, ay


def palm(variant):
    w, h = 15, 18
    ax, ay = 7, 17
    t = Spr(w, h)
    t.shadow(7.5, 17, 4.5, 1.1)
    lean = [1, -1, 2][variant]
    ring = ['#8a6a44', '#6b4e30', '#a8865a']
    # the trunk bends as it climbs; the rings catch the light
    pts = []
    for i in range(11):
        y = 17 - i
        x = 7 + round(lean * (i / 10) ** 2 * 2)
        pts.append((x, y))
        t.set(x, y, ring[2] if i % 2 else ring[0])
        t.set(x + 1, y, ring[1])
    cx, cy = pts[-1][0] + 0.5, pts[-1][1] - 1
    c = Spr(w, h)
    green = ['#163a1a', '#24582a', '#3a7d32', '#5aa043', '#84c258']
    # fronds radiate from the crown and droop at the tips; each is a rib with
    # leaflets hanging off its underside, so there is sky between them
    fronds = [(-7, 0.5, 2), (-4.5, -2.5, 3), (0.5, -4, 4), (4.5, -2.5, 3), (7, 0.5, 2), (2.5, 2.5, 1), (-3, 3, 1)]
    if variant == 1:
        fronds = [(-7, -0.5, 2), (-3.5, -3.5, 3), (2, -4, 4), (6, -2, 3), (7, 1.5, 2), (-5.5, 2.5, 1)]
    if variant == 2:
        fronds = [(-6.5, 1, 2), (-4, -3, 3), (1.5, -4, 4), (5.5, -1.5, 3), (4, 3, 1)]
    for fx, fy, lit in fronds:
        n = 8
        for st in range(n + 1):
            u = st / n
            x = cx + fx * u
            y = cy + fy * u + 3.2 * u * u      # droop
            c.set(x - 0.5, y - 0.5, green[min(4, lit + 1)] if u < 0.6 else green[lit])
            if 0.3 < u < 0.95 and st % 2 == 0:
                c.set(x - 0.5, y + 0.5, green[max(1, lit - 1)])
    c.set(cx - 1, cy, '#4a2e14')
    c.set(cx, cy, '#6a4420')
    c.set(cx - 1, cy + 1, '#6a4420')
    # a dark edge only under the drooping tips, so the fronds stay apart
    for y in range(h - 1, 0, -1):
        for x in range(w):
            if c.solid(x, y - 1) and not c.solid(x, y) and y > cy + 1:
                c.set(x, y, green[0])
    return sway_frames(t, c, 0, int(cy) + 5), ax, ay


def bush(variant, pal=None):
    w, h = 9, 7
    ax, ay = 4, 6
    t = Spr(w, h)
    t.shadow(4.5, 6, 4, 1)
    pal = pal or LEAF
    blobs = [[(4.5, 3.8, 4.0, 2.8), (2.5, 4.4, 2.3, 2.0)],
             [(4.5, 3.6, 3.6, 3.0), (6.6, 4.4, 2.2, 1.8)],
             [(3.2, 4.0, 2.8, 2.4), (6.0, 4.0, 2.8, 2.2), (4.5, 2.8, 2.4, 1.8)]][variant]
    c = blob_canopy(w, h, blobs, pal, 31 + variant)
    if variant == 1:     # berries
        for x, y in ((3, 3), (5, 4), (6, 3), (2, 5)):
            if c.get(x, y)[3]:
                c.set(x, y, '#e04a5a')
    if variant == 2:     # blossom
        for x, y in ((3, 2), (5, 3), (2, 4), (6, 5)):
            if c.get(x, y)[3]:
                c.set(x, y, '#fff0f6')
    return sway_frames(t, c, 0, 6), ax, ay


def dead_tree(variant):
    w, h = 11, 14
    ax, ay = 5, 13
    s = Spr(w, h)
    s.shadow(5.5, 13, 4, 1)
    wood = ['#3a2c22', '#5a4838', '#7a6652', '#a08a70']
    s.vline(5, 5, 13, wood[2])
    s.vline(6, 6, 13, wood[1])
    s.set(4, 13, wood[1])
    s.set(7, 13, wood[0])
    branches = [[(5, 8, 2, 5), (2, 5, 1, 3), (6, 6, 9, 3), (9, 3, 9, 1), (5, 5, 5, 1)],
                [(5, 9, 1, 6), (6, 7, 8, 4), (8, 4, 10, 3), (5, 5, 3, 2), (8, 4, 7, 1)]][variant]
    for x0, y0, x1, y1 in branches:
        s.line(x0, y0, x1, y1, wood[3] if x1 < x0 else wood[2])
    s.outline(rgb('#2a1f18', 255))
    return [s], ax, ay


def cactus(variant):
    w, h = 9, 12
    ax, ay = 4, 11
    s = Spr(w, h)
    s.shadow(4.5, 11, 3.5, 1)
    g = ['#1f3f22', '#2f6034', '#3f7d42', '#5a9a52', '#86c070']
    for y in range(1, 12):
        s.set(3, y, g[3])
        s.set(4, y, g[2])
        s.set(5, y, g[1])
    s.set(4, 0, g[3])
    arms = [((1, 3, 6), (7, 5, 8)), ((1, 5, 8), (7, 2, 5))][variant]
    for ax_, y0, y1 in arms:
        for y in range(y0, y1 + 1):
            s.set(ax_, y, g[3] if ax_ < 4 else g[2])
        side = 2 if ax_ < 4 else 6
        s.set(side, y1, g[2])
    for y in range(2, 11, 3):
        s.set(4, y, g[4])
    if variant == 1:
        s.set(4, 0, '#ff6b8a')
        s.set(3, 0, '#ffd0dc')
    s.outline(g[0])
    return [s], ax, ay


def boulder(variant, pal=None, k=1.0):
    w, h = 10, 8
    ax, ay = 5, 7
    s = Spr(w, h)
    s.shadow(5, 7, 4.8 * k, 1.1)
    pal = pal or ['#5e3218', '#8a4a22', '#b0703a', '#c98a4a', '#e0a868']
    blobs = [[(5, 4.2, 4.2, 3.2)], [(4, 4.5, 3.4, 3.0), (7.2, 5.2, 2.4, 2.0)], [(5, 3.8, 3.4, 3.4)]][variant]
    blobs = [(5 + (bx - 5) * k, 7 - (7 - by) * k, rx * k, ry * k) for bx, by, rx, ry in blobs]
    val = np.full((h, w), -9.0)
    for bx, by, rx, ry in blobs:
        for y in range(h):
            for x in range(w):
                dx, dy = (x + 0.5 - bx) / rx, (y + 0.5 - by) / ry
                d = dx * dx + dy * dy
                if d <= 1:
                    val[y, x] = max(val[y, x], 0.6 - 0.45 * dx - 0.6 * dy)
    for y in range(h):
        for x in range(w):
            if val[y, x] > -5:
                k = int(np.clip(1 + (val[y, x] + (h1(x, y, variant) - 0.5) * 0.2) * 3, 1, 4))
                s.set(x, y, pal[k])
    # a stratum line across it
    for x in range(w):
        y = 5 - (x // 4)
        if s.get(x, y)[3] and h1(x, 3) > 0.25:
            s.set(x, y, pal[1])
    s.outline(pal[0])
    return [s], ax, ay


GREY = ['#2a3038', '#46505e', '#636e7e', '#808b9a', '#a3adba']


def rock(variant):
    frames, ax, ay = boulder(variant, GREY, k=0.72)
    return frames, ax, ay


def pebble_rock(variant):
    w, h = 7, 5
    s = Spr(w, h)
    s.shadow(3.5, 4, 3.2, 0.9)
    shapes = [[(1, 2, 4, 2), (2, 1, 3, 1)], [(1, 2, 5, 2), (1, 1, 2, 1), (4, 1, 1, 1)], [(2, 1, 3, 3), (1, 2, 1, 2)]]
    for x, y, ww, hh in shapes[variant]:
        s.rect(x, y, ww, hh, GREY[2])
    for x in range(w):
        for y in range(h):
            if s.solid(x, y) and not s.solid(x, y - 1):
                s.set(x, y, GREY[3])
            if s.solid(x, y) and not s.solid(x + 1, y):
                s.set(x, y, GREY[1])
    s.set(2, 1 if variant != 2 else 1, GREY[4])
    s.outline(GREY[0], where=lambda x, y: y >= 1)
    return [s], 3, 4


def tuft(variant, dry=False):
    """A few blades of grass, each its own stroke, so the ground shows between."""
    w, h = 5, 5
    ax, ay = 2, 4
    g = ['#2f5a26', '#4a8236', '#6aa54a', '#9ad066'] if not dry else ['#5a4a1e', '#8a7430', '#b09a48', '#d8c478']
    base = Spr(w, h)
    blades = [[(0, 2, 1), (2, 0, 0), (4, 1, -1)], [(1, 1, 0), (2, 0, 1), (3, 2, 0)], [(0, 3, 0), (1, 1, 1), (3, 0, 0), (4, 2, -1)]][variant]
    c = Spr(w, h)
    for x, top, lean in blades:
        for y in range(top, 5):
            xx = x + (lean if y == top else 0)
            c.set(xx, y, g[3] if y == top else (g[2] if y < 3 else g[1]))
    c.set(2, 4, g[0])
    return sway_frames(base, c, 0, 2), ax, ay


def flower(variant):
    w, h = 5, 6
    ax, ay = 2, 5
    petals = [('#f4efdc', '#ffd84a'), ('#ff9ec0', '#ffe36a'), ('#ffd84a', '#c9781e')][variant]
    base = Spr(w, h)
    c = Spr(w, h)
    c.vline(2, 2, 5, '#3f7a30')
    c.set(1, 4, '#5a9a3a')
    c.set(3, 3, '#5a9a3a')
    for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
        c.set(2 + dx, 1 + dy, petals[0])
    c.set(2, 1, petals[1])
    return sway_frames(base, c, 0, 3), ax, ay


# ---------------- landmarks ----------------
def lighthouse():
    w, h = 13, 31
    ax, ay = 6, 30
    s = Spr(w, h)
    s.shadow(6.5, 30, 6, 1.2)
    stone = ['#3a3e46', '#5a606b', '#7d8491', '#a0a7b3']
    # rock plinth
    for y in range(26, 31):
        for x in range(1, 12):
            if abs(x + 0.5 - 6.5) <= 3.2 + (y - 26) * 0.35:
                s.set(x, y, stone[3] if y == 26 else stone[2] if x < 6 else stone[1])
    # the tower tapers from 7 wide to 5, banded white and red
    for y in range(9, 27):
        half = 2.5 + (y - 9) / 17 * 1.2
        for x in range(w):
            d = x + 0.5 - 6.5
            if abs(d) <= half:
                red = ((y - 9) // 4) % 2 == 1
                lit = d < -0.5
                if red:
                    col = '#e0524a' if lit else ('#b83a36' if d < 1.5 else '#8e2a2a')
                else:
                    col = '#ffffff' if lit else ('#e4e8f0' if d < 1.5 else '#b8c0cc')
                s.set(x, y, col)
    # door and a window
    s.rect(6, 23, 2, 3, '#3a2418')
    s.set(6, 23, '#5a3a24')
    s.set(6, 15, '#2a3a4a')
    # gallery and railing
    s.hline(2, 10, 8, '#2e323a')
    s.hline(2, 10, 7, '#5a606b')
    for x in (2, 4, 6, 8, 10):
        s.set(x, 6, '#2e323a')
    # lamp room: glass, lit
    s.rect(4, 3, 5, 4, '#ffe9a8')
    s.set(4, 3, '#fff8dc')
    s.set(5, 4, '#ffffff')
    s.vline(6, 3, 6, '#c9a24e')
    s.vline(8, 3, 6, '#d8b060')
    # roof
    s.hline(3, 9, 2, '#8e2a2a')
    s.hline(4, 8, 1, '#b83a36')
    s.set(6, 0, '#2e323a')
    s.outline(rgb('#1c1f26'))
    lamp = (6 - ax + 0.5, 4 - ay)
    return [s], ax, ay, lamp


def windmill():
    w, h = 19, 23
    ax, ay = 9, 22
    hub = (9, 7)
    frames = []
    for f in range(4):
        s = Spr(w, h)
        s.shadow(9.5, 22, 5.5, 1.1)
        # tower: whitewashed, tapering, on a stone foot
        for y in range(9, 23):
            half = 2.2 + (y - 9) / 13 * 1.8
            for x in range(w):
                d = x + 0.5 - 9.5
                if abs(d) <= half:
                    if y >= 21:
                        col = '#8d97a6' if d < 0 else '#5c6676'
                    else:
                        col = '#f2ead8' if d < -1 else ('#d8ccb0' if d < 1.2 else '#b0a284')
                    s.set(x, y, col)
        s.rect(9, 18, 2, 3, '#5a3a24')
        s.set(9, 18, '#7a5234')
        s.set(9, 13, '#3a2a1e')
        # cap
        for y in range(6, 10):
            half = 1.5 + (y - 6) * 0.8
            for x in range(w):
                d = x + 0.5 - 9.5
                if abs(d) <= half:
                    s.set(x, y, '#b0493c' if d < 0 else '#7e3028')
        # sails: four lattice arms, turned a quarter of a quarter per frame,
        # so four frames loop seamlessly
        base = f * (math.pi / 2) / 4
        for k in range(4):
            a = base + k * math.pi / 2
            ca, sa = math.cos(a), math.sin(a)
            px, py = -sa, ca
            for r in range(3, 9):
                x = hub[0] + 0.5 + ca * r
                y = hub[1] + 0.5 + sa * r
                for q in (0.9, 1.7):
                    cloth = '#fbf6ea' if q < 1.5 else '#ddd2ba'
                    if r % 3 == 2:
                        cloth = '#b0a080'    # the lattice showing through
                    s.set(x + px * q - 0.5, y + py * q - 0.5, cloth)
            for r in range(1, 9):
                s.set(hub[0] + ca * r, hub[1] + sa * r, '#5a3a24')
        s.set(hub[0], hub[1], '#2a1e16')
        s.outline(rgb('#2a2018'))
        frames.append(s)
    return frames, ax, ay


def smelter():
    w, h = 20, 21
    ax, ay = 9, 20
    s = Spr(w, h)
    s.shadow(9.5, 20, 9, 1.2)
    stone = ['#3a3430', '#5a4e46', '#7a6c60', '#9a8a7a']
    brick = ['#5e2a1c', '#8a3e28', '#a8523a']
    # the furnace house: rough stone walls
    for y in range(10, 21):
        for x in range(1, 15):
            k = 2 if x < 9 else 1
            if (y + (x // 3)) % 3 == 0 and h1(x, y) > 0.4:
                k -= 1
            if h1(x, y, 3) > 0.9:
                k += 1
            s.set(x, y, stone[max(0, min(3, k))])
    # sloped iron roof
    for y in range(6, 11):
        x0, x1 = (10 - y) // 2, 15 - (10 - y) // 2
        for x in range(x0, x1 + 1):
            s.set(x, y, '#6e7a8c' if (x + y) % 3 else '#5c6676')
        s.set(x0, y, '#8d97a6')
    s.hline(0, 15, 10, '#3a414d')
    # furnace mouth, glowing
    s.rect(3, 14, 5, 6, '#2a1a14')
    s.rect(4, 15, 3, 5, '#ff8a2a')
    s.set(5, 16, '#ffd060')
    s.rect(5, 17, 1, 3, '#ffd060')
    s.set(5, 18, '#fff2b0')
    s.hline(3, 7, 13, stone[3])
    # a small lit window
    s.rect(10, 13, 2, 2, '#ffb45a')
    s.set(10, 13, '#ffe0a0')
    # brick chimney, tall, stained at the top
    for y in range(1, 18):
        for x in range(15, 18):
            col = brick[2] if x == 15 else brick[1] if x < 17 else brick[0]
            if y % 3 == 0 and x == 16:
                col = brick[0]
            s.set(x, y, col)
    s.hline(14, 18, 1, '#3a2a24')
    s.hline(15, 17, 0, '#2a1e1a')
    s.set(16, 2, '#2a1e1a')
    # a heap of ore by the door, a fleck of gold in it
    for x, y, c in ((18, 19, '#7a6c60'), (18, 18, '#9a8a7a'), (19, 19, '#5a4e46'), (18, 20, '#5a4e46'), (19, 18, '#c9a24e')):
        s.set(x, y, c)
    s.outline(rgb('#221a16'))
    smoke = (16.5 - ax, -1 - ay)
    fire = (5.5 - ax, 17 - ay)
    return [s], ax, ay, smoke, fire


def stilt_hut(variant):
    """A kampung house: attap roof, woven walls, up on stilts with a ladder."""
    w, h = 14, 17
    ax, ay = 6, 16
    s = Spr(w, h)
    s.shadow(6.5, 16, 6, 1.0)
    wood = ['#3a2616', '#5a3c24', '#7a5634', '#9a7248']
    thatch = ['#6a4a1e', '#8e6a2c', '#b48c40', '#d4ae5c', '#ecd08a']
    # stilts and a ladder up to the door
    for x in (2, 6, 10):
        s.vline(x, 12, 16, wood[1])
    s.vline(11, 12, 16, wood[0])
    s.vline(12, 12, 16, wood[1])
    for y in (13, 15):
        s.set(12, y, wood[3])
    # floor and walls of woven panels
    s.hline(1, 11, 12, wood[0])
    s.hline(1, 11, 11, wood[3])
    for y in range(7, 11):
        for x in range(2, 11):
            col = wood[2] if (x + y) % 2 else wood[3]
            if x == 10:
                col = wood[1]
            s.set(x, y, col)
    # door and window (the window is what glows at night)
    s.rect(8, 8, 2, 3, '#2a1a10')
    wx = 3 if variant != 1 else 4
    s.rect(wx, 8, 2, 2, '#ffb45a')
    s.set(wx, 8, '#ffe0a0')
    # attap roof: steep, with a ridge and ragged eaves
    peak = [1, 0, 2][variant]
    for y in range(peak, 7):
        f = (y - peak) / (6 - peak)
        half = 1.5 + f * 5.6
        for x in range(w):
            d = x + 0.5 - 6.5
            if abs(d) <= half:
                k = 3 if d < -1 else (2 if d < 1.5 else 1)
                if (y + x) % 4 == 0:
                    k -= 1
                if y == 6 and h1(x, variant) > 0.5:
                    k = 0
                s.set(x, y, thatch[max(0, k)])
    s.hline(5, 7, peak, thatch[4])
    if variant == 2:
        # crossed gable ends, the way the old houses finish the ridge
        s.set(4, peak - 1, wood[1])
        s.set(8, peak - 1, wood[1])
    s.outline(rgb('#2a1a0e'))
    window = (wx + 1 - ax, 9 - ay)
    return [s], ax, ay, window


def pier():
    """Lies flat on the water, landward end at the top, anchored there."""
    w, h = 15, 18
    ax, ay = 5, 0
    s = Spr(w, h)
    plank = ['#5a3c24', '#7a5634', '#9a7248', '#b68c5c']
    for y in range(0, 16):
        for x in range(2, 9):
            k = 2 if (y % 2 == 0) else 1
            if x in (2, 8):
                k = 0
            if h1(x, y, 7) > 0.85:
                k = 3
            s.set(x, y, plank[k])
    # pilings in the water, with a dark reflection under each
    for y in (4, 9, 15):
        s.set(1, y, '#2a1a10')
        s.set(9, y, '#2a1a10')
        s.set(1, y + 1, (10, 24, 44, 150))
        s.set(9, y + 1, (10, 24, 44, 150))
    s.hline(2, 8, 16, (10, 24, 44, 120))
    # a mooring post and a coil of rope at the end
    s.rect(7, 13, 1, 2, '#3a2616')
    s.set(7, 12, '#9a7248')
    s.set(4, 14, '#e8d8a8')
    s.set(5, 14, '#c9b88a')
    # a sampan tied alongside
    for y in range(6, 14):
        half = 1.5 if 7 <= y <= 12 else 0.8
        for x in range(10, 15):
            d = x + 0.5 - 12.5
            if abs(d) <= half:
                s.set(x, y, '#8a4a22' if d < 0 else '#6a3616')
    for y in range(8, 12):
        s.set(12, y, '#c98a4a')
    s.set(11, 6, '#a85a2a')
    s.hline(10, 14, 14, (10, 24, 44, 110))
    s.line(9, 8, 10, 8, '#e8d8a8')
    return [s], ax, ay


def campfire():
    w, h = 9, 10
    ax, ay = 4, 9
    flames = [
        [(4, 3, '#ffd060'), (3, 4, '#ff8a2a'), (4, 4, '#fff2b0'), (5, 4, '#ff8a2a'), (3, 5, '#ff6a2a'), (4, 5, '#ffd060'), (5, 5, '#ff6a2a'), (4, 2, '#ff8a2a')],
        [(3, 3, '#ffd060'), (3, 4, '#ffd060'), (4, 4, '#fff2b0'), (5, 4, '#ff6a2a'), (2, 5, '#ff6a2a'), (4, 5, '#ffd060'), (5, 5, '#ff8a2a'), (5, 3, '#ff8a2a'), (3, 2, '#ff6a2a')],
        [(5, 3, '#ffd060'), (4, 4, '#ffd060'), (5, 4, '#fff2b0'), (3, 4, '#ff6a2a'), (3, 5, '#ff8a2a'), (4, 5, '#fff2b0'), (6, 5, '#ff6a2a'), (4, 1, '#ff8a2a'), (4, 3, '#ff8a2a')],
    ]
    frames = []
    for f in range(3):
        s = Spr(w, h)
        s.shadow(4.5, 9, 4, 0.9)
        for x, y, c in ((1, 7, '#8d97a6'), (2, 8, '#6e7a8c'), (4, 8, '#8d97a6'), (6, 8, '#6e7a8c'), (7, 7, '#5c6676'), (1, 8, '#4c5666'), (7, 8, '#4c5666')):
            s.set(x, y, c)
        s.line(2, 7, 6, 6, '#6b4a32')
        s.line(2, 6, 6, 7, '#8a6444')
        for x, y, c in flames[f]:
            s.set(x, y + 1, c)
        frames.append(s)
    return frames, ax, ay


def lantern():
    w, h = 5, 9
    ax, ay = 2, 8
    s = Spr(w, h)
    s.shadow(2.5, 8, 2, 0.7)
    s.vline(2, 4, 8, '#6b4a32')
    s.set(1, 8, '#3a2616')
    s.set(3, 8, '#3a2616')
    s.hline(1, 3, 0, '#3a2616')
    s.rect(1, 1, 3, 2, '#ffd27a')
    s.set(2, 1, '#fff2c0')
    s.set(3, 2, '#e8a040')
    s.hline(1, 3, 3, '#3a2616')
    s.outline(rgb('#241a12'))
    light = (2.5 - ax, 1.5 - ay)
    return [s], ax, ay, light


# ---------------- the catalogue ----------------
def sprites():
    """{name: dict(frames=[Spr], ax, ay, ms, sway, extra...)}"""
    out = {}

    def add(name, res, ms=0, sway=0, **extra):
        frames, ax, ay = res[0], res[1], res[2]
        out[name] = dict(frames=frames, ax=ax, ay=ay, ms=ms, sway=sway, **extra)

    for v, tag in enumerate('abc'):
        add(f'oak-{tag}', broadleaf(v), sway=1)
        add(f'pine-{tag}', pine(v), sway=1)
        add(f'palm-{tag}', palm(v), sway=1)
        add(f'bush-{tag}', bush(v), sway=1)
        add(f'boulder-{tag}', boulder(v))
        add(f'rock-{tag}', rock(v))
        add(f'stone-{tag}', pebble_rock(v))
        add(f'tuft-{tag}', tuft(v), sway=1)
        add(f'flower-{tag}', flower(v), sway=1)
    add('pine-snow', pine(1, snowy=True), sway=1)
    for v, tag in enumerate('ab'):
        add(f'sapling-{tag}', small_oak(v), sway=1)
        add(f'fir-{tag}', small_pine(v), sway=1)
    add('scrub-a', bush(0, LEAF_AUTUMN), sway=1)
    add('scrub-b', bush(2, ['#2e2a12', '#4a4418', '#6a6222', '#8f8a3a', '#aaa24a', '#c8c064']), sway=1)
    add('tuft-dry', tuft(0, dry=True), sway=1)
    for v, tag in enumerate('ab'):
        add(f'deadtree-{tag}', dead_tree(v))
        add(f'cactus-{tag}', cactus(v))
    f, ax, ay, lamp = lighthouse()
    add('lighthouse', (f, ax, ay), lamp=lamp)
    add('windmill', windmill(), ms=150)
    f, ax, ay, smoke, fire = smelter()
    add('smelter', (f, ax, ay), smoke=smoke, fire=fire)
    for v, tag in enumerate('abc'):
        f, ax, ay, win = stilt_hut(v)
        add(f'hut-{tag}', (f, ax, ay), window=win)
    add('pier', pier())
    add('campfire', campfire(), ms=120)
    f, ax, ay, light = lantern()
    add('lantern', (f, ax, ay), light=light)
    return out


# ---------------- placement ----------------
class Placer:
    """Puts props on the island without getting in the way of play.

    The rules, all checked per opaque pixel of every frame:
      - the foot stands on open ground ('.' in the grid), on a flat top, off
        the paths and the rivers (small tufts and flowers may stand on a claim);
      - nothing within 10px of a claim's centre or stand point, nothing over a
        claim icon or the label under it, and nothing in front of a miner at work;
      - trees keep most of their canopy off claim ground, so outlines stay readable.
    """

    ICON = (-12, -13, 12, 10)     # icon + label rect around a claim centre
    MINER = (-9, -24, 9, 0)       # a miner at a stand point

    def __init__(self, I, g, sp):
        self.I, self.g, self.sp = I, g, sp
        self.stands = [I.stand_for(c['i']) for c in I.CLAIMS]
        self.fit = I.fit_box()       # the app frames this box; anything outside it gets sliced
        self.cen = [(cx, cy) for cx, cy, _ in I.CEN]
        self.props = []
        self.feet = []      # (x, y, r) of everything placed, for spacing
        self.boxes = []     # opaque bounding boxes of the landmarks, kept clear of plants
        self._px = {}

    def pixels(self, name):
        """Opaque pixels of every frame, relative to the anchor."""
        if name not in self._px:
            d = self.sp[name]
            m = None
            for f in d['frames']:
                o = f.a[:, :, 3] > 200
                m = o if m is None else (m | o)
            ys, xs = np.nonzero(m)
            self._px[name] = (xs - d['ax'], ys - d['ay'], d['frames'][0].w, d['frames'][0].h)
        return self._px[name]

    def ui_clear(self, name, x, y, need=10):
        I = self.I
        xs, ys, _, _ = self.pixels(name)
        X, Y = xs + x, ys + y
        fx, fy, fw, fh = self.fit
        if X.min() < fx or Y.min() < fy or X.max() >= fx + fw or Y.max() >= fy + fh:
            return False
        for cx, cy in self.cen:
            if math.hypot(cx - x, cy - y) < need:
                return False
            a, b, c, d = self.ICON
            if ((X >= cx + a) & (X <= cx + c) & (Y >= cy + b) & (Y <= cy + d)).any():
                return False
        for sx, sy in self.stands:
            if math.hypot(sx - x, sy - y) < need:
                return False
            if y > sy - 2:
                a, b, c, d = self.MINER
                if ((X >= sx + a) & (X <= sx + c) & (Y >= sy + b) & (Y <= sy + d)).any():
                    return False
        return True

    def ground_ok(self, name, x, y, claim_ok=False, path_ok=False, islet=False):
        I, g = self.I, self.g
        if not (0 <= x < I.W and 0 <= y < I.H):
            return False
        xs, ys, _, _ = self.pixels(name)
        base = ys >= ys.max() - 1
        for px, py in zip(xs[base] + x, ys[base] + y):
            if not (0 <= px < I.W and 0 <= py < I.H):
                return False
            bx, by = px // I.B, py // I.B
            if islet:
                if not g.alpha[py, px] or g.face[py, px]:
                    return False
                continue
            if not I.LAND[by, bx] or (I.OWNER[by, bx] >= 0 and not claim_ok):
                return False
            if g.riv[py, px]:
                return False
        if not islet and I.OWNER[y // I.B, x // I.B] >= 0 and not claim_ok:
            return False
        for px in range(x - 1, x + 2):
            if not (0 <= px < I.W):
                return False
            if g.face[y, px] or g.mount[y, px] or not g.alpha[y, px]:
                return False
            if not path_ok and g.path[y, px] < 2.2:
                return False
        return True

    def spaced(self, x, y, r):
        for fx, fy, fr in self.feet:
            if math.hypot(fx - x, (fy - y) * 1.4) < r + fr:
                return False
        return True

    def claim_share(self, name, x, y):
        I = self.I
        xs, ys, _, _ = self.pixels(name)
        X = np.clip(xs + x, 0, I.W - 1) // I.B
        Y = np.clip(ys + y, 0, I.H - 1) // I.B
        return float((I.OWNER[Y, X] >= 0).mean()), float(self.g.mount[np.clip(ys + y, 0, I.H - 1), np.clip(xs + x, 0, I.W - 1)].mean())

    def box(self, name, x, y):
        xs, ys, _, _ = self.pixels(name)
        return (x + xs.min(), y + ys.min(), x + xs.max(), y + ys.max())

    def clear_of_landmarks(self, name, x, y, pad=1):
        a = self.box(name, x, y)
        for b in self.boxes:
            if a[0] <= b[2] + pad and a[2] >= b[0] - pad and a[1] <= b[3] + pad and a[3] >= b[1] - pad:
                return False
        return True

    def landmark(self, name, x, y, r):
        self.add(name, x, y, r)
        self.boxes.append(self.box(name, x, y))

    def add(self, name, x, y, r):
        d = self.sp[name]
        n = len(d['frames'])
        self.props.append({'s': f'prop-{name}', 'x': int(x), 'y': int(y), 'n': n, 'ms': int(d['ms']), 'sway': int(d['sway'])})
        self.feet.append((x, y, r))

    def find(self, name, tx, ty, radius=12, r=8, overlap=0, **kw):
        best = None
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                x, y = tx + dx, ty + dy
                d = math.hypot(dx, dy)
                if best and d >= best[0]:
                    continue
                if self.ground_ok(name, x, y, **kw) and self.ui_clear(name, x, y) and self.spaced(x, y, r) \
                        and self.clear_of_landmarks(name, x, y, pad=-overlap):
                    best = (d, x, y)
        if not best:
            raise SystemExit(f'island: nowhere to put the {name} near ({tx}, {ty}); move its target')
        return best[1], best[2]


def place(I, g, sp):
    """Returns (props, lights, smoke, lighthouse)."""
    P = Placer(I, g, sp)
    lights, smoke = [], []

    def light(x, y, r, c, f):
        lights.append({'x': int(round(x)), 'y': int(round(y)), 'r': r, 'c': c, 'f': f})

    # ---- landmarks ----
    x, y = P.find('lighthouse', 28, 71, r=7)
    P.landmark('lighthouse', x, y, 7)
    lx, ly = sp['lighthouse']['lamp']
    lighthouse = {'x': int(round(x + lx)), 'y': int(round(y + ly))}
    light(x + lx, y + ly, 56, '#fff1b8', 0.05)

    x, y = P.find('windmill', 196, 114, r=9)
    P.landmark('windmill', x, y, 9)

    x, y = P.find('smelter', 296, 120, r=10)
    P.landmark('smelter', x, y, 10)
    sx, sy = sp['smelter']['smoke']
    fx, fy = sp['smelter']['fire']
    smoke.append([int(round(x + sx)), int(round(y + sy))])
    light(x + fx, y + fy, 22, '#ff7a2a', 0.45)

    # the kampung: huts down the lane to the south beach, a fire between them
    for name, tx, ty in (('hut-a', 212, 165), ('hut-b', 219, 181), ('hut-c', 208, 197)):
        x, y = P.find(name, tx, ty, radius=9, r=6, overlap=6)
        P.landmark(name, x, y, 6)
        wx, wy = sp[name]['window']
        light(x + wx, y + wy, 12, '#ffb45a', 0.15)
    x, y = P.find('campfire', 211, 190, radius=12, r=3)
    P.landmark('campfire', x, y, 4)
    light(x, y - 4, 28, '#ff9a3c', 0.6)
    smoke.append([int(x), int(y - 8)])

    # the pier, off the beach closest to the kampung that has deep enough water
    best = None
    for px in range(150, 262):
        ys = np.nonzero(g.alpha[:, px])[0]
        ys = ys[ys > 150]
        if not len(ys):
            continue
        end = int(ys.max())          # where the beach meets the water under the deck's middle
        bx, by = px // I.B, end // I.B
        if not I.LAND[by, bx] or I.OWNER[by, bx] >= 0 or I.TIER[by, bx] != 0:
            continue
        if end + 18 > I.H - 2:
            continue
        # the deck beyond its first few planks, and the boat beside it, are in open water
        if g.alpha[end + 3:end + 18, px - 3:px + 4].any() or g.alpha[end + 5:end + 16, px + 4:px + 10].any():
            continue
        if not P.ui_clear('pier', px, end - 1, need=10):
            continue
        d = math.hypot(px - 213, end - 185)
        if best is None or d < best[0]:
            best = (d, px, end - 1)
    if not best:
        raise SystemExit('island: no stretch of beach for the pier')
    P.landmark('pier', best[1], best[2], 4)

    # lanterns on posts along the roads, spread out
    cand = []
    for yy in range(4, I.H - 4, 2):
        for xx in range(4, I.W - 4, 2):
            if 2.4 <= g.path[yy, xx] < 3.2 and P.ground_ok('lantern', xx, yy) and P.ui_clear('lantern', xx, yy, need=12):
                cand.append((xx, yy))
    chosen = []
    anchors = [(28, 71), (196, 114), (296, 120), (214, 180)]
    for _ in range(7):
        bestc = None
        for c in cand:
            dmin = min(math.hypot(c[0] - a[0], c[1] - a[1]) for a in anchors + chosen)
            if bestc is None or dmin > bestc[0]:
                bestc = (dmin, c)
        if not bestc or bestc[0] < 30:
            break
        chosen.append(bestc[1])
    for xx, yy in chosen:
        P.landmark('lantern', xx, yy, 3)
        ox, oy = sp['lantern']['light']
        light(xx + ox, yy + oy, 16, '#ffcf70', 0.2)

    # the islets: a palm on one, a stone on another
    for isl in I.ISLETS:
        ix, iy = int(isl['x']), int(isl['y'])
        if isl['palm']:
            P.add('palm-b', ix + 1, iy - 1, 3)
        elif isl['rock']:
            P.add('rock-b', ix, iy, 3)
        else:
            P.add('tuft-a', ix - 1, iy - 1, 1)

    # ---- vegetation ----
    near_snow = [(cx, base) for cx, base, w, h, snowy in I.RANGE if snowy]
    near_range = [(cx, base, w) for cx, base, w, h, snowy in I.RANGE]
    clump = I.fbm(np.arange(I.W)[None, :] / 22.0 + np.zeros((I.H, 1)), np.arange(I.H)[:, None] / 22.0 + np.zeros((1, I.W)), 91)

    def species(x, y, roll):
        b, t = int(g.cbio[y, x]), int(g.ctier[y, x])
        foothill = any(abs(x - cx) < w * 0.6 and 0 <= y - base < 16 for cx, base, w in near_range)
        snowy = any(abs(x - cx) < 26 and 0 <= y - base < 14 for cx, base in near_snow)
        if b == 2:
            return ['deadtree-a', 'deadtree-b', 'cactus-a', 'cactus-b', 'boulder-a', 'boulder-b', 'boulder-c', 'scrub-a', 'scrub-b'][int(roll * 9)]
        if b == 3:
            return ['palm-a', 'palm-b', 'palm-c', 'palm-a', 'palm-c', 'palm-b', 'bush-a', 'stone-c'][int(roll * 8)]
        if snowy:
            return ['pine-snow', 'pine-snow', 'pine-b', 'rock-a'][int(roll * 4)]
        if foothill or t >= 3:
            return ['pine-a', 'pine-b', 'pine-c', 'pine-a', 'pine-b', 'rock-a', 'stone-a', 'bush-a'][int(roll * 8)]
        if t == 2:
            return ['oak-a', 'oak-b', 'oak-c', 'pine-a', 'pine-c', 'bush-a', 'bush-b', 'stone-b'][int(roll * 8)]
        return ['oak-a', 'oak-b', 'oak-c', 'oak-a', 'oak-b', 'bush-a', 'bush-b', 'bush-c', 'stone-b'][int(roll * 9)]

    # distance to open water, roughly, for the coastal fringe
    sea = ~g.alpha
    coast = np.full((I.H, I.W), 99.0)
    grown = sea.copy()
    for k in range(1, 12):
        nxt = grown.copy()
        nxt[1:] |= grown[:-1]
        nxt[:-1] |= grown[1:]
        nxt[:, 1:] |= grown[:, :-1]
        nxt[:, :-1] |= grown[:, 1:]
        coast[nxt & ~grown] = k
        grown = nxt
    SMALL = {'oak': 'sapling', 'pine': 'fir', 'palm': 'bush'}
    RAD = {'sapling': 3.5, 'fir': 3, 'oak': 4.5, 'pine': 3.5, 'palm': 4.5, 'bush': 3, 'deadtree': 4, 'cactus': 3, 'boulder': 3.5,
           'scrub': 3, 'rock': 3, 'stone': 2.5}
    pts = []
    for yy in range(3, I.H - 2, 3):
        for xx in range(3, I.W - 2, 3):
            jx = xx + int(h1(xx, yy, 1) * 3)
            jy = yy + int(h1(xx, yy, 2) * 3)
            if 0 <= jx < I.W and 0 <= jy < I.H:
                pts.append((h1(jx, jy, 3), jx, jy))
    # denser where the clump noise is high: a copse, a grove, a thicket of cactus
    pts.sort(key=lambda p: -(clump[p[2], p[1]] * 1.6 + p[0] * 0.5))
    for _, x, y in pts:
        if not (0 <= y < I.H and 0 <= x < I.W) or not g.alpha[y, x]:
            continue
        c = clump[y, x]
        sandy = g.cbio[y, x] == 3
        # the coast gets a fringe of trees whatever the noise says: it frames the island
        coastal = coast[y, x] < 10
        keep = c > 0.42 or h1(x, y, 7) > (0.5 if sandy or coastal else 0.8)
        if not keep:
            continue
        name = species(x, y, h1(x, y, 5))
        def fits(name):
            r = RAD[name.split('-')[0]]
            if not P.ground_ok(name, x, y) or not P.ui_clear(name, x, y) \
                    or not P.spaced(x, y, r * (0.85 if c > 0.6 else 1.1)) or not P.clear_of_landmarks(name, x, y):
                return False
            share, mount = P.claim_share(name, x, y)
            return share <= 0.18 and mount <= 0.25

        kind = name.split('-')[0]
        if not fits(name):
            # a smaller one of the same kind often fits where the full-grown one does not
            if kind not in SMALL:
                continue
            name = SMALL[kind] + '-' + ('a' if h1(x, y, 17) < 0.5 else ('b' if kind != 'palm' else 'a'))
            if not fits(name):
                continue
        P.add(name, x, y, RAD[name.split('-')[0]])

    # small things: tufts and flowers, allowed onto claim ground but never on a line
    own_px = I.OWNER[np.arange(I.H)[:, None] // I.B, np.arange(I.W)[None, :] // I.B]
    for k, (_, x, y) in enumerate(sorted(pts, key=lambda p: p[0])):
        if h1(x, y, 11) > 0.30:
            continue
        x, y = x + 1, y + 1
        if not (0 <= y < I.H and 0 <= x < I.W) or not g.alpha[y, x]:
            continue
        b, t = int(g.cbio[y, x]), int(g.ctier[y, x])
        roll = h1(x, y, 13)
        if b == 0 and t == 1:
            name = ['tuft-a', 'tuft-b', 'tuft-c', 'flower-a', 'flower-b', 'flower-c'][int(roll * 6)]
        elif b == 0:
            name = ['tuft-a', 'tuft-b', 'tuft-c', 'flower-a'][int(roll * 4)]
        else:
            name = 'tuft-dry'
        xs, ys, _, _ = P.pixels(name)
        X, Y = xs + x, ys + y
        if not ((0 <= X).all() and (X < I.W).all() and (0 <= Y).all() and (Y < I.H).all()):
            continue
        # keep off the survey lines: every pixel on one owner's interior
        o = own_px[Y, X]
        if len(set(o.tolist())) > 1:
            continue
        if o[0] >= 0:
            bx, by = X // I.B, Y // I.B
            nb = [I.OWNER[min(I.ROWS - 1, max(0, yy + dy)), min(I.COLS - 1, max(0, xx + dx))]
                  for xx, yy in zip(bx, by) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            if any(v != o[0] for v in nb):
                continue
        if not P.ground_ok(name, x, y, claim_ok=True) or not P.ui_clear(name, x, y) or not P.spaced(x, y, 2) \
                or not P.clear_of_landmarks(name, x, y, pad=-1):
            continue
        P.add(name, x, y, 2)

    props = sorted(P.props, key=lambda p: (p['y'], p['x']))
    return props, lights, smoke, lighthouse

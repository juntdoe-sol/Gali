"""Shared drawing kit for Gali's procedural pixel art: palette, a tiny RGBA canvas."""
import math
import random

from PIL import Image

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



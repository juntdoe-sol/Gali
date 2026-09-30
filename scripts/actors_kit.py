"""Drawing kit for Gali's characters.

A frame is painted into a labelled buffer instead of straight into pixels: every
pixel remembers which output layer it belongs to (base / fit / pick), which
colour ramp it uses, a tone index on that ramp and the body part that painted it.
Painting order is z-order, so later strokes hide earlier ones, and because each
pixel belongs to exactly one layer the engine can stack base, fit, fit-shade,
pick and pick-shade in any order without one hiding another.

Once painted, `finish()` darkens pixels that sit in the shadow of a part in
front of them (light comes from the top left), draws the 1px silhouette outline
and splits the buffer into the five layer images.
"""
import math

from PIL import Image

INK = (42, 28, 20)
CLEAR = (0, 0, 0, 0)

# Colour ramps, dark to light.
RAMPS = {
    'skin': [(104, 58, 44), (150, 88, 60), (192, 124, 82), (224, 162, 112), (240, 190, 140)],
    'hair': [(56, 40, 40), (80, 56, 50), (110, 80, 64), (144, 112, 90)],
    'beard': [(62, 44, 42), (90, 64, 54), (124, 92, 74), (164, 150, 140), (206, 198, 190)],
    'grey': [(118, 110, 108), (160, 154, 148), (206, 202, 194)],
    'vest': [(120, 116, 132), (172, 170, 180), (216, 214, 216), (246, 244, 238)],
    'boot': [(46, 38, 40), (72, 60, 56), (100, 86, 76), (132, 118, 104)],
    'wood': [(86, 52, 32), (124, 80, 46), (160, 112, 66), (194, 148, 96)],
    'sack': [(96, 70, 44), (136, 102, 62), (174, 138, 88), (208, 176, 124), (230, 206, 158)],
    'gold': [(150, 96, 22), (206, 138, 34), (246, 188, 54), (255, 224, 110), (255, 248, 196)],
    'towel': [(170, 166, 160), (220, 216, 208), (250, 248, 240)],
    'red': [(120, 30, 34), (184, 50, 48), (226, 86, 70)],
    'ink': [INK, INK, INK],
    'eye': [(28, 18, 16), (28, 18, 16)],
    'white': [(236, 236, 240), (255, 255, 255)],
    'mouth': [(96, 30, 30), (150, 50, 50), (210, 110, 100)],
    'smear': [(255, 255, 255)],
    # fit / pick are masks: the "colour" is decided by the engine's tint and the
    # tone index only drives the shade overlay.
    'fit': [None] * 5,
    'pick': [None] * 5,
}

# Shade overlays for masks, by tone: 0 deep shadow .. 2 flat .. 4 specular.
# A cool purple-black for shadows and a warm white for light keeps the tinted
# colour from going muddy.
MASK_SHADE = {
    0: (26, 16, 44, 150),
    1: (26, 16, 44, 78),
    2: None,
    3: (255, 246, 220, 70),
    4: (255, 255, 255, 150),
}
PICK_SHADE = {
    0: (20, 14, 34, 150),
    1: (20, 14, 34, 80),
    2: None,
    3: (255, 255, 255, 110),
    4: (255, 255, 255, 220),
}

LIGHT = (-0.62, -0.78)  # direction the light comes FROM (top left)


class Frame:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[None] * w for _ in range(h)]
        self.detail = {}  # (x, y) -> RGBA drawn opaque-ish in the fit-shade layer
        self.pdetail = {}  # (x, y) -> RGBA in the pick-shade layer
        self.extra = []  # (x, y, rgba) translucent base-layer pixels (smears)

    # ---- painting ----
    def put(self, x, y, ramp, tone, part='', layer=None):
        x, y = int(math.floor(x)), int(math.floor(y))
        if not (0 <= x < self.w and 0 <= y < self.h):
            return
        if layer is None:
            layer = 'fit' if ramp == 'fit' else 'pick' if ramp == 'pick' else 'base'
        n = len(RAMPS[ramp])
        tone = max(0, min(n - 1, int(tone)))
        self.px[y][x] = [layer, ramp, tone, part]
        self.detail.pop((x, y), None)
        self.pdetail.pop((x, y), None)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def part_at(self, x, y):
        p = self.get(x, y)
        return p[3] if p else None

    def erase(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = None

    def shift_tone(self, x, y, d):
        p = self.get(x, y)
        if p:
            n = len(RAMPS[p[1]])
            p[2] = max(0, min(n - 1, p[2] + d))

    def stamp(self, rows, ox, oy, legend, part='', flip=False):
        """Paint a hand-drawn grid. legend: char -> (ramp, tone) or None for skip."""
        for j, row in enumerate(rows):
            w = len(row)
            for i, ch in enumerate(row):
                if ch in ' .':
                    continue
                spec = legend[ch]
                if spec is None:
                    continue
                x = ox + (w - 1 - i if flip else i)
                if spec == 'erase':
                    self.erase(x, oy + j)
                    continue
                ramp, tone = spec[0], spec[1]
                p = spec[2] if len(spec) > 2 else part
                self.put(x, oy + j, ramp, tone, p)

    def capsule(self, a, b, r, ramp, tones, part='', light=LIGHT, bias=0.0):
        """Thick segment a->b with radius r, shaded by its round cross-section.
        tones: (dark, mid, light) indices on the ramp."""
        ax, ay = a
        bx, by = b
        x0, x1 = int(min(ax, bx) - r - 1), int(max(ax, bx) + r + 2)
        y0, y1 = int(min(ay, by) - r - 1), int(max(ay, by) + r + 2)
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-6
        for y in range(y0, y1):
            for x in range(x0, x1):
                px, py = x + 0.5, y + 0.5
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                qx, qy = ax + dx * t, ay + dy * t
                nx, ny = px - qx, py - qy
                d = math.hypot(nx, ny)
                if d <= r:
                    if d > 1e-6:
                        nx, ny = nx / d, ny / d
                    v = -(nx * light[0] + ny * light[1]) * min(1, d / max(r, 0.01)) + bias
                    tone = tones[0] if v < -0.25 else tones[2] if v > 0.35 else tones[1]
                    self.put(x, y, ramp, tone, part)

    def blob(self, cx, cy, rx, ry, ramp, tones, part='', light=LIGHT, bias=0.0):
        """Filled ellipse shaded like a lit sphere. tones: 3 or more, dark to light."""
        n = len(tones)
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                nx, ny = (x + 0.5 - cx) / max(rx, 0.01), (y + 0.5 - cy) / max(ry, 0.01)
                d = nx * nx + ny * ny
                if d <= 1:
                    v = -(nx * light[0] + ny * light[1]) + bias
                    k = int((v + 1) / 2 * n)
                    self.put(x, y, ramp, tones[max(0, min(n - 1, k))], part)

    def line(self, a, b, ramp, tone, part=''):
        for x, y in bresenham(a, b):
            self.put(x, y, ramp, tone, part)

    # ---- finishing ----
    def cast_shadows(self, pairs):
        """pairs: {(front_part, behind_part)}. A behind pixel directly right of or
        below a front pixel drops one tone (the front part's shadow)."""
        dark = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p:
                    continue
                for dx, dy in ((-1, 0), (0, -1), (-1, -1)):
                    q = self.get(x + dx, y + dy)
                    if q and (q[3], p[3]) in pairs:
                        dark.append((x, y))
                        break
        for x, y in dark:
            self.shift_tone(x, y, -1)

    def bevel(self, parts, lit=1, dark=-1, ramps=None):
        """Rim shading for the given parts: pixels on the top/left edge of the
        part go up a tone, pixels on the bottom/right edge go down one."""
        parts = set(parts)
        changes = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p or p[3] not in parts or (ramps and p[1] not in ramps):
                    continue
                same = lambda dx, dy: (self.part_at(x + dx, y + dy) == p[3])
                d = 0
                if not same(1, 0) or not same(0, 1):
                    d = dark
                if not same(-1, 0) or not same(0, -1):
                    d = lit if d == 0 else 0
                if d:
                    changes.append((x, y, d))
        for x, y, d in changes:
            self.shift_tone(x, y, d)

    def contour(self, pairs, tone=0):
        """Where a front part touches a behind part, the behind pixel drops to
        the given tone (a soft internal line instead of full ink)."""
        marks = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = self.get(x + dx, y + dy)
                    if q and (q[3], p[3]) in pairs:
                        marks.append((x, y))
                        break
        for x, y in marks:
            self.px[y][x][2] = tone

    def ink_between(self, pairs):
        """Hard ink line on the behind part where front meets behind (used where
        tones alone would merge, e.g. an arm over a same-coloured arm)."""
        marks = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = self.get(x + dx, y + dy)
                    if q and (q[3], p[3]) in pairs:
                        marks.append((x, y))
                        break
        for x, y in marks:
            self.px[y][x] = ['base', 'ink', 0, 'ink']

    def render(self, outline=True):
        """Returns dict of layer name -> PIL image."""
        w, h = self.w, self.h
        base = Image.new('RGBA', (w, h), CLEAR)
        fit = Image.new('RGBA', (w, h), CLEAR)
        fits = Image.new('RGBA', (w, h), CLEAR)
        pick = Image.new('RGBA', (w, h), CLEAR)
        picks = Image.new('RGBA', (w, h), CLEAR)
        B, F, FS, P, PS = base.load(), fit.load(), fits.load(), pick.load(), picks.load()
        for y in range(h):
            for x in range(w):
                p = self.px[y][x]
                if not p:
                    continue
                layer, ramp, tone, _part = p
                if layer == 'fit':
                    F[x, y] = (255, 255, 255, 255)
                    s = self.detail.get((x, y)) or MASK_SHADE.get(tone)
                    if s:
                        FS[x, y] = s
                elif layer == 'pick':
                    P[x, y] = (255, 255, 255, 255)
                    s = self.pdetail.get((x, y)) or PICK_SHADE.get(tone)
                    if s:
                        PS[x, y] = s
                else:
                    B[x, y] = (*RAMPS[ramp][tone], 255)
        if outline:
            filled = [[self.px[y][x] is not None for x in range(w)] for y in range(h)]
            for y in range(h):
                for x in range(w):
                    if filled[y][x]:
                        continue
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and filled[ny][nx]:
                            B[x, y] = (*INK, 255)
                            break
        # ring the pick head with ink inside pick-shade, so it keeps its outline
        # when the engine draws it over the hat. Behind-the-body frames only ring
        # where the base is empty or already outline.
        ring = getattr(self, 'pick_ring', None)
        if ring:
            for y in range(h):
                for x in range(w):
                    p = self.px[y][x]
                    if p and p[0] == 'pick':
                        continue
                    near = False
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        q = self.get(x + dx, y + dy)
                        if q and q[0] == 'pick':
                            near = True
                            break
                    if not near:
                        continue
                    if ring == 'all' or B[x, y][3] == 0 or B[x, y][:3] == INK:
                        if not (p and p[3].startswith('arm-f')):
                            PS[x, y] = (*INK, 255)
        for x, y, col in self.extra:
            if 0 <= x < w and 0 <= y < h and B[x, y][3] == 0 and not self.px[y][x]:
                B[x, y] = col
        return {'base': base, 'fit': fit, 'fit-shade': fits, 'pick': pick, 'pick-shade': picks}


def bresenham(a, b):
    x0, y0 = int(round(a[0])), int(round(a[1]))
    x1, y1 = int(round(b[0])), int(round(b[1]))
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    out = []
    while True:
        out.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return out


def outline_img(img, col=INK):
    """1px 4-neighbour outline around a full-colour RGBA image (in place copy)."""
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


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def ramp_from(rgb, n=5, dark=(24, 14, 40), light=(255, 250, 230)):
    """A hue-shifted ramp around one colour: shadows cool, lights warm."""
    out = []
    for k in range(n):
        t = k / (n - 1)
        if t < 0.5:
            out.append(mix(dark, rgb, 0.35 + 0.65 * t * 2))
        else:
            out.append(mix(rgb, light, (t - 0.5) * 2 * 0.6))
    return out

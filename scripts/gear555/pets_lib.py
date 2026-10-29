"""Helpers for the pet slot (gear/pets.py). Pets face right, lit from the top left,
drawn on the rig's Frame and rendered with the ink outline."""
import math
import sys

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import kit  # noqa: E402
from kit import ramp, pet_frame, pet_render  # noqa: E402,F401
import actors_critters as C  # noqa: E402
from actors_kit import RAMPS, bresenham, hexrgb, mix  # noqa: E402,F401
from PIL import Image  # noqa: E402

BOB = (0, -1, -1, 0)
PINK = '#ff96b0'
WHITE = '#f4f2ee'
INKC = '#2a1c24'


def R(col):
    return ramp(col)


def frame(w, h):
    return pet_frame(w, h)


def B(f, cx, cy, rx, ry, col, part='body', tones=(1, 2, 2, 3), bias=0.0):
    f.blob(cx, cy, rx, ry, R(col), tones, part, bias=bias)


def CAP(f, a, b, r, col, part='body', tones=(1, 2, 3)):
    f.capsule(a, b, r, R(col), tones, part)


def P(f, x, y, col, tone=2, part='d'):
    f.put(x, y, R(col), tone, part)


def LN(f, a, b, col, tone=2, part='d'):
    for x, y in bresenham(a, b):
        f.put(x, y, R(col), tone, part)


def S(f, ox, oy, rows, legend, part='s'):
    """legend: char -> col | (col, tone) | (col, tone, part)."""
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in ' .':
                continue
            spec = legend[ch]
            if spec is None:
                continue
            if spec == 'erase':
                f.erase(ox + i, oy + j)
                continue
            if isinstance(spec, tuple):
                col, tone = spec[0], spec[1]
                pt = spec[2] if len(spec) > 2 else part
            else:
                col, tone, pt = spec, 2, part
            f.put(ox + i, oy + j, R(col), tone, pt)


def eye(f, x, y, blink=False, size=1, part='face'):
    """size 1: one dark pixel. size 2: 2x2 with a white glint top-left.
    size 3: a tall 1x2 eye with a glint on top."""
    if blink:
        for k in range(max(1, size if size != 3 else 1)):
            f.put(x + k, y + (1 if size >= 2 else 0), 'eye', 0, part)
        return
    if size == 1:
        f.put(x, y, 'eye', 0, part)
    elif size == 3:
        f.put(x, y, 'white', 1, part)
        f.put(x, y + 1, 'eye', 0, part)
    else:
        f.put(x, y, 'white', 1, part)
        f.put(x + 1, y, 'eye', 0, part)
        f.put(x, y + 1, 'eye', 0, part)
        f.put(x + 1, y + 1, 'eye', 0, part)


def bigeye(f, x, y, blink=False, part='face', look=1):
    """2x2 white eye with a 1px pupil (frogs, chicks)."""
    if blink:
        f.put(x, y + 1, 'eye', 0, part)
        f.put(x + 1, y + 1, 'eye', 0, part)
        return
    for (dx, dy) in ((0, 0), (1, 0), (0, 1), (1, 1)):
        f.put(x + dx, y + dy, 'white', 1 if dy == 0 else 0, part)
    f.put(x + (1 if look > 0 else 0), y + 1, 'eye', 0, part)


def blush(f, x, y):
    f.put(x, y, R(PINK), 3, 'face')


def outline_off(f):
    return f.render(outline=False)['base']


def render(f):
    return pet_render(f)


# ---------------------------------------------------------------- post effects
def setpx(img, x, y, rgb, a=255, over=False):
    if 0 <= x < img.width and 0 <= y < img.height:
        px = img.load()
        if over or px[x, y][3] == 0:
            px[x, y] = (*rgb, a)


def spark(img, x, y, rgb=(255, 248, 196), arm=1, over=False):
    setpx(img, x, y, (255, 255, 255), 255, over)
    for k in range(1, arm + 1):
        a = 230 if k == 1 else 140
        for dx, dy in ((k, 0), (-k, 0), (0, k), (0, -k)):
            setpx(img, x + dx, y + dy, rgb, a, over)


def dot(img, x, y, rgb, a=255, over=False):
    setpx(img, x, y, rgb, a, over)


def halo(img, rgb, cx, cy, r, amax):
    if isinstance(rgb, str):
        rgb = hexrgb(rgb)
    return C.halo(img, rgb, cx, cy, r, amax)


def ink_outline(img):
    from actors_kit import outline_img
    return outline_img(img)


def pad(img, w, h, ox=0, oy=0):
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.alpha_composite(img, (ox, oy))
    return out


def fixed(fn, w, h, anchor='bottom'):
    """Wrap a frame fn so every frame has the same size (pads centred/bottom)."""
    def g(t):
        im = fn(t)
        if im.size == (w, h):
            return im
        ox = (w - im.width) // 2
        oy = h - im.height if anchor == 'bottom' else (h - im.height) // 2
        return pad(im, w, h, ox, oy)
    return g


def tone_px(f, x, y, d):
    f.shift_tone(x, y, d)


def has(f, x, y, part=None):
    p = f.get(x, y)
    return bool(p) and (part is None or p[3] == part)


def poly(f, pts, col, tone=2, part='d', shade=None):
    """Fill a polygon. shade(x, y) -> tone overrides tone."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    for y in range(int(math.floor(min(ys))), int(math.ceil(max(ys))) + 1):
        for x in range(int(math.floor(min(xs))), int(math.ceil(max(xs))) + 1):
            if C._inside(pts, x + 0.5, y + 0.5):
                f.put(x, y, R(col), shade(x, y) if shade else tone, part)


def box(f, x0, y0, x1, y1, col, part='d', rnd=True, lit=3, mid=2, dk=1):
    """Shaded rectangle (inclusive), lit top/left, dark bottom/right, corners trimmed."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if rnd and (x in (x0, x1)) and (y in (y0, y1)):
                continue
            tone = mid
            if y == y0 or x == x0:
                tone = lit
            if y == y1 or x == x1:
                tone = dk
            f.put(x, y, R(col), tone, part)


def clip(f, keep):
    """Erase every pixel where keep(x, y) is False."""
    for y in range(f.h):
        for x in range(f.w):
            if f.px[y][x] and not keep(x, y):
                f.px[y][x] = None


def recolor(f, part, col, only=None):
    for y in range(f.h):
        for x in range(f.w):
            p = f.px[y][x]
            if p and p[3] == part and (only is None or only(x, y)):
                p[1] = R(col)


def text(f, ox, oy, rows, col, tone=0, part='txt'):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '#':
                f.put(ox + i, oy + j, R(col), tone, part)

"""Gali Island: the board the game is played on.

Generates the terrain, the 25 claim territories and the things that move on the
sea, into app/assets/pixel/. Called from pixel-art.py so one command rebuilds
every sprite the app uses.

The mockup that got signed off was landscape (560x392). The phone is not, so the
island is re-authored here at the app's own map size and the claim seeds are
placed for a tall frame: the range across the north, badlands down the east,
meadow through the middle, beach along the south.

Nothing about the chain changes. Claim `i` is ORE square `i`, 0 to 24.
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

# ---- the frame ----
#
# Shaped for the playfield, not for the phone. The screen is portrait, but the
# board sits between the HUD and the deploy panel, and that gap is about 390x193
# — landscape. An island authored portrait renders there at 40% scale with the
# claim labels on top of each other, which is how this was found out.
W, H = 360, 210          # logical pixels; matches META.map, so the app fits it as one piece
B = 3                    # terrain block, in logical pixels
COLS, ROWS = W // B, H // B   # 90 x 110

CLAIM_COUNT = 25


# ---- value noise, the same shape as the mockup's ----
def _hash(n: float) -> float:
    x = math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)


def _hash_grid(a: np.ndarray, b: np.ndarray, seed: float) -> np.ndarray:
    x = np.sin(a * 157.3 + b * 271.9 + seed * 57.1) * 43758.5453
    return x - np.floor(x)


def noise(x: np.ndarray, y: np.ndarray, seed: float) -> np.ndarray:
    xi, yi = np.floor(x), np.floor(y)
    xf, yf = x - xi, y - yi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    a = _hash_grid(xi, yi, seed)
    b = _hash_grid(xi + 1, yi, seed)
    c = _hash_grid(xi, yi + 1, seed)
    d = _hash_grid(xi + 1, yi + 1, seed)
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def fbm(x, y, s):
    return noise(x, y, s) * 0.6 + noise(x * 2.1, y * 2.1, s + 9) * 0.28 + noise(x * 4.3, y * 4.3, s + 17) * 0.12


GX, GY = np.meshgrid(np.arange(COLS, dtype=float), np.arange(ROWS, dtype=float))

# ---- the island as a field, so the coast comes out ragged rather than blocky ----
CX, CY = COLS / 2.0, ROWS / 2.0 - 3.0
RX, RY = COLS * 0.415, ROWS * 0.378


def _landness() -> np.ndarray:
    dx = (GX - CX) / RX
    dy = (GY - CY) / RY
    d = np.sqrt(dx * dx + dy * dy)
    ang = np.arctan2(dy, dx)
    d = d * (1 + 0.12 * np.sin(ang * 3 + 0.9) + 0.07 * np.sin(ang * 5 - 2.1))
    return (1 - d) + (fbm(GX / 16, GY / 16, 3) - 0.5) * 0.40


LANDNESS = _landness()
LAND = (LANDNESS > 0)

# the northern range: a few peaks the elevation piles up around
PEAKS = [(37, 11, 17, 1.05), (51, 7, 20, 1.25), (66, 10, 18, 1.12), (83, 12, 15, 0.95), (25, 17, 13, 0.82)]

# gentle relief only: the range is drawn on top as objects, so the ground
# underneath stays walkable rather than spiking into snow.
ELEV = np.minimum(1.0, LANDNESS * 1.35) * 0.62 + fbm(GX / 13, GY / 13, 7) * 0.34
for px, py, pr, ph in PEAKS:
    d = np.hypot(GX - px, GY - py) / pr
    ELEV += np.where(d < 1, (1 - d) ** 2 * ph * 0.30, 0.0)
# the south end sinks towards the water, which is what gives South Sands a beach
# wide enough to read as one rather than a one-block rim of sand
ELEV -= np.clip((GY - ROWS * 0.68) / (ROWS * 0.28), 0, 1) ** 1.6 * 0.42
ELEV = np.where(LAND, ELEV, -1.0)

# tiers: 0 beach, 1 lowland, 2 upland, 3 highland
TIER = np.where(LAND, np.digitize(ELEV, [0.16, 0.46, 0.80]), -1).astype(np.int8)

# ---- biomes: 0 meadow, 1 snow/alpine, 2 badlands, 3 sand ----
_east = (GX - COLS * 0.62) / (COLS * 0.40) + (fbm(GX / 9, GY / 9, 21) - 0.5) * 1.5 + np.sin(GY / 11) * 0.18
BIOME = np.zeros((ROWS, COLS), dtype=np.int8)
BIOME[(_east > 0.12) & (TIER >= 1)] = 2
BIOME[TIER == 0] = 3
BIOME[(TIER == 3) & (GY < ROWS * 0.28)] = 1
BIOME[TIER < 0] = -1


def at(arr, x, y, oob=-1):
    if 0 <= x < COLS and 0 <= y < ROWS:
        return arr[y][x]
    return oob


tier = lambda x, y: int(at(TIER, x, y, -1))
biome = lambda x, y: int(at(BIOME, x, y, -1))
is_land = lambda x, y: 0 <= x < COLS and 0 <= y < ROWS and bool(LAND[y][x])

# ---- rivers, walked downhill from the range ----
RIVER = np.zeros((ROWS, COLS), dtype=bool)


def carve_river(sx, sy):
    x, y = sx, sy
    for step in range(300):
        if not is_land(x, y):
            break
        w = 1 if step > 46 else 0
        for d in range(-w, w + 1):
            if 0 <= x + d < COLS:
                RIVER[y][x + d] = True
        bx, by, be = x, y, ELEV[y][x]
        for dy in (0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = x + dx, y + dy
                if not (0 <= nx < COLS and 0 <= ny < ROWS):
                    continue
                e = ELEV[ny][nx] + (_hash(nx * 7.1 + ny * 3.3) - 0.5) * 0.05 if is_land(nx, ny) else -2
                if e < be:
                    be, bx, by = e, nx, ny
        if (bx, by) == (x, y):
            y += 1
        else:
            x, y = bx, by


carve_river(46, 20)
carve_river(62, 22)
carve_river(30, 24)
river = lambda x, y: bool(at(RIVER, x, y, False))

# ---- the 25 claims ----
# Six bands down the island, widest through the middle where there is most land.
# `k` picks the icon, `r` the region the HUD names.
CLAIMS = [
    dict(i=0,  sx=23, sy=21, k='scree',    r='The Cap'),
    dict(i=1,  sx=37, sy=16, k='scree',    r='The Cap'),
    dict(i=2,  sx=17, sy=30, k='cave',     r='The Cap'),
    dict(i=3,  sx=30, sy=26, k='dig',      r='The Cap'),
    dict(i=4,  sx=52, sy=18, k='scree',    r='The Cap'),

    dict(i=5,  sx=69, sy=14, k='scree',    r='Rust Badlands'),
    dict(i=6,  sx=90, sy=18, k='gold',     r='Rust Badlands'),
    dict(i=7,  sx=80, sy=26, k='dig',      r='Rust Badlands'),
    dict(i=8,  sx=99, sy=30, k='gold',     r='Rust Badlands'),
    dict(i=9,  sx=87, sy=38, k='dig',      r='Rust Badlands'),

    dict(i=10, sx=45, sy=25, k='dig',      r='The Green'),
    dict(i=11, sx=58, sy=23, k='dig',      r='The Green'),
    dict(i=12, sx=37, sy=36, k='gold',     r='The Green'),
    dict(i=13, sx=53, sy=34, k='dig',      r='The Green'),
    dict(i=14, sx=25, sy=41, k='cave',     r='The Green'),
    dict(i=15, sx=67, sy=34, k='dig',      r='The Green'),

    dict(i=16, sx=78, sy=45, k='dig',      r='Rust Badlands'),
    dict(i=17, sx=66, sy=46, k='reef',     r='South Sands'),
    dict(i=18, sx=49, sy=45, k='dig',      r='The Green'),
    dict(i=19, sx=92, sy=50, k='scree',    r='Rust Badlands'),

    dict(i=20, sx=33, sy=50, k='dig',      r='South Sands'),
    dict(i=21, sx=54, sy=56, k='reef',     r='South Sands'),
    dict(i=22, sx=21, sy=48, k='cave',     r='South Sands'),
    dict(i=23, sx=72, sy=57, k='reef',     r='South Sands'),
    dict(i=24, sx=40, sy=59, k='gold',     r='South Sands'),
]
assert len(CLAIMS) == CLAIM_COUNT

# Each claim takes the ground nearest its seed, up to a fixed budget of blocks.
#
# A plain radius produced claims of wildly different size — the ones near the
# coast came out a tenth of the inland ones, which is unfair to tap and unfair to
# play. Ranking by distance and cutting at a budget keeps them comparable while
# the jitter and the wobble below keep the edges ragged rather than circular.
# Whatever is left over is open ground: roads, meadow, beach, the land players
# walk on. A board where the claims meet edge to edge has nowhere to stand.
# The budget is a compromise between two things a player wants at once: claims
# big enough to hit with a thumb, and enough open ground between them that the
# island reads as somewhere you walk rather than a tiled board. The claim itself
# stops short of thumb-sized; the tap tolerance in the app (see island.ts) makes
# up the rest, which is free — it costs no pixels.
BUDGET = 96       # blocks per claim
MIN_AREA = 96     # a claim below this is too small to tap; it takes more ground
MIN_FAT = 3       # blocks of radius at the claim's thickest point
MAX_REACH = 11.0  # blocks; a claim never sprawls further than this for its budget

def relax(seeds, rounds=24):
    """Lloyd relaxation over the land, so the 25 claims come out evenly spread.

    The seeds above are placed by hand, and by hand it is impossible to keep 25
    of them balanced on a coastline: one ends up hemmed between two neighbours
    and the sea, and comes out a sliver no thumb can hit. Each pass reassigns
    every land block to its nearest seed and moves the seed to the middle of
    what it got, which pulls seeds off the coast and away from each other until
    the regions are of a size. The hand placement still decides the layout; this
    only takes the unfairness out of it.
    """
    ly, lx = np.nonzero(LAND)
    pts = np.array(seeds, dtype=float)
    for _ in range(rounds):
        who = np.argmin((lx[None, :] - pts[:, :1]) ** 2 + (ly[None, :] - pts[:, 1:2]) ** 2, axis=0)
        moved = 0.0
        for i in range(len(pts)):
            m = who == i
            if not m.any():
                continue
            nxt = np.array([lx[m].mean(), ly[m].mean()])
            moved = max(moved, float(np.hypot(*(nxt - pts[i]))))
            pts[i] = nxt
        if moved < 0.05:
            break
    return pts


SEEDS = relax([(c['sx'], c['sy']) for c in CLAIMS])

_px = GX + (noise(GX / 9, GY / 9, 1) - 0.5) * 5
_py = GY + (noise(GX / 9, GY / 9, 2) - 0.5) * 5
_best = np.full((ROWS, COLS), -1, dtype=np.int8)
_bd = np.full((ROWS, COLS), 1e9)
for c in CLAIMS:
    sx, sy = SEEDS[c['i']]
    d = np.hypot(sx - _px, sy - _py)
    hit = d < _bd
    _bd = np.where(hit, d, _bd)
    _best = np.where(hit, c['i'], _best).astype(np.int8)
# the reach wobbles, so a claim is a worked patch rather than a circle
_bd = _bd / (0.84 + noise(GX / 6, GY / 6, 11) * 0.36)
_raw = np.where(LAND, _bd, np.inf)
_bd = np.where(_bd <= MAX_REACH, _raw, np.inf)

OWNER = np.full((ROWS, COLS), -1, dtype=np.int8)
for c in CLAIMS:
    ys, xs = np.nonzero((_best == c['i']) & np.isfinite(_bd))
    if len(xs) == 0:
        raise SystemExit(f"claim {c['i']} has no ground near its seed; move it inland")
    keep = np.argsort(_bd[ys, xs], kind='stable')[:BUDGET]
    OWNER[ys[keep], xs[keep]] = c['i']

# drop any stray block cut off from its claim's main body
_pad = np.full((ROWS + 2, COLS + 2), -2, dtype=np.int8)
_pad[1:-1, 1:-1] = OWNER
_same = np.zeros((ROWS, COLS), dtype=np.int16)
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        _same += (_pad[1 + dy:ROWS + 1 + dy, 1 + dx:COLS + 1 + dx] == OWNER)
OWNER = np.where((OWNER >= 0) & (_same <= 2), -1, OWNER).astype(np.int8)

def fat_radius(i):
    """Blocks of radius at the claim's thickest point: what a thumb has to hit."""
    own = (OWNER == i)
    pad = np.zeros((ROWS + 2, COLS + 2), dtype=bool)
    pad[1:-1, 1:-1] = own
    grown = own
    for r in range(1, 10):
        nxt = grown.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nxt &= pad[1 + dy:ROWS + 1 + dy, 1 + dx:COLS + 1 + dx]
        if not nxt.any():
            return r - 1
        pad[:] = False
        pad[1:-1, 1:-1] = nxt
        grown = nxt
    return 9


def neighbours_of(i):
    """How many blocks of claim `i` touch each block on the map."""
    pad = np.zeros((ROWS + 2, COLS + 2), dtype=np.int16)
    pad[1:-1, 1:-1] = (OWNER == i)
    n = np.zeros((ROWS, COLS), dtype=np.int16)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx or dy:
                n += pad[1 + dy:ROWS + 1 + dy, 1 + dx:COLS + 1 + dx]
    return n


# A claim hemmed in by the coast ends up a sliver, and so does one the wobble
# happens to carve a notch out of. Either way it is a claim a player cannot
# reliably hit with a thumb. Rather than leave it and hand-move the seed, let it
# take more of the open ground next to it until it is both big enough and fat
# enough. Filling beside blocks it already owns widens the claim instead of
# growing a tail, which is what the thickness floor actually cares about.
for c in CLAIMS:
    i = c['i']
    for _ in range(24):
        area = int((OWNER == i).sum())
        if area >= MIN_AREA and fat_radius(i) >= MIN_FAT:
            break
        free = (OWNER < 0) & np.isfinite(_raw) & (neighbours_of(i) >= 3)
        ys, xs = np.nonzero(free)
        if len(xs) == 0:
            break
        take = np.argsort(_raw[ys, xs], kind='stable')[:8]
        OWNER[ys[take], xs[take]] = i

_bad = [(c['i'], int((OWNER == c['i']).sum()), fat_radius(c['i'])) for c in CLAIMS
        if int((OWNER == c['i']).sum()) < MIN_AREA or fat_radius(c['i']) < MIN_FAT]
if _bad:
    raise SystemExit(
        'these claims are too small to tap (claim, blocks, thickest radius): '
        + repr(_bad) + f'\nfloors are {MIN_AREA} blocks and radius {MIN_FAT}; move their seeds inland')

owner_at = lambda x, y: int(at(OWNER, x, y, -1))

# centroids, in logical pixels
CEN = []
for c in CLAIMS:
    ys, xs = np.nonzero(OWNER == c['i'])
    if len(xs) == 0:
        raise SystemExit(f"claim {c['i']} ended up with no ground; move its seed")
    CEN.append((int(round(xs.mean() * B + B / 2)), int(round(ys.mean() * B + B / 2)), len(xs)))


def ground_of(i):
    """The region a claim sits in and the icon that belongs there.

    Read off the ground rather than a hand-written table: relaxation moves the
    claims, and a table would quietly end up putting a coral reef in the snow.
    """
    own = OWNER == i
    bio = int(np.bincount((BIOME[own] + 1).astype(int), minlength=5).argmax()) - 1
    ys, _ = np.nonzero(own)
    north = ys.mean() < ROWS * 0.36
    if bio == 2:
        return ('gold' if i % 2 else 'dig'), 'Rust Badlands'
    if bio == 3:
        return ('reef' if i % 2 else 'gold'), 'South Sands'
    if bio == 1 or north:
        return ('scree' if i % 2 else 'cave'), 'The Cap'
    return ('dig' if i % 3 else 'gold' if i % 2 else 'cave'), 'The Green'


for _c in CLAIMS:
    _c['k'], _c['r'] = ground_of(_c['i'])


# ---- painting ----
def hexc(s):
    s = s.lstrip('#')
    if len(s) == 8:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), int(s[6:8], 16) / 255)
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 1.0)


class Paint:
    """A small opaque canvas with alpha-blended rectangles, drawn at 1x."""

    def __init__(self, w, h):
        self.a = np.zeros((h, w, 3), dtype=np.float64)
        self.w, self.h = w, h

    def rect(self, x, y, w, h, col):
        x0, y0 = max(0, int(x)), max(0, int(y))
        x1, y1 = min(self.w, int(x) + int(w)), min(self.h, int(y) + int(h))
        if x1 <= x0 or y1 <= y0:
            return
        r, g, b, al = hexc(col)
        view = self.a[y0:y1, x0:x1]
        if al >= 1:
            view[:] = (r, g, b)
        else:
            view *= (1 - al)
            view += np.array((r, g, b)) * al

    def image(self):
        return Image.fromarray(self.a.round().clip(0, 255).astype(np.uint8), 'RGB').convert('RGBA')


TOP = [
    ['#e3cf94', '#d8c185', '#6aa54a', '#5c9440', '#4f8a38', '#467d31', '#8f9a86', '#7d8a76', '#eef4fb', '#dbe7f5'],
    ['#e3cf94', '#d8c185', '#cfe0f2', '#bed4ec', '#e8f0fa', '#d5e4f4', '#f4f9ff', '#e2eefb', '#ffffff', '#eef6ff'],
    ['#e0c88c', '#d2b87c', '#d99a4a', '#c98a3e', '#c9803a', '#b57132', '#a85f2c', '#945124', '#c9a179', '#b88f68'],
    ['#efe0ae', '#e3cf94', '#e3cf94', '#d8c185', '#d0b678', '#c4a96c', '#b89c60', '#ab8f56', '#efe0ae', '#e3cf94'],
]
FACE = [('#6b4a32', '#4a3122'), ('#6e7a8c', '#4c5666'), ('#8a4a22', '#5e3115'), ('#a8905c', '#7a6740')]

P = Paint(W, H)


# The open sea repeats every SEA_TILE pixels, so the app can tile the same water
# across the whole screen behind the board. Without it the map floats on a flat
# blue rectangle with a visible edge, which is what the ocean around the island
# looked like before.
SEA_TILE = 24
SEA_DEEP, SEA_DARK, SEA_LIGHT = '#123a6b', '#0a1330', '#16477e'


def sea_speckle(paint, w, h):
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            n = _hash((x % SEA_TILE) * 0.37 + (y % SEA_TILE) * 1.13)
            if n > 0.86:
                paint.rect(x, y, 4, 2, SEA_DARK)
            elif n < 0.08:
                paint.rect(x, y, 4, 2, SEA_LIGHT)


def sea_tile():
    t = Paint(SEA_TILE, SEA_TILE)
    t.rect(0, 0, SEA_TILE, SEA_TILE, SEA_DEEP)
    sea_speckle(t, SEA_TILE, SEA_TILE)
    return t.image()


def paint_sea():
    P.rect(0, 0, W, H, SEA_DEEP)
    sea_speckle(P, W, H)
    pad = np.zeros((ROWS + 6, COLS + 6), dtype=np.int16)
    pad[3:-3, 3:-3] = LAND
    near1 = sum(pad[3 + dy:ROWS + 3 + dy, 3 + dx:COLS + 3 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    near3 = sum(pad[3 + dy:ROWS + 3 + dy, 3 + dx:COLS + 3 + dx] for dy in range(-3, 4) for dx in range(-3, 4))
    for y in range(ROWS):
        for x in range(COLS):
            if LAND[y][x]:
                continue
            if near1[y][x]:
                P.rect(x * B, y * B, B, B, '#6fd3e8')
            elif near3[y][x]:
                P.rect(x * B, y * B, B, B, '#1d6ea8')


# ---- small islands out in the sea: somewhere for the eye to rest, nothing to tap ----
ISLETS = [
    dict(x=134, y=30,  r=1.8, palm=False, rock=False),
    dict(x=288, y=186, r=2.0, palm=False, rock=False),
    dict(x=54,  y=178, r=2.2, palm=True,  rock=False),
    dict(x=302, y=48,  r=2.0, palm=False, rock=True),
]


def paint_islets():
    for isl in ISLETS:
        cx, cy, r = isl['x'] / B, isl['y'] / B, isl['r']
        for y in range(int(cy - r - 3), int(cy + r + 4)):
            for x in range(int(cx - r - 3), int(cx + r + 4)):
                if not (0 <= x < COLS and 0 <= y < ROWS) or LAND[y][x]:
                    continue
                d = math.hypot(x - cx, y - cy) + (float(noise(np.array(x / 2.2), np.array(y / 2.2), 44)) - 0.5) * 2.8
                if d > r + 2.6:
                    continue
                if d > r + 1.1:
                    P.rect(x * B, y * B, B, B, '#6fd3e8')
                elif d > r - 0.6:
                    P.rect(x * B, y * B, B, B, '#e3cf94')
                else:
                    P.rect(x * B, y * B, B, B, '#5c9440' if _hash(x * 3.7 + y * 9.1) > 0.5 else '#4e8034')
        # a lip of rock on the seaward side, the same trick as the main coast
        for y in range(int(cy - r), int(cy + r + 1)):
            for x in range(int(cx - r), int(cx + r + 1)):
                if not (0 <= x < COLS and 0 <= y < ROWS) or LAND[y][x]:
                    continue
                if math.hypot(x - cx, y - cy) <= r - 0.6 < math.hypot(x - cx, y + 1 - cy):
                    P.rect(x * B, y * B + B, B, 3, '#6b4a32')
                    P.rect(x * B, y * B + B + 2, B, 2, '#4a3122')
        px, py = round(isl['x']), round(isl['y']) - 2
        if isl['palm']:
            P.rect(px, py - 7, 2, 8, '#6b4a32')
            P.rect(px - 5, py - 9, 5, 2, '#3f6b2a')
            P.rect(px + 2, py - 9, 5, 2, '#3f6b2a')
            P.rect(px - 4, py - 11, 4, 2, '#548a35')
            P.rect(px + 2, py - 11, 4, 2, '#548a35')
            P.rect(px - 1, py - 12, 4, 2, '#69a544')
        if isl['rock']:
            P.rect(px - 5, py - 4, 10, 6, '#5a6472')
            P.rect(px - 4, py - 8, 8, 6, '#7d8796')
            P.rect(px - 2, py - 7, 3, 2, '#98a2b0')


def paint_land():
    # pass one: the flat top of every block
    for y in range(ROWS):
        for x in range(COLS):
            t = int(TIER[y][x])
            if t < 0:
                continue
            bm = int(BIOME[y][x])
            pal = TOP[bm if bm >= 0 else 0]
            n = _hash(x * 3.1 + y * 7.7)
            P.rect(x * B, y * B, B, B, pal[min(9, t * 2 + (1 if n > 0.66 else 0))])

    # pass two: the faces. Separate, because a face belongs on top of the ground
    # below it, and drawing both in one pass means the next row paints over it.
    for y in range(ROWS):
        for x in range(COLS):
            t = int(TIER[y][x])
            if t < 0:
                continue
            bm = int(BIOME[y][x])
            f = FACE[1 if bm == 1 else 2 if bm == 2 else 3 if bm == 3 else 0]
            below = tier(x, y + 1)
            sea = not is_land(x, y + 1)
            if not sea and 0 <= below < t:
                h = min(3, t - below) * 4
                P.rect(x * B, y * B + B, B, h, f[0])
                P.rect(x * B, y * B + B + h - 2, B, 2, f[1])
                P.rect(x * B, y * B + B + h, B, 2, '#00000033')
            elif sea and t >= 1:
                P.rect(x * B, y * B + B, B, 5, f[0])
                P.rect(x * B, y * B + B + 3, B, 2, f[1])
            # sunlit rim where the ground climbs away from us
            if tier(x, y - 1) > t:
                P.rect(x * B, y * B, B, 1, '#ffffff26')
            # shaded side on the right of a step
            if 0 <= tier(x + 1, y) < t:
                P.rect(x * B + B - 1, y * B, 1, B, '#00000026')

    for y in range(ROWS):
        for x in range(COLS):
            if RIVER[y][x] and LAND[y][x]:
                P.rect(x * B, y * B, B, B, '#2f86c9')
                P.rect(x * B, y * B + 1, B, 2, '#4fa8e0')


def mountain(cx, base_y, w, h, snowy):
    """A mountain as an object rather than a terrain tier. This is what actually
    reads as height; shading the ground alone never does."""
    rock_l = '#8d97a6' if snowy else '#8a7f72'
    rock_r = '#5c6676' if snowy else '#5e544a'
    rock_e = '#46505f' if snowy else '#463e36'
    for i in range(h):
        y = base_y - h + i
        half = round((i / h) * (w / 2))
        if half < 1:
            continue
        snow = snowy and i < h * 0.42
        P.rect(cx - half, y, half, 1, '#ffffff' if snow else rock_l)
        P.rect(cx, y, half, 1, '#c6d6e8' if snow else rock_r)
        if i > 2 and _hash(cx * 3.1 + y * 7.7) > 0.72:
            P.rect(cx - half, y, 1, 1, rock_e)
            P.rect(cx + half - 1, y, 1, 1, rock_e)
    if snowy:
        y = base_y - h + round(h * 0.42)
        half = round(0.42 * (w / 2))
        for dx in range(-half, half):
            if _hash(cx + dx * 2.7) > 0.55:
                P.rect(cx + dx, y, 1, 1 + int(_hash(dx * 5.1) * 3), '#ffffff' if dx < 0 else '#c6d6e8')
    P.rect(cx - round(w / 2), base_y, w, 2, '#00000030')


RANGE = [
    (54, 95, 27, 17, False), (74, 82, 33, 25, False), (100, 72, 44, 36, True),
    (136, 66, 58, 47, True), (173, 70, 49, 41, True), (207, 76, 40, 30, True),
    (238, 84, 33, 23, False), (269, 92, 29, 18, False),
]

# roads between neighbouring claims. One loose network, not every pair: a road to
# everywhere is a spiderweb, and the island stops reading as ground.
LINKS = [(0, 3), (3, 1), (1, 4), (4, 11), (11, 5), (5, 6),
         (2, 3), (3, 10), (10, 13), (13, 15), (15, 7), (7, 8),
         (14, 12), (12, 18), (18, 17), (17, 16), (16, 9),
         (20, 22), (20, 24), (24, 21), (21, 23), (23, 19)]


def paint_features():
    for m in RANGE:
        mountain(*m)

    # trees, in clusters, off the rock and out of the water
    clump = fbm(GX / 7, GY / 7, 31)
    for i in range(1400):
        x = int(_hash(i * 1.7) * COLS)
        y = int(_hash(i * 2.9 + 5) * ROWS)
        t, bm = tier(x, y), biome(x, y)
        if t < 1 or t > 2 or river(x, y) or clump[y][x] < 0.52:
            continue
        px, py = x * B, y * B
        o = owner_at(x, y)
        if o >= 0 and abs(CEN[o][0] - px) < 22 and abs(CEN[o][1] - py) < 20:
            continue
        if py < 100 and 40 < px < 300:   # the range
            continue
        if bm == 2:
            P.rect(px + 1, py + 3, 3, 2, '#7a5a2a')
            P.rect(px + 1, py + 1, 4, 2, '#9c7a34')
        else:
            P.rect(px + 2, py + 4, 1, 2, '#2b4a1c')
            P.rect(px, py, 5, 5, '#35602a')
            P.rect(px + 1, py - 1, 3, 4, '#4b8038')

    for a, b in LINKS:
        ax, ay, _ = CEN[a]
        bx, by, _ = CEN[b]
        span = max(1.0, math.hypot(bx - ax, by - ay))
        steps = math.ceil(span / 3)
        for s in range(steps + 1):
            u = s / steps
            wig = math.sin(u * math.pi) * (_hash(a * 7 + b * 13) - 0.5) * 9
            nx = ax + (bx - ax) * u + wig * ((by - ay) / span)
            ny = ay + (by - ay) * u - wig * ((bx - ax) / span)
            gx, gy = int(nx // B), int(ny // B)
            if not is_land(gx, gy):
                continue
            P.rect(int(nx) - 1, int(ny) - 1, 3, 2, '#8a6a44')
            P.rect(int(nx) - 1, int(ny) - 1, 3, 1, '#a8865a')


def paint_claim_ground():
    for y in range(ROWS):
        for x in range(COLS):
            if OWNER[y][x] < 0:
                continue
            n = _hash(x * 13.7 + y * 4.9 + 60)
            # turned earth and spoil, the sign that someone works here
            if n > 0.58:
                P.rect(x * B, y * B, B, B, '#00000022')
            if n > 0.90:
                P.rect(x * B + 1, y * B + 1, 2, 2, '#7b5f42')


def paint_borders():
    """Outline every claim against whatever is next to it, open ground included.
    Without this a claim has no edge, and a player cannot see where to tap."""
    for y in range(ROWS):
        for x in range(COLS):
            o = int(OWNER[y][x])
            if o < 0:
                continue
            if owner_at(x - 1, y) != o:
                P.rect(x * B, y * B, 1, B, '#12261a')
                P.rect(x * B + 1, y * B, 1, B, '#ffffff1f')
            if owner_at(x + 1, y) != o:
                P.rect(x * B + B - 1, y * B, 1, B, '#12261a')
            if owner_at(x, y - 1) != o:
                P.rect(x * B, y * B, B, 1, '#12261a')
                P.rect(x * B, y * B + 1, B, 1, '#ffffff1f')
            if owner_at(x, y + 1) != o:
                P.rect(x * B, y * B + B - 1, B, 1, '#12261a')
    # marker posts at the corners, the way a real claim is pegged out
    for y in range(ROWS):
        for x in range(COLS):
            o = int(OWNER[y][x])
            if o < 0:
                continue
            open_sides = sum(owner_at(nx, ny) < 0 for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)))
            if open_sides < 2 or _hash(x * 7.7 + y * 3.1) < 0.86:
                continue
            P.rect(x * B + 1, y * B, 2, 5, '#5c3d26')
            P.rect(x * B + 1, y * B, 2, 2, '#c9a24e')


# ---- overlays: one shape per claim, tinted by the app ----
EDGE = 2   # the outline a player picks a claim by; 1px at this scale vanishes


def claim_overlays(i):
    """A solid fill and a 2px outline for claim `i`, cropped to its bounding box.

    White, so the app can tint them: cyan for a pick, gold for the winner, near
    black to dim the losers. One image per claim beats redrawing a polygon every
    frame on a phone.
    """
    ys, xs = np.nonzero(OWNER == i)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    w, h = (x1 - x0) * B, (y1 - y0) * B
    fill = np.zeros((h, w, 4), dtype=np.uint8)
    edge = np.zeros((h, w, 4), dtype=np.uint8)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if OWNER[y][x] != i:
                continue
            px, py = (x - x0) * B, (y - y0) * B
            fill[py:py + B, px:px + B] = (255, 255, 255, 255)
            if owner_at(x - 1, y) != i:
                edge[py:py + B, px:px + EDGE] = (255, 255, 255, 255)
            if owner_at(x + 1, y) != i:
                edge[py:py + B, px + B - EDGE:px + B] = (255, 255, 255, 255)
            if owner_at(x, y - 1) != i:
                edge[py:py + EDGE, px:px + B] = (255, 255, 255, 255)
            if owner_at(x, y + 1) != i:
                edge[py + B - EDGE:py + B, px:px + B] = (255, 255, 255, 255)
    box = [int(x0) * B, int(y0) * B, w, h]
    return Image.fromarray(fill, 'RGBA'), Image.fromarray(edge, 'RGBA'), box


# ---- claim icons, ships, birds: drawn on a fixed canvas so the app just places them ----
ICON_W, ICON_H, ICON_AX, ICON_AY = 20, 18, 10, 12


def icon(kind):
    p = Paint(ICON_W, ICON_H)
    mask = np.zeros((ICON_H, ICON_W), dtype=bool)

    def r(x, y, w, h, col):
        p.rect(ICON_AX + x, ICON_AY + y, w, h, col)
        x0, y0 = max(0, ICON_AX + x), max(0, ICON_AY + y)
        mask[y0:ICON_AY + y + h, x0:ICON_AX + x + w] = True

    if kind == 'scree':
        r(-7, -1, 14, 6, '#4c5666'); r(-5, -6, 10, 6, '#8d97a6'); r(-3, -5, 4, 2, '#b6c0cd')
    elif kind == 'reef':
        r(-4, -7, 4, 11, '#12607a'); r(1, -3, 3, 7, '#12607a')
        r(-3, -8, 2, 9, '#3ee6ff'); r(2, -4, 1, 6, '#3ee6ff'); r(-3, -7, 1, 2, '#d8fbff')
    elif kind == 'gold':
        r(-7, -2, 14, 6, '#6b4712'); r(-5, -5, 5, 5, '#ffcf4a'); r(1, -1, 4, 3, '#ffcf4a'); r(-4, -4, 2, 2, '#fff0b8')
    elif kind == 'cave':
        r(-8, -7, 16, 12, '#4c5666'); r(-7, -8, 14, 10, '#6e7a8c'); r(-4, -3, 8, 8, '#080b12')
    else:  # dig: a mine head frame
        r(-4, -1, 9, 6, '#080b12')
        r(-7, -9, 2, 10, '#5c3d26'); r(5, -9, 2, 10, '#5c3d26')
        r(-8, -10, 17, 2, '#8a6a4a'); r(-6, -5, 13, 1, '#4a3122')
    out = np.dstack([p.a.round().clip(0, 255).astype(np.uint8), np.where(mask, 255, 0).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


ISLET_W, ISLET_H, ISLET_AX, ISLET_AY = 40, 34, 20, 24


def islet_sprite(r, palm, rock, seed=0):
    """A standalone islet, for the open water outside the board.

    The six islets in the picture are painted into the terrain. These are the
    same thing as sprites, so the app can drop a few into the sea it tiles
    around the board, where there is room for them.
    """
    q = Paint(ISLET_W, ISLET_H)
    mask = np.zeros((ISLET_H, ISLET_W), dtype=bool)

    def put(x, y, w, h, col):
        q.rect(x, y, w, h, col)
        x0, y0 = max(0, int(x)), max(0, int(y))
        mask[y0:int(y) + int(h), x0:int(x) + int(w)] = True

    cx, cy = ISLET_AX / B, ISLET_AY / B
    for y in range(int(cy - r - 3), int(cy + r + 4)):
        for x in range(int(cx - r - 3), int(cx + r + 4)):
            d = math.hypot(x - cx, y - cy) + (_hash(x * 5.1 + y * 2.3 + seed) - 0.5) * 1.3
            if d > r + 2.4:
                continue
            if d > r + 1.0:
                put(x * B, y * B, B, B, '#6fd3e8')
            elif d > r - 0.6:
                put(x * B, y * B, B, B, '#e3cf94')
            else:
                put(x * B, y * B, B, B, '#5c9440' if _hash(x * 3.7 + y * 9.1) > 0.5 else '#4e8034')
    for y in range(int(cy - r), int(cy + r + 1)):
        for x in range(int(cx - r), int(cx + r + 1)):
            if math.hypot(x - cx, y - cy) <= r - 0.6 < math.hypot(x - cx, y + 1 - cy):
                put(x * B, y * B + B, B, 3, '#6b4a32')
                put(x * B, y * B + B + 2, B, 2, '#4a3122')
    px, py = ISLET_AX, ISLET_AY - 2
    if palm:
        put(px, py - 7, 2, 8, '#6b4a32')
        put(px - 5, py - 9, 5, 2, '#3f6b2a'); put(px + 2, py - 9, 5, 2, '#3f6b2a')
        put(px - 4, py - 11, 4, 2, '#548a35'); put(px + 2, py - 11, 4, 2, '#548a35')
        put(px - 1, py - 12, 4, 2, '#69a544')
    if rock:
        put(px - 5, py - 4, 10, 6, '#5a6472')
        put(px - 4, py - 8, 8, 6, '#7d8796')
        put(px - 2, py - 7, 3, 2, '#98a2b0')
    out = np.dstack([q.a.round().clip(0, 255).astype(np.uint8), np.where(mask, 255, 0).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


SHIP_W, SHIP_H, SHIP_AX, SHIP_AY = 24, 20, 12, 13
BIRD_W, BIRD_H, BIRD_AX, BIRD_AY = 10, 6, 4, 3


def ship(kind):
    """Drawn heading right; the app flips it for the other half of the circuit.
    The wake is baked in behind the hull, so it trails correctly when flipped."""
    p = Paint(SHIP_W, SHIP_H)
    mask = np.zeros((SHIP_H, SHIP_W), dtype=bool)

    def r(x, y, w, h, col):
        p.rect(SHIP_AX + x, SHIP_AY + y, w, h, col)
        x0, y0 = max(0, SHIP_AX + x), max(0, SHIP_AY + y)
        mask[y0:SHIP_AY + y + h, x0:SHIP_AX + x + w] = True

    r(-12, 4, 5, 1, '#9fe0f2'); r(-11, 5, 4, 1, '#9fe0f2')   # wake
    if kind == 'skiff':
        r(-5, 1, 10, 3, '#5c3d26'); r(-4, 0, 8, 2, '#8a6a4a')
        r(-1, -6, 1, 6, '#d8d5c8'); r(0, -6, 4, 5, '#f2f5ff')
    elif kind == 'trader':
        r(-8, 2, 16, 4, '#4a3122'); r(-7, 0, 14, 3, '#6b4a32'); r(-7, 1, 14, 1, '#c9a24e')
        r(-2, -9, 1, 9, '#d8d5c8'); r(3, -7, 1, 7, '#d8d5c8')
        r(-1, -9, 6, 7, '#f2f5ff'); r(4, -7, 4, 5, '#e6ecf8')
    else:  # sloop
        r(-6, 1, 12, 4, '#4a3122'); r(-5, -1, 10, 3, '#7d5a3c')
        r(-1, -8, 1, 8, '#d8d5c8'); r(0, -8, 5, 6, '#f2f5ff'); r(0, -8, 5, 1, '#ff4d5e')
    out = np.dstack([p.a.round().clip(0, 255).astype(np.uint8), np.where(mask, 255, 0).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


def bird(up):
    a = np.zeros((BIRD_H, BIRD_W, 4), dtype=np.uint8)
    def r(x, y, w, h):
        a[BIRD_AY + y:BIRD_AY + y + h, BIRD_AX + x:BIRD_AX + x + w] = (255, 255, 255, 255)
    if up:
        r(-4, -2, 4, 2); r(1, -2, 4, 2); r(-1, 0, 2, 1)
    else:
        r(-4, 1, 4, 2); r(1, 1, 4, 2); r(-1, -1, 2, 2)
    return Image.fromarray(a, 'RGBA')


# ---- where a character stands to work a claim, and where they can walk ----
def stand_for(i):
    """Just below the claim's icon, on the claim's own ground, so the miner does
    not end up standing in the sea or halfway up a cliff."""
    cx, cy, _ = CEN[i]
    best, bd = (cx, cy), 1e9
    for y in range(ROWS):
        for x in range(COLS):
            if OWNER[y][x] != i:
                continue
            px, py = x * B + B // 2, y * B + B // 2
            d = (px - cx) ** 2 + (py - (cy + 12)) ** 2
            if d < bd:
                bd, best = d, (px, py)
    return [best[0], best[1]]


def grid_string():
    """One character per terrain block: A-Y a claim, '.' open land, '~' sea.

    The app reads taps and keeps characters out of the water off this, which
    means the walkable shape and the drawn shape can never drift apart.
    """
    rows = []
    for y in range(ROWS):
        row = []
        for x in range(COLS):
            o = int(OWNER[y][x])
            row.append(chr(65 + o) if o >= 0 else ('.' if LAND[y][x] else '~'))
        rows.append(''.join(row))
    return ''.join(rows)


COURSE_STEPS = 72


def sea_course(margin):
    """A closed circuit of waypoints that follows the coast at roughly `margin` off it.

    An ellipse was the obvious thing and it does not work: this island is lumpy
    enough that no ellipse both clears the land and stays inside the frame. Walking
    out along each ray to the last block of land and standing off it by a fixed
    margin gives a course that is correct by construction, and it reads better too
    — a ship hugging the shore looks like it is going somewhere.
    """
    cx = float(np.nonzero(LAND.any(axis=0))[0].mean() * B)
    cy = float(np.nonzero(LAND.any(axis=1))[0].mean() * B)
    cx, cy = W / 2, (cy + H / 2) / 2
    pts, tight = [], 99.0
    for k in range(COURSE_STEPS):
        a = k * 2 * math.pi / COURSE_STEPS
        ca, sa = math.cos(a), math.sin(a)
        coast = 0
        for rr in range(8, 420, 2):
            gx, gy = int((cx + ca * rr) // B), int((cy + sa * rr) // B)
            if is_land(gx, gy):
                coast = rr
        # stand off the shore, then pull back in if that leaves the frame
        r = coast + margin
        while r > coast + 4:
            x, y = cx + ca * r, cy + sa * r
            if 12 <= x <= W - 12 and 12 <= y <= H - 8:
                break
            r -= 2
        tight = min(tight, r - coast)
        pts.append([round(cx + ca * r), round(cy + sa * r)])
    if tight < 4:
        print(f'  warning: a ship passes within {tight:.0f}px of the shore')
    return pts


def ship_courses():
    return [
        {'kind': 'sloop', 'from': 0, 'speed': 0.0055, 'path': sea_course(20)},
        {'kind': 'trader', 'from': 26, 'speed': -0.0038, 'path': sea_course(34)},
        {'kind': 'skiff', 'from': 51, 'speed': 0.0072, 'path': sea_course(13)},
    ]


def fit_box(pad=5):
    """The rectangle the app should fit to: everything drawn, not the canvas.

    The canvas carries a band of sea on every side so nothing is clipped when it
    is painted, but the app tiles that same water across the whole screen anyway
    — fitting to the canvas only shrinks the board to make room for sea it is
    already drawing. The union below is the land plus the two things that sit
    outside it, the mountains rising above the coast and the islets off it;
    either one sliced by the screen edge reads as a bug rather than a crop.
    """
    ys, xs = np.nonzero(LAND)
    x0, y0 = int(xs.min()) * B, int(ys.min()) * B
    x1, y1 = (int(xs.max()) + 1) * B, (int(ys.max()) + 1) * B + 5   # +5 for the cliff face
    for cx, base, w, h, _snow in RANGE:
        x0, x1 = min(x0, cx - w // 2), max(x1, cx + w // 2)
        y0, y1 = min(y0, base - h), max(y1, base + 2)
    for isl in ISLETS:
        r = isl['r'] * B + B + 4
        x0, x1 = min(x0, int(isl['x'] - r)), max(x1, int(isl['x'] + r))
        head = 14 if isl['palm'] else 10 if isl['rock'] else 0
        y0, y1 = min(y0, int(isl['y'] - r - head)), max(y1, int(isl['y'] + r + 5))
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(W, x1 + pad), min(H, y1 + pad)
    return [x0, y0, x1 - x0, y1 - y0]


def home_point():
    """Where a character stands when they have nothing to work: open ground on the
    southern flats, off anyone's claim."""
    tx, ty = W / 2, H * 0.78
    best, bd = None, 1e18
    for y in range(ROWS):
        for x in range(COLS):
            if OWNER[y][x] >= 0 or not LAND[y][x]:
                continue
            px, py = x * B + B // 2, y * B + B // 2
            d = (px - tx) ** 2 + (py - ty) ** 2
            if d < bd:
                bd, best = d, [px, py]
    return best


REGION_LABELS = [
    ['THE CAP', 96, 62],
    ['RUST BADLANDS', 268, 104],
    ['THE GREEN', 112, 132],
    ['SOUTH SANDS', 186, 168],
]


SEA_COLOURS = {(18, 58, 107), (10, 19, 48), (22, 71, 126), (111, 211, 232), (29, 110, 168)}
MARGIN = 5


def check_margin(art, margin=MARGIN):
    """Fail if anything but open water reaches the edge of the canvas.

    The island's south coast grew into the bottom edge and was being sliced off
    flat, which is the kind of thing that is obvious on a phone and invisible
    while tuning numbers. Cheaper to assert it than to notice it twice.
    """
    px = art.convert('RGB').load()
    bad = []
    for y in range(art.height):
        for x in range(art.width):
            if margin <= x < art.width - margin and margin <= y < art.height - margin:
                continue
            if px[x, y] not in SEA_COLOURS:
                bad.append((x, y))
    if bad:
        xs = [b[0] for b in bad]
        ys = [b[1] for b in bad]
        raise SystemExit(
            f'{len(bad)} pixels of land reach the canvas edge and will be cropped: '
            f'x {min(xs)}-{max(xs)}, y {min(ys)}-{max(ys)}. '
            'Shrink RX/RY or move the islet that overhangs.')


def build(out_dir, scale=4):
    """Render everything into `out_dir` and return the block for META."""
    paint_sea()
    paint_islets()
    paint_land()
    paint_features()
    paint_claim_ground()
    paint_borders()

    def save(img, name):
        img.resize((img.width * scale, img.height * scale), Image.NEAREST).save(
            os.path.join(out_dir, name), optimize=True)

    # Region names belong to the map, not to the interface. Painted into the art
    # they sit under the claim amounts instead of competing with them for the
    # same few pixels, which is what happened when the app drew them as text.
    art = P.image()
    ink = Image.new('RGBA', art.size, (0, 0, 0, 0))
    pen = ImageDraw.Draw(ink)
    for text, lx, ly in REGION_LABELS:
        text = '  '.join(text.split(' '))
        w = pen.textlength(text)
        pen.text((lx - w / 2 + 1, ly + 1), text, fill=(2, 5, 15, 105))
        pen.text((lx - w / 2, ly), text, fill=(236, 244, 255, 120))
    art = Image.alpha_composite(art, ink)
    check_margin(art)
    save(art, 'island.png')

    boxes = []
    for c in CLAIMS:
        fill, edge, box = claim_overlays(c['i'])
        save(fill, f"claim-{c['i']}-fill.png")
        save(edge, f"claim-{c['i']}-edge.png")
        boxes.append(box)

    kinds = sorted({c['k'] for c in CLAIMS})
    for k in kinds:
        save(icon(k), f'claim-icon-{k}.png')
    for k in ('sloop', 'trader', 'skiff'):
        save(ship(k), f'ship-{k}.png')
    # 1x, unlike every other sprite: the app tiles this one at its intrinsic size
    # to fill the screen behind the board, so it must not be pre-scaled.
    sea_tile().save(os.path.join(out_dir, 'sea-tile.png'), optimize=True)
    save(islet_sprite(3.6, True, False, 3), 'islet-palm.png')
    save(islet_sprite(3.0, False, True, 11), 'islet-rock.png')
    save(islet_sprite(2.4, False, False, 19), 'islet-bare.png')
    save(bird(True), 'bird-0.png')
    save(bird(False), 'bird-1.png')

    return {
        'size': [W, H],
        'block': B,
        'cols': COLS,
        'rows': ROWS,
        'icon': [ICON_W, ICON_H, ICON_AX, ICON_AY],
        'ship': [SHIP_W, SHIP_H, SHIP_AX, SHIP_AY],
        'bird': [BIRD_W, BIRD_H, BIRD_AX, BIRD_AY],
        'islet': [ISLET_W, ISLET_H, ISLET_AX, ISLET_AY],
        'seaTile': SEA_TILE,
        'sea': SEA_DEEP,
        'claims': [
            {
                'i': c['i'],
                'kind': c['k'],
                'region': c['r'],
                'cx': CEN[c['i']][0],
                'cy': CEN[c['i']][1],
                'area': CEN[c['i']][2],
                'box': boxes[c['i']],
                'stand': stand_for(c['i']),
            }
            for c in CLAIMS
        ],
        'regions': REGION_LABELS,
        'ships': ship_courses(),
        'fit': fit_box(),
        'home': home_point(),
        'grid': grid_string(),
    }


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, 'app/assets/pixel')
    os.makedirs(out, exist_ok=True)
    meta = build(out)
    areas = sorted(c['area'] for c in meta['claims'])
    print(f"island {W}x{H}, claims {len(meta['claims'])}, "
          f"area min {areas[0]} max {areas[-1]} blocks, land "
          f"{int(LAND.sum())}/{COLS * ROWS}")
    with open(os.path.join(out, 'island.json'), 'w') as f:
        json.dump(meta, f)

"""The shore around Gali Island: a wider map with the same island in the middle.

island.py still authors the island at 360x210, and nothing about it changes: the
25 claims, their size and place, the terrain, the props. This module wraps that
picture in a 720x420 map. It adds a ring of beach (wide on the south and east,
narrow on the north), a peninsula on the east with the ORE helipad, a boardwalk
down to a dock, and the beach props that make the space worth walking to.

Every coordinate the app reads (claims, props, lights, the walking grid, the fit
box) is shifted by OFFSET, so the default camera frames the island exactly as
before. The walking grid and the ground picture are built from the same masks, so
the sand a miner can see is the sand a miner can stand on.

Needs numpy and Pillow. scipy is used for distance fields when present.
"""
import math
import os
import random

import numpy as np
from PIL import Image

import island_props as IP

OFF_X, OFF_Y = 180, 105          # where the old 360x210 frame sits inside the new one
EW, EH = 720, 420
B = 3                            # terrain block, as in island.py
OFF_COL, OFF_ROW = OFF_X // B, OFF_Y // B
HERE = os.path.dirname(os.path.abspath(__file__))

# the helipad: a 72x72 slab, centred here, on the east peninsula
PAD_X, PAD_Y = OFF_X + 395, OFF_Y + 152
PAD = 72
PEN = (PAD_X, PAD_Y + 6, 100, 68)       # peninsula ellipse: cx, cy, rx, ry


def rgb(s):
    s = s.lstrip('#')
    return np.array([int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)], float)


SAND = np.array([rgb(c) for c in ('#c9ad74', '#d8c185', '#e3cf94', '#ecdca6', '#f6ebc0')])
BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], float) + 0.5) / 16


def dist_to(mask):
    """Distance in px from every pixel to the nearest True pixel of `mask`."""
    try:
        from scipy import ndimage
        return ndimage.distance_transform_edt(~mask).astype(np.float32)
    except ImportError:
        pass
    h, w = mask.shape
    d = np.where(mask, 0.0, 1e6).astype(np.float32)
    s2 = math.sqrt(2)
    for y in range(h):
        for x in range(w):
            m = d[y, x]
            if m == 0:
                continue
            if x:
                m = min(m, d[y, x - 1] + 1)
            if y:
                m = min(m, d[y - 1, x] + 1)
                if x:
                    m = min(m, d[y - 1, x - 1] + s2)
                if x < w - 1:
                    m = min(m, d[y - 1, x + 1] + s2)
            d[y, x] = m
    for y in range(h - 1, -1, -1):
        for x in range(w - 1, -1, -1):
            m = d[y, x]
            if m == 0:
                continue
            if x < w - 1:
                m = min(m, d[y, x + 1] + 1)
            if y < h - 1:
                m = min(m, d[y + 1, x] + 1)
                if x < w - 1:
                    m = min(m, d[y + 1, x + 1] + s2)
                if x:
                    m = min(m, d[y + 1, x - 1] + s2)
            d[y, x] = m
    return d


def majority(mask):
    """One smoothing pass: a pixel takes the vote of its 3x3 neighbourhood."""
    p = np.pad(mask.astype(np.int8), 1)
    n = sum(p[1 + dy:1 + dy + mask.shape[0], 1 + dx:1 + dx + mask.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    return n >= 5


# ---------------------------------------------------------------- new sprites
def umbrella(col, shade):
    s = IP.Spr(15, 17)
    s.shadow(7.5, 16, 6, 1.0)
    s.vline(7, 5, 15, '#e9e2d0')
    s.set(7, 15, '#8a7a5a')
    for y, half in ((1, 3), (2, 5), (3, 6), (4, 7)):
        for x in range(7 - half, 7 + half + 1):
            s.set(x, y, col if (x - (7 - half)) % 4 < 2 else '#fbf6e6')
    for x in range(1, 14):
        s.set(x, 5, shade)
    s.set(7, 0, '#e9e2d0')
    s.outline(IP.rgb('#3a2a1c'))
    return [s], 7, 16


def towel(col):
    s = IP.Spr(12, 6)
    s.shadow(6, 5, 5, 0.6, 50)
    for y in range(1, 5):
        for x in range(1, 11):
            s.set(x, y, col if (x + y) % 5 else '#fbf6e6')
    s.outline(IP.rgb('#6b5a3c'), where=lambda x, y: True)
    return [s], 6, 5


def log_seat():
    s = IP.Spr(12, 7)
    s.shadow(6, 6, 5, 0.8)
    for y in range(1, 5):
        for x in range(1, 11):
            s.set(x, y, '#7a5634' if y < 3 else '#5a3c24')
    s.set(1, 2, '#c9a070')
    s.set(1, 3, '#c9a070')
    s.hline(2, 9, 2, '#9a7248')
    s.outline(IP.rgb('#241a12'))
    return [s], 6, 6


def net():
    s = IP.Spr(34, 20)
    s.shadow(17, 19, 15, 1.0)
    s.vline(3, 4, 18, '#6b4a32')
    s.vline(30, 4, 18, '#6b4a32')
    for y in range(5, 12):
        for x in range(4, 30):
            if (x + y) % 3 == 0:
                s.set(x, y, '#f2f2ee')
    s.hline(3, 30, 4, '#ffffff')
    s.hline(3, 30, 12, '#cfd6e0')
    s.outline(IP.rgb('#241a12'), where=lambda x, y: y > 12 or x in (2, 4, 29, 31))
    return [s], 17, 19


def ball():
    s = IP.Spr(6, 6)
    s.shadow(3, 5, 2.5, 0.6, 60)
    s.ellipse(3, 2.5, 2.2, 2.2, '#fbf6e6')
    s.set(2, 1, '#ff5fa2')
    s.set(4, 3, '#3ee6ff')
    s.outline(IP.rgb('#3a2a1c'))
    return [s], 3, 5


def crate():
    s = IP.Spr(10, 11)
    s.shadow(5, 10, 4.5, 0.8)
    for y in range(2, 9):
        for x in range(1, 9):
            s.set(x, y, '#a86f3a' if (x in (1, 8) or y in (2, 8)) else '#c98a4a')
    s.line(2, 3, 7, 7, '#7a4d26')
    s.line(7, 3, 2, 7, '#7a4d26')
    s.outline(IP.rgb('#2a1a10'))
    return [s], 5, 10


def barrel():
    s = IP.Spr(8, 12)
    s.shadow(4, 11, 3.5, 0.7)
    for y in range(2, 10):
        for x in range(1, 7):
            s.set(x, y, '#8a4a22' if x < 4 else '#a85f2c')
    s.hline(1, 6, 4, '#3a3a44')
    s.hline(1, 6, 8, '#3a3a44')
    s.set(2, 3, '#d99a4a')
    s.outline(IP.rgb('#2a1a10'))
    return [s], 4, 11


def helicopter():
    """Parked on the sand beside the pad, rotor turning. Anchored between the skids."""
    frames = []
    for f in range(3):
        s = IP.Spr(46, 30)
        s.shadow(23, 28, 18, 1.8, 80)
        # skids
        s.hline(10, 30, 26, '#2a2f3a')
        s.vline(14, 21, 26, '#2a2f3a')
        s.vline(26, 21, 26, '#2a2f3a')
        # tail boom and fin
        for x in range(28, 43):
            s.set(x, 16, '#c0392b')
            s.set(x, 17, '#a52f23')
        s.rect(41, 11, 2, 7, '#c0392b')
        s.set(42, 10, '#ece6d8')
        # body
        s.ellipse(20, 17, 12, 8, '#c0392b')
        s.ellipse(20, 20, 11, 4.5, '#a52f23')
        s.hline(10, 30, 18, '#ece6d8')
        # canopy
        s.ellipse(14, 15, 6, 5, '#7fd3f0')
        s.ellipse(13, 14, 3, 2.5, '#d6f4ff')
        s.vline(15, 11, 19, '#2a6a88')
        # mast and rotor hub
        s.vline(21, 8, 10, '#2a2f3a')
        s.set(21, 7, '#e0e0e0')
        # main rotor: three frames of a spinning blade
        spans = ((-19, 19, 0), (-15, 15, 0), (-10, 10, 0))
        a, b, _ = spans[f]
        for x in range(a, b + 1):
            s.set(21 + x, 7 + (1 if f == 1 and abs(x) > 8 else 0), '#d8dde6' if abs(x) < 12 else '#9aa3b4')
        if f == 2:
            s.hline(2, 12, 6, (216, 221, 230, 110))
            s.hline(30, 40, 8, (216, 221, 230, 110))
        # tail rotor
        s.vline(44, 9 + f % 2, 13 + f % 2, '#d8dde6')
        s.outline(IP.rgb('#1c1420'))
        frames.append(s)
    return frames, 23, 28


def new_sprites():
    out = {}

    def add(name, res, ms=0, sway=0):
        frames, ax, ay = res
        out[name] = dict(frames=frames, ax=ax, ay=ay, ms=ms, sway=sway)

    add('umbrella-a', umbrella('#ff5fa2', '#c93a7a'))
    add('umbrella-b', umbrella('#ffcf4a', '#d9962a'))
    add('umbrella-c', umbrella('#3ee6ff', '#1fa8c8'))
    add('towel-a', towel('#ff5fa2'))
    add('towel-b', towel('#3ee6ff'))
    add('towel-c', towel('#ffcf4a'))
    add('log', log_seat())
    add('net', net())
    add('ball', ball())
    add('crate', crate())
    add('barrel', barrel())
    add('helicopter', helicopter(), ms=55)
    return out


# ---------------------------------------------------------------- the shore
def noise_field(I, seed, scale):
    yy, xx = np.mgrid[0:EH, 0:EW]
    return I.fbm(xx / scale, yy / scale, seed)


def extend(I, ground, sprites):
    """Everything the wider map adds. Returns a dict the caller folds into art.json."""
    rng = random.Random(2026)
    ga = np.array(ground)[:, :, 3] > 20
    base = np.zeros((EH, EW), bool)
    base[OFF_Y:OFF_Y + I.H, OFF_X:OFF_X + I.W] = ga
    yy, xx = np.mgrid[0:EH, 0:EW]

    # --- the ring of beach: wide south and east, narrow north ---
    D = dist_to(base)
    cx, cy = OFF_X + I.W / 2, OFF_Y + I.H / 2
    ang = np.arctan2(yy - cy, xx - cx)
    south = np.clip(np.sin(ang), 0, 1)
    north = np.clip(-np.sin(ang), 0, 1)
    east = np.clip(np.cos(ang), 0, 1)
    wobble = (noise_field(I, 31, 17) - 0.45) * 16
    width = np.clip(15 + 17 * south ** 1.1 + 8 * east - 7 * north + wobble, 7, 60)
    ring = (D > 0) & (D <= width)

    # the east peninsula the helipad stands on
    px0, py0, prx, pry = PEN
    ell = ((xx - px0) / prx) ** 2 + ((yy - py0) / pry) ** 2 + 0.55 * (noise_field(I, 12, 15) - 0.5)
    ring |= (ell < 1) & ~base

    # keep the cove the old pier stands in as open water
    pier = next((p for p in I.PROPS if p['s'] == 'prop-pier'), None)
    if pier:
        qx, qy = pier['x'] + OFF_X, pier['y'] + OFF_Y
        cove = ((xx - (qx + 3)) / 24.0) ** 2 + ((yy - (qy + 12)) / 26.0) ** 2 + 0.3 * (noise_field(I, 44, 9) - 0.5)
        ring &= cove >= 1

    ring &= ~base
    ring = majority(majority(ring))
    ring[:, :14] = ring[:, -14:] = False
    ring[:12, :] = ring[-12:, :] = False
    ring &= ~base

    # --- the pad, the boardwalk and the dock ---
    pad = np.zeros((EH, EW), bool)
    pad[PAD_Y - PAD // 2:PAD_Y + PAD // 2, PAD_X - PAD // 2:PAD_X + PAD // 2] = True
    land = base | ring
    # the boardwalk runs from the pad's south edge to open water, then a little way out
    bx0, bx1 = PAD_X - 6, PAD_X + 6
    col = land[:, PAD_X]
    shore_y = int(np.nonzero(col)[0].max())
    walk_y1 = min(EH - 14, shore_y + 30)
    walk = np.zeros((EH, EW), bool)
    walk[PAD_Y + PAD // 2:walk_y1, bx0:bx1] = True
    # a short T at the end, so it reads as a dock
    walk[walk_y1 - 10:walk_y1, bx0 - 12:bx1 + 12] = True
    # the sand around the dock head, so nothing floats
    sand = ring | (pad & ~base)
    walkable = sand | walk | pad

    # --- painting ---
    sea = ~(land | walk | pad)
    sd = dist_to(sea)                       # distance to open water, for the wet edge
    out = np.zeros((EH, EW, 4), np.uint8)
    n1 = noise_field(I, 5, 18)
    n2 = noise_field(I, 8, 5)
    n3 = noise_field(I, 21, 3)
    v = 2.0 + (n1 - 0.5) * 2.2 + (n2 - 0.5) * 0.8
    v = v - np.where(sd <= 1.5, 1.7, np.where(sd <= 3.5, 0.8, 0.0))
    v = v - np.where(D <= 2, 0.7, 0.0)
    ripple = np.sin((xx * 0.5 + yy * 0.95) / 1.15 + n1 * 7.0)
    dry = sd > 5
    v = v + np.where(dry & (ripple > 0.9), 0.9, 0.0) - np.where(dry & (ripple < -0.9), 0.5, 0.0)
    bay = BAYER[yy % 4, xx % 4]
    idx = np.clip(np.floor(v + bay - 0.5), 0, 4).astype(int)
    colors = SAND[idx]
    h = IP.h1  # per-pixel hash, vectorised below
    hv = (np.sin(xx * 12.9898 + yy * 78.233) * 43758.5453) % 1.0
    colors[(hv > 0.9965) & sand] = rgb('#fffbea')
    colors[(hv > 0.9915) & (hv <= 0.9965) & sand] = rgb('#a39a8c')
    out[sand, :3] = colors[sand].round().astype(np.uint8)
    out[sand, 3] = 255

    # pad: hazard stripes, concrete, then the ORE mark copied 1:1 from the logo
    x0, y0 = PAD_X - PAD // 2, PAD_Y - PAD // 2
    # a hard shadow to the south east, over the sand
    sh = np.zeros((EH, EW), bool)
    sh[y0 + 4:y0 + PAD + 3, x0 + 4:x0 + PAD + 3] = True
    sh &= ~pad & sand
    out[sh, :3] = (out[sh, :3] * 0.62).round().astype(np.uint8)
    slab = np.zeros((PAD, PAD, 4), np.uint8)
    slab[:] = (62, 68, 82, 255)
    for i in range(PAD):
        for j in range(PAD):
            edge = min(i, j, PAD - 1 - i, PAD - 1 - j)
            if edge < 3:
                stripe = ((i + j) // 4) % 2 == 0
                slab[j, i] = (255, 207, 74, 255) if stripe else (26, 26, 34, 255)
            elif edge < 6:
                slab[j, i] = (96, 104, 120, 255) if (i + j) % 7 else (82, 90, 106, 255)
    logo = Image.open(os.path.join(HERE, 'ore-logo-60.png')).convert('L')
    la = np.array(logo) > 127
    lx0 = (PAD - 60) // 2
    ly0 = (PAD - 60) // 2
    block = np.zeros((60, 60, 4), np.uint8)
    block[:] = (9, 8, 16, 255)                       # the logo's own background
    block[la] = (255, 255, 255, 255)
    slab[ly0:ly0 + 60, lx0:lx0 + 60] = block
    # corner lamps, so the pad reads at night too
    out[y0:y0 + PAD, x0:x0 + PAD] = slab
    lamps = []
    for sx, sy, c in ((x0 + 1, y0 + 1, (255, 77, 94)), (x0 + PAD - 3, y0 + 1, (255, 255, 255)),
                      (x0 + 1, y0 + PAD - 3, (255, 255, 255)), (x0 + PAD - 3, y0 + PAD - 3, (255, 77, 94))):
        out[sy:sy + 2, sx:sx + 2, :3] = c
        out[sy:sy + 2, sx:sx + 2, 3] = 255
        lamps.append((sx + 1, sy + 1, '#ff4d5e' if c[1] < 100 else '#fff1c8'))

    # boardwalk planks and the dock head
    for y in range(EH):
        for x in range(EW):
            if not walk[y, x] or pad[y, x]:
                continue
            k = (y // 2) % 2
            c = ((154, 114, 72), (128, 92, 58))[k]
            if x in (bx0, bx1 - 1) or (x in (bx0 - 12, bx1 + 11) and y >= walk_y1 - 10):
                c = (74, 50, 30)
            elif hv[y, x] > 0.93:
                c = (182, 140, 92)
            out[y, x] = (*c, 255)
    # posts every 9 px along the boardwalk's edges and at the head
    for y in range(PAD_Y + PAD // 2 + 4, walk_y1, 9):
        for x in (bx0 - 1, bx1):
            out[y:y + 2, x:x + 2] = (46, 30, 18, 255)
    for x in (bx0 - 13, bx1 + 11):
        out[walk_y1 - 10:walk_y1 - 8, x:x + 2] = (46, 30, 18, 255)
    ground_ext = Image.fromarray(out, 'RGBA')
    ground_full = Image.new('RGBA', (EW, EH), (0, 0, 0, 0))
    ground_full.alpha_composite(ground_ext)
    ground_full.alpha_composite(ground, (OFF_X, OFF_Y))

    # --- walking grid: the old grid, plus every block that is mostly sand, pad or deck ---
    old = I.grid_string()
    rows, cols = EH // B, EW // B
    grid = np.full((rows, cols), '~', dtype='<U1')
    og = np.array(list(old), dtype='<U1').reshape(I.ROWS, I.COLS)
    cover = walkable.reshape(rows, B, cols, B).mean(axis=(1, 3)) >= 0.5
    grid[cover] = '.'
    grid[OFF_ROW:OFF_ROW + I.ROWS, OFF_COL:OFF_COL + I.COLS] = np.where(
        og != '~', og, np.where(cover[OFF_ROW:OFF_ROW + I.ROWS, OFF_COL:OFF_COL + I.COLS], '.', '~'))
    grid_str = ''.join(''.join(r) for r in grid)

    # --- props ---
    props, lights, smoke = [], [], []
    placed = []                                    # (x, y, radius)
    allsp = dict(sprites)
    allsp.update(new_sprites())

    def add(name, x, y, r):
        d = allsp[name]
        props.append({'s': f'prop-{name}', 'x': int(x), 'y': int(y), 'n': len(d['frames']), 'ms': int(d['ms']), 'sway': int(d['sway'])})
        placed.append((x, y, r))

    def free(x, y, r):
        return all(math.hypot(x - a, (y - b) * 1.4) >= r + c for a, b, c in placed)

    near_pad = np.zeros((EH, EW), bool)
    near_pad[y0 - 14:y0 + PAD + 14, x0 - 14:x0 + PAD + 14] = True
    near_walk = np.zeros((EH, EW), bool)
    near_walk[PAD_Y:walk_y1 + 6, bx0 - 22:bx1 + 22] = True
    okmask = sand & ~near_pad & ~near_walk & (sd >= 4) & (D >= 7)

    def sites(lo, hi, extra=None):
        m = okmask & (sd >= lo) & (sd <= hi)
        if extra is not None:
            m &= extra
        ys, xs = np.nonzero(m)
        pts = list(zip(xs.tolist(), ys.tolist()))
        rng.shuffle(pts)
        return pts

    def nearest(tx, ty, lo=8, hi=40, r=12):
        best = None
        ys, xs = np.nonzero(okmask & (sd >= lo) & (sd <= hi))
        for x, y in zip(xs.tolist(), ys.tolist()):
            d = math.hypot(x - tx, y - ty)
            if (best is None or d < best[0]) and free(x, y, r):
                best = (d, x, y)
        return best[1:] if best else None

    # the campfire on the south-west beach, logs around it
    c = nearest(OFF_X + 75, OFF_Y + 232, r=16)
    if c:
        add('campfire', c[0], c[1], 14)
        for dx, dy in ((-13, 3), (13, 3), (-6, -8), (7, -8)):
            props.append({'s': 'prop-log', 'x': c[0] + dx, 'y': c[1] + dy, 'n': 1, 'ms': 0, 'sway': 0})
        lights.append({'x': c[0], 'y': c[1] - 4, 'r': 34, 'c': '#ff9a3c', 'f': 0.6})
        smoke.append([c[0], c[1] - 8])
    # a volleyball net on the south-east beach
    v_ = nearest(OFF_X + 300, OFF_Y + 232, r=22)
    if v_:
        add('net', v_[0], v_[1], 16)
        props.append({'s': 'prop-ball', 'x': v_[0] + 14, 'y': v_[1] + 6, 'n': 1, 'ms': 0, 'sway': 0})
    # crates and barrels at the head of the boardwalk
    for nm, dx, dy in (('crate', -15, 0), ('crate', 16, 6), ('barrel', -16, 14), ('barrel', 17, -4)):
        x, y = PAD_X + dx, PAD_Y + PAD // 2 + 8 + dy
        if walkable[y, x] and not walk[y, x]:
            add(nm, x, y, 5)
    # lanterns on the pad corners
    for lx, ly, col in lamps:
        props.append({'s': 'prop-lantern', 'x': lx, 'y': ly + 1, 'n': 1, 'ms': 0, 'sway': 0})
        lights.append({'x': lx, 'y': ly - 6, 'r': 18, 'c': col, 'f': 0.25})
    # the helicopter, parked beside the pad
    hx, hy = PAD_X + PAD // 2 + 30, PAD_Y + 8
    add('helicopter', hx, hy, 18)

    # umbrellas with a towel beside each, spread along the beaches
    n_umb = 0
    for x, y in sites(7, 22):
        if n_umb >= 11:
            break
        if free(x, y, 13) and free(x + 8, y + 3, 6):
            tag = 'abc'[n_umb % 3]
            add(f'umbrella-{tag}', x, y, 11)
            add(f'towel-{"abc"[(n_umb + 1) % 3]}', x + 11, y + 3, 5)
            n_umb += 1
    # palms near the water, in loose groups
    n_palm = 0
    for x, y in sites(4, 18):
        if n_palm >= 34:
            break
        if free(x, y, 9):
            add(f'palm-{"abc"[n_palm % 3]}', x, y, 7)
            n_palm += 1
    # rocks and stones at the water's edge, bushes on the inland side
    n_rock = 0
    for x, y in sites(2, 9):
        if n_rock >= 20:
            break
        if free(x, y, 6):
            add(('rock-', 'stone-')[n_rock % 2] + 'abc'[n_rock % 3], x, y, 4)
            n_rock += 1
    inland = D <= 14
    n_bush = 0
    for x, y in sites(8, 40, inland):
        if n_bush >= 12:
            break
        if free(x, y, 7):
            add('bush-' + 'abc'[n_bush % 3], x, y, 5)
            n_bush += 1

    # --- ships: new circuits that keep clear of the beach and the dock ---
    def sea_course(margin):
        cxx, cyy = EW / 2, EH / 2 - 8
        pts = []
        for k in range(72):
            a = k * 2 * math.pi / 72
            ca, sa = math.cos(a), math.sin(a)
            coast = 0
            for rr in range(8, 700, 2):
                gx, gy = int((cxx + ca * rr) // B), int((cyy + sa * rr) // B)
                if 0 <= gx < cols and 0 <= gy < rows and grid[gy, gx] != '~':
                    coast = rr
            r = coast + margin
            while r > coast + 4:
                x, y = cxx + ca * r, cyy + sa * r
                if 14 <= x <= EW - 14 and 14 <= y <= EH - 10:
                    break
                r -= 2
            pts.append([round(cxx + ca * r), round(cyy + sa * r)])
        return pts

    ships = [
        {'kind': 'sloop', 'from': 0, 'speed': 0.0055, 'path': sea_course(36)},
        {'kind': 'trader', 'from': 26, 'speed': -0.0038, 'path': sea_course(54)},
        {'kind': 'skiff', 'from': 51, 'speed': 0.0072, 'path': sea_course(28)},
    ]

    return {
        'ground': ground_full,
        'sprites': new_sprites(),
        'grid': grid_str,
        'props': props,
        'lights': lights,
        'smoke': smoke,
        'ships': ships,
        'pad': {'x': PAD_X, 'y': PAD_Y, 'size': PAD},
        'walkable_px': int(walkable.sum()),
        'ring_px': int(ring.sum()),
    }


def shift_meta(meta, ext):
    """Fold the wider map into the metadata build_atlas made for the old frame."""
    ox, oy = OFF_X, OFF_Y
    meta['size'] = [EW, EH]
    meta['cols'] = EW // B
    meta['rows'] = EH // B
    meta['offset'] = [ox, oy]
    meta['grid'] = ext['grid']
    meta['ships'] = ext['ships']
    meta['pad'] = ext['pad']
    for c in meta['claims']:
        c['cx'] += ox
        c['cy'] += oy
        c['box'] = [c['box'][0] + ox, c['box'][1] + oy, c['box'][2], c['box'][3]]
        c['stand'] = [c['stand'][0] + ox, c['stand'][1] + oy]
    meta['regions'] = [[n, x + ox, y + oy] for n, x, y in meta['regions']]
    f = meta['fit']
    meta['fit'] = [f[0] + ox, f[1] + oy, f[2], f[3]]
    meta['home'] = [meta['home'][0] + ox, meta['home'][1] + oy]
    meta['rivers'] = [[bx + OFF_COL, by + OFF_ROW] for bx, by in meta['rivers']]
    meta['props'] = [dict(p, x=p['x'] + ox, y=p['y'] + oy) for p in meta['props']] + ext['props']
    meta['lights'] = [dict(l, x=l['x'] + ox, y=l['y'] + oy) for l in meta['lights']] + ext['lights']
    meta['smoke'] = [[x + ox, y + oy] for x, y in meta['smoke']] + ext['smoke']
    meta['lighthouse'] = {'x': meta['lighthouse']['x'] + ox, 'y': meta['lighthouse']['y'] + oy}
    meta['islets'] = [dict(i, x=i['x'] + ox, y=i['y'] + oy) for i in meta['islets']]
    return meta

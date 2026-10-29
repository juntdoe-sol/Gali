"""Gali Gear 555, bottom slot: 92 trousers, shorts, sarongs, skirts, kilts and
tails, drawn on the miner rig via kit.Bottom.

Leg canvas: the visible front leg is a 3 x 6 grid (gx 0 lit/back edge, 1 mid,
2 front/dark edge; gy -1 at the hip down to 4 at the ankle), the back leg shows
gy 2..4 only. Grids are written as 6 strings (gy -1..4), '.' = base colour.
Waist: the bottom 2 torso rows. Anything bigger (skirts, belts, pockets, tails,
effects) is drawn in extra() relative to W = (x0, y0 + n - 2), the top-left of the
waist band: back pocket at W+(1..3, 0..1), front hip at W+(8..11, 0..3).
"""
import math

import kit
from kit import Bottom, ramp

AM = kit.AM
SLOT = 'bottom'

# ---------------------------------------------------------------- palette
WHITE = '#f4f0e8'
CREAM = '#efe0bc'
BLACK = '#2c2632'
CHAR = '#3a3444'
SLATE = '#7a86a8'
STEEL = '#a8b4cc'
NAVY = '#26346e'
DENIM = '#3462c8'
DKDENIM = '#2a3f8a'
RED = '#e0383a'
MAROON = '#8a2034'
ORANGE = '#ff8a24'
YELLOW = '#ffd23c'
GOLD = '#f6bc36'
LIME = '#9ae04a'
GREEN = '#3cc85a'
DKGREEN = '#2a6a3a'
OLIVE = '#7a8a3a'
TEAL = '#2ec4b0'
CYAN = '#5ee0f0'
SKY = '#7cc4f0'
PURPLE = '#8a4ae0'
LILAC = '#c8a8f0'
PINK = '#ff8ab8'
CORAL = '#ff6a4a'
BROWN = '#7a5232'
TAN = '#c8a070'
KHAKI = '#c8a868'
SKIN = 'skin'


# ---------------------------------------------------------------- geometry
def T0(P):
    bx, by = P['body']
    sq = P.get('squash', 0)
    return int(round(9.4 + bx)) - 4, int(round(16.8 + by + sq * 0.5)) - 4 + sq


def NR(P):
    return len(AM.TORSO[P.get('squash', 0)])


def W(P):
    x0, y0 = T0(P)
    return x0, y0 + NR(P) - 2


def wind(P):
    a, b = P['feet']
    return max(0.0, (abs(a[0] - b[0]) - 3) / 4.0)


# ---------------------------------------------------------------- leg painter
def gxy(lx, ly, side):
    l = lx - (0.5 if side == 'b' else 0)
    gx = 0 if l > 0.45 else 2 if l < -0.45 else 1
    return gx, int(math.floor(ly + 0.5))


def cell(rows, gx, gy):
    if not rows:
        return '.'
    j = gy + 1
    if 0 <= j < len(rows):
        r = rows[j]
        return r[gx] if gx < len(r) else '.'
    return '.'


def pants(base, F=None, B='same', legend=None, length=8.0, waist=None, extra=None, fn=None):
    """F: front-leg grid, B: back-leg grid ('same' = F). legend: char -> colour
    (or 'skin'). fn(gx, gy, side, lx, ly) -> colour|None overrides everything."""
    legend = legend or {}
    Bg = F if B == 'same' else B
    exs = extra if isinstance(extra, (list, tuple)) else ([extra] if extra else [])

    def colour(lx, ly, tone, side):
        gx, gy = gxy(lx, ly, side)
        if fn:
            c = fn(gx, gy, side, lx, ly)
            if c:
                return c
        ch = cell(F if side == 'f' else Bg, gx, gy)
        if ch in legend:
            return legend[ch]
        return base

    def ex(f, P):
        for e in exs:
            e(f, P)
    return Bottom(colour, length=length, waist=waist or base, extra=ex if exs else None)


# ---------------------------------------------------------------- drawing helpers
SKIP = ('arm-f', 'head', 'pick')


def px(f, x, y, col, tone=2, part='bx', skip=SKIP):
    p = f.get(x, y)
    if p and any(p[3].startswith(s) for s in skip):
        return
    if col == SKIN:
        f.put(x, y, 'skin', tone, part)
        return
    f.put(x, y, ramp(col), tone, part)


def under(f, x, y, col, tone=2, part='bxu'):
    if f.get(x, y) is None:
        f.put(x, y, ramp(col), tone, part)


def glow(f, x, y, rgb, a):
    f.extra.append((x + kit.OX, y + kit.OY, (*rgb, a)))


def halo(f, cx, cy, rgb, r=2.5, a=110):
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            d = math.hypot(x - cx, y - cy)
            if d <= r:
                glow(f, x, y, rgb, int(a * (1 - d / (r + 0.5))))


def spark(f, x, y, rgb=(255, 255, 255), big=False):
    glow(f, x, y, rgb, 255)
    if big:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            glow(f, x + dx, y + dy, rgb, 170)


def stamp(f, P, rows, legend, ox, oy, part='bx', skip=SKIP, behind=False):
    """Hand-drawn grid at W + (ox, oy). legend: char -> colour | (colour, tone)."""
    x0, y0 = W(P)
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in ' .':
                continue
            spec = legend[ch]
            col, t = spec if isinstance(spec, tuple) else (spec, 2)
            if behind:
                under(f, x0 + ox + i, y0 + oy + j, col, t, part)
            else:
                px(f, x0 + ox + i, y0 + oy + j, col, t, part, skip)


def band(f, P, fn):
    """Recolour the two waist rows (torso and thigh pixels), keeping the tone.
    fn(i, r) with i = x - x0 and r = 0 (top row) / 1."""
    x0, y0 = W(P)
    for r in (0, 1):
        for x in range(x0 - 1, x0 + 12):
            p = f.get(x, y0 + r)
            if p and p[3] in ('torso', 'leg-f', 'leg-b'):
                c = fn(x - x0, r)
                if c:
                    f.put(x, y0 + r, ramp(c), p[2], p[3])


def belt(col, buckle=None, bt=3):
    def e(f, P):
        band(f, P, lambda i, r: col if r == 0 else None)
        if buckle:
            x0, y0 = W(P)
            px(f, x0 + 7, y0, buckle, bt, 'torso')
            px(f, x0 + 8, y0, buckle, bt - 1, 'torso')
    return e


def leg_extent(f, y):
    xs = [x for x in range(-8, 30) if f.part_at(x, y) in ('leg-b', 'leg-f')]
    return (min(xs), max(xs)) if xs else None


def skirt(f, P, colfn, rows=5, flare=0.5, part='skirt', hug=True):
    """Flared wrap from the waist down. colfn(i, k, w, rows) -> colour | (colour, tone) | None.
    i: column from the left edge (0..w), k: row from the waist (0..rows-1)."""
    x0, y0 = W(P)
    sway = wind(P)
    for k in range(rows):
        y = y0 + k
        a = x0 + 1 - int(k * flare * 0.8)
        b = x0 + (9 if k == 0 else 8) + int(k * flare)
        ext = leg_extent(f, y)
        if ext and k >= 2 and hug:
            a = min(a, ext[0] - (1 if sway > 0.5 and k == rows - 1 else 0))
            b = max(b, ext[1] + (1 if sway > 0.5 and k == rows - 1 else 0))
        w = b - a
        for x in range(a, b + 1):
            p = f.get(x, y)
            if p and p[3].startswith(SKIP):
                continue
            i = x - a
            r = colfn(i, k, w, rows)
            if r is None:
                continue
            if isinstance(r, tuple):
                col, t = r
            else:
                col = r
                t = 3 if i == 0 else 1 if i == w else 2
                if k == rows - 1 and 0 < i < w:
                    t = 1
            if col == SKIN:
                f.put(x, y, 'skin', t, part)
            else:
                f.put(x, y, ramp(col), t, part)


def bare_legs():
    return lambda lx, ly, tone, side: SKIN


def wrap(base, colfn, rows=5, flare=0.5, legs=None, length=8.0, more=()):
    """Bottom that is mostly a skirt/sarong drawn in extra()."""
    def ex(f, P):
        skirt(f, P, colfn, rows, flare)
        for m in more:
            m(f, P)
    lc = legs or base
    if lc == SKIN:
        return Bottom(lambda lx, ly, tone, side: SKIN, length=length, waist=base, extra=ex)
    return Bottom(lambda lx, ly, tone, side: lc, length=length, waist=base, extra=ex)


# ---------------------------------------------------------------- shared extras
def front_hang(rows, legend, dx=0, dy=0):
    return lambda f, P: stamp(f, P, rows, legend, 8 + dx, 0 + dy)


def back_print(rows, legend, dx=0, dy=0):
    return lambda f, P: stamp(f, P, rows, legend, 1 + dx, 0 + dy, skip=SKIP + ('arm-b',))


def tail(col, tip=None):
    pts = [(0, 1, 2), (-1, 1, 2), (-2, 2, 2), (-3, 2, 2), (-4, 1, 3), (-4, 0, 3), (-4, -1, 3), (-3, -2, 3),
           (-2, -2, 2), (-2, -1, 1)]

    def e(f, P):
        x0, y0 = W(P)
        s = int(round(wind(P)))
        for k, (dx, dy, t) in enumerate(pts):
            c = tip if tip and k >= len(pts) - 2 else col
            px(f, x0 + dx - (s if k > 2 else 0), y0 + dy, c, t, 'tail', skip=SKIP + ('arm-b', 'leg'))
    return e


# =================================================================== COMMON
def airdrop_cargo_shorts():
    F = ['...', 'f..', 'p..', 'h..', '...', '...']
    return pants(OLIVE, F, F, {'f': '#9aab4a', 'p': '#5a6a2a', 'h': '#5a6a2a'}, length=2.4, waist='#5a4a2a',
                 extra=[back_print(['ff', 'pp'], {'f': ('#9aab4a', 3), 'p': ('#5a6a2a', 1)}, 1, 0),
                        front_hang(['F', 'p'], {'F': ('#9aab4a', 3), 'p': ('#5a6a2a', 1)}, 0, 0)])


def anon_dev_sweats():
    F = ['...', 'ww.', '..w', '.w.', '...', '.w.']
    return pants('#2e2a3c', F, '...........', {'w': WHITE}, waist='#2e2a3c',
                 extra=[front_hang(['w', 'w'], {'w': (WHITE, 3)}, -1, 1)])


def expired_hash_shorts():
    X = ['r.r', '.r.', 'r.r']
    return pants('#8a92b0', None, length=2.4, waist='#6a7290',
                 extra=back_print(X, {'r': ('#e8303a', 2)}, 0, 0))


def burnt_hem_jeans():
    F = ['...', '...', '...', 'c.c', 'cco', 'ccc']
    return pants(DENIM, F, ['...', '...', '...', '.c.', 'coc', 'ccc'],
                 {'c': '#2a2228', 'o': '#ff8a24'}, waist=DKDENIM)


def cave_run_knee_pads():
    F = ['...', '...', '...', 'ggg', '...', '...']

    def lantern(f, P):
        stamp(f, P, ['k', 'Y'], {'k': ('#5a5a6a', 2), 'Y': ('#ffe070', 4)}, 9, 1)
        x0, y0 = W(P)
        halo(f, x0 + 9, y0 + 2, (255, 220, 110), 1.8, 90)
    return pants(BROWN, F, F, {'g': '#a8b0c0'}, waist='#4e3420', extra=lantern)


def compressed_shorts():
    F = ['zz.', 'z..', '...', '...', '...', '...']
    return pants('#9aa0c0', F, F, {'z': '#5a6080'}, length=0.9, waist='#5a6080',
                 extra=belt(None) if False else None)


def broom_pocket_trousers():
    F = ['...', '.d.', '...', 'd..', '..d', '...']

    def broom(f, P):
        stamp(f, P, ['.y', 'yYy', 'yyy', '.r.', '.h.'],
              {'y': ('#e8c050', 2), 'Y': ('#ffe080', 4), 'r': ('#c83a2a', 2), 'h': ('#a0703f', 2)}, -1, -4,
              skip=SKIP)
    return pants('#9a7450', F, F, {'d': '#c8a882'}, waist='#6a4a30', extra=broom)


def gm_pajama_pants():
    F = ['.y.', '...', 'y..', '..y', '.y.', '...']
    B = ['...', '...', '...', 'y..', '..y', '...']
    return pants(SKY, F, B, {'y': '#ffd83a'}, waist='#5aa4e0',
                 extra=front_hang(['w', 'w'], {'w': (WHITE, 3)}, -1, 1))


def green_candle_joggers():
    F = ['.k.', '.k.', '.k.', '.k.', 'www', 'www']
    return pants(GREEN, F, F, {'k': '#1e5a2a', 'w': WHITE}, waist='#2a9a44')


def hat_dog_joggers():
    F = ['...', 'bb.', 'tk.', 'tt.', 'ddd', 'ddd']
    return pants(PINK, F, ['...', '...', '...', '...', 'ddd', 'ddd'],
                 {'b': '#3a7ae0', 't': '#e8b878', 'k': '#2a2228', 'd': '#e0609a'}, waist='#e0609a')


def hopium_pajamas():
    F = ['...', 'w..', 'r..', '..w', '..r', '...']
    return pants('#a8e8b0', F, ['...', '...', '...', '.w.', '.r.', '...'],
                 {'w': WHITE, 'r': '#ff5a4a'}, waist='#78c888')


def island_board_shorts():
    F = ['y..', 'yy.', '...', '..y', '...', '...']
    return pants('#20b0b0', F, ['...', '...', '...', 'y.y', '...', '...'], {'y': '#ffe04a'}, length=3.2,
                 waist='#188a90', extra=front_hang(['w', 'w', '.w'], {'w': (WHITE, 3)}, -1, 1))


def jeet_runner_shorts():
    F = ['...', '..t', 'swt', '...', '...', '...']
    return pants('#ff7a1a', F, F, {'t': WHITE, 'w': WHITE, 's': SKIN}, length=1.5, waist=WHITE)


def frozen_chain_joggers():
    F = ['...', '...', 'w.w', 'w.w', '...', 'iii']
    return pants('#9ad8f8', F, ['...', '...', '...', '...', '...', 'iii'], {'w': WHITE, 'i': '#d8f4ff'},
                 waist='#6ab8e8')


def night_shift_sweats():
    F = ['...', 'yy.', 'y..', 'yy.', '..c', '...']
    return pants(NAVY, F, ['...', '...', '...', '...', '.c.', '...'], {'y': '#ffd83a', 'c': '#8a5a34'},
                 waist='#1e2850')


def kain_pelikat_sarong():
    def c(i, k, w, rows):
        if k == 0:
            return ('#b03448', 3 if i < w - 1 else 2)
        if k == 1:
            return ('#8a2034', 1)
        a, b = (i // 2) % 2, ((k - 2) // 2) % 2
        if a and b:
            return '#1e3a26'
        if a or b:
            return '#2a5a3a' if a else '#8a2034'
        return '#b03448'
    return wrap(MAROON, c, rows=5, flare=0.4)


def paper_bag_shorts():
    F = ['...', '.b.', '.b.', 'sts', '...', '...']
    return pants(TAN, F, F, {'b': '#a07848', 's': SKIN, 't': TAN}, length=2.6, waist='#e0c090',
                 extra=lambda f, P: band(f, P, lambda i, r: '#e8cca0' if r == 0 else '#a07848' if i % 3 == 0 else None))


def priority_fee_trackies():
    F = ['.g.', 'ggg', '.g.', '.g.', '.g.', '.g.']
    return pants('#2f6ad8', F, F, {'g': '#ffc83a'}, waist='#2450a8')


def red_candle_sweats():
    F = ['.w.', '.w.', '.w.', '.w.', '.w.', 'ddd']
    return pants(RED, F, F, {'w': WHITE, 'd': '#a82030'}, waist='#a82030')


def rent_exempt_shorts():
    F = ['.s.', 's.s', 'ggg', 'gkg', '...', '...']
    return pants('#dcc89c', F, '......', {'s': '#c0c4d0', 'g': GOLD, 'k': '#6a4a10'}, length=2.5,
                 waist='#b8a478')


def ser_slacks():
    F = ['.l.', '.l.', '.l.', '.l.', '.l.', '.l.']
    return pants(SLATE, F, F, {'l': '#a8b4d0'}, waist=SLATE, extra=belt('#2a2430', '#d8dce8'))


def shrimp_shorts():
    S = ['.cc', 'c.c', 'cc.']
    return pants('#ff9ab8', None, length=1.0, waist='#ff9ab8',
                 extra=back_print(S, {'c': ('#ff5a2a', 2)}, 0, 0))


def sniper_camo_pants():
    F = ['k.l', '.kk', 'lr.', 'r.r', '.rk', 'kl.']
    return pants('#3a7a3a', F, ['k.l', '.kk', 'lk.', 'k.l', '.lk', 'kl.'],
                 {'k': '#1e2a1e', 'l': '#6aa84a', 'r': '#ff3030'}, waist='#2a4a2a')


def solana_summer_shorts():
    G = {-1: '#9a4ae8', 0: '#7a64e0', 1: '#4a96d4', 2: '#2ec4b0'}

    def sun(f, P):
        stamp(f, P, ['.w.', 'wWw', '.w.'], {'w': ('#fffbe8', 3), 'W': ('#ffffff', 4)}, 1, 0)
    return pants('#2ec4b0', fn=lambda gx, gy, s, lx, ly: G.get(gy), length=2.4, waist='#9a4ae8', extra=sun)


def arcade_token_shorts():
    F = ['g..', '..g', '.g.', 'gpg', '...', '...']
    return pants('#2a2436', F, F, {'g': GOLD, 'p': PURPLE}, length=2.5, waist='#2a2436',
                 extra=lambda f, P: band(f, P, lambda i, r: GOLD if r == 1 and i % 3 == 1 else None))


def blue_miner_jeans():
    F = ['o..', '...', 'o..', '...', 'o..', '...']

    def rivet(f, P):
        x0, y0 = W(P)
        px(f, x0 + 8, y0 + 1, '#e8b040', 4, 'torso')
        band(f, P, lambda i, r: '#ff8a24' if r == 0 and i % 2 else None)
    return pants(DKDENIM, F, F, {'o': '#ff8a24'}, waist=DKDENIM, extra=rivet)


def brawl_gym_shorts():
    F = ['g..', 'g..', 'g..', 'g..', '...', '...']
    return pants('#e02a3a', F, F, {'g': GOLD}, length=2.4, waist=WHITE)


def copium_sweatshorts():
    F = ['...', 'l.l', '.l.', 'lll', '...', '...']
    return pants('#9a9cc0', F, '......', {'l': '#c8cae4'}, length=2.6, waist='#7a7ca4')


def down_bad_trackies():
    F = ['.r.', '.r.', 'rrr', '.r.', '..d', '...']

    def sag(f, P):
        x0, y0 = W(P)
        band(f, P, lambda i, r: '#6a7090' if r == 0 else None)
        e = leg_extent(f, y0 + 3)
        if e:
            under(f, e[1] + 1, y0 + 3, '#8890b0', 1)
    return pants('#8890b0', F, ['...', '...', '...', '...', '.d.', '...'], {'r': '#e83a3a', 'd': '#6a7090'},
                 waist='#8890b0', extra=sag)


def khaki_work_pants():
    F = ['...', '...', '...', 'bbb', '...', '...']
    return pants(KHAKI, F, F, {'b': '#7a5232'}, waist='#a8884a', extra=belt('#5a3a22', '#d8a840'))


def lily_pad_shorts():
    F = ['d..', 'dd.', '..p', '.dd', '...', '...']
    return pants('#5ac850', F, ['...', '...', '...', 'dd.', '...', '...'], {'d': '#2a8a3a', 'p': '#ff9ac8'},
                 length=2.4, waist='#3aa040')


def lobby_lounge_pants():
    def bow(f, P):
        stamp(f, P, ['w.w', '.w.', 'w.w'], {'w': (WHITE, 3)}, 7, 0)
    F = ['...', '...', '...', '...', '...', 'lll']
    return pants(LILAC, F, F, {'l': '#e0d0fa'}, waist='#a888d8', extra=bow)


def monke_banana_shorts():
    B = ['b..', 'bb.', '.bb']
    return pants('#ffd23c', None, length=2.4, waist='#e8b020',
                 extra=back_print(B, {'b': ('#7a4a22', 2)}, -1, 0))


def pumpkin_patch_pants():
    F = ['...', '...', 'k.k', '.k.', 'kkk', '...']
    B = ['...', '...', '...', 'k.k', 'kkk', '...']
    return pants(ORANGE, F, B, {'k': '#2a1a1a'}, waist='#d86a14')


def touch_grass_shorts():
    F = ['...', '...', '...', 'l.l', 'sls', '...']
    return pants('#4ab84a', F, F, {'l': LIME, 's': SKIN}, length=3.4, waist='#2a8a3a')


def wagmi_track_pants():
    F = ['w.w', 'w.w', 'w.w', 'w.w', 'w.w', 'w.w']

    def w(f, P):
        stamp(f, P, ['w.w.w', '.w.w.'], {'w': (WHITE, 3)}, 1, 0)
    return pants('#7a3ad0', F, F, {'w': WHITE}, waist='#5a28a8', extra=w)


def whale_tail_trunks():
    F = ['...', 'w.w', '.w.', '.w.', '...', '...']
    return pants(NAVY, F, '......', {'w': WHITE}, length=3.0, waist='#1e2850')


# =================================================================== UNCOMMON
def sprint_shorts_400ms():
    def watch(f, P):
        stamp(f, P, ['.b.', 'tTt', 'twt', '.t.'], {'b': ('#c0c4d0', 3), 't': ('#20a8a0', 2),
                                                  'T': ('#e8fffa', 4), 'w': ('#2a2436', 1)}, 1, -1)
    F = ['..t', '..t', 'tst', '...', '...', '...']
    return pants('#f4f0e8', F, F, {'t': TEAL, 's': SKIN}, length=1.6, waist=TEAL, extra=watch)


def airdrop_mega_cargos():
    F = ['f.f', 'p.p', '.f.', '.p.', 'f.f', 'p.p']

    def chute(f, P):
        stamp(f, P, ['.www.', 'wrwrw', '.l.l.', '..b..'],
              {'w': (WHITE, 3), 'r': ('#e8303a', 2), 'l': ('#c8c0b0', 2), 'b': ('#5a6a2a', 2)}, -2, -3,
              behind=True)
    return pants(OLIVE, F, F, {'f': '#a8b85a', 'p': '#4e5a22'}, waist='#4e5a22',
                 extra=[chute, back_print(['fF', 'pp'], {'f': ('#a8b85a', 3), 'F': ('#e8303a', 3), 'p': ('#4e5a22', 1)}, 0, 0)])


def bonding_curve_leggings():
    F = ['w..', 'w..', '.w.', '..w', '..w', '..w']

    def tip(f, P):
        x0, y0 = W(P)
        band(f, P, lambda i, r: '#ffffff' if (r == 1 and i == 4) or (r == 0 and i == 3) else None)
        spark(f, x0 + 3, y0 - 1, (180, 255, 200))
    return pants('#221c2c', F, F, {'w': '#f4fff4'}, waist='#221c2c', extra=tip)


def breakpoint_tour_chinos():
    def lanyard(f, P):
        stamp(f, P, ['r..', '.r.', '.r.', 'WWW', 'Wpw', 'www'],
              {'r': ('#e8303a', 2), 'W': ('#ffffff', 4), 'w': ('#e8e4f0', 2), 'p': (PURPLE, 2)}, 7, 0)
    return pants(NAVY, None, waist=NAVY, extra=[belt('#6a4a30', '#d8a840'), lanyard])


def clan_banner_kilt():
    def c(i, k, w, rows):
        if k == 0:
            return ('#3a2a20', 2)
        if k == rows - 1:
            return ('#a01c28', 1) if i % 2 else ('#d02a34', 2)
        v, h = i % 4 == 2, k == 2
        if v and h:
            return ('#3a2a40', 2)
        if v or h:
            return ('#4a3450', 3)
        if i % 4 == 0 and k == 1:
            return ('#ffd23c', 3)
        return ('#e83a44', 3 if i < 2 else 2)

    def badge(f, P):
        stamp(f, P, ['sS'], {'s': ('#c8d0e0', 3), 'S': ('#e8ecf4', 4)}, 7, 0)
    return wrap('#d02a34', c, rows=5, flare=0.5, legs=SKIN, more=(badge,))


def diamond_stud_jeans():
    F = ['.d.', '...', 'd.c', '...', '.d.', 'c..']
    return pants('#243a7a', F, F, {'d': '#ffffff', 'c': '#9af0ff'}, waist='#1a2a5a',
                 extra=belt('#3a2a40', '#e8f8ff'))


def galaxy_brain_leggings():
    F = ['p..', '..b', '.p.', 'b..', '..p', '.b.']
    B = ['...', '...', '...', '.p.', 'b..', '..p']

    def stars(f, P):
        band(f, P, lambda i, r: '#ff8ae0' if (i + r * 3) % 5 == 0 else '#7ab8ff' if (i + r) % 7 == 3 else None)
    return pants('#3a1a6a', F, B, {'p': '#ff8ae0', 'b': '#7ab8ff'}, waist='#3a1a6a', extra=stars)


def skeleton_print_pants():
    F = ['w.w', '.w.', '.w.', 'w.w', '.w.', '.w.']

    def pelvis(f, P):
        band(f, P, lambda i, r: WHITE if (r == 0 and 2 <= i <= 6) or (r == 1 and i in (2, 6)) else None)
    return pants('#221c2a', F, F, {'w': '#f4f0e8'}, waist='#221c2a', extra=pelvis)


def liquidated_sweats():
    def pockets(f, P):
        stamp(f, P, ['ww', 'w.'], {'w': ('#f4f0e8', 3)}, -1, 1, behind=False)
        stamp(f, P, ['w', 'ww', 'w'], {'w': ('#f4f0e8', 3)}, 9, 0)
    return pants('#8a90a8', ['...', '...', '...', '...', '...', 'ddd'], 'same', {'d': '#6a7088'},
                 waist='#6a7088', extra=pockets)


def nugget_patch_shorts():
    F = ['...', 'yyy', 'mkm', 'mpm', '...', '...']
    return pants('#3a7ae0', F, '......', {'y': '#ffd23c', 'm': '#8a5a3a', 'k': '#1a1418', 'p': '#ff8aa0'},
                 length=2.8, waist='#2a5ab0')


def mint_day_bot_pants():
    F = ['b.b', '...', 'b.b', '...', 'b.b', '...']

    def led(f, P):
        x0, y0 = W(P)
        band(f, P, lambda i, r: '#5a6480' if r == 0 else None)
        px(f, x0 + 8, y0, '#5ef0c8', 4, 'torso')
        glow(f, x0 + 10, y0, (94, 240, 200), 120)
    return pants('#c4cce0', F, F, {'b': '#5a6480'}, waist='#a0a8c0', extra=led)


def monke_tail_trousers():
    def buckle(f, P):
        stamp(f, P, ['y..', '.yY'], {'y': ('#ffd23c', 2), 'Y': ('#7a5a1a', 1)}, 6, 0)
    return pants('#7a4a28', None, waist='#5a3418',
                 extra=[tail('#8a5a30', '#c88a50'), belt('#4a2a14'), buckle])


def motherlode_pocket_pants():
    def nuggets(f, P):
        x0, y0 = W(P)
        stamp(f, P, ['bb', 'bgb'], {'b': ('#8a5a34', 3), 'g': ('#ffd23c', 3)}, 0, 0)
        for (dx, dy, t) in ((-1, 2, 3), (-2, 4, 2), (10, 1, 3), (10, 3, 2), (9, 0, 4)):
            px(f, x0 + dx, y0 + dy, GOLD, t, 'nug')
        spark(f, x0 - 2, y0 + 1, (255, 248, 200))
    return pants(BROWN, ['...', '...', '...', '...', '...', 'ddd'], 'same', {'d': '#5a3a20'},
                 waist='#5a3a20', extra=[belt('#3a2414', GOLD), nuggets])


def halt_barrier_pants():
    def fn(gx, gy, s, lx, ly):
        if gy >= 2:
            return '#ffd23c' if (gx + gy) % 2 == 0 else '#1e1a22'
    return pants('#2a2430', fn=fn, waist='#2a2430')


def batik_sarong():
    def c(i, k, w, rows):
        if k == 0:
            return ('#3a4ab0', 3)
        if (i * 3 + k * 5) % 7 == 0:
            return ('#f4f0e8', 3)
        if (i * 3 + k * 5) % 7 == 3:
            return ('#7ab0f0', 2)
        if k == rows - 1:
            return ('#1e2868', 1)
        return '#2a3a8a'

    def knot(f, P):
        stamp(f, P, ['kK', 'k.', 'k.', '.k'], {'k': ('#3a4ab0', 2), 'K': ('#7ab0f0', 3)}, 9, 0)
    return wrap('#2a3a8a', c, rows=5, flare=0.45, more=(knot,))


def refinery_work_pants():
    F = ['...', '...', '...', 'sss', '...', '...']
    return pants('#ff7a1a', F, F, {'s': '#eef4ff'}, waist='#c85a10', extra=belt('#4a3a3a', '#c8d0e0'))


def probably_nothing_slacks():
    E = ['.w.', 'wkw', '.w.']
    return pants('#26222e', None, waist='#26222e',
                 extra=back_print(E, {'w': ('#f4f0e8', 3), 'k': ('#5ae0f0', 2)}, 0, 0))


def rug_pull_rug_shorts():
    F = ['n.n', '.c.', 'n.n', 'tst', '...', '...']
    return pants('#c8283a', F, F, {'n': '#2a2a6a', 'c': CREAM, 't': CREAM, 's': SKIN}, length=3.4,
                 waist='#efe0bc', extra=lambda f, P: band(f, P, lambda i, r: '#2a2a6a' if r == 1 and i % 2 else None))


def seeker_squad_cargos():
    F = ['..t', 'kk.', 'sk.', 'kk.', '...', 'ttt']
    return pants('#3e4660', F, ['...', '...', '...', '...', '...', 'ttt'],
                 {'t': TEAL, 'k': '#1a1e2a', 's': '#5ef0e0'}, waist='#2e3448')


def frog_pond_waders():
    F = ['...', '...', 'wkw', 'mmm', '...', '...']

    def straps(f, P):
        x0, y0 = W(P)
        for dy in range(-5, 0):
            for dx in (3, 7):
                p = f.get(x0 + dx, y0 + dy)
                if p and p[3] == 'torso':
                    f.put(x0 + dx, y0 + dy, ramp('#3a9a3a'), p[2], 'torso')
        px(f, x0 + 7, y0 - 2, '#c8d0e0', 3, 'torso')
    return pants('#4ab84a', F, ['...', '...', '...', 'wkw', 'mmm', '...'],
                 {'w': '#f4fff0', 'k': '#1a2a1a', 'm': '#1e5a24'}, waist='#4ab84a', extra=straps)


def lantern_belt_trousers():
    def kit_(f, P):
        stamp(f, P, ['.k.', 'kYk', 'kyk', '.k.'], {'k': ('#5a5a6a', 2), 'Y': ('#fff4a0', 4), 'y': ('#ffd040', 3)},
              8, 0)
        stamp(f, P, ['ww', 'ww'], {'w': ('#f4f0e8', 3)}, 0, 1)
        x0, y0 = W(P)
        halo(f, x0 + 9, y0 + 2, (255, 214, 90), 2.2, 80)
    return pants(BROWN, None, waist='#3a2414', extra=[lambda f, P: band(f, P, lambda i, r: '#3a2414'), kit_])


def origami_paper_skirt():
    def c(i, k, w, rows):
        if k == rows - 1:
            return ('#f8f6f0', 4) if i % 2 == 0 else None
        return ('#ffffff', 4) if (i + k) % 3 == 0 else ('#d8d4e0', 1) if (i + k) % 3 == 2 else ('#f0ecf4', 2)
    return wrap('#e8e4f0', c, rows=4, flare=0.8, legs=SKIN)


def shrimp_cocktail_skirt():
    def c(i, k, w, rows):
        if k == 2:
            if i % 3 == 1:
                return ('#ff5a2a', 3)
            return ('#ffb0cc', 3) if i % 2 else ('#ff8ab8', 2)
        return ('#ffc0d8', 3) if (i + k) % 2 else ('#ff8ab8', 2)

    def wide(f, P):
        x0, y0 = W(P)
        for dx, c in ((-2, '#ff8ab8'), (11, '#ff8ab8')):
            under(f, x0 + dx, y0 + 2, c, 2, 'skirt')
        spark(f, x0 + 11, y0 + 1, (255, 230, 240))
    return wrap('#ff8ab8', c, rows=3, flare=1.4, legs=SKIN, more=(wide,))


def wau_kite_shorts():
    F = ['.y.', 'yby', '.y.', 'ggg', '...', '...']
    return pants('#d82a3a', F, ['...', '...', '...', 'ggg', '...', '...'],
                 {'y': '#ffd23c', 'b': '#3a7ae0', 'g': GOLD}, length=2.4, waist=GOLD)


def this_is_fine_jeans():
    F = ['ccc', 'ccc', 'coc', 'ocy', 'cyo', 'ccc']

    def flames(f, P):
        x0, y0 = W(P)
        for y in (y0 + 1, y0 + 2, y0 + 3):
            e = leg_extent(f, y)
            if e:
                under(f, e[1] + 1, y, '#ff8a24' if y != y0 + 1 else '#ffd23c', 3, 'flame')
        halo(f, x0 + 11, y0 + 2, (255, 140, 40), 2.2, 90)
    return pants(DENIM, F, '......', {'c': '#2a2228', 'o': '#ff7a1a', 'y': '#ffd23c'}, waist=DKDENIM,
                 extra=flames)


def validator_rack_shorts():
    F = ['g.a', 'sss', 'a.g', 'sss', '...', '...']

    def leds(f, P):
        band(f, P, lambda i, r: '#5af06a' if r == 1 and i % 3 == 1 else '#ffb23a' if r == 1 and i % 3 == 2 else
             '#5a5a6e' if r == 0 else None)
    return pants('#221e2a', F, F, {'g': '#5af06a', 'a': '#ffb23a', 's': '#4a4a5e'}, length=2.6,
                 waist='#221e2a', extra=leds)


def whale_wetsuit_bottoms():
    F = ['..w', '..w', '..w', '..w', '..w', '..w']

    def spout(f, P):
        stamp(f, P, ['c.c', '.c.', '.w.'], {'c': ('#8ae4ff', 3), 'w': ('#f4fbff', 3)}, 0, -1)
    return pants(NAVY, F, F, {'w': '#f4f8ff'}, waist=NAVY, extra=spout)


# =================================================================== RARE
def crash_cart_racers():
    def fn(gx, gy, s, lx, ly):
        if gx == 0:
            return '#ffffff' if gy % 2 == 0 else '#1a161e'
        if gx == 1:
            return '#e8303a'
    F = None

    def cart(f, P):
        stamp(f, P, ['.r.', 'GGGG', 'gggg', 'k..k'],
              {'r': ('#e8303a', 2), 'G': ('#b8c0d4', 3), 'g': ('#8a92a8', 1), 'k': ('#2a2430', 2)}, 8, 1)
        x0, y0 = W(P)
        spark(f, x0 + 12, y0 + 1)
    return pants('#221e28', F, fn=fn, waist='#221e28', extra=[belt('#e8303a', '#f4f0e8'), cart])


def ko_champion_greaves():
    F = ['ddd', '...', 'r.r', '.r.', 'r.r', 'ddd']

    def stars(f, P):
        x0, y0 = W(P)
        for (dx, dy) in ((11, 0), (12, 2), (10, -1)):
            spark(f, x0 + dx, y0 + dy, (255, 230, 90), big=(dx == 12))
    return pants('#a8b4cc', F, ['...', '...', '...', '.r.', 'ddd', '...'],
                 {'d': '#6a7490', 'r': '#e8303a'}, waist='#7a2a2a', extra=[belt('#5a2020', GOLD), stars])


def diamond_plate_greaves():
    F = ['ddd', '...', 'ddd', 'bWb', '.b.', 'ddd']

    def glint(f, P):
        x0, y0 = W(P)
        spark(f, x0 + 11, y0 + 3, (220, 250, 255), big=True)
        halo(f, x0 + 10, y0 + 3, (120, 220, 255), 2.0, 80)
    return pants('#c4cee0', F, ['...', '...', '...', 'bWb', '.b.', 'ddd'],
                 {'d': '#7a86a0', 'b': '#3aa8ff', 'W': '#ffffff'}, waist='#7a86a0',
                 extra=[belt('#3a4460', '#9af0ff'), glint])


def pump_wick_trousers():
    F = ['.W.', '.w.', '.W.', '.w.', '.w.', 'ddd']

    def arrows(f, P):
        x0, y0 = W(P)
        for (dx, dy) in ((11, 0), (10, -1), (12, -1), (11, -3), (10, -4), (12, -4)):
            glow(f, x0 + dx, y0 + dy, (110, 255, 130), 230)
        halo(f, x0 + 9, y0 + 1, (90, 240, 120), 2.0, 60)
    return pants('#2ab84a', F, F, {'W': '#ffffff', 'w': '#c8ffd8', 'd': '#1a6a2a'}, waist='#1a7a32',
                 extra=arrows)


def lighthouse_stripe_pants():
    def fn(gx, gy, s, lx, ly):
        return '#e8303a' if gy % 2 == 0 else '#f8f4ec'

    def beam(f, P):
        x0, y0 = W(P)
        px(f, x0 + 7, y0, '#fff4a0', 4, 'torso')
        px(f, x0 + 8, y0, '#ffd23c', 3, 'torso')
        e = leg_extent(f, y0) or (0, x0 + 9)
        for d in range(1, 6):
            for v in range(-(d // 3), d // 3 + 1):
                glow(f, e[1] + d, y0 + v, (255, 236, 110), max(60, 230 - d * 35) if v == 0 else 90)
    return pants('#e8303a', fn=fn, waist='#2a2430', extra=[belt('#2a2430'), beam])


def margin_call_greaves():
    F = ['ddd', '.k.', 'k..', '.R.', '..k', 'ddd']

    def warn(f, P):
        e = None
        x0, y0 = W(P)
        for y in range(y0, y0 + 6):
            for x in range(x0, x0 + 14):
                p = f.get(x, y)
                if p and p[3] == 'leg-f' and p[1] == ramp('#ff2020'):
                    e = (x, y)
        if e:
            halo(f, e[0] + 0.5, e[1] + 0.5, (255, 40, 40), 2.6, 130)
    return pants('#9aa4b8', F, ['...', '...', '...', 'k.k', '.k.', 'ddd'],
                 {'d': '#5a6278', 'k': '#2a2a38', 'R': '#ff2020'}, waist='#5a6278',
                 extra=[belt('#3a3440', '#ff3030'), warn])


def mole_king_pantaloons():
    F = ['...', '...', '...', 'g.g', 'ggg', '...']

    def puff(f, P):
        x0, y0 = W(P)
        for y in (y0 + 1, y0 + 2):
            e = leg_extent(f, y)
            if e:
                under(f, e[0] - 1, y, '#a05ae8', 3, 'puff')
                under(f, e[1] + 1, y, '#6a2ab0', 1, 'puff')
        band(f, P, lambda i, r: '#2a1a1a' if r == 0 else None)
        for dx in (2, 5):
            px(f, x0 + dx, y0, '#fff07a', 4, 'torso')
            glow(f, x0 + dx, y0 - 1, (255, 240, 120), 110)
        spark(f, x0 + 11, y0 + 4, (255, 240, 160))
    return pants('#8a3ad8', F, F, {'g': GOLD}, waist='#6a2ab0', extra=puff)


def old_glow_lantern_belt():
    def lantern(f, P):
        band(f, P, lambda i, r: '#3a2414' if r == 0 else None)
        stamp(f, P, ['.hh.', 'kkkk', 'kYYk', 'kyyk', '.kk.'],
              {'h': ('#c8a040', 3), 'k': ('#4a3a2a', 2), 'Y': ('#fff6b0', 4), 'y': ('#ffc840', 3)}, 8, 0)
        x0, y0 = W(P)
        halo(f, x0 + 9.5, y0 + 3, (255, 200, 80), 3.6, 120)
    return pants('#7a5232', None, waist='#5a3a20', extra=lantern)


def songket_sampin():
    def c(i, k, w, rows):
        if k == 0:
            return ('#1e1a22', 2)
        if (i + k) % 4 == 0:
            return ('#c82a3a', 2)
        if (i - k) % 4 == 0:
            return ('#fff4c0', 4)
        return ('#f6bc36', 3 if i < 2 else 2)

    def keris(f, P):
        stamp(f, P, ['b.', 'gb', '.g'], {'b': ('#7a4a22', 3), 'g': ('#ffd23c', 4)}, 7, -2)
        x0, y0 = W(P)
        spark(f, x0 - 1, y0 + 2, (255, 248, 200))
        spark(f, x0 + 12, y0 + 1, (255, 248, 200), big=True)
    return wrap('#1e1a22', c, rows=4, flare=0.5, legs='#1e1a22', more=(keris,))


def red_wick_drip_pants():
    F = ['.k.', 'pkp', '.kp', '.p.', 'p.p', 'ppp']

    def drips(f, P):
        x0, y0 = W(P)
        e = leg_extent(f, y0 + 3)
        if e:
            under(f, e[1] + 1, y0 + 3, '#ff7a8a', 3, 'drip')
            under(f, e[1] + 1, y0 + 4, '#ff7a8a', 2, 'drip')
            spark(f, e[1] + 1, y0 + 6, (255, 110, 130))
    return pants('#d0202e', F, ['...', '...', '...', 'p.p', '.p.', 'ppp'], {'k': '#3a1418', 'p': '#ff7a8a'},
                 waist='#a01822', extra=drips)


def tearaway_track_pants():
    F = ['w.s', 'w..', 'w..', 'w.s', 'wss', 'w..']

    def flap(f, P):
        x0, y0 = W(P)
        e = leg_extent(f, y0 + 3)
        if e:
            under(f, e[1] + 1, y0 + 3, '#e0303a', 3, 'flap')
            under(f, e[1] + 2, y0 + 4, '#e0303a', 2, 'flap')
            under(f, e[1] + 1, y0 + 4, '#e0303a', 1, 'flap')
            spark(f, e[1] + 2, y0 + 2, (255, 255, 255))
    return pants('#e0303a', F, F, {'w': '#ffffff', 's': SKIN}, waist='#ffffff', extra=flap)


def sniper_bot_ghillie():
    def fn(gx, gy, s, lx, ly):
        return ['#3a8a3a', '#5ab048', '#2a6a2a', '#7ac850'][(gx * 3 + gy * 2 + (s == 'b')) % 4] \
            if not (s == 'f' and gx == 1 and gy == 2) else '#ff2020'

    def leaves(f, P):
        x0, y0 = W(P)
        for y in range(y0, y0 + 5):
            e = leg_extent(f, y)
            if not e:
                continue
            if y % 2 == 0:
                under(f, e[0] - 1, y, '#5ab048', 3, 'leaf')
            else:
                under(f, e[1] + 1, y, '#2a6a2a', 1, 'leaf')
        for (dx, dy) in ((0, 0), (9, 0), (-1, 1)):
            under(f, x0 + dx, y0 + dy, '#4a9a3a', 2, 'leaf')
        for y in range(y0, y0 + 6):
            for x in range(x0 - 3, x0 + 14):
                p = f.get(x, y)
                if p and p[3] == 'leg-f' and p[1] == ramp('#ff2020'):
                    halo(f, x + 0.5, y + 0.5, (255, 30, 30), 2.4, 140)
                    p[2] = 4
    return pants('#3a8a3a', fn=fn, waist='#2a6a2a', extra=leaves)


def ghost_hem_pants():
    def fn(gx, gy, s, lx, ly):
        if gy >= 3:
            return '#e8ecff'

    def wisp(f, P):
        for y in range(f.h):
            for x in range(f.w):
                p = f.px[y][x]
                if p and p[3] in ('leg-b-boot', 'leg-f-boot'):
                    f.px[y][x] = None
        x0, y0 = W(P)
        for (dx, dy, a) in ((1, 4, 190), (2, 4, 210), (3, 4, 210), (4, 4, 200), (5, 4, 180), (6, 4, 170),
                            (2, 5, 150), (3, 5, 110), (5, 5, 140), (6, 5, 90), (1, 5, 60), (7, 5, 80),
                            (4, 6, 70), (7, 6, 50), (0, 6, 40)):
            glow(f, x0 + dx + (2 if dy > 4 else 0) * (wind(P) > 0.5), y0 + dy, (236, 240, 255), a)
        for (dx, dy) in ((-2, 2), (10, 3)):
            glow(f, x0 + dx, y0 + dy, (220, 230, 255), 90)
    return pants('#f4f4ff', fn=fn, waist='#d8dcf4', extra=wisp)


def hopium_cloud_pants():
    def clouds(f, P):
        x0, y0 = W(P)
        for side in (0, 1):
            ax, ay = P['feet'][side]
            for (dx, dy, t) in ((-2, -2, 3), (-1, -2, 4), (0, -2, 4), (1, -2, 3), (2, -2, 2),
                                (-1, -3, 4), (0, -3, 3), (1, -3, 4)):
                px(f, ax + dx, ay + dy, '#ffffff' if t > 2 else '#c8dcf4', t, 'cloud')
        for (x, y) in ((x0 - 1, y0 + 2), (x0 + 11, y0 + 2)):
            px(f, x, y, '#f4f8ff', 3, 'cloud')
        spark(f, x0 + 12, y0, (255, 255, 255))
    return pants('#9ad0f8', None, waist='#7ab8e8', extra=clouds)


def mine_cart_cargos():
    def cart(f, P):
        stamp(f, P, ['.yo.', 'GGGG', 'gggg', 'k..k'],
              {'y': ('#ffd23c', 4), 'o': ('#ff8a24', 2), 'G': ('#b8c0d4', 3), 'g': ('#7a8298', 1),
               'k': ('#2a2430', 2)}, 1, 1, skip=SKIP + ('arm-b',))
        x0, y0 = W(P)
        spark(f, x0 + 2, y0, (255, 248, 200))
    F = ['...', 'p..', '...', '...', '...', 'ddd']
    return pants(KHAKI, F, F, {'p': '#a8884a', 'd': '#a8884a'}, waist='#8a6a3a', extra=cart)


def sunrise_sarong():
    def c(i, k, w, rows):
        mid = w / 2
        d = math.hypot(i - mid, (k - rows + 0.5) * 1.3)
        if d < 2.3 and k >= rows - 2:
            return ('#fff070', 4 if d < 1.2 else 3)
        if k == rows - 1:
            return ('#ff7a1a', 2)
        if d < 3.6 and k >= rows - 3 and (i % 2 == 0):
            return ('#ffd23c', 3)
        return ['#ff7aa8', '#ff8a8a', '#ff9a5a', '#ff8a2a', '#ff7a1a'][min(k, 4)]
    return wrap('#ff7aa8', c, rows=5, flare=0.5)


def grass_hakama():
    def c(i, k, w, rows):
        if k == 0:
            return ('#f4f0e8', 3)
        if k == rows - 1:
            return ('#9ae04a', 4) if i % 2 else ('#4ab84a', 2)
        return '#2a7a3a' if i % 3 == 2 else '#3aa04a'

    def blades(f, P):
        x0, y0 = W(P)
        sway = 1 if wind(P) > 0.5 else 0
        for dx in (0, 2, 4, 6, 8, 10):
            px(f, x0 + dx + sway, y0 + 5, '#9ae04a', 3, 'grass', skip=SKIP + ('leg',))
    return wrap('#3aa04a', c, rows=5, flare=0.9, more=(blades,))


def validator_uptime_kilt():
    def c(i, k, w, rows):
        if k == 0:
            return ('#5a5a70', 3)
        if i % 3 == 1 and k in (1, 3):
            return ('#5af06a', 4)
        if i % 3 == 2 and k == 2:
            return ('#ffb23a', 3)
        if k == 4:
            return ('#6a6a84', 3) if i % 2 else ('#4a4a60', 1)
        return ('#4a4a60', 3 if i == 0 else 2) if k % 2 else ('#3a3a50', 2)

    def glowl(f, P):
        x0, y0 = W(P)
        spark(f, x0 + 11, y0 + 1, (120, 255, 140))
    return wrap('#3a3a50', c, rows=5, flare=0.6, legs=SKIN, more=(glowl,))


def whale_splash_trunks():
    F = ['...', '...', '...', 'w.w', '...', '...']

    def spout(f, P):
        x0, y0 = W(P)
        for (dx, dy, c, a) in ((1, -1, (140, 220, 255), 255), (1, -2, (200, 240, 255), 255),
                               (0, -3, (140, 220, 255), 230), (2, -3, (140, 220, 255), 230),
                               (-1, -3, (200, 240, 255), 180), (3, -2, (200, 240, 255), 180),
                               (-1, -1, (140, 220, 255), 150), (1, -4, (255, 255, 255), 255)):
            glow(f, x0 + dx, y0 + dy, c, a)
        stamp(f, P, ['ww'], {'w': ('#f4f8ff', 3)}, 1, 0)
    return pants(NAVY, F, F, {'w': '#ffffff'}, length=2.8, waist='#1e2850', extra=spout)


# =================================================================== LEGENDARY
def token_burn_trousers():
    def fn(gx, gy, s, lx, ly):
        if gy == 4:
            return '#ffd23c' if gx != 1 else '#ff7a1a'
        if gy == 3:
            return '#ff7a1a' if gx != 1 else '#ffd23c'
        if gy == 2 and gx == 1:
            return '#e8402a'

    def fire(f, P):
        x0, y0 = W(P)
        for y in (y0 + 2, y0 + 3, y0 + 4):
            e = leg_extent(f, y)
            if not e:
                continue
            under(f, e[0] - 1, y, '#ff8a24' if y != y0 + 2 else '#ffd23c', 3, 'fire')
            under(f, e[1] + 1, y, '#ff6a1a' if y != y0 + 2 else '#ffd23c', 2, 'fire')
        for (dx, dy, c) in ((-2, 0, (255, 200, 60)), (-3, -2, (255, 140, 40)), (12, 0, (255, 200, 60)),
                            (11, -2, (255, 120, 40)), (-1, -4, (255, 230, 120)), (13, -3, (255, 230, 120))):
            spark(f, x0 + dx, y0 + dy, c)
        halo(f, x0 + 5, y0 + 4, (255, 120, 30), 6.0, 90)
    return pants('#3a3440', fn=fn, waist='#2a2430', extra=[belt('#1e1a22', '#ff8a24'), fire])


def diamond_leg_armour():
    def fn(gx, gy, s, lx, ly):
        k = (gx + gy) % 3
        if s == 'f' and gx == 1 and gy == 2:
            return '#ffffff'
        return ['#7ae8ff', '#3aa8f0', '#c8f8ff'][k]

    def sparkle(f, P):
        x0, y0 = W(P)
        for y in (y0 + 2,):
            e = leg_extent(f, y)
            if e:
                under(f, e[1] + 1, y, '#c8f8ff', 4, 'spike')
        for (dx, dy, b) in ((-2, 1, True), (-4, 3, False), (-1, 4, False), (-5, 0, False), (12, 3, True),
                            (11, 0, False)):
            spark(f, x0 + dx, y0 + dy, (220, 250, 255), big=b)
        halo(f, x0 + 5, y0 + 3, (110, 220, 255), 6.0, 70)
    return pants('#7ae8ff', fn=fn, waist='#3a78c8', extra=[belt('#2a4a8a', '#ffffff'), sparkle])


def live_chart_leggings():
    F = ['.g.', 'g..', '.g.', '..g', '.g.', 'g..']
    B = ['...', '...', '...', 'g.g', '.g.', '...']

    def chart(f, P):
        band(f, P, lambda i, r: '#7aff8a' if (r == (i // 2) % 2) else None)
        x0, y0 = W(P)
        for (dx, top, bot) in ((-4, 2, 4), (-2, 1, 3), (12, -1, 1), (14, -3, 0)):
            for y in range(top, bot + 1):
                glow(f, x0 + dx, y0 + y, (90, 255, 120), 220)
            glow(f, x0 + dx, y0 + top - 1, (90, 255, 120), 110)
        halo(f, x0 + 5, y0 + 3, (80, 255, 110), 5.5, 70)
    return pants('#16141e', F, B, {'g': '#7aff8a'}, waist='#16141e', extra=chart)


def jack_o_lantern_kilt():
    def c(i, k, w, rows):
        if k == 0:
            return ('#3a8a2a', 3 if i % 2 else 2)
        m = w // 2 + 1
        if k == 1 and i in (m - 3, m - 2, m + 2, m + 3):
            return ('#fff07a', 4)
        if k == 2 and i in (m - 2, m + 2):
            return ('#ffd23c', 3)
        if k == 3 and abs(i - m) <= 3:
            return ('#2a1a10', 0) if (i - m) % 2 else ('#ffd23c', 4)
        if k == 4:
            return ('#c85a10', 1) if i % 2 else ('#ff8a1c', 2)
        return ('#e8701a', 2) if i % 3 == 0 else ('#ff8a1c', 3 if i < 2 else 2)

    def bats(f, P):
        x0, y0 = W(P)
        for (bx, by) in ((-4, -2), (13, -4)):
            for (dx, dy) in ((0, 0), (-1, -1), (1, -1), (-2, -1), (2, -1), (-2, 0), (2, 0)):
                glow(f, x0 + bx + dx, y0 + by + dy, (110, 60, 150), 255)
            glow(f, x0 + bx, y0 + by - 1, (255, 90, 60), 255)
        halo(f, x0 + 5, y0 + 2, (255, 180, 40), 6.5, 80)
        stamp(f, P, ['vv.', '..v'], {'v': ('#3a8a2a', 2)}, -2, -1, behind=True)
    return wrap('#ff8a1c', c, rows=5, flare=0.9, legs=SKIN, more=(bats,))


def nugget_heist_pants():
    def mole(f, P):
        x0, y0 = W(P)
        rows = ['..yyy..', '.yYyyy.', 'pkmmmm.', '.mmmmm.', 'Ghmmm..', '.kkkk..']
        leg = {'y': ('#ffd23c', 3), 'Y': ('#fff4a0', 4), 'm': ('#9a6a44', 2), 'k': ('#1a2a5a', 1),
               'p': ('#ff8aa0', 3), 'h': ('#f0b888', 3), 'G': ('#ffd23c', 4)}
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != '.':
                    col, t = leg[ch]
                    px(f, x0 - 4 + i, y0 - 4 + j, col, t, 'mole', skip=('arm-f', 'head'))
        px(f, x0 - 4, y0 - 2, '#1a1418', 2, 'mole', skip=('arm-f', 'head'))
        spark(f, x0 - 5, y0, (255, 250, 200), big=True)
        halo(f, x0 - 4, y0, (255, 220, 90), 2.6, 110)
    return pants('#3a7ae0', ['...', '...', '...', '...', '...', 'ddd'], 'same', {'d': '#2a5ab0'},
                 waist='#2a5ab0', extra=[belt('#3a2a20', GOLD), mole])


def motherlode_drip_jeans():
    F = ['g.g', 'g..', 'G.g', '..g', '.gG', 'ggg']
    B = ['...', '...', '...', 'g..', 'G.g', 'ggg']

    def pool(f, P):
        x0, y0 = W(P)
        e = leg_extent(f, y0 + 3) or (x0 + 1, x0 + 6)
        fy = 25 - kit.OY + kit.OY  # ground row in rig coords
        a, b = P['feet'][1][0] - 1, P['feet'][1][0] + 4
        for x in range(a, b + 1):
            if f.get(x, 26) is None:
                f.put(x, 26, ramp(GOLD), 3 if x < a + 2 else 2, 'pool')
        for x in (a - 1, b + 1):
            under(f, x, 26, '#c88a20', 1, 'pool')
        under(f, e[1] + 1, y0 + 3, GOLD, 3, 'drip')
        for (x, y, b2) in ((a + 1, 25, True), (b - 1, 25, False), (x0 - 2, y0 + 2, False), (x0 + 12, y0 + 1, True)):
            spark(f, x, y, (255, 250, 210), big=b2)
        halo(f, (a + b) / 2, 26, (255, 210, 80), 4.5, 90)
    return pants('#243a7a', F, B, {'g': '#ffc83a', 'G': '#fff4a0'}, waist='#1a2a5a',
                 extra=[belt('#ffc83a'), pool])


def priority_fee_jetpants():
    F = ['...', '...', '...', '...', 'ggg', 'GGG']

    def jets(f, P):
        x0, y0 = W(P)
        for side in (0, 1):
            ax, ay = P['feet'][side]
            for (dx, dy, c) in ((-1, 0, '#ffd23c'), (-2, 0, '#ff8a24'), (-2, 1, '#ff8a24')):
                pass
            # cuff flare
            under(f, ax - 2, ay - 2, GOLD, 3, 'cuff')
            for (dx, dy, c, a) in ((-3, -1, (255, 240, 140), 255), (-4, -1, (255, 160, 40), 230),
                                   (-5, -1, (255, 110, 30), 160), (-4, 0, (255, 160, 40), 140),
                                   (-6, -1, (255, 90, 20), 80)):
                glow(f, ax + dx, ay + dy, c, a)
        for (dx, dy, cc) in ((-4, 1, '#ffd23c'), (-6, -2, '#ffd23c')):
            px(f, x0 + dx, y0 + dy, cc, 3, 'coin')
            spark(f, x0 + dx - 1, y0 + dy - 1, (255, 250, 210))
        halo(f, x0 - 1, y0 + 4, (255, 180, 60), 4.0, 70)
    return pants('#f4f2ec', F, F, {'g': GOLD, 'G': '#fff4a0'}, waist='#d8d4e0',
                 extra=[belt(GOLD, '#ffffff'), jets])


def eternal_summer_sarong():
    def c(i, k, w, rows):
        m = w / 2
        d = math.hypot(i - m, (k - 2.4) * 1.2)
        if k == rows - 1:
            return ('#ffd23c', 3 if i % 2 else 2)
        if d < 1.3:
            return ('#fffbd0', 4)
        if d < 2.3:
            return ('#ffd23c', 3)
        if k == 0:
            return ('#f6bc36', 3)
        return ['#9a4ae8', '#9a4ae8', '#7a64e0', '#4a96d4', '#2ec4b0'][min(k, 4)]

    def shimmer(f, P):
        x0, y0 = W(P)
        for (dx, dy, a) in ((0, 5, 110), (2, 6, 90), (5, 5, 110), (7, 6, 90), (9, 5, 110), (-1, 3, 80),
                            (11, 3, 80), (3, 7, 60), (8, 7, 60)):
            glow(f, x0 + dx, y0 + dy, (255, 220, 140), a)
        halo(f, x0 + 5, y0 + 2.5, (255, 220, 90), 6.5, 90)
        spark(f, x0 + 12, y0 + 1, (255, 250, 210), big=True)
    return wrap('#9a4ae8', c, rows=5, flare=0.7, more=(shimmer,))


def leviathan_tide_kilt():
    def c(i, k, w, rows):
        if k == 0:
            return ('#f6bc36', 3 if i % 3 else 4)
        if k == rows - 1:
            return ('#f4fbff', 4) if i % 3 == 0 else ('#5ae0f0', 3) if i % 3 == 1 else ('#2a7ad8', 3)
        if k == rows - 2:
            return ('#5ae0f0', 3) if i % 3 == 2 else ('#1e4aa8', 2)
        return ('#3a7ae0', 3) if (i + k) % 2 == 0 else ('#1e3a8a', 2)

    def spray(f, P):
        x0, y0 = W(P)
        for (dx, dy, cc, a) in ((-1, -1, (180, 230, 255), 255), (-2, -2, (220, 245, 255), 255),
                                (-2, -3, (140, 210, 255), 230), (-3, -4, (255, 255, 255), 255),
                                (-1, -4, (180, 230, 255), 200), (-4, -2, (180, 230, 255), 180),
                                (-4, -5, (220, 245, 255), 160), (0, -3, (220, 245, 255), 140),
                                (12, 4, (180, 230, 255), 200), (13, 3, (255, 255, 255), 255)):
            glow(f, x0 + dx, y0 + dy, cc, a)
        stamp(f, P, ['p'], {'p': ('#f4f0ff', 4)}, 7, 0)
        halo(f, x0 + 5, y0 + 4, (80, 180, 255), 6.5, 80)
    return wrap('#1e3a8a', c, rows=5, flare=0.9, legs=SKIN, more=(spray,))


# =================================================================== ITEMS
ITEMS = [
    ('G187', 'Airdrop Cargo Shorts', 'Common', airdrop_cargo_shorts),
    ('G188', 'Anon Dev Sweats', 'Common', anon_dev_sweats),
    ('G189', 'Expired Hash Shorts', 'Common', expired_hash_shorts),
    ('G190', 'Burnt Hem Jeans', 'Common', burnt_hem_jeans),
    ('G191', 'Cave Run Knee Pads', 'Common', cave_run_knee_pads),
    ('G192', 'Compressed Shorts', 'Common', compressed_shorts),
    ('G193', 'Broom Pocket Trousers', 'Common', broom_pocket_trousers),
    ('G194', 'GM Pajama Pants', 'Common', gm_pajama_pants),
    ('G195', 'Green Candle Joggers', 'Common', green_candle_joggers),
    ('G196', 'Hat Dog Joggers', 'Common', hat_dog_joggers),
    ('G197', 'Hopium Pajamas', 'Common', hopium_pajamas),
    ('G198', 'Island Board Shorts', 'Common', island_board_shorts),
    ('G199', 'Jeet Runner Shorts', 'Common', jeet_runner_shorts),
    ('G200', 'Frozen Chain Joggers', 'Common', frozen_chain_joggers),
    ('G201', 'Night Shift Sweats', 'Common', night_shift_sweats),
    ('G202', 'Kain Pelikat Sarong', 'Common', kain_pelikat_sarong),
    ('G203', 'Paper Bag Shorts', 'Common', paper_bag_shorts),
    ('G204', 'Priority Fee Trackies', 'Common', priority_fee_trackies),
    ('G205', 'Red Candle Sweats', 'Common', red_candle_sweats),
    ('G206', 'Rent Exempt Shorts', 'Common', rent_exempt_shorts),
    ('G207', 'Ser Slacks', 'Common', ser_slacks),
    ('G208', 'Shrimp Shorts', 'Common', shrimp_shorts),
    ('G209', 'Sniper Camo Pants', 'Common', sniper_camo_pants),
    ('G210', 'Solana Summer Shorts', 'Common', solana_summer_shorts),
    ('G211', 'Arcade Token Shorts', 'Common', arcade_token_shorts),
    ('G212', 'Blue Miner Jeans', 'Common', blue_miner_jeans),
    ('G213', 'Brawl Gym Shorts', 'Common', brawl_gym_shorts),
    ('G214', 'Copium Sweatshorts', 'Common', copium_sweatshorts),
    ('G215', 'Down Bad Trackies', 'Common', down_bad_trackies),
    ('G216', 'Khaki Work Pants', 'Common', khaki_work_pants),
    ('G217', 'Lily Pad Shorts', 'Common', lily_pad_shorts),
    ('G218', 'Lobby Lounge Pants', 'Common', lobby_lounge_pants),
    ('G219', 'Monke Banana Shorts', 'Common', monke_banana_shorts),
    ('G220', 'Pumpkin Patch Pants', 'Common', pumpkin_patch_pants),
    ('G221', 'Touch Grass Shorts', 'Common', touch_grass_shorts),
    ('G222', 'WAGMI Track Pants', 'Common', wagmi_track_pants),
    ('G223', 'Whale Tail Trunks', 'Common', whale_tail_trunks),
    ('G224', '400ms Sprint Shorts', 'Uncommon', sprint_shorts_400ms),
    ('G225', 'Airdrop Mega Cargos', 'Uncommon', airdrop_mega_cargos),
    ('G226', 'Bonding Curve Leggings', 'Uncommon', bonding_curve_leggings),
    ('G227', 'Breakpoint Tour Chinos', 'Uncommon', breakpoint_tour_chinos),
    ('G228', 'Clan Banner Kilt', 'Uncommon', clan_banner_kilt),
    ('G229', 'Diamond Stud Jeans', 'Uncommon', diamond_stud_jeans),
    ('G230', 'Galaxy Brain Leggings', 'Uncommon', galaxy_brain_leggings),
    ('G231', 'Skeleton Print Pants', 'Uncommon', skeleton_print_pants),
    ('G232', 'Liquidated Sweats', 'Uncommon', liquidated_sweats),
    ('G233', 'Nugget Patch Shorts', 'Uncommon', nugget_patch_shorts),
    ('G234', 'Mint Day Bot Pants', 'Uncommon', mint_day_bot_pants),
    ('G235', 'Monke Tail Trousers', 'Uncommon', monke_tail_trousers),
    ('G236', 'Motherlode Pocket Pants', 'Uncommon', motherlode_pocket_pants),
    ('G237', 'Halt Barrier Pants', 'Uncommon', halt_barrier_pants),
    ('G238', 'Batik Sarong', 'Uncommon', batik_sarong),
    ('G239', 'Refinery Work Pants', 'Uncommon', refinery_work_pants),
    ('G240', 'Probably Nothing Slacks', 'Uncommon', probably_nothing_slacks),
    ('G241', 'Rug Pull Rug Shorts', 'Uncommon', rug_pull_rug_shorts),
    ('G242', 'Seeker Squad Cargos', 'Uncommon', seeker_squad_cargos),
    ('G243', 'Frog Pond Waders', 'Uncommon', frog_pond_waders),
    ('G244', 'Lantern Belt Trousers', 'Uncommon', lantern_belt_trousers),
    ('G245', 'Origami Paper Skirt', 'Uncommon', origami_paper_skirt),
    ('G246', 'Shrimp Cocktail Skirt', 'Uncommon', shrimp_cocktail_skirt),
    ('G247', 'Wau Kite Shorts', 'Uncommon', wau_kite_shorts),
    ('G248', 'This Is Fine Jeans', 'Uncommon', this_is_fine_jeans),
    ('G249', 'Validator Rack Shorts', 'Uncommon', validator_rack_shorts),
    ('G250', 'Whale Wetsuit Bottoms', 'Uncommon', whale_wetsuit_bottoms),
    ('G251', 'Crash Cart Racers', 'Rare', crash_cart_racers),
    ('G252', 'KO Champion Greaves', 'Rare', ko_champion_greaves),
    ('G253', 'Diamond Plate Greaves', 'Rare', diamond_plate_greaves),
    ('G254', 'Pump Wick Trousers', 'Rare', pump_wick_trousers),
    ('G255', 'Lighthouse Stripe Pants', 'Rare', lighthouse_stripe_pants),
    ('G256', 'Margin Call Greaves', 'Rare', margin_call_greaves),
    ('G257', 'Mole King Pantaloons', 'Rare', mole_king_pantaloons),
    ('G258', 'Old Glow Lantern Belt', 'Rare', old_glow_lantern_belt),
    ('G259', 'Songket Sampin', 'Rare', songket_sampin),
    ('G260', 'Red Wick Drip Pants', 'Rare', red_wick_drip_pants),
    ('G261', 'Tearaway Track Pants', 'Rare', tearaway_track_pants),
    ('G262', 'Sniper Bot Ghillie', 'Rare', sniper_bot_ghillie),
    ('G263', 'Ghost Hem Pants', 'Rare', ghost_hem_pants),
    ('G264', 'Hopium Cloud Pants', 'Rare', hopium_cloud_pants),
    ('G265', 'Mine Cart Cargos', 'Rare', mine_cart_cargos),
    ('G266', 'Sunrise Sarong', 'Rare', sunrise_sarong),
    ('G267', 'Grass Hakama', 'Rare', grass_hakama),
    ('G268', 'Validator Uptime Kilt', 'Rare', validator_uptime_kilt),
    ('G269', 'Whale Splash Trunks', 'Rare', whale_splash_trunks),
    ('G270', 'Token Burn Trousers', 'Legendary', token_burn_trousers),
    ('G271', 'Diamond Leg Armour', 'Legendary', diamond_leg_armour),
    ('G272', 'Live Chart Leggings', 'Legendary', live_chart_leggings),
    ('G273', 'Jack O Lantern Kilt', 'Legendary', jack_o_lantern_kilt),
    ('G274', 'Nugget Heist Pants', 'Legendary', nugget_heist_pants),
    ('G275', 'Motherlode Drip Jeans', 'Legendary', motherlode_drip_jeans),
    ('G276', 'Priority Fee Jetpants', 'Legendary', priority_fee_jetpants),
    ('G277', 'Eternal Summer Sarong', 'Legendary', eternal_summer_sarong),
    ('G278', 'Leviathan Tide Kilt', 'Legendary', leviathan_tide_kilt),
]

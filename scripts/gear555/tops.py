"""Gali Gear 555, top slot: 93 shirts, tees, hoodies, vests, jackets, robes,
armour and capes, drawn on the miner rig via kit.Top.

Torso local coords: lx 0..10 back to chest, ly 0..7 top to bottom. In the idle
pose the front arm covers lx 3..5 and the hand lx 6..7 on ly 3..4, the beard
covers ly 0..1, so chest prints live at lx 7..10, ly 2..5 and patterns also
run over the back (lx 0..2) and the hem (ly 5..7).
"""
import math

import kit
from kit import Top, ramp

SLOT = 'top'

# ---------------------------------------------------------------- palette
WHITE = '#f4f0e8'
CREAM = '#efe4c8'
INKC = '#2a2232'
BLACK = '#2c2632'
CHAR = '#3e3a48'
GREY = '#8c8a9a'
LGREY = '#b8b6c4'
NAVY = '#26346e'
RED = '#e0383a'
ORANGE = '#ff8a24'
YELLOW = '#ffd23c'
GOLD = '#f6bc36'
LIME = '#9ae04a'
GREEN = '#3cc85a'
TEAL = '#2ec4b0'
CYAN = '#5ee0f0'
PURPLE = '#8a4ae0'
PINK = '#ff7aa8'
BROWN = '#8a5a34'
TAN = '#d8b484'
SKY = '#5ab8f0'
SINGLET = '#dcdae0'


# ---------------------------------------------------------------- helpers
def singlet(lx, ly):
    """Where the rig paints its white singlet (the strap column lx 2 is overalls)."""
    return (ly <= 2 and lx < 5 and lx != 2) or (ly <= 1 and lx >= 5)


def grid(rows, ox, oy, legend):
    d = {}
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch not in ' .':
                d[(ox + i, oy + j)] = legend[ch]
    return d


def T0(P):
    bx, by = P['body']
    sq = P.get('squash', 0)
    return int(round(9.4 + bx)) - 4, int(round(16.8 + by + sq * 0.5)) - 4 + sq


def HEAD0(P):
    bx, by = P['body']
    sq = P.get('squash', 0)
    return 4 + bx + P['head'][0], 3 + by + P['head'][1] + sq


def wind(P):
    """0 idle .. ~1 mid stride; used for flutter."""
    a, b = P['feet']
    return max(0.0, (abs(a[0] - b[0]) - 3) / 4.0)


def under(f, x, y, col, tone, part='cape'):
    """Paint only where nothing is drawn yet (stays behind back arm and leg)."""
    if f.get(x, y) is None:
        f.put(x, y, ramp(col), tone, part)


def over(f, x, y, col, tone, part='gear', skip=('head',)):
    p = f.get(x, y)
    if p and any(p[3].startswith(s) for s in skip):
        return
    f.put(x, y, ramp(col), tone, part)


def glow(f, x, y, rgb, a):
    f.extra.append((x + kit.OX, y + kit.OY, (*rgb, a)))


def hexrgb(h):
    return kit.hexrgb(h)


def make(base, prints=None, sleeve=0.0, sleeve_col=None, cuff=None, fn=None,
         open_front=None, back=None, front=None):
    """base: '#hex' or callable(lx, ly, tone). prints: {(lx, ly): colour}.
    fn(lx, ly, tone) -> colour, or False to fall through. open_front: colour of the
    shirt underneath for open jackets/vests (None keeps the rig singlet)."""
    prints = prints or {}

    def colour(lx, ly, tone):
        if fn:
            r = fn(lx, ly, tone)
            if r is not False:
                return r
        if (lx, ly) in prints:
            return prints[(lx, ly)]
        if open_front is not None and open_front is not False:
            if open_front(lx, ly) if callable(open_front) else False:
                return SINGLET
        return base(lx, ly, tone) if callable(base) else base

    sc = sleeve_col if sleeve_col is not None else (base if not callable(base) else None)

    def scol(t, tone):
        if cuff and t > 0.78:
            return cuff
        if callable(sc):
            return sc(t, tone)
        return sc if sc else base(5, 2, tone)
    return Top(colour, sleeve=sleeve, sleeve_colour=scol, back=back, front=front)


def vest_open(lx, ly):
    """Open-front V: singlet at the neck and down the chest edge."""
    return (ly <= 1 and lx >= 4) or (ly == 2 and 3 <= lx <= 4) or (ly <= 2 and lx in (0, 1))


def tee(base, prints=None, sleeve=2.6, **kw):
    return make(base, prints, sleeve=sleeve, **kw)


def hood_down(col, tone_bias=0):
    """Hood bunched behind the neck: a rounded lump past the back of the head."""
    def back(f, P):
        x0, y0 = T0(P)
        R = ramp(col)
        cells = [(-2, -3, 3), (-1, -3, 3), (-2, -2, 2), (-1, -2, 3), (-3, -1, 2), (-2, -1, 2), (-1, -1, 2),
                 (-3, 0, 1), (-2, 0, 1), (-1, 0, 2), (-2, 1, 1), (-1, 1, 1), (0, -1, 2), (0, -2, 2), (0, -3, 2)]
        for dx, dy, t in cells:
            f.put(x0 + dx, y0 + dy, R, max(0, t + tone_bias), 'hood')
        f.put(x0 - 1, y0 - 1, R, 0, 'hood')   # inner fold
    return back


def strings(col='#e8e4dc'):
    def p(lx, ly, tone):
        if (lx, ly) in ((6, 2), (8, 2), (8, 3)):
            return col
        return False
    return p


def check(c1, c2, c3, step=3):
    """Flannel check: base c1, stripe c2, crossing c3."""
    def b(lx, ly, tone):
        a, bb = lx % step == 1, ly % step == 1
        return c3 if a and bb else c2 if a or bb else c1
    return b


def cape_back(colfn, length=10, spread=0.45, top=0, flutter=1.0, part='cape', ragged=None):
    """Cape hanging from the back of the shoulders, flaring left. colfn(i, k, edge) -> (colour, tone)
    with i columns from the body edge (0 = at the back), k rows down."""
    def back(f, P):
        x0, y0 = T0(P)
        w = wind(P) * flutter
        for k in range(length + 1):
            y = y0 + top + k
            reach = 1 + int(k * (spread + 0.25 * w)) + (1 if k > 2 else 0)
            if ragged and ragged(k, reach):
                pass
            for i in range(0, reach + 1):
                x = x0 + 1 - i
                if ragged and k == length and ragged(i, 0):
                    continue
                c, t = colfn(i, k, i == reach)
                under(f, x, y, c, t, part)
        # pin at the shoulder
    return back


def plain_cape(col, line=None):
    def colfn(i, k, edge):
        if edge:
            return col, 1
        if line and k in line:
            return line[k], 2
        return col, 2 if (i + k // 3) % 3 else 3
    return colfn


def pad(f, P, col, hi=None, w=4):
    """Shoulder pad over the back shoulder (top-left of the torso)."""
    x0, y0 = T0(P)
    R = ramp(col)
    cells = [(-1, 0, 3), (0, -1, 4), (1, -1, 4), (2, -1, 3), (-1, 1, 2), (0, 0, 3), (1, 0, 3), (2, 0, 2),
             (3, 0, 1), (-1, 2, 1), (0, 1, 2), (1, 1, 2), (2, 1, 1), (0, 2, 0), (1, 2, 1)]
    for dx, dy, t in cells:
        over(f, x0 + dx, y0 + dy, col, t, 'pad')
    if hi:
        over(f, x0 + 1, y0 - 1, hi, 4, 'pad')


def skirt(f, P, colfn, rows=3, start=7):
    """Robe or coat skirt drawn over the upper legs. colfn(i, k, edge)->(col, tone)."""
    x0, y0 = T0(P)
    w = wind(P)
    for k in range(rows):
        y = y0 + start + k
        a = 1 - int(k * (0.5 + 0.3 * w))
        b = 9 + int(k * (0.4 + 0.3 * w))
        for x in range(x0 + a, x0 + b + 1):
            i = x - x0
            p = f.get(x, y)
            if p and p[3].startswith('arm-f'):
                continue
            c, t = colfn(i, k, x in (x0 + a, x0 + b))
            f.put(x, y, ramp(c), t, 'skirt')


# shared glyphs ----------------------------------------------------------------
def candle(col, x, y0, y1, wick=True):
    d = {}
    for y in range(y0, y1 + 1):
        d[(x, y)] = col
        d[(x + 1, y)] = col
    if wick:
        d[(x, y0 - 1)] = col
    return d


# ================================================================= COMMON
def blue_overalls():
    """The stock look: overalls, white singlet kept."""
    return make(lambda lx, ly, t: None if singlet(lx, ly) else '#2f5fd0')


def hazard_vest():
    def b(lx, ly, tone):
        if ly in (3, 5):
            return '#e8ecef'
        if lx in (3, 4) and ly < 3:
            return None
        if singlet(lx, ly) and ly <= 1:
            return None
        return '#ff7a1a'
    return make(b)


def khaki_overalls():
    def b(lx, ly, t):
        if singlet(lx, ly):
            return None
        if lx == 2 and ly <= 2:
            return '#a08a5a'   # strap
        if (lx, ly) == (7, 3):
            return '#c89a3a'   # button
        return '#c8b07a'
    return make(b)


def tee_400ms():
    G = '#3cdc6a'
    pr = grid(['g.g',
               'ggg',
               '..g'], 8, 2, {'g': G})
    pr.update({(6, 5): G, (7, 5): G, (8, 5): G, (9, 5): G, (10, 5): G})   # "00ms" bar under it
    pr.update({(0, 3): G, (1, 3): G, (0, 4): G, (1, 5): G})
    return tee(WHITE, pr)


def airdrop_flannel():
    def b(lx, ly, t):
        if (lx, ly) == (8, 3) or (lx, ly) == (8, 5):
            return '#e8d8a8'   # buttons
        return False
    return make(check('#4e9a3e', '#c8a46a', '#2e5a2a'), fn=b, sleeve=3.6,
                sleeve_col=lambda t, tone: '#c8a46a' if t > 0.7 else '#4e9a3e')


def devs_do_something():
    R = '#d8282a'
    pr = grid(['rr.r',
               '....',
               'r.rr',
               '....'], 7, 2, {'r': R})
    pr.update({(0, 3): R, (1, 3): R, (0, 5): R, (2, 5): R, (8, 4): R, (9, 4): R, (10, 4): R, (7, 6): R, (8, 6): R})
    return tee(WHITE, pr)


def arcade_coin():
    Y, D, H = '#ffd23c', '#c88a1a', '#fff6b0'
    pr = grid(['.yy.',
               'yhDy',
               'yDDy',
               '.yy.'], 7, 2, {'y': Y, 'D': D, 'h': H})
    return tee('#7a3ad0', pr)


def brawl_jersey():
    W = WHITE
    pr = grid(['ww.ww',
               'w.ww.',
               'w.ww.',
               'ww.ww'], 6, 2, {'w': W})
    # mesh shoulder stripe and white trim
    def f(lx, ly, t):
        if ly == 7:
            return W
        return False
    return make(RED, pr, sleeve=2.6, fn=f, cuff=W)


def burn_tee():
    O, Y, R = '#ff7a1a', '#ffd23c', '#e0382a'

    def f(lx, ly, t):
        h = [2, 3, 1, 3, 2, 4, 2, 3, 1, 3, 2][lx % 11]
        depth = 7 - ly
        if depth < h - 1:
            return Y if depth == 0 and lx % 2 else O
        if depth == h - 1:
            return R
        return False
    return tee(BLACK, fn=f, sleeve_col=BLACK, cuff=O)


def cave_run_hoodie():
    O, Y = '#ff8a24', '#ffe07a'
    pr = grid(['.o.',
               'oYo',
               'oYo',
               '.o.'], 8, 2, {'o': O, 'Y': Y})
    pr.update({(7, 6): '#2c2834', (8, 6): '#2c2834', (9, 6): '#2c2834'})   # pocket seam
    return make('#4a4654', pr, sleeve=7, fn=strings('#a8a4b0'), back=hood_down('#4a4654'),
                cuff='#3a3644')


def compressed_tee():
    G = '#9a98a8'

    def f(lx, ly, t):
        if ly >= 4:            # shrunk: belly sticks out under it
            return 'skin'
        if (lx, ly) in ((8, 2), (9, 2), (8, 3), (9, 3)):
            return '#4a4658'
        return False
    t = tee(G, fn=f, sleeve=1.6)
    orig = t.colour

    def colour(lx, ly, tone):
        r = orig(lx, ly, tone)
        return r
    return t


def diamond_hands():
    C, D, H = '#5ee0f0', '#2a98c0', '#e8fcff'
    pr = grid(['.cc.',
               'cHcc',
               'Dccd',
               '.DD.'], 7, 2, {'c': C, 'D': D, 'd': D, 'H': H})
    pr.update(grid(['.c.', 'cHc', '.D.'], 0, 3, {'c': C, 'H': H, 'D': D}))
    return tee(WHITE, pr)


def floor_sweeper_smock():
    G = '#8e9098'
    pr = grid(['p...',
               '.p..',
               'bbb.',
               'bbb.'], 7, 2, {'p': '#c89a5a', 'b': '#f0c84a'})
    pr.update({(7, 4): '#6a6c74', (8, 6): '#6a6c74', (9, 6): '#6a6c74'})
    return make(G, pr, sleeve=4.2, sleeve_col=G, fn=lambda lx, ly, t: '#6a6c74' if lx == 10 and ly >= 2 else False)


def frog_face_tee():
    L, G, W, K, M = '#b8f060', '#3cb83a', WHITE, INKC, '#d04a5a'
    pr = grid(['gw.gw',
               'gggGg',
               'gmmmg',
               '.ggg.'], 6, 2, {'g': G, 'G': G, 'w': W, 'm': K})
    pr[(7, 2)] = K
    pr[(10, 2)] = K
    return tee(L, pr)


def gm_tee():
    K = '#2a2430'
    pr = grid(['kk.kkk',
               'kk.kkk',
               '.k.k.k'], 5, 2, {'k': K})
    pr.update({(0, 3): K, (1, 3): K, (1, 4): K})
    return tee(WHITE, pr)


def gn_tee():
    Y, M = '#ffd84a', '#fff0a0'
    pr = {(8, 2): Y, (9, 2): M, (8, 3): Y, (9, 3): Y, (9, 4): Y, (10, 5): Y, (9, 5): Y, (8, 5): M}
    pr.update({(0, 3): Y, (1, 3): Y, (0, 4): Y, (1, 4): Y, (1, 5): Y, (0, 5): Y, (2, 4): Y, (2, 5): Y})
    pr.update({(6, 2): M, (7, 6): M, (2, 7): M})   # stars
    return tee('#22306a', pr)


def green_candle_tee():
    G, H = '#3ce06a', '#b0ffc0'
    pr = {}
    for y in range(1, 8):
        pr[(9, y)] = G
        pr[(8, y)] = G if y >= 2 else BLACK
    pr[(8, 2)] = H
    pr[(9, 0)] = G
    return tee(BLACK, pr)


def hat_dog_tee():
    P, D, K, T = '#ff8ac0', '#c88a4a', INKC, '#f0c890'
    pr = {(7, 2): P, (8, 2): '#ffd0e4', (9, 2): P, (6, 2): '#ffd0e4', (8, 3): D, (9, 3): K, (10, 3): D,
          (9, 4): D, (10, 4): T, (8, 5): D, (9, 5): T, (10, 5): K, (7, 5): D}
    pr.update({(0, 3): D, (1, 3): D, (0, 2): P, (1, 2): P, (1, 4): K})
    return tee('#ff8a2a', pr)


def wen_token_hoodie():
    W = WHITE
    pr = {(8, 2): W, (9, 2): W, (10, 3): W, (9, 4): W, (9, 6): W, (8, 3): '#b4b2c0'}
    pr.update({(0, 3): W, (1, 3): W, (0, 5): W})
    return make('#9a98a6', pr, sleeve=7, fn=strings(), back=hood_down('#9a98a6'), cuff='#7a7886')


def palm_tank():
    W, Wd = WHITE, '#d8e8f0'
    pr = grid(['w.w.w',
               '.www.',
               '..w..',
               '..w..',
               '..w..'], 6, 1, {'w': W})

    def f(lx, ly, t):
        if singlet(lx, ly) and ly <= 1 and lx < 4:
            return 'skin'
        return False
    return make(SKY, pr, fn=f)


def jeet_windbreaker():
    Y, Z = '#ffe04a', '#8a8a96'

    def f(lx, ly, t):
        if lx == 8 and ly >= 1:
            return Z
        if ly == 7 or (ly == 4 and lx < 3):
            return '#e0b820'
        return False
    return make(Y, fn=f, sleeve=7, cuff='#e0b820')


def afk_tee():
    W, K = WHITE, '#2a6a6a'
    pr = grid(['wwww',
               'wkkw',
               'wwww',
               'w...'], 7, 2, {'w': W, 'k': K})
    pr[(10, 3)] = W
    return tee('#2ab0a8', pr)


def monke_tee():
    T, K, P = '#e8c08a', INKC, '#c88a6a'
    pr = {(7, 2): T, (8, 2): '#5a3418', (9, 2): '#5a3418', (8, 3): T, (9, 3): K, (10, 3): T,
          (9, 4): T, (10, 4): T, (8, 5): P, (9, 5): P, (10, 5): K, (7, 5): T}
    return tee('#7a4a2a', pr)


def night_shift_flannel():
    return make(check('#5a2a8a', '#2a1c3a', '#1a1028'), sleeve=7,
                fn=lambda lx, ly, t: '#c8a0ff' if (lx, ly) in ((8, 3), (8, 5)) else False,
                sleeve_col=lambda t, tone: '#2a1c3a' if int(t * 4) % 2 else '#5a2a8a')


def paper_hands_polo():
    B, C = '#ece0c0', '#c4b48e'
    crease = {(1, 1), (2, 2), (0, 4), (1, 5), (6, 2), (7, 3), (9, 2), (10, 4), (9, 5), (7, 6), (8, 7), (3, 6)}

    def f(lx, ly, t):
        if ly <= 1 and lx >= 4:
            return '#f8f0dc'   # collar
        if (lx, ly) in crease:
            return C
        if lx == 8 and ly in (2, 3):
            return '#d8c8a4'
        return False
    return tee(B, fn=f)


def probably_nothing():
    K = '#4a4458'
    return tee(WHITE, {(8, 3): K, (9, 3): K, (10, 3): K})


def red_candle_tee():
    R, D = '#ff3a3a', '#a01a2a'
    pr = {}
    for y in range(1, 7):
        pr[(9, y)] = R
        pr[(8, y)] = R if y < 6 else BLACK
    pr[(9, 7)] = R
    pr[(8, 1)] = '#ff9a8a'
    pr[(9, 0)] = R
    pr[(1, 6)] = D
    pr[(1, 7)] = R
    return tee(BLACK, pr)


def rent_exempt_vest():
    G = '#8a8e9e'

    def f(lx, ly, t):
        if vest_open(lx, ly):
            return None if singlet(lx, ly) else SINGLET
        if (lx, ly) in ((8, 4), (9, 4), (10, 4)):
            return WHITE
        if (lx, ly) in ((8, 5), (9, 5)):
            return '#d0d2dc'
        if (lx, ly) == (5, 2):
            return '#6a6e7c'
        return False
    return make(G, fn=f)


def i_survived_tee():
    W, Rr = WHITE, '#ffb070'
    pr = grid(['wwww',
               'wrrw',
               'wwww',
               'w.w.'], 7, 2, {'w': W, 'r': Rr})
    pr.update({(0, 3): W, (1, 3): W, (0, 5): W, (1, 5): W, (2, 5): W})
    return tee('#d42a2e', pr)


def ser_polo():
    N, G = '#22306a', GOLD

    def f(lx, ly, t):
        if ly <= 1 and lx >= 3:
            return '#2e3e84'
        if (lx, ly) in ((5, 2), (6, 2)):
            return G
        if (lx, ly) in ((8, 2), (8, 3)):
            return '#e8e4dc'
        return False
    return tee(N, fn=f)


def shrimp_tank():
    P, O, D = '#ff9ac0', '#ff7a3a', '#c84a2a'
    pr = grid(['.oo',
               'o.o',
               'oo.'], 8, 2, {'o': O})
    pr[(10, 4)] = D

    def f(lx, ly, t):
        if singlet(lx, ly) and ly <= 1 and lx < 4:
            return 'skin'
        return False
    return make(P, pr, fn=f)


def solana_summer_shirt():
    P, T = '#9a4ae8', '#2ee0c0'

    def b(lx, ly, t):
        if (lx, ly) in ((8, 3), (8, 5)):
            return WHITE
        return T if lx % 3 == 0 else P
    return make(b, sleeve=2.8, sleeve_col=lambda t, tone: T if int(t * 3) == 1 else P)


def dusty_miner_tee():
    B, K, D = '#9a6a42', '#2a2226', '#b8885e'
    pr = grid(['.kk.',
               'k..k',
               'k..k',
               '.kk.'], 7, 2, {'k': K})
    dust = {(1, 1), (0, 5), (9, 6), (6, 2), (3, 7), (10, 3)}
    for d in dust:
        pr[d] = D
    return tee(B, pr)


def touch_grass_tee():
    W = WHITE
    pr = grid(['w.w.',
               'w.ww',
               'wwww'], 7, 3, {'w': W})
    pr[(9, 2)] = W
    return tee('#3cb04a', pr)


def validator_fleece():
    N, W, G = '#26346e', WHITE, '#5ae06a'
    pr = grid(['www',
               'wGw',
               'www'], 8, 2, {'w': W, 'G': G})

    def f(lx, ly, t):
        if lx == 7 and ly <= 1:
            return '#9aa4c8'
        return False
    return make(N, pr, fn=f, sleeve=7, cuff='#1c2650')


def ngmi_tee():
    R = '#c86a6a'
    pr = {(7, 2): R, (8, 2): R, (10, 2): R, (8, 3): R, (10, 3): R, (9, 4): R, (10, 4): R,
          (8, 5): R, (0, 3): R, (1, 4): R}
    return tee('#8a8896', pr)


def wagmi_tee():
    B = '#2a4ad0'
    pr = {(5, 2): B, (7, 2): B, (9, 2): B, (8, 3): B, (10, 3): B, (9, 4): B, (10, 4): B,
          (7, 5): B, (8, 5): B, (10, 5): B, (0, 3): B, (1, 3): B, (0, 4): B}
    return tee('#ffd83a', pr)


# ================================================================= UNCOMMON
def batik_digger():
    B, D, C = '#b8743a', '#4a2a6a', '#f0d08a'

    def b(lx, ly, t):
        k = (lx + 2 * ly) % 5
        if (lx + ly) % 4 == 0 and ly % 2 == 0:
            return C
        return D if k == 0 else B
    return make(b, sleeve=3.2, sleeve_col=lambda t, tone: D if int(t * 4) % 2 else B)


def anon_dev_hoodie():
    K = '#1c1822'

    def front(f, P, t0):
        hx, hy = HEAD0(P)
        R, Fc = ramp('#2a2632'), ramp('#0e0a12')
        for y in range(hy, hy + 12):
            for x in range(hx, hx + 13):
                p = f.get(x, y)
                if not p or p[3] != 'head':
                    continue
                i, j = x - hx, y - hy
                face = i >= 3 and j >= 4
                rim = face and (i == 3 or j == 4)
                if face and not rim:
                    f.put(x, y, Fc, 1, 'hood')
                else:
                    f.put(x, y, R, 3 if (i + j) < 6 else 2 if not rim else 1, 'hood')
        # hood rim past the chin and the two eyes
        for (i, j, tt) in ((12, 4, 1), (12, 5, 1), (12, 6, 1), (12, 7, 1), (11, 3, 2), (12, 8, 0), (11, 11, 1),
                           (10, 12, 1), (9, 12, 1), (2, 12, 1), (3, 12, 1)):
            f.put(hx + i, hy + j, R, tt, 'hood')
        f.put(hx + 7, hy + 7, ramp('#f8f8ff'), 2, 'eyes')
        f.put(hx + 10, hy + 7, ramp('#f8f8ff'), 2, 'eyes')
    return make(K, sleeve=7, fn=strings('#5a5664'), front=front, cuff='#14101a')


def crash_cart_jacket():
    R, W, K = '#e0302e', WHITE, '#4a4a56'

    def b(lx, ly, t):
        if lx in (4, 5) or ly == 7:
            return W
        if (lx, ly) in ((8, 3), (9, 3), (10, 3)):
            return '#8a6a4a'           # cart tub
        if (lx, ly) in ((8, 4), (10, 4)):
            return K                   # wheels
        if (lx, ly) in ((9, 2),):
            return GOLD                # ore in the cart
        if lx == 7 and ly >= 2:
            return '#b8b8c4'           # zipper
        return R
    return make(b, sleeve=7, sleeve_col=lambda t, tone: W if 0.35 < t < 0.6 else R, cuff=W)


def blockhash_hoodie():
    R, G = '#e83a3a', '#9a98a6'

    def f(lx, ly, t):
        if (ly in (2, 5) and 5 <= lx <= 10) or (lx in (5, 10) and 2 <= ly <= 5):
            return R
        if ly in (3, 4) and lx in (7, 8, 9) and (lx + ly) % 2:
            return R
        if (lx, ly) in ((0, 3), (1, 4), (2, 3)):
            return R
        return False
    return make(G, fn=f, sleeve=7, back=hood_down(G), cuff='#7a7886')


def bonding_curve_tee():
    G, K = '#2ec85a', '#c8c4d0'
    pr = {(5, 5): G, (6, 5): G, (7, 5): G, (8, 4): G, (9, 3): G, (10, 3): G, (9, 2): G,
          (8, 5): K, (9, 5): K, (10, 5): K, (5, 2): K, (5, 3): K, (5, 4): K,
          (0, 5): G, (1, 5): G, (2, 4): G}
    return tee(WHITE, pr)


def breakpoint_lanyard():
    P, B = '#8a3ae8', '#f0f0ff'

    def front(f, P_, t0):
        x0, y0 = t0
        R = ramp(P)
        for (dx, dy) in ((6, 0), (7, 1), (7, 2), (8, 3), (8, 4)):
            over(f, x0 + dx, y0 + dy, P, 2, 'lanyard', skip=('head', 'arm-f'))
        for (dx, dy, c, t) in ((8, 5, P, 2), (9, 5, P, 2), (8, 6, B, 3), (9, 6, B, 2), (10, 5, B, 2), (10, 6, B, 1)):
            over(f, x0 + dx, y0 + dy, c, t, 'badge')
    pr = {(1, 1): P, (0, 2): P}
    return tee(WHITE, pr, front=front)


def bat_wing_hoodie():
    K = '#24202c'

    def back(f, P):
        hood_down(K)(f, P)
        x0, y0 = T0(P)
        flap = int(wind(P) > 0.5)
        R = ramp('#3a3446')
        for (dx, dy, t) in ((-1, 0, 3), (-2, 0, 2), (-3, -1, 2), (-4, -2, 2), (-3, 1, 1), (-4, 0, 2), (-5, -1, 1),
                            (-4, 1, 1), (-2, 1, 1), (-5, 0, 0)):
            f.put(x0 + dx, y0 + dy + 1 - flap, R, t, 'wing')
    return make(K, sleeve=7, fn=strings('#5a5466'), back=back, cuff='#16121c')


def clan_crest_tabard():
    C, G, R = '#3a6ad8', GOLD, '#e83a3a'

    def b(lx, ly, t):
        if 7 <= lx <= 10 and 2 <= ly <= 5:
            if lx in (7, 10) or ly in (2, 5):
                return G
            return R
        if lx == 0 or ly == 7:
            return G
        return C

    def front(f, P, t0):
        x0, y0 = t0
        for k in range(3):
            for dx in range(6, 10):
                c = G if k == 2 and dx % 2 else C
                over(f, x0 + dx, y0 + 8 + k, c, 1 if dx == 9 else 2, 'tabard', skip=('head', 'arm-f'))
            for dx in (1, 2):
                over(f, x0 + dx, y0 + 8 + k, G if k == 2 else C, 1, 'tabard', skip=('head', 'arm-f'))
    return make(b, sleeve=0, front=front)


def founding_miner_vest():
    Br, G = '#7a4a28', GOLD

    def f(lx, ly, t):
        if vest_open(lx, ly):
            return None if singlet(lx, ly) else SINGLET
        if (lx, ly) in ((8, 3), (9, 3), (8, 4), (9, 4)):
            return G if (lx, ly) != (8, 3) else '#fff0a0'
        if (lx, ly) in ((10, 3),):
            return '#c88a1a'
        return False
    return make(Br, fn=f)


def frog_raincoat():
    G = '#4ac83a'

    def back(f, P):
        hood_down(G)(f, P)
        x0, y0 = T0(P)
        for (dx, dy, c, t) in ((-3, -4, G, 3), (-2, -4, G, 3), (-3, -5, WHITE, 3), (-2, -5, INKC, 0),
                               (-1, -4, G, 2), (0, -5, WHITE, 3), (0, -4, G, 2), (1, -5, INKC, 0)):
            f.put(x0 + dx, y0 + dy, ramp(c), t if c != INKC else 1, 'hood')

    def f(lx, ly, t):
        if lx == 8 and ly in (2, 4, 6):
            return YELLOW
        if ly == 7:
            return '#2e9a2a'
        return False
    return make(G, fn=f, sleeve=7, back=back, cuff='#2e9a2a')


def galaxy_brain_hoodie():
    N, P, H = '#1e2a6a', '#ff6ac8', '#ffc0ec'
    pr = grid(['.pp.',
               'pHpp',
               'pppp',
               '.p.p'], 7, 2, {'p': P, 'H': H})
    pr.update({(1, 1): '#a8c0ff', (0, 5): WHITE, (2, 6): '#a8c0ff'})

    def front(f, P_, t0):
        x0, y0 = t0
        for (dx, dy, a) in ((11, 2, 110), (11, 3, 150), (11, 4, 110), (10, 1, 90)):
            glow(f, x0 + dx, y0 + dy, (255, 106, 200), a)
    return make(N, pr, sleeve=7, back=hood_down(N), front=front, cuff='#141c4a')


def hopium_tracksuit():
    B, W = '#8ac8f0', WHITE

    def f(lx, ly, t):
        if lx == 8 and ly >= 1:
            return '#e8f4ff'
        if ly == 7 or (ly <= 1 and lx >= 5):
            return '#5a9ad0'
        if lx in (1, 2):
            return W
        return False
    return make(B, fn=f, sleeve=7, sleeve_col=lambda t, tone: W if tone >= 2 and int(t * 6) % 2 else B, cuff='#5a9ad0')


def lighthouse_raincoat():
    Y, N = '#ffd02a', '#22306a'

    def f(lx, ly, t):
        if ly <= 1 or (ly == 2 and lx >= 6):
            return N
        if (lx, ly) in ((8, 4), (9, 4)):
            return N
        if (lx, ly) in ((8, 3), (9, 3)):
            return '#fff6a0'
        if lx == 7 and ly >= 3:
            return '#d8a818'
        return False
    return make(Y, fn=f, sleeve=7, cuff=N, back=hood_down(Y))


def liquidation_jersey():
    R, W = '#ff2a2e', WHITE
    pr = grid(['w.w',
               'w.w',
               'www',
               '.w.'], 8, 2, {'w': W})
    pr.update({(5, 2): W, (6, 2): W, (6, 5): W, (7, 5): W, (0, 3): W, (1, 3): W, (0, 4): W})

    def f(lx, ly, t):
        if ly == 7:
            return W
        return False
    return make(R, pr, sleeve=2.6, cuff=W, fn=f)


def hero_replica_bib():
    D, Y, S = '#3a62b0', '#ffd23c', '#e8d090'

    def b(lx, ly, t):
        if singlet(lx, ly):
            return None
        if lx == 2 and ly <= 2:
            return '#2a4a8a'
        if (lx, ly) in ((8, 3), (9, 3), (10, 3)):
            return Y
        if (lx, ly) in ((8, 2), (9, 2)):
            return Y
        if (lx, ly) == (10, 4) or (lx, ly) == (8, 4) or (lx, ly) == (9, 4):
            return '#2a4a8a'
        if lx == 7 and ly >= 3:
            return S          # stitched seam
        return D
    return make(b)


def mint_day_hoodie():
    K, G, W = '#24202c', '#3cf07a', WHITE
    pr = grid(['.ww.',
               'wGww',
               'w.Gw',
               '.ww.'], 7, 2, {'w': W, 'G': G})
    pr.update({(0, 3): G, (1, 3): G, (2, 3): G, (0, 5): G, (1, 5): G, (7, 6): G, (8, 6): G, (9, 6): G})
    return make(K, pr, sleeve=7, back=hood_down(K), cuff='#16121c')


def banana_print_shirt():
    Y, Bn = '#ffd84a', '#8a5a2a'
    bananas = {(0, 1), (1, 1), (1, 4), (2, 4), (5, 2), (6, 2), (8, 2), (9, 3), (10, 4), (9, 5), (6, 6), (7, 6),
               (2, 7), (8, 7)}
    return make(lambda lx, ly, t: Bn if (lx, ly) in bananas else (WHITE if (lx, ly) in ((8, 4),) else Y),
                sleeve=2.8, sleeve_col=lambda t, tone: Bn if 0.4 < t < 0.6 else Y)


def chain_is_fine_vest():
    O, W = '#ff8a24', WHITE

    def f(lx, ly, t):
        if vest_open(lx, ly):
            return None if singlet(lx, ly) else SINGLET
        if lx in (0, 2) and 2 <= ly <= 6:
            return W            # pause bars on the back
        if lx == 1 and 2 <= ly <= 6:
            return O
        if (lx, ly) in ((9, 3), (9, 4), (9, 5)):
            return W
        return False
    return make(O, fn=f)


def songket_vest():
    K, G, H = '#24202c', '#e8b030', '#fff0a0'

    def f(lx, ly, t):
        if vest_open(lx, ly):
            return None if singlet(lx, ly) else SINGLET
        if ly in (3, 6):
            return G if (lx + ly) % 2 else H
        if ly in (4, 5) and (lx + ly) % 3 == 0:
            return G
        return False
    return make(K, fn=f)


def teh_tarik_apron():
    C, B, T, G = '#f0e4c4', '#a8642a', '#c88a4a', '#e8f4ff'

    def f(lx, ly, t):
        if lx <= 2 and ly <= 2:
            return None if singlet(lx, ly) else '#d8a868'
        if lx == 2 and ly <= 3:
            return '#d8a868'   # neck strap
        if lx == 9 and ly == 2:
            return T
        if (lx, ly) in ((8, 3), (9, 3), (10, 3)):
            return T
        if (lx, ly) in ((8, 4), (9, 4), (10, 4), (8, 5), (9, 5), (10, 5)):
            return G
        if (lx, ly) in ((7, 5), (7, 6), (6, 6)):
            return B
        if lx < 4:
            return '#2f5fd0'   # overalls show behind
        return False
    return make(C, fn=f)


def wau_kite_jacket():
    R, Y, B, K = '#e0302e', '#ffd23c', '#2a4ad0', '#7a1a1e'
    pr = {(1, 1): Y, (0, 2): Y, (1, 2): B, (2, 2): Y, (1, 3): Y, (0, 4): Y, (1, 4): B, (2, 4): Y,
          (1, 5): Y, (1, 6): Y}

    def f(lx, ly, t):
        if lx == 8 and ly >= 1:
            return '#b0b0c0'
        return False
    return make(R, pr, fn=f, sleeve=7, cuff=K)


def refinery_apron():
    L, O, S = '#7a4a28', '#ff8a24', '#c8ccd8'

    def f(lx, ly, t):
        if lx < 4:
            return None if singlet(lx, ly) else ('#5a3420' if lx == 2 else '#2f5fd0')
        if ly <= 1:
            return None
        if (lx, ly) in ((9, 3), (10, 3), (9, 4), (10, 4)):
            return S if (lx, ly) != (9, 3) else '#f0f4ff'
        if (lx, ly) in ((6, 5), (8, 6), (7, 2), (10, 6)):
            return O
        if (lx, ly) in ((7, 5), (9, 6)):
            return '#3a2010'
        return False

    def front(f_, P, t0):
        x0, y0 = t0
        for k in range(2):
            for dx in range(5, 10):
                over(f_, x0 + dx, y0 + 8 + k, L, 1 if dx in (5, 9) else 2, 'apron', skip=('head', 'arm-f'))
        over(f_, x0 + 7, y0 + 9, O, 2, 'apron')
    return make(L, fn=f, front=front)


def priority_fee_blazer():
    K, G, Wt = '#22202a', GOLD, '#f4f0e8'

    def f(lx, ly, t):
        if ly <= 2 and lx >= 6:
            return Wt
        if (lx, ly) in ((9, 3), (10, 4)):
            return Wt
        if (lx, ly) in ((5, 2), (6, 3), (7, 4), (8, 5), (8, 6)):
            return G
        if (lx, ly) == (8, 3):
            return '#ff4a6a'   # VIP pin
        return False
    return make(K, fn=f, sleeve=7, cuff=G)


def rug_cardigan():
    R, Y, D = '#c8302e', '#f0c060', '#7a1a20'

    def b(lx, ly, t):
        if lx == 8 and ly >= 1:
            return '#e8d8b8'   # button band
        k = (abs(lx - 5) + ly) % 4
        return Y if k == 0 else D if k == 2 else R

    def front(f, P, t0):
        x0, y0 = t0
        for dx in range(1, 10, 2):
            over(f, x0 + dx, y0 + 8, Y, 2, 'fringe', skip=('head', 'arm-f'))
    return make(b, sleeve=7, sleeve_col=lambda t, tone: Y if int(t * 5) % 2 else R, front=front)


def seeker_squad_jacket():
    K, T = '#24222c', '#2ee0c8'

    def f(lx, ly, t):
        if lx in (5, 6) and ly <= 7:
            return T if lx == 6 else K
        if ly == 7:
            return '#3a3846'   # ribbed hem
        if (lx, ly) in ((9, 3), (9, 4)):
            return '#3e3c4a'
        if (lx, ly) in ((9, 2), (10, 3)):
            return T
        return False
    return make(K, fn=f, sleeve=7, cuff='#3a3846', sleeve_col=lambda t, tone: T if 0.45 < t < 0.6 else K)


def sniper_bot_vest():
    O, R = '#5a6a32', '#ff3a3a'

    def f(lx, ly, t):
        if singlet(lx, ly) and ly <= 1:
            return None
        if (lx, ly) in ((9, 2), (9, 4), (8, 3), (10, 3)):
            return R
        if (lx, ly) == (9, 3):
            return '#ffd0c0'
        if ly in (5, 6) and lx in (6, 7, 9, 10):
            return '#46542a' if ly == 5 else '#3a4622'   # pouches
        if lx in (0, 1) and ly in (3, 4):
            return '#46542a'
        return False
    return make(O, fn=f)


def validator_lanyard_vest():
    G, L = '#4a4c58', '#4ae06a'

    def f(lx, ly, t):
        if vest_open(lx, ly):
            return None if singlet(lx, ly) else SINGLET
        return False

    def front(f_, P, t0):
        x0, y0 = t0
        for (dx, dy) in ((6, 0), (7, 1), (7, 2), (8, 3), (8, 4)):
            over(f_, x0 + dx, y0 + dy, L, 2, 'lanyard', skip=('head', 'arm-f'))
        for (dx, dy, c, t) in ((8, 5, WHITE, 3), (9, 5, WHITE, 2), (8, 6, L, 3), (9, 6, '#2a8a3a', 2),
                               (10, 5, WHITE, 1), (10, 6, L, 2)):
            over(f_, x0 + dx, y0 + dy, c, t, 'badge')
    return make(G, fn=f, front=front)


def whale_print_shirt():
    B, W = '#2a6ad0', WHITE
    whales = {(0, 1), (1, 1), (6, 2), (7, 2), (9, 3), (10, 3), (8, 5), (9, 5), (1, 4), (2, 4), (5, 6), (6, 6)}
    spout = {(7, 1), (10, 2), (2, 3)}

    def b(lx, ly, t):
        if (lx, ly) in whales:
            return W
        if (lx, ly) in spout:
            return '#a8e0ff'
        if lx == 8 and ly in (2, 4, 6):
            return '#e8f0ff'
        return B
    return make(b, sleeve=2.8, sleeve_col=B)


# ================================================================= RARE
def arena_champion_straps():
    L, Dk, R, G = '#8a5a30', '#5a3418', '#e0302e', GOLD

    def b(lx, ly, t):
        if lx - ly in (1, 2) or lx + ly in (9, 10):
            return L               # crossing straps
        if (lx, ly) in ((7, 5), (8, 5), (9, 5), (10, 5)):
            return R
        if ly == 6 or ly == 7:
            return Dk
        return 'skin'

    def front(f, P, t0):
        x0, y0 = t0
        over(f, x0 + 8, y0 + 5, '#ffe080', 4, 'plate')
        over(f, x0 + 9, y0 + 5, G, 2, 'plate')
        glow(f, x0 + 11, y0 + 4, (255, 240, 180), 160)
        glow(f, x0 + 11, y0 + 6, (255, 240, 180), 90)
        pad(f, P, L, hi='#c88a50')
    return make(b, front=front, sleeve=1.4, sleeve_col='#5a3418')


def mole_king_robe():
    P_, G, R = '#4a1e7a', GOLD, '#ff2a2a'

    def b(lx, ly, t):
        if lx == 8 or ly == 0 or (ly <= 1 and lx >= 6):
            return G
        if (lx, ly) == (9, 3):
            return R
        if (lx, ly) in ((10, 3), (9, 2), (9, 4)):
            return '#f0e0a0'
        return P_

    def front(f, P, t0):
        skirt(f, P, lambda i, k, e: (G, 2) if k == 2 or i == 8 else (P_, 1 if e else 2), rows=3)
        x0, y0 = t0
        glow(f, x0 + 11, y0 + 3, (255, 60, 60), 130)

    def back(f, P):
        x0, y0 = T0(P)
        for k in range(10):
            for i in range(0, 1 + k // 3):
                under(f, x0 + 1 - i, y0 + 1 + k, P_ if k < 9 else G, 1 if i == k // 3 else 2)
    return make(b, sleeve=7, sleeve_col=P_, cuff=G, front=front, back=back)


def diamond_chestplate():
    C, D, H = '#5ee0f0', '#2a90c0', '#f0ffff'

    def b(lx, ly, t):
        if (lx + ly) % 3 == 0:
            return H if ly < 3 else C
        if (lx - ly) % 4 == 0:
            return D
        if ly == 7:
            return D
        return C

    def front(f, P, t0):
        x0, y0 = t0
        pad(f, P, C, hi=H)
        for (dx, dy, a) in ((10, 1, 220), (11, 1, 120), (9, 1, 120), (10, 0, 120), (10, 2, 120)):
            glow(f, x0 + dx, y0 + dy, (240, 255, 255), a)
        over(f, x0 + 9, y0 + 2, H, 4, 'spark')
    return make(b, front=front, sleeve=2.0, sleeve_col='#3ab0d8')


def floor_receipt_cape():
    W, R, G = '#f8f6f0', '#e83a3a', '#d8d4cc'

    def colfn(i, k, edge):
        if i % 2 == 1:
            return G, 1               # gaps between strips
        if k % 3 == 1 and i > 0:
            return R, 2               # red numbers
        return W, 3 if k < 2 else 2

    def strip_ragged(i, _):
        return i % 2 == 1

    def f(lx, ly, t):
        if (lx, ly) in ((9, 3), (9, 4)):
            return R
        return False
    return make('#6a6c7a', fn=f, sleeve=2.6,
                back=cape_back(colfn, length=9, spread=0.5, flutter=1.6, ragged=strip_ragged))


def galaxy_brain_robe():
    I, S, P = '#2a1e7a', WHITE, '#ffd0ff'
    stars = {(1, 1), (0, 4), (2, 6), (6, 2), (9, 3), (8, 5), (10, 6), (5, 7)}

    def b(lx, ly, t):
        if (lx, ly) in stars:
            return S
        if (lx, ly) in ((9, 2), (7, 6)):
            return P
        return I

    def front(f, P_, t0):
        x0, y0 = t0
        skirt(f, P_, lambda i, k, e: (S, 3) if (i * 3 + k) % 5 == 0 else (I, 1 if e else 2), rows=3)
        for (dx, dy, a) in ((11, 1, 170), (-1, 3, 130), (12, 6, 120)):
            glow(f, x0 + dx, y0 + dy, (255, 255, 255), a)

    def back(f, P_):
        x0, y0 = T0(P_)
        for k in range(10):
            for i in range(0, 1 + k // 3):
                under(f, x0 + 1 - i, y0 + 1 + k, S if (i + k) % 5 == 2 else I, 1 if i == k // 3 else 2)
    return make(b, sleeve=7, sleeve_col=lambda t, tone: S if int(t * 7) == 3 else I, cuff='#4a3aa8',
                front=front, back=back)


def hollow_night_cloak():
    K, P = '#1c1824', '#8a3ae0'

    def colfn(i, k, edge):
        if edge:
            return P, 3 if k % 2 else 2     # purple lining at the trailing edge
        if i == 0:
            return P, 1
        return '#3a3048', 3 if (i + k) % 4 == 0 else 2

    def back(f, P_):
        cape_back(colfn, length=10, spread=0.85, top=-1, flutter=1.4, ragged=lambda i, _: i % 3 == 1)(f, P_)
        x0, y0 = T0(P_)
        # standing collar behind the head
        for (dx, dy, c, t) in ((-1, -2, K, 3), (0, -2, K, 2), (-1, -1, P, 2), (-2, -1, K, 2), (0, -3, K, 3)):
            f.put(x0 + dx, y0 + dy, ramp(c), t, 'cape')

    def f(lx, ly, t):
        if lx == 0:
            return P
        return False
    return make(K, fn=f, sleeve=7, back=back, cuff=P)


def hopium_tank_suit():
    S, B, H = '#c8ccd8', '#3a7ae8', '#a8d0ff'

    def back(f, P):
        x0, y0 = T0(P)
        R = ramp(B)
        for k in range(7):
            for i in range(1, 4):
                t = 3 if i == 3 else 2 if i == 2 else 1
                if k in (0, 6):
                    t -= 1
                f.put(x0 - i + 1, y0 + k, R, t, 'tank')
        f.put(x0 - 1, y0 - 1, ramp('#9aa0b0'), 2, 'tank')      # valve
        f.put(x0 - 1, y0 - 2, ramp('#9aa0b0'), 3, 'tank')
        for (dx, dy, a) in ((-1, -4, 180), (-2, -6, 140), (-1, -7, 90)):
            glow(f, x0 + dx, y0 + dy, (168, 220, 255), a)
        f.put(x0 - 2, y0 + 2, ramp(H), 4, 'tank')

    def b(lx, ly, t):
        if lx in (1, 2) or ly == 7:
            return '#9aa0b0'      # straps / belt
        if (lx, ly) in ((9, 3), (10, 3)):
            return B
        return S
    return make(b, sleeve=7, back=back, cuff='#9aa0b0')


def margin_call_suit():
    G, W, R = '#6a6c7a', '#f4f0e8', '#e02a2a'

    def b(lx, ly, t):
        if (lx, ly) in ((8, 2), (8, 3), (9, 4), (9, 5), (9, 6), (9, 7), (8, 4)):
            return R               # drooping tie
        if ly <= 3 and lx >= 7:
            return W
        if (lx, ly) in ((6, 2), (6, 3), (7, 4), (8, 5)):
            return '#4e505c'       # lapel
        return G

    def front(f, P, t0):
        x0, y0 = t0
        over(f, x0 + 9, y0 + 8, R, 1, 'tie')
        over(f, x0 + 9, y0 + 9, R, 0, 'tie')
    return make(b, sleeve=7, cuff=W, front=front)


def old_glow_vest():
    Br, O, Y = '#7a4a28', '#ff9a2a', '#fff0a0'

    def f(lx, ly, t):
        if vest_open(lx, ly):
            return None if singlet(lx, ly) else SINGLET
        return False

    def front(f_, P, t0):
        x0, y0 = t0
        for (dx, dy, c, t) in ((9, 2, '#5a5a66', 2), (9, 3, O, 3), (10, 3, '#6a5a3a', 1), (9, 4, Y, 4),
                               (10, 4, O, 2), (9, 5, '#5a5a66', 1), (10, 5, '#5a5a66', 1)):
            over(f_, x0 + dx, y0 + dy, c, t, 'lantern')
        for (dx, dy, a) in ((11, 3, 140), (11, 4, 170), (11, 5, 120), (12, 4, 70), (10, 6, 50)):
            glow(f_, x0 + dx, y0 + dy, (255, 170, 60), a)
    return make(Br, fn=f, front=front)


def motherlode_plate():
    G, D, H = '#f6bc36', '#9a6a1a', '#fff6c0'

    def b(lx, ly, t):
        if lx - ly in (3, 4) and ly <= 6:
            return H              # shine sweep
        if (lx, ly) in ((8, 3), (9, 3), (8, 4), (9, 4), (7, 4), (10, 4), (8, 5), (9, 5), (9, 2)):
            return D              # ore mark
        if ly == 7:
            return D
        return G

    def front(f, P, t0):
        pad(f, P, G, hi=H)
        x0, y0 = t0
        glow(f, x0 + 11, y0 + 2, (255, 246, 192), 160)
    return make(b, front=front, sleeve=2.2, sleeve_col='#c8901e')


def durian_armour():
    G, D, Y = '#7ab83a', '#4a7a22', '#d8e070'

    def b(lx, ly, t):
        if (lx + ly) % 2 == 0:
            return D
        if (lx * 3 + ly) % 5 == 0:
            return Y
        return G

    def back(f, P):
        x0, y0 = T0(P)
        for (dx, dy) in ((-1, 1), (-1, 3), (-1, 5), (0, 7), (0, -1), (2, -1)):
            f.put(x0 + dx, y0 + dy, ramp(D), 2, 'spike')
        f.put(x0 - 2, y0 + 2, ramp(D), 1, 'spike')
        f.put(x0 - 2, y0 + 4, ramp(D), 1, 'spike')

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy) in ((11, 3), (11, 5), (10, 7), (12, 4)):
            over(f, x0 + dx, y0 + dy, D, 2, 'spike')
        # stink lines
        for (dx, dy, a) in ((12, 0, 150), (13, -1, 120), (12, -2, 90), (-3, 0, 120), (-3, -2, 90), (-4, -1, 110)):
            glow(f, x0 + dx, y0 + dy, (200, 230, 90), a)
        pad(f, P, G, hi=Y)
    return make(b, back=back, front=front, sleeve=1.6, sleeve_col=D)


def keris_guard_vest():
    K, B, G, H = '#2a1e2e', '#5a3a6a', GOLD, '#fff6c0'

    def f(lx, ly, t):
        if singlet(lx, ly) and ly <= 1:
            return None
        if (lx, ly) in ((5, 2), (6, 3), (7, 3), (8, 4), (9, 4), (10, 5)):
            return G               # wavy blade across the chest
        if (lx, ly) in ((4, 1), (5, 1)):
            return '#a87a1a'       # hilt
        if (lx, ly) == (10, 5):
            return H
        if (lx + 2 * ly) % 4 == 0:
            return B
        return False

    def front(f_, P, t0):
        x0, y0 = t0
        over(f_, x0 + 9, y0 + 4, H, 4, 'glint')
        glow(f_, x0 + 11, y0 + 4, (255, 246, 192), 160)
    return make(K, fn=f, front=front)


def paper_armour():
    W, C, S = '#f8f6ee', '#d4d0c4', '#b0aca0'

    def b(lx, ly, t):
        if (lx + ly) % 4 == 0:
            return C               # fold lines
        if ly == 7:
            return S
        return W

    def front(f, P, t0):
        x0, y0 = t0
        flap = int(wind(P) > 0.5)
        pad(f, P, W, hi=WHITE)
        for (dx, dy, c, t) in ((11, 3 - flap, W, 3), (11, 4, C, 2), (10, 8, W, 2), (8, 8 + flap, C, 2),
                               (-1, 5, W, 2), (-1, 6 + flap, C, 1)):
            over(f, x0 + dx, y0 + dy, c, t, 'paper')
    return make(b, front=front, sleeve=2.0, sleeve_col=C)


def seeker_exosuit():
    K, T, D = '#2a2a36', '#2ee0c8', '#1a1a24'

    def b(lx, ly, t):
        if 8 <= lx <= 10 and 2 <= ly <= 5:
            if lx == 8 or ly in (2, 5):
                return '#4a4a5a'   # phone bezel
            return T if ly != 4 else '#a8fff0'
        if ly in (3, 6) and lx <= 6:
            return D
        return K

    def front(f, P, t0):
        x0, y0 = t0
        pad(f, P, '#4a4a5a', hi='#7a7a8e')
        glow(f, x0 + 11, y0 + 3, (46, 224, 200), 140)
        glow(f, x0 + 11, y0 + 4, (46, 224, 200), 110)
        x, y = x0 - 1, y0 + 2
        f.put(x, y, ramp(T), 3, 'gear')
    return make(b, sleeve=7, sleeve_col=lambda t, tone: T if 0.45 < t < 0.55 else K, cuff='#4a4a5a', front=front)


def sniper_ghillie():
    G1, G2, G3 = '#4a8a2e', '#2e5a22', '#8ac84a'

    def b(lx, ly, t):
        k = (lx * 7 + ly * 5) % 6
        return [G1, G2, G3, G1, G2, G1][k]

    def back(f, P):
        x0, y0 = T0(P)
        for (dx, dy, c) in ((-1, 0, G3), (-2, 1, G1), (-1, 2, G2), (-2, 3, G3), (-1, 4, G1), (-2, 5, G2),
                            (-1, 6, G3), (-1, 8, G1), (0, -1, G3), (1, -1, G1), (2, -2, G3)):
            f.put(x0 + dx, y0 + dy, ramp(c), 2, 'leaf')

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy, c) in ((11, 3, G3), (11, 5, G1), (10, 7, G2), (12, 4, G3), (4, 8, G1), (7, 8, G3),
                            (9, 8, G1), (1, 8, G2)):
            over(f, x0 + dx, y0 + dy, c, 2, 'leaf')
    return make(b, sleeve=7, sleeve_col=lambda t, tone: [G1, G2, G3][int(t * 6) % 3], back=back, front=front)


def summer_surf_suit():
    P, T, W = '#8a3ae0', '#2ee0c0', '#f0ffff'

    def b(lx, ly, t):
        wave = 4 + (1 if lx % 4 in (1, 2) else 0) - (1 if lx % 4 == 3 else 0)
        if ly == wave:
            return W
        if ly > wave:
            return T
        return P

    def front(f, P_, t0):
        x0, y0 = t0
        for (dx, dy, a) in ((11, 6, 200), (11, 8, 140), (-1, 7, 160), (10, 9, 110)):
            glow(f, x0 + dx, y0 + dy, (168, 240, 255), a)
        over(f, x0 + 9, y0 + 2, W, 4, 'spark')
    return make(b, sleeve=7, sleeve_col=lambda t, tone: T if t > 0.6 else P, front=front)


def this_is_fine_hoodie():
    B, T, O, Y, R = '#7a4a2a', '#c88a4a', '#ff7a1a', '#ffd23c', '#e0382a'

    def f(lx, ly, t):
        if (lx, ly) in ((8, 2), (9, 2), (8, 3), (9, 3), (10, 3), (8, 4), (9, 4)):
            return T                         # bear head
        if (lx, ly) in ((7, 2), (10, 2)):
            return T if (lx, ly) == (7, 2) else '#a06a3a'
        if (lx, ly) == (9, 3):
            return INKC
        if (lx, ly) == (10, 4):
            return WHITE                     # coffee cup
        h = [2, 1, 2, 1, 2, 3, 1, 2, 1, 2, 2][lx % 11]
        depth = 7 - ly
        if depth < h:
            return Y if depth == 0 and lx % 2 else O if depth < h - 1 else R
        return False

    def front(f_, P, t0):
        x0, y0 = t0
        for (dx, dy, a) in ((2, 8, 120), (11, 6, 150), (11, 7, 110), (-1, 6, 140)):
            glow(f_, x0 + dx, y0 + dy, (255, 140, 40), a)
    return make(B, fn=f, sleeve=7, back=hood_down(B), front=front, cuff=O)


def whale_diver_suit():
    N, Br, Gl = '#22306a', '#d8a030', '#7ad0f0'

    def b(lx, ly, t):
        d = (lx - 8.5) ** 2 + (ly - 3.5) ** 2
        if d <= 1.6:
            return Gl if (lx, ly) != (8, 3) else '#e0fcff'
        if d <= 4.2 and 6 <= lx <= 10:
            return Br
        if ly == 7:
            return Br
        return N

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy, a, s) in ((11, 0, 200, 0), (12, -2, 150, 0), (11, -4, 110, 0), (-2, -1, 120, 0)):
            glow(f, x0 + dx, y0 + dy, (190, 240, 255), a)
        pad(f, P, '#2e3e84', hi='#5a6ab0')
    return make(b, sleeve=7, cuff=Br, front=front)


# ================================================================= LEGENDARY
def golden_suit():
    G, H = '#f6bc36', '#fff6c0'

    def b(lx, ly, t):
        if (lx, ly) in ((8, 2), (8, 3), (8, 4), (8, 5)):
            return '#c8901e'          # placket
        if lx - ly == 4 or lx - ly == 5:
            return H                  # catches the light
        if (lx, ly) in ((9, 3),):
            return '#ffe080'
        return G

    def front(f, P, t0):
        x0, y0 = t0
        over(f, x0 + 9, y0 + 2, WHITE, 1, 'spark')
        for (dx, dy, a) in ((10, 1, 200), (11, 2, 120), (9, 0, 110), (-1, 2, 90), (12, 5, 80)):
            glow(f, x0 + dx, y0 + dy, (255, 240, 170), a)
    return make(b, sleeve=7, sleeve_col=lambda t, tone: H if tone >= 3 else G, cuff='#c8901e', front=front)


def burning_supply_suit():
    K, O, Y, R = '#24202a', '#ff7a1a', '#ffe04a', '#e0302a'

    def b(lx, ly, t):
        if (lx, ly) in ((8, 2), (8, 3), (9, 4), (9, 5), (9, 6)):
            return O                    # flame tie
        if ly <= 2 and lx >= 6:
            return '#3a3440'
        if ly == 0 or (lx <= 1 and ly <= 1):
            return R
        return K

    flame = [(-2, 0, 1), (-1, 0, 2), (-2, -1, 2), (-1, -1, 3), (-3, -2, 1), (-2, -2, 2), (-1, -2, 3),
             (-2, -3, 3), (-1, -3, 4), (-3, -4, 2), (-2, -4, 3), (-2, -5, 4), (-1, -5, 2), (-3, -6, 3),
             (0, -1, 2), (0, -2, 3), (1, -3, 2), (0, -3, 4), (1, -4, 3), (0, -4, 4), (0, -5, 3), (1, -6, 2)]

    def back(f, P):
        x0, y0 = T0(P)
        sway = int(wind(P) > 0.5)
        for (dx, dy, t) in flame:
            c = Y if t >= 4 else O if t >= 2 else R
            f.put(x0 + dx - (sway if dy < -3 else 0), y0 + dy, ramp(c), 2 if c != Y else 3, 'flame')

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy, a, c) in ((-4, -8, 220, (255, 200, 60)), (2, -9, 180, (255, 120, 40)), (-5, -4, 160, (255, 90, 40)),
                               (-1, -9, 120, (255, 220, 120)), (-4, 3, 120, (255, 120, 40)),
                               (-3, -7, 90, (255, 150, 40)), (-4, -2, 90, (255, 120, 40))):
            glow(f, x0 + dx, y0 + dy, c, a)
        # shoulder flames over the front shoulder too
        for (dx, dy, c) in ((1, -1, O), (2, -2, Y), (1, -2, O), (2, -1, R)):
            over(f, x0 + dx, y0 + dy, c, 2, 'flame')
    return make(b, sleeve=7, cuff=O, back=back, front=front)


def gm_sunrise_robe():
    O, Y, S, G = '#ff8a2a', '#ffd23c', '#fff4a0', '#ffb020'

    def b(lx, ly, t):
        if ly == 0 or lx == 8:
            return Y
        if (lx, ly) in ((9, 3), (10, 3)):
            return Y
        if ly in (6, 7) and (lx + ly) % 2:
            return '#e86a1a'
        return O

    def back(f, P):
        x0, y0 = T0(P)
        cx, cy = x0 - 1.5, y0 - 1.5
        for y in range(int(cy - 5), int(cy + 3)):
            for x in range(int(cx - 5), int(cx + 4)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if d <= 3.4:
                    t = 4 if (x + 0.5 - cx) + (y + 0.5 - cy) < -2 else 3 if d < 2.4 else 2
                    f.put(x, y, ramp(Y), t, 'sun')
        for ang in range(150, 361, 35):
            a = math.radians(ang)
            for r in (4.6, 5.4):
                f.put(int(cx + math.cos(a) * r), int(cy - abs(math.sin(a)) * r), ramp(G), 2, 'sun')
        for k in range(10):
            for i in range(0, 1 + k // 3):
                under(f, x0 + 1 - i, y0 + 1 + k, O if k < 9 else Y, 1 if i == k // 3 else 2)

    def front(f, P, t0):
        x0, y0 = t0
        skirt(f, P, lambda i, k, e: (Y, 3) if k == 2 else (O, 1 if e else 2), rows=3)
        for (dx, dy, a) in ((-7, -6, 120), (-1, -7, 110), (-8, -2, 100), (2, -5, 90)):
            glow(f, x0 + dx, y0 + dy, (255, 230, 140), a)
    return make(b, sleeve=7, sleeve_col=O, cuff=Y, back=back, front=front)


def live_candle_hoodie():
    K, G, R = '#1c1a22', '#3ce06a', '#ff3a3a'
    pr = {}
    bars = [(5, 3, 5, R), (6, 2, 4, G), (7, 3, 6, R), (8, 1, 4, G), (9, 2, 5, G), (10, 1, 3, G),
            (0, 3, 5, G), (1, 4, 6, R), (2, 2, 5, G)]
    for x, a, bb, c in bars:
        for y in range(a, bb + 1):
            pr[(x, y)] = c

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy, a, c) in ((11, 1, 170, (60, 224, 106)), (11, 2, 120, (60, 224, 106)), (11, 3, 100, (60, 224, 106)),
                               (-1, 3, 120, (60, 224, 106)), (-1, 5, 110, (255, 60, 60))):
            glow(f, x0 + dx, y0 + dy, c, a)
        over(f, x0 + 10, y0 + 0, '#b0ffc8', 3, 'spark')
    return make(K, pr, sleeve=7, back=hood_down(K), front=front, cuff=G)


def hollow_wraith_shroud():
    P, D, G = '#5a2a8a', '#2e1648', '#7affb0'

    def colfn(i, k, edge):
        if edge:
            return D, 1
        return P, 2 if (i * 2 + k) % 5 else 3

    def back(f, P_):
        cape_back(colfn, length=11, spread=0.6, top=-3, flutter=1.6, ragged=lambda i, _: i % 2 == 0)(f, P_)
        x0, y0 = T0(P_)
        # hood draped behind the head
        for (dx, dy, t) in ((-2, -4, 3), (-1, -5, 3), (0, -5, 3), (1, -5, 2), (-3, -3, 2), (-2, -3, 2), (-3, -2, 1)):
            f.put(x0 + dx, y0 + dy, ramp(P), t, 'cape')
        # ghost wisps
        for (dx, dy, t) in ((-6, 1, 3), (-7, 0, 4), (-7, -1, 3), (-8, -2, 2), (-5, 5, 3), (-6, 4, 4), (-7, 3, 2),
                            (-4, -4, 3), (-5, -5, 4), (-5, -6, 2)):
            under(f, x0 + dx, y0 + dy, G, t, 'wisp')

    def b(lx, ly, t):
        if (lx + ly * 2) % 5 == 0:
            return D
        return P

    def front(f, P_, t0):
        x0, y0 = t0
        skirt(f, P_, lambda i, k, e: (D, 1) if (i + k) % 3 == 0 else (P, 2), rows=4)
        for (dx, dy, a) in ((-6, -2, 160), (-8, -4, 120), (-4, -7, 140), (-9, 1, 100), (-3, 3, 100), (-8, -1, 90)):
            glow(f, x0 + dx, y0 + dy, (120, 255, 176), a)
    return make(b, sleeve=7, sleeve_col=lambda t, tone: D if t > 0.8 else P, back=back, front=front)


def hero_miner_jacket():
    Y, D, G, N = '#ffc82a', '#c88a1a', '#ffe070', '#f6bc36'

    def b(lx, ly, t):
        if lx == 7 and ly >= 1:
            return '#9a9aa8'
        if ly == 4 and lx <= 2 or ly == 6:
            return '#e8ecef'          # reflective bands
        if (lx, ly) in ((1, 2), (0, 2), (1, 3), (0, 1)):
            return '#fff8c0'          # glowing ore mark on the back
        return Y

    def front(f, P, t0):
        x0, y0 = t0
        # pocket with Nugget peeking out
        for dx in (8, 9, 10):
            over(f, x0 + dx, y0 + 4, D, 1, 'pocket')
            over(f, x0 + dx, y0 + 5, D, 2, 'pocket')
        for (dx, dy, t) in ((8, 3, 3), (9, 2, 4), (9, 3, 3), (10, 3, 2), (8, 2, 2)):
            over(f, x0 + dx, y0 + dy, N, t, 'nugget')
        over(f, x0 + 9, y0 + 3, INKC, 1, 'nugget')
        for (dx, dy, a) in ((-1, 1, 150), (-1, 2, 170), (-1, 3, 120), (11, 2, 100), (-2, 2, 80)):
            glow(f, x0 + dx, y0 + dy, (255, 240, 140), a)
        pad(f, P, Y, hi='#fff0a0')
    return make(b, sleeve=7, cuff='#e8ecef', front=front)


def motherlode_mech():
    G, D, H, S = '#f6bc36', '#9a6a1a', '#fff6c0', '#7a7e8e'

    def b(lx, ly, t):
        if ly in (2, 5) or lx in (3, 7):
            return D                 # frame bars
        if (lx, ly) in ((9, 3), (10, 4)):
            return H
        if ly == 7:
            return S
        return G

    def gear_disc(f, cx, cy, r, R, part):
        for y in range(int(cy - r - 2), int(cy + r + 2)):
            for x in range(int(cx - r - 2), int(cx + r + 2)):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                d = math.hypot(dx, dy)
                a = math.atan2(dy, dx)
                tooth = r + (1 if math.cos(a * 6) > 0.3 else 0)
                if d <= tooth:
                    t = 1 if d < 1.0 else (3 if dx + dy < -1 else 2)
                    f.put(x, y, R, t, part)

    def back(f, P):
        x0, y0 = T0(P)
        gear_disc(f, x0 - 2, y0 + 1, 2.8, ramp(S), 'mech')
        f.put(x0 - 2, y0 + 1, ramp(D), 1, 'mech')
        # exhaust pipes
        for k in range(4):
            f.put(x0 - 1, y0 - 2 - k, ramp(S), 3 if k % 2 else 2, 'mech')
        f.put(x0 - 1, y0 - 6, ramp(D), 1, 'mech')

    def front(f, P, t0):
        x0, y0 = t0
        pad(f, P, G, hi=H)
        for (dx, dy, c, t) in ((11, 2, S, 2), (11, 3, S, 1), (11, 5, S, 2), (11, 6, S, 1)):
            over(f, x0 + dx, y0 + dy, c, t, 'mech')
        for (dx, dy, t) in ((12, 0, 4), (13, -1, 3), (-5, -3, 4)):
            over(f, x0 + dx, y0 + dy, G, t, 'nugget')
        for (dx, dy, a) in ((12, -1, 140), (13, 0, 120), (-6, -3, 140), (-5, -4, 120)):
            glow(f, x0 + dx, y0 + dy, (255, 230, 140), a)
    return make(b, sleeve=7, sleeve_col=lambda t, tone: S if int(t * 5) % 2 else G, cuff=D, back=back, front=front)


def flying_rug_cape():
    R, Y, D, B = '#c8302e', '#f0c060', '#6a1420', '#2a4ab0'

    def back(f, P):
        x0, y0 = T0(P)
        w = wind(P)
        # rug billows out flat behind like a flying carpet, rippling
        for i in range(0, 10):
            ripple = int(round(math.sin(i * 0.9 + w * 2) * 0.8))
            ytop = y0 + 1 + i // 3 + ripple
            for k in range(4):
                x = x0 + 1 - i
                y = ytop + k
                if k in (0, 3):
                    c, t = Y, 2
                elif (i + k) % 3 == 0:
                    c, t = B, 2
                elif (i - k) % 4 == 0:
                    c, t = Y, 3
                else:
                    c, t = R, 2 if k == 1 else 1
                under(f, x, y, c, t)
            if i == 9:
                for k in (0, 2, 3):
                    under(f, x0 + 1 - i - 1, ytop + k, Y, 3, 'tassel')
        # lift shadow
        for dx in range(-3, 10):
            glow(f, x0 + dx, 25, (40, 20, 50), 0)

    def b(lx, ly, t):
        if lx <= 1 and ly <= 3:
            return Y                    # clasp straps
        return False
    return make(lambda lx, ly, t: D if (lx + ly) % 4 == 0 else '#e8dcc0', fn=b, sleeve=2.6, back=back,
                sleeve_col='#e8dcc0')


def validator_rack():
    K, S, G, L = '#3a3c48', '#6a6e7e', '#3cf06a', '#b0ffc0'

    def b(lx, ly, t):
        if ly in (1, 3, 5, 7) or lx in (0, 6):
            return S                    # rack rails
        if (lx in (8, 10) and ly in (2, 4, 6)) or (lx == 2 and ly in (2, 6)):
            return G                    # LEDs
        if (lx, ly) in ((9, 4), (1, 4)):
            return '#ff3a3a'
        return K

    def back(f, P):
        x0, y0 = T0(P)
        R = ramp(S)
        for k in range(-1, 8):
            for i in range(1, 4):
                t = 3 if i == 3 else 2 if k % 2 else 1
                f.put(x0 - i + 1, y0 + k, R, t, 'rack')
        f.put(x0 - 1, y0 + 2, ramp(G), 3, 'rack')
        f.put(x0 - 2, y0 + 4, ramp(G), 3, 'rack')
        f.put(x0 - 1, y0 + 6, ramp('#ffb03a'), 3, 'rack')
        # fan grille
        for (dx, dy) in ((-2, 0), (-1, 1), (-2, 1)):
            f.put(x0 + dx, y0 + dy, ramp('#24262e'), 2, 'rack')

    def front(f, P, t0):
        x0, y0 = t0
        pad(f, P, S, hi='#a8acbc')
        for (dx, dy, a) in ((11, 2, 150), (11, 4, 130), (11, 6, 110), (-3, 2, 120), (-3, 4, 110)):
            glow(f, x0 + dx, y0 + dy, (60, 240, 106), a)
    return make(b, sleeve=7, sleeve_col=lambda t, tone: S if int(t * 4) % 2 else K, cuff=G, back=back, front=front)


def whale_breach_coat():
    B, D, W, L = '#1e3a8a', '#12245a', '#e8f4ff', '#6ab0f0'

    whale = ['....dd......',
             '...dBBd.....',
             '..dBBBBd....',
             '..dBBBEBd...',
             '.dBBBBBBBd..',
             '.dBWWBBBBd..',
             'dBWWWBBBd...',
             'dBWWBBBd....',
             '.dBBBd......',
             'dd.dd.......']

    def back(f, P):
        x0, y0 = T0(P)
        # long coat tail behind
        for k in range(11):
            for i in range(0, 2 + k // 3):
                under(f, x0 + 1 - i, y0 + k, D if i == 1 + k // 3 else B, 1 if i == 1 + k // 3 else 2)
        # the whale breaching up from the back
        ox, oy = x0 - 9, y0 - 9
        for j, row in enumerate(whale):
            for i, ch in enumerate(row):
                if ch == '.':
                    continue
                c, t = {'d': (L, 1), 'B': (L, 2), 'W': (W, 3), 'E': (INKC, 1)}[ch]
                if ch == 'B' and i + j < 7:
                    t = 3
                f.put(ox + i, oy + j, ramp(c), t, 'whale')
        # splash ring
        for (dx, dy, t) in ((-11, 0, 3), (-10, -1, 4), (-4, -1, 4), (-3, 0, 3), (-12, -2, 3), (-2, -2, 3)):
            under(f, x0 + dx, y0 + dy, '#a8e0ff', t, 'splash')

    def b(lx, ly, t):
        if lx == 8 and ly in (2, 4, 6):
            return GOLD
        if lx == 7 and ly >= 1:
            return D
        return B

    def front(f, P, t0):
        x0, y0 = t0
        skirt(f, P, lambda i, k, e: (D, 1) if e or i == 7 else (B, 2), rows=3)
        for (dx, dy, a) in ((-13, -4, 140), (-5, -10, 150), (-13, -1, 120), (-2, -4, 110), (-7, -11, 110)):
            glow(f, x0 + dx, y0 + dy, (190, 230, 255), a)
    return make(b, sleeve=7, sleeve_col=B, cuff=L, back=back, front=front)


# ================================================================= list
ITEMS = [
    ('G094', 'Blue Overalls', 'Common', blue_overalls),
    ('G095', 'Hazard Vest', 'Common', hazard_vest),
    ('G096', 'Khaki Overalls', 'Common', khaki_overalls),
    ('G097', '400ms Tee', 'Common', tee_400ms),
    ('G098', 'Airdrop Farmer Flannel', 'Common', airdrop_flannel),
    ('G099', 'Devs Do Something Tee', 'Common', devs_do_something),
    ('G100', 'Arcade Coin Tee', 'Common', arcade_coin),
    ('G101', 'Brawl Jersey', 'Common', brawl_jersey),
    ('G102', 'Burn Tee', 'Common', burn_tee),
    ('G103', 'Cave Run Hoodie', 'Common', cave_run_hoodie),
    ('G104', 'Compressed Tee', 'Common', compressed_tee),
    ('G105', 'Diamond Hands Tee', 'Common', diamond_hands),
    ('G106', 'Floor Sweeper Smock', 'Common', floor_sweeper_smock),
    ('G107', 'Frog Face Tee', 'Common', frog_face_tee),
    ('G108', 'GM Tee', 'Common', gm_tee),
    ('G109', 'GN Tee', 'Common', gn_tee),
    ('G110', 'Green Candle Tee', 'Common', green_candle_tee),
    ('G111', 'Hat Dog Tee', 'Common', hat_dog_tee),
    ('G112', 'Wen Token Hoodie', 'Common', wen_token_hoodie),
    ('G113', 'Palm Tree Tank', 'Common', palm_tank),
    ('G114', 'Jeet Windbreaker', 'Common', jeet_windbreaker),
    ('G115', 'AFK Tee', 'Common', afk_tee),
    ('G116', 'Monke Tee', 'Common', monke_tee),
    ('G117', 'Night Shift Flannel', 'Common', night_shift_flannel),
    ('G118', 'Paper Hands Polo', 'Common', paper_hands_polo),
    ('G119', 'Probably Nothing Tee', 'Common', probably_nothing),
    ('G120', 'Red Candle Tee', 'Common', red_candle_tee),
    ('G121', 'Rent Exempt Vest', 'Common', rent_exempt_vest),
    ('G122', 'I Survived Tee', 'Common', i_survived_tee),
    ('G123', 'Ser Polo', 'Common', ser_polo),
    ('G124', 'Shrimp Tank Top', 'Common', shrimp_tank),
    ('G125', 'Solana Summer Shirt', 'Common', solana_summer_shirt),
    ('G126', 'Dusty Miner Tee', 'Common', dusty_miner_tee),
    ('G127', 'Touch Grass Tee', 'Common', touch_grass_tee),
    ('G128', 'Validator Fleece', 'Common', validator_fleece),
    ('G129', 'NGMI Tee', 'Common', ngmi_tee),
    ('G130', 'WAGMI Tee', 'Common', wagmi_tee),
    ('G131', 'Batik Digger', 'Uncommon', batik_digger),
    ('G132', 'Anon Dev Hoodie', 'Uncommon', anon_dev_hoodie),
    ('G133', 'Crash Cart Racer Jacket', 'Uncommon', crash_cart_jacket),
    ('G134', 'Blockhash Hoodie', 'Uncommon', blockhash_hoodie),
    ('G135', 'Bonding Curve Tee', 'Uncommon', bonding_curve_tee),
    ('G136', 'Breakpoint Lanyard Tee', 'Uncommon', breakpoint_lanyard),
    ('G137', 'Bat Wing Hoodie', 'Uncommon', bat_wing_hoodie),
    ('G138', 'Clan Crest Tabard', 'Uncommon', clan_crest_tabard),
    ('G139', 'Founding Miner Vest', 'Uncommon', founding_miner_vest),
    ('G140', 'Frog Raincoat', 'Uncommon', frog_raincoat),
    ('G141', 'Galaxy Brain Hoodie', 'Uncommon', galaxy_brain_hoodie),
    ('G142', 'Hopium Tracksuit', 'Uncommon', hopium_tracksuit),
    ('G143', 'Lighthouse Raincoat', 'Uncommon', lighthouse_raincoat),
    ('G144', 'Liquidation Jersey', 'Uncommon', liquidation_jersey),
    ('G145', 'Hero Replica Bib', 'Uncommon', hero_replica_bib),
    ('G146', 'Mint Day Hoodie', 'Uncommon', mint_day_hoodie),
    ('G147', 'Banana Print Shirt', 'Uncommon', banana_print_shirt),
    ('G148', 'Chain Is Fine Vest', 'Uncommon', chain_is_fine_vest),
    ('G149', 'Songket Vest', 'Uncommon', songket_vest),
    ('G150', 'Teh Tarik Apron', 'Uncommon', teh_tarik_apron),
    ('G151', 'Wau Kite Jacket', 'Uncommon', wau_kite_jacket),
    ('G152', 'Refinery Apron', 'Uncommon', refinery_apron),
    ('G153', 'Priority Fee Blazer', 'Uncommon', priority_fee_blazer),
    ('G154', 'Rug Knit Cardigan', 'Uncommon', rug_cardigan),
    ('G155', 'Seeker Squad Jacket', 'Uncommon', seeker_squad_jacket),
    ('G156', 'Sniper Bot Vest', 'Uncommon', sniper_bot_vest),
    ('G157', 'Validator Lanyard Vest', 'Uncommon', validator_lanyard_vest),
    ('G158', 'Whale Print Shirt', 'Uncommon', whale_print_shirt),
    ('G159', 'Arena Champion Straps', 'Rare', arena_champion_straps),
    ('G160', 'Mole King Robe', 'Rare', mole_king_robe),
    ('G161', 'Diamond Chestplate', 'Rare', diamond_chestplate),
    ('G162', 'Floor Receipt Cape', 'Rare', floor_receipt_cape),
    ('G163', 'Galaxy Brain Robe', 'Rare', galaxy_brain_robe),
    ('G164', 'Hollow Night Cloak', 'Rare', hollow_night_cloak),
    ('G165', 'Hopium Tank Suit', 'Rare', hopium_tank_suit),
    ('G166', 'Margin Call Suit', 'Rare', margin_call_suit),
    ('G167', 'Old Glow Vest', 'Rare', old_glow_vest),
    ('G168', 'Motherlode Plate', 'Rare', motherlode_plate),
    ('G169', 'Durian Armour', 'Rare', durian_armour),
    ('G170', 'Keris Guard Vest', 'Rare', keris_guard_vest),
    ('G171', 'Paper Armour', 'Rare', paper_armour),
    ('G172', 'Seeker Squad Exosuit', 'Rare', seeker_exosuit),
    ('G173', 'Sniper Ghillie Suit', 'Rare', sniper_ghillie),
    ('G174', 'Summer Surf Suit', 'Rare', summer_surf_suit),
    ('G175', 'This Is Fine Hoodie', 'Rare', this_is_fine_hoodie),
    ('G176', 'Whale Diver Suit', 'Rare', whale_diver_suit),
    ('G177', 'Golden Suit', 'Legendary', golden_suit),
    ('G178', 'Burning Supply Suit', 'Legendary', burning_supply_suit),
    ('G179', 'GM Sunrise Robe', 'Legendary', gm_sunrise_robe),
    ('G180', 'Live Candle Hoodie', 'Legendary', live_candle_hoodie),
    ('G181', 'Hollow Wraith Shroud', 'Legendary', hollow_wraith_shroud),
    ('G182', 'Hero Miner Jacket', 'Legendary', hero_miner_jacket),
    ('G183', 'Motherlode Mech Suit', 'Legendary', motherlode_mech),
    ('G184', 'Flying Rug Cape', 'Legendary', flying_rug_cape),
    ('G185', 'Validator Rack Armour', 'Legendary', validator_rack),
    ('G186', 'Whale Breach Coat', 'Legendary', whale_breach_coat),
]

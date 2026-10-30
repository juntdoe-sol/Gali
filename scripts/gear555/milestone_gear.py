"""Gali milestone gear: shoes and clothes for levels 3, 6, 15 and 30.

  Level 3   Uncommon shoes  (1)   Baby Steps Boots
  Level 6   Uncommon top    (1)   Six Pack Tee
  Level 15  Rare shoes      (3)   one at random
  Level 30  Legendary outfit (10) top + matching pants, one outfit at random

Same authoring as shoes.py (mk grid, toe right, last row the sole), tops.py (make, torso lx 0..10 / ly 0..7)
and bottoms.py (pants, leg grid gx 0..2 / gy 0..7).
"""
import math
import sys

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import tops as TP  # noqa: E402
import bottoms as BT  # noqa: E402
from shoes import mk  # noqa: E402

WHITE = '#f4f0e8'


# ================================================================ Level 3: Uncommon shoes
def baby_steps_boots():
    # first real work boots: tan leather, green laces, and an XP bar on the side 3 of 10 full
    return mk(['tt.....',
               'tLt....',
               'tLtt...',
               'tgggxxx',
               'ttttttt',
               'ddddddd'],
              {'t': '#c89058', 'L': ('#4ae06a', 3), 'g': ('#4ae06a', 4), 'x': ('#3a3048', 1), 'd': ('#5a3a24', 1)})


# ================================================================ Level 6: Uncommon top
def six_pack_tee():
    # a black tee with six ORE nuggets printed on the belly, 2 x 3, like abs
    K, N, H = '#26222e', '#2ad0c8', '#c8fff4'
    prints = {}
    for (x, y) in ((8, 2), (10, 2), (8, 4), (10, 4), (8, 6), (10, 6)):
        prints[(x, y)] = N
    prints[(8, 2)] = H
    prints[(10, 4)] = H
    return TP.tee(K, prints, sleeve=2.6, cuff=N)


# ================================================================ Level 15: Rare shoes
def ore_crusher_boots():
    # heavy steel boots with a teal ORE crystal for a toe cap and a riveted sole
    return mk(['ss.....',
               'sss....',
               'sRss...',
               'ssssccC',
               'sssscCc',
               'rdrdrdr'],
              {'s': '#9aa4b8', 'R': ('#e8eef8', 4), 'c': ('#2ad0c8', 3), 'C': ('#c8fff4', 4),
               'r': ('#d8dce8', 3), 'd': ('#3a3a4a', 1)})


def speedrun_sneakers():
    # white racers with a red swoosh, a gold split timer on the heel and a motion trail behind
    return mk(['...ww.....',
               '...wrw....',
               '...wrrww..',
               '-.yrrrrww.',
               '..wwwwwwww',
               '...kkkkkkk'],
              {'w': '#f4f4f8', 'r': ('#e8302a', 3), 'y': ('#ffd23c', 4), 'k': ('#2a2430', 1),
               '-': ('#ffffff', 4)}, anchor=(4, 4))


def lava_walkers():
    # obsidian boots split by glowing lava cracks, the sole burning orange
    return mk(['kk.....',
               'kok....',
               'kkok...',
               'kkkokkK',
               'kkkkokk',
               'OOyOOyO'],
              {'k': '#2a2230', 'o': ('#ff7a1a', 3), 'K': ('#4a3a50', 3), 'O': ('#ff5a1a', 3),
               'y': ('#ffe04a', 4)})


# ================================================================ Level 30: Legendary outfits
def _glow(f, x, y, rgb, a):
    TP.glow(f, x, y, rgb, a)


# 1. Ore King Regalia: red velvet robe, white fur trim, gold chain of nuggets; gold-striped royal trousers
def ore_king_robe():
    R, F, G = '#c0283a', '#f4f0e8', '#f6bc36'

    def b(lx, ly, t):
        if ly == 7 or lx in (6, 7) and ly >= 1:
            return F if (lx + ly) % 3 else '#2a2232'     # ermine with black tips
        if ly == 1 and lx >= 4 or (lx, ly) in ((9, 2), (10, 3), (8, 2)):
            return G                                  # nugget chain
        return R

    def back(f, P):
        TP.cape_back(lambda i, k, e: (F, 3) if e else (R, 2 if (i + k) % 3 else 3), length=9, spread=0.6, flutter=1.2)(f, P)

    def front(f, P, t0):
        x0, y0 = t0
        _glow(f, x0 + 9, y0 + 2, (255, 230, 140), 200)
    return TP.make(b, sleeve=7, sleeve_col=R, cuff=F, back=back, front=front)


def ore_king_trousers():
    def fn(gx, gy, s, lx, ly):
        if gx == 1:
            return '#f6bc36'
        if gy >= 7:
            return '#3a1a2a'
    return BT.pants('#8a1a2a', fn=fn, waist='#f6bc36', extra=BT.belt('#5a1020', '#2ad0c8'))


# 2. Gradient Prime Suit: purple to teal, sharp tailoring, glowing lapel line
def gradient_suit_top():
    C = ['#9a3ae8', '#7a52e0', '#5a6ad8', '#3a8ad0', '#22b0c0', '#14d0b0', '#14e8a0', '#3cf0a0']

    def b(lx, ly, t):
        if (lx, ly) in ((7, 2), (8, 3), (8, 4), (8, 5)):
            return '#ffffff'
        return C[max(0, min(7, ly))]
    return TP.make(b, sleeve=7, sleeve_col=lambda t, tone: C[min(7, int(t * 8))], cuff='#ffffff',
                   front=lambda f, P, t0: _glow(f, t0[0] + 8, t0[1] + 3, (200, 255, 240), 160))


def gradient_suit_pants():
    C = ['#3cf0a0', '#14e8a0', '#14d0b0', '#22b0c0', '#3a8ad0', '#5a6ad8', '#7a52e0', '#9a3ae8', '#9a3ae8']

    def fn(gx, gy, s, lx, ly):
        return C[max(0, min(8, gy + 1))]
    return BT.pants('#5a6ad8', fn=fn, waist='#3cf0a0', extra=BT.belt('#1a1a2a', '#ffffff'))


# 3. Pump Tracksuit: black with neon green stripes and a green candle on the chest
def pump_track_top():
    K, G = '#1c1a24', '#5aff7a'

    def b(lx, ly, t):
        if lx in (1, 2) or ly == 7:
            return G
        if lx == 9 and 2 <= ly <= 6 or (lx, ly) in ((9, 1),):
            return G if ly != 1 else '#c8ffd0'
        if lx == 8 and ly >= 1:
            return '#3a3848'      # zip
        return K
    return TP.make(b, sleeve=7, sleeve_col=lambda t, tone: G if tone >= 3 else K, cuff=G,
                   front=lambda f, P, t0: [_glow(f, t0[0] + 9, t0[1] + y, (90, 255, 120), 150) for y in (1, 3, 5)])


def pump_track_pants():
    F = ['g..', 'g..', 'g..', 'g..', 'g..', 'g..', 'g..']
    return BT.pants('#1c1a24', F, F, {'g': '#5aff7a'}, waist='#5aff7a')


# 4. Magma Core Suit: obsidian armour split by lava cracks, heat haze
def magma_top():
    K, O, Y = '#2a2230', '#ff6a1a', '#ffe04a'
    CR = {(1, 1), (2, 2), (2, 3), (3, 4), (8, 1), (9, 2), (8, 3), (9, 4), (10, 5), (5, 6), (6, 6), (7, 5), (0, 5)}

    def b(lx, ly, t):
        if (lx, ly) in CR:
            return Y if (lx + ly) % 3 == 0 else O
        return K if (lx + ly) % 4 else '#3a3040'

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy) in ((9, 2), (8, 3), (10, 5), (2, 2)):
            _glow(f, x0 + dx, y0 + dy, (255, 140, 40), 170)
        TP.pad(f, P, '#3a3040')
    return TP.make(b, sleeve=7, sleeve_col=lambda t, tone: O if int(t * 7) == 3 else K, cuff=O, front=front)


def magma_pants():
    def fn(gx, gy, s, lx, ly):
        if (gx + gy * 2) % 5 == 0:
            return '#ff6a1a'
        if gy == 7:
            return '#ffe04a'
    return BT.pants('#2a2230', fn=fn, waist='#3a3040',
                    extra=BT.belt('#1a141e', '#ff6a1a'))


# 5. Frost Vein Armour: pale ice plates with deep blue veins, frost sparkles
def frost_top():
    I, V, H = '#c8ecff', '#2a6ae0', '#ffffff'

    def b(lx, ly, t):
        if (lx - ly) in (2, 6) or (lx + ly) == 9:
            return V
        if (lx, ly) in ((9, 2), (5, 1)):
            return H
        return I

    def front(f, P, t0):
        x0, y0 = t0
        TP.pad(f, P, '#a8d8ff', hi=H)
        for (dx, dy) in ((11, 1), (-1, 4), (10, 6)):
            _glow(f, x0 + dx, y0 + dy, (220, 250, 255), 220)
    return TP.make(b, sleeve=7, sleeve_col=lambda t, tone: V if int(t * 6) == 2 else I, cuff=V, front=front)


def frost_pants():
    def fn(gx, gy, s, lx, ly):
        if (gx + gy) % 4 == 0:
            return '#2a6ae0'
        if gy == 7:
            return '#ffffff'
    return BT.pants('#c8ecff', fn=fn, waist='#2a6ae0', extra=BT.belt('#1a3a8a', '#ffffff'))


# 6. Void Walker Suit: deep space black with a starfield and a nebula sash
def void_top():
    K, N = '#120e22', '#7a3ae0'
    STARS = {(1, 2), (4, 1), (9, 5), (6, 6), (2, 6), (10, 2)}

    def b(lx, ly, t):
        if lx + ly in (8, 9):
            return N if (lx + ly) == 8 else '#3a8ae8'   # nebula sash
        if (lx, ly) in STARS:
            return '#ffffff'
        return K

    def back(f, P):
        TP.cape_back(lambda i, k, e: ('#7a3ae0', 3) if e else ('#120e22', 4 if (i * 7 + k * 3) % 11 == 0 else 2),
                     length=10, spread=0.75, flutter=1.4)(f, P)

    def front(f, P, t0):
        x0, y0 = t0
        for (dx, dy) in ((-3, 3), (-4, 7), (-2, 9)):
            _glow(f, x0 + dx, y0 + dy, (255, 255, 255), 230)
    return TP.make(b, sleeve=7, sleeve_col='#120e22', cuff='#7a3ae0', back=back, front=front)


def void_pants():
    def fn(gx, gy, s, lx, ly):
        if (gx * 5 + gy * 3) % 7 == 0:
            return '#ffffff'
        if gy == 7:
            return '#7a3ae0'
    return BT.pants('#120e22', fn=fn, waist='#120e22', extra=BT.belt('#2a1a4a', '#3a8ae8'))


# 7. Overclock Hazmat: yellow hazmat suit, green reactor glow on the chest, rubber black trims
def hazmat_top():
    Y, K, G = '#ffd23c', '#2a2430', '#5aff5a'

    def b(lx, ly, t):
        if ly == 7 or lx == 0:
            return K
        if (lx, ly) in ((8, 3), (9, 3), (8, 4), (9, 4)):
            return G
        if (lx, ly) in ((7, 3), (10, 3), (8, 2), (9, 5)):
            return K
        return Y

    def back(f, P):
        x0, y0 = TP.T0(P)
        for dy in range(0, 6):
            for dx in (-2, -1):
                f.put(x0 + dx, y0 + dy, TP.ramp('#b8c0cc'), 3 if dx == -2 else 2, 'tank')
        f.put(x0 - 2, y0 - 1, TP.ramp('#5aff5a'), 4, 'tank')

    def front(f, P, t0):
        x0, y0 = t0
        _glow(f, x0 + 8, y0 + 3, (90, 255, 90), 230)
        _glow(f, x0 + 9, y0 + 4, (90, 255, 90), 180)
    return TP.make(b, sleeve=7, sleeve_col=Y, cuff=K, back=back, front=front)


def hazmat_pants():
    def fn(gx, gy, s, lx, ly):
        if gy == 3:
            return '#2a2430'
        if gy >= 6:
            return '#2a2430'
    return BT.pants('#ffd23c', fn=fn, waist='#2a2430')


# 8. Ronin Miner Gi: red lacquered plates over black, gold crest, wide hakama
def ronin_top():
    R, K, G = '#c8282a', '#1c1820', '#f6bc36'

    def b(lx, ly, t):
        if ly in (3, 5) and lx >= 1:
            return K                       # lacing between the plates
        if (lx, ly) in ((8, 1), (9, 2), (8, 2)):
            return G                       # crest
        if lx >= 6 and ly <= 1:
            return WHITE                   # inner gi collar
        return R

    def front(f, P, t0):
        TP.pad(f, P, R, hi='#ff6a5a')
    return TP.make(b, sleeve=4.5, sleeve_col=K, cuff=R, front=front)


def ronin_pants():
    def fn(gx, gy, s, lx, ly):
        if gx == 2 and gy % 2 == 0:
            return '#3a3440'
    return BT.pants('#1c1820', fn=fn, waist='#c8282a', extra=BT.belt('#f6bc36'))


# 9. Gold Rush Duster: long brown duster coat with gold nugget buttons; leather chaps over denim
def duster_top():
    B, D, G = '#8a5a32', '#5a3a22', '#f6bc36'

    def b(lx, ly, t):
        if lx in (7, 8) and ly >= 2:
            return D if lx == 7 else B
        if (lx, ly) in ((8, 3), (8, 5)):
            return G
        if ly <= 1 and lx >= 5:
            return '#e8dcc0'              # neckerchief / shirt
        return B

    def back(f, P):
        # coat tails down past the hips
        TP.cape_back(lambda i, k, e: (D, 1) if e else (B, 2 if k % 3 else 1), length=7, spread=0.35, top=4, flutter=1.6)(f, P)

    def front(f, P, t0):
        x0, y0 = t0
        _glow(f, x0 + 8, y0 + 3, (255, 220, 120), 200)
        _glow(f, x0 + 8, y0 + 5, (255, 220, 120), 160)
    return TP.make(b, sleeve=7, sleeve_col=B, cuff=D, back=back, front=front)


def duster_pants():
    def fn(gx, gy, s, lx, ly):
        if gx == 0 and gy <= 5:
            return '#6a4228'              # chaps
        if gx == 0 and gy == 2:
            return '#f6bc36'
    return BT.pants('#2f5fd0', fn=fn, waist='#5a3a22', extra=BT.belt('#3a2416', '#f6bc36'))


# 10. Astro Miner Suit: white space suit, orange stripes, ORE mission patch, life support pack
def astro_top():
    W_, O, T = '#eef0f8', '#ff7a1a', '#2ad0c8'

    def b(lx, ly, t):
        if ly == 6:
            return O
        if (lx, ly) in ((9, 2), (8, 3), (10, 3), (9, 4)):
            return T                     # ORE patch
        if (lx, ly) == (9, 3):
            return '#c8fff4'
        if lx == 0:
            return '#b8bccc'
        return W_

    def back(f, P):
        x0, y0 = TP.T0(P)
        for dy in range(-1, 6):
            for dx in (-3, -2, -1):
                f.put(x0 + dx, y0 + dy, TP.ramp('#d8dce8'), 3 if dx == -3 else 2, 'pack')
        f.put(x0 - 2, y0 + 1, TP.ramp('#ff7a1a'), 3, 'pack')
        f.put(x0 - 2, y0 + 3, TP.ramp('#2ad0c8'), 4, 'pack')

    def front(f, P, t0):
        _glow(f, t0[0] + 9, t0[1] + 3, (120, 255, 240), 160)
    return TP.make(b, sleeve=7, sleeve_col=lambda t, tone: O if int(t * 7) == 4 else W_, cuff='#b8bccc', back=back, front=front)


def astro_pants():
    def fn(gx, gy, s, lx, ly):
        if gy == 3:
            return '#ff7a1a'
        if gy >= 7:
            return '#9a9eb0'
    return BT.pants('#eef0f8', fn=fn, waist='#b8bccc', extra=BT.belt('#6a6e80', '#2ad0c8'))


# ================================================================ lists
SHOES = [
    ('Level 3', 'Uncommon', 'Baby Steps Boots', baby_steps_boots),
    ('Level 15', 'Rare', 'Ore Crusher Boots', ore_crusher_boots),
    ('Level 15', 'Rare', 'Speedrun Sneakers', speedrun_sneakers),
    ('Level 15', 'Rare', 'Lava Walkers', lava_walkers),
]
TOPS = [('Level 6', 'Uncommon', 'Six Pack Tee', six_pack_tee)]
# (name, top name, top fn, pants name, pants fn)
OUTFITS = [
    ('Ore King Regalia', 'Ore King Robe', ore_king_robe, 'Ore King Trousers', ore_king_trousers),
    ('Gradient Prime Suit', 'Gradient Prime Jacket', gradient_suit_top, 'Gradient Prime Slacks', gradient_suit_pants),
    ('Pump Tracksuit', 'Pump Track Jacket', pump_track_top, 'Pump Track Pants', pump_track_pants),
    ('Magma Core Suit', 'Magma Core Plate', magma_top, 'Magma Core Greaves', magma_pants),
    ('Frost Vein Armour', 'Frost Vein Plate', frost_top, 'Frost Vein Greaves', frost_pants),
    ('Void Walker Suit', 'Void Walker Coat', void_top, 'Void Walker Pants', void_pants),
    ('Overclock Hazmat', 'Overclock Hazmat Top', hazmat_top, 'Overclock Hazmat Pants', hazmat_pants),
    ('Ronin Miner Gi', 'Ronin Miner Plate', ronin_top, 'Ronin Miner Hakama', ronin_pants),
    ('Gold Rush Duster', 'Gold Rush Duster', duster_top, 'Gold Rush Chaps', duster_pants),
    ('Astro Miner Suit', 'Astro Miner Suit', astro_top, 'Astro Miner Pants', astro_pants),
]


# ================================================================ catalogue ids (after the Level 10 / 20 weapons)
def _market():
    out = [('G562', 'shoe', SHOES[0][2], 'Uncommon', 'Level 3', SHOES[0][3]),
           ('G563', 'top', TOPS[0][2], 'Uncommon', 'Level 6', TOPS[0][3])]
    for k, (lv, r, n, fn) in enumerate(SHOES[1:]):
        out.append((f'G{564 + k}', 'shoe', n, 'Rare', 'Level 15', fn))
    gid = 567
    for (_, tn, tf, pn, pf) in OUTFITS:
        out.append((f'G{gid}', 'top', tn, 'Legendary', 'Level 30', tf))
        out.append((f'G{gid + 1}', 'bottom', pn, 'Legendary', 'Level 30', pf))
        gid += 2
    return out


# (id, rig key, name, rarity, set, fn)
MARKET = _market()

"""Gali milestone weapons: claimed with the Level 10 (Rare) and Level 20 (Legendary) certificates.

A certificate gives one of its level's three weapons at random when the Gali NFT market opens.
Same wbase.A authoring as weapons.py (idle view, '@' is the head joint, the handle enters from the right).
"""
from wbase import A  # noqa: E402

SLOT = 'weapon'
STEEL = '#aab4c6'
GOLD = '#f4bf2a'


# ---------------- Level 10 (Rare) ----------------
def ten_bagger_pick():
    # a steel pick with a fat money bag tied to the lower tip: level 10 = a ten-bagger
    art = ['...T.......',
           '..mm.......',
           '.Hmm.......',
           '.mmm.......',
           'dmm@c......',
           '.mmm.......',
           '.mmd.......',
           '..md.......',
           '..rT.......',
           '.rr........',
           'sss........',
           'sSSs.......',
           'SgSSs......',
           'SggSs......',
           'SgSSs......',
           'sSSs.......',
           '.ss........']
    return A(art, {'m': STEEL, 'H': ('#ffffff', 4), 'd': (STEEL, 1), 'T': ('#e8eef8', 4), 'c': ('#5a3a28', 1),
                   'r': ('#c8302c', 2), 's': ('#a8743a', 1), 'S': ('#d8a85a', 3), 'g': ('#3ad86a', 4)},
             handle='#6a4a32')


def level_up_pick():
    # the top tip is a big green LEVEL UP arrow, the bottom tip a little one, plus-sparkles around
    art = ['....g.....',
           '...ggg....',
           '..ggGgg...',
           '.ggGGGgg..',
           '...gGg..+.',
           '...gGg....',
           '..+mmm....',
           '..dmm@c...',
           '...mmm....',
           '...mmg..+.',
           '....ggg...',
           '.....g....']
    return A(art, {'g': ('#3ad86a', 3), 'G': ('#c8ffb8', 4), 'm': '#2a8a4a', 'd': ('#2a8a4a', 1),
                   'c': ('#1a3a28', 1), '+': ('#c8ffb8', 4)}, handle='#3a2a2a')


def xp_bar_blade():
    # the blade is an XP bar, 8 of 10 segments full, pointed at the end
    art = ['.oooooooooooo..',
           'oGGGGGGGGGGkko.',
           'oGgGgGgGgGgkk@c',
           'oGGGGGGGGGGkko.',
           '.oooooooooooo..']
    return A(art, {'o': ('#e8eef8', 4), 'G': ('#3ad86a', 3), 'g': ('#1aa84a', 2), 'k': ('#2a3048', 1),
                   'c': ('#b8862a', 2)}, handle='#3a2a2a', at='o')


# ---------------- Level 20 (Legendary) ----------------
def wen_moon_hammer():
    # the hammer head is a rocket, nose up, flame down: wen moon? Level 20
    art = ['...rr...',
           '..rWWr..',
           '..WWWW..',
           '..WbbW..',
           '..WbbW..',
           '.rWWWWr.',
           'rrW@WWrr',
           '.rWWWWr.',
           '..yooy..',
           '..oyyo..',
           '.y.oo.y.',
           '...yy...',
           '.y..y...']
    art = [r + 'c' if i == 6 else r for i, r in enumerate(art)]
    art[6] = 'rrWWW@c'
    return A(art, {'r': ('#e8302c', 2), 'W': ('#f4f0e6', 3), 'b': ('#4fd6ef', 4), 'y': ('#ffe84a', 4),
                   'o': ('#ff8a1a', 3), 'c': ('#5a5a6a', 1)}, handle='#3a3446', at='W', glow='#ff8a1a')


def bull_run_axe():
    # thick golden bull horns curl up and down off a bull's head, red eyes, a gold nose ring, green candles
    art = ['YY...........',
           'yYY.....g....',
           '.yYY....g....',
           '..yYYb.......',
           '...ybbbb.....',
           '..bbRbbb.....',
           '.bbbbbbb@c...',
           '..nnobbb.....',
           '...ybbb...g..',
           '..yYYb....g..',
           '.yYY.........',
           'yYY..........',
           'YY...........']
    return A(art, {'y': GOLD, 'Y': ('#fff4a0', 4), 'b': ('#8a4a2a', 2), 'R': ('#ff3a3a', 4), 'n': ('#e8b04a', 3),
                   'o': ('#ffd84a', 4), 'g': ('#3ad86a', 4), 'c': ('#5a3a28', 1)}, handle='#5a3420', at='b', glow='#ffd84a')


def genesis_block_hammer():
    # a glowing gold cube for a hammer head (block zero), with a short chain of smaller blocks on the handle
    art = ['.tttttt.......',
           'tTTTTTts......',
           'tTyyyyts......',
           'tTyYyyts......',
           'tTyyyy@slkk...',
           'tTyyyyts..kk..',
           'tsssssss......',
           '.ssssss.......']
    return A(art, {'t': ('#fff4a0', 4), 'T': ('#ffd84a', 3), 'y': GOLD, 'Y': ('#ffffff', 4),
                   's': ('#b8862a', 1), 'l': ('#4fd6ef', 3), 'k': ('#f4bf2a', 2)},
             handle='#3a2a1a', at='y', glow='#4fd6ef')


ITEMS = [
    ('G556', 'Ten Bagger Pick', 'Rare', ten_bagger_pick),
    ('G557', 'Level Up Pick', 'Rare', level_up_pick),
    ('G558', 'XP Bar Blade', 'Rare', xp_bar_blade),
    ('G559', 'Wen Moon Hammer', 'Legendary', wen_moon_hammer),
    ('G560', 'Bull Run Axe', 'Legendary', bull_run_axe),
    ('G561', 'Genesis Block Hammer', 'Legendary', genesis_block_hammer),
]

"""Helpers for the weapons slot (Gali Gear 555).

Art is authored in IDLE VIEW: how the weapon looks resting on the miner's
shoulder. The handle enters from the RIGHT; '@' marks the head joint J (the end
of the handle); up in the art is +v (the striking side in a swing); left in the
art is +u (away from the hand). A(...) converts this to a kit.Weapon grid.
"""
from kit import Weapon


def A(art, legend, handle='#a0703f', at='m', butt=1.2, glow=None):
    if isinstance(art, str):
        art = [r for r in art.strip('\n').split('\n')]
    r0 = c0 = None
    for r, row in enumerate(art):
        if '@' in row:
            r0, c0 = r, row.index('@')
    cells = {}
    for r, row in enumerate(art):
        for c, ch in enumerate(row):
            if ch in ' .':
                continue
            if ch == '@':
                ch = at
            cells[(c0 - c, r0 - r)] = ch    # (u, v)
    us = [u for u, v in cells] + [0]
    vs = [v for u, v in cells] + [0]
    u0, v0, u1, v1 = min(us), min(vs), max(us), max(vs)
    rows = [''.join(cells.get((u, v), '.') for u in range(u0, u1 + 1)) for v in range(v0, v1 + 1)]
    leg = {}
    for k, s in legend.items():
        leg[k] = s
    return Weapon(rows, leg, (-u0, -v0), handle=handle, butt=butt, glow=glow)


def edit(art, changes):
    """changes: {(row, col): ch}; grows the art to fit."""
    art = [list(r) for r in art]
    for (r, c), ch in changes.items():
        while len(art) <= r:
            art.append([])
        row = art[r]
        while len(row) <= c:
            row.append('.')
        row[c] = ch
    w = max(len(r) for r in art)
    return [''.join(r).ljust(w, '.') for r in art]


# stock crescent, '@' at (4, 2)
PICK = ['..T.',
        '..m.',
        '.Hm.',
        '.mm.',
        'dm@c',
        '.mm.',
        '.md.',
        '..d.',
        '..T.']

# heavier crescent, '@' at (4, 3)
FAT = ['...T.',
       '..mm.',
       '.Hmm.',
       '.mmm.',
       'dmm@c',
       '.mmm.',
       '.mmd.',
       '..md.',
       '...T.']

# legendary crescent, '@' at (5, 4)
BIG = ['....T.',
       '...mm.',
       '..Hmm.',
       '.Hmmm.',
       '.mmmm.',
       'dmmm@c',
       '.mmmm.',
       '.mmmd.',
       '..mmd.',
       '...md.',
       '....T.']


def pleg(metal, collar='#3a2a30', tip=None, hi=None, dark=None):
    return {'m': metal, 'T': (tip or metal, 3) if tip is None else tip,
            'H': (hi or metal, 4) if hi is None else hi,
            'd': (dark or metal, 1) if dark is None else dark,
            'c': (collar, 1)}


def pad(art, top=0, left=0, bottom=0, right=0):
    w = max(len(r) for r in art)
    art = [r.ljust(w, '.') for r in art]
    art = ['.' * left + r + '.' * right for r in art]
    W = w + left + right
    return ['.' * W] * top + art + ['.' * W] * bottom


def P(metal, handle, shape=None, ch=None, leg=None, **kw):
    """Pick built on a crescent shape plus edits {(row, col): ch} (cols may go
    right of '@' to decorate the handle: col c0+k is k px down the handle)."""
    art = list(shape or PICK)
    if ch:
        art = edit(art, ch)
    L = pleg(metal, **{k: kw.pop(k) for k in ('collar', 'tip', 'hi', 'dark') if k in kw})
    if leg:
        L.update(leg)
    return A(art, L, handle=handle, **kw)


def at(art):
    for r, row in enumerate(art):
        if '@' in row:
            return r, row.index('@')

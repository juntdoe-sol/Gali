"""Reference examples for each slot. Copy these patterns."""
from kit import Top, Bottom, Shoe, Weapon, ramp, pet_frame, pet_render

WHITE = '#f6f2ea'


# ---------------------------------------------------------------- tops
def gm_tee():
    """White tee, black 'gm' print on the chest, short sleeves."""
    G = {(6, 3), (5, 3), (5, 4), (6, 5), (5, 5), (8, 3), (8, 4), (9, 3), (9, 4), (7, 3), (7, 4)}

    def colour(lx, ly, tone):
        if (lx, ly) in G:
            return '#2a2430'
        if ly == 0 and 3 <= lx <= 6:
            return '#d8d2c8'   # collar
        return WHITE
    return Top(colour, sleeve=2.6)


def hazard_vest():
    """Orange vest over the white singlet, reflective stripes."""
    def colour(lx, ly, tone):
        if ly in (3, 5):
            return '#e8ecef'
        if lx in (3, 4) and ly < 3:
            return None        # keep the singlet showing at the neck
        return '#ff7a1a'
    return Top(colour)


# ---------------------------------------------------------------- bottoms
def camo_cargo():
    def colour(lx, ly, tone, side):
        k = (int(ly * 1.7) * 3 + int(lx * 2 + 3) * 5) % 7
        return ['#4f6b3a', '#6b8a4a', '#3a4a2a', '#4f6b3a', '#8a7a52', '#4f6b3a', '#6b8a4a'][k]
    return Bottom(colour, waist='#3a2a20')


def board_shorts():
    def colour(lx, ly, tone, side):
        return '#ff5a8a' if int(ly) % 2 else '#ffd84a'
    return Bottom(colour, length=3.2, waist='#2a2430')


# ---------------------------------------------------------------- shoes
def flip_flops():
    return Shoe(rows=['.s...',
                      'sSSSs',
                      'fffff'],
                legend={'s': 'skin', 'S': 'skin', 'f': '#3ab0e0'})


def clown_shoes():
    return Shoe(rows=['.rr....',
                      'rrrRRR.',
                      'RRRRRRR',
                      'yyyyyyy'],
                legend={'r': '#e8302c', 'R': ('#e8302c', 1), 'y': '#ffd84a'},
                anchor=(1, 1))


# ---------------------------------------------------------------- weapons
def baguette():
    """A loaf for a head: long along the handle."""
    return Weapon(head=['.bbbbbb.',
                        'bBBBBBBb',
                        '.bbbbbb.'],
                  legend={'b': '#d8a050', 'B': ('#e8c080', 3)},
                  origin=(1, 1), handle='#d8a050', butt=0.5)


def war_axe():
    """Big single bit on the upper side, spike on the lower side."""
    return Weapon(head=['.ss.',
                        'sSSs',
                        'sSSs',
                        '.hh.',
                        '.kk.'],
                  legend={'s': '#c9ced8', 'S': ('#e8edf5', 3), 'k': '#7a8090'},
                  origin=(1, 3), handle='#6b4228')


# ---------------------------------------------------------------- pets
def pet_slime(t):
    """Green slime blob, bouncing."""
    R = ramp('#5ed46a')
    f = pet_frame(14, 12)
    sq = (0, 1, 0, -1)[t]
    f.blob(7, 7.5 + sq * 0.5, 5.5 + sq * 0.6, 3.8 - sq * 0.6, R, (1, 2, 2, 3), 'body')
    f.put(9, 7, 'eye', 0, 'face')
    f.put(6, 7, 'eye', 0, 'face')
    f.put(5, 5 + (sq > 0), R, 4, 'body')
    return pet_render(f)

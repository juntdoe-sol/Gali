"""Gali Gear 555: Axes & Weapons slot (93 items, G371..G463).

Art is authored in idle view with the wbase.A helper: '@' is the head joint,
the handle enters from the right, the top of the art is the striking side.
"""
import sys

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from wbase import A, P, PICK, FAT, BIG, edit, pleg  # noqa: E402

SLOT = 'weapon'

IRON = '#8d97ab'
STEEL = '#aab4c6'
DKWOOD = '#4a3428'
WOOD = '#9a6236'
TAN = '#d8b47c'
GOLD = '#f4bf2a'
WHITE = '#f4f0e6'
INKP = '#2a2236'   # near-black purple for "black" items
TEAL = '#3de0c8'


def rot(glyph):
    """Screen glyph (as read while the pick is held overhead) -> art rows."""
    h, w = len(glyph), max(len(r) for r in glyph)
    g = [r.ljust(w, '.') for r in glyph]
    # art(row, col) = glyph(x=W-1-row, y=col)
    return [''.join(g[c][w - 1 - r] for c in range(h)) for r in range(w)]


# ============================================================ COMMONS
def besi_pick():
    return P(IRON, DKWOOD, ch={(2, 1): 'H', (3, 1): 'H'}, collar='#2a2028')


def kayu_pick():
    return P('#ecd29c', '#8a5a32', ch={(3, 1): 'g', (6, 2): 'g', (1, 2): 'g'},
             leg={'g': ('#c8a066', 2)}, collar='#5a3a22')


def anon_pick():
    art = ['...T.',
           '..mm.',
           '.mqm.',
           '.mmq.',
           'dmq@c',
           '.mmm.',
           '.mqd.',
           '..md.',
           '...T.']
    return A(art, {'m': INKP, 'T': (INKP, 3), 'd': (INKP, 1), 'q': ('#d8dce8', 4),
                   'c': ('#5a5a6a', 1)}, handle='#3a3446')


def expired_pick():
    art = ['...T.....',
           '..mm.....',
           '.mxxx....',
           '.mmxm....',
           'dmxx@cxh.',
           '.mmmm..x.',
           '.mmd.....',
           '..md.....',
           '...T.....']
    # x: faded hourglass; c crack on the handle
    art[4] = 'dxxx@ckhk'
    art[2] = '.mxxx....'
    art[3] = '.mmxm....'
    return A(art, {'m': '#9aa0ac', 'T': ('#9aa0ac', 3), 'd': ('#9aa0ac', 1),
                   'x': ('#e8d8a8', 2), 'c': ('#4a3428', 1), 'k': ('#2e2024', 1),
                   'h': ('#8a6a4a', 2)}, handle='#8a6a4a')


def curve_pick():
    art = ['..T......',
           '..m......',
           '.Hm......',
           '.mm......',
           'dm@cg....',
           '.mm..gg..',
           '.md....gg',
           '..d......',
           '..T......']
    # g: the handle bends upward into the head like a rising curve
    art = ['..T......',
           '..m......',
           '.Hm......',
           '.mm.hh...',
           'dm@h..h..',
           '.mm....hh',
           '.md......',
           '..d......',
           '..T......']
    return A(art, pleg('#9aa0ac', collar='#4a3428'), handle='#7a8a5a')


def arena_club():
    art = ['.wwwww...',
           'wnwwwnww.',
           'wWWnWWWw@',
           'wwwwwwww.',
           '.wwwww...']
    art = ['..wwww....',
           '.wnwwnww..',
           'wwWWWWWww@',
           'wwwwnwww..',
           '.wwwww....']
    return A(art, {'w': '#9a5a2c', 'W': ('#9a5a2c', 3), 'n': ('#c8ccd8', 4)},
             handle='#7a4626', at='w')


def cave_run_pick():
    art = edit(PICK, {(4, 8): 'f', (3, 8): 'F', (4, 9): 'f'})
    return A(art, dict(pleg('#4a4e5e', collar='#2a2028'), f=('#ff7a1a', 2), F=('#ffd84a', 3)),
             handle='#6b4a32')


def rookie_shovel():
    art = ['.sss.....',
           'sssss....',
           'sSSSskk@.',
           'sssss....',
           '.sss.....']
    return A(art, {'s': '#a8b0c0', 'S': ('#a8b0c0', 3), 'k': ('#6a7080', 1)},
             handle='#f0c030', at='h')


def frog_pick():
    art = ['.ee.....',
           'eWe.....',
           '.GGG....',
           'GgGGG...',
           'GmGGG@c.',
           'GgGGG...',
           '.GGG....',
           'eWe.....',
           '.ee.....']
    return A(art, {'G': '#5ec44a', 'g': ('#5ec44a', 1), 'm': ('#2e7a3a', 1),
                   'e': ('#5ec44a', 3), 'W': ('#ffffff', 2), 'c': ('#3a5a2a', 1)},
             handle=WOOD, at='G')


def gm_pick():
    art = edit(PICK, {(4, 6): 's', (3, 6): 'r', (5, 6): 'r', (4, 7): 'r', (4, 5): 'r',
                      (1, 1): 'H', (0, 2): 'o', (8, 2): 'o', (6, 1): 'o'})
    return A(art, dict(pleg('#ffcf3a', collar='#a04a1a'), s=('#fff4b0', 3), r=('#ffcf3a', 2),
                       o=('#ff9a2a', 2)), handle='#e8742a')


def big_brain_pick():
    art = ['..pp.',
           '.pPpp',
           'pPwpp',
           'pwPwp',
           'pPpw@c',
           'pwpPp',
           'pPwpp',
           '.pwp.',
           '..pp.']
    return A(art, {'p': '#ff8ab8', 'P': ('#ff8ab8', 3), 'w': ('#c84a80', 1),
                   'c': ('#4a2a6a', 1)}, handle='#8a4ad8', at='p')


def up_only_pick():
    art = ['...g...',
           '..ggg..',
           '.gGgGg.',
           'ggggggg',
           '..ggg..',
           '..ggg..',
           '...@c..']
    return A(art, {'g': '#3ad85a', 'G': ('#3ad85a', 4), 'c': ('#2a7a3a', 1)},
             handle='#f0ece0', at='g')


def hat_dog_pick():
    art = ['..bb...',
           '.kbbb..',
           'ppbeb..',
           'pPbbbb.',
           'ppbbn@c',
           'pPbbbb.',
           'ppbeb..',
           '.kbbb..',
           '..bb...']
    art = ['.bb....',
           'pbbe...',
           'ppbbb..',
           'pPbbbb.',
           'ppbbbn@',
           'pPbbbb.',
           'ppbbb..',
           'pbbe...',
           '.bb....']
    return A(art, {'b': '#a8642e', 'e': ('#2a1a1a', 0), 'n': ('#2a1a1a', 1),
                   'p': '#ff8ac0', 'P': ('#ff8ac0', 4)}, handle=TAN, at='b')


def pumpkin_pick():
    art = ['..oo..',
           '.oOoo.',
           'oOoroo',
           'sOoroo',
           'sooro@c',
           'oOoroo',
           'oOoroo',
           '.oOoo.',
           '..oo..']
    return A(art, {'o': '#ff8a1a', 'O': ('#ff8a1a', 3), 'r': ('#ff8a1a', 1),
                   's': '#4aa83a', 'c': ('#2a1a10', 1)}, handle='#2e2a36', at='o')


def copium_pick():
    art = edit(PICK, {(3, 5): 'a', (4, 5): 'A', (5, 5): 'a', (3, 6): 'a', (4, 6): 'A',
                      (5, 6): 'a', (4, 4): 's', (4, 7): 's', (2, 6): 's', (6, 5): 's'})
    return A(art, dict(pleg('#8fae8a', collar='#3a4a3a'), a=('#9ad8f0', 3), A=('#9ad8f0', 2),
                       s=('#e8f4f8', 3)), handle='#7a6a5a')


def hopium_pick():
    art = edit(PICK, {(3, 6): 'w', (4, 6): 'w', (5, 6): 'w', (3, 7): 'W', (4, 7): 'w', (5, 7): 'w',
                      (2, 7): 'w', (6, 7): 'W', (4, 8): 'w', (3, 8): 'w', (5, 8): 'W'})
    return A(art, dict(pleg('#6cc4ff', collar='#2a5a8a'), w=('#ffffff', 2), W=('#c8e0f0', 2)),
             handle='#f0f4f8')


def coconut_pick():
    art = ['...T.',
           '..mm.',
           '.mfm.',
           '.mmw.',
           'mfmw@c',
           '.mmw.',
           '.mfw.',
           '..mw.',
           '...T.']
    return A(art, {'m': '#8a5430', 'T': ('#8a5430', 1), 'f': ('#5a3420', 1),
                   'w': ('#fff4e0', 3), 'c': ('#3a5a2a', 1)}, handle='#5aa83a')


def pool_noodle():
    art = ['oppp.......',
           'oPPPppp....',
           '...PPPPpp..',
           '.......ppp@']
    return A(art, {'p': '#ff6ab0', 'P': ('#ff6ab0', 3), 'o': ('#a83a7a', 1)},
             handle='#ff6ab0', at='p', butt=0.6)


def mint_day_hammer():
    art = ['.mmm..',
           'mMmm..',
           'mMmm..',
           'mmmm@c',
           'mmmm..',
           'mmmd..',
           '.mdd..']
    return A(art, {'m': '#6ae8b0', 'M': ('#6ae8b0', 4), 'd': ('#6ae8b0', 1),
                   'c': ('#2a7a5a', 1)}, handle='#f4f0e6', at='h')


def banana_pick():
    art = ['..T..',
           '..y..',
           '.Yy..',
           '.Yy..',
           'yYyc@',
           '.yy..',
           '.yy..',
           '..y..',
           '..T..']
    art = ['..T..',
           '.yy..',
           'Yyy..',
           'Yyd..',
           'Yyd@.',
           'Yyd..',
           'Yyy..',
           '.yy..',
           '..T..']
    return A(art, {'y': '#ffe04a', 'Y': ('#ffe04a', 4), 'd': ('#ffe04a', 1),
                   'T': ('#5a3a1a', 2)}, handle=WOOD, at='h')


def stop_sign_paddle():
    art = ['..rrr....',
           '.rrrrr...',
           'rwwwwwr..',
           'rRRRRRrh@',
           'rwwwwwr..',
           '.rrrrr...',
           '..rrr....']
    return A(art, {'r': '#e8302c', 'R': ('#e8302c', 2), 'w': ('#ffffff', 2)},
             handle='#9aa0ac', at='h')


def night_shift_pick():
    art = edit(PICK, {(0, 2): 'W', (0, 1): 'W', (1, 1): '.'})
    art = ['.WT.',
           '..m.',
           '.Hm.',
           '.mm.',
           'dm@c',
           '.mm.',
           '.md.',
           '..d.',
           '..T.']
    return A(art, dict(pleg('#2e3e8a', collar='#2a1a4a'), W=('#ffffff', 2), T=('#fff4c0', 3)),
             handle='#8a4ad8')


def copper_pick():
    return P('#d8763a', '#7a4a2a', ch={(2, 1): 'W'}, leg={'W': ('#ffe0c0', 3)}, collar='#4a2a1a')


def sold_early_pick():
    art = edit(PICK, {(5, 5): 's', (6, 5): 't', (6, 4): 't', (7, 4): 't', (7, 5): 't',
                      (8, 5): 't', (6, 6): 't', (7, 6): 'x', (8, 6): 't'})
    return A(art, dict(pleg('#9aa0ac', collar='#3a3030'), s=('#d8d0c0', 1),
                       t=('#ffffff', 2), x=('#e8302c', 2)), handle=WOOD)


def priority_pick():
    art = edit(PICK, {(3, 5): 'o', (4, 5): 'O', (4, 6): 'o', (3, 6): 'O', (5, 5): 'o', (5, 6): 'o', (4, 4): 'o'})
    art = edit(PICK, {(3, 5): 'O', (3, 6): 'o', (4, 5): 'o', (4, 6): 'O', (5, 5): 'o', (5, 6): 'o'})
    return A(art, dict(pleg('#c07a3a', collar='#4a2a1a'), o=(GOLD, 2), O=(GOLD, 4)), handle=WOOD)


def down_bad_pick():
    art = ['...@c..',
           '..ggg..',
           '..ggg..',
           'ggggggg',
           '.gGgGg.',
           '..ggg..',
           '...g...']
    return A(art, {'g': '#e8302c', 'G': ('#e8302c', 4), 'c': ('#7a1a1a', 1)},
             handle='#9aa0ac', at='g')


def rent_paid_pick():
    art = edit(PICK, {(4, 5): 'p', (4, 6): 'P', (4, 7): 'p', (3, 6): 'p', (5, 6): 'p'})
    art = edit(PICK, {(3, 5): 'p', (3, 6): 'p', (3, 7): 'p', (4, 5): 'P', (4, 6): 'p', (4, 7): 'P',
                      (5, 5): 'p', (5, 6): 'p', (5, 7): 'p'})
    return A(art, dict(pleg('#e8d4a8', collar='#5a4a2a'), p=('#3ac85a', 2), P=('#c8f8c8', 3)),
             handle=WOOD)


def rusty_pick():
    art = ['..r.',
           '..mm',
           '.rm.',
           '.mm.',
           'rm@c',
           '.rm.',
           '.mr.',
           '..d.',
           '..T.']
    art = ['....',
           '....',
           '..m.',
           '.rm.',
           'dm@c',
           '.mr.',
           '.rd.',
           '..d.',
           '..T.']
    return A(art, {'m': '#b8602a', 'r': ('#7a3a1a', 1), 'd': ('#b8602a', 1),
                   'T': ('#b8602a', 2), 'c': ('#3a2020', 1)}, handle='#8a909c')


def seeker_pick():
    art = edit(PICK, {(3, 5): 'p', (3, 6): 'p', (3, 7): 'p', (3, 8): 'p',
                      (4, 5): 'p', (4, 6): 's', (4, 7): 's', (4, 8): 'p',
                      (5, 5): 'p', (5, 6): 'p', (5, 7): 'p', (5, 8): 'p'})
    return A(art, dict(pleg(INKP, collar='#1a1a22'), p=('#24242e', 2), s=(TEAL, 3)),
             handle=TEAL)


def ser_pick():
    art = edit(PICK, {(3, 4): 'r', (5, 4): 'r', (3, 6): 'r', (5, 6): 'r', (4, 5): 'R'})
    art = edit(PICK, {(3, 5): 'r', (5, 5): 'r', (3, 7): 'r', (5, 7): 'r', (4, 6): 'R',
                      (4, 5): 'h', (4, 7): 'h'})
    L = dict(pleg(INKP, collar='#1a1a22'), r=('#e8302c', 2), R=('#e8302c', 1))
    return A(art, L, handle='#f4f0e6')


def shrimp_pick():
    art = ['.T.....',
           '.m.....',
           'mm@....',
           '.m.....',
           '.T...tt',
           '.....t.']
    art = ['.T......',
           'dm......',
           'mm@.....',
           'dm....tt',
           '.T...tTt',
           '......t.']
    return A(art, {'m': '#ff8a9a', 'd': ('#ff8a9a', 1), 'T': ('#ff8a9a', 3),
                   't': ('#ff8a9a', 2), 'T2': '#ff8a9a'}, handle='#ffaab4', butt=0.4)


def batu_pick():
    art = ['.ss..',
           'sSss.',
           'sSssk',
           'ssss.',
           'ssst@tt',
           'sssst.',
           '.sss.',
           '..s..']
    art = ['..ss...',
           '.sSss..',
           'sSsss..',
           'sssss..',
           'sssst@t',
           'ssss.t.',
           '.sss...',
           '..s....']
    return A(art, {'s': '#9aa0b0', 'S': ('#9aa0b0', 4), 't': ('#e0c080', 2)},
             handle='#8a5a32', at='t')


def rubber_mallet():
    art = ['.kk..',
           'kKkk.',
           'kKkk.',
           'kkkk@',
           'kkkk.',
           'kkkk.',
           '.kk..']
    return A(art, {'k': '#3a3446', 'K': ('#8a84a0', 2)}, handle='#f4f0e6', at='h')


def grass_pick():
    art = ['g....',
           '.gT..',
           'g.m..',
           '.gm..',
           'dmm@c',
           '.mm..',
           'g.m..',
           '.gd..',
           'g.T..']
    art = ['.....',
           'g..T.',
           '.g.m.',
           'g.Hm.',
           '.mmm.',
           'dmm@c',
           '.mmm.',
           'g.md.',
           '.g.d.',
           'g..T.']
    return A(art, {'m': '#4ab83a', 'H': ('#4ab83a', 4), 'd': ('#4ab83a', 1),
                   'T': ('#4ab83a', 3), 'g': ('#8ae84a', 3), 'c': ('#3a2a1a', 1)},
             handle=WOOD)


def validator_wrench():
    art = ['ss...',
           'sss..',
           '..ss@bbbb',
           'sss..',
           'ss...']
    art = ['ss.......',
           'sSs......',
           '..ss@bbbb',
           'sss......',
           'ss.......']
    return A(art, {'s': '#c8d0dc', 'S': ('#c8d0dc', 4), 'b': ('#3a6ae8', 2)},
             handle='#c8d0dc', at='h')


def ngmi_stick():
    art = ['ss...',
           '..ss@.t.']
    art = ['s.....',
           '.s....',
           '..ss@tt']
    return A(art, {'s': '#8a8f9a', 't': ('#8a5a32', 2)}, handle='#8a8f9a', at='h')


def wagmi_pick():
    return P('#8a4ad8', '#f4f0e6', tip=('#5ae85a', 3), collar='#3a2a6a',
             ch={(0, 2): 'T', (8, 2): 'T', (1, 2): 'G', (7, 2): 'G'}, leg={'G': ('#5ae85a', 2)})


# ============================================================ UNCOMMONS
def emas_pick():
    art = edit(FAT, {(1, 1): 'H', (2, 2): 'W', (1, 0): 's', (0, 4): 's'})
    art = ['.s..T.',
           '...mm.',
           '..WHm.',
           '.HHmm.',
           'smmm@c',
           '.mmmm.',
           '.mmmd.',
           '..md..',
           '...T..']
    # trail pixels on the far side
    art = ['.y...T.',
           'y...mm.',
           '...WHm.',
           'y.HHmm.',
           '.dmmm@c',
           '..mmmm.',
           '..mmmd.',
           '...md..',
           '....T..']
    return A(art, {'m': GOLD, 'H': (GOLD, 4), 'W': ('#fffbe0', 4), 'd': (GOLD, 1),
                   'T': (GOLD, 3), 'c': ('#7a4a10', 1), 'y': ('#ffe68a', 3)},
             handle='#c8901a')


def airdrop_shovel():
    art = ['.ggg.........',
           'ggggg.....www',
           'gGGGgkk@..wWw',
           'ggggg....l.l.',
           '.ggg.....ll..']
    art = ['.........www.',
           '.ggg....wwWww',
           'ggggg....l.l.',
           'gGGGgkk@..l..',
           'ggggg........',
           '.ggg.........']
    return A(art, {'g': '#4ac85a', 'G': ('#4ac85a', 3), 'k': ('#2a7a3a', 1),
                   'w': ('#ffffff', 2), 'W': ('#e8e8f0', 1), 'l': ('#c8c8d8', 2)},
             handle=WOOD, at='h')


def joystick_club():
    art = ['.rr......',
           'rRrr.....',
           'rrrrssk@.',
           'rrrr.kk..',
           '.rr.kk...']
    art = ['.rr.......',
           'rRrr...k..',
           'rrrrsss@k.',
           'rrrr...k..',
           '.rr.......']
    return A(art, {'r': '#ff3040', 'R': ('#ffd0d8', 3), 's': ('#9aa0ac', 2),
                   'k': ('#2e2a36', 2)}, handle='#2e2a36', at='k', butt=0.6)


def knuckle_pick():
    art = ['..T.....',
           '..m.....',
           '.Hm.....',
           'dmo@cggg',
           '.mm..g.g',
           '.md..ggg',
           '..T.....']
    return A(art, {'m': '#e8402c', 'H': ('#e8402c', 4), 'd': ('#e8402c', 1),
                   'T': ('#e8402c', 3), 'o': (GOLD, 4), 'c': ('#5a1a1a', 1),
                   'g': (GOLD, 2)}, handle='#5a3428', butt=0.6)


def lanyard_pick():
    art = edit(PICK, {(5, 5): 'l', (6, 5): 'l', (7, 5): 'l', (6, 6): 'l', (6, 7): 'b',
                      (5, 7): 'b', (7, 7): 'b', (5, 8): 'B', (6, 8): 'b', (7, 8): 'B',
                      (5, 9): 'b', (6, 9): 'b', (7, 9): 'b'})
    return A(art, dict(pleg(STEEL, collar='#3a3a4a'), l=('#3a8af0', 2), b=('#ffffff', 2),
                       B=('#3a8af0', 2)), handle=WOOD)


def bat_wing_pick():
    art = ['.k......',
           'kkk.....',
           '.kk.....',
           'kkkk....',
           '.kkk@c..',
           'kkkk....',
           '.kk.....',
           'kkk.....',
           '.k......']
    art = ['k.....',
           'kk....',
           '.kk...',
           'kkkk..',
           '.kkr@c',
           'kkkk..',
           '.kk...',
           'kk....',
           'k.....']
    return A(art, {'k': '#3a2a4e', 'r': ('#ff4060', 3), 'c': ('#2a1a3a', 1)},
             handle='#8a4ad8', at='k')


def clan_banner_pick():
    art = ['bbbT.',
           'bBb.m.',
           'bbb.m.',
           '..Hm.',
           '..mm.',
           '.dm@c',
           '..mm.',
           '..md.',
           '...d.',
           '...T.']
    art = ['bbbbT.',
           'bBBbm.',
           'bbbbm.',
           '..Hmm.',
           '..mmm.',
           '.dmm@c',
           '..mmm.',
           '..mmd.',
           '...md.',
           '....T.']
    return A(art, {'m': STEEL, 'H': (STEEL, 4), 'd': (STEEL, 1), 'T': (STEEL, 3),
                   'b': '#3a6ae8', 'B': ('#ffffff', 3), 'c': ('#3a3a4a', 1)},
             handle=WOOD)


def compressed_pick():
    art = ['.Ts',
           'dm@',
           '.T.']
    return A(art, {'m': '#9aa0ac', 'd': ('#9aa0ac', 1), 'T': ('#9aa0ac', 3),
                   's': (TEAL, 4)}, handle=WOOD, butt=0.2)


def diamond_tape_pick():
    art = edit(PICK, {(4, 4): 'a', (4, 5): 'b', (4, 6): 'a', (4, 7): 'b', (4, 8): 'a', (4, 9): 'b'})
    art = [r + '.....' for r in PICK]
    art[4] = 'dm@cabab'
    art[3] = '.mm..a.a'
    art[5] = '.mm.b.b.'
    art = [r.replace('.', '.') for r in art]
    return A(art, dict(pleg(STEEL, collar='#3a3a4a'), a=('#9ae0ff', 3), b=('#5ab0f0', 2)),
             handle=WOOD, at='m')


def floor_broom():
    art = ['yy.........',
           'yyY........',
           'yyYYbbb@...',
           'yYY........',
           'yy.........']
    art = ['y..........',
           'yyy........',
           'yYyyr......',
           'yyYyrhhh@..',
           'yYyyr......',
           'yyy........',
           'y..........']
    return A(art, {'y': '#f0c840', 'Y': ('#f0c840', 1), 'r': ('#e8302c', 2)},
             handle='#8a5a32', at='h')


def lighthouse_pick():
    art = ['.www.......',
           'yyyyw......',
           'yWyyrwrwr@.',
           'yyyyw......',
           '.www.......']
    art = ['..y........',
           '.ooo.......',
           'oyYyorwrwr@',
           '.ooo.......',
           '..y........']
    return A(art, {'o': '#e8302c', 'y': '#ffe04a', 'Y': ('#fffbe0', 4),
                   'r': '#e8302c', 'w': ('#ffffff', 2)}, handle='#ffffff', at='w')


def jeet_spork():
    art = ['o.o....',
           'ooo....',
           'oOoooo@',
           'ooo....',
           'o.o....']
    art = ['.o.o.....',
           'o.ooo....',
           '..oOoooo@',
           'o.ooo....',
           '.o.o.....']
    return A(art, {'o': '#ff8a2a', 'O': ('#ffd0a0', 3)}, handle='#ff8a2a', at='o', butt=0.4)


def margin_call_pick():
    art = ['..T.',
           '..m.',
           '.Hm.',
           '.mm.',
           'ttttt',
           'tt@tc',
           '.mm..',
           '.md..',
           '..d..',
           '..T..']
    art = ['..T..',
           '..m..',
           '.Hm..',
           '.mk..',
           'ttttt',
           'dmk@c',
           '.km..',
           '.md..',
           '..d..',
           '..T..']
    return A(art, {'m': '#e8302c', 'H': ('#e8302c', 4), 'd': ('#e8302c', 1), 'T': ('#e8302c', 3),
                   'k': ('#3a1020', 1), 't': ('#b8bcc8', 3), 'c': ('#3a1a1a', 1)},
             handle='#6a4430')


def cart_hammer():
    art = ['gggggg..',
           'gGGGGg..',
           'gggggg@.',
           '.k..k...']
    art = ['ggggg.',
           'gGGGg.',
           'ggggg.',
           'ggggg@',
           'gkgkg.']
    art = ['.......',
           'ooooo..',
           'gGGGg..',
           'ggggg..',
           'ggggg@c',
           'kgggk..',
           'k...k..']
    art = ['ooooo..',
           'gGGGg..',
           'ggggg..',
           'ggggg@c',
           '.k.k...']
    return A(art, {'g': '#8a909e', 'G': ('#c8ccd8', 3), 'o': ('#ffd84a', 3),
                   'k': ('#2e2a36', 2), 'c': ('#3a3a4a', 1)}, handle=WOOD, at='g')


def matts_spare_pick():
    art = edit(FAT, {(3, 2): 'o', (4, 2): 'o', (3, 3): 'O', (4, 3): 'o', (5, 3): 'o', (2, 1): 'o'})
    art = ['...T.',
           '..mm.',
           '.Hmm.',
           '.ooo.',
           'doOo@c',
           '.ooo.',
           '.mmd.',
           '..md.',
           '...T.']
    return A(art, {'m': '#ffd03a', 'H': ('#ffd03a', 4), 'd': ('#ffd03a', 1), 'T': ('#ffd03a', 3),
                   'o': ('#5a3a10', 1), 'O': ('#ffd03a', 2), 'c': ('#5a3a10', 1)}, handle=WOOD)


def batik_mallet():
    art = ['.www..',
           'wbgbw.',
           'wgbgw.',
           'wbgbw@',
           'wgbgw.',
           'wbgbw.',
           '.www..']
    return A(art, {'w': '#9a6236', 'b': ('#3a6ad8', 2), 'g': ('#f4bf2a', 3)},
             handle='#7a4a2a', at='h')


def pelita_pick():
    art = [r + '....' for r in PICK]
    art[5] = '.mm....k'
    art[6] = '.md...yfy'
    art[7] = '..d...bbb'
    art[8] = '..T....b.'
    return A(art, dict(pleg('#d8a03a', collar='#5a3a10'), k=('#5a4a3a', 2), y=('#ffe068', 4),
                       f=('#ff8a1a', 3), b=('#d8a03a', 1)), handle=WOOD)


def teh_tarik_ladle():
    art = ['.t......',
           '.t......',
           '.tt.....',
           'sss.....',
           'sSs..hh@',
           'sssh....',
           'ttt.....']
    art = ['..t......',
           '..t......',
           '.t.......',
           'ssss.....',
           'sSSshhhh@',
           'ssss.....',
           'tttt.....']
    return A(art, {'s': '#b8c0cc', 'S': ('#ffffff', 3), 't': ('#d89a5a', 3)},
             handle='#b8c0cc', at='h')


def wau_pick():
    art = ['..y...',
           '.ryy..',
           'rryyy.',
           '.rrr..',
           'rrry@c',
           '.ryy..',
           'rryyy.',
           '.ryy..',
           '..y...']
    art = ['...y..',
           '..ryy.',
           '.rryy.',
           'rrrry.',
           '.rrYy.',
           '..ry@c',
           '.rrYy.',
           'rrrry.',
           '.rryy.',
           '..ryy.',
           '...y..']
    return A(art, {'r': '#e8302c', 'y': '#ffd84a', 'Y': ('#ffd84a', 4), 'c': ('#5a1a1a', 1)},
             handle=WOOD, at='r')


def refined_pick():
    art = edit(PICK, {(1, 1): 'W', (3, 1): 'H'})
    return A(art, dict(pleg('#d8dee8', collar='#1a5a5a'), W=('#ffffff', 4)), handle='#2ab8a8')


def origami_pick():
    art = ['..w.',
           '..ww',
           '.ww.',
           '.gw.',
           'ww@c',
           '.wg.',
           '.ww.',
           '..ww',
           '..w.']
    art = ['...w.',
           '..ww.',
           '.wwg.',
           '.wgw.',
           'wwg@c',
           '.wgw.',
           '.wwg.',
           '..ww.',
           '...w.']
    return A(art, {'w': '#f8f6f0', 'g': ('#a8a8b8', 2), 'c': ('#a8a8b8', 1)}, handle='#f8f6f0', at='w')


def probably_nothing_pick():
    return P('#9aa0ac', WOOD, ch={(4, 1): 'y'}, leg={'y': ('#ffe04a', 3)}, collar='#3a3030')


def rug_club():
    art = ['.rrrrrrr...',
           'rpypyprr...',
           'rRRRRRRrt@.',
           'rpypypyr...',
           '.rrrrrr....']
    art = ['.rrrrrrr...',
           'rryryryr...',
           'rRRtRRtRhh@',
           'rryryryr...',
           '.rrrrrrr...']
    return A(art, {'r': '#c8302c', 'R': ('#e85a40', 2), 'y': ('#ffd84a', 2),
                   't': ('#d8b47c', 2)}, handle='#d8b47c', at='h')


def sniper_drill():
    art = ['..rr...',
           '..kk...',
           'bgggg..',
           'Bgggg@.',
           'bgggg..']
    art = ['....r...',
           '...kkk..',
           'b.ggggg.',
           'BBgGGGg@',
           'b.ggggg.']
    return A(art, {'g': '#8a909e', 'G': ('#c8ccd8', 3), 'k': ('#2e2a36', 2),
                   'r': ('#ff3040', 4), 'b': ('#c8ccd8', 2), 'B': ('#c8ccd8', 3)},
             handle='#5a5a6a', at='h')


def beach_spade():
    art = ['.rrr.....',
           'rrrrr....',
           'rRRRryy@.',
           'rrrrr....',
           '.rrr.....']
    art = ['..rr.....',
           '.rrrr....',
           'rRRRryyy@',
           '.rrrr....',
           '..rr.....']
    return A(art, {'r': '#e8302c', 'R': ('#ff8a7a', 3), 'y': ('#ffd84a', 2)},
             handle='#ffd84a', at='h')


def rubber_chicken():
    art = ['...........',
           'yy.........',
           'byyyyyy....',
           'yyeyyyyyoo@',
           '.r.yyyyy...',
           '....yy.....']
    art = ['.r.........',
           'yyy........',
           'oyeyy......',
           '.yyyyyyy...',
           '...yyyyyoo@',
           '....yyy....']
    return A(art, {'y': '#ffe04a', 'e': ('#2a1a1a', 1), 'o': ('#ff8a1a', 2),
                   'r': ('#e8302c', 2)}, handle='#ff8a1a', at='o', butt=0.4)


def this_is_fine_pick():
    art = ['f.y..',
           'oyT.f',
           '.om.o',
           'fHm..',
           'dmm.',
           'dm@c',
           '.mm.',
           '.md.',
           '..d.',
           '..T.']
    art = ['.f..f',
           'fo.yo',
           'oyTo.',
           '.ym..',
           '.Hm..',
           '.mm..',
           'dm@c.',
           '.mm..',
           '.md..',
           '..d..',
           '..T..']
    return A(art, dict(pleg('#9aa0ac', collar='#3a3030'), f=('#ffd84a', 3), o=('#ff6a1a', 2),
                       y=('#ffb02a', 3)), handle=WOOD)


def whale_tail_pick():
    art = ['b......',
           'bb.....',
           '.bbB...',
           '..bbbb.',
           '...bb@c',
           '..bbbb.',
           '.bbB...',
           'bb.....',
           'b......']
    art = ['bb......',
           '.bb.....',
           '..bbB...',
           '...bbb..',
           '....bbb.',
           '....bb@c',
           '....bbb.',
           '...bbb..',
           '..bbB...',
           '.bb.....',
           'bb......']
    return A(art, {'b': '#3a7ae8', 'B': ('#9ad0ff', 3), 'c': ('#1a2a5a', 1)},
             handle='#2a4aa8', at='b')


# ============================================================ RARES
def permata_pick():
    art = ['.W..T.',
           '...cc.',
           '..Wcf.',
           '.cfcc.',
           '.ccfc.',
           'dcfc@k',
           '.cfcc.',
           '.ccfd.',
           '..cfd.',
           '...dd.',
           '....T.']
    return A(art, {'c': '#3ad8f0', 'f': ('#3ad8f0', 4), 'd': ('#2a7ab8', 2),
                   'T': ('#c8f8ff', 3), 'W': ('#ffffff', 4), 'k': ('#1a3a5a', 1)},
             handle='#3a4a6a', at='c')


def neon_pick():
    art = ['..p...',
           '..pc..',
           '.pPc..',
           '.pPc..',
           'pPPc@k',
           '.pCc..',
           '.pCc..',
           '..pc..',
           '...c..']
    art = ['...p..',
           '..pPc.',
           '.pPc..',
           '.pPc..',
           '.pPc..',
           'pPc@k.',
           '.cCc..',
           '.cCc..',
           '.cCc..',
           '..cC..',
           '...c..']
    return A(art, {'p': ('#ff3aa8', 2), 'P': ('#ffd0f0', 4), 'c': ('#2ae8f0', 2),
                   'C': ('#d8ffff', 4), 'k': ('#3a2a4e', 1)}, handle='#3a2a4e', at='c')


def masked_dev_pick():
    art = ['...kk..',
           '..kkk..',
           '.kkgk..',
           '.kgkk..',
           'kkfgk@c',
           '.kgfk..',
           '.kkgk..',
           '..kkk..',
           '...k...']
    art = ['....T.',
           '...kk.',
           '..kkk.',
           '.kgfk.',
           '.kfgk.',
           'dkgf@c',
           '.kfgk.',
           '.kgfk.',
           '..kkd.',
           '...kd.',
           '....T.']
    return A(art, {'k': '#2e2a3e', 'd': ('#2e2a3e', 1), 'T': ('#5a5a6a', 2),
                   'g': ('#3aff6a', 3), 'f': ('#1a8a3a', 2), 'c': ('#5a5a6a', 1)},
             handle='#8a909e', at='k')


def tunnel_collapse_drill():
    art = ['.....rrr..',
           '..yyyRrR..',
           'tyyyyyyyy.',
           'ttYYYYYYy@',
           'tyyyyyyyy.',
           '..yyyy....']
    art = ['....rrrr..',
           '....rRrR..',
           '.yyyyyyy..',
           'tyYYYYYYy@',
           'tyyyyyyyy.',
           '.dyydyyy..']
    art = ['.....rrrr.',
           '.....rRRr.',
           '..yyyyyyy.',
           'tyyYyYyYy@',
           '..yyyyyyy.',
           '...d.d.d..']
    art = ['......rrrr.',
           '......RrRr.',
           '...yyyyyyy.',
           '.tyYyYyYyyy@',
           'tttyyyyyyy.',
           '.tyYyYyYyyy.',
           '...yyyyyyy.']
    art = ['.....rrrr..',
           '.....RrRr..',
           '..yyyyyyy..',
           'tyYyYyYyyy@',
           'ttyyyyyyyy.',
           'tyYyYyYyyy.',
           '..yyyyyyy..']
    return A(art, {'y': '#ffd03a', 'Y': ('#ffd03a', 1), 't': ('#b8bcc8', 3),
                   'r': ('#3a1a1a', 2), 'R': ('#ff3a3a', 4)}, handle='#3a3446', at='y')


def galaxy_brain_pick():
    art = ['....T.',
           '...ss.',
           '..ssW.',
           '.Wsps.',
           '.spsy.',
           'dsps@c',
           '.Wsps.',
           '.spsd.',
           '..sWd.',
           '...sd.',
           '....T.']
    return A(art, {'s': '#4a2aa8', 'p': ('#a85af0', 3), 'W': ('#ffffff', 4),
                   'y': ('#ffe68a', 4), 'd': ('#4a2aa8', 1), 'T': ('#c8a0ff', 3),
                   'c': ('#2a1a4a', 1)}, handle='#6a3ad8', at='s')


def green_candle_pick():
    art = ['.T.........',
           'dmm.ww.....',
           '.mHgggggggg@',
           'dmm.......',
           '.T........']
    art = ['..T.........',
           '..m.........',
           '.Hm.........',
           '.mm..ggggg..',
           'dmmwwgGGGGgg@',
           '.mm..ggggg..',
           '.md.........',
           '..d.........',
           '..T.........']
    art = ['..T..........',
           '..m..........',
           '.Hm..........',
           '.mm.l.gggggg.',
           'dmmhhhGGGGGgg@',
           '.mm.l.gggggg.',
           '.md..........',
           '..d..........',
           '..T..........']
    return A(art, {'m': '#9aa0ac', 'H': ('#9aa0ac', 4), 'd': ('#9aa0ac', 1), 'T': ('#9aa0ac', 3),
                   'g': '#2ad85a', 'G': ('#9affb0', 3), 'l': ('#e8e8f0', 3)},
             handle='#2ad85a', at='g', butt=0.4)


def hollow_scythe():
    art = ['.pp.........',
           'pp..........',
           'pP..........',
           'pP..........',
           '.pPPpp......',
           '..ooppppkkkk@']
    art = ['ppp..........',
           'pP...........',
           'pP...........',
           'oP...........',
           'opPPpppp.....',
           '.ooooppkkkkkk@']
    return A(art, {'p': '#d8e0e8', 'P': ('#ffffff', 3), 'o': ('#ff8a1a', 3),
                   'k': ('#2e2a36', 2)}, handle='#2e2a36', at='k', butt=1.0)


def grandpa_hals_pick():
    art = [r + '....' for r in PICK]
    art[5] = '.mm...b.'
    art[6] = '.md..b.b'
    art[7] = '..d...bb'
    art = [r + '....' for r in PICK]
    art[5] = '.mm....b'
    art[6] = '.md...b.'
    art[7] = '..d...bb'
    art[2] = '.Hs.'
    art[6] = art[6][:2] + 'r' + art[6][3:]
    return A(art, dict(pleg('#8a6a4a', collar='#3a2a1a'), b=('#e8b84a', 3), s=('#5a4030', 1),
                       r=('#5a4030', 1)), handle='#6a4a32')


def nuggets_shiny_pick():
    art = ['....T.',
           '...mr.',
           '..Wmm.',
           '.mbmg.',
           'dmmpm@c',
           '.gmmb.',
           '.mrmd.',
           '..mmd.',
           '...T..']
    art = ['...T..',
           '..mr..',
           '.Wmm..',
           '.bmg..',
           'dmpm@c',
           '.gmb..',
           '.rmm..',
           '..md..',
           '...T..']
    return A(art, {'m': GOLD, 'W': ('#ffffff', 4), 'd': (GOLD, 1), 'T': (GOLD, 3),
                   'r': ('#ff3a5a', 3), 'b': ('#3ab0ff', 3), 'g': ('#5ae85a', 3),
                   'p': ('#c85aff', 3), 'c': ('#7a4a10', 1)}, handle='#8a5a32')


def frozen_clock_pick():
    art = ['...i..',
           '...i..',
           '..iwww',
           '.Hwkww',
           'diwkw@c',
           '.iwkkw',
           '..iwww',
           '...i..',
           '...i..']
    art = ['....T..',
           '...ii..',
           '..Hii..',
           '.iwwwi.',
           'iwwkwwi',
           'dwwkkw@c',
           'iwwwwwi',
           '.iwwwi.',
           '..iid..',
           '...id..',
           '....T..']
    art = ['....T..',
           '...ii..',
           '..Hii..',
           '..www..',
           '.wwkww.',
           'iwwk@wc',
           '.wwkkw.',
           '..www..',
           '..iid..',
           '...id..',
           '....T..']
    art = ['...T...',
           '..ii...',
           '.Hii...',
           '.www...',
           'wwkww..',
           'wwk@w..',
           'wkkkwc.',
           '.www...',
           '.iid...',
           '..id...',
           '...T...']
    art = ['....T...',
           '...ii...',
           '..Hii...',
           '.wwww...',
           'wwkwww..',
           'wwkkkw@c',
           'wwwwww..',
           '.wwww...',
           '..iid...',
           '...id...',
           '....T...']
    return A(art, {'i': '#8ad8ff', 'H': ('#ffffff', 4), 'd': ('#8ad8ff', 1), 'T': ('#e0f8ff', 3),
                   'w': ('#f4f8ff', 3), 'k': ('#2a4a8a', 1), 'c': ('#2a4a6a', 1)},
             handle='#6ab8e8', at='w')


def durian_mace():
    art = ['.s.s.s.',
           'sgGgGgs',
           '.gGgGg.',
           'sgGgGgs.',
           '.gGgGgh@',
           'sgGgGgs',
           '.gGgGg.',
           'sgGgGgs',
           '.s.s.s.']
    art = ['..k.k...',
           '.l.l.l..',
           'kgsgsgk.',
           '.sgsgs..',
           'kgsGsgk.',
           '.sgsgsh@',
           'kgsgsgk.',
           '.sgsgs..',
           '..k.k...']
    art = ['...l.l.....',
           '..l.l......',
           '.k.k.k.....',
           'kgggggk....',
           '.gGgGg.....',
           'kgggggkhhh@',
           '.gGgGg.....',
           'kgggggk....',
           '.k.k.k.....']
    return A(art, {'g': '#7ac83a', 'G': ('#c8f06a', 3), 'k': ('#4a7a2a', 1),
                   'l': ('#a8e88a', 2)}, handle='#7a4a2a', at='h', butt=0.4)


def keris_pick():
    art = ['b..........',
           '.bb........',
           '..b........',
           '.bb........',
           'bb.........',
           '.bb.....',
           '..bbggg@']
    # keris: wavy blade along u, gold hilt
    art = ['.b.b.b........',
           'bWbbbbbbggg@',
           '..b.b.b.g....']
    art = ['W..........',
           '.b.b.b.....',
           'bBbBbBbbgG@',
           '.bb.bb.bg..']
    art = ['..b...b......',
           '.bBb.bBb.....',
           'bb.bBb.bbbg..',
           'B....b..bBgG@',
           '.........g...']
    art = ['.......Wg...',
           '.bb..bb.gg..',
           'bBbbbBbbbgG@',
           '..bb..bb.g..']
    return A(art, {'b': '#c8d0dc', 'B': ('#8a96aa', 1), 'W': ('#ffffff', 4),
                   'g': GOLD, 'G': ('#fff0a0', 3)}, handle='#7a4a2a', at='g', butt=0.4)


def jet_fee_pick():
    art = [r + '.....' for r in PICK]
    art[5] = '.mm..sss'
    art[6] = '.md.sSSs'
    art[7] = '..d..fff'
    art[8] = '..T...ff'
    art[5] = '.mm.ssss'
    art[6] = '.md.sSSs'
    art[7] = '..d.FfF.'
    art[8] = '..T..f..'
    return A(art, dict(pleg(GOLD, collar='#7a4a10'), s=('#8a909e', 2), S=('#c8ccd8', 3),
                       f=('#3ab0ff', 3), F=('#c8f0ff', 4)), handle=WOOD)


def red_candle_pick():
    art = ['..T..........',
           '..m..........',
           '.Hm..........',
           '.mm..rrrrrr..',
           'dmmhhrRRRRRrr@',
           '.mm..rrrrrr..',
           '.md..........',
           '..d..l.......',
           '..T..l.......',
           '.....l.......',
           '.....e.......']
    return A(art, {'m': '#9aa0ac', 'H': ('#9aa0ac', 4), 'd': ('#9aa0ac', 1), 'T': ('#9aa0ac', 3),
                   'r': '#e8302c', 'R': ('#ff9a8a', 3), 'l': ('#e8e8f0', 2),
                   'e': ('#ff6a5a', 3)}, handle='#e8302c', at='r', butt=0.4)


def seeker_signal_pick():
    art = ['.....a.',
           '...w.a..',
           '.w..w...',
           '..w..A...',
           '....AT..',
           '....mm..',
           '...Hmm..',
           '...mmm..',
           '..dmm@c.',
           '...mmm..',
           '...mmd..',
           '....md..',
           '.....T..']
    art = ['w.w..T.',
           '.w...a.',
           '..w.Aa.',
           '..w.Tmm',
           '....mmm',
           '...Hmm.',
           '..dmm@c',
           '...mmm.',
           '...mmd.',
           '....md.',
           '.....T.']
    art = ['.w.....',
           'w.w..a.',
           '.w...a.',
           '..w..T.',
           '....mm.',
           '...Hmm.',
           '...mmm.',
           '..dmm@c',
           '...mmm.',
           '...mmd.',
           '....md.',
           '.....T.']
    return A(art, {'m': '#2ac8b8', 'H': ('#c8fff4', 4), 'd': ('#2ac8b8', 1), 'T': ('#2ac8b8', 3),
                   'a': ('#c8ccd8', 2), 'w': ('#ffffff', 4), 'c': ('#1a4a4a', 1)},
             handle='#2e2a36')


def sniper_scope_pick():
    art = [r + '' for r in PICK]
    art = ['r.r.rr.T.',
           '.......m.',
           '......Hm.',
           '......mm.',
           '.....dm@c',
           '......mm.',
           '......md.',
           '.......d.',
           '.......T.']
    art = ['R.r.r.rT.',
           '......km.',
           '.....kHm.',
           '......mm.',
           '.....dm@c',
           '......mm.',
           '......md.',
           '.......d.',
           '.......T.']
    art = ['R.r.r.T.',
           '......m.',
           '.....Hm.',
           '.....mm.',
           '....dm@c',
           '.....mm.',
           '.....md.',
           '......d.',
           '......T.']
    return A(art, {'m': '#3a3446', 'H': ('#8a84a0', 3), 'd': ('#3a3446', 1), 'T': ('#ff3040', 3),
                   'r': ('#ff3040', 2), 'R': ('#ffb0b8', 4), 'c': ('#1a1a22', 1)},
             handle='#3a3446')


def consensus_gavel():
    art = ['..ww...',
           'wwwwww.',
           'wsssw..',
           'wwwww..',
           'wwwww@.',
           'wwwww..',
           'wsssw..',
           'wwwww..']
    art = ['...b...',
           '..bbb..',
           '...b...',
           '.wsw...',
           '.wsw...',
           '.www...',
           '.www@..',
           '.www...',
           '.wsw...',
           '.wsw...']
    art = ['....bb.',
           '...bb..',
           'b.bb...',
           '.b.....',
           '.sss...',
           '.www...',
           '.wWw...',
           '.www@c.',
           '.www...',
           '.www...',
           '.sss...']
    return A(art, {'w': '#6a3a22', 'W': ('#a86a3a', 3), 's': ('#d8dee8', 3),
                   'b': ('#3ab0ff', 4), 'c': ('#3a2a1a', 1)}, handle='#6a3a22', at='w')


def whale_spout_hammer():
    art = ['w.w.....',
           '.ww.....',
           '..w.....',
           'bbbbb...',
           'bBBbb...',
           'bbbbb@c.',
           'bbbbb...',
           'bbbbb...',
           'bbbbd...']
    art = ['w...w...',
           '.w.w....',
           '..w.....',
           '.bbbbb..',
           'bBBbbbb.',
           'bbbbbbb.',
           'bbbbbbb@c',
           'bbbbbbb.',
           'bebbbbb.',
           '.bbbbb..']
    return A(art, {'b': '#3a7ae8', 'B': ('#9ad0ff', 3), 'w': ('#e8f8ff', 4),
                   'e': ('#ffffff', 4), 'c': ('#1a2a5a', 1)}, handle='#2a4aa8', at='b')


# ============================================================ LEGENDARIES
def seeker_splitter():
    art = ['.....t..',
           '....tT..',
           '...tmm..',
           '..tmmm..',
           '.tmmmm..',
           'tTmmm@c.',
           '.tmmmm..',
           '..tmmm..',
           '...tmm..',
           '....tT..',
           '.....t..']
    art = ['g....T.',
           '....tm.',
           '...tmm.',
           '..tmmm.',
           '.tmmmm.',
           'TtmmWm@c',
           '.tmmmm.',
           '..tmmm.',
           '...tmm.',
           'g...tm.',
           '.....T.']
    art = ['......g..',
           '.....tT..',
           '....tmm..',
           '...tmmm..',
           'g.tmmWm..',
           '.tmmmmm..',
           'TtmmmmK@c',
           '.tmmmmm..',
           '..tmmmm..',
           'g..tmmm..',
           '....tmm..',
           '.....tT..',
           '......g..']
    return A(art, {'m': '#4a4e6a', 'W': ('#9aa0c0', 3), 'K': ('#3de0c8', 3),
                   't': ('#3de0c8', 3), 'T': ('#e0fff8', 4), 'g': ('#3de0c8', 4),
                   'c': ('#3de0c8', 2)}, handle='#1e1e2a', at='m', glow=TEAL)


def ms400_drill():
    art = ['.........ttt...',
           '....l...sssss..',
           'wwbbsssTTsssss.',
           '..bbbsssssssss@',
           'wwbbsssTTsssss.',
           '....l...sssss..',
           '.........ttt...']
    art = ['w.w.......ttt..',
           '.......ssTsss..',
           'wwbBbssTssssss.',
           'bBbBbBssssssss@',
           'wwbBbssTssssss.',
           '.......ssTsss..',
           'w.w.......ttt..']
    art = ['ww.ww.......ss..',
           '..........sssTs.',
           '...bbsTsTsssss..',
           'bbbbBsTsTssssss@',
           '...bbsTsTsssss..',
           '..........sssTs.',
           'ww.ww.......ss..']
    art = ['w..w..........',
           '...........ss.',
           '.....ssTsTssss.',
           'bBbbsssTsTssss@',
           '.....ssTsTssss.',
           '...........ss.',
           'w..w..........']
    art = ['w.w.w.......s..',
           '...........sss.',
           '......sTsTsssss.',
           'b.bBbbsTsTssssss@',
           '......sTsTsssss.',
           '...........sss.',
           'w.w.w.......s..']
    art = ['ww.w........T..',
           '.........sssss.',
           '....bbsTsTsssss.',
           'bBbbBbsTsTsssss@',
           '....bbsTsTsssss.',
           '.........sssss.',
           'ww.w........T..']
    return A(art, {'s': '#c8d0dc', 'T': ('#2ad8c8', 3), 'b': ('#e8f0f8', 3),
                   'B': ('#8a96aa', 2), 'w': ('#ffffff', 4)}, handle='#2e2a36', at='s', glow=TEAL)


def ash_pick():
    art = ['.e...T.',
           '....mm.',
           '.e.mom.',
           '..mmmo.',
           '.omom..',
           'dmmo@c.',
           '.mmom..',
           '..momd.',
           'e..mmd.',
           '....md.',
           '.e...T.']
    art = ['.e....T.',
           '.....mo.',
           '..e.omm.',
           '....mom.',
           '...mmmo.',
           '.e.omom.',
           '..dmmo@c',
           '...omom.',
           '...mmom.',
           '.e..mod.',
           '....mmd.',
           '.....od.',
           '..e...T.']
    return A(art, {'m': '#3a3440', 'o': ('#ff7a1a', 3), 'd': ('#3a3440', 1), 'T': ('#ff7a1a', 2),
                   'e': ('#ffb04a', 4), 'c': ('#ff4a1a', 2)}, handle='#2a2430', at='m',
             glow='#ff7a1a')


def mole_king_scepter():
    art = ['.p.y.y.y....',
           '.p.yyyyy....',
           '.ppyRyRy....',
           '..pmmmmm....',
           '..mmrmrm....',
           'dmmmmmmm@c..',
           '..mmmmm.....',
           '.p.mmmd.....',
           '...mmd......',
           '....md......',
           '.....T......']
    art = ['y.y.y......',
           'yyyyy......',
           'yRyRy......',
           'yyyyy......',
           '.mmmm......',
           'mrmrm......',
           'mmmmm@c....',
           '.mmmm......',
           '..mmd......',
           '...md......',
           '....T......']
    art = ['.p...y.y.y..',
           '....yyyyyy..',
           'p..yyRyRyy..',
           '....mmmmm...',
           '...mrmmrmm..',
           '.pmmmmmmmm@c',
           '...mmmmmmm..',
           '....mmmmd...',
           '.p...mmmd...',
           '......mmd...',
           '.......mT...']
    art = ['p.......y.....',
           '...y.y.yy.....',
           '.p.yyyyyy.....',
           '...yRyyRy.....',
           '..pmmmmmm.....',
           '..mrmmmrm.....',
           'pmmmmmmmmm@c..',
           '..mmmmmmm.....',
           '...mmmmmd.....',
           'p...mmmmd.....',
           '.....mmmd.....',
           '......mT......']
    art = ['.p.....y.y.y.',
           '.......yyyyy.',
           'p.p...yRyyRy.',
           '......mmmmmm.',
           '.p...mrmmrmm.',
           '..pmmmmmmmm@c',
           '.....mmmmmm..',
           '.......mmmd..',
           '........mmd..',
           '.........mT..']
    return A(art, {'m': '#5a2a8a', 'r': ('#ff3a3a', 4), 'y': GOLD, 'R': ('#ff3a5a', 3),
                   'd': ('#5a2a8a', 1), 'T': ('#a87ad8', 3), 'p': ('#a86ae8', 3),
                   'c': ('#2a1a4a', 1)}, handle='#3a1a5a', at='m', glow='#a86ae8')


def diamond_hands_pick():
    art = [r for r in BIG]
    art = ['r...T.',
           '.o.mm.',
           'y..Hmm.',
           '.gHmmm.',
           'b.mmmm.',
           'dmmm@c',
           'p.mmmm.',
           '..mmmd.',
           '...mmd.',
           '....md.',
           '.....T.']
    art = ['r....T......',
           '.o..mm......',
           'y..Hmm......',
           '.gHmmm......',
           'b.mmmm......',
           'dmmmm@ch....',
           'p.mmmm..aAa.',
           '..mmmd.aaAaa',
           '...mmd..aAa.',
           '....md...a..',
           '.....T......']
    art = ['r....T.......',
           '.o..mm.......',
           'y..Hmm.......',
           '.gHmmm.......',
           'b.mmmm.......',
           'dmmmm@chhhaa',
           'p.mmmm....aAa',
           '..mmmd....aaa',
           '...mmd.......',
           '....md.......',
           '.....T.......']
    return A(art, {'m': '#b8c4d4', 'H': ('#ffffff', 4), 'd': ('#b8c4d4', 1), 'T': ('#e8f0ff', 3),
                   'c': ('#3a3a4a', 1), 'a': ('#9ae0ff', 3), 'A': ('#ffffff', 4),
                   'r': ('#ff5a5a', 3), 'o': ('#ffa83a', 3), 'y': ('#ffe84a', 3),
                   'g': ('#5ae86a', 3), 'b': ('#5aa8ff', 3), 'p': ('#b86aff', 3)},
             handle='#6a4a32', glow='#9ae0ff')


def invisible_pick():
    art = ['s...o.',
           '...o.o',
           '.s.o..',
           '..o..o',
           '.o..o.',
           'o...@o',
           '.o...o',
           '..o.o.',
           '.s.o.o',
           '....o.',
           's.....']
    art = ['s....o.',
           '....o.o',
           '.s.o..o',
           '..o...o',
           '.o....o',
           'o.....@',
           '.o....o',
           '..o...o',
           '.s.o..o',
           '....o.o',
           's....o.']
    art = ['s....o..',
           '....o.o.',
           '.s.o..o.',
           '..o...o.',
           '.o....o.',
           'o.....@w',
           '.o....o.',
           '..o...o.',
           '.s.o..o.',
           '....o.o.',
           's....o..']
    return A(art, {'o': ('#e8f0ff', 4), 's': ('#fff4a0', 4), 'w': ('#e8f0ff', 3)},
             handle='#ccd8ec', at='o')


def liquidation_hammer():
    art = ['$..rrrrrr.',
           '..rRRrrrr.',
           '$.rRrrrrr.',
           '..kkkkkkk.',
           '$.kwkwkwk@c',
           '..kkkkkkk.',
           '$.rrrrrrr.',
           '..rrrrrrr.',
           '$..rrrrrd.']
    art = ['$.........',
           '..rrrrrr..',
           '$rRRrrrrr.',
           '.rRrrrrrr.',
           '$kkkkkkkk.',
           '.kwkkwkkk@c',
           '$kWkkWkkk.',
           '.kkkkkkkk.',
           '$rrrrrrrr.',
           '.rrrrrrrr.',
           '$.rrrrrr..']
    art = ['$..........',
           '..rrrrrrr..',
           '.rRRrrrrrr.',
           '$rRrrrrrrr.',
           '.kkkwwkkkk.',
           '.kkwkkwkkk@c',
           '$kkwwwwkkk.',
           '.kkkwwkkkk.',
           '.rrrrrrrrr.',
           '$rrrrrrrrr.',
           '..rrrrrrr..']
    return A(art, {'r': '#e8202c', 'R': ('#ff9a8a', 4), 'k': ('#2a2030', 2), 'w': ('#f4f0e6', 3),
                   'W': ('#f4f0e6', 3), '$': (GOLD, 4), 'c': ('#3a1a1a', 1)},
             handle='#3a2a2a', at='r', glow='#ff3030')


def giant_ban_hammer():
    art = ['.gggggggg..',
           'gGGGGGGggg.',
           'gGrrgrrggg.',
           'gGrgrgrggg.',
           'ggrrgrrggg@',
           'ggrgrgrggg.',
           'ggrrgrgggg.',
           'gggggggggg.',
           '.ggggggggd.']
    # BAN reads down the head when overhead: write the letters as rotated glyphs
    B = ['rr.', 'rr.', 'r.r', 'rr.']
    art = ['.ggggggggg.',
           'gGGGGGGGggg.',
           'gGggggggggg.',
           'ggrgrrrgrrg.',
           'ggrgrgrgrgg.',
           'ggggggggggg@c',
           'ggrrrgrrrgg.',
           'ggrgrgrgrgg.',
           'ggrrrgrgggg.',
           'ggggggggggg.',
           '.gggggggggd.']
    # simpler: three vertical letter blocks B/A/N drawn across v so overhead they read left to right
    art = ['.gggggggggg..',
           'gGGGGGGGGggg.',
           'ggrrrrrrrggg.',
           'ggrgrgrgrggg.',
           'ggrgrrrgrggg.',
           'ggggggggggggg@',
           'ggrrrrrrrggg.',
           'ggrgrgggggg.',
           'ggrrrrrrrggg.',
           'ggggggggggg..',
           '.ggggggggggd.']
    return A(_ban_art(), {'g': '#9aa0b0', 'G': ('#e0e4ec', 4), 'r': ('#ff2a2a', 3),
                          'd': ('#9aa0b0', 1), 'c': ('#3a3a4a', 1), 'f': ('#ff6a6a', 4)},
             handle='#5a4a3a', at='g', glow='#ff2a2a')


def _ban_art():
    # overhead (swing 2) the handle points up-right; letters are placed so they
    # read as BAN on the hammer face when the miner holds it on the shoulder.
    face = ['ggggggggggggg',
            'gGGGGGGGGGGgg',
            'gGrrgggrggrgg',
            'gGrgrgrgrgrrg',
            'ggrrggrrrgrgr',
            'ggrgrgrgrgrgr',
            'ggrrggrgrgrgr',
            'ggggggggggggg',
            'ggggggggggggd']
    art = []
    for r, row in enumerate(face):
        art.append('.' + row + ('@' if r == 4 else '.') + ('c' if r == 4 else ''))
    art[0] = 'f' + art[0][1:]
    art[8] = 'f' + art[8][1:]
    return art


def old_glow_flail():
    art = ['..y.y......',
           '.y...y.....',
           '..bbb......',
           '.bYYYb.....',
           '.bYWYb.....',
           '.bYYYb.....',
           '..bbb......',
           '...k.......',
           '....k......',
           '.....kk@...']
    art = ['y...y........',
           '..y.......',
           '.y.bbb.......',
           '..bYYYb......',
           'y.bYWYbkk....',
           '..bYYYb.k....',
           '...bbb...k...',
           '.y........kk@']
    art = ['.y..y.........',
           '...bbb.......',
           'y.bYYYb......',
           '..bYWYbkk....',
           '..bYYYb..k...',
           'y..bbb....k..',
           '...........k@',
           '.y...........']
    return A(art, {'b': '#c8902a', 'Y': ('#ffe068', 3), 'W': ('#ffffff', 4),
                   'k': ('#8a909e', 2), 'y': ('#ffe068', 4)}, handle='#6a4a2a', at='h',
             glow='#ffe068')


def motherlode_pick():
    art = ['$....T.',
           '....mm.',
           '.$.Hmm.',
           '..Hmmm.',
           '$.mmmm.',
           'dmmtm@c',
           '.$mmmm.',
           '..mmmd.',
           '$..mmd.',
           '....md.',
           '.$...T.']
    art = ['$.....T.',
           '.....mm.',
           '..$.Hmm.',
           '$..Hmmm.',
           '...mmmm.',
           '.$mmttm.',
           'dmmmtT@c',
           '..$mmmm.',
           '$..mmmd.',
           '....mmd.',
           '..$..md.',
           '......T.']
    return A(art, {'m': GOLD, 'H': ('#fffbe0', 4), 'd': (GOLD, 1), 'T': ('#fff4a0', 3),
                   't': ('#2ad8c8', 2), '$': ('#ffd84a', 4), 'c': ('#7a4a10', 1)},
             handle='#8a5a32', glow=GOLD)


# ============================================================ ITEMS
_FN = [
    ('G371', besi_pick), ('G372', kayu_pick), ('G373', anon_pick), ('G374', expired_pick),
    ('G375', curve_pick), ('G376', arena_club), ('G377', cave_run_pick), ('G378', rookie_shovel),
    ('G379', frog_pick), ('G380', gm_pick), ('G381', big_brain_pick), ('G382', up_only_pick),
    ('G383', hat_dog_pick), ('G384', pumpkin_pick), ('G385', copium_pick), ('G386', hopium_pick),
    ('G387', coconut_pick), ('G388', pool_noodle), ('G389', mint_day_hammer), ('G390', banana_pick),
    ('G391', stop_sign_paddle), ('G392', night_shift_pick), ('G393', copper_pick),
    ('G394', sold_early_pick), ('G395', priority_pick), ('G396', down_bad_pick),
    ('G397', rent_paid_pick), ('G398', rusty_pick), ('G399', seeker_pick), ('G400', ser_pick),
    ('G401', shrimp_pick), ('G402', batu_pick), ('G403', rubber_mallet), ('G404', grass_pick),
    ('G405', validator_wrench), ('G406', ngmi_stick), ('G407', wagmi_pick),
    ('G408', emas_pick), ('G409', airdrop_shovel), ('G410', joystick_club), ('G411', knuckle_pick),
    ('G412', lanyard_pick), ('G413', bat_wing_pick), ('G414', clan_banner_pick),
    ('G415', compressed_pick), ('G416', diamond_tape_pick), ('G417', floor_broom),
    ('G418', lighthouse_pick), ('G419', jeet_spork), ('G420', margin_call_pick),
    ('G421', cart_hammer), ('G422', matts_spare_pick), ('G423', batik_mallet),
    ('G424', pelita_pick), ('G425', teh_tarik_ladle), ('G426', wau_pick), ('G427', refined_pick),
    ('G428', origami_pick), ('G429', probably_nothing_pick), ('G430', rug_club),
    ('G431', sniper_drill), ('G432', beach_spade), ('G433', rubber_chicken),
    ('G434', this_is_fine_pick), ('G435', whale_tail_pick),
    ('G436', permata_pick), ('G437', neon_pick), ('G438', masked_dev_pick),
    ('G439', tunnel_collapse_drill), ('G440', galaxy_brain_pick), ('G441', green_candle_pick),
    ('G442', hollow_scythe), ('G443', grandpa_hals_pick), ('G444', nuggets_shiny_pick),
    ('G445', frozen_clock_pick), ('G446', durian_mace), ('G447', keris_pick),
    ('G448', jet_fee_pick), ('G449', red_candle_pick), ('G450', seeker_signal_pick),
    ('G451', sniper_scope_pick), ('G452', consensus_gavel), ('G453', whale_spout_hammer),
    ('G454', seeker_splitter), ('G455', ms400_drill), ('G456', ash_pick),
    ('G457', mole_king_scepter), ('G458', diamond_hands_pick), ('G459', invisible_pick),
    ('G460', liquidation_hammer), ('G461', giant_ban_hammer), ('G462', old_glow_flail),
    ('G463', motherlode_pick),
]


def _catalogue():
    import json
    p = __import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'catalogue.json')
    return {i['id']: i for i in json.load(open(p)) if i['slot'] == 'Axes & Weapons'}


_C = _catalogue()
ITEMS = [(gid, _C[gid]['name'], _C[gid]['rarity'], fn) for gid, fn in _FN]
assert len(ITEMS) == 93 and [i[0] for i in ITEMS] == list(_C), 'catalogue mismatch'


# ============================================================ revisions (override earlier drafts)
def ms400_drill():
    art = ['w.w.w..........',
           '.........tttt..',
           '.....sTsssssc..',
           '.sTsTsTsTssss@c',
           '.....sTsssssc..',
           '.........tttt..',
           'w.w.w..........']
    art = ['ww.ww.w.........',
           '..........tttt..',
           '......sTsWssss..',
           '..sTsTsTsssssss@',
           '......sTsssssd..',
           '..........tttt..',
           'ww.ww.w.........']
    return A(art, {'s': '#c8d0dc', 'T': ('#6a7890', 2), 'W': ('#ffffff', 4), 'd': ('#c8d0dc', 1),
                   't': ('#2ad8c8', 3), 'w': ('#ffffff', 4)}, handle='#2e2a36', at='s', glow=TEAL)


def tunnel_collapse_drill():
    art = ['.........rrrr.',
           '.........RrRr.',
           '.......yyyyyy.',
           '....gGgyYyyyy.',
           '.gGgGgGyyyyyy@',
           '....gGgyYyyyy.',
           '.......yyyyyd.']
    return A(art, {'y': '#ffd03a', 'Y': ('#fff0a0', 3), 'd': ('#ffd03a', 1),
                   'g': ('#b8bcc8', 3), 'G': ('#6a7080', 2),
                   'r': ('#3a1a1a', 2), 'R': ('#ff3a3a', 4)}, handle='#3a3446', at='y')


def giant_ban_hammer():
    face = ['.gggggggggggggg.',
            'gGGGGGGGGGGGGGgg',
            'gGrr..r..r..rgg.',
            'gGr.r.r.r.rr.rg.',
            'ggrr..rrr.r.rrg@c',
            'ggr.r.r.r.r..rg.',
            'ggrr..r.r.r..rg.',
            'gggggggggggggggg',
            '.gggggggggggggd.']
    # letters drawn on a pale plate so they pop
    face = [r.replace('.', 'p') if 1 < i < 7 else r for i, r in enumerate(face)]
    face = [r[:-1] + '.' if r.endswith('p') else r for r in face]
    for i in (2, 3, 5, 6):
        face[i] = face[i][:15]
    return A(face, {'g': '#8a90a4', 'G': ('#d8dce8', 4), 'r': ('#ff2a2a', 3), 'p': ('#e8eaf0', 3),
                    'd': ('#8a90a4', 1), 'c': ('#3a3a4a', 1)},
             handle='#5a4a3a', at='g', glow='#ff2a2a')


def liquidation_hammer():
    art = ['$..........',
           '..rrrrrrrr.',
           '$rRRrrrrrr.',
           '.rRrrrrrrr.',
           '.kkkkkkkkk.',
           '.kkkwwwkkk.',
           '.kkwkwkwkk@c',
           '.kkwwwwwkk.',
           '.kkkwkwkkk.',
           '.kkkkkkkkk.',
           '$rrrrrrrrr.',
           '.rrrrrrrrr.',
           '$.rrrrrrd..']
    return A(art, {'r': '#e8202c', 'R': ('#ff9a8a', 4), 'k': ('#2a2030', 2), 'w': ('#f4f0e6', 4),
                   'd': ('#e8202c', 1), '$': (GOLD, 4), 'c': ('#3a1a1a', 1)},
             handle='#3a2a2a', at='k', glow='#ff3030')


def grandpa_hals_pick():
    art = ['..T.....',
           '..m.....',
           '.Hm.....',
           '.mm.....',
           'dms@c.bb',
           '.mm..b.b',
           '.md..b..',
           '..d..bb.',
           '..T.....']
    return A(art, {'m': '#a8805a', 'H': ('#e0c098', 3), 'd': ('#a8805a', 1), 'T': ('#a8805a', 3),
                   's': ('#6a4a30', 1), 'c': ('#3a2a1a', 1), 'b': ('#ffc84a', 3)},
             handle='#5a3a24')


def bat_wing_pick():
    art = ['k.....',
           'kk....',
           '.lk...',
           'kkkk..',
           '.lkr@c',
           'kkkk..',
           '.lk...',
           'kk....',
           'k.....']
    return A(art, {'k': '#5a3a8a', 'l': ('#a87ad8', 3), 'r': ('#ff4060', 4), 'c': ('#2a1a3a', 1)},
             handle='#8a4ad8', at='k')


_REV = {'G455': ms400_drill, 'G439': tunnel_collapse_drill, 'G461': giant_ban_hammer,
        'G460': liquidation_hammer, 'G443': grandpa_hals_pick, 'G413': bat_wing_pick}
ITEMS = [(g, n, r, _REV.get(g, f)) for g, n, r, f in ITEMS]


def giant_ban_hammer():
    face = ['.gggggggggggggg..',
            'gGGGGGGGGGGGGGGg.',
            'gGpppppppppppppg.',
            'gGprrppprpprppr g.',
            'gGprprprprprrpr g.',
            'gGprrpprrrprprr g@c',
            'gGprprprprprpprg.',
            'gGprrpprprprpprg.',
            'gGpppppppppppppg.',
            'gggggggggggggggg.',
            '.ggggggggggggggd.']
    face = [r.replace(' ', 'p') for r in face]
    return A(face, {'g': '#8a90a4', 'G': ('#d8dce8', 4), 'r': ('#ff2a2a', 2), 'p': ('#eceef4', 3),
                    'd': ('#8a90a4', 1), 'c': ('#3a3a4a', 1)},
             handle='#5a4a3a', at='g', glow='#ff2a2a')


ITEMS = [(g, n, r, giant_ban_hammer if g == 'G461' else f) for g, n, r, f in ITEMS]


def giant_ban_hammer():
    # BAN reads upright while the hammer rests on the shoulder (idle, the most-seen frame)
    B = ['rr.', 'r.r', 'rr.', 'r.r', 'rr.']
    An = ['.r.', 'r.r', 'rrr', 'r.r', 'r.r']
    N = ['r..r', 'rr.r', 'r.rr', 'r..r', 'r..r']
    txt = [B[i] + '.' + An[i] + '.' + N[i] for i in range(5)]
    face = ['.ggggggggggggggg.',
            'gGGGGGGGGGGGGGGGg',
            'gGppppppppppppppg']
    for t in txt:
        face.append('gGp' + t.replace('.', 'p') + 'ppg')
    face += ['gGppppppppppppppg',
             'ggggggggggggggggg',
             '.gggggggggggggdd.']
    face[5] = face[5] + '@c'
    face = [r.ljust(19, '.') for r in face]
    return A(face, {'g': '#8a90a4', 'G': ('#d8dce8', 4), 'r': ('#ff2a2a', 2), 'p': ('#eceef4', 3),
                    'd': ('#8a90a4', 1), 'c': ('#3a3a4a', 1)},
             handle='#5a4a3a', at='g', glow='#ff2a2a')


ITEMS = [(g, n, r, giant_ban_hammer if g == 'G461' else f) for g, n, r, f in ITEMS]


def giant_ban_hammer():
    """Oversized grey hammer; the BAN mark is a big red no-entry circle, the
    only BAN that survives every swing angle at this size."""
    face = ['.ggggggggggggg.',
            'gGGGGGGGGGGGGGg',
            'gGppppprrrppppg',
            'gGppprrppprrppg',
            'gGpprrrppppprpg',
            'gGpprpprrppprpg',
            'gGprppppprrpprg',
            'gGpprppppprrrpg',
            'gGpprrppppprrpg',
            'gGppprrppprrppg',
            'gGpppppprrrpppg',
            'ggggggggggggggg',
            '.gggggggggggggd']
    face = [r + '.' for r in face]
    face[6] = face[6][:-1] + '@c'
    face = [r.ljust(17, '.') for r in face]
    return A(face, {'g': '#8a90a4', 'G': ('#d8dce8', 4), 'r': ('#ff2a2a', 2), 'p': ('#eceef4', 3),
                    'd': ('#8a90a4', 1), 'c': ('#3a3a4a', 1)},
             handle='#5a4a3a', at='g', glow='#ff2a2a')


ITEMS = [(g, n, r, giant_ban_hammer if g == 'G461' else f) for g, n, r, f in ITEMS]


def giant_ban_hammer():
    """Oversized grey hammer with a big red no-entry ring (the BAN mark) that
    reads at every swing angle."""
    n = 11
    c = (n - 1) / 2
    plate = []
    for y in range(n):
        row = ''
        for x in range(n):
            dx, dy = x - c, y - c
            r = (dx * dx + dy * dy) ** 0.5
            if 3.4 <= r <= 5.1 or (abs(dx + dy) < 0.8 and r < 3.6):
                row += 'r'
            else:
                row += 'p'
        plate.append(row)
    face = ['.' + 'g' * (n + 2) + '.']
    face.append('g' + 'G' * (n + 2) + 'g')
    for row in plate:
        face.append('gG' + row + 'g')
    face.append('g' * (n + 4))
    face.append('.' + 'g' * (n + 1) + 'd.')
    mid = 2 + n // 2
    face = [r + '.' for r in face]
    face[mid] = face[mid][:-1] + '@c'
    w = max(len(r) for r in face)
    face = [r.ljust(w, '.') for r in face]
    return A(face, {'g': '#8a90a4', 'G': ('#d8dce8', 4), 'r': ('#ff2a2a', 2), 'p': ('#eceef4', 3),
                    'd': ('#8a90a4', 1), 'c': ('#3a3a4a', 1)},
             handle='#5a4a3a', at='g', glow='#ff2a2a')


ITEMS = [(g, n, r, giant_ban_hammer if g == 'G461' else f) for g, n, r, f in ITEMS]

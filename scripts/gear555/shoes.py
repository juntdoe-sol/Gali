"""Gali Gear 555, shoe slot: 92 hand-pixelled shoes (toe to the right, last row on
the ground). Light from the top left: mk() auto-shades 'material' cells (top edge
lit, top-left corner highlight, right / lower edges darker, ground row darker).
Fixed (colour, tone) legend entries are left exactly as drawn.
"""
import sys

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from kit import Shoe  # noqa: E402

SLOT = 'shoe'

_POOL = [chr(c) for c in range(0x100, 0x400)]


def _empty(rows, i, j):
    if j < 0 or j >= len(rows) or i < 0 or i >= len(rows[j]):
        return True
    return rows[j][i] in ' .'


def mk(rows, legend, anchor=None):
    """rows: grid strings. legend: char -> '#hex'/ramp name (auto shaded) or
    (colour, tone) fixed. anchor defaults to (1, last row - 1)."""
    if anchor is None:
        anchor = (1, len(rows) - 2)
    last = len(rows) - 1
    keys, out_leg, out_rows = {}, {}, []
    for j, row in enumerate(rows):
        s = ''
        for i, ch in enumerate(row):
            if ch in ' .':
                s += '.'
                continue
            spec = legend[ch]
            if isinstance(spec, tuple):
                col, t = spec
            else:
                col = spec
                if j == last:
                    t = 1 + (1 if _empty(rows, i - 1, j) and _empty(rows, i, j - 1) else 0)
                else:
                    up = _empty(rows, i, j - 1)
                    lf = _empty(rows, i - 1, j)
                    rt = _empty(rows, i + 1, j)
                    dn = j + 1 <= last and _empty(rows, i, j + 1)
                    t = 2 + (1 if up else 0) + (1 if up and lf else 0) - (1 if (rt or dn) and not up else 0)
                t = max(0, min(4, t))
            k = (col, t)
            if k not in keys:
                keys[k] = _POOL[len(keys)]
                out_leg[keys[k]] = k
            s += keys[k]
        out_rows.append(s)
    return Shoe(out_rows, out_leg, anchor)


# palette
INKY = '#3a3050'
WHITE = '#f4f0e8'
SOLE_DK = '#4a3a48'
GREY = '#9a98a8'
SKIN = 'skin'


# ---------------------------------------------------------------- Common
def farmer_gumboots():
    return mk(['yyy..',
               'yyy..',
               'mMmm.',
               'yyyym',
               'ddddd'],
              {'y': '#f4c430', 'm': '#8a5a2e', 'M': ('#8a5a2e', 3), 'd': ('#5a3a22', 1)})


def anon_dev_slippers():
    return mk(['.sgg..',
               'sggggg',
               'dddddd'],
              {'s': ('#8a8a9c', 1), 'g': '#9a9aae', 'd': ('#3a3444', 1)})


def coin_slot_shoes():
    return mk(['yyy...',
               'yyyyk.',
               'yyyyky',
               'oooooo'],
              {'y': '#f6c834', 'k': ('#5a3a1a', 0), 'o': ('#b87818', 1)})


def expired_boots():
    return mk(['ggg...',
               'ggggg.',
               'gggxgx',
               'ggggxg',
               'dddxdx'],
              {'g': '#a4a0a8', 'x': ('#b04848', 2), 'd': ('#5a5460', 1)})


def curve_sneakers():
    return mk(['www...',
               'wwwwwo',
               'wwwwow',
               'woowww',
               'ssssss'],
              {'w': WHITE, 'o': ('#ff7a1a', 2), 's': ('#c8c0b8', 0)})


def brawl_tape_wraps():
    return mk(['www..',
               'rrr..',
               'wwwws',
               'rwwss',
               'ssSSS'],
              {'w': WHITE, 'r': ('#e03a3a', 2), 's': SKIN, 'S': (SKIN, 1)})


def conference_sneakers():
    return mk(['pww...',
               'ptwwww',
               'tsssss'],
              {'w': WHITE, 'p': ('#9a4ae8', 2), 't': ('#2ad4c0', 2), 's': ('#c8c0d0', 1)})


def burnt_sneakers():
    return mk(['.ccc..',
               'ccccoy',
               'cccooo',
               'dddddd'],
              {'c': '#4a4450', 'o': ('#ff7a1a', 2), 'y': ('#ffd84a', 3), 'd': ('#2a2430', 1)})


def cave_run_wellies():
    return mk(['ggg...',
               'ggg...',
               'gggg..',
               'gggbgb',
               'gbbbbb',
               'dddddd'],
              {'g': '#2e6a3a', 'b': ('#8a5a2e', 2), 'd': ('#1e3a24', 1)})


def clan_colour_boots():
    return mk(['kkk..',
               'CCC..',
               'kkkkk',
               'ddddd'],
              {'k': '#4a4258', 'C': ('#e8344e', 2), 'd': ('#2a2434', 1)})


def compressed_kicks():
    return mk(['wwwwwww',
               'ppppppp'],
              {'w': ('#f4f0e8', 3), 'p': ('#8a3ae0', 1)}, anchor=(1, 0))


def steel_toe_boots():
    return mk(['ggg...',
               'gggg..',
               'ggggSs',
               'ggggss',
               'dddddd'],
              {'g': '#7a7888', 's': ('#c8ccd8', 2), 'S': ('#ffffff', 4), 'd': ('#3a3844', 1)})


def frog_flip_flops():
    return mk(['....e.e',
               'sssllll',
               'sssssss',
               'LLLLLLL'],
              {'e': ('#8ae83a', 3), 's': SKIN, 'l': ('#7ad42a', 2), 'L': ('#4a9a1a', 1)})


def gm_socks():
    return mk(['ooo..',
               'yyo..',
               'yyo..',
               'ooooo',
               'OOOOO'],
              {'o': '#ff8a1a', 'y': ('#ffe44a', 4), 'O': ('#c85a10', 1)})

def green_candle_sneakers():
    return mk(['.ggg..',
               'gggggw',
               'dddddd'],
              {'g': '#3ac850', 'w': ('#ffffff', 4), 'd': ('#1e6a2a', 1)})


def hat_dog_paws():
    return mk(['ttt....',
               'tttt.t.',
               'ttttttt',
               'TTTpTpp'],
              {'t': '#d8a868', 'T': ('#a87838', 1), 'p': ('#ff8ab0', 2)})


def copium_clogs():
    return mk(['.bbb..',
               'bbwbwb',
               'bbbbbb',
               'dddddd'],
              {'b': '#6ac0f0', 'w': ('#ffffff', 4), 'd': ('#3a7ab0', 1)})


def island_flip_flops():
    return mk(['.ss...',
               'sssTTs',
               'nnnnnn'],
              {'s': SKIN, 'T': ('#1ad4c4', 3), 'n': ('#f0d8a0', 2)})


def holey_socks():
    return mk(['ggg..',
               'ggg..',
               'ggggg',
               'gggsg',
               'GGGGs'],
              {'g': '#a8a6b4', 's': (SKIN, 2), 'G': ('#6a6878', 1)})


def lobby_loafers():
    return mk(['.bb...',
               'bbbLbb',
               'dddddd'],
              {'b': '#8a5430', 'L': ('#d09a5a', 3), 'd': ('#4a2a18', 1)})


def mint_day_slippers():
    return mk(['.mmm..',
               'mmmmmm',
               'wwwwww'],
              {'m': '#7ae8b8', 'w': ('#f8f8f0', 2)})


def bare_monke_feet():
    return mk(['bbb.....',
               'bbbbbbb.',
               'tttttt.t'],
              {'b': '#7a4a2a', 't': ('#c8946a', 2)})


def night_shift_socks():
    return mk(['nnn..',
               'mnn..',
               'nnnmn',
               'NNNNN'],
              {'n': '#2a3470', 'm': ('#e8e4c0', 3), 'N': ('#1a2050', 1)})


def kampung_rubber_shoes():
    return mk(['.www..',
               'wwwwww',
               'bbbbbb'],
              {'w': '#f4f4f0', 'b': ('#7ab0e8', 2)})


def paper_hand_slippers():
    return mk(['.ppp...',
               'ppGpppp',
               'PPPPPPP'],
              {'p': '#f0ead8', 'G': ('#a8a090', 2), 'P': ('#c8c0a8', 1)})


def priority_fee_sneakers():
    return mk(['.ggg..',
               'gggggw',
               'ddddww'],
              {'g': 'gold', 'w': ('#ffffff', 4), 'd': ('#a06010', 1)})


def probably_nothing_socks():
    return mk(['ggg..',
               'gWg..',
               'ggg..',
               'gWggg',
               'GGGGG'],
              {'g': '#9a98a8', 'W': ('#ffffff', 4), 'G': ('#5a586a', 1)})

def red_candle_sneakers():
    return mk(['.rrr..',
               'rrrrrr',
               'RRRRRR',
               'dddddd'],
              {'r': '#e83a3a', 'R': ('#8a1a22', 1), 'd': ('#e83a3a', 0)})


def rent_exempt_slides():
    return mk(['ss....',
               'skkwks',
               'kkkkkk'],
              {'s': SKIN, 'k': ('#3a3444', 2), 'w': ('#ffffff', 4)})


def seeker_squad_runners():
    return mk(['okk...',
               'kkkkkk',
               'gggggg'],
              {'o': ('#ff8a1a', 3), 'k': '#3e3850', 'g': ('#a8a4b0', 1)})


def socks_and_sandals():
    return mk(['www..',
               'www..',
               'wwwww',
               'wbwbw',
               'bbbbb'],
              {'w': WHITE, 'b': ('#8a5a30', 2)})


def shrimp_sandals():
    return mk(['ss....p',
               'ssspssp',
               'pppppp.'],
              {'s': SKIN, 'p': ('#ff8aa0', 2)})


def solana_summer_sandals():
    return mk(['ss....',
               'spbtss',
               'pbbttt'],
              {'s': SKIN, 'p': ('#9a4ae8', 2), 'b': ('#3a8ae8', 2), 't': ('#1ad4b0', 2)})


def plain_miner_boots():
    return mk(['bbb..',
               'bbbb.',
               'bbbbb',
               'ddddd'],
              {'b': '#9a6a40', 'd': ('#4a301e', 1)})


def grass_stained_sneakers():
    return mk(['.www..',
               'wwwgwg',
               'sssggs'],
              {'w': WHITE, 'g': ('#4ab83a', 2), 's': ('#b8b4b0', 1)})


def validator_clogs():
    return mk(['.ggg..',
               'ggggGg',
               'gggggg',
               'dddddd'],
              {'g': '#8a8aa0', 'G': ('#3aff6a', 3), 'd': ('#4a4a5a', 1)})


def whale_loafers():
    return mk(['...w.w',
               '.bbbwb',
               'bbbbbb',
               'dddddd'],
              {'b': '#5a72a8', 'w': ('#ffffff', 4), 'd': ('#2a3a68', 1)})


# ---------------------------------------------------------------- Uncommon
def pixel_hi_tops():
    return mk(['kkk..',
               'krk..',
               'kkbk.',
               'kkkrk',
               'wwwww'],
              {'k': '#3e3850', 'r': ('#ff3a4a', 3), 'b': ('#3a8aff', 3), 'w': ('#e8e4f0', 2)})


def arena_spike_cleats():
    return mk(['.kkk..',
               'kkkkkk',
               'dddddd',
               's.s.s.'],
              {'k': '#3e3850', 'd': ('#2a2434', 0), 's': ('#e0e4f0', 3)})


def lantern_toe_boots():
    return mk(['bbb...',
               'bbbb..',
               'bbbbbL',
               'dddddd'],
              {'b': '#8a5a34', 'L': ('#ffe060', 4), 'd': ('#4a2e1c', 1)})


def diamond_toe_boots():
    return mk(['kkk...',
               'kkkkc.',
               'kkkcCc',
               'ddddcd'],
              {'k': '#3e3850', 'c': ('#3ae0ff', 2), 'C': ('#e8ffff', 4), 'd': ('#221e2c', 1)})


def broom_bristle_shoes():
    return mk(['.bbb...',
               'bbbbbb.',
               'dddddd.',
               'yYyYyYy'],
              {'b': '#8a5a34', 'd': ('#4a2e1c', 1), 'y': ('#f0c040', 2), 'Y': ('#ffe080', 3)})


def frog_flippers():
    return mk(['ggg.....',
               'gggggg..',
               'ggwgwgwg',
               'GGGGGGGG'],
              {'g': '#5ac83a', 'w': ('#2e7a1e', 1), 'G': ('#3a8a24', 1)})


def galaxy_brain_socks():
    return mk(['pwp..',
               'ppP..',
               'PpPwp',
               'pppPp',
               'ddddd'],
              {'p': '#4a2a8a', 'w': ('#ffffff', 4), 'P': ('#ff6ad0', 2), 'd': ('#2a1a5a', 1)})


def pumpkin_boots():
    return mk(['ggg....',
               'ooooo..',
               'oooooo.',
               'oooyoy.',
               'ooyyyyo',
               '.ddddd.'],
              {'g': '#3a8a2a', 'o': '#ff8a1a', 'y': ('#ffe040', 4), 'd': ('#a04a10', 1)})


def hopium_puffers():
    return mk(['ppp...',
               'PPPP..',
               'ppppp.',
               'PPPPPP',
               'pppppp',
               'dddddd'],
              {'p': '#ffb0d0', 'P': ('#e888b0', 1), 'd': ('#c06890', 1)})


def lighthouse_boots():
    return mk(['www..',
               'rrr..',
               'wwww.',
               'rrrrY',
               'ddddd'],
              {'w': WHITE, 'r': ('#e83a3a', 2), 'Y': ('#ffe040', 4), 'd': ('#5a5468', 1)})


def exit_liquidity_runners():
    return mk(['w..rrr...',
               '..wrrrr..',
               'w..rwrrrr',
               '...wwwwww'],
              {'r': '#ff2a4a', 'w': ('#ffffff', 4)}, anchor=(4, 2))

def concrete_boots():
    return mk(['gggggg',
               'gggggg',
               'gggcgg',
               'ggggcg',
               'ggggcg',
               'dddddd'],
              {'g': '#a8a8b0', 'c': ('#5a5a68', 1), 'd': ('#6a6a78', 1)}, anchor=(2, 4))


def mine_cart_skates():
    return mk(['kkk....',
               'ggggggg',
               'gGgGgGg',
               '.ggggg.',
               '.w...w.'],
              {'k': '#5a5468', 'g': '#9a9aac', 'G': ('#6a6a7c', 1), 'w': ('#8a5a30', 2)})


def matts_work_boots():
    return mk(['yyyt.',
               'yyyo.',
               'yyyyy',
               'ddddd'],
              {'y': '#f6c030', 't': ('#f6c030', 3), 'o': ('#ff6a1a', 2), 'd': ('#6a4a1a', 1)})


def nugget_paw_slippers():
    return mk(['....hh.',
               'bbbbhhh',
               'bbbbbbb',
               'dddddpp'],
              {'h': '#ffd030', 'b': '#8a5a3a', 'd': ('#5a3a24', 1), 'p': ('#ff9ab8', 3)})


def halted_boots():
    return mk(['ggg...',
               'gggg..',
               'gggygy',
               'gggygy',
               'dddddd'],
              {'g': '#8a8a9c', 'y': ('#ffd830', 3), 'd': ('#4a4a5a', 1)})


def bunny_slippers():
    return mk(['....wp',
               '....wp',
               'wwwwww',
               'wwwwek',
               'pppppp'],
              {'w': '#f8f4f4', 'p': ('#ffa0c0', 2), 'e': ('#221a28', 0), 'k': ('#ffa0c0', 3)})


def batik_slip_ons():
    return mk(['.nnn..',
               'nnnngn',
               'nnngGg',
               'ddddgd'],
              {'n': '#2a3a7a', 'g': ('#f0c040', 2), 'G': ('#fff0a0', 4), 'd': ('#1a2450', 1)})


def durian_clogs():
    return mk(['g.g.g.g',
               'ggggggg',
               'gYgYgYg',
               'ddddddd'],
              {'g': '#a8c83a', 'Y': ('#f0e040', 3), 'd': ('#5a7a1a', 1)})


def teh_tarik_sandals():
    return mk(['ss....',
               'sbbsss',
               'tttttt'],
              {'s': SKIN, 'b': ('#7a4a2a', 2), 't': ('#e0c09a', 2)})


def refinery_hazard_boots():
    return mk(['ooo..',
               'yky..',
               'kyky.',
               'ooooo',
               'ddddd'],
              {'o': '#ff7a1a', 'y': ('#ffd830', 3), 'k': ('#2a2434', 1), 'd': ('#3a2a24', 1)})


def rugged_clown_shoes():
    return mk(['rrr.....',
               'rryyrrr.',
               'rrrrrrrr',
               'dddddddd'],
              {'r': '#e8302c', 'y': ('#ffd84a', 3), 'd': ('#8a1a1a', 1)})


def ghillie_boots():
    return mk(['G.G.G.',
               'gggG..',
               'ggggG.',
               'gggggr',
               'dddddd'],
              {'g': '#3a5a2a', 'G': ('#6aa83a', 3), 'r': ('#ff2a2a', 3), 'd': ('#22341a', 1)})


def rubber_duck_boots():
    return mk(['yyy....',
               'yyyy...',
               'yyyye..',
               'yyyyyoo',
               'OOOOO..'],
              {'y': '#ffd830', 'e': ('#221a28', 0), 'o': ('#ff8a1a', 3), 'O': ('#e86a10', 1)})


def velcro_dad_sneakers():
    return mk(['www...',
               'GGG...',
               'wwwww.',
               'GGGGww',
               'ssssss'],
              {'w': WHITE, 'G': ('#9a98a8', 2), 's': ('#c8c4c0', 1)})


def wagmi_walkers():
    return mk(['.wgw..',
               'wwbgbw',
               'ssssss'],
              {'w': WHITE, 'g': ('#3ad85a', 3), 'b': ('#3a8aff', 3), 's': ('#b8b4c0', 1)})


def whale_tail_flippers():
    return mk(['bbb....b',
               'bbbbbbb.',
               'wwwwwwbb',
               'ddddddd.'],
              {'b': '#3a6ad0', 'w': ('#e8f0ff', 3), 'd': ('#22408a', 1)})


# ---------------------------------------------------------------- Rare
def afterimage_sneakers():
    return mk(['....www...',
               'a.b.wwwwt.',
               'a.b.wwwwwt',
               'A.B.tttttt'],
              {'w': WHITE, 't': ('#1ad4c4', 2), 'a': ('#1ad4c4', 4), 'b': ('#1ad4c4', 3),
               'A': ('#1ad4c4', 3), 'B': ('#1ad4c4', 2)}, anchor=(5, 2))


def light_up_sneakers():
    return mk(['.www..',
               'wwwwww',
               'rrggbb'],
              {'w': WHITE, 'r': ('#ff3a4a', 3), 'g': ('#3aff6a', 3), 'b': ('#3a8aff', 3)})


def mole_claw_boots():
    return mk(['ppp....',
               'pppp...',
               'ppeppc.',
               'pppppcc',
               'ddddc.c'],
              {'p': '#5a2a8a', 'e': ('#ff3a3a', 4), 'c': ('#e8e0d0', 3), 'd': ('#2a1450', 1)})


def moon_boots():
    return mk(['y....y',
               '.www..',
               'wwwww.',
               'wWwWww',
               'wwwwww',
               'gggggg'],
              {'y': ('#ffe060', 4), 'w': '#f0f0f8', 'W': ('#c8c8e0', 1), 'g': ('#9a98b0', 1)})


def rocket_boots():
    return mk(['sss..',
               'ssss.',
               'sssss',
               'ddddd',
               'oyo..'],
              {'s': '#b8c0d0', 'd': ('#5a6070', 1), 'o': ('#ff7a1a', 2), 'y': ('#ffe060', 4)})


def ghost_miner_boots():
    return mk(['www..',
               'wwww.',
               'wwwww',
               'w.w.w'],
              {'w': '#c8e0f0'})


def cope_stilts():
    return mk(['bwb..',
               'bwb..',
               'bwb..',
               '.w...',
               '.w...',
               'wwwww'],
              {'b': ('#5a3a24', 1), 'w': '#c8945a'})


def surfboard_sandals():
    return mk(['ss.....w',
               'sssTs..w',
               'tttttttt'],
              {'s': SKIN, 'T': ('#ffffff', 3), 't': '#1ac4d0', 'w': ('#ffffff', 4)})


def banana_boots():
    return mk(['yyy....',
               'yyy...b',
               'yyyy.yy',
               'yyyyyy.',
               'dddd...'],
              {'y': '#ffe040', 'b': ('#6a4a1a', 1), 'd': ('#c8a020', 1)})


def pelita_lamp_clogs():
    return mk(['....y.',
               '....o.',
               '.bbbB.',
               'bbbbbb',
               'dddddd'],
              {'y': ('#ffe060', 4), 'o': ('#ff7a1a', 3), 'b': '#c8a040', 'B': ('#c8a040', 4),
               'd': ('#7a5a1a', 1)})


def wau_kite_sandals():
    return mk(['r.ss...',
               'rrsss..',
               '.rsbsss',
               '.bbbbbb'],
              {'r': ('#e8302c', 3), 's': SKIN, 'b': ('#8a5a30', 2)}, anchor=(3, 2))


def paper_plane_shoes():
    return mk(['www....',
               'wWww...',
               'wwwwww.',
               'gggggggw'],
              {'w': '#f8f4ec', 'W': ('#c8c0b0', 1), 'g': ('#c8c0b0', 1)})


def candle_wick_stilts():
    return mk(['rRr..',
               'rRr..',
               'rrrr.',
               'rrrrr',
               'kkkko',
               'dddd.'],
              {'r': '#e8302c', 'R': ('#ffd0c0', 4), 'k': ('#2a2028', 1), 'o': ('#ffd040', 4),
               'd': ('#8a1a1a', 1)})

def rug_roller_skates():
    return mk(['.kk....',
               'kkkkkk.',
               '.w..w..',
               'ryrryrr'],
              {'k': '#5a3a7a', 'w': ('#ffe040', 3), 'r': ('#c8282c', 2), 'y': ('#ffd040', 3)})


def seeker_ping_boots():
    return mk(['kkk.....',
               'kkkk..o.',
               'kkkkkt.o',
               'kkkkkt.o',
               'dddddd.o'],
              {'k': '#3e3850', 't': ('#ff8a1a', 3), 'o': ('#ff8a1a', 2), 'd': ('#221e2c', 1)})


def tank_tread_boots():
    return mk(['.ggg...',
               'ggggg..',
               'TTTTTT.',
               'TwTwTwT',
               '.TTTTT.'],
              {'g': '#7a7a8c', 'T': ('#4a4a58', 1), 'w': ('#b8b8c8', 3)})


def this_is_fine_slippers():
    return mk(['.....yo',
               'bb..bbo',
               'bbbbbbb',
               'bbbbebn',
               'ddddddd'],
              {'b': '#8a5a34', 'o': ('#ff6a1a', 3), 'y': ('#ffe040', 4), 'e': ('#221a28', 0),
               'n': ('#2a1a1a', 1), 'd': ('#4a2e1c', 1)})

def validator_node_boots():
    return mk(['kkk...',
               'kkkk..',
               'kkkkkk',
               'GdGdGd'],
              {'k': '#3e3850', 'G': ('#3aff6a', 3), 'd': ('#1e3a2a', 1)})


def whale_spout_boots():
    return mk(['w.w....',
               '.w.nnn.',
               '...nnn.',
               '...nnnn',
               '...dddd'],
              {'w': ('#e8f4ff', 4), 'n': '#2a3a7a', 'd': ('#1a2450', 1)}, anchor=(4, 3))


# ---------------------------------------------------------------- Legendary
def slot_leader_sprinters():
    return mk(['rrr.ppp...',
               'yyy.pppp..',
               'ggg.ppppwp',
               'bbb.dddddd'],
              {'r': ('#ff4a5a', 3), 'y': ('#ffd040', 3), 'g': ('#3ae07a', 3), 'b': ('#3a9aff', 3),
               'p': '#8a3ae0', 'w': ('#ffffff', 4), 'd': ('#3a1a6a', 1)}, anchor=(5, 2))


def burn_address_treads():
    return mk(['.kkk....',
               'okkkk...',
               'okkkkkk.',
               'yoyoyoyo'],
              {'k': '#3a3444', 'o': ('#ff6a1a', 3), 'y': ('#ffe060', 4)}, anchor=(2, 2))


def grandpa_hals_boots():
    return mk(['....bbb..',
               '....bbbb.',
               '....bbbbb',
               'a.a.Ddddd'],
              {'a': ('#ffb040', 4), 'b': '#7a5030', 'D': ('#ffb040', 3), 'd': ('#3a2414', 1)},
              anchor=(5, 2))

def diamond_sole_boots():
    return mk(['....w.',
               'kkk.....',
               'kkkk..',
               'kkkkkk',
               'cCcCcC',
               'CcCcCc'],
              {'w': ('#ffffff', 4), 'k': '#3e3850', 'c': ('#3ae0ff', 2), 'C': ('#c0faff', 3)})


def moonshot_thrusters():
    return mk(['sss..',
               'ssss.',
               'sssss',
               'ddd..',
               'g.g..',
               'GgG..'],
              {'s': '#d8e0ec', 'd': ('#5a6478', 1), 'g': ('#3aff6a', 3), 'G': ('#c0ffc0', 4)})


def jack_o_stompers():
    return mk(['vgg....v',
               'ooooo...',
               'ooooooo.',
               'oooyooy.',
               'ooyyyyyo',
               'vdddddd.'],
              {'v': ('#b04aff', 3), 'g': '#3a8a2a', 'o': '#ff8a1a', 'y': ('#ffe040', 4),
               'd': ('#a04a10', 1)}, anchor=(2, 4))


def margin_call_anchors():
    return mk(['.iii..r.',
               '.iiii...',
               '.iiiii..',
               'a.iii..a',
               '.aaaaaa.'],
              {'i': '#6a7080', 'r': ('#ff2a2a', 4), 'a': ('#4a5060', 2)}, anchor=(2, 3))


def motherlode_footprints():
    return mk(['.ggg....',
               '.gggg...',
               '.ggggg..',
               'c.dddd.c'],
              {'g': 'gold', 'c': ('gold', 4), 'd': ('#8a5a10', 1)}, anchor=(2, 2))


def frozen_chain_skates():
    return mk(['*.iii...',
               '..iiii.*',
               '*.iiiii.',
               '..s..s..',
               'bbbbbbbb'],
              {'*': ('#e8ffff', 4), 'i': '#7ad0f0', 's': ('#c8e8f8', 2), 'b': ('#c8e8f8', 3)},
              anchor=(3, 3))


ITEMS = [
    ('G279', 'Farmer Gumboots', 'Common', farmer_gumboots),
    ('G280', 'Anon Dev Slippers', 'Common', anon_dev_slippers),
    ('G281', 'Coin Slot Shoes', 'Common', coin_slot_shoes),
    ('G282', 'Expired Boots', 'Common', expired_boots),
    ('G283', 'Curve Sneakers', 'Common', curve_sneakers),
    ('G284', 'Brawl Tape Wraps', 'Common', brawl_tape_wraps),
    ('G285', 'Conference Sneakers', 'Common', conference_sneakers),
    ('G286', 'Burnt Sneakers', 'Common', burnt_sneakers),
    ('G287', 'Cave Run Wellies', 'Common', cave_run_wellies),
    ('G288', 'Clan Colour Boots', 'Common', clan_colour_boots),
    ('G289', 'Compressed Kicks', 'Common', compressed_kicks),
    ('G290', 'Steel Toe Boots', 'Common', steel_toe_boots),
    ('G291', 'Frog Flip Flops', 'Common', frog_flip_flops),
    ('G292', 'GM Socks', 'Common', gm_socks),
    ('G293', 'Green Candle Sneakers', 'Common', green_candle_sneakers),
    ('G294', 'Hat Dog Paws', 'Common', hat_dog_paws),
    ('G295', 'Copium Clogs', 'Common', copium_clogs),
    ('G296', 'Island Flip Flops', 'Common', island_flip_flops),
    ('G297', 'Holey Socks', 'Common', holey_socks),
    ('G298', 'Lobby Loafers', 'Common', lobby_loafers),
    ('G299', 'Mint Day Slippers', 'Common', mint_day_slippers),
    ('G300', 'Bare Monke Feet', 'Common', bare_monke_feet),
    ('G301', 'Night Shift Socks', 'Common', night_shift_socks),
    ('G302', 'Kampung Rubber Shoes', 'Common', kampung_rubber_shoes),
    ('G303', 'Paper Hand Slippers', 'Common', paper_hand_slippers),
    ('G304', 'Priority Fee Sneakers', 'Common', priority_fee_sneakers),
    ('G305', 'Probably Nothing Socks', 'Common', probably_nothing_socks),
    ('G306', 'Red Candle Sneakers', 'Common', red_candle_sneakers),
    ('G307', 'Rent Exempt Slides', 'Common', rent_exempt_slides),
    ('G308', 'Seeker Squad Runners', 'Common', seeker_squad_runners),
    ('G309', 'Socks And Sandals', 'Common', socks_and_sandals),
    ('G310', 'Shrimp Sandals', 'Common', shrimp_sandals),
    ('G311', 'Solana Summer Sandals', 'Common', solana_summer_sandals),
    ('G312', 'Plain Miner Boots', 'Common', plain_miner_boots),
    ('G313', 'Grass Stained Sneakers', 'Common', grass_stained_sneakers),
    ('G314', 'Validator Clogs', 'Common', validator_clogs),
    ('G315', 'Whale Loafers', 'Common', whale_loafers),
    ('G316', 'Pixel Hi Tops', 'Uncommon', pixel_hi_tops),
    ('G317', 'Arena Spike Cleats', 'Uncommon', arena_spike_cleats),
    ('G318', 'Lantern Toe Boots', 'Uncommon', lantern_toe_boots),
    ('G319', 'Diamond Toe Boots', 'Uncommon', diamond_toe_boots),
    ('G320', 'Broom Bristle Shoes', 'Uncommon', broom_bristle_shoes),
    ('G321', 'Frog Flippers', 'Uncommon', frog_flippers),
    ('G322', 'Galaxy Brain Socks', 'Uncommon', galaxy_brain_socks),
    ('G323', 'Pumpkin Boots', 'Uncommon', pumpkin_boots),
    ('G324', 'Hopium Puffers', 'Uncommon', hopium_puffers),
    ('G325', 'Lighthouse Boots', 'Uncommon', lighthouse_boots),
    ('G326', 'Exit Liquidity Runners', 'Uncommon', exit_liquidity_runners),
    ('G327', 'Concrete Boots', 'Uncommon', concrete_boots),
    ('G328', 'Mine Cart Skates', 'Uncommon', mine_cart_skates),
    ("G329", "Matt's Work Boots", 'Uncommon', matts_work_boots),
    ('G330', 'Nugget Paw Slippers', 'Uncommon', nugget_paw_slippers),
    ('G331', 'Halted Boots', 'Uncommon', halted_boots),
    ('G332', 'Bunny Slippers', 'Uncommon', bunny_slippers),
    ('G333', 'Batik Slip Ons', 'Uncommon', batik_slip_ons),
    ('G334', 'Durian Clogs', 'Uncommon', durian_clogs),
    ('G335', 'Teh Tarik Sandals', 'Uncommon', teh_tarik_sandals),
    ('G336', 'Refinery Hazard Boots', 'Uncommon', refinery_hazard_boots),
    ('G337', 'Rugged Clown Shoes', 'Uncommon', rugged_clown_shoes),
    ('G338', 'Ghillie Boots', 'Uncommon', ghillie_boots),
    ('G339', 'Rubber Duck Boots', 'Uncommon', rubber_duck_boots),
    ('G340', 'Velcro Dad Sneakers', 'Uncommon', velcro_dad_sneakers),
    ('G341', 'WAGMI Walkers', 'Uncommon', wagmi_walkers),
    ('G342', 'Whale Tail Flippers', 'Uncommon', whale_tail_flippers),
    ('G343', 'Afterimage Sneakers', 'Rare', afterimage_sneakers),
    ('G344', 'Light Up Sneakers', 'Rare', light_up_sneakers),
    ('G345', 'Mole Claw Boots', 'Rare', mole_claw_boots),
    ('G346', 'Moon Boots', 'Rare', moon_boots),
    ('G347', 'Rocket Boots', 'Rare', rocket_boots),
    ('G348', 'Ghost Miner Boots', 'Rare', ghost_miner_boots),
    ('G349', 'Cope Stilts', 'Rare', cope_stilts),
    ('G350', 'Surfboard Sandals', 'Rare', surfboard_sandals),
    ('G351', 'Banana Boots', 'Rare', banana_boots),
    ('G352', 'Pelita Lamp Clogs', 'Rare', pelita_lamp_clogs),
    ('G353', 'Wau Kite Sandals', 'Rare', wau_kite_sandals),
    ('G354', 'Paper Plane Shoes', 'Rare', paper_plane_shoes),
    ('G355', 'Candle Wick Stilts', 'Rare', candle_wick_stilts),
    ('G356', 'Rug Roller Skates', 'Rare', rug_roller_skates),
    ('G357', 'Seeker Ping Boots', 'Rare', seeker_ping_boots),
    ('G358', 'Tank Tread Boots', 'Rare', tank_tread_boots),
    ('G359', 'This Is Fine Slippers', 'Rare', this_is_fine_slippers),
    ('G360', 'Validator Node Boots', 'Rare', validator_node_boots),
    ('G361', 'Whale Spout Boots', 'Rare', whale_spout_boots),
    ('G362', 'Slot Leader Sprinters', 'Legendary', slot_leader_sprinters),
    ('G363', 'Burn Address Treads', 'Legendary', burn_address_treads),
    ("G364", "Grandpa Hal's Boots", 'Legendary', grandpa_hals_boots),
    ('G365', 'Diamond Sole Boots', 'Legendary', diamond_sole_boots),
    ('G366', 'Moonshot Thrusters', 'Legendary', moonshot_thrusters),
    ('G367', 'Jack O Stompers', 'Legendary', jack_o_stompers),
    ('G368', 'Margin Call Anchors', 'Legendary', margin_call_anchors),
    ('G369', 'Motherlode Footprints', 'Legendary', motherlode_footprints),
    ('G370', 'Frozen Chain Skates', 'Legendary', frozen_chain_skates),
]

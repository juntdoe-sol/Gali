"""Gali milestone certificates (Levels 3, 6, 10, 15, 20, 30): animated 16:9 cards in the Founding Miner card's
format (240x135 art shown at 3x, scene at 2x zoom).

Scene: the miner wears each of the level's rewards in turn, a flash between them: a certificate with several
rewards claims ONE of them at random when the Gali NFT market opens (Level 30: one full outfit, top and pants).

usage (from the repo root): python3 -I scripts/nft/milestone/card.py OUTDIR [LEVEL ...]
writes OUTDIR/level-N.gif and level-N.png (GIF 720x405, PNG 1200x675) for each level (default: all)
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
GEAR = f'{REPO}/scripts/gear555'
sys.path.insert(0, GEAR)
import kit  # noqa: E402
import milestone_weapons as MW  # noqa: E402
import milestone_gear as MG  # noqa: E402

OUTDIR = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUTDIR, exist_ok=True)
FONTS = f'{GEAR}/fonts'

W, H = 240, 135
NF = 42
MS = 100

NIGHT = (22, 14, 30)
STONE = [(30, 20, 40), (40, 28, 52), (52, 38, 66), (66, 50, 82)]
PANEL = (48, 32, 58)
INK = (42, 28, 20)
CREAM = (246, 234, 206)
LILAC = (186, 166, 214)
DIM = (150, 130, 176)
GOLD = [(92, 52, 20), (150, 92, 28), (214, 150, 40), (246, 196, 72), (255, 236, 160)]
BLUE = [(20, 46, 92), (30, 92, 150), (40, 150, 214), (79, 214, 239), (190, 246, 255)]

GREEN = [(20, 60, 30), (40, 110, 50), (70, 170, 80), (106, 212, 111), (210, 255, 200)]
VIOLET = [(50, 20, 80), (100, 40, 150), (160, 70, 220), (214, 130, 255), (250, 220, 255)]

_w = lambda fn: {'weapon': fn}  # noqa: E731
LEVELS = {
    3: dict(rar='UNCOMMON', ramp=GREEN, ribbon=(40, 130, 60), items=[{'shoe': MG.baby_steps_boots}],
            line='UNCOMMON SHOES', reward='Baby Steps Boots', claim='CLAIMS THESE SHOES'),
    6: dict(rar='UNCOMMON', ramp=GREEN, ribbon=(40, 130, 60), items=[{'top': MG.six_pack_tee}],
            line='UNCOMMON TOP', reward='Six Pack Tee', claim='CLAIMS THIS TEE'),
    10: dict(rar='RARE', ramp=BLUE, ribbon=(30, 92, 170), items=[_w(i[3]) for i in MW.ITEMS if i[2] == 'Rare'],
             line='1 RARE WEAPON  .  RANDOM', reward='1 of 3 weapons', claim='CLAIM 1 AT RANDOM'),
    15: dict(rar='RARE', ramp=BLUE, ribbon=(30, 92, 170), items=[{'shoe': i[3]} for i in MG.SHOES[1:]],
             line='1 RARE SHOES  .  RANDOM', reward='1 of 3 shoes', claim='CLAIM 1 AT RANDOM'),
    20: dict(rar='LEGENDARY', ramp=GOLD, ribbon=(216, 38, 58), items=[_w(i[3]) for i in MW.ITEMS if i[2] == 'Legendary'],
             line='1 LEGENDARY WEAPON  .  RANDOM', reward='1 of 3 weapons', claim='CLAIM 1 AT RANDOM'),
    30: dict(rar='LEGENDARY', ramp=VIOLET, ribbon=(150, 40, 200), items=[{'top': o[2], 'bottom': o[4]} for o in MG.OUTFITS],
             line='1 LEGENDARY OUTFIT  .  RANDOM', reward='1 of 10 outfits', claim='CLAIM 1 AT RANDOM'),
}
for _L in LEVELS.values():
    _L['nf'] = 42 if len(_L['items']) <= 3 else 8 * len(_L['items'])


def font(name, size):
    return ImageFont.truetype(f'{FONTS}/{name}.ttf', size)


# ---------------------------------------------------------------- scene (1x, shown at 2x)
SW, SH = 52, 62
FEET_Y = 50
atlas = Image.open(f'{REPO}/app/public/pixel/atlas.png').convert('RGBA')


def ground():
    import json
    rects = json.load(open(f'{REPO}/app/src/engine/art.json'))['atlas']['rects']
    g = rects['ground']
    return atlas.crop((g[0] + 276, g[1] + 186, g[0] + 276 + SW, g[1] + 186 + SH))


GROUND = ground()
def scene(k, L):
    sc = Image.new('RGBA', (SW, SH), (0, 0, 0, 255))
    sc.alpha_composite(GROUND)
    sc.alpha_composite(Image.new('RGBA', (SW, SH), (30, 10, 60, 110)))
    ramp = L['ramp']
    n = len(L['items'])
    SEG = L['nf'] // n
    i, t = divmod(k, SEG)
    gear = L['items'][i % n]
    t = t * 14 // SEG  # the 14-step routine, stretched or squeezed to this level's segment
    # light rays behind the miner, turning
    cx, cy = SW // 2, FEET_Y - 18
    for a in range(8):
        ang = a * math.pi / 4 + k * 0.07
        for r in range(9, 24):
            if r % 2:
                continue
            x, y = int(cx + math.cos(ang) * r), int(cy + math.sin(ang) * r)
            if 0 <= x < SW and 0 <= y < SH:
                sc.putpixel((x, y), (*ramp[3 if r < 15 else 2], 255))
    # the miner wearing it: idle, then a swing (a weapon) or a walk, then a cheer
    if 'weapon' in gear:
        pose, f = ('idle', (t // 2) % 4) if t < 5 else ('swing', min(5, t - 5)) if t < 11 else ('cheer', 1 + (t - 11) % 3)
    else:
        pose, f = ('idle', (t // 2) % 4) if t < 5 else ('walk', (t - 5) % 6) if t < 11 else ('cheer', 1 + (t - 11) % 3)
    img, (ax, ay) = kit.render({k_: fn() for k_, fn in gear.items()}, pose, f)
    d = ImageDraw.Draw(sc)
    d.rectangle((cx - 6, FEET_Y, cx + 6, FEET_Y + 1), fill=(8, 12, 24))
    sc.alpha_composite(img, (cx - ax, FEET_Y - ay))
    # sparkles
    for j, (sx, sy) in enumerate(((cx - 17, cy - 8), (cx + 16, cy - 2), (cx + 6, cy - 19), (cx - 9, cy + 12))):
        ph = (k + j * 3) % 5
        if ph < 3:
            s = [1, 2, 1][ph]
            for q in range(-s, s + 1):
                for (px_, py_) in ((sx + q, sy), (sx, sy + q)):
                    if 0 <= px_ < SW and 0 <= py_ < SH:
                        sc.putpixel((px_, py_), (*ramp[4], 255))
    # "?" over the miner's head: you get one of these at random
    if t >= 11 and n > 1:
        qx, qy = cx + 9, FEET_Y - 44
        d.rectangle((qx - 3, qy - 1, qx + 3, qy + 8), fill=(*ramp[1], 255))
        d.text((qx - 2, qy - 1), '?', font=font('Silkscreen_400Regular', 8), fill=(*ramp[4], 255))
    # flash between rewards
    if t == 0 and n > 1:
        sc.alpha_composite(Image.new('RGBA', (SW, SH), (255, 246, 230, 170)))
    elif t == 1:
        sc.alpha_composite(Image.new('RGBA', (SW, SH), (255, 246, 230, 70)))
    return sc, i % n


# ---------------------------------------------------------------- the card around it
def card_base(L):
    ramp = L['ramp']
    img = Image.new('RGBA', (W, H), NIGHT)
    px = img.load()
    d = ImageDraw.Draw(img)
    for y in range(H):
        for x in range(W):
            sx = x + (y // 9) * 6
            n = (x * 7 + y * 13 + (x * y) % 11) % 17
            k = 0 if n < 9 else 1 if n < 14 else 2
            if sx % 12 == 0 or y % 9 == 0:
                k = 0
            px[x, y] = (*STONE[k], 255)
    x0, y0, x1, y1 = 1, 1, W - 2, H - 2
    for i, c in enumerate((INK, ramp[1], ramp[3], ramp[2], INK)):
        d.rectangle((x0 + i, y0 + i, x1 - i, y1 - i), outline=c)
    d.line((x0 + 2, y0 + 2, x1 - 3, y0 + 2), fill=ramp[4])
    d.line((x0 + 2, y0 + 2, x0 + 2, y1 - 3), fill=ramp[4])
    for (cx, cy) in ((3, 3), (W - 4, 3), (3, H - 4), (W - 4, H - 4)):
        for r in range(4, -1, -1):
            c = INK if r == 4 else ramp[1] if r == 3 else ramp[3] if r > 0 else (255, 255, 255)
            d.polygon(((cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)), fill=c)
    sx0, sy0 = 8, 6
    d.rectangle((sx0 - 2, sy0 - 2, sx0 + 105, sy0 + 125), fill=INK)
    d.rectangle((sx0 - 1, sy0 - 1, sx0 + 104, sy0 + 124), outline=ramp[2])
    d.rectangle((118, 6, W - 7, H - 7), fill=PANEL)
    d.rectangle((118, 6, W - 7, H - 7), outline=ramp[1])
    # wordmark, outlined
    wm = Image.open(f'{REPO}/app/assets/brand/wordmark.png').convert('RGBA')
    ww = 46
    wh = round(wm.height * ww / wm.width)
    sm = wm.resize((ww, wh), Image.BOX)
    sm.putalpha(sm.getchannel('A').point(lambda v: 255 if v > 110 else 0))
    o = Image.new('RGBA', (ww + 2, wh + 2), (0, 0, 0, 0))
    op, sp = o.load(), sm.load()
    for y in range(wh):
        for x in range(ww):
            if sp[x, y][3]:
                for dx, dy in ((0, 0), (1, 0), (0, 1), (2, 1), (1, 2), (2, 2), (2, 0), (0, 2)):
                    if op[x + dx, y + dy][3] == 0:
                        op[x + dx, y + dy] = (*INK, 255)
    for y in range(wh):
        for x in range(ww):
            if sp[x, y][3]:
                op[x + 1, y + 1] = sp[x, y]
    PCX = (118 + W - 7) // 2
    img.alpha_composite(o, (PCX - ww // 2 - 1, 10))
    # ribbon
    ry, rw = 33, 60
    rx0, rx1 = PCX - rw // 2, PCX + rw // 2
    dark = tuple(int(c * 0.65) for c in L['ribbon'])
    for (a0, a1) in ((rx0 - 8, rx0 + 3), (rx1 - 3, rx1 + 8)):
        d.rectangle((a0, ry + 3, a1, ry + 10), fill=dark, outline=INK)
    d.polygon(((rx0 - 9, ry + 3), (rx0 - 5, ry + 6), (rx0 - 9, ry + 10)), fill=PANEL)
    d.polygon(((rx1 + 9, ry + 3), (rx1 + 5, ry + 6), (rx1 + 9, ry + 10)), fill=PANEL)
    d.rectangle((rx0, ry, rx1, ry + 8), fill=L['ribbon'], outline=INK)
    d.line((rx0 + 1, ry + 1, rx1 - 1, ry + 1), fill=tuple(min(255, c + 80) for c in L['ribbon']))
    d.line((124, 74, W - 13, 74), fill=ramp[1])
    for yy in (84, 93):
        for x in range(124, W - 12, 2):
            px[x, yy] = (70, 52, 86, 255)
    # claim box with the three weapons as thumbnails
    by0, by1 = 101, 120
    d.rectangle((123, by0, W - 12, by1), fill=(36, 24, 46))
    for x in range(123, W - 11, 2):
        px[x, by0] = (*ramp[2], 255)
        px[x, by1] = (*ramp[2], 255)
    for y in range(by0, by1 + 1, 2):
        px[123, y] = (*ramp[2], 255)
        px[W - 12, y] = (*ramp[2], 255)
    return img, PCX


def thumb(g):
    """The reward alone, idle, cropped tight (for the claim box)."""
    gear = {k: fn() for k, fn in g.items()}
    gear['head'] = 'none'
    img, _ = kit.render(gear, 'idle', 0, sil=True)
    bare, _ = kit.render({'head': 'none'}, 'idle', 0, sil=True)
    a, b = img.load(), bare.load()
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    o = out.load()
    for y in range(img.height):
        for x in range(img.width):
            if a[x, y] != b[x, y] and a[x, y][3]:
                o[x, y] = a[x, y]
    bb = out.getbbox()
    return out.crop(bb) if bb else out


def text_layer(L, S, PCX, lvl):
    ramp = L['ramp']
    lay = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    t = ImageDraw.Draw(lay)
    sz = {3: dict(silk=16, jer=54, pix=24, pixs=17), 5: dict(silk=24, jer=81, pix=40, pixs=28)}[S]

    def say(s, x, y, name, size, col, shadow=True, crisp=True, anchor='mt'):
        t.fontmode = '1' if crisp else 'L'
        ft = font(name, size)
        if shadow:
            t.text((x * S + S, y * S + S), s, font=ft, fill=INK, anchor=anchor)
        t.text((x * S, y * S), s, font=ft, fill=col, anchor=anchor)

    SILK, JER, PIX, PIXB = 'Silkscreen_400Regular', 'Jersey15_400Regular', 'PixelifySans_400Regular', 'PixelifySans_700Bold'
    say('MILESTONE', PCX, 35, SILK, sz['silk'], CREAM)
    m = Image.new('L', lay.size, 0)
    md = ImageDraw.Draw(m)
    md.fontmode = '1'
    md.text((PCX * S, 48 * S), f'LEVEL {lvl}', font=font(JER, sz['jer']), fill=255, anchor='mt')
    sh = Image.new('L', lay.size, 0)
    sh.paste(m, (S, S))
    lay.paste(Image.new('RGBA', lay.size, (*INK, 255)), (0, 0), sh)
    say(L['line'], PCX, 65, SILK, sz['silk'], ramp[3], shadow=False)
    rows = [('LEVEL REACHED', str(lvl), 77), ('RARITY', L['rar'].title(), 86), ('REWARD', L['reward'], 95)]
    for (lab, val, y) in rows:
        say(lab, 125, y, SILK, sz['silk'], LILAC, shadow=False, anchor='lt')
        say(val, W - 13, y - 1, PIXB, sz['pix'], CREAM, crisp=False, anchor='rt')
    say(L['claim'], 166, 104, SILK, sz['silk'], CREAM, shadow=False, anchor='lt')
    say('when market opens', 166, 111, PIX, sz['pixs'], LILAC, shadow=False, crisp=False, anchor='lt')
    say('Soulbound  |  gali.lol', PCX, 122, PIX, sz['pixs'], DIM, shadow=False, crisp=False)
    stamp = 'UNCLAIMED'
    ft = font(SILK, sz['silk'] if S == 3 else 16)
    t.fontmode = '1'
    tw = t.textlength(stamp, font=ft)
    bx, by = (W - 12) * S - tw - 4 * S, 9 * S
    t.rectangle((bx, by, bx + tw + 4 * S, by + 7 * S), fill=(36, 24, 46), outline=ramp[3], width=max(1, S // 2))
    t.text((bx + 2 * S, by + int(1.5 * S)), stamp, font=ft, fill=ramp[3])
    return lay, m


def shine_title(img, m, S, k, ramp):
    bb = m.getbbox()
    hgt = bb[3] - bb[1]
    band = Image.new('RGBA', img.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    for (lo, hi, c) in ((0, .22, ramp[4]), (.22, .58, ramp[3]), (.58, 1.01, ramp[2])):
        bd.rectangle((bb[0], bb[1] + int(lo * hgt), bb[2], bb[1] + int(hi * hgt)), fill=(*c, 255))
    p = (k % 14) / 13
    x = bb[0] - hgt + int(p * (bb[2] - bb[0] + 2 * hgt))
    bd.polygon(((x, bb[3]), (x + hgt // 2, bb[1]), (x + hgt // 2 + 4 * S, bb[1]), (x + 4 * S, bb[3])), fill=(255, 255, 255, 255))
    img.paste(band, (0, 0), m)


def render(lvl, S, only=None):
    L = LEVELS[lvl]
    base, PCX = card_base(L)
    thumbs = [thumb(g) for g in L['items']]
    lay, m = text_layer(L, S, PCX, lvl)
    frames = []
    for k in range(L['nf']) if only is None else [only]:
        a = base.copy()
        sc, cur = scene(k, L)
        a.alpha_composite(sc.resize((SW * 2, SH * 2), Image.NEAREST), (8, 6))
        # the rewards in the claim box (three at a time, the one on show lit, the others dimmed)
        x = 126 + (13 if len(thumbs) == 1 else 0)
        n = len(thumbs)
        show = [cur] if n == 1 else list(range(3)) if n == 3 else [(cur - 1) % n, cur, (cur + 1) % n]
        for j in show:
            th = thumbs[j]
            th2 = th.copy()
            if j != cur:
                th2.putalpha(th2.getchannel('A').point(lambda v: v * 45 // 100))
            s = min(1.0, 16 / th.height, 12 / th.width)
            th2 = th2.resize((max(1, round(th.width * s)), max(1, round(th.height * s))), Image.NEAREST)
            a.alpha_composite(th2, (x + (12 - th2.width) // 2, 103 + (16 - th2.height) // 2))
            x += 13
        big = a.resize((W * S, H * S), Image.NEAREST)
        big.alpha_composite(lay)
        shine_title(big, m, S, k, L['ramp'])
        frames.append(big.convert('RGB'))
    return frames


for lvl in [int(a) for a in sys.argv[2:]] or sorted(LEVELS):
    fr = render(lvl, 3)
    mosaic = Image.new('RGB', (720, 405 * 4))
    for i, k in enumerate((3, 10, 17, 31)):
        k = k * len(fr) // 42
        mosaic.paste(fr[k], (0, 405 * i))
    pal = mosaic.quantize(colors=255, method=Image.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in fr]
    gif = f'{OUTDIR}/level-{lvl}.gif'
    q[0].save(gif, save_all=True, append_images=q[1:], duration=MS, loop=0, optimize=False, disposal=1)
    render(lvl, 5, only=9)[0].save(f'{OUTDIR}/level-{lvl}.png')
    print(gif, os.path.getsize(gif) // 1024, 'KB')

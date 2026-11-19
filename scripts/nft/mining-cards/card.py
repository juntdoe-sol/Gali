"""Gali Mining Cards: eight animated pixel cards, $10 to $1000, sold in the Market for SKR or ORE.

Each card is a cut through a mine: a cave window with an ore crystal cluster that grows with the price, the card's
dollar value, and three perk icons (autopilot, free items, XP). One loop is exactly 2 seconds (20 frames, 0.1 s):
a shine sweeps across, the crystals breathe, sparkles blink and, from Silver up, ore dust rises. The Legend card's
frame shifts colour.

Art is 108x150, shown at 3x (GIF 324x450). A still PNG of the same size is written for the app on Android.

usage (from the repo root): python3 scripts/nft/mining-cards/card.py OUTDIR [VALUE ...]
writes OUTDIR/card-VALUE.gif and card-VALUE-still.png (Android cannot have two files with one name) for each value (default: all eight)
"""
import colorsys
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
FONTS = f'{REPO}/scripts/gear555/fonts'
OUTDIR = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUTDIR, exist_ok=True)

W, H = 108, 150
NF = 20  # frames
MS = 100  # ms a frame: 20 x 0.1 s = one 2 second loop
SCALE = 3

INK = (6, 8, 18)
NIGHT = (10, 14, 32)
CREAM = (246, 238, 214)
STAR = (255, 214, 92)

# five-step ramps, darkest first
COPPER = [(60, 28, 16), (118, 58, 30), (176, 96, 52), (224, 146, 92), (255, 210, 168)]
BRONZE = [(64, 36, 14), (128, 78, 30), (190, 124, 50), (232, 172, 84), (255, 226, 160)]
SILVER = [(40, 46, 60), (88, 98, 118), (146, 158, 178), (202, 212, 228), (250, 252, 255)]
GOLD = [(92, 52, 20), (160, 100, 28), (220, 160, 40), (255, 207, 74), (255, 240, 170)]
PLAT = [(30, 60, 70), (70, 120, 130), (130, 190, 196), (196, 236, 236), (248, 255, 255)]
DIAMOND = [(14, 44, 80), (24, 100, 150), (40, 170, 214), (62, 230, 255), (210, 250, 255)]
MASTER = [(44, 18, 74), (96, 40, 150), (156, 76, 220), (208, 140, 255), (246, 222, 255)]
LEGEND = [(80, 10, 24), (150, 24, 40), (216, 50, 58), (255, 120, 96), (255, 220, 190)]

GREEN = [(10, 60, 40), (16, 120, 80), (20, 190, 120), (20, 241, 149), (190, 255, 220)]

TIERS = {
    10: dict(name='STARTER', ramp=COPPER, gem=GREEN, crystals=[(0, 14, 7)]),
    25: dict(name='BRONZE', ramp=BRONZE, gem=GREEN, crystals=[(-7, 10, 6), (3, 16, 7)]),
    50: dict(name='SILVER', ramp=SILVER, gem=DIAMOND, crystals=[(-10, 11, 6), (0, 19, 8), (10, 13, 6)]),
    75: dict(name='GOLD', ramp=GOLD, gem=GOLD, crystals=[(-13, 10, 6), (-4, 20, 8), (7, 16, 7), (15, 9, 5)]),
    100: dict(name='PLATINUM', ramp=PLAT, gem=PLAT, crystals=[(-15, 12, 6), (-5, 23, 9), (6, 18, 8), (15, 11, 6)]),
    250: dict(name='DIAMOND', ramp=DIAMOND, gem=DIAMOND, crystals=[(-18, 10, 6), (-9, 19, 8), (1, 27, 10), (12, 20, 8), (20, 12, 6)]),
    500: dict(name='MASTER', ramp=MASTER, gem=MASTER, crystals=[(-20, 13, 6), (-11, 22, 8), (0, 31, 11), (11, 24, 9), (20, 15, 7)]),
    1000: dict(name='LEGEND', ramp=LEGEND, gem=GOLD, crystals=[(-22, 14, 7), (-13, 25, 9), (0, 35, 12), (13, 27, 9), (22, 16, 7), (-28, 8, 5), (28, 9, 5)]),
}


def font(name, size):
    return ImageFont.truetype(f'{FONTS}/{name}.ttf', size)


SMALL = font('Silkscreen_400Regular', 8)
# the game's A mark (app/assets/brand/mark512.png, the A-mountain with the ORE ring); drawn at 3x so it stays sharp
LOGO = Image.open(f'{REPO}/app/assets/brand/mark512.png').convert('RGBA')
LOGO = LOGO.crop(LOGO.split()[3].getbbox())
LOGO_W = 17 * 3  # 17 card pixels wide
LOGO3 = LOGO.resize((LOGO_W, round(LOGO.height * LOGO_W / LOGO.width)), Image.LANCZOS)


def logo(big):
    """Stamp the A mark on a 3x frame, centred at the top of the cave window, with a hard shadow."""
    x = (big.width - LOGO3.width) // 2
    y = (AY0 + 2) * SCALE
    shadow = Image.new('RGBA', LOGO3.size, (6, 8, 18, 0))
    shadow.putalpha(LOGO3.split()[3].point(lambda a: int(a * 0.85)))
    big.alpha_composite(shadow, (x + SCALE, y + SCALE))
    big.alpha_composite(LOGO3, (x, y))
    return big
BIG = font('Jersey15_400Regular', 34)


def hue_shift(ramp, deg):
    out = []
    for r, g, b in ramp:
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        r2, g2, b2 = colorsys.hls_to_rgb((h + deg / 360) % 1, l, s)
        out.append((round(r2 * 255), round(g2 * 255), round(b2 * 255)))
    return out


def text_c(d, cx, y, s, f, fill, outline=None, shadow=None):
    d.fontmode = '1'
    w = d.textlength(s, font=f)
    x = round(cx - w / 2)
    if shadow:
        d.text((x + 1, y + 1), s, font=f, fill=shadow)
    if outline:
        for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            d.text((x + ox, y + oy), s, font=f, fill=outline)
    d.text((x, y), s, font=f, fill=fill)


# ---------------------------------------------------------------- pieces
def frame(img, ramp):
    """Bevelled metal frame with notched corners and four rivets."""
    d = ImageDraw.Draw(img)
    d.rectangle((1, 0, W - 2, H - 1), fill=INK)
    d.rectangle((0, 1, W - 1, H - 2), fill=INK)
    d.rectangle((1, 1, W - 2, H - 2), fill=ramp[2])
    # light top and left, dark bottom and right
    d.line((2, 1, W - 3, 1), fill=ramp[4])
    d.line((1, 2, 1, H - 3), fill=ramp[4])
    d.line((2, 2, W - 4, 2), fill=ramp[3])
    d.line((2, 3, 2, H - 4), fill=ramp[3])
    d.line((2, H - 2, W - 2, H - 2), fill=ramp[0])
    d.line((W - 2, 2, W - 2, H - 2), fill=ramp[0])
    d.line((3, H - 3, W - 3, H - 3), fill=ramp[1])
    d.line((W - 3, 3, W - 3, H - 3), fill=ramp[1])
    # inner well
    d.rectangle((4, 4, W - 5, H - 5), fill=INK)
    d.rectangle((5, 5, W - 6, H - 6), fill=NIGHT)
    for (x, y) in ((2, 2), (W - 4, 2), (2, H - 4), (W - 4, H - 4)):
        d.rectangle((x, y, x + 1, y + 1), fill=ramp[0])
        img.putpixel((x, y), ramp[4])


def body_pattern(img, ramp):
    """Faint diagonal hatching in the card body, tinted by the tier."""
    px = img.load()
    tint = tuple(round(NIGHT[i] * 0.75 + ramp[1][i] * 0.25) for i in range(3))
    for y in range(5, H - 5):
        for x in range(5, W - 5):
            if (x + y) % 6 == 0 and px[x, y][:3] == NIGHT:
                px[x, y] = (*tint, 255)


AX0, AY0, AX1, AY1 = 9, 20, W - 10, 84  # art window


def cave(img, L, k):
    """The cave window: rock, an ore vein, the crystal cluster and its breathing glow."""
    d = ImageDraw.Draw(img)
    ramp, gem = L['ramp'], L['gem']
    d.rectangle((AX0 - 1, AY0 - 1, AX1 + 1, AY1 + 1), fill=ramp[1])
    d.rectangle((AX0, AY0, AX1, AY1), fill=INK)
    px = img.load()
    # rock: dark gradient with speckles, fixed per card
    for y in range(AY0, AY1 + 1):
        for x in range(AX0, AX1 + 1):
            t = (y - AY0) / (AY1 - AY0)
            base = (round(18 + 14 * t), round(16 + 10 * t), round(34 + 8 * t))
            n = (x * 73856093 ^ y * 19349663) & 255
            if n < 18:
                base = tuple(min(255, c + 16) for c in base)
            elif n > 246:
                base = tuple(max(0, c - 8) for c in base)
            px[x, y] = (*base, 255)
    # the window is an arch: round off the top corners with frame colour
    for y in range(AY0, AY0 + 10):
        for x in range(AX0, AX1 + 1):
            r = 10
            for (ccx, ccy) in ((AX0 + r, AY0 + r), (AX1 - r, AY0 + r)):
                if ((x < AX0 + r and ccx == AX0 + r) or (x > AX1 - r and ccx == AX1 - r)) and (x - ccx) ** 2 + (y - ccy) ** 2 > r * r:
                    px[x, y] = (*ramp[1], 255)
    # stalactites hanging from the roof
    for j, (sx, sl) in enumerate(((AX0 + 16, 7), (AX0 + 27, 4), (AX0 + 41, 9), (AX0 + 57, 5), (AX0 + 70, 8))):
        for i in range(sl):
            wdt = max(0, 2 - i * 3 // sl)
            for q in range(-wdt, wdt + 1):
                if AX0 <= sx + q <= AX1:
                    px[sx + q, AY0 + 6 + i] = (78, 64, 104, 255) if q <= 0 else (52, 42, 74, 255)
        # a drip that falls once per loop from one of them
        if j == 2:
            dy = AY0 + 6 + sl + (k * 3) % 36
            if dy < AY1 - 11:
                px[sx, dy] = (*gem[4], 255)
    # cracks and ore nuggets in the rock walls (fixed per card)
    for (x0, y0, x1, y1) in ((AX0 + 3, AY0 + 30, AX0 + 12, AY0 + 24), (AX1 - 4, AY0 + 18, AX1 - 14, AY0 + 26), (AX0 + 30, AY0 + 14, AX0 + 36, AY0 + 19)):
        d.line((x0, y0, x1, y1), fill=(12, 10, 22))
    for j in range(5 + len(L['crystals'])):
        hsh = (j * 2654435761 + 12345) & 0xFFFFFFFF
        nx = AX0 + 4 + hsh % (AX1 - AX0 - 10)
        ny = AY0 + 12 + (hsh >> 12) % 34
        if abs(nx - (AX0 + AX1) // 2) < 14 + len(L['crystals']) * 4 and ny > AY0 + 20:
            continue
        d.rectangle((nx, ny, nx + 2, ny + 1), fill=gem[1])
        px[nx, ny] = (*gem[3], 255)
        px[nx + 1, ny] = (*gem[4], 255)
    # floor
    fy = AY1 - 10
    d.rectangle((AX0, fy, AX1, AY1), fill=(28, 22, 40))
    for x in range(AX0, AX1 + 1, 3):
        px[x, fy] = (44, 36, 60, 255)
    cx = (AX0 + AX1) // 2
    # glow: a soft ellipse that breathes once per loop
    breathe = 0.5 + 0.5 * math.sin(2 * math.pi * k / NF)
    tall = max(h for _, h, _ in L['crystals'])
    gr = 12 + tall * 0.6 + breathe * 4
    for y in range(AY0, AY1 + 1):
        for x in range(AX0, AX1 + 1):
            dist = math.hypot((x - cx) / 1.25, (y - (fy - tall * 0.45)))
            if dist < gr:
                a = (1 - dist / gr) ** 2 * (0.45 + 0.25 * breathe)
                r, g, b, _ = px[x, y]
                c = gem[3]
                px[x, y] = (round(r + (c[0] - r) * a), round(g + (c[1] - g) * a), round(b + (c[2] - b) * a), 255)
    if L.get('rays'):
        rcx, rcy = cx, fy - tall * 0.5
        for a in range(8):
            ang = a * math.pi / 4 + (k / NF) * (math.pi / 4)
            for rr in range(int(tall * 0.6), 60):
                for wv in (-0.035, 0, 0.035):
                    x = int(rcx + math.cos(ang + wv) * rr)
                    y = int(rcy + math.sin(ang + wv) * rr)
                    if AX0 <= x <= AX1 and AY0 <= y < fy:
                        r_, g_, b_, _ = px[x, y]
                        c = gem[3]
                        al = 0.22 * (1 - rr / 60)
                        px[x, y] = (round(r_ + (c[0] - r_) * al), round(g_ + (c[1] - g_) * al), round(b_ + (c[2] - b_) * al), 255)
    # crystals, back ones first (shorter first)
    for dx, h, w in sorted(L['crystals'], key=lambda c: c[1]):
        crystal(img, cx + dx, fy + 1, h, w, gem, k)
    # a pickaxe stuck in the floor on the left
    pick(img, AX0 + 6, fy - 1, ramp)


def crystal(img, x, base, h, w, gem, k):
    """A hexagonal ore crystal pointing up: light left face, dark right face, a highlight that blinks."""
    d = ImageDraw.Draw(img)
    half = w // 2
    top = base - h
    tip = top - max(3, w // 2)
    left = [(x - half, base), (x - half, top), (x, tip), (x, base)]
    right = [(x, base), (x, tip), (x + half, top), (x + half, base)]
    d.polygon(left, fill=gem[3], outline=gem[0])
    d.polygon(right, fill=gem[2], outline=gem[0])
    d.line((x, tip + 1, x, base - 1), fill=gem[4])
    # highlight runs up the left face once per loop
    hy = base - 2 - ((k * 3 + h) % max(4, h))
    if top <= hy <= base - 2:
        d.line((x - half + 1, hy, x - 1, hy - 1), fill=gem[4])


def pick(img, x, y, ramp):
    d = ImageDraw.Draw(img)
    # handle
    for i in range(10):
        img.putpixel((x + i // 2, y - i), (120, 78, 44, 255))
        img.putpixel((x + i // 2 + 1, y - i), (82, 52, 30, 255))
    # head
    hx, hy = x + 5, y - 10
    d.line((hx - 5, hy + 2, hx - 1, hy - 1), fill=ramp[3])
    d.line((hx - 1, hy - 1, hx + 5, hy + 1), fill=ramp[3])
    d.line((hx - 5, hy + 3, hx - 1, hy), fill=ramp[1])
    d.line((hx, hy, hx + 5, hy + 2), fill=ramp[1])


def ornaments(img, L, k):
    d = ImageDraw.Draw(img)
    ramp, tier = L['ramp'], L['tier']
    if tier >= 3:
        for (x, y, sx, sy) in ((5, 5, 1, 1), (W - 6, 5, -1, 1), (5, H - 6, 1, -1), (W - 6, H - 6, -1, -1)):
            for i in range(7):
                img.putpixel((x + i * sx, y), (*ramp[4], 255))
                img.putpixel((x, y + i * sy), (*ramp[4], 255))
            img.putpixel((x + sx, y + sy), (*ramp[3], 255))
    if tier >= 5:
        # a gem set in the bottom edge of the frame, pulsing
        gem = L['gem']
        gx, gy = W // 2, H - 3
        lit = gem[4] if (k // 5) % 2 == 0 else gem[3]
        d.polygon([(gx - 4, gy), (gx, gy - 4), (gx + 4, gy), (gx, gy + 2)], fill=gem[2], outline=INK)
        d.line((gx - 1, gy - 2, gx, gy - 3), fill=lit)


CROWN = [
    'k..k..k',
    'kak.kak',
    'kaakaak',
    'kaaaaak',
    'kbbbbbk',
    'kkkkkkk',
]


def ribbon(img, L):
    d = ImageDraw.Draw(img)
    ramp = L['ramp']
    d.rectangle((8, 7, W - 9, 16), fill=ramp[1])
    d.line((8, 7, W - 9, 7), fill=ramp[3])
    d.line((8, 16, W - 9, 16), fill=ramp[0])
    for x in (6, 7):
        d.line((x, 9, x, 14), fill=ramp[0])
        d.line((W - 1 - x, 9, W - 1 - x, 14), fill=ramp[0])
    text_c(d, W / 2, 8, L['name'], SMALL, ramp[4], shadow=ramp[0])
    if L['tier'] >= 6:
        tw = d.textlength(L['name'], font=SMALL)
        for x in (round(W / 2 - tw / 2) - 11, round(W / 2 + tw / 2) + 3):
            icon(img, x, 9, CROWN, GOLD)


def value(img, v, L):
    d = ImageDraw.Draw(img)
    text_c(d, W / 2, 84, f'${v}', BIG, GOLD[3], outline=INK, shadow=GOLD[0])
    text_c(d, W / 2, 117, 'MINING CARD', SMALL, CREAM, shadow=INK)


ICONS = {
    # 9x9: . empty, a/b/c ramp light to dark, w white, k ink
    'auto': [
        '...kkk...',
        '..kcbck..',
        '.kc...ck.',
        'kc..w..ck',
        'kb..ww.bk',
        'kc.....ck',
        '.kc...ck.',
        '..kcbck..',
        '...kkk...',
    ],
    'gift': [
        '...k.k...',
        '..kwkwk..',
        'kkkkkkkkk',
        'kaaawaaak',
        'kkkkkkkkk',
        '.kbbwbbk.',
        '.kbbwbbk.',
        '.kccwcck.',
        '.kkkkkkk.',
    ],
    'xp': [
        '....k....',
        '...kwk...',
        'kkkkakkkk',
        'kaaaaaaak',
        '.kbbbbbk.',
        '..kbbbk..',
        '.kbbkbbk.',
        '.kck.kck.',
        '.kk...kk.',
    ],
}


def icon(img, x, y, rows, ramp):
    pal = {'a': ramp[4], 'b': ramp[3], 'c': ramp[2], 'w': (255, 255, 255), 'k': INK}
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch != '.':
                img.putpixel((x + i, y + j), (*pal[ch], 255))


def perks(img, L):
    d = ImageDraw.Draw(img)
    ramp = L['ramp']
    y = 128
    d.rectangle((10, y - 2, W - 11, y + 11), fill=(14, 20, 44))
    d.line((10, y - 2, W - 11, y - 2), fill=ramp[1])
    xs = [24, W // 2 - 4, W - 33]
    for x, name, col in zip(xs, ('auto', 'gift', 'xp'), (GREEN, ramp, GOLD)):
        icon(img, x, y, ICONS[name], col)


# ---------------------------------------------------------------- animation layers
def sparkles(img, L, k):
    gem = L['gem']
    n = 3 + len(L['crystals'])
    for j in range(n):
        sx = AX0 + 6 + (j * 37) % (AX1 - AX0 - 12)
        sy = AY0 + 4 + (j * 23) % 40
        ph = (k + j * 7) % 10
        if ph < 4:
            s = [0, 1, 2, 1][ph]
            c = (*gem[4], 255)
            for q in range(-s, s + 1):
                for (x, y) in ((sx + q, sy), (sx, sy + q)):
                    if AX0 <= x <= AX1 and AY0 <= y <= AY1:
                        img.putpixel((x, y), c)


def dust(img, L, k, count):
    gem = L['gem']
    for j in range(count):
        x = AX0 + 4 + (j * 29) % (AX1 - AX0 - 8)
        span = AY1 - 12 - AY0
        y = AY1 - 12 - ((k * 2 + j * 11) % span)
        if AY0 <= y <= AY1:
            img.putpixel((x, y), (*gem[3 if j % 2 else 4], 255))


def shine(img, k):
    """A diagonal band of light crossing the whole card in the first 12 frames of the loop."""
    if k >= 12:
        return
    px = img.load()
    pos = -30 + k * (W + 60) / 11
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if not a:
                continue
            dd = (x + y * 0.5) - pos
            if -6 < dd < 6:
                s = (1 - abs(dd) / 6) * 0.55
                px[x, y] = (round(r + (255 - r) * s), round(g + (255 - g) * s), round(b + (255 - b) * s), a)


# ---------------------------------------------------------------- one card
def render(v, k):
    L = dict(TIERS[v])
    L['tier'] = list(TIERS).index(v)
    L['rays'] = L['tier'] >= 4
    if v == 1000:
        L['ramp'] = hue_shift(LEGEND, 14 * math.sin(2 * math.pi * k / NF))
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    frame(img, L['ramp'])
    body_pattern(img, L['ramp'])
    ribbon(img, L)
    cave(img, L, k)
    ornaments(img, L, k)
    sparkles(img, L, k)
    if L['tier'] >= 2:
        dust(img, L, k, 3 + L['tier'] * 2)
    value(img, v, L)
    perks(img, L)
    shine(img, k)
    return img


def save(v):
    frames = [logo(render(v, k).resize((W * SCALE, H * SCALE), Image.NEAREST)) for k in range(NF)]
    # GIF: transparent corners, every frame full, so no ghosting between frames
    pal = []
    for f in frames:
        p = f.convert('RGBA')
        alpha = p.split()[3]
        q = p.convert('RGB').quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        mask = Image.eval(alpha, lambda a: 255 if a < 128 else 0)
        q.paste(255, mask)
        q.info['transparency'] = 255
        pal.append(q)
    pal[0].save(f'{OUTDIR}/card-{v}.gif', save_all=True, append_images=pal[1:], duration=MS, loop=0, disposal=2, transparency=255, optimize=False)
    frames[5].save(f'{OUTDIR}/card-{v}-still.png', optimize=True)
    print(f'card-{v}: {NF} frames, {NF * MS / 1000:.1f}s loop')


if __name__ == '__main__':
    values = [int(a) for a in sys.argv[2:]] or list(TIERS)
    for v in values:
        save(v)

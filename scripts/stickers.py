"""
Gali chat stickers: small animated pixel scenes drawn from the game's own atlas (the miner, the font,
the UI icons). Writes one PNG strip per sticker (frames side by side, 4x scale) for the app, and a GIF
of each for sharing. Run: python3 scripts/stickers.py
"""
import json, math, os, random
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app')
ART = json.load(open(os.path.join(APP, 'src/engine/art.json')))
ATLAS = Image.open(os.path.join(APP, 'assets/pixel/atlas.png')).convert('RGBA')
RECTS = ART['atlas']['rects']
FONT = ART['font']
MINER = ART['actors']['miner']
HATS = ART['actors']['hats']
OUT = os.path.join(APP, 'assets/stickers')
GIFS = os.path.join(ROOT, 'docs/stickers')
os.makedirs(OUT, exist_ok=True)
os.makedirs(GIFS, exist_ok=True)

S = 48          # sticker size in art px
SCALE = 4       # PNG strip scale
N = 8           # frames per sticker
LOOK = {'hat': 'hat-yellow', 'fit': '#2f5fd0', 'pick': '#c9c9c9'}


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def sprite(name, tint=None):
    r = RECTS.get(name)
    if not r:
        return None
    im = ATLAS.crop((r[0], r[1], r[0] + r[2], r[1] + r[3]))
    if tint:
        c = hexrgb(tint)
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                a = px[x, y][3]
                if a:
                    px[x, y] = (c[0], c[1], c[2], a)
    return im


def miner(pose, f, look=LOOK):
    cv = Image.new('RGBA', (30, 34), (0, 0, 0, 0))
    px, pt = 5, 6
    base = f'miner-{pose}-{f}'
    for layer in MINER['order']:
        if layer == 'hat':
            h = HATS[look['hat']]
            s = sprite(look['hat'])
            hx, hy = MINER['head'][pose][f]
            cv.alpha_composite(s, (px + hx - h['ax'], pt + hy - h['ay']))
        else:
            tint = look['fit'] if layer == 'fit' else look['pick'] if layer == 'pick' else None
            s = sprite(f'{base}-{layer}', tint)
            if s:
                cv.alpha_composite(s, (px, pt))
    return cv  # feet at (15, 31)


def text_img(t, color, scale=1):
    w = 0
    chars = []
    for ch in t.upper():
        if ch == ' ':
            w += FONT['space'] + FONT['gap']
            chars.append(None)
            continue
        cw = FONT['widths'].get(ch, 3)
        chars.append((ch, cw))
        w += cw + FONT['gap']
    w = max(1, w - FONT['gap'])
    im = Image.new('RGBA', (w, FONT['h']), (0, 0, 0, 0))
    x = 0
    for c in chars:
        if c is None:
            x += FONT['space'] + FONT['gap']
            continue
        ch, cw = c
        s = sprite(f'font-{ord(ch)}', color)
        if s:
            im.alpha_composite(s, (x, 0))
        x += cw + FONT['gap']
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    return im


def outlined(im, color=(18, 10, 38, 255), thick=1):
    w, h = im.width + thick * 2, im.height + thick * 2
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    a = im.split()[3]
    sil = Image.new('RGBA', im.size, color)
    sil.putalpha(a)
    for dx in range(-thick, thick + 1):
        for dy in range(-thick, thick + 1):
            if dx or dy:
                out.alpha_composite(sil, (thick + dx, thick + dy))
    out.alpha_composite(im, (thick, thick))
    return out


def label(cv, t, color, y, scale=2, bob=0):
    im = outlined(text_img(t, color, scale), thick=1)
    if im.width > S - 2:
        im = outlined(text_img(t, color, 1), thick=1)
    cv.alpha_composite(im, ((S - im.width) // 2, y + bob))


def disc(cv, cx, cy, r, fill, ring=None):
    d = ImageDraw.Draw(cv)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill, outline=ring)


def paste_c(cv, im, cx, by):
    """paste with its bottom centre at (cx, by)"""
    cv.alpha_composite(im, (int(cx - im.width // 2), int(by - im.height)))


def icon(name, scale=1):
    s = sprite(name)
    if s and scale != 1:
        s = s.resize((s.width * scale, s.height * scale), Image.NEAREST)
    return s


def badge_bg(cv, c1, c2):
    """a rounded pixel tile with a two-tone background, like a chat sticker"""
    d = ImageDraw.Draw(cv)
    d.rounded_rectangle((1, 1, S - 2, S - 2), radius=7, fill=c1, outline=(18, 10, 38, 255))
    d.rounded_rectangle((3, 3, S - 4, S // 2), radius=5, fill=c2)


def stars(cv, cx, cy, t, n=3, r=7, colors=('#ffffff', '#ffd84a')):
    d = ImageDraw.Draw(cv)
    for i in range(n):
        a = t * math.tau + i * math.tau / n
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r * 0.4
        c = hexrgb(colors[i % len(colors)])
        d.rectangle((x - 1, y, x + 1, y), fill=c)
        d.rectangle((x, y - 1, x, y + 1), fill=c)


# ---------------- the set ----------------

def gm(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (255, 176, 80, 255), (255, 214, 120, 255))
    d = ImageDraw.Draw(cv)
    # the sun coming up, rays turning
    t = f / N
    for i in range(8):
        a = t * math.pi / 2 + i * math.tau / 8
        d.line((36 + math.cos(a) * 8, 26 + math.sin(a) * 8, 36 + math.cos(a) * 12, 26 + math.sin(a) * 12), fill=(255, 245, 190, 255), width=2)
    disc(cv, 36, 26, 6, (255, 236, 120, 255), (240, 150, 40, 255))
    paste_c(cv, miner('cheer', [0, 1, 2, 1, 0, 1, 2, 3][f]), 18, 44)
    label(cv, 'GM', '#ffffff', 2, bob=[0, -1, -1, 0, 0, -1, -1, 0][f])
    return cv


def gn(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (36, 40, 98, 255), (58, 62, 140, 255))
    d = ImageDraw.Draw(cv)
    disc(cv, 35, 14, 6, (255, 240, 180, 255))
    disc(cv, 38, 12, 5, (58, 62, 140, 255))
    for (x, y) in [(8, 10), (14, 22), (40, 26), (30, 6)]:
        if (f + x) % 3:
            d.point((x, y), fill=(255, 255, 255, 255))
    m = miner('idle', 0).rotate(90, expand=True)
    paste_c(cv, m, 20, 44)
    for i, ch in enumerate('ZZZ'):
        k = (f + i * 3) % N
        z = text_img(ch, '#cfe0ff')
        cv.alpha_composite(z, (26 + i * 4 + k // 2, 30 - k * 2))
    label(cv, 'GN', '#ffe9a0', 2)
    return cv


def letsmine(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (80, 60, 50, 255), (110, 86, 70, 255))
    d = ImageDraw.Draw(cv)
    # a rock with gold in it
    d.polygon([(30, 42), (34, 32), (42, 30), (46, 36), (45, 42)], fill=(90, 84, 104, 255), outline=(40, 34, 50, 255))
    d.rectangle((36, 34, 38, 36), fill=(255, 210, 74, 255))
    d.rectangle((41, 37, 42, 38), fill=(255, 226, 122, 255))
    sf = [0, 1, 2, 3, 4, 5, 5, 0][f]
    paste_c(cv, miner('swing', sf), 20, 44)
    if sf in (3, 4):
        stars(cv, 33, 32, f / N, 4, 6)
    label(cv, "LET'S", '#ffd24a', 2, scale=1)
    label(cv, 'MINE', '#ffd24a', 9)
    return cv


def lfg(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (120, 24, 30, 255), (170, 40, 40, 255))
    d = ImageDraw.Draw(cv)
    for i in range(7):
        h = 8 + ((f + i * 2) % 4) * 3
        x = 4 + i * 6
        col = [(255, 154, 61, 255), (255, 210, 74, 255), (255, 106, 42, 255)][(i + f) % 3]
        d.rectangle((x, 46 - h, x + 4, 45), fill=col)
    paste_c(cv, miner('dance1', f % 6), 24, 42)
    label(cv, 'LFG', '#ffffff', 2, bob=-(f % 2))
    return cv


def gold(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (36, 52, 110, 255), (50, 74, 150, 255))
    g = icon('ui-gem', 2) or icon('ui-star', 2)
    paste_c(cv, miner('cheer', [0, 1, 2, 2, 1, 0, 1, 2][f]), 16, 44)
    if g:
        cv.alpha_composite(g, (26, 18 - [0, 1, 2, 1, 0, 1, 2, 1][f]))
    stars(cv, 34, 22, f / N, 4, 10, ('#ffffff', '#ffd84a', '#7fe3ff'))
    label(cv, 'GOLD!', '#ffd24a', 2)
    return cv


def rekt(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (60, 20, 40, 255), (90, 30, 60, 255))
    m = miner('idle', 0).rotate(-90 if f < 4 else -90, expand=True)
    shake = [0, 1, -1, 0, 1, 0, -1, 0][f]
    paste_c(cv, m, 24 + shake, 44)
    stars(cv, 30, 30, f / N, 3, 7)
    label(cv, 'REKT', '#ff6a6a', 3)
    return cv


def wagmi(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (30, 90, 70, 255), (40, 130, 100, 255))
    paste_c(cv, miner('dance2', f % 4), 14, 44)
    other = dict(LOOK, fit='#d04a3a', hat='hat-teal')
    paste_c(cv, miner('dance2', (f + 2) % 4, other).transpose(Image.FLIP_LEFT_RIGHT), 34, 44)
    h = icon('ui-heart')
    if h:
        cv.alpha_composite(h, (24 - h.width // 2, 16 - (f % 4)))
    label(cv, 'WAGMI', '#c8ffb8', 2)
    return cv


def gg(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (70, 40, 120, 255), (100, 60, 170, 255))
    d = ImageDraw.Draw(cv)
    random.seed(7)
    for i in range(16):
        x = random.randint(4, 43)
        y = (random.randint(0, 40) + f * 3) % 40 + 4
        col = [(255, 210, 74, 255), (61, 224, 200, 255), (255, 79, 216, 255), (255, 255, 255, 255)][i % 4]
        d.rectangle((x, y, x + 1, y), fill=col)
    paste_c(cv, miner('cheer', [0, 1, 2, 1, 0, 1, 2, 1][f]), 24, 44)
    t = icon('ui-trophy')
    if t:
        cv.alpha_composite(t, (30, 22))
    label(cv, 'GG', '#ffffff', 2)
    return cv


def bonk(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (40, 50, 80, 255), (60, 74, 120, 255))
    sf = [0, 1, 2, 3, 4, 5, 5, 0][f]
    paste_c(cv, miner('swing', sf), 18, 44)
    if sf in (3, 4, 5):
        d = ImageDraw.Draw(cv)
        r = 4 + (sf - 3) * 3
        cx, cy = 34, 34
        for i in range(8):
            a = i * math.tau / 8
            d.line((cx + math.cos(a) * r, cy + math.sin(a) * r, cx + math.cos(a) * (r + 4), cy + math.sin(a) * (r + 4)), fill=(255, 216, 74, 255), width=1)
        disc(cv, cx, cy, 2, (255, 255, 255, 255))
    label(cv, 'BONK!', '#ffd24a', 2, bob=-1 if sf in (3, 4) else 0)
    return cv


def motherlode(f):
    cv = Image.new('RGBA', (S, S))
    badge_bg(cv, (20, 40, 60, 255), (30, 70, 90, 255))
    d = ImageDraw.Draw(cv)
    t = f / N
    for i in range(12):
        a = i * math.tau / 12 + t
        r0, r1 = 6 + (f % 4) * 2, 18 + (f % 4) * 2
        d.line((24 + math.cos(a) * r0, 28 + math.sin(a) * r0, 24 + math.cos(a) * r1, 28 + math.sin(a) * r1), fill=(127, 245, 200, 200) if i % 2 else (255, 216, 74, 220), width=1)
    g = icon('ui-gem', 2)
    if g:
        cv.alpha_composite(g, (24 - g.width // 2, 28 - g.height // 2 - (f % 2)))
    label(cv, 'MOTHERLODE', '#7ff5c8', 4, scale=1)
    label(cv, '!!!', '#ffd24a', 36)
    return cv


SET = [('gm', gm), ('gn', gn), ('letsmine', letsmine), ('lfg', lfg), ('gold', gold), ('rekt', rekt), ('wagmi', wagmi), ('gg', gg), ('bonk', bonk), ('motherlode', motherlode)]

for name, fn in SET:
    frames = [fn(f) for f in range(N)]
    strip = Image.new('RGBA', (S * N, S), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        strip.alpha_composite(fr, (i * S, 0))
    strip.resize((S * N * SCALE, S * SCALE), Image.NEAREST).save(os.path.join(OUT, f'{name}.png'), optimize=True)
    big = [fr.resize((S * 4, S * 4), Image.NEAREST) for fr in frames]
    # GIF: flatten onto the chat's dark blue so the rounded corners look clean
    gif = []
    for b in big:
        bg = Image.new('RGBA', b.size, (15, 23, 52, 255))
        bg.alpha_composite(b)
        gif.append(bg.convert('P', palette=Image.ADAPTIVE, colors=64))
    gif[0].save(os.path.join(GIFS, f'gali-{name}.gif'), save_all=True, append_images=gif[1:], duration=130, loop=0, disposal=2)
    print(name)

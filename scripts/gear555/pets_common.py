"""Gali Gear 555 pets: Common tier (G464-G500). Each fn(t) -> RGBA frame, t 0..3."""
from pets_lib import *  # noqa: F401,F403
from pets_lib import B, CAP, P, LN, S, eye, bigeye, blush, render, frame, spark, dot, poly, box, halo, PINK, BOB, C


# G465 ------------------------------------------------------------ Coin Slot Bug
def coin_slot_bug(t):
    f = frame(16, 12)
    g = '#9aa2b8'
    bob = (0, 0, -1, 0)[t]
    by = 4 + bob
    # legs (scuttle)
    for i, x in enumerate((3, 6, 9)):
        dx = (0, 1, 0, -1)[(t + i) % 4] // 1
        P(f, x + dx, 11, '#5a5f70', 2, 'leg')
        P(f, x, 10, '#5a5f70', 1, 'leg')
    box(f, 1, by, 11, by + 6, g, 'body')
    # coin slot on the back
    for x in range(4, 9):
        P(f, x, by + 1, '#2a2430', 0, 'slot')
    P(f, 4, by + 2, g, 4, 'body')
    # coin dropping in on frames 1-2
    if t in (1, 2):
        cy = by - 3 + t
        for (dx, dy, k) in ((0, 0, 3), (1, 0, 2), (0, 1, 2), (1, 1, 1)):
            P(f, 6 + dx, cy + dy, '#f6bc36', k, 'coin')
    # little rivets / panel line
    P(f, 2, by + 4, g, 1, 'body')
    P(f, 9, by + 4, g, 1, 'body')
    # head
    B(f, 13, by + 4, 2.4, 2.2, '#7a8296', 'head')
    eye(f, 13, by + 3, blink=(t == 3))
    P(f, 14, by + 3, '#ff5a6a', 2, 'face') if False else None
    # antennae
    P(f, 14, by + 1, '#5a5f70', 2, 'ant')
    P(f, 15, by, '#ff6a5a', 2, 'ant')
    return render(f)


# G466 ------------------------------------------------------------ Blockhash Bunny
def blockhash_bunny(t):
    f = frame(17, 15)
    g = '#a8a6b8'
    bob = BOB[t]
    sway = (0, 1, 0, -1)[t]
    # body + tail
    B(f, 6, 11, 4.5, 3.3, g, 'body')
    B(f, 1.8, 10.5, 1.4, 1.3, '#f2f0f4', 'tail', tones=(2, 3, 4))
    # head
    B(f, 11, 8 + bob, 3.6, 3.0, g, 'head')
    # long droopy ears: rise from the crown then flop down the back
    for (a, b) in (((10, 5 + bob), (7, 3 + bob)), ((7, 3 + bob), (5, 6 + bob + (sway > 0))),):
        CAP(f, a, b, 1.0, g, 'ear', tones=(2, 2, 3))
    CAP(f, (12, 5 + bob), (10, 2 + bob), 1.0, '#8e8ca0', 'ear2', tones=(1, 2, 2))
    CAP(f, (10, 2 + bob), (8 + sway, 1 + bob), 0.9, '#8e8ca0', 'ear2', tones=(1, 2, 2))
    LN(f, (9, 4 + bob), (7, 4 + bob), '#ffaabf', 2, 'inner')
    # X eye
    ex, ey = 11, 7 + bob
    for (dx, dy) in ((0, 0), (2, 0), (1, 1), (0, 2), (2, 2)):
        P(f, ex + dx, ey + dy, '#2a2430', 0, 'face')
    P(f, 14, 9 + bob, '#ff7a9a', 2, 'face')
    blush(f, 13, 10 + bob)
    P(f, 9, 14, g, 3, 'foot')
    P(f, 10, 14, g, 2, 'foot')
    P(f, 3, 14, g, 1, 'foot')
    return render(f)


# G467 ------------------------------------------------------------ Arena Rooster
def arena_rooster(t):
    f = frame(16, 17)
    puff = (0, 1, 1, 0)[t]
    peck = (0, 0, 1, 0)[t]
    # tail feathers
    for (a, b, col) in (((5, 8), (1, 3), '#2e5a8a'), ((5, 9), (1, 6), '#24486e'), ((5, 9), (2, 9), '#2e5a8a')):
        CAP(f, a, b, 0.9, col, 'tail')
    # body + puffed chest
    B(f, 7, 10, 4.6, 3.6, '#c8402e', 'body')
    B(f, 10, 9.5, 2.6 + puff * 0.6, 2.8 + puff * 0.4, '#e2562f', 'chest')
    # wing
    B(f, 6.5, 10, 2.6, 1.6, '#a0302a', 'wing', tones=(1, 1, 2))
    # neck + head
    hx, hy = 11 + peck, 5 + peck
    B(f, hx, hy, 2.2, 2.2, '#e2562f', 'head')
    # comb
    for (x, y) in ((hx - 1, hy - 3), (hx, hy - 3), (hx, hy - 4), (hx + 1, hy - 3), (hx - 1, hy - 2)):
        P(f, x, y, '#ff3048', 2 if y > hy - 4 else 3, 'comb')
    # beak + wattle
    P(f, hx + 2, hy, '#ffd23a', 3, 'beak')
    P(f, hx + 3, hy, '#ffb020', 2, 'beak')
    P(f, hx + 2, hy + 1, '#ffb020', 1, 'beak')
    P(f, hx + 1, hy + 2, '#ff3048', 1, 'wattle')
    P(f, hx + 1, hy + 3, '#ff3048', 0, 'wattle')
    eye(f, hx + 1, hy - 1, blink=(t == 3))
    # legs
    for x in (6, 9):
        P(f, x, 14, '#ffb020', 2, 'leg')
        P(f, x, 15, '#ffb020', 2, 'leg')
        P(f, x + 1, 16, '#ffb020', 1, 'leg')
        P(f, x - 1, 16, '#ffb020', 2, 'leg')
    return render(f)


# G468 ------------------------------------------------------------ Ember Newt
def ember_newt(t):
    f = frame(20, 9)
    o = '#ff8a2a'
    wag = (0, 1, 0, -1)[t]
    # tail sweeping
    pts = [(1, 5 + wag), (3, 5 + wag * 0.5), (5, 6), (7, 6)]
    for a, b in zip(pts, pts[1:]):
        CAP(f, a, b, 0.7 + (a[0] / 10), o, 'tail')
    CAP(f, (6, 5.6), (13, 5.4), 2.0, o, 'body')
    B(f, 15, 4.8, 2.8, 2.0, o, 'head')
    # legs
    for x, ph in ((7, 0), (12, 1)):
        dx = (0, 1, 0, -1)[(t + ph * 2) % 4] if False else (0, 1)[(t + ph) % 2]
        P(f, x + dx, 8, o, 1, 'leg')
        P(f, x, 7, o, 1, 'leg')
    # red spots
    for (x, y) in ((7, 4), (10, 5), (12, 4), (4, 5), (15, 3)):
        P(f, x, y, '#d42a2a', 2, 'spot')
    P(f, 8, 4, '#ffd06a', 3, 'spot')
    eye(f, 16, 4, blink=(t == 2))
    P(f, 18, 5, '#c0501a', 1, 'face')
    # tiny ember rising
    img = render(f)
    ey = (2, 1, 0, -1)[t]
    if ey >= 0:
        dot(img, 10 + (t % 2), ey, (255, 200, 80), 220)
    return img


# G469 ------------------------------------------------------------ Crack Beetle
def crack_beetle(t):
    f = frame(15, 10)
    k = '#3c3650'
    # legs
    for i, x in enumerate((3, 6, 9)):
        dx = (0, 1)[(t + i) % 2]
        P(f, x + dx, 9, '#2a2436', 2, 'leg')
        P(f, x, 8, '#2a2436', 2, 'leg')
    B(f, 6.5, 5.5, 5.5, 3.6, k, 'shell', tones=(1, 2, 2, 3, 4))
    # wing seam
    for x in range(3, 11):
        P(f, x, 5 if x < 7 else 5, k, 0, 'seam') if x in (2,) else None
    LN(f, (7, 2), (7, 8), k, 0, 'seam')
    # orange dot
    P(f, 5, 4, '#ff8a2a', 2, 'dot')
    P(f, 4, 4, '#ff8a2a', 3, 'dot')
    P(f, 5, 5, '#ff8a2a', 1, 'dot')
    P(f, 4, 5, '#ff8a2a', 2, 'dot')
    # head
    B(f, 12.3, 6.5, 1.8, 1.6, '#2a2436', 'head', tones=(1, 2, 3))
    P(f, 13, 6, 'white', 1, 'face') if False else None
    f.put(13, 6, 'white', 1 if t != 3 else 0, 'face')
    # antennae twitch
    a = (0, 1, 0, 0)[t]
    P(f, 13, 4, '#2a2436', 2, 'ant')
    P(f, 14, 3 + a, '#2a2436', 2, 'ant')
    # shine
    P(f, 3, 3, k, 4, 'shell')
    return render(f)


# G470 ------------------------------------------------------------ Clan Ferret
def clan_ferret(t):
    f = frame(20, 11)
    b = '#9a6a44'
    bob = (0, 0, -1, 0)[t]
    wag = (0, -1, 0, 1)[t]
    CAP(f, (1, 6 + wag), (4, 7), 1.0, '#6e4a30', 'tail')
    CAP(f, (5, 7), (12, 6.5 + bob * 0.5), 2.3, b, 'body')
    B(f, 15, 5 + bob, 2.8, 2.4, b, 'head')
    # pale face mask
    B(f, 16.5, 5.6 + bob, 1.6, 1.2, '#e8cfa8', 'mask', tones=(2, 3))
    P(f, 18, 5 + bob, '#3a2420', 1, 'nose')
    P(f, 13, 2 + bob, b, 3, 'ear')
    eye(f, 16, 4 + bob, blink=(t == 3))
    # red bandana at the neck, knot flapping behind
    for (x, y) in ((13, 6), (13, 7), (14, 7), (14, 8), (15, 8), (12, 6)):
        P(f, x, y + bob, '#e02a3a', 2 if y < 8 else 1, 'band')
    P(f, 11, 5 + bob + (t % 2), '#e02a3a', 3, 'band')
    P(f, 13, 6 + bob, 'white', 1, 'band') if False else None
    P(f, 14, 8 + bob, '#ffffff', 1, 'band')
    # legs
    for x, ph in ((6, 0), (12, 1)):
        dx = (0, 1)[(t + ph) % 2]
        P(f, x + dx, 10, '#6e4a30', 2, 'leg')
        P(f, x, 9, '#6e4a30', 2, 'leg')
    return render(f)


# G471 ------------------------------------------------------------ Floor the Goldfish
def floor_goldfish(t):
    f = frame(16, 16)
    # bowl: glassy pale blue sphere with water
    B(f, 8, 9, 6.6, 6.4, '#bfe6f4', 'bowl', tones=(2, 3, 3, 4))
    for y in range(5, 16):
        for x in range(0, 16):
            p = f.get(x, y)
            if p and p[3] == 'bowl' and y >= 6:
                p[1] = R('#6cc4ec')
                p[2] = 2 if y > 7 else 3
    # rim
    for x in range(4, 13):
        P(f, x, 3, '#e6f6fc', 3 if x < 8 else 2, 'rim')
    # water surface line
    for x in range(2, 15):
        p = f.get(x, 6)
        if p:
            P(f, x, 6, '#e6f6fc', 3, 'surf')
    # fish sinks lower each frame, faces right
    fy = 8 + (0, 1, 2, 3)[t] * 0.67
    fx = 7 + (0, 1, 0, -1)[t]
    B(f, fx, fy + 1, 2.2, 1.5, '#ff8a2a', 'fish', tones=(1, 2, 3))
    P(f, fx - 3, fy, '#ff6a1a', 2, 'fin')
    P(f, fx - 3, fy + 2, '#ff6a1a', 2, 'fin')
    P(f, fx - 2, fy + 1, '#ff6a1a', 1, 'fin')
    P(f, fx + 1, fy, 'eye', 0, 'fish') if False else f.put(int(fx + 1), int(fy + 0.5), 'eye', 0, 'fish')
    # gravel floor
    for x in range(3, 14):
        P(f, x, 14, ('#e8c27a', '#c8a060')[x % 2], 2, 'gravel')
    # glass highlight
    P(f, 3, 8, 'white', 1, 'glint')
    P(f, 3, 9, 'white', 1, 'glint')
    P(f, 4, 7, 'white', 1, 'glint')
    img = render(f)
    # bubble
    by = (5, 4, 2, 1)[t]
    dot(img, int(fx) + 2, by + 1, (230, 250, 255), 255, over=True)
    return img


# G472 ------------------------------------------------------------ Pond Frog
def pond_frog(t):
    f = frame(16, 12)
    g = '#4ec43c'
    sq = (0, 1, 0, 0)[t]
    # back legs
    B(f, 3.5, 9.5, 2.5, 2.0, g, 'leg', tones=(1, 2, 2))
    B(f, 8, 8 + sq * 0.5, 6.2, 3.6 - sq * 0.4, g, 'body', tones=(1, 2, 2, 3))
    # pale belly / throat
    B(f, 10.5, 9.8, 3.0, 1.6, '#c8f08a', 'belly', tones=(2, 3))
    # eye bumps on top
    for ex in (6, 11):
        B(f, ex + 0.5, 4.2 + sq, 2.0, 1.9, g, 'bump', tones=(1, 2, 3))
        bigeye(f, ex, 3 + sq, blink=(t == 3))
    # wide smile
    for x in range(9, 14):
        P(f, x, 8 + sq, g, 0, 'mouth')
    P(f, 14, 7 + sq, g, 0, 'mouth')
    # front feet
    P(f, 12, 11, g, 3, 'foot')
    P(f, 13, 11, g, 2, 'foot')
    P(f, 2, 11, g, 1, 'foot')
    P(f, 3, 11, g, 2, 'foot')
    return render(f)


# G473 ------------------------------------------------------------ GM Chick
def gm_chick(t):
    f = frame(22, 17)
    y = '#ffd23a'
    open_ = t in (1, 2)
    hop = (0, 0, -1, 0)[t]
    B(f, 6, 11 + hop, 4.8, 4.3, y, 'body', tones=(1, 2, 2, 3, 4))
    B(f, 4.5, 12 + hop, 2.0, 1.4, y, 'wing', tones=(1, 1, 2))
    P(f, 6, 6 + hop, y, 3, 'tuft')
    P(f, 7, 5 + hop, y, 3, 'tuft')
    eye(f, 7, 9 + hop)
    blush(f, 7, 11 + hop)
    if open_:
        S(f, 10, 9 + hop, ['oo.', 'r..', 'oo.'], {'o': ('#ff8a1a', 2), 'r': ('#c8303a', 1)})
    else:
        S(f, 10, 10 + hop, ['oo', 'o.'], {'o': ('#ff8a1a', 2)})
    P(f, 5, 16, '#ff8a1a', 2, 'foot')
    P(f, 8, 16, '#ff8a1a', 2, 'foot')
    P(f, 9, 16, '#ff8a1a', 1, 'foot')
    img = render(f)
    if open_:
        bub = frame(22, 17)
        box(bub, 11, 0, 21, 6, '#f4f0e4', 'bub', rnd=True, lit=3, mid=3, dk=2)
        bi = render(bub)
        # g (3 wide, with descender) and m (5 wide), dark ink
        G = [(12, 1), (13, 1), (14, 1), (12, 2), (14, 2), (12, 3), (13, 3), (14, 3), (14, 4), (12, 5), (13, 5)]
        M = [(15, 2), (16, 2), (17, 2), (18, 2) if False else (15, 3), (15, 4), (16, 2), (17, 3), (17, 4), (18, 2), (18, 3), (18, 4)]
        M = [(15, 2), (15, 3), (15, 4), (16, 2), (17, 2), (17, 3), (17, 4), (18, 2), (18, 3) if False else (17, 2)]
        bi = render(bub)
        for (x, yy) in G:
            dot(bi, x, yy, (42, 36, 48), 255, over=True)
        for (x, yy) in ((16, 2), (16, 3), (16, 4), (17, 2), (18, 3), (18, 4), (18, 2) if False else (17, 2), (16, 2)):
            pass
        for (x, yy) in ((16, 2), (16, 3), (16, 4), (17, 2), (18, 2), (18, 3), (18, 4), (19, 2), (20, 3), (20, 4)):
            dot(bi, x, yy, (42, 36, 48), 255, over=True)
        dot(bi, 11, 7, (42, 28, 20), 255)
        img.alpha_composite(bi)
    return img


# G474 ------------------------------------------------------------ Brain Jelly
def brain_jelly(t):
    f = frame(14, 12)
    sq = (0, 1, 0, -1)[t]
    rx, ry = 5.6 + sq * 0.4, 4.4 - sq * 0.4
    cy = 11 - ry
    B(f, 7, cy + 0.4, rx, ry, '#a86ae8', 'body', tones=(1, 2, 2, 3))
    # brain top: pink folds
    for y in range(0, 12):
        for x in range(14):
            p = f.get(x, y)
            if p and p[3] == 'body' and y < cy - 0.6:
                tone = 3 if ((x + y * 2) % 4 == 0) else 2 if (x < 7) else 1
                f.put(x, y, R('#ff96c8'), tone, 'brain')
    # swirl lines
    for (x, y) in ((5, int(cy) - 2), (6, int(cy) - 3), (8, int(cy) - 2), (9, int(cy) - 1), (4, int(cy) - 1)):
        if f.get(x, y):
            P(f, x, y, '#ff96c8', 0, 'brain')
    eye(f, 6, int(cy) + 1, blink=(t == 2))
    eye(f, 9, int(cy) + 1, blink=(t == 2))
    P(f, 3, int(cy) + 1, '#a86ae8', 4, 'body')
    # drips at the bottom
    P(f, 3, 11, '#a86ae8', 1, 'body')
    P(f, 10, 11, '#a86ae8', 1, 'body')
    return render(f)


# G475 ------------------------------------------------------------ Green Candle Bug
def green_candle_bug(t):
    f = frame(15, 16)
    g = '#3ed46a'
    for i, x in enumerate((3, 6, 9)):
        dx = (0, 1)[(t + i) % 2]
        P(f, x + dx, 15, '#1e6a3a', 2, 'leg')
    B(f, 6.5, 12, 5.2, 2.8, '#2e9a4a', 'shell', tones=(1, 2, 3))
    # the candle: wick + green body, grows a little on frames 1-2
    grow = (0, 1, 1, 0)[t]
    top = 3 - grow
    box(f, 5, top + 2, 8, 10, g, 'candle', rnd=False, lit=3, mid=2, dk=1)
    LN(f, (6, top), (6, top + 1), '#1e6a3a', 2, 'wick')
    LN(f, (6, 11), (6, 12), '#1e6a3a', 2, 'wick')
    P(f, 6, top - 1, '#c8ffb0', 3, 'wick') if t in (1, 2) else None
    # head
    B(f, 12.5, 12.6, 1.8, 1.6, '#1e6a3a', 'head', tones=(1, 2, 3))
    f.put(13, 12, 'white', 1 if t != 3 else 0, 'face')
    P(f, 14, 10, '#1e6a3a', 2, 'ant')
    return render(f)


# G476 ------------------------------------------------------------ Hat Dog Pup
def hat_dog_pup(t, legend=False):
    f = frame(17, 17)
    tan = '#d8a466'
    wag = (0, 1, 0, -1)[t]
    bob = (0, 0, -1, 0)[t] if not legend else (0, -1, 0, -1)[t]
    # tail
    CAP(f, (3, 11), (1, 8 + wag), 0.8, tan, 'tail')
    # sitting body
    B(f, 6.5, 12.5, 4.0, 3.6, tan, 'body')
    B(f, 9, 13, 2.0, 2.4, '#f0d0a0', 'chest', tones=(2, 3))
    # head
    hx, hy = 10.5, 7.5 + bob
    B(f, hx, hy, 3.6, 3.2, tan, 'head')
    # snout
    B(f, hx + 3.2, hy + 1.3, 1.7, 1.2, '#f0d0a0', 'snout', tones=(2, 3))
    P(f, int(hx) + 5, int(hy) + 1, '#2a2430', 0, 'nose')
    # floppy ear
    CAP(f, (hx - 1.5, hy - 1), (hx - 2.5, hy + 2), 1.0, '#a8743e', 'ear')
    eye(f, int(hx) + 1, int(hy), blink=(t == 3))
    blush(f, int(hx) + 2, int(hy) + 2)
    # pink knit beanie
    pk = '#ff6ea0'
    for (y, x0, x1) in ((-4, -2, 1), (-3, -3, 2), (-2, -3, 3)):
        for x in range(x0, x1 + 1):
            tone = 3 if (x < -1 or y == -4) else 2
            P(f, int(hx) + x, int(hy) + y, pk, tone, 'hat')
    for x in range(-4, 4):
        P(f, int(hx) + x, int(hy) - 1, pk, 1 if x > 1 else 2, 'cuff')
    P(f, int(hx) - 4, int(hy) - 1, pk, 3, 'cuff')
    # feet
    P(f, 8, 16, tan, 3, 'foot')
    P(f, 9, 16, tan, 2, 'foot')
    P(f, 11, 16, tan, 2, 'foot')
    P(f, 4, 16, tan, 1, 'foot')
    f._hat = (int(hx), int(hy) - 5)
    return f


def hat_dog_pup_fn(t):
    f = hat_dog_pup(t)
    hx, hy = f._hat
    P(f, hx - 1, hy, '#ffc0d4', 3, 'pom')
    P(f, hx, hy, '#ffc0d4', 2, 'pom')
    return render(f)


# G477 ------------------------------------------------------------ Copium Puff
def copium_puff(t):
    f = frame(16, 13)
    c = '#b4dcf8'
    bob = BOB[t]
    for (x, y, rx, ry) in ((5, 7, 3.4, 3.0), (9, 5.6, 3.6, 3.4), (12, 7.6, 2.8, 2.6), (8, 8.6, 5.0, 2.4)):
        B(f, x, y + bob, rx, ry, c, 'cloud', tones=(1, 2, 3, 4))
    # sleepy half closed eyes: lid line with a pupil below
    for ex in (7, 11):
        P(f, ex, 7 + bob, '#5a7aa0', 1, 'lid')
        P(f, ex + 1, 7 + bob, '#5a7aa0', 1, 'lid')
        P(f, ex, 8 + bob, 'eye', 0, 'face') if t != 2 else None
        P(f, ex + 1, 8 + bob, '#2a2430', 0, 'face') if t != 2 else None
    blush(f, 6, 9 + bob)
    blush(f, 13, 9 + bob)
    img = render(f)
    # exhaled wisp
    if t in (2, 3):
        x = 14 + (t - 2)
        dot(img, x, 4 + bob - (t - 2), (220, 240, 255), 200)
        dot(img, x + 1 if x < 15 else x, 3 + bob - (t - 2), (220, 240, 255), 140)
    return img


# G478 ------------------------------------------------------------ Coconut Buddy
def coconut_buddy(t):
    f = frame(14, 15)
    sq = (0, 1, 0, -1)[t]
    rx, ry = 5.0 + sq * 0.3, 4.8 - sq * 0.3
    cy = 14.4 - ry
    B(f, 7, cy, rx, ry, '#8a5a34', 'nut', tones=(0, 1, 2, 3))
    # fibre hatching
    for (x, y) in ((4, 0), (6, 2), (9, -1), (3, 2), (10, 2), (5, -2)):
        if f.get(x, int(cy) + y):
            P(f, x, int(cy) + y, '#8a5a34', 0, 'nut')
    # three eye holes on the top like a real coconut
    for (x, y) in ((5, -3), (7, -3), (6, -2)):
        P(f, x, int(cy) + y, '#4a2e1a', 1, 'holes')
    eye(f, 6, int(cy) + 1, blink=(t == 3))
    eye(f, 9, int(cy) + 1, blink=(t == 3))
    blush(f, 10, int(cy) + 2)
    # sprout
    sw = (0, 1, 0, 0)[t]
    top = int(cy - ry)
    LN(f, (7, top), (7, top - 2), '#4ec43c', 2, 'sprout')
    P(f, 6 - sw, top - 3, '#7ae05a', 3, 'leaf')
    P(f, 5 - sw, top - 3, '#4ec43c', 2, 'leaf')
    P(f, 8, top - 3, '#4ec43c', 2, 'leaf')
    P(f, 9 + sw, top - 4, '#4ec43c', 1, 'leaf')
    return render(f)


# G479 ------------------------------------------------------------ Island Crab
def island_crab(t):
    f = frame(18, 13)
    r = '#e84a3a'
    snap = t in (1, 3)
    up = (0, -1, 0, -1)[t]
    # legs
    for side in (-1, 1):
        for k in range(3):
            x = 9 + side * (4 + k)
            P(f, x, 11 + (k == 2), r, 1, 'leg')
            P(f, x, 10, r, 1, 'leg')
    B(f, 9, 8.5, 5.2, 3.0, r, 'body', tones=(1, 2, 2, 3))
    # claws raised
    for side in (-1, 1):
        cx = 9 + side * 6
        LN(f, (9 + side * 4, 7), (cx, 4 + up), r, 1, 'arm')
        B(f, cx, 2.5 + up, 1.8, 1.8, r, 'claw', tones=(1, 2, 3))
        if not snap:
            f.erase(int(cx + (0 if side > 0 else 0)), int(1 + up))
            f.erase(int(cx), int(2 + up))
    # eyes on stalks
    for ex in (7, 11):
        P(f, ex, 5, r, 2, 'stalk')
        P(f, ex, 4, 'white', 1, 'face')
        P(f, ex, 4, 'eye', 0, 'face') if t == 2 else None
        P(f, ex + (1 if ex > 9 else 0), 4, 'eye', 0, 'face') if t != 2 else None
    P(f, 8, 9, '#ff9a7a', 3, 'body')
    # sand under
    for x in range(3, 15):
        P(f, x, 12, ('#f0d48a', '#e2c070')[x % 3 == 0], 2, 'sand')
    return render(f)


# G480 ------------------------------------------------------------ Jeet Rabbit
def jeet_rabbit(t):
    f = frame(20, 12)
    w = '#f2eef0'
    ph = t % 2
    lift = (0, -1, 0, -1)[t]
    # body stretched mid-run
    CAP(f, (5, 7 + lift), (11, 6 + lift), 2.6, w, 'body', tones=(1, 2, 3))
    B(f, 14, 5 + lift, 2.6, 2.2, w, 'head')
    # ears pinned flat back
    LN(f, (13, 3 + lift), (8, 2 + lift), w, 2, 'ear')
    LN(f, (13, 4 + lift), (9, 3 + lift), '#d8d0d8', 1, 'ear')
    P(f, 10, 2 + lift, '#ffaabf', 2, 'ear')
    P(f, 16, 5 + lift, PINK, 2, 'nose') if False else P(f, 16, 5 + lift, '#ff7a9a', 2, 'nose')
    eye(f, 14, 4 + lift)
    # sweat drop (panic)
    P(f, 12, 2 + lift, '#7ad0ff', 3, 'sweat') if ph else None
    # legs: stretch / tuck
    if ph == 0:
        LN(f, (12, 8 + lift), (15, 10), w, 1, 'leg')
        LN(f, (5, 8 + lift), (1, 10), w, 1, 'leg')
    else:
        LN(f, (11, 8 + lift), (9, 10), w, 1, 'leg')
        LN(f, (6, 8 + lift), (8, 10), w, 1, 'leg')
    P(f, 3, 5 + lift, w, 3, 'tail')
    img = render(f)
    # speed lines
    for (y, x0, L) in ((4, 0, 2 + ph), (8, 0, 1 + (1 - ph))):
        for k in range(L):
            dot(img, x0 + k, y + lift, (200, 200, 220), 170)
    return img


# G481 ------------------------------------------------------------ Liquidated Lamb
def liquidated_lamb(t):
    f = frame(17, 14)
    wool = '#f2eee6'
    bob = (0, 0, -1, 0)[t]
    # legs
    for x in (4, 6, 10, 12):
        LN(f, (x, 10), (x, 13), '#4a3a44', 1, 'leg')
    # fluffy body: clustered puffs
    for (x, y) in ((4, 7), (7, 6), (10, 6.5), (12, 8), (5, 9.5), (9, 9.5)):
        B(f, x, y, 2.4, 2.2, wool, 'wool', tones=(1, 2, 3, 4))
    # shaved patch: bare pink skin with stubble
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8), (9, 8), (8, 9)):
        P(f, x, y, '#ffb6b0', 2 if y > 7 else 3, 'skin')
    P(f, 8, 8, '#e88a8a', 1, 'skin')
    # head
    B(f, 14, 5 + bob, 2.4, 2.0, '#4a3a44', 'head', tones=(1, 2, 3))
    B(f, 13.5, 3 + bob, 1.6, 1.0, wool, 'tuft', tones=(2, 3))
    P(f, 12, 5 + bob, '#4a3a44', 1, 'ear')
    P(f, 11, 6 + bob, '#4a3a44', 1, 'ear')
    f.put(15, 5 + bob, 'white', 1 if t != 3 else 0, 'face')
    # sad red down-arrow tag
    img = render(f)
    return img


# G482 ------------------------------------------------------------ Lobby Gecko
def lobby_gecko(t):
    f = frame(20, 9)
    g = '#2ec4b0'
    curl = (0, 1, 1, 0)[t]
    # curled tail
    CAP(f, (4, 6), (2, 6), 1.0, g, 'tail')
    pts = [(2, 6), (1, 5), (1, 4), (2, 3 + curl), (3, 4)]
    for a, b in zip(pts, pts[1:]):
        LN(f, a, b, g, 2, 'tail')
    # flat body
    CAP(f, (5, 6.2), (13, 6.2), 1.7, g, 'body')
    B(f, 15.5, 5.8, 2.4, 1.8, g, 'head')
    # spots
    for x in (7, 10, 12):
        P(f, x, 5, '#ffd84a', 3, 'spot')
    # splayed toes
    for x in (6, 12):
        P(f, x - 1, 8, g, 1, 'leg')
        P(f, x + 1, 8, g, 1, 'leg')
        P(f, x, 8, g, 2, 'leg')
    # big round eye, blink
    if t == 2:
        P(f, 16, 5, '#1a7a6e', 0, 'face')
        P(f, 17, 5, '#1a7a6e', 0, 'face')
    else:
        P(f, 16, 4, '#ffd84a', 3, 'face')
        P(f, 17, 4, '#ffd84a', 2, 'face')
        P(f, 16, 5, '#ffd84a', 2, 'face')
        P(f, 17, 5, 'eye', 0, 'face') if False else f.put(17, 5, 'eye', 0, 'face')
    P(f, 18, 6, '#1a7a6e', 1, 'face')
    img = render(f)
    return img


# G483 ------------------------------------------------------------ Mint Day Mouse
def mint_day_mouse(t):
    f = frame(18, 12)
    g = '#9c9ab0'
    bob = (0, 0, -1, 0)[t]
    # tail
    pts = [(4, 8), (2, 8), (1, 7 + (t % 2)), (1, 5)]
    for a, b in zip(pts, pts[1:]):
        LN(f, a, b, '#ffaabf', 2, 'tail')
    B(f, 7.5, 8, 4.0, 3.0, g, 'body')
    B(f, 11.5, 6.6 + bob, 2.6, 2.4, g, 'head')
    # big round ear
    B(f, 10, 3.6 + bob, 1.6, 1.6, g, 'ear', tones=(2, 3))
    P(f, 10, 4 + bob, '#ffaabf', 2, 'ear')
    eye(f, 12, 6 + bob, blink=(t == 3))
    P(f, 14, 7 + bob, '#ff7a9a', 2, 'nose')
    # white ticket in the mouth
    box(f, 13, 8 + bob, 17, 10 + bob, '#fbf8ee', 'ticket', rnd=False, lit=1, mid=1, dk=0)
    P(f, 15, 9 + bob, '#e04a6a', 1, 'ticket')
    P(f, 16, 9 + bob, '#e04a6a', 1, 'ticket')
    for x in (6, 9):
        P(f, x + (t % 2), 11, '#ffaabf', 2, 'foot')
    return render(f)


# G484 ------------------------------------------------------------ Pocket Monke
def pocket_monke(t):
    f = frame(16, 15)
    b = '#8a5636'
    sw = (0, 1, 0, -1)[t]
    # long arms reaching down to the ground, swinging
    CAP(f, (4, 7), (2 - sw * 0.5, 13), 1.0, b, 'arm-b')
    B(f, 7.5, 9.5, 4.3, 4.6, b, 'body', tones=(1, 2, 2, 3))
    B(f, 8.5, 11, 2.4, 2.4, '#d8a876', 'belly', tones=(2, 3))
    # ears
    B(f, 3.6, 5.2, 1.2, 1.2, '#d8a876', 'ear', tones=(1, 2))
    B(f, 12.6, 5.2, 1.2, 1.2, '#d8a876', 'ear', tones=(2, 3))
    B(f, 8, 5.4, 4.2, 3.6, b, 'head')
    # tan heart face
    B(f, 7.4, 6.2, 1.6, 1.8, '#e8bc8a', 'face', tones=(2, 3))
    B(f, 9.8, 6.2, 1.6, 1.8, '#e8bc8a', 'face', tones=(2, 3))
    B(f, 8.6, 7.8, 2.4, 1.4, '#e8bc8a', 'face', tones=(2, 3))
    eye(f, 7, 5, blink=(t == 2))
    eye(f, 10, 5, blink=(t == 2))
    P(f, 8, 8, '#8a5636', 0, 'mouth')
    P(f, 9, 8, '#8a5636', 0, 'mouth')
    CAP(f, (12, 7), (14 + sw * 0.5, 13), 1.0, b, 'arm-f')
    # feet
    P(f, 5, 14, b, 1, 'foot')
    P(f, 10, 14, b, 2, 'foot')
    return render(f)


# G485 ------------------------------------------------------------ Motherlode Mite
def motherlode_mite(t):
    f = frame(12, 9)
    for i, x in enumerate((3, 5, 7)):
        dx = (0, 1)[(t + i) % 2]
        P(f, x + dx, 8, '#4a2e1a', 2, 'leg')
    B(f, 5.5, 5, 4.2, 3.0, '#8a5a34', 'shell', tones=(1, 2, 2, 3))
    for i, (x, y) in enumerate(((3, 4), (6, 3), (5, 6), (8, 5))):
        tone = 4 if (i == t) else 2
        P(f, x, y, '#f6bc36', tone, 'fleck')
    B(f, 9.8, 5.8, 1.5, 1.4, '#5a3a24', 'head', tones=(1, 2, 3))
    f.put(10, 5, 'white', 1 if t != 2 else 0, 'face')
    P(f, 11, 3, '#5a3a24', 2, 'ant')
    img = render(f)
    if t == 1:
        dot(img, 7, 1, (255, 240, 160), 230)
    return img


# G486 ------------------------------------------------------------ Halt Turtle
def halt_turtle(t):
    f = frame(18, 14)
    gr = '#5cba4a'
    # legs + head (green)
    for x in (4, 10):
        B(f, x, 12, 1.4, 1.4, gr, 'leg', tones=(1, 2))
    B(f, 14.2, 9.6 - (t % 2) * 0.3, 2.8, 2.4, gr, 'head')
    P(f, 1, 11, gr, 1, 'tail')
    # grey shell dome
    B(f, 7.5, 9, 6.2, 4.6, '#8e92a4', 'shell', tones=(1, 2, 2, 3, 4))
    clip(f, lambda x, y: not (y > 11 and f.part_at(x, y) == 'shell'))
    for x in range(2, 14):
        P(f, x, 11, '#6a6e80', 1, 'rim')
    # hex plates
    for (x, y) in ((5, 7), (9, 7), (7, 9), (11, 9), (4, 9)):
        P(f, x, y, '#6a6e80', 1, 'plate')
    # eyes shut
    P(f, 15, 9, '#2a6a2a', 0, 'face')
    P(f, 16, 9, '#2a6a2a', 0, 'face')
    blush(f, 15, 10)
    img = render(f)
    # floating z
    zx, zy = (13, 4), (14, 3)
    z = [(0, 0), (1, 0), (2, 0), (1, 1), (0, 2), (1, 2), (2, 2)]
    oy = (3, 2, 1, 0)[t]
    for (dx, dy) in z:
        dot(img, 14 + dx, oy + dy, (200, 220, 255), 230 if t < 3 else 150)
    return img


def clip(f, keep):
    for y in range(f.h):
        for x in range(f.w):
            if f.px[y][x] and not keep(x, y):
                f.px[y][x] = None


# G487 ------------------------------------------------------------ Night Owl
def night_owl(t):
    f = frame(14, 16)
    b = '#8a5a3a'
    tilt = (0, 0, 1, 0)[t]
    B(f, 7, 10, 5.0, 5.2, b, 'body', tones=(1, 2, 2, 3))
    B(f, 7.5, 11.5, 3.0, 3.2, '#d8b48a', 'belly', tones=(2, 3))
    for (x, y) in ((6, 11), (8, 12), (7, 13), (9, 10)):
        P(f, x, y, '#a07a52', 1, 'belly')
    # ear tufts
    P(f, 3, 3 + tilt, b, 3, 'tuft')
    P(f, 11, 3, b, 2, 'tuft')
    P(f, 4, 4, b, 2, 'tuft')
    P(f, 10, 4, b, 2, 'tuft')
    B(f, 7, 6.5, 4.4, 3.0, b, 'head')
    # wide yellow eyes
    for ex in (4, 8):
        B(f, ex + 1, 6.5, 1.6, 1.6, '#ffd23a', 'eye', tones=(2, 3))
        if t == 3:
            for dx in range(3):
                P(f, ex + dx, 6, '#5a3a24', 0, 'lid')
                P(f, ex + dx, 5, '#8a5a3a', 1, 'lid')
                P(f, ex + dx, 7, '#8a5a3a', 1, 'lid')
        else:
            f.put(ex + 1, 6, 'eye', 0, 'face')
            f.put(ex + 1, 7, 'eye', 0, 'face')
    P(f, 7, 8, '#ff9a2a', 2, 'beak')
    P(f, 7, 9, '#c86a1a', 1, 'beak')
    # wing edges
    for y in range(9, 14):
        P(f, 2, y, b, 1, 'wing')
    # feet
    for x in (5, 6, 8, 9):
        P(f, x, 15, '#ff9a2a', 2, 'foot')
    return render(f)


# G488 ------------------------------------------------------------ Slag Rat
def slag_rat(t):
    f = frame(19, 11)
    g = '#8c8a9c'
    sniff = (0, 1, 0, 1)[t]
    pts = [(4, 8), (2, 8), (1, 7), (0, 5 + (t % 2))]
    for a, b in zip(pts, pts[1:]):
        LN(f, a, b, '#ffaabf', 1, 'tail')
    B(f, 8, 7.5, 4.8, 2.8, g, 'body')
    B(f, 13, 6.6, 2.6, 2.1, g, 'head')
    # pointy snout
    P(f, 15, 7, g, 2, 'head')
    P(f, 16 + sniff, 7, '#ff7a9a', 2, 'nose')
    P(f, 16, 7, g, 1, 'head') if sniff else None
    B(f, 11.5, 4.2, 1.2, 1.1, g, 'ear', tones=(2, 3))
    P(f, 11, 4, '#ffaabf', 2, 'ear')
    f.put(13, 6, 'eye', 0, 'face') if t != 3 else f.put(13, 6, R(g), 0, 'face')
    # sooty black paws
    for x in (6, 11):
        P(f, x + (t % 2), 10, '#2a2430', 1, 'paw')
        P(f, x, 9, '#3a3440', 1, 'paw')
    # soot smudge
    P(f, 7, 9, '#5a5868', 1, 'body')
    P(f, 8, 9, '#5a5868', 1, 'body')
    return render(f)


# G489 ------------------------------------------------------------ Paper Crane
def paper_crane(t):
    f = frame(18, 15)
    w = '#f6f4ee'
    up = (2, 1, -1, 1)[t]
    by = 10 + (0, 0, -1, 0)[t]
    # far wing (shaded) peeks out behind when the wing is up
    if up > 0:
        poly(f, [(8, by - 1), (11, by - 1), (12, by - 3 - up * 2)], '#c8c2d4', 2, 'wingb')
    poly(f, [(3, by), (9, by - 2.5), (14, by), (9, by + 2.5)], w, 2, 'body',
         shade=lambda x, y: 3 if y < by else 1)
    poly(f, [(3, by + 1), (5, by - 1), (0, by - 4)], w, 2, 'tail', shade=lambda x, y: 3)
    poly(f, [(12, by + 1), (14, by), (16, by - 6)], w, 2, 'neck', shade=lambda x, y: 2 if x < 15 else 1)
    P(f, 17, by - 5, '#e04a5a', 2, 'beak')
    tipy = by - 1 - up * 3.5
    poly(f, [(5, by - 0.5), (12, by - 0.5), (5 + (up < 0) * 2, tipy)], w, 3, 'wing',
         shade=lambda x, y: (3 if x < 8 else 2) if up > 0 else (2 if x < 8 else 1))
    LN(f, (6, int(tipy) + (1 if up > 0 else -1)), (9, by - 1 if up > 0 else by + 1), '#c8c4d0', 1, 'crease')
    LN(f, (9, by - 1), (9, by + 2), '#c8c4d0', 1, 'crease')
    return render(f)


# G490 ------------------------------------------------------------ Priority Flea
def priority_flea(t):
    f = frame(12, 16)
    h = (0, 6, 8, 3)[t]
    k = '#3a3248'
    y0 = 13 - h
    B(f, 4.5, y0, 3.0, 2.3, k, 'body', tones=(1, 2, 3, 4))
    P(f, 4, y0 - 1, '#f6bc36', 3, 'gold')
    P(f, 3, y0 - 1, '#f6bc36', 4, 'gold')
    P(f, 4, y0, '#f6bc36', 2, 'gold')
    P(f, 3, y0, '#f6bc36', 3, 'gold')
    B(f, 8.0, y0 + 0.4, 1.5, 1.4, k, 'head', tones=(1, 2, 3))
    f.put(8, y0, 'white', 1, 'face')
    P(f, 10, y0 + 1, k, 2, 'snout')
    if h == 0:
        S(f, 1, y0 + 1, ['.##.', '#..#'], {'#': (k, 2)})
        P(f, 7, y0 + 2, k, 2, 'leg')
        P(f, 7, y0 + 3, k, 2, 'leg')
    else:
        LN(f, (3, y0 + 2), (1, y0 + 4), k, 2, 'leg')
        LN(f, (7, y0 + 2), (8, y0 + 3), k, 2, 'leg')
    LN(f, (9, y0 - 1), (10, y0 - 3), k, 2, 'ant')
    img = render(f)
    if h == 0:
        dot(img, 0, 15, (200, 180, 160), 160)
        dot(img, 9, 15, (200, 180, 160), 160)
    return img


# G491 ------------------------------------------------------------ Maybe Moth
def maybe_moth(t):
    f = frame(19, 14)
    g = '#7c7290'
    flap = (0, 1, 2, 1)[t]
    bob = BOB[t]
    cx = 9
    for side in (-1, 1):
        rx = (4.6, 3.2, 1.6)[flap]
        B(f, cx + 0.5 + side * (rx + 0.2), 4.8 + bob, rx, 3.6, g, 'wing', tones=(1, 2, 2, 3))
        B(f, cx + 0.5 + side * (rx * 0.6 + 0.3), 9.6 + bob, rx * 0.65, 2.2, '#5e5672', 'hind', tones=(1, 2, 2))
    Q = [(0, 0), (1, 0), (2, 0), (2, 1), (1, 2), (1, 4)]
    if flap == 0:
        for qx in (cx - 5, cx + 3):
            for (dx, dy) in Q:
                P(f, qx + dx, 2 + dy + bob, '#fff0c0', 3, 'q')
    elif flap == 1:
        for qx in (cx - 3, cx + 2):
            for (dx, dy) in ((0, 0), (1, 0), (1, 1), (0, 2), (0, 4)):
                P(f, qx + dx, 2 + dy + bob, '#fff0c0', 3, 'q')
    CAP(f, (cx + 0.5, 4 + bob), (cx + 0.5, 11 + bob), 1.2, '#4a4258', 'body')
    B(f, cx + 0.5, 3.0 + bob, 1.6, 1.4, '#4a4258', 'head')
    f.put(cx + 1, 3 + bob, 'white', 1, 'face')
    f.put(cx, 3 + bob, 'white', 1, 'face')
    P(f, cx - 1, 1 + bob, '#4a4258', 2, 'ant')
    P(f, cx - 2, 0 + bob, '#4a4258', 2, 'ant')
    P(f, cx + 2, 1 + bob, '#4a4258', 2, 'ant')
    P(f, cx + 3, 0 + bob, '#4a4258', 2, 'ant')
    return render(f)


# G492 ------------------------------------------------------------ Red Candle Slug
def red_candle_slug(t):
    f = frame(18, 13)
    r = '#e83a3a'
    st = (0, 1, 0, -1)[t]
    CAP(f, (2 + st * 0.3, 10.6), (12, 10.2), 1.6, r, 'foot', tones=(1, 2, 3))
    B(f, 12.5, 8.4, 2.6, 2.8, r, 'head')
    for x in range(3, 11):
        P(f, x, 12, '#a8202a', 1, 'foot')
    # wax drips running down the head
    P(f, 11, 7, '#ff8a7a', 3, 'drip')
    P(f, 11, 8, '#ff8a7a', 3, 'drip')
    # droopy eye stalks forward
    LN(f, (14, 6), (16, 5 + (t == 2)), r, 2, 'stalk')
    P(f, 16, 4 + (t == 2), '#2a2430', 0, 'eyeb')
    P(f, 15, 5, r, 3, 'stalk')
    # thin dark wick at the crown with a dead ember tip
    LN(f, (12, 5), (12, 3), '#3a2a2a', 2, 'wick')
    P(f, 13, 2, '#5a4a4a', 2, 'wick')
    eye(f, 14, 8, blink=(t == 2))
    P(f, 15, 10, '#7a1a20', 0, 'face')
    img = render(f)
    if t in (1, 2):
        dot(img, 13, 0 + (t == 2), (160, 150, 160), 160)
    dot(img, 1, 11, (232, 58, 58), 140)
    dot(img, 0, 12, (232, 58, 58), 90)
    return img


# G493 ------------------------------------------------------------ Rent Free Hermit
def rent_free_hermit(t):
    f = frame(16, 13)
    peek = (0, 1, 1, 0)[t]
    # legs + claw peeking out the front
    r = '#ff6a4a'
    for x in (10, 12):
        P(f, x + (t % 2), 12, r, 1, 'leg')
        P(f, x, 11, r, 1, 'leg')
    B(f, 12.5 + peek * 0.5, 9, 1.8, 1.4, r, 'claw', tones=(1, 2, 3))
    # eyes on stalks
    P(f, 12 + peek, 6, r, 2, 'stalk')
    P(f, 13 + peek, 6, r, 2, 'stalk')
    f.put(12 + peek, 5, 'eye', 0, 'face')
    f.put(13 + peek, 5, 'eye', 0, 'face')
    # grey spiral shell
    B(f, 6.5, 7.5, 5.6, 5.0, '#a4a2b4', 'shell', tones=(1, 2, 2, 3, 4))
    spiral = [(7, 8), (6, 8), (6, 7), (7, 6), (8, 6), (9, 7), (9, 8), (9, 9), (8, 10), (6, 10), (5, 10), (4, 9),
              (4, 8), (4, 7), (4, 6)]
    for (x, y) in spiral:
        P(f, x, y, '#6c6a80', 1, 'spiral')
    P(f, 7, 7, '#e8e6f0', 4, 'spiral')
    # opening (dark) at the front
    P(f, 11, 10, '#4a4858', 0, 'hole')
    P(f, 11, 9, '#4a4858', 1, 'hole')
    return render(f)


# G494 ------------------------------------------------------------ Seeker Gerbil
def seeker_gerbil(t):
    f = frame(15, 15)
    tan = '#d8a466'
    bob = (0, 0, -1, 0)[t]
    # long tail with tuft
    LN(f, (3, 13), (1, 9), tan, 1, 'tail')
    P(f, 1, 8, '#8a6a44', 2, 'tail')
    # sitting upright
    B(f, 6, 10.5, 3.6, 4.0, tan, 'body')
    B(f, 7, 11.5, 2.0, 2.4, '#f4dcb4', 'belly', tones=(2, 3))
    B(f, 7.5, 5.4 + bob, 3.0, 2.8, tan, 'head')
    B(f, 5.5, 2.8 + bob, 1.1, 1.3, tan, 'ear', tones=(2, 3))
    P(f, 5, 3 + bob, '#ffaabf', 2, 'ear')
    # looking down at the phone
    eye(f, 9, 5 + bob, blink=(t == 3))
    P(f, 10, 6 + bob, '#ff7a9a', 2, 'nose')
    # phone held in paws, glowing teal screen
    box(f, 10, 8, 12, 12, '#2a2430', 'phone', rnd=False, lit=1, mid=0, dk=0)
    for y in range(9, 12):
        P(f, 11, y, '#3de0c8', 3 if (y - 9) == (t % 3) else 2, 'screen')
    P(f, 9, 10, tan, 3, 'paw')
    P(f, 9, 11, tan, 2, 'paw')
    for x in (5, 8):
        P(f, x, 14, tan, 2, 'foot')
    img = render(f)
    # screen light on face
    return img


# G495 ------------------------------------------------------------ Ser Toad
def ser_toad(t):
    f = frame(16, 13)
    b = '#9a7244'
    sq = (0, 0, 1, 0)[t]
    B(f, 3.5, 10.5, 2.5, 2.0, b, 'leg', tones=(1, 2))
    B(f, 8, 8.6 + sq * 0.4, 6.0, 3.8 - sq * 0.4, b, 'body', tones=(1, 2, 2, 3))
    # warts
    for (x, y) in ((4, 7), (6, 6), (5, 9), (8, 7)):
        P(f, x, y, '#6a4a2a', 1, 'wart')
    B(f, 10.5, 10.5, 3.0, 1.4, '#e8cc90', 'belly', tones=(2, 3))
    # eye bump + gold monocle on the near eye
    B(f, 11, 5 + sq, 2.0, 1.8, b, 'bump', tones=(1, 2, 3))
    gx, gy = 10, 3 + sq
    for (dx, dy) in ((0, 0), (1, 0), (2, 0), (-1, 1), (3, 1), (-1, 2), (3, 2), (0, 3), (1, 3), (2, 3)):
        P(f, gx + dx, gy + dy, '#f6bc36', 3 if dy < 2 and dx < 2 else 2, 'mono')
    for (dx, dy) in ((0, 1), (1, 1), (2, 1), (0, 2), (1, 2), (2, 2)):
        P(f, gx + dx, gy + dy, '#e8f4ff', 1, 'glass')
    f.put(gx + 1, gy + 2, 'eye', 0, 'face')
    if t == 3:
        f.put(gx + 2, gy + 1, 'white', 1, 'glass')
    # monocle chain
    LN(f, (gx + 1, gy + 4), (gx, gy + 6), '#f6bc36', 1, 'chain')
    # mouth
    for x in range(10, 15):
        P(f, x, 8 + sq, b, 0, 'mouth')
    P(f, 12, 12, b, 2, 'foot')
    P(f, 13, 12, b, 2, 'foot')
    return render(f)


# G496 ------------------------------------------------------------ Tiny Shrimp
def tiny_shrimp(t):
    f = frame(15, 13)
    pk = '#ff7a8a'
    bob = BOB[t]
    # curled body: segments along an arc, head right, tail curling down-left
    segs = [(10, 5), (8, 4.4), (6, 4.6), (4.4, 5.8), (3.8, 7.6), (4.6, 9.2)]
    for i, (x, y) in enumerate(segs):
        r = 2.0 - i * 0.22
        B(f, x, y + bob, r, r, pk, 'body', tones=(1, 2, 3))
    for i, (x, y) in enumerate(segs[1:5]):
        P(f, int(x), int(y + bob - 1.2), '#ffc0c8', 3, 'band')
    # tail fan
    S(f, 5, 10 + bob, ['##', '.#'], {'#': (pk, 1)})
    P(f, 7, 10 + bob, pk, 2, 'tail')
    eye(f, 11, 4 + bob)
    # legs
    for x in (6, 8, 10):
        P(f, x, 7 + bob, '#d84a5a', 1, 'leg')
    # thin antennae sweeping
    sw = (0, 1, 0, -1)[t]
    LN(f, (12, 4 + bob), (14, 1 + bob + sw), '#d84a5a', 2, 'ant')
    LN(f, (12, 5 + bob), (14, 7 + bob), '#d84a5a', 2, 'ant')
    return render(f)


# G497 ------------------------------------------------------------ Summer Duck
def summer_duck(t):
    f = frame(16, 13)
    y = '#ffd23a'
    rock = (0, 1, 0, -1)[t]
    B(f, 7, 9.0, 5.4, 3.3, y, 'body', tones=(1, 2, 2, 3))
    P(f, 1, 6, y, 3, 'tail')
    P(f, 2, 7, y, 2, 'tail')
    for x in range(1, 14):
        if f.part_at(x, 9) == 'body':
            P(f, x, 9, '#9a5aff', 2, 'stripe')
        if f.part_at(x, 10) == 'body':
            P(f, x, 10, '#2ee0b8', 2, 'stripe')
    B(f, 10.6 + rock * 0.3, 4.4, 2.8, 2.6, y, 'head')
    eye(f, 11 + (rock > 0), 3)
    S(f, 13 + (rock > 0), 5, ['oo', 'O.'], {'o': ('#ff8a1a', 2), 'O': ('#ff8a1a', 1)})
    B(f, 6, 7.6, 2.0, 1.2, y, 'wing', tones=(1, 2, 3))
    img = render(f)
    for x in range(0 + (t % 2), 16, 3):
        dot(img, x, 12, (140, 210, 255), 160)
    return img


# G498 ------------------------------------------------------------ Pet Rock
def pet_rock(t):
    f = frame(14, 10)
    g = '#9a98a8'
    B(f, 7, 6.2, 6.0, 3.8, g, 'rock', tones=(0, 1, 2, 2, 3))
    B(f, 4, 4.2, 2.2, 1.8, g, 'lump', tones=(1, 2, 3, 4))
    clip(f, lambda x, y: y < 10)
    for (x, y) in ((9, 3), (3, 7), (10, 7)):
        P(f, x, y, g, 0, 'crack')
    P(f, 3, 3, g, 4, 'lump')
    blink = t == 2
    for ex in (7, 10):
        if blink:
            P(f, ex, 6, '#4a4858', 0, 'face')
        else:
            f.put(ex, 5, 'eye', 0, 'face')
            f.put(ex, 6, 'eye', 0, 'face')
    return render(f)


# G499 ------------------------------------------------------------ Grass Snail
def grass_snail(t):
    f = frame(17, 15)
    st = (0, 1, 0, 0)[t]
    # body
    CAP(f, (2, 13), (14, 12.6), 1.4, '#e8c88a', 'foot', tones=(1, 2, 3))
    LN(f, (13, 12), (14, 8 + st), '#e8c88a', 2, 'stalk')
    LN(f, (14, 12), (16, 9), '#e8c88a', 2, 'stalk')
    f.put(14, 7 + st, 'eye', 0, 'face')
    f.put(16, 8, 'eye', 0, 'face')
    # shell
    B(f, 7, 9, 4.6, 4.2, '#c8743a', 'shell', tones=(1, 2, 2, 3, 4))
    for (x, y) in ((7, 9), (8, 9), (8, 8), (7, 7), (6, 7), (5, 8), (5, 9), (5, 10), (6, 11), (8, 11), (9, 10)):
        P(f, x, y, '#8a4a20', 1, 'spiral')
    # green tuft of grass on top
    sway = (0, 1, 0, -1)[t]
    for (x, h) in ((4, 3), (5, 4), (6, 2), (7, 5), (8, 3), (9, 4), (10, 2)):
        top = 5 - h + 1
        for yy in range(top, 6):
            xx = x + (sway if yy == top and h >= 4 else 0)
            P(f, xx, yy, '#4ec43c', 3 if yy == top else 2 if x % 2 else 1, 'grass')
    return render(f)


# G500 ------------------------------------------------------------ Uptime Ant
def uptime_ant(t):
    f = frame(17, 14)
    k = '#3a3248'
    bob = (0, -1, 0, -1)[t]
    # legs
    for i, x in enumerate((5, 8, 11)):
        dx = (0, 1)[(t + i) % 2]
        LN(f, (x, 10), (x - 1 + dx * 2, 13), k, 2, 'leg')
    B(f, 3.5, 9.5, 2.6, 2.2, k, 'abd', tones=(1, 2, 3, 4))
    B(f, 7.5, 9.6, 1.6, 1.4, k, 'thorax', tones=(1, 2, 3))
    B(f, 11.2, 8.6, 2.0, 1.9, k, 'head', tones=(1, 2, 3, 4))
    f.put(12, 8, 'white', 1, 'face')
    LN(f, (12, 6), (14, 4), k, 2, 'ant')
    # tiny green block held overhead
    by = 2 + bob
    box(f, 6, by, 10, by + 3, '#3ed46a', 'block', rnd=False)
    P(f, 7, by + 1, '#c8ffb0', 3, 'block')
    LN(f, (8, by + 4), (8, 8), k, 2, 'arm')
    LN(f, (10, by + 4), (11, 7), k, 2, 'arm')
    return render(f)


ITEMS_COMMON = {
    'G464': lambda t: C.pet_mole(t),
    'G465': coin_slot_bug,
    'G466': blockhash_bunny,
    'G467': arena_rooster,
    'G468': ember_newt,
    'G469': crack_beetle,
    'G470': clan_ferret,
    'G471': floor_goldfish,
    'G472': pond_frog,
    'G473': gm_chick,
    'G474': brain_jelly,
    'G475': green_candle_bug,
    'G476': hat_dog_pup_fn,
    'G477': copium_puff,
    'G478': coconut_buddy,
    'G479': island_crab,
    'G480': jeet_rabbit,
    'G481': liquidated_lamb,
    'G482': lobby_gecko,
    'G483': mint_day_mouse,
    'G484': pocket_monke,
    'G485': motherlode_mite,
    'G486': halt_turtle,
    'G487': night_owl,
    'G488': slag_rat,
    'G489': paper_crane,
    'G490': priority_flea,
    'G491': maybe_moth,
    'G492': red_candle_slug,
    'G493': rent_free_hermit,
    'G494': seeker_gerbil,
    'G495': ser_toad,
    'G496': tiny_shrimp,
    'G497': summer_duck,
    'G498': pet_rock,
    'G499': grass_snail,
    'G500': uptime_ant,
}

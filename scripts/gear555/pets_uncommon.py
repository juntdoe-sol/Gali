"""Gali Gear 555 pets: Uncommon tier (G501-G527). Each fn(t) -> RGBA frame."""
from pets_lib import B, CAP, P, LN, S, eye, bigeye, blush, render, frame, spark, dot, poly, box, clip, halo, PINK, BOB, C


# G502 ------------------------------------------------------------ Slot Hummingbird
def slot_hummingbird(t):
    f = frame(18, 15)
    g = '#2ec46a'
    bob = (0, -1, 0, 1)[t]
    cy = 8 + bob
    poly(f, [(1, cy + 4), (5, cy + 1), (6, cy + 2), (2, cy + 6)], '#1e8a4a', 2, 'tail')
    B(f, 8, cy + 0.5, 3.4, 2.4, g, 'body', tones=(1, 2, 2, 3))
    B(f, 9, cy + 1.6, 2.0, 1.2, '#e8f0d8', 'belly', tones=(2, 3))
    B(f, 11.5, cy - 1.2, 2.0, 1.9, g, 'head', tones=(1, 2, 3, 4))
    P(f, 12, cy, '#e8304a', 2, 'throat')
    P(f, 11, cy, '#e8304a', 1, 'throat')
    LN(f, (14, cy - 1), (17, cy - 1), '#3a3036', 1, 'beak')
    eye(f, 12, cy - 2)
    img = render(f)
    # blurred white wings: a fan of translucent rows above the back, flipping per slot
    up = t % 2 == 0
    rows = [(5, 9), (4, 9), (5, 8)] if up else [(6, 10), (5, 10)]
    y0 = cy - 4 if up else cy - 1
    for j, (x0, x1) in enumerate(rows):
        for x in range(x0, x1 + 1):
            a = 210 if (x + j) % 2 == 0 else 120
            dot(img, x, y0 + j, (255, 255, 255), a)
    return img


# G503 ------------------------------------------------------------ Airdrop Pigeon
def airdrop_pigeon(t):
    f = frame(17, 20)
    sw = (0, 1, 0, -1)[t]
    bob = (0, 0, 1, 1)[t]
    # parachute canopy, red/white panels
    cx = 8 + sw * 0.4
    for y in range(0, 5):
        hw = [3, 6, 7, 8, 8][y]
        for x in range(int(cx - hw), int(cx + hw) + 1):
            panel = int((x - cx + 8) // 3) % 2
            col = '#e8303a' if panel else '#f6f2ea'
            tone = 3 if y < 2 else 2 if x < cx + 3 else 1
            P(f, x, y + bob, col, tone, 'chute')
    # scalloped hem
    for x in range(int(cx - 8), int(cx + 9), 2):
        f.erase(x, 4 + bob)
    # cords
    for sx in (-7, -3, 3, 7):
        LN(f, (cx + sx, 5 + bob), (cx + sx * 0.25, 10 + bob), '#d8d0c0', 1, 'cord')
    # pigeon
    py = 13 + bob
    g = '#9aa0b8'
    B(f, 8, py + 1.6, 3.6, 2.8, g, 'body')
    B(f, 9.6, py - 1.4, 2.2, 2.0, g, 'head')
    P(f, 9, py, '#6ad0a0', 2, 'neck')
    P(f, 10, py, '#c070d0', 2, 'neck')
    P(f, 12, py - 1, '#f6bc36', 2, 'beak')
    eye(f, 10, py - 2, blink=(t == 3))
    B(f, 6.5, py + 1.6, 2.2, 1.4, '#7a809a', 'wing', tones=(1, 2))
    P(f, 5, py + 2, '#3a3a50', 1, 'bar')
    P(f, 6, py + 2, '#3a3a50', 1, 'bar')
    P(f, 8, py + 5, '#ff8a7a', 2, 'foot')
    P(f, 9, py + 5, '#ff8a7a', 2, 'foot')
    # tiny crumb crate it delivers
    P(f, 11, py + 4, '#e8c27a', 2, 'crumb')
    return render(f)


# G504 ------------------------------------------------------------ Anon Dev Cat
def anon_dev_cat(t):
    f = frame(16, 16)
    k = '#2e2838'
    hood = '#8a8ea0'
    wag = (0, 1, 2, 1)[t]
    pts = [(3, 13), (1, 11), (1, 8 - wag // 2), (2, 6 - wag // 2)]
    for a, b in zip(pts, pts[1:]):
        CAP(f, a, b, 0.8, k, 'tail', tones=(1, 2, 3))
    B(f, 7, 11.5, 4.0, 3.6, hood, 'hoodie', tones=(1, 2, 2, 3))
    LN(f, (9, 10), (9, 14), '#6a6e80', 1, 'zip')
    for x in range(7, 11):
        P(f, x, 13, '#6a6e80', 1, 'pocket')
    # hood
    B(f, 9, 6, 3.9, 3.7, hood, 'hood', tones=(1, 2, 2, 3))
    # black cat ears through the hood
    S(f, 6, 1, ['k...k', 'kk..kk'], {'k': (k, 2)}) if False else None
    for (x, y) in ((6, 2), (6, 1), (7, 2), (11, 2), (12, 2), (12, 1)):
        P(f, x, y, k, 3 if y == 1 else 2, 'ear')
    # dark face opening
    B(f, 10, 6.6, 2.4, 2.1, '#141018', 'shadow', tones=(0, 0, 1))
    blink = t == 3
    for ex in (9, 11):
        if blink:
            P(f, ex, 7, '#3de0c8', 1, 'eyes')
        else:
            P(f, ex, 6, '#9af8e8', 3, 'eyes')
            P(f, ex, 7, '#3de0c8', 2, 'eyes')
    P(f, 8, 10, '#e8e6f0', 1, 'string')
    P(f, 8, 11, '#e8e6f0', 1, 'string')
    P(f, 10, 10, '#e8e6f0', 1, 'string')
    # black paws out of the sleeves, typing
    P(f, 11, 12 - (t % 2), k, 3, 'paw')
    P(f, 12, 12 - (t % 2), k, 2, 'paw')
    for x in (5, 9):
        P(f, x, 15, k, 2, 'paw')
    return render(f)


# G505 ------------------------------------------------------------ Crash Cart Turtle
def crash_cart_turtle(t):
    f = frame(18, 16)
    gr = '#5cba4a'
    rattle = (0, -1, 0, 0)[t]
    # turtle sitting in the cart
    B(f, 9, 5.6 + rattle, 4.4, 3.0, '#3e8a3a', 'shell', tones=(1, 2, 3, 4))
    for (x, y) in ((7, 4), (10, 4), (8, 6)):
        P(f, x, y + rattle, '#2a6a2a', 1, 'plate')
    B(f, 14, 5.2 + rattle, 2.0, 1.8, gr, 'head')
    eye(f, 14, 4 + rattle)
    P(f, 15, 6 + rattle, '#2a6a2a', 0, 'smile')
    P(f, 14, 6 + rattle, '#2a6a2a', 0, 'smile')
    # arm waving
    P(f, 13, 8 + rattle - (t % 2), gr, 2, 'arm')
    # grey mine cart
    poly(f, [(3, 8), (16, 8), (14.5, 13), (4.5, 13)], '#8e92a4', 2, 'cart',
         shade=lambda x, y: 3 if y == 8 else 1 if x > 12 else 2)
    for x in range(3, 16):
        P(f, x, 8, '#c4c8d4', 3, 'lip')
    for x in (6, 9, 12):
        P(f, x, 10, '#6a6e80', 1, 'rivet')
    # 1.01x sticker
    S(f, 7, 10, ['#.#..#', '#.#.##', '#.#..#'], {'#': ('#3ed46a', 3)}) if False else None
    # wheels turning
    for wx in (6, 13):
        B(f, wx, 14, 1.6, 1.6, '#4a4858', 'wheel', tones=(0, 1, 2))
        P(f, wx + (0, 1, 0, -1)[t] * 0 + (t % 2) - 0, 14, '#c4c8d4', 1, 'hub')
    # rail
    for x in range(0, 18):
        P(f, x, 15, '#8a5a34', 1 if x % 3 else 2, 'rail')
    return render(f)


# G506 ------------------------------------------------------------ Bonding Curve Snake
def bonding_curve_snake(t):
    f = frame(18, 18)
    g = '#4ec43c'
    # rising curve y = k*x^2, from bottom-left to top-right
    pts = []
    for i in range(0, 13):
        x = 1 + i
        y = 16 - (i / 12) ** 2.2 * 11
        pts.append((x, y))
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        r = 0.9 + i * 0.06
        CAP(f, a, b, r, g, 'body', tones=(1, 2, 3))
    # belly stripe along the underside
    for (x, y) in pts[:-2]:
        P(f, x + 1, y + 1, '#c8f08a', 2, 'belly')
    # diamond pattern
    for (x, y) in pts[2:-2:2]:
        P(f, x, y - 0.5, '#2a8a2a', 1, 'pat')
    # head at the top, flicking tongue
    hx, hy = 14, 4.6
    B(f, hx, hy, 2.4, 2.0, g, 'head', tones=(1, 2, 3, 4))
    eye(f, int(hx), int(hy) - 1, blink=(t == 3))
    if t in (1, 2):
        P(f, int(hx) + 3, int(hy), '#e8304a', 2, 'tongue')
        P(f, int(hx) + 4, int(hy) - (t == 2), '#e8304a', 2, 'tongue')
    # dotted grid axis hint
    img = render(f)
    for x in range(0, 18, 2):
        dot(img, x, 17, (120, 220, 140), 120)
    return img


# G507 ------------------------------------------------------------ Lanyard Lemur
def lanyard_lemur(t):
    f = frame(18, 18)
    g = '#a8a6b8'
    sw = (0, 1, 0, -1)[t]
    # ringed tail curling up behind
    pts = [(5, 14), (2, 13), (1, 10), (2, 6), (4, 4 + sw)]
    seg = 0
    for a, b in zip(pts, pts[1:]):
        for (x, y) in __import__('pets_lib').bresenham(a, b):
            col = '#2a2430' if (seg // 2) % 2 else '#f2f0f4'
            for dx in (0, 1):
                P(f, x + dx, y, col, 2 if col != '#2a2430' else 1, 'tail')
            seg += 1
    B(f, 8.5, 13, 3.8, 3.8, g, 'body')
    B(f, 9.5, 14, 2.0, 2.2, '#e8e6f0', 'belly', tones=(2, 3))
    B(f, 11, 7.6, 3.2, 2.8, g, 'head')
    # white face, dark eye mask, big amber eyes
    B(f, 12.6, 8.4, 2.0, 1.6, '#f2f0f4', 'face', tones=(2, 3))
    P(f, 14, 8, '#2a2430', 1, 'nose')
    for ex in (11, 13):
        P(f, ex, 7, '#ffb020', 3 if t != 3 else 0, 'eyeb')
        P(f, ex, 7, 'eye', 0, 'eyeb') if t == 3 else None
    P(f, 12, 7, '#2a2430', 1, 'mask')
    P(f, 9, 5, g, 3, 'ear')
    P(f, 9, 4, '#2a2430', 1, 'ear')
    # blue lanyard + white badge
    LN(f, (9, 9), (10, 12), '#3a7aff', 2, 'lan')
    LN(f, (13, 9), (11, 12), '#3a7aff', 2, 'lan')
    box(f, 9, 12, 12, 15, '#f6f2ea', 'badge', rnd=False, lit=1, mid=1, dk=0)
    P(f, 10, 13, '#3a7aff', 2, 'badge')
    P(f, 11, 13, '#3a7aff', 2, 'badge')
    P(f, 10, 14, '#a0a0b0', 1, 'badge')
    for x in (7, 12):
        P(f, x, 17, g, 2, 'foot')
    return render(f)


# G508 ------------------------------------------------------------ Cave Glowworm
def cave_glowworm(t):
    f = frame(18, 12)
    g = '#c8ecb0'
    inch = (0, 1, 2, 1)[t]
    # inchworm arch: body segments along a hump
    for i in range(9):
        x = 2 + i * (1.3 - inch * 0.12)
        h = max(0, 4 - abs(i - 4)) * (0.4 + inch * 0.35)
        B(f, x + 1, 8.6 - h, 1.5, 1.5, g, 'body', tones=(1, 2, 3))
    for i in range(1, 8, 2):
        x = 2 + i * (1.3 - inch * 0.12)
        h = max(0, 4 - abs(i - 4)) * (0.4 + inch * 0.35)
        P(f, x + 1, 8.6 - h + 1, '#8ab87a', 1, 'ring')
    # head on the right
    hx = 2 + 8 * (1.3 - inch * 0.12) + 2
    B(f, hx, 8, 1.8, 1.8, g, 'head', tones=(1, 2, 3, 4))
    eye(f, int(hx), 7, blink=(t == 3))
    blush(f, int(hx) + 1, 8)
    # glowing tail dot
    for (dx, dy, k) in ((0, 0, 4), (1, 0, 3), (0, 1, 3), (1, 1, 2)):
        f.put(1 + dx, 8 + dy, 'glow', k, 'tail')
    img = render(f)
    a = (150, 190, 220, 190)[t]
    return halo(img, (199, 242, 132), 2, 9, 5.5, a)


# G509 ------------------------------------------------------------ Flat Snail
def flat_snail(t):
    f = frame(16, 9)
    st = (0, 1, 0, 0)[t]
    # one pixel tall shell line + foot line
    for x in range(2, 11):
        P(f, x, 7, '#c8743a' if x % 3 else '#8a4a20', 2 if x < 7 else 1, 'shell')
    for x in range(1, 14):
        P(f, x, 8, '#e8c88a', 2 if x < 12 else 1, 'foot')
    # eyes on tall stalks (the only thing not compressed)
    LN(f, (12, 7), (12, 3 + st), '#e8c88a', 2, 'stalk')
    LN(f, (13, 7), (14, 4), '#e8c88a', 2, 'stalk')
    P(f, 12, 2 + st, '#2a2430', 0, 'eyeb')
    P(f, 14, 3, '#2a2430', 0, 'eyeb')
    img = render(f)
    # tiny compression arrows above the shell
    if t in (0, 1):
        for x in (4, 8):
            dot(img, x, 4, (180, 220, 255), 200)
            dot(img, x - 1, 3, (180, 220, 255), 140)
            dot(img, x + 1, 3, (180, 220, 255), 140)
    return img


# G510 ------------------------------------------------------------ Diamond Hamster
def diamond_hamster(t):
    f = frame(16, 14)
    tan = '#e0aa6a'
    puff = (0, 1, 1, 0)[t]
    B(f, 7, 8.4, 5.6, 5.0, tan, 'body', tones=(1, 2, 2, 3))
    B(f, 8, 10.4, 3.0, 2.6, '#f8e2c0', 'belly', tones=(2, 3))
    # stuffed cheek bulging with diamonds
    B(f, 11.4, 9 + puff * 0.2, 2.8 + puff * 0.4, 2.6 + puff * 0.3, tan, 'cheek', tones=(1, 2, 3, 3))
    for (x, y, k) in ((11, 8, 4), (12, 9, 2), (10, 10, 3), (13, 10, 2), (12, 7, 3)):
        P(f, x, y, '#a8e8ff', k, 'gem')
    P(f, 11, 8, 'white', 1, 'gem') if False else None
    # ears
    B(f, 4, 3.6, 1.3, 1.3, tan, 'ear', tones=(2, 3))
    B(f, 9, 3.4, 1.3, 1.3, tan, 'ear', tones=(2, 3))
    P(f, 4, 4, '#ffaabf', 2, 'ear')
    P(f, 9, 4, '#ffaabf', 2, 'ear')
    eye(f, 9, 6, blink=(t == 3))
    P(f, 12, 6, '#ff7a9a', 2, 'nose')
    for x in (5, 9):
        P(f, x, 13, '#ffaabf', 2, 'paw')
    img = render(f)
    if t == 1:
        spark(img, 14, 6, (168, 232, 255))
    return img


# G511 ------------------------------------------------------------ Lily Pad Frog
def lily_pad_frog(t):
    f = frame(20, 15)
    g = '#4ec43c'
    bob = (0, 1, 0, 0)[t]
    # lily pad with a notch
    B(f, 10, 12.6 + bob * 0.5, 9.0, 2.2, '#2e9a4a', 'pad', tones=(1, 2, 3))
    for (x, y) in ((10, 11), (11, 11), (10, 12)):
        f.erase(x, y + bob)
    # pink flower on the pad's left
    for (x, y, k) in ((2, 10, 3), (3, 9, 3), (4, 10, 2), (3, 10, 4), (3, 11, 2)):
        P(f, x, y + bob, '#ff7aa8', k, 'flower')
    P(f, 3, 10 + bob, '#ffd84a', 3, 'flower')
    # frog sitting on the pad
    fy = 7 + bob
    B(f, 9, fy + 1.4, 2.0, 1.6, g, 'leg', tones=(1, 2))
    B(f, 12, fy + 0.4, 4.2, 3.0, g, 'body', tones=(1, 2, 2, 3))
    B(f, 13.5, fy + 2, 2.2, 1.2, '#c8f08a', 'belly', tones=(2, 3))
    for ex in (10, 14):
        B(f, ex + 0.5, fy - 2.6, 1.6, 1.5, g, 'bump', tones=(1, 2, 3))
        bigeye(f, ex, fy - 3, blink=(t == 3))
    for x in range(12, 16):
        P(f, x, fy + 1, g, 0, 'mouth')
    img = render(f)
    # ripples
    for x in ((0, 19), (1, 18), (0, 19), (1, 18))[t]:
        dot(img, x, 13, (140, 210, 255), 170)
    return img


# G512 ------------------------------------------------------------ Hat Dog Sleeper
def hat_dog_sleeper(t):
    f = frame(19, 13)
    w = '#f4efe6'
    br = (0, 1, 1, 0)[t]
    # curled body loaf
    B(f, 8, 8.4 - br * 0.3, 6.6, 3.6 + br * 0.3, w, 'body', tones=(1, 2, 2, 3, 4))
    # tail wrapped around the front
    CAP(f, (3, 11), (9, 11.6), 1.0, '#e0d8cc', 'tail', tones=(1, 2, 3))
    # head resting on the right
    B(f, 14, 8.8, 3.2, 2.8, w, 'head', tones=(1, 2, 3, 4))
    B(f, 16.2, 10, 1.4, 1.0, w, 'snout', tones=(2, 3))
    P(f, 17, 9, '#2a2430', 0, 'nose')
    CAP(f, (12.5, 8), (11.5, 11), 1.1, '#c8a880', 'ear', tones=(1, 2, 2))
    # orange beanie pulled down over the eyes
    o = '#ff8a2a'
    for (y, x0, x1) in ((4, 13, 15), (5, 12, 16), (6, 12, 17), (7, 12, 17)):
        for x in range(x0, x1 + 1):
            P(f, x, y, o, 3 if (y < 6 and x < 14) else 2 if y < 7 else 1, 'hat')
    for x in range(12, 18):
        P(f, x, 8, o, 1 if x % 2 else 2, 'cuff')
    P(f, 14, 3, '#ffc070', 3, 'pom')
    # sleepy mouth
    P(f, 15, 11, '#c8b8a8', 0, 'mouth')
    img = render(f)
    z = [(0, 0), (1, 0), (2, 0), (1, 1), (0, 2), (1, 2), (2, 2)]
    oy = (3, 2, 1, 0)[t]
    for (dx, dy) in z:
        dot(img, 16 + dx, oy - 2 + dy, (255, 200, 140), 230 if t < 3 else 140)
    return img


# G513 ------------------------------------------------------------ Pumpkin Mouse
def pumpkin_mouse(t):
    f = frame(16, 15)
    o = '#ff8a1a'
    peek = (0, 1, 1, 0)[t]
    # mouse first (it sits inside, visible through the mouth hole and the top)
    g = '#a8a6b8'
    B(f, 9, 4.6 - peek, 2.4, 2.0, g, 'mouse')
    B(f, 7.4, 2.8 - peek, 1.1, 1.1, g, 'mear', tones=(2, 3))
    B(f, 10.6, 2.8 - peek, 1.1, 1.1, g, 'mear', tones=(2, 3))
    P(f, 7, 3 - peek, '#ffaabf', 2, 'mear')
    P(f, 11, 3 - peek, '#ffaabf', 2, 'mear')
    P(f, 8, 4 - peek, 'eye', 0, 'mf') if False else f.put(8, 4 - peek, 'eye', 0, 'mf')
    f.put(10, 4 - peek, 'eye', 0, 'mf')
    P(f, 9, 5 - peek, '#ff7a9a', 2, 'mf')
    # pumpkin
    for (cx, rx) in ((5, 3.6), (11, 3.6), (8, 4.0)):
        B(f, cx, 10, rx, 4.4, o, 'pk', tones=(1, 2, 2, 3))
    for x in (6, 10):
        LN(f, (x, 7), (x, 13), o, 1, 'rib')
    # top cut edge: dark rim (the mouse sits in the open top)
    for x in range(5, 12):
        P(f, x, 6, '#a84a10', 1, 'rim')
    # carved face: triangle eyes and grin glowing
    for (x, y) in ((4, 9), (5, 9), (4, 8) if False else (5, 8), (11, 9), (12, 9), (11, 8)):
        P(f, x, y, '#ffd84a', 3, 'carve')
    for x in range(5, 12):
        P(f, x, 11, '#ffd84a', 3 if x % 2 else 2, 'carve')
    P(f, 6, 12, '#ffd84a', 2, 'carve')
    P(f, 10, 12, '#ffd84a', 2, 'carve')
    return render(f)


# G514 ------------------------------------------------------------ Lighthouse Gull
def lighthouse_gull(t):
    f = frame(17, 16)
    w = '#f6f4ee'
    bob = (0, 0, -1, 0)[t]
    # body
    B(f, 7, 10, 4.6, 3.0, w, 'body', tones=(1, 2, 3, 4))
    # grey wing on top
    B(f, 6, 9, 3.6, 1.8, '#9aa2b8', 'wing', tones=(1, 2, 3))
    poly(f, [(1, 8), (4, 9), (3, 10)], '#3a3a50', 1, 'tip')
    B(f, 11.6, 5.6 + bob, 2.2, 2.0, w, 'head', tones=(1, 2, 3, 4))
    eye(f, 12, 5 + bob)
    S(f, 13, 6 + bob, ['yyy', 'r..'], {'y': ('#ffd23a', 2), 'r': ('#e8303a', 2)})
    # red and white striped scarf
    for i, (x, y) in enumerate(((9, 7), (10, 8), (11, 8), (12, 8), (13, 7))):
        P(f, x, y + bob, '#e8303a' if i % 2 == 0 else '#ffffff', 2, 'scarf')
    flap = (0, 1, 0, -1)[t]
    for i, (x, y) in enumerate(((9, 8), (8, 9 + flap), (7, 9 + flap))):
        P(f, x, y + bob * (i == 0), '#e8303a' if i % 2 else '#ffffff', 2, 'scarf')
    # orange legs
    for x in (6, 9):
        P(f, x, 13, '#ff9a2a', 2, 'leg')
        P(f, x, 14, '#ff9a2a', 2, 'leg')
        P(f, x + 1, 15, '#ff9a2a', 1, 'leg')
        P(f, x - 1, 15, '#ff9a2a', 2, 'leg')
    img = render(f)
    # stolen chip in beak on t=2
    if t == 2:
        dot(img, 16, 5 + bob, (255, 214, 100), 255, over=True)
        dot(img, 16, 6 + bob, (230, 180, 70), 255, over=True)
    return img


# G515 ------------------------------------------------------------ Banana Monke
def banana_monke(t):
    f = frame(17, 16)
    b = '#8a5636'
    hug = (0, 1, 0, 0)[t]
    B(f, 7.5, 11, 4.6, 4.4, b, 'body', tones=(1, 2, 2, 3))
    B(f, 3.4, 4.6, 1.2, 1.2, '#d8a876', 'ear', tones=(1, 2))
    B(f, 12.6, 4.6, 1.2, 1.2, '#d8a876', 'ear', tones=(2, 3))
    B(f, 8, 5.2, 4.2, 3.6, b, 'head')
    B(f, 7.4, 6.0, 1.6, 1.8, '#e8bc8a', 'face', tones=(2, 3))
    B(f, 9.8, 6.0, 1.6, 1.8, '#e8bc8a', 'face', tones=(2, 3))
    B(f, 8.6, 7.6, 2.4, 1.4, '#e8bc8a', 'face', tones=(2, 3))
    if t == 2:
        P(f, 7, 6, '#5a3a24', 0, 'face')
        P(f, 10, 6, '#5a3a24', 0, 'face')
    else:
        eye(f, 7, 5)
        eye(f, 10, 5)
    P(f, 8, 8, '#8a5636', 0, 'mouth')
    P(f, 9, 8, '#8a5636', 0, 'mouth')
    blush(f, 6, 7)
    # big banana held diagonally up the chest (a fat crescent)
    pts = [(4, 14), (7, 13.4), (10, 11.6), (12, 9), (12.6, 7)]
    for i, (a, c) in enumerate(zip(pts, pts[1:])):
        CAP(f, a, c, 1.5 if 0 < i < 3 else 1.2, '#ffd23a', 'banana', tones=(1, 2, 3))
    P(f, 13, 6, '#6a4a24', 1, 'stem')
    P(f, 3, 14, '#6a4a24', 1, 'stem')
    for (x, y) in ((6, 13), (9, 12), (11, 10)):
        P(f, x, y, '#fff0a0', 4, 'banana')
    CAP(f, (4, 9), (8 + hug * 0.4, 12), 0.9, b, 'arm')
    CAP(f, (12, 11), (10 - hug * 0.4, 13), 0.9, b, 'arm')
    for x in (5, 10):
        P(f, x, 15, b, 1, 'foot')
    return render(f)


# G516 ------------------------------------------------------------ Chart Cat
def chart_cat(t):
    f = frame(17, 18)
    k = '#3a3248'
    # candle chart: three green candles of rising height, the cat sits on top of the tallest
    for (x, top, col) in ((1, 13, '#3ed46a'), (4, 11, '#e8403a'), (7, 9, '#3ed46a'), (10, 7, '#3ed46a')):
        box(f, x, top, x + 2, 17, col, 'chart', rnd=False)
        P(f, x + 1, top - 1, col, 1, 'wick')
    # the cat: loaf on top of the last candle, tail hanging down the side
    wag = (0, 1, 0, -1)[t]
    LN(f, (14, 6), (15, 9), k, 2, 'tail')
    LN(f, (15, 9), (15 + (wag > 0), 12), k, 2, 'tail')
    B(f, 11.6, 4.6, 3.6, 2.4, k, 'body', tones=(1, 2, 3, 4))
    B(f, 8.6, 3.4, 2.4, 2.2, k, 'head', tones=(1, 2, 3, 4))
    P(f, 7, 1, k, 3, 'ear')
    P(f, 10, 1, k, 2, 'ear')
    # yellow eyes
    if t == 3:
        P(f, 7, 3, '#ffd23a', 0, 'eyes')
        P(f, 9, 3, '#ffd23a', 0, 'eyes')
    else:
        P(f, 7, 3, '#ffd23a', 3, 'eyes')
        P(f, 9, 3, '#ffd23a', 3, 'eyes')
    P(f, 8, 4, '#ff96b0', 2, 'nose')
    img = render(f)
    return img


# G517 ------------------------------------------------------------ Durian Hedgehog
def durian_hedgehog(t):
    f = frame(16, 14)
    g = '#7aa832'
    sn = (0, 1, 0, 0)[t]
    B(f, 7, 8, 5.8, 5.0, g, 'body', tones=(0, 1, 2, 2, 3))
    clip(f, lambda x, y: y < 13)
    # thorny spikes all over: lit pyramids
    for y in range(4, 12, 2):
        for x in range(2 + (y // 2) % 2, 12, 2):
            if f.part_at(x, y) == 'body':
                P(f, x, y, '#c8e05a', 4, 'thorn')
                P(f, x, y + 1, '#4a7a1e', 1, 'thorn')
    for (x, y) in ((3, 3), (7, 2), (10, 3), (1, 6), (12, 5), (0, 9), (5, 2)):
        P(f, x, y, '#a8c84a', 3, 'spike')
    # yellow face peeking out (open durian segment)
    B(f, 12.2, 9.4, 2.4, 2.4, '#ffd84a', 'face', tones=(1, 2, 3))
    eye(f, 12, 8, blink=(t == 3))
    P(f, 14 + sn, 10, '#5a3a24', 1, 'nose')
    blush(f, 13, 10)
    for x in (4, 9):
        P(f, x, 13, '#5a3a24', 1, 'foot')
    img = render(f)
    # stink waves
    for i, (x, y) in enumerate(((2, 1), (3, 0), (11, 1), (12, 0))):
        if (i + t) % 2 == 0:
            dot(img, x, y, (190, 220, 90), 170)
    return img


# G518 ------------------------------------------------------------ Teh Tarik Kitten
def teh_tarik_kitten(t):
    f = frame(16, 18)
    c = '#f4e6c8'
    # tall glass mug: clear walls, brown tea, foam top
    gx0, gx1 = 3, 12
    # kitten head poking out of the foam
    B(f, 7.5, 4.6, 3.4, 2.8, c, 'kitten', tones=(1, 2, 3, 4))
    P(f, 5, 1, c, 3, 'ear')
    P(f, 10, 1, c, 2, 'ear')
    P(f, 5, 2, '#ffaabf', 2, 'ear')
    P(f, 10, 2, '#ffaabf', 2, 'ear')
    if t == 2:
        P(f, 6, 4, '#8a6a4a', 0, 'face')
        P(f, 9, 4, '#8a6a4a', 0, 'face')
    else:
        eye(f, 6, 4)
        eye(f, 9, 4)
    P(f, 7, 5, '#ff96b0', 2, 'face')
    P(f, 8, 5, '#ff96b0', 1, 'face')
    blush(f, 5, 6)
    blush(f, 10, 6)
    # paws on the rim
    P(f, 4, 7, c, 3, 'paw')
    P(f, 11, 7, c, 2, 'paw')
    # foam layer
    for x in range(gx0 + 1, gx1):
        P(f, x, 8, '#fff4dc', 3 if x < 8 else 2, 'foam')
    # tea body: gradient brown, lighter at top (tarik pull)
    for y in range(9, 17):
        for x in range(gx0 + 1, gx1):
            tone = 3 if y < 11 else 2 if y < 14 else 1
            P(f, x, y, '#b0703a', tone, 'tea')
    # glass walls
    for y in range(7, 17):
        P(f, gx0, y, '#e6f6fc', 3, 'glass')
        P(f, gx1, y, '#bcd8e4', 1, 'glass')
    for x in range(gx0, gx1 + 1):
        P(f, x, 17, '#bcd8e4', 2, 'glass')
    P(f, gx0 + 1, 10, '#ffffff', 1, 'glint') if False else f.put(gx0 + 1, 10, 'white', 1, 'glint')
    f.put(gx0 + 1, 11, 'white', 0, 'glint')
    # handle
    for (x, y) in ((13, 9), (14, 10), (14, 11), (14, 12), (13, 13)):
        P(f, x, y, '#bcd8e4', 2, 'handle')
    img = render(f)
    # steam
    for k in range(2):
        x = 3 + k * 9 + (t % 2)
        dot(img, x, 2 - (t // 2), (255, 255, 255), 120)
    return img


# G519 ------------------------------------------------------------ Wau Butterfly
def wau_butterfly(t):
    f = frame(19, 15)
    flap = (0, 1, 2, 1)[t]
    bob = BOB[t]
    cx = 9
    for side in (-1, 1):
        w = (8, 6, 3)[flap]
        # wau kite wing: crescent upper wing + pointed lower wing, red with yellow trim
        poly(f, [(cx, 3 + bob), (cx + side * w, 1 + bob), (cx + side * w, 6 + bob), (cx, 7 + bob)],
             '#e8303a', 2, 'wing', shade=lambda x, y: 3 if y < 4 + bob else 2)
        poly(f, [(cx, 7 + bob), (cx + side * (w - 1), 8 + bob), (cx + side * max(1, w // 2), 13 + bob)],
             '#c8202a', 2, 'lower')
        # yellow trim and motif
        LN(f, (cx + side * w, 1 + bob), (cx + side * w, 6 + bob), '#ffd23a', 3, 'trim')
        if w >= 6:
            for (dx, dy) in ((3, 3), (4, 3), (3, 4), (4, 4), (5, 2)):
                P(f, cx + side * dx - (1 if side < 0 else 0) * 0, dy + bob, '#ffd23a', 3, 'motif')
            P(f, cx + side * 3, 9 + bob, '#ffd23a', 2, 'motif')
    CAP(f, (cx + 0.5, 3 + bob), (cx + 0.5, 11 + bob), 1.0, '#3a2a30', 'body', tones=(1, 2, 3))
    B(f, cx + 0.5, 2.4 + bob, 1.4, 1.3, '#3a2a30', 'head', tones=(1, 2, 3))
    f.put(cx + 1, 2 + bob, 'white', 1, 'face')
    LN(f, (cx, 1 + bob), (cx - 2, 0 + bob), '#3a2a30', 2, 'ant')
    LN(f, (cx + 1, 1 + bob), (cx + 3, 0 + bob), '#3a2a30', 2, 'ant')
    img = render(f)
    # wau kite tail streamer
    for k in range(3):
        dot(img, cx + (k % 2), 13 + bob + k if 13 + bob + k < 15 else 14, (255, 210, 58), 180 - k * 40)
    return img


# G520 ------------------------------------------------------------ Crawling Rug
def crawling_rug(t):
    import math
    f = frame(20, 13)
    r = '#c83038'
    hump = (0, 1, 2, 1)[t]
    def yo(x):
        return -int(round(hump * max(0, math.sin((x - 2) / 12 * math.pi))))
    for x in range(2, 16):
        for y in range(7, 12):
            border = y in (7, 11)
            diamond = abs((x - 2) % 6 - 3) + abs(y - 9) <= 1
            centre = abs((x - 2) % 6 - 3) + abs(y - 9) == 0
            col = '#2a3a8a' if border else '#ffd84a' if centre else '#f6e6c0' if diamond else r
            tone = 3 if y == 7 else 1 if y == 11 else 2
            P(f, x, y + yo(x), col, tone, 'rug')
    # tassels on the back edge
    for y in range(7, 12):
        P(f, 1, y, '#f6e6c0', 2, 'tassel')
        if y % 2:
            P(f, 0, y + (t % 2 if y == 9 else 0), '#f6e6c0', 1, 'tassel')
    # curled front edge rolled up into a mouth
    op = (1, 2, 1, 0)[t]
    B(f, 17, 7 - op * 0.4, 2.6, 2.4, r, 'roll', tones=(1, 2, 3))
    for (x, y) in ((16, 6), (17, 7), (18, 6)):
        P(f, x, y - int(op * 0.4), '#2a3a8a', 1, 'roll')
    for y in range(9, 9 + op + 1):
        for x in (16, 17, 18):
            P(f, x, y, '#5a1018', 0, 'mouth')
    for x in (16, 17, 18):
        P(f, x, 10 + op, r, 1, 'lip')
    f.put(16, 5 - int(op * 0.4), 'white', 1, 'eyes')
    f.put(18, 5 - int(op * 0.4), 'white', 1, 'eyes')
    f.put(17, 5 - int(op * 0.4), 'eye', 0, 'eyes') if False else None
    f.put(16, 4 - int(op * 0.4), 'eye', 0, 'eyes') if False else None
    for x in (16, 18):
        f.put(x, 5 - int(op * 0.4), 'eye', 0, 'eyes') if t == 3 else None
    return render(f)


# G521 ------------------------------------------------------------ Seeker Beetle
def seeker_beetle(t):
    f = frame(16, 11)
    k = '#2a2436'
    for i, x in enumerate((3, 6, 9)):
        dx = (0, 1)[(t + i) % 2]
        P(f, x + dx, 10, k, 2, 'leg')
        P(f, x, 9, k, 2, 'leg')
    B(f, 6.5, 6, 5.8, 3.8, k, 'shell', tones=(1, 2, 2, 3))
    # glowing teal screen inset
    box(f, 3, 3, 10, 7, '#3de0c8', 'screen', rnd=True, lit=3, mid=2, dk=1)
    # UI on the screen: scrolling ORE bars
    for i, x in enumerate((4, 6, 8)):
        h = (1, 2, 3, 2)[(t + i) % 4]
        for y in range(7 - h, 7):
            P(f, x, y, '#e8fff8', 4, 'ui')
    P(f, 9, 4, '#ffffff', 1, 'ui') if False else None
    B(f, 13, 7, 2.0, 1.8, k, 'head', tones=(1, 2, 3))
    f.put(14, 6, 'white', 1 if t != 3 else 0, 'face')
    P(f, 14, 4, k, 2, 'ant')
    P(f, 15, 3, '#3de0c8', 3, 'ant')
    img = render(f)
    return halo(img, (61, 224, 200), 6.5, 5, 6.5, 70)


# G522 ------------------------------------------------------------ Ser Butler Mouse
def ser_butler_mouse(t):
    f = frame(15, 18)
    g = '#a8a6b8'
    bow = (0, 1, 0, 0)[t]
    # tail
    LN(f, (3, 15), (1, 12), '#ffaabf', 1, 'tail')
    LN(f, (1, 12), (2, 9), '#ffaabf', 1, 'tail')
    # standing upright, tuxedo body
    B(f, 7, 12.6, 3.4, 4.0, '#2a2436', 'tux', tones=(1, 2, 3))
    B(f, 8, 12.6, 1.6, 3.2, '#f4f2ee', 'shirt', tones=(2, 3))
    # head bowing slightly
    hx, hy = 8 + bow * 0.6, 5.8 + bow
    B(f, hx, hy, 3.0, 2.6, g, 'head')
    B(f, hx - 2.4, hy - 2.6, 1.5, 1.5, g, 'ear', tones=(2, 3))
    B(f, hx + 1.4, hy - 2.8, 1.5, 1.5, g, 'ear', tones=(2, 3))
    P(f, hx - 2.4, hy - 2.4, '#ffaabf', 2, 'ear')
    P(f, hx + 1.4, hy - 2.4, '#ffaabf', 2, 'ear')
    eye(f, int(hx) + 1, int(hy) - 1, blink=(t == 1))
    P(f, int(hx) + 3, int(hy), '#ff7a9a', 2, 'nose')
    # whiskers
    P(f, int(hx) + 3, int(hy) + 1, '#e8e6f0', 1, 'wh')
    # black bow tie
    S(f, 6, 9, ['#.#', '###', '#.#'], {'#': ('#1a1420', 1)})
    P(f, 7, 10, '#e8303a', 1, 'knot') if False else None
    # tray arm holding a tiny gold coin on a plate
    LN(f, (10, 11), (12, 10), '#2a2436', 2, 'arm')
    LN(f, (11, 9), (14, 9), '#d8dce8', 3, 'tray')
    P(f, 12, 8, '#f6bc36', 3, 'coin')
    P(f, 13, 8, '#f6bc36', 2, 'coin')
    for x in (6, 9):
        P(f, x, 17, '#ffaabf', 2, 'foot')
    return render(f)


# G523 ------------------------------------------------------------ Shrimp in a Cup
def shrimp_in_cup(t):
    f = frame(14, 16)
    pk = '#ff7a8a'
    peek = (0, 1, 1, 0)[t]
    segs = [(8, 4 - peek), (6.4, 4.4 - peek), (5, 5.6 - peek), (4.6, 7.2 - peek)]
    for i, (x, y) in enumerate(segs):
        B(f, x, y, 1.9 - i * 0.2, 1.9 - i * 0.2, pk, 'shrimp', tones=(1, 2, 3))
    P(f, 6, 3 - peek, '#ffc0c8', 3, 'band')
    eye(f, 9, 3 - peek)
    LN(f, (10, 3 - peek), (12, 0), '#d84a5a', 2, 'ant')
    LN(f, (10, 4 - peek), (13, 3), '#d84a5a', 2, 'ant')
    poly(f, [(2, 8), (12, 8), (11, 15), (3, 15)], '#f6f2ea', 2, 'cup',
         shade=lambda x, y: 3 if x < 5 else 1 if x > 9 else 2)
    for x in range(2, 13):
        P(f, x, 8, '#ffffff', 1, 'rim')
    for yy in (11, 13):
        for x in range(2, 13):
            if f.part_at(x, yy) == 'cup':
                P(f, x, yy, '#ff7a1a' if yy == 13 else '#e8303a', 2 if x < 9 else 1, 'stripe')
    return render(f)


# G524 ------------------------------------------------------------ Sniper Hawk
def sniper_hawk(t):
    f = frame(18, 18)
    g = '#8a8ea4'
    bob = (0, 0, -1, 0)[t]
    # folded wings + tail
    poly(f, [(3, 9), (9, 7), (10, 14), (2, 16)], '#6a6e84', 2, 'wing', shade=lambda x, y: 3 if y < 10 else 1)
    for y in (11, 13, 15):
        LN(f, (3, y), (7, y - 1), '#4a4e60', 1, 'feather')
    B(f, 9, 10.5, 4.0, 4.6, g, 'body', tones=(1, 2, 3, 3))
    B(f, 10.5, 12, 2.0, 2.6, '#e8e6f0', 'chest', tones=(2, 3))
    for (x, y) in ((10, 11), (11, 13), (10, 13)):
        P(f, x, y, '#8a8ea4', 1, 'bar')
    # head
    B(f, 11, 5 + bob, 3.0, 2.6, g, 'head', tones=(1, 2, 3, 4))
    # hooked beak
    S(f, 13, 5 + bob, ['yy.', '.yy', '..y'], {'y': ('#ffc23a', 2)})
    # red crosshair eye (scope)
    ex, ey = 11, 4 + bob
    for (dx, dy) in ((0, -1), (-1, 0), (1, 0), (0, 1)):
        P(f, ex + dx, ey + dy, '#ff3048', 2, 'xhair')
    P(f, ex, ey, '#ffd0d0' if t != 3 else '#ff3048', 2, 'xhair')
    # brow
    P(f, 10, 2 + bob, '#4a4e60', 1, 'brow')
    P(f, 11, 2 + bob, '#4a4e60', 1, 'brow')
    for x in (8, 11):
        P(f, x, 16, '#ffc23a', 2, 'talon')
        P(f, x + 1, 16, '#ffc23a', 1, 'talon')
    img = render(f)
    # red laser line out of the eye on t==1,2
    if t in (1, 2):
        for k in range(3, 6):
            dot(img, ex + k, ey, (255, 48, 72), 200 - k * 20)
    return img


# G525 ------------------------------------------------------------ Fine Bear Cub
def fine_bear_cub(t):
    f = frame(18, 16)
    b = '#9a6238'
    B(f, 6, 11, 4.2, 4.0, b, 'body', tones=(1, 2, 2, 3))
    B(f, 6.8, 12, 2.4, 2.4, '#d8a876', 'belly', tones=(2, 3))
    B(f, 6.5, 5.4, 3.6, 3.2, b, 'head')
    B(f, 3.6, 2.6, 1.2, 1.2, b, 'ear', tones=(2, 3))
    B(f, 9.4, 2.6, 1.2, 1.2, b, 'ear', tones=(2, 3))
    B(f, 8.0, 6.6, 1.6, 1.2, '#d8a876', 'snout', tones=(2, 3))
    P(f, 8, 6, '#2a2430', 0, 'nose')
    eye(f, 5, 5, blink=(t == 3))
    eye(f, 9, 4, blink=(t == 3))
    # calm smile
    P(f, 8, 7, '#5a3a24', 0, 'mouth')
    # tiny mug held to chest
    box(f, 8, 9, 10, 11, '#f4f2ee', 'mug', rnd=False, lit=1, mid=1, dk=0)
    P(f, 11, 10, '#f4f2ee', 0, 'mug')
    P(f, 9, 9, '#8a4a20', 1, 'coffee')
    CAP(f, (4, 9), (8, 10), 0.9, b, 'arm')
    for x in (4, 8):
        P(f, x, 15, b, 1, 'foot')
    # flame tile beside it
    fl = (0, 1, 0, -1)[t]
    for x in range(12, 18):
        P(f, x, 15, '#8a5a34', 2 if x % 2 else 1, 'tile')
    poly(f, [(12.5, 15), (17.5, 15), (15 + fl * 0.5, 8 - (t % 2))], '#ff6a1a', 2, 'flame',
         shade=lambda x, y: 1 if y > 13 else 2)
    poly(f, [(13.5, 15), (16.5, 15), (15, 11 - (t % 2))], '#ffd23a', 3, 'core')
    img = render(f)
    if t in (1, 3):
        dot(img, 14 + (t == 3), 6, (255, 160, 60), 200)
    return img


# G526 ------------------------------------------------------------ Validator Crab
def validator_crab(t):
    f = frame(18, 15)
    bl = '#3a7aff'
    up = (0, -1, 0, -1)[t]
    for side in (-1, 1):
        for k in range(3):
            x = 8 + side * (3 + k)
            P(f, x, 13 + (k == 2), bl, 1, 'leg')
            P(f, x, 12, bl, 1, 'leg')
    B(f, 8, 10, 4.8, 3.2, bl, 'body', tones=(1, 2, 2, 3))
    P(f, 6, 9, '#a8c8ff', 4, 'body')
    # left claw resting, right claw raised with the check flag
    LN(f, (4, 9), (2, 8), bl, 2, 'arm')
    B(f, 1.6, 6.8, 1.6, 1.6, bl, 'claw', tones=(1, 2, 3))
    f.erase(1, 5)
    LN(f, (12, 9), (13, 7), bl, 2, 'arm')
    B(f, 13.6, 6.4 + up * 0.3, 1.6, 1.6, bl, 'claw', tones=(1, 2, 3))
    LN(f, (14, 6 + up), (14, 0 + up + 1), '#e8e6f0', 2, 'pole')
    box(f, 15, 1 + up, 17, 4 + up, '#3ed46a', 'flag', rnd=False)
    for (x, y) in ((15, 2), (16, 3), (17, 2)):
        P(f, x, y + up, '#ffffff', 1, 'check')
    for ex in (6, 10):
        P(f, ex, 6, bl, 2, 'stalk')
        f.put(ex, 5, 'white', 1, 'face')
        f.put(ex + 1, 5, 'eye', 0, 'face') if t != 2 else f.put(ex, 5, 'eye', 0, 'face')
    P(f, 7, 11, '#2050c0', 0, 'mouth')
    P(f, 8, 11, '#2050c0', 0, 'mouth')
    return render(f)


# G527 ------------------------------------------------------------ WAGMI Duckling
def wagmi_duckling(t):
    f = frame(15, 15)
    y = '#ffd23a'
    hop = (0, -1, 0, 0)[t]
    B(f, 6.5, 10 + hop, 4.6, 3.6, y, 'body', tones=(1, 2, 2, 3))
    P(f, 1, 8 + hop, y, 3, 'tail')
    B(f, 9.6, 5 + hop, 2.8, 2.6, y, 'head', tones=(1, 2, 3, 4))
    # tiny green headband with a knot tail
    for x in range(7, 13):
        if f.part_at(x, 4 + hop) == 'head':
            P(f, x, 4 + hop, '#3ed46a', 2, 'band')
    P(f, 6, 4 + hop + (t % 2), '#3ed46a', 3, 'band')
    P(f, 5, 5 + hop, '#3ed46a', 2, 'band')
    eye(f, 10, 5 + hop)
    S(f, 12, 6 + hop, ['oo', 'O.'], {'o': ('#ff8a1a', 2), 'O': ('#ff8a1a', 1)})
    blush(f, 10, 7 + hop)
    B(f, 5.5, 10 + hop, 2.0, 1.3, y, 'wing', tones=(1, 2, 2))
    if t == 1:
        # wing up cheer
        P(f, 5, 7 + hop, y, 3, 'wing')
        P(f, 4, 6 + hop, y, 3, 'wing')
    for x in (5, 8):
        P(f, x, 14, '#ff8a1a', 2, 'foot')
        P(f, x + 1, 14, '#ff8a1a', 1, 'foot')
    return render(f)


ITEMS_UNCOMMON = {
    'G501': lambda t: C.pet_bat(t),
    'G502': slot_hummingbird,
    'G503': airdrop_pigeon,
    'G504': anon_dev_cat,
    'G505': crash_cart_turtle,
    'G506': bonding_curve_snake,
    'G507': lanyard_lemur,
    'G508': cave_glowworm,
    'G509': flat_snail,
    'G510': diamond_hamster,
    'G511': lily_pad_frog,
    'G512': hat_dog_sleeper,
    'G513': pumpkin_mouse,
    'G514': lighthouse_gull,
    'G515': banana_monke,
    'G516': chart_cat,
    'G517': durian_hedgehog,
    'G518': teh_tarik_kitten,
    'G519': wau_butterfly,
    'G520': crawling_rug,
    'G521': seeker_beetle,
    'G522': ser_butler_mouse,
    'G523': shrimp_in_cup,
    'G524': sniper_hawk,
    'G525': fine_bear_cub,
    'G526': validator_crab,
    'G527': wagmi_duckling,
}

"""Gali Gear 555 pets: Legendary tier (G547-G555). Bigger, gold, glow, effects."""
import math

from PIL import Image

from pets_lib import (B, CAP, P, LN, S, eye, bigeye, blush, render, frame, spark, dot, poly, box, clip, halo,
                      PINK, BOB, C, R, pad, ink_outline, bresenham)
import pets_common


# G548 ------------------------------------------------------------ Burn Phoenix
def burn_phoenix(t):
    W, H = 24, 22
    f = frame(W, H)
    bob = BOB[t]
    flap = (0, 1, 2, 1)[t]
    cy = 10 + bob
    # flame tail: three feathers trailing down-left, licking
    for i, (ex, ey, col) in enumerate(((1, 19, '#e8302a'), (4, 21, '#ff7a1a'), (8, 21, '#ffc23a'))):
        wv = (0, 1, 0, -1)[(t + i) % 4]
        a, m, b = (10, cy + 2), ((10 + ex) / 2 + wv, (cy + 2 + ey) / 2), (ex + wv, ey - abs(wv))
        CAP(f, a, m, 1.4, col, 'tail', tones=(1, 2, 3))
        CAP(f, m, b, 0.9, col, 'tail', tones=(1, 2, 3))
        P(f, b[0], b[1], '#ffe88a', 4, 'tailtip')
    # back wing (darker), raised high behind
    btip = [(4, 0), (2, 4), (3, 9), (2, 4)][t]
    poly(f, [(10, cy - 1), (btip[0], btip[1] + bob), (btip[0] + 2, btip[1] + 3 + bob), (8, cy + 2)],
         '#c8282a', 2, 'wingb', shade=lambda x, y: 2)
    # body
    B(f, 11.5, cy + 1, 3.6, 3.0, '#ff6a1a', 'body', tones=(1, 2, 3, 4))
    B(f, 13, cy + 2, 1.8, 1.8, '#ffd23a', 'chest', tones=(2, 3, 4))
    # neck + head facing right
    CAP(f, (13, cy - 1), (15, cy - 4), 1.3, '#ff6a1a', 'neck', tones=(1, 2, 3))
    B(f, 16, cy - 5, 2.2, 1.9, '#ff6a1a', 'head', tones=(1, 2, 3, 4))
    S(f, 18, int(cy) - 5, ['yy', 'Y.'], {'y': ('#ffd23a', 3), 'Y': ('#c88a1a', 2)})
    eye(f, 16, int(cy) - 6)
    # crest flames streaming back
    lick = t % 2
    for (x, y, k) in ((14, -8, 3), (13, -9 + lick, 4), (15, -8, 3), (12, -8, 2), (16, -8, 3), (14, -9, 3)):
        P(f, x, cy + y, '#ffd23a', k, 'crest')
    # front wing, big flame-feathered, flapping
    ftip = [(5, 1), (2, 6), (5, 13), (2, 6)][t]
    poly(f, [(13, cy), (ftip[0], ftip[1] + bob), (ftip[0] + 3, ftip[1] + 4 + bob), (11, cy + 3)],
         '#ff8a1a', 3, 'wing', shade=lambda x, y: 3 if y < cy - 2 else 2)
    # feather tips along the wing's outer edge
    for k in range(3):
        fx = ftip[0] + k
        fy = ftip[1] + bob + (1 if flap == 2 else 0) - (0 if flap == 2 else 0)
        P(f, fx + (k if flap != 2 else 0), fy + k * (1 if flap != 2 else 1), '#ffe88a', 4, 'ftip')
    LN(f, (12, int(cy)), (ftip[0], ftip[1] + bob), '#ffd23a', 4, 'bone')
    # legs tucked
    P(f, 11, int(cy) + 4, '#c88a1a', 1, 'leg')
    P(f, 12, int(cy) + 4, '#c88a1a', 1, 'leg')
    img = render(f)
    # embers falling and vanishing
    for i in range(4):
        ph = (t + i) % 4
        x = (6, 10, 15, 19)[i]
        y = 12 + ph * 2 + (i % 2)
        if y < H:
            col = ((255, 230, 110), (255, 170, 60), (230, 100, 40), (150, 70, 40))[ph]
            dot(img, x, y, col, (255, 230, 170, 90)[ph])
    return halo(img, (255, 130, 40), 12, cy, 12, 80)


# G549 ------------------------------------------------------------ Compressed Critter
def compressed_critter(t):
    W, H = 20, 20
    f = frame(W, H)
    bob = BOB[t]
    # the magnifier lens hovering, angled handle down-right
    cx, cy, r = 9, 8 + bob, 6.4
    for y in range(H):
        for x in range(W):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if r - 1.6 <= d < r:
                ang = math.atan2(y + 0.5 - cy, x + 0.5 - cx)
                tone = 4 if -2.6 < ang < -1.2 else 3 if ang < 0 else 1
                f.put(x, y, R('#f6bc36'), tone, 'rim')
    CAP(f, (cx + 4.5, cy + 4.5), (cx + 8.5, cy + 8.5), 1.2, '#8a4a24', 'handle', tones=(1, 2, 3))
    P(f, int(cx + 4.5), int(cy + 4.5), '#f6bc36', 2, 'collar')
    img = render(f)
    # glass: translucent pale blue fill + glints
    gp = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    q = gp.load()
    pulse = (110, 140, 170, 140)[t]
    for y in range(H):
        for x in range(W):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d < r - 1.6:
                q[x, y] = (200, 240, 255, 200 + pulse // 4)
    gp.alpha_composite(img)
    img = gp
    dot(img, int(cx) - 3, int(cy) - 3, (255, 255, 255), 230, over=True)
    dot(img, int(cx) - 2, int(cy) - 4, (255, 255, 255), 170, over=True)
    # the one pixel creature in the centre, magnified 2x look: a 2x2 critter with eye
    ox, oy = int(cx) - 1, int(cy) - 1
    px = img.load()
    hop = 1 if t == 1 else 0
    oy -= hop
    for dy in range(3):
        for dx in range(3):
            if (dx, dy) in ((0, 0), (2, 0)):
                continue
            px[ox + dx, oy + dy] = (255, 120, 170, 255) if dy < 2 else (210, 70, 120, 255)
    px[ox, oy] = (255, 170, 200, 255)
    px[ox + 2, oy + 1] = (30, 20, 30, 255) if t != 2 else (255, 120, 170, 255)
    px[ox, oy + 3] = (150, 50, 90, 255)
    px[ox + 2, oy + 3] = (150, 50, 90, 255)
    # little feet + a "!" squeak
    if t in (1, 2):
        dot(img, ox + 3, oy - 3, (255, 255, 255), 255, over=True)
        dot(img, ox + 3, oy - 2, (255, 255, 255), 255, over=True)
        dot(img, ox + 3, oy, (255, 255, 255), 255, over=True)
    # sparkles
    sx, sy = [(2, 2), (16, 3), (17, 12), (1, 13)][t]
    spark(img, sx, sy + bob, (255, 230, 120))
    return halo(img, (255, 214, 90), cx, cy, 10, 60 + (t % 2) * 25)


# G550 ------------------------------------------------------------ Diamond Hands Drake
def diamond_drake(t):
    W, H = 24, 21
    f = frame(W, H)
    bob = BOB[t]
    flap = (0, 1, 2, 1)[t]
    ice = '#9ae0ff'
    cy = 10 + bob
    # back wing
    tip = (4, (1, 4, 8)[flap] + bob)
    poly(f, [(10, cy - 1), tip, (6, tip[1] + 4), (9, cy + 3)], '#6ab8e8', 2, 'wingb',
         shade=lambda x, y: 2)
    # tail curling
    pts = [(8, cy + 5), (5, cy + 7), (3, cy + 6), (2, cy + 4 + (t % 2))]
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        CAP(f, a, b, 1.5 - i * 0.4, ice, 'tail', tones=(1, 2, 3))
    P(f, 1, cy + 3 + (t % 2), '#e8f8ff', 3, 'tailtip')
    # body
    B(f, 11, cy + 3, 4.2, 4.0, ice, 'body', tones=(1, 2, 2, 3, 4))
    B(f, 12.5, cy + 4, 2.2, 2.6, '#e8f8ff', 'belly', tones=(2, 3))
    for y in range(int(cy) + 2, int(cy) + 7, 2):
        P(f, 13, y, '#9ae0ff', 1, 'scale')
    # neck + head
    CAP(f, (13, cy + 1), (15, cy - 3), 1.6, ice, 'neck', tones=(1, 2, 3))
    B(f, 16.5, cy - 4, 2.8, 2.2, ice, 'head', tones=(1, 2, 3, 4))
    roar = t == 2
    if roar:
        S(f, 18, int(cy) - 4, ['iii', 'r..', 'iii'], {'i': (ice, 2), 'r': ('#e8304a', 1)})
    else:
        S(f, 18, int(cy) - 4, ['iii', 'ii.'], {'i': (ice, 2)})
    # crystal horns / spikes
    for (x, y) in ((15, -7), (14, -8), (17, -7)):
        P(f, x, cy + y, '#e8f8ff', 4, 'horn')
    for (x, y) in ((9, -1), (8, 0), (10, -2)):
        P(f, x, cy + y + 2, '#e8f8ff', 4, 'spine')
    eye(f, 17, int(cy) - 5)
    # front wing
    tip2 = (8, (0, 3, 7)[flap] + bob)
    poly(f, [(12, cy), tip2, (9, tip2[1] + 5), (12, cy + 3)], ice, 3, 'wing',
         shade=lambda x, y: 3 if y < cy else 2)
    LN(f, (12, int(cy)), tip2, '#e8f8ff', 4, 'wingbone')
    # clutching a gem (blue diamond) against the chest
    gx, gy = 14, int(cy) + 3
    S(f, gx, gy, ['.ab.', 'abcd', '.cd.'], {'a': ('#3a7aff', 4), 'b': ('#3a7aff', 3), 'c': ('#3a7aff', 2), 'd': ('#3a7aff', 1)})
    P(f, 13, gy + 1, ice, 1, 'claw')
    P(f, 18, gy + 1, ice, 1, 'claw')
    # feet
    P(f, 9, int(cy) + 7, ice, 1, 'foot')
    P(f, 12, int(cy) + 7, ice, 1, 'foot')
    img = render(f)
    if roar:
        for (dx, dy) in ((0, 0), (1, -1), (1, 1)):
            dot(img, 22 + dx, int(cy) - 3 + dy, (255, 255, 255), 200)
    # sparkle trail
    for i, (x, y) in enumerate(((2, 2), (5, 16), (21, 15), (20, 2))):
        if (i + t) % 2 == 0:
            spark(img, x, y + bob, (180, 230, 255))
    spark(img, gx + 1, gy, (255, 255, 255), over=True) if t == 1 else None
    return halo(img, (140, 210, 255), 12, cy + 1, 12, 70)


# G551 ------------------------------------------------------------ Coin Tongue Frog
def coin_tongue_frog(t):
    W, H = 24, 16
    f = frame(W, H)
    bl = '#2a3a8a'
    sq = (0, 0, 1, 0)[t]
    B(f, 3.5, 13.5, 2.5, 2.0, bl, 'leg', tones=(1, 2, 2))
    B(f, 8, 11.6 + sq * 0.4, 6.2, 3.8 - sq * 0.4, bl, 'body', tones=(0, 1, 2, 3))
    B(f, 10.5, 13.4, 3.0, 1.4, '#7a8ae8', 'belly', tones=(2, 3))
    for ex in (6, 11):
        B(f, ex + 0.5, 7.4 + sq, 2.0, 1.9, bl, 'bump', tones=(1, 2, 3))
        bigeye(f, ex, 6 + sq, blink=(t == 3))
    # star speckles
    for (x, y) in ((4, 10), (7, 12), (3, 12), (9, 10), (6, 9)):
        P(f, x, y + sq, '#fff4b0', 4, 'star')
    # mouth / tongue
    if t == 1:
        # tongue lashing out to a coin
        for x in range(14, 22):
            P(f, x, 10, '#ff5a8a', 2 if x < 21 else 3, 'tongue')
        P(f, 21, 9, '#ff5a8a', 3, 'tongue')
    elif t == 2:
        # gulp: cheeks puffed, coin glint in mouth
        B(f, 13, 11, 1.8, 1.6, '#3a4aa8', 'cheek', tones=(2, 3))
        P(f, 13, 11, '#f6bc36', 3, 'coin')
    for x in range(9, 15):
        P(f, x, 10 + sq if t != 1 else 11, bl, 0, 'mouth') if t != 1 else None
    P(f, 12, 15, bl, 3, 'foot')
    P(f, 13, 15, bl, 2, 'foot')
    img = render(f)
    # the passing coin
    if t == 0:
        coin_xy = (20, 6)
    elif t == 1:
        coin_xy = (21, 9)
    else:
        coin_xy = None
    if coin_xy:
        cf = frame(W, H)
        B(cf, coin_xy[0] + 0.5, coin_xy[1] + 0.5, 1.8, 1.8, '#f6bc36', 'coin', tones=(1, 2, 3, 4))
        P(cf, coin_xy[0], coin_xy[1], '#f6bc36', 4, 'coin')
        ci = render(cf)
        img.alpha_composite(ci)
    if t == 3:
        # croak ring
        for (x, y) in ((16, 8), (17, 9), (17, 10), (16, 11)):
            dot(img, x, y, (200, 210, 255), 200)
    if t == 2:
        spark(img, 16, 8, (255, 230, 120))
    return halo(img, (120, 140, 255), 8, 10, 9, 60)


# G552 ------------------------------------------------------------ Hat Dog Legend
def hat_dog_legend(t):
    f = pets_common.hat_dog_pup(t, legend=True)
    hx, hy = f._hat
    # dance: lift a paw on alternate frames
    if t in (1, 3):
        P(f, 13, 11, '#d8a466', 3, 'paw')
        P(f, 14, 10, '#d8a466', 2, 'paw')
    # gold pom-pom
    S(f, hx - 1, hy - 1, ['.g.', 'ggg', '.g.'], {'g': ('#f6bc36', 3)})
    P(f, hx - 1, hy - 1, '#f6bc36', 4, 'pom') if False else P(f, hx, hy - 1, '#f6bc36', 4, 'pom')
    # gold knit stripe on the cuff
    for x in range(hx - 4, hx + 4, 2):
        P(f, x, hy + 4, '#f6bc36', 3, 'gold')
    img = render(f)
    img = pad(img, 21, 21, 2, 4)
    # sparkles on the beanie, rotating
    sp = [(4, 2), (15, 1), (18, 6), (2, 7)]
    sx, sy = sp[t]
    spark(img, sx, sy, (255, 230, 120))
    spark(img, hx + 2, hy + 4 - 1, (255, 255, 255), arm=1) if t % 2 == 0 else None
    # music note while dancing
    if t in (1, 3):
        for (x, y) in ((19, 10), (19, 11), (19, 12), (18, 12), (20, 10)):
            dot(img, x, y - (t == 3), (255, 150, 200), 230)
    return halo(img, (255, 200, 100), hx + 2, hy + 4, 9, 60)


# G553 ------------------------------------------------------------ Pocket Lighthouse
def pocket_lighthouse(t):
    W, H = 26, 24
    f = frame(W, H)
    bob = BOB[t]
    cx = 13
    # tapered tower with red and white bands
    for y in range(8, 20):
        hw = 2 + (y - 8) * 0.25
        for x in range(int(cx - hw), int(cx + hw) + 1):
            band = ((y - 8) // 3) % 2
            col = '#e8303a' if band == 0 else '#f6f2ea'
            tone = 3 if x < cx - hw * 0.4 else 2 if x < cx + hw * 0.5 else 1
            P(f, x, y + bob, col, tone, 'tower')
    # door
    P(f, cx, 18 + bob, '#5a3a24', 1, 'door')
    P(f, cx, 17 + bob, '#5a3a24', 2, 'door')
    # gallery rail + lamp room
    for x in range(cx - 4, cx + 5):
        P(f, x, 7 + bob, '#3a3a50', 2, 'rail')
    box(f, cx - 2, 3 + bob, cx + 2, 6 + bob, '#fff4b0', 'lamp', rnd=False, lit=4, mid=3, dk=2)
    LN(f, (cx, 3 + bob), (cx, 6 + bob), '#3a3a50', 1, 'mullion')
    # red cap roof
    poly(f, [(cx - 3, 3 + bob), (cx + 3, 3 + bob), (cx, 0 + bob)], '#e8303a', 2, 'roof',
         shade=lambda x, y: 3 if x < cx else 1)
    # tiny rock base floating
    B(f, cx, 20.5 + bob, 5.0, 1.8, '#8e8ca0', 'rock', tones=(1, 2, 3))
    img = render(f)
    # sweeping beam: a translucent wedge rotating around the lamp
    ang = [0.0, 1.0, math.pi, 2.2][t]
    lx, ly = cx + 0.5, 4.5 + bob
    beam = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bp = beam.load()
    dirx = math.cos(ang)
    side = 1 if t in (0, 1) else -1
    for y in range(H):
        for x in range(W):
            dx, dy = x + 0.5 - lx, y + 0.5 - ly
            d = math.hypot(dx, dy)
            if d < 3 or d > 13:
                continue
            if dx * side <= 0:
                continue
            spread = abs(dy) / max(1, abs(dx))
            narrow = (0.3, 0.55, 0.3, 0.55)[t]
            if spread < narrow:
                a = int(230 * (1 - d / 15))
                a = int(round(a / 18) * 18)
                if a > 0:
                    bp[x, y] = (255, 246, 180, a)
    beam.alpha_composite(img)
    img = beam
    if t == 0:
        spark(img, cx, 1 + bob - 1 if bob else 0, (255, 248, 196))
    return halo(img, (255, 230, 140), lx, ly, 7, 120)


# G554 ------------------------------------------------------------ Nugget
def nugget(t):
    W, H = 20, 17
    f = frame(W, H)
    bob = (0, -1, 0, 0)[t]
    cy = 11 + bob
    f.blob(8.4, cy, 5.6, 4.0, 'mole', (1, 2, 2, 3), 'body')
    f.blob(13.4, cy + 0.6, 2.0, 1.4, 'mole', (2, 3, 3), 'body')
    P(f, 15, int(cy), '#ff96b0', 2, 'nose')
    P(f, 16, int(cy), '#ff96b0', 1, 'nose')
    for x in range(6, 12):
        P(f, x, int(cy + 2.8), 'mole', 3, 'body') if False else f.put(x, int(cy + 2.8), 'mole', 3, 'body')
    # eye: grin squint on t==3
    if t == 3:
        P(f, 11, int(cy) - 1, '#3a2018', 0, 'face')
        P(f, 12, int(cy) - 2, '#3a2018', 0, 'face')
        for (x, y) in ((12, 2), (13, 2), (14, 1)):
            P(f, x, int(cy) + y, '#3a2018', 0, 'grin')
        P(f, 13, int(cy) + 1, 'white', 1, 'grin') if False else f.put(13, int(cy) + 1, 'white', 1, 'grin')
    else:
        f.put(11, int(cy) - 1, 'eye', 0, 'face')
        f.put(11, int(cy) - 2, 'white', 1, 'face')
    blush(f, 11, int(cy) + 1)
    # paws
    for x in (6, 11):
        P(f, x, 16, '#ff96b0', 2, 'paw')
    P(f, 2, int(cy) - 1, 'mole', 1, 'tail') if False else f.put(2, int(cy) - 1, 'mole', 1, 'tail')
    # yellow hardhat with ORE mark
    hx, hy = 9, int(cy) - 7
    for x in range(hx - 3, hx + 3):
        P(f, x, hy + 1, '#ffd23a', 3 if x < hx - 1 else 2, 'hat')
    for x in range(hx - 2, hx + 2):
        P(f, x, hy, '#ffd23a', 4 if x < hx else 3, 'hat')
    for x in range(hx - 3, hx + 3):
        P(f, x, hy + 2, '#ffd23a', 2 if x < hx + 1 else 1, 'hat')
    for x in range(hx - 4, hx + 6):
        P(f, x, hy + 3, '#e8a018', 2 if x < hx + 3 else 1, 'brim')
    # ORE mark: little dark pickaxe-ish "O" in a pip on the front
    for (x, y) in ((hx, hy + 1), (hx + 1, hy + 1), (hx, hy + 2), (hx + 1, hy + 2)):
        P(f, x, y, '#5a2e14', 1, 'mark')
    P(f, hx, hy + 1, '#ffd23a', 4, 'mark') if False else None
    # coin action: t0 coin held out, t1 hidden behind back, t2 grin sparkle, t3 grin
    if t == 0:
        S(f, 15, int(cy) + 2, ['.c.', 'cCc', '.c.'], {'c': ('#f6bc36', 2), 'C': ('#f6bc36', 4)})
        P(f, 14, int(cy) + 3, '#ff96b0', 2, 'paw')
    elif t == 1:
        S(f, 2, int(cy) + 1, ['cc', 'cc'], {'c': ('#f6bc36', 2)})
        P(f, 3, int(cy) + 1, '#f6bc36', 4, 'coin')
    img = render(f)
    if t in (2, 3):
        spark(img, 17, int(cy) - 4, (255, 230, 120), arm=2 if t == 2 else 1)
    if t == 0:
        spark(img, 18, int(cy) + 1, (255, 255, 255))
    return halo(img, (255, 210, 80), 9, cy - 2, 9.5, 60)


# G555 ------------------------------------------------------------ Old Glow
def old_glow(t):
    W, H = 22, 24
    f = frame(W, H)
    bob = BOB[t]
    cx = 11
    br = '#c88a3a'
    top = 4 + bob
    # hanging ring
    for (x, y) in ((cx - 1, top - 3), (cx, top - 4), (cx + 1, top - 3), (cx - 1, top - 2), (cx + 1, top - 2)):
        P(f, x, y, br, 3, 'ring')
    # cap
    poly(f, [(cx - 4, top + 2), (cx + 5, top + 2), (cx + 2, top - 1), (cx - 1, top - 1)], br, 2, 'cap',
         shade=lambda x, y: 3 if x < cx else 1)
    for x in range(cx - 5, cx + 6):
        P(f, x, top + 2, br, 3 if x < cx else 1, 'band')
    # glass chamber with brass frame posts
    for y in range(top + 3, top + 11):
        for x in range(cx - 4, cx + 5):
            P(f, x, y, '#fff0b0', 3, 'glass')
    for y in range(top + 3, top + 11):
        P(f, cx - 4, y, br, 3, 'post')
        P(f, cx + 4, y, br, 1, 'post')
        P(f, cx, y, br, 2, 'post') if False else None
    # flame inside, flickering
    fl = (0, 1, 0, -1)[t]
    fh = (4, 5, 4, 3)[t]
    poly(f, [(cx - 1.5, top + 10), (cx + 2.5, top + 10), (cx + 0.5 + fl * 0.6, top + 10 - fh - 1)], '#ff9a2a', 2,
         'flame')
    poly(f, [(cx - 0.5, top + 10), (cx + 1.5, top + 10), (cx + 0.5 + fl * 0.3, top + 10 - fh + 1)], '#fff4b0', 4,
         'core')
    # base
    for x in range(cx - 5, cx + 6):
        P(f, x, top + 11, br, 3 if x < cx else 1, 'base')
    for x in range(cx - 4, cx + 5):
        P(f, x, top + 12, br, 1, 'base')
    P(f, cx - 4, top + 11, '#ffe8a0', 4, 'base')
    img = render(f)
    # light circle on the ground below and a warm halo, flaring on t==1
    flare = t == 1
    ring = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    rp = ring.load()
    gy = H - 2
    for x in range(W):
        d = abs(x + 0.5 - cx - 0.5) / 9
        if d < 1:
            a = int(round((1 - d) * (150 if flare else 100) / 18) * 18)
            for y in (gy, gy + 1):
                rp[x, y] = (255, 214, 120, a if y == gy else a // 2)
    ring.alpha_composite(img)
    img = ring
    img = halo(img, (255, 200, 90), cx + 0.5, top + 7, 11 if flare else 9.5, 120 if flare else 90)
    if flare:
        spark(img, cx + 7, top + 2, (255, 240, 160), arm=2)
    if t == 3:
        spark(img, cx - 7, top + 6, (255, 240, 160))
    return img


ITEMS_LEGEND = {
    'G547': lambda t: C.pet_firefly(t),
    'G548': burn_phoenix,
    'G549': compressed_critter,
    'G550': diamond_drake,
    'G551': coin_tongue_frog,
    'G552': hat_dog_legend,
    'G553': pocket_lighthouse,
    'G554': nugget,
    'G555': old_glow,
}

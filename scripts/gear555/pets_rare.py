"""Gali Gear 555 pets: Rare tier (G528-G546). Distinct shapes, accent colours, a glint."""
import math

from pets_lib import B, CAP, P, LN, S, eye, bigeye, blush, render, frame, spark, dot, poly, box, clip, halo, PINK, BOB, C, R
from PIL import Image


# G529 ------------------------------------------------------------ Mini Mole King
def mini_mole_king(t):
    f = frame(16, 16)
    k = '#3a2a3a'
    bob = (0, -1, 0, -1)[t]
    cy = 10.5 + bob
    B(f, 7, cy, 5.4, 4.2, k, 'body', tones=(0, 1, 2, 3))
    B(f, 12, cy + 0.8, 2.0, 1.5, k, 'snout', tones=(1, 2, 3))
    P(f, 13, int(cy), '#ff96b0', 2, 'nose')
    P(f, 14, int(cy), '#ff96b0', 1, 'nose')
    # glowing red eyes, blink on t==2
    for ex in (9, 11):
        if t == 2:
            P(f, ex, int(cy) - 1, '#ff3048', 0, 'eyes')
        else:
            P(f, ex, int(cy) - 1, '#ff5a6a', 3, 'eyes')
    # claws
    fx = ((10, 4), (9, 5), (10, 4), (11, 3))[t]
    for x in fx:
        P(f, x, 15, '#ff96b0', 2, 'paw')
    # tiny gold crown with a red jewel
    cx, top = 7, int(cy - 4.2) - 3
    S(f, cx - 3, top, ['#.#.#', '#####', '##r##'], {'#': ('#f6bc36', 2), 'r': ('#e8304a', 2)})
    P(f, cx - 3, top, '#f6bc36', 4, 'crown')
    P(f, cx - 2, top + 1, '#f6bc36', 3, 'crown')
    img = render(f)
    # eye glow
    if t != 2:
        for ex in (9, 11):
            dot(img, ex, int(cy) - 2, (255, 80, 100), 90)
    if t == 1:
        spark(img, cx - 3, top - 1, (255, 230, 120))
    return halo(img, (255, 60, 80), 10, cy - 1, 4.5, 50) if t != 2 else img


# G530 ------------------------------------------------------------ Gem Shell Turtle
def gem_shell_turtle(t):
    f = frame(19, 15)
    gr = '#5cba4a'
    for x in (5, 11):
        B(f, x, 13, 1.5, 1.5, gr, 'leg', tones=(1, 2))
    B(f, 15.4, 10.6, 2.4, 2.0, gr, 'head')
    eye(f, 16, 10, blink=(t == 3))
    P(f, 17, 11, '#2a6a2a', 0, 'face')
    P(f, 2, 12, gr, 1, 'tail')
    # faceted pale blue diamond shell
    rows = [(4, 6, 10), (5, 4, 12), (6, 3, 13), (7, 2, 14), (8, 2, 14), (9, 2, 14), (10, 3, 13), (11, 3, 13)]
    for (y, x0, x1) in rows:
        for x in range(x0, x1 + 1):
            # facets: diagonal bands
            fct = ((x + y) // 3 + (x - y) // 3) % 3
            tone = (3, 2, 1)[fct]
            if y == 4 or x == x0:
                tone = 4
            if y == 11:
                tone = 1
            P(f, x, y, '#9ae0ff', tone, 'shell')
    for x in range(2, 15):
        P(f, x, 12, '#4a8ac0', 1, 'rim')
    img = render(f)
    # sparkle on loop moving across the shell
    sx, sy = [(5, 5), (8, 4), (11, 6), (13, 8)][t]
    spark(img, sx, sy, (200, 240, 255), over=True)
    return img


# G531 ------------------------------------------------------------ Broom Ferret
def broom_ferret(t):
    f = frame(22, 14)
    w = '#f4f0ea'
    sw = (0, 1, 0, -1)[t]
    # broom dragged behind: handle from the mouth back to bristles
    bx = 4 + sw
    LN(f, (15, 6), (bx + 2, 8), '#a0703f', 2, 'handle')
    poly(f, [(bx - 1, 8), (bx + 5, 8), (bx + 7, 13), (bx - 3, 13)], '#e8c060', 2, 'bristle',
         shade=lambda x, y: 3 if x < bx + 1 else 2 if x < bx + 4 else 1)
    for x in range(bx - 2, bx + 7, 2):
        P(f, x, 12, '#b08830', 1, 'bristle')
    for x in range(bx - 1, bx + 5):
        P(f, x, 8, '#c84a3a', 2, 'band')
    # dust puff
    CAP(f, (6, 7), (12, 7.4), 2.1, w, 'body', tones=(1, 2, 3))
    B(f, 15, 5.4, 2.6, 2.2, w, 'head', tones=(1, 2, 3, 4))
    P(f, 13, 3, w, 3, 'ear')
    # brown mask stripe around the eye
    for x in (14, 15, 16):
        P(f, x, 5, '#a07a5a', 1, 'mask')
    f.put(15, 5, 'eye', 0, 'face')
    P(f, 17, 6, '#ff7a9a', 2, 'nose')
    # holding the handle in mouth
    P(f, 16, 7, '#a0703f', 2, 'handle')
    P(f, 3 - 0, 6 + (t % 2), w, 2, 'tail') if False else None
    CAP(f, (4, 6.6), (1.6, 5.6 + (t % 2)), 0.9, '#e0d8cc', 'tail', tones=(1, 2, 3))
    for x, ph in ((7, 0), (12, 1)):
        dx = (0, 1)[(t + ph) % 2]
        P(f, x + dx, 10, '#e0d8cc', 1, 'leg')
        P(f, x, 9, '#e0d8cc', 1, 'leg')
    img = render(f)
    for (x, y) in (((1, 11), (0, 10)), ((2, 11), (1, 10)), ((0, 11), (1, 9)), ((1, 10), (0, 11)))[t]:
        dot(img, x, y, (220, 200, 160), 150) if False else None
    for (x, y, a) in ((bx - 2, 11, 150), (bx - 3, 10, 100), (bx + 6, 12, 120)):
        dot(img, x, y, (230, 210, 170), a)
    return img


# G532 ------------------------------------------------------------ Frog Prince Hopper
def frog_prince(t):
    f = frame(16, 16)
    g = '#4ec43c'
    puff = (0, 1, 2, 1)[t]
    B(f, 3.5, 13.5, 2.5, 2.0, g, 'leg', tones=(1, 2, 2))
    B(f, 8, 12, 6.2, 3.6, g, 'body', tones=(1, 2, 2, 3))
    # throat sac puffing
    B(f, 11, 13.4, 2.0 + puff * 0.7, 1.4 + puff * 0.5, '#e8ffb0', 'sac', tones=(2, 3, 4))
    for ex in (6, 11):
        B(f, ex + 0.5, 8.2, 2.0, 1.9, g, 'bump', tones=(1, 2, 3))
        bigeye(f, ex, 7, blink=False)
    for x in range(9, 14):
        P(f, x, 11, g, 0, 'mouth')
    P(f, 14, 10, g, 0, 'mouth')
    # crown between the eyes
    S(f, 7, 2, ['#.#.#', '#####', '#rbr#'], {'#': ('#f6bc36', 2), 'r': ('#e8304a', 2), 'b': ('#3a7aff', 2)})
    P(f, 7, 2, '#f6bc36', 4, 'crown')
    P(f, 8, 3, '#f6bc36', 3, 'crown')
    P(f, 11, 4, '#f6bc36', 1, 'crown')
    P(f, 12, 15, g, 3, 'foot')
    P(f, 13, 15, g, 2, 'foot')
    img = render(f)
    if t == 2:
        spark(img, 6, 1, (255, 230, 120))
    return img


# G533 ------------------------------------------------------------ Galaxy Jellyfish
def galaxy_jelly(t):
    W, H = 16, 19
    f = frame(W, H)
    bob = BOB[t]
    pulse = (0, 1, 0, -1)[t]
    rx, ry = 6.0 + pulse * 0.4, 4.6 - pulse * 0.3
    cy = 6 + bob
    B(f, 8, cy, rx, ry, '#7a4ae8', 'dome', tones=(0, 1, 2, 3, 4))
    clip(f, lambda x, y: y <= cy + 1.5)
    # scalloped hem
    for x in range(int(8 - rx), int(8 + rx) + 1):
        P(f, x, int(cy) + 2, '#c08aff', 2 if x % 2 else 3, 'hem')
    # trailing tentacles, wavy
    for i, x0 in enumerate((4, 6, 9, 11)):
        for k in range(7):
            x = x0 + int(round(math.sin((k + t * 1.5 + i) * 0.9) * 0.8))
            P(f, x, int(cy) + 3 + k, '#c08aff', 3 - (k // 3), 'tent')
    eye(f, 6, int(cy))
    eye(f, 10, int(cy))
    blush(f, 5, int(cy) + 1)
    blush(f, 11, int(cy) + 1)
    img = render(f)
    # semi-transparent: soften the dome
    px = img.load()
    for y in range(H):
        for x in range(W):
            p = px[x, y]
            if p[3] == 255 and p[:3] in [tuple(c) for c in __import__('pets_lib').RAMPS[R('#7a4ae8')]]:
                px[x, y] = (*p[:3], 215)
    # stars in the dome twinkle
    stars = [(5, 4), (9, 3), (11, 5), (7, 6), (4, 6)]
    for i, (x, y) in enumerate(stars):
        if (i + t) % 2 == 0:
            dot(img, x, y + bob, (255, 255, 230), 255, over=True)
        else:
            dot(img, x, y + bob, (200, 180, 255), 255, over=True)
    return halo(img, (170, 120, 255), 8, cy, 9, 60 + pulse * 15)


# G534 ------------------------------------------------------------ Hollow Wisp
def hollow_wisp(t):
    W, H = 15, 18
    f = frame(W, H)
    bob = BOB[t]
    w = '#f4f2fa'
    # sheet ghost: dome + draped body with wavy hem
    B(f, 7.5, 6 + bob, 5.0, 4.6, w, 'sheet', tones=(1, 2, 3, 4))
    for y in range(6, 15):
        for x in range(2, 14):
            hem = 14 + int(round(math.sin((x + t * 2) * 1.2) * 0.8))
            if y + bob <= hem + bob and y >= 6:
                tone = 3 if x < 5 else 2 if x < 11 else 1
                P(f, x, y + bob, w, tone, 'sheet')
    # black eye holes and a small mouth "boo"
    for ex in (5, 9):
        P(f, ex, 6 + bob, '#1a1420', 0, 'holes')
        P(f, ex + 1, 6 + bob, '#1a1420', 0, 'holes')
        P(f, ex, 7 + bob, '#1a1420', 0, 'holes')
        P(f, ex + 1, 7 + bob, '#1a1420', 0, 'holes')
    P(f, 7, 10 + bob, '#1a1420', 0, 'holes')
    P(f, 8, 10 + bob, '#1a1420', 0, 'holes')
    blush(f, 4, 9 + bob)
    blush(f, 11, 9 + bob)
    img = render(f)
    # flicker half transparent on t==1,3
    a = (255, 150, 255, 190)[t]
    if a < 255:
        px = img.load()
        for y in range(H):
            for x in range(W):
                p = px[x, y]
                if p[3]:
                    px[x, y] = (*p[:3], int(p[3] * a / 255))
    return halo(img, (220, 220, 255), 7.5, 9 + bob, 8.5, 50)


# G535 ------------------------------------------------------------ Hopium Balloon
def hopium_balloon(t):
    W, H = 14, 20
    f = frame(W, H)
    bob = (0, -1, -2, -1)[t]
    g = '#3ed46a'
    B(f, 7, 6 + bob, 5.4, 5.6, g, 'balloon', tones=(0, 1, 2, 3, 4))
    # knot
    S(f, 6, 12 + bob, ['.#.', '###'], {'#': (g, 1)})
    # face: happy hopeful
    eye(f, 5, 5 + bob, size=3)
    eye(f, 9, 5 + bob, size=3)
    for (x, y) in ((5, 8), (6, 9), (7, 9), (8, 9), (9, 8)):
        P(f, x, y + bob, '#1e6a3a', 0, 'smile')
    blush(f, 4, 7 + bob)
    blush(f, 10, 7 + bob)
    # highlight
    P(f, 4, 3 + bob, 'white', 1, 'shine') if False else f.put(4, 3 + bob, 'white', 1, 'shine')
    f.put(3, 4 + bob, 'white', 0, 'shine')
    img = render(f)
    # string curling down (thin, not outlined)
    for k in range(14 + bob, H):
        x = 7 + int(round(math.sin((k + t) * 0.8) * 1))
        dot(img, x, k, (230, 230, 240), 255)
    # up arrow sparkle
    if t == 2:
        spark(img, 12, 2, (200, 255, 200))
    return img


# G536 ------------------------------------------------------------ Margin Vulture
def margin_vulture(t):
    W, H = 22, 16
    f = frame(W, H)
    k = '#4a3e5e'
    bob = (0, 0, 1, 1)[t]
    flap = (0, 1, 2, 1)[t]
    cx = 11
    # wings: wide fingered sweep, slow flap
    for side in (-1, 1):
        tipy = (2, 5, 9)[flap] + bob
        sh = (cx + side * 2, 7 + bob)
        tip = (cx + side * 10, tipy)
        poly(f, [sh, tip, (cx + side * 9, tipy + 3), (cx + side * 3, 10 + bob)], k, 2, 'wing',
             shade=lambda x, y: 3 if y < 7 + bob else 2)
        # primary feather fingers
        for j in range(3):
            fx = cx + side * (8 - j * 2)
            P(f, fx, tipy + 3 + (j % 2), k, 1, 'finger')
    B(f, cx + 0.5, 9 + bob, 2.6, 3.0, k, 'body', tones=(1, 2, 3))
    # bald pinkish head with red eyes, hooked beak
    B(f, cx + 0.5, 4.6 + bob, 1.8, 1.8, '#e8a0a0', 'head', tones=(1, 2, 3))
    # neck ruff
    for x in range(cx - 1, cx + 3):
        P(f, x, 6 + bob, '#f4f0ea', 2, 'ruff')
    P(f, cx, 4 + bob, '#ff3048', 3, 'eyes')
    P(f, cx + 1, 4 + bob, '#ff3048', 3, 'eyes')
    P(f, cx + 2, 5 + bob, '#d8b060', 2, 'beak')
    P(f, cx + 2, 6 + bob, '#d8b060', 1, 'beak')
    img = render(f)
    # "50x" liquidation: red down arrow under it
    for (x, y) in ((cx, 14), (cx + 1, 14), (cx, 15) if False else (cx - 1, 13), (cx + 2, 13)):
        pass
    return halo(img, (255, 48, 72), cx, 4.5 + bob, 3.0, 50)


# G537 ------------------------------------------------------------ Space Monke
def space_monke(t):
    W, H = 18, 18
    f = frame(W, H)
    bob = BOB[t]
    b = '#8a5636'
    # body in a little white suit
    B(f, 9, 13.5 + bob, 3.8, 3.2, '#e8e6f0', 'suit', tones=(1, 2, 3))
    P(f, 9, 13 + bob, '#3a7aff', 2, 'patch')
    P(f, 10, 13 + bob, '#e8304a', 2, 'patch')
    # monke head inside the helmet
    B(f, 4.6, 7.4 + bob, 1.1, 1.1, '#d8a876', 'ear', tones=(1, 2))
    B(f, 13.4, 7.4 + bob, 1.1, 1.1, '#d8a876', 'ear', tones=(2, 3))
    B(f, 9, 7.6 + bob, 4.0, 3.4, b, 'head')
    B(f, 8.4, 8.4 + bob, 1.5, 1.6, '#e8bc8a', 'face', tones=(2, 3))
    B(f, 10.6, 8.4 + bob, 1.5, 1.6, '#e8bc8a', 'face', tones=(2, 3))
    B(f, 9.5, 9.8 + bob, 2.2, 1.2, '#e8bc8a', 'face', tones=(2, 3))
    eye(f, 8, 7 + bob, blink=(t == 3))
    eye(f, 11, 7 + bob, blink=(t == 3))
    P(f, 9, 10 + bob, '#8a5636', 0, 'mouth')
    P(f, 10, 10 + bob, '#8a5636', 0, 'mouth')
    img = render(f)
    # round glass helmet drawn over: rim + glass tint + glint
    hel = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hp = hel.load()
    cx, cy, r = 9, 7.6 + bob, 6.4
    for y in range(H):
        for x in range(W):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if r - 1 <= d < r:
                hp[x, y] = (220, 240, 255, 255) if (x < cx and y < cy) else (150, 190, 230, 255)
            elif d < r - 1 and img.getpixel((x, y))[3] == 0:
                hp[x, y] = (170, 220, 255, 70)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(hel)
    out.alpha_composite(img)
    out = __import__('pets_lib').ink_outline(out)
    # glints
    dot(out, 6, 3 + bob, (255, 255, 255), 255, over=True)
    dot(out, 5, 4 + bob, (255, 255, 255), 200, over=True)
    if t == 1:
        spark(out, 16, 2, (255, 248, 196))
    if t == 3:
        dot(out, 1, 14, (255, 248, 196), 220)
    return out


# G538 ------------------------------------------------------------ Nugget Golem
def nugget_golem(t):
    f = frame(16, 17)
    g = '#8e8ca0'
    stomp = (0, 0, 1, 0)[t]
    # legs
    box(f, 4, 13, 6, 16, g, 'leg', rnd=False, lit=2, mid=1, dk=0)
    box(f, 9, 13 - stomp, 11, 16 - stomp, g, 'leg', rnd=False, lit=2, mid=1, dk=0)
    # chunky body block
    box(f, 3, 6, 12, 13, g, 'body', rnd=True)
    # head block
    box(f, 5, 1, 11, 6, g, 'head', rnd=True)
    # arms
    box(f, 1, 7, 2, 12, g, 'arm', rnd=True, lit=2, mid=1, dk=0)
    box(f, 13, 7, 14, 12, g, 'arm', rnd=True)
    # gold vein zigzag down the body
    vein = [(4, 7), (5, 8), (6, 8), (7, 9), (8, 10), (9, 10), (10, 11), (11, 12), (6, 2), (7, 3), (7, 4)]
    for (x, y) in vein:
        P(f, x, y, '#f6bc36', 3 if (x + y + t) % 3 == 0 else 2, 'vein')
    # cyan eyes
    P(f, 8, 3, '#3de0c8', 3, 'eyes')
    P(f, 10, 3, '#3de0c8', 3, 'eyes')
    # chips/cracks
    P(f, 11, 8, g, 0, 'crack')
    P(f, 4, 11, g, 0, 'crack')
    img = render(f)
    if t == 1:
        spark(img, 8, 9, (255, 230, 120), over=True)
    return img


# G539 ------------------------------------------------------------ Frozen Block Sloth
def frozen_block_sloth(t):
    f = frame(18, 19)
    sw = (0, 0, 1, 0)[t]
    g = '#a8946e'
    # long arms reaching up and out to the block's corners
    CAP(f, (5, 10), (3, 4), 1.0, g, 'arm', tones=(1, 2, 3))
    CAP(f, (12, 10), (14, 4), 1.0, g, 'arm', tones=(1, 2, 3))
    # body hanging
    B(f, 8.5 + sw * 0.3, 13, 4.0, 4.4, g, 'body', tones=(1, 2, 2, 3))
    # round head below the block
    B(f, 8.5 + sw * 0.3, 9.2, 3.2, 2.8, g, 'head', tones=(1, 2, 3))
    # pale face with dark eye patches (classic sloth mask)
    B(f, 8.5 + sw * 0.3, 9.6, 2.4, 1.9, '#f0e4cc', 'face', tones=(2, 3))
    x0 = int(8.5 + sw * 0.3)
    for (dx, dy) in ((-2, 0), (-1, 0), (-2, 1), (1, 0), (2, 0), (2, 1)):
        P(f, x0 + dx, 9 + dy, '#5a4030', 1, 'patch')
    if t != 2:
        f.put(x0 - 1, 9, 'eye', 0, 'eyes')
        f.put(x0 + 1, 9, 'eye', 0, 'eyes')
    P(f, x0, 10, '#3a2a20', 0, 'nose')
    P(f, x0, 11, '#c89a7a', 1, 'smile')
    # legs dangling
    P(f, 6, 17, g, 1, 'leg')
    P(f, 11, 17, g, 1, 'leg')
    # icy blue block on top (over the claws)
    box(f, 1, 0, 16, 4, '#8ad8ff', 'ice', rnd=False)
    for (x, y) in ((2, 1), (3, 1), (2, 2), (4, 1)):
        P(f, x, y, '#e8f8ff', 4, 'ice')
    LN(f, (9, 1), (10, 3), '#4a9ad0', 1, 'crack')
    LN(f, (10, 3), (12, 3), '#4a9ad0', 1, 'crack')
    for x in (3, 14):
        P(f, x, 4, '#3a2a20', 1, 'claw')
        P(f, x - 1 if x < 9 else x + 1, 4, '#3a2a20', 1, 'claw')
    for x in (6, 11, 15):
        P(f, x, 5, '#bce8ff', 3, 'icicle')
    img = render(f)
    if t == 3:
        dot(img, 17, 6, (200, 240, 255), 220)
    return img


# G540 ------------------------------------------------------------ Kancil Trickster
def kancil(t):
    f = frame(16, 17)
    b = '#b0763c'
    tw = (0, 1, 0, 0)[t]
    # thin legs: far legs darker, near legs lit, hooves
    for (x, tone) in ((4, 1), (11, 1)):
        LN(f, (x, 11), (x, 15), '#6a3a1a', tone, 'legb')
    for (x, tone) in ((6, 2), (13, 2)):
        LN(f, (x, 11), (x, 15), '#8a5a2e', tone, 'leg')
    for x in (4, 6, 11, 13):
        P(f, x, 16, '#2a1a14', 1, 'hoof')
    B(f, 8.5, 9.6, 5.0, 2.6, b, 'body', tones=(1, 2, 2, 3))
    for x in range(5, 12):
        P(f, x, 11, '#f4ead8', 2, 'belly')
    CAP(f, (11.5, 8), (12.5, 5), 1.4, b, 'neck', tones=(1, 2, 3))
    B(f, 13, 4, 2.2, 1.8, b, 'head', tones=(1, 2, 3, 4))
    P(f, 14, 6, '#f4ead8', 3, 'chin')
    P(f, 13, 6, '#f4ead8', 2, 'chin')
    P(f, 12, 7, '#f4ead8', 2, 'chin')
    P(f, 15, 4, '#2a1a14', 1, 'nose')
    P(f, 11, 1 + tw, b, 3, 'ear')
    P(f, 12, 2, b, 2, 'ear')
    P(f, 11, 2 + tw, '#ffaabf', 2, 'ear')
    eye(f, 13, 3, blink=(t == 2))
    P(f, 3, 8, '#f4ead8', 3, 'tail')
    return render(f)


# G541 ------------------------------------------------------------ Smelter Salamander
def smelter_salamander(t):
    f = frame(21, 10)
    r = '#d8302a'
    wag = (0, 1, 0, -1)[t]
    pts = [(1, 6 + wag), (3, 6 + wag * 0.5), (5, 6.6), (7, 6.6)]
    for a, b in zip(pts, pts[1:]):
        CAP(f, a, b, 0.7 + (a[0] / 9), r, 'tail', tones=(1, 2, 3))
    CAP(f, (6, 6.2), (13, 6.0), 2.1, r, 'body', tones=(1, 2, 3))
    B(f, 15.4, 5.4, 2.8, 2.1, r, 'head', tones=(1, 2, 3, 4))
    for x, ph in ((7, 0), (12, 1)):
        dx = (0, 1)[(t + ph) % 2]
        P(f, x + dx, 9, r, 1, 'leg')
        P(f, x, 8, r, 1, 'leg')
    # glowing orange back stripes, pulse
    glow = (3, 4, 3, 2)[t]
    for x in range(3, 15):
        if x % 2 == 0:
            P(f, x, 4 if x > 4 else 5, '#ff9a2a', glow, 'stripe')
    eye(f, 16, 4, blink=(t == 3))
    blush(f, 17, 6)
    img = __import__('pets_lib').pad(render(f), 21, 14, 0, 3)
    for i, x in enumerate((5, 9, 13)):
        y = (2, 1, 0, -1)[(t + i) % 4]
        if y >= 0:
            dot(img, x, y, (255, 190, 80), 220)
    return halo(img, (255, 170, 60), 10, 8, 8 + glow * 0.4, 60 + glow * 18)


# G542 ------------------------------------------------------------ Origami Fox
def origami_fox(t):
    f = frame(18, 16)
    w = '#f6f4ee'
    ear = (0, 1, 0, 0)[t]
    flut = (0, 1, 0, -1)[t]
    # tail: big folded triangle
    poly(f, [(5, 12), (1, 4 + flut), (6, 9)], w, 2, 'tail', shade=lambda x, y: 3 if x < 3 else 2)
    poly(f, [(1, 4 + flut), (3, 3 + flut), (2, 6 + flut)], '#e8e4ec', 3, 'tailtip')
    # body: angular trapezoid with a crease
    poly(f, [(4, 9), (12, 8), (13, 15), (5, 15)], w, 2, 'body',
         shade=lambda x, y: 3 if x < 7 else 2 if x < 10 else 1)
    LN(f, (8, 9), (9, 15), '#c8c4d0', 1, 'crease')
    # head: triangle snout pointing right, two pointy ears
    poly(f, [(10, 3), (17, 7), (10, 9)], w, 2, 'head', shade=lambda x, y: 3 if y < 6 else 1)
    poly(f, [(10, 3), (11, 0 + ear), (13, 4)], w, 3, 'ear')
    poly(f, [(12, 4), (14, 1), (15, 5)], '#d8d4e0', 2, 'ear2')
    LN(f, (10, 6), (17, 7), '#c8c4d0', 1, 'crease')
    P(f, 17, 7, '#3a2a30', 1, 'nose')
    f.put(13, 5, 'eye', 0, 'face') if t != 2 else P(f, 13, 6, '#3a2a30', 1, 'face')
    # legs (folded strips)
    for x in (6, 11):
        LN(f, (x, 14), (x, 15), '#d8d4e0', 2, 'leg')
    img = render(f)
    return img


# G543 ------------------------------------------------------------ Survivor Roach
def survivor_roach(t):
    f = frame(19, 12)
    br = '#8a4a24'
    for i, x in enumerate((4, 7, 10)):
        dx = (0, 1)[(t + i) % 2]
        LN(f, (x, 8), (x - 1 + dx * 2, 11), '#5a2e14', 2, 'leg')
    B(f, 7.5, 7, 6.2, 3.0, br, 'shell', tones=(1, 2, 2, 3, 4))
    LN(f, (8, 4), (8, 10), br, 0, 'seam')
    P(f, 4, 5, br, 4, 'shell')
    # head with white bandage
    B(f, 14.4, 7, 2.0, 1.8, '#5a2e14', 'head', tones=(1, 2, 3))
    for (x, y) in ((13, 5), (14, 5), (15, 5), (14, 6)):
        P(f, x, y, '#f6f2ea', 2 if y == 5 else 1, 'bandage')
    P(f, 14, 5, '#e8303a', 1, 'cross') if False else None
    # bandage cross on the shell too
    for (x, y) in ((5, 6), (6, 6), (5, 7), (6, 7)):
        P(f, x, y, '#f6f2ea', 3 if y == 6 else 2, 'plaster')
    f.put(15, 7, 'white', 1 if t != 3 else 0, 'face')
    # long twitching antennae
    a = (0, 1, 0, -1)[t]
    LN(f, (15, 6), (18, 1 + a), '#5a2e14', 2, 'ant')
    LN(f, (16, 6), (18, 4 - a), '#5a2e14', 2, 'ant') if False else LN(f, (16, 7), (18, 5 - (a > 0)), '#5a2e14', 2, 'ant')
    img = render(f)
    spark(img, 3, 3, (255, 240, 200)) if t == 0 else None
    return img


# G544 ------------------------------------------------------------ Seeker Owl
def seeker_owl(t):
    f = frame(15, 17)
    k = '#2a2436'
    B(f, 7, 11, 5.0, 5.0, k, 'body', tones=(1, 2, 2, 3))
    for y in range(9, 15):
        P(f, 2, y, k, 1, 'wing')
        P(f, 12, y, k, 0, 'wing')
    P(f, 3, 3, k, 3, 'tuft')
    P(f, 11, 3, k, 2, 'tuft')
    # head is a teal screen
    box(f, 2, 3, 12, 9, '#3de0c8', 'screen', rnd=True, lit=3, mid=2, dk=1)
    # pixel eyes (square), blink
    for ex in (4, 8):
        if t == 3:
            P(f, ex, 6, '#0a4a44', 0, 'pix')
            P(f, ex + 1, 6, '#0a4a44', 0, 'pix')
        else:
            for (dx, dy) in ((0, 0), (1, 0), (0, 1), (1, 1)):
                P(f, ex + dx, 5 + dy, '#0a4a44', 0, 'pix')
            P(f, ex + 1, 5, '#e8fff8', 4, 'pix')
    P(f, 7, 8, '#ffb020', 3, 'beak')
    # chest notification badge
    if t in (1, 2):
        P(f, 7, 11, '#ff3048', 2, 'badge')
        P(f, 8, 11, '#ff3048', 2, 'badge')
    for x in (5, 9):
        P(f, x, 16, '#ffb020', 2, 'foot')
        P(f, x + 1, 16, '#ffb020', 1, 'foot')
    img = render(f)
    return halo(img, (61, 224, 200), 7, 6, 7.5, 70)


# G545 ------------------------------------------------------------ Snipe Drone
def snipe_drone(t):
    W, H = 20, 16
    f = frame(W, H)
    bob = BOB[t]
    g = '#8e92a4'
    cy = 5 + bob
    # arms + rotors
    for x0 in (2, 14):
        LN(f, (x0 + 2, cy), (10 if x0 < 10 else 10, cy + 1), '#6a6e80', 2, 'arm')
    B(f, 10, cy + 1.4, 3.6, 2.2, g, 'body', tones=(1, 2, 3, 4))
    # camera eye with red light
    P(f, 10, cy + 3, '#2a2430', 1, 'cam')
    P(f, 11, cy + 3, '#ff3048', 3, 'lens')
    P(f, 9, cy, '#c4c8d4', 4, 'body')
    # rotor blades blur: alternating long/short
    for x0 in (1, 13):
        L = 6 if t % 2 == 0 else 4
        off = 0 if t % 2 == 0 else 1
        for x in range(x0 + off, x0 + off + L):
            P(f, x, cy - 1, '#c4c8d4', 3 if x % 2 else 2, 'rotor')
        P(f, x0 + 3, cy, '#4a4858', 1, 'hub')
    # legs
    P(f, 8, cy + 4, '#6a6e80', 1, 'skid')
    P(f, 12, cy + 4, '#6a6e80', 1, 'skid')
    img = render(f)
    # red laser to the ground with a dot sweeping
    gx = (6, 9, 13, 9)[t]
    for (x, y) in __import__('pets_lib').bresenham((11, cy + 4), (gx, H - 1)):
        dot(img, x, y, (255, 48, 72), 150)
    for (dx, dy, a) in ((0, 0, 255), (-1, 0, 150), (1, 0, 150), (0, -1, 120)):
        dot(img, gx + dx, H - 1 + dy, (255, 90, 100), a, over=True)
    return img


# G546 ------------------------------------------------------------ Whale Calf Bubble
def whale_bubble(t):
    W, H = 20, 20
    f = frame(W, H)
    bob = BOB[t]
    bl = '#3a7aff'
    cy = 10.5 + bob
    # whale calf
    B(f, 10.8, cy + 0.3, 4.8, 3.4, bl, 'whale', tones=(1, 2, 2, 3))
    # pale belly with throat grooves
    B(f, 11.6, cy + 2.3, 3.4, 1.3, '#c8e4ff', 'belly', tones=(2, 3))
    for x in (9, 11, 13):
        P(f, x, int(cy) + 3, '#8ab8ff', 1, 'groove')
    # tail flukes on the left
    flk = (0, 1, 0, -1)[t]
    poly(f, [(7, cy), (4, cy - 3 + flk), (3, cy - 1 + flk), (5, cy + 1)], bl, 2, 'fluke')
    poly(f, [(7, cy + 1), (4, cy + 3 + flk), (3, cy + 2 + flk)], bl, 1, 'fluke')
    eye(f, 13, int(cy) - 1)
    blush(f, 14, int(cy))
    # flipper
    P(f, 9, int(cy) + 3, '#2a5acc', 1, 'flip')
    P(f, 8, int(cy) + 4, '#2a5acc', 1, 'flip')
    img = render(f)
    # spout puffs
    if t in (1, 2):
        sy = int(cy) - 5 - (t - 1)
        for (dx, dy) in ((0, 0), (-1, -1), (1, -1), (0, 1)):
            dot(img, 11 + dx, sy + dy, (200, 235, 255), 230)
    # clear bubble around it: a ring + glint
    bub = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    bp = bub.load()
    cx, cyy, r = 10, 10.0 + bob, 9.0
    for y in range(H):
        for x in range(W):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cyy)
            if r - 1 <= d < r:
                bp[x, y] = (210, 240, 255, 220 if (x < cx and y < cyy) else 150)
            elif d < r - 1:
                bp[x, y] = (150, 210, 255, 40)
    bub.alpha_composite(img)
    dot(bub, 5, 3 + bob, (255, 255, 255), 255, over=True)
    dot(bub, 4, 4 + bob, (255, 255, 255), 220, over=True)
    dot(bub, 6, 3 + bob, (255, 255, 255), 170, over=True)
    return bub


ITEMS_RARE = {
    'G528': lambda t: C.pet_sprite(t),
    'G529': mini_mole_king,
    'G530': gem_shell_turtle,
    'G531': broom_ferret,
    'G532': frog_prince,
    'G533': galaxy_jelly,
    'G534': hollow_wisp,
    'G535': hopium_balloon,
    'G536': margin_vulture,
    'G537': space_monke,
    'G538': nugget_golem,
    'G539': frozen_block_sloth,
    'G540': kancil,
    'G541': smelter_salamander,
    'G542': origami_fox,
    'G543': survivor_roach,
    'G544': seeker_owl,
    'G545': snipe_drone,
    'G546': whale_bubble,
}

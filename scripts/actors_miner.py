"""The miner: a bearded kampung pak cik in overalls and a white singlet.

Side view, facing right. Every frame is posed from a small rig (feet, hands,
torso offset, head offset, pick head joint + direction) and painted into an
actors_kit.Frame so the overalls and the pick head come out as separate masks.
The head is hand-pixelled; limbs, torso and pick are drawn from the rig.
"""
import math

from actors_kit import Frame, RAMPS, bresenham

W, H = 20, 26
GROUND = 25            # sole row
AX, AY = 10, 25        # feet anchor (bottom centre, on the sole row)
PICK_LEN = 9.0         # head joint to butt
PICK_R = 3.7           # half length of the pick head

# ---------------- head (hand pixelled) ----------------
# 12 wide. Row 0 is the top of the skull; the hat covers roughly rows 0-3.
HEAD = [
    "....hhhh....",
    "..hhHHHHhh..",
    ".hHHHJJJHHh.",
    ".hHHHHHHHHh.",
    ".hHHsSSLLLL.",
    ".hHsSSbbbSL.",
    ".hsdsBSwESLl",
    ".hssBSSsESlL",
    "..sBBSSBBBs.",
    "..bBBCBBBBBb",
    "...bBCBBBCb.",
    "....bbBBBb..",
]
HEAD_LEGEND = {
    'h': ('hair', 0), 'H': ('hair', 1), 'J': ('hair', 2),
    'd': ('skin', 0), 's': ('skin', 1), 'S': ('skin', 2), 'L': ('skin', 3), 'l': ('skin', 4),
    'b': ('beard', 0), 'B': ('beard', 1), 'C': ('beard', 2), 'g': ('beard', 3), 'G': ('beard', 4),
    'E': ('eye', 0), 'e': ('eye', 0), 'w': ('white', 0),
    'm': ('mouth', 0), 'M': ('mouth', 1), 't': ('mouth', 2),
}
# The girl miner: the same skull, helmet line and eye, a clean jaw instead of the beard,
# and a ponytail (HAIR_TAIL) hanging behind the head, tied with a red band.
HEAD_F = [
    "....hhhh....",
    "..hhHHHHhh..",
    ".hHHHJJJHHh.",
    ".hHHHHHHHHh.",
    ".hHHsSSLLLL.",
    ".hHsSSSSSSL.",
    ".hsdsSSwESLl",
    ".hssSSSsESlL",
    "..sSSSSSSLs.",
    "..sSSSSSSSL.",
    "...sSSSSLs..",
    ".....sSSs...",
]
HAIR_TAIL = [
    "..hh",
    ".hHH",
    "hHHh",
    "hHJh",
    "hHHh",
    "hHHh",
    ".hHh",
    "..hh",
]
HEAD_W = len(HEAD[0])
HEAD_TOP_CX = 6        # skull-top centre column within the stamp
EYE = (8, 6)           # upper eye pixel within the stamp (2 px tall)


def draw_head(f, ox, oy, eyes='open', mouth=None, female=False):
    if female:
        f.stamp(HAIR_TAIL, ox - 3, oy + 3, HEAD_LEGEND, part='head')
        f.put(ox - 1, oy + 4, 'red', 2, 'head')  # hair band
        f.stamp(HEAD_F, ox, oy, HEAD_LEGEND, part='head')
    else:
        f.stamp(HEAD, ox, oy, HEAD_LEGEND, part='head')
    ex, ey = ox + EYE[0], oy + EYE[1]
    if eyes != 'open':
        f.put(ex - 1, ey, 'skin', 2, 'head')
    if eyes == 'blink':
        f.put(ex, ey, 'skin', 2, 'head')
        f.put(ex, ey + 1, 'skin', 0, 'head')
        f.put(ex - 1, ey + 1, 'skin', 0, 'head')
    elif eyes == 'happy':
        f.put(ex, ey, 'eye', 0, 'head')
        f.put(ex - 1, ey + 1, 'eye', 0, 'head')
        f.put(ex + 1, ey + 1, 'skin', 1, 'head')
        f.put(ex, ey + 1, 'skin', 2, 'head')
    elif eyes == 'squint':
        f.put(ex, ey, 'skin', 1, 'head')
        f.put(ex, ey + 1, 'eye', 0, 'head')
    if mouth == 'open':
        for dx, dy, r, t in ((7, 9, 'mouth', 0), (8, 9, 'mouth', 0), (9, 9, 'mouth', 0),
                             (8, 10, 'mouth', 2), (7, 10, 'mouth', 1)):
            f.put(ox + dx, oy + dy, r, t, 'head')
    elif mouth == 'grit':
        f.put(ox + 8, oy + 9, 'white', 0, 'head')
        f.put(ox + 9, oy + 9, 'white', 0, 'head')


# ---------------- boots ----------------
BOOT = [
    ".cBB.",
    "cBBBb",
    "aaaaa",
]
BOOT_LEGEND = {'a': ('boot', 0), 'b': ('boot', 1), 'B': ('boot', 2), 'c': ('boot', 3)}


def draw_boot(f, ax, ay, part, dark=0, lift=False):
    """ax, ay: ankle point; the boot's sole sits on row ay+1, toe to the right."""
    ox, oy = int(round(ax)) - 1, int(round(ay)) - 1
    for j, row in enumerate(BOOT):
        for i, ch in enumerate(row):
            if ch == '.':
                continue
            r, t = BOOT_LEGEND[ch]
            if lift and j == 2 and i == 4:
                continue
            f.put(ox + i, oy + j, r, max(0, t - dark), part)


# ---------------- limbs ----------------
UPPER, FORE = 3.2, 3.4


def elbow(s, h, bend=1):
    """2-bone IK. bend=+1 puts the elbow below/behind the shoulder-hand line."""
    dx, dy = h[0] - s[0], h[1] - s[1]
    d = math.hypot(dx, dy)
    d = max(0.5, min(d, UPPER + FORE - 0.05))
    a = math.acos(max(-1, min(1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d))))
    base = math.atan2(dy, dx)
    ang = base + a * bend
    return (s[0] + math.cos(ang) * UPPER, s[1] + math.sin(ang) * UPPER)


def draw_leg(f, hip, ankle, part, dark=0):
    f.capsule(hip, (ankle[0] - 0.2, ankle[1] - 1.4), 1.45, 'fit', (2 - dark, 2 - dark, 2 - dark), part)
    draw_boot(f, ankle[0], ankle[1], part + '-boot', dark, lift=ankle[1] < GROUND - 1)


def draw_arm(f, shoulder, hand, part, dark=0, bend=1):
    e = elbow(shoulder, hand, bend)
    t = 2 - dark
    # short white sleeve on the upper arm, bare forearm
    mid = (shoulder[0] + (e[0] - shoulder[0]) * 0.55, shoulder[1] + (e[1] - shoulder[1]) * 0.55)
    f.capsule(e, hand, 0.95, 'skin', (t, t, t), part)
    f.capsule(shoulder, e, 1.1, 'skin', (t, t, t), part)
    hx, hy = int(math.floor(hand[0] - 0.5)), int(math.floor(hand[1] - 0.5))
    for (dx, dy, tt) in ((0, 0, 3), (1, 0, 3), (0, 1, 2), (1, 1, 1)):
        f.put(hx + dx, hy + dy, 'skin', tt - dark, part + '-hand')
    return e


# ---------------- torso ----------------
TORSO = {
    0: [(1, 7), (0, 8), (0, 9), (0, 10), (0, 10), (0, 10), (1, 9), (1, 8)],
    1: [(1, 8), (0, 9), (0, 10), (0, 11), (0, 11), (1, 10), (1, 9)],
}


def draw_torso(f, cx, cy, squash=0):
    """Round pak cik body: white singlet on top, overalls from the chest down."""
    spans = TORSO[squash]
    x0 = int(round(cx)) - 4
    y0 = int(round(cy)) - 4 + squash
    for j, (a, b) in enumerate(spans):
        for i in range(a, b + 1):
            vest = (j <= 2 and i < 5) or (j <= 1 and i >= 5)
            strap = i == 2 and j <= 2
            if vest and not strap:
                f.put(x0 + i, y0 + j, 'vest', 2, 'torso')
            else:
                f.put(x0 + i, y0 + j, 'fit', 2, 'torso')
    f.bevel(['torso'])
    # belly sheen and the round underside
    f.shift_tone(x0 + 6, y0 + 3, 1)
    f.shift_tone(x0 + 7, y0 + 3, 1)
    last = len(spans) - 1
    for i in range(spans[last][0], spans[last][1] + 1):
        pass
    # bib: gold button, pocket seam, stitch at the waist
    f.detail[(x0 + 5, y0 + 3)] = (26, 16, 44, 60)
    for i in range(6, 9):
        f.detail[(x0 + i, y0 + 4)] = (26, 16, 44, 90)
    f.detail[(x0 + 6, y0 + 5)] = (26, 16, 44, 50)
    f.detail[(x0 + 4, y0 + last)] = (26, 16, 44, 120)
    f.detail[(x0 + 4, y0 + last - 1)] = (26, 16, 44, 70)


# ---------------- pick ----------------
def draw_pick(f, grip, J, part='pick', buried=None, butt_extra=1.2):
    """Handle from just behind the grip to the head joint J, head across it.
    The head is rasterised in the handle's own frame (u along the handle, v across)
    so it stays a clean tapered crescent at every angle."""
    dx, dy = J[0] - grip[0], J[1] - grip[1]
    n = math.hypot(dx, dy) or 1
    d = (dx / n, dy / n)
    pv = (-d[1], d[0])
    butt = (grip[0] - d[0] * butt_extra, grip[1] - d[1] * butt_extra)
    for i, (x, y) in enumerate(bresenham(butt, (J[0] - d[0] * 0.5, J[1] - d[1] * 0.5))):
        if buried is not None and y > buried:
            continue
        f.put(x, y, 'wood', 3 if i % 4 == 1 else 2, part + '-handle')
    R = PICK_R
    cells = []
    for y in range(int(J[1] - R) - 2, int(J[1] + R) + 3):
        for x in range(int(J[0] - R) - 2, int(J[0] + R) + 3):
            qx, qy = x + 0.5 - J[0], y + 0.5 - J[1]
            u = qx * d[0] + qy * d[1]
            v = qx * pv[0] + qy * pv[1]
            if abs(v) > R + 0.2:
                continue
            k = abs(v) / R
            mid = -0.06 * v * v + 0.5           # droops toward the handle at the tips
            th = 1.55 - 1.05 * k                 # half thickness, tapering to a point
            if abs(u - mid) <= th:
                cells.append((x, y, u - mid, v))
    for (x, y, uu, v) in cells:
        if buried is not None and y > buried:
            continue
        f.put(x, y, 'pick', 2, part)
    # the tips must survive rasterising
    for s in (-1, 1):
        tx = J[0] + pv[0] * R * s - d[0] * (0.06 * R * R - 0.5)
        ty = J[1] + pv[1] * R * s - d[1] * (0.06 * R * R - 0.5)
        if buried is None or ty <= buried:
            f.put(tx, ty, 'pick', 2, part)
    # shading: the face toward the light is bright, the other side dark
    lit = -(d[0] * -0.62 + d[1] * -0.78)   # >0 when the +u face points at the light
    for y in range(f.h):
        for x in range(f.w):
            p = f.get(x, y)
            if not p or p[3] != part:
                continue
            up = f.part_at(x - 1, y) != part or f.part_at(x, y - 1) != part
            dn = f.part_at(x + 1, y) != part or f.part_at(x, y + 1) != part
            if up and not dn:
                p[2] = 3
            elif dn and not up:
                p[2] = 1
            elif up and dn:
                p[2] = 2
    gx, gy = J[0] - pv[0] * 1.0 - d[0] * 0.2, J[1] - pv[1] * 1.0 - d[1] * 0.2
    if f.part_at(int(gx), int(gy)) == part:
        f.get(int(gx), int(gy))[2] = 4
    # dark collar where the handle enters the head
    cx, cy = int(math.floor(J[0] - d[0] * 0.6)), int(math.floor(J[1] - d[1] * 0.6))
    if f.part_at(cx, cy) in (part, part + '-handle'):
        f.put(cx, cy, 'wood', 0, part + '-handle')
    return d


# ---------------- poses ----------------
REST_TORSO = (9.4, 16.8)
REST_HEAD = (4, 3)
POSES = {'idle': 180, 'walk': 100, 'swing': 90, 'cheer': 120, 'carry': 110}
HIT = 3
SHOULDER_GRIP = (12.2, 17.0)
SHOULDER_J = (3.4, 13.0)


def shoulders(body):
    bx, by = REST_TORSO[0] + body[0], REST_TORSO[1] + body[1]
    return (bx - 1.4, by - 3.2), (bx + 0.2, by - 3.1)


def hips(body):
    bx, by = REST_TORSO[0] + body[0], REST_TORSO[1] + body[1]
    return (bx - 1.4, by + 2.8), (bx + 1.0, by + 2.8)


def pose_frames():
    P = {}

    def shoulder_pick(b):
        return dict(grip=(SHOULDER_GRIP[0], SHOULDER_GRIP[1] + b), J=(SHOULDER_J[0], SHOULDER_J[1] + b), z='front')

    # idle: pick on the near shoulder, slow breath, a blink on frame 2
    idle = []
    for t, (dy, eyes) in enumerate(((0, 'open'), (0, 'open'), (1, 'blink'), (1, 'open'))):
        idle.append(dict(body=(0, dy), head=(0, 0), eyes=eyes, feet=((8, 24), (11, 24)),
                         back=(6.6, 19.5 + dy * 0.5), **shoulder_pick(dy)))
    P['idle'] = idle
    # walk: contact / down / pass for each foot
    legs = [((6, 24), (13, 24)), ((7, 23), (12, 24)), ((9, 22), (10, 24)),
            ((13, 24), (6, 24)), ((12, 24), (7, 23)), ((10, 24), (9, 22))]
    bob = [0, 1, 0, 0, 1, 0]
    bh = [(11.0, 19.5), (9.5, 20), (7.5, 20), (4.8, 19), (5.5, 19.5), (7.5, 20)]
    P['walk'] = [dict(body=(0, bob[t]), head=(0, 0), eyes='open', feet=legs[t],
                      back=(bh[t][0], bh[t][1] + bob[t]), **shoulder_pick(bob[t])) for t in range(6)]
    # swing
    P['swing'] = [
        # 0 anticipation: sink, lean back, pick drawn back low behind the hip
        dict(body=(-1, 1), squash=1, head=(-1, 0), eyes='squint', feet=((7, 24), (12, 24)),
             back=(6.8, 15.0), grip=(7.6, 15.6), J=(0.9, 13.4), z='mid', armz='back'),
        # 1 raise: up on the toes, pick cocked back behind the head
        dict(body=(-1, -1), head=(-1, -1), eyes='squint', mouth='grit', feet=((7, 24), (12, 23)),
             back=(6.8, 9.6), grip=(7.4, 9.4), J=(0.9, 7.2), z='mid', armz='back'),
        # 2 strike: whipped over the top, pick head up front (drawn over the hat)
        dict(body=(1, 0), head=(1, 0), eyes='squint', mouth='grit', feet=((7, 24), (12, 24)),
             back=(14.8, 10.4), grip=(15.6, 10.0), J=(18.0, 2.8), z='front', armz='back', smear=True),
        # 3 impact: squash, handle level, the lower tip buried in the ground
        dict(body=(1, 1), squash=1, head=(1, 1), eyes='squint', mouth='grit', feet=((7, 24), (12, 24)),
             back=(11.8, 19.0), grip=(12.8, 19.4), J=(17.6, 21.0), z='front', buried=GROUND - 1, dust=True),
        # 4 recoil: the pick bounces up out of the dirt
        dict(body=(1, 0), head=(0, 0), eyes='open', feet=((7, 24), (12, 24)),
             back=(12.0, 17.0), grip=(13.0, 17.2), J=(17.8, 16.6), z='front'),
        # 5 recover: stand tall, pick level at the waist, ready to go again
        dict(body=(0, 0), head=(0, 0), eyes='open', feet=((7, 24), (12, 24)),
             back=(10.4, 16.4), grip=(11.2, 16.6), J=(18.0, 15.4), z='front'),
    ]
    # cheer: crouch, jump, peak, land. Pick thrust up, other fist pumping.
    P['cheer'] = [
        dict(body=(0, 1), squash=1, head=(0, 0), eyes='happy', mouth='open', feet=((8, 24), (11, 24)),
             back=(3.6, 15.0), grip=(15.6, 12.2), J=(18.2, 5.4), z='front', armz='back'),
        dict(body=(0, -2), head=(0, 0), eyes='happy', mouth='open', feet=((8, 22), (11, 22)),
             back=(2.8, 10.0), grip=(15.4, 9.0), J=(17.8, 2.6), z='front', armz='back'),
        dict(body=(0, -2), head=(0, -1), eyes='happy', mouth='open', feet=((8, 21), (12, 21)),
             back=(2.6, 8.8), grip=(15.4, 8.2), J=(17.6, 2.0), z='front', armz='back'),
        dict(body=(0, 1), squash=1, head=(0, 0), eyes='happy', mouth='open', feet=((7, 24), (12, 24)),
             back=(3.4, 14.0), grip=(15.6, 11.4), J=(18.2, 4.4), z='front', armz='back'),
    ]
    # carry: heavier walk, ore sack hung from the pick head behind the back
    cbob = [0, 1, 1, 0, 1, 1]
    sway = [0, 0.4, 0.8, 0, -0.4, -0.8]
    P['carry'] = [dict(body=(0, cbob[t]), head=(0, 0), eyes='open', feet=legs[t],
                       back=(bh[t][0], bh[t][1] + cbob[t]), sack=sway[t], **shoulder_pick(cbob[t]))
                  for t in range(6)]
    return P


def draw_sack(f, J, sway):
    cx, cy = J[0] - 0.4 + sway * 0.5, J[1] + 5.2
    f.blob(cx, cy, 3.4, 3.7, 'sack', (0, 1, 2, 3), 'sack')
    # gathered neck tied under the pick head
    for (dx, dy, r, t) in ((0, 1, 'sack', 2), (1, 1, 'sack', 1), (0, 2, 'red', 2), (1, 2, 'red', 1)):
        f.put(J[0] + dx, J[1] + dy, r, t, 'sack')
    # gold ore peeking from the top and a patch
    f.put(cx - 1.4, cy - 2.6, 'gold', 4, 'sack')
    f.put(cx - 2.4, cy - 1.8, 'gold', 3, 'sack')
    f.put(cx - 1.4, cy - 1.6, 'gold', 2, 'sack')
    f.put(cx + 0.6, cy + 0.6, 'sack', 0, 'sack')
    f.put(cx + 1.6, cy + 0.6, 'sack', 0, 'sack')
    f.put(cx + 0.6, cy + 1.6, 'sack', 0, 'sack')
    f.put(cx + 1.6, cy + 1.6, 'sack', 0, 'sack')


def draw_frame(p, female=False):
    f = Frame(W, H)
    body = p['body']
    squash = p.get('squash', 0)
    tcx, tcy = REST_TORSO[0] + body[0], REST_TORSO[1] + body[1] + squash * 0.5
    hb, hf = hips(body)
    sb, sf = shoulders(body)
    J, grip, z = p['J'], p['grip'], p['z']
    if 'sack' in p:
        draw_sack(f, J, p['sack'])
    draw_arm(f, sb, p['back'], 'arm-b', dark=1)
    draw_leg(f, hb, p['feet'][0], 'leg-b', dark=1)
    if z == 'mid':
        draw_pick(f, grip, J, buried=p.get('buried'))
    draw_torso(f, tcx, tcy, squash=squash)
    draw_leg(f, hf, p['feet'][1], 'leg-f')
    hx = REST_HEAD[0] + body[0] + p['head'][0]
    hy = REST_HEAD[1] + body[1] + p['head'][1] + squash
    armz = p.get('armz', 'front')
    if armz == 'back':
        if z == 'front':
            draw_pick(f, grip, J, buried=p.get('buried'))
        draw_arm(f, sf, grip, 'arm-f')
    draw_head(f, hx, hy, p.get('eyes', 'open'), p.get('mouth'), female)
    if armz == 'front':
        if z == 'front':
            draw_pick(f, grip, J, buried=p.get('buried'))
        draw_arm(f, sf, grip, 'arm-f')
    f.bevel(['leg-b', 'leg-f', 'arm-b', 'arm-f', 'arm-b-sleeve', 'arm-f-sleeve'])
    f.cast_shadows({('head', 'torso'), ('leg-f', 'leg-b'), ('pick-handle', 'torso'),
                    ('leg-f-boot', 'leg-b-boot'), ('torso', 'leg-f'), ('torso', 'leg-b')})
    front = ('arm-f', 'arm-f-sleeve', 'arm-f-hand')
    f.contour({(a, b) for a in front for b in ('torso', 'head', 'pick-handle', 'leg-f')}, 0)
    f.pick_ring = 'all' if z == 'front' else 'empty'
    if p.get('smear'):
        # pale arc trailing the pick head from behind the head over the top
        for (x, y, a) in ((19, 5, 150), (19, 6, 140), (19, 7, 120), (19, 8, 100), (18, 9, 80), (19, 9, 70),
                          (18, 10, 60), (18, 11, 40), (17, 12, 30)):
            f.extra.append((x, y, (255, 255, 255, a)))

    if p.get('dust'):
        for (x, y, a) in ((15, 24, 200), (16, 23, 150), (19, 23, 170), (19, 24, 210), (14, 22, 90), (18, 21, 120)):
            f.extra.append((x, y, (232, 206, 170, a)))
    return f, (hx + HEAD_TOP_CX, hy)


def build_miner():
    """Returns ({pose: [layers dict per frame]}, heads {pose: [[x, y]...]})."""
    frames, heads = {}, {}
    for pose, seq in pose_frames().items():
        frames[pose] = []
        heads[pose] = []
        for p in seq:
            f, ha = draw_frame(p)
            frames[pose].append(f.render())
            heads[pose].append([int(ha[0]), int(ha[1])])
    return frames, heads


def build_miner_f():
    """The girl miner's body layer per pose and frame: {pose: [base image]}. Her overalls, pick and hat layers
    are the boy's, so only the base (skin, hair, boots) is drawn again."""
    out = {}
    for pose, seq in pose_frames().items():
        out[pose] = []
        for p in seq:
            f, _ = draw_frame(p, True)
            out[pose].append(f.render()['base'])
    return out

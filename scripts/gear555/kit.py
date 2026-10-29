"""Gali Gear 555 drawing kit.

Runs the game's own miner rig (scripts/actors_miner.py) and dresses it:
  * head    : a Hat sprite (heads.py style), drawn after the body like the engine
  * top     : recolours the torso (and optional sleeves on the upper arms)
  * bottom  : recolours the legs (shorts leave skin below the knee)
  * shoe    : replaces the boot stamp
  * weapon  : replaces the pick (handle + head stamp in the handle's own frame)
  * pet     : standalone 4-frame sprite drawn with the same Frame kit

Every colour becomes a 5-tone ramp (dark..light) registered in RAMPS, so the
rig's own bevels, cast shadows and ink outline apply to gear for free.

Gear dict keys (all optional):
  head   = (img, ax, ay)
  top    = Top(...)
  bottom = Bottom(...)
  shoe   = Shoe(...)
  weapon = Weapon(...)
"""
import math
import sys

from PIL import Image

sys.path.insert(0, __import__('os').path.join(__import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..')), 'scripts'))
import actors_kit as AK  # noqa: E402
import actors_miner as AM  # noqa: E402

RAMPS = AK.RAMPS
INK = AK.INK
OX, OY = 10, 14          # extra margin around the 20x26 rig canvas
CW, CH = AM.W + 2 * OX, AM.H + OY + 4


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def ramp(col, dark=(40, 20, 50), light=(255, 252, 235)):
    if isinstance(col, str) and col in RAMPS:
        return col
    """Register (once) and return the name of a 5-tone ramp around a colour.
    col: '#rrggbb' or (r, g, b). Tone 2 is the colour itself."""
    c = hexrgb(col) if isinstance(col, str) else tuple(col)
    name = 'g%02x%02x%02x' % c
    if name not in RAMPS:
        RAMPS[name] = [mix(c, dark, 0.55), mix(c, dark, 0.28), c, mix(c, light, 0.42), mix(c, light, 0.78)]
    return name


# ---------------------------------------------------------------- outfit specs
class Top:
    """colour(lx, ly, tone) -> '#hex' | (r,g,b) | None (keep the rig's own pixel).
    Torso local coords: lx 0..10 left (back) to right (chest), ly 0..7 top to bottom.
    The chest print area is about lx 5..9, ly 2..5. sleeve: arm length covered
    from the shoulder (0 none, 2.5 short, 7 long); sleeve_colour(t, tone) with t 0..1 along it.
    back(f, P): optional extra drawing behind the body (capes, wings, tanks)."""

    def __init__(self, colour, sleeve=0.0, sleeve_colour=None, back=None, front=None):
        self.colour, self.sleeve, self.sleeve_colour, self.back, self.front = colour, sleeve, sleeve_colour, back, front


class Bottom:
    """colour(lx, ly, tone, side) -> colour or None. Leg local coords: ly = distance
    below the hip (0..~7.5), lx = -1..1 across the leg, side 'b' back leg / 'f' front.
    length: how far down the leg it covers (7.5 full, 3 shorts); below that is skin.
    waist: colour for the bottom 2 torso rows (belt line) or None to leave the top.
    extra(f, P): optional drawing over the hips (skirts, tails, holsters)."""

    def __init__(self, colour, length=8.0, waist=None, extra=None):
        self.colour, self.length, self.waist, self.extra = colour, length, waist, extra


class Shoe:
    """rows: hand-drawn grid, toe to the right, last row is the sole (on the ground).
    legend: char -> colour (tone 2) or (colour, tone). anchor: (col, row) of the ankle
    point in the grid (the stock boot is (1, 1))."""

    def __init__(self, rows, legend, anchor=(1, 1)):
        self.rows, self.legend, self.anchor = rows, legend, anchor


class Weapon:
    """Replaces the pick. The handle runs from the grip back to the head joint J.
    head: rows of a grid laid out in the handle's own frame: each row is one step
    across the handle (v, top row = the side the pickaxe's upper tip points), each
    column one step along it (u, increasing away from the hand). origin=(col,row) is
    the cell sitting on J. legend: char -> colour or (colour, tone); 'h' cells use the
    handle colour. handle: colour; length: extra handle beyond J (u) for long weapons.
    glow: optional '#hex' for a soft glow baked around the head."""

    def __init__(self, head, legend, origin, handle='#a0703f', butt=1.2, glow=None):
        self.head, self.legend, self.origin, self.handle, self.butt, self.glow = head, legend, origin, handle, butt, glow


# ---------------------------------------------------------------- rig hooks
_G = {}


class GFrame(AK.Frame):
    """Rig frame with a margin so gear can spill past the stock 20x26 box."""

    def __init__(self, w, h):
        super().__init__(CW, CH)

    def put(self, x, y, ramp_, tone, part='', layer=None):
        super().put(x + OX, y + OY, ramp_, tone, part, layer)

    def get(self, x, y):
        return super().get(int(x) + OX, int(y) + OY)

    def part_at(self, x, y):
        p = self.get(x, y)
        return p[3] if p else None

    def erase(self, x, y):
        super().erase(x + OX, y + OY)

    def shift_tone(self, x, y, d):
        super().shift_tone(x + OX, y + OY, d)

    # bevel/contour/cast_shadows walk the raw grid; give them raw access
    def _raw_part(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h and self.px[y][x]:
            return self.px[y][x][3]
        return None

    def bevel(self, parts, lit=1, dark=-1, ramps=None):
        parts = set(parts)
        ch = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p or p[3] not in parts or (ramps and p[1] not in ramps):
                    continue
                same = lambda dx, dy: self._raw_part(x + dx, y + dy) == p[3]
                d = 0
                if not same(1, 0) or not same(0, 1):
                    d = dark
                if not same(-1, 0) or not same(0, -1):
                    d = lit if d == 0 else 0
                if d:
                    ch.append((x, y, d))
        for x, y, d in ch:
            p = self.px[y][x]
            n = len(RAMPS[p[1]])
            p[2] = max(0, min(n - 1, p[2] + d))

    def _rawget(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def cast_shadows(self, pairs):
        dark = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p:
                    continue
                for dx, dy in ((-1, 0), (0, -1), (-1, -1)):
                    q = self._rawget(x + dx, y + dy)
                    if q and (q[3], p[3]) in pairs:
                        dark.append((x, y))
                        break
        for x, y in dark:
            p = self.px[y][x]
            p[2] = max(0, p[2] - 1)

    def contour(self, pairs, tone=0):
        marks = []
        for y in range(self.h):
            for x in range(self.w):
                p = self.px[y][x]
                if not p:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    q = self._rawget(x + dx, y + dy)
                    if q and (q[3], p[3]) in pairs:
                        marks.append((x, y))
                        break
        for x, y in marks:
            self.px[y][x][2] = tone


AM.Frame = GFrame
_orig_boot = AM.draw_boot
_orig_pick = AM.draw_pick
_orig_torso = AM.draw_torso


def _boot(f, ax, ay, part, dark=0, lift=False):
    shoe = _G.get('shoe')
    if not shoe:
        return _orig_boot(f, ax, ay, part, dark, lift)
    cx, cy = shoe.anchor
    ox, oy = int(round(ax)) - cx, int(round(ay)) - cy
    last = len(shoe.rows) - 1
    for j, row in enumerate(shoe.rows):
        for i, ch in enumerate(row):
            if ch in ' .':
                continue
            spec = shoe.legend[ch]
            col, tone = (spec, 2) if not isinstance(spec, tuple) or len(spec) == 3 and isinstance(spec[0], int) else spec
            if lift and j == last and i == len(row) - 1:
                continue
            f.put(ox + i, oy + j, ramp(col), max(0, tone - dark), part)


def _pick(f, grip, J, part='pick', buried=None, butt_extra=1.2):
    w = _G.get('weapon')
    if not w:
        return _orig_pick(f, grip, J, part, buried, butt_extra)
    dx, dy = J[0] - grip[0], J[1] - grip[1]
    n = math.hypot(dx, dy) or 1
    d = (dx / n, dy / n)
    pv = (-d[1], d[0])
    hr = ramp(w.handle)
    butt = (grip[0] - d[0] * w.butt, grip[1] - d[1] * w.butt)
    for i, (x, y) in enumerate(AK_bres(butt, (J[0] - d[0] * 0.5, J[1] - d[1] * 0.5))):
        if buried is not None and y > buried:
            continue
        f.put(x, y, hr, 3 if i % 4 == 1 else 2, part + '-handle')
    ou, ov = w.origin
    rows = w.head
    H, Wd = len(rows), max(len(r) for r in rows)
    reach = max(H, Wd) + 2
    cells = {}
    for y in range(int(J[1] - reach), int(J[1] + reach) + 1):
        for x in range(int(J[0] - reach), int(J[0] + reach) + 1):
            qx, qy = x + 0.5 - J[0], y + 0.5 - J[1]
            u = qx * d[0] + qy * d[1]
            v = qx * pv[0] + qy * pv[1]
            ci, cj = int(math.floor(u + 0.5)) + ou, int(math.floor(v + 0.5)) + ov
            if 0 <= cj < H and 0 <= ci < len(rows[cj]):
                ch = rows[cj][ci]
                if ch in ' .':
                    continue
                if buried is not None and y > buried:
                    continue
                cells[(x, y)] = ch
    for (x, y), ch in cells.items():
        if ch == 'h':
            f.put(x, y, hr, 2, part + '-handle')
            continue
        spec = w.legend[ch]
        if isinstance(spec, tuple) and len(spec) == 2 and not isinstance(spec[0], int):
            col, tone = spec
        else:
            col, tone = spec, 2
        f.put(x, y, ramp(col), tone, part)
    # simple light: top/left edges of the head up a tone, bottom/right down a tone
    ch = []
    for (x, y) in cells:
        p = f.get(x, y)
        if not p or p[3] != part:
            continue
        up = f.part_at(x - 1, y) != part or f.part_at(x, y - 1) != part
        dn = f.part_at(x + 1, y) != part or f.part_at(x, y + 1) != part
        if up and not dn:
            ch.append((x, y, 1))
        elif dn and not up:
            ch.append((x, y, -1))
    for x, y, dd in ch:
        f.shift_tone(x, y, dd)
    _G.setdefault('glow_at', []).append((J, w.glow)) if w.glow else None
    return d


def AK_bres(a, b):
    return AM.bresenham(a, b)


def _torso(f, cx, cy, squash=0):
    top = _G.get('top')
    if top and top.back:
        top.back(f, _G['P'])
    _orig_torso(f, cx, cy, squash)
    _G['torso0'] = (int(round(cx)) - 4, int(round(cy)) - 4 + squash)


AM.draw_boot = _boot
AM.draw_pick = _pick
AM.draw_torso = _torso


# ---------------------------------------------------------------- dressing
FIT_DEFAULT = '#2f5fd0'
PICK_DEFAULT = '#c9c9c9'


def _col(c):
    return c


def dress(f, P, gear):
    top, bot = gear.get('top'), gear.get('bottom')
    body = P['body']
    tx0, ty0 = _G.get('torso0', (0, 0))
    sb, sf = AM.shoulders(body)
    hb, hf = AM.hips(body)
    hands = {'arm-b': P['back'], 'arm-f': P['grip']}
    sh = {'arm-b': sb, 'arm-f': sf}
    hips = {'leg-b': hb, 'leg-f': hf}
    feet = {'leg-b': P['feet'][0], 'leg-f': P['feet'][1]}
    nrows = len(AM.TORSO[P.get('squash', 0)])
    for y in range(f.h):
        for x in range(f.w):
            p = f.px[y][x]
            if not p:
                continue
            layer, rp, tone, part = p
            X, Y = x - OX, y - OY
            new = None
            if part == 'torso':
                lx, ly = X - tx0, Y - ty0
                if bot and bot.waist and ly >= nrows - 2:
                    new = bot.waist
                elif top:
                    new = top.colour(lx, ly, tone if rp == 'fit' else min(4, tone))
                if new is None and rp == 'fit':
                    new = FIT_DEFAULT
            elif part in ('leg-b', 'leg-f') and rp == 'fit':
                hp, ft = hips[part], feet[part]
                ax_, ay_ = ft[0] - hp[0], ft[1] - hp[1]
                L = math.hypot(ax_, ay_) or 1
                ly = ((X + 0.5 - hp[0]) * ax_ + (Y + 0.5 - hp[1]) * ay_) / L
                lx = ((X + 0.5 - hp[0]) * -ay_ + (Y + 0.5 - hp[1]) * ax_) / L
                if bot:
                    if ly > bot.length:
                        new = 'skin'
                    else:
                        new = bot.colour(lx, ly, tone, part[-1])
                if new is None:
                    new = FIT_DEFAULT
            elif part in ('arm-b', 'arm-f') and rp == 'skin' and top and top.sleeve > 0:
                s = sh[part]
                dist = math.hypot(X + 0.5 - s[0], Y + 0.5 - s[1])
                if dist <= top.sleeve:
                    t = dist / max(0.1, top.sleeve)
                    new = top.sleeve_colour(t, tone) if top.sleeve_colour else top.colour(5, 1, tone)
            elif part == 'pick':
                if rp == 'pick':
                    new = PICK_DEFAULT
            if new is None:
                continue
            if new == 'skin':
                f.px[y][x] = ['base', 'skin', 2, part]
                continue
            f.px[y][x] = ['base', ramp(new), tone if rp in ('fit', 'skin', 'pick') else min(4, tone), part]
    if top and top.front:
        top.front(f, P, (tx0, ty0))
    if bot and bot.extra:
        bot.extra(f, P)


SIL = [(40, 32, 54), (52, 43, 68), (64, 54, 82), (78, 67, 97), (92, 80, 112)]
RAMPS['sil'] = SIL
_KEEP = {'g2f5fd0', 'gc9c9c9'}  # default overalls and pick are body, not gear


def silhouette(f):
    """Turn everything that isn't gear into a dark silhouette, keeping tones for shape."""
    for row in f.px:
        for p in row:
            if not p:
                continue
            r = p[1]
            gear = r.startswith('g') and r not in _KEEP and r in RAMPS and len(r) == 7
            if not gear:
                n = len(RAMPS[r]) if r in RAMPS else 5
                tone = int(round(p[2] * 4 / max(1, n - 1)))
                p[0], p[1], p[2] = 'base', 'sil', max(0, min(4, tone))


def render(gear, pose='idle', t=0, female=False, sil=False):
    """Full-colour miner wearing the gear. Returns (img, (ax, ay)) where the anchor
    is the feet point in the image."""
    _G.clear()
    _G['shoe'], _G['weapon'], _G['top'] = gear.get('shoe'), gear.get('weapon'), gear.get('top')
    P = AM.pose_frames()[pose][t]
    _G['P'] = P
    f, head = AM.draw_frame(P, female)
    f.extra = [(x + OX, y + OY, c) for (x, y, c) in f.extra]
    dress(f, P, gear)
    if sil:
        silhouette(f)
        f.extra = []
    # the engine draws the pick after the hat when it is in front of the body
    front = None
    if P.get('z') == 'front':
        front = AK.Frame(f.w, f.h)
        for y in range(f.h):
            for x in range(f.w):
                p = f.px[y][x]
                if p and p[3].startswith('pick') and p[3] != 'pick-handle':
                    front.px[y][x] = p
                    f.px[y][x] = None
    img = f.render()['base']
    hat = gear.get('head') or default_hat()
    if hat != 'none':
        hi, ax, ay = hat
        img.alpha_composite(hi, (OX + int(head[0]) - ax, OY + int(head[1]) - ay))
    if front:
        img.alpha_composite(front.render()['base'])
    return img, (OX + AM.AX, OY + AM.AY)


_DEF_HAT = []


def default_hat():
    if _DEF_HAT:
        return _DEF_HAT[0]
    _DEF_HAT.append(_load_default_hat())
    return _DEF_HAT[0]


def _load_default_hat():
    import json
    art = json.load(open(__import__('os').path.join(__import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..')), 'app/src/engine/art.json')))
    r = art['atlas']['rects']['hat-yellow']
    at = Image.open(__import__('os').path.join(__import__('os').path.abspath(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), '..', '..')), 'app/public/pixel/atlas.png')).convert('RGBA')
    h = art['actors']['hats']['hat-yellow']
    return at.crop((r[0], r[1], r[0] + r[2], r[1] + r[3])), h['ax'], h['ay']


# ---------------------------------------------------------------- pets
def pet_frame(w, h):
    """A plain rig Frame for pets (no margin)."""
    return AK.Frame(w, h)


def pet_render(f):
    return AK.Frame.render(f)['base']

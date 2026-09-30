"""The ground layer of Gali Island, painted per pixel.

island.py owns the shape of the board (land, tiers, biomes, rivers, claims);
this module only paints it. What comes out is land, cliff faces, islets and the
painted range, with every open-sea pixel transparent: the engine draws the water
itself, and it reads the coastline for its foam off this layer's alpha.

Nothing here decides geometry. It reads the island module it is handed and
returns an RGBA image plus a few masks the prop placement needs (where the
paths run, which pixels are cliff face, where the mountains stand).
"""
import math

import numpy as np

BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], float) + 0.5) / 16


def rgb(s):
    s = s.lstrip('#')
    return np.array([int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)], float)


def ramp(*cols):
    return np.array([rgb(c) for c in cols])


# Five tones per ground: 0 deep shade, 1 dark, 2 the palette colour, 3 light, 4 highlight.
# The middle three carry the ground; 0 and 4 are kept for detail.
RAMPS = {
    (0, 1): ramp('#4a8236', '#5c9440', '#6aa54a', '#77b152', '#8fc460'),
    (0, 2): ramp('#3a6c2c', '#467d31', '#4f8a38', '#5a9640', '#6ea84b'),
    (0, 3): ramp('#62804a', '#77955a', '#88a866', '#99b874', '#b3cc8c'),
    (1, 3): ramp('#aac2de', '#c6d6e8', '#dbe7f5', '#eef4fb', '#ffffff'),
    (2, 1): ramp('#b0702f', '#c98a3e', '#d99a4a', '#e2a957', '#edbe74'),
    (2, 2): ramp('#9d5f28', '#b57132', '#c9803a', '#d38e45', '#dea35b'),
    (2, 3): ramp('#7e4520', '#945124', '#a85f2c', '#b56c35', '#c68246'),
    (3, 0): ramp('#c9ad74', '#d8c185', '#e3cf94', '#ecdca6', '#f6ebc0'),
}

# cliff faces: dirt under the meadow, blue rock under snow, rust under the badlands, sandstone
FACES = {
    0: ramp('#35231a', '#4a3122', '#5a3c28', '#6b4a32', '#80593b'),
    1: ramp('#3e4654', '#4c5666', '#5d6878', '#6e7a8c', '#8793a5'),
    2: ramp('#48240f', '#5e3115', '#74401d', '#8a4a22', '#a15a2b'),
    3: ramp('#5a4a2c', '#7a6740', '#8f7a4d', '#a8905c', '#bba36c'),
}


def ramp_key(b, t):
    if b == 3 or t <= 0:
        return (3, 0)
    if b == 1:
        return (1, 3)
    return (b, max(1, min(3, t)))


def hash2(x, y, seed=0.0):
    v = np.sin(np.asarray(x, float) * 12.9898 + np.asarray(y, float) * 78.233 + seed * 37.719) * 43758.5453
    return v - np.floor(v)


def shifted(a, dx, dy, fill=0):
    """out[y, x] = a[y - dy, x - dx]: the array moved by (dx, dy)."""
    out = np.full_like(a, fill)
    h, w = a.shape[:2]
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    out[ys0:ys1, xs0:xs1] = a[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def blur(a, r):
    """Box blur of radius r, separable, edges clamped."""
    a = a.astype(float)
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        p = np.pad(a, pad, mode='edge')
        c = np.cumsum(p, axis=axis)
        n = a.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def grow(mask, n=1, diag=True):
    m = mask.copy()
    for _ in range(n):
        g = m.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if (dx or dy) and (diag or not (dx and dy)):
                    g |= shifted(m, dx, dy, False)
        m = g
    return m


def mix(a, b, t):
    return a + (b - a) * t


class Ground:
    def __init__(self, I):
        self.I = I
        self.W, self.H, self.B = I.W, I.H, I.B
        H, W, B = self.H, self.W, self.B
        self.PY, self.PX = np.mgrid[0:H, 0:W]
        self.BXp, self.BYp = self.PX // B, self.PY // B
        self.bay = BAYER[self.PY % 4, self.PX % 4]
        self.rgb = np.zeros((H, W, 3))
        self.alpha = np.zeros((H, W), bool)
        self.face = np.zeros((H, W), bool)       # cliff face pixels
        self.mount = np.zeros((H, W), bool)      # painted range
        self.path = np.full((H, W), 99.0)        # distance to the nearest footpath centreline
        self._blocks()

    # ---- the block maps, with the islets folded in so they paint like the coast ----
    def _blocks(self):
        I = self.I
        self.GL = I.LAND.copy()
        self.GT = I.TIER.copy().astype(int)
        self.GB = I.BIOME.copy().astype(int)
        self.ISLET = np.zeros_like(self.GL)
        for isl in I.ISLETS:
            cx, cy, r = isl['x'] / I.B, isl['y'] / I.B, isl['r']
            for y in range(int(cy - r - 3), int(cy + r + 4)):
                for x in range(int(cx - r - 3), int(cx + r + 4)):
                    if not (0 <= x < I.COLS and 0 <= y < I.ROWS) or I.LAND[y][x]:
                        continue
                    d = math.hypot(x - cx, y - cy) + (float(I.noise(np.array(x / 2.2), np.array(y / 2.2), 44)) - 0.5) * 2.8
                    if d > r + 1.1:
                        continue
                    self.GL[y, x] = True
                    self.ISLET[y, x] = True
                    if d > r - 0.6:
                        self.GT[y, x], self.GB[y, x] = 0, 3
                    else:
                        self.GT[y, x], self.GB[y, x] = 1, 0
        self.OWN = I.OWNER.astype(int)
        self.RIV = I.RIVER & I.LAND

    def gt(self, x, y):
        if 0 <= x < self.I.COLS and 0 <= y < self.I.ROWS and self.GL[y, x]:
            return int(self.GT[y, x])
        return -1

    def px_blocks(self, a):
        return a[self.BYp, self.BXp]

    # ---- pass 1: the flat tops ----
    def tops(self):
        I = self.I
        land = self.px_blocks(self.GL)
        tier = self.px_blocks(self.GT)
        bio = self.px_blocks(self.GB)
        self.land = land
        # blend biomes across a dithered band rather than a hard block edge. Only
        # within one height: a step is a step, it should stay crisp.
        grp = np.where(land, np.maximum(tier, 1), -9)
        chosen = bio.copy()
        # the threshold is part ordered, part clustered noise, so the band frays
        # into clumps instead of printing a regular screen of dots
        clump = hash2(self.PX // 2, self.PY // 2, 73)
        u = np.clip(0.3 * self.bay + 0.45 * clump + 0.25 * hash2(self.PX, self.PY, 75)
                    + (I.noise(self.PX / 5.0, self.PY / 5.0, 71) - 0.5) * 0.5, 0.01, 0.99)
        for g in np.unique(grp[land]):
            gm = grp == g
            den = blur(gm, 3)
            cum = np.zeros(gm.shape)
            done = np.zeros(gm.shape, bool)
            for b in (0, 2, 3, 1):
                w = blur(gm & (bio == b), 3) / np.maximum(den, 1e-6)
                cum = cum + w
                take = gm & ~done & (cum >= u)
                chosen = np.where(take, b, chosen)
                done |= take
        # a tier-0 pixel that borrowed the meadow shows the meadow's lowland
        eff_t = np.where((chosen != 3) & (tier == 0), 1, tier)
        eff_t = np.where(chosen == 3, 0, eff_t)
        self.cbio, self.ctier = chosen, eff_t

        # tone: macro variation, a nudge per block so the 3px grid still reads, fine grain
        macro = I.fbm(self.PX / 17.0, self.PY / 17.0, 5)
        blockv = hash2(self.BXp, self.BYp, 3) - 0.5
        fine = hash2(self.PX, self.PY, 9) - 0.5
        v = 0.5 + (macro - 0.5) * 1.1 + blockv * 0.2 + fine * 0.06
        clump = hash2(self.PX // 2, self.PY // 2, 7)
        jit = 0.25 * self.bay + 0.45 * clump + 0.3 * hash2(self.PX, self.PY, 8)
        tone = 1 + np.floor(np.clip(v, 0, 0.999) * 2 + jit).astype(int)
        tone = np.clip(tone, 1, 3)
        self.tone = tone
        out = np.zeros((self.H, self.W, 3))
        for (b, t), R in RAMPS.items():
            m = land & (chosen == b) & (eff_t == t)
            if m.any():
                out[m] = R[tone[m]]
        # anything a ramp did not cover falls back to its own block's ramp
        miss = land & (out.sum(axis=2) == 0)
        for y, x in zip(*np.nonzero(miss)):
            out[y, x] = RAMPS[ramp_key(int(bio[y, x]), int(tier[y, x]))][tone[y, x]]
        self.rgb[:] = out
        self.alpha[:] = land

    def put(self, m, col, a=1.0):
        c = rgb(col) if isinstance(col, str) else np.asarray(col, float)
        if a >= 1:
            self.rgb[m] = c
        else:
            self.rgb[m] = mix(self.rgb[m], c, a)

    def tone_of(self, m, k):
        """Recolour mask m with ramp tone k of whatever ground is under it."""
        for (b, t), R in RAMPS.items():
            mm = m & (self.cbio == b) & (self.ctier == t)
            if mm.any():
                self.rgb[mm] = R[k]

    # ---- pass 2: texture per biome ----
    def detail(self):
        I = self.I
        top = self.land & ~self.px_blocks(self.RIV)
        h1 = hash2(self.PX, self.PY, 21)
        h2 = hash2(self.PX, self.PY, 22)
        h3 = hash2(self.PX, self.PY, 23)
        patch = I.fbm(self.PX / 11.0, self.PY / 11.0, 41)
        meadow = top & (self.cbio == 0) & (self.ctier <= 2)
        alpine = top & (self.cbio == 0) & (self.ctier == 3)
        bad = top & (self.cbio == 2)
        sand = top & (self.cbio == 3)

        # meadow: grass blades in tufts, darker roots under them, flower patches
        tuft = meadow & (h1 > 0.93) & (patch > 0.35)
        self.tone_of(shifted(tuft, 0, 1, False) & meadow, 0)
        self.tone_of(tuft, 4)
        self.tone_of(shifted(tuft, -1, 1, False) & meadow & (h2 > 0.4), 3)
        self.tone_of(shifted(tuft, 1, 1, False) & meadow & (h2 < 0.6), 3)
        blade = meadow & ~tuft & (h3 > 0.975)
        self.tone_of(blade, 3)
        flowers = meadow & (patch > 0.6) & (h2 > 0.955) & (self.ctier == 1)
        cols = ['#ffffff', '#ffe36a', '#ff9ec0', '#d6b0ff', '#ff7a5c']
        pick = (hash2(self.PX // 5, self.PY // 5, 17) * len(cols)).astype(int)   # a patch keeps one colour
        self.tone_of(shifted(flowers, 0, 1, False) & meadow, 0)
        for k, c in enumerate(cols):
            self.put(flowers & (pick == k), c)
        self.flower_px = flowers

        # highland heath: scree stones with a shadow, strata, a little frost
        stone = alpine & (h1 > 0.965)
        self.tone_of(shifted(stone, 0, 1, False) & alpine, 0)
        self.tone_of(shifted(stone, 1, 1, False) & alpine, 0)
        self.put(stone, '#c3cbbd')
        self.put(shifted(stone, 1, 0, False) & alpine & (h2 > 0.5), '#a3ad98')
        wob = np.round((I.noise(self.PX / 9.0, self.PY / 9.0, 55) - 0.5) * 6).astype(int)
        strata = alpine & (((self.PY + wob) % 6) == 0) & (I.noise(self.PX / 6.0, self.PY / 3.0, 57) > 0.58)
        self.tone_of(strata & ~stone, 1)
        self.tone_of(shifted(strata, 0, -1, False) & alpine & ~stone & (h3 > 0.5), 3)
        heath = alpine & (h3 > 0.97)
        self.put(heath & (h2 > 0.5), '#6f9a58')
        self.put(heath & (h2 <= 0.5), '#b88fb0')

        # badlands: pebbles, cracks, dry scrub
        peb = bad & (h1 > 0.972)
        self.tone_of(shifted(peb, 1, 1, False) & bad, 0)
        self.tone_of(peb, 4)
        crack_seed = bad & (h2 > 0.992)
        cm = np.zeros_like(bad)
        for y, x in zip(*np.nonzero(crack_seed)):
            n = 3 + int(hash2(x, y, 5) * 5)
            dx = 1 if hash2(x, y, 6) > 0.5 else -1
            for s in range(n):
                if 0 <= y < self.H and 0 <= x < self.W:
                    cm[y, x] = True
                r = hash2(x + s, y, 7)
                if r < 0.55:
                    x += dx
                elif r < 0.8:
                    y += 1
                else:
                    x += dx
                    y += 1
        self.tone_of(cm & bad, 0)
        self.tone_of(shifted(cm, 0, 1, False) & bad & ~cm & (h3 > 0.5), 3)
        scrub = bad & (h3 > 0.982) & (patch < 0.5)
        self.put(scrub, '#8f8a3a')
        self.put(shifted(scrub, 1, 0, False) & bad & (h1 > 0.3), '#a8a24a')

        # sand: wind ripples, shells
        wob = I.noise(self.PX / 8.0, self.PY / 8.0, 61)
        rip = (self.PY + np.sin(self.PX * 0.23 + wob * 4) * 1.6 + wob * 3) / 4.0
        fr = rip - np.floor(rip)
        field = I.noise(self.PX / 13.0, self.PY / 13.0, 63) > 0.3
        crest = sand & field & (fr < 0.2)
        trough = sand & field & (fr >= 0.25) & (fr < 0.42)
        self.tone_of(crest, 4)
        self.tone_of(trough & (h1 > 0.25), 1)
        shell = sand & (h1 > 0.994)
        self.put(shell & (h2 > 0.5), '#fff6e6')
        self.put(shell & (h2 <= 0.5), '#f0a89c')
        self.sand = sand

    # ---- pass 3: where the sea meets the land ----
    def shore(self):
        sea = ~self.land
        d1 = grow(sea, 1, diag=False) & self.land
        d2 = grow(sea, 2, diag=False) & self.land & ~d1
        d3 = grow(sea, 3, diag=False) & self.land & ~d1 & ~d2
        sandy = self.cbio == 3
        wet = rgb('#b99a5e')
        damp = rgb('#c9ab70')
        m = d1 & sandy
        self.rgb[m] = mix(self.rgb[m], wet, 0.85)
        m = d2 & sandy
        self.rgb[m] = mix(self.rgb[m], np.where((self.bay[m] < 0.6)[:, None], wet, damp), 0.7)
        m = d3 & sandy & (self.bay < 0.3)
        self.rgb[m] = mix(self.rgb[m], damp, 0.6)
        # grass at the water: a darker rim, the turf curling over the edge
        m = d1 & ~sandy
        self.rgb[m] *= 0.8

    # ---- pass 4: rivers ----
    def rivers(self):
        riv = self.px_blocks(self.RIV) & self.land
        # where the river steps diagonally from block to block, fill the corner
        # so it reads as one channel rather than a staircase of squares
        R = self.RIV
        rows, cols = R.shape
        for y in range(rows - 1):
            for x in range(cols):
                if not R[y, x]:
                    continue
                for sx in (-1, 1):
                    nx = x + sx
                    if 0 <= nx < cols and R[y + 1, nx] and not R[y, nx] and not R[y + 1, x]:
                        X, Y = x * 3, y * 3
                        cx = X + (3 if sx > 0 else -1)
                        riv[Y + 2, cx] = self.land[Y + 2, cx] or riv[Y + 2, cx]
                        riv[Y + 3, X + (2 if sx > 0 else 0)] = True
        edge = riv & grow(~riv & self.land, 1, diag=False)
        self.put(riv, '#2f7fc2')
        self.put(riv & (hash2(self.PX, self.PY, 81) > 0.8), '#3b8fd0')
        self.put(edge, '#246aa6')
        bank = grow(riv, 1, diag=False) & self.land & ~riv
        self.rgb[bank] *= 0.78
        reed = bank & (hash2(self.PX, self.PY, 83) > 0.8) & (self.cbio != 3)
        self.put(reed, '#8fbe5a')
        self.put(shifted(reed, 0, -1, False) & ~riv & self.land, '#3f6e2c')
        self.riv = riv

    # ---- pass 5: worn footpaths ----
    def paths(self):
        I = self.I
        cen = I.CEN
        for a, b in I.LINKS:
            ax, ay, _ = cen[a]
            bx, by, _ = cen[b]
            span = max(1.0, math.hypot(bx - ax, by - ay))
            steps = int(math.ceil(span * 2))
            wigseed = I._hash(a * 7 + b * 13) - 0.5
            for s in range(steps + 1):
                u = s / steps
                wig = math.sin(u * math.pi) * wigseed * 9 + math.sin(u * math.pi * 3 + a) * 1.2
                nx = ax + (bx - ax) * u + wig * ((by - ay) / span)
                ny = ay + (by - ay) * u - wig * ((bx - ax) / span)
                x0, y0 = int(nx) - 3, int(ny) - 3
                for yy in range(max(0, y0), min(self.H, y0 + 7)):
                    for xx in range(max(0, x0), min(self.W, x0 + 7)):
                        d = math.hypot(xx + 0.5 - nx, yy + 0.5 - ny)
                        if d < self.path[yy, xx]:
                            self.path[yy, xx] = d
        top = self.land & ~self.riv
        d = self.path + (hash2(self.PX, self.PY, 91) - 0.5) * 0.6
        core = top & (d < 0.9)
        body = top & (d >= 0.9) & (d < 1.6)
        rim = top & (d >= 1.6) & (d < 2.3) & (self.bay < (2.3 - d) / 0.7)
        sandy = self.cbio == 3
        badl = self.cbio == 2
        for m, (g, s, r) in (
            (core, ('#b08a5e', '#d4bc88', '#e4c08e')),
            (body, ('#98744c', '#c8ad76', '#d2a46a')),
            (rim, ('#7c5c3a', '#bb9e68', '#b98450')),
        ):
            self.put(m & ~sandy & ~badl, g)
            self.put(m & sandy, s)
            self.put(m & badl, r)
        peb = (core | body) & (hash2(self.PX, self.PY, 93) > 0.93)
        self.put(peb & ~sandy, '#c9ab7c')
        self.put(shifted(peb, 1, 1, False) & (core | body) & ~sandy, '#6b4a2e')
        # grass poking through the middle of a path nobody has walked in a while
        poke = core & (hash2(self.PX, self.PY, 95) > 0.94) & (self.cbio == 0)
        self.tone_of(poke, 1)
        # a plank bridge where the path crosses water
        br = self.riv & (self.path < 1.7)
        self.put(br, '#8a6a44')
        self.put(br & (self.PX % 2 == 0), '#a4804f')
        self.put(br & (self.path >= 1.1), '#5c4028')
        self.pathmask = core | body | br

    # ---- pass 6: light and shade on the steps ----
    def relief(self):
        I = self.I
        cols, rows = I.COLS, I.ROWS
        mul = np.ones((self.H, self.W))
        for y in range(rows):
            for x in range(cols):
                t = self.gt(x, y)
                if t < 0:
                    continue
                X, Y = x * 3, y * 3
                # crest: the ground drops away to the north, catch the light
                n = self.gt(x, y - 1)
                if 0 <= n < t:
                    mul[Y, X:X + 3] *= 1.14
                # the west side drops away: lit edge
                w = self.gt(x - 1, y)
                if 0 <= w < t:
                    mul[Y:Y + 3, X] *= 1.1
                # the east side drops away: shaded edge on us, and a shadow cast east
                e = self.gt(x + 1, y)
                if 0 <= e < t:
                    mul[Y:Y + 3, X + 2] *= 0.86
                    if X + 3 < self.W:
                        mul[Y:Y + 3, X + 3] *= 0.72
                    if X + 4 < self.W:
                        mul[Y:Y + 3, X + 4] *= np.where(self.bay[Y:Y + 3, X + 4] < 0.5, 0.84, 1.0)
        self.rgb *= mul[:, :, None]

    # ---- pass 7: cliff faces, south-facing, with strata and a foot of shadow ----
    def faces(self):
        I = self.I
        cols, rows = I.COLS, I.ROWS
        ao = np.ones((self.H, self.W))
        riv = self.RIV
        for y in range(rows):
            for x in range(cols):
                t = self.gt(x, y)
                if t < 0:
                    continue
                below = self.gt(x, y + 1)
                sea = below < 0
                if not sea and 0 <= below < t:
                    h = min(3, t - below) * 4
                elif sea and t >= 1:
                    h = 5
                else:
                    continue
                bm = int(self.GB[y, x])
                F = FACES.get(bm, FACES[0])
                lip = RAMPS[ramp_key(bm, t)]
                X, Y = x * 3, y * 3 + 3
                water = bool(riv[y, x])
                for r in range(h):
                    py = Y + r
                    if py >= self.H:
                        break
                    for c in range(3):
                        px = X + c
                        hv = float(hash2(px, py, 101))
                        hc = float(hash2(px, 0, 103))
                        if r == 0:
                            col = lip[1] if hv > 0.25 else lip[0]
                        elif r == 1 and hc > 0.6:
                            col = lip[0]    # turf hanging over the lip
                        elif r == h - 1:
                            col = F[0] * (0.8 if sea else 1.0)
                        elif r == h - 2 and sea:
                            col = F[1]
                        else:
                            # strata: a lit band under the lip, then alternating layers
                            band = (r + (1 if hash2(x, y, 105) > 0.5 else 0)) % 3
                            k = 3 if r == 1 else (2 if band else 1)
                            if hv > 0.88:
                                k -= 1
                            elif hv < 0.08:
                                k = 4
                            col = F[max(0, min(4, k))]
                        if water and r > 0:
                            # a waterfall where a river goes over the step
                            col = rgb('#e8f7ff') if (r >= h - 2 or hv > 0.7) else (rgb('#9fd6f5') if (px + r) % 3 else rgb('#5fb0e6'))
                        self.rgb[py, px] = col
                        self.face[py, px] = True
                        self.alpha[py, px] = True
                # the foot of the step, in shadow
                if not sea:
                    for k, m in enumerate((0.64, 0.8, 0.92)):
                        py = Y + h + k
                        if py >= self.H:
                            break
                        for c in range(3):
                            if k == 2 and self.bay[py, X + c] > 0.5:
                                continue
                            ao[py, X + c] = min(ao[py, X + c], m)
        ao = np.where(self.face, 1.0, ao)
        self.rgb *= ao[:, :, None]
        # stone steps cut into a face where a path climbs it
        stair = self.face & (self.path < 1.6) & ~self.px_blocks(riv)
        self.put(stair & (self.PY % 2 == 0), '#b09a78')
        self.put(stair & (self.PY % 2 == 1), '#6b5642')

    # ---- pass 8: round off the coast's square corners by a pixel ----
    def round_coast(self):
        I = self.I
        gl = lambda x, y: 0 <= x < I.COLS and 0 <= y < I.ROWS and bool(self.GL[y, x])
        for y in range(I.ROWS):
            for x in range(I.COLS):
                X, Y = x * 3, y * 3
                if gl(x, y):
                    t = int(self.GT[y, x])
                    for sx, sy, cx, cy in ((-1, -1, X, Y), (1, -1, X + 2, Y), (-1, 1, X, Y + 2), (1, 1, X + 2, Y + 2)):
                        if sy > 0 and t >= 1:
                            continue          # a cliff face hangs off this corner
                        if not gl(x + sx, y) and not gl(x, y + sy) and not gl(x + sx, y + sy):
                            if not self.face[cy, cx]:
                                self.alpha[cy, cx] = False
                else:
                    for sx, sy, cx, cy in ((-1, -1, X, Y), (1, -1, X + 2, Y), (-1, 1, X, Y + 2), (1, 1, X + 2, Y + 2)):
                        if gl(x + sx, y) and gl(x, y + sy) and not self.alpha[cy, cx]:
                            sy_px = min(self.H - 1, max(0, cy + (-1 if sy < 0 else 1)))
                            self.rgb[cy, cx] = self.rgb[sy_px, cx]
                            self.alpha[cy, cx] = True

    # ---- pass 9: the range, painted in ----
    def mountains(self):
        I = self.I
        for cx, base, w, h, snowy in sorted(I.RANGE, key=lambda m: m[1]):
            self.mountain(cx, base, w, h, snowy)

    def mountain(self, cx, base_y, w, h, snowy):
        if snowy:
            lit = ramp('#5f6979', '#7c8696', '#929cab', '#a9b3c0', '#c3cbd6')
            shd = ramp('#343c49', '#434d5c', '#4f5968', '#5b6575', '#687282')
        else:
            lit = ramp('#5e5448', '#7a6f62', '#8d8275', '#a2978a', '#b8ad9f')
            shd = ramp('#332d27', '#433b33', '#4f463d', '#5b5147', '#675d52')
        snow_l = ramp('#c3d3e8', '#d9e5f4', '#e9f1fb', '#f7fbff', '#ffffff')
        snow_r = ramp('#8fa5c2', '#a6b9d3', '#b9cbe1', '#cddbec', '#e4eef9')
        seed = cx * 0.37 + base_y
        top = base_y - h
        foot = self.rgb.copy()
        foot_alpha = self.alpha.copy()
        # the silhouette: a triangle with a broken edge
        spans = []
        for i in range(h):
            half = (i / h) * (w / 2)
            if i > 2:
                half += (float(self.I.noise(np.array(i / 2.5), np.array(seed), 121)) - 0.5) * 2.4
            half = int(round(min(w / 2, half)))
            spans.append(half)
        # crevices: a few dark seams running down and out from the ridge
        seams = set()
        for side in (-1, 1):
            for k in range(2 if h > 24 else 1):
                i = int(h * (0.3 + 0.28 * k + 0.1 * float(hash2(k, seed + side, 123))))
                x = cx + (side if side > 0 else -1)
                for step in range(int(h * 0.35)):
                    if i >= h:
                        break
                    seams.add((x, top + i))
                    i += 1
                    if hash2(step, seed + k + side, 125) > 0.35:
                        x += side
        for i in range(h):
            y = top + i
            half = spans[i]
            if y < 0 or y >= self.H or half < 1:
                continue
            x0, x1 = cx - half, cx + half
            for x in range(x0, x1):
                if not (0 <= x < self.W):
                    continue
                left = x < cx
                u = abs(x - cx + 0.5) / max(1.0, half)     # 0 at the ridge, 1 at the flank
                cl = float(hash2(x // 2, y // 2, 127))
                hv = float(hash2(x, y, 117))
                if left:
                    v = 0.82 - 0.55 * u + (cl - 0.5) * 0.35
                    k = int(np.clip(1 + v * 3.2, 1, 4))
                else:
                    v = 0.6 - 0.25 * u + (cl - 0.5) * 0.35
                    k = int(np.clip(v * 3.2, 0, 3))
                    if u < 0.1:
                        k = 0                            # the ridge line, dark side
                # broken strata
                if (y + int(seed)) % 4 == 0 and self.I.noise(np.array(x / 3.0), np.array(y / 4.0), 129) > 0.45:
                    k = max(0, k - 1)
                elif left and (y + int(seed)) % 4 == 3 and hv > 0.6:
                    k = min(4, k + 1)
                if (x, y) in seams:
                    k = 0 if not left else 1
                if hv > 0.96:
                    k = max(0, k - 2)
                col = (lit if left else shd)[k]
                # snow cap, with drips down the gullies
                sl = h * 0.4 + (float(hash2(x, seed, 119)) - 0.5) * 3 + (1.5 if left else -0.5)
                if float(hash2(x, seed, 131)) > 0.75:
                    sl += 2 + float(hash2(x, seed, 133)) * 3
                snow = snowy and i < sl
                if snow:
                    sk = 2
                    if left and u < 0.35:
                        sk = 3
                    if not left:
                        sk = 1 if u < 0.12 else 2
                    if (x, y) in seams:
                        sk = 0
                    if hv > 0.94:
                        sk = 4
                    col = (snow_l if left else snow_r)[sk]
                # foothills: the ground runs a little way up the lower slope
                g = 1.0 + float(self.I.noise(np.array(x / 3.5), np.array(seed), 135)) * 4.0
                if y > base_y - g and foot_alpha[y, x]:
                    col = foot[y, x] * 0.84
                    if y <= base_y - g + 1:
                        col = foot[y, x] * 0.62       # the turf's edge
                elif x == x0 or x == x1 - 1:
                    col = snow_r[0] if snow else shd[0] * 0.9
                self.rgb[y, x] = col
                self.alpha[y, x] = True
                self.mount[y, x] = True
        # the summit pixel
        if 0 <= top < self.H:
            self.rgb[top, cx - 1] = (snow_l if snowy else lit)[3]
            self.alpha[top, cx - 1] = True
        # shadow at the foot, on land only
        for k, m in enumerate((0.72, 0.86)):
            y = base_y + k
            if 0 <= y < self.H:
                for x in range(cx - w // 2 + k, cx + w // 2 - k):
                    if 0 <= x < self.W and self.alpha[y, x] and not self.mount[y, x]:
                        self.rgb[y, x] *= m

    # ---- pass 10: worked ground inside a claim ----
    def claim_ground(self):
        own = self.px_blocks(self.OWN) >= 0
        top = own & self.land & ~self.face & ~self.mount & ~self.riv & ~self.pathmask
        h = hash2(self.BXp, self.BYp, 131)
        # a few dug pits and spoil heaps, one per worked block at most
        pit = top & (h > 0.88) & (self.PX % 3 == 1) & (self.PY % 3 == 1)
        self.rgb[pit] *= 0.5
        self.rgb[shifted(pit, 1, 0, False) & top] *= 0.62
        spoil = shifted(pit, 0, -1, False) & top
        self.put(spoil, '#9a7652', 0.8)
        # the turned earth reads as a faint, uneven darkening
        dark = top & (hash2(self.PX // 2, self.PY // 2, 133) > 0.72)
        self.rgb[dark] *= 0.93

    # ---- pass 11: survey lines and pegs around every claim ----
    def borders(self):
        I = self.I
        own = self.OWN
        cols, rows = I.COLS, I.ROWS
        oat = lambda x, y: int(own[y, x]) if 0 <= x < cols and 0 <= y < rows else -1
        line = np.zeros((self.H, self.W), bool)
        shade = np.zeros((self.H, self.W), bool)
        for y in range(rows):
            for x in range(cols):
                o = int(own[y, x])
                if o < 0:
                    continue
                X, Y = x * 3, y * 3
                if oat(x, y - 1) != o:
                    line[Y, X:X + 3] = True
                    shade[Y + 1, X:X + 3] = True
                if oat(x, y + 1) != o:
                    line[Y + 2, X:X + 3] = True
                    if Y + 3 < self.H:
                        shade[Y + 3, X:X + 3] = True
                if oat(x - 1, y) != o:
                    line[Y:Y + 3, X] = True
                    shade[Y:Y + 3, X + 1] = True
                if oat(x + 1, y) != o:
                    line[Y:Y + 3, X + 2] = True
                    if X + 3 < self.W:
                        shade[Y:Y + 3, X + 3] = True
        shade &= ~line & self.alpha
        self.rgb[shade] *= 0.62
        base = self.rgb[line]
        # a dark cord with a pale fleck every few pixels: readable on sand and grass alike
        cord = base * 0.38 + np.array([22, 16, 8])
        self.rgb[line] = cord
        fleck = line & (((self.PX + self.PY) % 4) == 0)
        self.rgb[fleck] = mix(self.rgb[fleck], rgb('#efe2b6'), 0.55)
        self.alpha |= line
        # pegs where the line turns, and now and then along a straight run
        for y in range(rows):
            for x in range(cols):
                o = int(own[y, x])
                if o < 0:
                    continue
                X, Y = x * 3, y * 3
                up, dn, lf, rt = oat(x, y - 1) != o, oat(x, y + 1) != o, oat(x - 1, y) != o, oat(x + 1, y) != o
                spots = []
                if up and lf:
                    spots.append((X, Y))
                if up and rt:
                    spots.append((X + 2, Y))
                if dn and lf:
                    spots.append((X, Y + 2))
                if dn and rt:
                    spots.append((X + 2, Y + 2))
                open_ = sum(oat(nx, ny) < 0 for nx, ny in ((x, y - 1), (x, y + 1), (x - 1, y), (x + 1, y)))
                if open_ < 2 or hash2(x, y, 141) < 0.45:
                    continue
                for px, py in spots[:1]:
                    self.peg(px, py)

    def peg(self, px, py):
        if not (1 <= py < self.H - 1 and 0 <= px < self.W - 1):
            return
        self.rgb[py - 1, px] = rgb('#f2d27a')
        self.rgb[py, px] = rgb('#8a5a34')
        self.rgb[py + 1, px] = rgb('#5c3d26')
        self.alpha[py - 1:py + 2, px] = True
        if self.alpha[py + 1, px + 1] and not self.face[py + 1, px + 1]:
            self.rgb[py + 1, px + 1] *= 0.6

    def paint(self):
        self.tops()
        self.detail()
        self.shore()
        self.rivers()
        self.paths()
        self.relief()
        self.faces()
        self.round_coast()
        self.mountains()
        self.claim_ground()
        self.borders()
        a = np.dstack([self.rgb.round().clip(0, 255), np.where(self.alpha, 255, 0)]).astype(np.uint8)
        return a


def paint(I):
    """Paint the ground for island module `I`. Returns (rgba array, Ground)."""
    g = Ground(I)
    return g.paint(), g

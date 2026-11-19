"""Gali trailer music: breakcore at 175 BPM with a half-time dubstep drop. Synthesised (numpy), no samples.

Sections, in bars of 4 beats at 175 BPM (1.3714 s a bar):
  intro 4, breakcore 8, light breaks 4, build 2, DROP 12, breakcore 4, outro 4  = 38 bars, about 52 s

    python3 scripts/sfx/trailer-music.py OUT.wav
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 175
BEAT = 60 / BPM
BAR = BEAT * 4
STEP = BEAT / 4
SECTIONS = [('intro', 4), ('break', 8), ('light', 4), ('build', 2), ('drop', 12), ('break2', 4), ('outro', 4)]
TOTAL = sum(n for _, n in SECTIONS) * BAR
rng = np.random.default_rng(175)
N = int(TOTAL * SR) + SR * 2
L = np.zeros(N)
R = np.zeros(N)


def t_(d):
    return np.arange(int(d * SR)) / SR


def lp1(x, a):
    """one-pole low-pass with a fixed coefficient, vectorised by FFT-free recursion via cumulative trick"""
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        y[i] = acc
    return y


def band(x, lo, hi):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X = np.fft.rfft(x)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def put(x, at, g=1.0, pan=0.0):
    i = int(at * SR)
    if i < 0:
        x, i = x[-i:], 0
    j = min(N, i + len(x))
    if j <= i:
        return
    L[i:j] += x[: j - i] * g * (1 - max(0, pan))
    R[i:j] += x[: j - i] * g * (1 + min(0, pan))


# ---------------- drums ----------------
def kick(d=0.38):
    t = t_(d)
    f = 45 + 120 * np.exp(-t / 0.03)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(np.sin(ph) * np.exp(-t / 0.16) * 2.2) + np.exp(-t / 0.003) * rng.normal(0, 0.3, len(t))


def snare(d=0.22, tone=190):
    t = t_(d)
    n = band(rng.normal(0, 1, len(t)), 1200, 9000) * np.exp(-t / 0.07) * 1.4
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.05)
    return np.tanh((n + body * 0.8) * 1.6)


def hat(d=0.04, open_=False):
    d = 0.18 if open_ else d
    t = t_(d)
    return band(rng.normal(0, 1, len(t)), 7000, 16000) * np.exp(-t / (0.06 if open_ else 0.012))


def crash(d=1.6):
    t = t_(d)
    return band(rng.normal(0, 1, len(t)), 3000, 16000) * np.exp(-t / 0.5) * 0.7


KICK, SNARE, HAT, OHAT = kick(), snare(), hat(), hat(open_=True)

# an amen-like 16-step break: K kick, S snare, s ghost snare, h hat
AMEN = ['K', 'h', 'K', 'h', 'S', 'h', 's', 'S', 'h', 'S', 'K', 'K', 'S', 'h', 's', 'S']
AMEN_B = ['K', 'h', 'K', 'h', 'S', 'h', 's', 'S', 'h', 'S', 'K', 'h', 's', 'S', 'h', 's']


def hit(ch, at, g=1.0, pitch=1.0):
    src = {'K': KICK, 'S': SNARE, 's': SNARE, 'h': HAT}[ch]
    if pitch != 1.0:
        idx = np.arange(0, len(src), pitch)
        src = np.interp(idx, np.arange(len(src)), src)
    gain = {'K': 1.0, 'S': 0.85, 's': 0.35, 'h': 0.25}[ch] * g
    put(src, at, gain, rng.uniform(-0.25, 0.25) if ch == 'h' else 0)


def break_bar(t0, intensity=1.0, chopped=True):
    """one bar of chopped breaks: the pattern, with steps repeated, stuttered, pitched or rolled"""
    pat = AMEN if rng.random() < 0.5 else AMEN_B
    for i in range(16):
        at = t0 + i * STEP
        ch = pat[i]
        r = rng.random()
        if chopped and r < 0.12 * intensity:
            # stutter: the step fires as 3 or 4 quick hits
            n = rng.choice([3, 4])
            for k in range(n):
                hit(ch if ch != 'h' else 'S', at + k * STEP / n, 0.7, 1 + k * 0.06)
            continue
        if chopped and r < 0.2 * intensity:
            ch = rng.choice(['K', 'S'])
        hit(ch, at, 1.0, rng.choice([1.0, 1.0, 1.12, 0.92]) if chopped else 1.0)
        if ch != 'h' and rng.random() < 0.5:
            hit('h', at, 0.6)


def snare_roll(t0, bars):
    """a roll that speeds up into the drop: 8ths, 16ths, 32nds, 64ths, rising in pitch and volume"""
    total = bars * BAR
    t = 0.0
    while t < total:
        u = t / total
        div = 2 if u < 0.25 else 4 if u < 0.5 else 8 if u < 0.8 else 16
        hit('S', t0 + t, 0.4 + 0.6 * u, 1 + u * 0.5)
        t += BEAT / div


# ---------------- bass ----------------
NOTE = lambda n: 440 * 2 ** ((n - 69) / 12)
# F minor: F, Db, Eb, C (bass roots per bar, two octaves down)
ROOTS = [29, 25, 27, 24]


def saw(f, d, detune=0.0):
    t = t_(d)
    ph = (f * (1 + detune)) * t
    return 2 * (ph % 1) - 1


def sub(f, d):
    t = t_(d)
    return np.sin(2 * np.pi * f * t) * np.minimum(1, t / 0.005) * np.minimum(1, (d - t) / 0.02)


def wobble(f, d, rate_beats):
    """a dubstep wobble: two detuned saws and a square through a low-pass that an LFO opens and shuts"""
    t = t_(d)
    x = saw(f, d) + saw(f, d, 0.006) * 0.8 + np.sign(np.sin(2 * np.pi * f * 0.5 * t)) * 0.5
    lfo = 0.5 - 0.5 * np.cos(2 * np.pi * t / (BEAT * rate_beats))
    cut = 90 + 3200 * lfo ** 2
    a = 1 - np.exp(-2 * np.pi * cut / SR)
    y = np.empty_like(x)
    s1 = s2 = 0.0
    for i in range(len(x)):
        s1 += a[i] * (x[i] - s1)
        s2 += a[i] * (s1 - s2)
        y[i] = s2
    y = np.tanh(y * 2.6)
    return y * np.minimum(1, t / 0.004) * np.minimum(1, (d - t) / 0.01)


def growl(f, d):
    """a vowel-ish growl: a saw with a formant band sweeping 'yoi'"""
    t = t_(d)
    x = saw(f, d) + saw(f * 2, d, 0.01) * 0.5
    out = np.zeros_like(x)
    seg = 8
    n = len(x)
    for k in range(seg):
        a, b = k * n // seg, (k + 1) * n // seg
        fc = 400 + 1600 * abs(np.sin(np.pi * k / seg * 1.5))
        out[a:b] = band(x, fc * 0.6, fc * 1.6)[a:b]
    return np.tanh(out * 3) * np.minimum(1, (d - t) / 0.01)


def reese(f, d):
    t = t_(d)
    x = saw(f, d) + saw(f, d, 0.012) + saw(f, d, -0.009)
    return np.tanh(band(x, 30, 900) * 0.9) * np.minimum(1, t / 0.02) * np.minimum(1, (d - t) / 0.05)


# ---------------- tops ----------------
def pad(freqs, d):
    t = t_(d)
    x = sum(np.sin(2 * np.pi * f * t + i) + 0.3 * np.sin(2 * np.pi * f * 2.003 * t) for i, f in enumerate(freqs))
    return x / len(freqs) * np.minimum(1, t / 0.6) * np.minimum(1, (d - t) / 0.8)


def riser(d, f0=200, f1=4000):
    t = t_(d)
    n = rng.normal(0, 1, len(t))
    out = np.zeros_like(n)
    seg = 16
    for k in range(seg):
        a, b = k * len(n) // seg, (k + 1) * len(n) // seg
        fc = f0 * (f1 / f0) ** (k / seg)
        out[a:b] = band(n, fc * 0.7, fc * 1.4)[a:b]
    return out * (t / d) ** 2 * 1.5


def impact(d=2.5):
    t = t_(d)
    boom = np.sin(2 * np.pi * np.cumsum(30 + 80 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.7)
    return np.tanh(boom * 1.5) + crash(d) * 0.6


def arp(t0, bars, root, g=0.18):
    seq = [0, 3, 7, 12, 15, 12, 7, 3]
    for b in range(bars):
        for i in range(16):
            n = root + 36 + seq[i % len(seq)] + (12 if b % 2 and i % 8 == 6 else 0)
            d = STEP * 0.9
            t = t_(d)
            x = np.sign(np.sin(2 * np.pi * NOTE(n) * t)) * 0.5 + np.sin(2 * np.pi * NOTE(n) * 2 * t) * 0.3
            put(x * np.exp(-t / 0.06), t0 + (b * 16 + i) * STEP, g, 0.3 if i % 2 else -0.3)


def glitch(t0):
    """a quick tape-stop or stutter fill on the last beat of a phrase"""
    d = BEAT
    seg = t_(STEP)
    x = np.sin(2 * np.pi * 880 * seg) * np.exp(-seg / 0.02)
    for k in range(8):
        put(x, t0 + k * d / 8, 0.25 * (1 - k / 10), (-1) ** k * 0.5)


# ---------------- arrangement ----------------
t = 0.0
for name, bars in SECTIONS:
    if name == 'intro':
        put(pad([NOTE(53), NOTE(56), NOTE(60)], bars * BAR), t, 0.35)
        put(riser(bars * BAR, 120, 6000), t, 0.25)
        for b in range(bars):
            put(KICK, t + b * BAR, 0.6)
            if b >= 2:
                for i in range(8):
                    hit('h', t + b * BAR + i * BEAT / 2, 0.7)
        glitch(t + bars * BAR - BEAT)
    elif name in ('break', 'break2', 'light'):
        for b in range(bars):
            bt = t + b * BAR
            root = ROOTS[b % 4]
            break_bar(bt, 0.6 if name == 'light' else 1.0 + (0.6 if name == 'break2' else 0.2 * b / bars), chopped=True)
            if name == 'light':
                put(sub(NOTE(root), BAR * 0.95), bt, 0.55)
            else:
                put(reese(NOTE(root), BAR * 0.98), bt, 0.42)
                put(sub(NOTE(root), BAR * 0.95), bt, 0.45)
            if b % 4 == 3:
                glitch(bt + BAR - BEAT)
        if name == 'light':
            arp(t, bars, 53)
            put(pad([NOTE(65), NOTE(68), NOTE(72)], bars * BAR), t, 0.22)
        if name == 'break':
            put(crash(), t, 0.8)
            arp(t + 4 * BAR, 4, 53, 0.12)
    elif name == 'build':
        snare_roll(t, bars)
        put(riser(bars * BAR, 300, 9000), t, 0.5)
        tt = t_(bars * BAR)
        put(np.sin(2 * np.pi * np.cumsum(NOTE(41) * (1 + 3 * (tt / tt[-1]) ** 2)) / SR) * 0.3, t, 0.5)
    elif name == 'drop':
        put(impact(), t, 1.0)
        rates = [1, 0.5, 1 / 3, 0.25]
        for b in range(bars):
            bt = t + b * BAR
            root = ROOTS[(b // 2) % 4]
            # half-time: kick on 1 (and the and of 2), snare on 3
            put(KICK, bt, 1.0)
            put(KICK, bt + BEAT * 1.5, 0.8)
            put(SNARE, bt + BEAT * 2, 1.0)
            if b % 2:
                put(KICK, bt + BEAT * 3.25, 0.7)
            for i in range(8):
                hit('h', bt + i * BEAT / 2, 0.8)
            put(OHAT, bt + BEAT * 3.5, 0.35)
            # the bass: wobbles at changing rates, a growl on every 4th bar
            if b % 4 == 3:
                put(growl(NOTE(root + 12), BAR * 0.5), bt, 0.5)
                put(wobble(NOTE(root + 12), BAR * 0.5, 0.125), bt + BAR * 0.5, 0.55)
            else:
                put(wobble(NOTE(root + 12), BAR * 0.97, rates[b % 4]), bt, 0.6)
            put(sub(NOTE(root), BAR * 0.97), bt, 0.55)
            if b == bars // 2:
                put(crash(), bt, 0.7)
                snare_roll(bt - BAR * 0.5, 0.5)
    elif name == 'outro':
        put(impact(3.5), t, 0.9)
        put(pad([NOTE(53), NOTE(56), NOTE(60), NOTE(65)], bars * BAR), t, 0.4)
        for b in range(2):
            break_bar(t + b * BAR, 0.4, chopped=False)
        put(sub(NOTE(29), BAR * 2), t, 0.5)
    t += bars * BAR

# ---------------- master ----------------
end = int(TOTAL * SR)
L, R = L[:end], R[:end]
m = max(np.max(np.abs(L)), np.max(np.abs(R)))
L, R = np.tanh(L / m * 1.6) * 0.92, np.tanh(R / m * 1.6) * 0.92
fade = np.minimum(1, (end - np.arange(end)) / (SR * 1.2))
L, R = L * fade, R * fade
data = (np.stack([L, R], 1) * 32767).astype(np.int16)
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print(f'{TOTAL:.2f}s', 'bar', round(BAR, 4))

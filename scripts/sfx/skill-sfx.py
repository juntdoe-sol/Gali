"""Fight Club skill sounds: one per skill, plus a few hit sounds by element.

Every skill's sound is built so its impact lands when the skill's hitbox comes out: the wind-up (whoosh, charge, fuse,
rumble) fills the skill's start frames, then the hit (boom, crack, splash, clang) plays at start / 60 s. The engine plays
the file the moment the skill starts, so sound and picture stay together. Synthesised from noise, sines and envelopes,
like the other effects (32 kHz mono 16-bit).

    python3 scripts/sfx/skill-sfx.py

Writes app/assets/sfx/skill-<id>.wav for every skill and hit-<kind>.wav for fire, ice, shock, gold, rock and cut.
"""
import json
import os
import wave

import numpy as np

SR = 32000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'app', 'assets', 'sfx')
# start, active, end frames at 60 fps (game/brawl2/sim.ts SKILLS)
FRAMES = {
    'quake': [11, 6, 24], 'rush': [8, 10, 12], 'moon': [7, 8, 26], 'whirl': [5, 16, 18], 'dive': [6, 20, 12],
    'guard': [1, 32, 14], 'grab': [6, 4, 22], 'dynamite': [18, 5, 16], 'magnet': [10, 5, 18], 'tunnel': [24, 5, 22],
    'geyser': [14, 8, 16], 'cavein': [20, 7, 18], 'slide': [6, 12, 10], 'boomerang': [12, 10, 18], 'sonar': [13, 6, 14],
    'boulder': [8, 14, 12], 'meteor': [10, 16, 20], 'drill': [5, 16, 12], 'inferno': [16, 10, 18], 'jade': [10, 14, 20],
    'taiji': [18, 8, 18], 'thunder': [20, 5, 16], 'pillar': [18, 10, 16],
}
rng = np.random.default_rng(7)


# ---------------- building blocks ----------------
def sec(n):
    return int(n * SR)


def tl(d):
    return np.arange(sec(d)) / SR


def noise(d):
    return rng.normal(0, 1, sec(d))


def band(x, lo, hi):
    """Band-pass by FFT: keep lo..hi Hz, soft edges."""
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X = np.fft.rfft(x)
    w = np.clip((f - lo * 0.7) / (lo * 0.3 + 1), 0, 1) * np.clip((hi * 1.3 - f) / (hi * 0.3 + 1), 0, 1)
    return np.fft.irfft(X * w, len(x))


def lp(x, hi):
    return band(x, 0.01, hi)


def hp(x, lo):
    return band(x, lo, SR / 2 - 1)


def env(n, a, d, sustain=0.0, r=None):
    """attack a s, decay d s (exponential), optional hold level"""
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * ((1 - sustain) * np.exp(-np.maximum(0, t - a) / max(d, 1e-4)) + sustain)
    if r:
        e *= np.clip((n / SR - t) / r, 0, 1)
    return e


def norm(x, peak=1.0):
    m = np.max(np.abs(x))
    return x / m * peak if m > 0 else x


def place(buf, x, at, gain=1.0):
    i = sec(at)
    if i < 0:
        x, i = x[-i:], 0
    if i >= len(buf) or len(x) == 0:
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i] * gain


def sweep(d, f0, f1, shape='sin'):
    t = tl(d)
    f = f0 * (f1 / f0) ** (t / d)
    ph = 2 * np.pi * np.cumsum(f) / SR
    if shape == 'saw':
        return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if shape == 'sq':
        return np.sign(np.sin(ph))
    return np.sin(ph)


def whoosh(d, f0, f1, width=0.5):
    """band-passed noise whose centre slides from f0 to f1, swelling then fading"""
    n = sec(d)
    x = noise(d)
    out = np.zeros(n)
    steps = 12
    for k in range(steps):
        a, b = k * n // steps, (k + 1) * n // steps
        fc = f0 * (f1 / f0) ** (k / (steps - 1))
        seg = band(x, fc * (1 - width), fc * (1 + width))[a:b]
        out[a:b] = seg
    t = np.arange(n) / n
    return out * np.sin(np.pi * t) ** 1.5


def boom(d=0.8, f0=110, f1=38, grit=0.5):
    t = tl(d)
    body = sweep(d, f0, f1) * np.exp(-t / (d * 0.35))
    crack = hp(noise(d), 1500) * np.exp(-t / 0.03)
    rumble = lp(noise(d), 260) * 4 * np.exp(-t / (d * 0.4))
    return body * 1.0 + crack * 0.5 + rumble * grit


def crackle(d, rate=60, bright=3000):
    n = sec(d)
    x = np.zeros(n)
    for _ in range(int(rate * d)):
        i = rng.integers(0, n - 200)
        m = rng.integers(20, 120)
        x[i:i + m] += rng.normal(0, 1, m) * np.hanning(m) * rng.uniform(0.3, 1)
    return hp(x, bright * 0.5)


def roar(d, lo=150, hi=1400):
    """fire: a roaring band of noise that breathes"""
    t = tl(d)
    x = band(noise(d), lo, hi) * 2.5
    am = 0.7 + 0.3 * np.sin(2 * np.pi * 7 * t + rng.uniform(0, 6)) * np.sin(2 * np.pi * 3.1 * t)
    return x * am


def bell(d, f, partials=(1, 2.76, 5.4, 8.93), decay=0.6, detune=0.0):
    t = tl(d)
    x = np.zeros(len(t))
    for i, p in enumerate(partials):
        x += np.sin(2 * np.pi * f * p * (1 + detune * i) * t) * np.exp(-t / (decay / (1 + i * 0.8))) / (1 + i)
    return x


def zap(d, f=180):
    """electric buzz: a square wave that jumps pitch, with crackle on top"""
    n = sec(d)
    x = np.zeros(n)
    i = 0
    while i < n:
        m = int(rng.uniform(0.008, 0.03) * SR)
        ff = f * rng.uniform(0.6, 1.8)
        tt = np.arange(m) / SR
        x[i:i + m] = np.sign(np.sin(2 * np.pi * ff * tt))[: n - i]
        i += m
    return band(x, 120, 5000) * 0.5 + crackle(d, 200, 4000) * 1.5


def thud(d=0.25, f=70):
    t = tl(d)
    return sweep(d, f * 1.6, f) * np.exp(-t / 0.06) + lp(noise(d), 400) * 2 * np.exp(-t / 0.04)


def chime(notes, step=0.07, d=0.9):
    out = np.zeros(sec(step * len(notes) + d))
    for i, f in enumerate(notes):
        place(out, bell(d, f, (1, 2, 3.01, 4.2), 0.35), i * step, 0.6)
    return out


def reverb(x, size=0.5, mix=0.3):
    ir = rng.normal(0, 1, sec(size)) * np.exp(-tl(size) / (size * 0.25))
    ir[0] = 0
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + len(ir)) * np.fft.rfft(ir, len(x) + len(ir)))[: len(x)]
    return x + norm(wet, np.max(np.abs(x))) * mix


def mix(*xs):
    """sum sounds of different lengths"""
    n = max(len(x) for x in xs)
    out = np.zeros(n)
    for x in xs:
        out[: len(x)] += x
    return out


def blank(d):
    return np.zeros(sec(d))


# ---------------- the skills ----------------
def build(k):
    s, a, e = FRAMES[k]
    T, A = s / 60, a / 60
    L = T + A + 1.2
    b = blank(L)
    if k == 'moon':
        place(b, whoosh(T + 0.25, 400, 2600, 0.5) * 2.2, 0)
        place(b, chime([880, 1320, 1760], 0.04, 0.6), T)
        place(b, thud(0.2, 90), T, 0.8)
    elif k == 'rush':
        place(b, zap(T, 140) * env(sec(T), T * 0.8, 1), 0, 0.5)
        place(b, whoosh(A + 0.25, 1800, 500, 0.6) * 2.5, T)
        place(b, zap(A, 300) * env(sec(A), 0.005, A * 0.5), T, 0.6)
    elif k == 'quake':
        place(b, lp(noise(T), 120) * 4 * env(sec(T), T, 1), 0)
        place(b, boom(1.0, 120, 34, 0.9), T, 1.2)
        place(b, crackle(0.6, 80, 1500) * env(sec(0.6), 0.01, 0.25), T + 0.03, 0.8)
    elif k == 'whirl':
        for i in range(3):
            place(b, whoosh(0.22, 600, 2200, 0.4) * 2, T * 0.5 + i * A / 3)
        place(b, crackle(A, 40, 5000), T, 0.4)
    elif k == 'dive':
        place(b, roar(T + A, 200, 1600) * np.linspace(0.3, 1, sec(T + A)), 0, 0.8)
        place(b, whoosh(T + A, 1600, 300, 0.5) * 1.5, 0)
        place(b, boom(0.7, 100, 40, 0.5) + roar(0.7, 300, 2500) * env(sec(0.7), 0.005, 0.25) * 1.5, T + A)
    elif k == 'guard':
        place(b, bell(A + 0.6, 1046, (1, 2.4, 3.9, 6.1), 0.9, 0.002) * 0.8, 0)
        place(b, bell(A + 0.6, 1568, (1, 2.4, 3.9), 0.7, 0.003) * 0.5, 0.03)
        place(b, hp(noise(A), 6000) * 0.3 * env(sec(A), 0.02, A * 0.6), 0)
    elif k == 'grab':
        place(b, whoosh(T + 0.1, 900, 1800, 0.5) * 1.6, 0)
        place(b, thud(0.3, 75), T, 1.2)
    elif k == 'dynamite':
        fuse = hp(noise(T), 3000) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 23 * tl(T))))
        place(b, fuse * 0.6 + crackle(T, 120, 5000) * 0.8, 0)
        place(b, boom(1.1, 130, 30, 1.0) + roar(1.1, 200, 3000) * env(sec(1.1), 0.003, 0.3) * 2, T, 1.2)
    elif k == 'magnet':
        place(b, sweep(T + A, 90, 240, 'saw') * 0.25 * env(sec(T + A), T, 1), 0)
        for i in range(8):
            place(b, bell(0.08, rng.uniform(2200, 3400), (1, 2.7, 5.1), 0.03) * 0.6, T * 0.8 + i * 0.022)
        place(b, zap(A + 0.15, 220) * env(sec(A + 0.15), 0.005, 0.12), T, 0.6)
        place(b, bell(0.4, 620, (1, 2.76, 5.4), 0.15), T + A + 0.05, 0.8)
    elif k == 'tunnel':
        for i in range(6):
            place(b, band(noise(0.09), 300, 1800) * env(sec(0.09), 0.005, 0.03) * 2, i * T / 6)
        place(b, mix(thud(0.3, 60), crackle(0.4, 90, 1200) * 0.8), T, 1.1)
    elif k == 'geyser':
        n = sec(T)
        bub = np.zeros(n)
        for i in range(14):
            place(bub, sweep(0.05, rng.uniform(300, 600), rng.uniform(900, 1600)) * np.hanning(sec(0.05)), rng.uniform(0, T * 0.9), 0.5)
        place(b, bub + lp(noise(T), 200) * env(n, T, 1) * 2, 0)
        splash = hp(noise(0.8), 900) * env(sec(0.8), 0.004, 0.25) * 1.6 + whoosh(0.8, 500, 3000, 0.6) * 1.5
        place(b, splash, T, 1.1)
    elif k == 'cavein':
        for i in range(5):
            at = T * 0.4 + i * 0.06
            place(b, sweep(0.25, 1600, 700) * 0.12 * np.hanning(sec(0.25)), at - 0.15)
            place(b, mix(thud(0.25, rng.uniform(55, 85)), crackle(0.2, 60, 1500) * 0.6), at + 0.1, 0.8)
        place(b, lp(noise(0.8), 220) * 3 * env(sec(0.8), 0.02, 0.3), T)
    elif k == 'slide':
        scrape = band(noise(A + 0.1), 800, 3500) * (0.7 + 0.3 * np.sin(2 * np.pi * 40 * tl(A + 0.1)))
        place(b, scrape * env(sec(A + 0.1), 0.01, A, 0.6, 0.06) * 1.6, T)
        place(b, crackle(A, 140, 5000), T, 0.9)
    elif k == 'boomerang':
        d = A + 0.5
        whir = band(noise(d), 500, 2400) * (0.4 + 0.6 * np.abs(np.sin(2 * np.pi * 14 * tl(d))))
        place(b, whir * np.sin(np.pi * np.linspace(0, 1, sec(d))) * 2, T)
        place(b, bell(0.15, 1900, (1, 2.7), 0.05), T + d - 0.05, 0.5)
    elif k == 'sonar':
        place(b, sweep(T, 200, 520) * 0.4 * env(sec(T), T, 1), 0)
        for i in range(3):
            place(b, bell(0.7, 1240, (1, 2.01), 0.25) * (0.9 ** i), T + i * 0.12, 0.6)
        place(b, thud(0.35, 55), T, 0.9)
    elif k == 'boulder':
        d = A + 0.25
        roll = lp(noise(d), 300) * 4 * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * tl(d)))
        place(b, roll * env(sec(d), 0.03, d, 0.7, 0.1), T * 0.7)
        for i in range(5):
            place(b, crackle(0.08, 300, 1200), T * 0.7 + i * d / 5, 0.6)
    elif k == 'meteor':
        place(b, roar(T + A, 180, 2200) * np.linspace(0.4, 1, sec(T + A)) * 1.2, 0)
        place(b, whoosh(T + A, 900, 260, 0.6) * 2, 0)
        place(b, mix(boom(1.2, 120, 28, 1.0), roar(1.0, 200, 3000) * env(sec(1.0), 0.004, 0.35) * 2), T + A, 1.2)
    elif k == 'drill':
        d = A + 0.15
        whine = sweep(d, 520, 900, 'saw') * (1 + 0.05 * np.sin(2 * np.pi * 30 * tl(d)))
        place(b, band(whine, 300, 4000) * env(sec(d), 0.01, d, 0.8, 0.05) * 0.5, T * 0.5)
        place(b, crackle(d, 160, 3000), T, 0.9)
    elif k == 'inferno':
        d = A + 1.0
        place(b, whoosh(T, 300, 1200, 0.5) * 1.2, 0)
        place(b, roar(d, 120, 1800) * env(sec(d), 0.05, 0.6, 0.0, 0.3) * 1.6, T * 0.8)
        place(b, crackle(d, 90, 2000) * env(sec(d), 0.05, 0.7), T * 0.8, 1.2)
        place(b, boom(0.6, 90, 40, 0.3), T, 0.6)
    elif k == 'jade':
        for i in range(4):
            place(b, whoosh(0.25, 700, 2600, 0.35) * 1.8, T * 0.5 + i * A / 4)
        place(b, chime([1175, 1568, 2093, 2637], 0.05, 0.8), T, 0.8)
    elif k == 'taiji':
        place(b, bell(1.8, 98, (1, 2.01, 2.76, 4.1), 1.2, 0.001) * 1.2, 0)
        place(b, hp(noise(T), 5000) * 0.25 * env(sec(T), T, 1), 0)
        ice = mix(bell(0.5, 2400, (1, 2.3, 3.7), 0.18), hp(noise(0.3), 4000) * env(sec(0.3), 0.002, 0.05) * 1.5)
        place(b, ice, T, 0.9)
        place(b, chime([1568, 2093, 2794], 0.05, 0.9), T + 0.05, 0.5)
    elif k == 'thunder':
        place(b, zap(T, 160) * np.linspace(0.1, 1, sec(T)) * 0.6, 0)
        place(b, sweep(T, 300, 2400) * 0.15 * np.linspace(0, 1, sec(T)), 0)
        crack = hp(noise(0.25), 1200) * env(sec(0.25), 0.001, 0.05) * 3
        place(b, mix(crack, boom(1.3, 90, 30, 1.2)), T, 1.3)
    elif k == 'pillar':
        t = tl(T + A + 0.6)
        choir = sum(np.sin(2 * np.pi * f * (1 + 0.003 * np.sin(2 * np.pi * 5 * t + i)) * t) / (1 + i * 0.5)
                    for i, f in enumerate((523, 659, 784, 1046)))
        place(b, choir * env(len(t), T, 0.5, 0.6, 0.4) * 0.35, 0)
        place(b, boom(0.9, 100, 40, 0.4), T, 1.0)
        place(b, chime([2093, 2637, 3136], 0.04, 0.9), T, 0.6)
    return reverb(b, 0.45, 0.22)


def hits():
    return {
        'fire': mix(roar(0.45, 200, 3000) * env(sec(0.45), 0.003, 0.15) * 1.5, thud(0.3, 80)),
        'ice': mix(bell(0.5, 2600, (1, 2.3, 3.7), 0.15), hp(noise(0.2), 3500) * env(sec(0.2), 0.001, 0.04) * 2),
        'shock': zap(0.3, 260) * env(sec(0.3), 0.002, 0.1) * 1.5,
        'gold': mix(chime([1568, 2349], 0.03, 0.5), thud(0.25, 90)),
        'rock': mix(thud(0.35, 65), crackle(0.3, 100, 1200)),
        'cut': mix(hp(noise(0.15), 2500) * env(sec(0.15), 0.001, 0.04) * 2, thud(0.2, 110) * 0.7),
    }


def write(name, x, peak):
    x = norm(x, peak)
    n = len(x)
    x *= np.minimum(1, (n - np.arange(n)) / (0.03 * SR))
    data = (x * 32767).astype(np.int16)
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    return len(data) / SR


if __name__ == '__main__':
    for k in FRAMES:
        d = write(f'skill-{k}.wav', build(k), 0.5)
        print(f'skill-{k}.wav {d:.2f}s')
    for k, x in hits().items():
        write(f'hit-{k}.wav', x, 0.42)
        print(f'hit-{k}.wav')
    print(json.dumps(sorted(FRAMES)))

"""GALI in 30 seconds: an original chiptune score and sound effects, synthesised
from nothing (square, triangle and noise channels, like the consoles the art is
borrowing from). Every hit lands on the video's cues.

    python3 soundtrack.py out.wav
"""
import sys
import numpy as np

SR = 44100
DUR = 35.0
BPM = 120
BEAT = 60 / BPM
N = int(SR * DUR)
L = np.zeros(N)
R = np.zeros(N)
rng = np.random.default_rng(7)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a=0.005, d=0.1, s=0.6, r=0.05, hold=None):
    """ADSR over n samples."""
    t = np.arange(n) / SR
    total = n / SR
    hold = total - r if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-6), s))
    e = np.where(t > hold, e * np.clip(1 - (t - hold) / max(r, 1e-6), 0, 1), e)
    return e


def put(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * gain * (1 + min(0, pan))


def square(f, dur, duty=0.5, vib=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ph = np.cumsum(np.full(n, f) * (1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.clip(t * 3, 0, 1)) / SR)
    return np.where((ph % 1) < duty, 1.0, -1.0)


def tri(f, dur):
    n = int(dur * SR)
    ph = (np.arange(n) * f / SR) % 1
    return 4 * np.abs(ph - 0.5) - 1


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR))


def lowpass(x, k):
    """One-pole low-pass; k in (0,1], smaller is darker."""
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += k * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, k):
    return x - lowpass(x, k)


# ---------------- drums ----------------
def kick(at, g=0.9):
    d = 0.32
    n = int(d * SR)
    t = np.arange(n) / SR
    f = 45 + 120 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    s += 0.25 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * np.exp(-t * 40)
    put(s, at, g)


def snare(at, g=0.45):
    d = 0.22
    t = np.arange(int(d * SR)) / SR
    s = highpass(noise(d), 0.35) * np.exp(-t * 18) + 0.4 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30)
    put(s, at, g)


HAT = highpass(noise(0.06), 0.8) * np.exp(-np.arange(int(0.06 * SR)) / SR * 70)


def hat(at, g=0.14, pan=0.3):
    put(HAT, at, g, pan)


def crash(at, g=0.35, d=1.8):
    t = np.arange(int(d * SR)) / SR
    s = highpass(noise(d), 0.6) * np.exp(-t * 2.4)
    put(s, at, g * 0.8, -0.3)
    put(s[::-1][::-1], at + 0.012, g * 0.8, 0.3)


def boom(at, g=0.9):
    d = 1.4
    t = np.arange(int(d * SR)) / SR
    f = 38 + 80 * np.exp(-t * 6)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.8)
    put(s, at, g)


def whoosh(at, d=0.6, up=True, g=0.35):
    n = int(d * SR)
    t = np.arange(n) / SR
    x = noise(d)
    k = np.linspace(0.02, 0.5, n) if up else np.linspace(0.5, 0.02, n)
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.5
    put(y * e * 2.2, at, g, -0.4)
    put(y * e * 2.2, at + 0.02, g, 0.4)


def riser(at, d, g=0.25):
    n = int(d * SR)
    t = np.arange(n) / SR
    x = noise(d)
    k = np.linspace(0.01, 0.6, n) ** 1.5
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    put(y * (t / d) ** 2 * 2.5, at, g)


def roll(start, end, g=0.35):
    t = start
    step = 0.125
    while t < end:
        k = (t - start) / (end - start)
        snare(t, g * (0.3 + 0.7 * k))
        step = 0.125 if k < 0.5 else 0.0625
        t += step


# ---------------- tones ----------------
def note(m, at, dur, g=0.12, duty=0.5, pan=0.0, vib=0.004, rel=0.06):
    s = square(midi(m), dur + rel, duty, vib) * env(int((dur + rel) * SR), 0.004, 0.08, 0.7, rel, hold=dur)
    put(s, at, g, pan)


def bass(m, at, dur, g=0.3):
    s = tri(midi(m), dur) * env(int(dur * SR), 0.003, 0.05, 0.85, 0.03)
    put(s, at, g)


def blip(at, f=1400, d=0.05, g=0.12):
    t = np.arange(int(d * SR)) / SR
    put(np.sign(np.sin(2 * np.pi * f * t)) * np.exp(-t * 60), at, g)


def clink(at, g=0.22):
    """A pickaxe on rock: two inharmonic partials and a spit of noise."""
    d = 0.25
    t = np.arange(int(d * SR)) / SR
    s = (np.sin(2 * np.pi * 2350 * t) + 0.6 * np.sin(2 * np.pi * 3710 * t)) * np.exp(-t * 26)
    s += highpass(noise(d), 0.5) * np.exp(-t * 60) * 0.6
    put(s, at, g, rng.uniform(-0.3, 0.3))


def coin(at, g=0.12, base=83):
    note(base, at, 0.06, g, 0.25)
    note(base + 5, at + 0.06, 0.18, g, 0.25)


def pad(ms, at, dur, g=0.05):
    for k, m in enumerate(ms):
        s = square(midi(m), dur, 0.3, 0.006) + square(midi(m) * 1.004, dur, 0.3)
        s = lowpass(s, 0.12) * env(int(dur * SR), 0.25, 0.2, 0.8, 0.4)
        put(s, at, g, (-0.4, 0.4, 0)[k % 3])


# ---------------- the score ----------------
# C minor, i - VI - III - VII, one chord a bar (2 s)
CHORDS = [(48, [60, 63, 67]), (44, [56, 60, 63]), (51, [58, 63, 67]), (46, [58, 62, 65])]
HOOK = [  # (beat, beats, midi) over two bars
    (0, 0.5, 67), (0.5, 0.5, 67), (1, 0.5, 70), (1.5, 1.0, 72), (2.5, 0.5, 70), (3, 1, 67),
    (4, 0.5, 65), (4.5, 0.5, 67), (5, 0.5, 70), (5.5, 0.5, 67), (6, 1.5, 63), (7.5, 0.5, 65),
]
HOOK2 = [
    (0, 0.5, 72), (0.5, 0.5, 72), (1, 0.5, 75), (1.5, 1.0, 77), (2.5, 0.5, 75), (3, 1, 72),
    (4, 0.5, 70), (4.5, 0.5, 72), (5, 0.5, 75), (5.5, 0.5, 79), (6, 2, 84),
]


def chord_at(t):
    return CHORDS[int(t / 2) % 4]


def groove(start, end, drums=True, hats=True, bassline=True, lead=None, arps=False, half=False):
    t = start
    while t < end - 1e-6:
        b = round((t - start) / BEAT)
        root, tones = chord_at(t)
        if drums:
            if half:
                if b % 4 == 0:
                    kick(t)
                if b % 4 == 2:
                    snare(t)
            else:
                kick(t, 0.85)
                if b % 2 == 1:
                    snare(t)
        if hats:
            hat(t, 0.13)
            hat(t + BEAT / 2, 0.09, -0.3)
        if bassline:
            bass(root - 12, t, BEAT / 2 - 0.02, 0.32)
            bass(root - 12 + (12 if b % 2 else 7), t + BEAT / 2, BEAT / 2 - 0.02, 0.26)
        if arps:
            for k in range(4):
                note(tones[k % 3] + 12, t + k * BEAT / 4, BEAT / 4 - 0.02, 0.035, 0.25, 0.5 if k % 2 else -0.5, 0, 0.02)
        t += BEAT
    if lead:
        bar0 = start
        while bar0 < end - 1e-6:
            for bt, ln, m in lead:
                at = bar0 + bt * BEAT
                if at < end:
                    note(m, at, ln * BEAT - 0.03, 0.085, 0.5, 0.15)
                    note(m, at + 0.18, ln * BEAT - 0.03, 0.025, 0.5, -0.4)  # echo
            bar0 += 8 * BEAT


def pads(start, end, g=0.045):
    t = start
    while t < end - 1e-6:
        root, tones = chord_at(t)
        pad(tones, t, min(2.0, end - t), g)
        t += 2.0


# 0 - 2: the logo builds out of pixels
riser(0.0, 2.0, 0.22)
for k in range(16):
    root, tones = CHORDS[0]
    note(tones[k % 3] + 12 + (12 if k >= 8 else 0), k * 0.125, 0.1, 0.02 + 0.04 * k / 16, 0.25, 0.5 if k % 2 else -0.5, 0, 0.02)
roll(1.25, 2.0, 0.3)
# 2.0: the pickaxe hits the logo
kick(2.0, 1.0); boom(2.0, 0.8); crash(2.0, 0.4); clink(2.0, 0.35)
for m in (48, 55, 60, 63, 67):
    note(m, 2.0, 0.9, 0.05, 0.5, 0, 0.0, 0.5)
groove(2.0, 4.0, half=True, hats=True, bassline=True)
pads(2.0, 4.0, 0.035)
# 4.0: into the island
whoosh(3.7, 0.6, True, 0.4); crash(4.0, 0.25)
groove(4.0, 12.0, lead=HOOK, arps=False)
pads(4.0, 12.0, 0.03)
# the claims ping in a wave
for k in range(25):
    blip(6.1 + k * 0.045, 900 + k * 40, 0.03, 0.05)
# 01: taps
for at in (8.25, 8.65, 9.05, 9.45, 9.85):
    blip(at, 1600, 0.04, 0.12)
    blip(at + 0.05, 2400, 0.03, 0.06)
# 02: SOL lands on five claims
for k in range(5):
    coin(10.3 + k * 0.08, 0.09, 83 + k * 2)
# 12 - 13.5: the countdown, everything else steps back
for k, at in enumerate((12.0, 12.5, 13.0)):
    note(81 if k < 2 else 88, at, 0.12, 0.12, 0.5)
    kick(at, 0.6)
    bass(36, at, 0.4, 0.3)
kick(13.45, 0.9); snare(13.45, 0.5)
# 13.6 - 15.5: the island shakes
t = np.arange(int(1.9 * SR)) / SR
put(lowpass(noise(1.9), 0.02) * 6 * (t / 1.9), 13.6, 0.5)
riser(13.6, 1.9, 0.3)
roll(14.5, 15.5, 0.35)
# 15.5: STRUCK GOLD
kick(15.5, 1.0); boom(15.5, 0.9); crash(15.5, 0.45, 2.4)
for k, m in enumerate((60, 63, 67, 72, 75, 79, 84)):
    note(m, 15.5 + k * 0.06, 0.5 - k * 0.03, 0.08, 0.25, 0.3 if k % 2 else -0.3)
for k in range(36):
    coin(15.6 + rng.uniform(0, 1.0), 0.035, 84 + int(rng.integers(0, 12)))
groove(15.5, 17.0, lead=None, arps=True)
pads(15.5, 17.0, 0.035)
# 17.0: the dive
whoosh(16.75, 0.5, False, 0.45)
# 17 - 22: underground
groove(17.25, 22.0, drums=True, hats=True, bassline=True, lead=None, arps=False, half=True)
pads(17.25, 22.0, 0.03)
t0 = 18.9
while t0 < 21.8:
    clink(t0, 0.16)
    t0 += 0.54
# 20.95: the motherlode fills
kick(20.95, 0.9); crash(20.95, 0.3)
for k, m in enumerate((72, 75, 79, 84, 87, 91)):
    note(m, 20.95 + k * 0.05, 0.3, 0.05, 0.25)
# 22.0: back up; the day turns
whoosh(21.75, 0.5, True, 0.4); crash(22.0, 0.25)
pads(22.0, 24.2, 0.05)
groove(22.0, 24.2, drums=False, hats=False, bassline=True, arps=True)
# 24.2 - 28.0: gear up, one pop per item, a shimmer as the glint runs across
groove(24.2, 28.0, lead=HOOK2, arps=False)
for row, n in enumerate((6, 6, 5, 4)):
    for col in range(n):
        blip(24.55 + row * 0.32 + col * 0.07, 700 + (row * 6 + col) * 45, 0.04, 0.06)
for k in range(21):
    note(84 + (k % 5) * 2, 26.1 + k * 0.07, 0.05, 0.02, 0.25, 0.5 if k % 2 else -0.5, 0, 0.03)
# 28.0: the logo returns
riser(27.8, 0.8, 0.25); roll(28.1, 28.6, 0.3)
whoosh(27.9, 0.5, True, 0.35)
kick(28.6, 1.0); boom(28.6, 0.8); crash(28.6, 0.4, 2.6)
groove(28.6, 32.6, lead=None, arps=True, half=True)
pads(28.6, 32.6, 0.035)
# one accent under each line of the promise
for at, m in ((29.3, 60), (30.0, 63), (30.7, 67)):
    for d in (0, 7, 12):
        note(m + d, at, 0.35, 0.04, 0.5)
    kick(at, 0.5)
coin(31.5, 0.09, 88)
# the last chord rings out
for m in (48, 55, 60, 63, 67, 74):
    pad([m], 32.6, 2.4, 0.05)
for k, m in enumerate((72, 75, 79, 84)):
    note(m, 32.6 + k * 0.1, 0.8, 0.05, 0.25)
crash(32.6, 0.2, 2.4)

# ---------------- master ----------------
mix = np.stack([L, R], axis=1)
fade = np.clip((DUR - np.arange(N) / SR) / 0.8, 0, 1)
mix *= fade[:, None]
mix = np.tanh(mix * 1.1)  # gentle saturation, keeps the peaks round
mix /= np.max(np.abs(mix)) / 0.89
pcm = (mix * 32767).astype(np.int16)
import wave

with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'soundtrack.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote', len(pcm) / SR, 's')

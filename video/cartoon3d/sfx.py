"""
Score and sound effects for the Gali 3D cartoon, synthesised from scratch (stdlib only, nothing sampled).
Event times are frames at 24 fps and match build_scene.py.

    python3 sfx.py out/gali_cartoon.wav
"""
import math, random, struct, sys, wave

SR, FPS, DUR = 44100, 24, 10.0
N = int(SR * DUR)
L = [0.0] * N
R = [0.0] * N
random.seed(3)
TAU = 2 * math.pi

def add(t0, samples, gain=1.0, pan=0.0):
    i0 = int(t0 * SR)
    gl, gr = gain * (1 - pan) / 1.0, gain * (1 + pan) / 1.0
    gl, gr = gl * 0.7, gr * 0.7
    for k, v in enumerate(samples):
        i = i0 + k
        if 0 <= i < N:
            L[i] += v * gl
            R[i] += v * gr

def fr(frame):
    return frame / FPS

def note_hz(semi_from_a4):
    return 440.0 * 2 ** (semi_from_a4 / 12)

# ------------------------------------------------------------------ instruments
def marimba(hz, dur=0.6):
    n = int(dur * SR)
    out = []
    for k in range(n):
        t = k / SR
        v = math.sin(TAU * hz * t) * math.exp(-t * 7) + 0.35 * math.sin(TAU * hz * 4 * t) * math.exp(-t * 28)
        out.append(v * min(1, k / 40))
    return out

def bass(hz, dur=0.5):
    n = int(dur * SR)
    return [(math.sin(TAU * hz * k / SR) + 0.25 * math.sin(TAU * hz * 2 * k / SR)) * math.exp(-k / SR * 4) * min(1, k / 80)
            for k in range(n)]

def thump(dur=0.18, f0=110, f1=45):
    n, ph, out = int(dur * SR), 0.0, []
    for k in range(n):
        t = k / SR
        f = f1 + (f0 - f1) * math.exp(-t * 30)
        ph += TAU * f / SR
        out.append((math.sin(ph) + 0.15 * (random.random() * 2 - 1)) * math.exp(-t * 22))
    return out

def whoosh(dur=0.24):
    n, y, out = int(dur * SR), 0.0, []
    for k in range(n):
        t = k / n
        a = 0.02 + 0.25 * math.sin(math.pi * t)        # filter opens then closes
        y += a * ((random.random() * 2 - 1) - y)
        out.append(y * math.sin(math.pi * t) ** 1.5 * 1.8)
    return out

def clink(dur=0.5):
    parts = [(2120, 18), (3180, 22), (4710, 28), (6230, 36)]
    n = int(dur * SR)
    out = []
    for k in range(n):
        t = k / SR
        v = sum(math.sin(TAU * f * t) * math.exp(-t * d) / (i + 1) for i, (f, d) in enumerate(parts))
        if k < 250:
            v += (random.random() * 2 - 1) * (1 - k / 250)
        out.append(v)
    return out

def boom(dur=1.4):
    n, ph, y, out = int(dur * SR), 0.0, 0.0, []
    for k in range(n):
        t = k / SR
        f = 32 + 110 * math.exp(-t * 9)
        ph += TAU * f / SR
        y += 0.05 * ((random.random() * 2 - 1) - y)
        crackle = (random.random() * 2 - 1) * math.exp(-t * 14) * 0.5
        out.append(math.sin(ph) * math.exp(-t * 3.5) * 1.1 + y * 3 * math.exp(-t * 4) + crackle)
    return out

def tink(hz, dur=0.35):
    n = int(dur * SR)
    return [(math.sin(TAU * hz * k / SR) + 0.4 * math.sin(TAU * hz * 2.76 * k / SR)) * math.exp(-k / SR * 16) for k in range(n)]

def boing(dur=0.32, f0=180, f1=620):
    n, ph, out = int(dur * SR), 0.0, []
    for k in range(n):
        t = k / n
        f = f0 + (f1 - f0) * t + 25 * math.sin(TAU * 18 * t * dur)
        ph += TAU * f / SR
        out.append(math.sin(ph) * math.sin(math.pi * t) * 0.9)
    return out

def chime(hz, dur=1.4):
    n = int(dur * SR)
    return [(math.sin(TAU * hz * k / SR) + 0.5 * math.sin(TAU * hz * 2.0 * k / SR) * math.exp(-k / SR * 3)
             + 0.2 * math.sin(TAU * hz * 3.01 * k / SR)) * math.exp(-k / SR * 2.6) for k in range(n)]

# ------------------------------------------------------------------ music: I-V-vi-IV in C, 120 BPM
C4 = -9  # semitones from A4
CHORDS = [(0, 4, 7), (7, 11, 14), (9, 12, 16), (5, 9, 12)]
BEAT = 0.5
for bar in range(10):
    chord = CHORDS[bar % 4] if bar < 9 else (0, 4, 7)
    t0 = bar * 1.0
    loud = 0.16 if t0 < fr(122) else 0.24
    add(t0, bass(note_hz(C4 - 12 + chord[0]), 0.9), 0.55 * (loud / 0.2))
    if bar == 9:
        for j, s in enumerate(chord + (12,)):
            add(t0 + j * 0.05, marimba(note_hz(C4 + 12 + s), 1.0), loud, pan=-0.3 + 0.2 * j)
        break
    pattern = [0, 1, 2, 1, 2, 1, 0, 2]   # eighth-note arpeggio
    for e, idx in enumerate(pattern):
        oct_up = 12 if e in (3, 6) else 0
        add(t0 + e * BEAT / 2, marimba(note_hz(C4 + 12 + chord[idx] + oct_up), 0.45), loud * (1.0 if e % 2 == 0 else 0.7),
            pan=0.25 if e % 2 else -0.25)

# ------------------------------------------------------------------ sound effects (frames match build_scene.py)
for f in range(6, 45, 6):                      # footsteps
    add(fr(f), thump(0.12, 150, 70), 0.32, pan=-0.2)
add(fr(46), thump(0.16, 120, 55), 0.4)
for f in (63, 89, 119):                        # wind-up whooshes into the swing
    add(fr(f - 3), whoosh(0.2 if f < 119 else 0.3), 0.55)
for f in (66, 92):                             # pick on rock
    add(fr(f), clink(), 0.45, pan=0.2)
    add(fr(f), thump(0.1, 200, 80), 0.3)
add(fr(122), clink(), 0.5, pan=0.2)
add(fr(122), boom(), 0.75)                     # the ORE rock bursts
for i in range(28):                            # gems landing
    t = fr(128) + random.random() * 2.0
    add(t, tink(random.choice([2093, 2349, 2637, 3136, 3520, 4186])), 0.12, pan=random.uniform(-0.7, 0.7))
add(fr(140), boing(), 0.35)                    # jump 1
add(fr(155), thump(0.18, 120, 50), 0.5)
add(fr(164), boing(0.24, 240, 560), 0.28)      # hop 2
add(fr(176), thump(0.14, 130, 60), 0.4)
for j, hz in enumerate((1046.5, 1318.5, 1568.0, 2093.0)):   # GALI wordmark chime
    add(fr(152) + j * 0.07, chime(hz), 0.16, pan=-0.3 + 0.2 * j)
for j in range(6):                             # tagline sparkle
    add(fr(168) + j * 0.03, tink(3000 + j * 400, 0.25), 0.07, pan=0.4)

# ------------------------------------------------------------------ master: fade, soft clip, write
fade_n = int(0.7 * SR)
peak = 1e-9
for i in range(N):
    g = min(1.0, (N - i) / fade_n)
    g *= min(1.0, i / 400)
    L[i] = math.tanh(L[i] * g * 1.1)
    R[i] = math.tanh(R[i] * g * 1.1)
    peak = max(peak, abs(L[i]), abs(R[i]))
norm = 0.92 / peak
out = sys.argv[1] if len(sys.argv) > 1 else "gali_cartoon.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<hh", int(L[i] * norm * 32767), int(R[i] * norm * 32767)) for i in range(N)))
print("wrote", out)

"""GALI, the score: original chiptune music and sound design, synthesised from
nothing and arranged to the film's timeline.

    python3 soundtrack.py out.wav [render.events.json]

111.1 BPM, a beat every 0.54 s: the same length as one pickaxe swing in the game,
so the digging is in time with the drums. When the render's event log is given,
every swing the engine drew gets a clink at the exact frame it landed.

Arrangement (beats):
   0-4   intro        pixels gather: filtered arpeggio, riser, snare roll
   4     HIT          the pickaxe strikes the logo
   4-8   statement    half-time drums, the hook's first phrase
   8-16  island       drums enter light, bass, the hook
  16-28  steps 1-2    full groove; taps and coins are pitched to the chord
  28-32  countdown    everything drops out but a ticking bass and the count
  32-36  tension      rumble, rising arpeggio, snare roll
  36     STRUCK GOLD  the drop: full band, hook up an octave, coin shower
  40-52  underground  muffled groove, clinks as percussion, motherlode build at 48
  52-60  living       breakdown: pads, bells, no drums; build into
  60-68  gear up      bright groove, the hook again, a pop for every item
  68-81  end          the logo hits, one accent per line, last chord rings out
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import lfilter

SR = 44100
BEAT = 0.54
BAR = BEAT * 4
b = lambda n: n * BEAT  # noqa: E731
TOTAL = b(81)
N = int(SR * TOTAL) + SR
rng = np.random.default_rng(7)

# ---------------- buses ----------------
BUS = {k: np.zeros((N, 2)) for k in ('drums', 'bass', 'music', 'sfx')}
SEND = np.zeros((N, 2))  # reverb send
KICKS = []  # kick times, for the sidechain


def put(bus, sig, at, gain=1.0, pan=0.0, verb=0.0):
    i = int(at * SR)
    if i >= N or i + len(sig) <= 0:
        return
    sig = sig[: N - i]
    l = sig * gain * min(1.0, 1 - pan)
    r = sig * gain * min(1.0, 1 + pan)
    BUS[bus][i:i + len(sig), 0] += l
    BUS[bus][i:i + len(sig), 1] += r
    if verb:
        SEND[i:i + len(sig), 0] += l * verb
        SEND[i:i + len(sig), 1] += r * verb


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a=0.005, d=0.1, s=0.6, r=0.05, hold=None):
    t = np.arange(n) / SR
    total = n / SR
    hold = total - r if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-6), s))
    return np.where(t > hold, e * np.clip(1 - (t - hold) / max(r, 1e-6), 0, 1), e)


def lp(x, k):
    """One-pole low-pass, k in (0, 1]."""
    return lfilter([k], [1, k - 1], x)


def hp(x, k):
    return x - lp(x, k)


def lp_sweep(x, k0, k1):
    """Low-pass whose cutoff moves from k0 to k1 across the signal (in 64 blocks)."""
    out = np.zeros_like(x)
    zi = np.zeros(1)
    n = len(x)
    for j in range(64):
        a, c = j * n // 64, (j + 1) * n // 64
        k = k0 + (k1 - k0) * (j / 63)
        out[a:c], zi = lfilter([k], [1, k - 1], x[a:c], zi=zi)
    return out


def pulse(f, dur, duty=0.5, vib=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ph = np.cumsum(np.full(n, f) * (1 + vib * np.sin(2 * np.pi * 5.5 * t) * np.clip(t * 3, 0, 1)) / SR)
    return np.where((ph % 1) < duty, 1.0, -1.0)


def tri(f, dur):
    ph = (np.arange(int(dur * SR)) * f / SR) % 1
    return 4 * np.abs(ph - 0.5) - 1


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR))


# ---------------- drums ----------------
def kick(at, g=0.9):
    t = np.arange(int(0.32 * SR)) / SR
    f = 45 + 120 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    s += 0.25 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * np.exp(-t * 40)
    put('drums', s, at, g)
    KICKS.append((at, g))


def snare(at, g=0.4, verb=0.25):
    t = np.arange(int(0.22 * SR)) / SR
    s = hp(noise(0.22), 0.35) * np.exp(-t * 18) + 0.4 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30)
    put('drums', s, at, g, 0, verb)


def rim(at, g=0.18):
    t = np.arange(int(0.06 * SR)) / SR
    put('drums', np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 90) + hp(noise(0.06), 0.6) * np.exp(-t * 120) * 0.4, at, g, 0.2)


HAT = hp(noise(0.05), 0.8) * np.exp(-np.arange(int(0.05 * SR)) / SR * 80)
OHAT = hp(noise(0.25), 0.8) * np.exp(-np.arange(int(0.25 * SR)) / SR * 14)


def hat(at, g=0.11, pan=0.35, open_=False):
    put('drums', OHAT if open_ else HAT, at, g, pan)


def crash(at, g=0.3, d=2.2):
    t = np.arange(int(d * SR)) / SR
    s = hp(noise(d), 0.6) * np.exp(-t * 2.2)
    put('drums', s, at, g, -0.35, 0.3)
    put('drums', np.roll(s, 500), at, g, 0.35)


def boom(at, g=0.8):
    t = np.arange(int(1.6 * SR)) / SR
    f = 36 + 80 * np.exp(-t * 6)
    put('sfx', np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6), at, g)


def whoosh(at, d=0.6, up=True, g=0.3):
    x = noise(d)
    y = lp_sweep(x, 0.02, 0.45) if up else lp_sweep(x, 0.45, 0.02)
    t = np.arange(len(y)) / SR
    e = np.sin(np.pi * np.clip(t / d, 0, 1)) ** 1.6
    put('sfx', y * e * 2.2, at, g, -0.5, 0.3)
    put('sfx', np.roll(y * e * 2.2, 400), at, g, 0.5)


def riser(at, d, g=0.2):
    y = lp_sweep(noise(d), 0.01, 0.55)
    t = np.arange(len(y)) / SR
    put('sfx', y * (t / d) ** 2.2 * 2.5, at, g, 0, 0.35)


def roll(start, end, g=0.3):
    t = start
    while t < end - 1e-6:
        k = (t - start) / (end - start)
        snare(t, g * (0.25 + 0.75 * k), 0.15)
        t += b(0.25) if k < 0.5 else b(0.125)


# ---------------- tones ----------------
def lead(m, at, dur, g=0.07, pan=0.1, duty=0.25, verb=0.3, bright=0.35):
    """The lead: a thin pulse, softened, with a little vibrato and an echo."""
    n = int((dur + 0.08) * SR)
    s = pulse(midi(m), dur + 0.08, duty, 0.005) * env(n, 0.006, 0.08, 0.75, 0.08, hold=dur)
    s = lp(s, bright)
    put('music', s, at, g, pan, verb)
    put('music', s, at + b(0.75), g * 0.28, -0.5)  # dotted-eighth echo


def bell(m, at, dur=0.9, g=0.05, pan=0.0):
    t = np.arange(int(dur * SR)) / SR
    f = midi(m)
    s = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)) * np.exp(-t * 3.5)
    put('music', s, at, g, pan, 0.5)


def arp_note(m, at, dur, g=0.03, pan=0.0):
    n = int(dur * SR)
    s = lp(pulse(midi(m), dur, 0.125) * env(n, 0.002, 0.04, 0.4, 0.03), 0.5)
    put('music', s, at, g, pan, 0.2)


def bass(m, at, dur, g=0.3):
    n = int(dur * SR)
    e = env(n, 0.004, 0.06, 0.85, 0.03)
    s = tri(midi(m), dur) * e + 0.6 * np.sin(2 * np.pi * midi(m) * np.arange(n) / SR) * e
    put('bass', s, at, g)


def pad(ms, at, dur, g=0.04, cutoff=0.1):
    for k, m in enumerate(ms):
        s = pulse(midi(m), dur, 0.3, 0.004) + pulse(midi(m) * 1.005, dur, 0.3)
        s = lp(lp(s, cutoff), cutoff * 1.5) * env(int(dur * SR), min(0.35, dur / 3), 0.2, 0.85, min(0.5, dur / 3))
        put('music', s, at, g, (-0.45, 0.45, 0.0)[k % 3], 0.45)


def blip(at, m, d=0.05, g=0.08, pan=0.0):
    t = np.arange(int(d * SR)) / SR
    put('sfx', np.sign(np.sin(2 * np.pi * midi(m) * t)) * np.exp(-t * 55), at, g, pan, 0.2)


def clink(at, g=0.16):
    """A pickaxe on rock: two inharmonic partials and a spit of grit."""
    t = np.arange(int(0.25 * SR)) / SR
    s = (np.sin(2 * np.pi * 2350 * t) + 0.6 * np.sin(2 * np.pi * 3710 * t)) * np.exp(-t * 26)
    s += hp(noise(0.25), 0.5) * np.exp(-t * 60) * 0.5
    put('sfx', s, at, g, float(rng.uniform(-0.3, 0.3)), 0.2)


def coin(at, m=83, g=0.07, pan=0.0):
    blip(at, m, 0.06, g, pan)
    blip(at + 0.06, m + 5, 0.2, g, pan)


# ---------------- harmony ----------------
# C minor: i - VI - III - VII, a bar each
CHORDS = [(48, [60, 63, 67]), (44, [56, 60, 63]), (51, [58, 63, 67]), (46, [58, 62, 65])]
def chord_at(t):  # noqa: E302
    return CHORDS[int(t / BAR + 1e-6) % 4]


HOOK = [  # (beat, beats, midi) over two bars
    (0, 0.5, 67), (0.5, 0.5, 67), (1, 0.5, 70), (1.5, 1.0, 72), (2.5, 0.5, 70), (3, 1, 67),
    (4, 0.5, 65), (4.5, 0.5, 67), (5, 0.5, 70), (5.5, 0.5, 67), (6, 1.5, 63), (7.5, 0.5, 65),
]
HOOK_B = [
    (0, 0.5, 72), (0.5, 0.5, 72), (1, 0.5, 75), (1.5, 1.0, 77), (2.5, 0.5, 75), (3, 1, 72),
    (4, 0.5, 70), (4.5, 0.5, 72), (5, 0.5, 75), (5.5, 0.5, 79), (6, 2, 84),
]
COUNTER = [(0, 2, 60), (2, 2, 63), (4, 2, 60), (6, 2, 62)]  # a slow line under the drop


def play_hook(start, end, hook, g=0.07, octave=0):
    t0 = start
    while t0 < end - 1e-6:
        for bt, ln, m in hook:
            at = t0 + b(bt)
            if at < end - 0.05:
                lead(m + octave, at, min(b(ln), end - at) - 0.03, g)
        t0 += b(8)


def groove(start, end, style='full', bassline=True, arps=False, hats=True):
    """style: full (kick every beat, snare 2 & 4), half (kick 1, snare 3), light (kick 1 & 3), none."""
    t = start
    while t < end - 1e-6:
        beat = int(round((t - start) / BEAT))
        root, tones = chord_at(t)
        if style == 'full':
            kick(t, 0.85)
            if beat % 2 == 1:
                snare(t)
        elif style == 'half':
            if beat % 4 == 0:
                kick(t)
            if beat % 4 == 2:
                snare(t)
        elif style == 'light':
            if beat % 2 == 0:
                kick(t, 0.7)
            if beat % 4 == 3:
                rim(t)
        if hats and style != 'none':
            hat(t, 0.1)
            hat(t + b(0.5), 0.07, -0.35, open_=(beat % 4 == 3))
        if bassline:
            bass(root - 12, t, b(0.5) - 0.02, 0.3)
            bass(root - 12 + (12 if beat % 2 else 7), t + b(0.5), b(0.5) - 0.02, 0.24)
        if arps:
            for k in range(4):
                arp_note(tones[k % 3] + 12, t + b(k * 0.25), b(0.25) - 0.01, 0.028, 0.5 if k % 2 else -0.5)
        t += BEAT


def pads(start, end, g=0.04, cutoff=0.1):
    t = start
    while t < end - 1e-6:
        root, tones = chord_at(t)
        pad(tones, t, min(BAR, end - t) + 0.05, g, cutoff)
        t += BAR


# ---------------- the score ----------------
def score(tl, events):
    hit = tl['hit']
    # 0 - 4: pixels gather
    riser(0.0, hit, 0.2)
    for k in range(16):
        root, tones = CHORDS[0]
        arp_note(tones[k % 3] + 12 + (12 if k >= 8 else 0), b(k * 0.25), b(0.25), 0.012 + 0.03 * k / 16, 0.5 if k % 2 else -0.5)
    pad([60, 67], 0.0, hit, 0.025, 0.05)
    roll(b(3), hit, 0.28)
    # 4: the pickaxe hits the logo
    kick(hit, 1.0); boom(hit, 0.75); crash(hit, 0.35); clink(hit, 0.3)
    for m in (48, 55, 60, 63, 67):
        lead(m, hit, b(1.5), 0.035, 0, 0.5, 0.4, 0.25)
    groove(b(4), b(8), 'half', True)
    pads(b(4), b(8), 0.03)
    lead(67, b(6), b(0.5), 0.05); lead(70, b(6.5), b(0.5), 0.05); lead(72, b(7), b(1), 0.05)
    # 8: onto the island
    whoosh(tl['wipe'] - 0.1, 0.55, True, 0.3)
    crash(b(8), 0.22)
    groove(b(8), b(16), 'light', True)
    pads(b(8), b(16), 0.032)
    play_hook(b(12), b(16), HOOK, 0.055)
    for k in range(25):  # the claims ping, climbing the chord
        _, tones = chord_at(tl['wave'])
        blip(tl['wave'] + k * (b(2) / 25), tones[k % 3] + 12 + 12 * (k // 9), 0.04, 0.035, (k % 5 - 2) * 0.2)
    # 16 - 28: the steps
    groove(b(16), b(28), 'full', True)
    pads(b(16), b(28), 0.028)
    play_hook(b(16), b(24), HOOK, 0.065)
    play_hook(b(24), b(28), HOOK, 0.065, 12)
    for k, at in enumerate(tl['picks']):  # taps, pitched up the chord
        _, tones = chord_at(at)
        blip(at, tones[k % 3] + 24, 0.05, 0.08, 0.2)
    for k in range(5):  # SOL landing on each claim
        coin(tl['deploy'] + b(0.5 * k), 83 + k * 2, 0.06, (k - 2) * 0.2)
    roll(b(27.5), b(28), 0.25)
    # 28 - 32: the countdown, everything else steps back
    for k, at in enumerate(tl['count']):
        blip(at, 81 if k < 2 else 88, 0.14, 0.11)
        kick(at, 0.55)
        bass(36, at, b(0.9), 0.3)
        hat(at + b(0.5), 0.06)
    kick(tl['locked'], 0.9); snare(tl['locked'], 0.45); bass(36, tl['locked'], b(1), 0.3)
    for m in (48, 54):  # a tritone stab: locked
        lead(m + 12, tl['locked'], b(0.75), 0.05, 0, 0.5, 0.3, 0.3)
    # 32 - 36: the island shakes
    t = np.arange(int(b(4) * SR)) / SR
    put('sfx', lp(noise(b(4)), 0.02) * 6 * (t / b(4)), b(32), 0.45)
    riser(b(32), b(4), 0.25)
    for k in range(16):  # a rising arpeggio, eighth notes
        arp_note(60 + [0, 3, 7, 10, 12, 15, 19, 22][k % 8] + 12 * (k // 8), b(32 + k * 0.25), b(0.25), 0.02 + 0.03 * k / 16)
    for k in range(8):
        kick(b(32 + k * 0.5), 0.35 + 0.5 * k / 8)
    roll(b(34), b(36), 0.33)
    # 36: STRUCK GOLD
    s = tl['strike']
    kick(s, 1.0); boom(s, 0.9); crash(s, 0.4, 2.8)
    for k, m in enumerate((60, 63, 67, 72, 75, 79, 84)):
        lead(m, s + k * 0.05, 0.5 - k * 0.03, 0.06, 0.3 if k % 2 else -0.3)
    for k in range(34):
        coin(s + 0.1 + float(rng.uniform(0, b(3))), 84 + int(rng.integers(0, 12)), 0.028, float(rng.uniform(-0.6, 0.6)))
    groove(b(36), b(40), 'full', True, arps=True)
    pads(b(36), b(40), 0.04, 0.14)
    play_hook(b(36), b(40), HOOK_B, 0.06)
    for bt, ln, m in COUNTER:
        lead(m, b(36 + bt), b(ln) - 0.05, 0.03, -0.4, 0.5, 0.3, 0.2)
    # 39.5: the dive
    whoosh(tl['dive'] - 0.25, 0.6, False, 0.35)
    # 40 - 52: underground, muffled, the digging is the rhythm
    groove(b(40), b(52), 'light', True, hats=False)
    pads(b(40), b(52), 0.03, 0.05)
    for k in range(0, 12, 2):
        bell(72 + [0, 3, 7, 10, 7, 3][k // 2], b(40 + k * 2 + 1), 0.9, 0.025, 0.3)
    hits = [e['t'] for e in events if e['name'] == 'hit' and tl['dive'] <= e['t'] < tl['exit']]
    if not hits:  # no log: one clink a beat
        hits = [b(42) + k * BEAT for k in range(18)]
    for at in hits:
        clink(at, 0.14)
    # the miners on the island dig too, further off
    for e2 in events:
        if e2['name'] == 'hit' and not (tl['dive'] <= e2['t'] < tl['exit']) and e2['t'] < tl['shutIn']:
            clink(e2['t'], 0.05)
    # motherlode build and burst
    riser(tl['ml'], tl['mlFull'] - tl['ml'], 0.2)
    for k in range(10):
        arp_note(72 + [0, 3, 7, 10, 12][k % 5] + 12 * (k // 5), tl['ml'] + k * (tl['mlFull'] - tl['ml']) / 10, 0.12, 0.03)
    kick(tl['mlFull'], 0.9); crash(tl['mlFull'], 0.28)
    for k, m in enumerate((72, 75, 79, 84, 87, 91)):
        bell(m, tl['mlFull'] + k * 0.05, 1.2, 0.035, (k - 3) * 0.15)
    # 52: back up into the light
    whoosh(tl['exit'] - 0.45, 0.5, True, 0.35)
    crash(tl['exit'], 0.25)
    # 52 - 60: the living island
    pads(b(52), b(60), 0.05, 0.12)
    groove(b(52), b(60), 'none', True, arps=True, hats=False)
    bells = [(0, 79), (1.5, 77), (2, 75), (4, 74), (5.5, 75), (6, 72)]
    for bt, m in bells:
        bell(m, b(53 + bt), 1.1, 0.04, 0.2)
    riser(b(58), b(2), 0.2)
    roll(b(58.5), b(60), 0.25)
    whoosh(tl['shutIn'], b(0.5), True, 0.25)
    # 60 - 68: gear up
    kick(b(60), 0.9); crash(b(60), 0.2)
    groove(b(60), b(68), 'full', True)
    pads(b(60), b(68), 0.028)
    play_hook(b(60), b(68), HOOK_B, 0.06)
    for row, n in enumerate((6, 6, 5, 4)):
        for col in range(n):
            at = tl['gear'] + b(0.5) + b(row) + col * b(0.125)
            _, tones = chord_at(at)
            blip(at, tones[col % 3] + 24, 0.045, 0.04, (col - 2.5) * 0.15)
    for k in range(21):
        bell(84 + [0, 3, 7, 10][k % 4], tl['glint'] + k * b(0.125), 0.4, 0.015, (k % 7 - 3) * 0.15)
    whoosh(tl['gearOut'] + 0.2, 0.5, True, 0.25)
    roll(b(67), b(68), 0.28)
    # 68: the logo, the promise, the last chord
    e = tl['end']
    kick(e, 1.0); boom(e, 0.8); crash(e, 0.38, 3.0)
    groove(b(68), b(76), 'half', True, arps=True)
    pads(b(68), b(76), 0.04, 0.12)
    for at, m in ((tl['line1'], 60), (tl['line2'], 63), (tl['line3'], 67)):
        for d in (0, 7, 12):
            lead(m + d, at, b(0.9), 0.03, 0, 0.5, 0.35, 0.3)
        kick(at, 0.45)
    coin(tl['badge'], 88, 0.07)
    lead(72, b(74), b(0.5), 0.05); lead(75, b(74.5), b(0.5), 0.05); lead(79, b(75), b(1), 0.05)
    # the last chord rings out
    for m in (36, 48, 55, 60, 63, 67, 74):
        pad([m], b(76), b(5), 0.045, 0.1)
    for k, m in enumerate((72, 75, 79, 84, 87)):
        bell(m, b(76) + k * 0.09, 2.2, 0.035, (k - 2) * 0.2)
    kick(b(76), 0.8); crash(b(76), 0.25, 3.5)


# ---------------- mix ----------------
def reverb(x):
    """A small Schroeder room: four combs into two all-passes, per channel."""
    out = np.zeros_like(x)
    for ch in range(2):
        s = x[:, ch]
        acc = np.zeros_like(s)
        for d, gcomb in ((1557, 0.8), (1617, 0.79), (1491, 0.81), (1422, 0.8)):
            d += ch * 23
            a = np.zeros(d + 1)
            a[0] = 1
            a[d] = -gcomb
            acc += lfilter([1], a, s)
        y = acc / 4
        for d, ga in ((225, 0.5), (556, 0.5)):
            bcoef = np.zeros(d + 1)
            bcoef[0] = -ga
            bcoef[d] = 1
            acoef = np.zeros(d + 1)
            acoef[0] = 1
            acoef[d] = -ga
            y = lfilter(bcoef, acoef, y)
        out[:, ch] = lp(y, 0.45)
    return out


def sidechain():
    """Duck the bass and music under every kick, the pump a dance mix has."""
    g = np.ones(N)
    rel = int(0.16 * SR)
    curve = 1 - 0.45 * np.exp(-np.arange(rel) / (rel / 4))
    for at, k in KICKS:
        i = int(at * SR)
        if i >= N:
            continue
        seg = g[i:i + rel]
        c = 1 - (1 - curve[: len(seg)]) * min(1.0, k)
        g[i:i + len(seg)] = np.minimum(seg, c)
    return g[:, None]


def master(tl):
    duck = sidechain()
    mix = BUS['drums'] * 0.95 + BUS['bass'] * duck * 0.9 + BUS['music'] * duck + BUS['sfx'] * 0.9
    mix += reverb(SEND) * 0.35
    # underground: roll the top off everything but the clinks and the effects
    a, c = int(tl['dive'] * SR), int(tl['exit'] * SR)
    for ch in range(2):
        seg = mix[a:c, ch] - BUS['sfx'][a:c, ch] * 0.9
        mix[a:c, ch] = lp(seg, 0.18) * 1.15 + BUS['sfx'][a:c, ch] * 0.9
    mix = mix[: int(tl['total'] * SR)]
    n = len(mix)
    t = np.arange(n) / SR
    fade = np.clip((tl['total'] - t) / (tl['total'] - tl['fade']), 0, 1) ** 1.5
    mix *= fade[:, None]
    # glue: gentle compression by a slow envelope, then a soft clip
    envl = lp(np.max(np.abs(mix), axis=1), 0.0008)
    gain = 1 / (1 + np.maximum(0, envl - 0.35) * 1.4)
    mix *= gain[:, None]
    mix = np.tanh(mix * 1.2)
    mix /= np.max(np.abs(mix)) / 0.89
    return mix


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'score.wav'
    tl, events = None, []
    if len(sys.argv) > 2:
        d = json.load(open(sys.argv[2]))
        tl, events = d['timeline'], d['events']
    if tl is None:
        tl = {k: b(v) for k, v in dict(hit=4, wipe=7.5, wave=12.5, deploy=24.5, locked=31, strike=36, dive=39.5, ml=45.5, mlFull=48, exit=52, shutIn=59.5, gear=60, glint=64, gearOut=67.25, end=68, line1=70, line2=71, line3=72, badge=74, fade=79, total=81).items()}
        tl['picks'] = [b(x) for x in (17, 18, 19, 20, 21)]
        tl['count'] = [b(x) for x in (28, 29, 30)]
    score(tl, events)
    pcm = (master(tl) * 32767).astype(np.int16)
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', round(len(pcm) / SR, 2), 's,', len([e for e in events if e['name'] == 'hit']), 'engine hits')


if __name__ == '__main__':
    main()

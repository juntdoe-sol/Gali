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
  52-60  living       breakdown: pads, bells, no drums
  60-64  autopilot    light groove, a coin for every round sent
  64-72  lobby        full band, the town's own brighter tune
  72-80  talking      the band sits back; a pop for every line and emote
  80-92  dance        four on the floor, claps, octave bass; thunder and rain at the end
  92-96  tip          half time, three coins
  96-104 tour         full band, a whoosh on every pan
 104-112 Cave Run     muffled; the engine's hits and cracks are the percussion
 112-116 games row    half time, a build
 116-140 mini games   three rounds of eight beats: ticking build, reveal on the bar, payoff
 140-144 checked      calm, a bell per step
 144-152 gear up      bright groove, the hook again, a pop for every item
 152-165 end          the logo hits, one accent per line, last chord rings out
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
TOTAL = b(165)
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


def clap(at, g=0.3):
    """A hand clap: three quick bursts of filtered noise and a short tail."""
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    e = np.zeros(n)
    for d in (0.0, 0.011, 0.023):
        e += np.where(t >= d, np.exp(-(t - d) * 90), 0) * 0.6
    e += np.where(t >= 0.03, np.exp(-(t - 0.03) * 22), 0)
    s = hp(lp(noise(0.2), 0.55), 0.25) * e
    put('drums', s, at, g, 0.1, 0.3)


def glide(at, d, m0, m1, g=0.06, curve=1.0, duty=0.25):
    """A pulse whose pitch slides from one note to another: the cart climbing, or going over."""
    n = int(d * SR)
    k = (np.arange(n) / n) ** curve
    f = midi(m0) * (midi(m1) / midi(m0)) ** k
    ph = np.cumsum(f) / SR
    s = lp(np.where((ph % 1) < duty, 1.0, -1.0), 0.3) * env(n, 0.01, 0.05, 0.9, 0.05)
    put('music', s, at, g, 0, 0.25)


def thunder(at, g=0.5):
    d = 2.6
    t = np.arange(int(d * SR)) / SR
    s = lp(lp(noise(d), 0.03), 0.05) * 9 * np.exp(-t * 1.6) * (1 + 0.5 * np.sin(2 * np.pi * 7 * t))
    put('sfx', s, at, g, -0.3, 0.4)
    put('sfx', np.roll(s, 900), at, g, 0.3)
    crackle = hp(noise(0.25), 0.5) * np.exp(-np.arange(int(0.25 * SR)) / SR * 30)
    put('sfx', crackle, at, g * 0.35, 0.2, 0.4)


def rainbed(start, end, g=0.035):
    d = end - start
    t = np.arange(int(d * SR)) / SR
    e = np.clip(t / 1.0, 0, 1) * np.clip((d - t) / 1.2, 0, 1)
    put('sfx', hp(lp(noise(d), 0.5), 0.35) * e, start, g, -0.4)
    put('sfx', hp(lp(noise(d), 0.5), 0.35) * e, start, g, 0.4)


def stab(tones, at, dur=0.14, g=0.03):
    for k, m in enumerate(tones):
        n = int(dur * SR)
        s = lp(pulse(midi(m + 12), dur, 0.5) * env(n, 0.002, 0.05, 0.5, 0.04), 0.4)
        put('music', s, at, g, (-0.4, 0.4, 0.0)[k % 3], 0.3)


def rumble(at, d, g=0.45, rise=True):
    t = np.arange(int(d * SR)) / SR
    put('sfx', lp(noise(d), 0.02) * 6 * ((t / d) if rise else np.exp(-t * 2.5)), at, g)


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

TOWN = [  # the lobby's tune: brighter, up in the relative major
    (0, 0.5, 75), (0.5, 0.5, 79), (1, 1, 82), (2, 0.5, 80), (2.5, 0.5, 79), (3, 1, 75),
    (4, 0.5, 77), (4.5, 0.5, 79), (5, 0.5, 80), (5.5, 0.5, 79), (6, 1, 77), (7, 1, 74),
]
DANCE = [  # the dance floor riff: short, syncopated, easy to nod to
    (0, 0.25, 72), (0.75, 0.25, 72), (1.5, 0.5, 75), (2, 0.25, 72), (2.75, 0.25, 70), (3.5, 0.5, 67),
    (4, 0.25, 72), (4.75, 0.25, 72), (5.5, 0.5, 77), (6, 0.5, 75), (6.5, 0.5, 72), (7, 1, 70),
]


def disco(start, end):
    """Four on the floor, a clap on two and four, hats off the beat, a bass that bounces in octaves."""
    t = start
    while t < end - 1e-6:
        beat = int(round((t - start) / BEAT))
        root, tones = chord_at(t)
        kick(t, 1.0)
        if beat % 2 == 1:
            clap(t, 0.3)
            snare(t, 0.18, 0.2)
        hat(t + b(0.5), 0.13, -0.3, open_=True)
        for k in range(4):
            hat(t + b(k * 0.25), 0.05 + 0.03 * (k % 2), 0.3)
        bass(root - 12, t, b(0.25) - 0.01, 0.3)
        bass(root, t + b(0.5), b(0.25) - 0.01, 0.26)
        bass(root - 12, t + b(0.75), b(0.2), 0.2)
        stab(tones, t + b(0.5), 0.12, 0.028)
        t += BEAT


def game_round(t0, kind, events):
    """One mini game: a ticking build while stakes are open, the reveal on the bar, then the payoff."""
    groove(t0, t0 + b(3.5), 'light', True, hats=True)
    pads(t0, t0 + b(4), 0.03, 0.08)
    whoosh(t0 - 0.1, 0.4, True, 0.22)
    taps = (1.0, 1.25, 1.75) if kind == 'tunnel' else (1.25, 1.75) if kind == 'pot' else (0.75, 1.25, 1.75)
    for k, u in enumerate(taps):
        _, tones = chord_at(t0 + b(u))
        blip(t0 + b(u), tones[k % 3] + 24, 0.05, 0.08, 0.2)
    coin(t0 + b(1.75) + 0.04, 86, 0.07)
    for k in range(12):  # other miners' stakes arriving
        blip(t0 + b(0.4 + k * 0.26), 72 + [0, 3, 7, 10, 12][k % 5], 0.03, 0.03, (k % 5 - 2) * 0.25)
    for k in range(8):  # the clock runs down
        arp_note(60 + [0, 3, 7, 10, 12, 15, 19, 22][k], t0 + b(2 + k * 0.25), b(0.25), 0.02 + 0.03 * k / 8)
    riser(t0 + b(2.5), b(1.5), 0.2)
    roll(t0 + b(3.5), t0 + b(4), 0.3)
    r = t0 + b(4)
    if kind == 'tunnel':
        kick(r, 1.0); boom(r, 0.95); crash(r, 0.35, 2.4); rumble(r, 1.6, 0.6, rise=False)
        for k in range(10):
            clink(r + 0.05 + k * 0.045, 0.12)
        for k, m in enumerate((67, 63, 60, 55, 48)):
            lead(m, r + k * 0.06, 0.4, 0.05, 0.3 if k % 2 else -0.3, 0.5, 0.3, 0.25)
        groove(r, t0 + b(8), 'full', True)
        pads(r, t0 + b(8), 0.035, 0.12)
        play_hook(r, t0 + b(8), HOOK, 0.055)
        for k in range(14):
            coin(r + b(0.75) + k * 0.07, 84 + (k % 5) * 2, 0.03, (k % 5 - 2) * 0.25)
    elif kind == 'pot':
        for k in range(14):  # the wheel ticking round, slowing
            blip(t0 + b(3.0) + (1 - (1 - k / 14) ** 2.2) * b(1.0), 84, 0.03, 0.05)
        kick(r, 1.0); boom(r, 0.8); crash(r, 0.4, 2.8)
        for k, m in enumerate((63, 67, 70, 75, 79, 82, 87)):
            bell(m, r + k * 0.05, 1.3, 0.04, (k - 3) * 0.15)
            lead(m, r + k * 0.05, 0.45 - k * 0.03, 0.045, 0.3 if k % 2 else -0.3)
        for k in range(40):
            coin(r + 0.1 + float(rng.uniform(0, b(2.6))), 84 + int(rng.integers(0, 12)), 0.026, float(rng.uniform(-0.6, 0.6)))
        groove(r, t0 + b(8), 'full', True, arps=True)
        pads(r, t0 + b(8), 0.04, 0.14)
        play_hook(r, t0 + b(8), HOOK_B, 0.055)
    else:
        go, cash, bust = t0 + b(4), t0 + b(5.25), t0 + b(6.25)
        kick(go, 0.9); crash(go, 0.2)
        glide(go, bust - go, 57, 84, 0.06, 1.3)
        glide(go, bust - go, 45, 72, 0.04, 1.3, 0.5)
        k, at = 0, go
        while at < bust:  # the wheels on the rails, faster and faster
            hat(at, 0.09, 0.3 if k % 2 else -0.3)
            kick(at, 0.3)
            at += b(0.25) * (1 - 0.6 * (at - go) / (bust - go))
            k += 1
        bell(91, cash, 1.0, 0.06); bell(96, cash + 0.07, 1.0, 0.05); coin(cash, 88, 0.08)
        kick(bust, 1.0); boom(bust, 1.0); crash(bust, 0.42, 2.6); rumble(bust, 1.2, 0.55, rise=False)
        glide(bust, 0.7, 84, 40, 0.07, 0.6)
        snare(bust, 0.5)
        groove(t0 + b(6.5), t0 + b(8), 'half', True)
        pads(bust, t0 + b(8), 0.04, 0.1)
    whoosh(t0 + b(7.25), 0.5, True, 0.25)


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
        if e2['name'] == 'hit' and not (tl['dive'] <= e2['t'] < tl['exit']) and e2['t'] < tl['shutIn'] and not e2['name'].startswith(('cave:', 'town:')):
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
    riser(b(58.5), b(1.5), 0.14)
    # 60 - 64: autopilot, the island at night: a round on every half beat
    kick(b(60), 0.8); crash(b(60), 0.16)
    groove(b(60), b(64), 'light', True, arps=True)
    pads(b(60), b(64), 0.035, 0.1)
    for k, at in enumerate(tl['autoTicks']):
        coin(at, 79 + k * 2, 0.06, (k - 2.5) * 0.15)
        kick(at, 0.4)
    roll(b(63), b(64), 0.26)
    whoosh(tl['shutIn'], b(0.5), True, 0.25)
    # 64 - 72: the lobby
    kick(b(64), 1.0); crash(b(64), 0.28)
    groove(b(64), b(72), 'full', True, arps=True)
    pads(b(64), b(72), 0.03, 0.12)
    play_hook(b(64), b(72), TOWN, 0.062)
    for k in range(26):  # the town filling up
        blip(b(66.5) + k * b(3) / 26, 72 + [0, 3, 7, 10, 12, 15][k % 6], 0.03, 0.028, (k % 5 - 2) * 0.25)
    # 72 - 80: talking: the band sits back, every line and emote is a little pop
    groove(b(72), b(80), 'light', True)
    pads(b(72), b(80), 0.035, 0.1)
    play_hook(b(72), b(80), TOWN, 0.035)
    for at in tl['says']:
        blip(at, 79, 0.05, 0.08, -0.2); blip(at + 0.07, 84, 0.07, 0.08, -0.2)
    for k, at in enumerate(tl['emotes']):
        _, tones = chord_at(at)
        blip(at, tones[k % 3] + 24, 0.05, 0.06, 0.3)
    riser(b(78), b(2), 0.22)
    roll(b(79), b(80), 0.3)
    # 80 - 92: the dance
    d = tl['dance']
    kick(d, 1.0); boom(d, 0.7); crash(d, 0.35, 2.4)
    disco(b(80), b(92))
    pads(b(80), b(92), 0.03, 0.14)
    play_hook(b(80), b(88), DANCE, 0.07)
    play_hook(b(88), b(92), DANCE, 0.07, 12)
    for at in (tl['dance2'], tl['dance3']):
        crash(at, 0.28); boom(at, 0.5)
        roll(at - b(0.5), at, 0.26)
        for k, m in enumerate((72, 75, 79, 84)):
            lead(m, at + k * 0.04, 0.3, 0.04, 0.3 if k % 2 else -0.3)
    for bt, ln, m in COUNTER:
        lead(m + 12, b(84 + bt), b(ln) - 0.05, 0.028, -0.4, 0.5, 0.3, 0.2)
        lead(m + 12, b(88 + bt / 2), b(ln / 2) - 0.05, 0.028, 0.4, 0.5, 0.3, 0.2)
    rainbed(tl['rain'], tl['dawn'][0] + b(1.5), 0.03)
    for at in tl['bolts']:
        thunder(at + 0.05, 0.4)
    whoosh(tl['danceOut'], 0.45, False, 0.22)
    # 92 - 96: the tip: a breath, and three coins
    groove(b(92), b(96), 'half', True)
    pads(b(92), b(96), 0.045, 0.12)
    for k, at in enumerate(tl['tipCoins']):
        coin(at, 84 + k * 3, 0.085, (k - 1) * 0.3)
        bell(84 + k * 3, at, 0.8, 0.03)
    for bt, m in ((0, 79), (1.5, 77), (2.5, 75)):
        bell(m, b(92 + bt), 1.0, 0.035, 0.2)
    roll(b(95.5), b(96), 0.24)
    # 96 - 104: the tour: full band, a whoosh on every pan
    crash(b(96), 0.22)
    groove(b(96), b(103.5), 'full', True, arps=True)
    pads(b(96), b(104), 0.03, 0.12)
    play_hook(b(96), b(103.5), HOOK_B, 0.055)
    for at in tl['stops']:
        whoosh(at, b(0.9), True, 0.26)
        _, tones = chord_at(at + b(0.9))
        for k, m in enumerate(tones):
            bell(m + 24, at + b(0.9) + k * 0.03, 0.7, 0.03, (k - 1) * 0.3)
    whoosh(tl['caveIn'] - 0.05, b(0.5), False, 0.36)
    # 104 - 112: Cave Run: muffled, and the digging is the rhythm again
    c0, c1 = tl['cave'], tl['caveExit']
    groove(b(104), b(111.5), 'light', True, hats=False)
    pads(b(104), b(112), 0.03, 0.05)
    for k in range(0, 8, 2):
        bell(72 + [0, 3, 7, 10][k // 2], b(104 + k + 1), 0.9, 0.025, 0.3)
    for e2 in events:
        if not (c0 - 0.3 <= e2['t'] < c1):
            continue
        n = e2['name']
        if n == 'cave:hit':
            clink(e2['t'], 0.15)
        elif n == 'cave:crack':
            clink(e2['t'], 0.2); kick(e2['t'], 0.5)
        elif n in ('cave:gem', 'cave:oil'):
            coin(e2['t'], 88, 0.07)
        elif n == 'cave:pop':
            blip(e2['t'], 76, 0.08, 0.09)
        elif n == 'cave:hurt':
            blip(e2['t'], 50, 0.15, 0.1)
        elif n == 'cave:descend':
            whoosh(e2['t'], 0.5, False, 0.25)
    whoosh(c1 - 0.45, 0.5, True, 0.35)
    # 112 - 116: the games row
    kick(b(112), 1.0); crash(b(112), 0.3); boom(b(112), 0.6)
    groove(b(112), b(116), 'half', True, arps=True)
    pads(b(112), b(116), 0.04, 0.12)
    for k, m in enumerate((72, 75, 79)):
        for dd in (0, 7, 12):
            lead(m + dd, b(113 + k * 0.5), b(0.45), 0.03, (k - 1) * 0.4, 0.5, 0.35, 0.3)
    roll(b(115), b(116), 0.3)
    # 116 - 140: three games, eight beats each
    game_round(tl['tunnel'], 'tunnel', events)
    game_round(tl['pot'], 'pot', events)
    game_round(tl['crash'], 'crash', events)
    # 140 - 144: how a round is checked: calm, a bell for every step
    f = tl['fair']
    pads(f, f + b(4), 0.05, 0.12)
    groove(f, f + b(4), 'none', True, arps=True, hats=False)
    for k, u in enumerate((0.6, 1.35, 2.1)):
        bell(75 + (0, 4, 7)[k] + (0 if k < 2 else 5), f + b(u), 1.0, 0.045, (k - 1) * 0.3)
    for k, m in enumerate((79, 84, 87, 91)):
        bell(m, f + b(2.4) + k * 0.05, 1.4, 0.035, (k - 1.5) * 0.2)
    riser(f + b(2.5), b(1.5), 0.18)
    roll(f + b(3.25), f + b(4), 0.25)
    whoosh(tl['shut2'], b(0.5), True, 0.25)
    # 144 - 152: gear up
    G = tl['gear']
    kick(G, 0.9); crash(G, 0.2)
    groove(G, G + b(8), 'full', True)
    pads(G, G + b(8), 0.028)
    play_hook(G, G + b(8), HOOK_B, 0.06)
    for row, n in enumerate((6, 6, 5, 4)):
        for col in range(n):
            at = G + b(0.5) + b(row) + col * b(0.125)
            _, tones = chord_at(at)
            blip(at, tones[col % 3] + 24, 0.045, 0.04, (col - 2.5) * 0.15)
    for k in range(21):
        bell(84 + [0, 3, 7, 10][k % 4], tl['glint'] + k * b(0.125), 0.4, 0.015, (k % 7 - 3) * 0.15)
    whoosh(tl['gearOut'] + 0.2, 0.5, True, 0.25)
    roll(G + b(7), G + b(8), 0.28)
    # 152: the logo, the promise, the last chord
    e = tl['end']
    kick(e, 1.0); boom(e, 0.8); crash(e, 0.38, 3.0)
    groove(e, e + b(8), 'half', True, arps=True)
    pads(e, e + b(8), 0.04, 0.12)
    for at, m in ((tl['line1'], 60), (tl['line2'], 63), (tl['line3'], 67)):
        for dd in (0, 7, 12):
            lead(m + dd, at, b(0.9), 0.03, 0, 0.5, 0.35, 0.3)
        kick(at, 0.45)
    coin(tl['badge'], 88, 0.07)
    lead(72, e + b(6), b(0.5), 0.05); lead(75, e + b(6.5), b(0.5), 0.05); lead(79, e + b(7), b(1), 0.05)
    # the last chord rings out
    for m in (36, 48, 55, 60, 63, 67, 74):
        pad([m], e + b(8), b(5), 0.045, 0.1)
    for k, m in enumerate((72, 75, 79, 84, 87)):
        bell(m, e + b(8) + k * 0.09, 2.2, 0.035, (k - 2) * 0.2)
    kick(e + b(8), 0.8); crash(e + b(8), 0.25, 3.5)


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
    for lo, hi in ((tl['dive'], tl['exit']), (tl['cave'], tl['caveExit'])):
        a, c = int(lo * SR), int(hi * SR)
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
        raise SystemExit('usage: python3 soundtrack.py out.wav render.events.json (the render writes the timeline)')
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

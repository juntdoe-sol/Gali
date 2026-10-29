"""Soft digging sounds for mining swings (replaces the sharp 'hit' click on the island).

Each is a muffled thud of soil: a short low thump plus a brushed burst of low-passed noise, quiet and with a soft
attack. Three takes with small differences so a long autopilot run doesn't repeat one sample.
Writes app/assets/sfx/dirt-0.wav .. dirt-2.wav (32 kHz mono 16-bit, like the other effects).
"""
import os
import wave

import numpy as np

SR = 32000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'app', 'assets', 'sfx')


def lowpass(x, cutoff):
    # one-pole low-pass, run twice for a gentler slope
    a = np.exp(-2 * np.pi * cutoff / SR)
    for _ in range(2):
        y = np.empty_like(x)
        acc = 0.0
        for i, v in enumerate(x):
            acc = (1 - a) * v + a * acc
            y[i] = acc
        x = y
    return x


def take(seed, dur=0.17, thump_hz=95, cutoff=900, gain=0.30):
    rng = np.random.default_rng(seed)
    n = int(SR * dur)
    t = np.arange(n) / SR
    # soft attack (6 ms), then a quick decay
    env = np.minimum(1, t / 0.006) * np.exp(-t / 0.045)
    thump = np.sin(2 * np.pi * (thump_hz * t - 18 * t * t)) * np.exp(-t / 0.03) * 0.8
    soil = lowpass(rng.normal(0, 1, n), cutoff) * 3.2
    # a few grains of earth trickling off the pick
    grains = np.zeros(n)
    for _ in range(5):
        k = int(rng.uniform(0.03, 0.13) * SR)
        m = int(0.008 * SR)
        grains[k:k + m] += lowpass(rng.normal(0, 1, m), 1800) * np.hanning(m) * 1.2
    x = (thump + soil) * env + grains * 0.35
    x = x / np.max(np.abs(x)) * gain
    fade = np.minimum(1, (n - np.arange(n)) / (0.02 * SR))
    return (x * fade * 32767).astype(np.int16)


for i, (seed, hz, cut) in enumerate(((3, 95, 900), (7, 82, 760), (11, 105, 1050))):
    data = take(seed, thump_hz=hz, cutoff=cut)
    with wave.open(os.path.join(OUT, f'dirt-{i}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f'dirt-{i}.wav', len(data) / SR, 's peak', int(np.abs(data).max()))

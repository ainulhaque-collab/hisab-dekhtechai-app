"""Original coin-impact sound design. Deterministic PCM assets; no sampled third-party audio.
Run: python scripts/generate_coin_audio.py. Released under CC0-1.0.
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 24000
OUT = Path(__file__).resolve().parents[1] / 'public' / 'audio'
OUT.mkdir(parents=True, exist_ok=True)


def render(name, impacts, duration):
    rng = random.Random(20261025)
    samples = []
    for n in range(int(duration * RATE)):
        t = n / RATE
        sample = 0.0
        for start, fundamental, strength in impacts:
            age = t - start
            if age < 0:
                continue
            # Inharmonic resonances approximate struck metal rather than a musical chord.
            for ratio, weight, decay in [(1, 1, 24), (1.482, .53, 31), (2.173, .34, 39), (3.071, .17, 57)]:
                sample += strength * weight * math.sin(2 * math.pi * fundamental * ratio * age) * math.exp(-age * decay) * min(1, age * 3000)
            sample += strength * .3 * (rng.random() * 2 - 1) * math.exp(-age * 450)
        samples.append(sample)
    peak = max(abs(s) for s in samples) or 1
    with wave.open(str(OUT / f'{name}.wav'), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', round(s / peak * 16000)) for s in samples))


render('income', [(0, 2350, .6), (.055, 3100, .4), (.12, 2750, .24)], .45)
render('expense', [(0, 1800, .45), (.038, 1450, .16)], .29)
render('transfer', [(0, 1900, .42), (.18, 2700, .5)], .48)

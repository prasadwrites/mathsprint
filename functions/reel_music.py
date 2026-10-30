"""The Reel's soundtrack, synthesized here so there's nothing to license: a tense, ticking first half while the tutor's
stress climbs, a whoosh when MathSprint arrives, and an upbeat second half. Sound effects land on the animation's events.
"""

from __future__ import annotations

import io
import wave

import numpy as np

RATE = 44100


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


class _Mix:
    def __init__(self, seconds: float) -> None:
        self.n = int(RATE * seconds)
        self.left = np.zeros(self.n)
        self.right = np.zeros(self.n)
        self.rng = np.random.default_rng(7)

    def add(self, sound: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0) -> None:
        i = int(at * RATE)
        if i >= self.n or i < 0:
            return
        j = min(self.n, i + len(sound))
        self.left[i:j] += sound[: j - i] * gain * (1 - pan)
        self.right[i:j] += sound[: j - i] * gain * (1 + pan)

    def pad(self, notes: list[int], at: float, seconds: float, gain: float) -> None:
        n = int(seconds * RATE)
        t = np.arange(n) / RATE
        s = np.zeros(n)
        for m in notes:
            for detune in (-0.1, 0.0, 0.1):
                f = _hz(m + detune)
                s += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
        attack, release = min(int(0.4 * RATE), n), min(int(0.8 * RATE), n)
        env = np.ones(n)
        env[:attack] = np.linspace(0, 1, attack)
        env[n - release:] *= np.linspace(1, 0, release)
        self.add(s * env / (len(notes) * 3), at, gain)

    def pluck(self, midi: float, at: float, gain: float, pan: float = 0.0, decay: float = 6.0) -> None:
        t = np.arange(int(0.8 * RATE)) / RATE
        f = _hz(midi)
        s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 14)) * np.exp(-t * decay)
        s[:150] *= np.linspace(0, 1, 150)
        self.add(s, at, gain, pan)

    def kick(self, at: float, gain: float) -> None:
        t = np.arange(int(0.3 * RATE)) / RATE
        phase = 2 * np.pi * np.cumsum(50 + 100 * np.exp(-t * 32)) / RATE
        self.add(np.sin(phase) * np.exp(-t * 10), at, gain)

    def tick(self, at: float, high: bool) -> None:
        t = np.arange(int(0.05 * RATE)) / RATE
        s = np.sin(2 * np.pi * (2900 if high else 2200) * t) * np.exp(-t * 160)
        self.add(s, at, 0.16, 0.25 if high else -0.25)

    def hat(self, at: float, gain: float) -> None:
        n = int(0.05 * RATE)
        s = np.diff(np.concatenate([[0.0], self.rng.standard_normal(n)]))
        self.add(s * np.exp(-np.arange(n) / RATE * 80), at, gain, 0.2)

    def thud(self, at: float) -> None:
        """A paper stack landing on the desk."""
        t = np.arange(int(0.25 * RATE)) / RATE
        body = np.sin(2 * np.pi * np.cumsum(90 + 60 * np.exp(-t * 40)) / RATE) * np.exp(-t * 18)
        paper = self.rng.standard_normal(len(t)) * np.exp(-t * 35) * 0.35
        self.add(body + paper, at, 0.55)

    def ding(self, at: float, midi: float) -> None:
        self.pluck(midi, at, 0.28, 0.0, decay=4.0)
        self.pluck(midi + 7, at + 0.06, 0.16, 0.2, decay=4.5)

    def whoosh(self, at: float, seconds: float = 0.9) -> None:
        n = int(seconds * RATE)
        noise = self.rng.standard_normal(n)
        # A sweep: smooth the noise less and less, louder towards the end.
        k = np.linspace(1, 0, n) ** 2
        smooth = np.convolve(noise, np.ones(24) / 24, mode="same")
        s = (smooth * k + noise * (1 - k)) * np.sin(np.linspace(0, np.pi, n)) ** 2
        self.add(s, at, 0.22)

    def wav(self, fade_out: float) -> bytes:
        stereo = np.stack([self.left, self.right], axis=1)
        for delay, gain in ((0.031, 0.3), (0.053, 0.25), (0.089, 0.2), (0.137, 0.12)):  # a little room
            k = int(delay * RATE)
            stereo[k:] += stereo[:-k] * gain
        fade = np.ones(self.n)
        fn = min(int(fade_out * RATE), self.n)
        fade[-fn:] = np.linspace(1, 0, fn)
        fade[: int(0.05 * RATE)] = np.linspace(0, 1, int(0.05 * RATE))
        stereo *= fade[:, None]
        stereo /= max(np.max(np.abs(stereo)), 1e-9) * 1.12
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes((stereo * 32767).astype("<i2").tobytes())
        return out.getvalue()


def soundtrack(seconds: float, drops: list[float], arrive: float, dings: list[float], chime: float) -> bytes:
    """A WAV of `seconds`: tense until `arrive` (with a thud at each of `drops`), upbeat after (a ding at each of `dings`),
    and a chime when the web address shows (`chime`)."""
    mix = _Mix(seconds)
    beat = 0.5  # 120 BPM
    # The stress half: A minor and F, a clock ticking, getting busier at the meltdown.
    tense = [[57, 60, 64], [53, 57, 60], [57, 60, 64], [52, 56, 59]]
    for i, t in enumerate(np.arange(0.0, arrive, 2.0)):
        chord = tense[i % len(tense)]
        mix.pad(chord, t, 2.4, 0.2)
        mix.pad([chord[0] - 12], t, 2.4, 0.14)
    for i, t in enumerate(np.arange(0.0, arrive - 0.2, beat)):
        mix.tick(t, high=i % 2 == 0)
        if t > drops[-1]:
            mix.tick(t + beat / 2, high=i % 2 == 1)  # the clock speeds up
    for t in drops:
        mix.thud(t)
    mix.whoosh(arrive - 0.6)
    # The calm half: C, G, A minor, F with plucks and a light beat.
    happy = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
    start = arrive + 0.4
    for i, t in enumerate(np.arange(start, seconds, 2.0)):
        chord = happy[i % len(happy)]
        mix.pad(chord, t, 2.4, 0.18)
        mix.pad([chord[0] - 12], t, 2.4, 0.12)
        arp = [chord[1] + 12, chord[2] + 12, chord[0] + 24, chord[2] + 12]
        for k in range(8):
            if t + k * beat / 2 < seconds - 1.2:
                mix.pluck(arp[k % 4], t + k * beat / 2, 0.08, -0.3 if k % 2 else 0.3)
        for k in range(4):
            if t + k * beat < seconds - 1.2:
                if k % 2 == 0:
                    mix.kick(t + k * beat, 0.32)
                mix.hat(t + k * beat + beat / 2, 0.05)
    for i, t in enumerate(dings):
        mix.ding(t, 76 + 2 * i)
    mix.ding(chime, 84)
    mix.ding(chime + 0.15, 88)
    return mix.wav(fade_out=1.5)

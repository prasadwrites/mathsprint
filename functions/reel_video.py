"""Draws the daily Reel (see reels.py) frame by frame with Pillow and encodes it with its soundtrack into an MP4.

1080x1920 at 30 frames a second, 24 seconds. The story:
  0-10s   night: the hook types in, three stress cards drop onto the pile while the tutor stress meter climbs, and the
          screen shakes at MELTDOWN.
  10-12s  MathSprint arrives: a burst of color and the wordmark.
  12-20s  day: three fix cards slide in with check marks and the meter drops back to calm.
  20-24s  the punchline, mathsprint.org and a relaxed face in sunglasses.
Text stays clear of the parts of the screen Instagram covers (the top bar, the buttons on the right, the caption at
the bottom). ffmpeg comes from the imageio-ffmpeg package, which carries its own copy.
"""

from __future__ import annotations

import math
import os
import random
import subprocess
import tempfile
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFilter, ImageFont

import reel_music

W, H, FPS = 1080, 1920, 30
DURATION = 24.0
LEFT, RIGHT = 80, 940  # Instagram's buttons cover the right edge
CX = (LEFT + RIGHT) // 2

# The timeline, in seconds.
T_CARDS = (3.4, 5.4, 7.4)
T_MELT = 8.4
T_WIPE = 10.3
T_LOGO = 10.8
T_DAY = 12.2
T_FIXES = (12.7, 14.7, 16.7)
T_END = 19.6
T_CTA = 20.8
FADE = 0.35

# Where things go.
GAUGE_Y, GAUGE_R, FACE_R = 520, 180, 70
HOOK_Y = 740
CARD_Y = (930, 1124, 1318)
CARD_W, CARD_H, CARD_M = RIGHT - LEFT, 176, 30  # CARD_M: room for the shadow around a card

INK = (23, 32, 44)
WHITE = (255, 255, 255)
RED = (230, 57, 70)
GREEN = (36, 168, 104)
METER = [(46, 184, 114), (247, 201, 72), (245, 140, 50), (230, 57, 70)]
FACE = (255, 210, 90)
HOT_FACE = (250, 150, 110)

# Colors that change from day to day: the night sky, the day background, the brand color, and a highlight.
PALETTES = [
    {"night": ((20, 26, 50), (60, 30, 70)), "day": ((232, 240, 255), (255, 255, 255)), "accent": (37, 87, 214), "pop": (255, 196, 61)},
    {"night": ((16, 34, 46), (66, 36, 40)), "day": ((228, 247, 240), (255, 255, 255)), "accent": (15, 118, 98), "pop": (255, 150, 70)},
    {"night": ((30, 22, 54), (22, 42, 74)), "day": ((242, 236, 255), (255, 255, 255)), "accent": (98, 60, 210), "pop": (255, 98, 128)},
    {"night": ((24, 24, 32), (70, 40, 24)), "day": ((255, 244, 230), (255, 255, 255)), "accent": (214, 84, 37), "pop": (255, 214, 64)},
]

_FONTS = os.path.join(os.path.dirname(__file__), "fonts")


@lru_cache(maxsize=64)
def _font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    name = {"display": "InterDisplay-ExtraBold.otf", "text": "Inter-Medium.otf"}[kind]
    return ImageFont.truetype(os.path.join(_FONTS, name), size)


_MEASURE = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def _wrap(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        if lines and _MEASURE.textlength(f"{lines[-1]} {word}", font=font) <= width:
            lines[-1] += f" {word}"
        else:
            lines.append(word)
    return lines


def _fit(text: str, kind: str, size: int, width: int, max_lines: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """The largest font up to `size` that fits `text` in `max_lines` lines of `width`, and those lines."""
    while True:
        font = _font(kind, size)
        lines = _wrap(text, font, width)
        widest = max((_MEASURE.textlength(line, font=font) for line in lines), default=0)
        if (len(lines) <= max_lines and widest <= width) or size <= 24:
            return font, lines
        size -= 2


def _ease_out(p: float) -> float:
    p = min(max(p, 0.0), 1.0)
    return 1 - (1 - p) ** 3


def _ease_back(p: float) -> float:
    """Overshoots a little and settles: a bounce for things landing."""
    p = min(max(p, 0.0), 1.0)
    c = 1.9
    return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2


def _approach(start: float, events: list[tuple[float, float]], t: float, seconds: float = 0.6) -> float:
    """A value that moves smoothly to each event's value from its time on."""
    value = start
    for at, target in events:
        if t >= at:
            value += (target - value) * _ease_out((t - at) / seconds)
    return value


def _gradient(top: tuple, bottom: tuple) -> Image.Image:
    mask = Image.linear_gradient("L").resize((W, H))
    return Image.composite(Image.new("RGB", (W, H), bottom), Image.new("RGB", (W, H), top), mask)


def _doodles(img: Image.Image, color: tuple, alpha: int, seed: int) -> Image.Image:
    """Faint math symbols scattered over a background."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    rng = random.Random(seed)
    for _ in range(26):
        symbol = rng.choice(["π", "√", "x²", "∑", "÷", "∞", "Δ", "θ", "%", "=", "+", "y=mx+b", "f(x)", "∫"])
        d.text((rng.randint(-40, W - 80), rng.randint(0, H - 80)), symbol, font=_font("display", rng.randint(50, 120)), fill=(*color, alpha))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def _card(text: str, good: bool, accent: tuple) -> Image.Image:
    """One stress card (red badge with !) or fix card (green badge with a check), with its shadow, as RGBA."""
    img = Image.new("RGBA", (CARD_W + 2 * CARD_M, CARD_H + 2 * CARD_M), (0, 0, 0, 0))
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((CARD_M, CARD_M + 10, CARD_M + CARD_W, CARD_M + CARD_H + 10), 30, fill=(0, 0, 0, 90))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(img)
    box = (CARD_M, CARD_M, CARD_M + CARD_W, CARD_M + CARD_H)
    d.rounded_rectangle(box, 30, fill=WHITE)
    d.rounded_rectangle((CARD_M, CARD_M, CARD_M + 14, CARD_M + CARD_H), 7, fill=accent if good else RED)
    bx, by, br = CARD_M + 86, CARD_M + CARD_H // 2, 42
    d.ellipse((bx - br, by - br, bx + br, by + br), fill=GREEN if good else RED)
    if good:
        d.line([(bx - 19, by + 1), (bx - 5, by + 16), (bx + 21, by - 14)], fill=WHITE, width=10, joint="curve")
    else:
        d.rounded_rectangle((bx - 5, by - 25, bx + 5, by + 6), 5, fill=WHITE)
        d.ellipse((bx - 6, by + 13, bx + 6, by + 25), fill=WHITE)
    left = CARD_M + 156
    font, lines = _fit(text, "display", 46, CARD_W - 156 - 36, 2)
    line_h = font.size * 1.18
    y = CARD_M + (CARD_H - line_h * len(lines)) / 2
    for line in lines:
        d.text((left, y), line, font=font, fill=INK)
        y += line_h
    return img


def _pill(text: str, accent: tuple) -> Image.Image:
    font = _font("display", 76)
    width = int(_MEASURE.textlength(text, font=font)) + 120
    img = Image.new("RGBA", (width, 150), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, width - 1, 149), 75, fill=WHITE)
    d.text((width / 2, 75), text, font=font, fill=accent, anchor="mm")
    return img


def _wordmark(color: tuple, size: int) -> Image.Image:
    font = _font("display", size)
    width = int(_MEASURE.textlength("MathSprint", font=font)) + 20
    img = Image.new("RGBA", (width, int(size * 1.3)), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((10, size * 0.65), "MathSprint", font=font, fill=color, anchor="lm")
    return img


def _paste_scaled(img: Image.Image, sprite: Image.Image, center: tuple[float, float], scale: float) -> None:
    if scale <= 0.02:
        return
    w, h = max(int(sprite.width * scale), 1), max(int(sprite.height * scale), 1)
    s = sprite.resize((w, h), Image.BILINEAR) if (w, h) != sprite.size else sprite
    img.paste(s, (int(center[0] - w / 2), int(center[1] - h / 2)), s)


def _words(text: str, font: ImageFont.FreeTypeFont, lines: list[str], x: int, y: int, line_h: float) -> list[tuple[str, tuple[float, float]]]:
    """Every word of the wrapped text with where it goes, so the text can appear word by word."""
    out = []
    for i, line in enumerate(lines):
        cursor = x
        for word in line.split():
            out.append((word, (cursor, y + i * line_h)))
            cursor += _MEASURE.textlength(word + " ", font=font)
    return out


def draw_face(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float, level: float, t: float, shades: bool = False) -> None:
    """The tutor: happy when calm, worried when busy, X-eyed with steam at meltdown."""
    hot = min(max((level - 0.7) / 0.3, 0.0), 1.0)
    fill = tuple(int(a + (b - a) * hot) for a, b in zip(FACE, HOT_FACE))
    if level >= 0.85:  # steam
        for i, sx in enumerate((-0.45, 0.45)):
            rise = ((t * 1.6 + i * 0.5) % 1.0)
            px, py = cx + sx * r, cy - r - 10 - rise * 50
            rr = 10 + rise * 14
            d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=(235, 235, 240))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill, outline=INK, width=5)
    ex, ey, w = r * 0.36, cy - r * 0.18, max(int(r * 0.07), 3)
    if shades:
        for sx in (-1, 1):
            d.rounded_rectangle((cx + sx * ex - r * 0.3, ey - r * 0.16, cx + sx * ex + r * 0.3, ey + r * 0.22), int(r * 0.12), fill=INK)
        d.line([(cx - ex + r * 0.3, ey - r * 0.05), (cx + ex - r * 0.3, ey - r * 0.05)], fill=INK, width=w)
        d.arc((cx - r * 0.45, cy - r * 0.1, cx + r * 0.45, cy + r * 0.6), 20, 160, fill=INK, width=w + 2)
        return
    if level >= 0.85:  # X eyes, wobbly mouth, sweat
        s = r * 0.13
        for sx in (-1, 1):
            x0 = cx + sx * ex
            d.line([(x0 - s, ey - s), (x0 + s, ey + s)], fill=INK, width=w)
            d.line([(x0 - s, ey + s), (x0 + s, ey - s)], fill=INK, width=w)
        pts = [(cx - r * 0.4 + i * r * 0.1, cy + r * 0.42 + (r * 0.07 if i % 2 else -r * 0.07)) for i in range(9)]
        d.line(pts, fill=INK, width=w, joint="curve")
    elif level >= 0.45:  # worried
        for sx in (-1, 1):
            x0 = cx + sx * ex
            d.ellipse((x0 - r * 0.08, ey - r * 0.08, x0 + r * 0.08, ey + r * 0.1), fill=INK)
            d.line([(x0 - sx * r * 0.16, ey - r * 0.3), (x0 + sx * r * 0.14, ey - r * 0.2)], fill=INK, width=w)
        d.arc((cx - r * 0.35, cy + r * 0.3, cx + r * 0.35, cy + r * 0.75), 200, 340, fill=INK, width=w)
    else:  # happy
        for sx in (-1, 1):
            x0 = cx + sx * ex
            d.arc((x0 - r * 0.14, ey - r * 0.08, x0 + r * 0.14, ey + r * 0.2), 200, 340, fill=INK, width=w)
            d.ellipse((x0 - r * 0.14, cy + r * 0.12, x0 + r * 0.14, cy + r * 0.3), fill=(255, 160, 140))
        d.chord((cx - r * 0.42, cy - r * 0.05, cx + r * 0.42, cy + r * 0.62), 10, 170, fill=INK)
    if level >= 0.45:  # a drop of sweat
        sx, sy = cx + r * 0.78, cy - r * 0.35
        d.polygon([(sx, sy - r * 0.2), (sx - r * 0.1, sy), (sx + r * 0.1, sy)], fill=(120, 190, 255))
        d.ellipse((sx - r * 0.1, sy - r * 0.08, sx + r * 0.1, sy + r * 0.12), fill=(120, 190, 255))


def _mood(level: float) -> str:
    return "Calm" if level < 0.25 else "Busy" if level < 0.5 else "Frazzled" if level < 0.8 else "MELTDOWN"


class Reel:
    """Everything that's drawn the same in every frame, made once; frame(t) draws the moment t seconds in."""

    def __init__(self, script: dict, palette: int = 0) -> None:
        p = PALETTES[palette % len(PALETTES)]
        self.accent, self.pop = p["accent"], p["pop"]
        self.night = _doodles(_gradient(*p["night"]), WHITE, 16, 1)
        self.day = _doodles(_gradient(*p["day"]), self.accent, 18, 2)
        dark = tuple(int(c * 0.62) for c in self.accent)
        self.brand = _doodles(_gradient(self.accent, dark), WHITE, 20, 3)
        self.stress = [_card(s, False, self.accent) for s in script["stresses"]]
        self.fixes = [_card(s, True, self.accent) for s in script["fixes"]]
        font, lines = _fit(script["hook"], "display", 70, CARD_W, 3)
        self.hook = (font, _words(script["hook"], font, lines, LEFT, HOOK_Y, font.size * 1.12))
        font, lines = _fit(script["punchline"], "display", 92, CARD_W, 4)
        self.punch = (font, _words(script["punchline"], font, lines, LEFT, 520, font.size * 1.1))
        self.logo = _wordmark(WHITE, 150)
        self.logo_small = _wordmark(WHITE, 64)
        self.pill = _pill("mathsprint.org", self.accent)
        self.label = _font("text", 30)
        self.mark = _font("display", 34)

    # The parts of a scene.

    def _meter(self, img: Image.Image, level: float, t: float, dark: bool, ox: float, oy: float) -> None:
        d = ImageDraw.Draw(img)
        cx, cy, r = CX + ox, GAUGE_Y + oy, GAUGE_R
        box = (cx - r, cy - r, cx + r, cy + r)
        d.arc(box, 180, 360, fill=(255, 255, 255) if dark else (225, 230, 240), width=44)
        for i, color in enumerate(METER):
            d.arc(box, 180 + i * 45 + 1, 180 + (i + 1) * 45 - 1, fill=color, width=34)
        angle = math.radians(180 + min(max(level, 0.0), 1.0) * 180)
        tip = (cx + math.cos(angle) * (r - 26), cy + math.sin(angle) * (r - 26))
        needle = WHITE if dark else INK
        d.line([(cx, cy), tip], fill=needle, width=12)
        d.ellipse((tip[0] - 9, tip[1] - 9, tip[0] + 9, tip[1] + 9), fill=needle)
        draw_face(d, cx, cy, FACE_R, level, t)
        text = (235, 238, 245) if dark else (80, 90, 110)
        d.text((cx, cy + FACE_R + 34), "TUTOR STRESS LEVEL", font=self.label, fill=text, anchor="mm")
        mood = _mood(level)
        color = METER[min(int(level * 4), 3)]
        if mood == "MELTDOWN" and int(t * 6) % 2:
            color = self.pop
        d.text((cx, cy + FACE_R + 82), mood, font=_font("display", 50), fill=color, anchor="mm")

    def _mark(self, img: Image.Image, color: tuple) -> None:
        ImageDraw.Draw(img).text((LEFT, 218), "mathsprint.org", font=self.mark, fill=color)

    def _type(self, img: Image.Image, words, font, since: float, color: tuple, ox: float = 0, oy: float = 0) -> None:
        d = ImageDraw.Draw(img)
        shown = int(since / 0.14) + 1 if since >= 0 else 0
        for word, (x, y) in words[:shown]:
            d.text((x + ox, y + oy), word, font=font, fill=color)

    def _night(self, t: float) -> Image.Image:
        img = self.night.copy()
        ox = oy = 0.0
        if T_MELT <= t < T_WIPE:
            amp = 13 * (1 - 0.5 * (t - T_MELT) / (T_WIPE - T_MELT))
            ox, oy = amp * math.sin(t * 61), amp * 0.6 * math.cos(t * 53)
        level = _approach(0.12, [(T_CARDS[0] + 0.3, 0.38), (T_CARDS[1] + 0.3, 0.64), (T_CARDS[2] + 0.3, 0.86), (T_MELT, 1.0)], t)
        if t >= T_MELT:
            level = min(level + 0.02 * math.sin(t * 40), 1.0)
        self._mark(img, (200, 205, 220))
        self._meter(img, level, t, True, ox, oy)
        font, words = self.hook
        self._type(img, words, font, t - 0.3, WHITE, ox, oy)
        for at, card, y in zip(T_CARDS, self.stress, CARD_Y):
            if t >= at:
                drop = (1 - _ease_back((t - at) / 0.5)) * -900
                img.paste(card, (int(LEFT - CARD_M + ox), int(y - CARD_M + drop + oy)), card)
        if t >= T_WIPE:  # MathSprint bursts out from the tutor's face
            r = _ease_out((t - T_WIPE) / 0.55) * 2300
            ImageDraw.Draw(img).ellipse((CX - r, GAUGE_Y - r, CX + r, GAUGE_Y + r), fill=self.accent)
        if t >= T_LOGO:
            img.paste(self.brand, (0, 0))
            _paste_scaled(img, self.logo, (W / 2, 900), _ease_back((t - T_LOGO) / 0.5))
            if t >= T_LOGO + 0.35:
                d = ImageDraw.Draw(img)
                d.text((W / 2, 1040), "to the rescue", font=_font("display", 64), fill=self.pop, anchor="mm")
        return img

    def _day(self, t: float) -> Image.Image:
        img = self.day.copy()
        level = _approach(1.0, [(T_FIXES[0] + 0.3, 0.66), (T_FIXES[1] + 0.3, 0.38), (T_FIXES[2] + 0.3, 0.06)], t, 0.9)
        self._mark(img, self.accent)
        self._meter(img, level, t, False, 0, 0)
        d = ImageDraw.Draw(img)
        d.text((LEFT, HOOK_Y + 20), "With MathSprint:", font=_font("display", 76), fill=self.accent)
        for at, card, y in zip(T_FIXES, self.fixes, CARD_Y):
            if t >= at:
                slide = (1 - _ease_back((t - at) / 0.5)) * (W + 60)
                img.paste(card, (int(LEFT - CARD_M + slide), y - CARD_M), card)
        return img

    def _end(self, t: float) -> Image.Image:
        img = self.brand.copy()
        img.paste(self.logo_small, (LEFT - 10, 300), self.logo_small)
        font, words = self.punch
        self._type(img, words, font, t - T_END - 0.3, WHITE)
        if t >= T_CTA:
            _paste_scaled(img, self.pill, (CX, 1130), _ease_back((t - T_CTA) / 0.45))
        if t >= T_CTA + 0.5:
            d = ImageDraw.Draw(img)
            d.text((CX, 1265), "Free to start · Built for tutors", font=_font("text", 42), fill=(225, 232, 255), anchor="mm")
        if t >= T_CTA + 0.8:
            face = Image.new("RGBA", (260, 260), (0, 0, 0, 0))
            draw_face(ImageDraw.Draw(face), 130, 130, 100, 0.0, t, shades=True)
            _paste_scaled(img, face, (CX, 1440), _ease_back((t - T_CTA - 0.8) / 0.45))
        return img

    def frame(self, t: float) -> Image.Image:
        if t < T_DAY:
            return self._night(t)
        if t < T_END:
            img = self._day(t)
            if t < T_DAY + FADE:
                return Image.blend(self._night(T_DAY - 0.01), img, (t - T_DAY) / FADE)
            return img
        img = self._end(t)
        if t < T_END + FADE:
            return Image.blend(self._day(T_END - 0.01), img, (t - T_END) / FADE)
        return img


def soundtrack() -> bytes:
    return reel_music.soundtrack(
        DURATION,
        drops=[t + 0.28 for t in T_CARDS],
        arrive=T_LOGO,
        dings=[t + 0.3 for t in T_FIXES],
        chime=T_CTA + 0.1,
    )


def _ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # running somewhere with ffmpeg installed instead
        return "ffmpeg"


def render(script: dict, palette: int = 0) -> bytes:
    """The Reel as MP4 bytes (H.264 and AAC, ready for Instagram)."""
    reel = Reel(script, palette)
    with tempfile.TemporaryDirectory() as tmp:
        audio, video = os.path.join(tmp, "music.wav"), os.path.join(tmp, "reel.mp4")
        with open(audio, "wb") as f:
            f.write(soundtrack())
        cmd = [
            _ffmpeg(), "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
            "-i", audio,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", video,
        ]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for i in range(int(DURATION * FPS)):
                proc.stdin.write(reel.frame(i / FPS).tobytes())
            proc.stdin.close()
            err = proc.stderr.read()
            if proc.wait() != 0:
                raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[-500:]}")
        finally:
            if proc.poll() is None:
                proc.kill()
        with open(video, "rb") as f:
            return f.read()

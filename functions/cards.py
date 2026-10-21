"""Score card images for sharing a challenge on Facebook, Instagram and the like.

Two sizes: "feed" (1200x630, what Facebook and X show for a link) and "story" (1080x1920, an Instagram or
Facebook story). A card shows either the challenger's score to beat, or a friend's result against it.
"""

from __future__ import annotations

import io
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

SIZES = {"feed": (1200, 630), "story": (1080, 1920)}
ACCENT = (37, 87, 214)
INK = (23, 32, 44)
WHITE = (255, 255, 255)
SOFT = (198, 214, 255)  # light text on the accent background
GOOD = (29, 122, 73)
_FONTS = os.path.join(os.path.dirname(__file__), "fonts")


@lru_cache(maxsize=64)
def _font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    name = {"display": "InterDisplay-ExtraBold.otf", "text": "Inter-Medium.otf", "mono": "JetBrainsMono-Bold.ttf"}[kind]
    return ImageFont.truetype(os.path.join(_FONTS, name), size)


def _fit(draw: ImageDraw.ImageDraw, text: str, kind: str, size: int, width: int) -> ImageFont.FreeTypeFont:
    """The largest font up to `size` that fits `text` on one line in `width` pixels."""
    while size > 12 and draw.textlength(text, font=_font(kind, size)) > width:
        size -= 2
    return _font(kind, size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines: list[str] = []
    for word in text.split():
        if lines and draw.textlength(f"{lines[-1]} {word}", font=font) <= width:
            lines[-1] += f" {word}"
        else:
            lines.append(word)
    return lines


def clock(sec: object) -> str:
    m, s = divmod(max(0, int(sec or 0)), 60)
    return f"{m}:{s:02d}"


def headline(c: dict, a: dict | None) -> str:
    """The card's big line, also used as the link preview's title."""
    who = c.get("challengerName") or "A friend"
    if a is None:
        return f"{who} got {c.get('score', 0)}/{c.get('total', 0)}. Can you beat that?"
    name, outcome = a.get("name") or "A friend", a.get("outcome")
    if outcome == "win":
        return f"{name} beat {who}!"
    if outcome == "loss":
        return f"{who} beat {name}"
    return f"{name} and {who} tied"


def render(c: dict, a: dict | None, size: str, host: str) -> bytes:
    """A PNG card for challenge `c`, or for friend attempt `a` against it."""
    w, h = SIZES.get(size, SIZES["feed"])
    story = h > w
    img = Image.new("RGB", (w, h), ACCENT)
    d = ImageDraw.Draw(img)
    pad = 72 if story else 60
    inner = w - 2 * pad

    # Brand, top left.
    y = pad
    d.text((pad, y), "Math", font=_font("display", 44), fill=WHITE)
    d.text((pad + d.textlength("Math", font=_font("display", 44)), y), "Sprint", font=_font("display", 44), fill=SOFT)

    # What the challenge is.
    y += 90 if story else 78
    title = f"CHALLENGE · {str(c.get('deckTitle') or '').upper()}"
    d.text((pad, y), title, font=_fit(d, title, "text", 30 if story else 26, inner), fill=SOFT)

    # The headline, wrapped.
    y += 56 if story else 44
    hfont = _font("display", 92 if story else 58)
    for line in _wrap(d, headline(c, a), hfont, inner)[:3]:
        d.text((pad, y), line, font=hfont, fill=WHITE)
        y += int(hfont.size * 1.12)

    # The scores, on a white panel.
    panel_h = 420 if story else 200
    top = y + 70 if story else max(h - pad - panel_h, y + 30)
    d.rounded_rectangle((pad, top, w - pad, top + panel_h), radius=28, fill=WHITE)
    total = c.get("total", 0)
    sides = [(c.get("challengerName") or "A friend", c.get("score", 0), c.get("usedSec", 0), a is not None and a.get("outcome") == "loss")]
    if a is not None:
        sides.insert(0, (a.get("name") or "A friend", a.get("score", 0), a.get("usedSec", 0), a.get("outcome") == "win"))
    col = inner / len(sides)
    for i, (name, score, sec, won) in enumerate(sides):
        cx = pad + col * i + col / 2
        nfont = _fit(d, name, "text", 34 if story else 26, int(col) - 40)
        sfont = _fit(d, f"{score}/{total}", "mono", 150 if story else 84, int(col) - 48)
        tfont = _font("text", 38 if story else 26)
        ny = top + (70 if story else 22)
        d.text((cx, ny), name, font=nfont, fill=INK, anchor="mt")
        d.text((cx, ny + (70 if story else 40)), f"{score}/{total}", font=sfont, fill=GOOD if won else INK, anchor="mt")
        d.text((cx, ny + (250 if story else 132)), f"in {clock(sec)}" + ("  ·  winner" if won else ""), font=tfont, fill=GOOD if won else INK, anchor="mt")
    if len(sides) == 2:
        d.line((pad + col, top + 30, pad + col, top + panel_h - 30), fill=(221, 227, 234), width=3)

    # Where to play.
    if story:
        foot = "Play free, no account needed"
        y = top + panel_h + 80
        d.text((w / 2, y), foot, font=_font("display", 50), fill=WHITE, anchor="mt")
        d.text((w / 2, y + 74), host, font=_fit(d, host, "text", 36, inner), fill=SOFT, anchor="mt")
        # Center the whole block, clear of the app's own buttons at the top and bottom of a story.
        used = y + 74 + 50
        block = img.crop((0, 0, w, used))
        img = Image.new("RGB", (w, h), ACCENT)
        img.paste(block, (0, max(0, (h - used) // 2)))
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()

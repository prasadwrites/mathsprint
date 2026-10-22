"""Score card images for sharing a challenge or a public test's leaderboard on Facebook, Instagram and the like.

Two sizes: "feed" (1200x630, what Facebook and X show for a link) and "story" (1080x1920, an Instagram or
Facebook story). A challenge card shows either the challenger's score to beat, or a friend's result against it; a
leaderboard card (render_board) shows a public test's top places.
"""

from __future__ import annotations

import io
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

import leaderboards

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


# Inter draws Latin, Greek and Cyrillic. Names in other scripts (a leaderboard for players in India or Japan, say)
# use the Noto font for their script, laid out with Raqm so joined and right-to-left letters come out right.
_SCRIPTS = [
    ((0x0590, 0x05FF), "NotoSansHebrew-Bold.ttf"),
    ((0x0600, 0x06FF), "NotoSansArabic-Bold.ttf"), ((0x0750, 0x077F), "NotoSansArabic-Bold.ttf"),
    ((0xFB50, 0xFDFF), "NotoSansArabic-Bold.ttf"), ((0xFE70, 0xFEFF), "NotoSansArabic-Bold.ttf"),
    ((0x0900, 0x097F), "NotoSansDevanagari-Bold.ttf"), ((0x0980, 0x09FF), "NotoSansBengali-Bold.ttf"),
    ((0x0A00, 0x0A7F), "NotoSansGurmukhi-Bold.ttf"), ((0x0A80, 0x0AFF), "NotoSansGujarati-Bold.ttf"),
    ((0x0B00, 0x0B7F), "NotoSansOriya-Bold.ttf"), ((0x0B80, 0x0BFF), "NotoSansTamil-Bold.ttf"),
    ((0x0C00, 0x0C7F), "NotoSansTelugu-Bold.ttf"), ((0x0C80, 0x0CFF), "NotoSansKannada-Bold.ttf"),
    ((0x0D00, 0x0D7F), "NotoSansMalayalam-Bold.ttf"), ((0x0E00, 0x0E7F), "NotoSansThai-Bold.ttf"),
    ((0x1100, 0x11FF), "NotoSansCJKsc-Bold.otf"), ((0x2E80, 0x9FFF), "NotoSansCJKsc-Bold.otf"),
    ((0xAC00, 0xD7AF), "NotoSansCJKsc-Bold.otf"), ((0xF900, 0xFAFF), "NotoSansCJKsc-Bold.otf"),
    ((0xFF00, 0xFFEF), "NotoSansCJKsc-Bold.otf"),
]


def script_font(text: str) -> str | None:
    """The Noto font file for the first character of `text` that Inter can't draw, or None when Inter can."""
    for ch in str(text):
        c = ord(ch)
        for (lo, hi), name in _SCRIPTS:
            if lo <= c <= hi:
                return name
    return None


@lru_cache(maxsize=64)
def _noto(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(_FONTS, name), size, layout_engine=ImageFont.Layout.RAQM)


def _font_for(text: str, kind: str, size: int) -> ImageFont.FreeTypeFont:
    name = script_font(text) if kind != "mono" else None
    return _noto(name, size) if name else _font(kind, size)


def _fit(draw: ImageDraw.ImageDraw, text: str, kind: str, size: int, width: int) -> ImageFont.FreeTypeFont:
    """The largest font up to `size` that fits `text` on one line in `width` pixels, in a font that has its script."""
    while size > 12 and draw.textlength(text, font=_font_for(text, kind, size)) > width:
        size -= 2
    return _font_for(text, kind, size)


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
    hfont = _font_for(headline(c, a), "display", 92 if story else 58)
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


MEDALS = [(201, 146, 18), (138, 150, 165), (176, 110, 60)]  # gold, silver, bronze for the top three


def render_board(t: dict, size: str, host: str) -> bytes:
    """A PNG card for a public test: its top places, and an invitation to take them on."""
    w, h = SIZES.get(size, SIZES["feed"])
    story = h > w
    img = Image.new("RGB", (w, h), ACCENT)
    d = ImageDraw.Draw(img)
    pad = 72 if story else 60
    inner = w - 2 * pad
    rows = (t.get("board") or [])[: 8 if story else 3]
    total = int(t.get("total") or 0)

    y = pad
    d.text((pad, y), "Math", font=_font("display", 44), fill=WHITE)
    d.text((pad + d.textlength("Math", font=_font("display", 44)), y), "Sprint", font=_font("display", 44), fill=SOFT)

    y += 90 if story else 74
    title = f"LEADERBOARD · {str(t.get('deckTitle') or '').upper()}"
    d.text((pad, y), title, font=_fit(d, title, "text", 30 if story else 26, inner), fill=SOFT)

    y += 56 if story else 42
    text = leaderboards.headline(t)
    if story:
        hfont = _font_for(text, "display", 92)
        for line in _wrap(d, text, hfont, inner)[:3]:
            d.text((pad, y), line, font=hfont, fill=WHITE)
            y += int(hfont.size * 1.12)
    else:
        hfont = _fit(d, text, "display", 58, inner)
        d.text((pad, y), text, font=hfont, fill=WHITE)
        y += int(hfont.size * 1.2)
    sub = f"{total} questions · against the clock · play free, no account needed"
    d.text((pad, y + (28 if story else 0)), sub, font=_fit(d, sub, "text", 34 if story else 24, inner), fill=SOFT)
    y += 100 if story else 44

    # The top places on a white panel.
    row_h = 110 if story else 64
    panel_h = (max(len(rows), 1) * row_h) + (60 if story else 28)
    top = y + 30 if story else max(h - pad - panel_h, y + 10)
    d.rounded_rectangle((pad, top, w - pad, top + panel_h), radius=28, fill=WHITE)
    ry = top + (30 if story else 14)
    if not rows:
        msg = "Nobody's on the board yet. Be the first!"
        d.text((w / 2, ry + row_h / 2), msg, font=_fit(d, msg, "display", 50 if story else 34, inner - 60), fill=INK, anchor="mm")
    for i, r in enumerate(rows):
        cy = ry + row_h / 2
        left = pad + (36 if story else 28)
        rad = 34 if story else 22
        d.ellipse((left, cy - rad, left + 2 * rad, cy + rad), fill=MEDALS[i] if i < 3 else (221, 227, 234))
        d.text((left + rad, cy), str(i + 1), font=_font("mono", 36 if story else 24), fill=WHITE if i < 3 else INK, anchor="mm")
        score = f"{r.get('score', 0)}/{total}"
        sec = f"{clock(r.get('usedSec'))}"
        right = w - pad - (36 if story else 28)
        tfont = _font("text", 36 if story else 24)
        sfont = _font("mono", 50 if story else 34)
        d.text((right, cy), sec, font=tfont, fill=INK, anchor="rm")
        sx = right - d.textlength(sec, font=tfont) - (40 if story else 28)
        d.text((sx, cy), score, font=sfont, fill=GOOD if i == 0 else INK, anchor="rm")
        nx = left + 2 * rad + (28 if story else 20)
        name = str(r.get("name") or "Player")
        nfont = _fit(d, name, "display", 46 if story else 32, int(sx - d.textlength(score, font=sfont) - nx - 30))
        d.text((nx, cy), name, font=nfont, fill=INK, anchor="lm")
        if i < len(rows) - 1:
            d.line((nx, ry + row_h, right, ry + row_h), fill=(232, 236, 241), width=2)
        ry += row_h

    if story:
        y = top + panel_h + 80
        d.text((w / 2, y), "Your name could be here", font=_font("display", 50), fill=WHITE, anchor="mt")
        d.text((w / 2, y + 74), host, font=_fit(d, host, "text", 36, inner), fill=SOFT, anchor="mt")
        used = y + 74 + 50
        block = img.crop((0, 0, w, used))
        img = Image.new("RGB", (w, h), ACCENT)
        img.paste(block, (0, max(0, (h - used) // 2)))
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()

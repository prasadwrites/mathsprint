"""Score card images for sharing a challenge or a public test's leaderboard on Facebook, Instagram and the like.

Two sizes: "feed" (1200x630, what Facebook and X show for a link) and "story" (1080x1920, an Instagram or
Facebook story). A challenge card shows either the challenger's score to beat, or a friend's result against it; a
leaderboard card (render_board) shows a public test's top places; a question card (render_question) shows one
question from a deck, with its graph or diagram, for a question post.
"""

from __future__ import annotations

import io
import os
import re
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

import figure_image
import leaderboards
import posts

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
        hfont = _font("display", 92)
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


def _card_text(text: str) -> str:
    return text.replace("∠", "angle ")  # the one math sign the card fonts don't have


_OPERATOR = re.compile(r" ([=+−×÷<>≤≥≠]|-) ")


def _wrap_math(d: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Wraps like _wrap, but keeps "AB = 6" and "x + 3" on one line, which reads better than breaking at the sign."""
    kept = _OPERATOR.sub(lambda m: f"\u00a0{m.group(1)}\u00a0", text)
    lines: list[str] = []
    for word in kept.split(" "):
        if not word:
            continue
        if lines and d.textlength(f"{lines[-1]} {word}", font=font) <= width:
            lines[-1] += f" {word}"
        else:
            lines.append(word)
    return lines


def _question_block(d: ImageDraw.ImageDraw, q: dict, width: int, height: int, biggest: int) -> tuple[int, list]:
    """The question's words, math and choices laid out as large as they fit in width by height. Returns the height
    used and the lines to draw, each (kind, size, text, gap above)."""
    prompt, math_ = _card_text(str(q.get("prompt") or "").strip()), _card_text(str(q.get("math") or "").strip())
    choices = [_card_text(str(c)) for c in q.get("choices") or []][:6]
    size = biggest
    while True:
        tf, mf, cf = _font("text", size), _font("mono", round(size * 1.08)), _font("mono", round(size * 0.8))
        lines = [("text", tf.size, line, 0) for line in _wrap_math(d, prompt, tf, width)]
        mlines = _wrap_math(d, math_, mf, width)
        lines += [("mono", mf.size, line, round(size * 0.45) if i == 0 and lines else 0) for i, line in enumerate(mlines)]
        two = len(choices) > 1 and all(d.textlength(f"A  {c}", font=cf) <= width / 2 - 50 for c in choices)
        rows = [choices[i:i + 2] for i in range(0, len(choices), 2)] if two else [[c] for c in choices]
        lines += [("choices", cf.size, row, round(size * 0.6) if i == 0 else round(cf.size * 0.5)) for i, row in enumerate(rows)]
        used = sum(round(n * (1.9 if kind == "choices" else 1.22)) + gap for kind, n, _, gap in lines)
        if used <= height or size <= 20:
            return used, lines
        size -= 2


def _draw_question_block(d: ImageDraw.ImageDraw, lines: list, x: int, y: int, width: int) -> None:
    letter = 0
    cell = (width - 20) / 2 if any(kind == "choices" and len(text) == 2 for kind, _, text, _ in lines) else width
    for kind, size, text, gap in lines:
        y += gap
        if kind == "choices":
            for j, c in enumerate(text):
                cx = x + j * (cell + 20)
                box_h = round(size * 1.6)
                d.rounded_rectangle((cx, y, cx + cell, y + box_h), radius=14, outline=(201, 210, 222), width=3, fill=(243, 245, 248))
                tag = "ABCDEF"[letter]
                d.text((cx + 22, y + box_h / 2), tag, font=_font("display", size), fill=ACCENT, anchor="lm")
                d.text((cx + 22 + size * 1.4, y + box_h / 2), c, font=_font("mono", size), fill=INK, anchor="lm")
                letter += 1
            y += round(size * 1.9)
            continue
        d.text((x, y), text, font=_font("text" if kind == "text" else "mono", size), fill=INK if kind == "text" else ACCENT)
        y += round(size * 1.22)


def render_question(post: dict, size: str, host: str) -> bytes:
    """A PNG card for a question post: the question, big, with its graph or diagram, and a call to answer it."""
    w, h = SIZES.get(size, SIZES["feed"])
    story = h > w
    q = post.get("question") or {}
    img = Image.new("RGB", (w, h), ACCENT)
    d = ImageDraw.Draw(img)
    pad = 72 if story else 52
    inner = w - 2 * pad

    y = pad
    d.text((pad, y), "Math", font=_font("display", 44), fill=WHITE)
    d.text((pad + d.textlength("Math", font=_font("display", 44)), y), "Sprint", font=_font("display", 44), fill=SOFT)
    tag = f"CHALLENGE · {str(post.get('deckTitle') or '').upper()}"
    if story:
        y += 90
        d.text((pad, y), tag, font=_fit(d, tag, "text", 30, inner), fill=SOFT)
        y += 56
        hfont = _font("display", 104)
        d.text((pad, y), posts.headline(post), font=_fit(d, posts.headline(post), "display", 104, inner), fill=WHITE)
        y += int(hfont.size * 1.25)
    else:
        tfont = _fit(d, tag, "text", 24, inner - 340)
        d.text((w - pad, y + 24), tag, font=tfont, fill=SOFT, anchor="rm")
        y += 72
        d.text((pad, y), posts.headline(post), font=_font("display", 56), fill=WHITE)
        y += 82

    # The question on a white panel, with its figure beside it (feed) or under it (story).
    fig = q.get("figure")
    foot_h = 300 if story else 96
    panel_top = y
    panel_bottom = h - pad - foot_h if story else h - foot_h
    ppad = 48 if story else 30
    pw, ph = inner - 2 * ppad, panel_bottom - panel_top - 2 * ppad
    fig_img = None
    if fig and story:
        fig_img = figure_image.render(fig, pw, round(ph * 0.55))
        text_w, text_h = pw, ph - fig_img.height - 40
    elif fig:
        fig_img = figure_image.render(fig, round(pw * 0.48), ph)
        text_w, text_h = pw - fig_img.width - 30, ph
    else:
        text_w, text_h = pw, ph
    used, lines = _question_block(d, q, text_w, text_h, 72 if story else 46)
    if story:  # shrink the panel to what it holds, so the call to answer sits right under it
        content = used + (fig_img.height + 40 if fig_img else 0)
        panel_bottom = panel_top + content + 2 * ppad
    d.rounded_rectangle((pad, panel_top, w - pad, panel_bottom), radius=30, fill=WHITE)
    tx, ty = pad + ppad, panel_top + ppad
    if fig_img and story:
        _draw_question_block(d, lines, tx, ty, text_w)
        img.paste(fig_img, (round(w / 2 - fig_img.width / 2), ty + used + 40))
    elif fig_img:
        _draw_question_block(d, lines, tx, ty + max(0, (ph - used) // 2), text_w)
        img.paste(fig_img, (w - pad - ppad - fig_img.width, panel_top + ppad + (ph - fig_img.height) // 2))
    else:
        _draw_question_block(d, lines, tx, ty + max(0, (ph - used) // 2) if not story else ty, text_w)

    # The call to answer: a button-shaped pill and the site.
    label = "Answer it →"
    bfont = _font("display", 52 if story else 34)
    bw, bh = d.textlength(label, font=bfont) + (96 if story else 64), (110 if story else 62)
    if story:
        by = panel_bottom + 80
        d.rounded_rectangle((w / 2 - bw / 2, by, w / 2 + bw / 2, by + bh), radius=bh / 2, fill=WHITE)
        d.text((w / 2, by + bh / 2), label, font=bfont, fill=ACCENT, anchor="mm")
        line = f"Free, no account needed · {host}"
        d.text((w / 2, by + bh + 50), line, font=_fit(d, line, "text", 36, inner), fill=SOFT, anchor="mt")
        used_h = by + bh + 50 + 50
        block = img.crop((0, 0, w, used_h))
        img = Image.new("RGB", (w, h), ACCENT)
        img.paste(block, (0, max(0, (h - used_h) // 2)))
    else:
        by = h - foot_h + (foot_h - bh) // 2
        d.rounded_rectangle((w - pad - bw, by, w - pad, by + bh), radius=bh / 2, fill=WHITE)
        d.text((w - pad - bw / 2, by + bh / 2), label, font=bfont, fill=ACCENT, anchor="mm")
        line = f"Free, no account needed · {host}"
        d.text((pad, by + bh / 2), line, font=_fit(d, line, "text", 28, int(inner - bw - 30)), fill=WHITE, anchor="lm")
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()

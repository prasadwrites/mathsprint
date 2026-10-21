"""Head-to-head challenges: a student shares a finished practice session, and a friend plays the same questions.

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes. Answers are graded
with the same rules as group tests (groups.grade), on the server, so the friend never sees the key.
"""

from __future__ import annotations

import html
import re
import secrets

MAX_ATTEMPTS = 200  # friends who can play one challenge link
MAX_NAME = 30


def new_token() -> str:
    return secrets.token_urlsafe(12)


def clean_name(name: object) -> str:
    """The name a friend plays under, shown to the challenger. Blank becomes "A friend"."""
    return " ".join(str(name or "").split())[:MAX_NAME] or "A friend"


def challenger_time(used_sec: object, limit_sec: object) -> int:
    """The challenger's time as the session recorded it, which the browser wrote, so kept within the time limit."""
    try:
        used = max(0.0, float(used_sec or 0))
    except (TypeError, ValueError):
        used = 0.0
    limit = int(limit_sec or 0)
    return round(min(used, limit) if limit else used)


def outcome(friend: dict, challenger: dict) -> str:
    """"win", "loss" or "tie" for the friend: the higher score wins, and the faster time breaks a tie."""
    fs, cs = int(friend.get("score") or 0), int(challenger.get("score") or 0)
    if fs != cs:
        return "win" if fs > cs else "loss"
    ft, ct = int(friend.get("usedSec") or 0), int(challenger.get("usedSec") or 0)
    if ft != ct:
        return "win" if ft < ct else "loss"
    return "tie"


def brag(name: str, score: int, total: int, used_sec: int, title: str) -> str:
    """The line the challenger shares, e.g. "I got 16/20 in 7:10 on SAT Geometry. Beat me!"."""
    m, s = divmod(int(used_sec), 60)
    return f"I got {score}/{total} in {m}:{s:02d} on {title}. Beat me!"


# Link previews. Facebook, X, WhatsApp and iMessage read these tags when a challenge link is shared.
_HOST = re.compile(r"^[a-z0-9.-]+(:\d{2,5})?$")
_PREVIEW = re.compile(r"<!-- og -->.*?<!-- /og -->", re.S)
_TITLE = re.compile(r"<title>.*?</title>", re.S)


def public_host(forwarded: object, default: str) -> str:
    """The host the visitor used (a custom domain, say), if it looks like one; otherwise the default site."""
    host = str(forwarded or "").split(",")[0].strip().lower()
    return host if host and _HOST.match(host) else default


def preview_tags(title: str, description: str, url: str, image: str) -> str:
    e = lambda s: html.escape(s, quote=True)  # noqa: E731
    return "\n".join([
        "<!-- og -->",
        f'<meta name="description" content="{e(description)}" />',
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="MathSprint" />',
        f'<meta property="og:title" content="{e(title)}" />',
        f'<meta property="og:description" content="{e(description)}" />',
        f'<meta property="og:url" content="{e(url)}" />',
        f'<meta property="og:image" content="{e(image)}" />',
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{e(title)}" />',
        f'<meta name="twitter:description" content="{e(description)}" />',
        f'<meta name="twitter:image" content="{e(image)}" />',
        "<!-- /og -->",
    ])


def with_preview(index_html: str, title: str, description: str, url: str, image: str) -> str:
    """The app's index.html with this challenge's title and preview tags in place of the site's own."""
    tags = preview_tags(title, description, url, image)
    page = _PREVIEW.sub(lambda _: tags, index_html, count=1) if _PREVIEW.search(index_html) else index_html.replace("</head>", f"{tags}\n</head>", 1)
    return _TITLE.sub(lambda _: f"<title>{html.escape(title)} · MathSprint</title>", page, count=1)


def preview_description(c: dict, a: dict | None) -> str:
    title, total = c.get("deckTitle") or "a math challenge", c.get("total", 0)
    if a is None:
        return f"{total} questions on {title}. Play free on MathSprint, no account needed, and see who wins."
    return f"{a.get('name') or 'A friend'} {a.get('score', 0)}/{total} vs {c.get('challengerName') or 'A friend'} {c.get('score', 0)}/{total} on {title}. Think you can beat them? Play free on MathSprint."

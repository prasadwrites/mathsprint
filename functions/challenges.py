"""Head-to-head challenges: a student shares a finished practice session, and a friend plays the same questions.

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes. Answers are graded
with the same rules as group tests (groups.grade), on the server, so the friend never sees the key.
"""

from __future__ import annotations

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

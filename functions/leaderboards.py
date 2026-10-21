"""Public test links with a leaderboard (admin only).

The admin turns a deck into a public link (/p/TOKEN) without taking it. Anyone can play it under a name, with no
account, and is graded on the server. A result only goes on the leaderboard once its player signs up (or signs in)
and claims it, so every name on the board belongs to a real account. Ranking: more right answers first, then the
faster time, then whoever finished first.

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import random
import secrets

MAX_ATTEMPTS = 10_000  # plays one public link takes
BOARD_SIZE = 100  # leaderboard rows kept on the test, for the page and the share card
SHOWN = 10  # rows a visitor sees
MAX_NAME = 30
FILL = 8  # sample players keep the board this full until real players take their places
SEED_AT = 9_000_000_000_000_000  # sample players "finished" last, so a real player wins any tie
_FIRST = ["Maya", "Ethan", "Sofia", "Jayden", "Priya", "Lucas", "Aaliyah", "Noah", "Chloe", "Mateo", "Hannah", "Arjun",
          "Zoe", "Diego", "Grace", "Caleb", "Isabella", "Omar", "Lily", "Marcus", "Ava", "Kenji", "Nora", "Elijah",
          "Camila", "Owen", "Riya", "Tyler", "Leah", "Andre", "Emily", "Samir", "Jade", "Ryan", "Fatima", "Logan"]
_LAST = "ABCDEFGHJKLMNPRSTVWY"


def new_token() -> str:
    return secrets.token_urlsafe(9)


def clean_name(name: object) -> str:
    """The name a player goes on the board under. Required, so an empty one comes back empty."""
    return " ".join(str(name or "").split())[:MAX_NAME]


def sample_players(total: int, limit_sec: int, rng: random.Random | None = None) -> list[dict]:
    """FILL made-up players for a new link's leaderboard, so the first post doesn't show an empty board. Their scores
    sit between about 45% and 85% right, so a strong real player goes straight to the top."""
    rng = rng or random.Random()
    names = rng.sample(_FIRST, FILL)
    room = limit_sec or total * 60
    out = []
    for i, name in enumerate(names):
        score = max(1, round(total * rng.uniform(0.45, 0.85))) if total else 0
        out.append({
            "id": f"sample-{i}",
            "name": f"{name} {rng.choice(_LAST)}.",
            "score": min(score, total),
            "usedSec": max(20, round(room * rng.uniform(0.35, 0.9))),
            "at": SEED_AT,
            "sample": True,
        })
    return out


def showing_samples(samples: list[dict], real: int) -> list[dict]:
    """The sample players still on the board with `real` real players on it: enough to keep it FILL long, dropping the
    best samples first, so real players take over the top places."""
    keep = max(0, FILL - real)
    return sorted(samples, key=_key)[len(samples) - keep:] if keep else []


def _key(a: dict) -> tuple:
    return (-int(a.get("score") or 0), int(a.get("usedSec") or 0), int(a.get("at") or 0))


def board(attempts: list[dict], samples: list[dict] | None = None) -> list[dict]:
    """The leaderboard from claimed attempts ({uid, name, score, usedSec, at}): each account's best result once,
    best first, cut to BOARD_SIZE, with sample players filling it while it's short. Rows keep what the public page
    shows, plus "sample" on made-up players for the admin (open_public_test leaves it out)."""
    best: dict[str, dict] = {}
    for a in attempts:
        uid = a.get("uid")
        if not uid:
            continue
        if uid not in best or _key(a) < _key(best[uid]):
            best[uid] = a
    rows = sorted([*best.values(), *showing_samples(samples or [], len(best))], key=_key)[:BOARD_SIZE]
    return [{"name": r.get("name") or "Player", "score": int(r.get("score") or 0), "usedSec": int(r.get("usedSec") or 0), "at": int(r.get("at") or 0),
             **({"sample": True} if r.get("sample") else {})} for r in rows]


def rank_of(rows: list[dict], score: int, used_sec: int, at: int) -> int:
    """Where a result places (1 is top) among the board's rows: one past every row that beats or ties it earlier."""
    me = _key({"score": score, "usedSec": used_sec, "at": at})
    return 1 + sum(1 for r in rows if _key(r) < me)


def top_line(rows: list[dict], total: int) -> str:
    """"Maya 18/20 · Leo 17/20 · Sam 17/20", the top three for a preview's text."""
    return " · ".join(f"{i + 1}. {r['name']} {r['score']}/{total}" for i, r in enumerate(rows[:3]))


def headline(t: dict) -> str:
    """The card's big line, also the link preview's title."""
    rows = t.get("board") or []
    if not rows:
        return f"Be #1 on the {t.get('deckTitle') or 'math'} leaderboard"
    return "Think you can crack the top 10?" if len(rows) >= 10 else "Can you top this leaderboard?"


def preview_description(t: dict) -> str:
    total, title = int(t.get("total") or 0), t.get("deckTitle") or "math"
    rows = t.get("board") or []
    play = "Free, no account needed to play. How fast is your math?"
    if not rows:
        return f"{total} questions on {title}. Nobody's on the leaderboard yet. {play}"
    return f"{total} questions on {title}. Leaderboard: {top_line(rows, total)}. {play}"


def share_text(t: dict) -> str:
    """What the admin's share buttons post with the link."""
    total, title = int(t.get("total") or 0), t.get("deckTitle") or "math"
    rows = t.get("board") or []
    if not rows:
        return f"Calling all math fans: {total} questions on {title}, against the clock. Take the first spot on the leaderboard!"
    top = rows[0]
    m, s = divmod(top["usedSec"], 60)
    return f"Calling all math fans: {top['name']} leads {title} with {top['score']}/{total} in {m}:{s:02d}. Think you can beat that?"

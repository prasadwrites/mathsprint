"""Question posts for social media (admin only).

The admin picks one question from a deck and gets a post: a card picture of the question and a link (/q/TOKEN). A
visitor answers it with no account, sees whether they got it right and how it's solved, then keeps going with more
questions from the same deck. Signing up saves the whole deck to their new account.

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import secrets

MAX_POSTS_PER_DECK = 50
SHOW_RATE_AFTER = 10  # answers on a post before the page shows how many people got it right


def new_token() -> str:
    return secrets.token_urlsafe(9)


def question_text(q: dict) -> str:
    """The question as one line: its words, then its math."""
    return " ".join(s for s in (str(q.get("prompt") or "").strip(), str(q.get("math") or "").strip()) if s)


def snippet(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0]
    return f"{cut}…"


def public_question(q: dict, index: int) -> dict:
    """What a visitor's browser gets for one question: everything to show and answer it, nothing that gives it away."""
    return {
        "index": index,
        "prompt": q.get("prompt", ""),
        "math": q.get("math", ""),
        "figure": q.get("figure"),
        "type": q.get("type", "numeric"),
        "choices": q.get("choices") or [],
        "answerCount": len(q.get("answerValues") or []) or 1,
        "pair": bool(q.get("pair")),
        "concept": q.get("concept", ""),
        "difficulty": q.get("difficulty", ""),
    }


def reveal(q: dict) -> dict:
    """The answer and how it's solved, once the visitor has answered."""
    answer = q.get("answerChoice") if q.get("type") == "choice" else q.get("answerDisplay")
    return {
        "answer": answer or q.get("answerDisplay") or "",
        "steps": [{"description": s.get("description", ""), "expression": s.get("expression", "")} for s in q.get("steps") or []],
    }


def play_order(total: int, featured: int) -> list[int]:
    """The order a visitor meets the deck's questions: the posted one, then the ones after it, wrapping around."""
    if total <= 0:
        return []
    featured = featured if 0 <= featured < total else 0
    return [(featured + i) % total for i in range(total)]


def right_rate(post: dict) -> int | None:
    """The percent of people who got the posted question right, once enough have answered to make it mean something."""
    answers, right = int(post.get("answers") or 0), int(post.get("right") or 0)
    if answers < SHOW_RATE_AFTER:
        return None
    return round(100 * right / answers)


def headline(post: dict) -> str:
    """The card's big line, also the link preview's title."""
    return "Can you solve this?"


def preview_description(post: dict) -> str:
    q = snippet(question_text(post.get("question") or {}), 160)
    title = post.get("deckTitle") or "math"
    return f"{q} Answer free on MathSprint, no account needed, then try more {title} questions."


def share_text(post: dict) -> str:
    """What the admin's share buttons post with the link."""
    title = post.get("deckTitle") or "math"
    q = snippet(question_text(post.get("question") or {}), 120)
    return f"Quick {title} challenge: {q} Can you solve it? Tap to answer, free, no account needed."

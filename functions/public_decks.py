"""Public decks: decks the admin made public, which every signed-in user sees on their home page and anyone can see
listed on the sign-in page. Each user can hide one from their own home page; the deck itself stays the admin's."""

import subjects

MAX_LISTED = 60


def is_public(deck: dict | None) -> bool:
    return bool(deck) and deck.get("public") is True


def can_open(deck: dict | None, uid: str) -> bool:
    """Whether this signed-in user may read the deck: their own, shared with them, or public."""
    if not deck:
        return False
    return deck.get("ownerId") == uid or uid in (deck.get("sharedWith") or []) or is_public(deck)


def card(deck_id: str, deck: dict) -> dict:
    """What the sign-in page shows of a public deck. No owner or sharing details, since anyone can read it."""
    created = deck.get("createdAt")
    return {
        "id": deck_id,
        "title": str(deck.get("title") or "Practice deck")[:80],
        "subject": subjects.of(deck),
        "level": str(deck.get("level") or ""),
        "difficulty": str(deck.get("difficulty") or ""),
        "topics": [str(t) for t in (deck.get("topics") or [])][:8],
        "questionCount": int(deck.get("questionCount") or 0),
        "choicesOnly": bool(deck.get("choicesOnly")),
        "createdAt": int(created.timestamp() * 1000) if hasattr(created, "timestamp") else 0,
    }


def cards(rows: list[tuple[str, dict]]) -> list[dict]:
    """Public decks that have questions, newest first."""
    out = [card(i, d) for i, d in rows if is_public(d) and int(d.get("questionCount") or 0) > 0]
    out.sort(key=lambda c: c["createdAt"], reverse=True)
    return out[:MAX_LISTED]

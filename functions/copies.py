"""A deck owner duplicates one of their decks: a new deck of their own with the same questions, named "<name> (copy)".

A copy needs no Claude call, so it doesn't count toward the plan's decks and needs no access code. It starts with no
practice history and isn't shared with anyone. Plain Python; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

MAX_TITLE = 80  # the same limit as renaming (firestore.rules, web/src/lib/db.ts)
SUFFIX = " (copy)"

# Who the deck is shared with, and when it was made, belong to the original only.
NOT_COPIED = {"sharedWith", "sharedBy", "createdAt", "ownerId", "source", "copiedFrom", "fromPost"}


def copy_title(title: object) -> str:
    """"<name> (copy)", cutting the name short so the whole thing fits in MAX_TITLE characters."""
    name = " ".join(str(title or "").split()) or "Deck"
    return name[: MAX_TITLE - len(SUFFIX)].rstrip() + SUFFIX


def copy_fields(deck: dict, deck_id: str, uid: str) -> dict:
    """The new deck's fields, apart from createdAt."""
    out = {k: v for k, v in deck.items() if k not in NOT_COPIED}
    out.update(ownerId=uid, title=copy_title(deck.get("title")), source="copy", copiedFrom=deck_id)
    return out

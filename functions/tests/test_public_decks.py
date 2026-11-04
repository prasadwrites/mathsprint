from datetime import datetime, timezone

import public_decks


def test_only_decks_marked_public_count():
    assert public_decks.is_public({"public": True})
    assert not public_decks.is_public({"public": "yes"})
    assert not public_decks.is_public({})
    assert not public_decks.is_public(None)


def test_who_can_open_a_deck():
    deck = {"ownerId": "admin", "sharedWith": ["sam"]}
    assert public_decks.can_open(deck, "admin")
    assert public_decks.can_open(deck, "sam")
    assert not public_decks.can_open(deck, "lee")
    assert public_decks.can_open({**deck, "public": True}, "lee")
    assert not public_decks.can_open(None, "lee")


def test_cards_leave_out_owner_details_and_empty_decks():
    old = datetime(2026, 10, 1, tzinfo=timezone.utc)
    new = datetime(2026, 11, 1, tzinfo=timezone.utc)
    rows = [
        ("a", {"public": True, "title": "Old", "questionCount": 10, "createdAt": old, "ownerId": "admin", "sharedWith": ["x"], "sharedBy": "Prasad"}),
        ("b", {"public": True, "title": "New", "questionCount": 5, "createdAt": new, "subject": "Physics"}),
        ("c", {"public": True, "title": "Empty", "questionCount": 0, "createdAt": new}),
        ("d", {"title": "Private", "questionCount": 5, "createdAt": new}),
    ]
    out = public_decks.cards(rows)
    assert [c["id"] for c in out] == ["b", "a"]
    assert out[0]["subject"] == "Physics" and out[1]["subject"] == "Math"
    assert not {"ownerId", "sharedWith", "sharedBy"} & set(out[1])

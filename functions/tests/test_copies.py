import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import copies  # noqa: E402


def test_copy_title_adds_copy():
    assert copies.copy_title("Quadratics") == "Quadratics (copy)"


def test_copy_title_fits_the_rename_limit():
    title = copies.copy_title("x" * 80)
    assert len(title) == copies.MAX_TITLE
    assert title.endswith(" (copy)")


def test_copy_title_tidies_spaces_and_blank_names():
    assert copies.copy_title("  Linear   equations ") == "Linear equations (copy)"
    assert copies.copy_title("") == "Deck (copy)"
    assert copies.copy_title(None) == "Deck (copy)"


def test_copy_fields_belong_to_the_new_owner_and_leave_sharing_behind():
    deck = {
        "ownerId": "owner", "title": "Limits", "subject": "Math", "level": "AP Calculus", "difficulty": "Hard",
        "topics": ["Limits"], "questionCount": 10, "source": "ai", "choicesOnly": True, "sourcePdf": "ch2.pdf",
        "sharedWith": ["friend"], "sharedBy": "Sam", "createdAt": object(),
    }
    out = copies.copy_fields(deck, "deck1", "owner")
    assert out == {
        "ownerId": "owner", "title": "Limits (copy)", "subject": "Math", "level": "AP Calculus", "difficulty": "Hard",
        "topics": ["Limits"], "questionCount": 10, "source": "copy", "copiedFrom": "deck1", "choicesOnly": True,
        "sourcePdf": "ch2.pdf",
    }


def test_copy_of_a_saved_post_deck_is_a_plain_copy():
    out = copies.copy_fields({"title": "Post", "source": "ai", "fromPost": "p1"}, "d", "u")
    assert "fromPost" not in out and out["source"] == "copy"

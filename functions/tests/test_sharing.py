import pytest

import sharing
from accounts import AccessDenied


def test_email_is_cleaned_and_checked():
    assert sharing.clean_share_email("  Sam@Example.com ", "me@example.com") == "sam@example.com"
    with pytest.raises(AccessDenied, match="valid email"):
        sharing.clean_share_email("not-an-email", "me@example.com")
    with pytest.raises(AccessDenied, match="your own email"):
        sharing.clean_share_email("ME@example.com", "me@example.com")


def test_cannot_share_with_yourself():
    with pytest.raises(AccessDenied, match="own account"):
        sharing.check_can_share("u1", "u1", [])


def test_sharing_again_is_a_no_op():
    assert sharing.check_can_share("u1", "u2", []) is True
    assert sharing.check_can_share("u1", "u2", ["u2"]) is False


def test_share_limit():
    full = [f"u{i}" for i in range(sharing.MAX_SHARES)]
    with pytest.raises(AccessDenied, match="up to"):
        sharing.check_can_share("owner", "someone-new", full)
    assert sharing.check_can_share("owner", "u3", full) is False  # already there, still fine


def test_who_can_unshare():
    assert sharing.can_unshare("owner", "owner", "u2")
    assert sharing.can_unshare("u2", "owner", "u2")
    assert not sharing.can_unshare("u3", "owner", "u2")


def test_only_pro_and_pro_max_can_share():
    assert not sharing.can_share_decks({"plan": "free"}, False)
    assert sharing.can_share_decks({"plan": "pro"}, False)
    assert sharing.can_share_decks({"plan": "promax"}, False)
    assert sharing.can_share_decks({"plan": "free"}, True)  # the admin
    with pytest.raises(AccessDenied, match="Pro and Pro Max"):
        sharing.check_can_share_decks({"plan": "free"}, False)
    with pytest.raises(AccessDenied, match="suspended"):
        sharing.check_can_share_decks({"plan": "pro", "status": "suspended"}, False)


def test_a_running_promotion_counts():
    import time
    account = {"plan": "free", "promo": {"plan": "pro", "endsAt": int(time.time() * 1000) + 86_400_000}}
    assert sharing.can_share_decks(account, False)
    expired = {"plan": "free", "promo": {"plan": "pro", "endsAt": 1}}
    assert not sharing.can_share_decks(expired, False)

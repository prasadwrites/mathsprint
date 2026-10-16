import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import accounts  # noqa: E402
from accounts import AccessDenied, check_can_generate, clean_update, code_ok, is_admin, new_account, summary  # noqa: E402


def acct(**kw):
    return {**new_account("s@example.com", "S"), **kw}


def test_plan_limits_match_the_spec():
    assert [(p.max_decks, p.max_questions) for p in accounts.PLANS.values()] == [(5, 20), (50, 120), (100, 200)]
    assert accounts.MAX_QUESTIONS == 200


def test_admin_needs_the_verified_owner_email():
    assert is_admin({"email": "Prasad.Writes@gmail.com", "email_verified": True})
    assert not is_admin({"email": "prasad.writes@gmail.com", "email_verified": False})
    assert not is_admin({"email": "someone@gmail.com", "email_verified": True})
    assert not is_admin(None)


def test_free_plan_allows_five_decks_of_twenty():
    check_can_generate(acct(decksCreated=4), 20, admin=False)
    with pytest.raises(AccessDenied, match="20 questions"):
        check_can_generate(acct(), 21, admin=False)
    with pytest.raises(AccessDenied, match="all 5 decks"):
        check_can_generate(acct(decksCreated=5), 10, admin=False)


def test_pro_and_pro_max_raise_the_limits():
    check_can_generate(acct(plan="pro", decksCreated=49), 120, admin=False)
    with pytest.raises(AccessDenied):
        check_can_generate(acct(plan="pro"), 121, admin=False)
    check_can_generate(acct(plan="promax", decksCreated=99), 200, admin=False)
    with pytest.raises(AccessDenied):
        check_can_generate(acct(plan="promax", decksCreated=100), 10, admin=False)


def test_unknown_plan_falls_back_to_free():
    assert summary(acct(plan="gold"), admin=False)["maxDecks"] == 5


def test_suspended_accounts_cannot_generate_even_as_admin():
    with pytest.raises(AccessDenied, match="suspended"):
        check_can_generate(acct(status="suspended"), 5, admin=False)
    with pytest.raises(AccessDenied, match="suspended"):
        check_can_generate(acct(status="suspended"), 5, admin=True)


def test_admin_has_no_plan_limits():
    check_can_generate(acct(decksCreated=1000), 200, admin=True)


def test_own_code_replaces_the_shared_code():
    assert code_ok("mine-123", "mine-123", "shared", admin=False)
    assert not code_ok("shared", "mine-123", "shared", admin=False)
    assert code_ok("shared", None, "shared", admin=False)
    assert code_ok("shared", "  ", "shared", admin=False)
    assert not code_ok("", None, "", admin=False)
    assert code_ok("", "mine-123", "shared", admin=True)


def test_generated_codes_are_readable():
    code = accounts.new_code()
    assert len(code) == 19 and code.count("-") == 3
    assert not set(code) & set("01IOL")


def test_clean_update_keeps_only_valid_fields():
    assert clean_update({"plan": "pro", "status": "suspended", "resetDecks": True, "uid": "x"}) == {
        "plan": "pro", "status": "suspended", "decksCreated": 0,
    }
    with pytest.raises(ValueError):
        clean_update({"plan": "ultra"})
    with pytest.raises(ValueError):
        clean_update({"status": "deleted"})


def test_upgrade_requests_must_go_up_one_at_a_time():
    from accounts import check_upgrade_request

    check_upgrade_request("free", "pro", has_pending=False, admin=False)
    check_upgrade_request("free", "promax", has_pending=False, admin=False)
    check_upgrade_request("pro", "promax", has_pending=False, admin=False)
    for current, wanted in [("pro", "pro"), ("promax", "pro"), ("pro", "free")]:
        with pytest.raises(AccessDenied, match="already on"):
            check_upgrade_request(current, wanted, has_pending=False, admin=False)
    with pytest.raises(AccessDenied, match="waiting"):
        check_upgrade_request("free", "pro", has_pending=True, admin=False)
    with pytest.raises(AccessDenied):
        check_upgrade_request("free", "gold", has_pending=False, admin=False)
    with pytest.raises(AccessDenied):
        check_upgrade_request("free", "pro", has_pending=False, admin=True)

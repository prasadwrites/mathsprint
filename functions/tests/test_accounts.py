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


def test_heartbeats_add_a_minute_each_but_not_faster():
    day = 1_760_000_000_000  # some fixed time
    acct = {}
    first = accounts.credit_activity(acct, day)
    assert first["activeSeconds"] == 60 and first["activeDays"] == {accounts.day_key(day): 60}
    acct.update(first)
    assert accounts.credit_activity(acct, day + 10_000) is None  # a second tab in the same minute
    acct.update(accounts.credit_activity(acct, day + 60_000))
    assert acct["activeSeconds"] == 120


def test_activity_summary_counts_today_and_last_seven_days_and_drops_old_days():
    now = 1_760_000_000_000
    key = accounts.day_key
    acct = {"activeSeconds": 9000, "activeDays": {key(now): 120, key(now - 3 * accounts.DAY_MS): 600, key(now - 10 * accounts.DAY_MS): 900, key(now - 40 * accounts.DAY_MS): 50}, "lastBeatAt": now}
    s = accounts.activity_summary(acct, now)
    assert s == {"activeSeconds": 9000, "todaySeconds": 120, "weekSeconds": 720, "lastActiveAt": now}
    assert key(now - 40 * accounts.DAY_MS) not in accounts.credit_activity(acct, now + 60_000)["activeDays"]


def test_first_five_decks_need_no_access_code():
    import pytest

    for made in range(accounts.CODE_FREE_DECKS):
        accounts.check_code(acct(decksCreated=made), False, "", admin=False)  # no code, no problem
    sixth = acct(plan="pro", decksCreated=5)
    with pytest.raises(AccessDenied, match="Enter an access code"):
        accounts.check_code(sixth, False, "", admin=False)
    with pytest.raises(AccessDenied, match="isn't right"):
        accounts.check_code(sixth, False, "nope", admin=False)
    accounts.check_code(sixth, True, "good", admin=False)
    accounts.check_code(sixth, False, "", admin=True)
    assert summary(acct(decksCreated=3), admin=False)["codeFreeLeft"] == 2
    assert summary(sixth, admin=False)["needsCode"] is True
    assert summary(sixth, admin=True)["needsCode"] is False


def test_each_friend_who_joins_adds_a_deck_and_a_code_free_deck():
    a = acct(decksCreated=5, bonusDecks=2)
    assert summary(a, admin=False)["maxDecks"] == 7 and summary(a, admin=False)["codeFreeLeft"] == 2
    check_can_generate(a, 10, admin=False)  # 5 used of 5 + 2
    accounts.check_code(a, False, "", admin=False)  # still inside the 7 code-free decks
    with pytest.raises(AccessDenied, match="used all 7"):
        check_can_generate(acct(decksCreated=7, bonusDecks=2), 10, admin=False)


def test_invite_emails_are_checked():
    assert accounts.clean_invite_email("  Friend@Example.COM ", "me@example.com") == "friend@example.com"
    for bad in ["", "nope", "a@b", "me@example.com"]:
        with pytest.raises(AccessDenied):
            accounts.clean_invite_email(bad, "Me@Example.com")

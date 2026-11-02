import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import accounts  # noqa: E402
import offers  # noqa: E402
from accounts import AccessDenied, new_account  # noqa: E402

ET = offers.EASTERN


def ms(y, m, d, h=12):
    return int(datetime(y, m, d, h, tzinfo=ET).timestamp() * 1000)


NOW = ms(2026, 11, 2)


def acct(**kw):
    return {**new_account("s@example.com", "S"), **kw}


def offer(**kw):
    return {"plan": "pro", "months": 3, "redeemBy": ms(2026, 11, 30, 23), "maxUses": 0, "uses": 0, "disabled": False, **kw}


def test_codes_are_cleaned_and_generated_readably():
    assert offers.clean_code(" fall-2026 ") == "FALL-2026"
    assert offers.clean_code("ab") == ""
    assert offers.clean_code("bad code!") == ""
    code = offers.new_code()
    assert offers.clean_code(code) == code and code.startswith("MS-")


def test_redeem_by_is_the_end_of_that_day_eastern():
    end = offers.redeem_by_ms("2026-11-30")
    assert datetime.fromtimestamp(end / 1000, tz=ET).strftime("%Y-%m-%d %H:%M:%S") == "2026-11-30 23:59:59"
    with pytest.raises(AccessDenied):
        offers.redeem_by_ms("not a date")


def test_admin_offer_is_validated():
    f = offers.check_new_offer({"plan": "promax", "months": "6", "redeemBy": "2026-12-31", "maxUses": "50"}, NOW)
    assert (f["plan"], f["months"], f["maxUses"]) == ("promax", 6, 50)
    assert offers.check_new_offer({"plan": "pro", "months": 1, "redeemBy": "2026-11-02"}, NOW)["maxUses"] == 0  # today is fine
    for bad in (
        {"plan": "free", "months": 1, "redeemBy": "2026-12-01"},
        {"plan": "pro", "months": 0, "redeemBy": "2026-12-01"},
        {"plan": "pro", "months": 25, "redeemBy": "2026-12-01"},
        {"plan": "pro", "months": 1, "redeemBy": "2026-11-01"},
        {"plan": "pro", "months": 1, "redeemBy": "2026-12-01", "maxUses": "-3"},
    ):
        with pytest.raises(AccessDenied):
            offers.check_new_offer(bad, NOW)


def test_expired_code_says_when_it_expired():
    with pytest.raises(AccessDenied, match="expired on Nov 30, 2026"):
        offers.check_offer(offer(), ms(2026, 12, 1, 0))
    offers.check_offer(offer(), ms(2026, 11, 30, 23))  # still fine late on the last day


def test_unknown_used_up_and_disabled_codes():
    with pytest.raises(AccessDenied, match="isn't valid"):
        offers.check_offer(None, NOW)
    with pytest.raises(AccessDenied, match="as many times"):
        offers.check_offer(offer(maxUses=2, uses=2), NOW)
    with pytest.raises(AccessDenied, match="no longer available"):
        offers.check_offer(offer(disabled=True), NOW)


def test_free_account_gets_the_plan_for_its_months_then_free_again():
    a = acct()
    offers.check_redeem(offer(plan="promax"), a, False, False, NOW)
    a["promo"] = offers.promo_from("X", offer(plan="promax", months=3), NOW)
    assert accounts.plan_id(a, NOW) == "promax"
    assert accounts.plan_id(a, a["promo"]["endsAt"] - 1) == "promax"
    assert accounts.plan_id(a, a["promo"]["endsAt"]) == "free"


def test_pro_account_goes_back_to_pro_after_a_pro_max_code():
    a = acct(plan="pro")
    offers.check_redeem(offer(plan="promax"), a, False, False, NOW)
    a["promo"] = offers.promo_from("X", offer(plan="promax", months=1), NOW)
    assert accounts.plan_id(a, NOW) == "promax"
    assert accounts.plan_id(a, a["promo"]["endsAt"] + 1) == "pro"


def test_codes_that_would_change_nothing_or_repeat_are_refused():
    with pytest.raises(AccessDenied, match="already on Pro"):
        offers.check_redeem(offer(plan="pro"), acct(plan="pro"), False, False, NOW)
    with pytest.raises(AccessDenied, match="already used"):
        offers.check_redeem(offer(), acct(), True, False, NOW)
    with pytest.raises(AccessDenied, match="admin"):
        offers.check_redeem(offer(), acct(), False, True, NOW)
    with pytest.raises(AccessDenied, match="suspended"):
        offers.check_redeem(offer(), acct(status="suspended"), False, False, NOW)
    running = acct(promo={"plan": "promax", "endsAt": NOW + 10 * accounts.DAY_MS})
    with pytest.raises(AccessDenied, match="already have Pro Max"):
        offers.check_redeem(offer(plan="pro"), running, False, False, NOW)
    # A running Pro promotion can be raised to Pro Max by a code.
    offers.check_redeem(offer(plan="promax"), acct(promo={"plan": "pro", "endsAt": NOW + 10 * accounts.DAY_MS}), False, False, NOW)


def test_terms_version():
    assert not offers.terms_accepted(acct())
    assert offers.terms_accepted(acct(termsVersion=offers.TERMS_VERSION))
    assert not offers.terms_accepted(acct(termsVersion="2020-01-01"))

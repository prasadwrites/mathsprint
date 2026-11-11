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


def test_parse_emails_splits_pasted_text_and_drops_repeats():
    good, bad = offers.parse_emails("A@x.com, b@y.org\nnot-an-email; a@X.com  <c@z.io>")
    assert good == ["a@x.com", "b@y.org", "c@z.io"]
    assert bad == ["not-an-email"]
    assert offers.parse_emails(["d@e.co"]) == (["d@e.co"], [])
    with pytest.raises(AccessDenied):
        offers.parse_emails("nobody")
    with pytest.raises(AccessDenied):
        offers.parse_emails([f"p{i}@x.com" for i in range(offers.MAX_SEND + 1)])


def test_do_not_contact_addresses_are_skipped():
    keep, skipped = offers.drop_do_not_contact(["a@x.com", "barriesouth@mathnasium.ca", "b@y.org"])
    assert keep == ["a@x.com", "b@y.org"]
    assert skipped == ["barriesouth@mathnasium.ca"]


def test_send_id_is_stable_per_code_and_email():
    assert offers.send_id("FALL-2026", "A@x.com") == offers.send_id("FALL-2026", "a@x.com")
    assert offers.send_id("FALL-2026", "a@x.com") != offers.send_id("FALL-2026", "b@x.com")
    assert offers.send_id("FALL-2026", "a@x.com").startswith("FALL-2026_")


def test_share_text_names_plan_term_code_and_last_day():
    text = offers.share_text(offers.public_offer("FALL-2026", offer(months=1)))
    assert "Pro free for 1 month" in text and "FALL-2026" in text and "Nov 30, 2026" in text


def test_redeem_hint_explains_why_not():
    assert offers.redeem_hint(offer(), acct(), False, NOW) == ""
    assert "already used" in offers.redeem_hint(offer(), acct(), True, NOW)
    assert "already on Pro" in offers.redeem_hint(offer(), acct(plan="pro"), False, NOW)

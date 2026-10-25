import base64
import hashlib
import hmac
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import payments  # noqa: E402
from accounts import AccessDenied  # noqa: E402


def signed(body: bytes, key: str, url: str = payments.WEBHOOK_URL) -> str:
    return base64.b64encode(hmac.new(key.encode(), url.encode() + body, hashlib.sha256).digest()).decode()


def event(kind="payment.updated", status="COMPLETED", order_id="ORDER1", amount=999, currency="USD") -> bytes:
    payment = {"id": "PAY1", "status": status, "order_id": order_id, "amount_money": {"amount": amount, "currency": currency}}
    return json.dumps({"type": kind, "data": {"type": "payment", "id": "PAY1", "object": {"payment": payment}}}).encode()


def test_checkout_only_for_a_bigger_paid_plan():
    assert payments.check_checkout("free", "pro", 999, admin=False) == "pro"
    assert payments.check_checkout("pro", "promax", 1999, admin=False) == "promax"
    with pytest.raises(AccessDenied, match="already on Pro"):
        payments.check_checkout("pro", "pro", 999, admin=False)
    with pytest.raises(AccessDenied, match="Pick a plan"):
        payments.check_checkout("free", "free", 999, admin=False)
    with pytest.raises(AccessDenied, match="no limits"):
        payments.check_checkout("free", "pro", 999, admin=True)
    with pytest.raises(AccessDenied, match="isn't set up"):
        payments.check_checkout("free", "pro", 0, admin=False)


def test_payment_link_tags_the_order_with_the_student_and_plan():
    body = payments.payment_link_body("abc", "uid1", "promax", "s@example.com", "LOC", "USD", 1999)
    order = body["order"]
    assert body["idempotency_key"] == order["reference_id"] == "abc"
    assert order["metadata"] == {"uid": "uid1", "plan": "promax"}
    assert order["line_items"][0]["base_price_money"] == {"amount": 1999, "currency": "USD"}
    assert order["line_items"][0]["name"] == "MathSprint Pro Max"
    assert body["checkout_options"]["redirect_url"] == "https://mathsprint.org/upgrade?paid=promax"
    assert body["pre_populated_data"] == {"buyer_email": "s@example.com"}
    assert "pre_populated_data" not in payments.payment_link_body("abc", "uid1", "pro", "", "LOC", "USD", 999)


def test_signature_must_match_the_key_url_and_body():
    body = event()
    good = signed(body, "key")
    assert payments.signature_ok(body, good, "key")
    assert not payments.signature_ok(body, good, "other key")
    assert not payments.signature_ok(body + b" ", good, "key")
    assert not payments.signature_ok(body, signed(body, "key", "https://example.com/hook"), "key")
    assert not payments.signature_ok(body, "", "key")
    assert not payments.signature_ok(body, good, "")


def test_only_completed_payments_count():
    assert payments.completed_payment(event()) == {"id": "PAY1", "orderId": "ORDER1", "amount": 999, "currency": "USD"}
    assert payments.completed_payment(event(kind="payment.created"))["orderId"] == "ORDER1"
    assert payments.completed_payment(event(status="APPROVED")) is None
    assert payments.completed_payment(event(kind="refund.updated")) is None
    assert payments.completed_payment(event(order_id="")) is None
    assert payments.completed_payment(b"not json") is None


def test_payment_must_cover_the_price_in_the_same_currency():
    checkout = {"amount": 999, "currency": "USD"}
    assert payments.paid_in_full(checkout, {"amount": 999, "currency": "USD"})
    assert payments.paid_in_full(checkout, {"amount": 1200, "currency": "USD"})  # with a tip
    assert not payments.paid_in_full(checkout, {"amount": 500, "currency": "USD"})
    assert not payments.paid_in_full(checkout, {"amount": 999, "currency": "CAD"})


def test_paying_never_lowers_a_plan():
    assert payments.plan_after_payment("free", "pro") == "pro"
    assert payments.plan_after_payment("pro", "promax") == "promax"
    assert payments.plan_after_payment("promax", "pro") == "promax"
    assert payments.plan_after_payment("bogus", "pro") == "pro"


def test_paid_message():
    assert payments.paid_message("pro", 999, "USD") == "Payment of $9.99 received through Square. You're on Pro now."
    assert payments.paid_message("promax", 1999, "CAD") == "Payment of 19.99 CAD received through Square. You're on Pro Max now."

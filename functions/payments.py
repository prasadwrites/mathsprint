"""Square payments that upgrade a plan on their own.

Each Pay now makes a Square payment link for that one person and plan (create_checkout in main.py), and the link's
order id is saved with who it's for. When Square tells the square_webhook function that the payment completed, the
signature proves the message came from Square and the order id says whose plan to switch, so no one has to approve it.

A payment works like the admin approving a request did: the plan stays until the admin changes it.

Everything here is plain Python so it can be tested without Firebase or Square; main.py does the network and Firestore.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json

from accounts import DEFAULT_PLAN, PLAN_ORDER, PLANS, AccessDenied

SQUARE_VERSION = "2025-01-23"
API_HOSTS = {"production": "https://connect.squareup.com", "sandbox": "https://connect.squareupsandbox.com"}
PAID_PLANS = ("pro", "promax")
SITE = "https://mathsprint.org"
WEBHOOK_PATH = "/square/webhook"
WEBHOOK_URL = SITE + WEBHOOK_PATH  # paste this into the Square Developer Dashboard, exactly


def api_host(environment: str) -> str:
    return API_HOSTS.get((environment or "").strip().lower(), API_HOSTS["production"])


def check_checkout(base_plan: str, plan: object, price_cents: int, admin: bool) -> str:
    """The plan to charge for. Raises AccessDenied with a message for the student."""
    if admin:
        raise AccessDenied("The admin account has no limits to upgrade.")
    if plan not in PAID_PLANS:
        raise AccessDenied("Pick a plan to upgrade to.")
    current = base_plan if base_plan in PLANS else DEFAULT_PLAN
    if PLAN_ORDER.index(plan) <= PLAN_ORDER.index(current):
        raise AccessDenied(f"You're already on {PLANS[current].label}. Pick a bigger plan.")
    if price_cents <= 0:
        raise AccessDenied("Paying online isn't set up yet. Send a request instead and we'll switch your plan.")
    return plan


def payment_link_body(checkout_id: str, uid: str, plan: str, email: str, location_id: str, currency: str, price_cents: int) -> dict:
    """The request that makes one person's Square payment link. checkout_id doubles as the idempotency key."""
    return {
        "idempotency_key": checkout_id,
        "description": f"MathSprint {PLANS[plan].label}",
        "order": {
            "location_id": location_id,
            "reference_id": checkout_id,
            "metadata": {"uid": uid, "plan": plan},
            "line_items": [{
                "name": f"MathSprint {PLANS[plan].label}",
                "quantity": "1",
                "base_price_money": {"amount": int(price_cents), "currency": currency},
            }],
        },
        "checkout_options": {"redirect_url": f"{SITE}/upgrade?paid={plan}", "ask_for_shipping_address": False},
        **({"pre_populated_data": {"buyer_email": email}} if email else {}),
        "payment_note": f"MathSprint {PLANS[plan].label} for {email or uid}",
    }


def signature_ok(body: bytes, signature: str, key: str, url: str = WEBHOOK_URL) -> bool:
    """Square signs the notification URL followed by the raw body with the webhook's signature key (HMAC-SHA256)."""
    if not key or not signature:
        return False
    digest = hmac.new(key.encode("utf-8"), url.encode("utf-8") + body, hashlib.sha256).digest()
    return hmac.compare_digest(base64.b64encode(digest).decode("ascii"), signature.strip())


def completed_payment(body: bytes) -> dict | None:
    """The completed payment in a payment.created or payment.updated event: {id, orderId, amount, currency}.
    None for any other event, or a payment that hasn't completed."""
    try:
        event = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(event, dict) or event.get("type") not in ("payment.created", "payment.updated"):
        return None
    payment = ((event.get("data") or {}).get("object") or {}).get("payment") or {}
    if payment.get("status") != "COMPLETED" or not payment.get("order_id"):
        return None
    money = payment.get("amount_money") or {}
    return {
        "id": str(payment.get("id") or ""),
        "orderId": str(payment["order_id"]),
        "amount": int(money.get("amount") or 0),
        "currency": str(money.get("currency") or ""),
    }


def paid_in_full(checkout: dict, payment: dict) -> bool:
    """The payment covers what the link asked for. Tips can only add to it."""
    return payment["currency"] == checkout.get("currency") and payment["amount"] >= int(checkout.get("amount") or 0)


def plan_after_payment(base_plan: str, paid_plan: str) -> str:
    """The plan someone is on after paying: the one they paid for, unless the admin already gave them a bigger one."""
    current = base_plan if base_plan in PLANS else DEFAULT_PLAN
    return paid_plan if PLAN_ORDER.index(paid_plan) > PLAN_ORDER.index(current) else current


def paid_message(plan: str, amount: int, currency: str) -> str:
    """The note on the student's upgrade request, so they and the admin can see the payment."""
    money = f"${amount / 100:,.2f}" if currency == "USD" else f"{amount / 100:,.2f} {currency}"
    return f"Payment of {money} received through Square. You're on {PLANS[plan].label} now."

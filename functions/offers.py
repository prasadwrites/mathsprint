"""Offer codes and the Terms of Use.

An offer code is made by the admin for a plan (Pro or Pro Max) and a number of months, with a last day it can be
redeemed. Someone signing up from the /join link, or anyone signed in, redeems it; the plan lasts that many months from
the day they redeem it. It's stored as the account's `promo`, the same as an accepted promotion, so accounts.plan_id()
stops counting it when the term ends and the account is back on its own plan (Free, or Pro if they'd paid for Pro).
Nothing has to run to switch it back.

Plain Python, so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import time
from datetime import date, datetime, time as dtime, timedelta
from zoneinfo import ZoneInfo

import accounts
from accounts import PLANS, PLAN_ORDER, AccessDenied

# The version of the Terms of Use at /terms. Change it (and TERMS_VERSION in web/src/lib/terms.ts) when the terms
# change in a way people must agree to again; everyone is asked once more on their next visit.
TERMS_VERSION = "2026-11-02"

OFFER_PLANS = ("pro", "promax")
MIN_MONTHS, MAX_MONTHS = 1, 24
MAX_USES = 100_000
MAX_DAYS_AHEAD = 3 * 366
EASTERN = ZoneInfo("America/New_York")
_CODE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,22}[A-Z0-9]$")
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no look-alikes such as 0/O or 1/I

INVALID = "That offer code isn't valid. Check it and try again."


def clean_code(value: object) -> str:
    """The code as stored: upper case, no spaces. Empty if it can't be a code."""
    code = re.sub(r"\s+", "", str(value or "")).upper()
    return code if _CODE.match(code) else ""


def new_code() -> str:
    """Easy to read out or type, such as MS-7KQP-X3DM."""
    return "MS-" + "-".join("".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(2))


def redeem_by_ms(day: object) -> int:
    """The last moment a code can be redeemed: the end of that day in US Eastern time."""
    try:
        d = date.fromisoformat(str(day or ""))
    except ValueError:
        raise AccessDenied("Pick the last day the code can be redeemed.")
    end = datetime.combine(d + timedelta(days=1), dtime(0, 0), tzinfo=EASTERN)
    return int(end.timestamp() * 1000) - 1


def day_label(ms: int) -> str:
    """Nov 30, 2026, in US Eastern time."""
    d = datetime.fromtimestamp(ms / 1000, tz=EASTERN)
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def check_new_offer(data: dict, now_ms: int | None = None) -> dict:
    """Validates the admin's new code. Returns the fields to store (without the code itself). Raises AccessDenied."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    plan = data.get("plan")
    if plan not in OFFER_PLANS:
        raise AccessDenied("Pick Pro or Pro Max.")
    try:
        months = int(data.get("months"))
    except (TypeError, ValueError):
        months = 0
    if not MIN_MONTHS <= months <= MAX_MONTHS:
        raise AccessDenied(f"Pick between {MIN_MONTHS} and {MAX_MONTHS} months.")
    redeem_by = redeem_by_ms(data.get("redeemBy"))
    if redeem_by <= now_ms:
        raise AccessDenied("The last day to redeem must be today or later.")
    if redeem_by - now_ms > MAX_DAYS_AHEAD * accounts.DAY_MS:
        raise AccessDenied("The last day to redeem must be within 3 years.")
    raw_uses = data.get("maxUses")
    try:
        max_uses = int(raw_uses) if raw_uses not in (None, "") else 0
    except (TypeError, ValueError):
        max_uses = -1
    if not 0 <= max_uses <= MAX_USES:
        raise AccessDenied("Leave the number of uses empty for no limit, or enter a whole number.")
    return {
        "plan": plan,
        "months": months,
        "redeemBy": redeem_by,
        "redeemByDay": str(data.get("redeemBy")),
        "maxUses": max_uses,
        "note": str(data.get("note") or "").strip()[:200],
    }


def offer_status(offer: dict, now_ms: int | None = None) -> str:
    """active, expired, used_up or disabled."""
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if offer.get("disabled"):
        return "disabled"
    if now_ms > int(offer.get("redeemBy") or 0):
        return "expired"
    if int(offer.get("maxUses") or 0) and int(offer.get("uses") or 0) >= int(offer["maxUses"]):
        return "used_up"
    return "active"


def check_offer(offer: dict | None, now_ms: int | None = None) -> None:
    """Raises AccessDenied with a message anyone can read if this code can't be redeemed by anybody right now."""
    if not offer or offer.get("plan") not in OFFER_PLANS:
        raise AccessDenied(INVALID)
    status = offer_status(offer, now_ms)
    if status == "expired":
        raise AccessDenied(f"This offer code expired on {day_label(int(offer['redeemBy']))}.")
    if status == "used_up":
        raise AccessDenied("This offer code has already been used as many times as it allows.")
    if status == "disabled":
        raise AccessDenied("This offer code is no longer available.")


def check_redeem(offer: dict | None, account: dict, already_used: bool, admin: bool, now_ms: int | None = None) -> None:
    """Raises AccessDenied if this account can't redeem this code now."""
    check_offer(offer, now_ms)
    assert offer is not None
    if admin:
        raise AccessDenied("The admin account has no limits, so it doesn't need an offer code.")
    if account.get("status") == "suspended":
        raise AccessDenied("Your account is suspended.")
    if already_used:
        raise AccessDenied("You've already used this offer code.")
    plan = offer["plan"]
    base = accounts.base_plan_id(account)
    if PLAN_ORDER.index(plan) <= PLAN_ORDER.index(base):
        raise AccessDenied(f"You're already on {PLANS[base].label}, so this {PLANS[plan].label} code wouldn't change anything.")
    running = accounts.active_promo(account, now_ms)
    if running and PLAN_ORDER.index(running["plan"]) >= PLAN_ORDER.index(plan):
        raise AccessDenied(
            f"You already have {PLANS[running['plan']].label} until {day_label(int(running['endsAt']))}. "
            "Try this code again after that."
        )


def promo_from(code: str, offer: dict, now_ms: int) -> dict:
    """The account's promo for a redeemed code: the plan for `months` months from now."""
    return {
        "plan": offer["plan"],
        "months": int(offer["months"]),
        "startedAt": now_ms,
        "endsAt": accounts.add_months(now_ms, int(offer["months"])),
        "offerCode": code,
    }


def public_offer(code: str, offer: dict) -> dict:
    """What the /join page shows about a code before someone signs up."""
    return {
        "code": code,
        "plan": offer["plan"],
        "planLabel": PLANS[offer["plan"]].label,
        "months": int(offer["months"]),
        "redeemBy": int(offer["redeemBy"]),
    }


def terms_accepted(account: dict) -> bool:
    return account.get("termsVersion") == TERMS_VERSION


# Sending a code to people. The admin picks accounts or types email addresses; each person sees the code on their home
# page the next time they sign in (or once they sign up with that email), with buttons to pass it on to friends.
# Stored in offerSends/{send_id}, one per code and email, so sending the same code to someone again just shows it again.

MAX_SEND = 500
_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")


def parse_emails(value: object) -> tuple[list[str], list[str]]:
    """The addresses in a list or in pasted text (commas, semicolons, spaces or new lines between them).

    Returns (good, bad): good is lower case, with repeats removed, in the order given; bad is what didn't look like an
    email address. Raises AccessDenied if there's nobody to send to, or too many at once.
    """
    parts = value if isinstance(value, list) else re.split(r"[\s,;]+", str(value or ""))
    good: list[str] = []
    bad: list[str] = []
    for part in parts:
        p = str(part or "").strip().strip("<>").lower()
        if not p:
            continue
        if not _EMAIL.match(p) or len(p) > 254:
            bad.append(str(part).strip()[:80])
        elif p not in good:
            good.append(p)
    if not good:
        raise AccessDenied("Add at least one email address or pick some accounts.")
    if len(good) > MAX_SEND:
        raise AccessDenied(f"Send to at most {MAX_SEND} people at a time.")
    return good, bad


def send_id(code: str, email: str) -> str:
    """The same id every time for this code and email, so a second send replaces the first."""
    return f"{code}_{hashlib.sha256(email.lower().encode()).hexdigest()[:20]}"


def share_text(offer: dict) -> str:
    """What the person's friends get: the offer in one or two sentences. The link goes after it."""
    plan = PLANS[offer["plan"]].label
    months = int(offer["months"])
    term = f"{months} {'month' if months == 1 else 'months'}"
    return (
        f"Get MathSprint {plan} free for {term}, timed math practice that shows you where you lose points. "
        f"Sign up with offer code {offer['code']} by {day_label(int(offer['redeemBy']))}:"
    )


def redeem_hint(offer: dict, account: dict, already_used: bool, now_ms: int | None = None) -> str:
    """Empty if this account can redeem the code now, or a short reason it can't, for the home-page card."""
    if already_used:
        return "You've already used this code. Pass it on to your friends."
    try:
        check_redeem(offer, account, False, False, now_ms)
    except AccessDenied as e:
        return str(e)
    return ""

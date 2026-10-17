"""Account plans, deck limits, suspension and per-account access codes.

Everything here is plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from dataclasses import dataclass

from access import access_code_ok

ADMIN_EMAIL = "prasad.writes@gmail.com"


@dataclass(frozen=True)
class Plan:
    label: str
    max_decks: int
    max_questions: int


PLANS: dict[str, Plan] = {
    "free": Plan("Free", 5, 20),
    "pro": Plan("Pro", 50, 120),
    "promax": Plan("Pro Max", 100, 200),
}
DEFAULT_PLAN = "free"
STATUSES = {"active", "suspended"}
MIN_QUESTIONS = 3
MAX_QUESTIONS = max(p.max_questions for p in PLANS.values())
CODE_FREE_DECKS = 5  # everyone's first decks need no access code
WRONG_CODE = "That access code isn't right."


class AccessDenied(Exception):
    """Raised with a message the student can read."""


def is_admin(token: dict | None) -> bool:
    """The admin is the owner's email, and only once Firebase has verified it (Google sign-in always does)."""
    token = token or {}
    return (token.get("email") or "").lower() == ADMIN_EMAIL and token.get("email_verified") is True


def plan_for(account: dict) -> Plan:
    return PLANS.get(account.get("plan", DEFAULT_PLAN), PLANS[DEFAULT_PLAN])


def new_account(email: str, name: str) -> dict:
    return {"email": email, "displayName": name, "plan": DEFAULT_PLAN, "status": "active", "decksCreated": 0}


def summary(account: dict, admin: bool) -> dict:
    """What the app shows a student about their own account. Never includes the access code."""
    plan = plan_for(account)
    return {
        "plan": account.get("plan", DEFAULT_PLAN) if account.get("plan") in PLANS else DEFAULT_PLAN,
        "planLabel": plan.label,
        "status": account.get("status", "active"),
        "decksCreated": int(account.get("decksCreated", 0)),
        "maxDecks": plan.max_decks,
        "maxQuestions": plan.max_questions,
        "isAdmin": admin,
        "needsCode": needs_code(account, admin),
        "codeFreeLeft": 0 if admin else max(0, CODE_FREE_DECKS - int(account.get("decksCreated", 0))),
    }


def needs_code(account: dict, admin: bool) -> bool:
    """An access code is only asked for once someone has built their first CODE_FREE_DECKS decks."""
    return not admin and int(account.get("decksCreated", 0)) >= CODE_FREE_DECKS


def check_code(account: dict, code_valid: bool, given: object, admin: bool) -> None:
    """Raises AccessDenied if this deck needs an access code and the right one wasn't given."""
    if code_valid or not needs_code(account, admin):
        return
    if not str(given or "").strip():
        raise AccessDenied(f"Your first {CODE_FREE_DECKS} decks didn't need a code. Enter an access code to build more.")
    raise AccessDenied(WRONG_CODE)


def check_can_generate(account: dict, count: int, admin: bool) -> None:
    """Raises AccessDenied if this account can't build a deck of `count` questions right now."""
    if account.get("status") == "suspended":
        raise AccessDenied("Your account is suspended. Contact the person who runs MathSprint.")
    if admin:
        return
    plan = plan_for(account)
    if count > plan.max_questions:
        raise AccessDenied(f"Your {plan.label} plan allows up to {plan.max_questions} questions per deck.")
    if int(account.get("decksCreated", 0)) >= plan.max_decks:
        raise AccessDenied(f"You've used all {plan.max_decks} decks on your {plan.label} plan.")


def code_ok(given: object, account_code: str | None, global_code: str | None, admin: bool) -> bool:
    """An account's own code wins; the shared DECK_ACCESS_CODE only works for accounts without one."""
    if admin:
        return True
    if (account_code or "").strip():
        return access_code_ok(given, account_code)
    return access_code_ok(given, global_code)


def new_code() -> str:
    """A code that's easy to read out or type: four groups of four, no look-alike characters."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "-".join("".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4))


def clean_update(data: dict) -> dict:
    """Validates an admin's edit to one account. Returns only the fields to change."""
    out: dict = {}
    if "plan" in data:
        if data["plan"] not in PLANS:
            raise ValueError("Unknown plan.")
        out["plan"] = data["plan"]
    if "status" in data:
        if data["status"] not in STATUSES:
            raise ValueError("Unknown status.")
        out["status"] = data["status"]
    if data.get("resetDecks"):
        out["decksCreated"] = 0
    return out


PLAN_ORDER = list(PLANS)  # free < pro < promax
MAX_MESSAGE = 1000


def check_upgrade_request(current_plan: str, requested_plan: str, has_pending: bool, admin: bool) -> None:
    """Raises AccessDenied (with a message for the student) if this upgrade request can't be made."""
    if admin:
        raise AccessDenied("The admin account has no limits to upgrade.")
    if requested_plan not in PLANS:
        raise AccessDenied("Pick a plan to upgrade to.")
    current = current_plan if current_plan in PLANS else DEFAULT_PLAN
    if PLAN_ORDER.index(requested_plan) <= PLAN_ORDER.index(current):
        raise AccessDenied(f"You're already on {PLANS[current].label}. Pick a bigger plan.")
    if has_pending:
        raise AccessDenied("You already have a request waiting. You'll see the reply here.")


# Time on site. The app sends one heartbeat for each minute someone is actively using it.
HEARTBEAT_SECONDS = 60
MIN_BEAT_GAP_MS = 50_000  # extra beats (other tabs, retries) inside a minute earn nothing
KEEP_DAYS = 35
DAY_MS = 86_400_000


def day_key(ms: int) -> str:
    """The UTC date of a time in milliseconds, as YYYY-MM-DD."""
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def credit_activity(account: dict, now_ms: int) -> dict | None:
    """The fields to write for one heartbeat, or None if it came too soon after the last one."""
    last = account.get("lastBeatAt")
    if isinstance(last, (int, float)) and 0 <= now_ms - last < MIN_BEAT_GAP_MS:
        return None
    today = day_key(now_ms)
    oldest = day_key(now_ms - KEEP_DAYS * DAY_MS)
    days = {k: int(v) for k, v in (account.get("activeDays") or {}).items() if k > oldest}
    days[today] = days.get(today, 0) + HEARTBEAT_SECONDS
    return {
        "activeSeconds": int(account.get("activeSeconds", 0)) + HEARTBEAT_SECONDS,
        "activeDays": days,
        "lastBeatAt": now_ms,
    }


def activity_summary(account: dict, now_ms: int) -> dict:
    """What the admin sees about someone's time on site."""
    days = account.get("activeDays") or {}
    week = {day_key(now_ms - i * DAY_MS) for i in range(7)}
    return {
        "activeSeconds": int(account.get("activeSeconds", 0)),
        "todaySeconds": int(days.get(day_key(now_ms), 0)),
        "weekSeconds": sum(int(v) for k, v in days.items() if k in week),
        "lastActiveAt": account.get("lastBeatAt"),
    }

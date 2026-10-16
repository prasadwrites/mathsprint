"""Account plans, deck limits, suspension and per-account access codes.

Everything here is plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import secrets
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
    }


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

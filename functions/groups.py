"""Contact groups and the tests their owners assign to them (Pro and Pro Max only).

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import math
import re
import secrets

from accounts import AccessDenied, plan_for, plan_id

GROUP_PLANS = {"pro", "promax"}
MAX_GROUPS = 50
MAX_MEMBERS = 300
MAX_GROUP_NAME = 80
MAX_LOCKOUT_TRIES = 10  # wrong access codes before a test link stops accepting tries
LATE_GRACE_MS = 120_000  # answers sent this long after the time ran out are marked late
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def can_use_groups(account: dict, admin: bool) -> bool:
    return admin or plan_id(account) in GROUP_PLANS


def check_can_use_groups(account: dict, admin: bool) -> None:
    if account.get("status") == "suspended":
        raise AccessDenied("Your account is suspended.")
    if not can_use_groups(account, admin):
        raise AccessDenied(f"Groups are part of Pro and Pro Max. You're on {plan_for(account).label}.")


def clean_group(name: object, emails: object) -> tuple[str, list[str]]:
    """The group's name and its emails, lowercased and without repeats. Raises AccessDenied with a message to show."""
    name = str(name or "").strip()[:MAX_GROUP_NAME]
    if not name:
        raise AccessDenied("Give the group a name.")
    if not isinstance(emails, list):
        emails = []
    out: list[str] = []
    for e in emails:
        e = str(e or "").strip().lower()
        if not e or e in out:
            continue
        if len(e) > 254 or not _EMAIL.match(e):
            raise AccessDenied(f"{e} isn't a valid email address.")
        out.append(e)
    if len(out) > MAX_MEMBERS:
        raise AccessDenied(f"A group can have up to {MAX_MEMBERS} emails.")
    return name, out


# Class links: one link for a whole class. Each student signs in with Google (such as their Google Classroom school
# account), so the owner's results show the name and email Google gives, and each account gets one attempt.
MAX_CLASS_NAME = 80
MAX_CLASS_TAKERS = 500
_DOMAIN = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def clean_domain(value: object) -> str:
    """An optional school domain such as "lincolnhigh.org" ("" for any Google account). Raises AccessDenied to show."""
    d = str(value or "").strip().lower().lstrip("@")
    if "@" in d:
        d = d.split("@")[-1]
    if not d:
        return ""
    if not _DOMAIN.match(d):
        raise AccessDenied(f"{d} isn't a valid email domain. Use something like school.org, or leave it empty.")
    return d


def email_in_domain(email: str, domain: str) -> bool:
    email = (email or "").lower()
    return not domain or email.endswith("@" + domain) or email.endswith("." + domain)


def google_identity(token: dict | None) -> dict | None:
    """The name and email of a Google sign-in, from the Firebase ID token, or None for any other kind of sign-in."""
    token = token or {}
    firebase = token.get("firebase") or {}
    email = str(token.get("email") or "").strip().lower()
    if firebase.get("sign_in_provider") != "google.com" or not email or not token.get("email_verified"):
        return None
    return {"email": email, "name": str(token.get("name") or "").strip()[:120]}


def class_taker_id(test_id: str, uid: str) -> str:
    """One result per student and class link, so a second tab or device opens the same attempt."""
    return f"class_{test_id}_{uid}"


def new_test_token() -> str:
    return secrets.token_urlsafe(12)


def new_test_code() -> str:
    """Six characters that are easy to read out or type, with no look-alikes."""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def code_matches(given: object, code: str) -> bool:
    g = re.sub(r"[\s-]", "", str(given or "")).upper()
    return bool(code) and secrets.compare_digest(g.encode(), code.encode())


# Grading, the same rules as web/src/lib/grading.ts. Test answers are graded here so students never see the key.
# A number as a student types it: 5, -3, 1/2, 2.5, 6√3, √2/2, 4π, 2π/3.
_NUMBER = re.compile(r"(-?)(\d+(?:\.\d+)?)?(?:\s*√\s*\(?(\d+(?:\.\d+)?)\)?)?(?:\s*(π))?(?:\s*/\s*(-?\d+(?:\.\d+)?))?")


def parse_numbers(text: str) -> list[float]:
    s = re.sub("[−–]", "-", text).replace("*", "")
    s = re.sub(r"sqrt\s*", "√", s, flags=re.I)
    s = re.sub(r"pi", "π", s, flags=re.I)
    out: list[float] = []
    for m in _NUMBER.finditer(s):
        sign, coef, root, pi, den = m.groups()
        if not (coef or root or pi):
            continue
        value = (float(coef) if coef else 1) * (math.sqrt(float(root)) if root else 1) * (math.pi if pi else 1)
        if den is not None:
            if not float(den):
                continue
            value /= float(den)
        out.append(-value if sign else value)
    return out


def same_answer_text(answer: str) -> str:
    """An answer as typed, for matching the owner's "also accept" answers: case, spaces and a final period don't matter."""
    return re.sub(r"\.+$", "", re.sub(r"\s+", "", re.sub("[−–]", "-", answer.lower())))


def is_correct(q: dict, answer: object) -> bool:
    if not isinstance(answer, str) or not answer:
        return False
    if q.get("type") == "choice":
        return answer == q.get("answerChoice")
    typed = same_answer_text(answer)
    if typed and any(isinstance(a, str) and same_answer_text(a) == typed for a in q.get("acceptedAnswers") or []):
        return True
    tol = max(float(q.get("tolerance") or 0), 1e-6)
    expected = q.get("answerValues") or []
    if q.get("pair"):
        # A point: both coordinates, in order.
        got_pair = parse_numbers(answer)
        return len(got_pair) == len(expected) == 2 and all(abs(g - a) <= tol for g, a in zip(got_pair, expected))
    got = {round(n * 1e6) / 1e6 for n in parse_numbers(answer)}
    if len(got) != len(expected):
        return False
    return all(any(abs(g - a) <= tol for g in got) for a in expected)


def clean_answers(answers: object, count: int) -> dict[str, str]:
    """Answers keyed by question index ("0", "1", ...), trimmed to sane sizes."""
    if not isinstance(answers, dict):
        return {}
    out = {}
    for k, v in answers.items():
        try:
            i = int(k)
        except (TypeError, ValueError):
            continue
        if 0 <= i < count and isinstance(v, str) and v.strip():
            out[str(i)] = v[:200]
    return out


def clean_times(times: object, count: int, used_sec: float) -> list[float]:
    """Seconds the student spent on each question, as their browser measured it. The browser can't be trusted,
    so values are clamped and scaled down to fit the time the server saw them take."""
    raw = times if isinstance(times, list) else []
    out = []
    for i in range(count):
        v = raw[i] if i < len(raw) else 0
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 0.0
        out.append(v if v > 0 and v == v and v != float("inf") else 0.0)
    total = sum(out)
    room = max(0.0, float(used_sec))
    if total > room and total > 0:
        out = [v * room / total for v in out]
    return [round(v, 1) for v in out]


def clean_counts(counts: object, count: int, cap: int = 999) -> list[int]:
    """Small per-question counters from the browser, such as how often an answer was changed."""
    raw = counts if isinstance(counts, list) else []
    out = []
    for i in range(count):
        try:
            v = int(raw[i]) if i < len(raw) else 0
        except (TypeError, ValueError, OverflowError):
            v = 0
        out.append(max(0, min(cap, v)))
    return out


def grade(questions: list[dict], answers: dict[str, str]) -> dict:
    results = {str(i): is_correct(q, answers.get(str(i))) for i, q in enumerate(questions)}
    score = sum(results.values())
    return {"results": results, "score": score, "total": len(questions)}


def overall(takers: list[dict], question_count: int) -> dict:
    """The owner's summary across everyone who finished: average score and how often each question was right."""
    done = [t for t in takers if t.get("status") == "completed"]
    right = [0] * question_count
    for t in done:
        for k, ok in (t.get("results") or {}).items():
            if ok and k.isdigit() and int(k) < question_count:
                right[int(k)] += 1
    n = len(done)
    return {
        "assigned": len(takers),
        "started": sum(1 for t in takers if t.get("status") in ("started", "completed")),
        "completed": n,
        "averageScore": (sum(int(t.get("score", 0)) for t in done) / n) if n else None,
        "averageSec": (sum(int(t.get("usedSec", 0)) for t in done) / n) if n else None,
        "questionCorrect": right,
    }

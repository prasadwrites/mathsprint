"""Contact groups and the tests their owners assign to them (Pro and Pro Max only).

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes.
"""

from __future__ import annotations

import re
import secrets

from accounts import AccessDenied, plan_for

GROUP_PLANS = {"pro", "promax"}
MAX_GROUPS = 50
MAX_MEMBERS = 300
MAX_GROUP_NAME = 80
MAX_LOCKOUT_TRIES = 10  # wrong access codes before a test link stops accepting tries
LATE_GRACE_MS = 120_000  # answers sent this long after the time ran out are marked late
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def can_use_groups(account: dict, admin: bool) -> bool:
    return admin or account.get("plan") in GROUP_PLANS


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


def new_test_token() -> str:
    return secrets.token_urlsafe(12)


def new_test_code() -> str:
    """Six characters that are easy to read out or type, with no look-alikes."""
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def code_matches(given: object, code: str) -> bool:
    g = re.sub(r"[\s-]", "", str(given or "")).upper()
    return bool(code) and secrets.compare_digest(g.encode(), code.encode())


# Grading, the same rules as web/src/lib/grading.ts. Test answers are graded here so students never see the key.
_NUMBER = re.compile(r"-?\d+(?:\.\d+)?(?:\s*/\s*-?\d+(?:\.\d+)?)?")


def parse_numbers(text: str) -> list[float]:
    s = re.sub("[−–]", "-", text)
    out: list[float] = []
    for m in _NUMBER.findall(s):
        if "/" in m:
            a, b = (float(x) for x in m.split("/"))
            if b:
                out.append(a / b)
        else:
            out.append(float(m))
    return out


def is_correct(q: dict, answer: object) -> bool:
    if not isinstance(answer, str) or not answer:
        return False
    if q.get("type") == "choice":
        return answer == q.get("answerChoice")
    tol = max(float(q.get("tolerance") or 0), 1e-6)
    got = {round(n * 1e6) / 1e6 for n in parse_numbers(answer)}
    expected = q.get("answerValues") or []
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

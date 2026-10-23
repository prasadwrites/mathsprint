"""Subjects: every deck belongs to one, Math by default. The admin adds and removes the others (Physics, Biology,
General Knowledge and so on).

Math decks are written and checked as before, with SymPy solving every question again. Other subjects can't be
solved by SymPy, so their questions are mostly multiple choice and Claude checks them instead (generator.py): a second
call answers each question without seeing the key, and a question whose key it disagrees with is rewritten.

Plain Python so it can be tested without Firebase; main.py does the Firestore reads and writes. The list lives in
settings/subjects, which signed-in users read and only the admin writes (firestore.rules).
"""

from __future__ import annotations

DEFAULT = "Math"
STARTERS = ["Math", "Physics", "Chemistry", "Biology", "General Knowledge"]
MAX_SUBJECTS = 40
MAX_NAME = 40
_MATH = {"math", "maths", "mathematics"}


def clean(name: object) -> str:
    """A subject name as stored: single spaces, at most 40 characters. Blank stays blank."""
    return " ".join(str(name or "").split())[:MAX_NAME]


def of(doc: dict | None) -> str:
    """The subject of a deck, test, challenge or post. Anything made before subjects existed is Math."""
    return clean((doc or {}).get("subject")) or DEFAULT


def is_math(subject: str) -> bool:
    return clean(subject).lower() in _MATH


def listed(names: object) -> list[str]:
    """The admin's list, cleaned: no blanks or repeats (ignoring case), Math always first."""
    out, seen = [DEFAULT], {DEFAULT.lower()}
    for n in names if isinstance(names, list) else []:
        n = clean(n)
        if n and n.lower() not in seen and not is_math(n):
            out.append(n)
            seen.add(n.lower())
    return out[:MAX_SUBJECTS]


def pick(given: object, names: list[str]) -> str:
    """The subject a new deck gets: one from the list, matched ignoring case, or Math."""
    want = clean(given).lower()
    return next((n for n in names if n.lower() == want), DEFAULT)


def noun(subject: str) -> str:
    """The subject inside a sentence: "math" for Math, other names as the admin wrote them ("Physics fans")."""
    return "math" if is_math(subject) else clean(subject) or "math"


def verb(subject: str) -> str:
    """"solve" for a math question, "answer" for any other."""
    return "solve" if is_math(subject) else "answer"

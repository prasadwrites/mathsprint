"""Multiple choice only tests: typed-answer questions become four-option questions, so nobody has to type an answer.

The correct option is the question's own answer, whose values SymPy already checked when the deck was made or
edited. Wrong options are common slips (a flipped sign, off by one, doubled or halved, a dropped √ or π), written in
the same notation as the correct one so it doesn't stand out. Every option is read back with the grader's own number
reader (groups.parse_numbers): the correct one must match the answer and each wrong one must not. A question that
can't get three such wrong options is left out of the test rather than given a weak or doubtful one.
"""

from __future__ import annotations

import hashlib
import math
import random
import re
from fractions import Fraction

import groups

OPTIONS = 4
MINUS = "−"
_ROOTS = [n for n in range(2, 201) if all(n % (p * p) for p in range(2, int(n ** 0.5) + 1))]  # square-free


# An exact form the app can write: coef, coef·√root or coef·π.
class _Exact:
    def __init__(self, coef: Fraction, root: int = 1, pi: bool = False):
        self.coef, self.root, self.pi = coef, root, pi

    def value(self) -> float:
        return float(self.coef) * math.sqrt(self.root) * (math.pi if self.pi else 1)

    def text(self) -> str:
        c = abs(self.coef)
        unit = f"√{self.root}" if self.root > 1 else "π" if self.pi else ""
        top = c.numerator
        head = (str(top) if top != 1 or not unit else "") + unit
        out = head if c.denominator == 1 else f"{head}/{c.denominator}"
        return (MINUS if self.coef < 0 else "") + out

    def with_coef(self, coef: Fraction) -> "_Exact":
        return _Exact(coef, self.root, self.pi)


def _close(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(a - b) <= eps * max(1.0, abs(a), abs(b))


def exact_form(v: float) -> _Exact | None:
    """5, -7/3, 6√3, √2/2, 4π or 2π/3 when v is (to rounding) one of those with a small denominator."""
    f = Fraction(v).limit_denominator(24)
    if _close(float(f), v):
        return _Exact(f)
    f = Fraction(v / math.pi).limit_denominator(24)
    if f and _close(float(f) * math.pi, v):
        return _Exact(f, pi=True)
    for n in _ROOTS:
        f = Fraction(v / math.sqrt(n)).limit_denominator(24)
        if f and abs(f.numerator) <= 200 and _close(float(f) * math.sqrt(n), v):
            return _Exact(f, n)
    return None


def _decimals(tolerance: float, v: float) -> int | None:
    """How many decimal places to show a value that has no exact form; None when it can't be shown faithfully."""
    if tolerance > 0:
        return max(0, min(6, math.ceil(-math.log10(tolerance) - 1e-9)))
    for d in range(0, 5):
        if _close(round(v, d), v):
            return d
    return None


def _num(v: float, d: int, tolerance: float = 0) -> str:
    s = f"{abs(v):.{d}f}"
    if not tolerance and "." in s:
        s = s.rstrip("0").rstrip(".")  # an exact 0.5 isn't written 0.50
    return (MINUS if v < 0 and float(s) != 0 else "") + s


def _exact(v: float, decimal: bool) -> _Exact | None:
    """The exact form to write v in, unless the answer is written as a decimal and v has a short one."""
    if decimal and _decimals(0, v) is not None:
        return None
    return exact_form(v)


# Plausible wrong values for one correct value, as (text, value) pairs.
def _single_wrongs(v: float, tolerance: float, decimal: bool) -> list[tuple[str, float]] | None:
    e = _exact(v, decimal)
    if e is not None:
        c = e.coef
        coefs = [-c, c + 1, c - 1, c * 2, c / 2, c + 2, c - 2, c * 3, -(c + 1), c + Fraction(1, 2)]
        if c.denominator == 1:
            coefs = [k for k in coefs if k.denominator == 1]  # whole answers get whole wrong options
        forms = [e.with_coef(k) for k in coefs if k != c]
        if e.root > 1:
            forms += [_Exact(c), _Exact(c * e.root), _Exact(c, e.root + 1 if (e.root + 1) in _ROOTS else e.root + 2)]
        if e.pi:
            forms += [_Exact(c), _Exact(c * 2, pi=True), _Exact(c, 2)]
        return [(f.text(), f.value()) for f in forms if f.coef != 0 or e.coef == 0]
    d = _decimals(tolerance, v)
    if d is None:
        return None
    step = 10 ** -d
    raw = [-v, v + step, v - step, v * 2, v / 2, v * 10, v / 10, v + 10 * step, v - 10 * step, v + 1, v - 1]
    # A decimal one rounding step away is a fair wrong answer only when the answer itself is small.
    raw = [w for w in raw if abs(w - v) >= 0.01 * abs(v)]
    return [(_num(round(w, d), d, tolerance), round(w, d)) for w in raw]


def _text_for(values: list[float], tolerance: float, decimal: bool) -> str | None:
    forms = [_exact(v, decimal) for v in values]
    if all(forms):
        return ", ".join(f.text() for f in forms)
    ds = [_decimals(tolerance, v) for v in values]
    if any(d is None for d in ds):
        return None
    return ", ".join(_num(v, max(ds), tolerance) for v in values)


def _set_wrongs(values: list[float], tolerance: float, decimal: bool) -> list[tuple[str, list[float]]]:
    """Wrong answers for a question with several values, such as both roots of a quadratic."""
    out: list[list[float]] = [[-v for v in values]]
    for i, v in enumerate(values):
        out.append(values[:i] + [-v] + values[i + 1:])
        out.append(values[:i] + values[i + 1:])
        out.append(values[:i] + [v + 1] + values[i + 1:])
        out.append(values[:i] + [v - 1] + values[i + 1:])
    out.append([v * 2 for v in values])
    texts = []
    for vs in out:
        vs = sorted(vs)
        if vs and (t := _text_for(vs, tolerance, decimal)):
            texts.append((t, vs))
    return texts


def _pair_wrongs(x: float, y: float, tolerance: float, decimal: bool) -> list[tuple[str, list[float]]]:
    cands = [(y, x), (-x, y), (x, -y), (-x, -y), (x + 1, y), (x, y + 1), (x - 1, y), (x, y - 1), (y, -x)]
    out = []
    for a, b in cands:
        ta, tb = _text_for([a], tolerance, decimal), _text_for([b], tolerance, decimal)
        if ta and tb:
            out.append((f"({ta}, {tb})", [a, b]))
    return out


def _reads_as(q: dict, text: str, slack: float = 1) -> bool:
    """Would the grader count this option as the right answer if it were typed? With slack above 1, also catches
    wrong options so near the answer that they'd be unfair."""
    tol = max(float(q.get("tolerance") or 0), 1e-6) * slack
    return groups.is_correct({**q, "type": "numeric", "tolerance": tol}, text.replace(MINUS, "-"))


def to_choice(q: dict) -> dict | None:
    """A copy of a typed-answer question as a four-option question, or None if it can't be done reliably.
    Questions that are already multiple choice come back unchanged."""
    if q.get("type") == "choice":
        return q
    values = [float(v) for v in (q.get("answerValues") or [])]
    if not values or any(not math.isfinite(v) for v in values):
        return None
    tol = max(float(q.get("tolerance") or 0), 0.0)
    pair = bool(q.get("pair"))
    # Approximate answers, and answers the deck writes as decimals, stay decimals; the rest are written exactly.
    shown = str(q.get("answerDisplay") or "")
    decimal = tol > 0 or (re.search(r"\d\.\d", shown) is not None and not re.search(r"[/√π]|sqrt|pi", shown))
    if pair:
        if len(values) != 2:
            return None
        ta, tb = _text_for([values[0]], tol, decimal), _text_for([values[1]], tol, decimal)
        correct = f"({ta}, {tb})" if ta and tb else None
        wrongs = [t for t, _ in _pair_wrongs(values[0], values[1], tol, decimal)]
    elif len(values) == 1:
        correct = _text_for(values, tol, decimal)
        wrongs = [t for t, _ in (_single_wrongs(values[0], tol, decimal) or [])]
    else:
        values = sorted(values)
        correct = _text_for(values, tol, decimal)
        wrongs = [t for t, _ in _set_wrongs(values, tol, decimal)]
    if not correct or not _reads_as(q, correct):
        return None

    # The same question always gets the same options, in an order that doesn't give the answer away.
    seed = hashlib.sha256(f"{q.get('prompt', '')}|{q.get('math', '')}|{values}".encode()).hexdigest()
    rng = random.Random(seed)
    rng.shuffle(wrongs)
    picked: list[str] = []
    for w in wrongs:
        if w != correct and w not in picked and not _reads_as(q, w, slack=3) and groups.parse_numbers(w.replace(MINUS, "-")):
            picked.append(w)
        if len(picked) == OPTIONS - 1:
            break
    if len(picked) < OPTIONS - 1:
        return None
    options = picked + [correct]
    rng.shuffle(options)
    return {
        **q,
        "type": "choice",
        "choices": options,
        "answerChoice": correct,
        "answerValues": values,
        "pair": False,
        "madeChoice": True,  # was typed-answer in the deck
    }


def all_choice(questions: list[dict]) -> tuple[list[dict], int]:
    """Every question as multiple choice, leaving out the ones that can't be. Returns them and how many were left out."""
    out = [c for q in questions if (c := to_choice(q)) is not None]
    return out, len(questions) - len(out)

"""Deterministic answer checking with SymPy.

Claude writes each question together with a `check` (the same problem in SymPy
syntax). We solve or evaluate that check ourselves and compare the result with
the answer Claude gave. Anything that disagrees is sent back for regeneration.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

from schema import GeneratedQuestion

# parse_expr evaluates Python, so only a tiny, known vocabulary is let through.
_ALLOWED_CHARS = re.compile(r"^[0-9a-zA-Z+\-*/^()., =]*$")
_ALLOWED_NAMES = {
    "sqrt": sp.sqrt, "pi": sp.pi, "E": sp.E, "exp": sp.exp, "log": sp.log, "ln": sp.log,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "abs": sp.Abs, "Abs": sp.Abs,
}
_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)


class UnsafeExpression(ValueError):
    pass


@dataclass
class CheckResult:
    ok: bool
    reason: str = ""
    computed: list[float] | None = None


def _parse(text: str, variable: str) -> sp.Expr:
    text = text.replace("−", "-").replace("·", "*").replace("×", "*")
    if not _ALLOWED_CHARS.match(text) or "__" in text:
        raise UnsafeExpression(f"expression has characters outside the allowed set: {text!r}")
    for name in re.findall(r"[A-Za-z]+", text):
        if name not in _ALLOWED_NAMES and name != variable:
            raise UnsafeExpression(f"unknown name {name!r} in {text!r}")
    local = dict(_ALLOWED_NAMES)
    if variable:
        local[variable] = sp.Symbol(variable, real=True)
    return parse_expr(text, local_dict=local, global_dict={"Integer": sp.Integer, "Float": sp.Float, "Rational": sp.Rational, "Symbol": sp.Symbol}, transformations=_TRANSFORMS)


def _solutions(question: GeneratedQuestion) -> list[float]:
    c = question.check
    if c.kind == "evaluate":
        value = _parse(c.expression, "")
        return [float(sp.N(value))]

    if not re.fullmatch(r"[a-zA-Z]", c.variable or ""):
        raise UnsafeExpression("solve checks need a single-letter variable")
    if c.expression.count("=") != 1:
        raise ValueError("solve checks need exactly one '='")
    lhs, rhs = c.expression.split("=")
    x = sp.Symbol(c.variable, real=True)
    eq = sp.Eq(_parse(lhs, c.variable), _parse(rhs, c.variable))
    sols = sp.solveset(eq, x, domain=sp.S.Reals)
    if not isinstance(sols, sp.FiniteSet):
        raise ValueError("check does not have a finite set of real solutions")
    values = [float(sp.N(s)) for s in sols]
    if c.domain == "positive":
        values = [v for v in values if v > 0]
    elif c.domain == "nonnegative":
        values = [v for v in values if v >= 0]
    elif c.domain == "integer":
        values = [v for v in values if abs(v - round(v)) < 1e-9]
    return sorted(values)


def _same_set(a: list[float], b: list[float], tol: float) -> bool:
    a = sorted(set(round(v, 9) for v in a))
    b = sorted(set(round(v, 9) for v in b))
    return len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def parse_number(text: str) -> float | None:
    """Reads a choice label such as '−16', '3/2' or '2√3' as a number."""
    t = text.replace("−", "-").replace("√", "sqrt").strip()
    t = re.sub(r"sqrt\s*(\d+(?:\.\d+)?)", r"sqrt(\1)", t)
    try:
        return float(sp.N(_parse(t, "")))
    except Exception:
        return None


def check_question(q: GeneratedQuestion) -> CheckResult:
    if not q.steps:
        return CheckResult(False, "missing solution steps")
    tol = max(q.tolerance, 1e-6)

    if q.type == "choice":
        if len(q.choices) < 2 or len(set(q.choices)) != len(q.choices):
            return CheckResult(False, "choice questions need 2+ distinct options")
        if q.answer_choice not in q.choices:
            return CheckResult(False, "answer_choice is not one of the choices")
        picked = parse_number(q.answer_choice)
        if picked is None:
            return CheckResult(False, "the correct choice is not a number SymPy can read")
        expected = [picked]
    else:
        if q.choices:
            return CheckResult(False, "numeric questions must not have choices")
        if not q.answer_values:
            return CheckResult(False, "numeric question has no answer values")
        expected = q.answer_values

    try:
        computed = _solutions(q)
    except UnsafeExpression as e:
        return CheckResult(False, f"check rejected: {e}")
    except Exception as e:  # SymPy parse or solve failure
        return CheckResult(False, f"SymPy could not process the check: {e}")

    if not computed:
        return CheckResult(False, "the check has no solutions in the stated domain", computed)
    if not _same_set(expected, computed, tol):
        return CheckResult(False, f"answer {expected} does not match SymPy's {computed}", computed)
    if q.type == "choice":
        # Exactly one option may be correct.
        hits = [c for c in q.choices if (n := parse_number(c)) is not None and abs(n - computed[0]) <= tol]
        if len(computed) != 1 or len(hits) != 1:
            return CheckResult(False, "multiple-choice question must have exactly one correct option", computed)
    return CheckResult(True, computed=computed)

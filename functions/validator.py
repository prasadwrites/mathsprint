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

from schema import Figure, GeneratedQuestion

# parse_expr evaluates Python, so only a tiny, known vocabulary is let through.
_ALLOWED_CHARS = re.compile(r"^[0-9a-zA-Z+\-*/^()., =]*$")
_ALLOWED_NAMES = {
    "sqrt": sp.sqrt, "pi": sp.pi, "E": sp.E, "exp": sp.exp, "log": sp.log, "ln": sp.log,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "abs": sp.Abs, "Abs": sp.Abs, "diff": sp.diff,
}
X = sp.Symbol("x", real=True)
FIGURE_MAX_ITEMS = 8
# Grid lines per axis: fewer than 2 says nothing, more than 40 is unreadable on a phone.
GRID_LINES = (2, 40)
# Two labels closer than this share of the view's width or height would overlap.
LABEL_GAP = 0.04
_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)


class UnsafeExpression(ValueError):
    pass


@dataclass
class CheckResult:
    ok: bool
    reason: str = ""
    computed: list[float] | None = None


def _parse(text: str, variable: str, functions: dict[str, sp.Lambda] | None = None) -> sp.Expr:
    """`functions` are the graphs drawn in the question's figure, so a check can say f(3) or f(x) = g(x)."""
    functions = functions or {}
    text = text.replace("−", "-").replace("·", "*").replace("×", "*")
    if not _ALLOWED_CHARS.match(text) or "__" in text:
        raise UnsafeExpression(f"expression has characters outside the allowed set: {text!r}")
    for name in re.findall(r"[A-Za-z]+", text):
        if name not in _ALLOWED_NAMES and name != variable and name not in functions:
            raise UnsafeExpression(f"unknown name {name!r} in {text!r}")
    local = {**_ALLOWED_NAMES, **functions}
    if variable:
        local[variable] = sp.Symbol(variable, real=True)
    return parse_expr(text, local_dict=local, global_dict={"Integer": sp.Integer, "Float": sp.Float, "Rational": sp.Rational, "Symbol": sp.Symbol}, transformations=_TRANSFORMS)


def figure_functions(figure: Figure | None) -> dict[str, sp.Lambda]:
    """The figure's graphs that have a one-letter name, as functions of x a check can call."""
    out: dict[str, sp.Lambda] = {}
    for item in figure.items if figure else []:
        if item.type in ("function", "region") and re.fullmatch(r"[a-z]", item.label) and item.label not in "exy":
            out[item.label] = sp.Lambda(X, _parse(item.expr, "x"))
    return out


def _solutions(question: GeneratedQuestion) -> list[float]:
    c = question.check
    functions = figure_functions(question.figure)
    if c.kind == "evaluate":
        value = _parse(c.expression, "", functions)
        return [float(sp.N(value))]

    if not re.fullmatch(r"[a-zA-Z]", c.variable or ""):
        raise UnsafeExpression("solve checks need a single-letter variable")
    if c.expression.count("=") != 1:
        raise ValueError("solve checks need exactly one '='")
    lhs, rhs = c.expression.split("=")
    x = sp.Symbol(c.variable, real=True)
    eq = sp.Eq(_parse(lhs, c.variable, functions), _parse(rhs, c.variable, functions))
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


def _on_grid(v: float, grid: float) -> bool:
    half = grid / 2
    return abs(v / half - round(v / half)) < 1e-6


def _coordinates(label: str) -> tuple[float, float] | None:
    m = re.fullmatch(r"\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)\s*", label)
    if not m:
        return None
    a, b = parse_number(m.group(1)), parse_number(m.group(2))
    return None if a is None or b is None else (a, b)


def check_figure(fig: Figure) -> str:
    """Why the figure is wrong or unreadable, or '' if it is fine."""
    if not (fig.x_min < fig.x_max and fig.y_min < fig.y_max):
        return "figure ranges are empty: x_min must be below x_max and y_min below y_max"
    w, h = fig.x_max - fig.x_min, fig.y_max - fig.y_min
    for axis, span, step in (("x", w, fig.x_grid), ("y", h, fig.y_grid)):
        if step <= 0 or not GRID_LINES[0] <= span / step <= GRID_LINES[1]:
            return f"{axis}_grid {step:g} gives too few or too many grid lines for the {axis} range; aim for 6 to 20"
    if not fig.alt.strip():
        return "figure needs alt text"
    if not 1 <= len(fig.items) <= FIGURE_MAX_ITEMS:
        return f"figure needs 1 to {FIGURE_MAX_ITEMS} items"

    names = [i.label for i in fig.items if i.type in ("function", "region") and i.label]
    if len(names) != len(set(names)):
        return "two graphs in the figure share a name"
    labeled: list[tuple[float, float]] = []
    for item in fig.items:
        need = {"point": 1, "line": 2, "segment": 2}.get(item.type, 0)
        if len(item.points) != need:
            return f"a '{item.type}' needs exactly {need} points"
        if item.type in ("function", "region"):
            if (item.type == "region") != bool(item.side):
                return "only a 'region' has a side, and it needs one ('above' or 'below')"
            try:
                f = sp.lambdify(X, _parse(item.expr, "x"), modules="math")
            except Exception as e:
                return f"figure expression {item.expr!r} could not be read: {e}"
            visible = 0
            for k in range(41):
                try:
                    y = float(f(fig.x_min + w * k / 40))
                except Exception:
                    continue
                visible += fig.y_min <= y <= fig.y_max
            if visible < 8:
                return f"the graph of y = {item.expr} is mostly outside the figure's ranges"
        if item.type == "line" and (item.points[0].x, item.points[0].y) == (item.points[1].x, item.points[1].y):
            return "a 'line' needs two different points"
        for p in item.points:
            if not (fig.x_min <= p.x <= fig.x_max and fig.y_min <= p.y <= fig.y_max):
                return f"point ({p.x:g}, {p.y:g}) is outside the figure's ranges"
            if not (_on_grid(p.x, fig.x_grid) and _on_grid(p.y, fig.y_grid)):
                return f"point ({p.x:g}, {p.y:g}) is not on the grid, so a student cannot read it; move it or give it in the prompt"
        if item.type == "point":
            p = item.points[0]
            at = _coordinates(item.label)
            if at and (abs(at[0] - p.x) > 1e-6 or abs(at[1] - p.y) > 1e-6):
                return f"point labeled {item.label} is drawn at ({p.x:g}, {p.y:g})"
            if item.label:
                for qx, qy in labeled:
                    if abs(p.x - qx) / w < LABEL_GAP and abs(p.y - qy) / h < LABEL_GAP:
                        return "two labeled points are too close together to read"
                labeled.append((p.x, p.y))
    return ""


def check_question(q: GeneratedQuestion) -> CheckResult:
    if not q.steps:
        return CheckResult(False, "missing solution steps")
    if q.figure:
        problem = check_figure(q.figure)
        if problem:
            return CheckResult(False, problem)
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

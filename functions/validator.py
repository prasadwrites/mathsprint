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

from schema import Diagram, Figure, GeneratedQuestion

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
DIAGRAM_MAX_POINTS = 12
DIAGRAM_MAX_ITEMS = 16
# How many points each kind of diagram mark uses (polygons take 3 or more).
DIAGRAM_ARITY = {"segment": 2, "circle": 2, "right_angle": 3, "angle_mark": 3, "angle_label": 3, "length_label": 2, "ticks": 2}
# Labels may be rounded a little: lengths to 0.5%, angles to a tenth of a degree.
LENGTH_TOL = 0.005
ANGLE_TOL = 0.1
# An angle narrower than this can't be marked or labeled legibly.
MIN_MARKED_ANGLE = 10
_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)


class UnsafeExpression(ValueError):
    pass


@dataclass
class CheckResult:
    ok: bool
    reason: str = ""
    computed: list[float] | None = None


def _parse(text: str, variable: str, functions: dict[str, object] | None = None) -> sp.Expr:
    """`functions` are names the question's picture adds: the graphs in a figure, so a check can say f(3) or
    f(x) = g(x), or the points of a diagram and the measurements on them, so it can say dist(A, B)."""
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


def _dist(a: sp.Point2D, b: sp.Point2D) -> sp.Expr:
    return a.distance(b)


def _angle(a: sp.Point2D, b: sp.Point2D, c: sp.Point2D) -> sp.Expr:
    """The angle ABC at B, in degrees."""
    u, v = a - b, c - b
    return sp.acos(u.dot(v) / (sp.sqrt(u.dot(u)) * sp.sqrt(v.dot(v)))) * 180 / sp.pi


def _area(*pts: sp.Point2D) -> sp.Expr:
    """Area of the polygon with these vertices in order (shoelace formula)."""
    n = len(pts)
    return sp.Abs(sum(pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y for i in range(n))) / 2


def _perimeter(*pts: sp.Point2D) -> sp.Expr:
    return sum(_dist(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts)))


MEASUREMENTS = {"dist": _dist, "angle": _angle, "area": _area, "perimeter": _perimeter, "px": lambda p: p.x, "py": lambda p: p.y}


def diagram_points(diagram: Diagram) -> dict[str, sp.Point2D]:
    return {p.name: sp.Point2D(_parse(p.x, ""), _parse(p.y, ""), evaluate=False) for p in diagram.points}


def picture_names(q: GeneratedQuestion) -> dict[str, object]:
    """Everything a check may refer to besides plain math: graph names, or diagram points and measurements."""
    if q.diagram:
        return {**MEASUREMENTS, **diagram_points(q.diagram)}
    return figure_functions(q.figure)


def _solutions(question: GeneratedQuestion) -> list[float]:
    c = question.check
    functions = picture_names(question)
    if c.kind == "point":
        value = _parse(c.expression, "", functions)
        if not isinstance(value, tuple | sp.Tuple) or len(value) != 2:
            raise ValueError("point checks need two expressions, 'x, y'")
        return [float(sp.N(v)) for v in value]
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
    t = text.replace("−", "-").replace("√", "sqrt").replace("π", "pi").strip()
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


def _simple(pts: list[tuple[float, float]]) -> bool:
    """True if no two non-neighboring edges of the polygon cross."""
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    n = len(pts)
    edges = [(pts[i], pts[(i + 1) % n]) for i in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            (p1, p2), (p3, p4) = edges[i], edges[j]
            d1, d2, d3, d4 = cross(p3, p4, p1), cross(p3, p4, p2), cross(p1, p2, p3), cross(p1, p2, p4)
            if d1 * d2 < 0 and d3 * d4 < 0:
                return False
    return True


def check_diagram(d: Diagram) -> str:
    """Why the diagram is wrong or unreadable, or '' if it is fine."""
    if not d.alt.strip():
        return "diagram needs alt text"
    names = [p.name for p in d.points]
    if not 2 <= len(names) <= DIAGRAM_MAX_POINTS:
        return f"a diagram needs 2 to {DIAGRAM_MAX_POINTS} points"
    if len(set(names)) != len(names) or not all(re.fullmatch(r"[A-Z]", n) for n in names):
        return "diagram points need different one-capital-letter names"
    if not 1 <= len(d.items) <= DIAGRAM_MAX_ITEMS:
        return f"a diagram needs 1 to {DIAGRAM_MAX_ITEMS} items"
    try:
        exact = diagram_points(d)
        at = {n: (float(sp.N(p.x)), float(sp.N(p.y))) for n, p in exact.items()}
    except Exception as e:
        return f"diagram coordinates could not be read: {e}"

    xs, ys = [x for x, _ in at.values()], [y for _, y in at.values()]
    for item in d.items:
        if item.type == "circle" and all(n in at for n in item.of):
            (cx, cy), (px, py) = at[item.of[0]], at[item.of[1]]
            rad = ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5
            xs += [cx - rad, cx + rad]
            ys += [cy - rad, cy + rad]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    if span <= 0 or min(max(xs) - min(xs), max(ys) - min(ys)) < 0.15 * span:
        return "the diagram is too long and thin to read; choose less extreme proportions"
    shown = [n for n in names if next(p for p in d.points if p.name == n).show]
    for i, a in enumerate(shown):
        for b in shown[i + 1:]:
            if ((at[a][0] - at[b][0]) ** 2 + (at[a][1] - at[b][1]) ** 2) ** 0.5 < LABEL_GAP * span:
                return f"points {a} and {b} are too close together to label"

    ticks: dict[int, list[float]] = {}
    for item in d.items:
        need = DIAGRAM_ARITY.get(item.type)
        if (need and len(item.of) != need) or (item.type == "polygon" and len(item.of) < 3):
            return f"a '{item.type}' needs {need or '3 or more'} points"
        missing = [n for n in item.of if n not in at]
        if missing:
            return f"'{item.type}' uses unknown point {missing[0]}"
        if len(set(item.of)) != len(item.of):
            return f"a '{item.type}' repeats a point"
        if item.type in ("ticks", "angle_mark") and not 1 <= item.count <= 3:
            return f"'{item.type}' needs a count of 1 to 3"
        pts = [exact[n] for n in item.of]
        if item.type == "polygon":
            flat = [at[n] for n in item.of]
            if float(sp.N(_area(*pts))) < 1e-4 * span**2 or not _simple(flat):
                return "a polygon is flat or crosses itself"
        if item.type in ("right_angle", "angle_mark", "angle_label"):
            deg = float(sp.N(_angle(*pts)))
            if item.type == "right_angle" and abs(deg - 90) > ANGLE_TOL:
                return f"angle {''.join(item.of)} is marked as a right angle but is {deg:.1f}°"
            if deg < MIN_MARKED_ANGLE:
                return f"angle {''.join(item.of)} is too narrow to mark"
            if item.type == "angle_label":
                given = parse_number(item.text.replace("°", ""))
                if given is not None and abs(given - deg) > ANGLE_TOL:
                    return f"angle {''.join(item.of)} is labeled {item.text} but is drawn as {deg:.1f}°"
        if item.type in ("length_label", "ticks"):
            length = float(sp.N(_dist(*pts)))
            if item.type == "ticks":
                ticks.setdefault(item.count, []).append(length)
            else:
                given = parse_number(item.text)
                if given is not None and abs(given - length) > LENGTH_TOL * max(1.0, given):
                    return f"{''.join(item.of)} is labeled {item.text} but is drawn {length:.3g} long"
    for count, lengths in ticks.items():
        if max(lengths) - min(lengths) > LENGTH_TOL * max(lengths):
            return f"segments marked with {count} tick(s) are not equal"
    return ""


def check_question(q: GeneratedQuestion) -> CheckResult:
    if not q.steps:
        return CheckResult(False, "missing solution steps")
    if q.figure and q.diagram:
        return CheckResult(False, "a question has a figure or a diagram, not both")
    if q.diagram:
        problem = check_diagram(q.diagram)
        if problem:
            return CheckResult(False, problem)
    if q.pair and (q.type != "numeric" or q.check.kind != "point" or len(q.answer_values) != 2):
        return CheckResult(False, "a point answer needs type 'numeric', check kind 'point' and answer_values [x, y]")
    if q.check.kind == "point" and not q.pair:
        return CheckResult(False, "a 'point' check is only for questions with pair set to true")
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

    if q.pair:
        # Order matters for a point: (2, 5) is not (5, 2).
        if any(abs(a - b) > tol for a, b in zip(expected, computed)):
            return CheckResult(False, f"point {expected} does not match SymPy's {computed}", computed)
        return CheckResult(True, computed=computed)
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

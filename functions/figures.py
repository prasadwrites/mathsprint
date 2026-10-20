"""Turns a checked figure into what the app stores and draws.

Graphs are sampled here, so the browser only joins points and never evaluates math.
"""

from __future__ import annotations

import math

import sympy as sp

from schema import Diagram, Figure
from validator import X, _parse, diagram_points

SAMPLES = 240


def _paths(expr: str, fig: Figure) -> list[dict]:
    """The graph of y = expr as polylines, broken where it is undefined or jumps (an asymptote)."""
    f = sp.lambdify(X, _parse(expr, "x"), modules="math")
    w, h = fig.x_max - fig.x_min, fig.y_max - fig.y_min
    lo, hi = fig.y_min - h, fig.y_max + h
    paths: list[list[float]] = []
    current: list[float] = []
    prev: float | None = None
    for k in range(SAMPLES + 1):
        x = fig.x_min + w * k / SAMPLES
        try:
            y = float(f(x))
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            y = math.nan
        jump = prev is not None and math.isfinite(y) and abs(y - prev) > 2 * h and not (lo < y < hi and lo < prev < hi)
        if not math.isfinite(y) or jump:
            if len(current) >= 4:
                paths.append(current)
            current = []
        if math.isfinite(y):
            current += [round(x, 4), round(min(hi, max(lo, y)), 4)]
        prev = y if math.isfinite(y) else None
    if len(current) >= 4:
        paths.append(current)
    # Firestore cannot store arrays of arrays, so each polyline is a map holding a flat x, y, x, y list.
    return [{"xy": p} for p in paths]


def figure_doc(fig: Figure | None) -> dict | None:
    if not fig:
        return None
    items = []
    for item in fig.items:
        doc = {
            "type": item.type,
            "label": item.label,
            "dashed": item.dashed,
            "points": [p.model_dump() for p in item.points],
        }
        if item.type in ("function", "region"):
            doc.update(expr=item.expr, paths=_paths(item.expr, fig))
        if item.type == "region":
            doc["side"] = item.side
        items.append(doc)
    return {
        "kind": fig.kind,
        "alt": fig.alt,
        "xMin": fig.x_min,
        "xMax": fig.x_max,
        "yMin": fig.y_min,
        "yMax": fig.y_max,
        "xGrid": fig.x_grid,
        "yGrid": fig.y_grid,
        "items": items,
    }


def diagram_doc(d: Diagram | None) -> dict | None:
    """A geometry diagram with its exact coordinates turned into numbers the app can draw."""
    if not d:
        return None
    exact = diagram_points(d)
    return {
        "kind": "geometry",
        "alt": d.alt,
        "points": [
            {"name": p.name, "x": round(float(sp.N(exact[p.name].x)), 6), "y": round(float(sp.N(exact[p.name].y)), 6), "show": p.show}
            for p in d.points
        ],
        "items": [
            {"type": i.type, "of": i.of, "text": i.text, "count": i.count, "dashed": i.dashed, "shaded": i.shaded}
            for i in d.items
        ],
    }

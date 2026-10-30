"""A deck owner edits one of their questions; the edit is saved only if its answer checks out.

What the owner can change: the question's wording and formula, a choice question's options and correct option, a
numeric question's answer and other ways of writing it that also count as right (acceptedAnswers), the solution steps, the concept and the difficulty. The type, and any graph or diagram,
stay as they are.

How an edited answer is checked, by subject:
- Math, and numeric questions in any subject: Claude restates the edited question in SymPy syntax without seeing the
  owner's answer (generator.write_check), SymPy solves that, and the answer must match, the same check every
  generated question passes. A question with a graph or diagram is checked against the picture as drawn.
- Multiple choice outside math (Biology, History...): no program can solve those, so Claude answers the edited
  question without the key (generator.review_choice), as it does for every generated question, and must pick the
  owner's option.
An edit that changes only the steps, the concept, the difficulty or the also-accepted answers is saved without a new
check: those other answers are the owner's call ("ten", "10 meters"), and the grader matches them as typed.

Plain Python apart from the Claude calls, which take a client so tests can stand in for it; main.py does the
Firestore reads and writes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from groups import same_answer_text
from schema import Check, Diagram, DiagramItem, Figure, FigureItem, GeneratedQuestion, GeoPoint, Point, SolutionStep
from validator import check_question, parse_number

MAX_PROMPT = 1000
MAX_MATH = 300
MAX_CHOICE = 200
MAX_ANSWER = 120
MAX_ACCEPTED = 10
MAX_STEPS = 12
MAX_STEP_TEXT = 400
MAX_CONCEPT = 80
DIFFICULTIES = ("Easy", "Medium", "Hard")
# Fields that change what the question asks or what its answer is. Editing any of them means checking again.
CHECKED_FIELDS = ("prompt", "math", "choices", "answerChoice", "answerValues")
# Coordinates of a stored diagram are rounded to 6 places, so measurements on it are only that exact.
DIAGRAM_TOL = 1e-4


class EditError(ValueError):
    """An edit that can't be saved, with a message for the deck owner."""


def _text(value: object, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _values(text: str, pair: bool) -> list[float]:
    """The numbers in an answer as the owner types it: '2, -3', 'x = 2 or x = 3', '6√3', '(2, 5)'."""
    t = text.replace("−", "-").strip()
    if pair:
        t = t.strip("()[] ")
    parts = [p for p in re.split(r",|\bor\b|\band\b", t) if p.strip()]
    out = []
    for p in parts:
        p = re.sub(r"^\s*[A-Za-z]\s*=", "", p).strip()  # "x = 2"
        n = parse_number(p) if p else None
        if n is None:
            raise EditError("Write the answer as numbers, like 2, -3 or 6√3 or 1/2.")
        out.append(n)
    if pair and len(out) != 2:
        raise EditError("This answer is a point. Write it as (x, y).")
    if not out:
        raise EditError("Give the correct answer.")
    return out


def _accepted(value: object, answer: str) -> list[str]:
    """The owner's also-accepted answers, trimmed, without blanks, repeats or the answer itself."""
    seen = {same_answer_text(answer)}
    out = []
    for a in value if isinstance(value, list) else []:
        a = _text(a, MAX_ANSWER)
        key = same_answer_text(a)
        if key and key not in seen:
            seen.add(key)
            out.append(a)
    if len(out) > MAX_ACCEPTED:
        raise EditError(f"List at most {MAX_ACCEPTED} other accepted answers.")
    return out


def _tolerance(text: str, old: float) -> float:
    """Typed decimals are taken as rounded (3.33 accepts 10/3), and exact roots and π get the usual 0.01."""
    tol = old
    for d in re.findall(r"\.(\d+)", text):
        tol = max(tol, 0.5 * 10 ** -len(d))
    if re.search(r"√|sqrt|π|pi", text):
        tol = max(tol, 0.01)
    return tol


def apply_edit(old: dict, data: dict) -> dict:
    """The question's fields after the edit, cleaned and checked for shape (not yet for correctness)."""
    prompt = _text(data.get("prompt"), MAX_PROMPT)
    if not prompt:
        raise EditError("The question can't be empty.")
    new = {
        "prompt": prompt,
        "math": _text(data.get("math"), MAX_MATH),
        "concept": _text(data.get("concept"), MAX_CONCEPT) or old.get("concept", ""),
        "difficulty": data.get("difficulty") if data.get("difficulty") in DIFFICULTIES else old.get("difficulty", "Medium"),
    }

    steps = []
    for s in data.get("steps") if isinstance(data.get("steps"), list) else []:
        if not isinstance(s, dict):
            continue
        d, e = _text(s.get("description"), MAX_STEP_TEXT), _text(s.get("expression"), MAX_STEP_TEXT)
        if d or e:
            steps.append({"description": d, "expression": e})
    if not steps:
        raise EditError("Keep at least one solution step.")
    new["steps"] = steps[:MAX_STEPS]

    if old.get("type") == "choice":
        choices = [_text(c, MAX_CHOICE) for c in data.get("choices") or []] if isinstance(data.get("choices"), list) else []
        if len(choices) != len(old.get("choices") or []) or not all(choices):
            raise EditError("Fill in every option.")
        if len({c.lower() for c in choices}) != len(choices):
            raise EditError("Two options are the same. Make each one different.")
        answer = _text(data.get("answerChoice"), MAX_CHOICE)
        if answer not in choices:
            raise EditError("Pick the correct option.")
        number = parse_number(answer)
        new.update(
            choices=choices,
            answerChoice=answer,
            answerDisplay=answer,
            # Math choices are numbers; other subjects' options have none.
            answerValues=[number] if number is not None and old.get("answerValues") else [],
            tolerance=old.get("tolerance", 0),
        )
    else:
        answer = _text(data.get("answer"), MAX_ANSWER)
        if not answer:
            raise EditError("Give the correct answer.")
        new.update(
            choices=[],
            answerChoice="",
            answerDisplay=answer,
            answerValues=_values(answer, bool(old.get("pair"))),
            tolerance=_tolerance(answer, float(old.get("tolerance") or 0)),
            acceptedAnswers=_accepted(data.get("acceptedAnswers"), answer),
        )
    return new


def needs_check(old: dict, new: dict) -> bool:
    return any(old.get(k) != new.get(k) for k in CHECKED_FIELDS)


def figure_from_doc(doc: dict | None) -> tuple[Figure | None, Diagram | None]:
    """The stored picture (figures.figure_doc / diagram_doc) back in the shape the validator checks."""
    if not doc:
        return None, None
    if doc.get("kind") == "geometry":
        return None, Diagram(
            alt=doc.get("alt", ""),
            points=[GeoPoint(name=p["name"], x=repr(float(p["x"])), y=repr(float(p["y"])), show=p.get("show", True)) for p in doc.get("points", [])],
            items=[DiagramItem(**{k: i.get(k, d) for k, d in (("type", ""), ("of", []), ("text", ""), ("count", 0), ("dashed", False), ("shaded", False))}) for i in doc.get("items", [])],
        )
    return Figure(
        kind="plane",
        alt=doc.get("alt", ""),
        x_min=doc["xMin"], x_max=doc["xMax"], y_min=doc["yMin"], y_max=doc["yMax"],
        x_grid=doc["xGrid"], y_grid=doc["yGrid"],
        items=[
            FigureItem(
                type=i["type"], expr=i.get("expr", ""), label=i.get("label", ""), side=i.get("side", ""),
                dashed=i.get("dashed", False), points=[Point(**p) for p in i.get("points", [])],
            )
            for i in doc.get("items", [])
        ],
    ), None


def picture_text(doc: dict | None) -> str:
    """What Claude needs to know about the question's picture to restate it: names, graphs and coordinates."""
    if not doc:
        return ""
    if doc.get("kind") == "geometry":
        pts = ", ".join(f"{p['name']}({p['x']:g}, {p['y']:g})" for p in doc.get("points", []))
        marks = "; ".join(f"{i['type']} {''.join(i.get('of', []))}" + (f" labeled {i['text']}" if i.get("text") else "") for i in doc.get("items", []))
        return (
            f"The question shows a geometry diagram ({doc.get('alt', '')}). Points: {pts}. Marks: {marks}. "
            "Use the points in the check: dist(A, B), angle(A, B, C) in degrees at B, area(A, B, C, ...), "
            "perimeter(A, B, C, ...), px(A), py(A)."
        )
    graphs = [f"{i['label']}(x) = {i['expr']}" for i in doc.get("items", []) if i.get("type") in ("function", "region") and re.fullmatch(r"[a-z]", i.get("label", "")) and i["label"] not in "exy"]
    others = [f"{i['type']} {i.get('label', '')} at " + ", ".join(f"({p['x']:g}, {p['y']:g})" for p in i.get("points", [])) for i in doc.get("items", []) if i.get("type") in ("line", "segment", "point")]
    return (
        f"The question shows a graph ({doc.get('alt', '')})."
        + (f" Named graphs, which the check may call: {'; '.join(graphs)}." if graphs else "")
        + (f" Also drawn: {'; '.join(others)}." if others else "")
    )


def as_question(doc: dict, check: Check) -> GeneratedQuestion:
    """A stored question (with any picture) in the validator's shape, with the check to run."""
    figure, diagram = figure_from_doc(doc.get("figure"))
    tol = float(doc.get("tolerance") or 0)
    return GeneratedQuestion(
        prompt=doc["prompt"], math=doc.get("math", ""), type=doc["type"], choices=doc.get("choices", []),
        answer_values=doc.get("answerValues", []), answer_choice=doc.get("answerChoice", ""),
        answer_display=doc.get("answerDisplay", ""), tolerance=max(tol, DIAGRAM_TOL) if diagram else tol,
        concept=doc.get("concept", ""), difficulty=doc.get("difficulty", "Medium"),
        steps=[SolutionStep(**s) for s in doc.get("steps", [])], check=check,
        figure=figure, diagram=diagram, pair=bool(doc.get("pair")),
    )


@dataclass
class Verdict:
    ok: bool
    # For the owner when the edit is rejected.
    message: str = ""
    # The check that verified it, saved with the question.
    check: dict | None = None


def _number(v: float) -> str:
    return f"{round(v, 4):g}"


def verify(doc: dict, subject: str, level: str, client) -> Verdict:
    """Checks an edited question's answer. `doc` is the question as it would be saved."""
    import generator
    import subjects

    math = subjects.is_math(subject)
    if not math and doc["type"] == "choice":
        q = as_question(doc, Check(kind="none", expression="", variable="", domain="real"))
        problem = generator.review_choice(client, q, subject, level)
        if problem:
            return Verdict(False, problem)
        return Verdict(True, check=q.check.model_dump())

    written = generator.write_check(client, doc, picture_text(doc.get("figure")), subject)
    if not written.checkable:
        return Verdict(False, "The math engine couldn't check this question: " + (written.problem or "it has no single clear answer.") + " Reword it and try again.")
    q = as_question(doc, written.check)
    result = check_question(q, math)
    if result.ok:
        return Verdict(True, check=written.check.model_dump())
    if result.computed:
        got = ", ".join(_number(v) for v in result.computed)
        yours = doc["answerChoice"] if doc["type"] == "choice" else doc["answerDisplay"]
        if "exactly one correct option" in result.reason:
            return Verdict(False, f"The math engine worked this out as {got}, and more than one option matches that. Make only one option correct.")
        return Verdict(False, f"The math engine worked this out as {got}, not {yours}. Check the answer, or the question's wording.")
    return Verdict(False, f"The math engine couldn't confirm this answer ({result.reason}). Check the answer, or reword the question.")

"""A deck owner edits one of their questions; the edit is saved only if its answer checks out.

What the owner can change: the question's wording and formula, a choice question's options and correct option, a
numeric question's answer and other ways of writing it that also count as right (acceptedAnswers), the solution steps, the concept and the difficulty. The type stays
as it is.

The picture (the question's `figure`), by the owner's choice:
- keep: the graph, diagram or picture stays, and the edited question is checked against it.
- redraw (math only): Claude draws a new graph or diagram for the edited question (generator.draw_picture), following
  the owner's instructions if any, the validator checks it as it does every generated picture, and the answer is
  then checked against the new picture. Also how a question without a picture gets one.
- upload: the owner's own image, stored with the question as a data URL ({'kind': 'image', ...}) so tests, posts and
  copies made from the deck carry it with them. No program can read an image, so the check reads the owner's
  one-line description of it instead, and the question's words and that description must be enough to work out
  the answer.
- remove: the question becomes text only, and is checked as such.

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

import base64
import binascii
import io
import json
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
CHECKED_FIELDS = ("prompt", "math", "choices", "answerChoice", "answerValues", "figure")
# Coordinates of a stored diagram are rounded to 6 places, so measurements on it are only that exact.
DIAGRAM_TOL = 1e-4
PICTURE_ACTIONS = ("keep", "redraw", "upload", "remove")
MAX_PICTURE_NOTE = 400
MAX_ALT = 300
# The app shrinks a picture before it uploads it, to well under this; a question document must stay under 1 MB.
MAX_IMAGE_BYTES = 400_000
MAX_IMAGE_SIDE = 2400
_DATA_URL = re.compile(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)")
_FORMATS = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}


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


def picture_request(data: dict) -> tuple[str, dict]:
    """What the owner wants done with the picture (one of PICTURE_ACTIONS), and the details they sent with it."""
    picture = data.get("picture") if isinstance(data.get("picture"), dict) else {}
    action = picture.get("action") if picture.get("action") in PICTURE_ACTIONS else "keep"
    return action, picture


def redraw_note(data: dict) -> str | None:
    """The owner's instructions for a new drawing ('' for none), or None when they didn't ask for one."""
    action, picture = picture_request(data)
    return _text(picture.get("note"), MAX_PICTURE_NOTE) if action == "redraw" else None


def uploaded_picture(picture: dict) -> dict:
    """The owner's own image as it's stored with the question, after making sure it is one."""
    alt = _text(picture.get("alt"), MAX_ALT)
    if not alt:
        raise EditError("Describe the picture in a sentence. Students who use a screen reader hear it, and the answer check reads it.")
    m = _DATA_URL.fullmatch("".join(str(picture.get("image") or "").split()))
    if not m:
        raise EditError("Upload a PNG, JPEG or WebP picture.")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise EditError("That picture didn't upload properly. Try again.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise EditError("That picture is too large. Use one under 400 KB.")
    from PIL import Image

    try:
        with Image.open(io.BytesIO(raw)) as img:
            fmt, (width, height) = img.format, img.size
            img.verify()
    except Exception:
        raise EditError("That file isn't a picture the app can show. Try a PNG or JPEG.")
    if fmt != _FORMATS[m.group(1)] or not (0 < width <= MAX_IMAGE_SIDE and 0 < height <= MAX_IMAGE_SIDE):
        raise EditError("That file isn't a picture the app can show. Try a PNG or JPEG.")
    return {"kind": "image", "alt": alt, "src": f"data:image/{m.group(1)};base64,{m.group(2)}", "width": width, "height": height}


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

    # A redrawn picture takes a Claude call, so main.py makes it once the rest of the edit is known to be fine.
    action, picture = picture_request(data)
    if action == "remove":
        new["figure"] = None
    elif action == "upload":
        new["figure"] = uploaded_picture(picture)
    return new


def needs_check(old: dict, new: dict) -> bool:
    return any(k in new and old.get(k) != new[k] for k in CHECKED_FIELDS)


def _drawn(drawn) -> tuple[dict | None, str]:
    """Claude's drawing as the stored picture, or why it can't be used."""
    from figures import diagram_doc, figure_doc
    from validator import check_diagram, check_figure

    model = Figure if drawn.kind == "figure" else Diagram
    try:
        picture = model.model_validate(json.loads(drawn.picture))
    except (ValueError, TypeError) as e:
        return None, f"the {drawn.kind} is not valid {model.__name__} JSON: {str(e)[:300]}"
    problem = check_figure(picture) if drawn.kind == "figure" else check_diagram(picture)
    if problem:
        return None, problem
    return (figure_doc(picture) if drawn.kind == "figure" else diagram_doc(picture)), ""


def redraw(doc: dict, note: str, client) -> dict:
    """A new graph or diagram for the edited question `doc`, drawn by Claude and checked like a generated one.
    It gets one more try when the first drawing is unusable."""
    import generator

    stored = doc.get("figure") or {}
    figure, diagram = figure_from_doc(stored) if stored.get("kind") in ("plane", "geometry") else (None, None)
    current = (figure or diagram).model_dump_json() if figure or diagram else ""
    if stored.get("kind") == "image" and stored.get("alt"):
        note = f"{note} (The author's own picture, which this replaces, showed: {stored['alt']})".strip()
    problem = ""
    for _ in range(2):
        picture, problem = _drawn(generator.draw_picture(client, doc, note, current, problem))
        if picture:
            return picture
    raise EditError(f"The new picture couldn't be drawn ({problem}). Say what to draw and try again.")


def figure_from_doc(doc: dict | None) -> tuple[Figure | None, Diagram | None]:
    """The stored picture (figures.figure_doc / diagram_doc) back in the shape the validator checks."""
    if not doc or doc.get("kind") == "image":  # no program can read an uploaded image
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
    if doc.get("kind") == "image":
        return (
            f"The question shows a picture its author uploaded, described as: {doc.get('alt', '')} "
            "Only that description of it is known: if the question can't be answered from its words and the "
            "description, it is not checkable."
        )
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
        image = doc.get("figure") or {}
        if image.get("kind") == "image":
            q = q.model_copy(update={"prompt": f"{q.prompt} (The question shows a picture: {image.get('alt', '')})"})
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

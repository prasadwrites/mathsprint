"""Deck generation pipeline: Claude writes, SymPy checks, Claude fixes what failed.

Decks in a subject other than math (see subjects.py) are mostly multiple choice, which SymPy can't solve. For those,
a second Claude call answers every question without seeing the key (review), and a question it answers differently,
or finds unclear or wrong, goes back for repair like one that failed SymPy. Calculation questions in those subjects
(physics, chemistry) still get a SymPy check.
"""

from __future__ import annotations

import base64
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace
from typing import List

import anthropic
from pydantic import BaseModel, Field

import subjects
from schema import GeneratedDeck, GeneratedQuestion, picture_formats
from validator import check_question

MODEL = "claude-opus-5-5"
MAX_REPAIR_ROUNDS = 2
# Big decks (Pro plans allow up to 200 questions) are written in parts that run side by side,
# so each Claude call stays well inside its output limit and the whole deck inside the function timeout.
BATCH_SIZE = 20
PARALLEL_BATCHES = 5

log = logging.getLogger(__name__)

SYSTEM = """You write math practice questions for high school and college students in the US.

Every question needs a `check`: the same problem restated in SymPy syntax so a
program can verify your answer. Use ** for powers and * for multiplication.
Only use the variable you are solving for, numbers, + - * / ** ( ), and the
functions sqrt, exp, log, sin, cos, tan, abs, plus the constants pi and E.
For a word problem, the check is the equation you would set up, with `domain`
restricting answers that make no physical sense (lengths are 'positive').

Answers must be numeric: one or more real values. Give every real root of an
equation in answer_values. If the student should round, say so in the prompt
and set `tolerance` accordingly. Solution steps are short, concrete, and in the
order a strong student would write them; each step's `expression` shows the
working after that step.

Write `math` with readable Unicode (x², √, −, ·), not SymPy syntax.

Figures: when a question is about a graph (reading slope, intercepts, a vertex,
zeros, where graphs cross, which region is shaded, transformations), give it a
`figure`: a coordinate plane the app draws for you, written as a JSON object in
the Figure format below. Otherwise `figure` is ''.
Decks can mix both kinds; on a graph topic most questions should have a figure.
- Name each graph with one letter (f, g, h) and use those names in the `check`,
  so the answer is computed from what is drawn: 'f(3)' to evaluate, 'f(x) = 0'
  for zeros, 'f(x) = g(x)' for intersections, 'diff(f(x), x) = 0' for a vertex.
- Every point the student must read off the picture (intercepts, a vertex,
  where graphs cross, a line's two marked points) lies on the grid, at whole or
  half grid steps, so it can be read exactly. Every 'point' item must too.
- Pick ranges that show every key feature with some margin, 6 to 20 grid lines
  per axis; y_grid can differ from x_grid when y values are large. Keep labeled points apart so their labels don't overlap.
- Never label or mark the value the student is asked to find, and don't
  repeat the graph's equation in the prompt when the student must read it off.
- Use a 'region' with dashed true for a strict inequality (< or >).

Diagrams: when a question is about a shape (triangles, special right triangles,
similar figures, angles and parallel lines, polygons, circles, arcs and
sectors, area and perimeter), give it a `diagram` instead, a JSON object in the
Diagram format below. A question never has
both a figure and a diagram; text-only questions have neither.
- Give each point exact coordinates in SymPy syntax ('3*sqrt(3)', not 5.196),
  so the drawing is to scale and every length and angle is exact.
- Every number you label must match the drawing; label the unknown 'x' or '?'.
- Use the drawn points in the `check`: dist(A, B), angle(A, B, C) in degrees at
  B, area(A, B, C, ...) and perimeter(A, B, C, ...) for polygons in order, and
  px(A), py(A) for coordinates. Example: the hypotenuse is 'dist(A, B)'.
- Mark right angles with 'right_angle', equal sides with 'ticks' of the same
  count. Keep shapes in sensible proportions and points apart.

Answers: when the exact answer has a root or π, write answer_display in exact
form (6√3, 16π) and set `tolerance` to 0.01, so students may type the exact form
or a decimal. When the answer is a point (a midpoint, a vertex, an
intersection), set `pair` to true, answer_values to [x, y], and use a check of
kind 'point' with the expression 'x, y'.

""" + picture_formats()

# Any subject but math. {subject} is filled in per deck.
SYSTEM_GENERAL = """You write {subject} practice questions for high school and college students in the US.

Most questions are 'choice' questions with exactly four options and one clearly
correct answer; the other three are plausible but definitely wrong. Avoid "all
of the above", "none of the above", trick wording, opinions, and facts that are
disputed or change often; when a fact depends on a date, give the date in the
question. A choice question's `check` has kind 'none', with expression '' and
variable '' and domain 'real': another reviewer answers it again without the
key, so the correct option must follow from established facts alone.
answer_values is [], answer_display copies the correct option, tolerance is 0.

When a question asks for a calculation with one numeric result (a physics or
chemistry problem, say), it can be 'numeric' instead: the prompt names the unit
and how to round, answer_values holds the value, `tolerance` matches the
rounding, and the `check` has kind 'evaluate' with the arithmetic in SymPy
syntax (numbers, + - * / ** ( ), sqrt, exp, log, sin, cos, tan, pi, E; no units
or letters), so a program can verify it.

`math` is '' unless the question shows a formula, equation or chemical formula,
written in readable Unicode (H₂O, F = ma, x²).
`steps` explain why the answer is right in two to four short steps: each
`description` gives one piece of reasoning, and its `expression` the short fact,
formula or calculation it rests on ('' if none).
`concept` names the specific topic tested, e.g. 'Cellular respiration' or
"Newton's second law".
`figure` and `diagram` are always '', and `pair` is false.
"""


def system_for(subject: str) -> str:
    return SYSTEM if subjects.is_math(subject) else SYSTEM_GENERAL.replace("{subject}", subjects.clean(subject))


class GenerationError(RuntimeError):
    """A deck or explanation that couldn't be made, with a message fit to show the student.

    `detail` is the underlying cause (an Anthropic API error, for example), shown to the admin only."""

    def __init__(self, message: str, detail: str = ""):
        super().__init__(message)
        self.detail = detail


UNAVAILABLE = "Claude is unavailable right now. Please try again later."


def api_error(e: anthropic.APIError) -> GenerationError:
    """Turns an Anthropic API failure into a message for the student, keeping the real cause for the admin and the logs."""
    status = getattr(e, "status_code", None)
    detail = f"Anthropic API {status or 'connection'} error ({type(e).__name__}): {getattr(e, 'message', e)}"
    log.error(detail)
    if isinstance(e, anthropic.RateLimitError):
        return GenerationError("Lots of decks are being built right now. Try again in a minute.", detail)
    if isinstance(e, (anthropic.APIConnectionError, anthropic.InternalServerError)) or status == 529:
        return GenerationError("Claude is busy right now. Try again in a few minutes.", detail)
    # A rejected key, an empty credit balance, a model the account can't use: only the admin can fix these.
    return GenerationError(UNAVAILABLE, detail)


@dataclass
class DeckRequest:
    topic: str
    count: int
    difficulty: str  # Easy | Medium | Hard | Mixed
    level: str
    notes: str = ""
    subject: str = subjects.DEFAULT
    # What Claude read in a PDF the student uploaded; the questions are written to match it.
    source: str = ""
    part: int = 1
    parts: int = 1


@dataclass
class DeckResult:
    deck: GeneratedDeck
    dropped: int = 0
    repairs: int = 0
    failures: list[str] = field(default_factory=list)


def _too_large(e: anthropic.APIError) -> bool:
    return isinstance(e, anthropic.BadRequestError) and "grammar is too large" in str(e)


def _ask(client: anthropic.Anthropic, prompt: str, system: str = SYSTEM) -> GeneratedDeck:
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=20000,  # room for figures; kept under the SDK's non-streaming limit
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_format=GeneratedDeck,
            output_config={"effort": "medium"},
            # If a request is declined by a safety classifier, retry on a fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        if _too_large(e):
            # The API refuses to compile the deck schema into a grammar: ask for the same JSON as plain text instead.
            log.warning("output schema rejected as too large; asking for plain JSON")
            return _ask_plain(client, prompt, system)
        raise api_error(e) from e
    if response.stop_reason == "refusal":
        raise GenerationError("Claude declined to write this deck. Try rewording the topic.")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise GenerationError("The deck came back incomplete. Try fewer questions.")
    return response.parsed_output


def _ask_plain(client: anthropic.Anthropic, prompt: str, system: str = SYSTEM) -> GeneratedDeck:
    """The same request without constrained output: the deck's JSON Schema goes in the instructions."""
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=20000,
            system=system + "\n\nReply with one JSON object and nothing else, no code fences, matching this JSON Schema:\n"
            + json.dumps(GeneratedDeck.model_json_schema()),
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        raise api_error(e) from e
    if response.stop_reason == "refusal":
        raise GenerationError("Claude declined to write this deck. Try rewording the topic.")
    if response.stop_reason == "max_tokens":
        raise GenerationError("The deck came back incomplete. Try fewer questions.")
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    start, end = text.find("{"), text.rfind("}")
    try:
        return GeneratedDeck.model_validate_json(text[start : end + 1])
    except ValueError as e:
        log.warning("plain JSON deck didn't parse: %s", e)
        raise GenerationError("The deck came back garbled. Try again.") from e


def _initial_prompt(req: DeckRequest) -> str:
    mix = (
        "a balanced mix of Easy, Medium and Hard questions"
        if req.difficulty == "Mixed"
        else f"all at {req.difficulty} difficulty"
    )
    if subjects.is_math(req.subject):
        lines = [
            f"Write a practice deck of exactly {req.count} questions on: {req.topic}.",
            f"Level: {req.level}. Difficulty: {mix}.",
            "Use a mix of 'numeric' questions and a few 'choice' questions with four options.",
            "Add a figure to each question about a graph and a diagram to each question about a shape; leave both '' for the rest.",
        ]
    else:
        lines = [
            f"Write a {subjects.clean(req.subject)} practice deck of exactly {req.count} questions on: {req.topic}.",
            f"Level: {req.level}. Difficulty: {mix}.",
            "Make most of them 'choice' questions with four options; use 'numeric' only for calculations.",
        ]
    if req.source:
        lines.append(
            "Base the deck on this summary of material the student uploaded. Cover its topics in proportion, "
            "match its notation and the style of its problems, and write new problems rather than copying its own:\n"
            + req.source
        )
    if req.parts > 1:
        lines.append(
            f"This is part {req.part} of {req.parts} of a larger deck written in parallel. "
            "To avoid repeating the other parts, lean toward the sub-skills and question styles that fall "
            f"around position {req.part} of {req.parts} when the topic is split into that many areas, "
            "and vary the numbers and contexts."
        )
    if req.notes.strip():
        lines.append(f"Student's extra instructions: {req.notes.strip()}")
    return "\n".join(lines)


MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 100


class PdfSource(BaseModel):
    usable: bool = Field(description="True if the document has material in the requested subject that a student could practice.")
    topic: str = Field(description="A short name for what it covers, under 80 characters, e.g. 'Related rates' or 'Unit 4: Exponential functions'.")
    level: str = Field(description="The course or grade it suits, e.g. 'Algebra II' or 'AP Calculus AB'; '' if unclear.")
    summary: str = Field(
        description="Under 400 words: each topic and skill covered, the notation and methods used, "
        "and two or three representative problems written out in full."
    )


def read_pdf(data: bytes, topic_hint: str = "", client: anthropic.Anthropic | None = None, subject: str = subjects.DEFAULT) -> PdfSource:
    """Reads an uploaded PDF (worksheet, notes, textbook pages) into a short brief the deck is written from."""
    if not data.startswith(b"%PDF"):
        raise GenerationError("That file isn't a PDF.")
    if len(data) > MAX_PDF_BYTES:
        raise GenerationError("That PDF is too large. Upload one under 10 MB.")
    client = client or anthropic.Anthropic()
    ask = f"Read this document so {subjects.noun(subject)} practice questions can be written from it."
    if topic_hint:
        ask += f" The student wants to focus on: {topic_hint}"
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=4000,
            messages=[{"role": "user", "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()}},
                {"type": "text", "text": ask},
            ]}],
            output_format=PdfSource,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.BadRequestError as e:
        detail = str(getattr(e, "message", e))
        log.warning("PDF rejected: %s", detail)
        if "page" in detail.lower():
            raise GenerationError(f"That PDF has too many pages. Upload one with at most {MAX_PDF_PAGES}.", detail) from e
        raise GenerationError("That PDF couldn't be read. Try another file, or type the topic instead.", detail) from e
    except anthropic.APIError as e:
        raise api_error(e) from e
    source = response.parsed_output
    if response.stop_reason == "refusal" or source is None:
        raise GenerationError("That PDF couldn't be read. Try another file, or type the topic instead.")
    if not source.usable:
        raise GenerationError(f"That PDF doesn't seem to have any {subjects.noun(subject)} to practice.")
    return source


def _repair_prompt(req: DeckRequest, failed: list[tuple[GeneratedQuestion, str]]) -> str:
    items = [
        {"question": q.model_dump(), "problem": reason}
        for q, reason in failed
    ]
    check = "SymPy check" if subjects.is_math(req.subject) else "answer check"
    return (
        f"These questions for a {req.level} {subjects.noun(req.subject)} deck on {req.topic} failed an automatic {check}. "
        f"Write {len(failed)} corrected or replacement questions, one for each, at the same difficulty "
        "and on the same concept. Make sure the answer and the check agree.\n\n"
        + json.dumps(items, indent=2)
        + "\n\nReturn them as a deck; the title and topics fields can repeat the original deck's."
    )


def _difficulty_ok(req: DeckRequest, q: GeneratedQuestion) -> bool:
    return req.difficulty == "Mixed" or q.difficulty == req.difficulty


def generate_deck(req: DeckRequest, client: anthropic.Anthropic | None = None) -> DeckResult:
    client = client or anthropic.Anthropic()
    if req.count <= BATCH_SIZE:
        return _generate_part(req, client)

    sizes = [BATCH_SIZE] * (req.count // BATCH_SIZE) + ([req.count % BATCH_SIZE] if req.count % BATCH_SIZE else [])
    parts = [replace(req, count=n, part=i + 1, parts=len(sizes)) for i, n in enumerate(sizes)]

    def run(part: DeckRequest) -> DeckResult | Exception:
        try:
            return _generate_part(part, client)
        except GenerationError as e:
            log.warning("part %d of %d failed: %s", part.part, part.parts, e)
            return e

    with ThreadPoolExecutor(max_workers=PARALLEL_BATCHES) as pool:
        results = list(pool.map(run, parts))

    # A part that fails costs only its questions; the deck fails only if every part did.
    done = [r for r in results if isinstance(r, DeckResult)]
    if not done:
        raise results[0]
    first = done[0].deck
    topics = list(dict.fromkeys(t for r in done for t in r.deck.topics))[:5]
    deck = GeneratedDeck(title=first.title, topics=topics, questions=[q for r in done for q in r.deck.questions])
    return DeckResult(
        deck=deck,
        dropped=req.count - len(deck.questions),
        repairs=sum(r.repairs for r in done),
        failures=[f for r in done for f in r.failures],
    )


class ReviewedAnswer(BaseModel):
    number: int = Field(description="The question's number, as given.")
    choice: str = Field(description="The option you believe is correct, copied exactly.")
    problem: str = Field(description="'' if the question is sound. Otherwise one sentence: a factual error, more than one defensible option, or unclear wording.")


class Review(BaseModel):
    answers: List[ReviewedAnswer]


def _review(client: anthropic.Anthropic, req: DeckRequest, questions: list[GeneratedQuestion]) -> list[str]:
    """Claude answers each choice question again without the key. Returns, for each question, '' if it agrees with the
    key and finds nothing wrong, or the reason it doesn't."""
    asked = [(i, q) for i, q in enumerate(questions) if q.type == "choice" and q.check.kind == "none"]
    reasons = [""] * len(questions)
    if not asked:
        return reasons
    items = [{"number": n + 1, "question": f"{q.prompt} {q.math}".strip(), "options": q.choices} for n, (_, q) in enumerate(asked)]
    prompt = (
        f"You are checking a {req.level} {subjects.clean(req.subject)} practice deck before students see it. "
        "Answer each multiple-choice question below on your own: pick the one correct option, copied exactly. "
        "Then say whether the question has a problem: a factual error, no correct option, more than one defensible "
        "option, or wording a careful student could misread.\n\n" + json.dumps(items, indent=2, ensure_ascii=False)
    )
    try:
        response = client.beta.messages.parse(
            model=MODEL,
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
            output_format=Review,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        raise api_error(e) from e
    review = response.parsed_output
    by_number = {a.number: a for a in (review.answers if review else [])}
    for n, (i, q) in enumerate(asked):
        a = by_number.get(n + 1)
        if a is None:
            reasons[i] = "an independent check couldn't answer it"
        elif a.choice.strip() != q.answer_choice.strip():
            reasons[i] = f"an independent check chose {a.choice!r}, not the key {q.answer_choice!r}" + (f": {a.problem}" if a.problem else "")
        elif a.problem:
            reasons[i] = f"an independent check found a problem: {a.problem}"
    return reasons


def _sort(client: anthropic.Anthropic, req: DeckRequest, questions: list[GeneratedQuestion]) -> tuple[list[GeneratedQuestion], list[tuple[GeneratedQuestion, str]]]:
    """Splits questions into those that pass every check and those that go back for repair, with the reason."""
    math = subjects.is_math(req.subject)
    reasons = []
    for q in questions:
        result = check_question(q, math)
        reasons.append("" if result.ok and _difficulty_ok(req, q) else result.reason or f"difficulty should be {req.difficulty}")
    if not math:
        passed = [i for i, r in enumerate(reasons) if not r]
        for i, r in zip(passed, _review(client, req, [questions[i] for i in passed])):
            reasons[i] = r
    good = [q for q, r in zip(questions, reasons) if not r]
    failed = [(q, r) for q, r in zip(questions, reasons) if r]
    return good, failed


def _generate_part(req: DeckRequest, client: anthropic.Anthropic) -> DeckResult:
    system = system_for(req.subject)
    draft = _ask(client, _initial_prompt(req), system)
    good, failed = _sort(client, req, draft.questions[: req.count])

    repairs = 0
    for _ in range(MAX_REPAIR_ROUNDS):
        if not failed:
            break
        log.info("repairing %d questions: %s", len(failed), [r for _, r in failed])
        repairs += len(failed)
        fixed = _ask(client, _repair_prompt(req, failed), system)
        fixed_good, failed = _sort(client, req, fixed.questions[: len(failed)])
        good += fixed_good

    if not good:
        raise GenerationError("None of the generated questions passed the answer check. Try a narrower topic.")

    deck = GeneratedDeck(title=draft.title, topics=draft.topics, questions=good)
    return DeckResult(deck=deck, dropped=len(failed), repairs=repairs, failures=[r for _, r in failed])


EXPLAIN_STYLES = {
    "simple": "Explain it simply, in two or three short sentences.",
    "detailed": "Break it into smaller steps than the original solution, one idea per step.",
    "younger": "Explain it as you would to someone seeing this topic for the first time, with a concrete everyday comparison.",
    "another": "Show a different method that reaches the same result.",
}


def explain_step(question: dict, step_index: int | None, style: str, client: anthropic.Anthropic | None = None) -> str:
    client = client or anthropic.Anthropic()
    steps = question.get("steps", [])
    focus = (
        f"The student does not understand step {step_index + 1}: "
        f"{steps[step_index]['description']} ({steps[step_index]['expression']})."
        if step_index is not None and 0 <= step_index < len(steps)
        else "The student does not understand the solution."
    )
    figure = (question.get("figure") or {}).get("alt", "")
    prompt = (
        f"Question: {question.get('prompt', '')} {question.get('math', '')}\n"
        + (f"The question shows this picture: {figure}\n" if figure else "")
        + f"Answer:{question.get('answerDisplay', '')}\n"
        "Worked solution:\n"
        + "\n".join(f"{i + 1}. {s['description']}  {s['expression']}" for i, s in enumerate(steps))
        + f"\n\n{focus}\n{EXPLAIN_STYLES.get(style, EXPLAIN_STYLES['simple'])}\n"
        "Write plain text with Unicode math. No headings."
    )
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        raise api_error(e) from e
    if response.stop_reason == "refusal":
        raise GenerationError("Claude could not explain this step.")
    return "".join(b.text for b in response.content if b.type == "text").strip()

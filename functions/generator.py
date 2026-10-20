"""Deck generation pipeline: Claude writes, SymPy checks, Claude fixes what failed."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace

import anthropic

from schema import GeneratedDeck, GeneratedQuestion
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
`figure`: a coordinate plane the app draws for you. Otherwise `figure` is null.
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
sectors, area and perimeter), give it a `diagram` instead. A question never has
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
kind 'point' with the expression 'x, y'."""


class GenerationError(RuntimeError):
    pass


@dataclass
class DeckRequest:
    topic: str
    count: int
    difficulty: str  # Easy | Medium | Hard | Mixed
    level: str
    notes: str = ""
    part: int = 1
    parts: int = 1


@dataclass
class DeckResult:
    deck: GeneratedDeck
    dropped: int = 0
    repairs: int = 0
    failures: list[str] = field(default_factory=list)


def _ask(client: anthropic.Anthropic, prompt: str) -> GeneratedDeck:
    response = client.beta.messages.parse(
        model=MODEL,
        max_tokens=20000,  # room for figures; kept under the SDK's non-streaming limit
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        output_format=GeneratedDeck,
        output_config={"effort": "medium"},
        # If a request is declined by a safety classifier, retry on a fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise GenerationError("Claude declined to write this deck. Try rewording the topic.")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise GenerationError("The deck came back incomplete. Try fewer questions.")
    return response.parsed_output


def _initial_prompt(req: DeckRequest) -> str:
    mix = (
        "a balanced mix of Easy, Medium and Hard questions"
        if req.difficulty == "Mixed"
        else f"all at {req.difficulty} difficulty"
    )
    lines = [
        f"Write a practice deck of exactly {req.count} questions on: {req.topic}.",
        f"Level: {req.level}. Difficulty: {mix}.",
        "Use a mix of 'numeric' questions and a few 'choice' questions with four options.",
        "Add a figure to each question about a graph and a diagram to each question about a shape; leave both null for the rest.",
    ]
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


def _repair_prompt(req: DeckRequest, failed: list[tuple[GeneratedQuestion, str]]) -> str:
    items = [
        {"question": q.model_dump(), "problem": reason}
        for q, reason in failed
    ]
    return (
        f"These questions for a {req.level} deck on {req.topic} failed an automatic SymPy check. "
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
        except (GenerationError, anthropic.APIError) as e:
            log.warning("part %d of %d failed: %s", part.part, part.parts, e)
            return e

    with ThreadPoolExecutor(max_workers=PARALLEL_BATCHES) as pool:
        results = list(pool.map(run, parts))

    # A part that fails costs only its questions; the deck fails only if every part did.
    done = [r for r in results if isinstance(r, DeckResult)]
    if not done:
        first = results[0]
        if isinstance(first, GenerationError):
            raise first
        raise GenerationError("Claude couldn't be reached. Try again in a moment.") from first
    first = done[0].deck
    topics = list(dict.fromkeys(t for r in done for t in r.deck.topics))[:5]
    deck = GeneratedDeck(title=first.title, topics=topics, questions=[q for r in done for q in r.deck.questions])
    return DeckResult(
        deck=deck,
        dropped=req.count - len(deck.questions),
        repairs=sum(r.repairs for r in done),
        failures=[f for r in done for f in r.failures],
    )


def _generate_part(req: DeckRequest, client: anthropic.Anthropic) -> DeckResult:
    draft = _ask(client, _initial_prompt(req))

    good: list[GeneratedQuestion] = []
    failed: list[tuple[GeneratedQuestion, str]] = []
    for q in draft.questions[: req.count]:
        result = check_question(q)
        if result.ok and _difficulty_ok(req, q):
            good.append(q)
        else:
            failed.append((q, result.reason or f"difficulty should be {req.difficulty}"))

    repairs = 0
    for _ in range(MAX_REPAIR_ROUNDS):
        if not failed:
            break
        log.info("repairing %d questions: %s", len(failed), [r for _, r in failed])
        repairs += len(failed)
        fixed = _ask(client, _repair_prompt(req, failed))
        still: list[tuple[GeneratedQuestion, str]] = []
        for (orig, _), q in zip(failed, fixed.questions):
            result = check_question(q)
            if result.ok and _difficulty_ok(req, q):
                good.append(q)
            else:
                still.append((q, result.reason or f"difficulty should be {req.difficulty}"))
        failed = still

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
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
        output_config={"effort": "low"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        raise GenerationError("Claude could not explain this step.")
    return "".join(b.text for b in response.content if b.type == "text").strip()

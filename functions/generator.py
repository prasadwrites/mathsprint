"""Deck generation pipeline: Claude writes, SymPy checks, Claude fixes what failed."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import anthropic

from schema import GeneratedDeck, GeneratedQuestion
from validator import check_question

MODEL = "claude-opus-5-5"
MAX_REPAIR_ROUNDS = 2

log = logging.getLogger(__name__)

SYSTEM = """You write maths practice questions for students.

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

Write `math` with readable Unicode (x², √, −, ·), not SymPy syntax."""


class GenerationError(RuntimeError):
    pass


@dataclass
class DeckRequest:
    topic: str
    count: int
    difficulty: str  # Easy | Medium | Hard | Mixed
    level: str
    notes: str = ""


@dataclass
class DeckResult:
    deck: GeneratedDeck
    dropped: int = 0
    repairs: int = 0
    failures: list[str] = field(default_factory=list)


def _ask(client: anthropic.Anthropic, prompt: str) -> GeneratedDeck:
    response = client.beta.messages.parse(
        model=MODEL,
        max_tokens=16000,
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
    ]
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
    "younger": "Explain it as you would to an 8th-grade student, with a concrete everyday comparison.",
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
    prompt = (
        f"Question: {question.get('prompt', '')} {question.get('math', '')}\n"
        f"Answer: {question.get('answerDisplay', '')}\n"
        "Worked solution:\n"
        + "\n".join(f"{i + 1}. {s['description']}  {s['expression']}" for i, s in enumerate(steps))
        + f"\n\n{focus}\n{EXPLAIN_STYLES.get(style, EXPLAIN_STYLES['simple'])}\n"
        "Write plain text with Unicode maths. No headings."
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

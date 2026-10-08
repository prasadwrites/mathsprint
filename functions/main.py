"""Cloud Functions for MathSprint (Python runtime).

generate_deck  - Claude writes a deck, SymPy checks every answer, the deck is saved to Firestore.
explain_step   - Claude re-explains one solution step in the style the student picks.
"""

from __future__ import annotations

from firebase_admin import firestore, initialize_app
from firebase_functions import https_fn, options

from generator import DeckRequest, GenerationError, explain_step as _explain, generate_deck as _generate

initialize_app()
options.set_global_options(region="us-central1", max_instances=10)

DIFFICULTIES = {"Easy", "Medium", "Hard", "Mixed"}


def _require_user(req: https_fn.CallableRequest) -> str:
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "Sign in to create decks.")
    return req.auth.uid


def _clean(text, limit: int) -> str:
    return str(text or "").strip()[:limit]


@https_fn.on_call(secrets=["ANTHROPIC_API_KEY"], timeout_sec=540, memory=options.MemoryOption.GB_1)
def generate_deck(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    topic = _clean(data.get("topic"), 200)
    if not topic:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Tell me what to practise.")
    try:
        count = max(3, min(25, int(data.get("count", 10))))
    except (TypeError, ValueError):
        count = 10
    difficulty = data.get("difficulty") if data.get("difficulty") in DIFFICULTIES else "Medium"
    request = DeckRequest(
        topic=topic,
        count=count,
        difficulty=difficulty,
        level=_clean(data.get("level"), 80) or "High school",
        notes=_clean(data.get("notes"), 600),
    )

    try:
        result = _generate(request)
    except GenerationError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))

    db = firestore.client()
    deck_ref = db.collection("decks").document()
    batch = db.batch()
    batch.set(deck_ref, {
        "ownerId": uid,
        "title": result.deck.title,
        "topic": topic,
        "level": request.level,
        "difficulty": difficulty,
        "topics": result.deck.topics,
        "notes": request.notes,
        "questionCount": len(result.deck.questions),
        "source": "ai",
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    for i, q in enumerate(result.deck.questions):
        batch.set(deck_ref.collection("questions").document(), {
            "order": i,
            "prompt": q.prompt,
            "math": q.math,
            "type": q.type,
            "choices": q.choices,
            "answerValues": q.answer_values,
            "answerChoice": q.answer_choice,
            "answerDisplay": q.answer_display,
            "tolerance": q.tolerance,
            "concept": q.concept,
            "difficulty": q.difficulty,
            "steps": [s.model_dump() for s in q.steps],
            "check": q.check.model_dump(),
            "verified": True,
        })
    batch.commit()

    return {"deckId": deck_ref.id, "questionCount": len(result.deck.questions), "dropped": result.dropped}


@https_fn.on_call(secrets=["ANTHROPIC_API_KEY"], timeout_sec=120)
def explain_step(req: https_fn.CallableRequest) -> dict:
    uid = _require_user(req)
    data = req.data or {}
    deck_id, question_id = _clean(data.get("deckId"), 64), _clean(data.get("questionId"), 64)
    db = firestore.client()
    deck = db.collection("decks").document(deck_id).get()
    if not deck.exists or deck.get("ownerId") != uid:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "Deck not found.")
    q = deck.reference.collection("questions").document(question_id).get()
    if not q.exists:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "Question not found.")
    step = data.get("step")
    step = int(step) if isinstance(step, (int, float)) else None
    try:
        text = _explain(q.to_dict(), step, _clean(data.get("style"), 20) or "simple")
    except GenerationError as e:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, str(e))
    return {"explanation": text}

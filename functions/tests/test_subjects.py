import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import leaderboards  # noqa: E402
import posts  # noqa: E402
import subjects  # noqa: E402
from generator import DeckRequest, PdfSource, Review, ReviewedAnswer, generate_deck, read_pdf  # noqa: E402
from schema import Check, GeneratedDeck, GeneratedQuestion, SolutionStep  # noqa: E402
from validator import check_question  # noqa: E402


def test_old_decks_are_math_and_the_list_keeps_math_first():
    assert subjects.of({}) == "Math" and subjects.of({"subject": "  Physics "}) == "Physics"
    assert subjects.listed(["Biology", "", "biology", "Maths", "General   Knowledge"]) == ["Math", "Biology", "General Knowledge"]
    assert subjects.listed(None) == ["Math"]
    assert subjects.pick("physics", ["Math", "Physics"]) == "Physics"
    assert subjects.pick("Astrology", ["Math", "Physics"]) == "Math"


def test_share_text_follows_the_subject():
    board = {"deckTitle": "", "total": 10, "board": [], "subject": "Biology"}
    assert "Calling all Biology fans" in leaderboards.share_text(board)
    assert "How fast is your Biology?" in leaderboards.preview_description(board)
    assert "Calling all math fans" in leaderboards.share_text({**board, "subject": None})
    post = {"deckTitle": "Cell division", "subject": "Biology", "question": {"prompt": "Which phase comes first?"}}
    assert posts.headline(post) == "Can you answer this?"
    assert "Can you answer it?" in posts.share_text(post)
    assert posts.headline({"question": {}}) == "Can you solve this?"


def choice(answer="Mitochondria", choices=("Nucleus", "Mitochondria", "Ribosome", "Golgi body")):
    return GeneratedQuestion(
        prompt="Which organelle makes most of a cell's ATP?", math="", type="choice", choices=list(choices),
        answer_values=[], answer_choice=answer, answer_display=answer, tolerance=0, concept="Cell organelles",
        difficulty="Medium", steps=[SolutionStep(description="Cellular respiration happens there.", expression="")],
        check=Check(kind="none", expression="", variable="", domain="real"),
    )


def test_unchecked_choice_questions_pass_only_outside_math():
    assert check_question(choice(), math=False).ok
    assert not check_question(choice()).ok
    assert not check_question(choice(answer="Liver"), math=False).ok
    numeric = choice().model_copy(update={"type": "numeric", "choices": [], "answer_values": [5.0]})
    assert "needs a SymPy check" in check_question(numeric, math=False).reason


def test_a_physics_calculation_is_still_checked_by_sympy():
    q = GeneratedQuestion(
        prompt="A 2 kg mass accelerates at 3 m/s². What is the net force in newtons?", math="F = ma", type="numeric",
        choices=[], answer_values=[6], answer_choice="", answer_display="6 N", tolerance=0, concept="Newton's second law",
        difficulty="Easy", steps=[SolutionStep(description="Multiply.", expression="2 · 3 = 6")],
        check=Check(kind="evaluate", expression="2*3", variable="", domain="real"),
    )
    assert check_question(q, math=False).ok
    assert not check_question(q.model_copy(update={"answer_values": [5]}), math=False).ok


class ReviewClient:
    """Answers deck requests from `decks` and review requests from `reviews`; records the system prompts and prompts."""

    def __init__(self, decks, reviews):
        self.decks, self.reviews, self.systems, self.prompts = list(decks), list(reviews), [], []
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kw):
        self.prompts.append(kw["messages"][0]["content"])
        if kw["output_format"] is Review:
            return SimpleNamespace(stop_reason="end_turn", parsed_output=self.reviews.pop(0))
        if kw["output_format"] is PdfSource:
            return SimpleNamespace(stop_reason="end_turn", parsed_output=PdfSource(usable=False, topic="", level="", summary=""))
        self.systems.append(kw.get("system", ""))
        return SimpleNamespace(stop_reason="end_turn", parsed_output=self.decks.pop(0))


def deck(*qs):
    return GeneratedDeck(title="Cells", topics=["Organelles"], questions=list(qs))


def agree(*picks, problem=""):
    return Review(answers=[ReviewedAnswer(number=i + 1, choice=p, problem=problem) for i, p in enumerate(picks)])


def test_a_question_the_review_disagrees_with_is_repaired():
    wrong = choice(answer="Nucleus")
    client = ReviewClient(
        decks=[deck(choice(), wrong), deck(choice())],
        reviews=[agree("Mitochondria", "Mitochondria"), agree("Mitochondria")],
    )
    result = generate_deck(DeckRequest("Cells", 2, "Medium", "AP Biology", subject="Biology"), client)
    assert len(result.deck.questions) == 2 and result.repairs == 1 and result.dropped == 0
    assert "Biology practice questions" in client.systems[0] and "SymPy syntax" not in client.systems[0].split("numeric")[0]
    assert "chose 'Mitochondria', not the key 'Nucleus'" in client.prompts[2]
    # The reviewer never sees the key.
    assert "answer_choice" not in client.prompts[1] and "Nucleus" in client.prompts[1]


def test_a_question_the_review_finds_unclear_is_dropped_after_repairs():
    unclear = Review(answers=[ReviewedAnswer(number=1, choice="Mitochondria", problem="Two options could be right.")])
    client = ReviewClient(
        decks=[deck(choice(), choice()), deck(choice()), deck(choice())],
        reviews=[Review(answers=[agree("Mitochondria").answers[0], ReviewedAnswer(number=2, choice="Mitochondria", problem="Two options could be right.")]), unclear, unclear],
    )
    result = generate_deck(DeckRequest("Cells", 2, "Medium", "AP Biology", subject="Biology"), client)
    assert len(result.deck.questions) == 1 and result.dropped == 1 and result.repairs == 2
    assert "found a problem: Two options could be right." in client.prompts[2]


def test_math_decks_keep_the_math_instructions_and_skip_the_review():
    from generator import SYSTEM

    q = GeneratedQuestion(
        prompt="Solve for x:", math="x − 4 = 0", type="numeric", choices=[], answer_values=[4], answer_choice="",
        answer_display="x = 4", tolerance=0, concept="Linear equations", difficulty="Medium",
        steps=[SolutionStep(description="Add 4.", expression="x = 4")],
        check=Check(kind="solve", expression="x - 4 = 0", variable="x", domain="real"),
    )
    client = ReviewClient(decks=[deck(q)], reviews=[])
    generate_deck(DeckRequest("Linear equations", 1, "Medium", "Algebra I"), client)
    assert client.systems == [SYSTEM] and len(client.prompts) == 1


def test_pdf_refusal_names_the_subject():
    import pytest
    from generator import GenerationError

    with pytest.raises(GenerationError, match="any Chemistry to practice"):
        read_pdf(b"%PDF-1.4 fake", "", ReviewClient([], []), subject="Chemistry")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import public_decks  # noqa: E402
import teacher_exams as te  # noqa: E402
from generator import DeckRequest, Review, ReviewedAnswer, _initial_prompt, exam_parts, generate_deck  # noqa: E402
from schema import Check, GeneratedDeck, GeneratedQuestion, SolutionStep  # noqa: E402
from tests.test_generator import FakeClient, make_q  # noqa: E402


def test_every_exam_weights_add_up_to_100():
    for exam_id, e in te.EXAMS.items():
        assert sum(p for _, p, _ in e["categories"]) == 100, exam_id


def test_every_state_lists_known_exams():
    assert set(te.STATES) <= set(te.STATE_NAMES)
    for code, (exams, _) in te.STATES.items():
        assert exams and all(te.is_exam(e) for e in exams), code
    assert te.STATES["TX"][0] == ["texes-235", "texes-115"]
    assert te.STATES["VA"][0] == te.PRAXIS


def test_catalog_lists_all_states_and_unconfirmed_ones_have_no_exams():
    cat = te.catalog()
    assert len(cat["states"]) == 51
    iowa = next(s for s in cat["states"] if s["code"] == "IA")
    assert iowa["exams"] == []
    praxis = next(e for e in cat["exams"] if e["id"] == "praxis-5165")
    assert praxis["minutesPerQuestion"] == round(180 / 66, 2)
    assert praxis["categories"][0] == {"name": "Number and Quantity", "percent": 10, "covers": praxis["categories"][0]["covers"]}


def test_split_always_adds_up():
    for total in (3, 10, 17, 66, 100, 200):
        for exam in te.EXAMS.values():
            counts = te.split([p for _, p, _ in exam["categories"]], total)
            assert sum(counts) == total
    assert te.split([30, 30, 20, 20], 10) == [3, 3, 2, 2]


def test_plan_for_one_category_or_the_whole_exam():
    assert te.plan("praxis-5165", 4, 20) == [("Geometry", te.EXAMS["praxis-5165"]["categories"][4][2], 20)]
    whole = te.plan("praxis-5165", None, 66)
    assert [n for _, _, n in whole] == [7, 13, 13, 7, 13, 13]
    assert te.plan("praxis-5165", 99, 10) == te.plan("praxis-5165", None, 10)
    assert te.plan("praxis-5165", True, 10) == te.plan("praxis-5165", None, 10)


def test_titles():
    assert te.deck_title("texes-235", 1) == "TExES 235: Patterns and Algebra"
    assert te.deck_title("praxis-5164", None) == "Praxis 5164 Middle School Mathematics: mixed practice"


def test_exam_parts_keep_categories_in_order_and_sizes():
    plan = [("A", "a", 15), ("B", "b", 10), ("C", "c", 5)]
    parts = exam_parts(plan, [20, 10])
    assert parts == [[("A", "a", 15), ("B", "b", 5)], [("B", "b", 5), ("C", "c", 5)]]


def test_exam_prompt_names_categories_and_counts():
    req = DeckRequest(topic="Praxis 5165", count=10, difficulty="Mixed", level="Praxis", exam="For teachers.",
                      exam_plan=[("Algebra", "equations", 6), ("Geometry", "triangles", 4)])
    prompt = _initial_prompt(req)
    assert "For teachers." in prompt
    assert "- 6 on Algebra (covers equations)" in prompt and "- 4 on Geometry (covers triangles)" in prompt


def teaching_q(answer="Adds the denominators"):
    return GeneratedQuestion(
        prompt="A student writes 1/2 + 1/3 = 2/5. Which error explains it?", math="", type="choice",
        choices=["Adds the denominators", "Multiplies the numerators", "Inverts the second fraction", "Rounds early"],
        answer_values=[], answer_choice=answer, answer_display=answer, tolerance=0,
        concept="Students as Learners", difficulty="Medium", steps=[SolutionStep(description="d", expression="")],
        check=Check(kind="none", expression="", variable="", domain="real"),
    )


def test_exam_deck_keeps_teaching_questions_the_reviewer_agrees_with():
    draft = GeneratedDeck(title="T", topics=["x"], questions=[make_q([2, 3]), teaching_q()])
    client = FakeClient([draft, Review(answers=[ReviewedAnswer(number=1, choice="Adds the denominators", problem="")])])
    req = DeckRequest(topic="MTTC 133", count=2, difficulty="Mixed", level="MTTC", exam="x",
                      exam_plan=[("Mathematical Content", "", 1), ("Students as Learners", "", 1)])
    result = generate_deck(req, client)
    assert len(result.deck.questions) == 2


def test_an_unchecked_question_still_fails_on_an_ordinary_math_deck():
    draft = GeneratedDeck(title="T", topics=["x"], questions=[make_q([2, 3]), teaching_q()])
    fixed = GeneratedDeck(title="T", topics=["x"], questions=[make_q([2, 3])])
    client = FakeClient([draft, fixed])
    result = generate_deck(DeckRequest(topic="Fractions", count=2, difficulty="Mixed", level="HS"), client)
    assert len(result.deck.questions) == 2
    assert "SymPy check" in client.prompts[1]


def test_cert_decks_are_marked_on_their_cards():
    card = public_decks.card("d1", {"title": "Praxis 5165: Geometry", "public": True, "certExam": "praxis-5165", "questionCount": 3})
    assert card["certExam"] == "praxis-5165"
    assert "certExam" not in public_decks.card("d2", {"title": "Algebra", "public": True})
    assert public_decks.is_cert({"certExam": "texes-235"}) and not public_decks.is_cert({"public": True})


def test_new_accounts_are_asked_and_old_ones_are_not():
    import accounts
    assert accounts.new_account("a@b.c", "A")["teacherAsked"] is False
    assert accounts.summary(accounts.new_account("a@b.c", "A"), False)["teacherAsked"] is False
    old = {"plan": "free", "decksCreated": 2}
    assert accounts.summary(old, False)["teacherAsked"] is True and accounts.summary(old, False)["isTeacher"] is False
    assert accounts.summary({**old, "isTeacher": True, "teacherAsked": True}, False)["isTeacher"] is True


def test_cert_decks_are_only_for_teachers_and_never_on_the_public_list():
    cert = {"ownerId": "admin", "certExam": "praxis-5165", "questionCount": 3}
    assert not public_decks.can_open(cert, "student")
    assert public_decks.can_open(cert, "teacher", teacher=True)
    assert public_decks.can_open(cert, "admin")
    old_public_cert = {**cert, "public": True}
    assert not public_decks.can_open(old_public_cert, "student")
    assert public_decks.cards([("c", old_public_cert), ("p", {"public": True, "questionCount": 2})])[0]["id"] == "p"
    assert len(public_decks.cards([("c", old_public_cert)])) == 0

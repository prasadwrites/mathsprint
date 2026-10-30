import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import editing  # noqa: E402
from figures import diagram_doc, figure_doc  # noqa: E402
from generator import Review, ReviewedAnswer, WrittenCheck  # noqa: E402
from schema import Check, Diagram, DiagramItem, Figure, FigureItem, GeoPoint  # noqa: E402

STEPS = [{"description": "Factor.", "expression": "(x − 2)(x − 3) = 0"}]


def numeric(**kw):
    return {
        "prompt": "Solve for x:", "math": "x² − 5x + 6 = 0", "type": "numeric", "choices": [], "answerValues": [2.0, 3.0],
        "answerChoice": "", "answerDisplay": "x = 2, 3", "tolerance": 0, "concept": "Factoring", "difficulty": "Medium",
        "steps": STEPS, "verified": True, **kw,
    }


def choice(**kw):
    return {
        "prompt": "What is 6 × 7?", "math": "", "type": "choice", "choices": ["42", "48", "36", "54"], "answerValues": [42.0],
        "answerChoice": "42", "answerDisplay": "42", "tolerance": 0, "concept": "Times tables", "difficulty": "Easy",
        "steps": STEPS, "verified": True, **kw,
    }


def edit(old, **kw):
    data = {"prompt": old["prompt"], "math": old["math"], "steps": old["steps"], "concept": old["concept"], "difficulty": old["difficulty"]}
    if old["type"] == "choice":
        data.update(choices=old["choices"], answerChoice=old["answerChoice"])
    else:
        data["answer"] = old["answerDisplay"]
    data.update(kw)
    return editing.apply_edit(old, data)


class FakeClient:
    """Answers beta.messages.parse with queued outputs and records what was asked."""

    def __init__(self, *outputs):
        self.outputs, self.asked = list(outputs), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kw):
        self.asked.append(kw["messages"][0]["content"])
        return SimpleNamespace(stop_reason="end_turn", parsed_output=self.outputs.pop(0), usage=None)


def written(expr, kind="solve", variable="x", domain="real"):
    return WrittenCheck(checkable=True, problem="", check=Check(kind=kind, expression=expr, variable=variable, domain=domain))


def test_answer_text_is_read_as_numbers():
    q = edit(numeric(), answer="x = 2 or x = 3")
    assert q["answerValues"] == [2, 3] and q["answerDisplay"] == "x = 2 or x = 3"
    assert edit(numeric(), answer="6√3")["answerValues"][0] == pytest.approx(10.3923, abs=1e-4)
    assert edit(numeric(), answer="6√3")["tolerance"] == 0.01
    assert edit(numeric(), answer="3.33")["tolerance"] == 0.005
    assert edit(numeric(pair=True), answer="(2, -5)")["answerValues"] == [2, -5]
    with pytest.raises(editing.EditError, match="point"):
        edit(numeric(pair=True), answer="2")
    with pytest.raises(editing.EditError, match="numbers"):
        edit(numeric(), answer="two")


def test_shape_errors():
    with pytest.raises(editing.EditError):
        edit(numeric(), prompt="  ")
    with pytest.raises(editing.EditError, match="step"):
        edit(numeric(), steps=[{"description": "", "expression": ""}])
    with pytest.raises(editing.EditError, match="same"):
        edit(choice(), choices=["42", "42", "36", "54"])
    with pytest.raises(editing.EditError, match="correct option"):
        edit(choice(), answerChoice="41")
    with pytest.raises(editing.EditError, match="every option"):
        edit(choice(), choices=["42", "48", "36"])


def test_steps_only_edit_needs_no_check():
    old = numeric()
    assert not editing.needs_check(old, edit(old, steps=[{"description": "Use the quadratic formula.", "expression": "x = (5 ± 1)/2"}]))
    assert editing.needs_check(old, edit(old, math="x² − 7x + 12 = 0"))


def test_also_accepted_answers_are_cleaned_and_need_no_check():
    old = numeric(answerValues=[10.0], answerDisplay="10")
    new = edit(old, acceptedAnswers=["  ten ", "Ten", "", "10", "ten meters", 7])
    assert new["acceptedAnswers"] == ["ten", "ten meters", "7"]
    assert not editing.needs_check(old, new)
    with pytest.raises(editing.EditError):
        edit(old, acceptedAnswers=[f"a{i}" for i in range(11)])
    assert "acceptedAnswers" not in edit(choice(), acceptedAnswers=["forty-two"])


def test_correct_edit_passes_and_keeps_the_new_check():
    old = numeric()
    new = {**old, **edit(old, math="x² − 7x + 12 = 0", answer="3, 4")}
    client = FakeClient(written("x**2 - 7*x + 12 = 0"))
    v = editing.verify(new, "Math", "Algebra I", client)
    assert v.ok and v.check["expression"] == "x**2 - 7*x + 12 = 0"
    # Claude restates the question without the owner's answer.
    assert "3, 4" not in client.asked[0] and "x² − 7x + 12 = 0" in client.asked[0]


def test_wrong_answer_is_rejected_with_what_sympy_found():
    old = numeric()
    new = {**old, **edit(old, math="x² − 7x + 12 = 0")}  # answer left at 2, 3
    v = editing.verify(new, "Math", "Algebra I", FakeClient(written("x**2 - 7*x + 12 = 0")))
    assert not v.ok and "3, 4" in v.message and "x = 2, 3" in v.message


def test_uncheckable_question_is_rejected():
    old = numeric()
    new = {**old, **edit(old, prompt="Explain why factoring works.")}
    unclear = WrittenCheck(checkable=False, problem="It asks for an explanation, not a number.", check=Check(kind="none", expression="", variable="", domain="real"))
    v = editing.verify(new, "Math", "Algebra I", FakeClient(unclear))
    assert not v.ok and "explanation" in v.message


def test_math_choice_needs_exactly_one_matching_option():
    old = choice()
    good = {**old, **edit(old, prompt="What is 6 × 8?", answerChoice="48")}
    assert editing.verify(good, "Math", "", FakeClient(written("6*8", kind="evaluate", variable=""))).ok
    wrong = {**old, **edit(old, prompt="What is 6 × 8?")}  # still keyed 42
    v = editing.verify(wrong, "Math", "", FakeClient(written("6*8", kind="evaluate", variable="")))
    assert not v.ok and "48" in v.message


def test_other_subjects_are_answered_again_without_the_key():
    old = choice(prompt="Which organelle makes ATP?", choices=["Mitochondrion", "Nucleus", "Ribosome", "Golgi body"],
                 answerValues=[], answerChoice="Nucleus", answerDisplay="Nucleus")
    new = {**old, **edit(old)}
    client = FakeClient(Review(answers=[ReviewedAnswer(number=1, choice="Mitochondrion", problem="")]))
    v = editing.verify({**new, "prompt": "Which organelle makes most of a cell's ATP?"}, "Biology", "High school", client)
    assert not v.ok and "Mitochondrion" in v.message
    agrees = FakeClient(Review(answers=[ReviewedAnswer(number=1, choice="Nucleus", problem="")]))
    assert editing.verify(new, "Biology", "High school", agrees).ok


def test_numeric_question_in_another_subject_gets_sympy():
    old = numeric(prompt="A 2 kg mass accelerates at 3 m/s². What net force acts on it, in N?", math="F = ma",
                  answerValues=[6.0], answerDisplay="6")
    new = {**old, **edit(old, answer="5")}
    v = editing.verify(new, "Physics", "", FakeClient(written("2*3", kind="evaluate", variable="")))
    assert not v.ok and "6" in v.message


def test_graph_question_is_checked_against_the_picture():
    fig = Figure(kind="plane", alt="A parabola.", x_min=-5, x_max=5, y_min=-5, y_max=5, x_grid=1, y_grid=1,
                 items=[FigureItem(type="function", expr="x**2 - 4", points=[], label="f", side="", dashed=False)])
    old = numeric(prompt="What is f(3)?", math="", answerValues=[5.0], answerDisplay="5", figure=figure_doc(fig))
    new = {**old, **edit(old, prompt="What is f(1)?", answer="-3")}
    client = FakeClient(written("f(1)", kind="evaluate", variable=""))
    assert editing.verify(new, "Math", "", client).ok
    assert "f(x) = x**2 - 4" in client.asked[0]


def test_diagram_question_is_checked_against_the_picture():
    d = Diagram(alt="Right triangle.", points=[GeoPoint(name=n, x=x, y=y, show=True) for n, x, y in (("A", "0", "0"), ("B", "3*sqrt(3)", "0"), ("C", "0", "3"))],
                items=[DiagramItem(type="polygon", of=["A", "B", "C"], text="", count=0, dashed=False, shaded=False),
                       DiagramItem(type="right_angle", of=["B", "A", "C"], text="", count=0, dashed=False, shaded=False)])
    old = numeric(prompt="Find BC.", math="", answerValues=[6.0], answerDisplay="6", figure=diagram_doc(d))
    new = {**old, **edit(old, prompt="Find AB.", answer="3√3")}
    assert editing.verify(new, "Math", "", FakeClient(written("dist(A, B)", kind="evaluate", variable=""))).ok
    wrong = {**old, **edit(old, prompt="Find AB.", answer="5")}
    assert not editing.verify(wrong, "Math", "", FakeClient(written("dist(A, B)", kind="evaluate", variable=""))).ok


def new(**kw):
    data = {"type": "numeric", "prompt": "Solve for x:", "math": "2x + 1 = 7", "answer": "3", "concept": "Linear equations",
            "difficulty": "Easy", "steps": STEPS}
    data.update(kw)
    return data


def test_new_typed_question_is_shaped_like_a_generated_one():
    q = editing.new_question(new(acceptedAnswers=["three", "3"]), math=True)
    assert q["type"] == "numeric" and q["answerValues"] == [3.0] and q["answerDisplay"] == "3"
    assert q["acceptedAnswers"] == ["three"] and q["choices"] == [] and q["tolerance"] == 0
    assert "figure" not in q


def test_new_choice_question_keeps_numbers_in_math_only():
    data = new(type="choice", prompt="What is 6 × 7?", math="", choices=["42", "48", "36"], answerChoice="42")
    assert editing.new_question(data, math=True)["answerValues"] == [42.0]
    assert editing.new_question(data, math=False)["answerValues"] == []


def test_new_question_shape_errors():
    for data, flags, message in [
        (new(type="essay"), {}, "typed answer or multiple choice"),
        (new(), {"choices_only": True}, "multiple choice only"),
        (new(type="choice", choices=["1"], answerChoice="1"), {}, "2 to 6 options"),
        (new(type="choice", choices=["1", "2", "3", "4", "5", "6", "7"], answerChoice="1"), {}, "2 to 6 options"),
        (new(type="choice", choices=["1", "2"], answerChoice="3"), {}, "Pick the correct option"),
        (new(concept=""), {}, "concept"),
        (new(answer=""), {}, "Give the correct answer"),
        (new(prompt=" "), {}, "can't be empty"),
    ]:
        with pytest.raises(editing.EditError, match=message):
            editing.new_question(data, math=True, **flags)


def test_new_question_is_checked_like_an_edit():
    q = editing.new_question(new(answer="4"), math=True)
    verdict = editing.verify(q, "Math", "", FakeClient(written("2*x + 1 = 7")))
    assert not verdict.ok and "worked this out as 3, not 4" in verdict.message
    q = editing.new_question(new(), math=True)
    assert editing.verify(q, "Math", "", FakeClient(written("2*x + 1 = 7"))).ok

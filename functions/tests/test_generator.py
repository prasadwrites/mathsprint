import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generator import DeckRequest, generate_deck  # noqa: E402
from schema import Check, GeneratedDeck, GeneratedQuestion, SolutionStep  # noqa: E402


def make_q(values, expr="x**2 - 5*x + 6 = 0"):
    return GeneratedQuestion(
        prompt="Solve for x:", math="", type="numeric", choices=[], answer_values=values,
        answer_choice="", answer_display="", tolerance=0, concept="Factoring", difficulty="Medium",
        steps=[SolutionStep(description="d", expression="e")],
        check=Check(kind="solve", expression=expr, variable="x", domain="real"),
    )


class FakeClient:
    """Returns queued decks from beta.messages.parse and records the prompts."""

    def __init__(self, decks):
        self.decks, self.prompts = list(decks), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kw):
        self.prompts.append(kw["messages"][0]["content"])
        return SimpleNamespace(stop_reason="end_turn", parsed_output=self.decks.pop(0))


def deck(*qs):
    return GeneratedDeck(title="Quadratics", topics=["Factoring"], questions=list(qs))


def test_wrong_answer_is_repaired():
    client = FakeClient([
        deck(make_q([2, 3]), make_q([-2, -3])),  # second answer is wrong
        deck(make_q([4], expr="x - 4 = 0")),      # the repair
    ])
    result = generate_deck(DeckRequest("Quadratics", 2, "Medium", "Algebra II"), client)
    assert [q.answer_values for q in result.deck.questions] == [[2, 3], [4]]
    assert result.repairs == 1 and result.dropped == 0
    assert "does not match" in client.prompts[1]


def test_unfixable_question_is_dropped():
    bad = make_q([-2, -3])
    client = FakeClient([deck(make_q([2, 3]), bad), deck(bad), deck(bad)])
    result = generate_deck(DeckRequest("Quadratics", 2, "Medium", "Algebra II"), client)
    assert len(result.deck.questions) == 1 and result.dropped == 1

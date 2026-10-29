import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import anthropic  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

from generator import MAX_PDF_BYTES, UNAVAILABLE, DeckRequest, GenerationError, PdfSource, generate_deck, read_pdf  # noqa: E402
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


class ThreadSafeFakeClient:
    """Answers every part of a big deck with `n` good questions; records each prompt."""

    def __init__(self):
        import threading

        self.lock, self.prompts = threading.Lock(), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kw):
        prompt = kw["messages"][0]["content"]
        with self.lock:
            self.prompts.append(prompt)
        n = int(prompt.split("exactly ")[1].split(" ")[0])
        return SimpleNamespace(stop_reason="end_turn", parsed_output=deck(*[make_q([2, 3]) for _ in range(n)]))


def test_big_decks_are_written_in_parts():
    client = ThreadSafeFakeClient()
    result = generate_deck(DeckRequest("Quadratics", 45, "Medium", "Algebra II"), client)
    assert len(result.deck.questions) == 45 and result.dropped == 0
    assert sorted(p.split("exactly ")[1].split(" ")[0] for p in client.prompts) == ["20", "20", "5"]
    assert all("of 3 of a larger deck" in p for p in client.prompts)


def test_small_decks_are_one_call():
    client = ThreadSafeFakeClient()
    generate_deck(DeckRequest("Quadratics", 20, "Medium", "Algebra II"), client)
    assert len(client.prompts) == 1 and "larger deck" not in client.prompts[0]


class FailingClient:
    """beta.messages.parse always raises the given Anthropic API error."""

    def __init__(self, error):
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=lambda **kw: (_ for _ in ()).throw(error)))


def api_status_error(cls, status, message):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls(message, response=httpx.Response(status, request=request), body=None)


def test_api_errors_become_messages_with_the_cause_kept_for_the_admin():
    error = api_status_error(anthropic.BadRequestError, 400, "Your credit balance is too low to access the Anthropic API.")
    with pytest.raises(GenerationError) as e:
        generate_deck(DeckRequest(topic="t", count=2, difficulty="Medium", level="HS"), client=FailingClient(error))
    assert str(e.value) == UNAVAILABLE
    assert "credit balance is too low" in e.value.detail


def test_a_busy_api_asks_the_student_to_retry():
    error = api_status_error(anthropic.InternalServerError, 529, "Overloaded")
    with pytest.raises(GenerationError, match="busy"):
        generate_deck(DeckRequest(topic="t", count=2, difficulty="Medium", level="HS"), client=FailingClient(error))


def test_a_big_deck_whose_parts_all_fail_reports_the_cause():
    error = api_status_error(anthropic.AuthenticationError, 401, "invalid x-api-key")
    with pytest.raises(GenerationError) as e:
        generate_deck(DeckRequest(topic="t", count=45, difficulty="Medium", level="HS"), client=FailingClient(error))
    assert "invalid x-api-key" in e.value.detail


class GrammarTooLargeClient:
    """Rejects the structured-output call like the API does, then answers the plain call with JSON text."""

    def __init__(self, deck_json):
        self.deck_json, self.plain_systems = deck_json, []
        error = api_status_error(anthropic.BadRequestError, 400, "The compiled grammar is too large, which would cause performance issues.")
        self.beta = SimpleNamespace(messages=SimpleNamespace(
            parse=lambda **kw: (_ for _ in ()).throw(error),
            create=self._create,
        ))

    def _create(self, **kw):
        self.plain_systems.append(kw["system"])
        text = SimpleNamespace(type="text", text="Here it is:\n```json\n" + self.deck_json + "\n```")
        return SimpleNamespace(stop_reason="end_turn", content=[text])


def test_a_rejected_output_schema_falls_back_to_plain_json():
    client = GrammarTooLargeClient(deck(make_q([2, 3])).model_dump_json())
    result = generate_deck(DeckRequest(topic="t", count=1, difficulty="Medium", level="HS"), client=client)
    assert [q.answer_values for q in result.deck.questions] == [[2, 3]]
    assert "JSON Schema" in client.plain_systems[0]


def test_garbled_plain_json_is_a_readable_error():
    with pytest.raises(GenerationError, match="garbled"):
        generate_deck(DeckRequest(topic="t", count=1, difficulty="Medium", level="HS"), client=GrammarTooLargeClient("{oops"))


class PdfClient:
    """Answers the PDF read with `source`, then decks as FakeClient does; records every request."""

    def __init__(self, source, decks=()):
        self.source, self.decks, self.calls = source, list(decks), []
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kw):
        self.calls.append(kw)
        if kw["output_format"] is PdfSource:
            return SimpleNamespace(stop_reason="end_turn", parsed_output=self.source)
        return SimpleNamespace(stop_reason="end_turn", parsed_output=self.decks.pop(0))


PDF = b"%PDF-1.4 fake"


def test_pdf_is_sent_as_a_document():
    source = PdfSource(usable=True, topic="Factoring", level="Algebra I", summary="Factor trinomials like x² − 5x + 6.")
    client = PdfClient(source)
    assert read_pdf(PDF, "just the trinomials", client) == source
    block = client.calls[0]["messages"][0]["content"][0]
    assert block["type"] == "document" and block["source"]["media_type"] == "application/pdf"
    assert "just the trinomials" in client.calls[0]["messages"][0]["content"][1]["text"]


def test_pdf_without_math_is_refused():
    client = PdfClient(PdfSource(usable=False, topic="", level="", summary=""))
    with pytest.raises(GenerationError, match="doesn't seem to have any math"):
        read_pdf(PDF, "", client)


def test_non_pdf_and_huge_files_are_refused_without_calling_claude():
    client = PdfClient(None)
    with pytest.raises(GenerationError, match="isn't a PDF"):
        read_pdf(b"hello", "", client)
    with pytest.raises(GenerationError, match="too large"):
        read_pdf(b"%PDF" + b"0" * MAX_PDF_BYTES, "", client)
    assert client.calls == []


def test_deck_prompt_includes_the_pdf_summary():
    client = FakeClient([deck(make_q([2, 3]))])
    generate_deck(DeckRequest("Factoring", 1, "Medium", "Algebra I", source="Factor trinomials like x² − 5x + 6."), client)
    assert "material the student uploaded" in client.prompts[0] and "x² − 5x + 6" in client.prompts[0]


def test_choices_only_deck_asks_for_multiple_choice():
    from generator import DeckRequest, _initial_prompt

    req = DeckRequest(topic="Quadratics", count=5, difficulty="Medium", level="Algebra 1", choices_only=True)
    assert "no 'numeric' questions" in _initial_prompt(req)
    assert "no 'numeric' questions" not in _initial_prompt(DeckRequest(topic="Quadratics", count=5, difficulty="Medium", level="Algebra 1"))


class StreamingFakeClient(FakeClient):
    """Streams each queued deck's JSON in small chunks, as the API does when the app is watching progress."""

    def __init__(self, decks, chunk=5):
        super().__init__(decks)
        self.chunk = chunk
        self.beta.messages.stream = self._stream

    def _stream(self, **kw):
        self.prompts.append(kw["messages"][0]["content"])
        d = self.decks.pop(0)
        text, size = d.model_dump_json(), self.chunk

        class Stream:
            text_stream = (text[i : i + size] for i in range(0, len(text), size))

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def get_final_message(self):
                return SimpleNamespace(stop_reason="end_turn", parsed_output=d)

        return Stream()


def test_progress_counts_questions_as_they_are_written():
    from generator import Progress

    seen = []
    progress = Progress(3, seen.append, every=0)
    client = StreamingFakeClient([deck(make_q([2, 3]), make_q([2, 3]), make_q([-2, -3])), deck(make_q([4], expr="x - 4 = 0"))])
    result = generate_deck(DeckRequest("Quadratics", 3, "Medium", "Algebra II", progress=progress), client)
    assert len(result.deck.questions) == 3
    written = [s["written"] for s in seen if s["stage"] == "writing"]
    assert written == [1, 2, 3]  # one at a time, and the last once the reply ends
    assert [s["stage"] for s in seen if s["stage"] != "writing"] == ["checking", "checking", "fixing", "fixing"]
    assert progress.snapshot() == {"total": 3, "written": 3, "checked": 3, "stage": "fixing"}
    assert not client.decks  # the repair was asked too (without streaming)


def test_progress_never_passes_the_total():
    from generator import Progress

    progress = Progress(2)
    extra = deck(make_q([2, 3]), make_q([2, 3]), make_q([2, 3]))
    generate_deck(DeckRequest("Quadratics", 2, "Medium", "Algebra II", progress=progress), StreamingFakeClient([extra], chunk=1))
    assert progress.written == 2 and progress.checked == 2

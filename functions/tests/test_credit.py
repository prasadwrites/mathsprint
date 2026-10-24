import threading
from types import SimpleNamespace

import pytest

import credit


def test_cost_from_usage_at_opus_5_5_prices():
    usage = SimpleNamespace(input_tokens=1_000_000, output_tokens=100_000, cache_read_input_tokens=None, cache_creation_input_tokens=None)
    assert credit.cost_usd("claude-opus-5-5", usage) == pytest.approx(4.0 + 2.0)


def test_cache_tokens_and_dict_usage():
    usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 1_000_000, "cache_creation_input_tokens": 1_000_000}
    assert credit.cost_usd("claude-opus-5-5", usage) == pytest.approx(0.4 + 5.0)


def test_longest_model_name_wins_and_unknown_is_priced_high():
    usage = {"input_tokens": 1_000_000, "output_tokens": 0}
    assert credit.cost_usd("claude-opus-5-5", usage) == pytest.approx(4.0)
    assert credit.cost_usd("claude-opus-5", usage) == pytest.approx(5.0)
    assert credit.cost_usd("claude-opus-5-20260101", usage) == pytest.approx(5.0)
    assert credit.cost_usd("some-new-model", usage) == pytest.approx(10.0)
    assert credit.cost_usd("claude-opus-5-5", None) == 0


def test_meter_adds_across_threads_and_take_resets():
    meter = credit.Meter()
    response = SimpleNamespace(model="claude-haiku-5-5", usage={"input_tokens": 1_000_000, "output_tokens": 0})
    threads = [threading.Thread(target=lambda: [meter.add(response) for _ in range(100)]) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    spent, calls = meter.take()
    assert calls == 500 and spent == pytest.approx(50.0)
    assert meter.take() == (0.0, 0)


def test_summary_before_and_after_a_balance_is_entered():
    empty = credit.summary(None)
    assert empty["balanceUsd"] is None and empty["remainingUsd"] is None and empty["consoleUrl"].startswith("https://")
    s = credit.summary({"balanceUsd": 50, "spentUsd": 12.3456, "calls": 7, "setAt": 1})
    assert s["remainingUsd"] == 37.65 and s["calls"] == 7


@pytest.mark.parametrize("typed,expected", [("42.50", 42.5), ("$1,200", 1200.0), (0, 0.0), (19.999, 20.0)])
def test_parse_balance(typed, expected):
    assert credit.parse_balance(typed) == expected


@pytest.mark.parametrize("typed", ["", "abc", None, -1, 2_000_000])
def test_parse_balance_rejects(typed):
    with pytest.raises(ValueError):
        credit.parse_balance(typed)

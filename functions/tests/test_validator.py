import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from schema import Check, GeneratedQuestion, SolutionStep  # noqa: E402
from validator import UnsafeExpression, _parse, check_question, parse_number  # noqa: E402

STEP = [SolutionStep(description="Factor.", expression="(x − 2)(x − 3) = 0")]


def q(**kw):
    base = dict(
        prompt="Solve for x:", math="x² − 5x + 6 = 0", type="numeric", choices=[],
        answer_values=[2, 3], answer_choice="", answer_display="x = 2, 3", tolerance=0,
        concept="Factoring", difficulty="Medium", steps=STEP,
        check=Check(kind="solve", expression="x**2 - 5*x + 6 = 0", variable="x", domain="real"),
    )
    base.update(kw)
    return GeneratedQuestion(**base)


def test_correct_roots_pass():
    assert check_question(q()).ok


def test_wrong_roots_fail():
    r = check_question(q(answer_values=[-2, -3]))
    assert not r.ok and "does not match" in r.reason


def test_missing_root_fails():
    assert not check_question(q(answer_values=[2])).ok


def test_word_problem_domain_drops_negative_root():
    check = Check(kind="solve", expression="w*(w + 3) = 40", variable="w", domain="positive")
    assert check_question(q(answer_values=[5], check=check)).ok


def test_rounded_answer_with_tolerance():
    check = Check(kind="solve", expression="x**2 - 4*x + 1 = 0", variable="x", domain="real")
    assert check_question(q(answer_values=[3.73, 0.27], tolerance=0.01, check=check)).ok
    assert not check_question(q(answer_values=[3.73, 0.27], tolerance=0, check=check)).ok


def test_choice_question():
    check = Check(kind="evaluate", expression="2**2 - 4*1*5", variable="", domain="real")
    good = q(type="choice", choices=["−16", "24", "16", "−4"], answer_values=[-16], answer_choice="−16", check=check)
    assert check_question(good).ok
    wrong = q(type="choice", choices=["−16", "24", "16", "−4"], answer_values=[16], answer_choice="16", check=check)
    assert not check_question(wrong).ok


def test_choice_with_two_correct_options_fails():
    check = Check(kind="evaluate", expression="25", variable="", domain="real")
    dup = q(type="choice", choices=["25", "5**2", "10", "100"], answer_values=[25], answer_choice="25", check=check)
    assert not check_question(dup).ok


def test_parse_number_handles_unicode():
    assert parse_number("−16") == -16
    assert parse_number("3/2") == 1.5
    assert abs(parse_number("2√3") - 3.4641016) < 1e-6


@pytest.mark.parametrize("bad", ["__import__('os')", "x.real", "open(1)", "eval(1)", "lambda: 1"])
def test_unsafe_expressions_rejected(bad):
    with pytest.raises(UnsafeExpression):
        _parse(bad, "x")


def test_unsafe_check_fails_question():
    check = Check(kind="solve", expression="__import__('os') = 0", variable="x", domain="real")
    r = check_question(q(check=check))
    assert not r.ok and "rejected" in r.reason

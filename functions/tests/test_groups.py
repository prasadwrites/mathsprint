import pytest

import groups
from accounts import AccessDenied


def test_only_paid_plans_and_admin_use_groups():
    assert not groups.can_use_groups({"plan": "free"}, False)
    assert groups.can_use_groups({"plan": "pro"}, False)
    assert groups.can_use_groups({"plan": "promax"}, False)
    assert groups.can_use_groups({"plan": "free"}, True)
    with pytest.raises(AccessDenied, match="Pro and Pro Max"):
        groups.check_can_use_groups({"plan": "free"}, False)
    with pytest.raises(AccessDenied, match="suspended"):
        groups.check_can_use_groups({"plan": "pro", "status": "suspended"}, False)


def test_clean_group_lowercases_and_drops_repeats():
    name, emails = groups.clean_group("  8th Grade ", ["A@x.com", "a@x.com", " b@y.org ", ""])
    assert name == "8th Grade"
    assert emails == ["a@x.com", "b@y.org"]


def test_clean_group_rejects_bad_input():
    with pytest.raises(AccessDenied, match="name"):
        groups.clean_group(" ", [])
    with pytest.raises(AccessDenied, match="valid email"):
        groups.clean_group("G", ["not-an-email"])
    with pytest.raises(AccessDenied, match="up to"):
        groups.clean_group("G", [f"s{i}@x.com" for i in range(groups.MAX_MEMBERS + 1)])


def test_codes_are_readable_and_matched_loosely():
    code = groups.new_test_code()
    assert len(code) == 6 and set(code) <= set(groups._CODE_ALPHABET)
    assert groups.code_matches(f" {code.lower()} ", code)
    assert groups.code_matches(code[:3] + "-" + code[3:], code)
    assert not groups.code_matches("", code)
    assert not groups.code_matches("ZZZZZZ" if code != "ZZZZZZ" else "YYYYYY", code)


def test_grading_matches_the_app():
    numeric = {"type": "numeric", "answerValues": [2, -3], "tolerance": 0}
    assert groups.is_correct(numeric, "x = 2, -3")
    assert groups.is_correct(numeric, "−3 and 2")
    assert not groups.is_correct(numeric, "2")
    assert groups.is_correct({"type": "numeric", "answerValues": [0.5], "tolerance": 0}, "1/2")
    assert groups.is_correct({"type": "choice", "answerChoice": "B"}, "B")
    assert not groups.is_correct({"type": "choice", "answerChoice": "B"}, "A")
    assert not groups.is_correct(numeric, None)


def test_grade_and_overall():
    qs = [{"type": "choice", "answerChoice": "A"}, {"type": "numeric", "answerValues": [4], "tolerance": 0}]
    answers = groups.clean_answers({"0": "A", "1": "5", "7": "x", "bad": "y"}, len(qs))
    assert answers == {"0": "A", "1": "5"}
    g = groups.grade(qs, answers)
    assert g == {"results": {"0": True, "1": False}, "score": 1, "total": 2}
    takers = [
        {"status": "completed", "score": 1, "usedSec": 60, "results": {"0": True, "1": False}},
        {"status": "completed", "score": 2, "usedSec": 120, "results": {"0": True, "1": True}},
        {"status": "started"},
        {"status": "assigned"},
    ]
    o = groups.overall(takers, 2)
    assert o["assigned"] == 4 and o["started"] == 3 and o["completed"] == 2
    assert o["averageScore"] == 1.5 and o["averageSec"] == 90
    assert o["questionCorrect"] == [2, 1]
    assert groups.overall([], 2)["averageScore"] is None


def test_clean_times_clamps_and_fits_the_server_clock():
    assert groups.clean_times([10, "x", -5, None, float("nan")], 5, 100) == [10.0, 0.0, 0.0, 0.0, 0.0]
    assert groups.clean_times([1.26], 3, 100) == [1.3, 0.0, 0.0]
    # A browser that claims more time than the server saw is scaled down to fit.
    assert groups.clean_times([300, 100], 2, 100) == [75.0, 25.0]
    assert groups.clean_times("nope", 2, 100) == [0.0, 0.0]
    assert groups.clean_times([5, 5, 5], 2, 100) == [5.0, 5.0]


def test_clean_counts_are_small_whole_numbers():
    assert groups.clean_counts([2, "3", -1, 10**9, "x"], 6) == [2, 3, 0, 999, 0, 0]
    assert groups.clean_counts(None, 2) == [0, 0]


def test_grading_reads_roots_pi_and_points():
    import math
    assert groups.is_correct({"type": "numeric", "answerValues": [6 * math.sqrt(3)], "tolerance": 0}, "6√3")
    assert groups.is_correct({"type": "numeric", "answerValues": [4 * math.pi], "tolerance": 0}, "4pi")
    assert groups.is_correct({"type": "numeric", "answerValues": [math.sqrt(2) / 2], "tolerance": 0}, "sqrt(2)/2")
    assert groups.is_correct({"type": "numeric", "answerValues": [2 * math.sqrt(5)], "tolerance": 0}, "2 sqrt(5)")
    point = {"type": "numeric", "answerValues": [2, 5], "tolerance": 0, "pair": True}
    assert groups.is_correct(point, "(2, 5)")
    assert not groups.is_correct(point, "(5, 2)")
    assert groups.is_correct({**point, "answerValues": [3, 3]}, "(3, 3)")

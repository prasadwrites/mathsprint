import choices
import groups


def numeric(values, tolerance=0, **extra):
    return {"prompt": "Solve", "math": "", "type": "numeric", "choices": [], "answerValues": values, "answerChoice": "",
            "tolerance": tolerance, **extra}


def wrong_options(c):
    return [o for o in c["choices"] if o != c["answerChoice"]]


def test_choice_questions_are_left_alone():
    q = {"type": "choice", "choices": ["a", "b"], "answerChoice": "a", "answerValues": []}
    assert choices.to_choice(q) is q


def test_whole_number_answer_gets_whole_wrong_options():
    c = choices.to_choice(numeric([100]))
    assert c["type"] == "choice" and c["answerChoice"] == "100" and len(c["choices"]) == 4
    assert len(set(c["choices"])) == 4
    assert all("/" not in o and "." not in o for o in c["choices"])
    assert groups.is_correct(c, "100") and not any(groups.is_correct(c, o) for o in wrong_options(c))


def test_wrong_options_are_never_right():
    for values, extra in [([7 / 3], {}), ([6 * 3 ** 0.5], {}), ([2.0943951023931953], {}), ([2, -3], {}),
                          ([3.732], {"tolerance": 0.01}), ([2, 5], {"pair": True}), ([0], {})]:
        q = numeric(values, **extra)
        c = choices.to_choice(q)
        assert c is not None, values
        assert choices._reads_as(q, c["answerChoice"])
        assert not any(choices._reads_as(q, o, slack=3) for o in wrong_options(c)), (values, c["choices"])


def test_exact_answers_are_written_exactly():
    assert choices.to_choice(numeric([6 * 3 ** 0.5]))["answerChoice"] == "6√3"
    assert choices.to_choice(numeric([2 ** 0.5 / 2]))["answerChoice"] == "√2/2"
    assert choices.to_choice(numeric([2.0943951023931953]))["answerChoice"] == "2π/3"
    assert choices.to_choice(numeric([-7 / 3]))["answerChoice"] == "−7/3"
    assert choices.to_choice(numeric([2, -3]))["answerChoice"] == "−3, 2"
    assert choices.to_choice(numeric([2, 5], pair=True))["answerChoice"] == "(2, 5)"


def test_decimals_follow_the_deck():
    assert choices.to_choice(numeric([3.732], tolerance=0.01))["answerChoice"] == "3.73"
    assert choices.to_choice(numeric([0.25], answerDisplay="0.25"))["answerChoice"] == "0.25"
    assert choices.to_choice(numeric([0.25], answerDisplay="1/4"))["answerChoice"] == "1/4"


def test_same_question_same_options():
    assert choices.to_choice(numeric([42]))["choices"] == choices.to_choice(numeric([42]))["choices"]


def test_answers_that_cant_be_written_are_left_out():
    assert choices.to_choice(numeric([1.23456789])) is None
    assert choices.to_choice(numeric([])) is None
    picked, left_out = choices.all_choice([numeric([1.23456789]), numeric([5])])
    assert left_out == 1 and len(picked) == 1 and picked[0]["madeChoice"]

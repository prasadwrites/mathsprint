import challenges


def test_names_are_trimmed_and_default():
    assert challenges.clean_name("  Sam   Lee ") == "Sam Lee"
    assert challenges.clean_name("") == "A friend"
    assert challenges.clean_name(None) == "A friend"
    assert len(challenges.clean_name("x" * 100)) == challenges.MAX_NAME


def test_challenger_time_stays_inside_the_limit():
    assert challenges.challenger_time(430.4, 600) == 430
    assert challenges.challenger_time(9999, 600) == 600
    assert challenges.challenger_time(-5, 600) == 0
    assert challenges.challenger_time(812, 0) == 812
    assert challenges.challenger_time("junk", 600) == 0


def test_outcome_by_score_then_time():
    c = {"score": 16, "usedSec": 430}
    assert challenges.outcome({"score": 17, "usedSec": 900}, c) == "win"
    assert challenges.outcome({"score": 15, "usedSec": 100}, c) == "loss"
    assert challenges.outcome({"score": 16, "usedSec": 400}, c) == "win"
    assert challenges.outcome({"score": 16, "usedSec": 500}, c) == "loss"
    assert challenges.outcome({"score": 16, "usedSec": 430}, c) == "tie"


def test_brag_line():
    assert challenges.brag("Sam", 16, 20, 430, "SAT Geometry") == "I got 16/20 in 7:10 on SAT Geometry. Beat me!"
    assert challenges.brag("Sam", 5, 5, 65, "Derivatives") == "I got 5/5 in 1:05 on Derivatives. Beat me!"

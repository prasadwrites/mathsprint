import io

from PIL import Image

import cards
import leaderboards


def test_names_are_trimmed_and_required():
    assert leaderboards.clean_name("  Maya   R ") == "Maya R"
    assert leaderboards.clean_name("") == ""
    assert leaderboards.clean_name(None) == ""
    assert len(leaderboards.clean_name("x" * 100)) == leaderboards.MAX_NAME


def test_board_ranks_by_score_then_time_then_who_finished_first():
    rows = leaderboards.board([
        {"uid": "a", "name": "Ana", "score": 17, "usedSec": 400, "at": 5},
        {"uid": "b", "name": "Ben", "score": 18, "usedSec": 600, "at": 6},
        {"uid": "c", "name": "Cy", "score": 17, "usedSec": 300, "at": 7},
        {"uid": "d", "name": "Dee", "score": 17, "usedSec": 400, "at": 2},
    ])
    assert [r["name"] for r in rows] == ["Ben", "Cy", "Dee", "Ana"]
    assert set(rows[0]) == {"name", "score", "usedSec", "at"}  # no account ids on the public board


def test_board_keeps_each_accounts_best_and_skips_unclaimed():
    rows = leaderboards.board([
        {"uid": "a", "name": "Ana", "score": 12, "usedSec": 400, "at": 1},
        {"uid": "a", "name": "Ana again", "score": 15, "usedSec": 500, "at": 2},
        {"uid": None, "name": "Guest", "score": 20, "usedSec": 100, "at": 3},
    ])
    assert rows == [{"name": "Ana again", "score": 15, "usedSec": 500, "at": 2}]


def test_board_is_capped():
    rows = leaderboards.board([{"uid": str(i), "name": "P", "score": i % 20, "usedSec": i, "at": i} for i in range(500)])
    assert len(rows) == leaderboards.BOARD_SIZE


def test_rank_of():
    rows = [{"score": 18, "usedSec": 600, "at": 1}, {"score": 17, "usedSec": 300, "at": 2}]
    assert leaderboards.rank_of([], 3, 900, 9) == 1
    assert leaderboards.rank_of(rows, 19, 900, 9) == 1
    assert leaderboards.rank_of(rows, 17, 299, 9) == 2
    assert leaderboards.rank_of(rows, 17, 300, 9) == 3  # same score and time: who finished first stays ahead
    assert leaderboards.rank_of(rows, 17, 300, 2) == 2  # the row itself, once it's on the board
    assert leaderboards.rank_of(rows, 2, 50, 9) == 3


T = {"deckTitle": "SAT Geometry", "total": 20, "board": [
    {"name": "Maya", "score": 18, "usedSec": 372, "at": 1},
    {"name": "Leo", "score": 17, "usedSec": 300, "at": 2},
    {"name": "Sam", "score": 17, "usedSec": 410, "at": 3},
    {"name": "Kai", "score": 9, "usedSec": 410, "at": 4},
]}


def test_preview_copy():
    empty = {**T, "board": []}
    assert leaderboards.headline(empty) == "Be #1 on the SAT Geometry leaderboard"
    assert leaderboards.headline(T) == "Can you top this leaderboard?"
    assert leaderboards.headline({**T, "board": T["board"] * 3}) == "Think you can crack the top 10?"
    assert "Nobody's on the leaderboard yet" in leaderboards.preview_description(empty)
    assert "1. Maya 18/20 · 2. Leo 17/20 · 3. Sam 17/20" in leaderboards.preview_description(T)
    assert "Kai" not in leaderboards.preview_description(T)
    assert leaderboards.share_text(T) == "Calling all math fans: Maya leads SAT Geometry with 18/20 in 6:12. Think you can beat that?"
    assert "first spot" in leaderboards.share_text(empty)


def test_board_cards_render_at_both_sizes():
    long = {**T, "deckTitle": "AP Calculus BC: Series and Sequences", "board": [{**r, "name": "A very long player name here"} for r in T["board"] * 3]}
    for t in ({**T, "board": []}, T, long):
        for size, dims in cards.SIZES.items():
            img = Image.open(io.BytesIO(cards.render_board(t, size, "mathsprint-2b113.web.app")))
            assert img.format == "PNG" and img.size == dims


def test_sample_players_look_real_and_leave_room_at_the_top():
    import random

    samples = leaderboards.sample_players(20, 1200, random.Random(1))
    assert len(samples) == leaderboards.FILL
    assert len({s["name"] for s in samples}) == leaderboards.FILL
    for s in samples:
        assert 9 <= s["score"] <= 17 and 20 <= s["usedSec"] <= 1080 and s["sample"]
    rows = leaderboards.board([], samples)
    assert len(rows) == leaderboards.FILL and all(r["sample"] for r in rows)


def test_real_players_replace_samples_best_first_and_win_ties():
    samples = [{"id": f"sample-{i}", "name": f"S{i}", "score": 10 + i, "usedSec": 300, "at": leaderboards.SEED_AT, "sample": True} for i in range(8)]
    real = [{"uid": "a", "name": "Ana", "score": 17, "usedSec": 300, "at": 5}]
    rows = leaderboards.board(real, samples)
    assert len(rows) == 8
    assert "S7" not in [r["name"] for r in rows]  # the best sample made room
    assert rows[0]["name"] == "Ana"  # tied with S7's score and time, but real players win ties
    assert "sample" not in rows[0]
    many = [{"uid": str(i), "name": f"R{i}", "score": 1, "usedSec": 900, "at": i} for i in range(8)]
    assert not any(r.get("sample") for r in leaderboards.board(many, samples))
    assert {s["name"] for s in leaderboards.showing_samples(samples, 3)} == {"S0", "S1", "S2", "S3", "S4"}

import io
import sys
import wave
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import reel_music  # noqa: E402
import reel_video  # noqa: E402
import reels  # noqa: E402
from generator import GenerationError  # noqa: E402

SCRIPT = {
    "hook": "11:48 PM. Quiz number 23 of 30.",
    "stresses": ["Red pen is out of ink", "Coffee number four", "Seven more quizzes to grade"],
    "fixes": ["Tests grade themselves on submit", "Each student gets their own link", "Scores and time per question"],
    "punchline": "Tonight, the only thing you grade is pizza.",
    "caption": "We see you, tutors.",
    "hashtags": ["MathSprint", "MathTutor", "SATPrep"],
}


class FakeClient:
    def __init__(self, reply, stop="end_turn"):
        self.reply, self.stop, self.calls = reply, stop, []
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self._parse))

    def _parse(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(stop_reason=self.stop, parsed_output=self.reply, model="claude-opus-5-5", usage=None)


def test_themes_rotate_daily_and_another_reel_moves_on():
    day = date(2026, 10, 30)
    week = [reels.theme_for(day + timedelta(days=i))["key"] for i in range(len(reels.THEMES))]
    assert sorted(week) == sorted(t["key"] for t in reels.THEMES)  # every theme before any repeats
    assert reels.theme_for(day, 1) == reels.theme_for(day + timedelta(days=1))
    assert all(len(t["facts"]) >= 3 for t in reels.THEMES)
    assert {reels.palette_for(day + timedelta(days=i), 0, 4) for i in range(4)} == {0, 1, 2, 3}


def test_on_screen_text_drops_emoji_and_long_runs():
    assert reels.on_screen("Coffee #4 ☕️ 😵‍💫  again", 34) == "Coffee 4 again"
    long = reels.on_screen("word " * 40, 20)
    assert long.endswith("…") and len(long) <= 41


def test_tidy_keeps_three_lines_and_clean_tags():
    script = reels.ReelScript(
        hook="A hook 🎉",
        stresses=["One", "", "Two"],
        fixes=["A", "B", "C", "D"],
        punchline="",
        caption="We get it. 😅\n#tutor #math",
        hashtags=["#SAT Prep", "mathtutor", "AP-Calc", "SATPrep"],
    )
    out = reels.tidy(script)
    assert out["hook"] == "A hook"
    assert len(out["stresses"]) == 3 and out["stresses"][:2] == ["One", "Two"]
    assert out["fixes"] == ["A", "B", "C"]
    assert out["punchline"]
    assert out["caption"] == "We get it. 😅"
    assert out["hashtags"] == ["MathSprint", "MathTutor", "SATPrep", "APCalc"]


def test_full_caption_says_where_to_try_it():
    text = reels.full_caption(SCRIPT)
    assert text.startswith("We see you, tutors.")
    assert "mathsprint.org" in text and text.endswith("#MathSprint #MathTutor #SATPrep")


def test_write_script_gives_claude_only_the_themes_facts():
    theme = reels.THEMES[0]
    client = FakeClient(reels.ReelScript(**SCRIPT))
    out = reels.write_script(theme, ["Old hook", ""], client=client)
    prompt = client.calls[0]["messages"][0]["content"]
    assert theme["pain"] in prompt and all(f in prompt for f in theme["facts"])
    assert "Old hook" in prompt
    assert "testimonials" in client.calls[0]["system"]
    assert out["hook"] == SCRIPT["hook"] and len(out["fixes"]) == 3


def test_write_script_refusal_is_an_error():
    with pytest.raises(GenerationError):
        reels.write_script(reels.THEMES[0], [], client=FakeClient(None, stop="refusal"))


def test_chunks_join_back():
    data = bytes(range(256)) * 10_000
    parts = reels.chunks(data, 1_000_000)
    assert len(parts) == 3 and b"".join(parts) == data


def test_byte_ranges():
    assert reels.byte_range(None, 100) is None
    assert reels.byte_range("bytes=0-", 100) == (0, 99)
    assert reels.byte_range("bytes=0-1", 100) == (0, 1)
    assert reels.byte_range("bytes=90-500", 100) == (90, 99)
    assert reels.byte_range("bytes=-10", 100) == (90, 99)
    assert reels.byte_range("items=0-1", 100) is None
    with pytest.raises(ValueError):
        reels.byte_range("bytes=100-", 100)


def test_frames_draw_every_scene_even_with_long_text():
    script = {**SCRIPT, "hook": "Supercalifragilistic " * 6, "fixes": ["x" * 80, "A", "B"]}
    reel = reel_video.Reel(script, palette=5)
    for t in (0.0, 4.0, 9.0, 10.5, 11.5, 12.3, 15.0, 19.7, 23.9):
        img = reel.frame(t)
        assert img.size == (1080, 1920) and img.mode == "RGB"


def test_soundtrack_lasts_the_whole_reel():
    with wave.open(io.BytesIO(reel_video.soundtrack())) as w:
        assert w.getnchannels() == 2
        assert abs(w.getnframes() / w.getframerate() - reel_video.DURATION) < 0.01


def test_render_makes_an_mp4(monkeypatch):
    monkeypatch.setattr(reel_video, "DURATION", 0.5)
    monkeypatch.setattr(reel_video, "soundtrack", lambda: reel_music.soundtrack(0.5, [0.1], 0.2, [0.3], 0.4))
    data = reel_video.render(SCRIPT)
    assert data[4:8] == b"ftyp" and len(data) > 1000

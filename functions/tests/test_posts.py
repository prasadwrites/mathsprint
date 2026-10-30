import base64
import io
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cards  # noqa: E402
import figure_image  # noqa: E402
import posts  # noqa: E402

PLANE = {
    "kind": "plane", "alt": "A parabola.", "xMin": -3, "xMax": 7, "yMin": -5, "yMax": 7, "xGrid": 1, "yGrid": 1,
    "items": [
        {"type": "function", "label": "f", "dashed": False, "points": [], "paths": [{"xy": [-1, -4, 0, 1, 2, 5, 4, 1, 5, -4]}]},
        {"type": "region", "label": "", "dashed": True, "points": [], "side": "below", "paths": [{"xy": [-3, 0, 7, 2]}]},
        {"type": "line", "label": "", "dashed": True, "points": [{"x": 0, "y": 1}, {"x": 1, "y": 2}]},
        {"type": "segment", "label": "", "dashed": False, "points": [{"x": 0, "y": 0}, {"x": 3, "y": 3}]},
        {"type": "point", "label": "(2, 5)", "dashed": False, "points": [{"x": 2, "y": 5}]},
        {"type": "point", "label": "far", "dashed": False, "points": [{"x": 40, "y": 5}]},  # out of view: left off
    ],
}
GEOMETRY = {
    "kind": "geometry", "alt": "A right triangle.",
    "points": [{"name": "A", "x": 0, "y": 0, "show": True}, {"name": "B", "x": 6, "y": 0, "show": True}, {"name": "C", "x": 0, "y": 8, "show": False}],
    "items": [
        {"type": t, "of": of, "text": text, "count": n, "dashed": dashed, "shaded": shaded}
        for t, of, text, n, dashed, shaded in [
            ("polygon", ["A", "B", "C"], "", 0, False, True),
            ("circle", ["A", "B"], "", 0, True, False),
            ("right_angle", ["B", "A", "C"], "", 0, False, False),
            ("angle_mark", ["A", "B", "C"], "", 2, False, False),
            ("angle_label", ["A", "C", "B"], "37°", 0, False, False),
            ("length_label", ["A", "B"], "6", 0, False, False),
            ("ticks", ["B", "C"], "", 2, False, False),
            ("segment", ["A", "Z"], "", 0, False, False),  # names a point that isn't there: skipped
        ]
    ],
}
Q = {"prompt": "What is the maximum value of f?", "math": "f(x) = −(x − 2)² + 5", "type": "numeric", "answerValues": [5],
     "answerDisplay": "5", "answerChoice": "", "steps": [{"description": "Read the vertex.", "expression": "(2, 5)"}], "concept": "Vertex",
     "difficulty": "Medium", "check": {"kind": "evaluate"}}


def test_public_question_hides_the_answer():
    pub = posts.public_question({**Q, "figure": PLANE}, 3)
    assert pub["index"] == 3 and pub["figure"] == PLANE and pub["answerCount"] == 1
    assert not {"answerValues", "answerDisplay", "answerChoice", "steps", "check"} & set(pub)


def test_reveal_gives_the_answer_and_steps():
    assert posts.reveal(Q) == {"answer": "5", "steps": [{"description": "Read the vertex.", "expression": "(2, 5)"}]}
    assert posts.reveal({"type": "choice", "answerChoice": "B) 12", "answerDisplay": "12"})["answer"] == "B) 12"


def test_play_order_starts_with_the_posted_question():
    assert posts.play_order(5, 2) == [2, 3, 4, 0, 1]
    assert posts.play_order(3, 9) == [0, 1, 2]
    assert posts.play_order(0, 0) == []


def test_right_rate_waits_for_enough_answers():
    assert posts.right_rate({"answers": 9, "right": 9}) is None
    assert posts.right_rate({"answers": 12, "right": 5}) == 42


def test_texts():
    post = {"deckTitle": "SAT Algebra", "question": Q}
    assert posts.snippet("one two three four", 10) == "one two…"
    assert "What is the maximum value of f? f(x) = −(x − 2)² + 5" in posts.preview_description(post)
    assert posts.share_text(post).startswith("Quick SAT Algebra challenge: What is the maximum")


def _uploaded(size):
    buf = io.BytesIO()
    Image.new("RGBA", size, (30, 90, 200, 128)).save(buf, "PNG")
    return {"kind": "image", "alt": "A blue box.", "src": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), "width": size[0], "height": size[1]}


UPLOADED = _uploaded((900, 300))


def test_figures_draw():
    for fig in (PLANE, GEOMETRY, {"kind": "geometry", "points": [], "items": []}, {"kind": "plane", "items": []}, UPLOADED, _uploaded((20, 60))):
        img = figure_image.render(fig, 400, 300)
        assert img.mode == "RGB" and img.width <= 400 and img.height <= 300


def test_question_cards_render_at_both_sizes():
    long = {**Q, "prompt": "A rectangular garden is 3 meters longer than it is wide. " * 6}
    choice = {**Q, "type": "choice", "choices": ["8", "15", "16", "24"], "math": ""}
    for q in (Q, long, choice, {**Q, "figure": PLANE}, {**Q, "figure": GEOMETRY}, {**choice, "figure": GEOMETRY}, {**Q, "figure": UPLOADED}):
        for size, dims in cards.SIZES.items():
            img = Image.open(io.BytesIO(cards.render_question({"deckTitle": "SAT Algebra", "question": posts.public_question(q, 0)}, size, "mathsprint.org")))
            assert img.format == "PNG" and img.size == dims

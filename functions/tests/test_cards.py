import io

from PIL import Image

import cards

C = {"challengerName": "Alex", "deckTitle": "SAT Geometry", "score": 16, "total": 20, "usedSec": 430}


def test_headlines():
    assert cards.headline(C, None) == "Alex got 16/20. Can you beat that?"
    assert cards.headline(C, {"name": "Sam", "outcome": "win"}) == "Sam beat Alex!"
    assert cards.headline(C, {"name": "Sam", "outcome": "loss"}) == "Alex beat Sam"
    assert cards.headline(C, {"name": "Sam", "outcome": "tie"}) == "Sam and Alex tied"


def test_cards_render_at_both_sizes():
    a = {"name": "A very long friend name indeed", "score": 17, "usedSec": 512, "outcome": "win"}
    for attempt in (None, a):
        for size, dims in cards.SIZES.items():
            img = Image.open(io.BytesIO(cards.render(C, attempt, size, "mathsprint-2b113.web.app")))
            assert img.format == "PNG" and img.size == dims

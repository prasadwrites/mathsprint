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


INDEX = """<html><head><title>MathSprint</title>
<!-- og -->
<meta property="og:title" content="MathSprint" />
<!-- /og -->
</head><body><div id="root"></div></body></html>"""


def test_preview_replaces_the_site_tags_and_escapes():
    page = challenges.with_preview(INDEX, 'Al "x" <b> got 3/5', "desc & more", "https://h/c/T", "https://h/c/T/card.png")
    assert page.count("og:title") == 1
    assert 'content="Al &quot;x&quot; &lt;b&gt; got 3/5"' in page
    assert "desc &amp; more" in page
    assert '<meta property="og:image" content="https://h/c/T/card.png" />' in page
    assert "<title>Al &quot;x&quot; &lt;b&gt; got 3/5 · MathSprint</title>" in page
    assert '<div id="root"></div>' in page


def test_preview_goes_before_head_end_without_markers():
    page = challenges.with_preview("<html><head></head><body></body></html>", "T", "D", "U", "I")
    assert page.index('og:title') < page.index("</head>")


def test_public_host():
    assert challenges.public_host("mathsprint.org", "x.web.app") == "mathsprint.org"
    assert challenges.public_host("A.web.app, proxy", "x.web.app") == "a.web.app"
    assert challenges.public_host('evil"><script>', "x.web.app") == "x.web.app"
    assert challenges.public_host(None, "x.web.app") == "x.web.app"

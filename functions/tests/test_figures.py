import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from figures import figure_doc  # noqa: E402
from schema import Check, Figure, FigureItem, GeneratedQuestion, Point, SolutionStep  # noqa: E402
from validator import check_figure, check_question  # noqa: E402

STEP = [SolutionStep(description="Read the vertex.", expression="(2, 5)")]


def item(type, expr="", points=(), label="", side="", dashed=False):
    return FigureItem(type=type, expr=expr, points=[Point(x=x, y=y) for x, y in points], label=label, side=side, dashed=dashed)


def plane(*items, **kw):
    base = dict(kind="plane", alt="A downward parabola.", x_min=-3, x_max=7, y_min=-5, y_max=7, x_grid=1, y_grid=1, items=list(items))
    base.update(kw)
    return Figure(**base)


PARABOLA = item("function", "-(x-2)**2 + 5", label="f")


def q(figure, check, answer_values=(5,), **kw):
    base = dict(
        prompt="What is the maximum value of f?", math="", type="numeric", choices=[],
        answer_values=list(answer_values), answer_choice="", answer_display="5", tolerance=0,
        concept="Vertex", difficulty="Medium", steps=STEP, check=check, figure=figure,
    )
    base.update(kw)
    return GeneratedQuestion(**base)


def test_answer_is_computed_from_the_drawn_graph():
    assert check_question(q(plane(PARABOLA), Check(kind="evaluate", expression="f(2)", variable="", domain="real"))).ok


def test_answer_that_disagrees_with_the_graph_fails():
    r = check_question(q(plane(PARABOLA), Check(kind="evaluate", expression="f(3)", variable="", domain="real")))
    assert not r.ok and "does not match" in r.reason


def test_zeros_and_intersections_use_the_figure():
    line = item("function", "x + 1", label="g")
    check = Check(kind="solve", expression="f(x) = g(x)", variable="x", domain="real")
    r = check_question(q(plane(PARABOLA, line), check, answer_values=(0, 3), answer_display="x = 0, 3"))
    assert r.ok, r.reason


def test_vertex_by_derivative():
    check = Check(kind="solve", expression="diff(f(x), x) = 0", variable="x", domain="real")
    assert check_question(q(plane(PARABOLA), check, answer_values=(2,))).ok


def test_unknown_function_name_is_rejected():
    r = check_question(q(plane(PARABOLA), Check(kind="evaluate", expression="g(2)", variable="", domain="real")))
    assert not r.ok


def test_good_figure_passes():
    assert check_figure(plane(PARABOLA, item("point", points=[(2, 5)], label="V"))) == ""


def test_point_off_the_grid_fails():
    assert "not on the grid" in check_figure(plane(PARABOLA, item("point", points=[(2.3, 5)])))


def test_half_steps_are_on_the_grid():
    assert check_figure(plane(PARABOLA, item("point", points=[(2.5, 4.5)]))) == ""


def test_point_outside_the_view_fails():
    assert "outside" in check_figure(plane(PARABOLA, item("point", points=[(9, 0)])))


def test_coordinate_label_must_match_the_point():
    assert "drawn at" in check_figure(plane(PARABOLA, item("point", points=[(2, 5)], label="(2, 4)")))
    assert check_figure(plane(PARABOLA, item("point", points=[(2, 5)], label="(2, 5)"))) == ""


def test_graph_outside_the_view_fails():
    assert "outside" in check_figure(plane(item("function", "x + 50", label="f")))


def test_too_many_grid_lines_fails():
    assert "grid" in check_figure(plane(PARABOLA, x_grid=0.1))


def test_axes_can_have_different_steps():
    growth = item("function", "5*2**x", label="p")
    assert check_figure(plane(growth, x_min=-1, x_max=8, y_min=-20, y_max=140, y_grid=20)) == ""
    assert "on the grid" in check_figure(plane(growth, item("point", points=[(1, 15)]), x_min=-1, x_max=8, y_min=-20, y_max=140, y_grid=20))


def test_crowded_labels_fail():
    pts = [item("point", points=[(2, 5)], label="A"), item("point", points=[(2, 5)], label="B")]
    assert "too close" in check_figure(plane(PARABOLA, *pts))


def test_line_needs_two_points_and_region_needs_a_side():
    assert "exactly 2" in check_figure(plane(item("line", points=[(0, 0)])))
    assert "side" in check_figure(plane(item("region", "2*x + 1")))
    assert check_figure(plane(item("region", "2*x + 1", side="above", dashed=True))) == ""


def test_unsafe_figure_expression_is_rejected():
    assert "could not be read" in check_figure(plane(item("function", "__import__('os')", label="f")))


def test_figure_doc_samples_graphs_and_breaks_at_asymptotes():
    doc = figure_doc(plane(item("function", "1/x", label="f"), x_min=-4, x_max=4, y_min=-4, y_max=4))
    paths = doc["items"][0]["paths"]
    assert len(paths) == 2  # one branch on each side of x = 0
    assert all(len(p["xy"]) % 2 == 0 for p in paths)
    assert doc["xMin"] == -4 and doc["items"][0]["expr"] == "1/x"


def test_figure_doc_skips_where_undefined():
    doc = figure_doc(plane(item("function", "sqrt(x)", label="f"), x_min=-4, x_max=8, y_min=-1, y_max=4))
    xs = doc["items"][0]["paths"][0]["xy"][0::2]
    assert len(doc["items"][0]["paths"]) == 1 and min(xs) >= 0


def test_questions_without_figures_are_unchanged():
    assert figure_doc(None) is None


def test_claude_sends_pictures_as_json_text_so_the_output_grammar_stays_small():
    from anthropic.lib._parse._transform import transform_schema

    from schema import GeneratedDeck

    defs = transform_schema(GeneratedDeck)["$defs"]
    assert "Figure" not in defs and "Diagram" not in defs
    assert defs["GeneratedQuestion"]["properties"]["figure"]["type"] == "string"


def test_figure_json_text_is_parsed_and_checked():
    fig = plane(PARABOLA).model_dump_json()
    parsed = GeneratedQuestion.model_validate_json(
        q(None, Check(kind="evaluate", expression="f(2)", variable="", domain="real")).model_dump_json()
        .replace('"figure":null', '"figure":' + json.dumps(fig))
    )
    assert parsed.figure == plane(PARABOLA)
    assert check_question(parsed).ok


def test_unreadable_figure_json_fails_the_check_so_it_gets_repaired():
    raw = q(None, Check(kind="evaluate", expression="5", variable="", domain="real")).model_dump()
    parsed = GeneratedQuestion.model_validate({**raw, "figure": "{not json"})
    assert parsed.figure is None
    result = check_question(parsed)
    assert not result.ok and "figure" in result.reason


def test_empty_picture_text_means_none():
    raw = q(None, Check(kind="evaluate", expression="5", variable="", domain="real")).model_dump()
    parsed = GeneratedQuestion.model_validate({**raw, "figure": "", "diagram": ""})
    assert parsed.figure is None and parsed.diagram is None and not parsed.picture_error

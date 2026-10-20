import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from figures import diagram_doc  # noqa: E402
from schema import Check, Diagram, DiagramItem, GeneratedQuestion, GeoPoint, SolutionStep  # noqa: E402
from validator import check_diagram, check_question  # noqa: E402

STEP = [SolutionStep(description="Use the Pythagorean theorem.", expression="6² + 8² = 10²")]


def pt(name, x, y, show=True):
    return GeoPoint(name=name, x=str(x), y=str(y), show=show)


def mark(type, of, text="", count=0, dashed=False, shaded=False):
    return DiagramItem(type=type, of=list(of), text=text, count=count, dashed=dashed, shaded=shaded)


def triangle(*extra, c=("C", 0, 0)):
    return Diagram(
        alt="Right triangle ABC with legs 6 and 8.",
        points=[pt("A", 0, 6), pt("B", 8, 0), pt(*c)],
        items=[mark("polygon", "ABC"), mark("right_angle", "ACB"), mark("length_label", "AC", "6"),
               mark("length_label", "BC", "8"), mark("length_label", "AB", "x"), *extra],
    )


def q(diagram, check, answer_values=(10,), **kw):
    base = dict(prompt="Find x.", math="", type="numeric", choices=[], answer_values=list(answer_values),
                answer_choice="", answer_display="10", tolerance=0, concept="Pythagorean theorem",
                difficulty="Easy", steps=STEP, check=check, diagram=diagram)
    base.update(kw)
    return GeneratedQuestion(**base)


def ev(expr):
    return Check(kind="evaluate", expression=expr, variable="", domain="real")


def test_answer_is_measured_on_the_diagram():
    assert check_question(q(triangle(), ev("dist(A, B)"))).ok


def test_wrong_answer_fails():
    assert not check_question(q(triangle(), ev("dist(A, B)"), answer_values=(12,))).ok


def test_angles_areas_and_perimeters():
    assert check_question(q(triangle(), ev("area(A, B, C)"), answer_values=(24,))).ok
    assert check_question(q(triangle(), ev("perimeter(A, B, C)"), answer_values=(24,))).ok
    assert check_question(q(triangle(), ev("angle(A, C, B)"), answer_values=(90,))).ok


def test_exact_coordinates_keep_exact_answers():
    equilateral = Diagram(alt="Equilateral triangle.", points=[pt("A", 0, 0), pt("B", 6, 0), pt("C", 3, "3*sqrt(3)")],
                          items=[mark("polygon", "ABC"), mark("ticks", "AB", count=1), mark("ticks", "BC", count=1),
                                 mark("ticks", "CA", count=1), mark("angle_label", "BAC", "60°")])
    assert check_diagram(equilateral) == ""
    r = check_question(q(equilateral, ev("area(A, B, C)"), answer_values=(9 * 3 ** 0.5,)))
    assert r.ok, r.reason


def test_label_that_disagrees_with_the_drawing_fails():
    d = triangle()
    d.items[2] = mark("length_label", "AC", "7")
    assert "labeled 7" in check_diagram(d)


def test_root_labels_are_read():
    d = Diagram(alt="Square with diagonal.", points=[pt("A", 0, 0), pt("B", 4, 0), pt("C", 4, 4), pt("D", 0, 4)],
                items=[mark("polygon", "ABCD"), mark("segment", "AC", dashed=True), mark("length_label", "AC", "4√2")])
    assert check_diagram(d) == ""


def test_false_right_angle_fails():
    assert "right angle" in check_diagram(triangle(c=("C", 1, 0)))


def test_unequal_ticks_fail():
    assert "not equal" in check_diagram(triangle(mark("ticks", "AC", count=1), mark("ticks", "BC", count=1)))


def test_angle_label_must_match():
    assert "labeled 40°" in check_diagram(triangle(mark("angle_label", "CAB", "40°")))


def test_unknown_point_and_bad_arity_fail():
    assert "unknown point" in check_diagram(triangle(mark("segment", "AZ")))
    assert "needs 2" in check_diagram(triangle(mark("segment", "ABC")))


def test_crossed_polygon_fails():
    d = Diagram(alt="Bow tie.", points=[pt("A", 0, 0), pt("B", 4, 4), pt("C", 4, 0), pt("D", 0, 4)], items=[mark("polygon", "ABCD")])
    assert "crosses" in check_diagram(d)


def test_crowded_points_fail():
    d = triangle()
    d.points.append(pt("D", "0.1", "0.1"))
    assert "too close" in check_diagram(d)


def test_unsafe_coordinates_are_rejected():
    d = triangle()
    d.points[0] = pt("A", "__import__('os')", 0)
    assert "could not be read" in check_diagram(d)


def test_circle_measures():
    d = Diagram(alt="Circle with center O through P.", points=[pt("O", 0, 0), pt("P", 3, 4)],
                items=[mark("circle", "OP"), mark("segment", "OP"), mark("length_label", "OP", "5")])
    assert check_question(q(d, ev("pi*dist(O, P)**2"), answer_values=(25 * 3.141592653589793,))).ok


def test_point_answers_are_ordered():
    d = triangle()
    check = Check(kind="point", expression="(px(A) + px(B))/2, (py(A) + py(B))/2", variable="", domain="real")
    assert check_question(q(d, check, answer_values=(4, 3), pair=True)).ok
    assert not check_question(q(d, check, answer_values=(3, 4), pair=True)).ok


def test_point_check_needs_pair_and_pair_needs_point_check():
    check = Check(kind="point", expression="4, 3", variable="", domain="real")
    assert "pair" in check_question(q(triangle(), check, answer_values=(4, 3))).reason
    assert "point answer" in check_question(q(triangle(), ev("4"), answer_values=(4, 3), pair=True)).reason


def test_diagram_doc_has_numeric_coordinates():
    doc = diagram_doc(Diagram(alt="t", points=[pt("A", 0, 0), pt("B", 6, 0), pt("C", 3, "3*sqrt(3)")], items=[mark("polygon", "ABC")]))
    assert doc["kind"] == "geometry"
    assert abs(doc["points"][2]["y"] - 5.196152) < 1e-6
    assert doc["items"][0]["of"] == ["A", "B", "C"]

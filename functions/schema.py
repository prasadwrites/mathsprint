"""Structured shape of a generated deck. Claude fills this in; SymPy checks it."""

import json
from typing import Annotated, Any, List, Literal, Optional

from pydantic import BaseModel, Field, ValidationError, WithJsonSchema, model_validator
from pydantic.json_schema import SkipJsonSchema


class SolutionStep(BaseModel):
    description: str = Field(description="One short sentence explaining what this step does and why.")
    expression: str = Field(description="The math after this step, in readable Unicode (x², √, −).")


class Check(BaseModel):
    """A machine-checkable restatement of the question, written in SymPy syntax."""

    kind: Literal["solve", "evaluate", "point"] = Field(
        description="'solve' for an equation whose real solutions are the answer; "
        "'evaluate' for an expression whose numeric value is the answer; "
        "'point' for an answer that is a point: two expressions 'x, y' giving its coordinates."
    )
    expression: str = Field(
        description="SymPy syntax using ** for powers and * for products. "
        "For 'solve', an equation such as 'x**2 - 5*x + 6 = 0'. For 'evaluate', e.g. '2**2 - 4*1*5'."
    )
    variable: str = Field(description="The single-letter variable to solve for, or '' for 'evaluate'.")
    domain: Literal["real", "positive", "nonnegative", "integer"] = Field(
        description="Restricts which real solutions count, e.g. 'positive' for a length in a word problem."
    )


class Point(BaseModel):
    x: float
    y: float


class FigureItem(BaseModel):
    """One thing drawn on a coordinate plane."""

    type: Literal["function", "region", "line", "segment", "point"] = Field(
        description="'function': the graph of y = expr. 'region': y = expr with the area above or below it shaded, "
        "for inequalities. 'line': the infinite line through two points. 'segment': the segment between two points. "
        "'point': a dot at one point."
    )
    expr: str = Field(description="For 'function' and 'region': the right-hand side of y = ..., in SymPy syntax using x. '' otherwise.")
    points: List[Point] = Field(description="'point': exactly one. 'line' and 'segment': exactly two. [] for 'function' and 'region'.")
    label: str = Field(
        description="A short name drawn beside it: a function name such as 'f' or 'g', a point name such as 'A', "
        "or a point's coordinates such as '(2, 5)'. '' for none. Never label the unknown the student must find."
    )
    side: Literal["", "above", "below"] = Field(description="For 'region': which side of the curve is shaded. '' otherwise.")
    dashed: bool = Field(description="Draw a dashed line, e.g. for a strict inequality (< or >) or an asymptote.")


class Figure(BaseModel):
    """A coordinate-plane picture. The app draws it; nothing here is free-form drawing."""

    kind: Literal["plane"]
    alt: str = Field(description="One or two sentences describing the picture for a student who cannot see it, without giving the answer away.")
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    x_grid: float = Field(description="Spacing of the vertical grid lines and x-axis numbers, usually 1; 2 or 5 for wider views.")
    y_grid: float = Field(description="Spacing of the horizontal grid lines and y-axis numbers; differs from x_grid when y values are much larger, e.g. 10 or 20 for exponential growth.")
    items: List[FigureItem] = Field(description="1 to 8 things to draw.")


class GeoPoint(BaseModel):
    name: str = Field(description="One capital letter, e.g. 'A'. Checks refer to points by these names.")
    x: str = Field(description="Exact x-coordinate in SymPy syntax, e.g. '4' or '3*sqrt(3)'.")
    y: str = Field(description="Exact y-coordinate in SymPy syntax.")
    show: bool = Field(description="Draw a dot and the point's name. False for helper points the student shouldn't see named.")


class DiagramItem(BaseModel):
    """One mark in a geometry diagram. `of` names the points it uses, in order."""

    type: Literal["polygon", "segment", "circle", "right_angle", "angle_mark", "angle_label", "length_label", "ticks"] = Field(
        description="'polygon': 3+ vertices in order. 'segment': 2 points. 'circle': [center, a point on the circle]. "
        "'right_angle': [A, B, C] puts a square corner at B. 'angle_mark': [A, B, C] draws an arc at B. "
        "'angle_label': [A, B, C] writes `text` in the angle at B. 'length_label': [A, B] writes `text` beside AB. "
        "'ticks': [A, B] draws `count` tick marks on AB; segments with the same count are equal."
    )
    of: List[str] = Field(description="Point names this item uses.")
    text: str = Field(
        description="For labels: a number the drawing must match (e.g. '8', '40°', '6√3'), or the unknown ('x', '?'). '' otherwise."
    )
    count: int = Field(description="For 'ticks' and 'angle_mark': 1 to 3 marks. 0 otherwise.")
    dashed: bool = Field(description="Draw dashed, e.g. a height or a hidden edge.")
    shaded: bool = Field(description="Fill a polygon or circle, for 'shaded region' questions.")


class Diagram(BaseModel):
    """A geometry diagram drawn to scale from exact coordinates."""

    alt: str = Field(description="One or two sentences describing the diagram for a student who cannot see it, without giving the answer away.")
    points: List[GeoPoint] = Field(description="2 to 12 named points. The app picks the scale; only shapes and ratios matter.")
    items: List[DiagramItem] = Field(description="1 to 16 marks.")


def _as_json_text(description: str) -> WithJsonSchema:
    return WithJsonSchema({"type": "string", "description": description})


# `figure` and `diagram` travel as JSON text, not nested objects: the API compiles the whole output schema into a
# grammar, and with both picture shapes inline it is too large to accept. They are parsed into Figure and Diagram
# here; one that doesn't parse is left out and named in `picture_error`, so the question fails its check and goes
# back to Claude for repair.
class GeneratedQuestion(BaseModel):

    prompt: str = Field(description="The instruction shown to the student, e.g. 'Solve for x:' or a full word problem.")
    math: str = Field(description="The expression or equation in readable Unicode, or '' for word problems.")
    type: Literal["numeric", "choice"]
    choices: List[str] = Field(description="Exactly 4 options for 'choice' questions; [] for 'numeric'.")
    answer_values: List[float] = Field(
        description="For 'numeric': every correct value (all roots). For 'choice': the numeric value of the correct option."
    )
    answer_choice: str = Field(description="For 'choice': the correct option, copied exactly from choices. '' otherwise.")
    answer_display: str = Field(description="The answer as a student would write it, e.g. 'x = 2, 3'.")
    tolerance: float = Field(description="Accepted absolute error when grading; 0 for exact answers, 0.01 for 2-dp answers.")
    concept: str = Field(description="The specific skill tested, e.g. 'Factoring' or 'Completing the square'.")
    difficulty: Literal["Easy", "Medium", "Hard"]
    steps: List[SolutionStep]
    check: Check
    figure: Annotated[Optional[Figure], _as_json_text(
        "A graph on a coordinate plane the student needs to see: a JSON object in the Figure format from the "
        "instructions, or '' for none."
    )] = None
    diagram: Annotated[Optional[Diagram], _as_json_text(
        "A geometry diagram (triangles, circles, polygons, angles) the student needs to see: a JSON object in the "
        "Diagram format from the instructions, or '' for none. Never both a figure and a diagram."
    )] = None
    pair: bool = Field(
        default=False,
        description="True when the answer is a point (x, y): answer_values is [x, y] in that order and the check kind is 'point'.",
    )
    picture_error: SkipJsonSchema[str] = Field(default="", exclude=True)

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        # Claude always writes every field: optional ones make the API's output grammar bigger.
        # The defaults above are for code and tests.
        schema = handler.resolve_ref_schema(handler(core_schema))
        schema["required"] = list(schema["properties"])
        return schema

    @model_validator(mode="before")
    @classmethod
    def _parse_pictures(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        for key, model in (("figure", Figure), ("diagram", Diagram)):
            value = data.get(key)
            if not isinstance(value, str):
                continue
            data[key] = None
            if not value.strip() or value.strip() == "null":
                continue
            try:
                data[key] = model.model_validate(json.loads(value))
            except (ValueError, ValidationError) as e:
                data["picture_error"] = f"the {key} is not valid {model.__name__} JSON: {str(e)[:300]}"
        return data


def picture_formats() -> str:
    """The Figure and Diagram JSON formats, for the instructions."""
    return (
        "Figure format (JSON Schema):\n" + json.dumps(Figure.model_json_schema()) + "\n\n"
        "Diagram format (JSON Schema):\n" + json.dumps(Diagram.model_json_schema())
    )


class GeneratedDeck(BaseModel):
    title: str = Field(description="A short deck title, e.g. 'Quadratic Equations'.")
    topics: List[str] = Field(description="2 to 5 sub-topics the deck covers.")
    questions: List[GeneratedQuestion]

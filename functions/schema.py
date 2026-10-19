"""Structured shape of a generated deck. Claude fills this in; SymPy checks it."""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SolutionStep(BaseModel):
    description: str = Field(description="One short sentence explaining what this step does and why.")
    expression: str = Field(description="The math after this step, in readable Unicode (x², √, −).")


class Check(BaseModel):
    """A machine-checkable restatement of the question, written in SymPy syntax."""

    kind: Literal["solve", "evaluate"] = Field(
        description="'solve' for an equation whose real solutions are the answer; "
        "'evaluate' for an expression whose numeric value is the answer."
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
    figure: Optional[Figure] = Field(
        default=None,
        description="A graph the student needs to see, or null for questions that are text only.",
    )


class GeneratedDeck(BaseModel):
    title: str = Field(description="A short deck title, e.g. 'Quadratic Equations'.")
    topics: List[str] = Field(description="2 to 5 sub-topics the deck covers.")
    questions: List[GeneratedQuestion]

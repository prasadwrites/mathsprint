"""Structured shape of a generated deck. Claude fills this in; SymPy checks it."""

from typing import List, Literal

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


class GeneratedDeck(BaseModel):
    title: str = Field(description="A short deck title, e.g. 'Quadratic Equations'.")
    topics: List[str] = Field(description="2 to 5 sub-topics the deck covers.")
    questions: List[GeneratedQuestion]

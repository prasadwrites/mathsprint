import type { Question } from "./types";

type SampleQuestion = Omit<Question, "id" | "order" | "verified">;

const step = (description: string, expression: string) => ({ description, expression });
const num = (prompt: string, math: string, answerValues: number[], answerDisplay: string, concept: string, steps: ReturnType<typeof step>[], tolerance = 0): SampleQuestion => ({
  prompt, math, type: "numeric", choices: [], answerValues, answerChoice: "", answerDisplay, tolerance, concept, difficulty: "Medium", steps,
});
const choice = (prompt: string, math: string, choices: string[], answerChoice: string, value: number, concept: string, steps: ReturnType<typeof step>[]): SampleQuestion => ({
  prompt, math, type: "choice", choices, answerValues: [value], answerChoice, answerDisplay: answerChoice, tolerance: 0, concept, difficulty: "Medium", steps,
});

/** Hand-checked deck offered to new students so they can try timed practice straight away. */
export const SAMPLE_DECK = {
  title: "Quadratic Equations",
  topic: "Quadratic equations",
  level: "Algebra II",
  difficulty: "Medium" as const,
  topics: ["Factoring", "Quadratic formula", "Completing the square", "Word problems"],
  questions: [
    num("Solve for x:", "x² − 5x + 6 = 0", [2, 3], "x = 2, 3", "Factoring", [
      step("Factor the quadratic.", "(x − 2)(x − 3) = 0"),
      step("Set each factor equal to zero.", "x − 2 = 0 or x − 3 = 0"),
      step("Solve each equation.", "x = 2 or x = 3"),
    ]),
    num("Solve for x:", "2x² − 7x + 3 = 0", [3, 0.5], "x = 3, 1/2", "Factoring", [
      step("Find two numbers that multiply to 2·3 = 6 and add to −7: −6 and −1.", "2x² − 6x − x + 3 = 0"),
      step("Factor by grouping.", "(2x − 1)(x − 3) = 0"),
      step("Solve each factor.", "x = 1/2 or x = 3"),
    ]),
    num("Solve for x:", "x² − 9 = 0", [3, -3], "x = 3, −3", "Difference of squares", [
      step("Recognize a difference of squares.", "(x − 3)(x + 3) = 0"),
      step("Solve each factor.", "x = 3 or x = −3"),
    ]),
    choice("Which is the discriminant of this quadratic?", "x² + 2x + 5", ["−16", "24", "16", "−4"], "−16", -16, "Discriminant", [
      step("The discriminant is b² − 4ac with a = 1, b = 2, c = 5.", "2² − 4·1·5"),
      step("Evaluate.", "4 − 20 = −16"),
      step("A negative discriminant means there are no real roots.", "Δ < 0"),
    ]),
    num("Solve for x:", "x² + 4x + 4 = 0", [-2], "x = −2", "Perfect squares", [
      step("Recognize a perfect square trinomial.", "(x + 2)² = 0"),
      step("Take the square root of both sides.", "x + 2 = 0"),
      step("Solve.", "x = −2 (a repeated root)"),
    ]),
    num("A rectangle is 3 cm longer than it is wide, and its area is 40 cm². How wide is it, in cm?", "", [5], "5 cm", "Word problems", [
      step("Let the width be w, so the length is w + 3.", "w(w + 3) = 40"),
      step("Rearrange into standard form.", "w² + 3w − 40 = 0"),
      step("Factor.", "(w + 8)(w − 5) = 0"),
      step("A width cannot be negative, so discard w = −8.", "w = 5"),
    ]),
    num("Solve for x:", "3x² = 12x", [0, 4], "x = 0, 4", "Factoring", [
      step("Move everything to one side. Do not divide by x, or you lose the x = 0 root.", "3x² − 12x = 0"),
      step("Factor out the common term.", "3x(x − 4) = 0"),
      step("Solve each factor.", "x = 0 or x = 4"),
    ]),
    choice("What number completes the square?", "x² + 10x + ___", ["10", "20", "25", "100"], "25", 25, "Completing the square", [
      step("Take half of the x coefficient.", "10 ÷ 2 = 5"),
      step("Square it.", "5² = 25"),
      step("Check.", "x² + 10x + 25 = (x + 5)²"),
    ]),
    num("Solve for x:", "x² + 6x = 7", [1, -7], "x = 1, −7", "Factoring", [
      step("Move 7 to the left side.", "x² + 6x − 7 = 0"),
      step("Factor.", "(x + 7)(x − 1) = 0"),
      step("Solve each factor.", "x = −7 or x = 1"),
    ]),
    num("Solve using the quadratic formula. Give answers to 2 decimal places.", "x² − 4x + 1 = 0", [3.732, 0.268], "x ≈ 3.73, 0.27", "Quadratic formula", [
      step("Use x = (−b ± √(b² − 4ac)) / 2a with a = 1, b = −4, c = 1.", "x = (4 ± √(16 − 4)) / 2"),
      step("Simplify the root.", "x = (4 ± 2√3) / 2 = 2 ± √3"),
      step("Approximate.", "x ≈ 3.73 or x ≈ 0.27"),
    ], 0.01),
  ] satisfies SampleQuestion[],
};

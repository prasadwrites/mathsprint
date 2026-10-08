import { describe, expect, it } from "vitest";
import { isCorrect, parseNumbers } from "./grading";

const quad = { type: "numeric" as const, answerValues: [2, 3], answerChoice: "", tolerance: 0 };

describe("parseNumbers", () => {
  it("reads integers, negatives, unicode minus, decimals and fractions", () => {
    expect(parseNumbers("x = 2, −3")).toEqual([2, -3]);
    expect(parseNumbers("1/2 and 3.5")).toEqual([0.5, 3.5]);
    expect(parseNumbers("x = -7 or x = 1")).toEqual([-7, 1]);
  });
});

describe("isCorrect", () => {
  it("accepts any order and formatting", () => {
    expect(isCorrect(quad, "3, 2")).toBe(true);
    expect(isCorrect(quad, "x = 2 or x = 3")).toBe(true);
  });
  it("rejects missing, extra or wrong roots", () => {
    expect(isCorrect(quad, "2")).toBe(false);
    expect(isCorrect(quad, "2, 3, 4")).toBe(false);
    expect(isCorrect(quad, "-2, -3")).toBe(false);
    expect(isCorrect(quad, "")).toBe(false);
  });
  it("treats a repeated value as one answer", () => {
    expect(isCorrect({ ...quad, answerValues: [-2] }, "-2, -2")).toBe(true);
  });
  it("accepts fractions for decimal answers", () => {
    expect(isCorrect({ ...quad, answerValues: [3, 0.5] }, "3, 1/2")).toBe(true);
  });
  it("uses the tolerance for rounded answers", () => {
    const q = { ...quad, answerValues: [3.732, 0.268], tolerance: 0.01 };
    expect(isCorrect(q, "3.73, 0.27")).toBe(true);
    expect(isCorrect(q, "3.7, 0.3")).toBe(false);
  });
  it("matches multiple choice exactly", () => {
    const q = { type: "choice" as const, answerValues: [-16], answerChoice: "−16", tolerance: 0 };
    expect(isCorrect(q, "−16")).toBe(true);
    expect(isCorrect(q, "16")).toBe(false);
  });
});

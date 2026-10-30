import { describe, expect, it } from "vitest";
import { isCorrect, parseNumbers } from "./grading";

const quad = { type: "numeric" as const, answerValues: [2, 3], answerChoice: "", tolerance: 0 };

describe("parseNumbers", () => {
  it("reads integers, negatives, unicode minus, decimals and fractions", () => {
    expect(parseNumbers("x = 2, −3")).toEqual([2, -3]);
    expect(parseNumbers("1/2 and 3.5")).toEqual([0.5, 3.5]);
    expect(parseNumbers("x = -7 or x = 1")).toEqual([-7, 1]);
  });
  it("reads square roots and π in the forms students type", () => {
    const close = (got: number[], want: number[]) => want.forEach((w, k) => expect(got[k]).toBeCloseTo(w, 9));
    close(parseNumbers("6√3"), [6 * Math.sqrt(3)]);
    close(parseNumbers("−√2/2"), [-Math.SQRT2 / 2]);
    close(parseNumbers("2 sqrt(5)"), [2 * Math.sqrt(5)]);
    close(parseNumbers("4π, 2pi/3"), [4 * Math.PI, (2 * Math.PI) / 3]);
    expect(parseNumbers("π")).toHaveLength(1);
    expect(parseNumbers("(2, -5)")).toEqual([2, -5]);
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
  it("accepts exact forms for root and π answers", () => {
    expect(isCorrect({ ...quad, answerValues: [6 * Math.sqrt(3)] }, "6√3")).toBe(true);
    expect(isCorrect({ ...quad, answerValues: [16 * Math.PI], tolerance: 0.01 }, "50.27")).toBe(true);
    expect(isCorrect({ ...quad, answerValues: [16 * Math.PI], tolerance: 0.01 }, "16π")).toBe(true);
  });
  it("grades a point's coordinates in order", () => {
    const point = { ...quad, answerValues: [2, 5], pair: true };
    expect(isCorrect(point, "(2, 5)")).toBe(true);
    expect(isCorrect(point, "2,5")).toBe(true);
    expect(isCorrect(point, "(5, 2)")).toBe(false);
    expect(isCorrect(point, "(2, 5, 1)")).toBe(false);
    expect(isCorrect({ ...point, answerValues: [3, 3] }, "(3, 3)")).toBe(true);
  });
  it("matches multiple choice exactly", () => {
    const q = { type: "choice" as const, answerValues: [-16], answerChoice: "−16", tolerance: 0 };
    expect(isCorrect(q, "−16")).toBe(true);
    expect(isCorrect(q, "16")).toBe(false);
  });
  it("counts the owner's also-accepted answers, ignoring case, spaces and a final period", () => {
    const q = { type: "numeric" as const, answerValues: [10], answerChoice: "", tolerance: 0, acceptedAnswers: ["ten", "Ten meters"] };
    for (const a of ["10", "10 m", "10 meters", "TEN", "ten meters.", "tenmeters"]) expect(isCorrect(q, a)).toBe(true);
    expect(isCorrect(q, "eleven")).toBe(false);
    expect(isCorrect(q, "12")).toBe(false);
  });
});

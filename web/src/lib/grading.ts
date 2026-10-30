import type { Question } from "./types";

/** Reads every number out of a typed answer: "x = 2, -3", "1/2", "−7", "3.73", "6√3", "√2/2", "4π", "(2, 5)". */
export function parseNumbers(input: string): number[] {
  const s = input.replace(/[−–]/g, "-").replace(/\*/g, "").replace(/sqrt\s*/gi, "√").replace(/pi/gi, "π");
  const out: number[] = [];
  const re = /(-?)(\d+(?:\.\d+)?)?(?:\s*√\s*\(?(\d+(?:\.\d+)?)\)?)?(?:\s*(π))?(?:\s*\/\s*(-?\d+(?:\.\d+)?))?/g;
  for (const [, sign, coef, root, pi, den] of s.matchAll(re)) {
    if (!coef && !root && !pi) continue;
    let value = (coef ? Number(coef) : 1) * (root ? Math.sqrt(Number(root)) : 1) * (pi ? Math.PI : 1);
    if (den !== undefined) {
      if (!Number(den)) continue;
      value /= Number(den);
    }
    out.push(sign ? -value : value);
  }
  return out;
}

/** An answer as typed, for matching the owner's "also accept" answers: case, spaces and a final period don't matter. */
export function sameAnswerText(answer: string): string {
  return answer.toLowerCase().replace(/[−–]/g, "-").replace(/\s+/g, "").replace(/\.+$/, "");
}

export function isCorrect(q: Pick<Question, "type" | "answerValues" | "answerChoice" | "tolerance" | "pair" | "acceptedAnswers">, answer: string | undefined): boolean {
  if (!answer) return false;
  if (q.type === "choice") return answer === q.answerChoice;
  const typed = sameAnswerText(answer);
  if (typed && q.acceptedAnswers?.some((a) => sameAnswerText(a) === typed)) return true;
  const tol = Math.max(q.tolerance ?? 0, 1e-6);
  if (q.pair) {
    // A point: both coordinates, in order.
    const got = parseNumbers(answer);
    return got.length === 2 && q.answerValues.length === 2 && got.every((g, k) => Math.abs(g - q.answerValues[k]) <= tol);
  }
  const got = [...new Set(parseNumbers(answer).map((n) => Math.round(n * 1e6) / 1e6))];
  if (got.length !== q.answerValues.length) return false;
  return q.answerValues.every((a) => got.some((g) => Math.abs(g - a) <= tol));
}

/** The answer box's example and help line, by what kind of answer is expected. */
export function answerHint(count: number, pair?: boolean) {
  if (pair) return { placeholder: "e.g. (2, 5)", help: "Enter the point as (x, y)." };
  const forms = "Fractions like 1/2, roots like 2√3 (or 2sqrt3) and π (or pi) are fine.";
  return count > 1
    ? { placeholder: "e.g. 2, -3", help: `Separate answers with commas. ${forms}` }
    : { placeholder: "e.g. 5", help: `Enter a number. ${forms}` };
}

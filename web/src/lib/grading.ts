import type { Question } from "./types";

/** Reads every number out of a typed answer: "x = 2, -3", "1/2", "−7", "3.73". */
export function parseNumbers(input: string): number[] {
  const s = input.replace(/[−–]/g, "-");
  const out: number[] = [];
  const re = /-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?/g;
  for (const m of s.match(re) ?? []) {
    if (m.includes("/")) {
      const [a, b] = m.split("/").map(Number);
      if (b) out.push(a / b);
    } else {
      out.push(Number(m));
    }
  }
  return out;
}

export function isCorrect(q: Pick<Question, "type" | "answerValues" | "answerChoice" | "tolerance">, answer: string | undefined): boolean {
  if (!answer) return false;
  if (q.type === "choice") return answer === q.answerChoice;
  const tol = Math.max(q.tolerance ?? 0, 1e-6);
  const got = [...new Set(parseNumbers(answer).map((n) => Math.round(n * 1e6) / 1e6))];
  if (got.length !== q.answerValues.length) return false;
  return q.answerValues.every((a) => got.some((g) => Math.abs(g - a) <= tol));
}

import type { TestResults, TestTaker } from "./types";

/** Statistics for a group test, worked out from what get_test_results returns. */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const finishers = (data: TestResults) => data.takers.filter((t) => t.status === "completed");
const timed = (ts: TestTaker[]) => ts.filter((t) => Array.isArray(t.times) && t.times.length > 0);

export type Outcome = "correct" | "wrong" | "skipped";
export const outcome = (t: TestTaker, i: number): Outcome => (t.results[i] ? "correct" : (t.answers[i] ?? "").trim() ? "wrong" : "skipped");

/** Better score first; on the same score, less time first. */
const better = (a: TestTaker, b: TestTaker) => (b.score ?? 0) - (a.score ?? 0) || (a.usedSec ?? 0) - (b.usedSec ?? 0);

/** 1 is best. Members with the same score and time share a rank. */
export function rankOf(data: TestResults, t: TestTaker) {
  const done = finishers(data);
  return { rank: 1 + done.filter((o) => better(o, t) < 0).length, of: done.length };
}

/** Members in finishing order, best first. */
export const ranked = (data: TestResults) => [...finishers(data)].sort(better);

/** For each question: share of finishers who got it right, and their average seconds on it. */
export function questionStats(data: TestResults) {
  const done = finishers(data);
  const withTimes = timed(done);
  return data.questions.map((q, i) => ({
    i,
    concept: q.concept || "",
    correctPct: done.length ? done.filter((t) => t.results[i]).length / done.length : null,
    skippedPct: done.length ? done.filter((t) => outcome(t, i) === "skipped").length / done.length : null,
    avgSec: mean(withTimes.map((t) => t.times![i] ?? 0)),
  }));
}

export interface ConceptRow {
  concept: string;
  questions: number;
  /** Share right, of this member (or of everyone, for the group). */
  pct: number;
  groupPct: number | null;
}

/** Accuracy per concept for one member (or the whole group when no member is given). */
export function conceptStats(data: TestResults, t?: TestTaker): ConceptRow[] {
  const done = finishers(data);
  const by = new Map<string, number[]>();
  data.questions.forEach((q, i) => {
    const c = (q.concept || "").trim() || "Other";
    by.set(c, [...(by.get(c) ?? []), i]);
  });
  const groupPct = (idx: number[]) =>
    done.length ? done.reduce((n, o) => n + idx.filter((i) => o.results[i]).length, 0) / (done.length * idx.length) : null;
  return [...by.entries()].map(([concept, idx]) => {
    const g = groupPct(idx);
    return {
      concept,
      questions: idx.length,
      pct: t ? idx.filter((i) => t.results[i]).length / idx.length : g ?? 0,
      groupPct: g,
    };
  });
}

/** Everything the per-member page shows. */
export function memberStats(data: TestResults, t: TestTaker) {
  const N = data.questions.length;
  const done = finishers(data);
  const outcomes = data.questions.map((_, i) => outcome(t, i));
  const times = Array.isArray(t.times) && t.times.length ? t.times : null;
  const secs = (o: Outcome) => (times ? mean(outcomes.flatMap((x, i) => (x === o ? [times[i] ?? 0] : []))) : null);
  const order = times ? data.questions.map((_, i) => i).sort((a, b) => (times[a] ?? 0) - (times[b] ?? 0)) : [];
  const q = questionStats(data);
  const { rank, of } = rankOf(data, t);
  return {
    score: t.score ?? 0,
    pct: N ? (t.score ?? 0) / N : 0,
    rank,
    of,
    /** Share of the other finishers this member beat (null when they finished alone). */
    beat: of > 1 ? done.filter((o) => better(t, o) < 0).length / (of - 1) : null,
    groupAvgScore: mean(done.map((o) => o.score ?? 0)),
    groupAvgSec: mean(done.map((o) => o.usedSec ?? 0)),
    correct: outcomes.filter((o) => o === "correct").length,
    wrong: outcomes.filter((o) => o === "wrong").length,
    skipped: outcomes.filter((o) => o === "skipped").length,
    timed: !!times,
    secPerQuestion: times ? (mean(times.map((x) => x ?? 0)) ?? 0) : N ? (t.usedSec ?? 0) / N : null,
    secCorrect: secs("correct"),
    secWrong: secs("wrong"),
    fastest: times ? order[0] : null,
    slowest: times ? order[order.length - 1] : null,
    changedTotal: (t.changes ?? []).reduce((a, b) => a + b, 0),
    /** Questions answered right and faster than the group's average: their strongest. */
    quickRight: times ? q.filter(({ i, avgSec }) => t.results[i] && avgSec !== null && (times[i] ?? 0) < avgSec).length : null,
    rows: data.questions.map((_, i) => ({
      i,
      outcome: outcomes[i],
      sec: times ? times[i] ?? 0 : null,
      groupAvgSec: q[i].avgSec,
      groupCorrectPct: q[i].correctPct,
      visits: t.visits?.[i] ?? null,
      changes: t.changes?.[i] ?? null,
    })),
    concepts: conceptStats(data, t),
  };
}

/** Extra numbers for the whole group, beyond the server's overall summary. */
export function groupStats(data: TestResults) {
  const N = data.questions.length;
  const done = finishers(data);
  const scores = done.map((t) => t.score ?? 0);
  const q = questionStats(data).filter((x) => x.correctPct !== null);
  const byPct = [...q].sort((a, b) => a.correctPct! - b.correctPct!);
  // Score bands as a share of the questions.
  const bands = [
    { label: "90–100%", min: 0.9 },
    { label: "70–89%", min: 0.7 },
    { label: "50–69%", min: 0.5 },
    { label: "Under 50%", min: 0 },
  ];
  const band = (s: number) => bands.findIndex((b) => (N ? s / N : 0) >= b.min);
  return {
    median: median(scores),
    best: scores.length ? Math.max(...scores) : null,
    lowest: scores.length ? Math.min(...scores) : null,
    medianSec: median(done.map((t) => t.usedSec ?? 0)),
    late: done.filter((t) => t.late).length,
    bands: bands.map((b, k) => ({ label: b.label, count: scores.filter((s) => band(s) === k).length })),
    hardest: byPct[0] ?? null,
    easiest: byPct[byPct.length - 1] ?? null,
    timed: timed(done).length,
  };
}

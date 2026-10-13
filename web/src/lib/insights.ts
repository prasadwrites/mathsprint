import { opened } from "./timing";
import type { ConceptStat, PracticeSession } from "./types";

export type Selection = "first" | "random" | "unpractised" | "missed";

/** Questions the student opened in any finished session of this deck. */
export function practisedIds(sessions: PracticeSession[]): Set<string> {
  const seen = new Set<string>();
  for (const s of sessions) {
    s.questionIds.forEach((id, i) => {
      if (opened(s, i)) seen.add(id);
    });
  }
  return seen;
}

/** Questions answered wrongly (or skipped) in the most recent finished session of this deck. */
export function missedLastTime(sessions: PracticeSession[]): string[] {
  const last = [...sessions].sort((a, b) => b.startedAtMs - a.startedAtMs)[0];
  if (!last) return [];
  return last.questionIds.filter((_, i) => !last.results?.[i]);
}

export function selectQuestions(
  allIds: string[],
  selection: Selection,
  count: number,
  history: PracticeSession[],
  random: () => number = Math.random,
): string[] {
  let ids = allIds;
  if (selection === "unpractised") {
    const seen = practisedIds(history);
    ids = allIds.filter((id) => !seen.has(id));
  } else if (selection === "missed") {
    const missed = new Set(missedLastTime(history));
    ids = allIds.filter((id) => missed.has(id));
  } else if (selection === "random") {
    ids = allIds
      .map((id) => [random(), id] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, id]) => id);
  }
  return ids.slice(0, count);
}

export interface ConceptSummary extends ConceptStat {
  concept: string;
  accuracy: number;
}

/** Totals per concept across sessions, weakest first. Concepts need 2+ attempts to count. */
export function weakestConcepts(sessions: PracticeSession[], limit = 3): ConceptSummary[] {
  const totals = new Map<string, ConceptStat>();
  for (const s of sessions) {
    for (const [concept, st] of Object.entries(s.conceptStats ?? {})) {
      const t = totals.get(concept) ?? { attempted: 0, correct: 0, seconds: 0 };
      totals.set(concept, { attempted: t.attempted + st.attempted, correct: t.correct + st.correct, seconds: t.seconds + st.seconds });
    }
  }
  return [...totals.entries()]
    .map(([concept, t]) => ({ concept, ...t, accuracy: t.correct / t.attempted }))
    .filter((c) => c.attempted >= 2 && c.accuracy < 0.8)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted)
    .slice(0, limit);
}

/** Average seconds per question across sessions, and the average target. */
export function paceSummary(sessions: PracticeSession[]): { avg: number; target: number } | null {
  const timed = sessions.filter((s) => s.mode !== "learn" && s.usedSec);
  const q = timed.reduce((a, s) => a + s.questionIds.length, 0);
  if (!q) return null;
  return {
    avg: timed.reduce((a, s) => a + (s.usedSec ?? 0), 0) / q,
    target: timed.reduce((a, s) => a + s.timeLimitSec, 0) / q,
  };
}

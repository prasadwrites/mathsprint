import type { PracticeSession, QuestionTiming } from "./types";

/**
 * Students can move between questions in any order, so each question keeps the total time spent on it
 * across visits (spentMs). The visit in progress started at visitStartedAt. All times are ms from session start.
 */

function visitStart(s: PracticeSession): number {
  return s.visitStartedAt ?? s.timings[s.currentIndex]?.startedAt ?? 0;
}

/** Closes the current visit at atMs and opens question `to`. Returns the updated session fields. */
export function moveTo(s: PracticeSession, to: number, atMs: number): Pick<PracticeSession, "timings" | "currentIndex" | "visitStartedAt"> {
  const from = s.currentIndex;
  const timings = { ...s.timings };
  const t = timings[from] ?? { startedAt: visitStart(s) };
  timings[from] = { ...t, spentMs: spent(t) + Math.max(0, atMs - visitStart(s)), answeredAt: atMs };
  if (to !== from) timings[to] = timings[to] ?? { startedAt: atMs, spentMs: 0 };
  return { timings, currentIndex: to, visitStartedAt: atMs };
}

function spent(t: QuestionTiming): number {
  return t.spentMs ?? 0;
}

/** Seconds spent on question i, including the visit in progress. Null if it was never opened. */
export function secondsOn(s: PracticeSession, i: number, nowMs: number): number | null {
  const t = s.timings[i];
  if (!t) return null;
  // Sessions from before revisiting existed recorded one visit per question.
  if (t.spentMs == null) return Math.max(0, ((t.answeredAt ?? nowMs) - t.startedAt) / 1000);
  const live = s.status === "active" && i === s.currentIndex ? Math.max(0, nowMs - visitStart(s)) : 0;
  return (t.spentMs + live) / 1000;
}

/** Whether the student opened question i at all. */
export function opened(s: PracticeSession, i: number): boolean {
  return !!s.timings[i];
}

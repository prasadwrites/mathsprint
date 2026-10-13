import { describe, expect, it } from "vitest";
import { missedLastTime, paceSummary, practisedIds, selectQuestions, weakestConcepts } from "./insights";
import type { PracticeSession } from "./types";

const session = (over: Partial<PracticeSession>): PracticeSession => ({
  id: "s",
  ownerId: "u",
  deckId: "d",
  deckTitle: "Deck",
  mode: "practice",
  questionIds: [],
  timeLimitSec: 600,
  startedAtMs: 0,
  currentIndex: 0,
  answers: {},
  timings: {},
  status: "completed",
  ...over,
});

const ids = ["a", "b", "c", "d", "e"];

describe("question selection", () => {
  const t = { startedAt: 0, spentMs: 1000 };
  const older = session({ startedAtMs: 1, questionIds: ["a", "b"], timings: { 0: t, 1: t }, results: { 0: false, 1: true } });
  const newer = session({ startedAtMs: 2, questionIds: ["c", "d", "e"], timings: { 0: t, 1: t }, results: { 0: true, 1: false, 2: false } });

  it("counts only questions the student opened", () => {
    expect([...practisedIds([older, newer])].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("uses the most recent session for missed questions, including ones not reached", () => {
    expect(missedLastTime([older, newer])).toEqual(["d", "e"]);
  });
  it("selects by mode and respects the count", () => {
    expect(selectQuestions(ids, "first", 3, [])).toEqual(["a", "b", "c"]);
    expect(selectQuestions(ids, "unpractised", 5, [older, newer])).toEqual(["e"]);
    expect(selectQuestions(ids, "missed", 5, [older, newer])).toEqual(["d", "e"]);
    const shuffled = selectQuestions(ids, "random", 5, [], () => 0.5);
    expect([...shuffled].sort()).toEqual(ids);
  });
});

describe("weakestConcepts", () => {
  it("ranks concepts by accuracy and ignores single attempts and strong ones", () => {
    const s1 = session({ conceptStats: { Factoring: { attempted: 4, correct: 4, seconds: 200 }, "Word problems": { attempted: 2, correct: 1, seconds: 280 } } });
    const s2 = session({ conceptStats: { "Word problems": { attempted: 2, correct: 0, seconds: 300 }, Discriminant: { attempted: 1, correct: 0, seconds: 60 }, "Completing the square": { attempted: 3, correct: 2, seconds: 150 } } });
    const weak = weakestConcepts([s1, s2]);
    expect(weak.map((c) => c.concept)).toEqual(["Word problems", "Completing the square"]);
    expect(weak[0].accuracy).toBe(0.25);
  });
});

describe("paceSummary", () => {
  it("averages time per question across timed sessions only", () => {
    const a = session({ questionIds: ["a", "b"], usedSec: 100, timeLimitSec: 180 });
    const learn = session({ mode: "learn", questionIds: ["c"], usedSec: 500, timeLimitSec: 0 });
    expect(paceSummary([a, learn])).toEqual({ avg: 50, target: 90 });
    expect(paceSummary([learn])).toBeNull();
  });
});

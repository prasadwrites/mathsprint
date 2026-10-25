import { describe, expect, it } from "vitest";
import { groupStats, memberStats, questionStats, rankOf } from "./testStats";
import type { TestResults, TestTaker } from "./types";

const q = (concept: string) => ({ prompt: "p", math: "", type: "numeric", answerDisplay: "1", concept });
const taker = (email: string, results: boolean[], usedSec: number, extra: Partial<TestTaker> = {}): TestTaker => ({
  token: email,
  email,
  code: "ABC123",
  status: "completed",
  score: results.filter(Boolean).length,
  usedSec,
  late: false,
  locked: false,
  startedAt: 0,
  completedAt: 0,
  answers: Object.fromEntries(results.map((_, i) => [String(i), "1"])),
  results: Object.fromEntries(results.map((r, i) => [String(i), r])),
  ...extra,
});

const data = (takers: TestTaker[]): TestResults => ({
  test: { id: "t", deckId: "d", deckTitle: "D", groupId: "g", groupName: "G", kind: "group", questionCount: 3, timeLimitSec: 0, createdAt: 0, assigned: takers.length, completed: 0 },
  questions: [q("Linear"), q("Linear"), q("Quadratic")],
  takers,
  overall: { assigned: 0, started: 0, completed: 0, averageScore: null, averageSec: null, questionCorrect: [] },
});

describe("group test stats", () => {
  const a = taker("a", [true, true, true], 90, { times: [10, 20, 60], visits: [1, 1, 2], changes: [0, 0, 1] });
  const b = taker("b", [true, false, true], 60, { times: [20, 30, 10] });
  const c = taker("c", [true, false, true], 80, { answers: { "0": "1", "2": "1" } }); // skipped question 2, no times
  const waiting: TestTaker = { ...taker("d", [false, false, false], 0), status: "assigned", score: null };
  const all = data([a, b, c, waiting]);

  it("ranks by score, then time, and ignores members who haven't finished", () => {
    expect(rankOf(all, a)).toEqual({ rank: 1, of: 3 });
    expect(rankOf(all, b).rank).toBe(2);
    expect(rankOf(all, c).rank).toBe(3);
  });

  it("averages question time only over members whose times were recorded", () => {
    const s = questionStats(all);
    expect(s[0].avgSec).toBe(15);
    expect(s[1].correctPct).toBeCloseTo(1 / 3);
    expect(s[1].skippedPct).toBeCloseTo(1 / 3);
  });

  it("describes one member against the group", () => {
    const m = memberStats(all, a);
    expect(m.beat).toBe(1);
    expect(m.correct).toBe(3);
    expect(m.fastest).toBe(0);
    expect(m.slowest).toBe(2);
    expect(m.secPerQuestion).toBe(30);
    expect(m.changedTotal).toBe(1);
    expect(m.concepts.find((x) => x.concept === "Linear")).toMatchObject({ questions: 2, pct: 1 });
    const mc = memberStats(all, c);
    expect(mc).toMatchObject({ correct: 2, wrong: 0, skipped: 1, timed: false, fastest: null });
    expect(mc.rows[1]).toMatchObject({ outcome: "skipped", sec: null, groupAvgSec: 25 });
  });

  it("sums up the group", () => {
    const g = groupStats(all);
    expect(g).toMatchObject({ median: 2, best: 3, lowest: 2, timed: 2 });
    expect(g.bands.map((x) => x.count)).toEqual([1, 0, 2, 0]);
    expect(g.hardest?.i).toBe(1);
  });
});

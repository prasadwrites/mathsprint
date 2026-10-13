import { describe, expect, it } from "vitest";
import { moveTo, opened, secondsOn } from "./timing";
import type { PracticeSession } from "./types";

const start = (): PracticeSession => ({
  id: "s",
  ownerId: "u",
  deckId: "d",
  deckTitle: "Deck",
  mode: "practice",
  questionIds: ["a", "b", "c"],
  timeLimitSec: 300,
  startedAtMs: 0,
  currentIndex: 0,
  answers: {},
  timings: { 0: { startedAt: 0, spentMs: 0 } },
  visitStartedAt: 0,
  status: "active",
});

describe("time per question with revisits", () => {
  it("adds up time across visits to the same question", () => {
    let s = start();
    s = { ...s, ...moveTo(s, 1, 10_000) }; // 10s on Q1
    s = { ...s, ...moveTo(s, 0, 25_000) }; // 15s on Q2, back to Q1
    s = { ...s, ...moveTo(s, 2, 30_000) }; // 5s more on Q1
    expect(secondsOn(s, 0, 40_000)).toBe(15);
    expect(secondsOn(s, 1, 40_000)).toBe(15);
    expect(secondsOn(s, 2, 40_000)).toBe(10); // live visit
    expect(s.currentIndex).toBe(2);
  });

  it("can jump ahead, leaving skipped questions unopened", () => {
    let s = start();
    s = { ...s, ...moveTo(s, 2, 5_000) };
    expect(opened(s, 1)).toBe(false);
    expect(secondsOn(s, 1, 9_000)).toBeNull();
    expect(secondsOn(s, 2, 9_000)).toBe(4);
  });

  it("stops the clock on a finished session", () => {
    let s = start();
    s = { ...s, ...moveTo(s, 0, 12_000), status: "completed" };
    expect(secondsOn(s, 0, 99_000)).toBe(12);
  });

  it("still reads sessions recorded before revisiting existed", () => {
    const old = { ...start(), status: "completed" as const, visitStartedAt: undefined, timings: { 0: { startedAt: 0, answeredAt: 8_000 }, 1: { startedAt: 8_000, answeredAt: 20_000 } } };
    expect(secondsOn(old, 0, 0)).toBe(8);
    expect(secondsOn(old, 1, 0)).toBe(12);
  });
});

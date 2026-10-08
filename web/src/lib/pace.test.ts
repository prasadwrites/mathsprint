import { describe, expect, it } from "vitest";
import { formatClock, pace, pressureTint, stage, verdict } from "./pace";

describe("pressureTint", () => {
  it("is clear at the start and strongest at the end", () => {
    expect(pressureTint(1).alpha).toBe(0);
    expect(pressureTint(0).alpha).toBeCloseTo(0.24);
  });
  it("only ever gets stronger as time runs out", () => {
    let last = -1;
    for (let r = 1; r >= 0; r -= 0.01) {
      const a = pressureTint(r).alpha;
      expect(a).toBeGreaterThanOrEqual(last - 1e-9);
      last = a;
    }
  });
  it("warms from blue to yellow by the halfway mark", () => {
    expect(pressureTint(0.5).hue).toBe(42);
  });
});

describe("stage", () => {
  it("follows the plan's bands", () => {
    expect(stage(0.9).label).toBe("Plenty of time");
    expect(stage(0.6).label).toBe("Over half left");
    expect(stage(0.3).tone).toBe("warn");
    expect(stage(0.05).tone).toBe("bad");
  });
});

describe("pace", () => {
  // The design plan's example: 10 questions in 20 minutes, 10 minutes in.
  it("expects question 5 halfway through", () => {
    expect(pace(600, 1200, 10, 5).expected).toBe(5);
  });
  it("flags being two questions behind", () => {
    const p = pace(600, 1200, 10, 3);
    expect(p.tone).toBe("bad");
    expect(p.label).toBe("Behind pace");
  });
  it("calls one question behind slightly behind", () => {
    expect(pace(600, 1200, 10, 4).label).toBe("Slightly behind");
  });
  it("recognises being ahead", () => {
    expect(pace(600, 1200, 10, 7).label).toBe("Ahead of pace");
  });
  it("does not nag in the first half-question of time", () => {
    expect(pace(30, 1200, 10, 0).label).toBe("Warming up");
  });
});

describe("verdict", () => {
  const base = { answered: 10, questions: 10, totalSec: 900, slowCount: 0 };
  it("praises fast, accurate work", () => {
    expect(verdict({ ...base, endReason: "finished", accuracy: 0.8, usedSec: 768, avgSec: 77 }).tone).toBe("good");
  });
  it("flags running out of time", () => {
    const v = verdict({ ...base, answered: 7, endReason: "timeout", accuracy: 0.6, usedSec: 900, avgSec: 128 });
    expect(v.detail).toContain("7 of 10");
  });
  it("separates good accuracy from slow pace", () => {
    const v = verdict({ ...base, slowCount: 3, endReason: "finished", accuracy: 0.9, usedSec: 890, avgSec: 99 });
    expect(v.title).toBe("Good accuracy, but pace can improve");
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(522)).toBe("8:42");
    expect(formatClock(-3)).toBe("0:00");
  });
});

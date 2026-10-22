import { describe, expect, it } from "vitest";
import { parseSampleLines, sampleLines } from "./samplePlayers";

describe("parseSampleLines", () => {
  it("reads name, score and an optional time", () => {
    expect(parseSampleLines("आरव शर्मा, 18, 6:12\n\n  佐藤 ハルト,15 \nZoë")).toEqual([
      { name: "आरव शर्मा", score: "18", time: "6:12" },
      { name: "佐藤 ハルト", score: "15", time: "" },
      { name: "Zoë", score: "", time: "" },
    ]);
  });
  it("keeps commas in names and reads spreadsheet tabs", () => {
    expect(parseSampleLines("Lee, Min-jun, 14, 7:00")).toEqual([{ name: "Lee, Min-jun", score: "14", time: "7:00" }]);
    expect(parseSampleLines("Ana, B\t12\t300")).toEqual([{ name: "Ana, B", score: "12", time: "300" }]);
  });
  it("round-trips the saved list", () => {
    expect(parseSampleLines(sampleLines([{ name: "Maya", score: 18, usedSec: 372 }]))).toEqual([{ name: "Maya", score: "18", time: "6:12" }]);
  });
});

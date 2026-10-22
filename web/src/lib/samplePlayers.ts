import { formatClock } from "./pace";

/** A sample player the admin types for a public link: one per line as "name, score, time" (time optional). */
export interface SampleRow {
  name: string;
  score: string;
  time: string;
}

/** Lines pasted from a spreadsheet (tabs) or typed with commas. The name can hold commas: score and time come last. */
export function parseSampleLines(text: string): SampleRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(line.includes("\t") ? "\t" : ",").map((p) => p.trim());
      const looksLikeTime = (p: string) => /^\d+(:\d{1,2})?$/.test(p);
      if (parts.length >= 3 && looksLikeTime(parts[parts.length - 1]) && looksLikeTime(parts[parts.length - 2])) {
        return { name: parts.slice(0, -2).join(", "), score: parts[parts.length - 2], time: parts[parts.length - 1] };
      }
      if (parts.length >= 2) return { name: parts.slice(0, -1).join(", "), score: parts[parts.length - 1], time: "" };
      return { name: parts[0], score: "", time: "" };
    });
}

export const sampleLines = (rows: { name: string; score: number; usedSec: number }[]) =>
  rows.map((r) => `${r.name}, ${r.score}, ${formatClock(r.usedSec)}`).join("\n");

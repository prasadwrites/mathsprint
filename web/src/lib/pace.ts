/**
 * The visual pressure gauge and pace feedback for timed practice.
 * Everything here is a pure function of elapsed time so it is easy to test.
 */

export interface Tint {
  hue: number;
  sat: number;
  alpha: number;
}

// [fraction of time remaining, hue, saturation %, overlay alpha]
// Calm blue at the start, warming through yellow and orange to a muted red. Never a solid red screen.
const STOPS: [number, number, number, number][] = [
  [1.0, 215, 40, 0.0],
  [0.75, 205, 55, 0.05],
  [0.5, 42, 90, 0.09],
  [0.25, 24, 92, 0.14],
  [0.1, 6, 85, 0.19],
  [0.0, 0, 85, 0.24],
];

export function pressureTint(remaining: number): Tint {
  const r = Math.min(1, Math.max(0, remaining));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [r0, h0, s0, a0] = STOPS[i];
    const [r1, h1, s1, a1] = STOPS[i + 1];
    if (r <= r0 && r >= r1) {
      const t = (r0 - r) / (r0 - r1);
      return { hue: h0 + (h1 - h0) * t, sat: s0 + (s1 - s0) * t, alpha: a0 + (a1 - a0) * t };
    }
  }
  return { hue: 0, sat: 85, alpha: 0.24 };
}

export function pressureBackground(remaining: number): string {
  const { hue, sat, alpha } = pressureTint(remaining);
  const c = (a: number) => `hsla(${hue.toFixed(0)}, ${sat.toFixed(0)}%, 50%, ${a.toFixed(3)})`;
  // A light wash in the centre and a stronger glow at the edges keeps the question readable.
  return `radial-gradient(ellipse at center, ${c(alpha * 0.35)} 35%, ${c(alpha * 1.4)} 100%)`;
}

export type Tone = "neutral" | "good" | "warn" | "bad";

export function stage(remaining: number): { label: string; tone: Tone } {
  if (remaining > 0.75) return { label: "Plenty of time", tone: "neutral" };
  if (remaining > 0.5) return { label: "Over half left", tone: "neutral" };
  if (remaining > 0.25) return { label: "Under half left", tone: "warn" };
  if (remaining > 0.1) return { label: "Final quarter", tone: "warn" };
  return { label: "Last minutes", tone: "bad" };
}

export interface Pace {
  expected: number; // questions you should have finished by now
  done: number;
  diff: number; // done - expected; positive means ahead
  tone: Tone;
  label: string;
  message: string;
}

/** Expected question = elapsed / total × questions, compared with questions finished. */
export function pace(elapsedSec: number, totalSec: number, questions: number, done: number): Pace {
  const expected = Math.min(questions, (elapsedSec / totalSec) * questions);
  const diff = done - expected;
  const perQ = totalSec / questions;
  const base = { expected, done, diff };
  if (done === 0 && elapsedSec < perQ * 0.5) {
    return { ...base, tone: "neutral", label: "Warming up", message: `Aim for about ${formatClock(perQ)} per question.` };
  }
  if (diff >= 0.5) {
    const ahead = diff >= 1.5 ? `${Math.floor(diff)} questions` : "a little";
    return { ...base, tone: "good", label: "Ahead of pace", message: `You're ${ahead} ahead of your target. Keep it steady.` };
  }
  if (diff > -0.75) return { ...base, tone: "good", label: "On pace", message: "Right where you should be." };
  if (diff > -1.75) {
    return { ...base, tone: "warn", label: "Slightly behind", message: "You're moving a little slower than your target pace." };
  }
  return {
    ...base,
    tone: "bad",
    label: "Behind pace",
    message: `About ${Math.round(-diff)} questions behind. Consider moving on and coming back if time allows.`,
  };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface Verdict {
  tone: Tone;
  title: string;
  detail: string;
}

/** Timing feedback for the results screen. */
export function verdict(opts: {
  endReason: "finished" | "timeout" | "quit";
  answered: number;
  questions: number;
  accuracy: number; // 0..1
  usedSec: number;
  totalSec: number;
  avgSec: number;
  slowCount: number;
}): Verdict {
  const target = opts.totalSec / opts.questions;
  if (opts.endReason === "timeout") {
    return {
      tone: "bad",
      title: "Time management needs attention",
      detail: `You answered ${opts.answered} of ${opts.questions} questions before time expired. Try moving on sooner from questions that stall you.`,
    };
  }
  if (opts.accuracy >= 0.7 && opts.avgSec <= target) {
    return {
      tone: "good",
      title: "Excellent pace",
      detail: `You finished ${formatClock(opts.totalSec - opts.usedSec)} before the time limit, averaging ${formatClock(opts.avgSec)} against a ${formatClock(target)} target.`,
    };
  }
  if (opts.accuracy >= 0.7) {
    return {
      tone: "warn",
      title: "Good accuracy, but pace can improve",
      detail: opts.slowCount
        ? `Your accuracy was strong, but you spent well over the target time on ${opts.slowCount} question${opts.slowCount > 1 ? "s" : ""}.`
        : `Your accuracy was strong. Your average of ${formatClock(opts.avgSec)} was a little over the ${formatClock(target)} target.`,
    };
  }
  return {
    tone: "warn",
    title: "Accuracy first",
    detail: `You scored ${Math.round(opts.accuracy * 100)}%. Review the solutions below, then try again with the same time.`,
  };
}

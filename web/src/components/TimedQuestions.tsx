import { useCallback, useEffect, useRef, useState } from "react";
import Figure from "./Figure";
import { Icon } from "./TopBar";
import { answerHint } from "../lib/grading";
import { formatClock } from "../lib/pace";
import type { OpenTest } from "../lib/types";

/** Per question: seconds on screen, times opened, and times an answer was changed after it was first given. */
export type Track = { times: number[]; visits: number[]; changes: number[] };
export type Saved = { code?: string; attempt?: string; answers?: Record<string, string>; track?: Track };

/** A refresh keeps the code, answers and timings under `key`, so the student lands back on their test. */
export function loadLocal(key: string): Saved {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}
export function saveLocal(key: string, value: Saved) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function newTrack(saved: Track | undefined, n: number): Track {
  const fit = (xs: unknown) => Array.from({ length: n }, (_, i) => (Array.isArray(xs) && typeof xs[i] === "number" ? xs[i] : 0));
  return { times: fit(saved?.times), visits: fit(saved?.visits), changes: fit(saved?.changes) };
}

export interface TimedTest {
  title: string;
  questions: NonNullable<OpenTest["questions"]>;
  elapsedSec?: number;
  remainingSec?: number | null;
}

/** The questions of a group test or a challenge, one at a time, with the clock. `send` grades them on the server. */
export default function TimedQuestions({ storeKey, test, send }: { storeKey: string; test: TimedTest; send: (answers: Record<string, string>, track: Track) => Promise<void> }) {
  // What the page saved before the questions opened (the access code, or the challenge attempt), kept on every save.
  const kept = useRef((({ code, attempt }: Saved) => ({ code, attempt }))(loadLocal(storeKey)));
  const questions = test.questions;
  const N = questions.length;
  const [answers, setAnswers] = useState<Record<string, string>>(() => loadLocal(storeKey).answers ?? {});
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const startedAt = useRef(Date.now() - (test.elapsedSec ?? 0) * 1000);
  const deadline = useRef(test.remainingSec == null ? null : Date.now() + test.remainingSec * 1000);
  const sent = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const track = useRef(newTrack(loadLocal(storeKey).track, N));
  const iRef = useRef(i);
  iRef.current = i;
  const entry = useRef(""); // the answer the open question had when it was opened
  const lastOpened = useRef(-1);

  const persist = useCallback(() => saveLocal(storeKey, { ...kept.current, answers: answersRef.current, track: track.current }), [storeKey]);
  /** Counts a changed answer when the student moves off a question they had already answered. */
  const noteChange = useCallback((k: number) => {
    const now = (answersRef.current[k] ?? "").trim();
    if (entry.current && now && now !== entry.current) track.current.changes[k] += 1;
    entry.current = now;
  }, []);

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setSending(true);
    setError("");
    noteChange(iRef.current);
    persist();
    try {
      await send(answersRef.current, track.current);
      try {
        localStorage.removeItem(storeKey);
      } catch {
        /* ignore */
      }
    } catch (e) {
      sent.current = false;
      setSending(false);
      setError((e as Error).message || "Your answers didn't send. Check your connection and try again.");
    }
  }, [storeKey, send, noteChange, persist]);

  useEffect(() => {
    let last = Date.now();
    let saved = last;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      // Only time the question while it's on screen; a long gap means the device slept.
      if (document.visibilityState === "visible" && !sent.current) track.current.times[iRef.current] += Math.min(n - last, 5000) / 1000;
      last = n;
      if (n - saved >= 2000) {
        saved = n;
        persist();
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [persist]);
  useEffect(() => {
    if (lastOpened.current !== i) track.current.visits[i] += 1; // not again when React re-runs the effect
    lastOpened.current = i;
    entry.current = (answersRef.current[i] ?? "").trim();
    return () => noteChange(i);
  }, [i, noteChange]);
  useEffect(() => {
    if (deadline.current !== null && now >= deadline.current) submit();
  }, [now, submit]);

  const q = questions[i];
  const answer = answers[i] ?? "";
  const done = questions.filter((_, k) => (answers[k] ?? "").trim()).length;
  const setAnswer = (value: string) => {
    const next = { ...answers, [i]: value };
    setAnswers(next);
    saveLocal(storeKey, { ...kept.current, answers: next, track: track.current });
  };
  const last = i === N - 1;
  const left = deadline.current === null ? null : Math.max(0, (deadline.current - now) / 1000);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="practice-top">
        <div className="row spread">
          <div>
            <div className="eyebrow">{test.title}</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              Question {i + 1} of {N}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className={`clock ${left === null ? "muted" : ""}`} role="timer" style={left !== null && left < 60 ? { color: "var(--bad)" } : undefined}>
              {formatClock(left ?? (now - startedAt.current) / 1000)}
            </div>
            <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
              {left === null ? "No time limit" : "Time left"}
            </div>
          </div>
        </div>
        <div className="track" aria-label={`${done} of ${N} answered`}>
          <div className="fill" style={{ width: `${(done / N) * 100}%` }} />
        </div>
      </div>

      <nav className="qpicker" aria-label="Questions">
        {questions.map((_, k) => (
          <button
            key={k}
            type="button"
            className={(answers[k] ?? "").trim() ? "answered" : ""}
            aria-current={k === i ? "step" : undefined}
            aria-label={`Question ${k + 1}${(answers[k] ?? "").trim() ? ", answered" : ""}`}
            onClick={() => setI(k)}
          >
            {k + 1}
          </button>
        ))}
      </nav>

      <div className="panel qcard">
        <div className="qtext">{q.prompt}</div>
        {q.figure && <Figure figure={q.figure} />}
        {q.math && <div className="qmath">{q.math}</div>}
        {q.type === "choice" ? (
          <div className="choices" role="group" aria-label="Choices">
            {q.choices.map((c) => (
              <button key={c} type="button" aria-pressed={answer === c} onClick={() => setAnswer(c)}>
                {c}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <label htmlFor="ans">Your answer</label>
            <div className="answer-wrap">
              <input
                id="ans"
                className="answer-input"
                type="text"
                autoComplete="off"
                autoFocus
                placeholder={answerHint(q.answerCount, q.pair).placeholder}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !last && setI(i + 1)}
              />
            </div>
            <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
              {answerHint(q.answerCount, q.pair).help}
            </p>
          </div>
        )}
        <div className="row spread">
          <span className="saved">{last && done < N ? `${N - done} unanswered` : ""}</span>
          <div className="row practice-nav">
            <button className="btn btn-big" onClick={() => setI(i - 1)} disabled={i === 0}>
              Previous
            </button>
            {last ? (
              <button className="btn btn-primary btn-big practice-next" onClick={submit} disabled={sending}>
                {sending ? "Sending…" : "Finish"} <Icon name="check" />
              </button>
            ) : (
              <button className="btn btn-primary btn-big practice-next" onClick={() => setI(i + 1)}>
                Next <Icon name="next" />
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row spread">
        <button className="btn-link" onClick={submit} disabled={sending}>
          Finish and send my answers now
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Answers are kept on this device until you finish.
        </span>
      </div>
    </div>
  );
}


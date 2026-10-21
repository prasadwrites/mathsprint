import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Figure from "../components/Figure";
import TimedQuestions, { loadLocal, saveLocal } from "../components/TimedQuestions";
import { Brand, Chip } from "../components/TopBar";
import { openTest, submitTest } from "../lib/db";
import { formatClock } from "../lib/pace";
import type { OpenTest, OwnTestResult } from "../lib/types";

const storeKey = (token: string) => `ms.test.${token}`;

function Result({ test, result }: { test: OpenTest; result: OwnTestResult }) {
  const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Your result</div>
        <h1>{test.title}</h1>
      </div>
      <div className="panel stack">
        <div className="score">
          <div className="big mono">
            {result.score}
            <span className="muted" style={{ fontSize: 32 }}>/{result.total}</span>
          </div>
          <div>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 28, fontWeight: 800 }}>{pct}%</div>
            <div className="muted">
              Time <b className="mono">{formatClock(result.usedSec)}</b>
            </div>
          </div>
        </div>
        <p className="muted">{test.from ? `${test.from} can see your result too.` : "The person who sent the test can see your result too."}</p>
      </div>
      <section className="panel">
        <h2>Review</h2>
        {result.questions.map((q, i) => (
          <div className="review-item" key={i}>
            <div className="review-head">
              <h3>Question {i + 1}</h3>
              {q.correct ? <Chip tone="good">Correct</Chip> : q.answer ? <Chip tone="miss">Incorrect</Chip> : <Chip>Skipped</Chip>}
            </div>
            <p>
              {q.prompt} <span className="mono">{q.math}</span>
            </p>
            {q.figure && <Figure figure={q.figure} small />}
            <div className="ans">
              <span className="muted">Your answer</span>
              <b>{q.answer || "–"}</b>
              <span className="muted">Correct answer</span>
              <b>{q.answerDisplay}</b>
              {q.sec != null && (
                <>
                  <span className="muted">Time</span>
                  <b>{formatClock(q.sec)}</b>
                </>
              )}
            </div>
            {q.steps.length > 0 && (
              <details>
                <summary>Worked solution</summary>
                <ol className="steps" style={{ marginTop: 8 }}>
                  {q.steps.map((s, k) => (
                    <li key={k}>
                      {s.description}
                      {s.expression && <code>{s.expression}</code>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

/** A group member's test. No sign-in: the link and the access code are all they need. */
export default function TakeTest() {
  const { token = "" } = useParams();
  const [meta, setMeta] = useState<OpenTest | null>(null);
  const [test, setTest] = useState<OpenTest | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = useCallback(
    async (given: string) => {
      setBusy(true);
      setError("");
      try {
        const t = await openTest(token, given);
        saveLocal(storeKey(token), { ...loadLocal(storeKey(token)), code: given });
        setCode(given);
        setTest(t);
      } catch (e) {
        setError((e as Error).message || "That didn't work. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [token],
  );

  useEffect(() => {
    openTest(token)
      .then((m) => {
        setMeta(m);
        const saved = loadLocal(storeKey(token)).code;
        if (saved && m.status !== "assigned") start(saved);
      })
      .catch((e) => setError((e as Error).message || "This test link doesn't work."));
  }, [token, start]);

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="stack">
        <Brand small />
        {test?.result ? (
          <Result test={test} result={test.result} />
        ) : test?.questions ? (
          <TimedQuestions
            storeKey={storeKey(token)}
            test={{ ...test, questions: test.questions }}
            send={async (answers, track) => setTest(await submitTest(token, code, answers, track))}
          />
        ) : !meta ? (
          error ? <p className="error">{error}</p> : <span className="spinner" />
        ) : (
          <>
            <div>
              <div className="eyebrow">
                Test{meta.from && ` from ${meta.from}`}
                {meta.groupName && ` · ${meta.groupName}`}
              </div>
              <h1>{meta.title}</h1>
            </div>
            <div className="kv">
              <div><span>Questions</span><b>{meta.questionCount}</b></div>
              <div><span>Time limit</span><b>{meta.timeLimitSec ? `${Math.round(meta.timeLimitSec / 60)} min` : "None"}</b></div>
              <div><span>For</span><b style={{ fontSize: 15, overflowWrap: "anywhere" }}>{meta.email}</b></div>
            </div>
            <form
              className="panel stack"
              onSubmit={(e) => {
                e.preventDefault();
                start(code.trim());
              }}
            >
              <div>
                <label htmlFor="code">Access code</label>
                <input
                  id="code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="mono"
                  placeholder="6 letters and numbers"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <p className="muted">
                {meta.status === "completed"
                  ? "You've finished this test. Enter your code to see your result."
                  : meta.status === "started"
                    ? "You've already started. Enter your code to carry on; the clock kept running."
                    : meta.timeLimitSec
                      ? "The clock starts as soon as you enter your code, and your answers send when time runs out."
                      : "Your test starts as soon as you enter your code."}
              </p>
              <button className="btn btn-primary btn-big" type="submit" disabled={busy || !code.trim()}>
                {busy ? "Opening…" : meta.status === "completed" ? "See my result" : meta.status === "started" ? "Carry on" : "Start test"}
              </button>
              {error && <p className="error">{error}</p>}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

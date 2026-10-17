import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Brand, Chip, Icon } from "../components/TopBar";
import { openTest, submitTest } from "../lib/db";
import { formatClock } from "../lib/pace";
import type { OpenTest, OwnTestResult } from "../lib/types";

/** A refresh keeps the code and answers, so the student lands back on their test. */
const storeKey = (token: string) => `ms.test.${token}`;
function loadLocal(token: string): { code?: string; answers?: Record<string, string> } {
  try {
    return JSON.parse(localStorage.getItem(storeKey(token)) || "{}");
  } catch {
    return {};
  }
}
function saveLocal(token: string, value: { code: string; answers: Record<string, string> }) {
  try {
    localStorage.setItem(storeKey(token), JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

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
            <div className="ans">
              <span className="muted">Your answer</span>
              <b>{q.answer || "–"}</b>
              <span className="muted">Correct answer</span>
              <b>{q.answerDisplay}</b>
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

function Questions({ token, code, test, onDone }: { token: string; code: string; test: OpenTest; onDone: (t: OpenTest) => void }) {
  const questions = test.questions ?? [];
  const N = questions.length;
  const [answers, setAnswers] = useState<Record<string, string>>(() => loadLocal(token).answers ?? {});
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const startedAt = useRef(Date.now() - (test.elapsedSec ?? 0) * 1000);
  const deadline = useRef(test.remainingSec == null ? null : Date.now() + test.remainingSec * 1000);
  const sent = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true;
    setSending(true);
    setError("");
    try {
      const done = await submitTest(token, code, answersRef.current);
      try {
        localStorage.removeItem(storeKey(token));
      } catch {
        /* ignore */
      }
      onDone(done);
    } catch (e) {
      sent.current = false;
      setSending(false);
      setError((e as Error).message || "Your answers didn't send. Check your connection and try again.");
    }
  }, [token, code, onDone]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (deadline.current !== null && now >= deadline.current) submit();
  }, [now, submit]);

  const q = questions[i];
  const answer = answers[i] ?? "";
  const done = questions.filter((_, k) => (answers[k] ?? "").trim()).length;
  const setAnswer = (value: string) => {
    const next = { ...answers, [i]: value };
    setAnswers(next);
    saveLocal(token, { code, answers: next });
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
                placeholder={q.answerCount > 1 ? "e.g. 2, -3" : "e.g. 5"}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !last && setI(i + 1)}
              />
            </div>
            <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
              {q.answerCount > 1 ? "Separate answers with commas. Fractions like 1/2 are fine." : "Enter a number. Fractions like 1/2 are fine."}
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
        saveLocal(token, { code: given, answers: loadLocal(token).answers ?? {} });
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
        const saved = loadLocal(token).code;
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
          <Questions token={token} code={code} test={test} onDone={setTest} />
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

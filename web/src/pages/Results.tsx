import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import TopBar, { Chip } from "../components/TopBar";
import { explainStep, getQuestions, getSession } from "../lib/db";
import { formatClock, verdict } from "../lib/pace";
import type { PracticeSession, Question } from "../lib/types";

const STYLES: [string, string][] = [
  ["simple", "Simpler"],
  ["detailed", "Smaller steps"],
  ["younger", "Like I'm in 8th grade"],
  ["another", "Another method"],
];

function Explain({ deckId, question }: { deckId: string; question: Question }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = async (style: string) => {
    setBusy(true);
    setError("");
    try {
      setText(await explainStep({ deckId, questionId: question.id, step, style }));
    } catch {
      setError("Couldn't get an explanation right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn-link" onClick={() => setOpen(true)}>
        I don't understand this
      </button>
    );
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <label htmlFor={`step-${question.id}`} style={{ margin: 0 }}>
          Which part?
        </label>
        <select
          id={`step-${question.id}`}
          style={{ width: "auto" }}
          value={step ?? ""}
          onChange={(e) => setStep(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">The whole solution</option>
          {question.steps.map((_, i) => (
            <option key={i} value={i}>
              Step {i + 1}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        {STYLES.map(([k, l]) => (
          <button key={k} disabled={busy} onClick={() => ask(k)}>
            {l}
          </button>
        ))}
        {busy && <span className="spinner" />}
      </div>
      {text && <div className="explain">{text}</div>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export default function Results() {
  const { sessionId = "" } = useParams();
  const [s, setS] = useState<PracticeSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    getSession(sessionId).then(async (sess) => {
      if (!sess) return;
      const all = await getQuestions(sess.deckId);
      const byId = new Map(all.map((q) => [q.id, q]));
      setQuestions(sess.questionIds.map((id) => byId.get(id)!).filter(Boolean));
      setS(sess);
    });
  }, [sessionId]);

  if (!s || !questions.length) return <div className="wrap"><span className="spinner" /></div>;

  const N = questions.length;
  const used = s.usedSec ?? s.timeLimitSec;
  const items = questions.map((q, i) => {
    const t = s.timings[i];
    const reached = i <= s.currentIndex;
    const time = reached && t ? Math.max(0, ((t.answeredAt ?? used * 1000) - t.startedAt) / 1000) : null;
    return { q, i, answer: s.answers[i] ?? "", ok: !!s.results?.[i], reached, time };
  });
  const answered = items.filter((x) => x.answer).length;
  const correct = items.filter((x) => x.ok).length;
  const skipped = items.filter((x) => x.reached && !x.answer).length;
  const notReached = items.filter((x) => !x.reached).length;
  const times = items.map((x) => x.time).filter((t): t is number => t !== null);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const target = s.timeLimitSec / N;
  const v = verdict({
    endReason: s.endReason ?? "finished",
    answered,
    questions: N,
    accuracy: correct / N,
    usedSec: used,
    totalSec: s.timeLimitSec,
    avgSec: avg,
    slowCount: times.filter((t) => t > target * 1.5).length,
  });
  const byConcept = new Map<string, number>();
  items.forEach((x) => x.time !== null && byConcept.set(x.q.concept, (byConcept.get(x.q.concept) ?? 0) + x.time));
  const top = [...byConcept.entries()].sort((a, b) => b[1] - a[1])[0];
  const maxT = Math.max(target * 1.6, ...times);
  const heading = s.endReason === "timeout" ? "Time's up" : s.endReason === "quit" ? "Ended early" : "Practice complete";
  const icon = { good: "🟢", warn: "🟡", bad: "🔴", neutral: "" }[v.tone];

  return (
    <div className="wrap">
      <TopBar back={{ to: "/", label: "Home" }} />
      <div className="stack">
        <div className="eyebrow">
          {s.deckTitle} · {heading}
        </div>
        <div className="panel stack">
          <div className="score">
            <div className="big mono">
              {correct}/{N}
            </div>
            <div>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 28, fontWeight: 800 }}>{Math.round((correct / N) * 100)}%</div>
              <div className="muted">
                Time used <b className="mono">{formatClock(used)}</b> of {formatClock(s.timeLimitSec)}
              </div>
            </div>
          </div>
          <div className={`verdict ${v.tone}`}>
            <h3>
              {icon} {v.title}
            </h3>
            <p>{v.detail}</p>
          </div>
          <div className="kv">
            <div><span>Correct</span><b>{correct}</b></div>
            <div><span>Incorrect</span><b>{answered - correct}</b></div>
            <div><span>Skipped</span><b>{skipped}</b></div>
            {notReached > 0 && <div><span>Not reached</span><b>{notReached}</b></div>}
            <div><span>Average per question</span><b>{formatClock(avg)}</b></div>
            <div><span>Target average</span><b>{formatClock(target)}</b></div>
            {times.length > 0 && (
              <>
                <div><span>Fastest</span><b>{formatClock(Math.min(...times))}</b></div>
                <div><span>Slowest</span><b>{formatClock(Math.max(...times))}</b></div>
              </>
            )}
          </div>
        </div>

        <div className="panel stack">
          <div className="row spread">
            <h2>Time per question</h2>
            <span className="muted" style={{ fontSize: 13 }}>Line marks the {formatClock(target)} target</span>
          </div>
          <div className="bars">
            {items.map((x) => (
              <div className="bar" key={x.i}>
                <span className="mono muted">{x.i + 1}</span>
                <div className="b">
                  {x.time !== null && <i style={{ width: `${(x.time / maxT) * 100}%`, background: `var(--${x.ok ? "good" : "bad"})` }} />}
                  <span className="t" style={{ left: `${(target / maxT) * 100}%` }} />
                </div>
                <span className="mono">{x.time !== null ? formatClock(x.time) : "–"}</span>
              </div>
            ))}
          </div>
          {top && (
            <p>
              You spent the most time on <b>{top[0]}</b> ({formatClock(top[1])} in total).
            </p>
          )}
        </div>

        <div className="row">
          <Link className="btn btn-primary" to={`/decks/${s.deckId}/practice`} style={{ textDecoration: "none" }}>
            Try again
          </Link>
          <Link className="btn" to="/" style={{ textDecoration: "none" }}>
            Back to decks
          </Link>
        </div>

        <div className="panel">
          <h2>Review test</h2>
          {items.map((x) => (
            <div className="review-item" key={x.i}>
              <div className="row spread">
                <h3>Question {x.i + 1}</h3>
                {x.ok ? (
                  <Chip tone="good">✓ Correct</Chip>
                ) : !x.reached ? (
                  <Chip>Not reached</Chip>
                ) : !x.answer ? (
                  <Chip tone="warn">Skipped</Chip>
                ) : (
                  <Chip tone="bad">✗ Incorrect</Chip>
                )}
              </div>
              <div>
                {x.q.prompt} {x.q.math && <span className="mono" style={{ fontWeight: 700 }}>{x.q.math}</span>}
              </div>
              <div className="ans">
                <span className="muted">Your answer</span>
                <b>{x.answer || "–"}</b>
                <span className="muted">Correct answer</span>
                <b>{x.q.answerDisplay}</b>
                {x.time !== null && (
                  <>
                    <span className="muted">Time</span>
                    <b>{formatClock(x.time)}</b>
                  </>
                )}
              </div>
              <details open={!x.ok}>
                <summary>Show detailed solution</summary>
                <ol className="steps" style={{ marginTop: 10 }}>
                  {x.q.steps.map((st, k) => (
                    <li key={k}>
                      {st.description}
                      <code>{st.expression}</code>
                    </li>
                  ))}
                </ol>
                <div style={{ marginTop: 10 }}>
                  <Explain deckId={s.deckId} question={x.q} />
                </div>
              </details>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

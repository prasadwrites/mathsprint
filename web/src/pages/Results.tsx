import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import TopBar, { Chip, Icon } from "../components/TopBar";
import { explainStep, getDeck, getQuestions, getSession } from "../lib/db";
import { formatClock, verdict, type Verdict } from "../lib/pace";
import { opened, secondsOn } from "../lib/timing";
import type { Deck, PracticeSession, Question } from "../lib/types";

const STYLES: [string, string][] = [
  ["simple", "Simpler"],
  ["detailed", "Smaller steps"],
  ["younger", "Like I'm in 8th grade"],
  ["another", "Another method"],
];

function Solution({ deckId, question }: { deckId: string; question: Question }) {
  const [explaining, setExplaining] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [style, setStyle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ask = async (s: string, st = step) => {
    setStyle(s);
    setBusy(true);
    setError("");
    try {
      setText(await explainStep({ deckId, questionId: question.id, step: st, style: s }));
    } catch {
      setError("Couldn't get an explanation right now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ol className="steps-box">
        {question.steps.map((st, k) => (
          <li key={k} className={explaining && step === k ? "focus" : ""}>
            {st.description}
            <code>{st.expression}</code>
          </li>
        ))}
      </ol>
      {!explaining ? (
        <div>
          <button className="btn-link" onClick={() => setExplaining(true)}>
            I don't understand this
          </button>
        </div>
      ) : (
        <div className="explain-box" aria-live="polite">
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">Which part?</span>
            <div className="pills" role="group" aria-label="Which part">
              <button aria-pressed={step === null} onClick={() => setStep(null)}>
                Whole solution
              </button>
              {question.steps.map((_, k) => (
                <button key={k} aria-pressed={step === k} onClick={() => setStep(k)}>
                  Step {k + 1}
                </button>
              ))}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">{step === null ? "Explain the solution" : `Explain step ${step + 1}`}</span>
            <div className="pills" role="group" aria-label="Explanation style">
              {STYLES.map(([k, l]) => (
                <button key={k} disabled={busy} aria-pressed={style === k} onClick={() => ask(k)}>
                  {l}
                </button>
              ))}
              {busy && <span className="spinner" />}
            </div>
          </div>
          {text && <div className="explain">{text}</div>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function Results() {
  const { sessionId = "" } = useParams();
  const [s, setS] = useState<PracticeSession | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    getSession(sessionId).then(async (sess) => {
      if (!sess) return;
      const [all, d] = await Promise.all([getQuestions(sess.deckId), getDeck(sess.deckId)]);
      const byId = new Map(all.map((q) => [q.id, q]));
      setQuestions(sess.questionIds.map((id) => byId.get(id)!).filter(Boolean));
      setDeck(d);
      setS(sess);
    });
  }, [sessionId]);

  if (!s || !questions.length) {
    return (
      <>
        <TopBar back={{ to: "/", label: "Home" }} />
        <main className="page"><span className="spinner" /></main>
      </>
    );
  }

  const N = questions.length;
  const timed = s.timeLimitSec > 0;
  const used = s.usedSec ?? s.timeLimitSec;
  const items = questions.map((q, i) => {
    const reached = opened(s, i);
    const time = secondsOn(s, i, used * 1000);
    return { q, i, answer: s.answers[i] ?? "", ok: !!s.results?.[i], reached, time };
  });
  const answered = items.filter((x) => x.answer).length;
  const correct = items.filter((x) => x.ok).length;
  const missed = N - correct;
  const skipped = items.filter((x) => x.reached && !x.answer).length;
  const notReached = items.filter((x) => !x.reached).length;
  const times = items.map((x) => x.time).filter((t): t is number => t !== null);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const target = timed ? s.timeLimitSec / N : 0;
  const v: Verdict = timed
    ? verdict({
        endReason: s.endReason ?? "finished",
        answered,
        questions: N,
        accuracy: correct / N,
        usedSec: used,
        totalSec: s.timeLimitSec,
        avgSec: avg,
        slowCount: times.filter((t) => t > target * 1.5).length,
      })
    : {
        tone: correct / N >= 0.7 ? "good" : "warn",
        title: correct / N >= 0.7 ? "Solid understanding" : "Worth another look",
        detail: `Learn mode, so no clock. You averaged ${formatClock(avg)} a question. Try Practise mode next to work on pace.`,
      };

  // Where the time went, by concept, and whether any of it was missed.
  const byConcept = new Map<string, { sec: number; n: number; wrong: number }>();
  items.forEach((x) => {
    if (x.time === null) return;
    const c = byConcept.get(x.q.concept) ?? { sec: 0, n: 0, wrong: 0 };
    byConcept.set(x.q.concept, { sec: c.sec + x.time, n: c.n + 1, wrong: c.wrong + (x.ok ? 0 : 1) });
  });
  const top = [...byConcept.entries()].sort((a, b) => b[1].sec - a[1].sec)[0];
  const weakest = [...byConcept.entries()].filter(([, c]) => c.wrong).sort((a, b) => b[1].wrong / b[1].n - a[1].wrong / a[1].n || b[1].sec - a[1].sec)[0];
  const maxT = Math.max(target * 1.6, ...times, 1);
  const heading = s.endReason === "timeout" ? "Time's up" : s.endReason === "quit" ? "Ended early" : "Practice complete";
  const toneVar = v.tone === "neutral" ? "var(--ink)" : `var(--${v.tone})`;
  const deckTopic = deck?.topic || s.deckTitle;

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page narrow">
        <div className="eyebrow">
          {s.deckTitle} · {heading}
        </div>

        <div className="panel stack">
          <div className="score">
            <div className="big mono">
              {correct}
              <span className="muted" style={{ fontSize: 32 }}>/{N}</span>
            </div>
            <div>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 28, fontWeight: 800 }}>{Math.round((correct / N) * 100)}%</div>
              <div className="muted">
                {timed ? (
                  <>
                    Time used <b className="mono">{formatClock(used)}</b> of {formatClock(s.timeLimitSec)}
                  </>
                ) : (
                  <>
                    Time spent <b className="mono">{formatClock(used)}</b>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={`verdict ${v.tone}`}>
            <h3 style={{ color: toneVar }}>{v.title}</h3>
            <p>{v.detail}</p>
          </div>
          <div className="kv">
            <div><span>Correct</span><b>{correct}</b></div>
            <div><span>Incorrect</span><b>{answered - correct}</b></div>
            {skipped > 0 && <div><span>Skipped</span><b>{skipped}</b></div>}
            {notReached > 0 && <div><span>Not reached</span><b>{notReached}</b></div>}
            <div><span>Average</span><b>{formatClock(avg)}</b></div>
            {timed && <div><span>Target</span><b>{formatClock(target)}</b></div>}
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
            <h2>Where your time went</h2>
            <div className="legend">
              <span><i style={{ background: "var(--accent)" }} /> Correct</span>
              <span><i style={{ background: "var(--miss)" }} /> Incorrect</span>
              {timed && <span><i style={{ background: "var(--ink)", width: 2, opacity: 0.6 }} /> {formatClock(target)} target</span>}
            </div>
          </div>
          <div className="tbars">
            {items.map((x) => (
              <div className="tbar" key={x.i}>
                <span className="mono muted">{x.i + 1}</span>
                <div className="b">
                  {x.time !== null && <i style={{ width: `${(x.time / maxT) * 100}%`, background: `var(--${x.ok ? "accent" : "miss"})` }} />}
                  {timed && <span className="t" style={{ left: `${(target / maxT) * 100}%` }} />}
                </div>
                <span className="mono">{x.time !== null ? formatClock(x.time) : "–"}</span>
              </div>
            ))}
          </div>
          {top && (
            <p>
              You spent the most time on <b>{top[0]}</b>: {formatClock(top[1].sec)} across {top[1].n} question{top[1].n > 1 ? "s" : ""}
              {top[1].wrong ? `, and you missed ${top[1].wrong === top[1].n ? (top[1].n > 1 ? "all of them" : "it") : top[1].wrong === 1 ? "one of them" : `${top[1].wrong} of them`}.` : "."}
            </p>
          )}
        </div>

        <div className="row">
          <Link className="btn btn-primary" to={`/decks/${s.deckId}/practice`}>
            Try again
          </Link>
          {missed > 0 && (
            <Link className="btn" to={`/decks/${s.deckId}/practice?select=missed`}>
              Retry the {missed === 1 ? "one" : missed} I missed
            </Link>
          )}
          {weakest && (
            <Link className="btn" to={`/create?topic=${encodeURIComponent(`${deckTopic}: ${weakest[0]}`)}`}>
              <Icon name="sparkle" /> More {weakest[0].toLowerCase()}
            </Link>
          )}
        </div>

        <section className="panel">
          <h2>Review test</h2>
          {items.map((x) => (
            <div className="review-item" key={x.i}>
              <div className="review-head">
                <h3>Question {x.i + 1}</h3>
                {x.ok ? (
                  <Chip tone="good">Correct{x.time !== null && ` · ${formatClock(x.time)}`}</Chip>
                ) : !x.reached ? (
                  <Chip>Not reached</Chip>
                ) : !x.answer ? (
                  <Chip tone="miss">Skipped{x.time !== null && ` · ${formatClock(x.time)}`}</Chip>
                ) : (
                  <Chip tone="miss">Incorrect{x.time !== null && ` · ${formatClock(x.time)}`}</Chip>
                )}
              </div>
              <div>
                {x.q.prompt} {x.q.math && <span className="mono" style={{ fontWeight: 700 }}>{x.q.math}</span>}
              </div>
              {!x.ok && (
                <div className="ans">
                  <span className="muted">Your answer</span>
                  <b>{x.answer || "–"}</b>
                  <span className="muted">Correct answer</span>
                  <b>{x.q.answerDisplay}</b>
                </div>
              )}
              <details open={!x.ok}>
                <summary>{x.ok ? "Show solution" : "Solution"}</summary>
                <div style={{ marginTop: 10 }}>
                  <Solution deckId={s.deckId} question={x.q} />
                </div>
              </details>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}

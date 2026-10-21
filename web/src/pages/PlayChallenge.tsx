import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Figure from "../components/Figure";
import TimedQuestions, { loadLocal, saveLocal } from "../components/TimedQuestions";
import { Brand, Chip, Icon } from "../components/TopBar";
import { challengeStoreKey, rememberClaim } from "../lib/challenge";
import { openChallenge, submitChallenge } from "../lib/db";
import { formatClock } from "../lib/pace";
import type { ChallengeResult, OpenChallenge } from "../lib/types";

const HEADLINE = {
  win: (from: string) => `You beat ${from}!`,
  loss: (from: string) => `${from} wins this one`,
  tie: () => "It's a tie",
};

function FaceOff({ c, result }: { c: OpenChallenge; result: ChallengeResult }) {
  const side = (label: string, score: number, sec: number, won: boolean) => (
    <div className={`faceoff-side ${won ? "won" : ""}`}>
      <span className="eyebrow">{label}</span>
      <div className="big mono">
        {score}
        <span className="muted" style={{ fontSize: 24 }}>/{c.total}</span>
      </div>
      <span className="muted">
        in <b className="mono">{formatClock(sec)}</b>
      </span>
      {won && <Chip tone="good">Winner</Chip>}
    </div>
  );
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Challenge · {c.title}</div>
        <h1>{HEADLINE[result.outcome](c.from)}</h1>
        {result.outcome !== "tie" && result.score === c.score && <p className="muted">Same score, so the faster time wins.</p>}
      </div>
      <div className="panel faceoff">
        {side(result.name === "A friend" ? "You" : `You (${result.name})`, result.score, result.usedSec, result.outcome === "win")}
        <span className="faceoff-vs">vs</span>
        {side(c.from, c.score, c.usedSec, result.outcome === "loss")}
      </div>

      <div className="panel stack cta-panel">
        <h2>{result.outcome === "win" ? "Save your win" : "Get your rematch"}</h2>
        <p>
          {result.outcome === "win"
            ? `Make a free MathSprint account and this win over ${c.from} is saved to it. Then build your own decks and send a challenge back.`
            : `Make a free MathSprint account to save this result, practice the questions you missed, and challenge ${c.from} back.`}
        </p>
        <div>
          <Link className="btn btn-primary btn-big" to="/">
            <Icon name="sparkle" /> {result.outcome === "win" ? "Sign up and save my win" : "Sign up free"}
          </Link>
        </div>
      </div>

      <section className="panel">
        <h2>Question by question</h2>
        {result.questions.map((q, i) => (
          <div className="review-item" key={i}>
            <div className="review-head">
              <h3>Question {i + 1}</h3>
              <div className="row" style={{ gap: 6 }}>
                {q.correct ? <Chip tone="good">You: right</Chip> : q.answer ? <Chip tone="miss">You: wrong</Chip> : <Chip>You: skipped</Chip>}
                <Chip tone={q.theirsCorrect ? "good" : "miss"}>
                  {c.from}: {q.theirsCorrect ? "right" : "wrong"}
                </Chip>
              </div>
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
                  <span className="muted">Your time</span>
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

/** A friend's challenge. No sign-in: they play the same questions and see both results at the end. */
export default function PlayChallenge() {
  const { token = "" } = useParams();
  const key = challengeStoreKey(token);
  const [c, setC] = useState<OpenChallenge | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const show = useCallback(
    (next: OpenChallenge) => {
      if (next.attempt) saveLocal(key, { ...loadLocal(key), attempt: next.attempt });
      if (next.result && next.attempt) rememberClaim({ token, attempt: next.attempt });
      setC(next);
    },
    [key, token],
  );

  useEffect(() => {
    const attempt = loadLocal(key).attempt;
    openChallenge(attempt ? { token, attempt } : { token })
      .then(show)
      .catch((e) => setError((e as Error).message || "This challenge link doesn't work."));
  }, [token, key, show]);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      show(await openChallenge({ token, start: true, name: name.trim() }));
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="stack">
        <Brand small />
        {c?.result ? (
          <FaceOff c={c} result={c.result} />
        ) : c?.questions && c.attempt ? (
          <TimedQuestions
            storeKey={key}
            test={{ ...c, questions: c.questions }}
            send={async (answers, track) => show(await submitChallenge(token, c.attempt!, answers, track.times))}
          />
        ) : !c ? (
          error ? <p className="error">{error}</p> : <span className="spinner" />
        ) : (
          <>
            <div>
              <div className="eyebrow">Challenge from {c.from}</div>
              <h1>
                {c.from} got {c.score}/{c.total} in {formatClock(c.usedSec)}. Can you beat that?
              </h1>
              <p className="muted" style={{ marginTop: 8 }}>
                {c.title}: the same {c.total} questions {c.from} answered. Higher score wins; a tie goes to the faster time.
              </p>
            </div>
            <div className="kv">
              <div><span>Questions</span><b>{c.total}</b></div>
              <div><span>Time limit</span><b>{c.timeLimitSec ? `${Math.round(c.timeLimitSec / 60)} min` : "None"}</b></div>
              <div><span>To beat</span><b className="mono">{c.score}/{c.total}</b></div>
            </div>
            <form
              className="panel stack"
              onSubmit={(e) => {
                e.preventDefault();
                start();
              }}
            >
              <div>
                <label htmlFor="name">Your name</label>
                <input id="name" type="text" autoComplete="given-name" maxLength={30} placeholder={`So ${c.from} knows who beat them`} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="muted">
                No account needed. {c.timeLimitSec ? "The clock starts as soon as you press start." : "There's no time limit, but your time still counts in a tie."}
              </p>
              <button className="btn btn-primary btn-big" type="submit" disabled={busy}>
                {busy ? "Starting…" : "Accept the challenge"}
              </button>
              {error && <p className="error">{error}</p>}
            </form>
          </>
        )}
      </div>
    </div>
  );
}

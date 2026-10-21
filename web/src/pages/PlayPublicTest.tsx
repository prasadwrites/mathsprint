import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Figure from "../components/Figure";
import Leaderboard from "../components/Leaderboard";
import ShareButtons from "../components/ShareButtons";
import TimedQuestions from "../components/TimedQuestions";
import { Brand, Chip, Icon } from "../components/TopBar";
import { openPublicTest, submitPublicTest } from "../lib/db";
import { formatClock } from "../lib/pace";
import { publicStoreKey, publicTestCard, publicTestLink, rememberPublicClaim, saveAttempt, savedAttempt } from "../lib/publicTest";
import type { OpenPublicTest, PublicTestResult } from "../lib/types";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function Result({ token, t, result }: { token: string; t: OpenPublicTest; result: PublicTestResult }) {
  const placeText = result.claimed
    ? `You're ${ordinal(result.rank)} on the leaderboard`
    : result.rank <= 10
      ? `That's good for ${ordinal(result.rank)} place`
      : `That would put you ${ordinal(result.rank)}`;
  const brag = `I scored ${result.score}/${t.total} in ${formatClock(result.usedSec)} on ${t.title}${result.claimed ? ` and I'm ${ordinal(result.rank)} on the leaderboard` : ""}. Think you can beat me?`;
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">Leaderboard · {t.title}</div>
        <h1>{placeText}{result.claimed && result.rank === 1 ? "!" : "."}</h1>
      </div>
      <div className="panel faceoff" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="faceoff-side">
          <span className="eyebrow">Your score</span>
          <div className="big mono">
            {result.score}
            <span className="muted" style={{ fontSize: 24 }}>/{t.total}</span>
          </div>
          <span className="muted">
            in <b className="mono">{formatClock(result.usedSec)}</b>
          </span>
        </div>
        <div className={`faceoff-side ${result.claimed ? "won" : ""}`}>
          <span className="eyebrow">{result.claimed ? "Your place" : "Your place if you sign up"}</span>
          <div className="rank-big">#{result.rank}</div>
          <span className="muted">of {Math.max(t.ranked + (result.claimed ? 0 : 1), result.rank)}</span>
        </div>
      </div>

      {!result.claimed && (
        <div className="panel stack cta-panel">
          <h2>Put {result.name} on the leaderboard</h2>
          <p>
            Only players with a free MathSprint account go on the leaderboard. Sign up (or sign in) and your score goes up as {result.name}
            {result.rank <= 10 ? `, in ${ordinal(result.rank)} place right now` : ""}. Then build your own decks and keep practicing.
          </p>
          <div>
            <Link className="btn btn-primary btn-big" to="/">
              <Icon name="sparkle" /> Sign up and claim my spot
            </Link>
          </div>
        </div>
      )}

      <section className="panel stack">
        <div className="row spread">
          <h2>Leaderboard</h2>
          <span className="muted">{t.ranked} {t.ranked === 1 ? "player" : "players"}</span>
        </div>
        <Leaderboard rows={t.board} total={t.total} highlight={result.claimed ? result.rank : undefined} />
      </section>

      <div className="panel stack">
        <h2>Dare your friends</h2>
        <ShareButtons link={publicTestLink(token)} text={brag} card={publicTestCard(token)} title="MathSprint leaderboard" />
      </div>

      <section className="panel">
        <h2>Question by question</h2>
        <p className="muted" style={{ marginTop: 4 }}>The correct answers stay hidden so the leaderboard stays fair.</p>
        {result.questions.map((q, i) => (
          <div className="review-item" key={i}>
            <div className="review-head">
              <h3>Question {i + 1}</h3>
              {q.correct ? <Chip tone="good">Right</Chip> : q.answer ? <Chip tone="miss">Wrong</Chip> : <Chip>Skipped</Chip>}
            </div>
            <p>
              {q.prompt} <span className="mono">{q.math}</span>
            </p>
            {q.figure && <Figure figure={q.figure} small />}
            <div className="ans">
              <span className="muted">Your answer</span>
              <b>{q.answer || "–"}</b>
              {q.sec != null && (
                <>
                  <span className="muted">Your time</span>
                  <b>{formatClock(q.sec)}</b>
                </>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/** A public test link. No sign-in: anyone plays under a name; signing up afterwards puts them on the leaderboard. */
export default function PlayPublicTest() {
  const { token = "" } = useParams();
  const [t, setT] = useState<OpenPublicTest | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const show = useCallback(
    (next: OpenPublicTest) => {
      if (next.attempt) saveAttempt(token, next.attempt);
      if (next.result && next.attempt && !next.result.claimed) rememberPublicClaim({ token, attempt: next.attempt, title: next.title });
      setT(next);
    },
    [token],
  );

  useEffect(() => {
    const attempt = savedAttempt(token);
    openPublicTest(attempt ? { token, attempt } : { token })
      .then(show)
      .catch((e) => setError((e as Error).message || "This test link doesn't work."));
  }, [token, show]);

  const start = async () => {
    if (!name.trim()) {
      setError("Enter your name. It's the name you'll have on the leaderboard.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      show(await openPublicTest({ token, start: true, name: name.trim() }));
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
        {t?.result ? (
          <Result token={token} t={t} result={t.result} />
        ) : t?.questions && t.attempt ? (
          <TimedQuestions
            storeKey={publicStoreKey(token)}
            test={{ ...t, questions: t.questions }}
            send={async (answers, track) => show(await submitPublicTest(token, t.attempt!, answers, track.times))}
          />
        ) : !t ? (
          error ? <p className="error">{error}</p> : <span className="spinner" />
        ) : (
          <>
            <div>
              <div className="eyebrow">Open leaderboard · {t.title}</div>
              <h1>{!t.board.length ? `Be #1 on the ${t.title} leaderboard` : t.ranked >= 10 ? "Think you can crack the top 10?" : "Can you top this leaderboard?"}</h1>
              <p className="muted" style={{ marginTop: 8 }}>
                {t.total} questions on {t.title}. The most right answers wins, and the faster time breaks a tie. Free to play, no account needed.
              </p>
            </div>
            <div className="kv">
              <div><span>Questions</span><b>{t.total}</b></div>
              <div><span>Time limit</span><b>{t.timeLimitSec ? `${Math.round(t.timeLimitSec / 60)} min` : "None"}</b></div>
              <div><span>{t.board.length ? "Top score" : "Players"}</span><b className="mono">{t.board.length ? `${t.board[0].score}/${t.total}` : 0}</b></div>
            </div>
            <form
              className="panel stack cta-panel"
              onSubmit={(e) => {
                e.preventDefault();
                start();
              }}
            >
              <div>
                <label htmlFor="name">Your name</label>
                <input id="name" type="text" autoComplete="given-name" maxLength={30} required placeholder="The name on the leaderboard" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="muted">
                {t.timeLimitSec ? "The clock starts as soon as you press start. " : "There's no time limit, but your time breaks ties. "}
                After you finish, sign up free to put your score on the leaderboard.
              </p>
              <button className="btn btn-primary btn-big" type="submit" disabled={busy}>
                {busy ? "Starting…" : "Start the test"}
              </button>
              {error && <p className="error">{error}</p>}
            </form>
            <section className="panel stack">
              <div className="row spread">
                <h2>Leaderboard</h2>
                <span className="muted">{t.ranked} {t.ranked === 1 ? "player" : "players"}</span>
              </div>
              <Leaderboard rows={t.board} total={t.total} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

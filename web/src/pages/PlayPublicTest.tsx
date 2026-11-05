import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Figure from "../components/Figure";
import Leaderboard from "../components/Leaderboard";
import ShareButtons from "../components/ShareButtons";
import TimedQuestions from "../components/TimedQuestions";
import { Brand, Chip, Icon } from "../components/TopBar";
import { openPublicTest, submitPublicTest } from "../lib/db";
import { auth } from "../lib/firebase";
import { formatClock } from "../lib/pace";
import { type FromPublicTest, publicStoreKey, publicTestCard, publicTestLink, rememberMakeQuiz, rememberPublicClaim, saveAttempt, savedAttempt } from "../lib/publicTest";
import { tagSignupRef } from "../lib/signupRef";
import type { OpenPublicTest, PublicTestResult } from "../lib/types";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Shown right under the score: the invitation to make a quiz of their own and send it to friends. Making one needs a
 * free account, so a signed-out player signs up first (which also puts their score on the leaderboard) and then lands
 * on the deck builder. */
function MakeYourOwn({ t, result }: { t: OpenPublicTest; result: PublicTestResult }) {
  const navigate = useNavigate();
  const from: FromPublicTest = { title: t.title, rank: result.claimed ? result.rank : undefined };
  // Signed in with the score on the board: straight to the deck builder.
  const ready = result.claimed && !!auth.currentUser;
  const signUp = (makeQuiz: boolean) => {
    if (makeQuiz) rememberMakeQuiz({ title: t.title });
    tagSignupRef("public-test");
    navigate("/");
  };
  return (
    <section className="panel stack cta-panel make-own" aria-labelledby="make-own">
      <div>
        <div className="eyebrow">Your turn</div>
        <h2 id="make-own" style={{ marginTop: 4 }}>Create your own quiz and share it with friends</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Pick any topic, or upload a worksheet, and MathSprint writes a timed quiz with every answer checked. Take it once, then send your friends a
          link to see who can beat your score.
        </p>
      </div>
      <ol className="make-own-steps">
        <li><b>Pick a topic</b><span>Like "SAT linear equations" or "AP Calc limits"</span></li>
        <li><b>Take your quiz</b><span>Set the score your friends have to beat</span></li>
        <li><b>Share the link</b><span>Friends play from their phone, no setup</span></li>
      </ol>
      {ready ? (
        <div>
          <Link className="btn btn-primary btn-big" to="/create" state={{ fromPublicTest: from }}>
            <Icon name="sparkle" /> Make my quiz
          </Link>
        </div>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            {result.claimed ? (
              <>Sign in to MathSprint to make your quiz. Your first 5 quizzes are free.</>
            ) : (
              <>
                You'll need a free MathSprint account, no card needed. Signing up also puts <b>{result.name}</b> on this leaderboard
                {result.rank <= 10 ? `, in ${ordinal(result.rank)} place right now` : ""}.
              </>
            )}
          </p>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary btn-big" onClick={() => signUp(true)}>
              <Icon name="sparkle" /> {result.claimed ? "Sign in and make my quiz" : "Sign up free and make my quiz"}
            </button>
            {!result.claimed && (
              <button type="button" className="btn-link" onClick={() => signUp(false)}>
                Just claim my spot
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

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

      <MakeYourOwn t={t} result={result} />
      <section className="panel stack">
        <div className="row spread">
          <h2>Leaderboard</h2>
          <span className="muted">{t.ranked} {t.ranked === 1 ? "player" : "players"}</span>
        </div>
        <Leaderboard rows={t.board} total={t.total} highlight={result.claimed ? result.rank : undefined} />
        {result.claimed && <p className="muted">Your spot is saved. Each account gets one try per leaderboard, so this link now shows your result.</p>}
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
    // Wait for sign-in to load: a player who already claimed a spot here gets their saved result, not a new try.
    auth
      .authStateReady()
      .then(() => openPublicTest(attempt ? { token, attempt } : { token }))
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

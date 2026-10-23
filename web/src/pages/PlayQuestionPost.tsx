import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Figure from "../components/Figure";
import ShareButtons from "../components/ShareButtons";
import { Brand, Chip, Icon } from "../components/TopBar";
import { checkPostAnswer, openQuestionPost, savePostDeck } from "../lib/db";
import { auth } from "../lib/firebase";
import { answerHint } from "../lib/grading";
import { isMath, solveVerb, subjectOf } from "../lib/subjects";
import { loadProgress, questionPostCard, questionPostLink, rememberPostSave, saveProgress, type PostProgress } from "../lib/questionPost";
import type { OpenQuestionPost, PostAnswer, PostQuestion } from "../lib/types";

/** Signing up (or adding the deck when already signed in) to keep practicing the whole deck. */
function KeepGoing({ token, post, user }: { token: string; post: OpenQuestionPost; user: User | null | undefined }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const { deckId } = await savePostDeck(token);
      navigate(`/decks/${deckId}`);
    } catch (e) {
      setError((e as Error).message || "The deck wasn't added. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="panel stack cta-panel">
      <h2>Get all {post.total} questions free</h2>
      <p>
        Save the whole {post.title} deck to a free MathSprint account. Practice it against the clock, see the step-by-step solutions, track the
        topics you miss, and build your own decks on anything you're studying.
      </p>
      <div>
        {user ? (
          <button className="btn btn-primary btn-big" onClick={add} disabled={busy}>
            <Icon name="sparkle" /> {busy ? "Adding…" : "Add this deck to my decks"}
          </button>
        ) : (
          <Link className="btn btn-primary btn-big" to="/" onClick={() => rememberPostSave(token)}>
            <Icon name="sparkle" /> Sign up free and get the deck
          </Link>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Ask({ q, busy, onAnswer }: { q: PostQuestion; busy: boolean; onAnswer: (answer: string) => void }) {
  const [answer, setAnswer] = useState("");
  const hint = answerHint(q.answerCount, q.pair);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (answer.trim()) onAnswer(answer.trim());
      }}
    >
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
          <label htmlFor="post-answer">Your answer</label>
          <div className="answer-wrap">
            <input
              id="post-answer"
              className="answer-input"
              type="text"
              autoComplete="off"
              placeholder={hint.placeholder}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            {hint.help}
          </p>
        </div>
      )}
      <div>
        <button className="btn btn-primary btn-big" type="submit" disabled={busy || !answer.trim()}>
          {busy ? "Checking…" : "Check my answer"} <Icon name="check" />
        </button>
      </div>
    </form>
  );
}

function Feedback({ given, result, first, subject }: { given: string; result: PostAnswer; first: boolean; subject: string }) {
  return (
    <div className="stack" role="status">
      <div className="row" style={{ gap: 10 }}>
        {result.correct ? <Chip tone="good">Right!</Chip> : <Chip tone="miss">Not quite</Chip>}
        <span>
          {result.correct ? (
            <>
              <b className="mono">{given}</b> is correct{first ? ". Nice work." : "."}
            </>
          ) : (
            <>
              You said <b className="mono">{given}</b>. The answer is <b className="mono">{result.answer}</b>.
            </>
          )}
        </span>
      </div>
      {first && result.rightRate !== null && <p className="muted">{result.rightRate}% of people got this one right.</p>}
      {result.steps.length > 0 && (
        <details open={!result.correct}>
          <summary>{isMath(subject) ? "How to solve it" : "Why it's right"}</summary>
          <ol className="steps-box" style={{ marginTop: 10 }}>
            {result.steps.map((s, k) => (
              <li key={k}>
                {s.description}
                {s.expression && <code>{s.expression}</code>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** A question post. No sign-in: anyone answers the posted question, then keeps going through the same deck. */
export default function PlayQuestionPost() {
  const { token = "" } = useParams();
  const [post, setPost] = useState<OpenQuestionPost | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<PostProgress>(() => loadProgress(token) ?? { answers: {}, results: {} });
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const saved = loadProgress(token);
    openQuestionPost(token, !saved) // a visitor coming back isn't a new view
      .then((p) => {
        setPost(p);
        // Back where they left off: on the last question they answered.
        const done = p.questions.map((q, k) => (saved?.results[q.index] ? k : -1)).filter((k) => k >= 0);
        if (done.length) setAt(Math.max(...done));
      })
      .catch((e) => setError((e as Error).message || "This question isn't available."));
  }, [token]);

  if (!post) {
    return (
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="stack">
          <Brand small />
          {error ? <p className="error">{error}</p> : <span className="spinner" />}
        </div>
      </div>
    );
  }

  const q = post.questions[at];
  const subject = subjectOf(post);
  const verb = solveVerb(subject);
  const result = progress.results[q.index];
  const tried = post.questions.filter((x) => progress.results[x.index]);
  const right = tried.filter((x) => progress.results[x.index].correct).length;
  const next = post.questions.findIndex((x, k) => k > at && !progress.results[x.index]);
  const first = at === 0;

  const answer = async (given: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await checkPostAnswer(token, q.index, given);
      const p = { answers: { ...progress.answers, [q.index]: given }, results: { ...progress.results, [q.index]: r } };
      setProgress(p);
      saveProgress(token, p);
    } catch (e) {
      setError((e as Error).message || "Your answer didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="stack">
        <Brand small />
        <div>
          <div className="eyebrow">
            {first ? "Challenge" : `Question ${at + 1} of ${post.total}`} · {post.title}
          </div>
          <h1>{first ? `Can you ${verb} this?` : result ? (result.correct ? "Nailed it." : "Almost. Try the next one.") : "Next one. Can you get it?"}</h1>
          {tried.length > 1 && (
            <p className="muted" style={{ marginTop: 6 }}>
              {right} of {tried.length} right so far.
            </p>
          )}
        </div>

        <div className="panel qcard">
          <div className="row" style={{ gap: 6 }}>
            {q.concept && <Chip>{q.concept}</Chip>}
            {q.difficulty && <Chip tone={q.difficulty === "Hard" ? "miss" : "neutral"}>{q.difficulty}</Chip>}
          </div>
          <div className="qtext">{q.prompt}</div>
          {q.figure && <Figure figure={q.figure} />}
          {q.math && <div className="qmath">{q.math}</div>}
          {result ? <Feedback given={progress.answers[q.index] ?? ""} result={result} first={first} subject={subject} /> : <Ask key={q.index} q={q} busy={busy} onAnswer={answer} />}
          {error && <p className="error">{error}</p>}
        </div>

        {result && (
          <div className="row" style={{ gap: 10 }}>
            {next >= 0 ? (
              <button className="btn btn-primary btn-big" onClick={() => setAt(next)}>
                {first ? `Try more ${post.title} questions` : "Next question"} <Icon name="next" />
              </button>
            ) : (
              <p>
                <b>
                  That's the whole deck: {right} of {tried.length} right.
                </b>
              </p>
            )}
            {at > 0 && (
              <button className="btn btn-big" onClick={() => setAt(at - 1)}>
                Previous
              </button>
            )}
          </div>
        )}

        {result && <KeepGoing token={token} post={post} user={user} />}

        <div className="panel stack">
          <h2>Challenge your friends</h2>
          <ShareButtons
            link={questionPostLink(token)}
            text={
              progress.results[post.questions[0].index]?.correct
                ? `I ${verb === "solve" ? "solved" : "got"} this ${post.title} question. Can you? Free, no account needed.`
                : `Can you ${verb} this ${post.title} question? Free, no account needed.`
            }
            card={questionPostCard(token)}
            title="MathSprint question"
          />
        </div>
      </div>
    </div>
  );
}

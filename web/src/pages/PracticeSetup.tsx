import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMaybeUser } from "../App";
import TopBar, { Brand, Icon } from "../components/TopBar";
import { getDeck, getQuestions, listPublicDeckCards, listSessions, startSession } from "../lib/db";
import { missedLastTime, practicedIds, selectQuestions, type Selection } from "../lib/insights";
import { formatClock } from "../lib/pace";
import { holdPublicStart, takePublicStart } from "../lib/publicDeck";
import { subjectOf } from "../lib/subjects";
import type { Deck, Mode, PracticeSession, PublicDeckCard, Question } from "../lib/types";
import Login from "./Login";

const MODES: [Mode, string, string][] = [
  ["learn", "Learn", "No clock. Take your time and focus on understanding."],
  ["practice", "Practice", "Your own time limit, with pace feedback as you go."],
  ["challenge", "Challenge", "One minute per question. Stricter pacing."],
];

const MODE_IDS = new Set(MODES.map(([m]) => m));
const SELECTIONS = new Set<Selection>(["first", "random", "unpracticed", "missed"]);

function timeLimit(mode: Mode, count: number, minutes: number) {
  return mode === "learn" ? 0 : mode === "challenge" ? count * 60 : Math.round(Math.max(0.5, minutes || 1) * 60);
}

/** A public deck as the sign-in page lists it, shaped as a deck for this page (it has no questions until sign-in). */
const fromCard = (c: PublicDeckCard): Deck => ({
  id: c.id,
  ownerId: "",
  title: c.title,
  subject: c.subject,
  topic: c.title,
  level: c.level,
  difficulty: c.difficulty as Deck["difficulty"],
  topics: c.topics,
  questionCount: c.questionCount,
  source: "ai",
  createdAt: c.createdAt ? new Date(c.createdAt) : null,
  public: true,
});

/** Signed out, this page works for the admin's public decks: the visitor sets up a practice from the sign-in page's
 * list, and signs in or signs up to start it. The practice then starts as soon as they're signed in. */
export default function PracticeSetup() {
  const user = useMaybeUser();
  const navigate = useNavigate();
  const { deckId = "" } = useParams();
  const [params] = useSearchParams();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [missing, setMissing] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [history, setHistory] = useState<PracticeSession[]>([]);
  const [mode, setMode] = useState<Mode>("practice");
  const [n, setN] = useState(10);
  const [minutes, setMinutes] = useState(15);
  const [selection, setSelection] = useState<Selection>((params.get("select") as Selection) || "first");
  const [starting, setStarting] = useState(false);
  // Signed out and pressed Start: show sign-in and sign-up, with the setup kept for after.
  const [asking, setAsking] = useState(false);
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) {
      listPublicDeckCards()
        .then((cards) => {
          const card = cards.find((c) => c.id === deckId);
          if (!card) return setMissing(true);
          const count = Math.min(10, card.questionCount);
          setN(count);
          setMinutes(Math.min(30, Math.max(1, Math.round(count * 1.5))));
          setDeck(fromCard(card));
        })
        .catch(() => setMissing(true));
      return;
    }
    Promise.all([getDeck(deckId), getQuestions(deckId), listSessions(uid, deckId)])
      .then(async ([d, qs, hs]) => {
        // Set up before signing in: start it now, with the settings the visitor picked.
        const held = d && qs.length ? takePublicStart(deckId) : null;
        if (d && held && MODE_IDS.has(held.mode) && SELECTIONS.has(held.selection)) {
          const ids = qs.map((q) => q.id);
          const pool = held.selection === "missed" ? missedLastTime(hs).length : held.selection === "unpracticed" ? ids.filter((id) => !practicedIds(hs).has(id)).length : ids.length;
          const sel = pool ? held.selection : "first";
          const count = Math.max(1, Math.min(pool || ids.length, Math.round(held.n) || 1));
          const sessionId = await startSession({ uid, deck: d, mode: held.mode, questionIds: selectQuestions(ids, sel, count, hs), timeLimitSec: timeLimit(held.mode, count, held.minutes) });
          navigate(`/sessions/${sessionId}`, { replace: true });
          return;
        }
        setDeck(d);
        setMissing(!d);
        setHistory(hs);
        const preset = params.get("select") === "missed" ? missedLastTime(hs).length : 0;
        const count = preset || Math.min(10, qs.length);
        setN(count);
        setMinutes(Math.min(30, Math.max(1, Math.round(count * 1.5))));
        setQuestions(qs);
      })
      .catch(() => setMissing(true));
  }, [deckId, uid, params, navigate]);

  const guestBar = (
    <header className="appbar">
      <div className="appbar-inner">
        <Link className="back" to="/">
          <Icon name="back" /> Sign in
        </Link>
        <div style={{ flexGrow: 1 }} />
        <Brand small />
      </div>
    </header>
  );
  const bar = user ? <TopBar back={{ to: deck ? `/decks/${deck.id}` : `/decks/${deckId}`, label: deck?.title ?? "Deck" }} /> : guestBar;

  if (missing) {
    return (
      <>
        {bar}
        <main className="page narrow">
          <p>{user ? "This deck doesn't exist or isn't yours." : "This deck isn't available anymore."}</p>
          {!user && (
            <p>
              <Link to="/">Sign in or sign up</Link> to build your own practice deck on any topic.
            </p>
          )}
        </main>
      </>
    );
  }

  // Signed out, the deck's own count stands in for its questions (they're read once the visitor signs in).
  const total = user ? questions.length : deck?.questionCount ?? 0;
  if (!deck || !total) {
    return (
      <>
        {bar}
        <main className="page"><span className="spinner" /></main>
      </>
    );
  }

  if (asking && !user) {
    return <Login startDeck={{ title: deck.title, onBack: () => setAsking(false) }} />;
  }

  const allIds = questions.map((q) => q.id);
  const seen = practicedIds(history);
  const available: Record<Selection, number> = {
    first: total,
    random: total,
    unpracticed: user ? allIds.filter((id) => !seen.has(id)).length : total,
    missed: missedLastTime(history).length,
  };
  const pool = available[selection];
  const count = Math.max(1, Math.min(pool || 1, n || 1));
  const timeLimitSec = timeLimit(mode, count, minutes);
  const perQ = timeLimitSec / count;

  const start = async () => {
    if (!user) {
      holdPublicStart({ deckId: deck.id, mode, n: count, minutes, selection });
      setAsking(true);
      window.scrollTo(0, 0);
      return;
    }
    setStarting(true);
    const sessionId = await startSession({
      uid: user.uid,
      deck,
      mode,
      questionIds: selectQuestions(allIds, selection, count, history),
      timeLimitSec,
    });
    navigate(`/sessions/${sessionId}`, { replace: true });
  };

  const options: [Selection, string][] = [
    ["first", `First ${count}, in order`],
    ["random", `Random ${count}`],
    ["unpracticed", "Ones I haven't practiced"],
    ["missed", "Ones I got wrong last time"],
  ];
  // Someone who hasn't signed in has practiced none of it yet.
  const shownOptions = user ? options : options.slice(0, 2);

  return (
    <>
      {bar}
      <main className="page narrow">
        {user ? (
          <h1>Set up your practice</h1>
        ) : (
          <div>
            <div className="eyebrow">
              {subjectOf(deck)} · {deck.level} · {deck.difficulty} · {total} questions
            </div>
            <h1>{deck.title}</h1>
            <p className="muted">Set up your practice, then sign in or create a free account to start it.</p>
          </div>
        )}
        <form
          className="stack layout-gap"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0, gap: 10 }}>
            <legend className="eyebrow" style={{ marginBottom: 10 }}>Mode</legend>
            <div className="modes">
              {MODES.map(([m, name, desc]) => (
                <label key={m} className="mode">
                  <span className="name">
                    <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                    {name}
                  </span>
                  <span className="desc">{desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="panel stack">
            <div className="grid2">
              <div>
                <label htmlFor="n">Number of questions</label>
                <input id="n" type="number" min={1} max={pool || 1} value={n} onChange={(e) => setN(Number(e.target.value))} />
                <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                  This deck has {total}
                </p>
              </div>
              {mode === "practice" && (
                <div>
                  <label htmlFor="minutes">Time available (minutes)</label>
                  <input id="minutes" type="number" min={0.5} max={180} step={0.5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
                  <div className="quick" style={{ marginTop: 8 }} aria-label="Quick picks">
                    {[10, 15, 20, 30].map((m) => (
                      <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {mode !== "learn" ? (
              <div className="target-box">
                <Icon name="clock" size={22} />
                <span>
                  Target pace: <b className="mono" style={{ fontSize: 20 }}>{formatClock(perQ)}</b> per question
                </span>
                <span className="muted" style={{ fontSize: 14 }}>
                  {mode === "challenge"
                    ? `${formatClock(timeLimitSec)} in total.`
                    : "You'll see whether you're ahead or behind this as you go."}
                </span>
              </div>
            ) : (
              <p className="muted">No clock in Learn mode. Your time per question is still recorded so you can see where you slowed down.</p>
            )}
          </div>

          <fieldset className="panel stack" style={{ margin: 0, gap: 4 }}>
            <legend className="sr-only">Which questions</legend>
            <h2 style={{ marginBottom: 8 }}>Which questions</h2>
            {shownOptions.map(([v, label]) => (
              <label key={v} className="radio">
                <input type="radio" name="selection" value={v} checked={selection === v} disabled={!available[v]} onChange={() => setSelection(v)} />
                {label}
                {(v === "unpracticed" || v === "missed") && <span className="count">({available[v]})</span>}
              </label>
            ))}
          </fieldset>

          <div>
            <button className="btn btn-primary btn-big" type="submit" disabled={starting || !pool}>
              <Icon name="play" /> {starting ? "Starting…" : user ? "Start practice" : "Sign in to start"}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}

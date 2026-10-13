import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useUser } from "../App";
import TopBar, { Icon } from "../components/TopBar";
import { getDeck, getQuestions, listSessions, startSession } from "../lib/db";
import { missedLastTime, practicedIds, selectQuestions, type Selection } from "../lib/insights";
import { formatClock } from "../lib/pace";
import type { Deck, Mode, PracticeSession, Question } from "../lib/types";

const MODES: [Mode, string, string][] = [
  ["learn", "Learn", "No clock. Take your time and focus on understanding."],
  ["practice", "Practice", "Your own time limit, with pace feedback as you go."],
  ["challenge", "Challenge", "One minute per question. Stricter pacing."],
];

export default function PracticeSetup() {
  const user = useUser();
  const navigate = useNavigate();
  const { deckId = "" } = useParams();
  const [params] = useSearchParams();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [history, setHistory] = useState<PracticeSession[]>([]);
  const [mode, setMode] = useState<Mode>("practice");
  const [n, setN] = useState(10);
  const [minutes, setMinutes] = useState(15);
  const [selection, setSelection] = useState<Selection>((params.get("select") as Selection) || "first");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    Promise.all([getDeck(deckId), getQuestions(deckId), listSessions(user.uid, deckId)]).then(([d, qs, hs]) => {
      setDeck(d);
      setHistory(hs);
      const preset = params.get("select") === "missed" ? missedLastTime(hs).length : 0;
      const count = preset || Math.min(10, qs.length);
      setN(count);
      setMinutes(Math.min(30, Math.max(1, Math.round(count * 1.5))));
      setQuestions(qs);
    });
  }, [deckId, user.uid, params]);

  if (!deck || !questions.length) {
    return (
      <>
        <TopBar back={{ to: `/decks/${deckId}`, label: "Deck" }} />
        <main className="page"><span className="spinner" /></main>
      </>
    );
  }

  const allIds = questions.map((q) => q.id);
  const seen = practicedIds(history);
  const available: Record<Selection, number> = {
    first: allIds.length,
    random: allIds.length,
    unpracticed: allIds.filter((id) => !seen.has(id)).length,
    missed: missedLastTime(history).length,
  };
  const pool = available[selection];
  const count = Math.max(1, Math.min(pool || 1, n || 1));
  const timeLimitSec = mode === "learn" ? 0 : mode === "challenge" ? count * 60 : Math.round(Math.max(0.5, minutes || 1) * 60);
  const perQ = timeLimitSec / count;

  const start = async () => {
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

  return (
    <>
      <TopBar back={{ to: `/decks/${deck.id}`, label: deck.title }} />
      <main className="page narrow">
        <h1>Set up your practice</h1>
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
                  This deck has {questions.length}
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
            {options.map(([v, label]) => (
              <label key={v} className="radio">
                <input type="radio" name="selection" value={v} checked={selection === v} disabled={!available[v]} onChange={() => setSelection(v)} />
                {label}
                {(v === "unpracticed" || v === "missed") && <span className="count">({available[v]})</span>}
              </label>
            ))}
          </fieldset>

          <div>
            <button className="btn btn-primary btn-big" type="submit" disabled={starting || !pool}>
              <Icon name="play" /> {starting ? "Starting…" : "Start practice"}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}

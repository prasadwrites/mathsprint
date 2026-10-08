import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useUser } from "../App";
import TopBar from "../components/TopBar";
import { getDeck, getQuestions, startSession } from "../lib/db";
import { formatClock } from "../lib/pace";
import type { Deck, Question } from "../lib/types";

type Order = "first" | "random";

export default function PracticeSetup() {
  const user = useUser();
  const navigate = useNavigate();
  const { deckId = "" } = useParams();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [n, setN] = useState(10);
  const [minutes, setMinutes] = useState(15);
  const [order, setOrder] = useState<Order>("first");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getDeck(deckId).then(setDeck);
    getQuestions(deckId).then((qs) => {
      setQuestions(qs);
      setN(Math.min(10, qs.length));
      setMinutes(Math.min(15, Math.max(1, qs.length * 1.5)));
    });
  }, [deckId]);

  if (!deck || !questions.length) return <div className="wrap"><span className="spinner" /></div>;

  const count = Math.max(1, Math.min(questions.length, n || 1));
  const perQ = (Math.max(0.5, minutes || 1) * 60) / count;

  const start = async () => {
    setStarting(true);
    let ids = questions.map((q) => q.id);
    if (order === "random") ids = ids.map((id) => [Math.random(), id] as const).sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    const sessionId = await startSession({
      uid: user.uid,
      deck,
      questionIds: ids.slice(0, count),
      timeLimitSec: Math.round(Math.max(0.5, minutes) * 60),
    });
    navigate(`/sessions/${sessionId}`, { replace: true });
  };

  return (
    <div className="wrap">
      <TopBar back={{ to: `/decks/${deck.id}`, label: deck.title }} />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <h1>Practice settings</h1>
        <div className="panel stack">
          <div className="grid2">
            <div>
              <label htmlFor="n">Number of questions</label>
              <input id="n" type="number" min={1} max={questions.length} value={n} onChange={(e) => setN(Number(e.target.value))} />
            </div>
            <div>
              <label htmlFor="minutes">Time available (minutes)</label>
              <input id="minutes" type="number" min={0.5} max={180} step={0.5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </div>
          </div>
          <p className="muted">
            Target pace: <b className="mono">{formatClock(perQ)}</b> per question.
          </p>
          <div>
            <label>Question selection</label>
            <div className="seg">
              {(
                [
                  ["first", `First ${count}`],
                  ["random", `Random ${count}`],
                ] as [Order, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={order === v} onClick={() => setOrder(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-primary btn-big" type="submit" disabled={starting || !questions.length}>
            {starting ? "Starting…" : "Start practice"}
          </button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "../App";
import TopBar, { Chip } from "../components/TopBar";
import { addSampleDeck, listDecks, listSessions } from "../lib/db";
import { formatClock } from "../lib/pace";
import type { Deck, PracticeSession } from "../lib/types";

export default function Dashboard() {
  const user = useUser();
  const navigate = useNavigate();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listDecks(user.uid).then(setDecks);
    listSessions(user.uid).then(setSessions);
  }, [user.uid]);

  const answered = sessions.reduce((a, s) => a + s.questionIds.length, 0);
  const correct = sessions.reduce((a, s) => a + (s.score ?? 0), 0);
  const seconds = sessions.reduce((a, s) => a + (s.usedSec ?? 0), 0);
  const best = (deckId: string) => {
    const scores = sessions.filter((s) => s.deckId === deckId).map((s) => Math.round((s.accuracy ?? 0) * 100));
    return scores.length ? Math.max(...scores) : null;
  };

  return (
    <div className="wrap">
      <TopBar />
      <div className="stack">
        <h1>What do you want to practise?</h1>
        <Link className="create-cta" to="/create" style={{ textDecoration: "none", color: "inherit" }}>
          <span>
            <strong>Create a practice deck with AI</strong>
            <br />
            <span className="muted">Pick a topic, level and difficulty. Every answer is checked before it reaches you.</span>
          </span>
          <span style={{ fontSize: 24 }}>→</span>
        </Link>

        <div className="row spread">
          <h2>Your decks</h2>
          {decks && <span className="muted">{decks.length} decks</span>}
        </div>
        {decks === null ? (
          <span className="spinner" />
        ) : decks.length === 0 ? (
          <div className="panel stack">
            <p>You don't have any decks yet. Create one with AI above, or start with a ready-made quadratics deck.</p>
            <div>
              <button
                disabled={adding}
                onClick={async () => {
                  setAdding(true);
                  navigate(`/decks/${await addSampleDeck(user.uid)}`);
                }}
              >
                {adding ? "Adding…" : "Add the sample deck"}
              </button>
            </div>
          </div>
        ) : (
          <div className="decks">
            {decks.map((d) => {
              const b = best(d.id);
              return (
                <div key={d.id} className="panel deck-card">
                  <div>
                    <h3>{d.title}</h3>
                    <div className="meta">
                      {d.level} · {d.difficulty} · {d.questionCount} questions
                    </div>
                  </div>
                  <div className="row">
                    {b === null ? <Chip>Not practised yet</Chip> : <Chip tone={b >= 80 ? "good" : b >= 60 ? "warn" : "bad"}>Best {b}%</Chip>}
                  </div>
                  <div className="row">
                    <Link className="btn btn-primary" to={`/decks/${d.id}/practice`} style={{ textDecoration: "none" }}>
                      ▶ Practise
                    </Link>
                    <Link className="btn" to={`/decks/${d.id}`} style={{ textDecoration: "none" }}>
                      Review
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <h2>Your progress</h2>
        <div className="panel stats">
          <div className="stat">
            <b>{answered}</b>
            <span>questions practised</span>
          </div>
          <div className="stat">
            <b>{answered ? `${Math.round((correct / answered) * 100)}%` : "–"}</b>
            <span>accuracy</span>
          </div>
          <div className="stat">
            <b>{formatClock(seconds)}</b>
            <span>practice time</span>
          </div>
        </div>
      </div>
    </div>
  );
}

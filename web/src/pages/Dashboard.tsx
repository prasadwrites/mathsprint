import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAccount, useUser } from "../App";
import TopBar, { Chip, Icon } from "../components/TopBar";
import { addSampleDeck, listDecks, listSessions } from "../lib/db";
import { paceSummary, weakestConcepts } from "../lib/insights";
import { formatClock } from "../lib/pace";
import type { Deck, PracticeSession } from "../lib/types";

const tone = (pct: number) => (pct >= 80 ? "good" : pct >= 60 ? "warn" : "bad");

function formatHours(sec: number) {
  if (sec > 0 && sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function Dashboard() {
  const user = useUser();
  const { account } = useAccount();
  const waiting = account?.isAdmin ? account.upgrade?.waiting ?? 0 : 0;
  const unread = account?.upgrade?.unreadReplies ?? 0;
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [topic, setTopic] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    listDecks(user.uid).then(setDecks);
    listSessions(user.uid).then(setSessions);
  }, [user.uid]);

  useEffect(() => {
    if (hash && decks) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [hash, decks]);

  const answered = sessions.reduce((a, s) => a + s.questionIds.length, 0);
  const correct = sessions.reduce((a, s) => a + (s.score ?? 0), 0);
  const seconds = sessions.reduce((a, s) => a + (s.usedSec ?? 0), 0);
  const pace = paceSummary(sessions);
  const weak = weakestConcepts(sessions);
  const best = (deckId: string) => {
    const scores = sessions.filter((s) => s.deckId === deckId).map((s) => Math.round((s.accuracy ?? 0) * 100));
    return scores.length ? Math.max(...scores) : null;
  };

  return (
    <>
      <TopBar />
      <main className="page">
        {waiting > 0 && (
          <Link className="notice" to="/admin#requests">
            <b>
              {waiting} upgrade {waiting === 1 ? "request is" : "requests are"} waiting for you.
            </b>
            <span>Review and reply →</span>
          </Link>
        )}
        {unread > 0 && (
          <Link className="notice" to="/upgrade">
            <b>You have a reply about your upgrade request.</b>
            <span>Read it →</span>
          </Link>
        )}
        <section className="stack">
          <h1 style={{ fontSize: "clamp(30px, 5vw, 40px)" }}>What do you want to practice?</h1>
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/create${topic.trim() ? `?topic=${encodeURIComponent(topic.trim())}` : ""}`);
            }}
          >
            <div>
              <label htmlFor="topic">Create a practice deck with AI</label>
              <input id="topic" type="text" placeholder="Try “SAT linear equations” or “Calc II integration by parts”" value={topic} onChange={(e) => setTopic(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-big" type="submit">
              <Icon name="sparkle" /> Build my deck
            </button>
          </form>
        </section>

        <section className="stack" id="decks">
          <div className="row spread">
            <h2>Your decks</h2>
            {decks && <span className="muted">{decks.length} {decks.length === 1 ? "deck" : "decks"}</span>}
          </div>
          {decks === null ? (
            <span className="spinner" />
          ) : decks.length === 0 ? (
            <div className="panel stack">
              <p>You don't have any decks yet. Build one with AI above, or start with a ready-made quadratics deck.</p>
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
                  <article key={d.id} className="panel deck-card">
                    <div>
                      <h3>{d.title}</h3>
                      <div className="meta">
                        {d.level} · {d.difficulty} · {d.questionCount} questions
                      </div>
                    </div>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <div className="bar">
                        <i style={{ width: `${b ?? 0}%`, background: `var(--${b === null ? "muted" : tone(b)})` }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", color: `var(--${b === null ? "muted" : tone(b)})` }}>
                        {b === null ? "New" : `Best ${b}%`}
                      </span>
                    </div>
                    <div className="row">
                      <Link className="btn btn-primary" style={{ flexGrow: 1 }} to={`/decks/${d.id}/practice`}>
                        Practice
                      </Link>
                      <Link className="btn" to={`/decks/${d.id}`}>
                        Review
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="tiles" id="progress" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <div className="panel stack">
            <h2>Your progress</h2>
            <div className="stats" style={{ padding: 0, border: "none" }}>
              <div className="stat">
                <b>{answered}</b>
                <span>questions</span>
              </div>
              <div className="stat">
                <b>{answered ? `${Math.round((correct / answered) * 100)}%` : "–"}</b>
                <span>accuracy</span>
              </div>
              <div className="stat">
                <b>{formatHours(seconds)}</b>
                <span>practice time</span>
              </div>
            </div>
            {pace ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row spread" style={{ fontSize: 15 }}>
                  <span>Your pace</span>
                  <span className="mono">{formatClock(pace.avg)} / question</span>
                </div>
                <div className="track" style={{ height: 10 }}>
                  <div className="fill" style={{ width: `${Math.min(100, (pace.avg / Math.max(pace.avg, pace.target)) * 100)}%`, background: pace.avg <= pace.target ? "var(--good)" : "var(--warn)" }} />
                  <div className="target" style={{ left: `calc(${Math.min(100, (pace.target / Math.max(pace.avg, pace.target)) * 100)}% - 1px)` }} />
                </div>
                <span className="muted" style={{ fontSize: 14 }}>
                  {pace.avg <= pace.target
                    ? `${Math.round((1 - pace.avg / pace.target) * 100)}% faster than your ${formatClock(pace.target)} target`
                    : `${Math.round((pace.avg / pace.target - 1) * 100)}% slower than your ${formatClock(pace.target)} target`}
                </span>
              </div>
            ) : (
              <p className="muted">Finish a timed practice to see your pace here.</p>
            )}
          </div>
          <div className="panel stack">
            <div className="row spread">
              <h2>Practice next</h2>
              <Chip>From your sessions</Chip>
            </div>
            {weak.length ? (
              <>
                <ul className="weak" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {weak.map((w) => (
                    <li key={w.concept}>
                      <span>{w.concept}</span>
                      <b style={{ color: `var(--${tone(w.accuracy * 100)})` }}>{Math.round(w.accuracy * 100)}%</b>
                    </li>
                  ))}
                </ul>
                <Link
                  className="btn"
                  style={{ alignSelf: "flex-start", borderColor: "var(--accent)", color: "var(--accent)" }}
                  to={`/create?topic=${encodeURIComponent(weak.map((w) => w.concept).join(", "))}&notes=${encodeURIComponent("Focus on the topics I find hardest.")}`}
                >
                  Build a deck from these
                </Link>
              </>
            ) : (
              <p className="muted">After a few sessions, the topics you find hardest will show up here so you can target them.</p>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

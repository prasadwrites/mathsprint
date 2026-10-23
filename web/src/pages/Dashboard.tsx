import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAccount, useUser } from "../App";
import TopBar, { Chip, Icon } from "../components/TopBar";
import DeleteDeck from "../components/DeleteDeck";
import RemoveSharedDeck from "../components/RemoveSharedDeck";
import PromotionOffer from "../components/PromotionOffer";
import { addSampleDeck, listChallenges, listDecks, listSessions } from "../lib/db";
import { paceSummary, weakestConcepts } from "../lib/insights";
import { formatClock } from "../lib/pace";
import { filterSubjects, listSubjects, sameSubject, subjectOf } from "../lib/subjects";
import type { ChallengeOutcome, Deck, PlayedChallenge, PracticeSession, SentChallenge } from "../lib/types";

const tone = (pct: number) => (pct >= 80 ? "good" : pct >= 60 ? "warn" : "bad");

/** The challenger's view of a friend's outcome is the opposite of the friend's. */
const FLIP: Record<ChallengeOutcome, ChallengeOutcome> = { win: "loss", loss: "win", tie: "tie" };
const OUTCOME_CHIP: Record<ChallengeOutcome, ["good" | "miss" | "neutral", string]> = { win: ["good", "Won"], loss: ["miss", "Lost"], tie: ["neutral", "Tie"] };

function Challenges({ sent, played }: { sent: SentChallenge[]; played: PlayedChallenge[] }) {
  if (!sent.length && !played.length) return null;
  const wins = sent.reduce((n, c) => n + c.friends.filter((f) => f.outcome === "loss").length, 0) + played.filter((p) => p.outcome === "win").length;
  const games = sent.reduce((n, c) => n + c.friends.filter((f) => f.outcome).length, 0) + played.length;
  return (
    <section className="stack" id="challenges">
      <div className="row spread">
        <h2>Challenges</h2>
        {games > 0 && <span className="muted">{wins} won of {games}</span>}
      </div>
      <div className="decks">
        {played.map((p) => {
          const [tone, label] = OUTCOME_CHIP[p.outcome];
          return (
            <article key={p.attempt} className="panel deck-card">
              <div>
                <div className="row spread">
                  <h3>vs {p.from}</h3>
                  <Chip tone={tone}>{label}</Chip>
                </div>
                <div className="meta">{p.deckTitle} · their challenge</div>
              </div>
              <div className="mono">
                You {p.score}/{p.total} in {formatClock(p.usedSec)} · {p.from} {p.theirScore}/{p.total} in {formatClock(p.theirSec)}
              </div>
            </article>
          );
        })}
        {sent.map((c) => {
          const done = c.friends.filter((f) => f.status === "completed" && f.outcome);
          return (
            <article key={c.token} className="panel deck-card">
              <div>
                <h3>{c.deckTitle}</h3>
                <div className="meta">
                  Your challenge · {c.score}/{c.total} in {formatClock(c.usedSec)}
                </div>
              </div>
              {done.length ? (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {done.map((f, k) => {
                    const [tone, label] = OUTCOME_CHIP[FLIP[f.outcome!]];
                    return (
                      <li key={k} className="row spread" style={{ flexWrap: "nowrap" }}>
                        <span style={{ overflowWrap: "anywhere" }}>
                          {f.name} <span className="mono muted">{f.score}/{c.total} · {formatClock(f.usedSec ?? 0)}</span>
                        </span>
                        <Chip tone={tone}>{label}</Chip>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">
                  {c.friends.length ? `${c.friends.length} playing now.` : "No one has played yet."}{" "}
                  <Link to={`/sessions/${c.sessionId}/results`}>Get the link</Link>
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

const ALL = "All";
const FILTER_KEY = "ms.deckSubject";

function storedFilter() {
  try {
    return localStorage.getItem(FILTER_KEY) || ALL;
  } catch {
    return ALL;
  }
}

function storeFilter(subject: string) {
  try {
    localStorage.setItem(FILTER_KEY, subject);
  } catch {
    /* storage unavailable */
  }
}

function formatHours(sec: number) {
  if (sec > 0 && sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function Dashboard() {
  const user = useUser();
  const { account, refresh } = useAccount();
  const waiting = account?.isAdmin ? account.upgrade?.waiting ?? 0 : 0;
  const openReports = account?.isAdmin ? account.reports?.open ?? 0 : 0;
  const reportReplies = account?.reports?.unread ?? 0;
  const unread = account?.upgrade?.unreadReplies ?? 0;
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [topic, setTopic] = useState("");
  const [adding, setAdding] = useState(false);
  const [challenges, setChallenges] = useState<{ sent: SentChallenge[]; played: PlayedChallenge[] }>({ sent: [], played: [] });
  const [listed, setListed] = useState<string[]>([]);
  const [filter, setFilter] = useState(storedFilter);

  useEffect(() => {
    listDecks(user.uid).then(setDecks);
    listSessions(user.uid).then(setSessions);
    listSubjects().then(setListed);
  }, [user.uid]);
  // After the account loads, so a challenge played before signing up has been saved to it.
  useEffect(() => {
    if (account) listChallenges().then(setChallenges).catch(() => {});
  }, [account]);

  useEffect(() => {
    if (hash && decks) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [hash, decks]);

  const subjectNames = useMemo(() => filterSubjects(listed, decks ?? []), [listed, decks]);
  // A remembered subject that's gone from the list and from every deck shows all decks again.
  const subject = filter === ALL ? ALL : subjectNames.find((n) => sameSubject(n, filter)) ?? ALL;
  const pick = (s: string) => {
    setFilter(s);
    storeFilter(s);
  };
  const countOf = (s: string) => (decks ?? []).filter((d) => sameSubject(subjectOf(d), s)).length;
  const shown = (decks ?? []).filter((d) => subject === ALL || sameSubject(subjectOf(d), subject));

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
        {openReports > 0 && (
          <Link className="notice" to="/admin#reports">
            <b>
              {openReports} problem {openReports === 1 ? "report is" : "reports are"} waiting for you.
            </b>
            <span>Read and reply →</span>
          </Link>
        )}
        {reportReplies > 0 && (
          <Link className="notice" to="/report">
            <b>You have a reply about a problem you reported.</b>
            <span>Read it →</span>
          </Link>
        )}
        {account?.offer && <PromotionOffer offer={account.offer} onDone={refresh} />}
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
              const q = new URLSearchParams();
              if (topic.trim()) q.set("topic", topic.trim());
              if (subject !== ALL) q.set("subject", subject);
              navigate(`/create${q.toString() ? `?${q}` : ""}`);
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
            {decks && (
              <span className="muted">
                {subject === ALL ? decks.length : `${shown.length} of ${decks.length}`} {decks.length === 1 ? "deck" : "decks"}
              </span>
            )}
          </div>
          {!!decks?.length && subjectNames.length > 1 && (
            <div className="seg" role="group" aria-label="Show decks in subject" style={{ alignSelf: "flex-start" }}>
              {[ALL, ...subjectNames].map((s) => (
                <button key={s} type="button" aria-pressed={subject === s} onClick={() => pick(s)}>
                  {s} <span style={{ fontWeight: 500, opacity: 0.8 }}>{s === ALL ? decks.length : countOf(s)}</span>
                </button>
              ))}
            </div>
          )}
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
          ) : shown.length === 0 ? (
            <div className="panel stack">
              <p>You don't have any {subject} decks yet.</p>
              <div>
                <Link className="btn" to={`/create?subject=${encodeURIComponent(subject)}`}>
                  <Icon name="sparkle" /> Build a {subject} deck
                </Link>
              </div>
            </div>
          ) : (
            <div className="decks">
              {shown.map((d) => {
                const b = best(d.id);
                const mine = d.ownerId === user.uid;
                const drop = () => setDecks((all) => all?.filter((x) => x.id !== d.id) ?? null);
                return (
                  <article key={d.id} className="panel deck-card">
                    <div>
                      <h3>{d.title}</h3>
                      <div className="meta">
                        {subject === ALL && `${subjectOf(d)} · `}
                        {d.level} · {d.difficulty} · {d.questionCount} questions
                      </div>
                      {mine ? (
                        !!d.sharedWith?.length && <div className="meta">Shared with {d.sharedWith.length} {d.sharedWith.length === 1 ? "person" : "people"}</div>
                      ) : (
                        <div className="meta">Shared with you{d.sharedBy ? ` by ${d.sharedBy}` : ""}</div>
                      )}
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
                      {mine ? <DeleteDeck deck={d} onDeleted={drop} /> : <RemoveSharedDeck deck={d} onRemoved={drop} />}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <Challenges sent={challenges.sent} played={challenges.played} />

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

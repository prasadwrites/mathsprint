import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Figure from "../components/Figure";
import DeleteDeck from "../components/DeleteDeck";
import AssignTest from "../components/AssignTest";
import ShareDeck from "../components/ShareDeck";
import RemoveSharedDeck from "../components/RemoveSharedDeck";
import PublicTestLinks from "../components/PublicTestLinks";
import { useIsAdmin, useUser } from "../App";
import TopBar, { Chip, Icon } from "../components/TopBar";
import { getDeck, getQuestions } from "../lib/db";
import { formatClock } from "../lib/pace";
import type { Deck, Question } from "../lib/types";

const LEVELS = [
  ["Easy", "var(--good)"],
  ["Medium", "var(--accent)"],
  ["Hard", "var(--miss)"],
] as const;

export default function DeckReview() {
  const { deckId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useUser();
  const admin = useIsAdmin();
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    getDeck(deckId).then(setDeck);
    getQuestions(deckId).then(setQuestions);
  }, [deckId]);

  const back = { to: "/#decks", label: "My decks" };
  if (deck === undefined) return <><TopBar back={back} /><main className="page"><span className="spinner" /></main></>;
  if (deck === null) return <><TopBar back={back} /><main className="page"><p>This deck doesn't exist or isn't yours.</p></main></>;

  const mine = deck.ownerId === user.uid;
  const dropped = Number(params.get("dropped") || 0);
  const verified = questions.length > 0 && questions.every((q) => q.verified);
  const spread = LEVELS.map(([l, c]) => ({ l, c, n: questions.filter((q) => q.difficulty === l).length }));

  return (
    <>
      <TopBar back={back} />
      <main className="page narrow">
        <div className="stack">
          {verified && (
            <div className="row">
              <Chip tone="good">
                <Icon name="check" size={14} /> {params.get("fresh") ? "Deck ready · " : ""}all {questions.length} answers verified
              </Chip>
              {dropped > 0 && (
                <span className="muted">
                  {dropped} question{dropped > 1 ? "s" : ""} failed the answer check and {dropped > 1 ? "were" : "was"} left out.
                </span>
              )}
            </div>
          )}
          <div>
            <div className="eyebrow">
              {deck.level} · {deck.difficulty}
              {deck.createdAt && ` · Created ${deck.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
              {!mine && ` · Shared with you${deck.sharedBy ? ` by ${deck.sharedBy}` : ""}`}
            </div>
            <h1>{deck.title}</h1>
          </div>
          <div className="row">
            {deck.topics.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
          <div className="row">
            <Link className="btn btn-primary btn-big" to={`/decks/${deck.id}/practice`}>
              <Icon name="play" /> Start practice
            </Link>
            {mine ? (
              <DeleteDeck deck={deck} onDeleted={() => navigate("/#decks", { replace: true })} />
            ) : (
              <RemoveSharedDeck deck={deck} onRemoved={() => navigate("/#decks", { replace: true })} />
            )}
          </div>
        </div>

        <div className="tiles">
          <div className="tile">
            <span className="label">Questions</span>
            <span className="value">{questions.length}</span>
          </div>
          <div className="tile">
            <span className="label">Difficulty spread</span>
            <div className="spread-bar" aria-hidden>
              {spread.map((s) => s.n > 0 && <i key={s.l} style={{ flexGrow: s.n, background: s.c }} />)}
            </div>
            <span style={{ fontSize: 14 }}>{spread.map((s) => `${s.n} ${s.l.toLowerCase()}`).join(" · ")}</span>
          </div>
          <div className="tile">
            <span className="label">Suggested time</span>
            <span className="value">{formatClock(questions.length * 90)}</span>
          </div>
        </div>

        {mine && <ShareDeck deck={deck} />}
        {mine && <AssignTest deck={deck} suggestedSec={questions.length * 90} />}
        {mine && admin && <PublicTestLinks deck={deck} suggestedSec={questions.length * 90} />}

        <div className="panel">
          <div className="row spread">
            <h2>Questions</h2>
            <span className="muted">Answers stay hidden until after you practice</span>
          </div>
          <ul className="qlist" style={{ marginTop: 12 }}>
            {questions.map((q, i) => (
              <li key={q.id}>
                <span className="n">{i + 1}</span>
                <span className="q">
                  {q.prompt} <span className="mono">{q.math}</span>
                  {q.figure && <Figure figure={q.figure} small />}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Chip>{q.concept}</Chip>
                  <Chip tone={q.difficulty === "Hard" ? "miss" : "neutral"}>{q.difficulty}</Chip>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}

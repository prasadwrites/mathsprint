import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import TopBar, { Chip } from "../components/TopBar";
import { getDeck, getQuestions } from "../lib/db";
import type { Deck, Question } from "../lib/types";

export default function DeckReview() {
  const { deckId = "" } = useParams();
  const [params] = useSearchParams();
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [questions, setQuestions] = useState<Question[]>([]);

  useEffect(() => {
    getDeck(deckId).then(setDeck);
    getQuestions(deckId).then(setQuestions);
  }, [deckId]);

  if (deck === undefined) return <div className="wrap"><span className="spinner" /></div>;
  if (deck === null) return <div className="wrap"><TopBar back={{ to: "/", label: "My decks" }} /><p>This deck doesn't exist or isn't yours.</p></div>;

  const dropped = Number(params.get("dropped") || 0);
  return (
    <div className="wrap">
      <TopBar back={{ to: "/", label: "My decks" }} />
      <div className="stack">
        {params.get("fresh") && (
          <div className="row">
            <Chip tone="good">✓ Deck ready · all {deck.questionCount} answers verified</Chip>
            {dropped > 0 && <span className="muted">{dropped} question{dropped > 1 ? "s" : ""} failed the answer check and were left out.</span>}
          </div>
        )}
        <div>
          <div className="eyebrow">
            {deck.level} · {deck.difficulty}
            {deck.createdAt && ` · Created ${deck.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
          </div>
          <h1>{deck.title}</h1>
        </div>
        <div className="row">
          {deck.topics.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
        <Link className="btn btn-primary btn-big" to={`/decks/${deck.id}/practice`} style={{ textDecoration: "none", textAlign: "center" }}>
          ▶ Start practice
        </Link>
        <div className="panel">
          <div className="row spread">
            <h2>{deck.questionCount} questions</h2>
            <span className="muted">Answers stay hidden until you practise</span>
          </div>
          <ul className="qlist" style={{ marginTop: 12 }}>
            {questions.map((q, i) => (
              <li key={q.id}>
                <span className="n">{i + 1}</span>
                <span className="q">
                  {q.prompt} <span className="mono">{q.math}</span>
                </span>
                <Chip>{q.concept}</Chip>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Figure from "../components/Figure";
import EditQuestion from "../components/EditQuestion";
import DeleteDeck from "../components/DeleteDeck";
import RenameDeck from "../components/RenameDeck";
import DuplicateDeck, { CopyNamePrompt } from "../components/DuplicateDeck";
import AssignTest from "../components/AssignTest";
import ShareDeck from "../components/ShareDeck";
import RemoveSharedDeck from "../components/RemoveSharedDeck";
import PublicTestLinks from "../components/PublicTestLinks";
import QuestionPosts from "../components/QuestionPosts";
import { useIsAdmin, useUser } from "../App";
import TopBar, { Chip, Icon } from "../components/TopBar";
import { getDeck, getQuestions } from "../lib/db";
import { subjectOf } from "../lib/subjects";
import { formatClock } from "../lib/pace";
import type { Deck, Question } from "../lib/types";

const LEVELS = [
  ["Easy", "var(--good)"],
  ["Medium", "var(--accent)"],
  ["Hard", "var(--miss)"],
] as const;

export default function DeckReview() {
  const { deckId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useUser();
  const admin = useIsAdmin();
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [postPick, setPostPick] = useState<{ id: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Questions show as one line each; these are the ones opened to full size.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  useEffect(() => {
    setDeck(undefined);
    getDeck(deckId).then(setDeck);
    getQuestions(deckId).then(setQuestions);
  }, [deckId]);

  const back = { to: "/#decks", label: "My decks" };
  if (deck === undefined) return <><TopBar back={back} /><main className="page"><span className="spinner" /></main></>;
  if (deck === null) return <><TopBar back={back} /><main className="page"><p>This deck doesn't exist or isn't yours.</p></main></>;

  const mine = deck.ownerId === user.uid;
  const dropped = Number(params.get("dropped") || 0);
  // Just made with Duplicate: ask whether to change the copy's name.
  const copied = mine && params.has("copied");
  const verified = questions.length > 0 && questions.every((q) => q.verified);
  const typed = questions.filter((q) => q.type !== "choice").length;
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
              {subjectOf(deck)} · {deck.level} · {deck.difficulty}
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
              <>
                {!copied && <RenameDeck deck={deck} onRenamed={(title) => setDeck({ ...deck, title })} />}
                <DuplicateDeck deck={deck} onDuplicated={(c) => navigate(`/decks/${c.deckId}?copied=1`)} />
                <DeleteDeck deck={deck} onDeleted={() => navigate("/#decks", { replace: true })} />
              </>
            ) : (
              <RemoveSharedDeck deck={deck} onRemoved={() => navigate("/#decks", { replace: true })} />
            )}
          </div>
          {copied && <CopyNamePrompt deck={deck} onRenamed={(title) => setDeck({ ...deck, title })} onDone={() => setParams({}, { replace: true })} />}
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
        {mine && <AssignTest deck={deck} suggestedSec={questions.length * 90} typed={typed} />}
        {mine && admin && <PublicTestLinks deck={deck} total={questions.length} suggestedSec={questions.length * 90} typed={typed} />}
        {mine && admin && <QuestionPosts deck={deck} questions={questions} pick={postPick} />}

        <div className="panel">
          <div className="row spread">
            <h2>Questions</h2>
            {questions.length > 0 && (
              <button
                type="button"
                className="btn-link"
                onClick={() => setOpen(open.size === questions.length ? new Set() : new Set(questions.map((q) => q.id)))}
              >
                {open.size === questions.length ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Tap a question to see it in full. Answers stay hidden until after you practice{mine ? ", or until you edit a question" : ""}.
          </p>
          <ul className="qlist" style={{ marginTop: 12 }}>
            {questions.map((q, i) => {
              const full = open.has(q.id) || editing === q.id;
              return (
                <li key={q.id} className={full ? "open" : "closed"}>
                  <span className="n">{i + 1}</span>
                  {full ? (
                    <span className="q">
                      <button type="button" className="qline-toggle" aria-expanded onClick={() => toggle(q.id)}>
                        <span className="qfull">
                          {q.prompt} <span className="mono">{q.math}</span>
                        </span>
                        <span className="chev"><Icon name="chevron" size={16} /></span>
                      </button>
                      {q.figure && <Figure figure={q.figure} small />}
                    </span>
                  ) : (
                    <button type="button" className="q qline-toggle" aria-expanded={false} onClick={() => toggle(q.id)}>
                      <span className="qline">
                        {q.prompt} {q.math && <span className="mono">{q.math}</span>}
                        {q.figure && <span className="muted"> · with a picture</span>}
                      </span>
                      <span className="chev"><Icon name="chevron" size={16} /></span>
                    </button>
                  )}
                  <span className="row" style={{ gap: 6 }}>
                    <Chip tone={q.difficulty === "Hard" ? "miss" : "neutral"}>{q.difficulty}</Chip>
                    {full && <Chip>{q.concept}</Chip>}
                    {full && mine && admin && (
                      <button type="button" className="btn-link" onClick={() => setPostPick({ id: q.id })} aria-label={`Make a post of question ${i + 1}`}>
                        Post it
                      </button>
                    )}
                    {full && mine && editing !== q.id && (
                      <button type="button" className="btn-link" onClick={() => setEditing(q.id)} aria-label={`Edit question ${i + 1}`}>
                        Edit
                      </button>
                    )}
                  </span>
                  {editing === q.id && (
                    <EditQuestion
                      deckId={deck.id}
                      subject={subjectOf(deck)}
                      question={q}
                      onCancel={() => setEditing(null)}
                      onSaved={(saved) => {
                        setQuestions(questions.map((x) => (x.id === saved.id ? saved : x)));
                        setEditing(null);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </>
  );
}

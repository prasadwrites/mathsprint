import { useEffect, useRef, useState } from "react";
import ShareButtons from "./ShareButtons";
import { createQuestionPost, deleteQuestionPost, listQuestionPosts } from "../lib/db";
import { questionPostCard, questionPostLink } from "../lib/questionPost";
import type { Deck, Question, QuestionPost } from "../lib/types";

const short = (q: Pick<Question, "prompt" | "math">, n = 70) => {
  const text = [q.prompt, q.math].filter(Boolean).join(" ");
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

function PostCard({ post, onChange }: { post: QuestionPost; onChange: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = questionPostLink(post.token);
  const rate = post.answers ? Math.round((100 * post.right) / post.answers) : null;
  return (
    <div className="panel stack" style={{ boxShadow: "none" }}>
      <div className="row spread">
        <b>
          Question {post.featured + 1}: {short(post.question)}
        </b>
        <a className="btn btn-small" href={link} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <a href={questionPostCard(post.token)} target="_blank" rel="noreferrer" aria-label="The post's picture, full size">
        <img className="post-card" src={questionPostCard(post.token)} alt={`The post's picture: Can you solve this? ${short(post.question, 200)}`} loading="lazy" />
      </a>
      <div className="challenge-share">
        <input type="text" readOnly value={link} aria-label="Question post link" onFocus={(e) => e.target.select()} />
      </div>
      <div className="muted small">
        {post.views} {post.views === 1 ? "visit" : "visits"} · {post.answers} answered{rate !== null ? ` (${rate}% right)` : ""} · {post.more} more questions tried ·{" "}
        {post.saved} saved the deck
      </div>
      <ShareButtons link={link} text={post.shareText} card={questionPostCard(post.token)} title="MathSprint question" />
      {asking ? (
        <div className="confirm-delete" role="alertdialog" aria-label="Delete this post">
          <p>
            <b>Delete this post?</b> Its link stops working for anyone who sees it. Decks people already saved from it stay theirs.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-small btn-danger-solid"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await deleteQuestionPost(post.token).catch(() => {});
                onChange();
              }}
            >
              {busy ? "Deleting…" : "Delete post"}
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-small btn-danger" onClick={() => setAsking(true)}>
            Delete post
          </button>
        </div>
      )}
    </div>
  );
}

/** Admin only, on a deck's page: social media posts of single questions. `pick` is a question chosen from the list below. */
export default function QuestionPosts({ deck, questions, pick }: { deck: Deck; questions: Question[]; pick: { id: string } | null }) {
  const [posts, setPosts] = useState<QuestionPost[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const section = useRef<HTMLElement>(null);

  const load = () => listQuestionPosts(deck.id).then(setPosts).catch(() => setPosts([]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);
  useEffect(() => {
    if (!chosen && questions.length) setChosen(questions[0].id);
  }, [questions, chosen]);
  useEffect(() => {
    if (!pick) return;
    setChosen(pick.id);
    section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [pick]);

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await createQuestionPost(deck.id, chosen);
      setPosts((ps) => [p, ...(ps ?? [])]);
    } catch (e) {
      setError((e as Error).message || "The post wasn't made. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" ref={section} id="question-posts">
      <div>
        <h2>Question post</h2>
        <p className="muted">
          Turn one question into a social media post: a picture of the question with an "Answer it" button, and a link. Anyone who taps it answers
          right away with no account, sees the solution, then gets more questions from this deck and an offer to save the whole deck with a free
          account.
        </p>
      </div>
      <form
        className="row"
        style={{ gap: 12, alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          make();
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <label htmlFor="post-question">Question</label>
          <select id="post-question" value={chosen} onChange={(e) => setChosen(e.target.value)} style={{ width: "100%" }}>
            {questions.map((q, i) => (
              <option key={q.id} value={q.id}>
                {i + 1}. {short(q)}
                {q.figure ? " (with figure)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !chosen}>
          {busy ? "Making the post…" : "Make a post"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {posts === null ? <span className="spinner" /> : posts.map((p) => <PostCard key={p.token} post={p} onChange={load} />)}
    </section>
  );
}

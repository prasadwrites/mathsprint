import { useEffect, useState } from "react";
import Leaderboard from "./Leaderboard";
import ShareButtons from "./ShareButtons";
import { Chip } from "./TopBar";
import { createPublicTest, deletePublicTest, listPublicTests, publicTestPlayers, removePublicPlayer } from "../lib/db";
import { formatClock } from "../lib/pace";
import { publicTestCard, publicTestLink } from "../lib/publicTest";
import type { Deck, PublicPlayer, PublicTest } from "../lib/types";

/** Everyone who played one link, signed up or not, with a way to take a result off the leaderboard. */
function Players({ test, onChange }: { test: PublicTest; onChange: () => void }) {
  const [players, setPlayers] = useState<PublicPlayer[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    publicTestPlayers(test.token)
      .then(setPlayers)
      .catch((e) => setError((e as Error).message || "Couldn't load the players."));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.token]);

  if (error) return <p className="error">{error}</p>;
  if (!players) return <span className="spinner" />;
  if (!players.length) return <p className="muted">Nobody has played this link yet.</p>;
  return (
    <ul className="players">
      {players.map((p) => (
        <li key={p.attempt}>
          <span className="board-name">{p.name}</span>
          {p.status === "completed" ? (
            <span className="mono">
              {p.score}/{test.total} · {formatClock(p.usedSec ?? 0)}
            </span>
          ) : (
            <span className="muted small">didn't finish</span>
          )}
          {p.registered ? <Chip tone="good">On leaderboard</Chip> : <Chip>Not signed up</Chip>}
          <button
            type="button"
            className="btn-link danger"
            onClick={async () => {
              if (!window.confirm(`Remove ${p.name}'s result${p.registered ? " from the leaderboard" : ""}?`)) return;
              await removePublicPlayer(test.token, p.attempt).catch(() => {});
              load();
              onChange();
            }}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

function LinkCard({ test, onChange }: { test: PublicTest; onChange: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = publicTestLink(test.token);
  return (
    <div className="panel stack" style={{ boxShadow: "none" }}>
      <div className="row spread">
        <div className="muted small">
          {test.timeLimitSec ? `${formatClock(test.timeLimitSec)} limit` : "No time limit"} · {test.plays} played · {test.finished} finished · {test.ranked} on the leaderboard
        </div>
        <a className="btn btn-small" href={link} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <div className="challenge-share">
        <input type="text" readOnly value={link} aria-label="Public test link" onFocus={(e) => e.target.select()} />
      </div>
      {test.board.length > 0 && <Leaderboard rows={test.board} total={test.total} />}
      <ShareButtons link={link} text={test.shareText} card={publicTestCard(test.token)} title="MathSprint leaderboard" />
      <details>
        <summary>Everyone who played</summary>
        <div style={{ marginTop: 8 }}>
          <Players test={test} onChange={onChange} />
        </div>
      </details>
      {asking ? (
        <div className="confirm-delete" role="alertdialog" aria-label="Delete this link">
          <p>
            <b>Delete this link?</b> It stops working, and its leaderboard and everyone's results are deleted for good.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-small btn-danger-solid"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await deletePublicTest(test.token).catch(() => {});
                onChange();
              }}
            >
              {busy ? "Deleting…" : "Delete link"}
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(false)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-small btn-danger" onClick={() => setAsking(true)}>
            Delete link
          </button>
        </div>
      )}
    </div>
  );
}

/** Admin only, on a deck's page: public links anyone can play without an account, each with its own leaderboard. */
export default function PublicTestLinks({ deck, suggestedSec }: { deck: Deck; suggestedSec: number }) {
  const [tests, setTests] = useState<PublicTest[] | null>(null);
  const [timed, setTimed] = useState(true);
  const [minutes, setMinutes] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => listPublicTests(deck.id).then(setTests).catch(() => setTests([]));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.id]);
  useEffect(() => setMinutes(Math.max(1, Math.ceil(suggestedSec / 60))), [suggestedSec]);

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      const t = await createPublicTest(deck.id, timed ? minutes * 60 : 0);
      setTests((ts) => [t, ...(ts ?? [])]);
    } catch (e) {
      setError((e as Error).message || "The link wasn't made. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <div>
        <h2>Public test link</h2>
        <p className="muted">
          Anyone with the link can take this deck as a test with just a name, no account. Players who sign up afterwards go on the leaderboard, ranked by
          right answers, then time. Share it and the post shows the top of the leaderboard.
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
        <div>
          <label htmlFor="public-minutes">Time limit</label>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <input
              id="public-minutes"
              type="number"
              min={1}
              max={360}
              value={minutes}
              disabled={!timed}
              onChange={(e) => setMinutes(Math.max(1, Math.min(360, Number(e.target.value) || 1)))}
              style={{ width: 90 }}
            />
            <span className="muted">min</span>
            <label className="radio" style={{ whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={!timed} onChange={(e) => setTimed(!e.target.checked)} /> No limit
            </label>
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Making the link…" : tests?.length ? "Make another link" : "Make a public link"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {tests === null ? <span className="spinner" /> : tests.map((t) => <LinkCard key={t.token} test={t} onChange={load} />)}
    </section>
  );
}

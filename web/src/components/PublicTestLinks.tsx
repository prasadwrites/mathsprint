import { useEffect, useState } from "react";
import Leaderboard from "./Leaderboard";
import ShareButtons from "./ShareButtons";
import { Chip } from "./TopBar";
import { createPublicTest, deletePublicTest, listPublicTests, publicTestPlayers, removePublicPlayer, setPublicSamples } from "../lib/db";
import { formatClock } from "../lib/pace";
import ChoicesOnly, { choicesNote } from "./ChoicesOnly";
import { publicTestCard, publicTestLink } from "../lib/publicTest";
import { parseSampleLines, sampleLines } from "../lib/samplePlayers";
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
          {p.sample ? (
            <Chip tone={p.showing ? "warn" : "neutral"}>{p.showing ? "Sample, on leaderboard" : "Sample, replaced"}</Chip>
          ) : p.registered ? (
            <Chip tone="good">On leaderboard</Chip>
          ) : (
            <Chip>Not signed up</Chip>
          )}
          <button
            type="button"
            className="btn-link danger"
            onClick={async () => {
              if (!window.confirm(p.sample ? `Remove the sample player ${p.name}?` : `Remove ${p.name}'s result${p.registered ? " from the leaderboard" : ""}?`)) return;
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

/** The admin's own sample players, one per line, for a post aimed at a country whose names aren't English, say. */
function SampleEditor({ id, value, onChange, total }: { id: string; value: string; onChange: (v: string) => void; total: number }) {
  const rows = parseSampleLines(value);
  return (
    <div style={{ flexBasis: "100%" }}>
      <label htmlFor={id}>Your sample players</label>
      <textarea
        id={id}
        rows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"One per line: name, score, time\nAarav Sharma, 18, 6:12\nப்ரியா, 17, 5:40\nYuki Tanaka, 15"}
        style={{ width: "100%", fontFamily: "inherit" }}
      />
      <p className="muted small">
        {rows.length} {rows.length === 1 ? "player" : "players"}. Names can be in any language. Scores are out of {total}; leave the time off and a
        believable one is picked.
      </p>
    </div>
  );
}

function LinkCard({ test, onChange }: { test: PublicTest; onChange: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filling, setFilling] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState("");
  const samples = async (fill: boolean, own?: string) => {
    setFilling(true);
    setSampleError("");
    try {
      await setPublicSamples(test.token, fill, own === undefined ? undefined : parseSampleLines(own));
      setEditing(null);
      onChange();
    } catch (e) {
      setSampleError((e as Error).message || "The sample players weren't saved. Try again.");
    } finally {
      setFilling(false);
    }
  };
  const link = publicTestLink(test.token);
  return (
    <div className="panel stack" style={{ boxShadow: "none" }}>
      <div className="row spread">
        <div className="muted small">
          {test.timeLimitSec ? `${formatClock(test.timeLimitSec)} limit` : "No time limit"}{choicesNote(test)} · {test.plays} played · {test.finished} finished · {test.ranked} on the leaderboard
        </div>
        <a className="btn btn-small" href={link} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      <div className="challenge-share">
        <input type="text" readOnly value={link} aria-label="Public test link" onFocus={(e) => e.target.select()} />
      </div>
      {test.board.length > 0 && <Leaderboard rows={test.board} total={test.total} />}
      <div className="row" style={{ gap: 8 }}>
        <span className="muted small">
          {test.samples
            ? `${test.samplesShowing} of ${test.samples} sample players on the board. Real players take their places as they sign up; visitors can't tell them apart.`
            : "No sample players."}
        </span>
        {editing === null && (
          <>
            <button type="button" className="btn-link" disabled={filling} onClick={() => setEditing(sampleLines(test.sampleList ?? []))}>
              {test.samples ? "Edit sample players" : "Add my own"}
            </button>
            <button type="button" className="btn-link" disabled={filling} onClick={() => samples(!test.samples)}>
              {filling ? "Saving…" : test.samples ? "Remove sample players" : "Add made-up players"}
            </button>
          </>
        )}
      </div>
      {editing !== null && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            samples(true, editing);
          }}
        >
          <SampleEditor id={`samples-${test.token}`} value={editing} onChange={setEditing} total={test.total} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-small btn-primary" type="submit" disabled={filling}>
              {filling ? "Saving…" : "Save sample players"}
            </button>
            <button className="btn btn-small" type="button" disabled={filling} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {sampleError && <p className="error">{sampleError}</p>}
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
export default function PublicTestLinks({ deck, total, suggestedSec, typed }: { deck: Deck; total: number; suggestedSec: number; typed: number }) {
  const [tests, setTests] = useState<PublicTest[] | null>(null);
  const [timed, setTimed] = useState(true);
  const [fill, setFill] = useState<"made-up" | "own" | "none">("made-up");
  const [own, setOwn] = useState("");
  const [minutes, setMinutes] = useState(1);
  const [choicesOnly, setChoicesOnly] = useState(false);
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
      const t = await createPublicTest(deck.id, timed ? minutes * 60 : 0, fill === "made-up", fill === "own" ? parseSampleLines(own) : undefined, choicesOnly);
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
          right answers, then time. Share it and the post shows the top of the leaderboard. Sample players fill a new board so the
          first post isn't empty; they step aside as real players join. Posting to another country? Enter your own names and scores.
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
        <div>
          <label htmlFor="public-fill">Sample players</label>
          <select id="public-fill" value={fill} onChange={(e) => setFill(e.target.value as typeof fill)}>
            <option value="made-up">Made-up names</option>
            <option value="own">My own names and scores</option>
            <option value="none">None</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Making the link…" : tests?.length ? "Make another link" : "Make a public link"}
        </button>
        <div style={{ flexBasis: "100%" }}>
          <ChoicesOnly id="public-choices" typed={typed} checked={choicesOnly} onChange={setChoicesOnly} />
        </div>
        {fill === "own" && <SampleEditor id="public-own" value={own} onChange={setOwn} total={total} />}
      </form>
      {error && <p className="error">{error}</p>}
      {tests === null ? <span className="spinner" /> : tests.map((t) => <LinkCard key={t.token} test={t} onChange={load} />)}
    </section>
  );
}

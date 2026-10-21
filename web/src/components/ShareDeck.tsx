import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listDeckShares, shareDeck, unshareDeck } from "../lib/db";
import type { Deck, DeckShare } from "../lib/types";

/** On the owner's deck page: share the deck with other registered users by email, and see or remove who has it. */
export default function ShareDeck({ deck }: { deck: Deck }) {
  const [shares, setShares] = useState<DeckShare[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    listDeckShares(deck.id).then(setShares).catch(() => setShares([]));
  }, [deck.id]);

  const submit = async () => {
    const to = email.trim();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await shareDeck(deck.id, to);
      setShares(r.shares);
      setEmail("");
      setNotice(r.added ? `Shared with ${to.toLowerCase()}. It's in their decks now.` : `${to.toLowerCase()} already has this deck.`);
    } catch (e) {
      setError((e as Error).message || "The deck wasn't shared. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: DeckShare) => {
    setRemoving(s.uid);
    setError("");
    setNotice("");
    try {
      setShares(await unshareDeck(deck.id, s.uid));
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
    } finally {
      setRemoving("");
    }
  };

  return (
    <section className="panel stack" id="share">
      <div>
        <h2>Share this deck</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Enter the email someone uses to sign in to MathSprint. The deck shows up in their decks so they can practice it, and it doesn't count toward their plan.
        </p>
      </div>
      <form
        className="row"
        style={{ alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div style={{ flex: "1 1 240px" }}>
          <label htmlFor="share-email">Their registered email</label>
          <input id="share-email" type="email" inputMode="email" autoComplete="off" required placeholder="classmate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sharing…" : "Share"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
          {error.startsWith("No MathSprint account") && (
            <>
              {" "}
              <Link to="/invite">Invite a friend</Link>
            </>
          )}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {shares && shares.length > 0 && (
        <ul className="requests">
          {shares.map((s) => (
            <li key={s.uid} className="request">
              <div className="row spread">
                <span style={{ overflowWrap: "anywhere" }}>
                  <b>{s.email}</b>
                  {s.name && <span className="muted"> · {s.name}</span>}
                </span>
                <button type="button" className="btn btn-small" disabled={removing === s.uid} onClick={() => remove(s)}>
                  {removing === s.uid ? "Removing…" : "Stop sharing"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

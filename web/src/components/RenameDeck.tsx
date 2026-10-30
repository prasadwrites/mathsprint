import { useState } from "react";
import { MAX_TITLE, renameDeck } from "../lib/db";
import type { Deck } from "../lib/types";

/** A Rename button that opens a box for the deck's new name. Only for the deck's owner. With `startOpen` the box is open
 * from the start, and `onClose` runs when it's saved or cancelled. */
export default function RenameDeck({ deck, onRenamed, small, startOpen, onClose }: {
  deck: Pick<Deck, "id" | "title">;
  onRenamed: (title: string) => void;
  small?: boolean;
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const [title, setOpenTitle] = useState<string | null>(startOpen ? deck.title : null);
  const setTitle = (t: string | null) => {
    setOpenTitle(t);
    if (t === null) onClose?.();
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (title === null) {
    return (
      <button type="button" className={`btn ${small ? "btn-small" : ""}`} onClick={() => { setTitle(deck.title); setError(""); }}>
        Rename
      </button>
    );
  }
  const next = title.trim();
  return (
    <form
      className="rename-deck"
      aria-label={`Rename ${deck.title}`}
      style={{ flexBasis: "100%" }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!next) return;
        if (next === deck.title) return setTitle(null);
        setBusy(true);
        setError("");
        try {
          await renameDeck(deck.id, next);
          onRenamed(next);
          setTitle(null);
        } catch (err) {
          setError((err as Error).message || "The deck wasn't renamed. Try again.");
        }
        setBusy(false);
      }}
    >
      <label htmlFor={`rename-${deck.id}`}>New name</label>
      <input
        id={`rename-${deck.id}`}
        type="text"
        autoFocus
        maxLength={MAX_TITLE}
        value={title}
        onFocus={(e) => startOpen && e.target.select()}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && !busy && setTitle(null)}
      />
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-small btn-primary" disabled={busy || !next}>
          {busy ? "Saving…" : "Save name"}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => setTitle(null)}>
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

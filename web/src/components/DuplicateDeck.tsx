import { useState } from "react";
import { duplicateDeck } from "../lib/db";
import type { Deck } from "../lib/types";
import RenameDeck from "./RenameDeck";

/** A Duplicate button for the deck's owner. The copy is named "<name> (copy)"; `onDuplicated` gets its id and name. */
export default function DuplicateDeck({ deck, onDuplicated, small }: { deck: Pick<Deck, "id" | "title">; onDuplicated: (copy: { deckId: string; title: string }) => void; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={`btn ${small ? "btn-small" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            onDuplicated(await duplicateDeck(deck.id));
          } catch (e) {
            setError((e as Error).message || "The deck wasn't copied. Try again.");
          }
          setBusy(false);
        }}
      >
        {busy ? "Copying…" : "Duplicate"}
      </button>
      {error && <p className="error" style={{ flexBasis: "100%" }}>{error}</p>}
    </>
  );
}

/** Shown on a copy just made: asks whether to change its name, and opens the rename box if so. */
export function CopyNamePrompt({ deck, onRenamed, onDone }: { deck: Pick<Deck, "id" | "title">; onRenamed: (title: string) => void; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <RenameDeck deck={deck} onRenamed={onRenamed} startOpen onClose={onDone} />;
  return (
    <div className="rename-deck" role="dialog" aria-label="Name the copy" style={{ flexBasis: "100%" }}>
      <p style={{ margin: 0 }}>
        <b>Copy made: “{deck.title}”.</b> Do you want to change its name?
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-small btn-primary" autoFocus onClick={() => setEditing(true)}>
          Change name
        </button>
        <button type="button" className="btn btn-small" onClick={onDone}>
          Keep this name
        </button>
      </div>
    </div>
  );
}

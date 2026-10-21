import { useState } from "react";
import { unshareDeck } from "../lib/db";
import type { Deck } from "../lib/types";

/** For a deck someone shared with you: takes it out of your decks, after asking. The owner keeps it. */
export default function RemoveSharedDeck({ deck, onRemoved, small }: { deck: Pick<Deck, "id" | "title">; onRemoved: () => void; small?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!asking) {
    return (
      <button type="button" className={`btn ${small ? "btn-small" : ""}`} onClick={() => setAsking(true)}>
        Remove
      </button>
    );
  }
  return (
    <div className="confirm-delete" role="alertdialog" aria-label={`Remove ${deck.title}`} style={{ flexBasis: "100%" }}>
      <p>
        <b>Remove “{deck.title}” from your decks?</b> Your practice history for it is deleted too. You'd need its owner to share it again to get it back.
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-small btn-danger-solid"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await unshareDeck(deck.id);
              onRemoved();
            } catch (e) {
              setError((e as Error).message || "The deck wasn't removed. Try again.");
              setBusy(false);
            }
          }}
        >
          {busy ? "Removing…" : "Remove deck"}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

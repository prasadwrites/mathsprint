import { useState } from "react";
import { useAccount } from "../App";
import { deleteDeck } from "../lib/db";
import type { Deck } from "../lib/types";

/** A Delete button that asks first. Deleting doesn't give the deck back to the plan. */
export default function DeleteDeck({ deck, onDeleted, small }: { deck: Pick<Deck, "id" | "title" | "source">; onDeleted: () => void; small?: boolean }) {
  const { account, refresh } = useAccount();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!asking) {
    return (
      <button type="button" className={`btn ${small ? "btn-small" : ""} btn-danger`} onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  }
  const counted = deck.source === "ai" && account && !account.isAdmin;
  return (
    <div className="confirm-delete" role="alertdialog" aria-label={`Delete ${deck.title}`} style={{ flexBasis: "100%" }}>
      <p>
        <b>Delete “{deck.title}”?</b> Its questions and your practice history for it are deleted for good.
        {counted && ` It still counts as one of your ${account.maxDecks} decks, so deleting it won't let you build another.`}
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
              await deleteDeck(deck.id);
              refresh();
              onDeleted();
            } catch (e) {
              setError((e as Error).message || "The deck wasn't deleted. Try again.");
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete deck"}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

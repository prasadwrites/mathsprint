import { useState } from "react";
import { useUser } from "../App";
import { hidePublicDeck } from "../lib/db";
import type { Deck } from "../lib/types";

/** For one of the admin's public decks on a student's home page: takes it off their decks only, after asking. The deck
 * stays public for everyone else, and the student's practice history for it stays in their progress. */
export default function HidePublicDeck({ deck, onHidden, small }: { deck: Pick<Deck, "id" | "title">; onHidden: () => void; small?: boolean }) {
  const user = useUser();
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
  return (
    <div className="confirm-delete" role="alertdialog" aria-label={`Delete ${deck.title} from your decks`} style={{ flexBasis: "100%" }}>
      <p>
        <b>Delete “{deck.title}” from your decks?</b> It's a MathSprint deck, so it only goes from your home page. Your practice history for it stays in your
        progress, and you can bring it back from the bottom of your decks.
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
              await hidePublicDeck(user.uid, deck.id);
              onHidden();
            } catch (e) {
              setError((e as Error).message || "The deck wasn't deleted. Try again.");
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete from my decks"}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={() => setAsking(false)}>
          Keep it
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

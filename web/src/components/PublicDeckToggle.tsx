import { useState } from "react";
import { setDeckPublic } from "../lib/db";
import type { Deck } from "../lib/types";

/** Admin only, on the admin's own deck page: makes the deck public, so it's on every user's home page and listed on
 * the sign-in page, or private again. Users who deleted it from their decks don't get it back. */
export default function PublicDeckToggle({ deck, onChanged }: { deck: Pick<Deck, "id" | "public" | "questionCount">; onChanged: (isPublic: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const on = !!deck.public;
  return (
    <section className="panel stack" aria-labelledby="public-deck">
      <div className="row spread">
        <h2 id="public-deck" style={{ margin: 0 }}>Public deck</h2>
        <span className="muted">{on ? "Public" : "Private"}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {on
          ? "Everyone signed in has this deck on their home page, and it's listed on the sign-in page, where visitors can set up a practice and sign up to start it. A user who deletes it only takes it off their own home page. It doesn't count toward anyone's plan."
          : "Make it public to put it on every user's home page and list it on the sign-in page. It doesn't count toward their plan, and only you can edit it."}
      </p>
      <div>
        <button
          type="button"
          className={on ? "btn" : "btn btn-primary"}
          disabled={busy || (!on && !deck.questionCount)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await setDeckPublic(deck.id, !on);
              onChanged(!on);
            } catch (e) {
              setError((e as Error).message || "That didn't save. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : on ? "Make private" : "Make public"}
        </button>
      </div>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}

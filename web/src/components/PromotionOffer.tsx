import { useState } from "react";
import { respondPromotion } from "../lib/db";
import type { PromotionOffer as Offer } from "../lib/types";

const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

/** The admin's offer of a bigger plan for a while, on the home page until the user answers it. */
export default function PromotionOffer({ offer, onDone }: { offer: Offer; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = async (accept: boolean) => {
    setBusy(true);
    setError("");
    try {
      await respondPromotion(offer.id, accept);
      onDone();
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
      setBusy(false);
    }
  };
  return (
    <section className="offer" aria-label="Promotion offer">
      <div className="stack" style={{ gap: 4 }}>
        <b>
          You've been offered {offer.planLabel} free for {months(offer.months)}.
        </b>
        {offer.note && <span>{offer.note}</span>}
        <span className="small muted">It starts when you accept. Afterwards your account goes back to its current plan.</span>
        {error && <span className="error">{error}</span>}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => answer(true)}>
          Accept {offer.planLabel}
        </button>
        <button className="btn" disabled={busy} onClick={() => answer(false)}>
          No thanks
        </button>
      </div>
    </section>
  );
}

import { useState } from "react";
import { createCheckout } from "../lib/db";
import type { PlanId } from "../lib/types";

/** Square's "Pay now" card for one plan. It opens a checkout made for this student, and Square brings them back to
 * /upgrade?paid=PLAN once they've paid; the plan switches as soon as Square confirms the payment. */
export default function SquarePay({ plan }: { plan: PlanId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (plan === "free") return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="square-pay">
        <button
          type="button"
          className="square-pay-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              window.location.assign(await createCheckout(plan));
            } catch (e) {
              setError((e as Error).message || "Square checkout didn't open. Try again in a minute.");
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening checkout…" : "Pay now"}
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

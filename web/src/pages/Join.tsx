import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import TopBar from "../components/TopBar";
import { useAccount } from "../App";
import { redeemOfferCode } from "../lib/db";
import { cleanCode, codeFromUrl } from "../lib/offerCode";
import type { RedeemedOffer } from "../lib/types";

/** How redeeming went for a code entered on the sign-up form (App redeems it right after signing in). */
export type JoinResult = { code: string; redeemed: RedeemedOffer } | { code: string; error: string };

const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const monthsLabel = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

function Redeemed({ r }: { r: RedeemedOffer }) {
  return (
    <div className="offer" role="status">
      <div className="stack" style={{ gap: 4 }}>
        <b>
          You're on {r.planLabel} for {monthsLabel(r.months)}, until {longDate(r.endsAt)}.
        </b>
        <span className="small">
          After that your account goes back to {r.basePlanLabel}. Decks you build stay yours to practice and test with on any plan.
        </span>
      </div>
      <Link className="btn btn-primary" to="/create">
        Build a deck
      </Link>
    </div>
  );
}

/** /join for someone signed in: redeem an offer code from an email, or see how the one from the sign-up form went.
 * Keyed by location, since App navigates here again (with the result) when the sign-up form's code is redeemed. */
export default function Join() {
  return <JoinPage key={useLocation().key} />;
}

function JoinPage() {
  const { account, refresh } = useAccount();
  const from = useLocation().state as JoinResult | null;
  const [code, setCode] = useState(from?.code ?? codeFromUrl());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RedeemedOffer | null>(from && "redeemed" in from ? from.redeemed : null);
  const [error, setError] = useState(from && "error" in from ? from.error : "");

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = cleanCode(code);
    if (!c) return setError("Enter your offer code.");
    setBusy(true);
    setError("");
    try {
      setDone(await redeemOfferCode(c));
      refresh();
    } catch (err) {
      setError((err as Error).message || "That offer code couldn't be redeemed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page narrow">
        <h1>Redeem an offer code</h1>
        {done ? (
          <Redeemed r={done} />
        ) : (
          <>
            <p className="muted">
              Enter the code from your email to get its plan for the months it gives, starting today.
              {account?.promo && ` You're on ${account.promo.planLabel} until ${longDate(account.promo.endsAt)} right now.`}
            </p>
            <form className="panel stack" onSubmit={redeem}>
              <div>
                <label htmlFor="redeem-code">Offer code</label>
                <input
                  id="redeem-code"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="Such as MS-7KQP-X3DM"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Redeeming…" : "Redeem"}
              </button>
              {error && <p className="error">{error}</p>}
            </form>
          </>
        )}
        <p className="muted small">
          <Link to="/plans">Compare plans</Link> · <Link to="/upgrade">Upgrade</Link>
        </p>
      </main>
    </>
  );
}

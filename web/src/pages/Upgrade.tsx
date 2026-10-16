import { useEffect, useState } from "react";
import { useAccount } from "../App";
import TopBar, { Chip } from "../components/TopBar";
import { listUpgradeRequests, requestUpgrade } from "../lib/db";
import { PLANS, type PlanId, type UpgradeRequest } from "../lib/types";

const label = (id: PlanId) => PLANS.find((p) => p.id === id)?.label ?? id;
export const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

export default function Upgrade() {
  const { account, refresh } = useAccount();
  const [requests, setRequests] = useState<UpgradeRequest[] | null>(null);
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setRequests(await listUpgradeRequests(true));
      refresh(); // clears the reply notification
    } catch (e) {
      setError((e as Error).message || "Your requests couldn't be loaded.");
      setRequests([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const current = account?.plan ?? "free";
  const currentIndex = PLANS.findIndex((p) => p.id === current);
  const pending = requests?.find((r) => r.status === "pending");
  const choice = plan ?? PLANS[currentIndex + 1]?.id ?? null;

  const submit = async () => {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      await requestUpgrade(choice, message.trim());
      setMessage("");
      setPlan(null);
      await load();
    } catch (e) {
      setError((e as Error).message || "Your request didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page narrow">
        <h1>Upgrade your plan</h1>

        <div className="tiles">
          {PLANS.map((p, i) => {
            const isCurrent = p.id === current;
            const selectable = i > currentIndex && !pending;
            return (
              <button
                key={p.id}
                type="button"
                className={`tile plan-tile ${choice === p.id && selectable ? "selected" : ""}`}
                aria-pressed={selectable ? choice === p.id : undefined}
                disabled={!selectable}
                onClick={() => setPlan(p.id)}
              >
                <span className="row spread" style={{ width: "100%" }}>
                  <span className="label">{p.label}</span>
                  {isCurrent && <Chip>Your plan</Chip>}
                </span>
                <b className="mono" style={{ fontSize: 20 }}>
                  {p.decks} decks
                </b>
                <span className="label">up to {p.questions} questions each</span>
              </button>
            );
          })}
        </div>

        {account?.isAdmin ? (
          <p className="muted">The admin account has no limits.</p>
        ) : pending ? (
          <div className="panel stack">
            <div className="row" style={{ gap: 8 }}>
              <Chip tone="warn">Waiting for a reply</Chip>
              <span className="muted">You asked for {label(pending.requestedPlan)} on {when(pending.createdAt)}.</span>
            </div>
            <p className="muted">You'll see the reply here and on your home page.</p>
          </div>
        ) : choice ? (
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <h2>Ask for {label(choice)}</h2>
            <div>
              <label htmlFor="upgrade-note">
                Anything to add? <span className="muted">(optional)</span>
              </label>
              <textarea
                id="upgrade-note"
                maxLength={1000}
                placeholder="e.g. I'm preparing for the AP Calculus exam in May and need bigger decks."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">You're on the biggest plan.</p>
        )}
        {error && <p className="error">{error}</p>}

        {requests && requests.length > 0 && (
          <section className="stack">
            <h2>Your requests</h2>
            <ul className="requests">
              {requests.map((r) => (
                <li key={r.id} className="panel stack" style={{ gap: 8 }}>
                  <div className="row spread">
                    <b>
                      {label(r.currentPlan)} → {label(r.requestedPlan)}
                    </b>
                    {r.status === "pending" ? <Chip tone="warn">Waiting</Chip> : r.approved ? <Chip tone="good">Upgraded</Chip> : <Chip>Replied</Chip>}
                  </div>
                  <span className="small muted">Sent {when(r.createdAt)}</span>
                  {r.message && <p className="quote">{r.message}</p>}
                  {r.status === "replied" && (
                    <div className="reply">
                      <span className="small muted">Reply from MathSprint · {when(r.repliedAt)}</span>
                      {r.reply ? <p>{r.reply}</p> : <p>Your plan was upgraded to {label(r.requestedPlan)}.</p>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

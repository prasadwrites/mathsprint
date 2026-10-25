import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAccount } from "../App";
import SquarePay from "../components/SquarePay";
import TopBar, { Chip } from "../components/TopBar";
import { listUpgradeRequests, replyUpgrade, requestUpgrade } from "../lib/db";
import { PLANS, type PlanId, type RequestMessage, type UpgradeRequest } from "../lib/types";

const label = (id: PlanId) => PLANS.find((p) => p.id === id)?.label ?? id;
export const when = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** The messages on one request or report, oldest first. `viewer` decides which side reads as "You". */
export function Conversation({
  r,
  viewer,
  onDelete,
}: {
  r: { thread: RequestMessage[]; displayName: string; email: string; requestedPlan?: PlanId };
  viewer: "student" | "admin";
  /** Shows a Delete link on each message, with a confirm step. */
  onDelete?: (index: number, m: RequestMessage) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!r.thread.length) return <p className="small muted">No messages.</p>;
  return (
    <ol className="conversation">
      {r.thread.map((m, i) => {
        const mine = m.from === viewer;
        const who = mine ? "You" : m.from === "admin" ? "MathSprint" : r.displayName || r.email;
        return (
          <li key={i} className={`msg ${m.from === "admin" ? "from-admin" : "from-student"} ${mine ? "mine" : ""}`}>
            <span className="small muted">
              {who} · {when(m.at)}
            </span>
            {m.approved && r.requestedPlan && <span className="small"><b>Upgraded to {label(r.requestedPlan)}.</b></span>}
            {m.resolved && <span className="small"><b>Marked as resolved.</b></span>}
            {m.text && <p>{m.text}</p>}
            {onDelete &&
              (confirm === i ? (
                <span className="row small" style={{ gap: 8 }}>
                  Delete this message?
                  <button
                    type="button"
                    className="btn-link danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onDelete(i, m);
                        setConfirm(null);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="btn-link" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-link small muted msg-delete" aria-label={`Delete message from ${who}`} onClick={() => setConfirm(i)}>
                  Delete
                </button>
              ))}
          </li>
        );
      })}
    </ol>
  );
}

/** A textarea and Send button for writing back on a request. */
export function ReplyBox({ label: aria, placeholder, onSend, children }: { label: string; placeholder: string; onSend: (text: string, approve: boolean) => Promise<void>; children?: (text: string, busy: boolean, send: (approve: boolean) => void) => ReactNode }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (approve = false) => {
    setBusy(true);
    try {
      await onSend(text.trim(), approve);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send();
      }}
    >
      <textarea aria-label={aria} maxLength={1000} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row" style={{ gap: 8 }}>
        {children ? (
          children(text.trim(), busy, send)
        ) : (
          <button type="submit" className="btn-small btn-primary" disabled={busy || !text.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
        )}
      </div>
    </form>
  );
}

export default function Upgrade() {
  const { account, refresh } = useAccount();
  const [requests, setRequests] = useState<UpgradeRequest[] | null>(null);
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Square sends a student back here with ?paid=PLAN; the plan switches once Square tells us the payment completed.
  const [params] = useSearchParams();
  const paid = PLANS.find((p) => p.id === params.get("paid"))?.id ?? null;
  const [waited, setWaited] = useState(0);

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

  // Requests are for a lasting plan, so a running promotion doesn't count.
  const current = account?.basePlan ?? account?.plan ?? "free";
  const currentIndex = PLANS.findIndex((p) => p.id === current);
  const pending = requests?.find((r) => r.status === "pending" && !r.approved);
  const choice = plan ?? PLANS[currentIndex + 1]?.id ?? null;
  const paidIndex = paid ? PLANS.findIndex((p) => p.id === paid) : -1;
  const confirming = paidIndex > currentIndex && waited < 20;

  // Check every few seconds for a minute while the payment is confirmed.
  useEffect(() => {
    if (!confirming || !account) return;
    const t = setTimeout(() => {
      refresh();
      setWaited((n) => n + 1);
    }, 3000);
    return () => clearTimeout(t);
  }, [confirming, account, waited]);
  const switched = !!paid && !!account && paidIndex <= currentIndex;
  useEffect(() => {
    if (switched) load(); // show the payment on the request list
  }, [switched]);

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
        <div className="row spread">
          <h1>Upgrade your plan</h1>
          <Link to="/plans">Compare plans</Link>
        </div>
        {account?.promo && (
          <p className="notice" role="status">
            <b>
              You're on {account.promo.planLabel} until {new Date(account.promo.endsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} with a promotion.
            </b>{" "}
            After that you're back on {label(current)}, unless you upgrade.
          </p>
        )}

        {paid && account && !account.isAdmin && (
          switched ? (
            <p className="notice" role="status">
              <b>Thanks for your payment. You're on {label(current)} now.</b>
            </p>
          ) : confirming ? (
            <p className="notice" role="status">
              <b>Thanks! Square is confirming your payment.</b> Your plan switches to {label(paid)} in a few seconds.
            </p>
          ) : (
            <p className="notice" role="status">
              <b>We haven't heard from Square about your payment yet.</b> It can take a few minutes. If your plan hasn't switched to {label(paid)} soon, send us a request below and we'll sort it out.
            </p>
          )
        )}

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
            <div className="pay-step">
              <SquarePay plan={pending.requestedPlan} />
              <span className="muted">Haven't paid for {label(pending.requestedPlan)} yet? Pay here and your plan switches as soon as Square confirms it.</span>
            </div>
          </div>
        ) : choice ? (
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <h2>Upgrade to {label(choice)}</h2>
            <div className="stack" style={{ gap: 8 }}>
              <b>Pay with Square</b>
              <div className="pay-step">
                <SquarePay plan={choice} />
                <span className="muted">Your plan switches to {label(choice)} as soon as Square confirms the payment. No request needed.</span>
              </div>
            </div>
            <div>
              <label htmlFor="upgrade-note">
                <b>Or send us a request</b> if you paid another way or have a question. <span className="muted">(optional)</span>
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
                    {r.status === "pending" ? <Chip tone="warn">Waiting</Chip> : r.paid ? <Chip tone="good">Paid</Chip> : r.approved ? <Chip tone="good">Upgraded</Chip> : <Chip>Replied</Chip>}
                  </div>
                  <span className="small muted">Sent {when(r.createdAt)}</span>
                  <Conversation r={r} viewer="student" />
                  <ReplyBox
                    label="Write back"
                    placeholder="Write back to MathSprint"
                    onSend={async (text) => {
                      try {
                        await replyUpgrade(r.id, text);
                        setError("");
                        await load();
                      } catch (e) {
                        setError((e as Error).message || "Your message didn't send. Try again.");
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

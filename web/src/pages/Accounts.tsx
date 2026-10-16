import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar, { Chip } from "../components/TopBar";
import { useAccount } from "../App";
import { adminDeleteAccount, adminListAccounts, adminReplyUpgrade, adminUpdateAccount, listUpgradeRequests, type AccountUpdate } from "../lib/db";
import { PLANS, type AdminAccount, type PlanId, type PlanLimits, type UpgradeRequest } from "../lib/types";
import { when } from "./Upgrade";

const PLAN_ORDER: PlanId[] = ["free", "pro", "promax"];

const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

function AccountRow({
  a,
  plans,
  onChange,
  onDelete,
}: {
  a: AdminAccount;
  plans: Record<PlanId, PlanLimits>;
  onChange: (u: Omit<AccountUpdate, "uid">) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  // The admin types the email (or DELETE for accounts without one) so a stray click can't delete anyone.
  const confirmWord = a.email || "DELETE";
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const suspended = a.status === "suspended";
  const used = Math.min(100, (a.decksCreated / Math.max(1, a.maxDecks)) * 100);

  const run = async (u: Omit<AccountUpdate, "uid">) => {
    setBusy(true);
    try {
      await onChange(u);
      setEditing(false);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`acct ${suspended ? "suspended" : ""}`}>
      <div className="who-col">
        <div className="row" style={{ gap: 8 }}>
          <b>{a.displayName || a.email || "No name"}</b>
          {a.isAdmin && <Chip>Admin</Chip>}
          {suspended && <Chip tone="bad">Suspended</Chip>}
        </div>
        {a.displayName && <span className="small">{a.email}</span>}
        <span className="small">
          Joined {date(a.createdAt)} · last sign-in {date(a.lastSignInAt)}
        </span>
      </div>

      <div className="usage">
        {a.isAdmin ? (
          <span className="small">No limits on the admin account</span>
        ) : (
          <>
            <div className="seg" role="group" aria-label={`Plan for ${a.email}`}>
              {PLAN_ORDER.map((p) => (
                <button key={p} type="button" className="btn-small" aria-pressed={a.plan === p} disabled={busy} onClick={() => a.plan !== p && run({ plan: p })}>
                  {plans[p]?.label ?? p}
                </button>
              ))}
            </div>
            <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
              <div className="bar">
                <i style={{ width: `${used}%`, background: `var(--${used >= 100 ? "bad" : used >= 80 ? "warn" : "accent"})` }} />
              </div>
              <span className="small mono" style={{ whiteSpace: "nowrap" }}>
                {a.decksCreated}/{a.maxDecks} decks
              </span>
            </div>
            <span className="small">
              Up to {a.maxQuestions} questions a deck
              {a.decksCreated > 0 && (
                <>
                  {" · "}
                  <button type="button" className="btn-link" style={{ fontSize: 13 }} disabled={busy} onClick={() => confirm(`Reset the deck count for ${a.email}?`) && run({ resetDecks: true })}>
                    Reset count
                  </button>
                </>
              )}
            </span>
          </>
        )}
      </div>

      <div className="usage">
        {a.isAdmin ? (
          <span className="small">The admin doesn't need a code</span>
        ) : editing ? (
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim().length >= 6) run({ accessCode: code.trim() });
            }}
          >
            <input type="text" aria-label="New access code" placeholder="At least 6 characters" value={code} onChange={(e) => setCode(e.target.value)} autoFocus style={{ flex: 1, minWidth: 140 }} />
            <button type="submit" className="btn-small btn-primary" disabled={busy || code.trim().length < 6}>
              Save
            </button>
            <button type="button" className="btn-small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className="small">Access code</span>
            {a.accessCode ? <span className="code">{a.accessCode}</span> : <span className="small">Uses the shared code</span>}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn-small" disabled={busy} onClick={() => run({ accessCode: "generate" })}>
                {a.accessCode ? "New code" : "Generate"}
              </button>
              <button type="button" className="btn-small" disabled={busy} onClick={() => setEditing(true)}>
                Set
              </button>
              {a.accessCode && (
                <button type="button" className="btn-link" style={{ fontSize: 14 }} disabled={busy} onClick={() => run({ accessCode: null })}>
                  Remove
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="actions">
        {!a.isAdmin &&
          (suspended ? (
            <button type="button" className="btn-small" disabled={busy} onClick={() => run({ status: "active" })}>
              Reactivate
            </button>
          ) : (
            <button
              type="button"
              className="btn-small btn-danger"
              disabled={busy}
              onClick={() => confirm(`Suspend ${a.email}? They'll be signed out and can't sign in or build decks until you reactivate them.`) && run({ status: "suspended" })}
            >
              Suspend
            </button>
          ))}
        {!a.isAdmin && !deleting && (
          <button type="button" className="btn-small btn-danger" disabled={busy} onClick={() => setDeleting(true)}>
            Delete
          </button>
        )}
      </div>

      {deleting && (
        <form
          className="confirm-delete"
          role="alertdialog"
          aria-label={`Delete ${a.email || "this account"}`}
          onSubmit={async (e) => {
            e.preventDefault();
            if (typed.trim() !== confirmWord) return;
            setBusy(true);
            try {
              await onDelete();
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            <b>Delete {a.email || "this account"} permanently?</b> This removes their sign-in, their decks, practice history and access
            code. It can't be undone. To block someone for now, suspend them instead.
          </p>
          <label htmlFor={`confirm-${a.uid}`} className="small" style={{ fontWeight: 400 }}>
            Type <b className="mono">{confirmWord}</b> to confirm
          </label>
          <div className="row" style={{ gap: 8 }}>
            <input id={`confirm-${a.uid}`} type="text" autoComplete="off" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} style={{ flex: "1 1 220px", width: "auto" }} />
            <button type="submit" className="btn-small btn-danger-solid" disabled={busy || typed.trim() !== confirmWord}>
              {busy ? "Deleting…" : "Delete forever"}
            </button>
            <button
              type="button"
              className="btn-small"
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                setTyped("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

const planLabel = (id: PlanId) => PLANS.find((p) => p.id === id)?.label ?? id;

function RequestItem({ r, onReply }: { r: UpgradeRequest; onReply: (reply: string, approve: boolean) => Promise<void> }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (approve: boolean) => {
    setBusy(true);
    try {
      await onReply(reply.trim(), approve);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`request ${r.status === "pending" ? "pending" : ""}`}>
      <div className="row spread">
        <div className="who-col">
          <b>{r.displayName || r.email}</b>
          {r.displayName && <span className="small">{r.email}</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="mono small">
            {planLabel(r.currentPlan)} → {planLabel(r.requestedPlan)}
          </span>
          {r.status === "pending" ? <Chip tone="warn">Waiting</Chip> : r.approved ? <Chip tone="good">Upgraded</Chip> : <Chip>Replied</Chip>}
        </div>
      </div>
      <span className="small">Sent {when(r.createdAt)}</span>
      {r.message ? <p className="quote">{r.message}</p> : <p className="small">No note.</p>}
      {r.status === "pending" ? (
        <form
          className="stack"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            send(true);
          }}
        >
          <textarea aria-label={`Reply to ${r.email}`} maxLength={1000} placeholder="Write a message back (optional when you approve)" value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn-small btn-primary" disabled={busy}>
              Upgrade to {planLabel(r.requestedPlan)} and reply
            </button>
            <button type="button" className="btn-small" disabled={busy || !reply.trim()} onClick={() => send(false)}>
              Reply without upgrading
            </button>
          </div>
        </form>
      ) : (
        <div className="reply">
          <span className="small">You replied · {when(r.repliedAt)}{r.userRead ? " · seen" : ""}</span>
          {r.reply && <p>{r.reply}</p>}
        </div>
      )}
    </li>
  );
}

function Requests({ onChange }: { onChange: () => void }) {
  const [requests, setRequests] = useState<UpgradeRequest[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setRequests(await listUpgradeRequests());
    } catch (e) {
      setError((e as Error).message || "Requests couldn't be loaded.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!requests?.length && !error) return null;
  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const done = (requests ?? []).filter((r) => r.status !== "pending");
  const shown = [...pending, ...(showAll ? done : done.slice(0, pending.length ? 0 : 3))];
  return (
    <section className="panel stack" id="requests">
      <div className="row spread">
        <h2>Upgrade requests</h2>
        {pending.length > 0 && <Chip tone="warn">{pending.length} waiting</Chip>}
      </div>
      {error && <p className="error">{error}</p>}
      {pending.length === 0 && <p className="muted">Nothing waiting. Recent replies are below.</p>}
      <ul className="requests">
        {shown.map((r) => (
          <RequestItem
            key={r.id}
            r={r}
            onReply={async (reply, approve) => {
              try {
                await adminReplyUpgrade({ id: r.id, reply, approve });
                setError("");
                await load();
                onChange();
              } catch (e) {
                setError((e as Error).message || "The reply didn't send. Try again.");
              }
            }}
          />
        ))}
      </ul>
      {done.length > shown.length - pending.length && (
        <button type="button" className="btn-link" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(true)}>
          Show {done.length - (shown.length - pending.length)} earlier {done.length - (shown.length - pending.length) === 1 ? "reply" : "replies"}
        </button>
      )}
    </section>
  );
}

export default function Accounts() {
  const { refresh } = useAccount();
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [plans, setPlans] = useState<Record<PlanId, PlanLimits> | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PlanId | "suspended">("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await adminListAccounts();
      setAccounts(res.accounts);
      setPlans(res.plans);
      setError("");
    } catch (e) {
      setError((e as Error).message || "Accounts couldn't be loaded.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const update = async (uid: string, u: Omit<AccountUpdate, "uid">) => {
    try {
      await adminUpdateAccount({ uid, ...u });
      await load();
    } catch (e) {
      setError((e as Error).message || "That change didn't save. Try again.");
    }
  };

  const remove = async (a: AdminAccount) => {
    try {
      await adminDeleteAccount(a.uid);
      setAccounts((list) => list?.filter((x) => x.uid !== a.uid) ?? null);
      setNotice(`Deleted ${a.email || "the account"}.`);
      setError("");
    } catch (e) {
      setError((e as Error).message || "The account couldn't be deleted. Try again.");
    }
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (accounts ?? []).filter(
      (a) =>
        (!q || a.email.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q)) &&
        (filter === "all" || (filter === "suspended" ? a.status === "suspended" : a.plan === filter && !a.isAdmin)),
    );
  }, [accounts, search, filter]);

  const count = (f: typeof filter) => (accounts ?? []).filter((a) => (f === "suspended" ? a.status === "suspended" : !a.isAdmin && a.plan === f)).length;

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page">
        <div className="row spread">
          <h1>Accounts</h1>
          {accounts && <span className="muted">{accounts.length} {accounts.length === 1 ? "account" : "accounts"}</span>}
        </div>

        <Requests
          onChange={() => {
            load();
            refresh();
          }}
        />

        {plans && (
          <div className="tiles">
            {PLAN_ORDER.map((p) => (
              <div key={p} className="tile">
                <span className="label">{plans[p].label}</span>
                <b className="mono" style={{ fontSize: 20 }}>
                  {plans[p].max_decks} decks × {plans[p].max_questions} questions
                </b>
                <span className="label">{count(p)} {count(p) === 1 ? "account" : "accounts"}</span>
              </div>
            ))}
          </div>
        )}

        <div className="panel stack">
          <div className="row">
            <input type="text" aria-label="Search accounts" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 240px", width: "auto" }} />
            <div className="seg" role="group" aria-label="Filter">
              {(["all", ...PLAN_ORDER, "suspended"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "suspended" ? `Suspended (${count("suspended")})` : plans?.[f]?.label ?? f}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          {notice && !error && (
            <p className="muted" role="status">
              {notice}
            </p>
          )}
          {accounts === null && !error ? (
            <span className="spinner" />
          ) : shown.length === 0 ? (
            <p className="muted">No accounts match.</p>
          ) : (
            plans && (
              <ul className="acct-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {shown.map((a) => (
                  <AccountRow key={a.uid} a={a} plans={plans} onChange={(u) => update(a.uid, u)} onDelete={() => remove(a)} />
                ))}
              </ul>
            )
          )}
          <p className="muted" style={{ fontSize: 14 }}>
            An account's own access code replaces the shared code for that person. Accounts without one use the shared code.
          </p>
        </div>
      </main>
    </>
  );
}

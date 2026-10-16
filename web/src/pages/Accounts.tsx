import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar, { Chip } from "../components/TopBar";
import { adminListAccounts, adminUpdateAccount, type AccountUpdate } from "../lib/db";
import type { AdminAccount, PlanId, PlanLimits } from "../lib/types";

const PLAN_ORDER: PlanId[] = ["free", "pro", "promax"];

const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

function AccountRow({ a, plans, onChange }: { a: AdminAccount; plans: Record<PlanId, PlanLimits>; onChange: (u: Omit<AccountUpdate, "uid">) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
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
      </div>
    </li>
  );
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [plans, setPlans] = useState<Record<PlanId, PlanLimits> | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PlanId | "suspended">("all");
  const [error, setError] = useState("");

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
          {accounts === null && !error ? (
            <span className="spinner" />
          ) : shown.length === 0 ? (
            <p className="muted">No accounts match.</p>
          ) : (
            plans && (
              <ul className="acct-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {shown.map((a) => (
                  <AccountRow key={a.uid} a={a} plans={plans} onChange={(u) => update(a.uid, u)} />
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

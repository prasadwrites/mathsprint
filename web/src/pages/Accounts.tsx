import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import SubjectEditor from "../components/SubjectEditor";
import TopBar, { Chip } from "../components/TopBar";
import { useAccount } from "../App";
import {
  adminDeleteAccount,
  adminDeleteUpgrade,
  adminEndPromotion,
  adminListAccounts,
  adminOfferPromotion,
  adminReplyReport,
  adminReplyUpgrade,
  adminUpdateAccount,
  listReports,
  listUpgradeRequests,
  type AccountUpdate,
} from "../lib/db";
import { PLANS, type AdminAccount, type PlanId, type PlanLimits, type ProblemReport, type UpgradeRequest } from "../lib/types";
import { listSubjects } from "../lib/subjects";
import { ReportStatus } from "./Report";
import { Conversation, ReplyBox, when } from "./Upgrade";

const PLAN_ORDER: PlanId[] = ["free", "pro", "promax"];

/** 0 → "0m", 300 → "5m", 7500 → "2h 5m". */
export const duration = (seconds: number) => {
  const m = Math.round(seconds / 60);
  if (m < 1) return "0m";
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
};

const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

const MONTHS = [1, 2, 3, 6, 12];
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Offer a bigger plan for a few months, or see and end the one running. */
function Promotion({ a, plans, onChanged }: { a: AdminAccount; plans: Record<PlanId, PlanLimits>; onChanged: () => void }) {
  const higher = PLAN_ORDER.slice(PLAN_ORDER.indexOf(a.basePlan) + 1);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PlanId>(higher[0] ?? "promax");
  const [months, setMonths] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setOpen(false);
      setNote("");
      onChanged();
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const end = (
    <button type="button" className="btn-link" style={{ fontSize: 13 }} disabled={busy} onClick={() => confirm(`End this for ${a.email}?`) && act(() => adminEndPromotion(a.uid))}>
      {a.promo ? "End now" : "Withdraw"}
    </button>
  );
  if (a.promo || a.offer) {
    return (
      <span className="small">
        {a.promo && (
          <>
            <Chip tone="good">Promotion</Chip> {a.promo.planLabel} until {shortDate(a.promo.endsAt)}, then {plans[a.basePlan]?.label}.{" "}
          </>
        )}
        {a.offer && (
          <>
            <Chip tone="warn">Offered</Chip> {a.offer.planLabel} for {a.offer.months} mo, not answered yet.{" "}
          </>
        )}
        {end}
        {error && <span className="error"> {error}</span>}
      </span>
    );
  }
  if (!higher.length) return null;
  if (!open) {
    return (
      <span className="small">
        <button type="button" className="btn-link" style={{ fontSize: 13 }} onClick={() => setOpen(true)}>
          Offer a promotion
        </button>
      </span>
    );
  }
  return (
    <form
      className="promo-box"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => adminOfferPromotion({ uid: a.uid, plan, months, note: note.trim() }));
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        <select aria-label="Promotion plan" value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} style={{ width: "auto" }}>
          {higher.map((p) => (
            <option key={p} value={p}>
              {plans[p]?.label ?? p}
            </option>
          ))}
        </select>
        <select aria-label="Promotion length" value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ width: "auto" }}>
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? "month" : "months"}
            </option>
          ))}
        </select>
      </div>
      <input type="text" aria-label="Note to the user" placeholder="Note to them (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn-small btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send offer"}
        </button>
        <button type="button" className="btn-small" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <span className="small">They see it when they sign in. The term starts when they accept, then they go back to {plans[a.basePlan]?.label}.</span>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function AccountRow({
  a,
  plans,
  onChange,
  onDelete,
  onPromotion,
}: {
  a: AdminAccount;
  plans: Record<PlanId, PlanLimits>;
  onChange: (u: Omit<AccountUpdate, "uid">) => Promise<void>;
  onDelete: () => Promise<void>;
  onPromotion: () => void;
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
          Joined {date(a.createdAt)}
          {a.signupRef ? ` from ${a.signupRef}` : ""} · last sign-in {date(a.lastSignInAt)}
        </span>
        <span className="small time-on-site">
          Time on site: <b>{duration(a.activeSeconds)}</b> in all · {duration(a.weekSeconds)} this week · {duration(a.todaySeconds)} today
          {a.lastActiveAt ? ` · last active ${when(a.lastActiveAt)}` : ""}
        </span>
        <span className="small">
          <Link to={`/admin/engagement?u=${encodeURIComponent(a.uid)}`}>See engagement</Link>
        </span>
        {a.invitesJoined > 0 && (
          <span className="small">
            {a.invitesJoined} {a.invitesJoined === 1 ? "friend" : "friends"} joined from their invites (+{a.invitesJoined} {a.invitesJoined === 1 ? "deck" : "decks"})
          </span>
        )}
      </div>

      <div className="usage">
        {a.isAdmin ? (
          <span className="small">No limits on the admin account</span>
        ) : (
          <>
            <div className="seg" role="group" aria-label={`Plan for ${a.email}`}>
              {PLAN_ORDER.map((p) => (
                <button key={p} type="button" className="btn-small" aria-pressed={a.basePlan === p} disabled={busy} onClick={() => a.basePlan !== p && run({ plan: p })}>
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
            <Promotion a={a} plans={plans} onChanged={onPromotion} />
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

function RequestItem({
  r,
  onReply,
  onDelete,
}: {
  r: UpgradeRequest;
  onReply: (reply: string, approve: boolean) => Promise<void>;
  /** With a message, deletes just that one; without, the whole request. */
  onDelete: (message?: { index: number; at: number | null }) => Promise<void>;
}) {
  // Messages stay folded away until the admin opens them.
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = r.thread?.length ?? 0;
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
          {r.status === "pending" ? <Chip tone="warn">Waiting</Chip> : r.paid ? <Chip tone="good">Paid</Chip> : r.approved ? <Chip tone="good">Upgraded</Chip> : <Chip>Replied</Chip>}
        </div>
      </div>
      <span className="small">
        Sent {when(r.createdAt)}
        {r.status === "replied" && r.userRead ? " · they've seen your reply" : ""}
      </span>
      <div className="row" style={{ gap: 16 }}>
        <button type="button" className="btn-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide messages" : `Show messages (${count})`}
        </button>
        {!confirm && (
          <button type="button" className="btn-link danger" onClick={() => setConfirm(true)}>
            Delete request
          </button>
        )}
      </div>
      {confirm && (
        <div className="confirm-delete">
          <span>
            Delete this request and all its messages? It's gone for {r.displayName || r.email} too.
            {r.approved ? " Their plan stays as it is." : ""}
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-small btn-danger-solid"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Delete request"}
            </button>
            <button type="button" className="btn btn-small" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {open && <Conversation r={r} viewer="admin" onDelete={(index, m) => onDelete({ index, at: m.at })} />}
      {open && (
        <ReplyBox label={`Reply to ${r.email}`} placeholder={r.approved ? "Write a message back" : "Write a message back (optional when you approve)"} onSend={onReply}>
          {(text, busy, send) =>
            r.approved ? (
              <button type="submit" className="btn-small btn-primary" disabled={busy || !text}>
                Send reply
              </button>
            ) : (
              <>
                <button type="button" className="btn-small btn-primary" disabled={busy} onClick={() => send(true)}>
                  Upgrade to {planLabel(r.requestedPlan)} and reply
                </button>
                <button type="submit" className="btn-small" disabled={busy || !text}>
                  Reply without upgrading
                </button>
              </>
            )
          }
        </ReplyBox>
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
            onDelete={async (message) => {
              try {
                await adminDeleteUpgrade(r.id, message);
                setError("");
                await load();
                onChange();
              } catch (e) {
                setError((e as Error).message || "That didn't delete. Try again.");
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

function Reports({ onChange }: { onChange: () => void }) {
  const [reports, setReports] = useState<ProblemReport[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setReports(await listReports());
    } catch (e) {
      setError((e as Error).message || "Reports couldn't be loaded.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  if (!reports?.length && !error) return null;
  const open = (reports ?? []).filter((r) => r.status === "open");
  const rest = (reports ?? []).filter((r) => r.status !== "open");
  const shown = [...open, ...(showAll ? rest : rest.slice(0, open.length ? 0 : 3))];
  const send = async (r: ProblemReport, text: string, resolve: boolean) => {
    try {
      await adminReplyReport({ id: r.id, text, resolve });
      setError("");
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message || "The reply didn't send. Try again.");
    }
  };
  return (
    <section className="panel stack" id="reports">
      <div className="row spread">
        <h2>Problem reports</h2>
        {open.length > 0 && <Chip tone="warn">{open.length} waiting</Chip>}
      </div>
      {error && <p className="error">{error}</p>}
      {open.length === 0 && <p className="muted">Nothing waiting. Recent reports are below.</p>}
      <ul className="requests">
        {shown.map((r) => (
          <li key={r.id} className="request">
            <div className="row spread">
              <div className="who-col">
                <b>{r.displayName || r.email}</b>
                {r.displayName && <span className="small">{r.email}</span>}
              </div>
              <ReportStatus status={r.status} />
            </div>
            <span className="small">
              Sent {when(r.createdAt)}
              {r.page && (
                <>
                  {" "}from <span className="mono">{r.page}</span>
                </>
              )}
            </span>
            <Conversation r={r} viewer="admin" />
            <ReplyBox label={`Reply to ${r.email}`} placeholder="Write back (optional when you mark it resolved)" onSend={(text, resolve) => send(r, text, resolve)}>
              {(text, busy, submit) => (
                <>
                  <button type="submit" className="btn-small btn-primary" disabled={busy || !text}>
                    Reply
                  </button>
                  {r.status !== "resolved" && (
                    <button type="button" className="btn-small" disabled={busy} onClick={() => submit(true)}>
                      {text ? "Reply and mark resolved" : "Mark resolved"}
                    </button>
                  )}
                </>
              )}
            </ReplyBox>
          </li>
        ))}
      </ul>
      {rest.length > shown.length - open.length && (
        <button type="button" className="btn-link" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(true)}>
          Show {rest.length - (shown.length - open.length)} earlier
        </button>
      )}
    </section>
  );
}

/** The subjects decks can be made in. */
function Subjects() {
  const [subjects, setSubjects] = useState<string[] | null>(null);
  useEffect(() => {
    listSubjects().then(setSubjects);
  }, []);
  return (
    <section className="panel stack" id="subjects">
      <h2>Subjects</h2>
      {subjects ? <SubjectEditor subjects={subjects} onChange={setSubjects} /> : <span className="spinner" />}
    </section>
  );
}

export default function Accounts() {
  const { refresh } = useAccount();
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [plans, setPlans] = useState<Record<PlanId, PlanLimits> | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | PlanId | "suspended">("all");
  const [sort, setSort] = useState<"newest" | "week" | "total">("newest");
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
    const list = (accounts ?? []).filter(
      (a) =>
        (!q || a.email.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q)) &&
        (filter === "all" || (filter === "suspended" ? a.status === "suspended" : a.plan === filter && !a.isAdmin)),
    );
    if (sort === "week") return [...list].sort((x, y) => y.weekSeconds - x.weekSeconds);
    if (sort === "total") return [...list].sort((x, y) => y.activeSeconds - x.activeSeconds);
    return list; // the server sends the admin first, then newest sign-ups
  }, [accounts, search, filter, sort]);

  const count = (f: typeof filter) => (accounts ?? []).filter((a) => (f === "suspended" ? a.status === "suspended" : !a.isAdmin && a.plan === f)).length;

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page">
        <div className="row spread">
          <h1>Accounts</h1>
          <div className="row">
            {accounts && <span className="muted">{accounts.length} {accounts.length === 1 ? "account" : "accounts"}</span>}
            <Link className="btn btn-small" to="/admin/engagement">
              Engagement
            </Link>
          </div>
        </div>

        <Requests
          onChange={() => {
            load();
            refresh();
          }}
        />
        <Reports onChange={refresh} />
        <Subjects />

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
            <select aria-label="Sort accounts" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: "auto" }}>
              <option value="newest">Newest first</option>
              <option value="week">Most time this week</option>
              <option value="total">Most time in all</option>
            </select>
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
                  <AccountRow key={a.uid} a={a} plans={plans} onChange={(u) => update(a.uid, u)} onDelete={() => remove(a)} onPromotion={load} />
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

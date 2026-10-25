import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "../App";
import TopBar, { Chip } from "../components/TopBar";
import { deleteGroup, listGroups, listTests, saveGroup } from "../lib/db";
import { canUseGroups, type Group, type GroupTest } from "../lib/types";
import { when } from "./Upgrade";

/** Emails typed or pasted one per line, or separated by commas, spaces or semicolons. */
export const splitEmails = (text: string) => text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);

const message = (e: unknown, fallback: string) => (e as Error).message || fallback;

function GroupCard({ group, onChange, onDelete }: { group: Group; onChange: (g: Group) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (changes: { name?: string; emails?: string[] }) => {
    setBusy(true);
    setError("");
    try {
      const saved = await saveGroup({ id: group.id, name: changes.name ?? group.name, emails: changes.emails ?? group.emails });
      onChange(saved);
      return true;
    } catch (e) {
      setError(message(e, "That didn't save. Try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (await save({ emails: [...group.emails, ...splitEmails(adding)] })) setAdding("");
  };

  return (
    <li className="panel stack group-card">
      <div className="row spread">
        <button type="button" className="btn-link group-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <h3>{group.name}</h3>
        </button>
        <span className="muted">
          {group.emails.length} {group.emails.length === 1 ? "email" : "emails"}
        </span>
      </div>
      {open && (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              save({ name: name.trim() });
            }}
          >
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor={`name-${group.id}`}>Group name</label>
              <input id={`name-${group.id}`} type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn" type="submit" disabled={busy || !name.trim() || name.trim() === group.name} style={{ alignSelf: "flex-end" }}>
              Rename
            </button>
          </form>

          {group.emails.length > 0 ? (
            <ul className="email-list">
              {group.emails.map((email, i) =>
                editing?.index === i ? (
                  <li key={email}>
                    <form
                      className="row"
                      style={{ flexGrow: 1 }}
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const emails = group.emails.map((x, k) => (k === i ? editing.value.trim() : x));
                        if (await save({ emails })) setEditing(null);
                      }}
                    >
                      <input
                        type="text"
                        inputMode="email"
                        aria-label={`Edit ${email}`}
                        value={editing.value}
                        onChange={(e) => setEditing({ index: i, value: e.target.value })}
                        style={{ flex: "1 1 200px", width: "auto" }}
                        autoFocus
                      />
                      <button className="btn btn-small btn-primary" type="submit" disabled={busy || !editing.value.trim()}>
                        Save
                      </button>
                      <button className="btn btn-small" type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  </li>
                ) : (
                  <li key={email}>
                    <span className="email">{email}</span>
                    <span className="row" style={{ gap: 8 }}>
                      <button className="btn btn-small" type="button" onClick={() => setEditing({ index: i, value: email })}>
                        Edit
                      </button>
                      <button
                        className="btn btn-small btn-danger"
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${email}`}
                        onClick={() => save({ emails: group.emails.filter((_, k) => k !== i) })}
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className="muted">No emails yet. Add the people in this group below.</p>
          )}

          <form
            className="stack"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor={`add-${group.id}`} style={{ marginBottom: 0 }}>
              Add emails
            </label>
            <textarea
              id={`add-${group.id}`}
              placeholder={"one per line, or separated by commas\nstudent1@school.org, student2@school.org"}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            />
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={busy || !splitEmails(adding).length}>
                {busy ? "Saving…" : `Add ${splitEmails(adding).length || ""} ${splitEmails(adding).length === 1 ? "email" : "emails"}`}
              </button>
            </div>
          </form>
          {error && <p className="error">{error}</p>}

          <div className="row">
            {confirmDelete ? (
              <div className="confirm-delete" style={{ flexGrow: 1 }}>
                <span>
                  Delete <b>{group.name}</b>? Tests you already assigned to it keep working.
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-small btn-danger-solid" type="button" onClick={onDelete}>
                    Delete group
                  </button>
                  <button className="btn btn-small" type="button" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-small btn-danger" type="button" onClick={() => setConfirmDelete(true)}>
                Delete group
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

export function TestList({ tests }: { tests: GroupTest[] }) {
  return (
    <ul className="requests">
      {tests.map((t) => (
        <li key={t.id} className="request">
          <div className="row spread">
            <Link to={`/tests/${t.id}`}>
              <b>{t.deckTitle}</b>
            </Link>
            <Chip tone={t.completed === t.assigned && t.assigned > 0 ? "good" : undefined}>
              {t.completed} of {t.assigned} finished
            </Chip>
          </div>
          <span className="small">
            {t.kind === "class" ? `Class link${t.groupName ? `: ${t.groupName}` : ""}${t.open === false ? " (closed)" : ""}` : t.groupName} · {t.questionCount} questions · {t.timeLimitSec ? `${Math.round(t.timeLimitSec / 60)} min` : "no time limit"} · Assigned{" "}
            {when(t.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Groups() {
  const { account } = useAccount();
  const allowed = canUseGroups(account);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [tests, setTests] = useState<GroupTest[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return;
    listGroups()
      .then(setGroups)
      .catch((e) => {
        setError(message(e, "Your groups couldn't be loaded."));
        setGroups([]);
      });
    listTests().then(setTests).catch(() => {});
  }, [allowed]);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const g = await saveGroup({ name: name.trim(), emails: [] });
      setGroups([...(groups ?? []), g].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
    } catch (e) {
      setError(message(e, "The group wasn't created. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page narrow">
        <h1>Groups</h1>
        <p className="muted">
          Keep a list of emails for each class or study group. Then open any deck and assign it to a group: everyone gets their own link and access code,
          and you see each person's result.
        </p>

        {!account ? (
          <span className="spinner" />
        ) : !allowed ? (
          <div className="notice">
            <b>Groups and group tests are part of Pro and Pro Max.</b>
            <Link className="btn btn-primary" to="/upgrade">
              Upgrade
            </Link>
          </div>
        ) : (
          <>
            <form
              className="panel row"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <div style={{ flex: "1 1 260px" }}>
                <label htmlFor="group-name">New group</label>
                <input id="group-name" type="text" placeholder="8th Grade" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()} style={{ alignSelf: "flex-end" }}>
                {busy ? "Creating…" : "Create group"}
              </button>
            </form>
            {error && <p className="error">{error}</p>}

            {groups === null ? (
              <span className="spinner" />
            ) : groups.length === 0 ? (
              <p className="muted">No groups yet.</p>
            ) : (
              <ul className="group-list">
                {groups.map((g) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    onChange={(saved) => setGroups(groups.map((x) => (x.id === saved.id ? saved : x)))}
                    onDelete={async () => {
                      try {
                        await deleteGroup(g.id);
                        setGroups(groups.filter((x) => x.id !== g.id));
                      } catch (e) {
                        setError(message(e, "The group wasn't deleted. Try again."));
                      }
                    }}
                  />
                ))}
              </ul>
            )}

            {tests.length > 0 && (
              <section className="stack">
                <h2>Assigned tests</h2>
                <div className="panel">
                  <TestList tests={tests} />
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

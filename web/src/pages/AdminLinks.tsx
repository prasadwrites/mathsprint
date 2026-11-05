import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TopBar, { Chip } from "../components/TopBar";
import { adminListLinks } from "../lib/db";
import { KIND_LABELS, linkUrl } from "../lib/links";
import type { EngagementLink } from "../lib/types";

type Kind = EngagementLink["kind"];
const KINDS: Kind[] = ["challenge", "class", "group", "public", "post"];
const SHOWN = 50;

const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

/** Admin only: every quiz link anyone has made, who made it, and how far it went. */
export default function AdminLinks() {
  const [links, setLinks] = useState<EngagementLink[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [search, setSearch] = useState("");
  const [othersOnly, setOthersOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setLinks(await adminListLinks());
    } catch (e) {
      setError((e as Error).message || "The links couldn't be loaded.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const pool = useMemo(() => (links ?? []).filter((l) => !othersOnly || !l.ownerIsAdmin), [links, othersOnly]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
    pool.forEach((l) => c[l.kind]++);
    return c;
  }, [pool]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pool.filter(
      (l) =>
        (kind === "all" || l.kind === kind) &&
        (!q || [l.title, l.label, l.ownerName, l.ownerEmail].some((t) => (t || "").toLowerCase().includes(q))),
    );
  }, [pool, kind, search]);
  const owners = useMemo(() => new Set(pool.map((l) => l.ownerUid)).size, [pool]);

  const copy = async (l: EngagementLink) => {
    const url = `${window.location.origin}${linkUrl(l)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(`${l.kind}-${l.id}`);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  return (
    <>
      <TopBar back={{ to: "/admin", label: "Accounts" }} />
      <main className="page">
        <div className="row spread">
          <h1>Quiz links</h1>
          <button type="button" className="btn-small" onClick={load}>
            Refresh
          </button>
        </div>
        <p className="muted">Every test link made on MathSprint, newest first, with who made it.</p>

        {error && <p className="error">{error}</p>}
        {links === null && !error && <span className="spinner" />}

        {links && (
          <section className="panel stack">
            <div className="seg" role="group" aria-label="Kind of link" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
              {(["all", ...KINDS] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === "all" ? "All" : KIND_LABELS[k]} <span style={{ fontWeight: 500, opacity: 0.8 }}>{k === "all" ? pool.length : counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <input
                type="text"
                aria-label="Search links"
                placeholder="Search by owner, email, deck or group"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: "1 1 240px", width: "auto" }}
              />
              <label className="row" style={{ gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={othersOnly} onChange={(e) => setOthersOnly(e.target.checked)} style={{ width: "auto" }} />
                Hide my own links
              </label>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {shown.length} {shown.length === 1 ? "link" : "links"} · {owners} {owners === 1 ? "owner" : "owners"} in all
            </p>

            {shown.length === 0 ? (
              <p className="muted">{pool.length ? "No link matches." : "No one has made a link yet."}</p>
            ) : (
              <div className="plans-table-wrap" style={{ padding: 0 }}>
                <table className="plans-table eng-table eng-links">
                  <thead>
                    <tr>
                      <th scope="col">Link</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Made</th>
                      <th scope="col">Played</th>
                      <th scope="col">Finished</th>
                      <th scope="col">New accounts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, showAll || search ? undefined : SHOWN).map((l) => {
                      const url = linkUrl(l);
                      return (
                        <tr key={`${l.kind}-${l.id}`}>
                          <th scope="row">
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer">
                                {l.title}
                              </a>
                            ) : (
                              l.title
                            )}
                            <span className="small">
                              <Chip tone={l.kind === "public" ? "good" : undefined}>{KIND_LABELS[l.kind]}</Chip>
                              {l.label ? ` ${l.label}` : ""}
                              {l.kind === "class" && !l.open && " · closed"}
                              {l.kind === "group" && " · one link per member"}
                            </span>
                            {url && (
                              <span className="small">
                                <span className="mono">{url}</span>{" "}
                                <button type="button" className="btn-link" onClick={() => copy(l)}>
                                  {copied === `${l.kind}-${l.id}` ? "Copied" : "Copy"}
                                </button>
                              </span>
                            )}
                          </th>
                          <th scope="row">
                            <Link to={`/admin/engagement?u=${encodeURIComponent(l.ownerUid)}`}>{l.ownerName}</Link> {l.ownerIsAdmin && <Chip>Admin</Chip>}
                            {l.ownerName !== l.ownerEmail && <span className="small">{l.ownerEmail}</span>}
                          </th>
                          <td className="small">{date(l.createdAt)}</td>
                          <td className="mono">{l.reached}</td>
                          <td className="mono">{l.completed}</td>
                          <td className="mono">{l.signups}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!showAll && !search && shown.length > SHOWN && (
              <button type="button" className="btn-link" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(true)}>
                Show all {shown.length}
              </button>
            )}
          </section>
        )}

        <p className="muted" style={{ fontSize: 14 }}>
          Challenges come from a finished practice session, class links and group tests from assigning a deck (Pro and Pro Max), and public tests and
          question posts are made by the admin. Played counts everyone who opened a test (for a question post, everyone who answered). New accounts counts
          people who signed up after getting the link. Links from deleted accounts aren't listed. <Link to="/admin/engagement">Engagement</Link>
        </p>
      </main>
    </>
  );
}

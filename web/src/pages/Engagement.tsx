import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import TopBar, { Chip } from "../components/TopBar";
import { adminEngagement, adminUserEngagement } from "../lib/db";
import type { EngagementChannel, EngagementUser, ScoreRule } from "../lib/types";
import { duration } from "./Accounts";
import { when } from "./Upgrade";

type Sort = "score" | "completions" | "signups" | "linksCreated" | "activeSeconds" | "decksCreated";
const SORTS: { id: Sort; label: string }[] = [
  { id: "score", label: "Engagement score" },
  { id: "completions", label: "Finished tests" },
  { id: "signups", label: "New accounts" },
  { id: "linksCreated", label: "Links shared" },
  { id: "activeSeconds", label: "Time on site" },
  { id: "decksCreated", label: "Decks created" },
];
const CHANNEL_ORDER: EngagementChannel[] = ["challenge", "group", "share", "public", "post", "invite"];
const SHOWN = 25;

const date = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");
const name = (u: EngagementUser) => u.displayName || u.email || "No name";
const rate = (r: number | null) => (r === null ? "–" : `${Math.round(r * 100)}%`);

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note && <span className="label">{note}</span>}
    </div>
  );
}

/** One person: their own usage, how far each kind of link went, where their score comes from, and each deck. */
function UserDetail({ uid, scoring, channels, onClose }: { uid: string; scoring: ScoreRule[]; channels: Record<EngagementChannel, string>; onClose: () => void }) {
  const [u, setU] = useState<EngagementUser | null>(null);
  const [error, setError] = useState("");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setU(null);
    setError("");
    adminUserEngagement(uid)
      .then((res) => setU(res.user))
      .catch((e) => setError((e as Error).message || "That account couldn't be loaded."));
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [uid]);

  return (
    <section ref={ref} className="panel stack" id="person" aria-live="polite">
      <div className="row spread">
        <h2>{u ? name(u) : "Loading…"}</h2>
        <button type="button" className="btn-small" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!u && !error && <span className="spinner" />}
      {u && (
        <>
          <span className="muted" style={{ fontSize: 14 }}>
            {u.displayName && `${u.email} · `}Joined {date(u.createdAt)} · last sign-in {date(u.lastSignInAt)}
            {u.lastActiveAt ? ` · last active ${when(u.lastActiveAt)}` : ""} {u.isAdmin && <Chip>Admin</Chip>}
          </span>

          <div className="kv">
            <div>
              <span>Engagement score</span>
              <b>{u.score}</b>
            </div>
            <div>
              <span>Time on site</span>
              <b>{duration(u.activeSeconds)}</b>
            </div>
            <div>
              <span>This week · today</span>
              <b>
                {duration(u.weekSeconds)} · {duration(u.todaySeconds)}
              </b>
            </div>
            <div>
              <span>Active days (35)</span>
              <b>{u.activeDays}</b>
            </div>
            <div>
              <span>Decks created</span>
              <b>{u.decksCreated}</b>
            </div>
            <div>
              <span>Decks practiced</span>
              <b>{u.decksPracticed}</b>
            </div>
            <div>
              <span>Sessions finished</span>
              <b>{u.sessionsCompleted}</b>
            </div>
          </div>

          <h3>Their links</h3>
          <div className="plans-table-wrap" style={{ padding: 0 }}>
            <table className="plans-table eng-table">
              <thead>
                <tr>
                  <th scope="col">How they shared</th>
                  <th scope="col">Links</th>
                  <th scope="col">People reached</th>
                  <th scope="col">Finished</th>
                  <th scope="col">New accounts</th>
                </tr>
              </thead>
              <tbody>
                {CHANNEL_ORDER.filter((c) => Object.values(u.channels[c]).some(Boolean)).map((c) => (
                  <tr key={c}>
                    <th scope="row">{channels[c]}</th>
                    <td className="mono">{u.channels[c].links}</td>
                    <td className="mono">{c === "invite" ? "–" : u.channels[c].reached}</td>
                    <td className="mono">{c === "invite" ? "–" : u.channels[c].completed}</td>
                    <td className="mono">{u.channels[c].signups}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">All</th>
                  <td className="mono">
                    <b>{u.linksCreated}</b>
                  </td>
                  <td className="mono">
                    <b>{u.peopleReached}</b>
                  </td>
                  <td className="mono">
                    <b>{u.completions}</b> <span className="small">({rate(u.completionRate)})</span>
                  </td>
                  <td className="mono">
                    <b>{u.signups}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Where the score comes from</h3>
          <ul className="eng-points">
            {scoring
              .filter((s) => u.points[s.field])
              .map((s) => (
                <li key={s.field}>
                  <span>
                    {(u as unknown as Record<string, number>)[s.field]} × {s.points} for each {s.per}
                  </span>
                  <b className="mono">{u.points[s.field]}</b>
                </li>
              ))}
            {!scoring.some((s) => u.points[s.field]) && <li className="muted">Nothing yet.</li>}
          </ul>

          <h3>Decks</h3>
          {u.decks && u.decks.length > 0 ? (
            <div className="plans-table-wrap" style={{ padding: 0 }}>
              <table className="plans-table eng-table">
                <thead>
                  <tr>
                    <th scope="col">Deck</th>
                    <th scope="col">Their sessions</th>
                    <th scope="col">Links</th>
                    <th scope="col">People reached</th>
                    <th scope="col">Finished</th>
                    <th scope="col">New accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {u.decks.map((d) => (
                    <tr key={d.deckId}>
                      <th scope="row">
                        {d.title}
                        <span className="small">
                          {d.subject}
                          {d.createdAt ? ` · made ${date(d.createdAt)}` : ""}
                          {d.deleted ? " · deleted" : !d.own ? " · shared with them" : ""}
                        </span>
                      </th>
                      <td className="mono">{d.ownSessions}</td>
                      <td className="mono">{d.links}</td>
                      <td className="mono">{d.reached}</td>
                      <td className="mono">{d.completed}</td>
                      <td className="mono">{d.signups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No decks.</p>
          )}
        </>
      )}
    </section>
  );
}

export default function Engagement() {
  const [users, setUsers] = useState<EngagementUser[] | null>(null);
  const [scoring, setScoring] = useState<ScoreRule[]>([]);
  const [channels, setChannels] = useState<Record<EngagementChannel, string> | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [withAdmin, setWithAdmin] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [params, setParams] = useSearchParams();
  const selected = params.get("u");
  const select = (uid: string | null) => setParams(uid ? { u: uid } : {}, { replace: false });

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await adminEngagement();
      setUsers(res.users);
      setScoring(res.scoring);
      setChannels(res.channels);
    } catch (e) {
      setError((e as Error).message || "Engagement couldn't be loaded.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const people = useMemo(() => (users ?? []).filter((u) => withAdmin || !u.isAdmin), [users, withAdmin]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = people.filter((u) => !q || u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
    return [...list].sort((a, b) => b[sort] - a[sort] || b.score - a.score);
  }, [people, search, sort]);
  const total = (k: "linksCreated" | "peopleReached" | "completions" | "signups" | "activeSeconds") => people.reduce((n, u) => n + u[k], 0);
  const engaged = people.filter((u) => u.score > 0).length;

  return (
    <>
      <TopBar back={{ to: "/admin", label: "Accounts" }} />
      <main className="page">
        <div className="row spread">
          <h1>Engagement</h1>
          <button type="button" className="btn-small" onClick={load}>
            Refresh
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        {users === null && !error && <span className="spinner" />}

        {users && (
          <div className="tiles four">
            <Tile label="Engaged accounts" value={engaged} note={`of ${people.length}`} />
            <Tile label="Links shared" value={total("linksCreated")} />
            <Tile label="People reached" value={total("peopleReached")} />
            <Tile
              label="Finished a test"
              value={total("completions")}
              note={total("peopleReached") ? `${Math.round((total("completions") / total("peopleReached")) * 100)}% of people reached` : undefined}
            />
            <Tile label="New accounts from links" value={total("signups")} />
            <Tile label="Time on site" value={duration(total("activeSeconds"))} />
          </div>
        )}

        {selected && channels && <UserDetail uid={selected} scoring={scoring} channels={channels} onClose={() => select(null)} />}

        {users && (
          <section className="panel stack">
            <div className="row spread">
              <h2>Top users</h2>
              <span className="muted">Pick someone to see their usage</span>
            </div>
            <div className="row">
              <input type="text" aria-label="Search people" placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: "1 1 240px", width: "auto" }} />
              <select aria-label="Rank by" value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ width: "auto" }}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    Rank by {s.label.toLowerCase()}
                  </option>
                ))}
              </select>
              <label className="row" style={{ gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={withAdmin} onChange={(e) => setWithAdmin(e.target.checked)} style={{ width: "auto" }} />
                Include the admin
              </label>
            </div>
            {shown.length === 0 ? (
              <p className="muted">No one matches.</p>
            ) : (
              <div className="plans-table-wrap" style={{ padding: 0 }}>
                <table className="plans-table eng-table eng-rank">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Person</th>
                      <th scope="col">Score</th>
                      <th scope="col">Links shared</th>
                      <th scope="col">Finished</th>
                      <th scope="col">New accounts</th>
                      <th scope="col">Decks</th>
                      <th scope="col">Time on site</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, showAll || search ? undefined : SHOWN).map((u, i) => (
                      <tr key={u.uid} aria-selected={u.uid === selected} onClick={() => select(u.uid)}>
                        <td className="mono">{i + 1}</td>
                        <th scope="row">
                          <button type="button" className="btn-link" onClick={(e) => (e.stopPropagation(), select(u.uid))}>
                            {name(u)}
                          </button>{" "}
                          {u.isAdmin && <Chip>Admin</Chip>}
                          {u.displayName && <span className="small">{u.email}</span>}
                        </th>
                        <td className="mono">
                          <b>{u.score}</b>
                        </td>
                        <td className="mono">{u.linksCreated}</td>
                        <td className="mono">
                          {u.completions}
                          {u.peopleReached > 0 && <span className="small">of {u.peopleReached}</span>}
                        </td>
                        <td className="mono">{u.signups}</td>
                        <td className="mono">{u.decksCreated}</td>
                        <td className="mono">{duration(u.activeSeconds)}</td>
                      </tr>
                    ))}
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

        {scoring.length > 0 && (
          <section className="panel stack" id="scoring">
            <h2>How the score works</h2>
            <ul className="eng-points">
              {scoring.map((s) => (
                <li key={s.field}>
                  <span>Each {s.per}</span>
                  <b className="mono">
                    {s.points} {s.points === 1 ? "point" : "points"}
                  </b>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: 14 }}>
              Links count challenge links, each group-test member's link, decks shared by email, public test links, question posts and invites. A new
              account counts when someone signs up after getting one of their links (once per person). A shared deck counts as finished once the person
              finishes a practice session on it, and a question post answer counts as finishing it. Time on site has only been counted since the
              heartbeat went live on Oct 17, 2026, so time before that is missing. <Link to="/admin">Back to Accounts</Link>
            </p>
          </section>
        )}
      </main>
    </>
  );
}

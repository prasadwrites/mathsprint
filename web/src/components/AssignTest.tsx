import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAccount } from "../App";
import { assignTest, createClassTest, listGroups, listTests } from "../lib/db";
import { canUseGroups, type Deck, type Group, type GroupTest } from "../lib/types";
import { TestList } from "../pages/Groups";

/** On a deck's page: assign it to one of your groups, or make one class link where students sign in with Google, and
 * see the tests already assigned. */
export default function AssignTest({ deck, suggestedSec }: { deck: Deck; suggestedSec: number }) {
  const { account } = useAccount();
  const allowed = canUseGroups(account);
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [tests, setTests] = useState<GroupTest[]>([]);
  const [groupId, setGroupId] = useState("");
  const [mode, setMode] = useState<"group" | "class">("group");
  const [className, setClassName] = useState("");
  const [domain, setDomain] = useState("");
  const [timed, setTimed] = useState(true);
  const [minutes, setMinutes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return;
    listGroups()
      .then((g) => {
        setGroups(g);
        setGroupId((id) => id || g.find((x) => x.emails.length)?.id || "");
      })
      .catch(() => setGroups([]));
    listTests(deck.id).then(setTests).catch(() => {});
  }, [allowed, deck.id]);
  useEffect(() => setMinutes(Math.max(1, Math.ceil(suggestedSec / 60))), [suggestedSec]);

  if (!account) return null;
  if (!allowed) {
    return (
      <div className="note">
        Teachers and tutors: assign this deck to a class and see every student's result with Pro or Pro Max. <Link to="/upgrade">Upgrade</Link>
      </div>
    );
  }

  const group = groups?.find((g) => g.id === groupId);
  const already = mode === "group" ? tests.find((t) => t.kind !== "class" && t.groupId === groupId) : undefined;

  const assign = async () => {
    setBusy(true);
    setError("");
    try {
      const timeLimitSec = timed ? minutes * 60 : 0;
      const { id } =
        mode === "class"
          ? await createClassTest({ deckId: deck.id, name: className.trim(), domain: domain.trim(), timeLimitSec })
          : await assignTest({ deckId: deck.id, groupId, timeLimitSec });
      navigate(`/tests/${id}`);
    } catch (e) {
      setError((e as Error).message || "The test wasn't assigned. Try again.");
      setBusy(false);
    }
  };

  return (
    <section className="panel stack">
      <div className="row spread">
        <h2>Assign as a test</h2>
        <div className="seg" role="group" aria-label="How students get the test">
          <button type="button" aria-pressed={mode === "group"} onClick={() => setMode("group")}>
            To a group
          </button>
          <button type="button" aria-pressed={mode === "class"} onClick={() => setMode("class")}>
            One class link
          </button>
        </div>
      </div>
      {mode === "group" && groups === null ? (
        <span className="spinner" />
      ) : mode === "group" && groups!.length === 0 ? (
        <p className="muted">
          You don't have any groups yet. <Link to="/groups">Create a group</Link> with your students' emails, or make{" "}
          <button type="button" className="btn-link" onClick={() => setMode("class")}>
            one class link
          </button>{" "}
          instead.
        </p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            assign();
          }}
        >
          {mode === "class" && (
            <div className="grid2">
              <div>
                <label htmlFor="class-name">Class name (optional)</label>
                <input id="class-name" type="text" maxLength={80} placeholder="Period 3 Algebra" value={className} onChange={(e) => setClassName(e.target.value)} />
              </div>
              <div>
                <label htmlFor="class-domain">Only school accounts from (optional)</label>
                <input
                  id="class-domain"
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  placeholder="yourschool.org"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="grid2">
            {mode === "group" && (
              <div>
                <label htmlFor="assign-group">Group</label>
                <select id="assign-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="" disabled>
                    Pick a group
                  </option>
                  {groups!.map((g) => (
                    <option key={g.id} value={g.id} disabled={!g.emails.length}>
                      {g.name} ({g.emails.length} {g.emails.length === 1 ? "email" : "emails"})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="assign-minutes">Time limit</label>
              <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                <input
                  id="assign-minutes"
                  type="number"
                  min={1}
                  max={360}
                  value={minutes}
                  disabled={!timed || !!already}
                  onChange={(e) => setMinutes(Math.max(1, Math.min(360, Number(e.target.value) || 1)))}
                  style={{ width: 90 }}
                />
                <span className="muted">min</span>
                <label className="radio" style={{ whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={!timed} disabled={!!already} onChange={(e) => setTimed(!e.target.checked)} /> No limit
                </label>
              </div>
            </div>
          </div>
          <p className="muted small">
            {mode === "class"
              ? `You get one link to post in Google Classroom or anywhere else. Each student signs in with their Google account${domain.trim() ? ` from ${domain.trim().replace(/^@/, "")}` : ""}, gets one try, and shows up in your results with their Google name and email.`
              : already
                ? `${group?.name} already has this test. Assigning again adds links for anyone you've added to the group since.`
                : "Each person gets their own link and access code. The clock starts when they enter the code, and they only see their own result."}
          </p>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy || (mode === "group" && !groupId)}>
              {busy ? (mode === "class" ? "Making the link…" : "Assigning…") : mode === "class" ? "Make class link" : already ? "Add new members" : "Assign test"}
            </button>
            {already && (
              <Link className="btn" to={`/tests/${already.id}`}>
                See results
              </Link>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </form>
      )}
      {tests.length > 0 && (
        <>
          <h3>Assigned</h3>
          <TestList tests={tests} />
        </>
      )}
    </section>
  );
}

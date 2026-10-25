import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import TopBar, { Chip } from "../components/TopBar";
import { deleteTest, getTestResults, resetTestLink, setClassTestOpen } from "../lib/db";
import { formatClock } from "../lib/pace";
import { choicesNote } from "../components/ChoicesOnly";
import { conceptStats, groupStats, questionStats, rankOf } from "../lib/testStats";
import { classLink, classShareText, shareText, takerLabel, testLink, testMailto } from "../lib/tests";
import type { TestResults as Results, TestTaker } from "../lib/types";
import { when } from "./Upgrade";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this", text);
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function status(t: TestTaker, total: number) {
  if (t.status === "completed") {
    return (
      <Chip tone={(t.score ?? 0) / total >= 0.7 ? "good" : "warn"}>
        {t.score}/{total} · {formatClock(t.usedSec ?? 0)}
        {t.late && " · late"}
      </Chip>
    );
  }
  if (t.locked) return <Chip tone="bad">Locked: too many wrong codes</Chip>;
  return t.status === "started" ? <Chip tone="warn">In progress</Chip> : <Chip>Not started</Chip>;
}

/** A class link student: their Google name and email, and where they are. No code, since they signed in. */
function ClassMember({ t, data }: { t: TestTaker; data: Results }) {
  return (
    <li className="request">
      <div className="row spread">
        <span>
          <b style={{ overflowWrap: "anywhere" }}>{takerLabel(t)}</b>
          {t.name && <span className="small muted" style={{ display: "block", overflowWrap: "anywhere" }}>{t.email}</span>}
        </span>
        <span className="row" style={{ gap: 8 }}>
          {t.status === "completed" && rankOf(data, t).of > 1 && <span className="small muted">#{rankOf(data, t).rank}</span>}
          {status(t, data.questions.length)}
        </span>
      </div>
      <span className="small">{t.status === "completed" ? `Finished ${when(t.completedAt)}` : `Started ${when(t.startedAt)}`}</span>
      {t.status === "completed" && (
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-small btn-primary" to={`/tests/${data.test.id}/m/${t.token}`}>
            See their result
          </Link>
        </div>
      )}
    </li>
  );
}

function Member({ t, data, onReset }: { t: TestTaker; data: Results; onReset: (t: TestTaker) => void }) {
  const [busy, setBusy] = useState(false);
  const title = data.test.deckTitle;
  const total = data.questions.length;
  return (
    <li className="request">
      <div className="row spread">
        <b style={{ overflowWrap: "anywhere" }}>{t.email}</b>
        <span className="row" style={{ gap: 8 }}>
          {t.status === "completed" && rankOf(data, t).of > 1 && <span className="small muted">#{rankOf(data, t).rank}</span>}
          {status(t, total)}
        </span>
      </div>
      <span className="small">
        {t.status === "completed"
          ? `Finished ${when(t.completedAt)}`
          : t.status === "started"
            ? `Started ${when(t.startedAt)}`
            : "Hasn't opened the test yet"}
        {" · "}Access code <span className="mono">{t.code}</span>
      </span>
      <div className="row" style={{ gap: 8 }}>
        <CopyButton text={shareText(title, t)} label="Copy link and code" />
        <a className="btn btn-small" href={testMailto(title, t)}>
          Email it
        </a>
        {t.status !== "completed" && (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                onReset(await resetTestLink(t.token));
              } finally {
                setBusy(false);
              }
            }}
          >
            New code
          </button>
        )}
        {t.status === "completed" && (
          <Link className="btn btn-small btn-primary" to={`/tests/${data.test.id}/m/${t.token}`}>
            See their result
          </Link>
        )}
      </div>
    </li>
  );
}

export default function TestResults() {
  const { testId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "score">("name");

  useEffect(() => {
    getTestResults(testId)
      .then(setData)
      .catch((e) => setError((e as Error).message || "This test couldn't be loaded."));
  }, [testId]);

  const back = { to: "/groups", label: "Groups" };
  if (error) return <><TopBar back={back} /><main className="page"><p className="error">{error}</p></main></>;
  if (!data) return <><TopBar back={back} /><main className="page"><span className="spinner" /></main></>;

  const { test, overall, questions, takers } = data;
  const N = questions.length;
  const g = groupStats(data);
  const qs = questionStats(data);
  const topics = conceptStats(data);
  const maxBand = Math.max(1, ...g.bands.map((b) => b.count));
  const isClass = test.kind === "class";
  const sorted =
    sortBy === "name"
      ? isClass
        ? [...takers].sort((a, b) => takerLabel(a).localeCompare(takerLabel(b)))
        : takers
      : [...takers].sort((a, b) => (b.status === "completed" ? 1 : 0) - (a.status === "completed" ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0) || (a.usedSec ?? 0) - (b.usedSec ?? 0));
  const allText = takers.map((t) => `${t.email}\n${testLink(t.token)}\nAccess code: ${t.code}`).join("\n\n");

  return (
    <>
      <TopBar back={back} />
      <main className="page narrow">
        <div className="stack">
          <div>
            <div className="eyebrow">
              {isClass ? `Class link${test.groupName ? ` · ${test.groupName}` : ""}` : `Group test · ${test.groupName}`} · {N} questions · {test.timeLimitSec ? `${Math.round(test.timeLimitSec / 60)} min` : "no time limit"}{choicesNote(test)}
            </div>
            <h1>{test.deckTitle}</h1>
          </div>
          <div className="row">
            <Link className="btn" to={`/decks/${test.deckId}`}>
              Open the deck
            </Link>
            {!isClass && <CopyButton text={allText} label="Copy everyone's link and code" />}
          </div>
          {isClass && test.classToken && (
            <div className="panel stack">
              <div className="row spread">
                <h2>Class link</h2>
                {test.open === false ? <Chip tone="warn">Closed to new students</Chip> : <Chip tone="good">Open</Chip>}
              </div>
              <p className="mono" style={{ overflowWrap: "anywhere" }}>{classLink(test.classToken)}</p>
              <p className="muted small">
                Post it in Google Classroom or send it any way you like. Students sign in with their Google account
                {test.allowedDomain ? ` (only @${test.allowedDomain} accounts)` : ""}, get one try each, and show up below with their Google name and email.
              </p>
              <div className="row" style={{ gap: 8 }}>
                <CopyButton text={classLink(test.classToken)} label="Copy link" />
                <CopyButton text={classShareText(test.deckTitle, test.classToken, test.allowedDomain)} label="Copy message for students" />
                <a
                  className="btn btn-small"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://classroom.google.com/share?url=${encodeURIComponent(classLink(test.classToken))}&title=${encodeURIComponent(test.deckTitle)}`}
                >
                  Share to Google Classroom
                </a>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={async () => {
                    const row = await setClassTestOpen(test.id, test.open === false);
                    setData({ ...data, test: { ...test, ...row } });
                  }}
                >
                  {test.open === false ? "Open to new students" : "Close to new students"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="tiles four">
          <div className="tile">
            <span className="label">Finished</span>
            <span className="value">
              {overall.completed} of {overall.assigned}
            </span>
            {isClass && <span className="muted">who opened the link</span>}
          </div>
          <div className="tile">
            <span className="label">Average score</span>
            <span className="value">
              {overall.averageScore === null ? "–" : `${Math.round((overall.averageScore / N) * 100)}%`}
            </span>
            {overall.averageScore !== null && <span className="muted">{overall.averageScore.toFixed(1)} of {N} right</span>}
          </div>
          <div className="tile">
            <span className="label">Average time</span>
            <span className="value">{overall.averageSec === null ? "–" : formatClock(overall.averageSec)}</span>
          </div>
          <div className="tile">
            <span className="label">In progress</span>
            <span className="value">{overall.started - overall.completed}</span>
          </div>
        </div>

        {overall.completed > 0 && (
          <>
            <div className="tiles four">
              <div className="tile">
                <span className="label">Median score</span>
                <span className="value">
                  {g.median === null ? "–" : `${g.median % 1 ? g.median.toFixed(1) : g.median}/${N}`}
                </span>
              </div>
              <div className="tile">
                <span className="label">Best and lowest</span>
                <span className="value">
                  {g.best}/{N} · {g.lowest}/{N}
                </span>
              </div>
              <div className="tile">
                <span className="label">Median time</span>
                <span className="value">{g.medianSec === null ? "–" : formatClock(g.medianSec)}</span>
              </div>
              <div className="tile">
                <span className="label">Sent late</span>
                <span className="value">{g.late}</span>
                <span className="muted">{g.late ? "after the time ran out" : "Everyone finished on time"}</span>
              </div>
            </div>

            <section className="panel stack">
              <h2>Scores</h2>
              <div className="tbars">
                {g.bands.map((b) => (
                  <div className="tbar wide" key={b.label}>
                    <span className="small">{b.label}</span>
                    <div className="b">
                      <i style={{ width: `${(b.count / maxBand) * 100}%`, background: "var(--accent)" }} />
                    </div>
                    <span className="mono">{b.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel stack">
              <div className="row spread">
                <h2>Question by question</h2>
                <span className="muted">Share of finishers who got it right{g.timed > 0 && ", and their average time"}</span>
              </div>
              {g.hardest && g.easiest && g.hardest.i !== g.easiest.i && (
                <p className="muted small">
                  Hardest was question {g.hardest.i + 1} ({Math.round(g.hardest.correctPct! * 100)}% right). Easiest was question {g.easiest.i + 1} ({Math.round(g.easiest.correctPct! * 100)}% right).
                </p>
              )}
              <div className="tbars">
                {questions.map((q, i) => {
                  const pct = overall.questionCorrect[i] / overall.completed;
                  return (
                    <div className={`tbar${g.timed > 0 ? " timed" : ""}`} key={i} title={`${q.prompt} ${q.math}`}>
                      <span className="mono muted">{i + 1}</span>
                      <div className="b">
                        <i style={{ width: `${pct * 100}%`, background: `var(--${pct >= 0.5 ? "accent" : "miss"})` }} />
                      </div>
                      <span className="mono">{Math.round(pct * 100)}%</span>
                      {g.timed > 0 && <span className="mono muted">{qs[i].avgSec === null ? "–" : formatClock(qs[i].avgSec!)}</span>}
                    </div>
                  );
                })}
              </div>
              {g.timed > 0 && g.timed < overall.completed && (
                <p className="muted small">Times come from the {g.timed} members who finished after MathSprint started tracking time per question.</p>
              )}
            </section>

            {topics.length > 1 && (
              <section className="panel stack">
                <h2>By topic</h2>
                <div className="tbars">
                  {topics.map((c) => (
                    <div className="tbar wide" key={c.concept}>
                      <span className="small">
                        {c.concept} <span className="muted">({c.questions})</span>
                      </span>
                      <div className="b">
                        <i style={{ width: `${c.pct * 100}%`, background: `var(--${c.pct >= 0.5 ? "accent" : "miss"})` }} />
                      </div>
                      <span className="mono">{Math.round(c.pct * 100)}%</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <section className="stack">
          <div className="row spread">
            <h2>{isClass ? "Students" : "Members"}</h2>
            <div className="seg" role="group" aria-label="Sort members">
              <button type="button" aria-pressed={sortBy === "name"} onClick={() => setSortBy("name")}>
                {isClass ? "By name" : "By email"}
              </button>
              <button type="button" aria-pressed={sortBy === "score"} onClick={() => setSortBy("score")}>
                By score
              </button>
            </div>
          </div>
          <div className="panel">
            <ul className="requests">
              {isClass && !sorted.length && <li className="muted">Nobody has opened the link yet. Students show up here as soon as they start.</li>}
              {sorted.map((t) =>
                isClass ? (
                  <ClassMember key={t.token} t={t} data={data} />
                ) : (
                <Member
                  key={t.token}
                  t={t}
                  data={data}
                  onReset={(fresh) => setData({ ...data, takers: takers.map((x) => (x.token === fresh.token ? fresh : x)) })}
                />
                ),
              )}
            </ul>
          </div>
        </section>

        <div className="row">
          {confirmDelete ? (
            <div className="confirm-delete" style={{ flexGrow: 1 }}>
              <span>Delete this test? Every link stops working and the results are gone for good.</span>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-small btn-danger-solid"
                  type="button"
                  onClick={async () => {
                    await deleteTest(test.id);
                    navigate("/groups", { replace: true });
                  }}
                >
                  Delete test
                </button>
                <button className="btn btn-small" type="button" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-small btn-danger" type="button" onClick={() => setConfirmDelete(true)}>
              Delete test
            </button>
          )}
        </div>
      </main>
    </>
  );
}

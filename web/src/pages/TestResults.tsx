import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import TopBar, { Chip } from "../components/TopBar";
import { deleteTest, getTestResults, resetTestLink } from "../lib/db";
import { formatClock } from "../lib/pace";
import { shareText, testLink, testMailto } from "../lib/tests";
import type { TestResults as Results, TestTaker } from "../lib/types";
import { when } from "./Upgrade";

function CopyButton({ text, label }: { text: string; label: string }) {
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

function Member({ t, data, onReset }: { t: TestTaker; data: Results; onReset: (t: TestTaker) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = data.test.deckTitle;
  const total = data.questions.length;
  return (
    <li className="request">
      <div className="row spread">
        <b style={{ overflowWrap: "anywhere" }}>{t.email}</b>
        {status(t, total)}
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
          <button type="button" className="btn btn-small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide answers" : "See answers"}
          </button>
        )}
      </div>
      {open && (
        <ol className="answer-grid">
          {data.questions.map((q, i) => (
            <li key={i} className={t.results[i] ? "ok" : "no"}>
              <span className="mono muted">{i + 1}</span>
              <span>
                {q.prompt} <span className="mono">{q.math}</span>
              </span>
              <span className="mono">{t.answers[i] || "–"}</span>
              <span>{t.results[i] ? <Chip tone="good">Correct</Chip> : <Chip tone="miss">Answer: {q.answerDisplay}</Chip>}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export default function TestResults() {
  const { testId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

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
  const allText = takers.map((t) => `${t.email}\n${testLink(t.token)}\nAccess code: ${t.code}`).join("\n\n");

  return (
    <>
      <TopBar back={back} />
      <main className="page narrow">
        <div className="stack">
          <div>
            <div className="eyebrow">
              Group test · {test.groupName} · {N} questions · {test.timeLimitSec ? `${Math.round(test.timeLimitSec / 60)} min` : "no time limit"}
            </div>
            <h1>{test.deckTitle}</h1>
          </div>
          <div className="row">
            <Link className="btn" to={`/decks/${test.deckId}`}>
              Open the deck
            </Link>
            <CopyButton text={allText} label="Copy everyone's link and code" />
          </div>
        </div>

        <div className="tiles four">
          <div className="tile">
            <span className="label">Finished</span>
            <span className="value">
              {overall.completed} of {overall.assigned}
            </span>
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
          <section className="panel stack">
            <div className="row spread">
              <h2>Question by question</h2>
              <span className="muted">Share of finishers who got it right</span>
            </div>
            <div className="tbars">
              {questions.map((q, i) => {
                const pct = overall.questionCorrect[i] / overall.completed;
                return (
                  <div className="tbar" key={i} title={`${q.prompt} ${q.math}`}>
                    <span className="mono muted">{i + 1}</span>
                    <div className="b">
                      <i style={{ width: `${pct * 100}%`, background: `var(--${pct >= 0.5 ? "accent" : "miss"})` }} />
                    </div>
                    <span className="mono">{Math.round(pct * 100)}%</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="stack">
          <h2>Members</h2>
          <div className="panel">
            <ul className="requests">
              {takers.map((t) => (
                <Member
                  key={t.token}
                  t={t}
                  data={data}
                  onReset={(fresh) => setData({ ...data, takers: takers.map((x) => (x.token === fresh.token ? fresh : x)) })}
                />
              ))}
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

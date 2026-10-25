import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import Figure from "../components/Figure";
import TopBar, { Chip } from "../components/TopBar";
import { getTestResults } from "../lib/db";
import { formatClock } from "../lib/pace";
import { memberStats, type Outcome } from "../lib/testStats";
import type { TestResults, TestTaker } from "../lib/types";
import { CopyButton } from "./TestResults";
import { when } from "./Upgrade";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const clock = (x: number | null) => (x === null ? "–" : formatClock(x));
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const tone: Record<Outcome, string> = { correct: "var(--good)", wrong: "var(--miss)", skipped: "var(--line)" };

function OutcomeChip({ o }: { o: Outcome }) {
  return o === "correct" ? <Chip tone="good">Correct</Chip> : o === "wrong" ? <Chip tone="miss">Incorrect</Chip> : <Chip>Skipped</Chip>;
}

/** A plain-text summary the owner can paste or email to the member. */
function summary(data: TestResults, t: TestTaker, s: ReturnType<typeof memberStats>) {
  const N = data.questions.length;
  const lines = [
    `MathSprint test result: ${data.test.deckTitle}`,
    t.name ? `${t.name} (${t.email})` : t.email,
    `Score: ${s.score}/${N} (${pct(s.pct)})`,
    `Time: ${formatClock(t.usedSec ?? 0)}${t.late ? " (sent late)" : ""}`,
    s.of > 1 ? `Place: ${ordinal(s.rank)} of ${s.of}` : "",
    `Correct ${s.correct}, incorrect ${s.wrong}, skipped ${s.skipped}`,
    "",
    ...s.rows.map((r) => `Q${r.i + 1}: ${r.outcome === "correct" ? "correct" : r.outcome === "wrong" ? `incorrect (answer ${data.questions[r.i].answerDisplay})` : "skipped"}${r.sec !== null ? `, ${formatClock(r.sec)}` : ""}`),
  ];
  return lines.filter((l, i) => l || i > 0).join("\n");
}

/** The test owner's view of one member's finished test. */
export default function MemberResult() {
  const { testId = "", token = "" } = useParams();
  const [data, setData] = useState<TestResults | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getTestResults(testId)
      .then(setData)
      .catch((e) => setError((e as Error).message || "This test couldn't be loaded."));
  }, [testId]);

  const back = { to: `/tests/${testId}`, label: "All results" };
  const t = data?.takers.find((x) => x.token === token);
  const frame = (body: ReactNode) => (
    <>
      <TopBar back={back} />
      <main className="page">{body}</main>
    </>
  );
  if (error) return frame(<p className="error">{error}</p>);
  if (!data) return frame(<span className="spinner" />);
  if (!t) return frame(<p className="error">That member isn't on this test any more.</p>);
  if (t.status !== "completed") return frame(<p className="muted">{t.email} hasn't finished this test yet. Their result shows here once they send their answers.</p>);

  const s = memberStats(data, t);
  const N = data.questions.length;
  const maxSec = Math.max(1, ...s.rows.map((r) => Math.max(r.sec ?? 0, r.groupAvgSec ?? 0)));
  const text = summary(data, t, s);
  const mailto = `mailto:${encodeURIComponent(t.email)}?subject=${encodeURIComponent(`Your result: ${data.test.deckTitle}`)}&body=${encodeURIComponent(text)}`;

  return (
    <>
      <TopBar back={back} />
      <main className="page narrow">
        <div className="stack">
          <div>
            <div className="eyebrow">
              {data.test.deckTitle} · {data.test.kind === "class" ? data.test.groupName || "Class link" : data.test.groupName}
            </div>
            <h1 style={{ overflowWrap: "anywhere" }}>{t.name || t.email}</h1>
            {t.name && <p className="muted" style={{ overflowWrap: "anywhere" }}>{t.email}</p>}
            <p className="muted">
              Started {when(t.startedAt)} · finished {when(t.completedAt)}
              {t.late && " · sent after the time ran out"}
            </p>
          </div>
          <div className="row">
            <CopyButton text={text} label="Copy result" />
            <a className="btn btn-small" href={mailto}>
              Email it to them
            </a>
          </div>
        </div>

        <div className="panel stack">
          <div className="score">
            <div className="big mono">
              {s.score}
              <span className="muted" style={{ fontSize: 32 }}>/{N}</span>
            </div>
            <div>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 28, fontWeight: 800 }}>{pct(s.pct)}</div>
              <div className="muted">
                {s.of > 1 ? (
                  <>
                    <b>{ordinal(s.rank)}</b> of {s.of} who finished
                    {s.beat !== null && ` · ahead of ${pct(s.beat)} of them`}
                  </>
                ) : (
                  "The only one to finish so far"
                )}
              </div>
            </div>
          </div>
          <div className="kv">
            <div><span>Correct</span><b>{s.correct}</b></div>
            <div><span>Incorrect</span><b>{s.wrong}</b></div>
            <div><span>Skipped</span><b>{s.skipped}</b></div>
            <div><span>Group average</span><b>{s.groupAvgScore === null ? "–" : `${s.groupAvgScore.toFixed(1)}/${N}`}</b></div>
          </div>
        </div>

        <div className="tiles four">
          <div className="tile">
            <span className="label">Total time</span>
            <span className="value">{formatClock(t.usedSec ?? 0)}</span>
            <span className="muted">Group average {clock(s.groupAvgSec)}</span>
          </div>
          <div className="tile">
            <span className="label">Per question</span>
            <span className="value">{clock(s.secPerQuestion)}</span>
            <span className="muted">on average</span>
          </div>
          <div className="tile">
            <span className="label">On right answers</span>
            <span className="value">{clock(s.secCorrect)}</span>
            <span className="muted">On wrong ones {clock(s.secWrong)}</span>
          </div>
          <div className="tile">
            <span className="label">Answers changed</span>
            <span className="value">{t.changes ? s.changedTotal : "–"}</span>
            {s.quickRight !== null && <span className="muted">{s.quickRight} right and faster than the group</span>}
          </div>
        </div>

        {s.timed ? (
          <section className="panel stack">
            <div className="row spread">
              <h2>Time on each question</h2>
              <span className="legend">
                <span><i style={{ background: tone.correct }} /> Correct</span>
                <span><i style={{ background: tone.wrong }} /> Incorrect</span>
                <span><i className="mark" /> Group average</span>
              </span>
            </div>
            {s.fastest !== null && s.slowest !== null && (
              <p className="muted small">
                Quickest on question {s.fastest + 1} ({clock(s.rows[s.fastest].sec)}), longest on question {s.slowest + 1} ({clock(s.rows[s.slowest].sec)}).
              </p>
            )}
            <div className="tbars">
              {s.rows.map((r) => (
                <div className="tbar" key={r.i} title={`${data.questions[r.i].prompt} ${data.questions[r.i].math}`}>
                  <span className="mono muted">{r.i + 1}</span>
                  <div className="b">
                    <i style={{ width: `${((r.sec ?? 0) / maxSec) * 100}%`, background: tone[r.outcome] }} />
                    {r.groupAvgSec !== null && <span className="t" style={{ left: `${(r.groupAvgSec / maxSec) * 100}%` }} />}
                  </div>
                  <span className="mono">{clock(r.sec)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <p className="muted small">Time on each question wasn't recorded for this member, because they finished before MathSprint started tracking it.</p>
        )}

        {s.concepts.length > 1 && (
          <section className="panel stack">
            <div className="row spread">
              <h2>By topic</h2>
              <span className="legend">
                <span><i style={{ background: "var(--accent)" }} /> {t.name || t.email.split("@")[0]}</span>
                <span><i className="mark" /> Group</span>
              </span>
            </div>
            <div className="tbars">
              {s.concepts.map((c) => (
                <div className="tbar wide" key={c.concept}>
                  <span className="small">
                    {c.concept} <span className="muted">({c.questions})</span>
                  </span>
                  <div className="b">
                    <i style={{ width: `${c.pct * 100}%`, background: "var(--accent)" }} />
                    {c.groupPct !== null && <span className="t" style={{ left: `${c.groupPct * 100}%` }} />}
                  </div>
                  <span className="mono">{pct(c.pct)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <h2>Question by question</h2>
          {s.rows.map((r) => {
            const q = data.questions[r.i];
            return (
              <div className="review-item" key={r.i}>
                <div className="review-head">
                  <h3>Question {r.i + 1}</h3>
                  <OutcomeChip o={r.outcome} />
                </div>
                <p>
                  {q.prompt} <span className="mono">{q.math}</span>
                </p>
                {q.figure && <Figure figure={q.figure} small />}
                <div className="ans">
                  <span className="muted">Their answer</span>
                  <b>{t.answers[r.i] || "–"}</b>
                  <span className="muted">Correct answer</span>
                  <b>{q.answerDisplay}</b>
                  {r.sec !== null && (
                    <>
                      <span className="muted">Time</span>
                      <b>
                        {clock(r.sec)} <span className="muted small">group {clock(r.groupAvgSec)}</span>
                      </b>
                    </>
                  )}
                  <span className="muted">Group got it right</span>
                  <b>{pct(r.groupCorrectPct)}</b>
                  {r.visits !== null && (
                    <>
                      <span className="muted">Opened</span>
                      <b>
                        {r.visits} {r.visits === 1 ? "time" : "times"}
                        {r.changes ? ` · answer changed ${r.changes}×` : ""}
                      </b>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </main>
    </>
  );
}

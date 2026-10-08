import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chip, Icon } from "../components/TopBar";
import { advance, finishSession, getQuestions, getSession, saveAnswer } from "../lib/db";
import { formatClock, pace, pressureBackground, stage } from "../lib/pace";
import type { EndReason, PracticeSession, Question } from "../lib/types";

const TICK_MS = 250;

/** "x =" in front of the answer box when a solve question has one obvious variable. */
function answerPrefix(q: Question) {
  if (q.type !== "numeric" || !/^(solve|find)/i.test(q.prompt)) return "";
  const vars = new Set(q.math.match(/(?<![A-Za-z])[a-z](?![A-Za-z])/g) ?? []);
  return vars.size === 1 ? `${[...vars][0]} =` : "";
}

export default function Practice() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [now, setNow] = useState(Date.now());
  const [saved, setSaved] = useState(false);
  const ending = useRef(false);
  const saveTimer = useRef<number>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const s = await getSession(sessionId);
      if (!s) return navigate("/", { replace: true });
      if (s.status === "completed") return navigate(`/sessions/${s.id}/results`, { replace: true });
      // A refresh loses at most the last half-second of typing: prefer the local copy if it is newer.
      try {
        const local = JSON.parse(localStorage.getItem(`ms.answers.${s.id}`) || "{}");
        s.answers = { ...s.answers, ...local };
      } catch {
        /* storage unavailable */
      }
      const all = await getQuestions(s.deckId);
      const byId = new Map(all.map((q) => [q.id, q]));
      setQuestions(s.questionIds.map((id) => byId.get(id)!).filter(Boolean));
      setSession(s);
    })();
  }, [sessionId, navigate]);

  const elapsedSec = session ? (now - session.startedAtMs) / 1000 : 0;
  // Learn mode has no time limit: the clock counts up and nothing ends the session but the student.
  const timed = (session?.timeLimitSec ?? 0) > 0;
  const total = timed ? session!.timeLimitSec : Infinity;

  const end = useCallback(
    async (reason: EndReason) => {
      if (!session || ending.current) return;
      ending.current = true;
      window.clearTimeout(saveTimer.current);
      const used = Math.min(total, (Date.now() - session.startedAtMs) / 1000);
      await finishSession(session, questions, reason, used);
      try {
        localStorage.removeItem(`ms.answers.${session.id}`);
      } catch {
        /* ignore */
      }
      navigate(`/sessions/${session.id}/results`, { replace: true });
    },
    [session, questions, total, navigate],
  );

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (session && timed && elapsedSec >= total) end("timeout");
  }, [session, timed, elapsedSec, total, end]);

  useEffect(() => {
    inputRef.current?.focus();
    setSaved(false);
  }, [session?.currentIndex]);

  const remaining = timed ? Math.max(0, total - elapsedSec) / total : 1;
  const background = useMemo(() => (session && timed ? pressureBackground(remaining) : "none"), [session, timed, remaining]);

  if (!session || !questions.length) return <main className="page practice"><span className="spinner" /></main>;

  const N = questions.length;
  const i = session.currentIndex;
  const q = questions[i];
  const answer = session.answers[i] ?? "";
  const last = i === N - 1;
  const perQ = timed ? total / N : 0;
  const p = timed ? pace(elapsedSec, total, N, i) : null;
  const prefix = answerPrefix(q);
  const st = stage(remaining);
  const onQuestion = elapsedSec - (session.timings[i]?.startedAt ?? 0) / 1000;

  const setAnswer = (value: string) => {
    const answers = { ...session.answers, [i]: value };
    setSession({ ...session, answers });
    setSaved(false);
    try {
      localStorage.setItem(`ms.answers.${session.id}`, JSON.stringify(answers));
    } catch {
      /* ignore */
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveAnswer(session.id, i, value).then(() => setSaved(true)), 500);
  };

  const next = async () => {
    window.clearTimeout(saveTimer.current);
    if (last) return end("finished");
    const at = Date.now() - session.startedAtMs;
    await Promise.all([saveAnswer(session.id, i, answer), advance(session.id, i, at)]);
    setSession({
      ...session,
      currentIndex: i + 1,
      timings: { ...session.timings, [i]: { ...session.timings[i], answeredAt: at }, [i + 1]: { startedAt: at } },
    });
  };

  return (
    <>
      <div className="pressure" style={{ background }} aria-hidden />
      <main className="page practice">
        <div className="practice-top">
          <div className="row spread">
            <div>
              <div className="eyebrow">{session.deckTitle}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                Question {i + 1} of {N}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {timed ? (
                <>
                  <div className="clock" style={{ color: st.tone === "neutral" ? "var(--ink)" : `var(--${st.tone})` }} role="timer">
                    {formatClock(total - elapsedSec)}
                  </div>
                  <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
                    {st.label}
                  </div>
                </>
              ) : (
                <>
                  <div className="clock muted">{formatClock(elapsedSec)}</div>
                  <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
                    Learn mode · no time limit
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="track" aria-label={p ? `${i} of ${N} done; target is ${p.expected.toFixed(1)}` : `${i} of ${N} done`}>
            <div className="fill" style={{ width: `${(i / N) * 100}%` }} />
            {p && <div className="target" style={{ left: `calc(${(p.expected / N) * 100}% - 1px)` }} />}
          </div>
          {p && (
            <div className="pace" aria-live="polite">
              <Chip tone={p.tone}>{p.label}</Chip>
              <span>{p.message}</span>
            </div>
          )}
        </div>

        <div className="panel qcard">
          <div className="qtext">{q.prompt}</div>
          {q.math && <div className="qmath">{q.math}</div>}
          {q.type === "choice" ? (
            <div className="choices" role="group" aria-label="Choices">
              {q.choices.map((c) => (
                <button key={c} type="button" aria-pressed={answer === c} onClick={() => setAnswer(c)}>
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <div>
              <label htmlFor="ans">Your answer</label>
              <div className="answer-wrap">
                {prefix && <span aria-hidden>{prefix}</span>}
                <input
                  id="ans"
                  ref={inputRef}
                  className="answer-input"
                  type="text"
                  autoComplete="off"
                  placeholder={q.answerValues.length > 1 ? "e.g. 2, -3" : "e.g. 5"}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && next()}
                />
              </div>
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                {q.answerValues.length > 1
                  ? "Separate answers with commas. Fractions like 1/2 are fine."
                  : "Enter a number. Fractions like 1/2 are fine."}
              </p>
            </div>
          )}
          <div className="row spread">
            <div className="qtimer">
              This question <b className={`mono ${timed && onQuestion > perQ ? "over" : ""}`}>{formatClock(onQuestion)}</b>
              {timed && <> / target {formatClock(perQ)}</>}
            </div>
            <div className="row">
              <span className="saved">{saved && answer ? "Saved" : ""}</span>
              <button className="btn btn-primary btn-big practice-next" onClick={next}>
                {last ? (
                  <>
                    Finish <Icon name="check" />
                  </>
                ) : (
                  <>
                    Next <Icon name="next" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="row spread">
          <button className="btn-link" style={{ color: "var(--muted)" }} onClick={() => end("quit")}>
            End session early
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Answers save automatically, so a refresh won't lose your place
          </span>
        </div>
      </main>
    </>
  );
}

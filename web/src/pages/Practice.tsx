import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chip } from "../components/TopBar";
import { advance, finishSession, getQuestions, getSession, saveAnswer } from "../lib/db";
import { formatClock, pace, pressureBackground, stage } from "../lib/pace";
import type { EndReason, PracticeSession, Question } from "../lib/types";

const TICK_MS = 250;

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
  const total = session?.timeLimitSec ?? 1;

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
    if (session && elapsedSec >= total) end("timeout");
  }, [session, elapsedSec, total, end]);

  useEffect(() => {
    inputRef.current?.focus();
    setSaved(false);
  }, [session?.currentIndex]);

  const remaining = Math.max(0, total - elapsedSec) / total;
  const background = useMemo(() => (session ? pressureBackground(remaining) : "none"), [session, remaining]);

  if (!session || !questions.length) return <div className="wrap"><span className="spinner" /></div>;

  const N = questions.length;
  const i = session.currentIndex;
  const q = questions[i];
  const answer = session.answers[i] ?? "";
  const last = i === N - 1;
  const perQ = total / N;
  const p = pace(elapsedSec, total, N, i);
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
      <div className="wrap">
        <div className="practice-top">
          <div className="row spread">
            <div>
              <div className="eyebrow">{session.deckTitle}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>
                Question {i + 1} of {N}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="clock" style={{ color: st.tone === "neutral" ? "var(--ink)" : `var(--${st.tone})` }} role="timer">
                {formatClock(total - elapsedSec)}
              </div>
              <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
                {st.label}
              </div>
            </div>
          </div>
          <div className="track" aria-label={`${i} of ${N} done; target is ${p.expected.toFixed(1)}`}>
            <div className="fill" style={{ width: `${(i / N) * 100}%` }} />
            <div className="target" style={{ left: `calc(${(p.expected / N) * 100}% - 1px)` }} />
          </div>
          <div className="pace" aria-live="polite">
            <Chip tone={p.tone}>{p.label}</Chip>
            <span>{p.message}</span>
          </div>
        </div>

        <div className="panel qcard" style={{ marginTop: 20 }}>
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
              <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                {q.answerValues.length > 1
                  ? "Separate multiple answers with commas. Fractions like 1/2 are fine."
                  : "Enter a number. Fractions like 1/2 are fine."}
              </p>
            </div>
          )}
          <div className="row spread">
            <div className="qtimer">
              This question <b className={`mono ${onQuestion > perQ ? "over" : ""}`}>{formatClock(onQuestion)}</b> / target {formatClock(perQ)}
            </div>
            <div className="row">
              <span className="saved">{saved && answer ? "Saved" : ""}</span>
              <button className="btn-primary btn-big" onClick={next}>
                {last ? "Finish" : "Next →"}
              </button>
            </div>
          </div>
        </div>
        <div className="row spread" style={{ marginTop: 14 }}>
          <button className="btn-link" style={{ color: "var(--muted)" }} onClick={() => end("quit")}>
            End session early
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Answers save automatically
          </span>
        </div>
      </div>
    </>
  );
}

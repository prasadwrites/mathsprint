import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAccount, useIsAdmin } from "../App";
import TopBar, { Icon } from "../components/TopBar";
import { listTeacherExams, setTeacher } from "../lib/db";
import { publicDeckPath } from "../lib/publicDeck";
import type { PublicDeckCard, TeacherExam, TeacherExamsCatalog } from "../lib/types";

const STATE_KEY = "ms.teacherState";
/** Admin only: every exam at once, to build decks for any of them. */
const ALL = "ALL";

/** What the admin's "Build a deck" hands to the deck builder (/create). focus is a content category's index, or null
 * for the whole exam mixed by weight. */
export interface CertBuild {
  exam: string;
  examLabel: string;
  focus: number | null;
  title: string;
}

function rememberedState() {
  try {
    return localStorage.getItem(STATE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberState(code: string) {
  try {
    localStorage.setItem(STATE_KEY, code);
  } catch {
    /* storage blocked: they pick it again next time */
  }
}

/** The math teacher certification section, for teacher accounts (and the admin): a teacher picks their state and sees
 * its exams, each with its content categories and the ready-made practice decks for it. */
export default function TeacherExams() {
  const admin = useIsAdmin();
  const { account, refresh } = useAccount();
  if (!account && !admin) {
    return (
      <>
        <TopBar />
        <main className="page narrow"><span className="spinner" /></main>
      </>
    );
  }
  if (!admin && !account?.isTeacher) return <NotATeacher onTurnedOn={refresh} />;
  return <TeacherExamsPage admin={admin} />;
}

/** For an account that hasn't said it's a teacher's: what the section is, and a way to turn teacher tools on. */
function NotATeacher({ onTurnedOn }: { onTurnedOn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <TopBar />
      <main className="page narrow stack">
        <h1 style={{ margin: 0 }}>Teacher tools</h1>
        <p className="muted" style={{ margin: 0 }}>
          Teacher exam prep, for math teacher certification exams such as Praxis, TExES and CSET, is part of the teacher tools. They're only added to
          teacher accounts. If you're a teacher, or training to be one, add them to your account.
        </p>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await setTeacher(true);
                onTurnedOn();
              } catch (e) {
                setError((e as Error).message || "That didn't save. Try again.");
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "I'm a teacher: add teacher tools"}
          </button>
        </div>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      </main>
    </>
  );
}

function TeacherExamsPage({ admin }: { admin: boolean }) {
  const [params, setParams] = useSearchParams();
  const [catalog, setCatalog] = useState<TeacherExamsCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const state = (params.get("state") || rememberedState()).toUpperCase();

  useEffect(() => {
    listTeacherExams().then(setCatalog).catch(() => setFailed(true));
  }, []);

  const pick = (code: string) => {
    if (code !== ALL) rememberState(code);
    setParams(code ? { state: code } : {}, { replace: true });
  };

  const byId = useMemo(() => new Map((catalog?.exams ?? []).map((e) => [e.id, e])), [catalog]);
  const chosen = catalog?.states.find((s) => s.code === state);
  const shown: TeacherExam[] =
    state === ALL && admin
      ? catalog?.exams ?? []
      : chosen
        ? (chosen.exams.length ? chosen.exams : ["praxis-5165", "praxis-5164"]).map((id) => byId.get(id)).filter((e): e is TeacherExam => !!e)
        : [];

  const bar = <TopBar />;

  return (
    <>
      {bar}
      <main className="page narrow stack teacher-exams">
        <div className="stack" style={{ gap: 8 }}>
          <h1 style={{ margin: 0 }}>Math teacher certification prep</h1>
          <p className="muted" style={{ margin: 0 }}>
            Practice for the math exam your state requires to teach middle school or high school. Pick your state to see its exams and their ready-made
            practice decks. Every question is original, written to the exam's official content categories, and checked before it's saved. You take them
            with a timer, at the exam's pace, and see your results by content category.
          </p>
        </div>

        <div className="panel stack" style={{ gap: 8 }}>
          <label htmlFor="teacher-state" style={{ margin: 0 }}>
            Your state
          </label>
          <select id="teacher-state" value={chosen || (admin && state === ALL) ? state : ""} onChange={(e) => pick(e.target.value)} disabled={!catalog} style={{ maxWidth: 360 }}>
            <option value="">Choose your state</option>
            {admin && <option value={ALL}>All exams (admin)</option>}
            {catalog?.states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {failed && <p className="error">The exams couldn't be loaded. Refresh the page to try again.</p>}
        {!catalog && !failed && <span className="spinner" />}

        {chosen && !chosen.exams.length && (
          <p className="notice" role="status" style={{ display: "block", margin: 0 }}>
            We haven't confirmed which math exams {chosen.name} requires yet, so check with your state's education department before you register. Many
            states use the Praxis exams below, and their content is a good match for most middle and high school math licensure tests.
          </p>
        )}
        {chosen?.note && <p className="muted" style={{ margin: 0 }}>{chosen.note}</p>}
        {chosen && !!chosen.exams.length && (
          <p className="muted small" style={{ margin: 0 }}>
            Requirements change, so confirm the exam and passing score with your state or teacher preparation program before you register.
          </p>
        )}

        {shown.map((exam) => (
          <ExamPanel key={exam.id} exam={exam} decks={catalog?.decks.filter((d) => d.certExam === exam.id) ?? []} admin={admin} />
        ))}
      </main>
    </>
  );
}

function ExamPanel({ exam, decks, admin }: { exam: TeacherExam; decks: PublicDeckCard[]; admin: boolean }) {
  const navigate = useNavigate();
  const [focus, setFocus] = useState("all");
  const headingId = `exam-${exam.id}`;
  const build = () => {
    const i = focus === "all" ? null : Number(focus);
    const short = `${exam.program} ${exam.code}`;
    const certBuild: CertBuild = {
      exam: exam.id,
      examLabel: exam.label,
      focus: i,
      title: i === null ? `${short} ${exam.name}: mixed practice` : `${short}: ${exam.categories[i].name}`,
    };
    navigate("/create", { state: { certBuild } });
  };
  return (
    <section className="panel stack" aria-labelledby={headingId}>
      <div className="stack" style={{ gap: 4 }}>
        <h2 id={headingId} style={{ margin: 0 }}>{exam.label}</h2>
        <span className="muted">
          {exam.grades} · {exam.format}
        </span>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Practice decks</h3>
        {decks.length ? (
          decks.map((d) => (
            <Link key={d.id} className="panel deck-card public-deck" to={publicDeckPath(d.id)}>
              <b>{d.title}</b>
              <span className="meta">
                {d.questionCount} questions · {d.difficulty}
                {d.examPace ? ` · exam pace about ${formatPace(d.examPace)} per question` : ""}
              </span>
            </Link>
          ))
        ) : (
          <p className="muted" style={{ margin: 0 }}>Practice decks for this exam are on the way. Check back soon.</p>
        )}
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>What's on it</h3>
        <ul className="exam-cats">
          {exam.categories.map((c) => (
            <li key={c.name}>
              <div className="row spread" style={{ gap: 8 }}>
                <b>{c.name}</b>
                <span className="muted">about {c.percent}%</span>
              </div>
              <div className="bar" aria-hidden="true">
                <i style={{ width: `${c.percent}%`, background: "var(--accent)" }} />
              </div>
              <span className="muted small">{c.covers}</span>
            </li>
          ))}
        </ul>
        {exam.teaching && <p className="muted small" style={{ margin: 0 }}>{exam.teaching}</p>}
        <a className="small" href={exam.source} target="_blank" rel="noopener noreferrer">
          Official test framework
        </a>
      </div>

      {admin && (
        <div className="row" style={{ gap: 8 }}>
          <label htmlFor={`focus-${exam.id}`} className="sr-only">
            What the new deck covers
          </label>
          <select id={`focus-${exam.id}`} value={focus} onChange={(e) => setFocus(e.target.value)} style={{ width: "auto", maxWidth: "100%" }}>
            <option value="all">Whole exam, mixed by weight</option>
            {exam.categories.map((c, i) => (
              <option key={c.name} value={String(i)}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={build}>
            <Icon name="sparkle" /> Build a deck
          </button>
        </div>
      )}
    </section>
  );
}

function formatPace(minutes: number) {
  const whole = Math.floor(minutes);
  const sec = Math.round((minutes - whole) * 60);
  return sec ? `${whole} min ${sec} s` : `${whole} min`;
}

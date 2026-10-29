import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAccount, useIsAdmin } from "../App";
import SubjectEditor from "../components/SubjectEditor";
import TopBar, { Chip, Icon } from "../components/TopBar";
import { type DeckProgress, generateDeck, newProgressId, watchDeckProgress } from "../lib/db";
import { formatClock } from "../lib/pace";
import { DEFAULT_SUBJECT, STARTER_SUBJECTS, cleanSubjects, isMath, listSubjects, sameSubject } from "../lib/subjects";
import type { Difficulty } from "../lib/types";

const CODE_KEY = "ms.accessCode";

function storedCode() {
  try {
    return localStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeCode(code: string | null) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* storage unavailable */
  }
}

// Matches the server's limit; base64 makes the upload a third bigger, still well inside a function request.
const MAX_PDF_MB = 10;

/** The progress panel shown while the server builds the deck. `progress` is null until its first update. */
function BuildProgress({ progress, count, pdf, math }: { progress: DeckProgress | null; count: number; pdf: boolean; math: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const total = progress?.total || count;
  const written = progress?.written ?? 0;
  const checked = progress?.checked ?? 0;
  // Parts of a big deck run side by side, so one can be checking while others are still writing.
  const stage = !progress ? (pdf ? "reading" : "writing") : written < total && progress.stage !== "reading" ? "writing" : progress.stage;
  const doing = {
    reading: "Reading your PDF",
    writing: written === 0 ? "Planning the questions" : `Writing question ${written + 1}`,
    checking: math ? "Checking every answer with a math engine" : "Checking every answer",
    fixing: "Rewriting questions that didn't check out",
    saving: "Saving your deck",
  }[stage];
  const waiting = stage === "reading" || (stage === "writing" && written === 0);
  return (
    <div className="panel stack" aria-live="polite">
      <div className="row spread">
        <h2 className="row" style={{ gap: 10 }}>
          <span className="spinner" /> Building your deck
        </h2>
        <span className="muted small mono">{formatClock(elapsed)}</span>
      </div>
      <p className="note">
        This runs in the background and takes a while: {count > 20 ? "big decks can take several minutes" : "usually a minute or two"}.
        You can leave this page; the deck still gets finished and shows up under My decks.
      </p>
      <div>
        <div
          className={`progress${waiting ? " waiting" : ""}`}
          role="progressbar"
          aria-label="Questions written"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={written}
        >
          <i style={{ width: `${(written / total) * 100}%` }} />
        </div>
        <div className="row spread" style={{ marginTop: 8 }}>
          <strong>
            {written} of {total} questions written
          </strong>
          {checked > 0 && <span className="muted small">{checked} checked</span>}
        </div>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {doing}…
        </p>
      </div>
    </div>
  );
}

/** Example topics for the topic box, by subject. */
const EXAMPLES: Record<string, { topic: string; level: string; notes: string }> = {
  math: { topic: "Related rates", level: "AP Calculus BC or Calculus II", notes: "Include some word problems and make at least 2 questions require factoring." },
  physics: { topic: "Projectile motion", level: "AP Physics 1 or Physics I", notes: "Include a few calculations and some conceptual questions." },
  chemistry: { topic: "Balancing equations", level: "AP Chemistry or General Chemistry", notes: "Include a few stoichiometry calculations." },
  biology: { topic: "Cell division", level: "AP Biology or 10th grade", notes: "Focus on the differences between mitosis and meiosis." },
  "general knowledge": { topic: "World capitals", level: "High school", notes: "Mix easy questions with a few hard ones." },
};
const examples = (subject: string) =>
  EXAMPLES[isMath(subject) ? "math" : subject.toLowerCase()] ?? { topic: `a unit or chapter in ${subject}`, level: "11th grade or an intro college course", notes: "Say what to focus on or what kinds of questions you want." };

export default function CreateDeck() {
  const navigate = useNavigate();
  const { account, refresh } = useAccount();
  const isAdmin = useIsAdmin();
  // Until the account loads, assume the free plan; the server checks the real limits either way.
  const maxQuestions = account?.maxQuestions ?? 20;
  const outOfDecks = !!account && !account.isAdmin && account.decksCreated >= account.maxDecks;
  const suspended = account?.status === "suspended";
  const [params] = useSearchParams();
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [asked, setAsked] = useState(!!params.get("topic"));
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [level, setLevel] = useState("");
  const [notes, setNotes] = useState(params.get("notes") ?? "");
  const [choicesOnly, setChoicesOnly] = useState(false);
  const [accessCode, setAccessCode] = useState(storedCode);
  // Set when the server asks for a code the account summary didn't know about yet.
  const [codeAsked, setCodeAsked] = useState(false);
  const needsCode = codeAsked || !!account?.needsCode;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DeckProgress | null>(null);
  // The build keeps going if the student leaves the page; when it ends, don't pull them back to the deck.
  const here = useRef(true);
  useEffect(() => () => void (here.current = false), []);
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [subjects, setSubjects] = useState(() => cleanSubjects(STARTER_SUBJECTS));
  const [subject, setSubject] = useState(params.get("subject") || DEFAULT_SUBJECT);
  const [editing, setEditing] = useState(false);
  const math = isMath(subject);
  const ex = examples(subject);

  useEffect(() => {
    listSubjects().then((list) => {
      setSubjects(list);
      // A subject from the link that isn't on the list (anymore) falls back to Math.
      setSubject((s) => list.find((l) => sameSubject(l, s)) ?? DEFAULT_SUBJECT);
    });
  }, []);

  const pickPdf = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("That file isn't a PDF.");
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setError(`That PDF is too large. Upload one under ${MAX_PDF_MB} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPdf({ name: file.name, data: String(reader.result).split(",")[1] ?? "" });
      setAsked(true);
    };
    reader.onerror = () => setError("That file couldn't be read. Try another one.");
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    setProgress(null);
    const progressId = newProgressId();
    // The server writes progress there as it goes; the watch starts first so no update is missed.
    const stop = watchDeckProgress(progressId, (p) => p && setProgress(p));
    try {
      const res = await generateDeck({
        topic,
        count: clamp(count),
        difficulty,
        // With a PDF, an empty level lets the server use the course the PDF is pitched at.
        level: level || (pdf ? "" : "High school or college"),
        notes,
        subject,
        accessCode: accessCode.trim(),
        choicesOnly,
        progressId,
        ...(pdf && { pdf: pdf.data, pdfName: pdf.name }),
      });
      if (needsCode) storeCode(accessCode.trim());
      refresh();
      if (here.current) navigate(`/decks/${res.deckId}?fresh=1${res.dropped ? `&dropped=${res.dropped}` : ""}`);
    } catch (e) {
      if ((e as Error).message === "That access code isn't right.") storeCode(null);
      if (/access code/i.test((e as Error).message)) setCodeAsked(true);
      refresh();
      setError((e as Error).message || "The deck couldn't be generated. Try again.");
      setBusy(false);
    } finally {
      stop();
    }
  };

  const clamp = (n: number) => Math.max(3, Math.min(maxQuestions, n || 3));

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page">
        <h1>Create a practice deck</h1>
        <div className="two-col">
          <div className="main stack">
            <div className="panel chat">
              <div className="bubble bot">What would you like to practice?</div>
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <label htmlFor="subject" style={{ margin: 0 }}>
                    Subject
                  </label>
                  <select id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} style={{ width: "auto", minWidth: 180 }}>
                    {subjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {isAdmin && (
                    <button type="button" className="btn-link" onClick={() => setEditing(!editing)}>
                      {editing ? "Done editing" : "Edit subjects"}
                    </button>
                  )}
                </div>
                {editing && isAdmin && (
                  <SubjectEditor
                    subjects={subjects}
                    onChange={(list) => {
                      setSubjects(list);
                      setSubject((s) => list.find((l) => sameSubject(l, s)) ?? DEFAULT_SUBJECT);
                    }}
                  />
                )}
              </div>
              {asked ? (
                <>
                  {pdf ? (
                    <>
                      <div className="bubble me row" style={{ gap: 6 }}>
                        <Icon name="file" /> {pdf.name}
                      </div>
                      <div className="bubble bot">I'll read it and write new questions on the same topics, in the same style. A few quick details first.</div>
                    </>
                  ) : (
                    <>
                      <div className="bubble me">
                        {topic}
                        {!math && <span className="muted"> · {subject}</span>}
                      </div>
                      <div className="bubble bot">Good choice. A few quick details and I'll write it.</div>
                    </>
                  )}
                </>
              ) : (
                <>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (topic.trim()) setAsked(true);
                  }}
                >
                  <input
                    id="topic"
                    type="text"
                    autoFocus
                    placeholder={`e.g. ${ex.topic}`}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button className="btn-primary" type="submit">
                    Next
                  </button>
                </form>
                <div className="row" style={{ gap: 10 }}>
                  <label className="btn" style={{ margin: 0 }}>
                    <Icon name="file" /> Upload a PDF
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      hidden
                      onChange={(e) => {
                        pickPdf(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span className="muted" style={{ fontSize: 14 }}>
                    A worksheet, class notes or textbook pages, up to {MAX_PDF_MB} MB
                  </span>
                </div>
                {error && <p className="error">{error}</p>}
                </>
              )}
            </div>

            {busy && <BuildProgress progress={progress} count={clamp(count)} pdf={!!pdf} math={math} />}

            {asked && !busy && (
              <form
                className="panel stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                {pdf && (
                  <div>
                    <label htmlFor="focus">
                      Focus on <span className="muted">(optional)</span>
                    </label>
                    <input id="focus" type="text" placeholder={`e.g. Only the section on ${ex.topic.toLowerCase()}`} value={topic} onChange={(e) => setTopic(e.target.value)} />
                  </div>
                )}
                <div className="grid2">
                  <div>
                    <label htmlFor="count">How many questions?</label>
                    <div className="stepper">
                      <button type="button" aria-label="Fewer questions" onClick={() => setCount(clamp(count - 1))}>
                        −
                      </button>
                      <input id="count" type="number" min={3} max={maxQuestions} value={count} onChange={(e) => setCount(Number(e.target.value))} onBlur={() => setCount(clamp(count))} />
                      <button type="button" aria-label="More questions" onClick={() => setCount(clamp(count + 1))}>
                        +
                      </button>
                    </div>
                    <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                      Up to {maxQuestions}
                      {account && !account.isAdmin && ` on the ${account.planLabel} plan`}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="level">Grade or level</label>
                    <input id="level" type="text" placeholder={pdf ? "Taken from the PDF if left blank" : `e.g. ${ex.level}`} value={level} onChange={(e) => setLevel(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label>Difficulty</label>
                  <div className="seg">
                    {(["Easy", "Medium", "Hard", "Mixed"] as Difficulty[]).map((d) => (
                      <button key={d} type="button" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="radio" htmlFor="choices-only">
                    <input id="choices-only" type="checkbox" checked={choicesOnly} onChange={(e) => setChoicesOnly(e.target.checked)} /> Multiple choice only
                  </label>
                  <p className="muted small">Every question has four options to pick from, so nobody types an answer.</p>
                </div>
                <div>
                  <label htmlFor="notes">
                    Anything else? <span className="muted">(optional)</span>
                  </label>
                  <textarea
                    id="notes"
                    placeholder={ex.notes}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                {needsCode && (
                <div>
                  <label htmlFor="access">Access code</label>
                  <input
                    id="access"
                    type="password"
                    autoComplete="off"
                    required={needsCode}
                    placeholder="Ask the person who runs MathSprint"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value)}
                    style={{ maxWidth: 320 }}
                  />
                  <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                    {account?.hasOwnCode
                      ? "Use the code you were given for your account. This browser remembers it after the first deck."
                      : "Building decks uses AI credit, so it needs a code. This browser remembers it after the first deck."}
                  </p>
                </div>
                )}
                {account && !account.isAdmin && (
                  <div className="row" style={{ gap: 8 }}>
                    <Chip tone={outOfDecks ? "bad" : undefined}>{account.planLabel}</Chip>
                    <span className="muted" style={{ fontSize: 14 }}>
                      {outOfDecks
                        ? `You've used all ${account.maxDecks} decks on your plan.`
                        : `${account.decksCreated} of ${account.maxDecks} decks used.`}
                    </span>
                    {account.codeFreeLeft > 0 && account.maxDecks > account.decksCreated + account.codeFreeLeft && (
                      <span className="muted" style={{ fontSize: 14 }}>
                        · {account.codeFreeLeft === 1 ? "1 more deck" : `${account.codeFreeLeft} more decks`} without an access code
                      </span>
                    )}
                    {account.plan !== "promax" && (
                      <Link to="/upgrade" style={{ fontWeight: 700, fontSize: 14 }}>
                        {account.upgrade?.pendingPlan ? "Upgrade requested" : "Request an upgrade"}
                      </Link>
                    )}
                    <Link to="/invite" style={{ fontWeight: 700, fontSize: 14 }}>
                      Invite a friend for a free deck
                    </Link>
                  </div>
                )}
                {suspended && <p className="error">Your account is suspended. Contact the person who runs MathSprint.</p>}
                <div className="row">
                  <button className="btn btn-primary btn-big" type="submit" disabled={outOfDecks || suspended}>
                    <Icon name="sparkle" /> Generate deck
                  </button>
                  <span className="muted small">Takes a minute or two, longer for big decks</span>
                  <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setAsked(false);
                        setPdf(null);
                        setError("");
                      }}
                    >
                      {pdf ? "Choose another file" : "Change topic"}
                  </button>
                </div>
                {error && <p className="error">{error}</p>}
              </form>
            )}
          </div>

          <aside className="side panel stack">
            <h2>Every answer gets checked</h2>
            <p className="muted">
              {math
                ? "Claude writes the questions. A math engine solves each one again on its own, and anything that disagrees is rewritten before you see it."
                : "Claude writes the questions, then answers each one again without seeing the key. Anything it answers differently, or finds unclear, is rewritten before you see it. Calculations are also checked by a math engine."}
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAccount } from "../App";
import TopBar, { Chip, Icon } from "../components/TopBar";
import { generateDeck } from "../lib/db";
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

const steps = (count: number, pdf: boolean) => [
  ...(pdf ? ["Reading your PDF"] : []),
  `Writing ${count} questions with Claude`,
  "Writing step-by-step solutions",
  "Checking answers with SymPy",
  "Fixing anything that didn't check out",
  "Saving your deck",
];

export default function CreateDeck() {
  const navigate = useNavigate();
  const { account, refresh } = useAccount();
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
  const [accessCode, setAccessCode] = useState(storedCode);
  // Set when the server asks for a code the account summary didn't know about yet.
  const [codeAsked, setCodeAsked] = useState(false);
  const needsCode = codeAsked || !!account?.needsCode;
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const STEPS = steps(count, !!pdf);

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

  // The pipeline runs server-side in one call; advance the checklist so the wait is legible.
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [busy, STEPS.length]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await generateDeck({
        topic,
        count: clamp(count),
        difficulty,
        // With a PDF, an empty level lets the server use the course the PDF is pitched at.
        level: level || (pdf ? "" : "High school or college"),
        notes,
        accessCode: accessCode.trim(),
        ...(pdf && { pdf: pdf.data, pdfName: pdf.name }),
      });
      if (needsCode) storeCode(accessCode.trim());
      refresh();
      navigate(`/decks/${res.deckId}?fresh=1${res.dropped ? `&dropped=${res.dropped}` : ""}`);
    } catch (e) {
      if ((e as Error).message === "That access code isn't right.") storeCode(null);
      if (/access code/i.test((e as Error).message)) setCodeAsked(true);
      refresh();
      setError((e as Error).message || "The deck couldn't be generated. Try again.");
      setBusy(false);
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
                      <div className="bubble me">{topic}</div>
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
                    placeholder="e.g. Related rates"
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

            {asked && (
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
                    <input id="focus" type="text" placeholder="e.g. Only the section on related rates" value={topic} onChange={(e) => setTopic(e.target.value)} />
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
                    <input id="level" type="text" placeholder={pdf ? "Taken from the PDF if left blank" : "e.g. AP Calculus BC or Calculus II"} value={level} onChange={(e) => setLevel(e.target.value)} />
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
                  <label htmlFor="notes">
                    Anything else? <span className="muted">(optional)</span>
                  </label>
                  <textarea
                    id="notes"
                    placeholder="Include some word problems and make at least 2 questions require factoring."
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
                  <button className="btn btn-primary btn-big" type="submit" disabled={busy || outOfDecks || suspended}>
                    <Icon name="sparkle" /> {busy ? "Generating…" : "Generate deck"}
                  </button>
                  {busy ? (
                    <span className="muted">{count > 20 ? "Big decks are written in parts and can take several minutes" : "Usually under a minute for 10 questions"}</span>
                  ) : (
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
                  )}
                </div>
                {error && <p className="error">{error}</p>}
              </form>
            )}
          </div>

          <aside className="side panel stack" aria-live="polite">
            <div className="row spread">
              <h2>{busy ? "Generating" : "Every answer gets checked"}</h2>
            </div>
            <p className="muted">
              Claude writes the questions. A math engine solves each one again on its own, and anything that disagrees is rewritten before you see it.
            </p>
            <ul className="checklist">
              {STEPS.map((s, i) => {
                const state = !busy ? "" : i < step ? "done" : i === step ? "on" : "";
                return (
                  <li key={s} className={state}>
                    <span className="dot">{state === "done" && <Icon name="check" size={14} />}</span>
                    <span>{s}</span>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </main>
    </>
  );
}

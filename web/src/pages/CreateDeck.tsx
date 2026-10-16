import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

const steps = (count: number) => [
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
  const needsCode = !account?.isAdmin;
  const [params] = useSearchParams();
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [asked, setAsked] = useState(!!params.get("topic"));
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [level, setLevel] = useState("");
  const [notes, setNotes] = useState(params.get("notes") ?? "");
  const [accessCode, setAccessCode] = useState(storedCode);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const STEPS = steps(count);

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
      const res = await generateDeck({ topic, count: clamp(count), difficulty, level: level || "High school or college", notes, accessCode: needsCode ? accessCode.trim() : "" });
      if (needsCode) storeCode(accessCode.trim());
      refresh();
      navigate(`/decks/${res.deckId}?fresh=1${res.dropped ? `&dropped=${res.dropped}` : ""}`);
    } catch (e) {
      if ((e as Error).message === "That access code isn't right.") storeCode(null);
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
                  <div className="bubble me">{topic}</div>
                  <div className="bubble bot">Good choice. A few quick details and I'll write it.</div>
                </>
              ) : (
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
                    <input id="level" type="text" placeholder="e.g. AP Calculus BC or Calculus II" value={level} onChange={(e) => setLevel(e.target.value)} />
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
                        ? `You've used all ${account.maxDecks} decks on your plan. Ask the person who runs MathSprint about upgrading.`
                        : `${account.decksCreated} of ${account.maxDecks} decks used.`}
                    </span>
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
                    <button type="button" className="btn-link" onClick={() => setAsked(false)}>
                      Change topic
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

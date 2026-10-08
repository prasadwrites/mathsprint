import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "../components/TopBar";
import { generateDeck } from "../lib/db";
import type { Difficulty } from "../lib/types";

const STEPS = [
  "Writing questions with Claude",
  "Writing step-by-step solutions",
  "Checking every answer with SymPy",
  "Fixing anything that didn't check out",
  "Saving your deck",
];

export default function CreateDeck() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [asked, setAsked] = useState(false);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [level, setLevel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  // The pipeline runs server-side in one call; advance the checklist so the wait is legible.
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [busy]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await generateDeck({ topic, count, difficulty, level: level || "High school", notes });
      navigate(`/decks/${res.deckId}?fresh=1${res.dropped ? `&dropped=${res.dropped}` : ""}`);
    } catch (e) {
      setError((e as Error).message || "The deck couldn't be generated. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <TopBar back={{ to: "/", label: "Home" }} />
      <div className="stack">
        <h1>Create a practice deck</h1>
        <div className="panel chat">
          <div className="bubble bot">What would you like to practise?</div>
          {asked ? (
            <>
              <div className="bubble me">{topic}</div>
              <div className="bubble bot">Great. A few details and I'll write the deck.</div>
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
                placeholder="e.g. Quadratic equations"
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
                <input id="count" type="number" min={3} max={25} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </div>
              <div>
                <label htmlFor="level">Grade or level</label>
                <input id="level" type="text" placeholder="e.g. Algebra II" value={level} onChange={(e) => setLevel(e.target.value)} />
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
                Additional instructions <span className="muted">(optional)</span>
              </label>
              <textarea
                id="notes"
                placeholder="e.g. Include some word problems and make at least 2 questions require factoring."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="row">
              <button className="btn-primary btn-big" type="submit" disabled={busy}>
                ✨ Generate deck
              </button>
              {!busy && (
                <button type="button" className="btn-link" onClick={() => setAsked(false)}>
                  Change topic
                </button>
              )}
            </div>
            {busy && (
              <div className="pipeline" aria-live="polite">
                {STEPS.map((s, i) => (
                  <div key={s} className={i < step ? "done" : i === step ? "on" : ""}>
                    {s}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

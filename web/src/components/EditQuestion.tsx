import { useState } from "react";
import { addQuestion, editQuestion } from "../lib/db";
import { isMath } from "../lib/subjects";
import type { Question, SolutionStep } from "../lib/types";

const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

/** A new question's starting point: no picture, four empty options if it becomes multiple choice. */
function blank(choicesOnly: boolean): Question {
  return {
    id: "new", order: 0, prompt: "", math: "", type: choicesOnly ? "choice" : "numeric", choices: ["", "", "", ""],
    answerValues: [], answerChoice: "", answerDisplay: "", tolerance: 0, concept: "", difficulty: "Medium", steps: [], verified: false,
  };
}

/** The owner's editor for one question, or for a new one when `question` is left out. The server checks the answer
 * before it saves, and says why when it won't. */
export default function EditQuestion({ deckId, subject, question: existing, choicesOnly = false, onSaved, onCancel }: {
  deckId: string;
  subject: string;
  question?: Question;
  /** A multiple choice only deck: a new question can only be multiple choice. */
  choicesOnly?: boolean;
  onSaved: (q: Question) => void;
  onCancel: () => void;
}) {
  const adding = !existing;
  const [question] = useState(() => existing ?? blank(choicesOnly));
  const [kind, setKind] = useState(question.type);
  const choice = kind === "choice";
  // Multiple choice outside math is checked by Claude answering it again without the key; everything else by SymPy.
  const engine = isMath(subject) || !choice;
  const [prompt, setPrompt] = useState(question.prompt);
  const [math, setMath] = useState(question.math);
  const [choices, setChoices] = useState(question.choices);
  const [answerChoice, setAnswerChoice] = useState(adding ? -1 : choices.indexOf(question.answerChoice));
  const [answer, setAnswer] = useState(question.answerDisplay);
  const [accepted, setAccepted] = useState<string[]>(question.acceptedAnswers ?? []);
  const [steps, setSteps] = useState<SolutionStep[]>(question.steps.length ? question.steps : [{ description: "", expression: "" }]);
  const [concept, setConcept] = useState(question.concept);
  const [difficulty, setDifficulty] = useState(question.difficulty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = (name: string) => `edit-${question.id}-${name}`;

  const setStep = (i: number, patch: Partial<SolutionStep>) => setSteps(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const fields = {
        deckId,
        prompt,
        math,
        steps,
        concept,
        difficulty,
        ...(choice ? { choices, answerChoice: choices[answerChoice] ?? "" } : { answer, acceptedAnswers: accepted.filter((a) => a.trim()) }),
      };
      if (adding) onSaved(await addQuestion({ ...fields, type: kind }));
      else onSaved({ ...question, ...(await editQuestion({ ...fields, questionId: question.id })), verified: true });
    } catch (err) {
      setError((err as Error).message || "The question wasn't saved. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="edit-question stack" onSubmit={save} aria-label={adding ? "New question" : "Edit question"}>
      {adding && !choicesOnly && (
        <fieldset className="row edit-kind" disabled={busy}>
          <legend>Answer type</legend>
          <label><input type="radio" name={id("kind")} checked={!choice} onChange={() => setKind("numeric")} /> Typed answer</label>
          <label><input type="radio" name={id("kind")} checked={choice} onChange={() => setKind("choice")} /> Multiple choice</label>
        </fieldset>
      )}
      <div>
        <label htmlFor={id("prompt")}>Question</label>
        <textarea id={id("prompt")} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} />
      </div>
      <div>
        <label htmlFor={id("math")}>
          Formula or equation <span className="muted">(optional)</span>
        </label>
        <input id={id("math")} type="text" className="mono" value={math} onChange={(e) => setMath(e.target.value)} disabled={busy} placeholder="e.g. x² − 5x + 6 = 0" />
      </div>
      {question.figure && <p className="muted">The {question.figure.kind === "geometry" ? "diagram" : "graph"} stays as it is, and the answer is checked against it.</p>}

      {choice ? (
        <fieldset disabled={busy}>
          <legend>Options (pick the correct one)</legend>
          {choices.map((c, i) => (
            <div className="row edit-option" key={i}>
              <input type="radio" name={id("correct")} checked={answerChoice === i} onChange={() => setAnswerChoice(i)} aria-label={`Option ${i + 1} is correct`} />
              <input type="text" value={c} onChange={(e) => setChoices(choices.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Option ${i + 1}`} />
              {adding && choices.length > MIN_OPTIONS && (
                <button type="button" className="btn-link danger" aria-label={`Remove option ${i + 1}`} onClick={() => {
                  setChoices(choices.filter((_, k) => k !== i));
                  setAnswerChoice(answerChoice === i ? -1 : answerChoice > i ? answerChoice - 1 : answerChoice);
                }}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {adding && choices.length < MAX_OPTIONS && (
            <button type="button" className="btn-link" onClick={() => setChoices([...choices, ""])}>
              + Add an option
            </button>
          )}
        </fieldset>
      ) : (
        <div>
          <label htmlFor={id("answer")}>Correct answer</label>
          <input id={id("answer")} type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy}
            placeholder={question.pair ? "e.g. (2, 5)" : "e.g. x = 2, 3"} />
          <p className="muted hint">
            {adding && !isMath(subject) && "Typed answers must be numbers; use multiple choice for answers in words. "}
            {question.pair ? "Write the point as (x, y). " : "Separate more than one answer with commas. "}
            Fractions like 1/2, roots like 6√3 and π are fine. Students see it written this way.
          </p>
          <fieldset className="edit-accepted" disabled={busy}>
            <legend>
              Also accept <span className="muted">(optional)</span>
            </legend>
            <p className="muted hint">
              Other ways a student might write the right answer, like "ten" or "half". Answers with the same numbers, such as "10 m" or
              "10 meters" for 10, already count. Capitals, spaces and a final period don't matter.
            </p>
            {accepted.map((a, i) => (
              <div className="row edit-option" key={i}>
                <input type="text" value={a} maxLength={120} onChange={(e) => setAccepted(accepted.map((x, k) => (k === i ? e.target.value : x)))}
                  aria-label={`Also accept answer ${i + 1}`} placeholder="e.g. ten" />
                <button type="button" className="btn-link danger" onClick={() => setAccepted(accepted.filter((_, k) => k !== i))} aria-label={`Remove accepted answer ${i + 1}`}>
                  Remove
                </button>
              </div>
            ))}
            {accepted.length < 10 && (
              <button type="button" className="btn-link" onClick={() => setAccepted([...accepted, ""])}>
                + Add an answer to accept
              </button>
            )}
          </fieldset>
        </div>
      )}

      <fieldset disabled={busy}>
        <legend>Solution steps</legend>
        {steps.map((s, i) => (
          <div className="edit-step" key={i}>
            <span className="n">{i + 1}</span>
            <input type="text" value={s.description} onChange={(e) => setStep(i, { description: e.target.value })} aria-label={`Step ${i + 1}`} placeholder="What this step does" />
            <input type="text" className="mono" value={s.expression} onChange={(e) => setStep(i, { expression: e.target.value })} aria-label={`Step ${i + 1} working`} placeholder="The working" />
            {steps.length > 1 && (
              <button type="button" className="btn-link danger" onClick={() => setSteps(steps.filter((_, k) => k !== i))} aria-label={`Remove step ${i + 1}`}>
                Remove
              </button>
            )}
          </div>
        ))}
        {steps.length < 12 && (
          <button type="button" className="btn-link" onClick={() => setSteps([...steps, { description: "", expression: "" }])}>
            + Add a step
          </button>
        )}
      </fieldset>

      <div className="row edit-meta">
        <div>
          <label htmlFor={id("concept")}>Concept</label>
          <input id={id("concept")} type="text" value={concept} onChange={(e) => setConcept(e.target.value)} disabled={busy} />
        </div>
        <div>
          <label htmlFor={id("difficulty")}>Difficulty</label>
          <select id={id("difficulty")} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Question["difficulty"])} disabled={busy}>
            {DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          {busy ? <><span className="spinner" /> Checking the answer…</> : adding ? "Check and add" : "Check and save"}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="muted hint">
        {adding
          ? engine
            ? `The math engine works the question out on its own and adds it only if your ${choice ? "option" : "answer"} is correct.${choice ? "" : " Answers you also accept are saved as you write them."}`
            : "An independent check answers the question without your key and adds it only if it picks your option."
          : engine
          ? "If you change the question or its answer, the math engine works it out again and saves it only if your answer is correct. Answers you also accept are saved as you write them."
          : "If you change the question or its options, an independent check answers it again without your key and saves it only if it picks your option."}
      </p>
    </form>
  );
}

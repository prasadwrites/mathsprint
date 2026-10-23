import { useState } from "react";
import { DEFAULT_SUBJECT, MAX_SUBJECTS, cleanSubject, saveSubjects } from "../lib/subjects";

/** Admin only: add and remove the subjects decks can be made in. Math stays. Decks already made keep their subject. */
export default function SubjectEditor({ subjects, onChange }: { subjects: string[]; onChange: (names: string[]) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (names: string[]) => {
    setBusy(true);
    setError("");
    try {
      onChange(await saveSubjects(names));
      return true;
    } catch (e) {
      setError((e as Error).message || "The subjects didn't save. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const n = cleanSubject(name);
    if (!n) return;
    if (subjects.some((s) => s.toLowerCase() === n.toLowerCase())) {
      setError(`${n} is already on the list.`);
      return;
    }
    if (await save([...subjects, n])) setName("");
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <ul className="row" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }} aria-label="Subjects">
        {subjects.map((s) => (
          <li key={s} className="chip">
            {s}
            {s !== DEFAULT_SUBJECT && (
              <button
                type="button"
                className="btn-link"
                aria-label={`Remove ${s}`}
                disabled={busy}
                onClick={() => save(subjects.filter((x) => x !== s))}
                style={{ padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          type="text"
          aria-label="New subject"
          placeholder="e.g. US History"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: "1 1 200px", width: "auto" }}
        />
        <button type="submit" disabled={busy || !name.trim() || subjects.length >= MAX_SUBJECTS}>
          Add subject
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted" style={{ fontSize: 14 }}>
        Everyone can build decks in these subjects. Removing one doesn't change decks already made in it.
      </p>
    </div>
  );
}

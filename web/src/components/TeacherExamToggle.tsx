import { useEffect, useState } from "react";
import { listTeacherExams, setDeckCertExam } from "../lib/db";
import type { Deck, TeacherExam } from "../lib/types";

/** Admin only, on the admin's own deck page: lists the deck on the teacher certification exams page under one exam
 * (which makes it public, so every teacher can practice it, but keeps it off students' home pages), or takes it off. */
export default function TeacherExamToggle({ deck, onChanged }: { deck: Pick<Deck, "id" | "certExam" | "questionCount">; onChanged: (exam: TeacherExam | null) => void }) {
  const [exams, setExams] = useState<TeacherExam[]>([]);
  const [pick, setPick] = useState(deck.certExam ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    listTeacherExams().then((c) => setExams(c.exams)).catch(() => setError("The exam list couldn't be loaded."));
  }, []);
  const current = exams.find((e) => e.id === deck.certExam);
  const save = async (exam: TeacherExam | null) => {
    setBusy(true);
    setError("");
    try {
      await setDeckCertExam(deck.id, exam);
      onChanged(exam);
    } catch (e) {
      setError((e as Error).message || "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack" aria-labelledby="teacher-exam">
      <div className="row spread">
        <h2 id="teacher-exam" style={{ margin: 0 }}>Teacher exams page</h2>
        <span className="muted">{deck.certExam ? "Listed" : "Not listed"}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {deck.certExam
          ? `Teachers see this deck under ${current?.label ?? deck.certExam} on the teacher exams page, signed in or not. It isn't on students' home pages.`
          : "List this deck under a teacher certification exam. Teachers in every state that uses the exam see it, and it stays off students' home pages."}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <label htmlFor="teacher-exam-pick" className="sr-only">Exam</label>
        <select id="teacher-exam-pick" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || !exams.length} style={{ width: "auto", maxWidth: "100%" }}>
          <option value="">Choose an exam</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !pick || pick === deck.certExam || !deck.questionCount}
          onClick={() => save(exams.find((e) => e.id === pick) ?? null)}
        >
          {busy ? "Saving…" : deck.certExam ? "Move it" : "List it"}
        </button>
        {deck.certExam && (
          <button type="button" className="btn" disabled={busy} onClick={() => save(null).then(() => setPick(""))}>
            Take it off
          </button>
        )}
      </div>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}

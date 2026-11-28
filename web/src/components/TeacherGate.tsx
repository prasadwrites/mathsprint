import { useState } from "react";
import { Brand } from "./TopBar";
import { setTeacher } from "../lib/db";

/** Asked once, straight after a new account is made: is its owner a teacher? Teachers get teacher tools, starting with
 * certification exam prep. Either answer can be changed later from the profile menu. */
export function TeacherGate({ onAnswered }: { onAnswered: () => void }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState("");
  const answer = async (isTeacher: boolean) => {
    setBusy(isTeacher ? "yes" : "no");
    setError("");
    try {
      await setTeacher(isTeacher);
      onAnswered();
    } catch (e) {
      setError((e as Error).message || "That didn't save. Try again.");
      setBusy(null);
    }
  };
  return (
    <div className="wrap" style={{ maxWidth: 520 }}>
      <div className="stack" style={{ paddingTop: "10vh" }}>
        <Brand />
        <h1>Are you a teacher?</h1>
        <p className="muted">
          Choose <b>I'm a teacher</b> to add teacher tools to your account, including prep for math teacher certification exams such as Praxis, TExES and
          CSET. These tools are only added for teacher accounts. Students and everyone else get the same MathSprint practice either way.
        </p>
        <div className="panel stack">
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => answer(true)}>
            {busy === "yes" ? "Saving…" : "I'm a teacher"}
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => answer(false)}>
            {busy === "no" ? "Saving…" : "I'm not a teacher"}
          </button>
          <p className="muted small" style={{ margin: 0 }}>You can change this any time from your profile menu.</p>
          {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}

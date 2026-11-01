import type { GoogleSignInProblem } from "../lib/googleSignIn";

/** Shows why Google sign-in didn't finish, worded so a blocked school account reads as the school's setting. */
export default function GoogleSignInNote({ problem }: { problem: GoogleSignInProblem }) {
  return (
    <div className={`signin-note signin-note-${problem.tone}`} role={problem.tone === "error" ? "alert" : "status"}>
      <b>{problem.title}</b>
      <p>{problem.text}</p>
    </div>
  );
}

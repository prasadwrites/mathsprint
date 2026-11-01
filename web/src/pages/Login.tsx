import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { useState } from "react";
import { Link } from "react-router-dom";
import { pendingInvite } from "../lib/invite";
import { pendingPublicClaim } from "../lib/publicTest";
import { pendingRef } from "../lib/signupRef";
import { Brand } from "../components/TopBar";
import { auth, googleProvider } from "../lib/firebase";
import { googleSignInProblem, type GoogleSignInProblem } from "../lib/googleSignIn";
import GoogleSignInNote from "../components/GoogleSignInNote";

/** Who sent this visitor, from the ?ref= tag a landing page puts on its sign-up links (like "tutors-oct-email"). */
function audience(ref: string | null) {
  if (ref?.startsWith("tutors")) return "Type a topic or upload a worksheet, and get a timed practice deck with worked solutions and checked answers for your next session.";
  if (ref?.startsWith("parents")) return "Build a practice test on exactly what's coming up, and see which topics need work before test day.";
  return "Timed practice for high school and college math, SAT, ACT and AP: build a deck on any topic and see exactly where your time went.";
}

export default function Login() {
  const invite = pendingInvite();
  const board = pendingPublicClaim();
  const [email, setEmail] = useState(invite?.email ?? "");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">(invite || board || pendingRef() ? "signup" : "signin");
  const [error, setError] = useState("");
  const [googleProblem, setGoogleProblem] = useState<GoogleSignInProblem | null>(null);

  const google = async () => {
    setError("");
    setGoogleProblem(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setGoogleProblem(googleSignInProblem((e as { code?: string }).code ?? "", "login"));
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setGoogleProblem(null);
    try {
      await fn();
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      setError(
        code.includes("invalid-credential") || code.includes("wrong-password")
          ? "That email and password don't match. Check them and try again."
          : code.includes("user-disabled")
            ? "This account has been suspended. Contact the person who runs MathSprint."
          : code.includes("email-already-in-use")
            ? "An account already uses this email. Sign in instead."
            : code.includes("weak-password")
              ? "Use a password of at least 6 characters."
              : "Sign-in didn't work. Try again in a moment.",
      );
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 440 }}>
      <div className="stack" style={{ paddingTop: "10vh" }}>
        <Brand />
        {mode === "signup" ? (
          <>
            {/* Every "Start free" button on the landing pages lands here, so this repeats their promise. */}
            <h1>Build your first deck free, no card needed.</h1>
            <p className="muted">
              {audience(pendingRef())} Your first 5 decks are free. <Link to="/plans">Compare plans</Link>
            </p>
          </>
        ) : (
          <>
            <h1>Timed math practice for high school and college students.</h1>
            <p className="muted">
              Create a deck on any topic, practice against the clock, and see exactly where your time went. New here? Your first 5 decks are free, no card
              needed. <Link to="/plans">Compare plans</Link>
            </p>
          </>
        )}
        {invite && (
          <p className="notice" role="status">
            <b>A friend invited you to MathSprint.</b>
            {invite.email ? ` Sign up with ${invite.email} so they get the credit.` : " Sign up with the email your invite was sent to so they get the credit."}
          </p>
        )}
        {board && (
          <p className="notice" role="status">
            <b>Sign up to claim your spot on the {board.title} leaderboard.</b> Already have an account? Sign in and it goes on the board too.
          </p>
        )}
        <button className="btn-primary btn-big" onClick={google}>
          Continue with Google
        </button>
        {googleProblem ? (
          <GoogleSignInNote problem={googleProblem} />
        ) : (
          <p className="muted" style={{ textAlign: "center", margin: 0, fontSize: 13 }}>
            Some school Google accounts block outside apps. If yours does, use a personal Google account or your email.
          </p>
        )}
        <p className="muted" style={{ textAlign: "center", margin: 0, fontSize: 14 }}>
          or use your email
        </p>
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              mode === "signin"
                ? signInWithEmailAndPassword(auth, email, password)
                : createUserWithEmailAndPassword(auth, email, password),
            );
          }}
        >
          <div>
            <label htmlFor="email">Email</label>
            <input id="email" type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="w-full rounded-[10px] border border-line bg-bg px-3 py-2.5"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit">{mode === "signin" ? "Sign in with email" : "Create account"}</button>
          <button type="button" className="btn-link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

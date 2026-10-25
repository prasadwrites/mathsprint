import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import TimedQuestions from "../components/TimedQuestions";
import { Brand } from "../components/TopBar";
import { openClassTest, submitClassTest } from "../lib/db";
import { auth } from "../lib/firebase";
import type { OpenClassTest } from "../lib/types";
import { Result } from "./TakeTest";

const storeKey = (token: string) => `ms.class.${token}`;

/** One link for a whole class. Each student signs in with Google (such as their Google Classroom school account), and
 * the teacher's results show the name and email Google gives. One try per account. */
export default function ClassTest() {
  const { token = "" } = useParams();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [test, setTest] = useState<OpenClassTest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setTest(await openClassTest(token, true));
    } catch (e) {
      setError((e as Error).message || "The test didn't open. Try again.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    if (user === undefined) return;
    setError("");
    openClassTest(token)
      .then((t) => {
        setTest(t);
        // Already started on this account: carry straight on, since the clock is running anyway.
        if (t.signedIn && t.status !== "assigned") start();
      })
      .catch((e) => setError((e as Error).message || "This class link doesn't work."));
  }, [token, user, start]);

  const google = async () => {
    setError("");
    const provider = new GoogleAuthProvider();
    // Always ask which account, since school computers are shared; a domain hint puts school accounts first.
    provider.setCustomParameters({ prompt: "select_account", ...(test?.domain ? { hd: test.domain } : {}) });
    try {
      if (auth.currentUser) await signOut(auth);
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (!code.includes("popup-closed") && !code.includes("cancelled-popup")) {
        setError(code.includes("user-disabled") ? "This account has been suspended." : "Google sign-in didn't work. Try again in a moment.");
      }
    }
  };

  const isGoogle = !!user?.providerData.some((p) => p.providerId === "google.com");
  const wrongAccount = !!user && !!test?.problem;

  return (
    <div className="wrap" style={{ maxWidth: 820 }}>
      <div className="stack">
        <Brand small />
        {test?.result ? (
          <>
            <Result test={test} result={test.result} />
            <p className="muted">
              Want more practice? <Link to="/">Open MathSprint</Link> with the same account and make your own decks.
            </p>
          </>
        ) : test?.questions ? (
          <TimedQuestions
            storeKey={storeKey(token)}
            test={{ ...test, questions: test.questions }}
            send={async (answers, track) => setTest(await submitClassTest(token, answers, track))}
          />
        ) : !test || user === undefined ? (
          error ? <p className="error">{error}</p> : <span className="spinner" />
        ) : (
          <>
            <div>
              <div className="eyebrow">
                Class test{test.from && ` from ${test.from}`}
                {test.groupName && ` · ${test.groupName}`}
              </div>
              <h1>{test.title}</h1>
            </div>
            <div className="kv">
              <div><span>Questions</span><b>{test.questionCount}</b></div>
              <div><span>Time limit</span><b>{test.timeLimitSec ? `${Math.round(test.timeLimitSec / 60)} min` : "None"}</b></div>
              <div><span>Tries</span><b>One</b></div>
            </div>
            <div className="panel stack">
              {!user || wrongAccount ? (
                <>
                  <p>
                    {!user
                      ? `Sign in with your ${test.domain ? `@${test.domain} ` : ""}Google account, the one you use for Google Classroom. Your teacher sees your result under your Google name and email.`
                      : !isGoogle
                        ? `You're signed in to MathSprint as ${user.email ?? "someone"} without Google. This test needs a Google sign-in.`
                        : test.problem}
                  </p>
                  <button className="btn btn-primary btn-big" type="button" onClick={google}>
                    {!user ? "Continue with Google" : test.domain ? `Switch to your @${test.domain} account` : "Switch to a Google account"}
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Signed in as <b>{test.name || user.displayName}</b> <span className="muted">({test.email ?? user.email})</span>.{" "}
                    <button type="button" className="btn-link" onClick={google}>
                      Not you?
                    </button>
                  </p>
                  <p className="muted">
                    {!test.open
                      ? "Your teacher has closed this test to new students."
                      : test.timeLimitSec
                        ? "The clock starts when you press Start, and your answers send when time runs out. You get one try."
                        : "Your test starts when you press Start. You get one try."}
                  </p>
                  <button className="btn btn-primary btn-big" type="button" disabled={busy || !test.open} onClick={start}>
                    {busy ? "Opening…" : "Start test"}
                  </button>
                </>
              )}
              {error && <p className="error">{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

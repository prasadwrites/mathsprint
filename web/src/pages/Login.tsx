import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { pendingInvite } from "../lib/invite";
import { pendingMakeQuiz, pendingPublicClaim } from "../lib/publicTest";
import { pendingRef } from "../lib/signupRef";
import { Brand } from "../components/TopBar";
import { auth, googleProvider } from "../lib/firebase";
import { googleSignInProblem, type GoogleSignInProblem } from "../lib/googleSignIn";
import GoogleSignInNote from "../components/GoogleSignInNote";
import { TermsCheckbox } from "../components/Terms";
import { checkOfferCode, listPublicDeckCards } from "../lib/db";
import { publicDeckPath } from "../lib/publicDeck";
import { cleanCode, codeFromUrl, holdOfferCode } from "../lib/offerCode";
import { agreeTermsOnSignup } from "../lib/terms";
import type { PublicDeckCard, PublicOfferCode } from "../lib/types";

const longDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const monthsLabel = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;

/** Who sent this visitor, from the ?ref= tag a landing page puts on its sign-up links (like "tutors-oct-email"). */
function audience(ref: string | null) {
  if (ref?.startsWith("tutors")) return "Type a topic or upload a worksheet, and get a timed practice deck with worked solutions and checked answers for your next session.";
  if (ref?.startsWith("parents")) return "Build a practice test on exactly what's coming up, and see which topics need work before test day.";
  return "Timed practice for high school and college math, SAT, ACT and AP: build a deck on any topic and see exactly where your time went.";
}

/** The admin's public decks, which anyone can set up a practice on before signing in. Shows nothing if there are none
 * or they can't be read. */
function PublicDecks() {
  const [decks, setDecks] = useState<PublicDeckCard[]>([]);
  useEffect(() => {
    listPublicDeckCards().then(setDecks).catch(() => {});
  }, []);
  if (!decks.length) return null;
  return (
    <section className="stack" style={{ gap: 10, paddingBottom: 40 }} aria-labelledby="public-decks">
      <h2 id="public-decks" style={{ marginBottom: 0 }}>Try a ready-made deck</h2>
      <p className="muted" style={{ margin: 0 }}>
        Pick one to set up a timed practice. You'll sign in or create a free account to start it.
      </p>
      <div className="stack" style={{ gap: 8 }}>
        {decks.map((d) => (
          <Link key={d.id} className="panel deck-card public-deck" to={publicDeckPath(d.id)}>
            <b>{d.title}</b>
            <span className="meta">
              {d.subject} · {d.level} · {d.difficulty} · {d.questionCount} questions
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** With startDeck, the visitor set up a practice on a public deck and pressed Start: they sign in or sign up here,
 * and the practice starts once they have. */
export default function Login({ startDeck }: { startDeck?: { title: string; onBack: () => void } } = {}) {
  const invite = pendingInvite();
  const board = pendingPublicClaim();
  // Pressed "make my quiz" after a public test: they sign up here, then go straight to the deck builder.
  const makeQuiz = pendingMakeQuiz();
  // /join?code=CODE: the sign-up link sent with an offer code.
  const join = useLocation().pathname.replace(/\/+$/, "") === "/join";
  const [email, setEmail] = useState(invite?.email ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState(join ? codeFromUrl() : "");
  const [offer, setOffer] = useState<PublicOfferCode | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">(join || invite || board || startDeck || pendingRef() ? "signup" : "signin");
  const [error, setError] = useState("");
  // Where to show the error: next to the Google button when that's what was pressed.
  const [errorAtGoogle, setErrorAtGoogle] = useState(false);
  const [googleProblem, setGoogleProblem] = useState<GoogleSignInProblem | null>(null);

  /** Before an account is made: the terms box must be ticked, and an offer code must still be good (an expired code
   * says so here, not after the account exists). Returns false and shows why if not. */
  const ready = async (signingUp: boolean) => {
    if (signingUp && !agreed) {
      setError("Tick the box to agree to the Terms of Use first.");
      return false;
    }
    if (signingUp) agreeTermsOnSignup();
    const c = cleanCode(code);
    if (!join || !c) return true;
    try {
      setOffer(await checkOfferCode(c));
    } catch (e) {
      setOffer(null);
      setError((e as Error).message || "That offer code couldn't be checked. Try again.");
      return false;
    }
    holdOfferCode(c); // redeemed as soon as the account is signed in
    return true;
  };

  const google = async () => {
    setError("");
    setErrorAtGoogle(true);
    setGoogleProblem(null);
    if (!(await ready(mode === "signup"))) return;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setGoogleProblem(googleSignInProblem((e as { code?: string }).code ?? "", "login"));
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setErrorAtGoogle(false);
    setGoogleProblem(null);
    if (!(await ready(mode === "signup"))) return;
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
        {startDeck ? (
          <>
            <h1>Sign in to start your practice.</h1>
            <p className="muted">
              Create a free account or sign in, and your practice on <b>{startDeck.title}</b> starts right away with the settings you picked. Your first 5
              decks of your own are free too.{" "}
              <button type="button" className="btn-link" style={{ padding: 0 }} onClick={startDeck.onBack}>
                Change the settings
              </button>
            </p>
          </>
        ) : join ? (
          <>
            <h1>Join MathSprint with your offer code.</h1>
            <p className="muted">
              Create your account with your email and a password, and enter the offer code from your email. Already have an account? Sign in and the code is
              added to it.
            </p>
          </>
        ) : makeQuiz ? (
          <>
            <h1>{mode === "signup" ? "Sign up to make your own quiz." : "Sign in to make your own quiz."}</h1>
            <p className="muted">
              Create a free account and you'll go straight to making a quiz on any topic, ready to share with your friends. Your first 5 quizzes are free,
              no card needed.
            </p>
          </>
        ) : mode === "signup" ? (
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
            {makeQuiz ? (
              <>
                <b>Your {board.title} score goes on the leaderboard too.</b> Already have an account? Sign in and it's added there.
              </>
            ) : (
              <>
                <b>Sign up to claim your spot on the {board.title} leaderboard.</b> Already have an account? Sign in and it goes on the board too.
              </>
            )}
          </p>
        )}
        {join && (
          <div className="panel">
            <label htmlFor="offer-code">Offer code</label>
            <input
              id="offer-code"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Such as MS-7KQP-X3DM"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setOffer(null);
              }}
            />
            {offer && (
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {offer.planLabel} free for {monthsLabel(offer.months)} from the day you join. Redeem by {longDate(offer.redeemBy)}.
              </p>
            )}
          </div>
        )}
        {mode === "signup" && <TermsCheckbox checked={agreed} onChange={setAgreed} />}
        <button className="btn-primary btn-big" onClick={google}>
          Continue with Google
        </button>
        {error && errorAtGoogle && <p className="error" style={{ margin: 0 }}>{error}</p>}
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
          <button type="submit">{mode === "signin" ? "Sign in with email" : join ? "Create account and redeem" : "Create account"}</button>
          <button type="button" className="btn-link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
          {error && !errorAtGoogle && <p className="error">{error}</p>}
        </form>
        {!join && !startDeck && !invite && !board && <PublicDecks />}
      </div>
    </div>
  );
}

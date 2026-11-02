import { signOut } from "firebase/auth";
import { useState } from "react";
import { Brand } from "./TopBar";
import { acceptTerms } from "../lib/db";
import { auth } from "../lib/firebase";
import { TERMS_VERSION } from "../lib/terms";

/** The "I agree" box every new account has to tick. The links open in a new tab so the form isn't lost. */
export function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="terms-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        I am 13 or older and I agree to the MathSprint{" "}
        <a href="/terms" target="_blank" rel="noopener">
          Terms of Use
        </a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noopener">
          Privacy statement
        </a>
        .
      </span>
    </label>
  );
}

/** Shown once to anyone signed in who hasn't agreed to the current terms: a Google sign-in that made a new account from
 * the sign-in form, accounts made before the terms existed, and everyone after the terms change. */
export function TermsGate({ onAccepted }: { onAccepted: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const agree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) return setError("Tick the box to agree before you continue.");
    setBusy(true);
    setError("");
    try {
      await acceptTerms(TERMS_VERSION);
      onAccepted();
    } catch (err) {
      setError((err as Error).message || "That didn't save. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="wrap" style={{ maxWidth: 520 }}>
      <form className="stack" style={{ paddingTop: "10vh" }} onSubmit={agree}>
        <Brand />
        <h1>One step before you continue</h1>
        <p className="muted">
          Please read and agree to our Terms of Use. In short: MathSprint is a study aid, AI-written questions can have mistakes, you're responsible for what
          you upload, and the service comes as is.
        </p>
        <div className="panel stack">
          <TermsCheckbox checked={agreed} onChange={setAgreed} />
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Agree and continue"}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
        <button type="button" className="btn-link" onClick={() => signOut(auth)}>
          Don't agree? Sign out
        </button>
      </form>
    </div>
  );
}

import { useState } from "react";
import { Icon } from "./TopBar";
import { challengeLink } from "../lib/challenge";
import { createChallenge } from "../lib/db";
import type { Challenge } from "../lib/types";

/** Turns a finished session into a link that dares a friend to beat it. Asking twice gives the same link. */
export default function ChallengeFriend({ sessionId }: { sessionId: string }) {
  const [c, setC] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const make = async () => {
    setBusy(true);
    setError("");
    try {
      setC(await createChallenge(sessionId));
    } catch (e) {
      setError((e as Error).message || "Couldn't make a challenge link. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!c) {
    return (
      <div className="panel stack cta-panel">
        <div>
          <h2>Challenge a friend</h2>
          <p className="muted">Send a link. Your friend plays the same questions with no account, and you both see who won.</p>
        </div>
        <div>
          <button className="btn btn-primary" onClick={make} disabled={busy}>
            {busy ? "Making your link…" : "Challenge a friend"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const link = challengeLink(c.token);
  const text = `${c.brag} ${link}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it yourself.");
    }
  };
  const canShare = typeof navigator.share === "function";

  return (
    <div className="panel stack cta-panel">
      <div>
        <h2>Challenge a friend</h2>
        <p style={{ fontWeight: 700 }}>“{c.brag}”</p>
      </div>
      <div className="challenge-share">
        <input type="text" readOnly value={link} aria-label="Challenge link" onFocus={(e) => e.target.select()} />
        <button className="btn btn-primary" onClick={copy}>
          {copied ? <><Icon name="check" /> Copied</> : "Copy message"}
        </button>
        {canShare && (
          <button className="btn" onClick={() => navigator.share({ title: "MathSprint challenge", text: c.brag, url: link }).catch(() => {})}>
            Share
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 14 }}>Send it to as many friends as you like. You'll see how each one did on your home page.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

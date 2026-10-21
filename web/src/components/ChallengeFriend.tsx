import { useState } from "react";
import ShareButtons from "./ShareButtons";
import { challengeCard, challengeLink } from "../lib/challenge";
import { createChallenge } from "../lib/db";
import type { Challenge } from "../lib/types";

/** Turns a finished session into a link that dares a friend to beat it. Asking twice gives the same link. */
export default function ChallengeFriend({ sessionId }: { sessionId: string }) {
  const [c, setC] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
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
  return (
    <div className="panel stack cta-panel">
      <div>
        <h2>Challenge a friend</h2>
        <p style={{ fontWeight: 700 }}>“{c.brag}”</p>
      </div>
      <div className="challenge-share">
        <input type="text" readOnly value={link} aria-label="Challenge link" onFocus={(e) => e.target.select()} />
      </div>
      <ShareButtons link={link} text={c.brag} card={challengeCard(c.token)} />
      <p className="muted" style={{ fontSize: 14 }}>Send it to as many friends as you like. You'll see how each one did on your home page.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

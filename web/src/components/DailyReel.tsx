import { useEffect, useState } from "react";
import { listReels, makeReel } from "../lib/db";
import type { DailyReel as Reel } from "../lib/types";

/** What each day's tutor headache is called on screen (the server's theme keys). */
const THEMES: Record<string, string> = {
  grading: "Late-night grading",
  worksheets: "A worksheet for everyone",
  "answer-keys": "Wrong answer keys",
  parents: "Parent check-ins",
  pdf: "Retyping textbook problems",
  explaining: "Explaining it again",
  "test-prep": "SAT and ACT nerves",
  class: "A whole class on one quiz",
  homework: "Chasing homework",
  "quick-check": "Five-minute checks",
};

const video = (r: Reel) => `/reel/${r.token}.mp4`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** Admin only, on the home page: today's Instagram Reel for tutors, to watch, download and post with its caption. */
export default function DailyReel() {
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [today, setToday] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [note, setNote] = useState("");

  const load = () =>
    listReels()
      .then((r) => {
        setReels(r.reels);
        setToday(r.today);
      })
      .catch((e) => setNote(`Couldn't load the Reels: ${e.message}`));
  useEffect(() => {
    load();
  }, []);

  if (reels === null) return note ? <p className="muted">{note}</p> : null;
  const ready = reels.filter((r) => r.status === "ready");
  const reel = ready.find((r) => r.token === shown) ?? ready[0];
  const inProgress = reels.find((r) => r.status === "making" && r.day === today);
  const failed = reels.find((r) => r.status === "failed" && r.day === today && !ready.some((x) => x.day === today));

  const another = async () => {
    setMaking(true);
    setNote("");
    try {
      const made = await makeReel();
      setShown(made.token);
      await load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setMaking(false);
    }
  };
  const copy = async () => {
    if (!reel) return;
    try {
      await navigator.clipboard.writeText(reel.caption);
      setNote("Caption copied. Paste it into Instagram.");
    } catch {
      setNote("Couldn't copy. Select the caption and copy it yourself.");
    }
  };

  return (
    <section className="panel stack reel" aria-labelledby="reel-title">
      <div className="row spread">
        <h2 id="reel-title">{reel && reel.day === today ? "Today's Instagram Reel" : "Instagram Reel"}</h2>
        <button type="button" className="btn btn-small" onClick={another} disabled={making}>
          {making ? "Making a new Reel…" : "Make another"}
        </button>
      </div>
      {making && <p className="muted small">Claude is writing it and the server is animating it. This takes about a minute.</p>}
      {!reel && !making && (
        <p className="muted">
          {inProgress ? "Today's Reel is being made. Check back in a minute." : "A new Reel is made every morning at 5 AM Eastern. Make one now to see it."}
        </p>
      )}
      {failed && !making && <p className="muted small">Today's Reel didn't work out ({failed.error || "unknown error"}). Make another to try again.</p>}
      {reel && (
        <div className="reel-body">
          <video key={reel.token} className="reel-video" src={video(reel)} controls playsInline preload="metadata" aria-label={`Reel: ${reel.hook}`} />
          <div className="stack reel-side">
            <div className="row">
              <span className="chip">{THEMES[reel.theme] ?? reel.theme}</span>
              <span className="muted small">{dayLabel(reel.day)} · {reel.seconds}s · {(reel.bytes / 1_000_000).toFixed(1)} MB</span>
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <b>Caption</b>
              <textarea readOnly value={reel.caption} rows={9} onFocus={(e) => e.target.select()} />
            </label>
            <div className="row">
              <a className="btn btn-primary" href={`${video(reel)}?download=1`} download>
                Download video
              </a>
              <button type="button" className="btn" onClick={copy}>
                Copy caption
              </button>
            </div>
            <p className="muted small">Post it as a Reel on Instagram: upload the video, paste the caption, and share.</p>
          </div>
        </div>
      )}
      {note && <p className="small" role="status">{note}</p>}
      {ready.length > 1 && (
        <details>
          <summary>Earlier Reels</summary>
          <ul className="reel-list">
            {ready.map((r) => (
              <li key={r.token}>
                <button type="button" className="link" onClick={() => setShown(r.token)} aria-current={r.token === reel?.token}>
                  {dayLabel(r.day)}: {r.hook}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

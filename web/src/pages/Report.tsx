import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAccount } from "../App";
import TopBar, { Chip } from "../components/TopBar";
import { listReports, replyReport, reportProblem } from "../lib/db";
import type { ProblemReport } from "../lib/types";
import { Conversation, ReplyBox, when } from "./Upgrade";

export function ReportStatus({ status }: { status: ProblemReport["status"] }) {
  return status === "resolved" ? <Chip tone="good">Resolved</Chip> : status === "replied" ? <Chip>Replied</Chip> : <Chip tone="warn">Waiting for a reply</Chip>;
}

/** A signed-in user tells the admin about a problem and reads the replies. */
export default function Report() {
  const { refresh } = useAccount();
  // The page they came from, so the admin knows where it happened.
  const from = (useLocation().state as { from?: string } | null)?.from ?? "";
  const [reports, setReports] = useState<ProblemReport[] | null>(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setReports(await listReports(true));
      refresh(); // clears the reply notification
    } catch (e) {
      setError((e as Error).message || "Your reports couldn't be loaded.");
      setReports([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await reportProblem(text.trim(), from);
      setText("");
      setSent(true);
      await load();
    } catch (e) {
      setError((e as Error).message || "Your report didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar back={{ to: from || "/", label: "Back" }} />
      <main className="page narrow">
        <h1>Report a problem</h1>
        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor="report-text">What went wrong?</label>
            <textarea
              id="report-text"
              maxLength={1000}
              placeholder="e.g. My deck on logarithms stopped loading after question 12."
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSent(false);
              }}
              style={{ minHeight: 120 }}
            />
          </div>
          <p className="small muted">The admin will read it and reply here. You'll see a note on your home page when they do.</p>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()}>
              {busy ? "Sending…" : "Send report"}
            </button>
            {sent && (
              <span className="muted" role="status">
                Sent. Thanks for telling us.
              </span>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </form>

        {reports && reports.length > 0 && (
          <section className="stack">
            <h2>Your reports</h2>
            <ul className="requests">
              {reports.map((r) => (
                <li key={r.id} className="panel stack" style={{ gap: 8 }}>
                  <div className="row spread">
                    <span className="small muted">Sent {when(r.createdAt)}</span>
                    <ReportStatus status={r.status} />
                  </div>
                  <Conversation r={r} viewer="student" />
                  <ReplyBox
                    label="Write back"
                    placeholder={r.status === "resolved" ? "Still a problem? Write back and it reopens." : "Add more detail or write back"}
                    onSend={async (reply) => {
                      try {
                        await replyReport(r.id, reply);
                        setError("");
                        await load();
                      } catch (e) {
                        setError((e as Error).message || "Your message didn't send. Try again.");
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

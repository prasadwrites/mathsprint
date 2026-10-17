import { useEffect, useState } from "react";
import { useAccount } from "../App";
import TopBar, { Chip } from "../components/TopBar";
import { createInvite, listInvites } from "../lib/db";
import { inviteLink } from "../lib/invite";
import type { Invite as InviteRow } from "../lib/types";
import { when } from "./Upgrade";

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", link);
        }
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

const mailto = (email: string, link: string) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Practice math with me on MathSprint")}&body=${encodeURIComponent(
    `I've been using MathSprint for timed math practice. Join with this link:\n\n${link}`,
  )}`;

export default function Invite() {
  const { account, refresh } = useAccount();
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [latest, setLatest] = useState<InviteRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setInvites(await listInvites());
      refresh(); // picks up decks earned since the last visit
    } catch (e) {
      setError((e as Error).message || "Your invites couldn't be loaded.");
      setInvites([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      setLatest(await createInvite(email.trim()));
      setEmail("");
      await load();
    } catch (e) {
      setError((e as Error).message || "The invite didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const joined = (invites ?? []).filter((i) => i.status === "joined").length;

  return (
    <>
      <TopBar back={{ to: "/", label: "Home" }} />
      <main className="page narrow">
        <h1>Invite friends</h1>
        <p className="muted">
          Each friend who joins MathSprint with your link earns you one more deck, on top of your 5 free decks.
          {account && account.bonusDecks > 0 && ` You've earned ${account.bonusDecks} so far.`}
        </p>

        <form
          className="panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor="invite-email">Friend's email</label>
            <input id="invite-email" type="text" inputMode="email" autoComplete="off" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Creating…" : "Create invite link"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {latest && (
            <div className="reply stack" style={{ gap: 8 }} role="status">
              <span className="small">Send this link to {latest.email}. It counts when they sign up with that email.</span>
              <code className="invite-link">{inviteLink(latest.token, latest.email)}</code>
              <div className="row" style={{ gap: 8 }}>
                <CopyLink link={inviteLink(latest.token, latest.email)} />
                <a className="btn btn-small" href={mailto(latest.email, inviteLink(latest.token, latest.email))}>
                  Email it
                </a>
              </div>
            </div>
          )}
        </form>

        {invites && invites.length > 0 && (
          <section className="stack">
            <div className="row spread">
              <h2>Your invites</h2>
              <span className="muted">
                {joined} of {invites.length} joined
              </span>
            </div>
            <div className="panel">
            <ul className="requests">
              {invites.map((i) => (
                <li key={i.token} className="request">
                  <div className="row spread">
                    <b>{i.email}</b>
                    {i.status === "joined" ? <Chip tone="good">Joined · +1 deck</Chip> : <Chip>Invited</Chip>}
                  </div>
                  <span className="small">{i.status === "joined" ? `Joined ${when(i.joinedAt)}` : `Invited ${when(i.createdAt)}`}</span>
                  {i.status === "invited" && (
                    <div className="row" style={{ gap: 8 }}>
                      <CopyLink link={inviteLink(i.token, i.email)} />
                      <a className="btn btn-small" href={mailto(i.email, inviteLink(i.token, i.email))}>
                        Email it
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

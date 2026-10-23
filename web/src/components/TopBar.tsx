import { signOut } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAccount, useIsAdmin, useUser } from "../App";
import { auth } from "../lib/firebase";

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className="brand" style={small ? { fontSize: 19 } : undefined}>
      Math<span>Sprint</span>
    </div>
  );
}

export function Icon({ name, size = 18 }: { name: "back" | "sparkle" | "play" | "check" | "next" | "chevron" | "clock" | "more" | "file"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (name) {
    case "back":
      return <svg {...common} {...stroke}><path d="M15 18l-6-6 6-6" /></svg>;
    case "sparkle":
      return <svg {...common} {...stroke}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>;
    case "play":
      return <svg {...common} fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>;
    case "check":
      return <svg {...common} {...stroke} strokeWidth={3}><path d="M5 12l5 5 9-11" /></svg>;
    case "next":
      return <svg {...common} {...stroke} strokeWidth={2.5}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "chevron":
      return <svg {...common} {...stroke} strokeWidth={2.5}><path d="M9 6l6 6-6 6" /></svg>;
    case "clock":
      return <svg {...common} {...stroke}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg>;
    case "file":
      return <svg {...common} {...stroke}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
    case "more":
      return <svg {...common} fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
  }
}

function ProfileMenu() {
  const user = useUser();
  const { account } = useAccount();
  const admin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const initial = (user.displayName || user.email || "?").trim()[0]?.toUpperCase();
  return (
    <div ref={ref}>
      <button
        className="avatar"
        aria-label="Profile and settings"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {initial}
        {!admin && !!account?.reports?.unread && <span className="dot" aria-label="New reply to your report" />}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="who">{user.displayName || user.email}</div>
          {account && (
            <div className="who">
              <Chip>{account.isAdmin ? "Admin" : account.planLabel}</Chip>{" "}
              {!account.isAdmin && `${account.decksCreated} of ${account.maxDecks} decks used`}
              {account.promo && (
                <div className="small">Promotion until {new Date(account.promo.endsAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
              )}
            </div>
          )}
          <Link role="menuitem" className="menu-link" to="/plans" onClick={() => setOpen(false)}>
            Compare plans
          </Link>
          {!admin && (
            <Link role="menuitem" className="menu-link" to="/report" state={{ from: location.pathname }} onClick={() => setOpen(false)}>
              Report a problem {!!account?.reports?.unread && <span className="badge">{account.reports.unread}</span>}
            </Link>
          )}
          {admin && (
            <Link role="menuitem" className="menu-link" to="/admin" onClick={() => setOpen(false)}>
              Manage accounts
            </Link>
          )}
          <button role="menuitem" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Home gets the main navigation; inner pages get a back link. */
export default function TopBar({ back }: { back?: { to: string; label: string } }) {
  const { pathname, hash } = useLocation();
  const current = (h: string) => (pathname === "/" && hash === h ? "page" : undefined);
  const admin = useIsAdmin();
  const { account } = useAccount();
  const upgrade = account?.upgrade;
  const waiting = (upgrade?.waiting ?? 0) + (account?.reports?.open ?? 0);
  const unread = upgrade?.unreadReplies ?? 0;
  return (
    <header className="appbar">
      <div className="appbar-inner">
        {back ? (
          <>
            <Link className="back" to={back.to}>
              <Icon name="back" /> {back.label}
            </Link>
            <div style={{ flexGrow: 1 }} />
            <Brand small />
          </>
        ) : (
          <>
            <Brand />
            <nav className="nav" aria-label="Main">
              <Link to="/" aria-current={current("")}>Home</Link>
              <Link to="/#decks" aria-current={current("#decks")}>My decks</Link>
              <Link to="/#progress" aria-current={current("#progress")}>Progress</Link>
              <Link to="/groups" aria-current={pathname === "/groups" ? "page" : undefined}>Groups</Link>
              {!admin && (
                <>
                  <Link to="/upgrade" aria-current={pathname === "/upgrade" ? "page" : undefined}>
                    Upgrade {!!unread && <span className="badge" aria-label={`${unread} new ${unread === 1 ? "reply" : "replies"}`}>{unread}</span>}
                  </Link>
                  <Link to="/invite" aria-current={pathname === "/invite" ? "page" : undefined}>
                    Invite friends
                  </Link>
                </>
              )}
              {admin && (
                <Link to="/admin" aria-current={pathname === "/admin" ? "page" : undefined}>
                  Accounts {!!waiting && <span className="badge" aria-label={`${waiting} requests and reports waiting`}>{waiting}</span>}
                </Link>
              )}
              {admin && (
                <Link to="/admin/engagement" aria-current={pathname === "/admin/engagement" ? "page" : undefined}>
                  Engagement
                </Link>
              )}
            </nav>
            <ProfileMenu />
          </>
        )}
      </div>
    </header>
  );
}

export function Chip({ tone, children }: { tone?: "good" | "warn" | "bad" | "neutral" | "miss"; children: React.ReactNode }) {
  const style = tone === "miss" ? { background: "var(--miss-soft)", color: "var(--miss-ink)" } : undefined;
  return (
    <span className={`chip ${tone && tone !== "neutral" && tone !== "miss" ? tone : ""}`} style={style}>
      {children}
    </span>
  );
}

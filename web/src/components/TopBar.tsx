import { signOut } from "firebase/auth";
import { Link } from "react-router-dom";
import { auth } from "../lib/firebase";

export function Brand({ small }: { small?: boolean }) {
  return (
    <div className="brand" style={small ? { fontSize: 17 } : undefined}>
      Math<span>Sprint</span>
    </div>
  );
}

export default function TopBar({ back }: { back?: { to: string; label: string } }) {
  return (
    <div className="topbar">
      {back ? (
        <Link className="btn-link" to={back.to}>
          ← {back.label}
        </Link>
      ) : (
        <Brand />
      )}
      {back ? (
        <Brand small />
      ) : (
        <button className="btn-link" style={{ color: "var(--muted)" }} onClick={() => signOut(auth)}>
          Sign out
        </button>
      )}
    </div>
  );
}

export function Chip({ tone, children }: { tone?: "good" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  return <span className={`chip ${tone && tone !== "neutral" ? tone : ""}`}>{children}</span>;
}

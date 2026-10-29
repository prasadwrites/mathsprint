import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brand, Icon } from "../components/TopBar";
import { auth } from "../lib/firebase";
import { PLANS, planPrice, type PlanId } from "../lib/types";

type Cell = boolean | string;
const value = (by: Record<PlanId, number>) => Object.fromEntries(PLANS.map((p) => [p.id, String(by[p.id])])) as Record<PlanId, Cell>;
const all: Record<PlanId, Cell> = { free: true, pro: true, promax: true };
const paid: Record<PlanId, Cell> = { free: false, pro: true, promax: true };

/** Deck and question limits come from PLANS, which mirrors the server. */
const ROWS: { label: string; detail?: string; cells: Record<PlanId, Cell> }[] = [
  { label: "Price", detail: "Free needs no card", cells: Object.fromEntries(PLANS.map((p) => [p.id, planPrice(p.usdPerMonth)])) as Record<PlanId, Cell> },
  { label: "Decks you can build", detail: "Counted when you build them, so deleting one doesn't give it back", cells: value({ free: PLANS[0].decks, pro: PLANS[1].decks, promax: PLANS[2].decks }) },
  { label: "Questions per deck", cells: value({ free: PLANS[0].questions, pro: PLANS[1].questions, promax: PLANS[2].questions }) },
  { label: "AI decks on any topic, every answer checked", cells: all },
  { label: "Learn, Practice and Challenge modes", cells: all },
  { label: "Worked solutions and step-by-step help", cells: all },
  { label: "Progress and what to practice next", cells: all },
  { label: "One more deck for each friend who joins", cells: all },
  { label: "Contact groups for a class or study group", cells: paid },
  { label: "Assign tests to a group", detail: "Each person gets their own link and code; you see everyone's results", cells: paid },
];

function Mark({ cell }: { cell: Cell }) {
  if (typeof cell === "string") return <b className="mono">{cell}</b>;
  return cell ? (
    <span className="yes">
      <Icon name="check" size={16} />
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="no" aria-label="Not included">
      –
    </span>
  );
}

/** Same as the served plans.html title (see vite.config.ts), for visits that arrive from inside the app. */
const PLANS_TITLE = "MathSprint plans and pricing: timed practice decks for tutors";

/** Anyone can compare the plans, signed in or not. */
export default function Plans() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    document.title = PLANS_TITLE;
  }, []);

  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
            <Brand small />
          </Link>
          <div style={{ flexGrow: 1 }} />
          {user ? (
            <Link className="back" to="/">
              Back to MathSprint
            </Link>
          ) : user === null ? (
            <Link className="back" to="/">
              Sign in
            </Link>
          ) : null}
        </div>
      </header>
      <main className="page narrow">
        <div className="stack" style={{ gap: 8 }}>
          <h1>Compare plans</h1>
          <p className="muted">
            Every plan gets timed practice with AI-built decks and checked answers. Bigger plans give you more and bigger decks, plus tools for teachers and tutors. Pro costs less than one tutoring hour a month.
          </p>
        </div>

        <div className="panel plans-table-wrap">
          <table className="plans-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                {PLANS.map((p) => (
                  <th key={p.id} scope="col">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label}>
                  <th scope="row">
                    {r.label}
                    {r.detail && <span className="small muted">{r.detail}</span>}
                  </th>
                  {PLANS.map((p) => (
                    <td key={p.id}>
                      <Mark cell={r.cells[p.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row">
          {user ? (
            <Link className="btn btn-primary btn-big" to="/upgrade">
              Upgrade
            </Link>
          ) : (
            <Link className="btn btn-primary btn-big" to="/">
              Start free
            </Link>
          )}
          <span className="muted">{user ? "Pay with Square on the Upgrade page, and we'll switch your plan." : "Free needs no card. You can upgrade any time after you sign up."}</span>
        </div>
      </main>
    </>
  );
}

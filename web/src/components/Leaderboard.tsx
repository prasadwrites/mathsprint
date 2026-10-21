import { Chip } from "./TopBar";
import { formatClock } from "../lib/pace";
import type { BoardRow } from "../lib/types";

/** A public test's top places. `highlight` marks the viewer's own place (1 is top). Sample players are only marked
 * in the admin's view; the public page never gets the flag. */
export default function Leaderboard({ rows, total, highlight }: { rows: BoardRow[]; total: number; highlight?: number }) {
  if (rows.length === 0) {
    return <p className="muted">Nobody's on the leaderboard yet. The first person to finish and sign up takes the top spot.</p>;
  }
  return (
    <ol className="board">
      {rows.map((r, i) => (
        <li key={i} className={highlight === i + 1 ? "me" : undefined}>
          <span className={`board-place p${i + 1}`}>{i + 1}</span>
          <span className="board-name">
            {r.name} {r.sample && <Chip>Sample</Chip>}
          </span>
          <b className="mono">
            {r.score}/{total}
          </b>
          <span className="muted mono">{formatClock(r.usedSec)}</span>
        </li>
      ))}
    </ol>
  );
}

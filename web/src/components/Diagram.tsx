import type { DiagramItem, GeometryFigure } from "../lib/types";

const W = 400;
/** Room around the shape for point names and side labels. */
const PAD = 34;
const MAX_H = 400;
/** Wide shapes would otherwise fill the card and draw their lines and labels oversized. */
const MAX_WIDTH = 460;

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const len = (a: V) => Math.hypot(a[0], a[1]);
const unit = (a: V): V => (len(a) ? mul(a, 1 / len(a)) : [0, -1]);
const pt = (a: V) => `${a[0].toFixed(1)},${a[1].toFixed(1)}`;

/** Draws a geometry diagram to scale. Coordinates were checked against every label on the server. */
export default function Diagram({ diagram, small }: { diagram: GeometryFigure; small: boolean }) {
  const byName = new Map(diagram.points.map((p) => [p.name, p]));
  const radius = (it: DiagramItem) => {
    const [c, p] = it.of.map((n) => byName.get(n)!);
    return Math.hypot(p.x - c.x, p.y - c.y);
  };

  // The bounding box of every point and circle, in the diagram's own units.
  const xs = diagram.points.map((p) => p.x);
  const ys = diagram.points.map((p) => p.y);
  for (const it of diagram.items) {
    if (it.type !== "circle") continue;
    const c = byName.get(it.of[0])!;
    const r = radius(it);
    xs.push(c.x - r, c.x + r);
    ys.push(c.y - r, c.y + r);
  }
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const scale = Math.min((W - 2 * PAD) / bw, (MAX_H - 2 * PAD) / bh);
  const H = Math.round(bh * scale + 2 * PAD);
  const offX = (W - bw * scale) / 2;
  const at = (name: string): V => {
    const p = byName.get(name)!;
    return [offX + (p.x - minX) * scale, PAD + (maxY - p.y) * scale];
  };

  // Labels point away from the middle of the shape, so they sit outside it.
  const all = diagram.points.map((p) => at(p.name));
  const center: V = mul(all.reduce(add, [0, 0] as V), 1 / all.length);

  const fills: JSX.Element[] = [];
  const lines: JSX.Element[] = [];
  const marks: JSX.Element[] = [];
  const labels: JSX.Element[] = [];

  diagram.items.forEach((it, i) => {
    const p = it.of.map(at);
    const stroke = { stroke: "var(--ink)", strokeWidth: 2.2, fill: "none", strokeDasharray: it.dashed ? "6 5" : undefined, strokeLinejoin: "round" as const };
    switch (it.type) {
      case "polygon": {
        const d = `M${p.map(pt).join(" L")} Z`;
        if (it.shaded) fills.push(<path key={i} d={d} fill="var(--accent)" opacity={0.18} />);
        lines.push(<path key={i} d={d} {...stroke} />);
        break;
      }
      case "segment":
        lines.push(<path key={i} d={`M${pt(p[0])} L${pt(p[1])}`} {...stroke} />);
        break;
      case "circle": {
        const r = radius(it) * scale;
        if (it.shaded) fills.push(<circle key={i} cx={p[0][0]} cy={p[0][1]} r={r} fill="var(--accent)" opacity={0.18} />);
        lines.push(<circle key={i} cx={p[0][0]} cy={p[0][1]} r={r} {...stroke} />);
        break;
      }
      case "right_angle": {
        const u = mul(unit(sub(p[0], p[1])), 12);
        const v = mul(unit(sub(p[2], p[1])), 12);
        marks.push(<path key={i} d={`M${pt(add(p[1], u))} L${pt(add(add(p[1], u), v))} L${pt(add(p[1], v))}`} stroke="var(--ink)" strokeWidth={1.6} fill="none" />);
        break;
      }
      case "angle_mark": {
        const a1 = Math.atan2(p[0][1] - p[1][1], p[0][0] - p[1][0]);
        const a2 = Math.atan2(p[2][1] - p[1][1], p[2][0] - p[1][0]);
        let diff = a2 - a1;
        while (diff <= -Math.PI) diff += 2 * Math.PI;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        for (let k = 0; k < Math.max(1, it.count); k++) {
          const r = 20 + 5 * k;
          const from = add(p[1], [r * Math.cos(a1), r * Math.sin(a1)]);
          const to = add(p[1], [r * Math.cos(a2), r * Math.sin(a2)]);
          marks.push(<path key={`${i}-${k}`} d={`M${pt(from)} A${r},${r} 0 0 ${diff > 0 ? 1 : 0} ${pt(to)}`} stroke="var(--ink)" strokeWidth={1.6} fill="none" />);
        }
        break;
      }
      case "angle_label": {
        const bis = unit(add(unit(sub(p[0], p[1])), unit(sub(p[2], p[1]))));
        const spot = add(p[1], mul(bis, 38));
        labels.push(
          <text key={i} x={spot[0]} y={spot[1]} textAnchor="middle" dominantBaseline="middle" className="fig-label fig-halo dia-label">
            {it.text}
          </text>,
        );
        break;
      }
      case "length_label": {
        const mid = mul(add(p[0], p[1]), 0.5);
        let n = unit([p[0][1] - p[1][1], p[1][0] - p[0][0]]);
        if (len(sub(add(mid, n), center)) < len(sub(mid, center))) n = mul(n, -1);
        const spot = add(mid, mul(n, 15));
        labels.push(
          <text key={i} x={spot[0]} y={spot[1]} textAnchor="middle" dominantBaseline="middle" className="fig-label fig-halo dia-label">
            {it.text}
          </text>,
        );
        break;
      }
      case "ticks": {
        const mid = mul(add(p[0], p[1]), 0.5);
        const along = unit(sub(p[1], p[0]));
        const across = mul([-along[1], along[0]], 6);
        for (let k = 0; k < it.count; k++) {
          const c = add(mid, mul(along, (k - (it.count - 1) / 2) * 5));
          marks.push(<path key={`${i}-${k}`} d={`M${pt(sub(c, across))} L${pt(add(c, across))}`} stroke="var(--ink)" strokeWidth={1.6} />);
        }
        break;
      }
    }
  });

  const names = diagram.points
    .filter((p) => p.show)
    .map((p) => {
      const at_ = at(p.name);
      const dir = unit(sub(at_, center));
      // Names above or below a point need more room than names beside it, since text is wider than tall.
      const spot = add(at_, mul(dir, Math.abs(dir[1]) > 0.6 ? 18 : 14));
      return (
        <g key={p.name}>
          <circle cx={at_[0]} cy={at_[1]} r={3.5} fill="var(--ink)" />
          <text
            x={spot[0]}
            y={spot[1]}
            textAnchor={dir[0] > 0.35 ? "start" : dir[0] < -0.35 ? "end" : "middle"}
            dominantBaseline="middle"
            className="fig-label fig-halo"
          >
            {p.name}
          </text>
        </g>
      );
    });

  return (
    <figure className={`figure${small ? " small" : ""}`} style={{ maxWidth: small ? 260 : Math.min(MAX_WIDTH, Math.round((340 * W) / H)) }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={diagram.alt}>
        {fills}
        {lines}
        {marks}
        {labels}
        {names}
      </svg>
    </figure>
  );
}

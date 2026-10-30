import { useId } from "react";
import type { Figure as FigureSpec, FigureItem, ImageFigure, PlaneFigure } from "../lib/types";
import Diagram from "./Diagram";

const W = 400;
const PAD = 14;
/** Graphs take these colors in order, so f and g are told apart by more than their labels. */
const SERIES = ["var(--accent)", "var(--miss)", "var(--good)", "var(--bad)"];

/** The steps at which grid lines fall, counted in whole steps so floating point never drifts. */
function ticks(min: number, max: number, step: number) {
  const out: number[] = [];
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + 1e-9; k++) out.push(+(k * step).toFixed(6));
  return out;
}

const fmt = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

/** Draws a question's graph or geometry diagram, or shows the picture its owner uploaded. The server has already
 * checked everything in it. */
export default function Figure({ figure, small = false }: { figure: FigureSpec; small?: boolean }) {
  if (figure.kind === "image") return <Uploaded figure={figure} small={small} />;
  return figure.kind === "geometry" ? <Diagram diagram={figure} small={small} /> : <Plane figure={figure} small={small} />;
}

/** The owner's own picture, no taller than a drawn one. */
function Uploaded({ figure, small }: { figure: ImageFigure; small: boolean }) {
  const maxH = small ? 220 : 360;
  const maxW = Math.min(small ? 280 : 560, Math.round((maxH * figure.width) / figure.height));
  return (
    <figure className={`figure figure-image${small ? " small" : ""}`} style={{ maxWidth: maxW }}>
      <img src={figure.src} alt={figure.alt} width={figure.width} height={figure.height} />
    </figure>
  );
}

/** A coordinate plane with graphs, which the server has already sampled. */
function Plane({ figure, small }: { figure: PlaneFigure; small: boolean }) {
  const clip = `fig${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { xMin, xMax, yMin, yMax, xGrid, yGrid } = figure;
  const H = Math.round(W * Math.min(1, Math.max(0.55, (yMax - yMin) / (xMax - xMin))));
  const sx = (x: number) => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
  const sy = (y: number) => PAD + ((yMax - y) / (yMax - yMin)) * (H - 2 * PAD);
  const inView = (x: number, y: number) => x >= xMin && x <= xMax && y >= yMin && y <= yMax;

  const xs = ticks(xMin, xMax, xGrid);
  const ys = ticks(yMin, yMax, yGrid);
  // Number every line when there are few, otherwise every second or fifth so labels never collide.
  const every = (n: number) => (n <= 12 ? 1 : n <= 24 ? 2 : 5);
  const xEvery = every(xs.length);
  const yEvery = every(ys.length);
  const axisY = yMin <= 0 && yMax >= 0 ? 0 : yMin; // the x-axis, or the bottom edge when 0 is out of view
  const axisX = xMin <= 0 && xMax >= 0 ? 0 : xMin;

  let series = 0;
  const colorOf = new Map<FigureItem, string>();
  for (const item of figure.items) {
    if (item.type !== "point") colorOf.set(item, SERIES[series++ % SERIES.length]);
  }

  const polyline = (xy: number[]) => xy.reduce((d, v, k) => (k % 2 ? `${d},${sy(v).toFixed(1)}` : `${d}${k ? " L" : "M"}${sx(v).toFixed(1)}`), "");

  /** A spot for a graph's name: the rightmost sample comfortably inside the view. */
  const labelSpot = (item: FigureItem): [number, number] | null => {
    const mx = (xMax - xMin) * 0.06;
    const my = (yMax - yMin) * 0.06;
    for (const p of [...(item.paths ?? [])].reverse()) {
      for (let k = p.xy.length - 2; k >= 0; k -= 2) {
        const [x, y] = [p.xy[k], p.xy[k + 1]];
        if (x < xMax - mx && x > xMin + mx && y < yMax - my && y > yMin + my) return [x, y];
      }
    }
    return null;
  };

  const draw = (item: FigureItem, i: number) => {
    const color = colorOf.get(item) ?? "var(--ink)";
    const dash = item.dashed ? "7 5" : undefined;
    const line = { stroke: color, strokeWidth: 2.5, fill: "none", strokeDasharray: dash, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    switch (item.type) {
      case "function":
      case "region": {
        const paths = item.paths ?? [];
        const spot = labelSpot(item);
        return (
          <g key={i}>
            {item.type === "region" &&
              paths.map((p, k) => {
                const edge = sy(item.side === "above" ? yMax : yMin);
                const first = sx(p.xy[0]);
                const last = sx(p.xy[p.xy.length - 2]);
                return <path key={k} d={`${polyline(p.xy)} L${last},${edge} L${first},${edge} Z`} fill={color} opacity={0.16} />;
              })}
            {paths.map((p, k) => (
              <path key={k} d={polyline(p.xy)} {...line} />
            ))}
            {item.label && spot && (
              <text x={sx(spot[0]) + 6} y={sy(spot[1]) - 8} className="fig-label" style={{ fill: color }}>
                {item.label}
              </text>
            )}
          </g>
        );
      }
      case "line": {
        // Extend far past the view both ways; the clip path trims it to the plot.
        const [a, b] = item.points;
        const far = 1000 * Math.max(xMax - xMin, yMax - yMin);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const [dx, dy] = [((b.x - a.x) / len) * far, ((b.y - a.y) / len) * far];
        return <path key={i} d={`M${sx(a.x - dx)},${sy(a.y - dy)} L${sx(a.x + dx)},${sy(a.y + dy)}`} {...line} />;
      }
      case "segment": {
        const [a, b] = item.points;
        return <path key={i} d={`M${sx(a.x)},${sy(a.y)} L${sx(b.x)},${sy(b.y)}`} {...line} />;
      }
      case "point": {
        const p = item.points[0];
        if (!p || !inView(p.x, p.y)) return null;
        const right = sx(p.x) < W - 70;
        return (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill="var(--ink)" stroke="var(--surface)" strokeWidth={1.5} />
            {item.label && (
              <text x={sx(p.x) + (right ? 8 : -8)} y={sy(p.y) - 8} textAnchor={right ? "start" : "end"} className="fig-label fig-halo">
                {item.label}
              </text>
            )}
          </g>
        );
      }
    }
  };

  return (
    <figure className={`figure${small ? " small" : ""}`} style={{ maxWidth: small ? 280 : Math.round((360 * W) / H) }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={figure.alt}>
        <defs>
          <clipPath id={clip}>
            <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} />
          </clipPath>
        </defs>
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="fig-plot" />
        <g className="fig-grid">
          {xs.map((x) => (
            <line key={`x${x}`} x1={sx(x)} x2={sx(x)} y1={PAD} y2={H - PAD} />
          ))}
          {ys.map((y) => (
            <line key={`y${y}`} y1={sy(y)} y2={sy(y)} x1={PAD} x2={W - PAD} />
          ))}
        </g>
        <g className="fig-axis">
          {yMin <= 0 && yMax >= 0 && <line x1={PAD} x2={W - PAD} y1={sy(0)} y2={sy(0)} />}
          {xMin <= 0 && xMax >= 0 && <line y1={PAD} y2={H - PAD} x1={sx(0)} x2={sx(0)} />}
        </g>
        <g className="fig-ticks" aria-hidden>
          {xs.map((x) =>
            x !== 0 && x !== xMin && x !== xMax && Math.round(x / xGrid) % xEvery === 0 ? (
              <text key={`tx${x}`} x={sx(x)} y={Math.min(sy(axisY) + 14, H - PAD - 3)} textAnchor="middle" className="fig-halo">
                {fmt(x)}
              </text>
            ) : null,
          )}
          {ys.map((y) =>
            y !== 0 && y !== yMin && y !== yMax && Math.round(y / yGrid) % yEvery === 0 ? (
              <text key={`ty${y}`} x={Math.max(sx(axisX) - 5, PAD + 18)} y={sy(y) + 4} textAnchor="end" className="fig-halo">
                {fmt(y)}
              </text>
            ) : null,
          )}
          {xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0 && (
            <text x={sx(0) - 5} y={sy(0) + 14} textAnchor="end" className="fig-halo">
              0
            </text>
          )}
          <text x={W - PAD - 4} y={sy(axisY) - 6} textAnchor="end" className="fig-axis-name">
            x
          </text>
          <text x={sx(axisX) + 6} y={PAD + 12} className="fig-axis-name">
            y
          </text>
        </g>
        <g clipPath={`url(#${clip})`}>{figure.items.filter((it) => it.type !== "point").map(draw)}</g>
        {figure.items.map((it, i) => (it.type === "point" ? draw(it, i) : null))}
      </svg>
    </figure>
  );
}

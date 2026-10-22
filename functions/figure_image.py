"""Draws a question's graph or geometry diagram as a picture, for the question post card.

The same drawing as the app's Figure.tsx and Diagram.tsx, in the same 400-unit space, so the card matches what the
visitor sees when they open the link. Drawn three times larger than asked and scaled down, which smooths the lines.
"""

from __future__ import annotations

import math
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

W = 400
SS = 3  # supersampling
INK = (23, 32, 44)
MUTED = (79, 92, 108)
LINE = (221, 227, 234)
ACCENT = (37, 87, 214)
WHITE = (255, 255, 255)
SERIES = [ACCENT, (224, 136, 44), (29, 122, 73), (168, 50, 31)]  # accent, miss, good, bad, as in Figure.tsx
_FONTS = os.path.join(os.path.dirname(__file__), "fonts")


@lru_cache(maxsize=32)
def _font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    name = {"text": "Inter-Medium.otf", "bold": "InterDisplay-ExtraBold.otf", "mono": "JetBrainsMono-Bold.ttf"}[kind]
    return ImageFont.truetype(os.path.join(_FONTS, name), size)


class _Pen:
    """Draws in the figure's 400-unit space onto a canvas `k` times larger."""

    def __init__(self, img: Image.Image, k: float, t: float = 1.0):
        self.img, self.k = img, k
        self.t = t  # text and lines grow by this much on a small picture, so they stay readable
        self.d = ImageDraw.Draw(img, "RGBA")

    def p(self, x: float, y: float) -> tuple[float, float]:
        return (x * self.k, y * self.k)

    def line(self, pts: list[tuple[float, float]], color, width: float, dashed: tuple[float, float] | None = None) -> None:
        pts = [self.p(x, y) for x, y in pts]
        w = max(1, round(width * self.k * min(self.t, 1.6)))
        if not dashed:
            self.d.line(pts, fill=color, width=w, joint="curve")
            for x, y in (pts[0], pts[-1]):  # round caps
                self.d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)
            return
        on, off = dashed[0] * self.k, dashed[1] * self.k
        left, drawing = on, True
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            seg = math.hypot(x2 - x1, y2 - y1)
            at = 0.0
            while at < seg:
                step = min(left, seg - at)
                if drawing and step > 0:
                    t1, t2 = at / seg, (at + step) / seg
                    self.d.line([(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1), (x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2)], fill=color, width=w)
                at += step
                left -= step
                if left <= 1e-9:
                    drawing = not drawing
                    left = on if drawing else off

    def polygon(self, pts: list[tuple[float, float]], fill) -> None:
        self.d.polygon([self.p(x, y) for x, y in pts], fill=fill)

    def circle(self, cx: float, cy: float, r: float, fill=None, outline=None, width: float = 0) -> None:
        x, y = self.p(cx, cy)
        r *= self.k
        self.d.ellipse((x - r, y - r, x + r, y + r), fill=fill, outline=outline, width=max(1, round(width * self.k * min(self.t, 1.6))) if outline else 0)

    def circle_line(self, cx: float, cy: float, r: float, color, width: float, dashed: bool) -> None:
        if not dashed:
            self.circle(cx, cy, r, outline=color, width=width)
            return
        n = max(24, int(2 * math.pi * r / 4))
        pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]
        self.line(pts, color, width, (6, 5))

    def text(self, x: float, y: float, s: str, font: str, size: float, color, anchor: str = "ls", halo: bool = False) -> None:
        f = _font(font, max(6, round(size * self.k * self.t)))
        extra = {"stroke_width": round(2 * self.k * self.t), "stroke_fill": WHITE} if halo else {}
        self.d.text(self.p(x, y), s, font=f, fill=color, anchor=anchor, **extra)


def _ticks(lo: float, hi: float, step: float) -> list[float]:
    out = []
    if step <= 0:
        return out
    k = math.ceil(lo / step - 1e-9)
    while k * step <= hi + 1e-9 and len(out) < 400:
        out.append(round(k * step, 6))
        k += 1
    return out


def _fmt(n: float) -> str:
    s = f"{abs(n):g}"
    return f"−{s}" if n < 0 else s


def plane_height(fig: dict) -> int:
    xr = (fig.get("xMax", 1) - fig.get("xMin", 0)) or 1
    yr = fig.get("yMax", 1) - fig.get("yMin", 0)
    return round(W * min(1, max(0.55, yr / xr)))


def _plane(fig: dict, k: float, t: float) -> Image.Image:
    pad = 14
    H = plane_height(fig)
    x0, x1, y0, y1 = (float(fig.get(n, 0)) for n in ("xMin", "xMax", "yMin", "yMax"))
    if x1 <= x0 or y1 <= y0:
        x0, x1, y0, y1 = -5.0, 5.0, -5.0, 5.0
    xg, yg = float(fig.get("xGrid") or 1), float(fig.get("yGrid") or 1)
    sx = lambda x: pad + (x - x0) / (x1 - x0) * (W - 2 * pad)  # noqa: E731
    sy = lambda y: pad + (y1 - y) / (y1 - y0) * (H - 2 * pad)  # noqa: E731

    img = Image.new("RGB", (round(W * k), round(H * k)), WHITE)
    pen = _Pen(img, k, t)
    pen.d.rectangle((*pen.p(pad, pad), *pen.p(W - pad, H - pad)), outline=LINE, width=max(1, round(k)))
    xs, ys = _ticks(x0, x1, xg), _ticks(y0, y1, yg)
    for x in xs:
        pen.line([(sx(x), pad), (sx(x), H - pad)], LINE, 1)
    for y in ys:
        pen.line([(pad, sy(y)), (W - pad, sy(y))], LINE, 1)
    if y0 <= 0 <= y1:
        pen.line([(pad, sy(0)), (W - pad, sy(0))], MUTED, 1.6)
    if x0 <= 0 <= x1:
        pen.line([(sx(0), pad), (sx(0), H - pad)], MUTED, 1.6)

    every = lambda n: 1 if n <= 12 else 2 if n <= 24 else 5  # noqa: E731
    axis_y = 0 if y0 <= 0 <= y1 else y0
    axis_x = 0 if x0 <= 0 <= x1 else x0
    for x in xs:
        if x not in (0, x0, x1) and round(x / xg) % every(len(xs)) == 0:
            pen.text(sx(x), min(sy(axis_y) + 14, H - pad - 3), _fmt(x), "mono", 11, MUTED, "ms", halo=True)
    for y in ys:
        if y not in (0, y0, y1) and round(y / yg) % every(len(ys)) == 0:
            pen.text(max(sx(axis_x) - 5, pad + 18), sy(y) + 4, _fmt(y), "mono", 11, MUTED, "rs", halo=True)
    if x0 <= 0 <= x1 and y0 <= 0 <= y1:
        pen.text(sx(0) - 5, sy(0) + 14, "0", "mono", 11, MUTED, "rs", halo=True)
    pen.text(W - pad - 4, sy(axis_y) - 6, "x", "text", 13, MUTED, "rs")
    pen.text(sx(axis_x) + 6, pad + 12, "y", "text", 13, MUTED, "ls")

    # Graphs, lines and regions go on their own layer, clipped to the plot like the app's clip path.
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    lp = _Pen(layer, k, t)
    items = fig.get("items") or []
    labels = []
    series = 0
    for it in items:
        if it.get("type") == "point":
            continue
        color = SERIES[series % len(SERIES)]
        series += 1
        dash = (7, 5) if it.get("dashed") else None
        kind = it.get("type")
        if kind in ("function", "region"):
            paths = [p.get("xy") or [] for p in it.get("paths") or []]
            for xy in paths:
                if len(xy) < 4:
                    continue
                pts = [(sx(xy[i]), sy(xy[i + 1])) for i in range(0, len(xy) - 1, 2)]
                if kind == "region":
                    edge = sy(y1 if it.get("side") == "above" else y0)
                    lp.polygon([*pts, (pts[-1][0], edge), (pts[0][0], edge)], (*color, 41))
                lp.line(pts, color, 2.5, dash)
            spot = _label_spot(paths, x0, x1, y0, y1)
            if it.get("label") and spot:
                labels.append((sx(spot[0]) + 6, sy(spot[1]) - 8, it["label"], color, "ls"))
        elif kind in ("line", "segment"):
            pts = it.get("points") or []
            if len(pts) < 2:
                continue
            a, b = pts[0], pts[1]
            if kind == "line":
                far = 1000 * max(x1 - x0, y1 - y0)
                n = math.hypot(b["x"] - a["x"], b["y"] - a["y"]) or 1
                dx, dy = (b["x"] - a["x"]) / n * far, (b["y"] - a["y"]) / n * far
                lp.line([(sx(a["x"] - dx), sy(a["y"] - dy)), (sx(a["x"] + dx), sy(a["y"] + dy))], color, 2.5, dash)
            else:
                lp.line([(sx(a["x"]), sy(a["y"])), (sx(b["x"]), sy(b["y"]))], color, 2.5, dash)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rectangle((*pen.p(pad, pad), *pen.p(W - pad, H - pad)), fill=255)
    clipped = Image.new("RGBA", img.size, (0, 0, 0, 0))
    clipped.paste(layer, (0, 0), mask)
    img.paste(clipped, (0, 0), clipped)
    pen = _Pen(img, k, t)
    for x, y, s, color, anchor in labels:
        pen.text(x, y, s, "bold", 15, color, anchor)

    for it in items:
        if it.get("type") != "point" or not it.get("points"):
            continue
        p = it["points"][0]
        if not (x0 <= p["x"] <= x1 and y0 <= p["y"] <= y1):
            continue
        cx, cy = sx(p["x"]), sy(p["y"])
        pen.circle(cx, cy, 6, fill=WHITE)
        pen.circle(cx, cy, 4.5, fill=INK)
        if it.get("label"):
            right = cx < W - 70
            pen.text(cx + (8 if right else -8), cy - 8, it["label"], "bold", 15, INK, "ls" if right else "rs", halo=True)
    return img


def _label_spot(paths: list[list[float]], x0: float, x1: float, y0: float, y1: float) -> tuple[float, float] | None:
    mx, my = (x1 - x0) * 0.06, (y1 - y0) * 0.06
    for xy in reversed(paths):
        for i in range(len(xy) - 2, -1, -2):
            x, y = xy[i], xy[i + 1]
            if x0 + mx < x < x1 - mx and y0 + my < y < y1 - my:
                return x, y
    return None


def _unit(v: tuple[float, float]) -> tuple[float, float]:
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n) if n else (0.0, -1.0)


def _geometry_layout(fig: dict):
    pts = {p["name"]: p for p in fig.get("points") or []}
    xs = [p["x"] for p in pts.values()]
    ys = [p["y"] for p in pts.values()]
    for it in fig.get("items") or []:
        if it.get("type") == "circle" and len(it.get("of") or []) >= 2 and all(n in pts for n in it["of"][:2]):
            c, q = pts[it["of"][0]], pts[it["of"][1]]
            r = math.hypot(q["x"] - c["x"], q["y"] - c["y"])
            xs += [c["x"] - r, c["x"] + r]
            ys += [c["y"] - r, c["y"] + r]
    if not xs:
        return pts, 0, 0, 0, 1, 1, 1
    pad, max_h = 34, 400
    bw = (max(xs) - min(xs)) or 1
    bh = (max(ys) - min(ys)) or 1
    scale = min((W - 2 * pad) / bw, (max_h - 2 * pad) / bh)
    H = round(bh * scale + 2 * pad)
    return pts, min(xs), max(ys), (W - bw * scale) / 2, scale, H, pad


def geometry_height(fig: dict) -> int:
    return _geometry_layout(fig)[5]


def _geometry(fig: dict, k: float, t: float) -> Image.Image:
    pts, min_x, max_y, off_x, scale, H, pad = _geometry_layout(fig)
    img = Image.new("RGB", (round(W * k), round(H * k)), WHITE)
    if not pts:
        return img
    at = lambda n: (off_x + (pts[n]["x"] - min_x) * scale, pad + (max_y - pts[n]["y"]) * scale)  # noqa: E731
    all_ = [at(n) for n in pts]
    center = (sum(p[0] for p in all_) / len(all_), sum(p[1] for p in all_) / len(all_))
    fills = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fp = _Pen(fills, k, t)
    pen = _Pen(img, k, t)
    lines, marks, labels = [], [], []
    for it in fig.get("items") or []:
        of = [n for n in it.get("of") or [] if n in pts]
        if len(of) != len(it.get("of") or []) or not of:
            continue
        p = [at(n) for n in of]
        dash = (6, 5) if it.get("dashed") else None
        kind = it.get("type")
        if kind == "polygon" and len(p) >= 3:
            if it.get("shaded"):
                fp.polygon(p, (*ACCENT, 46))
            lines.append(lambda p=p, dash=dash: pen.line([*p, p[0]], INK, 2.2, dash))
        elif kind == "segment" and len(p) >= 2:
            lines.append(lambda p=p, dash=dash: pen.line(p[:2], INK, 2.2, dash))
        elif kind == "circle" and len(p) >= 2:
            r = math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1])
            if it.get("shaded"):
                fp.circle(p[0][0], p[0][1], r, fill=(*ACCENT, 46))
            lines.append(lambda p=p, r=r, d=bool(dash): pen.circle_line(p[0][0], p[0][1], r, INK, 2.2, d))
        elif kind == "right_angle" and len(p) >= 3:
            u, v = _unit((p[0][0] - p[1][0], p[0][1] - p[1][1])), _unit((p[2][0] - p[1][0], p[2][1] - p[1][1]))
            a = (p[1][0] + 12 * u[0], p[1][1] + 12 * u[1])
            b = (a[0] + 12 * v[0], a[1] + 12 * v[1])
            c = (p[1][0] + 12 * v[0], p[1][1] + 12 * v[1])
            marks.append(lambda a=a, b=b, c=c: pen.line([a, b, c], INK, 1.6))
        elif kind == "angle_mark" and len(p) >= 3:
            a1 = math.atan2(p[0][1] - p[1][1], p[0][0] - p[1][0])
            a2 = math.atan2(p[2][1] - p[1][1], p[2][0] - p[1][0])
            diff = a2 - a1
            while diff <= -math.pi:
                diff += 2 * math.pi
            while diff > math.pi:
                diff -= 2 * math.pi
            for j in range(max(1, int(it.get("count") or 1))):
                r = 20 + 5 * j
                arc = [(p[1][0] + r * math.cos(a1 + diff * t / 24), p[1][1] + r * math.sin(a1 + diff * t / 24)) for t in range(25)]
                marks.append(lambda arc=arc: pen.line(arc, INK, 1.6))
        elif kind == "angle_label" and len(p) >= 3:
            u, v = _unit((p[0][0] - p[1][0], p[0][1] - p[1][1])), _unit((p[2][0] - p[1][0], p[2][1] - p[1][1]))
            b = _unit((u[0] + v[0], u[1] + v[1]))
            labels.append((p[1][0] + 38 * b[0], p[1][1] + 38 * b[1], it.get("text") or "", "mm"))
        elif kind == "length_label" and len(p) >= 2:
            mid = ((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2)
            n = _unit((p[0][1] - p[1][1], p[1][0] - p[0][0]))
            if math.hypot(mid[0] + n[0] - center[0], mid[1] + n[1] - center[1]) < math.hypot(mid[0] - center[0], mid[1] - center[1]):
                n = (-n[0], -n[1])
            labels.append((mid[0] + 15 * n[0], mid[1] + 15 * n[1], it.get("text") or "", "mm"))
        elif kind == "ticks" and len(p) >= 2:
            mid = ((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2)
            al = _unit((p[1][0] - p[0][0], p[1][1] - p[0][1]))
            ac = (-al[1] * 6, al[0] * 6)
            count = int(it.get("count") or 1)
            for j in range(count):
                c = (mid[0] + al[0] * (j - (count - 1) / 2) * 5, mid[1] + al[1] * (j - (count - 1) / 2) * 5)
                marks.append(lambda c=c, ac=ac: pen.line([(c[0] - ac[0], c[1] - ac[1]), (c[0] + ac[0], c[1] + ac[1])], INK, 1.6))
    img.paste(fills, (0, 0), fills)
    for draw in lines + marks:
        draw()
    for x, y, s, anchor in labels:
        pen.text(x, y, s, "bold", 15, ACCENT, anchor, halo=True)
    for name, p in pts.items():
        if not p.get("show", True):
            continue
        a = at(name)
        d = _unit((a[0] - center[0], a[1] - center[1]))
        dist = 18 if abs(d[1]) > 0.6 else 14
        h = "l" if d[0] > 0.35 else "r" if d[0] < -0.35 else "m"
        pen.circle(a[0], a[1], 3.5, fill=INK)
        pen.text(a[0] + d[0] * dist, a[1] + d[1] * dist, name, "bold", 15, INK, f"{h}m", halo=True)
    return img


def render(fig: dict, max_w: int, max_h: int, min_label: int = 14) -> Image.Image:
    """The figure as an RGB picture on white, as large as fits in max_w by max_h. Labels are at least min_label
    pixels tall, so they stay readable on a small picture."""
    geometry = fig.get("kind") == "geometry"
    H = geometry_height(fig) if geometry else plane_height(fig)
    k = min(max_w / W, max_h / H)
    big = (_geometry if geometry else _plane)(fig, k * SS, max(1.0, min_label / (15 * k)))
    return big.resize((max(1, round(W * k)), max(1, round(H * k))), Image.LANCZOS)

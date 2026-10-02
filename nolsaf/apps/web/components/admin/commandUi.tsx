"use client";

import { useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

/**
 * The "command" look shared by the finance surfaces (All Revenue, the
 * Expenses overview): a charcoal green canvas, flat panels with thin borders
 * and small corners, no glows. Brand reads "NoLSAF"; never put it in an
 * uppercase label.
 */

export const panel = "min-w-0 rounded-lg border border-solid border-[#284540] bg-[#182c28]";
export const eyebrow = "m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8fb5ad]";
export const ghostButton = "inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-[#284540] bg-[#13241f] px-3.5 text-xs font-semibold text-slate-200 no-underline transition hover:border-emerald-300/40 hover:text-emerald-200 hover:no-underline";

export function CommandCanvas({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0 rounded-xl bg-[#13241f] text-slate-100">
      <div className="space-y-4 p-3 sm:p-5">{children}</div>
    </div>
  );
}

export function DeltaChip({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return null;
  const flat = Math.abs(value) < 0.5;
  const good = invert ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ring-inset ${flat ? "bg-white/[0.04] text-slate-400 ring-white/10" : good ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25" : "bg-rose-400/10 text-rose-300 ring-rose-400/25"}`}>
      <Icon className="h-3 w-3" />
      {flat ? "0%" : `${Math.abs(value).toFixed(value >= 100 ? 0 : 1)}%`}
    </span>
  );
}

/** Smooth path through points: horizontal-tangent cubic curves, so it never overshoots. */
export function smoothPath(pts: Array<[number, number]>) {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

/** A 240° dial. `marker` draws a tick at a value on the same scale (e.g. break-even). */
export function Dial({ value, max, label, display, sub, tone = "good", marker }: { value: number | null; max: number; label: string; display: string; sub?: ReactNode; tone?: "good" | "warn" | "bad"; marker?: number }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const sweep = C * (240 / 360);
  const shown = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const stroke = tone === "bad" ? "#f87171" : tone === "warn" ? "#fbbf24" : "#34d399";
  // Marker position: the dial starts at 150° (rotated) and sweeps 240°.
  const markerAngle = marker != null ? ((150 + (Math.min(marker, max) / max) * 240) * Math.PI) / 180 : null;
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full">
        <g transform="rotate(150 70 70)">
          <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${sweep} ${C}`} />
          {shown > 0 ? <circle cx="70" cy="70" r={R} fill="none" stroke={stroke} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${sweep * shown} ${C}`} /> : null}
        </g>
        {markerAngle != null ? (
          <line x1={70 + (R - 9) * Math.cos(markerAngle)} y1={70 + (R - 9) * Math.sin(markerAngle)} x2={70 + (R + 9) * Math.cos(markerAngle)} y2={70 + (R + 9) * Math.sin(markerAngle)} stroke="#e2e8f0" strokeWidth="2" />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
        <span className={`text-3xl font-semibold tabular-nums ${value == null ? "text-slate-600" : "text-white"}`}>{display}</span>
        {sub ? <span className="text-[11px] text-slate-400">{sub}</span> : null}
      </div>
    </div>
  );
}

export type BridgeStep = { key: string; label: string; amount: number; kind: "start" | "less" | "sub" | "end"; tag?: string };

/** Revenue to net as a horizontal bridge: each cost sits where the running total stood. */
export function LinearBridge({ steps, money }: { steps: BridgeStep[]; money: (v: number) => string }) {
  let level = 0;
  const bars = steps.map((st) => {
    let from: number;
    let to: number;
    if (st.kind === "less") { from = level; to = level - st.amount; level = to; }
    else { from = 0; to = st.amount; level = st.amount; }
    return { ...st, from, to };
  });
  const hi = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const span = hi - lo || 1;
  return (
    <ol className="m-0 list-none p-0">
      {bars.map((b) => {
        const left = ((Math.min(b.from, b.to) - lo) / span) * 100;
        const width = Math.max(0.6, (Math.abs(b.to - b.from) / span) * 100);
        const total = b.kind !== "less";
        const color = b.kind === "less" || b.to < 0 ? "#f87171" : b.kind === "end" ? "#5eead4" : "#34d399";
        return (
          <li key={b.key} className={`grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_7.5rem] items-center gap-4 py-2 ${b.kind === "sub" || b.kind === "end" ? "border-0 border-t border-solid border-[#284540]" : ""}`}>
            <span className={`truncate text-xs ${total ? "font-semibold text-slate-100" : "text-slate-400"}`} title={b.label}>
              {b.kind === "less" ? <span className="text-slate-500">Less </span> : null}{b.kind === "less" ? b.label.toLowerCase() : b.label}
              {b.tag ? <span className="ml-1 text-[10px] font-semibold text-amber-300">{b.tag}</span> : null}
            </span>
            <span className="relative block h-1.5 bg-[#13241f]">
              {lo < 0 ? <span className="absolute inset-y-[-3px] w-px bg-slate-500/50" style={{ left: `${((0 - lo) / span) * 100}%` }} aria-hidden /> : null}
              <span className="absolute inset-y-0" style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: total ? 1 : 0.75 }} />
            </span>
            <span className={`whitespace-nowrap text-right text-xs tabular-nums ${b.kind === "less" ? "text-rose-300" : b.to < 0 ? "font-semibold text-rose-300" : total ? "font-semibold text-white" : "text-slate-300"}`}>
              {b.kind === "less" ? (b.amount ? `- ${money(b.amount)}` : money(0)) : money(b.amount)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type DualPoint = { key: string; label: string; a: number; b: number };

/**
 * Two series on one scale (e.g. revenue against costs), with hover details
 * and an optional selected point. Clicking a point calls onPick.
 */
export function DualLineChart({ points, aLabel, bLabel, money, selected, onPick, height = 220 }: { points: DualPoint[] | null; aLabel: string; bLabel: string; money: (v: number) => string; selected?: string; onPick?: (key: string) => void; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = height;
  const PAD_T = 18;
  const PAD_B = 8;
  if (!points) return <div className="w-full animate-pulse rounded-md bg-white/[0.03]" style={{ height }} />;
  if (!points.length) {
    return <div className="grid w-full place-items-center border border-dashed border-[#284540] text-xs text-slate-500" style={{ height }}>Nothing to chart yet.</div>;
  }
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => Math.max(p.a, p.b)));
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B);
  const lineA = smoothPath(points.map((p, i) => [x(i), y(p.a)]));
  const lineB = smoothPath(points.map((p, i) => [x(i), y(p.b)]));
  const areaA = `${lineA} L${x(n - 1)},${H} L${x(0)},${H} Z`;
  const sel = selected ? points.findIndex((p) => p.key === selected) : -1;
  const hp = hover != null ? points[hover] : null;
  const indexAt = (clientX: number, rect: DOMRect) => Math.max(0, Math.min(n - 1, Math.round(((clientX - rect.left) / rect.width) * (n - 1))));

  return (
    <div>
      <div
        className={`relative w-full ${onPick ? "cursor-pointer" : ""}`}
        style={{ height }}
        onMouseMove={(e) => setHover(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { if (onPick) onPick(points[indexAt(e.clientX, e.currentTarget.getBoundingClientRect())].key); }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`${aLabel} against ${bLabel}`}>
          <defs>
            <linearGradient id="dual-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={PAD_T + f * (H - PAD_T - PAD_B)} y2={PAD_T + f * (H - PAD_T - PAD_B)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />)}
          {sel >= 0 ? <rect x={x(sel) - (n > 1 ? W / (n - 1) / 2 : 40)} y={0} width={n > 1 ? W / (n - 1) : 80} height={H} fill="rgba(255,255,255,0.035)" /> : null}
          <path d={areaA} fill="url(#dual-fill)" />
          <path d={lineB} fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={lineA} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hp ? <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={H} stroke="rgba(226,232,240,0.25)" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {(hover != null ? [hover] : sel >= 0 ? [sel] : []).map((i) => (
          <span key={`dots-${i}`}>
            <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-[#182c28] bg-emerald-300" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(points[i].a) / H) * 100}%` }} />
            <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-[#182c28] bg-rose-400" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(points[i].b) / H) * 100}%` }} />
          </span>
        ))}
        {hp ? (
          <div className="pointer-events-none absolute top-0 z-10 w-52 -translate-x-1/2 rounded-md border border-solid border-[#2f524b] bg-[#0f1f1b] px-3.5 py-2.5 shadow-lg" style={{ left: `clamp(6.5rem, ${(x(hover!) / W) * 100}%, calc(100% - 6.5rem))` }}>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8fb5ad]">{hp.label}</p>
            <p className="m-0 mt-1 flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">{aLabel}</span><b className="tabular-nums text-emerald-300">{money(hp.a)}</b></p>
            <p className="m-0 mt-0.5 flex items-center justify-between gap-2 text-xs"><span className="text-slate-400">{bLabel}</span><b className="tabular-nums text-rose-300">{money(hp.b)}</b></p>
            <p className="m-0 mt-1 border-0 border-t border-solid border-[#284540] pt-1 text-[11px] text-slate-400">{hp.b > 0 ? `${Math.round((hp.a / hp.b) * 100)}% covered` : hp.a > 0 ? "No costs" : "No activity"}</p>
          </div>
        ) : null}
      </div>
      <div className="relative mt-2 h-4 text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500">
        {points.map((p, i) => (
          <span key={p.key} className={`absolute whitespace-nowrap ${i === sel ? "font-bold text-slate-200" : ""}`} style={{ left: `${(x(i) / W) * 100}%`, transform: n === 1 ? "translateX(-50%)" : i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}

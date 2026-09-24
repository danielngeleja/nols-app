"use client";

import { useEffect, useState } from "react";

/**
 * A connected route across the hero: the most-visited NoLScope places (by the
 * popularity score the API sorts on) joined by one glowing line that draws
 * itself, with a light travelling the route. Stops show their typical nights.
 */

type Stop = { code: string; name: string; nights: number | null };

const W = 400;
const H = 70;

export default function NolScopeHeroRoute() {
  const [stops, setStops] = useState<Stop[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/nolscope/destinations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const list: Stop[] = (d?.destinations ?? [])
          .slice(0, 4) // the API already orders by popularity
          .map((r: any) => ({
            code: r.destinationCode ?? r.code,
            name: String(r.displayName ?? r.destinationName ?? r.name ?? "")
              .replace(/\s+(National Park|Conservation Area|Archipelago)$/i, "")
              .replace(/^Mount\s+/i, ""),
            nights: r.avgStayDays ?? null,
          }));
        setStops(list);
      })
      .catch(() => alive && setStops([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!stops || stops.length < 2) return <div className="mt-8 h-[92px]" aria-hidden />;

  // Stops spread evenly, alternating slightly up and down, joined by smooth curves
  const pad = 24;
  const pts = stops.map((_, i) => ({ x: pad + (i * (W - pad * 2)) / (stops.length - 1), y: i % 2 === 0 ? 26 : 44 }));
  const d = pts
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
    })
    .join(" ");
  const totalNights = stops.reduce((s, x) => s + (x.nights || 0), 0);

  return (
    <div className="mt-8 w-full max-w-[520px]" aria-label={`Most visited: ${stops.map((s) => s.name).join(", ")}`}>
      <style>{`
        @keyframes nsDraw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
        @keyframes nsPop { from { transform: translate(-50%, -50%) scale(0); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
        .ns-draw { stroke-dasharray: 1; animation: nsDraw 1.6s cubic-bezier(.4,0,.2,1) .2s both; }
        .ns-pop { animation: nsPop .45s cubic-bezier(.2,.8,.2,1.4) both; }
        @media (prefers-reduced-motion: reduce) { .ns-draw, .ns-pop { animation: none; } .ns-travel { display: none; } }
      `}</style>
      <div className="flex items-baseline justify-between gap-3">
        <p className="m-0 text-[12px] font-semibold text-emerald-200/90">Where travellers go most</p>
        {totalNights ? <p className="m-0 text-[11.5px] text-white/45">{totalNights} nights, typical pace</p> : null}
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-[70px] w-full overflow-visible" preserveAspectRatio="none">
          <defs>
            <linearGradient id="nsRouteGrad" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#6ee7b7" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#5eead4" stopOpacity="0.35" />
            </linearGradient>
            <filter id="nsGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* faint track, then the glowing line drawing itself over it */}
          <path d={d} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          <path d={d} pathLength={1} className="ns-draw" fill="none" stroke="url(#nsRouteGrad)" strokeWidth="2.2" strokeLinecap="round" filter="url(#nsGlow)" vectorEffect="non-scaling-stroke" />
          {/* a light travelling the route */}
          <circle className="ns-travel" r="2.6" fill="#d1fae5" filter="url(#nsGlow)">
            <animateMotion dur="5.5s" begin="1.6s" repeatCount="indefinite" path={d} />
          </circle>
        </svg>
        {/* Stops and labels in HTML so they stay round and crisp while the line stretches */}
        {pts.map((p, i) => (
          <span
            key={`dot-${stops[i].code}`}
            aria-hidden
            className="ns-pop absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-emerald-300/15"
            style={{ left: `${(p.x / W) * 100}%`, top: `${p.y}px`, animationDelay: `${0.25 + i * 0.35}s` }}
          >
            <span className="h-2 w-2 rounded-full border-2 border-solid border-emerald-300 bg-[#024d47] shadow-[0_0_8px_rgba(110,231,183,0.8)]" />
          </span>
        ))}
        {pts.map((p, i) => (
          <span
            key={stops[i].code}
            className="absolute -translate-x-1/2 whitespace-nowrap text-center leading-tight"
            style={{ left: `${(p.x / W) * 100}%`, top: `${p.y + 12}px` }}
          >
            <span className="block text-[11.5px] font-semibold text-white/85">{stops[i].name}</span>
            {stops[i].nights ? <span className="block text-[10px] text-white/45">{stops[i].nights} nights</span> : null}
          </span>
        ))}
      </div>
      <div className="h-6" aria-hidden />
    </div>
  );
}

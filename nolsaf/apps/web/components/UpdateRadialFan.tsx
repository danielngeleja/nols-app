"use client";

/**
 * UpdateRadialFan — radial spoke diagram for updates.
 *
 * Renders a half-disc fan on the left (arc segments, center disc)
 * with connector lines radiating to text items on the right,
 * exactly like the editorial infographic style.
 *
 * Usage:
 *   <UpdateRadialFan items={updates} />                  // navigates to /updates on click
 *   <UpdateRadialFan items={updates} onSelect={fn} />    // calls fn(item) on click
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface RadialItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

// ── SVG math helpers ──────────────────────────────────────────────────────────
const rad = (d: number) => (d * Math.PI) / 180;
const px = (cx: number, r: number, d: number) => cx + r * Math.cos(rad(d));
const py = (cy: number, r: number, d: number) => cy + r * Math.sin(rad(d));

/**
 * Builds a donut‑segment SVG path from a1° to a2° (both clockwise from east).
 * Uses the "M inner-start → L outer-start → arc CW outer → L inner-end → arc CCW inner → Z" pattern.
 * Works correctly for segments < 180°.
 */
function buildArcPath(
  cx: number, cy: number,
  ri: number, ro: number,
  a1: number, a2: number
): string {
  const sox = px(cx, ro, a1), soy = py(cy, ro, a1); // outer start
  const eox = px(cx, ro, a2), eoy = py(cy, ro, a2); // outer end
  const six = px(cx, ri, a1), siy = py(cy, ri, a1); // inner start
  const eix = px(cx, ri, a2), eiy = py(cy, ri, a2); // inner end
  // Large-arc flag is safe as 0 because each segment is ≤ 180° with GAP applied
  return [
    `M ${six.toFixed(2)} ${siy.toFixed(2)}`,
    `L ${sox.toFixed(2)} ${soy.toFixed(2)}`,
    `A ${ro} ${ro} 0 0 1 ${eox.toFixed(2)} ${eoy.toFixed(2)}`,
    `L ${eix.toFixed(2)} ${eiy.toFixed(2)}`,
    `A ${ri} ${ri} 0 0 0 ${six.toFixed(2)} ${siy.toFixed(2)}`,
    "Z",
  ].join(" ");
}

// ── Layout constants ──────────────────────────────────────────────────────────

/** SVG canvas dimensions */
const W = 530;
const H = 490;

/** Circle center — placed at the left edge so the fan opens rightward */
const CX = 68;
const CY = H / 2; // 245

/** Fan radii */
const RI = 50; // inner radius
const RO = 152; // outer radius

/** Angular gap between adjacent segments (degrees) */
const GAP = 3;

/** X position of the connector dot (end of each spoke line) */
const CONN_X = 262;

/** X position where text labels begin */
const TEXT_X = 272;

/** Segment colour palette: darkest → lightest (newest → oldest) */
const COLORS = ["#013d39", "#02665e", "#037d74", "#05ada2", "#9dd3d0"];

// ── Date formatter ────────────────────────────────────────────────────────────
function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  items: RadialItem[];
  /** Hard cap — default 5. Fan always divides into exactly this many equal slices. */
  maxItems?: number;
  /** If provided, clicking a text item calls this instead of navigating to /updates */
  onSelect?: (item: RadialItem) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function UpdateRadialFan({ items, maxItems = 5, onSelect }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(W);

  // Narrow screens scale the canvas down; wide screens stretch the text column instead
  // of leaving empty space to the right of the fan.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(1, available / W);
  const canvasW = Math.max(W, Math.round(available));

  const display = items.slice(0, maxItems);
  const N = display.length;
  if (N === 0) return null;

  /** Angular span of each segment */
  const SEG = 180 / N;

  /** Height allocated to each text item */
  const ITEM_SLOT = H / N;
  const BLOCK_H = Math.min(ITEM_SLOT - 12, 104);

  return (
    // Outer wrapper measures available width; inner canvas scales proportionally
    <div
      ref={wrapperRef}
      aria-label="Latest updates"
      style={{ width: "100%", height: Math.round(H * scale) }}
    >
    <div
      style={{ position: "relative", width: canvasW, height: H, transformOrigin: "top left", transform: `scale(${scale})` }}
    >
      {/* ── SVG layer: fan + lines ── */}
      <svg
        viewBox={`0 0 ${canvasW} ${H}`}
        width={canvasW}
        height={H}
        style={{ position: "absolute", inset: 0, overflow: "hidden" }}
        aria-hidden="true"
      >
        {/* Subtle outer guide ring — right semicircle only (left half is off-canvas) */}
        <path
          d={`M ${CX} ${(CY - (RO + 8)).toFixed(2)} A ${RO + 8} ${RO + 8} 0 0 1 ${CX} ${(CY + (RO + 8)).toFixed(2)}`}
          fill="none"
          stroke="#dde9e8"
          strokeWidth={1.5}
        />

        {/* Arc segments */}
        {display.map((_, i) => {
          const a1 = -90 + i * SEG + GAP / 2;
          const a2 = -90 + (i + 1) * SEG - GAP / 2;
          return (
            <path
              key={i}
              d={buildArcPath(CX, CY, RI, RO, a1, a2)}
              fill={COLORS[i % COLORS.length]}
              opacity={hovered !== null && hovered !== i ? 0.45 : 1}
              style={{ transition: "opacity 0.2s ease", pointerEvents: "auto", cursor: "pointer" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}

        {/* Hairline separators between rows in the text column */}
        {display.slice(1).map((_, i) => {
          const y = (H * (i + 1)) / N;
          return (
            <line
              key={`sep-${i}`}
              x1={TEXT_X + 12}
              y1={y}
              x2={canvasW - 8}
              y2={y}
              stroke="#e6efee"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          );
        })}

        {/* Segment index labels */}
        {display.map((_, i) => {
          const midDeg = -90 + (i + 0.5) * SEG;
          const mr = (RI + RO) / 2;
          return (
            <text
              key={i}
              x={px(CX, mr, midDeg)}
              y={py(CY, mr, midDeg)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="rgba(255,255,255,0.9)"
              fontSize={12}
              fontWeight="800"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              letterSpacing="0.06em"
              style={{ pointerEvents: "none" }}
            >
              {String(i + 1).padStart(2, "0")}
            </text>
          );
        })}

        {/* Center disc: white ring → brand fill → "N" label */}
        <circle cx={CX} cy={CY} r={RI - 1} fill="white" />
        <circle cx={CX} cy={CY} r={RI - 8} fill="#02665e" />
        <circle cx={CX} cy={CY} r={RI - 14} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        {/* Brand mark in place of a plain letter; filter renders the logo white */}
        <image
          href="/assets/NoLS2025-04.png"
          x={CX - 15}
          y={CY - 15}
          width={30}
          height={30}
          preserveAspectRatio="xMidYMid meet"
          style={{ filter: "brightness(0) invert(1)" }}
        />

        {/* Connector spoke lines + endpoint dots */}
        {display.map((_, i) => {
          const midDeg = -90 + (i + 0.5) * SEG;
          // line starts just beyond the outer arc edge
          const lx1 = px(CX, RO + 10, midDeg);
          const ly1 = py(CY, RO + 10, midDeg);
          // line ends at the connector dot
          const ly2 = H * (i + 0.5) / N;
          const isHov = hovered === i;
          return (
            <g key={i}>
              <line
                x1={lx1.toFixed(2)} y1={ly1.toFixed(2)}
                x2={CONN_X} y2={ly2.toFixed(2)}
                stroke={isHov ? "#02665e" : "#c0d4d2"}
                strokeWidth={isHov ? 1.5 : 1}
                style={{ transition: "stroke 0.2s, stroke-width 0.2s" }}
              />
              <circle
                cx={CONN_X}
                cy={ly2.toFixed(2)}
                r={isHov ? 5 : 3.5}
                fill="white"
                stroke={isHov ? "#02665e" : "#7ab5b1"}
                strokeWidth={1.5}
                style={{ transition: "r 0.2s, stroke 0.2s" }}
              />
            </g>
          );
        })}
      </svg>

      {/* ── Text items (HTML positioned over SVG) ── */}
      {display.map((item, i) => {
        const centerY = H * (i + 0.5) / N;
        const topY = Math.round(centerY - BLOCK_H / 2);
        const isHov = hovered === i;

        const accent = COLORS[i % COLORS.length];
        const inner = (
          <div
            style={{
              boxSizing: "border-box",
              height: BLOCK_H,
              display: "flex",
              alignItems: "center",
              gap: 16,
              paddingLeft: 14,
              paddingRight: 14,
              borderLeft: `3px solid ${isHov ? "#02665e" : "transparent"}`,
              background: isHov ? "rgba(2,102,94,0.05)" : "transparent",
              borderRadius: "0 8px 8px 0",
              transition: "border-color 0.18s ease, background 0.18s ease",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              {/* Meta line: segment colour key, date and the New tag on one row */}
              <p
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11.5,
                  color: "#64748b",
                  margin: 0,
                  marginBottom: 5,
                  lineHeight: 1,
                  fontFamily: "inherit",
                }}
              >
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: accent, flexShrink: 0 }} />
                {fmt(item.createdAt)}
                {i === 0 && (
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "#e6f4f2",
                      color: "#02665e",
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      lineHeight: 1.2,
                    }}
                  >
                    New
                  </span>
                )}
              </p>
              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  color: isHov ? "#02665e" : "#0f172a",
                  margin: 0,
                  marginBottom: 4,
                  lineHeight: 1.3,
                  transition: "color 0.18s ease",
                  display: "-webkit-box",
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  fontFamily: "inherit",
                }}
              >
                {item.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  margin: 0,
                  maxWidth: 680,
                  lineHeight: 1.5,
                  display: "-webkit-box",
                  WebkitLineClamp: BLOCK_H >= 90 ? 2 : 1,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  fontFamily: "inherit",
                }}
              >
                {item.content}
              </p>
            </div>

            {/* Read cue: fills with brand colour on hover */}
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 8,
                border: `1px solid ${isHov ? "#02665e" : "#dbe7e5"}`,
                background: isHov ? "#02665e" : "#ffffff",
                color: isHov ? "#ffffff" : "#02665e",
                fontSize: 16,
                fontWeight: 700,
                transform: isHov ? "translateX(2px)" : "none",
                transition: "all 0.18s ease",
              }}
            >
              &rarr;
            </span>
          </div>
        );

        const posStyle: React.CSSProperties = {
          position: "absolute",
          left: TEXT_X,
          top: topY,
          width: canvasW - TEXT_X - 8,
          display: "block",
          cursor: "pointer",
          textDecoration: "none",
          background: "none",
          border: "none",
          padding: 0,
          textAlign: "left",
        };

        return onSelect ? (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={posStyle}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-1"
          >
            {inner}
          </button>
        ) : (
          <Link
            key={item.id}
            href="/updates"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={posStyle}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-1"
          >
            {inner}
          </Link>
        );
      })}
    </div>
    </div>
  );
}

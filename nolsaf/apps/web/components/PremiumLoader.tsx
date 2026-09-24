"use client";

import React, { useId } from "react";

export type PremiumLoaderSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizeMap: Record<PremiumLoaderSize, { px: number; stroke: number; font: string; subFont: string }> = {
  xs: { px: 20, stroke: 3, font: "text-[10px]", subFont: "text-[9px]" },
  sm: { px: 24, stroke: 3, font: "text-xs", subFont: "text-[10px]" },
  md: { px: 44, stroke: 4, font: "text-xs", subFont: "text-xs" },
  lg: { px: 56, stroke: 5, font: "text-sm", subFont: "text-xs" },
  xl: { px: 72, stroke: 6, font: "text-lg", subFont: "text-sm" },
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export default function PremiumLoader({
  size = "md",
  progress,
  showPercent,
  label = "Loading...",
  className = "",
  ariaLabel,
}: {
  size?: PremiumLoaderSize;
  progress?: number;
  showPercent?: boolean;
  label?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  const meta = sizeMap[size];

  const isDeterminate = typeof progress === "number" && Number.isFinite(progress);
  const p = isDeterminate ? clamp01(progress / 100) : 0;

  const radius = (meta.px - meta.stroke) / 2;
  const cx = meta.px / 2;
  const cy = meta.px / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - p);

  const percentText = isDeterminate ? `${Math.round(progress!)}%` : "";
  const shouldShowPercent = (showPercent ?? meta.px >= 44) && isDeterminate;
  const shouldShowLabel = meta.px >= 44;

  return (
    <span
      role="status"
      aria-label={ariaLabel || label}
      aria-live="polite"
      className={`inline-flex flex-col items-center justify-center gap-2 ${className}`.trim()}
    >
      <span className="relative inline-flex items-center justify-center">
        <svg
          width={meta.px}
          height={meta.px}
          viewBox={`0 0 ${meta.px} ${meta.px}`}
          className={isDeterminate ? "" : "animate-spin"}
          aria-hidden
        >
          <defs>
            {/* Use existing theme palette tokens (info + brand + success). */}
            <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#022099" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#02665e" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.95" />
            </linearGradient>
          </defs>

          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            className="stroke-neutral-200"
            strokeWidth={meta.stroke}
          />

          {/* Progress / spinner arc */}
          <circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={`url(#${id}-grad)`}
            strokeWidth={meta.stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={isDeterminate ? dashOffset : circumference * 0.75}
            style={{
              transformOrigin: "50% 50%",
              transform: "rotate(-90deg)",
              transition: isDeterminate ? "stroke-dashoffset 220ms ease" : undefined,
            }}
          />
        </svg>

        {shouldShowPercent ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className={`font-bold tabular-nums tracking-tight text-neutral-900 ${meta.font}`}>{percentText}</span>
          </span>
        ) : null}
      </span>

      {shouldShowLabel ? (
        <span aria-hidden className={`font-semibold text-neutral-400 ${meta.subFont}`}>{label}</span>
      ) : null}

      <span className="sr-only">{label}</span>
    </span>
  );
}

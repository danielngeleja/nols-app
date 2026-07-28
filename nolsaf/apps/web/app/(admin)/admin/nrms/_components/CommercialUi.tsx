"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function SummaryCard({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: "emerald" | "slate" | "amber" | "blue" }) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
  } as const;
  return (
    <div className="flex min-w-0 items-center gap-3.5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_10px_30px_-28px_rgba(15,23,42,0.45)] sm:p-5">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
        <p className="m-0 mt-1 truncate text-lg font-black tracking-tight text-neutral-950">{value}</p>
        <p className="mb-0 mt-0.5 truncate text-[11px] text-neutral-400">{detail}</p>
      </div>
    </div>
  );
}

const SECTION_HEADER_TONES = {
  emerald: { border: "border-emerald-100", bg: "bg-[linear-gradient(135deg,#ffffff_0%,#f0faf6_100%)]", icon: "border-emerald-100 bg-white text-emerald-700", circle: "border-emerald-600/[0.06]" },
  red: { border: "border-red-100", bg: "bg-[linear-gradient(135deg,#ffffff_0%,#fef2f2_100%)]", icon: "border-red-100 bg-white text-red-600", circle: "border-red-600/[0.06]" },
} as const;

export function SectionHeader({ icon: Icon, title, subtitle, right, tone = "emerald" }: { icon: LucideIcon; title: string; subtitle: string; right?: ReactNode; tone?: keyof typeof SECTION_HEADER_TONES }) {
  const t = SECTION_HEADER_TONES[tone];
  return (
    <div className={`relative overflow-hidden border-b ${t.border} ${t.bg} px-4 py-4 sm:px-5`}>
      <div className={`pointer-events-none absolute -right-8 -top-12 h-28 w-28 rounded-full border ${t.circle}`} aria-hidden="true" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm ${t.icon}`}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-bold text-neutral-900">{title}</h2>
            <p className="mb-0 mt-0.5 truncate text-[11px] text-neutral-400">{subtitle}</p>
          </div>
        </div>
        {right}
      </div>
    </div>
  );
}

export function CountPill({ count, singular, plural }: { count: number; singular: string; plural: string }) {
  return <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">{count} {count === 1 ? singular : plural}</span>;
}

export function EmptyState({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center px-5 py-7 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 text-neutral-300"><Icon className="h-5 w-5" /></span>
      <p className="m-0 mt-3 text-sm font-bold text-neutral-700">{title}</p>
      <p className="mb-0 mt-1 max-w-xs text-xs leading-5 text-neutral-400">{text}</p>
    </div>
  );
}

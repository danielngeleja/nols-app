"use client";

// Building blocks for the stock control workspace, on the house tokens
// (brand, shadow-card). Preflight is off in this app, so every border states
// border-solid and every button states its own background.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export const cardClass = "rounded-2xl border border-solid border-neutral-200 bg-white shadow-card";
export const fieldClass = "[font-family:inherit] mt-1.5 box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10";
export const smallFieldClass = "[font-family:inherit] box-border h-9 min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-brand";
export const labelClass = "block text-xs font-bold uppercase tracking-[0.12em] text-neutral-500";
export const primaryButton = "[font-family:inherit] inline-flex h-9 items-center justify-center gap-2 rounded-lg border-0 bg-brand px-3.5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400";
export const outlineButton = "[font-family:inherit] inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-solid border-brand/50 bg-white px-3.5 text-sm font-bold text-brand transition hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-50";
/** Brand-coloured checkbox (the forms plugin paints `text-*` as the checked fill). */
export const checkboxClass = "h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[5px] border-2 border-solid border-neutral-400 bg-white text-brand shadow-sm transition hover:border-brand focus:ring-2 focus:ring-brand/25 focus:ring-offset-0 checked:border-brand";
/** Radio in the same style as checkboxClass. */
export const radioClass = "h-[18px] w-[18px] shrink-0 cursor-pointer rounded-full border-2 border-solid border-neutral-400 bg-white text-brand transition hover:border-brand focus:ring-2 focus:ring-brand/25 focus:ring-offset-0 checked:border-brand";
export const quietButton = "[font-family:inherit] inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-neutral-300 bg-white px-2.5 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50";

export function IconTile({ icon: Icon, tone = "brand", size = "md" }: { icon: LucideIcon; tone?: "brand" | "amber" | "red" | "sky" | "neutral"; size?: "sm" | "md" }) {
  const toneClass = {
    brand: "bg-brand/10 text-brand",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    sky: "bg-sky-50 text-sky-700",
    neutral: "bg-neutral-100 text-neutral-600",
  }[tone];
  const sizeClass = size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl";
  return <span className={`flex shrink-0 items-center justify-center ${sizeClass} ${toneClass}`}><Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} /></span>;
}

export function SectionCard({ icon, title, subtitle, action, children, tone, bodyClass = "p-4 sm:p-5" }: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  tone?: "brand" | "amber" | "red" | "sky" | "neutral";
  bodyClass?: string;
}) {
  return (
    <section className={cardClass}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <IconTile icon={icon} tone={tone} size="sm" />
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[15px] font-bold text-neutral-950">{title}</h2>
            {subtitle && <p className="m-0 mt-0.5 truncate text-[13px] text-neutral-500">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Pill({ tone, children }: { tone: "ok" | "low" | "out" | "negative" | "muted" | "info"; children: ReactNode }) {
  const toneClass = {
    ok: "bg-emerald-50 text-emerald-700",
    low: "bg-amber-50 text-amber-800",
    out: "bg-red-50 text-red-700",
    negative: "bg-red-100 text-red-800",
    muted: "bg-neutral-100 text-neutral-600",
    info: "bg-sky-50 text-sky-700",
  }[tone];
  const dot = { ok: "bg-emerald-500", low: "bg-amber-500", out: "bg-red-500", negative: "bg-red-600", muted: "bg-neutral-400", info: "bg-sky-500" }[tone];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${toneClass}`}><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{children}</span>;
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Icon className="h-6 w-6" /></span>
      <p className="mb-0 mt-3 text-sm font-bold text-neutral-900">{title}</p>
      <p className="mx-auto mb-0 mt-1 max-w-md text-xs leading-relaxed text-neutral-500">{body}</p>
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

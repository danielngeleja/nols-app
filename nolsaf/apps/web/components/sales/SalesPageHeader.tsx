"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export default function SalesPageHeader({
  eyebrow = "Sales workspace",
  title,
  description,
  icon: Icon,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  icon: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border border-emerald-100/80 bg-gradient-to-r from-white via-white to-emerald-50/80 px-5 py-5 shadow-[0_16px_45px_-40px_rgba(3,73,61,0.55)] sm:px-6">
      <div className="pointer-events-none absolute -right-8 -top-16 h-40 w-40 rounded-full bg-emerald-100/45 blur-2xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#087f68] text-white shadow-[0_12px_28px_-18px_rgba(8,127,104,0.9)]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">
              {eyebrow}
            </p>
            <h1 className="mb-0 mt-1 text-[clamp(1.35rem,2vw,1.8rem)] font-black leading-tight tracking-[-0.025em] text-slate-950">
              {title}
            </h1>
            <p className="mb-0 mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">
              {description}
            </p>
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}


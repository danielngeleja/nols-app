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
    <header className="rounded-lg border border-solid border-slate-200 bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold text-[#02665e]">{eyebrow}</p>
            <h1 className="m-0 mt-0.5 text-xl font-bold leading-tight tracking-tight text-slate-900">{title}</h1>
            <p className="mb-0 mt-1 max-w-3xl text-[13px] leading-5 text-slate-600">{description}</p>
          </div>
        </div>
        {actions ? <div className="w-full min-w-0 max-w-full sm:w-auto">{actions}</div> : null}
      </div>
    </header>
  );
}

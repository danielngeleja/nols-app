"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, FileText, TrendingUp } from "lucide-react";

const REPORTS = [
  {
    href: "/admin/management/reports",
    label: "Overview",
    description: "Management pulse",
    icon: BarChart3,
    exact: true,
  },
  {
    href: "/admin/management/reports/revenue",
    label: "Revenue",
    description: "Finance and commission",
    icon: TrendingUp,
  },
  {
    href: "/admin/management/reports/bookings",
    label: "Bookings",
    description: "Operational activity",
    icon: CalendarDays,
  },
] as const;

export default function NoLSAFReportsFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen w-full min-w-0 max-w-full overflow-x-clip bg-neutral-50/70">
      <main className="mx-auto box-border w-[calc(100%-1rem)] min-w-0 max-w-7xl space-y-4 py-5 sm:w-[calc(100%-1.5rem)] lg:w-[calc(100%-2rem)]">
        <header className="box-border flex w-full min-w-0 max-w-full flex-wrap items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-4 shadow-sm sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#073c35] text-white">
              <FileText className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NoLSAF reports</p>
              <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">Management reporting centre</h1>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Company finance, booking activity, commission, and management controls.</p>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>

        <nav className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm" aria-label="NoLSAF report views">
          <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            {REPORTS.map((report) => {
              const active = "exact" in report && report.exact ? pathname === report.href : pathname.startsWith(report.href);
              const Icon = report.icon;
              return (
                <Link
                  key={report.href}
                  href={report.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-11 w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 no-underline transition ${
                    active
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950 shadow-sm"
                      : "border-transparent bg-white text-neutral-600 hover:border-neutral-200 hover:bg-neutral-50 hover:text-neutral-950"
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold">{report.label}</span>
                    <span className="block text-[9px] text-neutral-400">{report.description}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        {children}
      </main>
    </div>
  );
}

const TITLE_ICONS = {
  overview: BarChart3,
  revenue: TrendingUp,
  bookings: CalendarDays,
} as const;

type ReportTitleIcon = keyof typeof TITLE_ICONS;

export function NoLSAFReportTitle({ icon, eyebrow, title, text, actions }: { icon: ReportTitleIcon; eyebrow: string; title: string; text: string; actions?: ReactNode }) {
  const Icon = TITLE_ICONS[icon];

  return (
    <header className="box-border flex w-full min-w-0 max-w-full flex-wrap items-start justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white"><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0">
          <p className="m-0 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-700">{eyebrow}</p>
          <h2 className="mb-0 mt-0.5 text-base font-bold text-neutral-950">{title}</h2>
          <p className="mb-0 mt-0.5 text-[11px] leading-4 text-neutral-500">{text}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function NoLSAFReportPanel({ title, description, children, className = "" }: { title: string; description: string; children: ReactNode; className?: string }) {
  return (
    <section className={`box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm ${className}`}>
      <header className="border-b border-neutral-100 px-4 py-3">
        <h3 className="m-0 text-sm font-bold text-neutral-950">{title}</h3>
        <p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">{description}</p>
      </header>
      <div className="min-w-0 p-3 sm:p-4">{children}</div>
    </section>
  );
}

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

  // The admin layout owns the gutter and the sizing model, so this frame only
  // stacks its sections and fills the width it is given.
  return (
    <div className="box-border w-full min-w-0 max-w-full">
      <div className="box-border w-full min-w-0 max-w-full space-y-4">
        {/* One header: identity, page actions and the report switcher together */}
        <div className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#073c35] text-white">
                <FileText className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="m-0 text-[17px] font-bold leading-5 tracking-tight text-neutral-950">Management reporting centre</h1>
                <p className="m-0 mt-0.5 text-[13px] leading-4 text-neutral-500">Company finance, booking activity, commission and management controls.</p>
              </div>
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </header>

          <nav className="border-0 border-t border-solid border-neutral-100 px-2 sm:px-3" aria-label="NoLSAF report views">
            <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
              {REPORTS.map((report) => {
                const active = "exact" in report && report.exact ? pathname === report.href : pathname.startsWith(report.href);
                const Icon = report.icon;
                return (
                  <Link
                    key={report.href}
                    href={report.href}
                    aria-current={active ? "page" : undefined}
                    title={report.description}
                    className={`relative flex h-11 flex-none items-center gap-2 px-3 text-[14px] font-semibold no-underline transition-colors ${
                      active ? "text-[#073c35]" : "text-neutral-500 hover:text-neutral-900"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {report.label}
                    {active ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[#073c35]" /> : null}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {children}
      </div>
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

  // A section heading, not a card: the frame above already carries the page identity
  return (
    <header className="box-border flex w-full min-w-0 max-w-full flex-wrap items-end justify-between gap-3 px-1 pt-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#073c35]/10 text-[#073c35]">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-[16px] font-bold leading-5 text-neutral-950">{title}</h2>
          <p className="m-0 text-[13px] leading-4 text-neutral-500">
            <span className="sr-only">{eyebrow}. </span>
            {text}
          </p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function NoLSAFReportPanel({ title, description, children, className = "" }: { title: string; description: string; children: ReactNode; className?: string }) {
  return (
    <section className={`box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm ${className}`}>
      <header className="border-0 border-b border-solid border-neutral-100 px-4 py-3">
        <h3 className="m-0 text-[15px] font-bold leading-5 text-neutral-950">{title}</h3>
        <p className="mb-0 mt-0.5 text-[12.5px] leading-4 text-neutral-500">{description}</p>
      </header>
      <div className="min-w-0 p-3 sm:p-4">{children}</div>
    </section>
  );
}

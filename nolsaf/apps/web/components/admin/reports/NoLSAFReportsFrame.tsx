"use client";

import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, FileText, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const REPORTS = [
  {
    href: "/admin/management/reports",
    label: "Overview",
    description: "Live management pulse",
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

/**
 * Report workspace shell, in the admin NRMS language: a dark brand band that
 * carries the page identity, the page actions and the report switcher as
 * workspace chips. Everything below it stays on plain white cards.
 */
export default function NoLSAFReportsFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const pathname = usePathname();

  // The admin layout owns the gutter and the sizing model, so this frame only
  // stacks its sections and fills the width it is given.
  return (
    <div className="box-border w-full min-w-0 max-w-full">
      <div className="box-border w-full min-w-0 max-w-full space-y-4">
        <section className="relative box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 shadow-sm sm:p-5">
          <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full border border-solid border-white/[0.06]" aria-hidden />
          <div className="pointer-events-none absolute -right-2 -top-8 h-32 w-32 rounded-full border border-solid border-white/[0.05]" aria-hidden />

          <div className="relative flex min-w-0 flex-col gap-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm">
                  <FileText className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Management reporting</p>
                    <span className="inline-flex rounded-full border border-solid border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white">Read-only</span>
                  </div>
                  <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Management reporting centre</h1>
                  <p className="mb-0 mt-1 text-xs leading-5 text-white/65 sm:text-sm">Company finance, booking activity, commission and management controls.</p>
                </div>
              </div>

              {/* Page actions read as light buttons on the dark band; the last one is the primary action. */}
              {actions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2 [&>button:last-child]:!border-white [&>button:last-child]:!bg-white [&>button:last-child]:!text-[#073c35] [&>button:last-child:hover]:!bg-emerald-50 [&>button]:!border-solid [&>button]:!border-white/25 [&>button]:!bg-white/10 [&>button]:!text-white [&>button]:!shadow-none [&>button:hover]:!bg-white/20">
                  {actions}
                </div>
              ) : null}
            </div>

            <nav aria-label="NoLSAF report views" className="grid min-w-0 grid-cols-1 gap-2 border-0 border-t border-solid border-white/15 pt-4 sm:grid-cols-3">
              {REPORTS.map((report) => {
                const active = "exact" in report && report.exact ? pathname === report.href : pathname.startsWith(report.href);
                return <ReportChip key={report.href} href={report.href} label={report.label} description={report.description} icon={report.icon} active={active} />;
              })}
            </nav>
          </div>
        </section>

        {children}
      </div>
    </div>
  );
}

function ReportChip({ href, label, description, icon: Icon, active }: { href: string; label: string; description: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`box-border flex min-w-0 items-center gap-3 rounded-xl border border-solid px-3 py-2.5 no-underline shadow-sm transition ${
        active ? "border-white bg-white" : "border-white/15 bg-white/[0.07] hover:border-white/30 hover:bg-white/[0.12]"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white" : "bg-white/10 text-emerald-200"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-[13px] font-bold ${active ? "text-[#073c35]" : "text-white"}`}>{label}</span>
        <span className={`block truncate text-[11px] ${active ? "text-neutral-500" : "text-white/55"}`}>{description}</span>
      </span>
    </Link>
  );
}

const TITLE_ICONS = {
  overview: BarChart3,
  revenue: TrendingUp,
  bookings: CalendarDays,
} as const;

type ReportTitleIcon = keyof typeof TITLE_ICONS;

/** Section heading for the active report: eyebrow, title and one line of scope. */
export function NoLSAFReportTitle({ icon, eyebrow, title, text, actions }: { icon: ReportTitleIcon; eyebrow: string; title: string; text: string; actions?: ReactNode }) {
  const Icon = TITLE_ICONS[icon];

  return (
    <header className="box-border flex w-full min-w-0 max-w-full flex-wrap items-center justify-between gap-3 px-1 pt-1">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">{eyebrow}</p>
          <h2 className="m-0 mt-0.5 text-[17px] font-bold leading-5 tracking-tight text-neutral-950">{title}</h2>
          <p className="m-0 mt-0.5 text-[12.5px] leading-4 text-neutral-500">{text}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Icons arrive either as a component (from client code) or as a ready element,
 * because a server page cannot pass a component function into client code.
 */
type HeaderIcon = LucideIcon | ReactElement;

function renderIcon(icon: HeaderIcon) {
  if (isValidElement(icon)) return icon;
  const Icon = icon as LucideIcon;
  return <Icon className="h-4 w-4" aria-hidden />;
}

/** NRMS-style card header: bordered icon tile, title, subtitle and an optional right slot. */
export function NoLSAFCardHeader({ icon, title, subtitle, right }: { icon: HeaderIcon; title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm [&>svg]:h-4 [&>svg]:w-4">
          {renderIcon(icon)}
        </span>
        <div className="min-w-0">
          <h3 className="m-0 truncate text-sm font-bold text-neutral-900">{title}</h3>
          <p className="mb-0 mt-0.5 text-[11.5px] leading-4 text-neutral-400">{subtitle}</p>
        </div>
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function NoLSAFReportPanel({
  title,
  description,
  children,
  className = "",
  icon = FileText,
  right,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  icon?: HeaderIcon;
  right?: ReactNode;
}) {
  return (
    <section className={`box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ${className}`}>
      <NoLSAFCardHeader icon={icon} title={title} subtitle={description} right={right} />
      <div className="min-w-0 p-3 sm:p-4">{children}</div>
    </section>
  );
}

const STATUS_TONES: Array<[RegExp, string]> = [
  [/^(CONFIRMED|PAID|COMPLETED|CHECKED_OUT|SETTLED|APPROVED|ACTIVE|SUCCESS|DISBURSED)/, "border-emerald-100 bg-emerald-50 text-emerald-700"],
  [/^(ACCEPTED|CHECKED_IN|IN_PROGRESS|PROCESSING|BOOKED|CLAIMED|VERIFIED)/, "border-sky-100 bg-sky-50 text-sky-700"],
  [/^(PENDING|NEW|AWAITING|DRAFT|REQUESTED|UNPAID|PARTIAL)/, "border-amber-100 bg-amber-50 text-amber-700"],
  [/^(CANCEL|REJECT|FAILED|DECLINED|EXPIRED|NO_SHOW|REFUND)/, "border-red-100 bg-red-50 text-red-700"],
];

/** Status pill in the NRMS register colours, keyed off the status word. */
export function NoLSAFStatusBadge({ status }: { status?: string | null }) {
  const raw = String(status || "").trim();
  if (!raw) return <NoLSAFMuted />;
  const key = raw.toUpperCase();
  const tone = STATUS_TONES.find(([pattern]) => pattern.test(key))?.[1] ?? "border-neutral-200 bg-neutral-100 text-neutral-600";
  return <span className={`inline-flex whitespace-nowrap rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${tone}`}>{raw.replaceAll("_", " ")}</span>;
}

/** Quiet placeholder for a value that was never recorded. */
export function NoLSAFMuted({ text = "Not set" }: { text?: string }) {
  return <span className="text-[11px] text-neutral-300">{text}</span>;
}

/** Two-line cell: a strong first line and a quiet second line. */
export function NoLSAFStack({ top, bottom, strong = true }: { top: ReactNode; bottom?: ReactNode; strong?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className={`block truncate ${strong ? "font-bold text-neutral-900" : "text-neutral-700"}`}>{top}</span>
      {bottom ? <span className="mt-0.5 block truncate text-[10.5px] text-neutral-400">{bottom}</span> : null}
    </span>
  );
}

export type NoLSAFRegisterColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Column width, e.g. "14rem". */
  width?: string;
};

/**
 * NRMS register: card header with a count pill, then a table with a soft
 * header row, zebra rows, an emerald hover and a sticky first column.
 */
export function NoLSAFRegister<T>({
  icon,
  title,
  subtitle,
  rows,
  rowKey,
  columns,
  noun,
  emptyTitle,
  emptyText,
  loading,
}: {
  icon: HeaderIcon;
  title: string;
  subtitle: string;
  rows: T[];
  rowKey: (row: T) => string | number;
  columns: Array<NoLSAFRegisterColumn<T>>;
  noun: [singular: string, plural: string];
  emptyTitle: string;
  emptyText: string;
  loading?: boolean;
}) {
  const count = rows.length;
  return (
    <section className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
      <NoLSAFCardHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        right={
          <span className="rounded-full border border-solid border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">
            {count} {count === 1 ? noun[0] : noun[1]}
          </span>
        }
      />
      <div className="w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]" role="region" aria-label={title} tabIndex={0}>
        <table className="w-full min-w-[56rem] table-fixed border-collapse text-left">
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
          <thead className="bg-neutral-50/90">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`whitespace-nowrap border-0 border-b border-solid border-neutral-200 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.06em] text-neutral-500 ${
                    column.align === "right" ? "text-right" : ""
                  } ${index === 0 ? "sticky left-0 z-10 bg-neutral-50 shadow-[1px_0_0_0_rgb(229,229,229)] sm:px-5" : ""} ${index === columns.length - 1 ? "sm:pr-5" : ""}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const zebra = rowIndex % 2 === 1;
              return (
                <tr key={rowKey(row)} className={`group text-xs transition ${zebra ? "bg-neutral-50/55" : "bg-white"} hover:bg-emerald-50/70`}>
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={`border-0 border-b border-solid border-neutral-100 px-4 py-3 align-middle text-neutral-600 ${column.align === "right" ? "text-right tabular-nums" : ""} ${
                        index === 0
                          ? `sticky left-0 z-[5] shadow-[1px_0_0_0_rgb(245,245,245)] transition-colors group-hover:bg-emerald-50 sm:px-5 ${zebra ? "bg-[#fafafa]" : "bg-white"}`
                          : ""
                      } ${index === columns.length - 1 ? "sm:pr-5" : ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {count === 0 ? (
              <tr>
                <td colSpan={columns.length} className="border-0">
                  <div className="flex min-h-40 flex-col items-center justify-center px-5 py-7 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 text-neutral-300 [&>svg]:h-5 [&>svg]:w-5">
                      {renderIcon(icon)}
                    </span>
                    <p className="m-0 mt-3 text-sm font-bold text-neutral-700">{loading ? "Loading records" : emptyTitle}</p>
                    <p className="mb-0 mt-1 max-w-xs text-xs leading-5 text-neutral-400">{loading ? "Fetching this period from the server." : emptyText}</p>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** NRMS summary tile: gradient icon square, uppercase label, value and a quiet detail line. */
export function NoLSAFSummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "emerald" | "slate" | "amber" | "blue" | "violet";
}) {
  const tones = {
    emerald: "from-emerald-500 to-emerald-700",
    slate: "from-neutral-400 to-neutral-600",
    amber: "from-amber-400 to-amber-600",
    blue: "from-blue-500 to-blue-700",
    violet: "from-violet-500 to-violet-700",
  } as const;
  return (
    <div className="box-border flex min-w-0 items-center gap-3.5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-inset ring-neutral-200/70 transition hover:ring-neutral-300">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${tones[tone]}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="m-0 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
        <p className="m-0 mt-1 truncate text-lg font-black tabular-nums tracking-tight text-neutral-950">{value}</p>
        <p className="mb-0 mt-0.5 truncate text-[11px] text-neutral-400" title={detail}>{detail}</p>
      </div>
    </div>
  );
}

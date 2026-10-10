"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ClipboardList, HandHeart, Users } from "lucide-react";

/**
 * Shared frame for the three Group stays pages, so they read as one area:
 * the same dark band, the three pages as tabs, and a row of figures.
 */

export const GS_TZ = "Africa/Dar_es_Salaam";

const PAGES = [
  { href: "/owner/group-stays", label: "Assigned to me", Icon: Users, exact: true },
  { href: "/owner/group-stays/claims", label: "Open to claim", Icon: HandHeart, exact: true },
  { href: "/owner/group-stays/claims/my-claims", label: "My claims", Icon: ClipboardList, exact: true },
];

/** "AWAITING_DEPOSIT" -> "Awaiting deposit". */
export function humanize(value: string | null | undefined): string {
  const text = String(value ?? "").trim().replace(/[_-]+/g, " ").toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** "dar-es-salaam" -> "Dar es Salaam". */
export function placeName(value: string | null | undefined): string {
  const small = new Set(["es", "of", "la", "na", "wa"]);
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => (index > 0 && small.has(word.toLowerCase()) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: GS_TZ, day: "numeric", month: "short", year: "numeric" });
}

export function nightsBetween(checkIn: string | null | undefined, checkOut: string | null | undefined): number | null {
  if (!checkIn || !checkOut) return null;
  const n = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000);
  return n > 0 ? n : null;
}

export function tzs(amount: number | null | undefined, currency = "TZS"): string {
  return `${currency === "TZS" ? "TSh" : currency} ${Math.round(Number(amount) || 0).toLocaleString("en-US")}`;
}

/** Calendar tile for the arrival day. */
export function DateTile({ iso, tone = "bg-[#012a26] text-[#5eead4]" }: { iso: string | null | undefined; tone?: string }) {
  if (!iso) {
    return <span className="grid h-14 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-[10px] font-semibold text-slate-400">No date</span>;
  }
  const d = new Date(iso);
  return (
    <span className="flex w-12 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center ring-1 ring-slate-200">
      <span className={`py-0.5 text-[9px] font-bold tracking-[0.14em] ${tone}`}>{d.toLocaleDateString("en-GB", { timeZone: GS_TZ, month: "short" }).toUpperCase()}</span>
      <span className="pt-0.5 text-lg font-bold leading-none tabular-nums text-slate-900">{d.toLocaleDateString("en-GB", { timeZone: GS_TZ, day: "2-digit" })}</span>
      <span className="pb-1 text-[9px] font-semibold text-slate-400">{d.toLocaleDateString("en-GB", { timeZone: GS_TZ, weekday: "short" })}</span>
    </span>
  );
}

export function GroupStaysBand({
  title,
  subtitle,
  stats,
  actions,
}: {
  title: string;
  subtitle: string;
  stats?: Array<{ label: string; value: ReactNode; hint?: string; tone?: string }>;
  actions?: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  return (
    <header className="overflow-hidden rounded-3xl bg-[#012a26] text-white">
      <div className="px-5 pt-5 sm:px-8 sm:pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">Group stays</p>
            <h1 className="m-0 mt-1 text-[26px] font-bold leading-tight tracking-tight text-white sm:text-[30px]">{title}</h1>
            <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">{subtitle}</p>
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        <nav aria-label="Group stays pages" className="-mb-px mt-5 flex gap-1 overflow-x-auto">
          {PAGES.map((page) => {
            const active = pathname === page.href;
            return (
              <Link
                key={page.href}
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 items-center gap-2 whitespace-nowrap border-0 border-b-2 border-solid px-3 text-sm font-semibold no-underline transition ${active ? "border-[#5eead4] text-white" : "border-transparent text-white/55 hover:text-white"}`}
              >
                <page.Icon className="h-4 w-4" aria-hidden />
                {page.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {stats && stats.length > 0 && (
        <dl className={`m-0 grid gap-px border-0 border-t border-solid border-white/10 bg-white/10 ${stats.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
          {stats.map((stat) => (
            <div key={stat.label} className="bg-[#012a26] px-5 py-3.5 sm:px-8">
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/45">{stat.label}</dt>
              <dd className={`m-0 mt-1 text-2xl font-extrabold tabular-nums ${stat.tone ?? "text-white"}`}>{stat.value}</dd>
              {stat.hint ? <p className="m-0 hidden truncate text-[11px] text-white/45 sm:block">{stat.hint}</p> : null}
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

/** Underline status tabs under the band. */
export function StatusTabs({ tabs, value, onChange }: { tabs: Array<{ key: string; label: string; count: number }>; value: string; onChange: (key: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-200" role="tablist">
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key || "all"}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold transition ${active ? "border-[#02665e] text-[#02665e]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {tab.label}
            <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

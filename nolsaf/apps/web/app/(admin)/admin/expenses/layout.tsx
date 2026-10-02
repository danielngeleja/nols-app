"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, CalendarCheck2, ChevronsLeft, ChevronsRight, Handshake, KeyRound, LayoutDashboard, LogOut, Menu, SlidersHorizontal, TrendingUp, Users, X } from "lucide-react";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";

/**
 * Expenses workspace: NoLSAF's own operating costs, from the ledger to
 * payroll. A self-contained shell like Disbursements (see the pathname bypass
 * in (admin)/admin/layout.tsx) with its own sidebar and an exit back to the
 * admin panel. Everything inside sits behind the finance verification grant.
 */

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean; badge?: "people" | "run" };
const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Workspace",
    items: [
      { href: "/admin/expenses", label: "Overview", icon: LayoutDashboard, exact: true },
      { href: "/admin/expenses/ledger", label: "Ledger", icon: BookOpenText },
    ],
  },
  {
    title: "Payroll",
    items: [
      { href: "/admin/expenses/payroll/employees", label: "Employees", icon: Users, badge: "people" },
      { href: "/admin/expenses/payroll/runs", label: "Pay runs and payslips", icon: CalendarCheck2, badge: "run" },
    ],
  },
  {
    title: "Commissioned",
    items: [{ href: "/admin/expenses/payroll/partners", label: "Sales partners", icon: Handshake }],
  },
  { title: "Setup", items: [{ href: "/admin/expenses/settings", label: "Rates and settings", icon: SlidersHorizontal }] },
];
const ALL_ITEMS = NAV.flatMap((g) => g.items);

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

type Pulse = { locked: boolean; costs: number | null; people: number | null; runStatus: string | null; covered: number | null; overdue: number; month: string; daysLeft: number };

/** Figures for the sidebar's month card. Never prompts for the grant itself. */
function useMonthPulse(pathname: string): Pulse {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const month = today.slice(0, 7);
  const [y, m, d] = today.split("-").map(Number);
  const daysLeft = new Date(Date.UTC(y, m, 0)).getUTCDate() - d;
  const [pulse, setPulse] = useState<Omit<Pulse, "month" | "daysLeft">>({ locked: false, costs: null, people: null, runStatus: null, covered: null, overdue: 0 });

  const load = useCallback(async () => {
    const get = async (url: string) => {
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (res.status === 403) throw new Error("locked");
      return res.ok ? res.json() : null;
    };
    try {
      const [expenses, people, runs, coverage, statutory] = await Promise.all([
        get(`/api/admin/finance/expenses?from=${month}-01&to=${today}&pageSize=1`),
        get("/api/admin/finance/payroll/employees?status=ACTIVE"),
        get("/api/admin/finance/payroll/runs"),
        get(`/api/admin/finance/payroll/coverage?month=${month}`).catch(() => null),
        get("/api/admin/finance/payroll/remittances/open").catch(() => null),
      ]);
      const costs = (expenses?.totals ?? []).filter((t: any) => t.currency === "TZS").reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      const counts = people?.counts ?? {};
      const run = (runs?.items ?? []).find((r: any) => r.periodMonth === month && r.status !== "CANCELLED");
      const covered = coverage?.months?.[0]?.coveragePercent;
      setPulse({ locked: false, costs, people: (counts.ACTIVE ?? 0) + (counts.ON_LEAVE ?? 0), runStatus: run?.status ?? null, covered: typeof covered === "number" ? covered : null, overdue: Number(statutory?.overdue) || 0 });
    } catch {
      setPulse({ locked: true, costs: null, people: null, runStatus: null, covered: null, overdue: 0 });
    }
  }, [month, today]);

  useEffect(() => { void load(); }, [load, pathname]);
  useEffect(() => {
    window.addEventListener("finance-grant-granted", load);
    return () => window.removeEventListener("finance-grant-granted", load);
  }, [load]);

  return { ...pulse, month, daysLeft };
}

const RUN_LABEL: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Approved", tone: "bg-sky-100 text-sky-800" },
  PAID: { label: "Paid", tone: "bg-emerald-100 text-emerald-800" },
};
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : Math.round(n).toLocaleString("en-US"));

export default function ExpensesWorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pulse = useMonthPulse(pathname);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("expenses-sidebar-collapsed") === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("expenses-sidebar-collapsed", next ? "1" : "0"); } catch { /* storage blocked */ }
      return next;
    });
  };

  const title = [...ALL_ITEMS].reverse().find((item) => isActive(pathname, item))?.label ?? "Expenses";
  const monthName = new Date(`${pulse.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const unlock = () => window.dispatchEvent(new CustomEvent("finance-grant-required"));

  const badgeFor = (item: NavItem) => {
    if (pulse.locked) return null;
    if (item.badge === "people" && pulse.people != null) return <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-neutral-600">{pulse.people}</span>;
    if (item.badge === "run") {
      if (pulse.overdue > 0) return <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800" title="Statutory payments past their due date">{pulse.overdue} overdue</span>;
      const run = pulse.runStatus ? RUN_LABEL[pulse.runStatus] : null;
      return run ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${run.tone}`}>{run.label}</span> : <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-500">To do</span>;
    }
    return null;
  };

  const sidebar = (
    <aside className={`flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-[0_18px_40px_-28px_rgba(11,36,32,0.45)] transition-[width] duration-200 ${collapsed ? "w-[4.75rem]" : "w-[17.5rem]"}`}>
      {/* Brand */}
      <div className={`flex items-center pb-3 pt-4 ${collapsed ? "flex-col gap-2 px-2" : "gap-3 px-4"}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority />
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[15px] font-bold tracking-tight text-neutral-900">Expenses</p>
            <p className="m-0 text-[11px] text-neutral-400">Running costs and payroll</p>
          </div>
        )}
        <button type="button" onClick={toggleCollapsed} className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 lg:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* This month */}
      {!collapsed && (
        <div className="mx-3 mb-2 overflow-hidden rounded-2xl bg-[#0b2420] text-white">
          <div className="relative px-3.5 py-3">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.3)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
            <div className="relative flex items-center justify-between">
              <p className="m-0 text-[11px] font-semibold text-emerald-200/80">{monthName}</p>
              <p className="m-0 text-[10px] text-white/50">{pulse.daysLeft === 0 ? "Last day" : `${pulse.daysLeft} days left`}</p>
            </div>
            {pulse.locked ? (
              <button type="button" onClick={unlock} className="relative mt-2 inline-flex items-center gap-1.5 rounded-lg border-0 bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15">
                <KeyRound className="h-3.5 w-3.5" /> Unlock to see figures
              </button>
            ) : (
              <>
                <p className="relative m-0 mt-1.5 text-xl font-bold tabular-nums">{pulse.costs == null ? "..." : `TZS ${compact(pulse.costs)}`}</p>
                <p className="relative m-0 text-[10px] text-white/50">recorded costs so far</p>
                <div className="relative mt-2.5 rounded-xl bg-white/[0.07] px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/70">Revenue covers</span>
                    <span className={`text-[11px] font-bold tabular-nums ${pulse.covered == null ? "text-white/60" : pulse.covered >= 100 ? "text-emerald-300" : pulse.covered >= 70 ? "text-amber-300" : "text-rose-300"}`}>{pulse.covered == null ? "..." : `${Math.round(pulse.covered)}%`}</span>
                  </div>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10"><span className={`block h-full rounded-full ${pulse.covered != null && pulse.covered >= 100 ? "bg-emerald-300" : pulse.covered != null && pulse.covered >= 70 ? "bg-amber-300" : "bg-rose-400"}`} style={{ width: `${Math.min(100, pulse.covered ?? 0)}%` }} /></span>
                </div>
                <div className="relative mt-1.5 flex items-center justify-between rounded-xl bg-white/[0.07] px-2.5 py-1.5">
                  <span className="text-[11px] text-white/70">Payroll</span>
                  <span className="text-[11px] font-semibold">{pulse.runStatus ? RUN_LABEL[pulse.runStatus]?.label ?? pulse.runStatus : "Not started"}</span>
                </div>
              </>
            )}
            <span className="relative mt-2.5 block h-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-emerald-300" style={{ width: `${Math.max(4, 100 - (pulse.daysLeft / 31) * 100)}%` }} />
            </span>
          </div>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-label="Expenses workspace navigation">
        {NAV.map((group) => (
          <div key={group.title} className="mb-4 last:mb-0">
            {!collapsed ? <p className="m-0 mb-1 px-2.5 text-[11px] font-semibold text-neutral-400">{group.title}</p> : <span className="mx-auto mb-2 block h-px w-6 bg-neutral-200" aria-hidden />}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-10 items-center rounded-xl text-[13px] font-semibold no-underline transition hover:no-underline ${collapsed ? "justify-center px-2" : "gap-3 px-2.5"} ${active ? "bg-[#0b2420] text-white shadow-sm" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"}`}
                  >
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-emerald-300" : "text-neutral-400"}`} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && !active ? badgeFor(item) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-1.5 border-0 border-t border-solid border-neutral-100 p-3">
        <Link href="/admin/finance" title={collapsed ? "Margin on All Revenue" : undefined} className={`flex min-h-10 items-center rounded-xl text-[12px] font-semibold text-neutral-600 no-underline hover:bg-neutral-100 hover:text-neutral-900 hover:no-underline ${collapsed ? "justify-center" : "gap-3 px-2.5"}`}>
          <TrendingUp className="h-4 w-4 shrink-0 text-neutral-400" />{!collapsed && "Margin on All Revenue"}
        </Link>
        <Link href="/admin/home" title={collapsed ? "Exit to Admin" : undefined} className={`flex min-h-10 items-center rounded-xl border border-solid border-neutral-200 text-[12px] font-semibold text-neutral-700 no-underline hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline ${collapsed ? "justify-center" : "gap-3 px-2.5"}`}>
          <LogOut className="h-4 w-4 shrink-0 text-neutral-500" />{!collapsed && "Exit to Admin"}
        </Link>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen min-h-[36rem] min-w-0 overflow-hidden bg-[#f4f6f5]">
      <FinanceGrantPanel showTrigger={false} listenForRequired />

      <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button type="button" aria-label="Close expenses navigation" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[18rem] p-3">
            {sidebar}
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl border-0 bg-neutral-100 text-neutral-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mx-3 mt-3 shrink-0 rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex min-h-[3.75rem] items-center gap-3 px-3 sm:px-4">
            <button type="button" onClick={() => setMobileOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-neutral-200 bg-white text-neutral-700 lg:hidden" aria-label="Open expenses navigation">
              <Menu className="h-5 w-5" />
            </button>
            <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-neutral-500">
              Expenses <span className="text-neutral-300">/</span> <span className="text-neutral-900">{title}</span>
            </p>
            <button type="button" onClick={unlock} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-solid border-emerald-200 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
              <KeyRound className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Unlock finance</span>
              <span className="sm:hidden">Unlock</span>
            </button>
            <Link href="/admin/home" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-solid border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline">
              <LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}

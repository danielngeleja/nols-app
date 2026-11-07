"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsLeft, ChevronsRight, FileText, HeartPulse, KeyRound, LogOut, Menu, ShieldCheck, Trophy, Users, Wallet, X,
} from "lucide-react";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";

/**
 * Sales workspace: partners, teams and their money, as one self-contained
 * workspace like Disbursements and Expenses (see the pathname bypass in
 * (admin)/admin/layout.tsx), with its own sidebar and an exit back to admin.
 * Every API call underneath is still admin-only and audited.
 */

type Badge = "invites" | "review" | "risk" | "holds";
type NavItem = { href: string; label: string; icon: typeof Users; exact?: boolean; badge?: Badge };
const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Partners",
    items: [
      { href: "/admin/sales/partners", label: "Sales partners", icon: Users, badge: "invites" },
      { href: "/admin/sales", label: "Conversion review", icon: ShieldCheck, exact: true },
    ],
  },
  {
    title: "Teams",
    items: [
      { href: "/admin/sales/teams", label: "Team health", icon: HeartPulse, badge: "risk" },
      { href: "/admin/sales/leaderboard", label: "Leaderboard", icon: Trophy },
    ],
  },
  { title: "Money", items: [{ href: "/admin/sales/finance", label: "Finance", icon: Wallet, badge: "review" }] },
  { title: "Resources", items: [{ href: "/admin/sales/materials", label: "Learning materials", icon: FileText }] },
];
const ALL_ITEMS = NAV.flatMap((g) => g.items);

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

type Pulse = { invites: number | null; review: number | null; holds: number | null; atRisk: number | null; strong: number | null };

/** The month card and the menu badges. Each figure fails quietly on its own. */
function usePulse(pathname: string): Pulse {
  const [pulse, setPulse] = useState<Pulse>({ invites: null, review: null, holds: null, atRisk: null, strong: null });
  const load = useCallback(async () => {
    const get = async (url: string) => {
      try {
        const res = await fetch(url, { credentials: "include", cache: "no-store" });
        return res.ok ? res.json() : null;
      } catch {
        return null;
      }
    };
    const [invites, review, holds, health] = await Promise.all([
      get("/api/admin/sales/team-invites?status=ACCEPTED"),
      get("/api/admin/sales/payouts?status=UNDER_REVIEW&pageSize=1"),
      get("/api/admin/sales/payout-holds"),
      get("/api/admin/sales/team-health"),
    ]);
    setPulse({
      invites: invites ? (invites.invites ?? []).length : null,
      review: review ? Number(review.total ?? 0) : null,
      holds: holds ? (holds.partners ?? []).length : null,
      atRisk: health ? Number(health.counts?.AT_RISK ?? 0) : null,
      strong: health ? Number(health.counts?.STRONG ?? 0) : null,
    });
  }, []);
  useEffect(() => { void load(); }, [load, pathname]);
  return pulse;
}

export default function SalesWorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pulse = usePulse(pathname);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("admin-sales-sidebar-collapsed") === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("admin-sales-sidebar-collapsed", next ? "1" : "0"); } catch { /* storage blocked */ }
      return next;
    });
  };

  const title = [...ALL_ITEMS].reverse().find((item) => isActive(pathname, item))?.label ?? "Sales";
  const unlock = () => window.dispatchEvent(new CustomEvent("finance-grant-required"));

  const badgeFor = (item: NavItem) => {
    const n = item.badge === "invites" ? pulse.invites : item.badge === "review" ? pulse.review : item.badge === "risk" ? pulse.atRisk : null;
    if (!n) return null;
    const tone = item.badge === "risk" ? "bg-rose-400 text-rose-950" : "bg-amber-400 text-emerald-950";
    return <span className={`grid min-w-[1.35rem] place-items-center rounded px-1.5 text-[11px] font-bold leading-5 ${tone}`}>{n}</span>;
  };

  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const stat = (label: string, value: number | null, tone: string, href: string) => (
    <Link href={href} className="flex items-center justify-between rounded-md bg-white/[0.06] px-2.5 py-1.5 text-white no-underline hover:bg-white/[0.1] hover:no-underline">
      <span className="text-[11px] text-white/70">{label}</span>
      <span className={`text-[12px] font-bold tabular-nums ${value ? tone : "text-white/50"}`}>{value == null ? "..." : value}</span>
    </Link>
  );

  const sidebar = (
    <aside className={`flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-solid border-[#12342f] bg-[#0b2420] text-white transition-[width] duration-200 ${collapsed ? "w-[4.25rem]" : "w-[16rem]"}`}>
      <div className={`flex min-h-[4rem] shrink-0 items-center border-0 border-b border-solid border-white/10 ${collapsed ? "flex-col justify-center gap-2 px-2 py-3" : "gap-3 px-3.5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-8 w-8 scale-[1.9] object-contain" priority />
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[14px] font-bold leading-tight">Sales</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-white/45">Partners, teams and payouts</p>
          </div>
        )}
        <button type="button" onClick={toggleCollapsed} className="hidden h-8 w-8 shrink-0 place-items-center rounded-md border-0 bg-transparent text-white/50 hover:bg-white/[0.06] hover:text-white lg:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="mx-2.5 mt-3 rounded-md border border-solid border-white/10 bg-white/[0.03] p-2.5">
          <p className="m-0 mb-2 text-[11px] font-semibold text-emerald-300/80">{monthName}</p>
          <div className="space-y-1">
            {stat("Team invites waiting", pulse.invites, "text-amber-300", "/admin/sales/partners")}
            {stat("Withdrawals to review", pulse.review, "text-amber-300", "/admin/sales/finance")}
            {stat("Partners paused", pulse.holds, "text-rose-300", "/admin/sales/finance")}
            {stat("Teams at risk", pulse.atRisk, "text-rose-300", "/admin/sales/teams")}
          </div>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Sales workspace navigation">
        {NAV.map((group, groupIndex) => (
          <div key={group.title} className="mb-3 last:mb-0">
            {!collapsed ? (
              <p className="m-0 mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{group.title}</p>
            ) : groupIndex > 0 ? (
              <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
            ) : null}
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
                    className={`group relative flex h-9 items-center rounded-md text-[13px] font-medium no-underline transition-colors hover:no-underline ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "bg-white/[0.09] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}
                  >
                    {active ? <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-emerald-400" aria-hidden /> : null}
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-300" : "text-white/55 group-hover:text-white/85"}`} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed ? badgeFor(item) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-0 border-t border-solid border-white/10 p-2">
        <Link href="/admin/home" title={collapsed ? "Exit to Admin" : undefined} className={`flex h-9 items-center rounded-md border border-solid border-white/10 bg-white/[0.04] text-[12px] font-semibold text-white/80 no-underline hover:bg-white/[0.08] hover:text-white hover:no-underline ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}>
          <LogOut className="h-4 w-4 shrink-0" />{!collapsed && "Exit to Admin"}
        </Link>
      </div>
    </aside>
  );

  return (
    <div id="admin-sales-workspace" className="admin-soft-ui flex h-screen min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100">
      <style>{`#admin-sales-workspace, #admin-sales-workspace * { box-sizing: border-box; }`}</style>
      <FinanceGrantPanel showTrigger={false} listenForRequired />

      <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button type="button" aria-label="Close sales navigation" className="absolute inset-0 border-0 bg-neutral-950/45" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[17rem] p-3">
            {sidebar}
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-6 top-6 grid h-8 w-8 place-items-center rounded-md border-0 bg-white/10 text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mx-3 mt-3 shrink-0 rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="flex min-h-[3.5rem] items-center gap-3 px-3 sm:px-4">
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-700 lg:hidden" aria-label="Open sales navigation">
              <Menu className="h-5 w-5" />
            </button>
            <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-neutral-500">
              Sales <span className="text-neutral-300">/</span> <span className="text-neutral-900">{title}</span>
            </p>
            <button type="button" onClick={unlock} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
              <KeyRound className="h-3.5 w-3.5" /><span className="hidden sm:inline">Unlock finance</span><span className="sm:hidden">Unlock</span>
            </button>
            <Link href="/admin/home" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline">
              <LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </header>

        <main className="admin-workspace min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}

"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ChevronsLeft, ChevronsRight, KeyRound, Layers, LayoutDashboard, LogOut, Menu, RotateCcw, ShieldAlert, Timer, X } from "lucide-react";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";
import apiClient from "@/lib/apiClient";

type Pulse = { approve: number | null; stuck: number | null; review: number | null; release: number | null };
type BadgeKey = keyof Pulse;
type NavItem = { href: string; label: string; hint: string; icon: typeof Layers; exact?: boolean; badge?: BadgeKey };

const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Pay out",
    items: [
      { href: "/admin/disbursements", label: "Queue", hint: "Every payout and where it stands", icon: LayoutDashboard, exact: true, badge: "approve" },
      { href: "/admin/disbursements/batches", label: "Batches", hint: "Group payouts and release them", icon: Layers, badge: "release" },
      { href: "/admin/disbursements/owner-payouts", label: "Owner payouts", hint: "Stays unlocking for owners", icon: Timer },
    ],
  },
  {
    title: "Check",
    items: [
      { href: "/admin/disbursements/security-review", label: "Security review", hint: "Payouts paused by safety checks", icon: ShieldAlert, badge: "review" },
      { href: "/admin/disbursements/recoveries", label: "Recoveries", hint: "Money being won back", icon: RotateCcw },
    ],
  },
  {
    title: "Report",
    items: [
      { href: "/admin/disbursements/reports", label: "Reports", hint: "Export for reconciliation", icon: BarChart3 },
    ],
  },
];
const NAV_ITEMS = NAV.flatMap((group) => group.items);

function isActive(pathname: string, item: { href: string; exact?: boolean }) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function currentTitle(pathname: string): string {
  const match = [...NAV_ITEMS].reverse().find((item) => isActive(pathname, item));
  return match?.label ?? "Queue";
}

/**
 * Disbursement Workspace: self-contained shell for the post-approval payout
 * pipeline. Same visual family as the Sales workspace (dark band, rounded-lg
 * frame, rounded-md rows, live counts), so admin workspaces read as one
 * product. Hides the standard admin chrome (pathname bypass in
 * (admin)/admin/layout.tsx).
 *
 * FinanceGrantPanel is mounted modal-only and opened from the header button
 * via the finance-grant-required event, never as a flex child.
 */
export default function DisbursementWorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pulse, setPulse] = useState<Pulse>({ approve: null, stuck: null, review: null, release: null });

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("disbursement-sidebar-collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  // What needs a person right now. Three light reads, refreshed every minute
  // and on every page change; a failed read shows "..." rather than a wrong 0.
  const loadPulse = useCallback(async () => {
    const [queue, review, drafts] = await Promise.allSettled([
      apiClient.get("/api/admin/disbursements", { params: { pageSize: 1 } }),
      apiClient.get("/api/admin/disbursements/security-review"),
      apiClient.get("/api/admin/disbursements/batches", { params: { status: "DRAFT" } }),
    ]);
    setPulse({
      approve: queue.status === "fulfilled" ? Number(queue.value.data?.stats?.adminToApprove ?? 0) : null,
      stuck: queue.status === "fulfilled" ? Number(queue.value.data?.stats?.stuck ?? 0) : null,
      review: review.status === "fulfilled" ? (review.value.data?.disbursements?.length ?? 0) : null,
      release: drafts.status === "fulfilled"
        ? (drafts.value.data?.batches ?? []).filter((batch: { mode?: string }) => batch.mode !== "AUTO").length
        : null,
    });
  }, []);
  useEffect(() => {
    void loadPulse();
    const timer = window.setInterval(() => void loadPulse(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadPulse, pathname]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("disbursement-sidebar-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const unlockFinance = () => window.dispatchEvent(new CustomEvent("finance-grant-required"));

  const badgeFor = (item: NavItem) => {
    const n = item.badge ? pulse[item.badge] : null;
    if (!n) return null;
    const tone = item.badge === "review" ? "bg-rose-400 text-rose-950" : "bg-amber-400 text-emerald-950";
    return <span className={`grid min-w-[1.35rem] place-items-center rounded px-1.5 text-[11px] font-bold leading-5 ${tone}`}>{n}</span>;
  };

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
            <p className="m-0 truncate text-[14px] font-bold leading-tight">Disbursement</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-white/45">Batch, release and reconcile</p>
          </div>
        )}
        <button type="button" onClick={toggleCollapsed} className="hidden h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-white/50 hover:bg-white/[0.06] hover:text-white lg:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="mx-2.5 mt-3 rounded-md border border-solid border-white/10 bg-white/[0.03] p-2.5">
          <p className="m-0 mb-2 text-[11px] font-semibold text-emerald-300/80">Needs a person</p>
          <div className="space-y-1">
            {stat("Waiting for approval", pulse.approve, "text-amber-300", "/admin/disbursements")}
            {stat("Batches to release", pulse.release, "text-amber-300", "/admin/disbursements/batches")}
            {stat("Stuck over 30 min", pulse.stuck, "text-amber-300", "/admin/disbursements")}
            {stat("Held for review", pulse.review, "text-rose-300", "/admin/disbursements/security-review")}
          </div>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Disbursement workspace navigation">
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
                const count = item.badge ? pulse[item.badge] : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? `${item.label}${count ? ` (${count})` : ""}: ${item.hint}` : item.hint}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-9 items-center rounded-md text-[13px] font-medium no-underline transition-colors hover:no-underline ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "bg-white/[0.09] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}
                  >
                    {active ? <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-emerald-400" aria-hidden /> : null}
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-300" : "text-white/55 group-hover:text-white/85"}`} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed ? badgeFor(item) : count ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden /> : null}
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
    <div id="admin-disbursement-workspace" className="flex h-screen min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100">
      <style>{`#admin-disbursement-workspace, #admin-disbursement-workspace * { box-sizing: border-box; }`}</style>
      {/* Modal-only mount: opened from the header button below, never rendered inline. */}
      <FinanceGrantPanel showTrigger={false} listenForRequired />

      <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button type="button" aria-label="Close disbursement navigation" className="absolute inset-0 border-0 bg-neutral-950/45" onClick={() => setMobileOpen(false)} />
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
            <button type="button" onClick={() => setMobileOpen(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-700 lg:hidden" aria-label="Open disbursement navigation">
              <Menu className="h-5 w-5" />
            </button>
            <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-neutral-500">
              Disbursement <span className="text-neutral-300">/</span> <span className="text-neutral-900">{currentTitle(pathname)}</span>
            </p>
            <button type="button" onClick={unlockFinance} className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
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

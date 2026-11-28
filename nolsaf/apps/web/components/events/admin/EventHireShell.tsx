"use client";

import { type ReactNode, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight, Building2, CalendarDays, ChevronsLeft, ChevronsRight, ClipboardCheck, FileText, Gauge, Handshake,
  KeyRound, LogOut, Menu, RefreshCw, Send, Wallet, X,
} from "lucide-react";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";
import { tsh } from "../eventHireTypes";
import { PulseContext, pulseCounts, refreshEventHire, usePulseLoader, askFinanceGrant, type Pulse } from "./eventAdmin";

/**
 * Event hire workspace: venues, date requests, bookings, deposits and
 * payouts as one self-contained workspace like Sales and Disbursements
 * (see the pathname bypass in (admin)/admin/layout.tsx), ordered the way an
 * event actually flows. Every API call underneath stays admin-only.
 */

type Badge = "venues" | "requests" | "payment";
type NavItem = { href: string; label: string; icon: typeof Gauge; purpose: string; badge?: Badge };
const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Today",
    items: [
      { href: "/admin/event-hire", label: "Command centre", icon: Gauge, purpose: "What needs a decision now, what is coming up and where the money stands." },
    ],
  },
  {
    title: "Pipeline",
    items: [
      { href: "/admin/event-hire/venues", label: "Venue approvals", icon: Building2, badge: "venues", purpose: "Check the space, the owner's consent and the venue rules before it goes on sale." },
      { href: "/admin/event-hire/requests", label: "Date requests", icon: Handshake, badge: "requests", purpose: "Client date requests: owner confirmation, partner assignment and independent callbacks." },
      { href: "/admin/event-hire/bookings", label: "Event bookings", icon: FileText, badge: "payment", purpose: "Paid events from checkout to completion, cancellations and damage claims." },
      { href: "/admin/event-hire/availability", label: "Event calendar", icon: CalendarDays, purpose: "Every venue's paid bookings, checkout holds and owner closures, month by month." },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/admin/event-hire/payments", label: "Collections & deposits", icon: Wallet, purpose: "What clients paid and the refundable deposit NoLSAF holds for each event." },
      { href: "/admin/event-hire/settlements", label: "Payouts & refunds", icon: Send, purpose: "Owner earnings, deposit refunds and damage awards: approve, then release through finance." },
      { href: "/admin/event-hire/reconciliation", label: "Revenue check", icon: ClipboardCheck, purpose: "Event revenue compared with the ledger. Deposits are liabilities, never revenue." },
    ],
  },
];
const ALL = NAV.flatMap(g => g.items);
const isActive = (path: string, item: NavItem) => item.href === "/admin/event-hire" ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);

function operatingState(p: Pulse): { text: string; tone: string } {
  if (!p.summary) return { text: p.loading ? "Checking status" : "Status unavailable", tone: "bg-neutral-300" };
  if (!p.summary.enabled) return { text: "Read only", tone: "bg-neutral-400" };
  if (!p.summary.paymentsEnabled) return { text: "Requests open, checkout off", tone: "bg-amber-400" };
  return { text: "Live: requests and checkout", tone: "bg-emerald-500" };
}

export default function EventHireShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/admin/event-hire";
  const pulse = usePulseLoader();
  const counts = pulseCounts(pulse);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("admin-event-hire-sidebar-collapsed") === "1"); } catch { /* storage blocked */ }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  // The printable payment confirmation stands alone, without workspace chrome.
  if (/^\/admin\/event-hire\/payments\/.+/.test(pathname)) {
    return <PulseContext.Provider value={pulse}><FinanceGrantPanel showTrigger={false} listenForRequired />{children}</PulseContext.Provider>;
  }

  const toggle = () => setCollapsed(c => {
    try { localStorage.setItem("admin-event-hire-sidebar-collapsed", c ? "0" : "1"); } catch { /* storage blocked */ }
    return !c;
  });
  const page = [...ALL].reverse().find(i => isActive(pathname, i)) ?? ALL[0];
  const state = operatingState(pulse);

  const badgeFor = (b?: Badge) => {
    const n = b === "venues" ? counts.venuesToReview : b === "requests" ? counts.requestActions : b === "payment" ? counts.paymentReview : null;
    if (!n) return null;
    return <span className="grid min-w-[1.35rem] place-items-center rounded bg-amber-400 px-1.5 text-[11px] font-bold leading-5 text-emerald-950">{n}</span>;
  };
  const stat = (text: string, value: string | number | null, href: string, warm = false) => (
    <Link href={href} className="flex items-center justify-between gap-2 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-white no-underline hover:bg-white/[0.1] hover:no-underline">
      <span className="truncate text-[11px] text-white/70">{text}</span>
      <span className={`shrink-0 text-[12px] font-bold tabular-nums ${warm && value ? "text-amber-300" : value ? "text-white" : "text-white/50"}`}>{value == null ? "..." : value}</span>
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
            <p className="m-0 truncate text-[14px] font-bold leading-tight">Event hire</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-white/45">Venues, bookings and payouts</p>
          </div>
        )}
        <button type="button" onClick={toggle} className="hidden h-8 w-8 shrink-0 place-items-center rounded-md border-0 bg-transparent text-white/50 hover:bg-white/[0.06] hover:text-white lg:grid" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="mx-2.5 mt-3 rounded-md border border-solid border-white/10 bg-white/[0.03] p-2.5">
          <p className="m-0 mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300/80"><span className={`h-1.5 w-1.5 rounded-full ${state.tone}`} aria-hidden />{state.text}</p>
          <div className="space-y-1">
            {stat("Venues to review", counts.venuesToReview, "/admin/event-hire/venues", true)}
            {stat("Requests needing you", counts.requestActions, "/admin/event-hire/requests", true)}
            {stat("Deposits held", pulse.summary ? tsh(pulse.summary.depositHeld) : null, "/admin/event-hire/payments")}
            {stat("Awaiting release", pulse.summary ? tsh(pulse.summary.settlementPending) : null, "/admin/event-hire/settlements")}
          </div>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Event hire navigation">
        {NAV.map((group, gi) => (
          <div key={group.title} className="mb-3 last:mb-0">
            {!collapsed ? (
              <p className="m-0 mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{group.title}</p>
            ) : gi > 0 ? <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden /> : null}
            <div className="space-y-0.5">
              {group.items.map(item => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                const badge = badgeFor(item.badge);
                return (
                  <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined}
                    className={`group relative flex h-9 items-center rounded-md text-[13px] font-medium no-underline transition-colors hover:no-underline ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "bg-white/[0.09] text-white" : "text-white/60 hover:bg-white/[0.05] hover:text-white"}`}>
                    {active ? <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-emerald-400" aria-hidden /> : null}
                    <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-300" : "text-white/55 group-hover:text-white/85"}`} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed ? badge : badge ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400" aria-hidden /> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-1.5 border-0 border-t border-solid border-white/10 p-2">
        <Link href="/admin/disbursements?source=EVENT_HIRE" title={collapsed ? "Disbursements" : undefined} className={`flex h-9 items-center rounded-md text-[12px] font-semibold text-white/70 no-underline hover:bg-white/[0.06] hover:text-white hover:no-underline ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}>
          <ArrowUpRight className="h-4 w-4 shrink-0" />{!collapsed && "Disbursements"}
        </Link>
        <Link href="/admin/home" title={collapsed ? "Exit to Admin" : undefined} className={`flex h-9 items-center rounded-md border border-solid border-white/10 bg-white/[0.04] text-[12px] font-semibold text-white/80 no-underline hover:bg-white/[0.08] hover:text-white hover:no-underline ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}>
          <LogOut className="h-4 w-4 shrink-0" />{!collapsed && "Exit to Admin"}
        </Link>
      </div>
    </aside>
  );

  return (
    <PulseContext.Provider value={pulse}>
      <div id="admin-event-hire-workspace" className="admin-soft-ui flex h-screen min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100">
        <style>{`#admin-event-hire-workspace, #admin-event-hire-workspace * { box-sizing: border-box; }`}</style>
        <FinanceGrantPanel showTrigger={false} listenForRequired />

        <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

        {mobileOpen && (
          <div className="fixed inset-0 z-[10000] lg:hidden">
            <button type="button" aria-label="Close event hire navigation" className="absolute inset-0 border-0 bg-neutral-950/45" onClick={() => setMobileOpen(false)} />
            <div className="relative h-full w-[17rem] p-3">
              {sidebar}
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-6 top-6 grid h-8 w-8 place-items-center rounded-md border-0 bg-white/10 text-white"><X className="h-4 w-4" /></button>
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="mx-3 mt-3 shrink-0 rounded-lg border border-solid border-neutral-200 bg-white">
            <div className="flex min-h-[3.5rem] items-center gap-2 px-3 sm:gap-3 sm:px-4">
              <button type="button" onClick={() => setMobileOpen(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-700 lg:hidden" aria-label="Open event hire navigation"><Menu className="h-5 w-5" /></button>
              <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-neutral-500">
                Event hire <span className="text-neutral-300">/</span> <span className="text-neutral-900">{page.label}</span>
              </p>
              <span className="hidden items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 md:inline-flex"><span className={`h-1.5 w-1.5 rounded-full ${state.tone}`} aria-hidden />{state.text}</span>
              <button type="button" onClick={refreshEventHire} disabled={pulse.loading} aria-label="Refresh event hire" title="Refresh" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${pulse.loading ? "animate-spin" : ""}`} />
              </button>
              <button type="button" onClick={askFinanceGrant} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100">
                <KeyRound className="h-3.5 w-3.5" /><span className="hidden sm:inline">Unlock finance</span>
              </button>
              <Link href="/admin/home" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline">
                <LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Exit</span>
              </Link>
            </div>
          </header>

          <main className="admin-workspace min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">
            <div className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h1 className="m-0 text-[18px] font-bold tracking-[-0.01em] text-neutral-900">{page.label}</h1>
                <p className="m-0 mt-0.5 max-w-3xl text-[12.5px] text-neutral-500">{page.purpose}</p>
              </div>
              <p className="m-0 text-[11px] text-neutral-400">East Africa Time · TZS</p>
            </div>
            {pulse.error && <p role="alert" className="m-0 mb-4 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{pulse.error}</p>}
            {children}
          </main>
        </div>
      </div>
    </PulseContext.Provider>
  );
}

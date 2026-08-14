"use client";

import { type ReactNode, Suspense, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BarChart3, ChevronLeft, ChevronRight, KeyRound, Layers, LayoutDashboard, LogOut, Menu, ShieldAlert, X } from "lucide-react";
import FinanceGrantPanel from "@/components/FinanceGrantPanel";

const NAV_ITEMS = [
  { href: "/admin/disbursements", label: "Queue", icon: LayoutDashboard, exact: true },
  { href: "/admin/disbursements/batches", label: "Batches", icon: Layers },
  { href: "/admin/disbursements/security-review", label: "Security Review", icon: ShieldAlert },
  { href: "/admin/disbursements/reports", label: "Reports", icon: BarChart3 },
];

// Status filter lives in the sidebar (not a dropdown on the page), driven by
// the ?status= URL param the Queue page reads. `dot` tones each status the
// same way the queue table badges do.
const STATUS_FILTERS: Array<{ value: string; label: string; dot: string }> = [
  { value: "", label: "All statuses", dot: "bg-emerald-200" },
  { value: "REQUESTED", label: "Requested", dot: "bg-amber-400" },
  { value: "APPROVED", label: "Approved", dot: "bg-sky-400" },
  { value: "BATCHED", label: "Batched", dot: "bg-sky-400" },
  { value: "AUTHORIZED", label: "Authorized", dot: "bg-sky-400" },
  { value: "SUBMITTED", label: "Submitted", dot: "bg-amber-400" },
  { value: "PROCESSING", label: "Processing", dot: "bg-amber-400" },
  { value: "PAID", label: "Paid", dot: "bg-emerald-400" },
  { value: "FAILED", label: "Failed", dot: "bg-red-400" },
  { value: "SECURITY_REVIEW", label: "Security review", dot: "bg-red-400" },
];

function isActive(pathname: string, item: { href: string; exact?: boolean }) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/**
 * Status filter rows for the Queue page, rendered inside the sidebar. Reads
 * the current ?status= param and links to the same page with the param set,
 * so the page and sidebar stay in sync. Wrapped in Suspense by the caller
 * because useSearchParams needs a boundary.
 */
function StatusFilterNav() {
  const searchParams = useSearchParams();
  const current = searchParams.get("status") ?? "";
  return (
    <div className="mt-3.5">
      <p className="mb-1.5 px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/45">Filter by status</p>
      <div className="space-y-0.5">
        {STATUS_FILTERS.map((filter) => {
          const active = current === filter.value;
          const href = filter.value ? `/admin/disbursements?status=${filter.value}` : "/admin/disbursements";
          return (
            <Link
              key={filter.value || "ALL"}
              href={href}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`group relative flex min-h-9 items-center gap-2.5 rounded-lg border px-2.5 text-[13px] font-semibold no-underline transition hover:no-underline ${active ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm" : "border-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}>
                <span className={`h-2 w-2 rounded-full ${filter.dot}`} />
              </span>
              <span className="flex-1 truncate">{filter.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function currentTitle(pathname: string): string {
  const match = [...NAV_ITEMS].reverse().find((item) => isActive(pathname, item));
  return match?.label ?? "Disbursements";
}

/**
 * Disbursement Workspace — self-contained operational shell for the
 * post-approval payout pipeline (batch, authorize, reconcile, security
 * review). Owns its own navigation and hides the standard admin chrome
 * (see the pathname bypass in (admin)/admin/layout.tsx), same pattern as
 * the owner-side NRMS Workspace at /owner/nrms.
 *
 * FinanceGrantPanel is mounted modal-only (showTrigger=false) and opened
 * from the header button via the finance-grant-required event — never as a
 * flex child, which would eat a full column of horizontal space and push
 * the content off-screen.
 */
export default function DisbursementWorkspaceLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("disbursement-sidebar-collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("disbursement-sidebar-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const unlockFinance = () => {
    window.dispatchEvent(new CustomEvent("finance-grant-required"));
  };

  const sidebar = (
    <aside className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-emerald-950/70 bg-[#082f2a] text-white shadow-[0_14px_34px_rgba(8,47,42,0.18)] transition-[width] duration-200 ${collapsed ? "w-[4.5rem]" : "w-[17rem]"}`}>
      <div className={`flex min-h-[5rem] items-center border-b border-white/10 ${collapsed ? "justify-center px-2" : "gap-3 px-4"}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-white shadow-sm">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority />
        </span>
        {!collapsed && (
          <>
            <span className="h-8 w-px shrink-0 bg-white/10" aria-hidden />
            <div className="min-w-0">
              <h1 className="m-0 truncate text-base font-bold tracking-[-0.01em]">Disbursement</h1>
              <p className="mb-0 mt-1 text-[10px] text-emerald-100/50">Batch, authorize &amp; reconcile</p>
            </div>
          </>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="Disbursement workspace navigation">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`group relative flex min-h-9 items-center rounded-lg border text-[13px] font-semibold no-underline transition hover:no-underline ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm" : "border-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>

        {/* Status filter for the Queue page only, replacing the old on-page dropdown. */}
        {!collapsed && pathname === "/admin/disbursements" && (
          <Suspense fallback={null}>
            <StatusFilterNav />
          </Suspense>
        )}
      </nav>

      <div className="border-t border-white/10 bg-black/5 p-2.5">
        <Link href="/admin/home" title={collapsed ? "Exit workspace" : undefined} className={`flex min-h-9 items-center rounded-lg border border-amber-200/10 bg-amber-100/[0.04] text-[12px] font-semibold text-amber-100 no-underline transition hover:border-amber-200/20 hover:bg-amber-300/10 hover:text-amber-50 hover:no-underline ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}>
          <LogOut className="h-3.5 w-3.5 shrink-0" />{!collapsed && "Exit to Admin"}
        </Link>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`mt-1.5 hidden min-h-8 w-full appearance-none items-center rounded-lg border border-white/[0.06] bg-white/[0.05] text-[11px] font-semibold text-emerald-100/60 hover:bg-white/10 hover:text-white lg:flex ${collapsed ? "justify-center" : "justify-between px-2.5"}`}
          aria-label={collapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar"}
        >
          {!collapsed && "Collapse sidebar"}{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100">
      {/* Modal-only mount — opened from the header button below, never rendered inline. */}
      <FinanceGrantPanel showTrigger={false} listenForRequired />

      <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button type="button" aria-label="Close disbursement navigation" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[17.5rem] p-3">
            {sidebar}
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mx-3 mt-3 shrink-0 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex min-h-[4.75rem] items-center gap-3 px-3 sm:px-5">
            <button type="button" onClick={() => setMobileOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 lg:hidden" aria-label="Open disbursement navigation">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-sm font-bold text-neutral-950">{currentTitle(pathname)}</p>
              <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">AzamPay disbursement pipeline</p>
            </div>
            <button
              type="button"
              onClick={unlockFinance}
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
            >
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">Unlock finance actions</span>
              <span className="sm:hidden">Unlock</span>
            </button>
            <Link href="/admin/home" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline">
              <LogOut className="h-4 w-4" /><span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}

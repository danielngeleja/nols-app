"use client";

// Sales Partner Workspace shell: sidebar, header and the workspace switcher.
//
// Every page in the (sales) route group renders inside this. The shell shows
// nothing sensitive on its own: identity and contract standing come from
// /api/sales/me, which is entitlement gated on the server.
//
// See docs/SALES_PARTNER_WORKSPACE.md sections 9.1 and 9.7.
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  Building2,
  FileSignature,
  LayoutDashboard,
  LifeBuoy,
  Send,
  UsersRound,
  WalletCards,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

export interface SalesMe {
  partner: {
    id: number;
    agentCode: string;
    status: string;
    region: string | null;
    territory: string | null;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    activatedAt: string | null;
  };
  level: {
    level: string;
    benefits: { badge: string; summary: string };
    revenueGenerated: number;
    activeProperties: number;
    next: {
      level: string;
      badge: string;
      requiredRevenue: number;
      remainingRevenue: number;
      progress: number;
    } | null;
  };
  contract: {
    id: number;
    status: string;
    startsAt: string;
    expiresAt: string;
    daysRemaining: number;
    nrmsCommissionRate: number;
    marketplaceRevenueRate: number;
    isEarning: boolean;
  } | null;
}

const NAV = [
  { href: "/sales", label: "Overview", Icon: LayoutDashboard },
  { href: "/sales/leads", label: "Leads", Icon: UsersRound },
  { href: "/sales/properties", label: "Properties", Icon: Building2 },
  { href: "/sales/earnings", label: "Earnings", Icon: WalletCards },
  { href: "/sales/payouts", label: "Payouts", Icon: Send },
  { href: "/sales/contract", label: "Contract", Icon: FileSignature },
  { href: "/sales/materials", label: "Marketing materials", Icon: BookOpen },
  { href: "/sales/notifications", label: "Notifications", Icon: Bell },
  { href: "/sales/support", label: "Support", Icon: LifeBuoy },
];

/** Status pill colours, per doc section 9.7. */
export function statusTone(status: string): string {
  const value = String(status || "").toUpperCase();
  if (["ACTIVE", "APPROVED", "AVAILABLE", "PAID", "VERIFIED", "CONVERTED"].includes(value)) {
    return "bg-green-50 text-green-800";
  }
  if (["PENDING", "TRIAL", "EXPIRING", "PROCESSING", "VALIDATING", "ELIGIBLE"].includes(value)) {
    return "bg-amber-50 text-amber-800";
  }
  if (["REJECTED", "SUSPENDED", "REVERSED", "TERMINATED", "FAILED", "LOST"].includes(value)) {
    return "bg-red-50 text-red-800";
  }
  if (["NEW", "VIEWED", "UNDER_REVIEW", "SENT", "SIGNED"].includes(value)) {
    return "bg-blue-50 text-blue-800";
  }
  return "bg-gray-100 text-gray-700";
}

export function initialsOf(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SP";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function SalesShellContentSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="space-y-4 rounded-3xl bg-white p-6 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
            <div className="h-5 w-2/5 rounded-full bg-slate-200/80 animate-pulse" />
            <div className="space-y-3">
              <div className="h-3 rounded-full bg-slate-200/80 animate-pulse" />
              <div className="h-3 rounded-full bg-slate-200/80 animate-pulse" />
              <div className="h-3 w-3/4 rounded-full bg-slate-200/80 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2].map((item) => (
          <div key={item} className="rounded-3xl bg-white p-6 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
            <div className="h-5 w-1/3 rounded-full bg-slate-200/80 animate-pulse" />
            <div className="mt-4 space-y-3">
              <div className="h-3 rounded-full bg-slate-200/80 animate-pulse" />
              <div className="h-3 rounded-full bg-slate-200/80 animate-pulse" />
              <div className="h-3 w-2/3 rounded-full bg-slate-200/80 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesOperationalFooter({ contract }: { contract: SalesMe['contract'] | null }) {
  const hasContract = Boolean(contract);
  const healthy = contract?.daysRemaining && contract.daysRemaining > 0;
  const statusLabel = hasContract ? (healthy ? "Agreement healthy" : "Agreement expired") : "No contract";
  const statusDot = hasContract ? (healthy ? "bg-emerald-500" : "bg-rose-500") : "bg-amber-400";
  const statusHelp = hasContract
    ? healthy
      ? `${contract.daysRemaining} days remaining`
      : "Please review your agreement"
    : "Open the contract page to get started";

  return (
    <footer className="mx-4 mb-4 rounded-2xl border border-white/10 bg-[#0c433d] px-4 py-3 text-xs text-emerald-100 shadow-sm lg:mx-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/sales/contract"
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-white/5 hover:no-underline"
        >
          <FileSignature className="h-4 w-4" />
          Contract
        </Link>

        <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
          {statusLabel}
        </span>

        <Link
          href="/sales/support"
          className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-white/5 hover:no-underline"
        >
          <LifeBuoy className="h-4 w-4" />
          Help
        </Link>
      </div>
      <p className="mt-3 text-[11px] text-emerald-200">{statusHelp}</p>
    </footer>
  );
}

export default function SalesShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<SalesMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<string>("");
  const [contentLoading, setContentLoading] = useState(false);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get("/api/sales/me");
        if (!cancelled) setMe(res.data);
      } catch (error: any) {
        if (cancelled) return;
        const status = error?.response?.status;
        // 403 means the entitlement or the contract is not live. Say which,
        // rather than dropping the partner on a blank screen.
        setDenied(
          error?.response?.data?.error ||
            (status === 403
              ? "Your sales workspace is not active."
              : "Could not load your sales workspace."),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const switchToNormal = useCallback(async () => {
    try {
      await apiClient.post("/api/me/workspace/select", { workspace: "NORMAL" });
    } catch {
      // Selection is a preference. If it fails, still navigate.
    }
    router.push("/account");
  }, [router]);

  useEffect(() => {
    if (previousPathname.current && previousPathname.current !== pathname) {
      setContentLoading(true);
    }
    previousPathname.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!contentLoading) return;
    const timeout = window.setTimeout(() => setContentLoading(false), 800);
    return () => window.clearTimeout(timeout);
  }, [contentLoading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="h-8 w-8 rounded-full border-2 border-brand border-t-transparent animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (denied || !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-gray-900">Sales workspace unavailable</h1>
          <p className="mt-2 text-sm text-gray-600">{denied || "Could not load your sales workspace."}</p>
          <button
            type="button"
            onClick={switchToNormal}
            className="mt-5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Go to NoLSAF
          </button>
        </div>
      </div>
    );
  }

  const contract = me.contract;

  return (
    <div id="sales-workspace" className="min-h-screen bg-[#f5f7f6] lg:flex">
      <style jsx global>{`
        #sales-workspace,
        #sales-workspace *,
        #sales-workspace *::before,
        #sales-workspace *::after {
          box-sizing: border-box;
        }
        #sales-workspace button,
        #sales-workspace input,
        #sales-workspace select,
        #sales-workspace textarea {
          font: inherit;
        }
      `}</style>
      <aside className="bg-[#07332d] text-white rounded-3xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[252px] lg:shrink-0 lg:flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4 lg:px-5 lg:py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400 font-black text-emerald-950">N</span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-black tracking-[0.08em]">NoLSAF</p>
            <p className="mb-0 mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100/65">Sales partner</p>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:block lg:flex-1 lg:space-y-1 lg:overflow-visible lg:py-4">
          {NAV.map((item) => {
            const active = item.href === "/sales" ? pathname === "/sales" : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold no-underline transition ${
                  active ? "bg-emerald-400 text-emerald-950 shadow-sm" : "text-emerald-50/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={switchToNormal}
            className="flex min-h-10 w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-emerald-900/10 px-3 text-[13px] font-semibold text-emerald-100 transition hover:bg-emerald-400/15 lg:mt-4"
          >
            <ArrowLeftRight className="h-4 w-4 shrink-0" />
            Switch workspace
          </button>
        </nav>
        {contract ? (
          <>
            <div className="mx-4 mt-auto hidden border-t border-white/10 py-4 lg:block">
              <div className="m-0 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100/55">
                <ArrowLeftRight className="h-3.5 w-3.5 text-emerald-100" />
                <span>Agreement standing</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-white">{contract.status}</span>
                <span className="text-emerald-100/65">{contract.daysRemaining > 0 ? `${contract.daysRemaining} days` : "Expired"}</span>
              </div>
            </div>
            <SalesOperationalFooter contract={contract} />
          </>
        ) : null}
      </aside>

      <div className="flex-1 min-w-0">
        <header className="border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:sticky lg:top-0 lg:z-20">
          {pathname === "/sales" ? (
            <div className="mx-auto flex min-h-10 max-w-[1600px] items-center justify-between gap-3">
              <div>
                <p className="m-0 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Partner portal</p>
                <p className="mb-0 mt-0.5 text-xs text-slate-400">Live Sales workspace</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/sales/notifications" className="relative grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700" aria-label="Sales notifications">
                  <Bell className="h-4 w-4" />
                </Link>
                {me.partner.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.partner.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#07332d] text-[11px] font-black text-white">{initialsOf(me.partner.name)}</span>
                )}
              </div>
            </div>
          ) : (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3">
            {me.partner.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={me.partner.avatarUrl}
                alt=""
                className="h-10 w-10 rounded-xl object-cover ring-1 ring-slate-200"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-sm font-black text-emerald-800 ring-1 ring-emerald-100">
                {initialsOf(me.partner.name)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-950">{me.partner.name || "Sales partner"}</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  {me.level.benefits.badge}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusTone(me.partner.status)}`}>
                  {me.partner.status}
                </span>
              </div>
              <p className="mb-0 mt-0.5 truncate text-xs text-slate-500">
                Partner ID {me.partner.agentCode}
                {me.partner.region ? `, ${me.partner.region}` : ""}
              </p>
            </div>

            {contract ? (
              <div className="hidden border-l border-slate-200 pl-4 text-right sm:block">
                <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Agreement expires</p>
                <p className="mb-0 mt-0.5 text-sm font-bold text-slate-800">
                  {new Date(contract.expiresAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <p className="mb-0 mt-0.5 text-[11px] text-slate-500">
                  {contract.daysRemaining > 0 ? `${contract.daysRemaining} days remaining` : "Expired"}
                </p>
              </div>
            ) : null}
          </div>
          )}
        </header>

        <main className="relative mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <Suspense fallback={<SalesShellContentSkeleton />}>{children}</Suspense>
          {contentLoading ? (
            <div className="pointer-events-none absolute inset-0 z-10 rounded-3xl bg-white/90 p-4 shadow-inner backdrop-blur-sm">
              <SalesShellContentSkeleton />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

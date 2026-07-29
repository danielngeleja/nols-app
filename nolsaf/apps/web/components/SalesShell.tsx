"use client";

// Sales Partner Workspace shell: sidebar, header and the workspace switcher.
//
// Every page in the (sales) route group renders inside this. The shell shows
// nothing sensitive on its own: identity and contract standing come from
// /api/sales/me, which is entitlement gated on the server.
//
// See docs/SALES_PARTNER_WORKSPACE.md sections 9.1 and 9.7.
import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Bell,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileSignature,
  Headphones,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  Menu,
  Send,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useSalesWorkspace } from "@/components/sales/SalesWorkspaceContext";
export type { SalesMe } from "@/components/sales/SalesWorkspaceContext";

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

const NAV_GROUPS = [
  { label: "Workspace", items: NAV.slice(0, 3) },
  { label: "Finance", items: NAV.slice(3, 5) },
  { label: "Resources", items: NAV.slice(5) },
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

type HealthState = "checking" | "healthy" | "unavailable";

function SalesOperationalFooter() {
  const [health, setHealth] = useState<HealthState>("checking");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const checkHealth = useCallback(async (signal?: AbortSignal) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setHealth("unavailable");
      setLastCheckedAt(new Date());
      return;
    }

    try {
      const response = await fetch("/api/ready", {
        cache: "no-store",
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error(`Readiness check failed: ${response.status}`);
      const payload = await response.json().catch(() => null);
      const ready = payload?.status === "ready" && payload?.checks?.database === "ok";
      setHealth(ready ? "healthy" : "unavailable");
      setLastCheckedAt(new Date());
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setHealth("unavailable");
        setLastCheckedAt(new Date());
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal);
    const interval = window.setInterval(() => void checkHealth(), 60_000);
    const onOnline = () => {
      setHealth("checking");
      void checkHealth();
    };
    const onOffline = () => setHealth("unavailable");

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [checkHealth]);

  const statusLabel =
    health === "healthy"
      ? "Systems ok"
      : health === "checking"
        ? "Checking"
        : "Connection issue";
  const statusDot =
    health === "healthy"
      ? "bg-emerald-500"
      : health === "checking"
        ? "bg-amber-400"
        : "bg-rose-500";
  const checkedTime = lastCheckedAt?.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusTitle =
    health === "healthy"
      ? `NoLSAF systems are operating normally${checkedTime ? ` · checked ${checkedTime}` : ""}`
      : health === "checking"
        ? "Checking system status"
        : `We're having trouble reaching NoLSAF${checkedTime ? ` · checked ${checkedTime}` : ""}`;

  return (
    <footer
      aria-label="Sales workspace resources"
      className="mx-3 mb-3 mt-2 min-h-[3.75rem] shrink-0 rounded-2xl border border-neutral-200 bg-white px-4 py-2 shadow-sm sm:px-5"
    >
      <div className="grid min-h-[2.5rem] grid-cols-3 items-center gap-2 text-xs font-bold sm:text-sm">
        <Link
          href="/sales/contract"
          className="inline-flex items-center justify-self-start gap-1.5 rounded-lg px-1 py-1 text-violet-800 no-underline transition-colors hover:text-violet-950 hover:no-underline"
        >
          <FileSignature className="h-4 w-4" aria-hidden />
          Contract
        </Link>

        <span
          title={statusTitle}
          aria-label={`${statusLabel}. ${statusTitle}`}
          className="inline-flex items-center justify-self-center gap-1.5 rounded-lg px-1 py-1 text-neutral-500"
        >
          <span className="relative flex h-4 w-4 items-center justify-center" aria-hidden>
            <span className={`absolute h-2 w-2 rounded-full ${statusDot}`} />
            <HeartPulse
              className={`relative h-3.5 w-3.5 ${
                health === "healthy" ? "text-emerald-600" : "text-transparent"
              }`}
            />
          </span>
          {statusLabel}
        </span>

        <Link
          href="/sales/support"
          className="inline-flex items-center justify-self-end gap-1.5 rounded-lg px-1 py-1 text-blue-700 no-underline transition-colors hover:text-blue-900 hover:no-underline"
        >
          <Headphones className="h-4 w-4" aria-hidden />
          Help
        </Link>
      </div>
    </footer>
  );
}

export default function SalesShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, denied } = useSalesWorkspace();
  const [navigation, setNavigation] = useState<{ href: string; label: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sales-sidebar-collapsed") === "1");
    } catch {
      // Storage is optional; expanded is the safe default.
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setNavigation(null);
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("sales-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
      return next;
    });
  }, []);

  const switchToNormal = useCallback(async () => {
    setNavigation({ href: "/account", label: "NoLSAF workspace" });
    try {
      await apiClient.post("/api/me/workspace/select", { workspace: "NORMAL" });
    } catch {
      // Selection is a preference. If it fails, still navigate.
    }
    router.push("/account");
  }, [router]);

  useEffect(() => {
    if (!navigation) return;
    const timeout = window.setTimeout(() => setNavigation(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [navigation]);

  const handleWorkspaceNavigation = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href?.startsWith("/sales")) return;

      const nextPath = href.split(/[?#]/, 1)[0];
      if (nextPath === pathname) return;

      const destination = NAV.find((item) =>
        item.href === "/sales"
          ? nextPath === "/sales"
          : nextPath.startsWith(item.href),
      );
      setNavigation({
        href: nextPath,
        label: destination?.label || "Sales page",
      });
    },
    [pathname],
  );

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
  const renderSidebar = (sidebarCollapsed: boolean) => (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-emerald-950/70 bg-[#082f2a] text-white shadow-[0_14px_34px_rgba(8,47,42,0.18)] transition-[width] duration-200 ${
        sidebarCollapsed ? "w-[4.5rem]" : "w-[17rem]"
      }`}
    >
      <div className={`flex min-h-[5rem] shrink-0 items-center border-b border-white/10 ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-4"}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-white shadow-sm">
          <Image
            src="/assets/NoLS2025-04.png"
            alt="NoLSAF"
            width={40}
            height={40}
            className="h-9 w-9 scale-[1.9] object-contain"
            priority
          />
        </span>
        {!sidebarCollapsed ? (
          <>
            <span className="h-8 w-px shrink-0 bg-white/10" aria-hidden />
            <div className="min-w-0">
              <h1 className="m-0 truncate text-base font-bold tracking-[-0.01em]">Sales Workspace</h1>
              <p className="mb-0 mt-1 text-[10px] text-emerald-100/50">Partner growth and earnings</p>
            </div>
          </>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="Sales workspace navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3.5 last:mb-0">
            {!sidebarCollapsed ? (
              <p className="mb-1.5 px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/45">
                {group.label}
              </p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/sales" ? pathname === "/sales" : pathname?.startsWith(item.href);
                const pending = navigation
                  ? item.href === "/sales"
                    ? navigation.href === "/sales"
                    : navigation.href.startsWith(item.href)
                  : false;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex min-h-9 items-center rounded-lg border text-[13px] font-semibold no-underline transition hover:no-underline ${
                      sidebarCollapsed ? "justify-center px-2" : "gap-2.5 px-2.5"
                    } ${
                      active
                        ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm"
                        : "border-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}>
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <item.Icon className="h-3.5 w-3.5" />
                      )}
                    </span>
                    {!sidebarCollapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 bg-black/5 p-2.5">
        <button
          type="button"
          onClick={switchToNormal}
          title={sidebarCollapsed ? "Switch workspace" : undefined}
          className={`flex min-h-9 w-full items-center rounded-lg border border-amber-200/10 bg-amber-100/[0.04] text-[12px] font-semibold text-amber-100 transition hover:border-amber-200/20 hover:bg-amber-300/10 hover:text-amber-50 ${
            sidebarCollapsed ? "justify-center" : "gap-2.5 px-2.5"
          }`}
        >
          {navigation?.href === "/account" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          )}
          {!sidebarCollapsed ? "Switch workspace" : null}
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`mt-1.5 hidden min-h-8 w-full appearance-none items-center rounded-lg border border-white/[0.06] bg-white/[0.05] text-[11px] font-semibold text-emerald-100/60 hover:bg-white/10 hover:text-white lg:flex ${
            sidebarCollapsed ? "justify-center" : "justify-between px-2.5"
          }`}
          aria-label={sidebarCollapsed ? "Expand Sales sidebar" : "Collapse Sales sidebar"}
        >
          {!sidebarCollapsed ? "Collapse sidebar" : null}
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );

  return (
    <div
      id="sales-workspace"
      className="flex h-dvh min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100"
      onClickCapture={handleWorkspaceNavigation}
      aria-busy={navigation ? "true" : undefined}
    >
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
      <div className="hidden shrink-0 p-3 lg:block">{renderSidebar(collapsed)}</div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button
            type="button"
            aria-label="Close Sales navigation"
            className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[17.5rem] p-3">
            {renderSidebar(false)}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mx-3 mt-3 shrink-0 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="mx-auto flex min-h-[4.75rem] max-w-[1600px] items-center gap-3 px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 lg:hidden"
              aria-label="Open Sales navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {me.partner.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.partner.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-neutral-200" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-xs font-black text-emerald-800 ring-1 ring-emerald-100">
                {initialsOf(me.partner.name)}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="m-0 truncate text-sm font-bold text-neutral-950">{me.partner.name || "Sales partner"}</p>
                <span className="hidden rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700 sm:inline">
                  {me.level.benefits.badge}
                </span>
                <span className={`hidden rounded-full px-2 py-0.5 text-[9px] font-bold uppercase md:inline ${statusTone(me.partner.status)}`}>
                  {me.partner.status}
                </span>
              </div>
              <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">
                Partner ID {me.partner.agentCode}{me.partner.region ? ` · ${me.partner.region}` : ""}
              </p>
            </div>

            {contract ? (
              <div className="hidden border-l border-neutral-200 pl-4 text-right md:block">
                <p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Agreement</p>
                <p className="mb-0 mt-1 text-xs font-bold text-neutral-800">
                  {contract.daysRemaining > 0 ? `${contract.daysRemaining} days remaining` : "Expired"}
                </p>
              </div>
            ) : null}

            <Link
              href="/sales/notifications"
              className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline"
              aria-label="Sales notifications"
            >
              <Bell className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">
          <div className="relative mx-auto w-full max-w-[1600px]">
            <Suspense fallback={<SalesShellContentSkeleton />}>{children}</Suspense>
            {navigation ? (
              <div
                className="pointer-events-none absolute inset-0 z-30 bg-neutral-100/95 backdrop-blur-[2px]"
                role="status"
                aria-live="polite"
              >
                <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-emerald-100">
                  <span className="block h-full w-1/3 animate-[pulse_0.8s_ease-in-out_infinite] bg-emerald-500" />
                </div>
                <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                  <div>
                    <p className="m-0 text-sm font-bold text-neutral-900">Opening {navigation.label}…</p>
                    <p className="mb-0 mt-0.5 text-xs text-neutral-500">Your Sales workspace will stay in place.</p>
                  </div>
                </div>
                <SalesShellContentSkeleton />
              </div>
            ) : null}
          </div>
        </main>
        <SalesOperationalFooter />
      </div>
    </div>
  );
}

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
import { usePathname } from "next/navigation";
import {
  Bell,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileSignature,
  FileText,
  Handshake,
  Headphones,
  IdCard,
  Trophy,
  Users,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  Menu,
  Send,
  Star,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { useSalesWorkspace } from "@/components/sales/SalesWorkspaceContext";

/** "2026-10" as "Oct 2026". */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}
import apiClient from "@/lib/apiClient";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import SystemHealthPopover from "@/components/SystemHealthPopover";
export type { SalesMe } from "@/components/sales/SalesWorkspaceContext";

const NAV = [
  { href: "/sales", label: "Overview", Icon: LayoutDashboard },
  { href: "/sales/leads", label: "Leads", Icon: UsersRound },
  { href: "/sales/properties", label: "Properties", Icon: Building2 },
  { href: "/sales/leaderboard", label: "Leaderboard", Icon: Trophy },
  { href: "/sales/team", label: "My team", Icon: Users, teamLeadOnly: true },
  { href: "/sales/agency", label: "Agency Desk", Icon: Handshake, agencyOnly: true },
  { href: "/sales/earnings", label: "Earnings", Icon: WalletCards },
  { href: "/sales/payouts", label: "Payouts", Icon: Send },
  { href: "/sales/statements", label: "Statements", Icon: FileText },
  { href: "/sales/contract", label: "Contract", Icon: FileSignature },
  { href: "/sales/id-card", label: "My ID card", Icon: IdCard },
  { href: "/sales/materials", label: "Marketing materials", Icon: BookOpen },
  { href: "/sales/notifications", label: "Notifications", Icon: Bell },
  { href: "/sales/support", label: "Support", Icon: LifeBuoy },
];

const NAV_GROUPS = [
  { label: "Workspace", items: NAV.slice(0, 6) },
  { label: "Finance", items: NAV.slice(6, 9) },
  { label: "Resources", items: NAV.slice(9) },
];

/** Status pill colours, per doc section 9.7. */
/** Partner-facing wording for API codes: "PROPOSAL_SENT" reads "Proposal sent". */
export function codeLabel(code: string | null | undefined): string {
  const value = String(code || "").trim().toUpperCase();
  if (!value) return "";
  const special: Record<string, string> = {
    NRMS: "NRMS",
    MARKETPLACE: "Marketplace",
    NRMS_AND_MARKETPLACE: "NRMS + Marketplace",
  };
  if (special[value]) return special[value];
  const words = value.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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

function SalesOperationalFooter() {
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

        <SystemHealthPopover className="justify-self-center" />

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
  const { me, loading, denied } = useSalesWorkspace();
  const [navigation, setNavigation] = useState<{ href: string; label: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // "My team" appears only for team leads; the server enforces it on every request.
  const [isTeamLead, setIsTeamLead] = useState(false);
  // Last month's winning team, when it is this partner's team.
  const [topTeamMonth, setTopTeamMonth] = useState<string | null>(null);
  const [hasAgencyDesk, setHasAgencyDesk] = useState(false);
  useEffect(() => {
    let alive = true;
    apiClient
      .get("/api/sales/team/status")
      .then(({ data }) => {
        if (!alive) return;
        setIsTeamLead(Boolean(data?.isTeamLead));
        setTopTeamMonth(data?.topTeam?.mine ? String(data.topTeam.month) : null);
      })
      .catch(() => undefined);
    // Agency Desk appears only when the server answers; everyone else gets a 404.
    apiClient
      .get("/api/sales/agency/status")
      .then(({ data }) => {
        if (alive) setHasAgencyDesk(Boolean(data?.status));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Unread count for the Notifications badges: refreshed on every page change,
  // once a minute, and at once when the notifications page marks one read.
  const refreshUnread = useCallback(async () => {
    try {
      const response = await apiClient.get("/api/sales/notifications", { params: { tab: "unread", page: 1, pageSize: 1 } });
      setUnreadCount(Math.max(0, Number(response.data?.totalUnread || 0)));
    } catch {
      // Keep the last known count; a badge is not worth an error message.
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    void refreshUnread();
  }, [me, pathname, refreshUnread]);

  useEffect(() => {
    if (!me) return;
    const interval = window.setInterval(() => void refreshUnread(), 60_000);
    const onChanged = () => void refreshUnread();
    window.addEventListener("sales-notifications-changed", onChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("sales-notifications-changed", onChanged);
    };
  }, [me, refreshUnread]);
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);

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
          <WorkspaceSwitcher currentWorkspace="SALES" variant="standalone" />
        </div>
      </div>
    );
  }

  const contract = me.contract;
  const renderSidebar = (sidebarCollapsed: boolean) => (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-solid border-[#12342f] bg-[#0b2420] text-white transition-[width] duration-200 ${
        sidebarCollapsed ? "w-[4.25rem]" : "w-[15.5rem]"
      }`}
    >
      <div className={`flex min-h-[4rem] shrink-0 items-center border-0 border-b border-solid border-white/10 ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3.5"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
          <Image
            src="/assets/NoLS2025-04.png"
            alt="NoLSAF"
            width={40}
            height={40}
            className="h-8 w-8 scale-[1.9] object-contain"
            priority
          />
        </span>
        {!sidebarCollapsed ? (
          <>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-[14px] font-bold leading-tight">Sales workspace</h1>
              <p className="m-0 mt-0.5 truncate text-[11px] text-white/45">Partner growth and earnings</p>
            </div>
          </>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Sales workspace navigation">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label} className="mb-3 last:mb-0">
            {!sidebarCollapsed ? (
              <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
                {group.label}
              </p>
            ) : groupIndex > 0 ? (
              <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
            ) : null}
            <div className="space-y-0.5">
              {group.items
                .filter((item) => (!("teamLeadOnly" in item) || isTeamLead) && (!("agencyOnly" in item) || hasAgencyDesk))
                .map((item) => {
                const active = item.href === "/sales" ? pathname === "/sales" : pathname?.startsWith(item.href);
                const pending = navigation
                  ? item.href === "/sales"
                    ? navigation.href === "/sales"
                    : navigation.href.startsWith(item.href)
                  : false;
                const badge = item.href === "/sales/notifications" && unreadCount > 0 ? unreadLabel : null;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={sidebarCollapsed ? (badge ? `${item.label} (${badge} unread)` : item.label) : undefined}
                    aria-label={badge ? `${item.label}, ${badge} unread` : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-9 items-center rounded-md text-[13px] font-medium no-underline transition-colors hover:no-underline ${
                      sidebarCollapsed ? "justify-center px-2" : "gap-2.5 px-2.5"
                    } ${
                      active
                        ? "bg-white/[0.09] text-white"
                        : "text-white/60 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    {active ? <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-emerald-400" aria-hidden /> : null}
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${active ? "text-emerald-300" : "text-white/55 group-hover:text-white/85"}`}>
                      {pending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <item.Icon className="h-4 w-4" />
                      )}
                    </span>
                    {!sidebarCollapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                    {badge ? (
                      sidebarCollapsed ? (
                        <span className="absolute right-1.5 top-1 grid min-w-[1.05rem] place-items-center rounded bg-amber-400 px-1 text-[10px] font-bold leading-[1.05rem] text-emerald-950 ring-2 ring-[#0b2420]" aria-hidden>
                          {badge}
                        </span>
                      ) : (
                        <span
                          className="grid min-w-[1.35rem] shrink-0 place-items-center rounded bg-amber-400 px-1.5 text-[11px] font-bold leading-5 text-emerald-950"
                          aria-hidden
                        >
                          {badge}
                        </span>
                      )
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-0 border-t border-solid border-white/10 p-2">
        <WorkspaceSwitcher
          currentWorkspace="SALES"
          variant="sales-sidebar"
          collapsed={sidebarCollapsed}
          onSwitchStart={(_workspace, destination) => setNavigation({ href: destination, label: "NoLSAF Dashboard" })}
          onSwitchError={() => setNavigation(null)}
        />
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`mt-1 hidden h-8 w-full appearance-none items-center rounded-md border-0 bg-transparent text-[12px] font-medium text-white/50 [font-family:inherit] hover:bg-white/[0.05] hover:text-white lg:flex ${
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
      <style>{`
        #sales-workspace,
        #sales-workspace *,
        #sales-workspace *::before,
        #sales-workspace *::after {
          box-sizing: border-box;
        }
        /* Tailwind preflight is off app-wide, so utility classes here were
           fighting browser defaults: "border" drew nothing (no border-style),
           "border-t border-solid" drew all four sides, and headings, paragraphs
           and <dd> kept their UA margins and indents. This is the relevant
           slice of preflight, scoped to the sales workspace. :where() keeps it
           at zero specificity, so every utility class still wins. */
        @layer base {
          /* Inside the base layer on purpose: Tailwind 4 puts utilities in a
             cascade layer, and unlayered CSS beats every layer whatever its
             specificity. Unlayered, these rules erased all bg-* on buttons
             and all border-* on fields across the sales workspace. */
          :where(#sales-workspace) *,
          :where(#sales-workspace) *::before,
          :where(#sales-workspace) *::after {
            border-width: 0;
            border-style: solid;
            border-color: #e2e8f0;
          }
          :where(#sales-workspace) :where(h1, h2, h3, h4, h5, h6, p, dl, dd, figure, blockquote, pre) {
            margin: 0;
          }
          /* Only buttons that bring no background of their own: a button with
             any bg-* class is never touched, whatever the cascade does. */
          :where(#sales-workspace) :where(button, [type="button"], [type="submit"], [type="reset"]):where(:not([class*="bg-"])) {
            background-color: transparent;
            background-image: none;
          }
          :where(#sales-workspace) :where(button, input, select, textarea) {
            font: inherit;
          }
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
        <header className="mx-3 mt-3 shrink-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="mx-auto flex min-h-[4rem] max-w-[1600px] items-center gap-3 px-3 sm:px-4">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-700 lg:hidden"
              aria-label="Open Sales navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            {me.partner.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.partner.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-neutral-200" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#02665e] text-xs font-bold text-white">
                {initialsOf(me.partner.name)}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="m-0 truncate text-sm font-bold text-neutral-950">{me.partner.name || "Sales partner"}</p>
                <span className="hidden rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 sm:inline">
                  {me.level.benefits.badge}
                </span>
                {isTeamLead ? (
                  <span className="hidden items-center gap-1 rounded-md bg-[#f5c451] px-1.5 py-0.5 text-[11px] font-bold text-[#4a3205] sm:inline-flex">
                    <Star className="h-3 w-3" aria-hidden /> Team lead
                  </span>
                ) : null}
                {topTeamMonth ? (
                  <span
                    className="hidden items-center gap-1 rounded-md border border-solid border-[#f5c451] bg-[#fffbeb] px-1.5 py-0.5 text-[11px] font-bold text-[#4a3205] md:inline-flex"
                    title={`Your team finished first in ${monthLabel(topTeamMonth)}`}
                  >
                    <Trophy className="h-3 w-3" aria-hidden /> Top team · {monthLabel(topTeamMonth)}
                  </span>
                ) : null}
                <span className={`hidden items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold md:inline-flex ${statusTone(me.partner.status)}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  {codeLabel(me.partner.status)}
                </span>
              </div>
              <p className="mb-0 mt-0.5 truncate text-[12px] text-neutral-500">
                <span className="font-mono">{me.partner.agentCode}</span>{me.partner.region ? ` · ${me.partner.region}` : ""}
              </p>
            </div>

            {contract ? (
              <div className="hidden w-44 border-0 border-l border-solid border-neutral-200 pl-4 md:block">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="m-0 text-[11px] text-neutral-500">Agreement</p>
                  <p className={`m-0 text-[12px] font-semibold ${contract.daysRemaining > 30 ? "text-neutral-800" : contract.daysRemaining > 0 ? "text-amber-700" : "text-rose-700"}`}>
                    {contract.daysRemaining > 0 ? `${contract.daysRemaining} days left` : "Expired"}
                  </p>
                </div>
                {(() => {
                  const start = new Date(contract.startsAt).getTime();
                  const end = new Date(contract.expiresAt).getTime();
                  const left = end > start ? Math.max(0, Math.min(100, ((end - Date.now()) / (end - start)) * 100)) : 0;
                  return (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                      <div className={`h-full rounded-full ${contract.daysRemaining > 30 ? "bg-[#02665e]" : "bg-amber-500"}`} style={{ width: `${left}%` }} />
                    </div>
                  );
                })()}
              </div>
            ) : null}

            <Link
              href="/sales/notifications"
              className="relative grid h-9 w-9 shrink-0 place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline"
              aria-label={unreadCount > 0 ? `Sales notifications, ${unreadLabel} unread` : "Sales notifications"}
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 grid min-w-[1.25rem] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white" aria-hidden>
                  {unreadLabel}
                </span>
              ) : null}
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

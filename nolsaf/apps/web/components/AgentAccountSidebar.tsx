"use client";

// Desktop navigation rail for the tour-agent workspace under /account/agent.
// The section outgrew the header dropdown, so the same destinations now live in
// a persistent sidebar. Purely navigational: identity, the Hotels shortcut and
// the notification badge stay in AgentWorkspaceHeader so nothing is fetched twice.
// Hidden below lg, where MobileAgentNav remains the navigation surface.
// Collapse state is per-browser and persisted; it is read after mount so the
// server and first client render agree, then applied without a width animation.
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  Archive,
  BadgeCheck,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  CreditCard,
  Eye,
  FileSignature,
  FileText,
  HandCoins,
  Headphones,
  Layers,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  UserCheck,
  Wallet2,
  type LucideIcon,
} from "lucide-react";
import {
  RAIL_COUNTS_EVENT,
  RAIL_SIGNAL_GROUPS,
  parseRailCountsDetail,
  readCachedRailCounts,
  type RailCounts,
  type RailSignalGroup,
} from "@/lib/agentRailSignals";

const STORAGE_KEY = "nolsaf:agentRail:collapsed";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Match only this exact path; used where a child route owns its own entry. */
  exact?: boolean;
  /** Sub-entries revealed by a chevron, as in the NRMS rail. */
  children?: NavItem[];
  /** Workload signal that marks this entry with a dot when non-zero. */
  signal?: { group: RailSignalGroup; key: string };
};

type NavGroup = { title: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: "Workspace",
    items: [
      { href: "/account/agent", label: "Dashboard", Icon: LayoutDashboard, exact: true },
      {
        href: "/account/agent/bookings",
        label: "My bookings",
        Icon: CalendarDays,
        children: [
          { href: "/account/agent/bookings?stage=new", label: "New", Icon: Sparkles, signal: { group: "bookings", key: "new" } },
          { href: "/account/agent/bookings?stage=confirmed", label: "Confirmed", Icon: UserCheck, signal: { group: "bookings", key: "confirmed" } },
          { href: "/account/agent/bookings?stage=progress", label: "In Progress", Icon: Activity, signal: { group: "bookings", key: "progress" } },
          { href: "/account/agent/bookings?stage=completed", label: "Completed", Icon: CheckCircle2, signal: { group: "bookings", key: "completed" } },
        ],
      },
      {
        href: "/account/agent/cancellations",
        label: "Cancellation cases",
        Icon: MessagesSquare,
        children: [
          {
            href: "/account/agent/cancellations?view=active",
            label: "Needs attention",
            Icon: TriangleAlert,
            signal: { group: "cases", key: "attention" },
          },
          { href: "/account/agent/cancellations?view=all", label: "All cases", Icon: Layers },
          { href: "/account/agent/cancellations?view=closed", label: "Closed", Icon: Archive },
        ],
      },
    ],
  },
  {
    title: "Performance",
    items: [
      {
        href: "/account/agent/revenues",
        label: "My revenues",
        Icon: TrendingUp,
        children: [
          { href: "/account/agent/revenues?track=all", label: "All", Icon: Layers },
          { href: "/account/agent/revenues?track=new", label: "New", Icon: Sparkles, signal: { group: "revenues", key: "new" } },
          { href: "/account/agent/revenues?track=claimed", label: "Claimed", Icon: HandCoins, signal: { group: "revenues", key: "claimed" } },
          { href: "/account/agent/revenues?track=verified", label: "Verified", Icon: ShieldCheck, signal: { group: "revenues", key: "verified" } },
          { href: "/account/agent/revenues?track=approved", label: "Approved", Icon: BadgeCheck, signal: { group: "revenues", key: "approved" } },
          { href: "/account/agent/revenues?track=disbursed", label: "Disbursed", Icon: Wallet2, signal: { group: "revenues", key: "disbursed" } },
          { href: "/account/agent/revenues?track=rejected", label: "Rejected", Icon: CircleSlash, signal: { group: "revenues", key: "rejected" } },
        ],
      },
      { href: "/account/agent/reports", label: "My reports", Icon: BarChart3 },
    ],
  },
  {
    title: "Profile",
    items: [
      {
        href: "/account/agent/profile",
        label: "My profile",
        Icon: BadgeCheck,
        exact: true,
        children: [
          { href: "/account/agent/profile?view=status", label: "Profile status", Icon: Activity },
          { href: "/account/agent/profile?view=packages", label: "My packages", Icon: Layers },
        ],
      },
      { href: "/account/agent/profile/preview", label: "Public preview", Icon: Eye },
      { href: "/account/agent/card", label: "My card", Icon: CreditCard },
      { href: "/account/agent/documents", label: "My documents", Icon: FileText },
      { href: "/account/agent/contract", label: "Contract", Icon: FileSignature },
    ],
  },
  {
    title: "Settings",
    items: [
      { href: "/account/agent/notifications", label: "Notifications", Icon: Bell },
      { href: "/account/agent/security", label: "Security", Icon: Shield },
      { href: "/account/agent/help", label: "Help & guide", Icon: Headphones },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const href = item.href.split("?")[0]!;
  if (item.exact) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

// Default values the page applies when a param is absent, so the first entry of
// a nested group still reads as active on a bare URL.
const PARAM_FALLBACKS: Record<string, string> = { stage: "new", view: "status", track: "all" };

function isChildActive(
  pathname: string,
  searchParams: { get: (name: string) => string | null },
  currentHash: string,
  child: NavItem
) {
  const [hrefWithoutHash, hash] = child.href.split("#");
  const [path, query] = hrefWithoutHash.split("?");
  if ((pathname.replace(/\/+$/, "") || "/") !== path) return false;
  if (hash) return currentHash === `#${hash}`;
  if (!query) return true;
  return Array.from(new URLSearchParams(query).entries()).every(
    ([key, value]) => (searchParams.get(key) ?? PARAM_FALLBACKS[key] ?? null) === value
  );
}

export default function AgentAccountSidebar() {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [currentHash, setCurrentHash] = useState("");
  // Undefined means "follow the route": a group opens on its own once you are
  // inside it, and stays wherever you put it after you click the chevron.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [signals, setSignals] = useState<Partial<Record<RailSignalGroup, RailCounts>>>({});

  useEffect(() => {
    const cached: Partial<Record<RailSignalGroup, RailCounts>> = {};
    for (const group of RAIL_SIGNAL_GROUPS) {
      const counts = readCachedRailCounts(group);
      if (counts) cached[group] = counts;
    }
    setSignals(cached);

    const onCounts = (event: Event) => {
      const next = parseRailCountsDetail((event as CustomEvent).detail);
      if (next) setSignals((prev) => ({ ...prev, [next.group]: next.counts }));
    };
    window.addEventListener(RAIL_COUNTS_EVENT, onCounts as EventListener);
    return () => window.removeEventListener(RAIL_COUNTS_EVENT, onCounts as EventListener);
  }, []);

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // private mode or blocked storage: stay expanded
    }
    setHydrated(true);
  }, []);

  const toggleGroup = useCallback((href: string, fallbackOpen: boolean) => {
    setOpenGroups((prev) => ({ ...prev, [href]: !(prev[href] ?? fallbackOpen) }));
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore persistence failures
      }
      return next;
    });
  }, []);

  return (
    <aside
      id="agent-account-rail"
      aria-label="Agent workspace navigation"
      className={`hidden h-full flex-shrink-0 lg:block ${collapsed ? "w-[4.25rem]" : "w-[15rem]"} ${
        hydrated ? "transition-[width] duration-200 ease-out" : ""
      }`}
    >
      <style jsx global>{`
        #agent-account-rail, #agent-account-rail *, #agent-account-rail *::before, #agent-account-rail *::after { box-sizing: border-box; }
      `}</style>

      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-solid border-white/10 bg-[#252d2c] text-white shadow-[0_14px_34px_-18px_rgba(15,23,42,0.45)]">
        <div className={`flex min-h-[5rem] shrink-0 items-center border-0 border-b border-solid border-white/10 ${collapsed ? "justify-center px-2" : "gap-3 px-4"}`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg border border-solid border-white/15 bg-white">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority />
          </span>
          {collapsed ? null : (
            <>
              <span className="h-8 w-px shrink-0 bg-white/10" aria-hidden />
              <div className="min-w-0">
                <p className="m-0 truncate text-[12px] font-semibold tracking-[0.08em] text-white/85">AGENT WORKSPACE</p>
                <p className="m-0 mt-1 text-[10px] text-white/40">Tour operator portal</p>
              </div>
            </>
          )}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-0.5 py-3">
          {GROUPS.map((group, groupIndex) => (
            <div key={group.title} className={groupIndex === 0 ? "" : "mt-4"}>
              {collapsed ? (
                groupIndex === 0 ? null : (
                  <div className="mx-auto mb-3 h-px w-7 bg-white/10" aria-hidden />
                )
              ) : (
                <p className="m-0 px-4 pb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white/35">
                  {group.title}
                </p>
              )}
              <div className="px-2">
                {group.items.map((item) => {
                  const { href, label, Icon, children } = item;
                  const active = isActive(pathname, item);

                  // Nested groups only make sense with room for labels; the
                  // collapsed rail falls back to the parent link, as NRMS does.
                  if (children?.length && !collapsed) {
                    const nestedOpen = openGroups[href] ?? active;
                    // A nested entry owns selection; its parent remains a
                    // neutral group label, matching the existing case menu.
                    const parentIsActive = false;
                    const nestedId = `agent-rail-${href.replace(/[^a-z0-9]+/gi, "-")}`;
                    return (
                      <div key={href} className="mb-0.5 last:mb-0">
                        <button
                          type="button"
                          onClick={() => toggleGroup(href, active)}
                          aria-expanded={nestedOpen}
                          aria-controls={nestedId}
                          className={`group flex min-h-9 w-full cursor-pointer appearance-none items-center gap-2.5 rounded-lg border border-solid px-2.5 text-left text-[13px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-300/40 ${
                            parentIsActive
                              ? "border-emerald-300/70 bg-emerald-300 text-emerald-950"
                              : "border-transparent bg-transparent text-white/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"
                          }`}
                        >
                          <span
                            className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-md transition ${
                              parentIsActive ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <ChevronDown
                            className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 ${
                              nestedOpen ? "rotate-180" : ""
                            }`}
                            aria-hidden
                          />
                        </button>

                        {nestedOpen ? (
                          <div
                            id={nestedId}
                            className="ml-5 mt-1 border-0 border-l border-solid border-white/10 pl-2"
                          >
                            {children.map((child) => {
                              const ChildIcon = child.Icon;
                              const childActive = isChildActive(pathname, searchParams, currentHash, child);
                              const childCount = child.signal
                                ? signals[child.signal.group]?.[child.signal.key] ?? null
                                : null;
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  aria-current={childActive ? "page" : undefined}
                                  className={`mb-0.5 flex min-h-8 items-center gap-2 rounded-lg border border-solid px-2 text-[12px] font-medium no-underline outline-none transition last:mb-0 focus-visible:ring-2 focus-visible:ring-emerald-300/40 ${
                                    childActive
                                      ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100"
                                      : "border-transparent text-white/45 hover:bg-white/[0.06] hover:text-white"
                                  }`}
                                >
                                  <ChildIcon
                                    className="h-3.5 w-3.5 flex-shrink-0"
                                    aria-hidden
                                  />
                                  <span className="min-w-0 flex-1 truncate">{child.label}</span>
                                  {/* Presence, not volume: a stage with nothing
                                      waiting shows no marker at all. */}
                                  {childCount ? (
                                    <span
                                      className="mr-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-300 ring-4 ring-emerald-300/20"
                                      aria-hidden
                                    />
                                  ) : null}
                                  {childCount ? (
                                    <span className="sr-only">
                                      {childCount} waiting
                                    </span>
                                  ) : null}
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? label : undefined}
                      title={collapsed ? label : undefined}
                      className={`group mb-0.5 flex min-h-9 items-center rounded-lg border border-solid text-[13px] font-semibold no-underline outline-none transition last:mb-0 hover:no-underline focus-visible:ring-2 focus-visible:ring-emerald-300/40 ${
                        collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"
                      } ${
                        active
                          ? "border-emerald-300/70 bg-emerald-300 text-emerald-950"
                          : "border-transparent text-white/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"
                      }`}
                    >
                      <span
                        className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-md transition ${
                          active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-shrink-0 border-0 border-t border-solid border-white/10 p-2">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-controls="agent-account-rail"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className={`flex min-h-9 w-full cursor-pointer appearance-none items-center rounded-lg border-0 bg-transparent text-[12px] font-semibold text-white/50 outline-none transition hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-emerald-300/40 ${
              collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"
            }`}
          >
            <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-white/[0.04]">
              {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden /> : <PanelLeftClose className="h-3.5 w-3.5" aria-hidden />}
            </span>
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}

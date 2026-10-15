"use client";

/**
 * Admin shell header.
 *
 * Structure is taken from the NRMS workspace header
 * (app/(owner)/owner/nrms/layout.tsx): an inset card with an identity block on
 * the left, controls on the right, and a primary tab row underneath.
 *
 * The palette is the admin sidebar's, not NRMS's white: #082f2a on
 * border-emerald-950/70 with rounded-2xl, so the header and the sidebar read as
 * one dark family rather than two unrelated surfaces.
 *
 * This lives outside SiteHeader for the same reason OwnerSiteHeader and
 * DriverSiteHeader do: the admin chrome has diverged far enough that branching
 * inside the shared component costs more than a sibling.
 *
 * Geometry contract with app/(admin)/admin/layout.tsx:
 *  - Width: no horizontal margin. The card fills .public-container's content
 *    box, which is exactly where the sidebar (absolute left-3) starts and where
 *    the workspace surface ends. Adding mx-* here breaks that alignment.
 *  - Height: pt-3 (12) + row (76) + tab row (45) = 133px. The layout offsets its
 *    sidebar and content with top-40 / pt-40 against this, so changing the row
 *    heights means changing those two numbers too.
 */

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  RefreshCw,
  Siren,
  Settings,
  Shield,
  User,
} from "lucide-react";
import { clearAuthToken } from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import AdminJumpSearch from "@/components/AdminJumpSearch";
import { ADMIN_NAV_PAGES } from "@/components/AdminSidebar";
import { useAdminNavCounts, type AdminNavCounts } from "@/lib/useAdminNavCounts";

const PRIMARY_TABS: Array<{ href: string; label: string; icon: typeof Bell; exact?: boolean; count?: keyof AdminNavCounts }> = [
  { href: "/admin/home", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/action-center", label: "Actions", icon: Siren },
  { href: "/admin/properties/previews", label: "Approvals", icon: CheckCircle2, count: "listings" },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, count: "payouts" },
  { href: "/admin/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/admin/finance", label: "Revenue", icon: BarChart3 },
  { href: "/admin/nrms", label: "NRMS", icon: Building2 },
];

const PROFILE_LINKS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/profile", label: "My Profile", icon: User },
  { href: "/admin/management/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, tab: { href: string; exact?: boolean }) {
  return tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
}

/** Where you are, from the sidebar's page index: the longest page path that contains this one. */
function locate(pathname: string) {
  let best: (typeof ADMIN_NAV_PAGES)[number] | null = null;
  for (const p of ADMIN_NAV_PAGES) {
    if ((pathname === p.href || pathname.startsWith(p.href + "/")) && (!best || p.href.length > best.href.length)) best = p;
  }
  if (!best) return null;
  const deeper = pathname.length > best.href.length;
  return { section: best.section === "Pages" ? null : best.section, page: best.label, deeper };
}

export default function AdminSiteHeader({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const pathname = usePathname() ?? "";
  const navCounts = useAdminNavCounts();
  const here = useMemo(() => locate(pathname), [pathname]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [profilePlacement, setProfilePlacement] = useState<"down" | "up">("down");

  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [sessionRemainingSec, setSessionRemainingSec] = useState<number | null>(null);
  const logoutInProgressRef = useRef(false);

  const logoutAndRedirect = useCallback(async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    setProfileOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Redirect anyway; the server already considers the session expired.
    } finally {
      clearAuthToken();
      window.location.replace("/admin/login");
    }
  }, []);

  const toggleSidebar = () => {
    try {
      window.dispatchEvent(new CustomEvent("toggle-admin-sidebar", { detail: { source: "header" } }));
    } catch {
      // ignore
    }
  };

  const openNotifications = () => window.dispatchEvent(new Event("nols:admin-notifications:open"));

  const handleRefresh = () => {
    setIsRefreshing(true);
    try {
      window.location.reload();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Live unread badge: the drawer and the socket listener both broadcast here.
  useEffect(() => {
    const onNotification = () => setUnreadCount((current) => (current ?? 0) + 1);
    const onUnreadChange = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number; delta?: number }>).detail;
      setUnreadCount((current) =>
        typeof detail?.count === "number" ? Math.max(0, detail.count) : Math.max(0, (current ?? 0) + (detail?.delta ?? 0))
      );
    };
    window.addEventListener("nols:admin-notification", onNotification);
    window.addEventListener("nols:admin-unread-change", onUnreadChange);
    return () => {
      window.removeEventListener("nols:admin-notification", onNotification);
      window.removeEventListener("nols:admin-unread-change", onUnreadChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.setItem("navigationContext", "admin");

    (async () => {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 8_000);
      try {
        const r = await fetch("/api/admin/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
          signal: ac.signal,
        });
        if (!r.ok) return;
        const data = await r.json();
        if (typeof data.totalUnread === "number") setUnreadCount(data.totalUnread);
      } catch {
        // non-critical: no badge shown
      } finally {
        window.clearTimeout(t);
      }
    })();

    (async () => {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 8_000);
      try {
        const response = await fetchAccountSession({ signal: ac.signal });
        const data = response.data;
        if (data?.avatarUrl) setAvatarUrl(data.avatarUrl);
        const displayName = data?.displayName || data?.fullName || data?.name || data?.email;
        if (displayName) setUserName(displayName);
        if (data?.email) setUserEmail(data.email);
      } catch {
        // non-critical: avatar and name stay empty
      } finally {
        window.clearTimeout(t);
      }
    })();
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, []);

  // Open downward when the menu fits, otherwise flip up. Without this the menu is
  // clipped on short viewports.
  useEffect(() => {
    if (!profileOpen) return;

    const computePlacement = () => {
      const anchorEl = profileRef.current;
      const menuEl = profileMenuRef.current;
      if (!anchorEl || !menuEl) return;
      const anchorRect = anchorEl.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();

      const margin = 12;
      const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - margin;

      if (spaceBelow >= menuRect.height) setProfilePlacement("down");
      else if (spaceAbove >= menuRect.height) setProfilePlacement("up");
      else setProfilePlacement(spaceAbove > spaceBelow ? "up" : "down");
    };

    const raf = window.requestAnimationFrame(computePlacement);
    window.addEventListener("resize", computePlacement);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", computePlacement);
    };
  }, [profileOpen]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 8_000);
      try {
        const resp = await fetch("/api/auth/session", { method: "GET", credentials: "include", signal: ac.signal });
        if (!resp.ok) {
          if (resp.status === 401 || resp.status === 403) void logoutAndRedirect();
          return;
        }
        const json = await resp.json();
        if (cancelled) return;
        setSessionExpiresAt(typeof json?.expiresAt === "string" ? json.expiresAt : null);
        setSessionRemainingSec(typeof json?.remainingSec === "number" ? json.remainingSec : null);
      } catch {
        // non-critical: countdown simply not shown
      } finally {
        window.clearTimeout(t);
      }
    }
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [logoutAndRedirect]);

  useEffect(() => {
    if (!sessionExpiresAt) return;
    const expiryMs = new Date(sessionExpiresAt).getTime();
    if (!Number.isFinite(expiryMs)) return;
    const tick = () => setSessionRemainingSec(Math.max(0, Math.floor((expiryMs - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sessionExpiresAt]);

  useEffect(() => {
    if (typeof sessionRemainingSec !== "number") return;
    if (sessionRemainingSec <= 0) void logoutAndRedirect();
  }, [logoutAndRedirect, sessionRemainingSec]);

  const sessionLabel = useMemo(() => {
    if (typeof sessionRemainingSec !== "number") return null;
    const minutes = Math.floor(sessionRemainingSec / 60);
    const seconds = sessionRemainingSec % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [sessionRemainingSec]);

  const sessionCritical = typeof sessionRemainingSec === "number" && sessionRemainingSec <= 5 * 60;
  const badgeCount = unreadCount ?? unreadMessages;
  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));

  // border-solid on every bordered element: preflight is disabled project-wide,
  // so a bare `border` utility draws nothing.
  // Toolbar buttons sit inside one grouped pill, so they carry no border of their own.
  const iconButton =
    "inline-flex h-8 w-8 shrink-0 cursor-pointer appearance-none items-center justify-center rounded-lg " +
    "border-0 bg-transparent text-emerald-50/75 no-underline " +
    "transition duration-200 hover:bg-white/[0.1] hover:text-white " +
    "hover:no-underline active:scale-95 focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-emerald-300/40";

  return (
    <header id="admin-site-header" className="fixed left-0 right-0 top-0 z-50 text-white">
      {/* Preflight is disabled project-wide, so this shell sets its own box model
          and owns the one keyframe it needs. */}
      <style>{`
        #admin-site-header, #admin-site-header * { box-sizing: border-box; }
        @keyframes admin-session-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .admin-session-blink { animation: admin-session-blink 1.4s ease-in-out infinite; }
        /* SiteHeader used to inject this globally. It no longer renders on the
           admin shell, so the menu owns its own entrance animation. */
        @keyframes admin-fade-in-up {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .admin-fade-in-up { animation: admin-fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>

      <div className="public-container pt-3">
        {/* No mx-*: the card must span the container's content box so its edges
            line up with the sidebar on the left and the workspace on the right.

            Deliberately NOT overflow-hidden. The profile menu is absolutely
            positioned inside this card and hangs below it, and because this box is
            an ancestor of the menu's containing block, clipping here cuts the menu
            off at the card edge. The decorative layer below carries its own
            rounding instead. */}
        <div className="relative rounded-2xl border border-solid border-emerald-950/70 bg-[#082f2a] shadow-[0_14px_34px_rgba(8,47,42,0.18)]">
          {/* Depth without a hard band: a wide emerald bloom top-left and a cool
              highlight top-right, both far below the content in opacity. Rounded to
              match the card, since nothing clips it now. */}
          <div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            aria-hidden
            style={{
              background:
                "radial-gradient(680px circle at 12% -40%, rgba(52,211,153,0.16), transparent 60%), radial-gradient(520px circle at 88% -30%, rgba(125,211,252,0.08), transparent 62%)",
            }}
          />

          <div className="relative flex min-h-[4.75rem] items-center gap-3 px-3 sm:px-5">
            <button type="button" onClick={toggleSidebar} className={`${iconButton} h-10 w-10 rounded-xl border border-solid border-white/10 bg-white/[0.06]`} aria-label="Toggle sidebar" title="Toggle sidebar">
              <Menu className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
            </button>

            <span className="hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-white/15 bg-white shadow-sm sm:flex">
              <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority />
            </span>

            {/* One label only. The logo tile beside it already carries the brand,
                so a title, a pill and a subtitle were three ways of saying it. */}
            <div className="min-w-0 shrink-0 lg:max-w-[240px] xl:max-w-[300px]">
              <p className="m-0 truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-white">Admin Console</p>
              {here ? (
                <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium text-emerald-100/55">
                  {here.section ? <><span className="truncate">{here.section}</span><span aria-hidden className="text-emerald-100/30">/</span></> : null}
                  <span className="truncate text-emerald-200/90">{here.page}</span>
                  {here.deeper ? <><span aria-hidden className="text-emerald-100/30">/</span><span className="truncate">Record</span></> : null}
                </p>
              ) : null}
            </div>

            {/* Jump anywhere: pages and records in one box */}
            <div className="hidden min-w-0 flex-1 justify-center px-2 lg:flex">
              <AdminJumpSearch />
            </div>
            <div className="flex-1 lg:hidden" />

            {sessionLabel && (
              <div
                className={`hidden h-10 shrink-0 select-none items-center gap-1.5 rounded-xl border border-solid px-3 transition duration-200 sm:inline-flex ${
                  sessionCritical
                    ? "admin-session-blink border-rose-300/30 bg-rose-400/15 text-rose-100"
                    : "border-white/10 bg-white/[0.06] text-emerald-50/85"
                }`}
                title={sessionExpiresAt ? `Session ends at ${new Date(sessionExpiresAt).toLocaleTimeString()}` : "Session time remaining"}
              >
                <Clock className={`h-3.5 w-3.5 shrink-0 ${sessionCritical ? "text-rose-200" : "text-emerald-200/80"}`} strokeWidth={2} aria-hidden />
                <span className="text-[13px] font-semibold tabular-nums tracking-tight text-white">{sessionLabel}</span>
                <span className="hidden text-[11px] font-medium text-emerald-100/50 xl:inline">left</span>
              </div>
            )}

            <div className="hidden shrink-0 items-center gap-0.5 rounded-xl border border-solid border-white/10 bg-white/[0.05] p-1 md:flex">
              <button type="button" onClick={handleRefresh} disabled={isRefreshing} className={iconButton} aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-[18px] w-[18px] shrink-0 ${isRefreshing ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden />
              </button>

              <button type="button" onClick={openNotifications} className={`relative ${iconButton}`} aria-label="Notifications" title="Notifications">
                <Bell className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
                {badgeCount > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold leading-none text-amber-950 ring-2 ring-[#0c3530]"
                    aria-label={`${badgeCount} unread notifications`}
                  >
                    {badgeCount > 9 ? "9+" : badgeCount}
                  </span>
                )}
              </button>

              <Link href="/admin/support" className={iconButton} aria-label="Support" title="Support">
                <LifeBuoy className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
              </Link>

              <Link href="/admin/management/settings" className={iconButton} aria-label="Settings" title="Settings">
                <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
              </Link>
            </div>

            <span className="mx-1 hidden h-6 w-px shrink-0 bg-white/10 md:block" aria-hidden />

            <div ref={profileRef} className="relative z-[90] shrink-0">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="group inline-flex h-10 cursor-pointer appearance-none items-center justify-center gap-2.5 rounded-xl border-0 bg-transparent px-1.5 transition duration-200 hover:bg-white/[0.1] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40"
                aria-label="Profile menu"
                aria-expanded={profileOpen}
              >
                {avatarUrl ? (
                  <span className="relative block h-9 w-9 overflow-hidden rounded-full border border-solid border-white/15">
                    <Image src={avatarUrl} alt="Profile" fill sizes="36px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                  </span>
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-solid border-white/15 bg-white/[0.08]">
                    <User className="h-5 w-5 text-emerald-50/80" strokeWidth={2} aria-hidden />
                  </span>
                )}
                <span className="hidden min-w-0 max-w-[140px] flex-col items-start text-left xl:flex">
                  <span className="block w-full truncate text-[13px] font-semibold leading-tight text-white">{userName || "Administrator"}</span>
                  <span className="block text-[11px] leading-tight text-emerald-100/50">Administrator</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-emerald-100/50 transition duration-200 ${profileOpen ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
              </button>

              {profileOpen && (
                <div
                  ref={profileMenuRef}
                  className={`admin-fade-in-up absolute right-0 z-[95] max-h-[calc(100vh-6rem)] w-64 overflow-hidden overflow-y-auto rounded-2xl border border-solid border-white/10 bg-gradient-to-b from-[#0b1220]/95 via-[#0a1624]/90 to-[#070f1a]/95 shadow-[0_24px_80px_rgba(0,0,0,0.55),0_0_40px_rgba(2,102,94,0.18)] backdrop-blur-xl ${
                    profilePlacement === "down" ? "top-full mt-3" : "bottom-full mb-3"
                  }`}
                >
                  <div className="border-0 border-b border-solid border-white/10 bg-white/5 px-3.5 py-3">
                    <div className="flex items-center gap-3">
                      {avatarUrl ? (
                        <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full border border-solid border-white/15">
                          <Image src={avatarUrl} alt="Profile" fill sizes="40px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                        </span>
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-solid border-white/15 bg-white/5">
                          <Shield className="h-5 w-5 text-teal-200" strokeWidth={2} aria-hidden />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">{userName || "Administrator"}</span>
                          <Shield className="h-4 w-4 shrink-0 text-teal-200/90" strokeWidth={2} aria-hidden />
                        </div>
                        <div className="mt-0.5 truncate text-xs text-white/70">{userEmail || "No email"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="py-2">
                    {PROFILE_LINKS.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setProfileOpen(false)}
                        className="group mx-2 flex items-center gap-3 rounded-xl bg-transparent px-3 py-2 text-sm font-medium text-white/90 no-underline transition-all duration-200 ease-out hover:bg-white/10 hover:no-underline active:scale-[0.99] active:bg-white/10"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-solid border-white/10 bg-white/5 transition-all duration-200 ease-out group-hover:border-white/20 group-hover:bg-white/10">
                          <item.icon className="h-4 w-4 text-white/75 transition-all duration-200 ease-out group-hover:scale-105 group-hover:text-white" strokeWidth={2} aria-hidden />
                        </span>
                        {item.label}
                      </Link>
                    ))}

                    <WorkspaceSwitcher currentWorkspace="NORMAL" variant="menu-dark" />

                    <button
                      type="button"
                      onClick={logoutAndRedirect}
                      className="group mx-2 flex w-[calc(100%-1rem)] appearance-none items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2 text-sm font-semibold text-rose-200 transition-all duration-200 ease-out hover:bg-rose-500/10 active:scale-[0.99] active:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/30"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-solid border-white/10 bg-white/5 transition-all duration-200 ease-out group-hover:border-rose-200/30 group-hover:bg-rose-500/10">
                        <LogOut className="h-4 w-4 transition-all duration-200 ease-out group-hover:scale-105 group-hover:text-rose-100" strokeWidth={2} aria-hidden />
                      </span>
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <nav
            className="scrollbar-hide relative overflow-x-auto border-0 border-t border-solid border-white/10 px-3 sm:px-5"
            aria-label="Primary admin sections"
          >
            <div className="flex w-max min-w-full gap-1">
              {PRIMARY_TABS.map((tab) => {
                const active = isActive(pathname, tab);
                const waiting = tab.count && navCounts ? navCounts[tab.count] : 0;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 border-0 px-3 text-xs font-semibold no-underline transition duration-200 hover:no-underline ${
                      active ? "text-white" : "text-emerald-50/50 hover:text-white"
                    }`}
                  >
                    <tab.icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-300" : ""}`} strokeWidth={2} aria-hidden />
                    {tab.label}
                    {waiting > 0 ? (
                      <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400/15 px-1.5 text-[10px] font-bold tabular-nums text-amber-200" aria-label={`${waiting} waiting`}>
                        {waiting > 99 ? "99+" : waiting}
                      </span>
                    ) : null}
                    {active ? <span className="pointer-events-none absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-emerald-300 shadow-[0_0_10px_1px_rgba(110,231,183,0.55)]" aria-hidden /> : null}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}

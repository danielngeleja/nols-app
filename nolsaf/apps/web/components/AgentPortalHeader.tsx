"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { fetchAccountSession } from "@/lib/accountSession";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import {
  BarChart3,
  Bell,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  MessagesSquare,
  LayoutDashboard,
  LogOut,
  Handshake,
  Shield,
  TrendingUp,
  UserRound,
} from "lucide-react";

export default function AgentPortalHeader() {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [agentUnreadCount, setAgentUnreadCount] = useState<number>(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [accommodationEnabled, setAccommodationEnabled] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("navigationContext", "agent");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const loadAccommodationCapability = async () => {
      try {
        const response = await fetch("/api/agent-portal/profile", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (mounted) setAccommodationEnabled(response.ok);
      } catch (error) {
        if (mounted && (error as Error).name !== "AbortError") setAccommodationEnabled(false);
      }
    };
    void loadAccommodationCapability();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  const { socket } = useSocket(undefined, { enabled: true, joinDriverRoom: false });

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const node = profileMenuRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) setProfileMenuOpen(false);
    };
    if (!profileMenuOpen) return;
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [profileMenuOpen]);

  const iconButtonClass =
    "inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/90 shadow-card transition-all duration-300 ease-out hover:bg-white/10 hover:border-white/20 hover:text-white hover:shadow-md hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 motion-reduce:transition-none";

  const avatarButtonClass =
    "inline-flex h-10 w-10 items-center justify-center rounded-full bg-transparent p-0 shadow-card overflow-hidden transition-all duration-300 ease-out hover:shadow-md hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 motion-reduce:transition-none";

  const menuItemClass =
    "group flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors no-underline";

  const logoutRedirect = "/login";

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const loadAvatar = async () => {
      try {
        const r = await fetchAccountSession({ signal: controller.signal });
        if (!r.ok) return;
        const me = r.data;
        const url = typeof (me as any)?.avatarUrl === "string" ? String((me as any).avatarUrl).trim() : "";
        if (mounted) setAvatarUrl(url || null);
      } catch {
        // ignore
      }
    };

    void loadAvatar();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as any;
      const url = typeof detail?.avatarUrl === "string" ? String(detail.avatarUrl).trim() : "";
      if (url) setAvatarUrl(url);
    };
    window.addEventListener("account:avatarUrl", handler as EventListener);
    return () => window.removeEventListener("account:avatarUrl", handler as EventListener);
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const r = await fetch("/api/agent/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!r.ok) return;
        const j = await r.json();
        const c = Number(j.totalUnread ?? j.total ?? 0);
        if (mounted) setAgentUnreadCount(Number.isFinite(c) ? c : 0);
      } catch {
        // ignore
      }
    };

    void load();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as any;
      const count = Number(detail?.count);
      if (Number.isFinite(count)) setAgentUnreadCount(count);
    };

    window.addEventListener("agent:notifications:unreadCount", handler as EventListener);
    return () => window.removeEventListener("agent:notifications:unreadCount", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onNew = (payload: any) => {
      if (payload?.type !== "agent") return;
      setAgentUnreadCount((c) => (Number.isFinite(c) ? c + 1 : 1));
    };

    socket.on("notification:new", onNew);
    return () => {
      socket.off("notification:new", onNew);
    };
  }, [socket]);
  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));

  return (
    <div className="sticky top-0 z-40 bg-transparent">
      <div className="public-container h-16 flex items-center">
        <div className="w-full h-14 rounded-3xl border border-white/10 bg-slate-950/60 text-white backdrop-blur shadow-card flex items-center justify-between gap-4 px-3 sm:px-4 transition-all duration-300 ease-out hover:bg-slate-950/70 hover:shadow-lg motion-reduce:transition-none">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/account/agent"
              aria-label="NoLSAF Agent Portal"
              className="group inline-flex items-center gap-2 min-w-0"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 shadow-card transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none">
                <Image
                  src="/assets/NoLS2025-04.png"
                  alt="NoLSAF"
                  width={44}
                  height={44}
                  className="h-7 w-7 brightness-0 invert"
                  priority
                />
              </span>
            </Link>

            <div className="h-6 w-px bg-white/10" aria-hidden />

            <div className="min-w-0">
              <div className="text-[13px] font-extrabold text-white tracking-tight truncate">Agent Portal</div>
              <div className="text-xs text-white/70 truncate">Support workspace & assignments</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {accommodationEnabled ? (
              <Link
                href="/agent-portal"
                aria-label="Accommodation partnerships"
                title="Accommodation partnerships"
                className="group inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-emerald-100 no-underline shadow-card transition hover:border-emerald-300/30 hover:bg-emerald-400/20"
              >
                <Handshake className="h-5 w-5 transition-transform group-hover:scale-110" aria-hidden />
                <span className="hidden text-xs font-bold sm:inline">Hotels</span>
              </Link>
            ) : null}
            <Link
              href="/account/agent/notifications"
              aria-label="Notifications"
              title="Notifications"
              className={`group relative ${iconButtonClass}`}
            >
              <Bell className="h-5 w-5 transition-transform duration-300 ease-out group-hover:scale-110 motion-reduce:transition-none" aria-hidden />
              {agentUnreadCount > 0 ? (
                <span
                  className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[11px] font-extrabold tabular-nums inline-flex items-center justify-center ring-2 ring-slate-950/80 animate-scale-in"
                  aria-label={`${agentUnreadCount} unread notifications`}
                >
                  {agentUnreadCount > 99 ? "99+" : agentUnreadCount}
                </span>
              ) : null}
            </Link>

            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                aria-label="Profile menu"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((v) => !v)}
                className={`group ${avatarUrl ? avatarButtonClass : iconButtonClass}`}
              >
                <span className="sr-only">Open profile menu</span>
                {avatarUrl ? (
                  <span className="relative block h-full w-full">
                    <Image src={avatarUrl} alt="Profile photo" fill sizes="40px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                  </span>
                ) : (
                  <UserRound className="h-5 w-5 transition-transform duration-300 ease-out group-hover:scale-110 motion-reduce:transition-none" aria-hidden />
                )}
              </button>

              {profileMenuOpen && (
                <div
                  role="menu"
                  aria-label="Agent menu"
                  className="absolute right-0 z-[1000] mt-3 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/10 bg-slate-950 text-white shadow-2xl"
                >
                  <div className="py-2">
                    <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                      Portal
                    </div>

                    <Link
                      role="menuitem"
                      href="/account/agent"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <LayoutDashboard className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">Dashboard</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/assignments"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <ClipboardList className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">Assignments</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    {accommodationEnabled ? (
                      <Link
                        role="menuitem"
                        href="/agent-portal"
                        onClick={() => setProfileMenuOpen(false)}
                        className={menuItemClass}
                      >
                        <Handshake className="h-4 w-4 text-emerald-300 transition-colors group-hover:text-emerald-200" aria-hidden />
                        <span className="flex-1">Accommodation partnerships</span>
                        <ChevronRight className="h-3.5 w-3.5 text-white/40 transition-colors group-hover:text-brand" aria-hidden />
                      </Link>
                    ) : null}

                    <div className="my-2 mx-4 h-px bg-white/10" />

                    <div className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                      Activity
                    </div>

                    <Link
                      role="menuitem"
                      href="/account/agent/bookings"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <CalendarDays className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">My Bookings</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/cancellations"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <MessagesSquare className="h-4 w-4 text-white/60 transition-colors group-hover:text-brand" aria-hidden />
                      <span className="flex-1">Cancellation cases</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 transition-colors group-hover:text-brand" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/revenues"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <TrendingUp className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">My Revenues</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <div className="my-2 mx-4 h-px bg-white/10" />

                    <div className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                      Profile
                    </div>

                    <Link
                      role="menuitem"
                      href="/account/agent/profile"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <BadgeCheck className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">My Profile</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/profile/preview"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <UserRound className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">Preview</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/card"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <BadgeCheck className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">My Card</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <div className="my-2 mx-4 h-px bg-white/10" />

                    <div className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                      Settings
                    </div>

                    <Link
                      role="menuitem"
                      href="/account/agent/security"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <Shield className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">Security</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/reports"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <BarChart3 className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">My Reports</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>

                    <Link
                      role="menuitem"
                      href="/account/agent/documents"
                      onClick={() => setProfileMenuOpen(false)}
                      className={menuItemClass}
                    >
                      <FileText className="h-4 w-4 text-white/60 group-hover:text-brand transition-colors" aria-hidden />
                      <span className="flex-1">My Documents</span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/40 group-hover:text-brand transition-colors" aria-hidden />
                    </Link>
                    <WorkspaceSwitcher currentWorkspace="NORMAL" variant="menu-dark" />

                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setProfileMenuOpen(false);
                        const next = encodeURIComponent(logoutRedirect);
                        window.location.href = `/api/auth/logout?next=${next}`;
                      }}
                      className="group w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/10 transition-colors border-0 bg-transparent cursor-pointer"
                    >
                      <LogOut className="h-4 w-4 text-rose-300 group-hover:text-rose-200 transition-colors" aria-hidden />
                      <span className="flex-1 text-left">Logout</span>
                      <ChevronRight className="h-3.5 w-3.5 text-rose-300/70 group-hover:text-rose-200 transition-colors" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

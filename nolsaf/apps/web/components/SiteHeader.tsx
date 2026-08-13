"use client";
import Link from "next/link";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Image from "next/image";
import { Bell, LifeBuoy, Settings as SettingsIcon, RefreshCw, Download, Sliders, Plus, FileText, Shield, Lock, Truck, User, Gift, Calendar, LogOut, ChevronDown, Trophy, Share2, Building2, CheckCircle, Home, DollarSign, LayoutDashboard, Clock } from "lucide-react";
import dynamic from 'next/dynamic';
import { clearAuthToken } from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
const LegalModal = dynamic(() => import('@/components/LegalModal'), { ssr: false });
import ClientErrorBoundary from '@/components/ClientErrorBoundary';

// Add dropdown animation styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fade-in-up {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    @keyframes slide-in-right {
      from {
        opacity: 0;
        transform: translateX(10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    @keyframes scale-in {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
    @keyframes slide-down {
      from {
        opacity: 0;
        transform: translateY(-20px);
        max-height: 0;
      }
      to {
        opacity: 1;
        transform: translateY(0);
        max-height: 1000px;
      }
    }
    @keyframes slide-up {
      from {
        opacity: 1;
        transform: translateY(0);
        max-height: 1000px;
      }
      to {
        opacity: 0;
        transform: translateY(-20px);
        max-height: 0;
      }
    }
    @keyframes fade-in-stagger {
      from {
        opacity: 0;
        transform: translateX(-10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    .animate-fade-in-up {
      animation: fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .animate-slide-in-right {
      animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .animate-scale-in {
      animation: scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .animate-slide-down {
      animation: slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .animate-fade-in-stagger {
      animation: fade-in-stagger 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .glass-effect {
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .mobile-menu-item {
      animation-delay: calc(var(--delay) * 50ms);
    }

    @keyframes session-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    .animate-session-blink {
      animation: session-blink 1s ease-in-out infinite;
    }
  `;
  style.setAttribute('data-dropdown-animations', 'true');
  if (!document.head.querySelector('style[data-dropdown-animations]')) {
    document.head.appendChild(style);
  }
}

export default function SiteHeader({
  role = "OWNER",
  unreadMessages = 0,
  driverMode = false,
}: { role?: "ADMIN" | "OWNER" | "DRIVER" | "CUSTOMER"; unreadMessages?: number; driverMode?: boolean }) {
  const [open, setOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isAdmin = role === "ADMIN";
  const isOwner = role === "OWNER";
  const isDriver = driverMode || role === "DRIVER";
  const sidebarToggleEvent: "toggle-admin-sidebar" | "toggle-owner-sidebar" | "toggle-driver-sidebar" | null =
    isAdmin ? "toggle-admin-sidebar" : isDriver ? "toggle-driver-sidebar" : isOwner ? "toggle-owner-sidebar" : null;
  const showSidebarToggle = sidebarToggleEvent !== null;
  const logoutRedirect = isAdmin
    ? "/admin/login"
    : isOwner
      ? "/owner/login"
      : isDriver
        ? "/driver/login"
        : "/account/login";
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [touchedIcon, setTouchedIcon] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const profileDropdownMenuRef = useRef<HTMLDivElement>(null);
  const [profileDropdownPlacement, setProfileDropdownPlacement] = useState<"down" | "up">("down");

  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [sessionRemainingSec, setSessionRemainingSec] = useState<number | null>(null);
  const logoutInProgressRef = useRef(false);

  const logoutAndRedirect = useCallback(async () => {
    if (logoutInProgressRef.current) return;
    logoutInProgressRef.current = true;
    setOpen(false);
    setProfileDropdownOpen(false);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Redirect anyway; the server already considers the session expired.
    } finally {
      clearAuthToken();
      window.location.replace(logoutRedirect);
    }
  }, [logoutRedirect]);

  useEffect(() => {
    if (!isAdmin) return;

    const onAdminNotification = () => {
      setUnreadCount((current) => (current ?? 0) + 1);
    };

    window.addEventListener("nols:admin-notification", onAdminNotification);
    const onUnreadChange = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number; delta?: number }>).detail;
      setUnreadCount((current) => typeof detail?.count === "number" ? Math.max(0, detail.count) : Math.max(0, (current ?? 0) + (detail?.delta ?? 0)));
    };
    window.addEventListener("nols:admin-unread-change", onUnreadChange);
    return () => {
      window.removeEventListener("nols:admin-notification", onAdminNotification);
      window.removeEventListener("nols:admin-unread-change", onUnreadChange);
    };
  }, [isAdmin]);

  const openAdminNotifications = () => window.dispatchEvent(new Event("nols:admin-notifications:open"));

  const handleTouch = (id: string) => {
    setTouchedIcon(id);
    // clear after 2s so touch shows the hover state briefly
    window.setTimeout(() => setTouchedIcon((v) => (v === id ? null : v)), 2000);
  };

  useEffect(() => {
    // Set navigation context for policy pages based on role
    if (typeof window !== 'undefined') {
      const context = role.toLowerCase() as 'owner' | 'driver' | 'admin';
      sessionStorage.setItem('navigationContext', context);
    }

    // fetch unread count when running in browser for admin
    (async () => {
      if (role !== "ADMIN") return;
      const ac = new AbortController();
      const t = window.setTimeout(() => ac.abort(), 8_000);
      try {
        // Use relative paths in browser to leverage Next.js rewrites (avoids CORS issues)
        const url = '/api/admin/notifications?tab=unread&page=1&pageSize=1';
        const r = await fetch(url, { credentials: 'include', signal: ac.signal });
        if (!r.ok) return;
        const data = await r.json();
        if (typeof data.totalUnread === 'number') setUnreadCount(data.totalUnread);
      } catch {
        // ignore — 502 / timeout: no unread badge shown, non-critical
      } finally {
        window.clearTimeout(t);
      }
    })();

    // fetch user profile to get avatar/name/email
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
        // ignore — 502 / timeout: avatar/name simply stays empty, non-critical
      } finally {
        window.clearTimeout(t);
      }
    })();


    if (typeof window === 'undefined') return;
    // Close settings dropdown when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-settings-dropdown]')) {
        setSettingsOpen(false);
      }
      // Close profile dropdown when clicking outside
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(target as Node)) {
        setProfileDropdownOpen(false);
      }
      
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [role]);

  useEffect(() => {
    if (!profileDropdownOpen) return;

    const computePlacement = () => {
      const anchorEl = profileDropdownRef.current;
      const menuEl = profileDropdownMenuRef.current;
      if (!anchorEl || !menuEl) return;
      const anchorRect = anchorEl.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();

      const margin = 12;
      const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - margin;

      // Prefer opening down when it fits. Otherwise, open up if it gives more space.
      if (spaceBelow >= menuRect.height) setProfileDropdownPlacement("down");
      else if (spaceAbove >= menuRect.height) setProfileDropdownPlacement("up");
      else setProfileDropdownPlacement(spaceAbove > spaceBelow ? "up" : "down");
    };

    const raf = window.requestAnimationFrame(computePlacement);
    window.addEventListener("resize", computePlacement);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", computePlacement);
    };
  }, [profileDropdownOpen]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    async function loadSessionCountdown() {
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
        const expiresAt = typeof json?.expiresAt === "string" ? json.expiresAt : null;
        const remainingSec = typeof json?.remainingSec === "number" ? json.remainingSec : null;
        setSessionExpiresAt(expiresAt);
        setSessionRemainingSec(remainingSec);
      } catch {
        // ignore — 502 / timeout: session countdown simply not shown
      } finally {
        window.clearTimeout(t);
      }
    }

    loadSessionCountdown();
    const refreshId = window.setInterval(loadSessionCountdown, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
    };
  }, [isAdmin, logoutAndRedirect]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!sessionExpiresAt) return;

    const expiryMs = new Date(sessionExpiresAt).getTime();
    if (!Number.isFinite(expiryMs)) return;

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
      setSessionRemainingSec(remaining);
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [isAdmin, sessionExpiresAt]);

  useEffect(() => {
    if (!isAdmin) return;
    if (typeof sessionRemainingSec !== "number") return;
    if (sessionRemainingSec <= 0) void logoutAndRedirect();
  }, [isAdmin, logoutAndRedirect, sessionRemainingSec]);

  const sessionCountdownLabel = useMemo(() => {
    if (!isAdmin) return null;
    if (typeof sessionRemainingSec !== "number") return null;
    const minutes = Math.floor(sessionRemainingSec / 60);
    const seconds = sessionRemainingSec % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [isAdmin, sessionRemainingSec]);

  const sessionCountdownTone = useMemo(() => {
    if (!isAdmin) return "neutral" as const;
    if (typeof sessionRemainingSec !== "number") return "neutral" as const;
    if (sessionRemainingSec <= 5 * 60) return "critical" as const;
    return "neutral" as const;
  }, [isAdmin, sessionRemainingSec]);

  // Note: adminSidebarVisible state is no longer needed since menu icon is fixed

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Refresh the current page
      window.location.reload();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExportInvoices = () => {
    (async () => {
      try {
        // Use relative paths in browser to leverage Next.js rewrites (avoids CORS issues)
        const defaultUrl = '/api/owner/revenue/invoices.csv';
        const endpoint = process.env.NEXT_PUBLIC_EXPORT_INVOICES_ENDPOINT || defaultUrl;

        const filenameTemplate = process.env.NEXT_PUBLIC_EXPORT_INVOICES_FILENAME || 'invoices.csv';
        const date = new Date().toISOString().split('T')[0];
        const filename = filenameTemplate.replace('{date}', date);

        // Uses secure httpOnly cookie session; no x-role or localStorage token.
        const resp = await fetch(endpoint, { credentials: "include" });
        if (!resp.ok) throw new Error(`Export failed (${resp.status})`);
        const blob = await resp.blob();
        const a = document.createElement('a');
        const downloadUrl = window.URL.createObjectURL(blob);
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
      } catch (err: any) {
        console.error('Export failed', err);
        alert('Export failed. Check console for details.');
      }
    })();
  };
  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));

  const handleWidgetPreferences = () => {
    alert("Widget preferences clicked");
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 text-white transition-all duration-300 ${
        isAdmin
          ? 'bg-transparent'
          : (isOwner || driverMode)
          ? 'bg-[#02665e]'
          : 'bg-brand-primary'
      }`}
      style={
        driverMode
          ? {
              background: 'linear-gradient(135deg, #02665e 0%, #014d47 100%)',
              textShadow: '0 2px 4px rgba(0, 0, 0, 0.2), 0 0 8px rgba(0, 0, 0, 0.15)',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
            }
          : isOwner
          ? {
              background: 'linear-gradient(135deg, #02665e 0%, #014d47 100%)',
              textShadow: '0 2px 4px rgba(0, 0, 0, 0.2), 0 0 8px rgba(0, 0, 0, 0.15)',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
            }
          : undefined
      }
    >
      {isAdmin && (
        <>
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                'radial-gradient(900px circle at 20% 0%, rgba(2,102,94,0.16), transparent 52%), radial-gradient(900px circle at 80% 0%, rgba(56,189,248,0.10), transparent 55%), linear-gradient(to bottom, rgba(2,6,23,0.80), rgba(2,6,23,0.15) 70%, rgba(2,6,23,0.00))',
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10" aria-hidden />
        </>
      )}

      {/* Fixed menu icon for non-admin roles (kept outside the pill). */}
      {!isAdmin ? (
        <button
          onClick={() => {
            if (!sidebarToggleEvent) return;
            try {
              const evt = new CustomEvent(sidebarToggleEvent, { detail: { source: "header" } });
              window.dispatchEvent(evt);
            } catch {
              // ignore
            }
          }}
          aria-label="Toggle sidebar"
          className={`group fixed left-4 top-3 z-[80] inline-flex items-center justify-center h-10 w-10 rounded-2xl transition-all duration-300 ease-out ${
            isAdmin
              ? "bg-[#02665e]/25 backdrop-blur-md border border-[#02665e]/35 hover:bg-[#02665e]/35 hover:border-[#02665e]/45"
              : "bg-white/10 backdrop-blur-md border border-white/15 hover:bg-white/15 hover:border-white/25"
          } hover:scale-105 active:scale-95 ${showSidebarToggle ? "" : "opacity-0 pointer-events-none"}`}
        >
          <svg
            className="w-5 h-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}

      <div
        className={`public-container h-16 flex items-center ${
          showSidebarToggle ? (isAdmin ? '' : 'pl-14') : ''
        } relative`}
      >
        <div
          className={`w-full h-14 rounded-3xl border border-white/10 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.40),0_0_50px_rgba(2,102,94,0.14)] flex items-center justify-between px-5 md:px-6 relative overflow-visible ${
            isAdmin
              ? 'bg-gradient-to-b from-[#0b1220]/90 via-[#0a1624]/75 to-[#070f1a]/85'
              : (isOwner || driverMode)
              ? 'bg-white/5'
              : 'bg-white/0'
          }`}
        >
        {/* Admin: hamburger inside the pill line */}
        {isAdmin ? (
          <button
            onClick={() => {
              if (!sidebarToggleEvent) return;
              try {
                const evt = new CustomEvent(sidebarToggleEvent, { detail: { source: "header" } });
                window.dispatchEvent(evt);
              } catch {
                // ignore
              }
            }}
            aria-label="Toggle sidebar"
            className={`group inline-flex items-center justify-center h-10 w-10 rounded-2xl transition-all duration-300 ease-out ${
              "bg-[#02665e]/25 backdrop-blur-md border border-[#02665e]/35 hover:bg-[#02665e]/35 hover:border-[#02665e]/45"
            } hover:scale-105 active:scale-95 ${showSidebarToggle ? "" : "opacity-0 pointer-events-none"}`}
          >
            <svg
              className="w-5 h-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}

        {isAdmin ? null : isOwner ? null : driverMode ? (
          <Link href="/driver" className="inline-flex items-center transition-opacity duration-300 hover:opacity-80" aria-label="NoLSAF Home">
            <Image
              src="/assets/nolsnewlog.png"
              alt="NoLSAF"
              width={120}
              height={30}
              className="h-8 w-auto"
            />
          </Link>
        ) : null}

        {/* driverMode: no textual controls here; icons live in the right-side group below */}

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-2 md:absolute md:right-3 md:top-1/2 md:-translate-y-1/2">
          {isAdmin ? (
            <div className="flex items-center gap-1">
              {sessionCountdownLabel && (
                <div
                  className={`group relative inline-flex items-center gap-2 h-10 px-3 rounded-xl border backdrop-blur-sm transition-all duration-300 ease-out hover:scale-105 active:scale-95 select-none ${
                    sessionCountdownTone === "critical"
                      ? "border-rose-300/35 bg-rose-500/15 hover:bg-rose-500/20 hover:border-rose-200/40 text-rose-100 animate-session-blink"
                        : "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-white/85"
                  }`}
                  title={sessionExpiresAt ? `Session ends at ${new Date(sessionExpiresAt).toLocaleTimeString()}` : "Session time remaining"}
                >
                  <span
                    className={`h-2 w-2 rounded-full ring-2 ring-white/10 transition-colors duration-300 ${
                      sessionCountdownTone === "critical"
                        ? "bg-rose-300/90"
                          : "bg-emerald-300/80"
                    }`}
                    aria-hidden
                  />
                  <Clock className="h-4 w-4 opacity-90" aria-hidden />
                  <span className="text-[11px] font-semibold tracking-wide text-white/70 hidden lg:inline">SESSION</span>
                  <span className="tabular-nums text-sm font-extrabold tracking-tight">{sessionCountdownLabel}</span>
                </div>
              )}

              <button
                onClick={handleRefresh}
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-lg bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/15 hover:border-white/25 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Refresh"
                title="Refresh"
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
              </button>

              <button
                onClick={handleWidgetPreferences}
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-lg bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/15 hover:border-white/25 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Widget Preferences"
                title="Widget Preferences"
              >
                <Sliders className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 group-hover:rotate-90" />
              </button>

              <button
                onClick={openAdminNotifications}
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 group-hover:scale-110" />
                {(unreadCount ?? unreadMessages) > 0 && (
                <span
                    className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-rose-500 text-[9px] leading-3.5 text-white font-semibold ring-1 ring-white/50 text-center flex items-center justify-center"
                  aria-label={`${unreadCount ?? unreadMessages} unread notifications`}
                >
                  {(unreadCount ?? unreadMessages) > 9 ? "9+" : (unreadCount ?? unreadMessages)}
                </span>
                )}
              </button>

              <Link 
                href="/admin/support" 
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out" 
                aria-label="Support" 
                title="Support"
              >
                <LifeBuoy className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 group-hover:rotate-12" />
              </Link>

              <Link 
                href="/admin/management/settings" 
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out" 
                aria-label="Settings" 
                title="Settings"
              >
                <SettingsIcon className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 group-hover:rotate-90" />
              </Link>

              <div className="mx-1 h-6 w-px bg-white/15" />

              <div ref={profileDropdownRef} className="relative z-[90]">
                <button
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="group inline-flex items-center justify-center gap-2 h-10 px-2 rounded-xl bg-transparent border-0 hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/30"
                  aria-label="Profile menu"
                  aria-expanded={profileDropdownOpen}
                >
                  {avatarUrl ? (
                    <div className="relative h-9 w-9 rounded-full overflow-hidden transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                      <Image src={avatarUrl} alt="Profile" fill sizes="36px" unoptimized={bypassAvatarOptimizer} className="object-cover transition-transform duration-300 ease-out group-hover:scale-110" />
                    </div>
                  ) : (
                    <div className="h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10 bg-white/10 border border-white/20">
                      <User className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-opacity duration-300" />
                    </div>
                  )}
                  <ChevronDown className={`h-4 w-4 text-white opacity-90 transition-all duration-300 ease-out ${profileDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {profileDropdownOpen && (
                  <div
                    ref={profileDropdownMenuRef}
                    className={`absolute right-0 w-64 rounded-2xl overflow-hidden z-[95] animate-fade-in-up max-h-[calc(100vh-6rem)] overflow-y-auto border border-white/10 bg-gradient-to-b from-[#0b1220]/95 via-[#0a1624]/90 to-[#070f1a]/95 shadow-[0_24px_80px_rgba(0,0,0,0.55),0_0_40px_rgba(2,102,94,0.18)] backdrop-blur-xl ${
                      profileDropdownPlacement === "down" ? "top-full mt-3" : "bottom-full mb-3"
                    }`}
                  >
                    {/* Profile Info Section */}
                    <div className="px-3.5 py-3 border-b border-white/10 bg-white/5">
                      <div className="flex items-center gap-3">
                        {avatarUrl ? (
                          <div className="relative h-10 w-10 rounded-full border border-white/15 overflow-hidden flex-shrink-0">
                            <Image src={avatarUrl} alt="Profile" fill sizes="40px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                          </div>
                        ) : (
                          <div className="h-10 w-10 rounded-full border border-white/15 bg-white/5 flex items-center justify-center flex-shrink-0">
                            <Shield className="h-5 w-5 text-teal-200" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-semibold text-sm text-white truncate">
                              {userName || 'Administrator'}
                            </div>
                            <div className="flex-shrink-0" title="Administrator Account">
                              <Shield className="h-4 w-4 text-teal-200/90" />
                            </div>
                          </div>
                          <div className="text-xs text-white/70 truncate mt-0.5">
                            {userEmail || 'No email'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Menu Items */}
                    <div className="py-2">
                      <Link
                        href="/admin"
                        onClick={() => setProfileDropdownOpen(false)}
                        className="group flex items-center gap-3 mx-2 rounded-xl px-3 py-2 text-sm text-white/90 bg-transparent hover:bg-white/10 active:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99] no-underline"
                      >
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 transition-all duration-200 ease-out group-hover:bg-white/10 group-hover:border-white/20">
                          <LayoutDashboard className="h-4 w-4 text-white/75 transition-all duration-200 ease-out group-hover:text-white group-hover:scale-105" />
                        </span>
                        <span className="font-medium">Dashboard</span>
                      </Link>

                      <Link
                        href="/admin/profile"
                        onClick={() => setProfileDropdownOpen(false)}
                        className="group flex items-center gap-3 mx-2 rounded-xl px-3 py-2 text-sm text-white/90 bg-transparent hover:bg-white/10 active:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99] no-underline"
                      >
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 transition-all duration-200 ease-out group-hover:bg-white/10 group-hover:border-white/20">
                          <User className="h-4 w-4 text-white/75 transition-all duration-200 ease-out group-hover:text-white group-hover:scale-105" />
                        </span>
                        <span className="font-medium">My Profile</span>
                      </Link>

                      <Link
                        href="/admin/management/settings"
                        onClick={() => setProfileDropdownOpen(false)}
                        className="group flex items-center gap-3 mx-2 rounded-xl px-3 py-2 text-sm text-white/90 bg-transparent hover:bg-white/10 active:bg-white/10 transition-all duration-200 ease-out active:scale-[0.99] no-underline"
                      >
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 transition-all duration-200 ease-out group-hover:bg-white/10 group-hover:border-white/20">
                          <SettingsIcon className="h-4 w-4 text-white/75 transition-all duration-200 ease-out group-hover:text-white group-hover:scale-105" />
                        </span>
                        <span className="font-medium">Settings</span>
                      </Link>

                      <div className="my-2 mx-3 h-px bg-white/10" />

                      <button
                        onClick={logoutAndRedirect}
                        className="group w-[calc(100%-1rem)] mx-2 flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-rose-200 bg-transparent hover:bg-rose-500/10 active:bg-rose-500/10 transition-all duration-200 ease-out active:scale-[0.99] appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/30"
                      >
                        <span className="grid place-items-center h-9 w-9 rounded-xl bg-white/5 border border-white/10 transition-all duration-200 ease-out group-hover:bg-rose-500/10 group-hover:border-rose-200/30">
                          <LogOut className="h-4 w-4 transition-all duration-200 ease-out group-hover:text-rose-100 group-hover:scale-105" />
                        </span>
                        <span className="font-semibold">Logout</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          ) : null}

          {/* left side for owners is intentionally blank here; owner actions render to the right */}
        </nav>

        {/* Owner right-side icon group (md+). Rendered after the nav so it aligns to the far right.
            If driverMode is enabled (driver dashboard) render a reduced set of icons only. */}
        {driverMode ? (
          <div className="hidden md:inline-flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              aria-label="Refresh"
              title="Refresh"
              onTouchStart={() => handleTouch('refresh')}
              onTouchEnd={() => setTouchedIcon(null)}
            >
              <RefreshCw className={`h-5 w-5 opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
            </button>

            <Link 
              href="/driver/notifications" 
              className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              aria-label="Notifications" 
              title="Notifications"
              onTouchStart={() => handleTouch('notifications')}
              onTouchEnd={() => setTouchedIcon(null)}
            >
              <Bell className="h-5 w-5 opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out group-hover:animate-pulse" />
              <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[10px] leading-4 text-white font-semibold ring-2 ring-[#02665e] text-center animate-scale-in">
                0
              </span>
            </Link>

            <Link 
              href="/driver/support" 
              className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
              aria-label="Request assistance" 
              title="Request assistance"
              onTouchStart={() => handleTouch('support')}
              onTouchEnd={() => setTouchedIcon(null)}
            >
              <LifeBuoy className="h-5 w-5 opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out group-hover:rotate-12" />
            </Link>

            <div className="relative" data-settings-dropdown>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsOpen(!settingsOpen);
                }}
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl bg-transparent border-0 text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Settings"
                title="Settings"
                onTouchStart={() => handleTouch('settings')}
                onTouchEnd={() => setTouchedIcon(null)}
              >
                <SettingsIcon className={`h-5 w-5 opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out ${settingsOpen ? 'rotate-90' : 'group-hover:rotate-45'}`} />
              </button>

              {settingsOpen && (
                <div className="absolute right-0 top-full mt-3 w-72 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 py-2 z-50 animate-fade-in-up overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100/50 bg-gradient-to-r from-emerald-50/30 to-slate-50/30">
                    <h3 className="font-semibold text-gray-900 text-sm">Management</h3>
                  </div>

                  <div className="py-1.5">
                    <Link
                      href="/driver/management?tab=documents"
                      onClick={() => setSettingsOpen(false)}
                      className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1"
                    >
                      <div className="font-medium flex items-center gap-2.5">
                        <FileText className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Documents</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">License, insurance, contracts</div>
                    </Link>

                    <Link
                      href="/driver/management?tab=safety"
                      onClick={() => setSettingsOpen(false)}
                      className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1"
                    >
                      <div className="font-medium flex items-center gap-2.5">
                        <Shield className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Safety Measures</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">Incidents and safety summary</div>
                    </Link>

                    <Link
                      href="/driver/security"
                      onClick={() => setSettingsOpen(false)}
                      className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1"
                    >
                      <div className="font-medium flex items-center gap-2.5">
                        <Lock className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Security</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">Password and contact details</div>
                    </Link>

                    <Link
                      href="/driver/management?tab=settings"
                      onClick={() => setSettingsOpen(false)}
                      className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1"
                    >
                      <div className="font-medium flex items-center gap-2.5">
                        <Truck className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Vehicle Settings</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">Vehicle details and registration</div>
                    </Link>
                  </div>
                </div>
              )}
            </div>

            <div className="mx-1 h-6 w-px bg-white/20" />

            <div ref={profileDropdownRef} className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="group inline-flex items-center justify-center gap-2 h-10 px-2 rounded-xl bg-transparent border-0 hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Profile menu"
                aria-expanded={profileDropdownOpen}
                onTouchStart={() => handleTouch('profile')}
                onTouchEnd={() => setTouchedIcon(null)}
              >
                {avatarUrl ? (
                  <div className="relative h-9 w-9 rounded-full overflow-hidden transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                    <Image src={avatarUrl} alt="Profile" fill sizes="36px" unoptimized={bypassAvatarOptimizer} className="object-cover transition-transform duration-300 ease-out group-hover:scale-110" />
                  </div>
                ) : (
                  <div className="h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                    <User className="h-5 w-5 text-white/90" />
                  </div>
                )}
                <ChevronDown className={`h-4 w-4 text-white/90 transition-all duration-300 ease-out ${profileDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 top-full mt-3 w-64 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden z-50 animate-fade-in-up">
                  {/* Profile Info Section */}
                  <div className="px-4 py-3 border-b border-gray-100/50 bg-gradient-to-r from-emerald-50/40 to-slate-50/40">
                    <div className="flex items-center gap-3">
                      {avatarUrl ? (
                        <div className="relative h-10 w-10 rounded-full border-2 border-emerald-200 overflow-hidden flex-shrink-0 transition-transform duration-300 hover:scale-110 ring-2 ring-emerald-100">
                          <Image src={avatarUrl} alt="Profile" fill sizes="40px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                        </div>
                      ) : (
                        <div className="h-10 w-10 rounded-full border-2 border-emerald-200 bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center flex-shrink-0 transition-transform duration-300 hover:scale-110 ring-2 ring-emerald-100">
                          <User className="h-5 w-5 text-emerald-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 truncate">
                          {userName || 'Driver'}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {userEmail || 'No email'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-1.5">
                    <Link
                      href="/driver/profile"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <User className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Profile</span>
                    </Link>

                    <Link
                      href="/driver/bonus"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Gift className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Bonus</span>
                    </Link>

                    <Link
                      href="/driver/level"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Trophy className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Level</span>
                    </Link>

                    <Link
                      href="/driver/referral"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Share2 className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Referral</span>
                    </Link>

                    <Link
                      href="/driver/history"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Calendar className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">History</span>
                    </Link>

                    <Link
                      href="/driver/management"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <SettingsIcon className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Setting</span>
                    </Link>

                    <div className="my-1 mx-2 h-px bg-gray-200" />

                    <button
                      onClick={logoutAndRedirect}
                      className="group w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50/50 transition-all duration-200 no-underline"
                    >
                      <LogOut className="h-4 w-4 group-hover:scale-110 transition-all duration-200" />
                      <span className="font-medium">Logout</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : isOwner ? (
          <div className="hidden md:inline-flex items-center gap-1">
            <button
              onClick={handleRefresh}
              className={`inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === 'refresh' ? 'bg-white/10' : ''}`}
              aria-label="Refresh"
              title="Refresh"
              onTouchStart={() => handleTouch('refresh')}
            >
              <RefreshCw className={`h-5 w-5 text-white ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={handleExportInvoices}
              className={`inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === 'export' ? 'bg-white/10' : ''}`}
              aria-label="Export Invoices CSV"
              title="Export Invoices CSV"
              onTouchStart={() => handleTouch('export')}
            >
              <Download className="h-5 w-5 text-white" />
            </button>

            <Link
              href="/owner/properties/add"
              className={`inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === 'add' ? 'bg-white/10' : ''}`}
              aria-label="Add property"
              title="Add new property"
              onTouchStart={() => handleTouch('add')}
            >
              <Plus className="h-5 w-5 text-white" />
            </Link>

            <Link href="/owner/support" className={`inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === 'support' ? 'bg-white/10' : ''}`} aria-label="Request assistance" title="Request assistance" onTouchStart={() => handleTouch('support')}>
              <LifeBuoy className="h-5 w-5 text-white" />
            </Link>

            <Link href="/owner/notifications" className={`relative inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === 'notifications' ? 'bg-white/10' : ''}`} aria-label="Notifications" title="Notifications" onTouchStart={() => handleTouch('notifications')}>
              <Bell className="h-5 w-5 text-white" />
              <span className="absolute -top-0.5 -right-0.5 h-3 min-w-3 px-0.5 rounded-full bg-rose-500 text-[9px] leading-3 text-white font-semibold ring-1 ring-white/50 text-center">{unreadMessages > 9 ? '9+' : unreadMessages}</span>
            </Link>

            <Link href="/owner/settings" className={`inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === 'settings' ? 'bg-white/10' : ''}`} aria-label="Settings" title="Settings" onTouchStart={() => handleTouch('settings')}>
              <SettingsIcon className="h-5 w-5 text-white" />
            </Link>

            <div className="mx-2 h-5 w-px bg-white/20" />

            <div ref={profileDropdownRef} className="relative">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="group inline-flex items-center justify-center gap-2 h-10 px-2 rounded-xl bg-transparent border-0 hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Profile menu"
                aria-expanded={profileDropdownOpen}
                onTouchStart={() => handleTouch('profile')}
                onTouchEnd={() => setTouchedIcon(null)}
              >
              {avatarUrl ? (
                  <div className="relative h-9 w-9 rounded-full overflow-hidden transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                    <Image src={avatarUrl} alt="Profile" fill sizes="36px" unoptimized={bypassAvatarOptimizer} className="object-cover transition-transform duration-300 ease-out group-hover:scale-110" />
                </div>
              ) : (
                  <div className="h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                    <User className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
              )}
                <ChevronDown className={`h-4 w-4 text-white opacity-90 transition-all duration-300 ease-out ${profileDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 top-full mt-3 w-72 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden z-50 animate-fade-in-up">
                  {/* Profile Info Section */}
                  <div className="px-4 py-4 border-b border-gray-100/50 bg-gradient-to-br from-emerald-50 via-emerald-50/50 to-slate-50/30">
                    <div className="flex items-center gap-3 mb-3">
                      {avatarUrl ? (
                        <div className="relative h-12 w-12 rounded-full border-2 border-emerald-300 overflow-hidden flex-shrink-0 transition-transform duration-300 hover:scale-110 ring-2 ring-emerald-100">
                          <Image src={avatarUrl} alt="Profile" fill sizes="48px" unoptimized={bypassAvatarOptimizer} className="object-cover" />
                        </div>
                      ) : (
                        <div className="h-12 w-12 rounded-full border-2 border-emerald-300 bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center flex-shrink-0 transition-transform duration-300 hover:scale-110 ring-2 ring-emerald-100">
                          <User className="h-6 w-6 text-emerald-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-bold text-base text-gray-900 truncate">
                            {userName || 'Owner'}
                          </div>
                          <div className="flex-shrink-0" title="Verified Account">
                            <CheckCircle className="h-4 w-4 text-emerald-600" />
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 truncate mt-0.5">
                          {userEmail || 'No email'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-2">
                    <Link
                      href="/owner"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Home className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Dashboard</span>
            </Link>

                    <Link
                      href="/owner/profile"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <User className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Profile</span>
                    </Link>

                    <Link
                      href="/owner/properties/approved"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Building2 className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Properties</span>
                    </Link>

                    <Link
                      href="/owner/bookings"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <Calendar className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Bookings</span>
                    </Link>

                    <Link
                      href="/owner/revenue"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <DollarSign className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Revenues</span>
                    </Link>

                    <Link
                      href="/owner/settings"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline"
                    >
                      <SettingsIcon className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Settings</span>
                    </Link>

                    <div className="my-2 mx-3 h-px bg-gray-200" />

                    <button
                      onClick={logoutAndRedirect}
                      className="group w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-all duration-200 no-underline rounded-lg mx-1"
                    >
                      <LogOut className="h-4 w-4 group-hover:scale-110 transition-all duration-200" />
                      <span className="font-semibold">Logout</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Mobile burger */}
        <button
          className={`md:hidden inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/15 hover:border-white/20 active:scale-95 transition-all duration-300 ease-out ${open ? 'bg-white/15 border-white/25' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <svg 
            className={`w-5 h-5 text-white transition-all duration-300 ease-out ${open ? 'rotate-90' : ''}`} 
            viewBox="0 0 24 24" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            aria-hidden
          >
            {open ? (
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <>
          {/* Backdrop overlay */}
          <div 
            className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Mobile menu drawer */}
          <div
            className={`md:hidden relative z-50 border-t border-white/10 backdrop-blur-xl animate-slide-down overflow-hidden ${driverMode ? "bg-[#02665e]/98" : isAdmin ? "bg-[#02665e]/98" : "bg-brand-primary/98"}`}
            style={{ willChange: 'transform, opacity' }}
          >
            <nav className="public-container py-4 flex flex-col gap-2.5">
              {driverMode ? (
                <>
                  {/* Icon buttons row with staggered animation */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                      onClick={() => {
                        handleRefresh();
                        setOpen(false);
                      }}
                      aria-label="Refresh"
                      title="Refresh"
                      className="mobile-menu-item inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out"
                      style={{ '--delay': 0 } as React.CSSProperties}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={`h-5 w-5 transition-transform duration-300 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <Link
                      href="/driver/notifications"
                      onClick={() => setOpen(false)}
                      className="mobile-menu-item relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out animate-fade-in-stagger"
                      style={{ '--delay': 1 } as React.CSSProperties}
                      aria-label="Notifications"
                    >
                      <Bell className="h-5 w-5 transition-transform duration-300 hover:scale-110" />
                    </Link>
                    <Link
                      href="/driver/support"
                      onClick={() => setOpen(false)}
                      className="mobile-menu-item inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out animate-fade-in-stagger"
                      style={{ '--delay': 2 } as React.CSSProperties}
                      aria-label="Support"
                    >
                      <LifeBuoy className="h-5 w-5 transition-transform duration-300 hover:rotate-12" />
                    </Link>
                    <Link
                      href="/driver/profile"
                      onClick={() => setOpen(false)}
                      className="mobile-menu-item inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out animate-fade-in-stagger"
                      style={{ '--delay': 3 } as React.CSSProperties}
                      aria-label="Profile"
                    >
                      <User className="h-5 w-5 transition-transform duration-300 hover:scale-110" />
                    </Link>
                  </div>
                  
                  {/* Separator with animation */}
                  <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-fade-in-stagger" style={{ '--delay': 4 } as React.CSSProperties} />
                  
                  {/* Navigation links with staggered animation */}
                  <Link 
                    href="/driver/profile" 
                    className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-medium text-white/90 no-underline hover:text-white active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden" 
                    style={{ '--delay': 5 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                    <span className="relative z-10">My Profile</span>
                  </Link>
                  <Link 
                    href="/driver/bonus" 
                    className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-medium text-white/90 no-underline hover:text-white active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden" 
                    style={{ '--delay': 6 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                    <span className="relative z-10">My Bonus</span>
                  </Link>
                  <Link 
                    href="/driver/management" 
                    className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-medium text-white/90 no-underline hover:text-white active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden" 
                    style={{ '--delay': 7 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                    <span className="relative z-10">Management</span>
                  </Link>
                  <Link 
                    href="/account" 
                    className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-medium text-white/90 no-underline hover:text-white active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden" 
                    style={{ '--delay': 8 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                    <span className="relative z-10">Account Settings</span>
                  </Link>
                </>
              ) : isAdmin && (
              <>
                <div className="my-3 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={handleRefresh}
                    aria-label="Refresh"
                    title="Refresh"
                    className="mobile-menu-item group inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out"
                    style={{ '--delay': 0 } as React.CSSProperties}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`h-5 w-5 text-white/90 group-hover:text-white transition-transform duration-300 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
                  </button>
                  <button
                    aria-label="Notifications"
                    title="Notifications"
                    className="mobile-menu-item group relative inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out"
                    style={{ '--delay': 4 } as React.CSSProperties}
                    onClick={() => { setOpen(false); openAdminNotifications(); }}
                  >
                    <Bell className="h-5 w-5 text-white/90 group-hover:text-white transition-transform duration-300 group-hover:scale-110" />
                    {(unreadCount ?? unreadMessages) > 0 && (
                    <span
                        className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[10px] leading-4 text-white font-bold ring-2 ring-[#02665e] text-center flex items-center justify-center"
                      aria-label={`${unreadCount ?? unreadMessages} unread notifications`}
                    >
                      {(unreadCount ?? unreadMessages) > 9 ? "9+" : (unreadCount ?? unreadMessages)}
                    </span>
                    )}
                  </button>
                  <Link
                    href="/admin/support"
                    aria-label="Support"
                    title="Support"
                    className="mobile-menu-item group inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out"
                    style={{ '--delay': 5 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <LifeBuoy className="h-5 w-5 text-white/90 group-hover:text-white transition-transform duration-300 group-hover:rotate-12" />
                  </Link>
                  <Link
                    href="/admin/management/settings"
                    aria-label="Settings"
                    title="Settings"
                    className="mobile-menu-item group inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out"
                    style={{ '--delay': 6 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <SettingsIcon className="h-5 w-5 text-white/90 group-hover:text-white transition-transform duration-300 group-hover:rotate-90" />
                  </Link>
                  <Link
                    href="/admin/profile"
                    aria-label="Profile"
                    title="Profile"
                    className="mobile-menu-item group inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/30 bg-white/10 hover:bg-white/20 hover:border-white/50 active:scale-95 transition-all duration-300 ease-out"
                    style={{ '--delay': 7 } as React.CSSProperties}
                    onClick={() => setOpen(false)}
                  >
                    <User className="h-5 w-5 text-white/90 group-hover:text-white transition-colors duration-300" />
                  </Link>
                </div>
                <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <Link 
                  href="/admin/profile" 
                  className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-medium text-white/90 no-underline hover:text-white active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden"
                  style={{ '--delay': 8 } as React.CSSProperties}
                  onClick={() => setOpen(false)}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                  <span className="relative z-10 flex items-center gap-2">
                    <User className="h-4 w-4" />
                    My Profile
                  </span>
                </Link>
                <Link 
                  href="/admin/management/settings" 
                  className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-medium text-white/90 no-underline hover:text-white active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden"
                  style={{ '--delay': 9 } as React.CSSProperties}
                  onClick={() => setOpen(false)}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-white/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                  <span className="relative z-10 flex items-center gap-2">
                    <SettingsIcon className="h-4 w-4" />
                    Settings
                  </span>
                </Link>
                <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <button
                  onClick={logoutAndRedirect}
                  className="mobile-menu-item group relative px-4 py-3 rounded-xl text-sm font-semibold text-red-300 hover:text-red-100 active:scale-[0.98] transition-all duration-300 ease-out animate-fade-in-stagger overflow-hidden"
                  style={{ '--delay': 10 } as React.CSSProperties}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-500/10 to-red-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-out" />
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-red-400/40 scale-y-0 group-hover:scale-y-100 transition-transform duration-300 ease-out origin-center" />
                  <span className="relative z-10 flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Logout
                  </span>
                </button>
              </>
            )}
            {!isAdmin && (
              <Link href="/account" className="px-3 py-2 rounded-xl text-sm hover:bg-white/10" onClick={() => setOpen(false)}>
                My Account
              </Link>
            )}
          </nav>
        </div>
        </>
      )}
      <ClientErrorBoundary>
        <LegalModal />
      </ClientErrorBoundary>
    </header>
  );
}

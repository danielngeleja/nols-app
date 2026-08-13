"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { clearAuthToken } from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import dynamic from "next/dynamic";
import {
  Bell,
  Calendar,
  ChevronDown,
  FileText,
  Gift,
  LifeBuoy,
  Lock,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  Share2,
  Trophy,
  Truck,
  User,
} from "lucide-react";

import ClientErrorBoundary from "@/components/ClientErrorBoundary";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";

const LegalModal = dynamic(() => import("@/components/LegalModal"), { ssr: false });

// Keep dropdown animation styles consistent with the admin header.
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes fade-in-up {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slide-down {
      from { opacity: 0; transform: translateY(-20px); max-height: 0; }
      to { opacity: 1; transform: translateY(0); max-height: 1000px; }
    }
    @keyframes scale-in {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes fade-in-stagger {
      from { opacity: 0; transform: translateX(-10px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .animate-fade-in-up { animation: fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-slide-down { animation: slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-scale-in { animation: scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-fade-in-stagger { animation: fade-in-stagger 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .glass-effect { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  `;
  style.setAttribute("data-driver-header-animations", "true");
  if (!document.head.querySelector('style[data-driver-header-animations]')) {
    document.head.appendChild(style);
  }
}

export default function DriverSiteHeader({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const [open, setOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(unreadMessages);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  const logoutRedirect = "/driver/login";

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("navigationContext", "driver");
    }

    const fetchUnreadCount = async () => {
      const ac = new AbortController();
      const timeout = window.setTimeout(() => ac.abort(), 8_000);
      try {
        const response = await fetch("/api/driver/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
          signal: ac.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data?.totalUnread === "number") {
          setUnreadCount(data.totalUnread);
        } else if (typeof data?.total === "number") {
          setUnreadCount(data.total);
        }
      } catch {
        // ignore unread badge failures
      } finally {
        window.clearTimeout(timeout);
      }
    };

    fetchUnreadCount();

    const handleWindowFocus = () => {
      fetchUnreadCount();
    };

    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!r.ok) return;
        const data = r.data;
        if (data?.avatarUrl) setAvatarUrl(data.avatarUrl);
        if (data?.displayName ?? data?.fullName ?? data?.name) setUserName(data.displayName ?? data.fullName ?? data.name ?? null);
        if (data?.email) setUserEmail(data.email);
      } catch {
        // ignore
      }
    })();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(target as Node)) {
        setProfileDropdownOpen(false);
      }
      if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(target as Node)) {
        setSettingsOpen(false);
      }
    };

    // Update avatar instantly when the driver uploads a new profile photo
    const handleAvatarUpdated = (e: Event) => {
      try {
        const ce = e as CustomEvent<any>;
        const next = ce?.detail?.avatarUrl;
        if (typeof next === "string" && next.trim()) setAvatarUrl(next.trim());
      } catch { /* ignore */ }
    };

    document.addEventListener("click", handleClickOutside);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("account:avatarUrl", handleAvatarUpdated as EventListener);
    window.addEventListener("nolsaf:profile-updated", handleAvatarUpdated as EventListener);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("account:avatarUrl", handleAvatarUpdated as EventListener);
      window.removeEventListener("nolsaf:profile-updated", handleAvatarUpdated as EventListener);
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      window.location.reload();
    } finally {
      setIsRefreshing(false);
    }
  };
  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 text-white transition-all duration-300 bg-transparent"
    >
      {/* Admin-like ambient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(900px circle at 20% 0%, rgba(2,102,94,0.16), transparent 52%), radial-gradient(900px circle at 80% 0%, rgba(56,189,248,0.10), transparent 55%), linear-gradient(to bottom, rgba(2,6,23,0.80), rgba(2,6,23,0.15) 70%, rgba(2,6,23,0.00))",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/10" aria-hidden />

      <div className="public-container h-16 flex items-center relative">
        <div className="w-full h-14 rounded-3xl border border-white/10 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.40),0_0_50px_rgba(2,102,94,0.14)] flex items-center justify-between px-5 md:px-6 relative bg-gradient-to-b from-[#0b1220]/90 via-[#0a1624]/75 to-[#070f1a]/85">
          {/* Left: sidebar toggle + brand (kept inside bar) */}
          <div className="inline-flex items-center gap-3">
            <button
              onClick={() => {
                try {
                  const evt = new CustomEvent("toggle-driver-sidebar", { detail: { source: "header" } });
                  window.dispatchEvent(evt);
                } catch {
                  // ignore
                }
              }}
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
              className="group hidden md:inline-flex items-center justify-center h-10 w-10 rounded-2xl transition-all duration-300 ease-out bg-[#02665e]/25 backdrop-blur-md border border-[#02665e]/35 hover:bg-[#02665e]/35 hover:border-[#02665e]/45 hover:scale-105 active:scale-95"
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

            <Link href="/driver" className="inline-flex items-center transition-opacity duration-300 hover:opacity-80 no-underline" aria-label="Driver Home">
              <Image
                src="/assets/NoLS2025-04.png"
                alt="NoLSAF"
                width={44}
                height={44}
                sizes="44px"
                loading="eager"
                priority
                className="h-9 w-9 brightness-0 invert"
              />
            </Link>
          </div>

          {/* Right: tools (visible). Action icons scroll on small screens. */}
          <div className="flex items-center gap-2 min-w-0 text-white">
            <div className="-my-1 flex items-center gap-1 min-w-0 overflow-x-auto px-1 py-1 scrollbar-hide text-white">
              <button
                onClick={handleRefresh}
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Refresh"
                title="Refresh"
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out ${isRefreshing ? "animate-spin" : "group-hover:rotate-180"}`} />
              </button>

              <Link
                href="/driver/notifications"
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Notifications"
                title="Notifications"
              >
                <Bell className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out group-hover:animate-pulse" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[10px] leading-4 text-white font-semibold ring-2 ring-[#02665e] text-center animate-scale-in">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>

              <Link
                href="/driver/support"
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Request assistance"
                title="Request assistance"
              >
                <LifeBuoy className="h-5 w-5 text-white opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out group-hover:rotate-12" />
              </Link>
            </div>

            <div ref={settingsDropdownRef} className="relative" data-settings-dropdown>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSettingsOpen(!settingsOpen);
                }}
                className="group relative inline-flex items-center justify-center h-10 w-10 rounded-xl bg-transparent border-0 text-white hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Settings"
                title="Settings"
              >
                <SettingsIcon className={`h-5 w-5 opacity-90 group-hover:opacity-100 transition-all duration-300 ease-out ${settingsOpen ? "rotate-90" : "group-hover:rotate-45"}`} />
              </button>

              {settingsOpen && (
                <div className="absolute right-0 top-full mt-3 w-72 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 py-2 z-50 animate-fade-in-up overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100/50 bg-gradient-to-r from-emerald-50/30 to-slate-50/30">
                    <h3 className="font-semibold text-gray-900 text-sm">Management</h3>
                  </div>

                  <div className="py-1.5">
                    <Link href="/driver/management?tab=documents" onClick={() => setSettingsOpen(false)} className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1">
                      <div className="font-medium flex items-center gap-2.5">
                        <FileText className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Documents</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">License, insurance, contracts</div>
                    </Link>

                    <Link href="/driver/management?tab=safety" onClick={() => setSettingsOpen(false)} className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1">
                      <div className="font-medium flex items-center gap-2.5">
                        <Shield className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Safety Measures</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">Incidents and safety summary</div>
                    </Link>

                    <Link href="/driver/security" onClick={() => setSettingsOpen(false)} className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1">
                      <div className="font-medium flex items-center gap-2.5">
                        <Lock className="h-4 w-4 text-emerald-600 transition-transform duration-200 group-hover:scale-110" />
                        <span>Security</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-6.5 mt-0.5">Password and contact details</div>
                    </Link>

                    <Link href="/driver/management?tab=settings" onClick={() => setSettingsOpen(false)} className="group block px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline rounded-lg mx-1">
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

            <div className="hidden sm:block mx-1 h-6 w-px bg-white/20" />

            <div ref={profileDropdownRef} className="relative flex-shrink-0">
              <button
                onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                className="group inline-flex items-center justify-center gap-2 h-10 px-2 rounded-xl bg-transparent border-0 hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Profile menu"
                aria-expanded={profileDropdownOpen}
              >
                {avatarUrl ? (
                  <div className="h-9 w-9 rounded-full overflow-hidden transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                    <Image src={avatarUrl} alt="Profile" width={36} height={36} unoptimized={bypassAvatarOptimizer} className="object-cover w-full h-full transition-transform duration-300 ease-out group-hover:scale-110" />
                  </div>
                ) : (
                  <div className="h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 ease-out group-hover:ring-2 group-hover:ring-white/10">
                    <User className="h-5 w-5 text-white/90" />
                  </div>
                )}
                <ChevronDown className={`h-4 w-4 text-white/90 transition-all duration-300 ease-out ${profileDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 top-full mt-3 w-64 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden z-50 animate-fade-in-up">
                  <div className="px-4 py-3 border-b border-gray-100/50 bg-gradient-to-r from-emerald-50/40 to-slate-50/40">
                    <div className="flex items-center gap-3">
                      {avatarUrl ? (
                        <div className="h-10 w-10 rounded-full border-2 border-emerald-200 overflow-hidden flex-shrink-0 transition-transform duration-300 hover:scale-110 ring-2 ring-emerald-100">
                          <Image src={avatarUrl} alt="Profile" width={40} height={40} unoptimized={bypassAvatarOptimizer} className="object-cover w-full h-full" />
                        </div>
                      ) : (
                        <div className="h-10 w-10 rounded-full border-2 border-emerald-200 bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center flex-shrink-0 transition-transform duration-300 hover:scale-110 ring-2 ring-emerald-100">
                          <User className="h-5 w-5 text-emerald-600" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 truncate">{userName || "Driver"}</div>
                        <div className="text-xs text-gray-500 truncate">{userEmail || "No email"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="py-1.5">
                    <Link href="/driver/profile" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <User className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Profile</span>
                    </Link>
                    <Link href="/driver/bonus" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Gift className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Bonus</span>
                    </Link>
                    <Link href="/driver/level" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Trophy className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Level</span>
                    </Link>
                    <Link href="/driver/referral" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Share2 className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Referral</span>
                    </Link>
                    <Link href="/driver/history" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Calendar className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">History</span>
                    </Link>
                    <Link href="/driver/management" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50/50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <SettingsIcon className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Setting</span>
                    </Link>

                    <WorkspaceSwitcher currentWorkspace="NORMAL" />

                    <button
                      onClick={async () => {
                        try {
                          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                          clearAuthToken();
                        } catch {}
                        window.location.href = logoutRedirect;
                      }}
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

          {/* Mobile burger */}
          <button
            className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/15 hover:border-white/20 active:scale-95 transition-all duration-300 ease-out"
            onClick={() => {
              try {
                const evt = new CustomEvent("toggle-driver-sidebar", { detail: { source: "mobile-header" } });
                window.dispatchEvent(evt);
              } catch {
                // ignore
              }
            }}
            aria-label="Toggle sidebar"
          >
            <svg
              className="w-5 h-5 text-white transition-all duration-300 ease-out"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <>
          <div className="md:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="md:hidden relative z-50 border-t border-white/10 backdrop-blur-xl animate-slide-down overflow-hidden bg-[#0b1220]/95 text-white" style={{ willChange: "transform, opacity" }}>
            <nav className="mx-auto max-w-6xl px-4 py-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  onClick={() => {
                    handleRefresh();
                    setOpen(false);
                  }}
                  aria-label="Refresh"
                  title="Refresh"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out"
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`h-5 w-5 text-white transition-transform duration-300 ${isRefreshing ? "animate-spin" : ""}`} />
                </button>
                <Link href="/driver/notifications" onClick={() => setOpen(false)} className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out" aria-label="Notifications">
                  <Bell className="h-5 w-5 text-white" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-[10px] leading-4 text-white font-bold ring-2 ring-[#02665e] text-center flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Link>
                <Link href="/driver/support" onClick={() => setOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out" aria-label="Support">
                  <LifeBuoy className="h-5 w-5 text-white" />
                </Link>
                <Link href="/driver/profile" onClick={() => setOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 hover:bg-white/20 hover:border-white/30 active:scale-95 transition-all duration-300 ease-out" aria-label="Profile">
                  <User className="h-5 w-5 text-white" />
                </Link>
              </div>

              <div className="my-2 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />

              <Link href="/driver/profile" className="px-3 py-2 rounded-xl text-sm hover:bg-white/10 no-underline" onClick={() => setOpen(false)}>
                My Profile
              </Link>
              <Link href="/driver/bonus" className="px-3 py-2 rounded-xl text-sm hover:bg-white/10 no-underline" onClick={() => setOpen(false)}>
                My Bonus
              </Link>
              <Link href="/driver/management" className="px-3 py-2 rounded-xl text-sm hover:bg-white/10 no-underline" onClick={() => setOpen(false)}>
                Management
              </Link>
              <Link href="/account" className="px-3 py-2 rounded-xl text-sm hover:bg-white/10 no-underline" onClick={() => setOpen(false)}>
                Account Settings
              </Link>

              <button
                onClick={async () => {
                  setOpen(false);
                  try {
                    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                    clearAuthToken();
                  } catch {}
                  window.location.href = logoutRedirect;
                }}
                className="mt-2 w-full text-left px-3 py-2 rounded-xl text-sm font-semibold text-red-200 hover:text-red-50 hover:bg-white/10 transition-colors"
              >
                Logout
              </button>
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

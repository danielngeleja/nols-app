"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Bell,
  CheckCircle,
  ChevronDown,
  Home,
  LifeBuoy,
  LogOut,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  User,
  Building2,
  Calendar,
  DollarSign,
} from "lucide-react";

import ClientErrorBoundary from "@/components/ClientErrorBoundary";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { clearAuthToken } from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";

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
    @keyframes slide-in-left {
      from { opacity: 0; transform: translateX(-100%); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes fade-in-overlay {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .animate-fade-in-up { animation: fade-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-slide-down { animation: slide-down 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-scale-in { animation: scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-slide-in-left { animation: slide-in-left 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .animate-fade-in-overlay { animation: fade-in-overlay 0.25s ease forwards; }
  `;
  style.setAttribute("data-owner-header-animations", "true");
  if (!document.head.querySelector('style[data-owner-header-animations]')) {
    document.head.appendChild(style);
  }
}

export default function OwnerSiteHeader({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [touchedIcon, setTouchedIcon] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  const logoutRedirect = "/owner/login";

  const handleTouch = (id: string) => {
    setTouchedIcon(id);
    window.setTimeout(() => setTouchedIcon((v) => (v === id ? null : v)), 2000);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("navigationContext", "owner");
    }

    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!r.ok) return;
        const me = r.data;
        if (me?.avatarUrl) setAvatarUrl(me.avatarUrl);
        if (me?.displayName || me?.fullName || me?.name) setUserName(me.displayName || me.fullName || me.name || null);
        if (me?.email) setUserEmail(me.email);
      } catch {
        // ignore
      }
    })();

    if (typeof window === "undefined") return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(target as Node)) {
        setProfileDropdownOpen(false);
      }
    };

    const handleProfileUpdated = (e: Event) => {
      try {
        const ce = e as CustomEvent<any>;
        const nextAvatarUrl = ce?.detail?.avatarUrl;
        if (typeof nextAvatarUrl === "string" && nextAvatarUrl.trim()) {
          setAvatarUrl(nextAvatarUrl.trim());
        }
      } catch {
        // ignore
      }
    };

    document.addEventListener("click", handleClickOutside);
    window.addEventListener("nolsaf:profile-updated", handleProfileUpdated as EventListener);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      window.removeEventListener("nolsaf:profile-updated", handleProfileUpdated as EventListener);
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
      <div className="relative box-border flex h-16 min-w-0 max-w-full items-center px-3">
        <div className="relative box-border flex h-14 min-w-0 max-w-full flex-1 items-center rounded-2xl bg-[#02665e] px-3 sm:px-4 md:px-6">
          {/* Left: mobile burger + desktop sidebar toggle + desktop brand */}
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              className="inline-flex md:hidden items-center justify-center h-10 w-10 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/15 hover:border-white/20 active:scale-95 transition-all duration-300 ease-out"
              onClick={() => {
                try {
                  window.dispatchEvent(new CustomEvent("toggle-owner-sidebar", { detail: { source: "mobile-burger" } }));
                } catch {
                  // ignore
                }
              }}
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              onClick={() => {
                try {
                  const evt = new CustomEvent("toggle-owner-sidebar", { detail: { source: "header" } });
                  window.dispatchEvent(evt);
                } catch {
                  // ignore
                }
              }}
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
              className="group hidden md:inline-flex items-center justify-center h-10 w-10 rounded-2xl transition-all duration-300 ease-out bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/15 hover:border-white/30 hover:scale-105 active:scale-95"
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

            <Link href="/owner" className="inline-flex items-center no-underline hover:opacity-90 transition-opacity" aria-label="Owner Dashboard">
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

          {/* Right: compact mobile actions, full tools from small tablets upward */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2 text-white">
            <div className="flex items-center gap-0.5 sm:gap-1 text-white">
              <button
                onClick={handleRefresh}
                className={`hidden sm:inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === "refresh" ? "bg-white/10" : ""}`}
                aria-label="Refresh"
                title="Refresh"
                onTouchStart={() => handleTouch("refresh")}
              >
                <RefreshCw className={`h-5 w-5 text-white ${isRefreshing ? "animate-spin" : ""}`} />
              </button>

              <Link
                href="/owner/properties/add"
                className={`inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === "add" ? "bg-white/10" : ""}`}
                aria-label="Add property"
                title="Add new property"
                onTouchStart={() => handleTouch("add")}
              >
                <Plus className="h-5 w-5 text-white" />
              </Link>

              <Link
                href="/owner/support"
                className={`hidden sm:inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === "support" ? "bg-white/10" : ""}`}
                aria-label="Request assistance"
                title="Request assistance"
                onTouchStart={() => handleTouch("support")}
              >
                <LifeBuoy className="h-5 w-5 text-white" />
              </Link>

              <Link
                href="/owner/notifications"
                className={`relative inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === "notifications" ? "bg-white/10" : ""}`}
                aria-label="Notifications"
                title="Notifications"
                onTouchStart={() => handleTouch("notifications")}
              >
                <Bell className="h-5 w-5 text-white" />
                {unreadMessages > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-3 min-w-3 px-0.5 rounded-full bg-rose-500 text-[9px] leading-3 text-white font-semibold ring-1 ring-white/50 text-center">
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                )}
              </Link>

              <Link
                href="/owner/settings"
                className={`hidden sm:inline-flex items-center justify-center rounded-md p-1.5 hover:bg-white/10 ${touchedIcon === "settings" ? "bg-white/10" : ""}`}
                aria-label="Settings"
                title="Settings"
                onTouchStart={() => handleTouch("settings")}
              >
                <SettingsIcon className="h-5 w-5 text-white" />
              </Link>
            </div>

            <div className="hidden sm:block mx-1 h-5 w-px bg-white/20" />

            <div ref={profileDropdownRef} className="relative z-[60] flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileDropdownOpen((v) => !v);
                }}
                className="group inline-flex items-center justify-center gap-1.5 h-10 px-2 rounded-xl bg-transparent border-0 hover:bg-white/10 hover:backdrop-blur-sm hover:border hover:border-white/20 hover:scale-105 active:scale-95 transition-all duration-300 ease-out"
                aria-label="Profile menu"
                aria-expanded={profileDropdownOpen}
                onTouchStart={() => handleTouch("profile")}
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
                <ChevronDown className={`h-4 w-4 text-white opacity-90 transition-all duration-300 ease-out ${profileDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {profileDropdownOpen && (
                <div className="absolute right-0 top-full mt-3 w-72 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200/50 overflow-hidden z-50 animate-fade-in-up">
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
                          <div className="font-bold text-base text-gray-900 truncate">{userName || "Owner"}</div>
                          <div className="flex-shrink-0" title="Verified Account">
                            <CheckCircle className="h-4 w-4 text-emerald-600" />
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 truncate mt-0.5">{userEmail || "No email"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="py-2">
                    <Link href="/owner" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Home className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Dashboard</span>
                    </Link>
                    <Link href="/owner/profile" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <User className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Profile</span>
                    </Link>
                    <Link href="/owner/properties/approved" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Building2 className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Properties</span>
                    </Link>
                    <Link href="/owner/bookings" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <Calendar className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Bookings</span>
                    </Link>
                    <Link href="/owner/revenue" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <DollarSign className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">My Revenues</span>
                    </Link>
                    <Link href="/owner/settings" onClick={() => setProfileDropdownOpen(false)} className="group flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-all duration-200 no-underline">
                      <SettingsIcon className="h-4 w-4 text-gray-500 group-hover:text-emerald-600 transition-all duration-200 group-hover:scale-110" />
                      <span className="font-medium">Settings</span>
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
                      className="group flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-all duration-200 no-underline"
                    >
                      <LogOut className="h-4 w-4 group-hover:scale-110 transition-all duration-200" />
                      <span className="font-semibold">Logout</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ClientErrorBoundary>
        <LegalModal />
      </ClientErrorBoundary>
    </header>
  );
}

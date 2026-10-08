"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import {
  BadgeCheck,
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  DoorOpen,
  FileText,
  LifeBuoy,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  User,
  Wallet,
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

/** What an owner starts most often, one tap from anywhere. */
const QUICK_CREATE = [
  { href: "/owner/bookings/validate", label: "Check in a guest", hint: "Validate the guest's code", icon: DoorOpen },
  { href: "/owner/bookings/checked-in", label: "Create an invoice", hint: "From a guest in house", icon: FileText },
  { href: "/owner/properties/add", label: "Add a property", hint: "List a new place to stay", icon: Building2 },
];

export default function OwnerSiteHeader({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const pathname = usePathname() ?? "";
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const logoutRedirect = "/owner/login";

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
      const target = e.target as Node;
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(target)) setProfileDropdownOpen(false);
      if (createRef.current && !createRef.current.contains(target)) setCreateOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setProfileDropdownOpen(false);
      setCreateOpen(false);
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
    document.addEventListener("keydown", handleKey);
    window.addEventListener("nolsaf:profile-updated", handleProfileUpdated as EventListener);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("nolsaf:profile-updated", handleProfileUpdated as EventListener);
    };
  }, []);

  // Menus close when the owner moves to another page.
  useEffect(() => {
    setProfileDropdownOpen(false);
    setCreateOpen(false);
  }, [pathname]);

  const bypassAvatarOptimizer = Boolean(avatarUrl && /^https?:\/\//i.test(avatarUrl));
  const toggleSidebar = () => {
    try {
      const source = window.innerWidth < 768 ? "mobile-burger" : "header";
      window.dispatchEvent(new CustomEvent("toggle-owner-sidebar", { detail: { source } }));
    } catch {
      // ignore
    }
  };
  const firstName = (userName || "").trim().split(/\s+/)[0] || "Owner";
  const avatar = (size: number) =>
    avatarUrl ? (
      <span className="relative block shrink-0 overflow-hidden rounded-full ring-2 ring-[#5eead4]/40" style={{ width: size, height: size }}>
        <Image src={avatarUrl} alt="" fill sizes={`${size}px`} unoptimized={bypassAvatarOptimizer} className="object-cover" />
      </span>
    ) : (
      <span className="grid shrink-0 place-items-center rounded-full bg-[#5eead4] text-xs font-extrabold text-[#012a26]" style={{ width: size, height: size }}>
        {firstName.charAt(0).toUpperCase()}
      </span>
    );
  const menuLink = "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 no-underline transition hover:bg-slate-50 hover:text-slate-900";
  const menuIcon = "h-4 w-4 text-slate-400 transition group-hover:text-[#02665e]";

  return (
    <header className="fixed left-0 right-0 top-0 z-50 bg-transparent text-white">
      <div className="relative box-border flex h-16 min-w-0 max-w-full items-center px-3">
        <div className="relative box-border flex h-14 min-w-0 max-w-full flex-1 items-center gap-3 rounded-2xl bg-[#012a26] px-2.5 shadow-[0_10px_30px_-18px_rgba(1,42,38,0.85),inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:px-3">
          {/* Left: sidebar toggle, mark, and where the owner is */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-solid border-white/10 bg-white/[0.06] text-white transition hover:bg-white/[0.12]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 6h16M4 12h10M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            <Link href="/owner" className="flex min-w-0 items-center no-underline" aria-label="Owner dashboard">
              <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={36} height={36} sizes="36px" loading="eager" priority className="h-8 w-8 shrink-0 brightness-0 invert" />
            </Link>
          </div>

          {/* Right: New, notifications, profile */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div ref={createRef} className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateOpen((open) => !open);
                  setProfileDropdownOpen(false);
                }}
                aria-haspopup="menu"
                aria-expanded={createOpen}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-[#5eead4] px-3 text-sm font-bold text-[#012a26] transition hover:bg-[#8ff3e1] sm:px-3.5"
              >
                <Plus className="h-4 w-4" strokeWidth={2.75} aria-hidden />
                <span className="hidden sm:inline">New</span>
                <span className="sr-only sm:hidden">New</span>
              </button>
              {createOpen && (
                <div role="menu" className="animate-fade-in-up absolute right-0 top-full z-50 mt-3 w-64 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white p-1.5 text-slate-900 shadow-[0_24px_50px_-20px_rgba(15,23,42,0.35)]">
                  {QUICK_CREATE.map((item) => (
                    <Link key={item.href} href={item.href} role="menuitem" onClick={() => setCreateOpen(false)} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 no-underline transition hover:bg-emerald-50/70">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]">
                        <item.icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                        <span className="block text-xs text-slate-500">{item.hint}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <Link
              href="/owner/notifications"
              aria-label={unreadMessages > 0 ? `Notifications, ${unreadMessages} unread` : "Notifications"}
              title="Notifications"
              className="relative grid h-10 w-10 place-items-center rounded-xl text-white/85 no-underline transition hover:bg-white/[0.08] hover:text-white"
            >
              <Bell className="h-5 w-5" aria-hidden />
              {unreadMessages > 0 && (
                <span className="absolute right-1 top-1 h-[18px] min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-[#012a26]">
                  {unreadMessages > 99 ? "99+" : unreadMessages}
                </span>
              )}
            </Link>

            <span className="mx-0.5 hidden h-6 w-px bg-white/10 sm:block" aria-hidden />

            <div ref={profileDropdownRef} className="relative z-[60] shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setProfileDropdownOpen((v) => !v);
                  setCreateOpen(false);
                }}
                className="inline-flex h-11 items-center gap-2.5 rounded-xl border-0 bg-transparent py-1 pl-1 pr-2 text-left text-white transition hover:bg-white/[0.08]"
                aria-label="Profile menu"
                aria-expanded={profileDropdownOpen}
              >
                {avatar(36)}
                <span className="hidden min-w-0 flex-col leading-tight lg:flex">
                  <span className="max-w-[140px] truncate text-sm font-semibold text-white">{userName || "Owner"}</span>
                  <span className="text-[11px] text-white/55">Property owner</span>
                </span>
                <ChevronDown className={`h-4 w-4 text-white/70 transition-transform ${profileDropdownOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>

              {profileDropdownOpen && (
                <div className="animate-fade-in-up absolute right-0 top-full z-50 mt-3 w-72 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white text-slate-900 shadow-[0_24px_50px_-20px_rgba(15,23,42,0.35)]">
                  <div className="flex items-center gap-3 border-0 border-b border-solid border-slate-100 px-4 py-4">
                    {avatar(44)}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="m-0 truncate text-sm font-bold text-slate-900">{userName || "Owner"}</p>
                        <BadgeCheck className="h-4 w-4 shrink-0 text-[#02665e]" aria-label="Verified account" />
                      </div>
                      <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{userEmail || "No email on file"}</p>
                    </div>
                  </div>

                  <div className="p-1.5">
                    <Link href="/owner/profile" className={menuLink}><User className={menuIcon} aria-hidden />My profile</Link>
                    <Link href="/owner/properties/approved" className={menuLink}><Building2 className={menuIcon} aria-hidden />My properties</Link>
                    <Link href="/owner/bookings" className={menuLink}><Calendar className={menuIcon} aria-hidden />All bookings</Link>
                    <Link href="/owner/payouts" className={menuLink}><Wallet className={menuIcon} aria-hidden />My Payouts</Link>
                  </div>
                  <div className="border-0 border-t border-solid border-slate-100 p-1.5">
                    <Link href="/owner/support" className={menuLink}><LifeBuoy className={menuIcon} aria-hidden />Help and support</Link>
                    <Link href="/owner/settings" className={menuLink}><SettingsIcon className={menuIcon} aria-hidden />Settings</Link>
                    <WorkspaceSwitcher currentWorkspace="NORMAL" />
                  </div>
                  <div className="border-0 border-t border-solid border-slate-100 p-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                          clearAuthToken();
                        } catch {}
                        window.location.href = logoutRedirect;
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4" aria-hidden />
                      Log out
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

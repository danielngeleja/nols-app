"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clearAuthToken } from "@/lib/apiClient";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { 
  User, 
  Calendar, 
  Car, 
  Users, 
  Settings, 
  LogOut,
  ChevronRight,
  ClipboardList
} from 'lucide-react';

export default function UserMenu({ variant = "dark" }: { variant?: "light" | "dark" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  const logoutRedirect = "/account/login";

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener('click', onDoc);
      return () => document.removeEventListener('click', onDoc);
    }
  }, [open]);

  // Inject animation keyframes
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const styleId = 'user-menu-animations';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(-8px) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;
    document.head.appendChild(style);
    return () => {
      const existing = document.getElementById(styleId);
      if (existing) existing.remove();
    };
  }, []);

  const menuItems = [
    { href: "/account", label: "My account", icon: User },
    { href: "/account/bookings", label: "My Bookings", icon: Calendar },
    { href: "/account/rides", label: "My Rides", icon: Car },
    { href: "/account/group-stays", label: "My Group Stay", icon: Users },
    { href: "/account/tour-packages", label: "My Tour Packages", icon: ClipboardList },
  ];

  const settingsItems = [
    { href: "/account/security", label: "Settings", icon: Settings },
  ];

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  const buttonClass = variant === "light"
    ? "bg-[#02665e]/10 hover:bg-[#02665e]/15 text-[#02665e] border-[#02665e]/20"
    : "bg-white/10 hover:bg-white/20 text-white border-white/20";

  const menuBgClass = variant === "light"
    ? "bg-white/95 backdrop-blur-xl border-[#02665e]/10"
    : "bg-white/95 backdrop-blur-xl border-gray-200/50";

  const textClass = variant === "light"
    ? "text-gray-800"
    : "text-gray-800";

  const hoverBgClass = variant === "light"
    ? "hover:bg-[#02665e]/8"
    : "hover:bg-[#02665e]/8";

  const activeBgClass = variant === "light"
    ? "bg-[#02665e]/12"
    : "bg-[#02665e]/12";

  return (
    <div ref={ref} className="relative">
      <button
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center justify-center h-9 w-9 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 border ${buttonClass}`}
        title="User menu"
        style={{
          boxShadow: variant === "light" 
            ? "0 2px 8px rgba(2, 102, 94, 0.12)" 
            : "0 2px 8px rgba(0, 0, 0, 0.15)",
        }}
      >
        <User className="h-5 w-5 transition-transform duration-300" aria-hidden />
      </button>

      {open && (
        <div 
          className={`absolute right-0 mt-3 w-56 max-w-none ${menuBgClass} rounded-2xl shadow-2xl ring-1 overflow-hidden z-50`}
          style={{
            animation: "fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            boxShadow: "0 20px 40px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)",
            maxWidth: "none",
          }}
        >
          <div className="py-2">
            {/* Main Menu Items */}
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`group relative flex items-center gap-3 px-4 py-2.5 text-sm font-medium ${textClass} ${hoverBgClass} transition-all duration-200 active:scale-[0.98] no-underline ${
                    active ? activeBgClass : ""
                  }`}
                  style={{
                    animationDelay: `${idx * 30}ms`,
                  }}
                >
                  <Icon 
                    className={`h-4 w-4 transition-all duration-200 ${
                      active ? "text-[#02665e]" : "text-gray-500 group-hover:text-[#02665e]"
                    }`}
                    strokeWidth={active ? 2.5 : 2}
                  />
                  <span className="flex-1">{item.label}</span>
                  {active && (
                    <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-[#02665e] animate-pulse" />
                  )}
                  <ChevronRight 
                    className="h-3.5 w-3.5 text-gray-400 group-hover:text-[#02665e] transition-all duration-200 opacity-0 group-hover:opacity-100 transform translate-x-[-4px] group-hover:translate-x-0" 
                  />
                </Link>
              );
            })}

            <WorkspaceSwitcher currentWorkspace="NORMAL" />

            {/* Settings Items */}
            {settingsItems.map((item, idx) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`group relative flex items-center gap-3 px-4 py-2.5 text-sm font-medium ${textClass} ${hoverBgClass} transition-all duration-200 active:scale-[0.98] no-underline ${
                    active ? activeBgClass : ""
                  }`}
                  style={{
                    animationDelay: `${(menuItems.length + idx) * 30}ms`,
                  }}
                >
                  <Icon 
                    className={`h-4 w-4 transition-all duration-200 ${
                      active ? "text-[#02665e]" : "text-gray-500 group-hover:text-[#02665e]"
                    }`}
                    strokeWidth={active ? 2.5 : 2}
                  />
                  <span className="flex-1">{item.label}</span>
                  {active && (
                    <div className="absolute right-3 w-1.5 h-1.5 rounded-full bg-[#02665e] animate-pulse" />
                  )}
                  <ChevronRight 
                    className="h-3.5 w-3.5 text-gray-400 group-hover:text-[#02665e] transition-all duration-200 opacity-0 group-hover:opacity-100 transform translate-x-[-4px] group-hover:translate-x-0" 
                  />
                </Link>
              );
            })}

            {/* Divider */}
            <div className="my-1.5 mx-4 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />

            {/* Sign Out */}
            <button
              onClick={async (e) => {
                e.preventDefault();
                setOpen(false);
                try {
                  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                  clearAuthToken();
                } catch {}
                window.location.href = logoutRedirect;
              }}
              className={`group relative flex items-center gap-3 w-full px-4 py-2.5 text-sm font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition-all duration-200 active:scale-[0.98] border-0 bg-transparent cursor-pointer`}
              style={{
                animationDelay: `${(menuItems.length + settingsItems.length) * 30}ms`,
              }}
            >
              <LogOut 
                className="h-4 w-4 transition-all duration-200 text-rose-500 group-hover:text-rose-600 group-hover:rotate-[-5deg]" 
                strokeWidth={2.5}
              />
              <span className="flex-1 text-left">Sign out</span>
              <ChevronRight 
                className="h-3.5 w-3.5 text-rose-400 transition-all duration-200 opacity-0 group-hover:opacity-100 transform translate-x-[-4px] group-hover:translate-x-0" 
              />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

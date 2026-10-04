"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Home, User } from "lucide-react";
import { usePathname } from "next/navigation";

type Slot = "home" | "bookings" | "notifications" | "account";

export default function MobileAgentNav() {
  const pathname = usePathname();
  const [pressed, setPressed] = useState<Slot | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const press = useCallback((slot: Slot) => setPressed(slot), []);
  const release = useCallback(() => setPressed(null), []);

  const isVisible =
    pathname === "/account/agent" ||
    pathname.startsWith("/account/agent/");

  const active = useMemo(() => {
    const path = pathname || "";
    return {
      home: path === "/account/agent" || path === "/account/agent/",
      bookings: path.startsWith("/account/agent/bookings") || path.startsWith("/account/agent/tour-bookings"),
      notifications: path.startsWith("/account/agent/notifications"),
      account:
        path.startsWith("/account/agent/profile") ||
        path.startsWith("/account/agent/card") ||
        path.startsWith("/account/agent/security") ||
        path.startsWith("/account/agent/contract"),
    };
  }, [pathname]);

  useEffect(() => {
    if (!isVisible) return;

    let mounted = true;
    const fetchUnread = async () => {
      const ac = new AbortController();
      const timeout = window.setTimeout(() => ac.abort(), 8000);
      try {
        const response = await fetch("/api/agent/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
          signal: ac.signal,
        });
        if (!response.ok || !mounted) return;
        const data = await response.json();
        setUnreadCount(Number(data?.totalUnread ?? data?.total ?? 0));
      } catch {
        // ignore badge failures
      } finally {
        window.clearTimeout(timeout);
      }
    };

    fetchUnread();
    const handleFocus = () => fetchUnread();
    window.addEventListener("focus", handleFocus);
    return () => {
      mounted = false;
      window.removeEventListener("focus", handleFocus);
    };
  }, [isVisible, pathname]);

  const touch = (slot: Slot) => ({
    onTouchStart: () => press(slot),
    onTouchEnd: release,
    onTouchCancel: release,
    onMouseDown: () => press(slot),
    onMouseUp: release,
    onMouseLeave: release,
  });

  const iconScale = (slot: Slot): React.CSSProperties => ({
    transform: pressed === slot ? "scale(0.84)" : "scale(1)",
    opacity: pressed === slot ? 0.82 : 1,
    transition:
      pressed === slot
        ? "transform 0.10s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.10s ease"
        : "transform 0.34s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease",
  });

  if (!isVisible) return null;

  const BRAND = "#02665e";
  const BRAND_SOFT = "rgba(2,102,94,0.74)";
  const ICON_SIZE = 22;
  const iconColor = (isActive: boolean) => (isActive ? BRAND : BRAND_SOFT);
  const strokeWidth = (isActive: boolean) => (isActive ? 2.6 : 2.15);

  const renderNavItem = ({
    href,
    slot,
    label,
    activeState,
    icon,
    badge,
  }: {
    href: string;
    slot: Slot;
    label: string;
    activeState: boolean;
    icon: React.ReactNode;
    badge?: React.ReactNode;
  }) => (
    <Link
      href={href}
      aria-label={label}
      className="relative flex h-full min-w-0 select-none items-center justify-center no-underline outline-none"
      {...touch(slot)}
    >
      <span
        className="relative flex w-full max-w-[4.1rem] flex-col items-center justify-center px-1 py-1.5 transition-all duration-200"
        style={iconScale(slot)}
      >
        <span
          className={[
            "relative inline-flex h-10 w-10 items-center justify-center rounded-[1.15rem] transition-all duration-200",
            activeState
              ? "bg-[#02665e]/12 text-[#02665e] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] ring-1 ring-[#02665e]/8"
              : "text-slate-400",
          ].join(" ")}
        >
          {icon}
          {badge}
        </span>
        <span
          className={`mt-1.5 text-[9px] font-medium uppercase leading-none tracking-[0.14em] ${
            activeState ? "text-slate-700" : "text-slate-300"
          }`}
        >
          {label}
        </span>
        <span
          className={`mt-2 h-[3px] rounded-full transition-all duration-200 ${
            activeState ? "w-8 bg-[#02665e] opacity-100" : "w-6 bg-slate-200 opacity-45"
          }`}
          aria-hidden
        />
      </span>
    </Link>
  );

  return (
    <nav aria-label="Agent portal mobile navigation" className="md:hidden fixed inset-x-0 bottom-0 z-50">
      <div style={{ paddingBottom: "env(safe-area-inset-bottom)" }} className="border-t border-slate-200/90 bg-white/95 backdrop-blur-xl shadow-[0_-4px_20px_rgba(15,23,42,0.07)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#02665e]/10 to-transparent" aria-hidden />

          <div className="grid h-16 grid-cols-4 items-stretch px-2">
            {renderNavItem({
              href: "/account/agent",
              slot: "home",
              label: "Dashboard",
              activeState: active.home,
              icon: (
                <Home
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  strokeWidth={strokeWidth(active.home)}
                  color={iconColor(active.home)}
                />
              ),
            })}

            {renderNavItem({
              href: "/account/agent/bookings",
              slot: "bookings",
              label: "Bookings",
              activeState: active.bookings,
              icon: (
                <CalendarDays
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  strokeWidth={strokeWidth(active.bookings)}
                  color={iconColor(active.bookings)}
                />
              ),
            })}

            {renderNavItem({
              href: "/account/agent/notifications",
              slot: "notifications",
              label: "Alerts",
              activeState: active.notifications,
              icon: (
                <Bell
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  strokeWidth={strokeWidth(active.notifications)}
                  color={iconColor(active.notifications)}
                />
              ),
              badge:
                unreadCount > 0 ? (
                  <span className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-white">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                ) : undefined,
            })}

            {renderNavItem({
              href: "/account/agent/profile",
              slot: "account",
              label: "Editor",
              activeState: active.account,
              icon: (
                <User
                  width={ICON_SIZE}
                  height={ICON_SIZE}
                  strokeWidth={strokeWidth(active.account)}
                  color={iconColor(active.account)}
                />
              ),
            })}
          </div>
        </div>
    </nav>
  );
}

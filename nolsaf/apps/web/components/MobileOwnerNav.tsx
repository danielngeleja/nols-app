"use client";

import Link from "next/link";
import React, { useCallback, useMemo, useState } from "react";
import { Home, ClipboardList, QrCode, CreditCard, CalendarDays } from "lucide-react";
import { usePathname } from "next/navigation";

type Slot = "home" | "bookings" | "validate" | "revenue" | "availability";

export default function MobileOwnerNav() {
  const pathname = usePathname();
  const [pressed, setPressed] = useState<Slot | null>(null);

  const press = useCallback((s: Slot) => setPressed(s), []);
  const release = useCallback(() => setPressed(null), []);

  const active = useMemo(() => {
    const p = pathname || "";
    return {
      home: p === "/owner" || p === "/owner/",
      bookings: p.startsWith("/owner/bookings") && !p.startsWith("/owner/bookings/validate"),
      validate: p.startsWith("/owner/bookings/validate"),
      revenue: p.startsWith("/owner/revenue") || p.startsWith("/owner/payouts"),
      availability: p.startsWith("/owner/properties/availability"),
    };
  }, [pathname]);

  const isHidden = !(pathname || "").startsWith("/owner");
  if (isHidden) return null;

  const touch = (s: Slot) => ({
    onTouchStart: () => press(s),
    onTouchEnd: release,
    onTouchCancel: release,
    onMouseDown: () => press(s),
    onMouseUp: release,
    onMouseLeave: release,
  });

  const iconScale = (s: Slot): React.CSSProperties => ({
    transform: pressed === s ? "scale(0.84)" : "scale(1)",
    opacity: pressed === s ? 0.82 : 1,
    transition:
      pressed === s
        ? "transform 0.10s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.10s ease"
        : "transform 0.34s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease",
  });

  const fabScale = (s: Slot): React.CSSProperties => ({
    transform: pressed === s ? "scale(0.88)" : "scale(1)",
    filter: pressed === s ? "brightness(0.92)" : "brightness(1)",
    transition:
      pressed === s
        ? "transform 0.10s cubic-bezier(0.25,0.46,0.45,0.94), filter 0.10s ease"
        : "transform 0.34s cubic-bezier(0.34,1.56,0.64,1), filter 0.18s ease",
  });

  const BRAND = "#02665e";
  const ICON_SIZE = 21;
  const iconColor = (isActive: boolean) => (isActive ? BRAND : "rgba(2,102,94,0.78)");
  const strokeW = (isActive: boolean) => (isActive ? 2.6 : 2.2);
  const labelClass = (isActive: boolean) =>
    `mt-1 text-[10px] leading-none tracking-tight transition-all duration-200 ${isActive ? "font-extrabold text-[#02665e]" : "font-bold text-[#02665e]/70"}`;
  const itemClass = (isActive: boolean) =>
    `relative flex flex-col items-center justify-center flex-1 h-full select-none outline-none rounded-2xl transition-all duration-200 ease-out ${
      isActive ? "bg-[#02665e]/8 shadow-[inset_0_0_0_1px_rgba(2,102,94,0.08)]" : "hover:bg-[#02665e]/5"
    }`;
  const iconWrapClass = (isActive: boolean) =>
    `relative inline-flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 ${
      isActive ? "bg-[#02665e] text-white shadow-sm shadow-[#02665e]/25" : "text-[#02665e]/80"
    }`;

  // Tuned to match the reference footer shape
  const BAR_HEIGHT = 76;
  const BAR_RADIUS = 10;
  const NOTCH_WIDTH = 132;
  const NOTCH_DEPTH = 18;
  const FAB_SIZE = 52;

  const W = 400;
  const H = BAR_HEIGHT;
  const r = BAR_RADIUS;
  const startX = (W - NOTCH_WIDTH) / 2;
  const endX = startX + NOTCH_WIDTH;
  const cx = W / 2;
  const c1x1 = startX + NOTCH_WIDTH * 0.18;
  const c1x2 = cx - NOTCH_WIDTH * 0.22;
  const c2x1 = cx + NOTCH_WIDTH * 0.22;
  const c2x2 = endX - NOTCH_WIDTH * 0.18;

  const svgPath = [
    `M ${r} 0`,
    `H ${startX}`,
    `C ${c1x1} 0 ${c1x2} ${NOTCH_DEPTH} ${cx} ${NOTCH_DEPTH}`,
    `C ${c2x1} ${NOTCH_DEPTH} ${c2x2} 0 ${endX} 0`,
    `H ${W - r}`,
    `A ${r} ${r} 0 0 1 ${W} ${r}`,
    `V ${H - r}`,
    `A ${r} ${r} 0 0 1 ${W - r} ${H}`,
    `H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${H - r}`,
    `V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    "Z",
  ].join(" ");

  return (
    <nav
      aria-label="Owner mobile navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-50"
    >
      <div
        className="relative w-full"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Bar (with notch cut-out) */}
        <div className="relative" style={{ zIndex: 1 }}>
          <div
            className="relative w-full"
            style={{
              height: `${BAR_HEIGHT}px`,
            }}
          >
            {/* SVG background: white pill with a smooth center bend (notch) */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 400 76"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path d={svgPath} fill="#ffffff" stroke="rgba(2,102,94,0.22)" strokeWidth="1" />
            </svg>

            <div className="relative flex w-full items-stretch px-2" style={{ height: `${BAR_HEIGHT}px` }}>
        {/* Home */}
        <Link
          href="/owner"
          aria-label="Home"
          style={{ textDecoration: "none" }}
          className={itemClass(active.home)}
          {...touch("home")}
        >
          <span className={iconWrapClass(active.home)} style={iconScale("home")}>
            <Home
              width={ICON_SIZE}
              height={ICON_SIZE}
              strokeWidth={strokeW(active.home)}
              color={active.home ? "#ffffff" : iconColor(active.home)}
            />
          </span>
          <span className={labelClass(active.home)}>Home</span>
        </Link>

        {/* My Bookings */}
        <Link
          href="/owner/bookings"
          aria-label="All bookings"
          style={{ textDecoration: "none" }}
          className={itemClass(active.bookings)}
          {...touch("bookings")}
        >
          <span className={iconWrapClass(active.bookings)} style={iconScale("bookings")}>
            <ClipboardList
              width={ICON_SIZE}
              height={ICON_SIZE}
              strokeWidth={strokeW(active.bookings)}
              color={active.bookings ? "#ffffff" : iconColor(active.bookings)}
            />
          </span>
          <span className={labelClass(active.bookings)}>Bookings</span>
        </Link>

        {/* Middle slot keeps spacing */}
        <div className="flex-1" aria-hidden />

        {/* Payouts */}
        <Link
          href="/owner/payouts"
          aria-label="My Payouts"
          style={{ textDecoration: "none" }}
          className={itemClass(active.revenue)}
          {...touch("revenue")}
        >
          <span className={iconWrapClass(active.revenue)} style={iconScale("revenue")}>
            <CreditCard
              width={ICON_SIZE}
              height={ICON_SIZE}
              strokeWidth={strokeW(active.revenue)}
              color={active.revenue ? "#ffffff" : iconColor(active.revenue)}
            />
          </span>
          <span className={labelClass(active.revenue)}>Payouts</span>
        </Link>

        {/* Room Availability */}
        <Link
          href="/owner/properties/availability"
          aria-label="Room availability"
          style={{ textDecoration: "none" }}
          className={itemClass(active.availability)}
          {...touch("availability")}
        >
          <span className={iconWrapClass(active.availability)} style={iconScale("availability")}>
            <CalendarDays
              width={ICON_SIZE}
              height={ICON_SIZE}
              strokeWidth={strokeW(active.availability)}
              color={active.availability ? "#ffffff" : iconColor(active.availability)}
            />
          </span>
          <span className={labelClass(active.availability)}>Rooms</span>
        </Link>
            </div>

            {/* Scanner / Validate floating action (sits in the bend) */}
            <Link
              href="/owner/bookings/validate"
              aria-label="Check in a guest"
              style={{ textDecoration: "none", transform: "translate(-50%, -44%)" }}
              className="absolute left-1/2 top-0"
              {...touch("validate")}
            >
              <span
                className="flex items-center justify-center rounded-full"
                style={{
                  width: `${FAB_SIZE}px`,
                  height: `${FAB_SIZE}px`,
                  ...fabScale("validate"),
                  background: BRAND,
                }}
              >
                <QrCode width={24} height={24} strokeWidth={2.4} color="#ffffff" />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

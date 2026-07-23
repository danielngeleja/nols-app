"use client";

import Link from "next/link";
import React, { useEffect, useState, useCallback } from "react";
import { Home, Building2, PlusSquare, User, Car, Calendar, Users, ClipboardList, Settings as SettingsIcon, LogOut, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthToken } from "@/lib/apiClient";
import { fetchAccountSession, type AccountSession } from "@/lib/accountSession";
import { hidesPublicMobileNavigation } from "@/lib/publicMobileNavigation";

type Slot = "home" | "stays" | "list" | "rides" | "account";

export default function MobilePublicNav() {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<AccountSession | null>(null);
  const [pressed, setPressed] = useState<Slot | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // This nav lives in the root layout and persists across client navigations,
  // so the SSR'd shell and the hydrating client can disagree on usePathname().
  // Defer the path-derived active highlight until after mount so the server and
  // first client render are identical (no active tab), then light up post-hydration.
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  const press   = useCallback((s: Slot) => setPressed(s), []);
  const release = useCallback(() => setPressed(null), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!alive) return;
        if (r.ok) {
          setAuthed(true);
          setUser(r.data ?? null);
        } else {
          setAuthed(false);
        }
      } catch {
        if (alive) setAuthed(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { setMounted(true); }, []);

  const isHome       = mounted && pathname === "/public";
  const isProperties = mounted && pathname.startsWith("/public/properties");
  const isRides      = mounted && pathname.startsWith("/account/rides");
  const isAccount    = mounted && pathname.startsWith("/account") && !isRides;

  // Dedicated portals and focused guest flows provide their own navigation.
  if (hidesPublicMobileNavigation(pathname)) return null;

  /* Touch-spring helpers */
  const touch = (s: Slot) => ({
    onTouchStart:  () => press(s),
    onTouchEnd:    release,
    onTouchCancel: release,
    onMouseDown:   () => press(s),
    onMouseUp:     release,
    onMouseLeave:  release,
  });

  const itemScale = (s: Slot): React.CSSProperties => ({
    transform:  pressed === s ? "scale(0.88)" : "scale(1)",
    transition: pressed === s
      ? "transform 0.07s cubic-bezier(0.25,0.46,0.45,0.94)"
      : "transform 0.36s cubic-bezier(0.34,1.56,0.64,1)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
  });

  const BRAND = "#02665e";
  const iconColor = (active: boolean) => active ? BRAND : "rgba(2,102,94,0.45)";
  const strokeW   = (active: boolean) => active ? 2.4 : 1.6;
  const labelColor = (active: boolean) => active ? BRAND : "rgba(2,102,94,0.45)";

  const TabItem = ({
    slot, label, icon, onClick, href,
  }: {
    slot: Slot;
    label: string;
    icon: React.ReactNode;
    href?: string;
    onClick?: () => void;
  }) => {
    const active =
      slot === "home" ? isHome :
      slot === "stays" ? isProperties :
      slot === "rides" ? isRides :
      slot === "account" ? isAccount : false;

    const inner = (
      <span style={itemScale(slot)}>
        {/* Active dot indicator above icon */}
        <span style={{
          width: active ? "18px" : "0px",
          height: "2.5px",
          borderRadius: "999px",
          background: BRAND,
          opacity: active ? 1 : 0,
          transition: "width 0.22s ease, opacity 0.22s ease",
          marginBottom: "-1px",
        }} />
        <span style={{ lineHeight: 0 }}>{icon}</span>
        <span style={{
          fontSize: "10px",
          fontWeight: active ? 700 : 500,
          letterSpacing: "0.01em",
          color: labelColor(active),
          lineHeight: 1,
          transition: "color 0.18s ease",
        }}>
          {label}
        </span>
      </span>
    );

    const cls = "relative flex items-center justify-center flex-1 h-full select-none outline-none";

    if (href) {
      return (
        <Link href={href} aria-label={label} style={{ textDecoration: "none" }} className={cls} {...touch(slot)}>
          {inner}
        </Link>
      );
    }
    return (
      <button type="button" aria-label={label} style={{ background: "none", border: "none", padding: 0 }} className={`${cls} cursor-pointer`} onClick={onClick} {...touch(slot)}>
        {inner}
      </button>
    );
  };

  return (
    <>
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-50"
      style={{
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(16px) saturate(1.6)",
        WebkitBackdropFilter: "blur(16px) saturate(1.6)",
        borderTop: "1px solid rgba(2,102,94,0.10)",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.07)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* Teal shimmer along top edge */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: "10%",
          right: "10%",
          height: "1px",
          background: "linear-gradient(90deg, transparent 0%, rgba(2,102,94,0.35) 40%, rgba(2,102,94,0.55) 50%, rgba(2,102,94,0.35) 60%, transparent 100%)",
        }}
      />

      <div className="flex w-full items-stretch h-[62px] max-w-lg mx-auto px-2">
        {TabItem({ slot:"home",  label:"Home",   href:"/public",             icon:<Home        width={22} height={22} strokeWidth={strokeW(isHome)}       color={iconColor(isHome)}       /> })}
        {TabItem({ slot:"stays", label:"Stays",  href:"/public/properties",  icon:<Building2   width={22} height={22} strokeWidth={strokeW(isProperties)} color={iconColor(isProperties)} /> })}
        {TabItem({ slot:"list",  label:"List",   href:"/account/register?role=owner", icon:<PlusSquare  width={22} height={22} strokeWidth={strokeW(false)}       color={iconColor(false)}        /> })}
        {TabItem({ slot:"rides", label:"Rides",  href:authed ? "/account/rides" : "/account/sign-in", icon:<Car width={22} height={22} strokeWidth={strokeW(isRides)} color={iconColor(isRides)} /> })}
        {TabItem({
          slot: "account",
          label: authed ? "Account" : "Sign in",
          onClick: () => authed ? setMenuOpen(true) : router.push("/account/sign-in"),
          icon: authed && user?.profileImage ? (
            <span className="relative block" style={{ lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={user.profileImage}
                alt={user.name ?? "Account"}
                width={24}
                height={24}
                className="rounded-full object-cover"
                style={{
                  width: "24px",
                  height: "24px",
                  outline: isAccount ? `2px solid ${BRAND}` : "1.5px solid rgba(0,0,0,0.12)",
                  outlineOffset: "1px",
                }}
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-[7px] h-[7px] rounded-full bg-emerald-400 ring-[1.5px] ring-white" />
            </span>
          ) : (
            <User width={22} height={22} strokeWidth={strokeW(isAccount)} color={iconColor(isAccount)} />
          ),
        })}
      </div>
    </nav>

    {/* ── Mobile Account Sheet ── */}
    {menuOpen && (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />
        {/* Sheet */}
        <div
          className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-3xl bg-white shadow-2xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}
        >
          {/* Drag handle */}
          <div className="mx-auto mt-3 w-10 h-1 rounded-full bg-slate-200" />
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
            <div>
              {user?.name && (
                <div className="font-bold text-slate-900 text-base leading-tight">{user.name}</div>
              )}
              <div className="text-xs text-slate-400 mt-0.5">Manage your account</div>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-4 h-4 text-slate-600" />
            </button>
          </div>

          {/* Menu items */}
          <div className="px-3 py-2">
            {([
              { href: "/account",            label: "My account",    Icon: User          },
              { href: "/account/bookings",    label: "My Bookings",   Icon: Calendar      },
              { href: "/account/rides",       label: "My Rides",      Icon: Car           },
              { href: "/account/group-stays", label: "My Group Stay", Icon: Users         },
              { href: "/account/tour-packages", label: "My Tour Packages", Icon: ClipboardList },
              { href: "/account/security",    label: "Settings",      Icon: SettingsIcon  },
            ] as { href: string; label: string; Icon: React.ElementType }[]).map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <button
                  key={href}
                  type="button"
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                  onClick={() => { setMenuOpen(false); router.push(href); }}
                >
                  <span
                    className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                    style={{ background: active ? "linear-gradient(135deg,#0a5c82,#02665e)" : "#f1f5f9" }}
                  >
                    <Icon className="w-4 h-4" style={{ color: active ? "#ffffff" : "#64748b" }} />
                  </span>
                  <span className={`text-sm font-medium ${active ? "text-teal-700" : "text-slate-700"}`}>
                    {label}
                  </span>
                  {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-teal-500" />}
                </button>
              );
            })}
          </div>

          {/* Sign out */}
          <div className="px-3 pb-2 pt-1 border-t border-slate-100">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors hover:bg-red-50 active:bg-red-100"
              onClick={async () => {
                setMenuOpen(false);
                await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                clearAuthToken();
                window.location.href = "/account/login";
              }}
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 bg-red-50">
                <LogOut className="w-4 h-4 text-red-500" />
              </span>
              <span className="text-sm font-medium text-red-500">Sign out</span>
            </button>
          </div>
        </div>
      </>
    )}
    </>
  );
}

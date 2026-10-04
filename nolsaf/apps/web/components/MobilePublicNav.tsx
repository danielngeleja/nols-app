"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import {
  Building2,
  Calendar,
  Car,
  ChevronRight,
  ClipboardList,
  Home,
  LogOut,
  PlusSquare,
  Settings as SettingsIcon,
  User,
  Users,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthToken } from "@/lib/apiClient";
import { fetchAccountSession, type AccountSession } from "@/lib/accountSession";
import { hidesPublicMobileNavigation } from "@/lib/publicMobileNavigation";

type Slot = "home" | "stays" | "trips" | "rides" | "account";

const BRAND_GRADIENT = "linear-gradient(135deg, #011a18 0%, #023a35 55%, #02665e 100%)";

/** Everything under "Trips": the things a traveller has booked. */
const TRIP_PATHS = ["/account/bookings", "/account/group-stays", "/account/tour-packages"];

export default function MobilePublicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<AccountSession | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // This nav lives in the root layout and persists across client navigations, so the
  // SSR'd shell and the hydrating client can disagree on usePathname(). Defer the
  // path-derived highlight until after mount so both first renders are identical.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!alive) return;
        setAuthed(r.ok);
        setUser(r.ok ? r.data ?? null : null);
      } catch {
        if (alive) setAuthed(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Dedicated portals and focused guest flows provide their own navigation.
  if (hidesPublicMobileNavigation(pathname)) return null;

  const under = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");
  const isTrips = mounted && TRIP_PATHS.some(under);
  const isRides = mounted && under("/account/rides");
  const active: Record<Slot, boolean> = {
    home: mounted && pathname === "/public",
    stays: mounted && pathname.startsWith("/public/properties"),
    trips: isTrips,
    rides: isRides,
    account: mounted && under("/account") && !isTrips && !isRides,
  };

  const signInHref = "/account/sign-in";
  const displayName = user?.fullName || user?.name || user?.displayName || "";
  const avatar = user?.profileImage || user?.avatarUrl || "";
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("");

  const tabClass = "relative flex h-full flex-1 select-none flex-col items-center justify-center gap-0.5 border-0 bg-transparent p-0 pt-1 no-underline outline-none";

  const TabBody = ({ slot, label, icon }: { slot: Slot; label: string; icon: React.ReactNode }) => {
    const on = active[slot];
    return (
      <>
        <span className={`flex h-6 items-center justify-center transition-colors ${on ? "text-[#02665e]" : "text-slate-400"}`}>
          {icon}
        </span>
        <span className={`text-[10.5px] leading-none transition-colors ${on ? "font-semibold text-[#02665e]" : "font-medium text-slate-500"}`}>
          {label}
        </span>
        <span
          aria-hidden
          className={`h-1 w-1 rounded-full bg-[#02665e] transition-all duration-200 ${on ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
        />
      </>
    );
  };

  const tab = (slot: Slot, label: string, href: string, icon: React.ReactNode) => (
    <Link key={slot} href={href} aria-label={label} aria-current={active[slot] ? "page" : undefined} className={`${tabClass} active:scale-95 transition-transform`}>
      <TabBody slot={slot} label={label} icon={icon} />
    </Link>
  );

  const iconSize = "h-[19px] w-[19px]";

  return (
    <>
      {/* In-flow spacer: phones have no footer, so the last content must clear the fixed bar. */}
      <div aria-hidden className="md:hidden" style={{ height: "calc(72px + env(safe-area-inset-bottom, 0px))" }} />

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-0 border-t border-solid border-slate-200 bg-white shadow-[0_-4px_16px_rgba(15,23,42,0.05)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="mx-auto flex h-[60px] max-w-lg items-stretch">
            {tab("home", "Home", "/public", <Home className={iconSize} strokeWidth={2} />)}
            {tab("stays", "Stays", "/public/properties", <Building2 className={iconSize} strokeWidth={2} />)}
            {tab("trips", "Trips", authed ? "/account/bookings" : signInHref, <Calendar className={iconSize} strokeWidth={2} />)}
            {tab("rides", "Rides", authed ? "/account/rides" : signInHref, <Car className={iconSize} strokeWidth={2} />)}

            <button
              type="button"
              aria-label={authed ? "Account menu" : "Sign in"}
              aria-haspopup={authed ? "dialog" : undefined}
              aria-expanded={authed ? menuOpen : undefined}
              onClick={() => (authed ? setMenuOpen(true) : router.push(signInHref))}
              className={`${tabClass} cursor-pointer transition-transform active:scale-95`}
            >
              <TabBody
                slot="account"
                label={authed ? "Account" : "Sign in"}
                icon={
                  authed && initials ? (
                    <span
                      className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[9.5px] font-bold ring-[1.5px] ${
                        active.account ? "bg-[#02665e] text-white ring-[#02665e]" : "bg-slate-100 text-slate-600 ring-slate-300"
                      }`}
                    >
                      {initials}
                    </span>
                  ) : (
                    <User className={iconSize} strokeWidth={2} />
                  )
                }
              />
            </button>
        </div>
      </nav>

      {/* ── Account sheet: same sectioned style as the header menu ── */}
      {menuOpen && (
        <div className="fixed inset-0 z-[90] md:hidden" role="dialog" aria-modal="true" aria-label="Account menu">
          <button type="button" aria-label="Close" onClick={() => setMenuOpen(false)} className="absolute inset-0 border-0 bg-black/50 backdrop-blur-[2px]" />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-[#f3faf8] shadow-[0_-20px_50px_rgba(0,0,0,0.35)]"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <div className="sticky top-0 z-10 mb-4 border-0 border-b border-solid border-[#02665e]/10 bg-[#f3faf8] px-4 pb-3 pt-2.5">
              <span className="mx-auto block h-1 w-10 rounded-full bg-slate-300" aria-hidden="true" />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-white" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ background: BRAND_GRADIENT }}>
                      {initials || <User className="h-5 w-5" />}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[15px] font-bold text-slate-900">{displayName || "Your account"}</p>
                    {user?.email && <p className="m-0 truncate text-[12px] text-slate-500">{user.email}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 bg-white text-slate-600 ring-1 ring-inset ring-slate-200"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            <div className="space-y-5 px-4 pb-2">
              {[
                {
                  title: "Your trips",
                  items: [
                    { href: "/account/bookings", label: "My stays", Icon: Calendar },
                    { href: "/account/rides", label: "My rides", Icon: Car },
                    { href: "/account/group-stays", label: "Group stays", Icon: Users },
                    { href: "/account/tour-packages", label: "Tour packages", Icon: ClipboardList },
                  ],
                },
                {
                  title: "Account",
                  items: [
                    { href: "/account", label: "Profile", Icon: User },
                    { href: "/account/security", label: "Security & settings", Icon: SettingsIcon },
                  ],
                },
                {
                  title: "Host with NoLSAF",
                  items: [{ href: "/account/register?role=owner", label: "List your property", Icon: PlusSquare }],
                },
              ].map((section) => (
                <section key={section.title}>
                  <h2 className="m-0 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{section.title}</h2>
                  <ul className="m-0 list-none overflow-hidden rounded-2xl bg-white p-0 ring-1 ring-inset ring-[#02665e]/10">
                    {section.items.map(({ href, label, Icon }, index) => {
                      const here = pathname === href;
                      return (
                        <li key={href} className={index > 0 ? "border-0 border-t border-solid border-slate-100" : ""}>
                          <button
                            type="button"
                            onClick={() => { setMenuOpen(false); router.push(href); }}
                            aria-current={here ? "page" : undefined}
                            className={`flex w-full items-center gap-3 border-0 px-4 py-3 text-left transition ${here ? "bg-[#02665e]/[0.06]" : "bg-transparent active:bg-slate-50"}`}
                          >
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${here ? "text-white" : "bg-[#02665e]/[0.08] text-[#02665e]"}`}
                              style={here ? { background: BRAND_GRADIENT } : undefined}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className={`flex-1 text-[14px] font-semibold ${here ? "text-[#02665e]" : "text-slate-800"}`}>{label}</span>
                            <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}

              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                  clearAuthToken();
                  window.location.href = "/account/login";
                }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border-0 bg-white text-[14px] font-semibold text-rose-600 ring-1 ring-inset ring-rose-100 active:bg-rose-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

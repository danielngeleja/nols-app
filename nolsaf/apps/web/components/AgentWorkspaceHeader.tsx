"use client";

// Workspace header for /account/agent, matching the NRMS layout header: a white
// card carrying identity on the left, workspace controls on the right, and a
// primary tab row underneath. AgentPortalHeader still serves /about, /careers
// and /help, where the marketing chrome belongs.
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetchAccountSession } from "@/lib/accountSession";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Handshake,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  TrendingUp,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type Tab = { href: string; label: string; Icon: LucideIcon; exact?: boolean };

// The destinations an operator opens most, mirroring PRIMARY_TABS in NRMS. The
// rail still carries the full set.
const PRIMARY_TABS: Tab[] = [
  { href: "/account/agent", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/account/agent/bookings", label: "Bookings", Icon: CalendarDays },
  { href: "/account/agent/cancellations", label: "Cases", Icon: MessagesSquare },
  { href: "/account/agent/revenues", label: "Revenues", Icon: TrendingUp },
  { href: "/account/agent/reports", label: "Reports", Icon: BarChart3 },
];

function isActive(pathname: string, tab: Tab) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (tab.exact) return path === tab.href;
  return path === tab.href || path.startsWith(`${tab.href}/`);
}

export default function AgentWorkspaceHeader() {
  const pathname = usePathname() || "";
  const [name, setName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [accommodationEnabled, setAccommodationEnabled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") sessionStorage.setItem("navigationContext", "agent");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    void (async () => {
      try {
        const result = await fetchAccountSession({ signal: controller.signal });
        if (!alive || !result.ok) return;
        const session = result.data as any;
        const url = typeof session?.avatarUrl === "string" ? session.avatarUrl.trim() : "";
        setAvatarUrl(url || null);
        setName(String(session?.fullName || session?.name || "").trim());
      } catch {
        // identity is decorative here; the rail and pages handle auth
      }
    })();

    void (async () => {
      try {
        const response = await fetch("/api/agent-portal/profile", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (alive) setAccommodationEnabled(response.ok);
      } catch {
        /* not an accommodation agent */
      }
    })();

    void (async () => {
      try {
        const response = await fetch("/api/agent/notifications?tab=unread&page=1&pageSize=1", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok || !alive) return;
        const payload = await response.json();
        const count = Number(payload?.totalUnread ?? payload?.total ?? 0);
        setUnread(Number.isFinite(count) ? count : 0);
      } catch {
        /* badge is best effort */
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const onCount = (event: Event) => {
      const next = Number((event as CustomEvent)?.detail?.count);
      if (Number.isFinite(next)) setUnread(next);
    };
    window.addEventListener("agent:notifications:unreadCount", onCount as EventListener);
    return () => window.removeEventListener("agent:notifications:unreadCount", onCount as EventListener);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen]);

  const controlClass =
    "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline outline-none transition hover:border-emerald-200 hover:bg-emerald-50/40 hover:text-emerald-800 hover:no-underline focus-visible:ring-2 focus-visible:ring-emerald-600/25";

  return (
    <header className="relative z-40 mb-3 mt-3 shrink-0 rounded-3xl border border-solid border-neutral-200 bg-white shadow-[0_10px_30px_-26px_rgba(15,23,42,0.5)]">
      <div className="flex min-h-[4.75rem] items-center gap-3 px-3 sm:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white lg:hidden">
          <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-bold leading-tight tracking-tight text-neutral-900">
            {name || "Agent portal"}
          </p>
          <p className="m-0 mt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">
            Tour operator workspace
          </p>
        </div>

        <span className="mx-0.5 hidden h-8 w-px shrink-0 bg-neutral-200 sm:block" aria-hidden />

        {accommodationEnabled ? (
          <Link href="/agent-portal" className={`${controlClass} hidden sm:inline-flex`} title="Accommodation partnerships">
            <Handshake className="h-4 w-4 text-emerald-700" aria-hidden />
            <span className="hidden sm:inline">Hotels</span>
          </Link>
        ) : null}

        <Link
          href="/account/agent/notifications"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          title="Notifications"
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-solid border-neutral-200 bg-white text-neutral-600 no-underline outline-none transition hover:border-emerald-200 hover:bg-emerald-50/40 hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-600/25"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Link>

        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="grid h-10 w-10 cursor-pointer appearance-none place-items-center overflow-hidden rounded-full border border-solid border-neutral-200 bg-neutral-50 p-0 text-neutral-600 outline-none transition hover:border-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-600/25"
          >
            {avatarUrl ? (
              <span className="relative block h-full w-full">
                <Image src={avatarUrl} alt="" fill sizes="40px" unoptimized={/^https?:\/\//i.test(avatarUrl)} className="object-cover" />
              </span>
            ) : (
              <UserRound className="h-4 w-4" aria-hidden />
            )}
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-[1000] mt-2 w-56 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white py-1 shadow-[0_18px_45px_-25px_rgba(15,23,42,0.5)]"
            >
              <Link role="menuitem" href="/account/agent/profile" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-neutral-600 no-underline transition hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline">
                <UserRound className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
                My profile
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  window.location.href = `/api/auth/logout?next=${encodeURIComponent("/login")}`;
                }}
                className="flex w-full cursor-pointer appearance-none items-center gap-2.5 border-0 bg-transparent px-3 py-2 text-left text-xs font-semibold text-red-600 transition hover:bg-red-50"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <nav className="overflow-x-auto rounded-b-3xl border-0 border-t border-solid border-neutral-100 px-3 pt-0.5 sm:px-5" aria-label="Primary agent operations">
        <div className="flex w-max min-w-full gap-1">
          {PRIMARY_TABS.map(({ href, label, Icon, exact }) => {
            const active = isActive(pathname, { href, label, Icon, exact });
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 border-0 border-b-2 border-solid px-3 text-xs font-bold no-underline outline-none transition hover:no-underline focus-visible:text-emerald-800 ${
                  active
                    ? "border-emerald-700 text-emerald-800"
                    : "border-transparent text-neutral-500 hover:border-neutral-200 hover:text-neutral-800"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Calendar, Wallet, FileText, PlusSquare, LayoutDashboard,
  ChevronDown, ChevronLeft, ChevronRight, Users, HandHeart, CalendarDays,
  CheckCircle2, Building2, BadgeCheck, LogIn, LogOut, BarChart3, BedDouble,
  LayoutGrid, Clock, Receipt, Archive,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

/* 
   COLLAPSED ICON BUTTON
 */
function CollapseBtn({
  href, label, Icon, count, active,
}: { href?: string; label: string; Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; count?: number; active?: boolean }) {
  const sty = active
    ? { background: "rgba(255,255,255,0.18)", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }
    : { background: "rgba(255,255,255,0.06)" };
  const cls = "group relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 no-underline";
  const inner = (
    <>
      <Icon className="w-5 h-5" style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.65)" }} aria-hidden />
      {count !== undefined && count > 0 && (
        <span className="absolute -top-1 -right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full text-[9px] font-black text-white"
          style={{ background: "#e11d48" }}>
          {count > 9 ? "9+" : count}
        </span>
      )}
      <span className="absolute left-full ml-3 px-2.5 py-1.5 text-[12px] font-semibold text-white rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-150 shadow-lg"
        style={{ background: "#0a1f1e" }}>
        {label}{count !== undefined && count > 0 ? ` · ${count}` : ""}
      </span>
    </>
  );
  if (href) return <Link href={href} title={label} className={cls} style={sty}>{inner}</Link>;
  return <button title={label} className={cls} style={sty}>{inner}</button>;
}

/* 
   SUB-ITEM LINK
 */
function SubItem({
  href, label, Icon, count, exact = false, tone = "neutral", also = [], match,
}: {
  href: string;
  label: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  count?: number;
  exact?: boolean;
  /** "alert" paints the count amber: something is waiting on the owner. */
  tone?: "neutral" | "alert";
  /** Extra path prefixes that also mark this item as the current page. */
  also?: string[];
  /** Custom rule for pages that do not share this item's URL prefix. */
  match?: (path: string) => boolean;
}) {
  const path = usePathname() || "";
  const active =
    path === href ||
    (!exact && href !== "/owner" && path.startsWith(href + "/")) ||
    also.some((prefix) => path.startsWith(prefix)) ||
    Boolean(match?.(path));

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="group relative flex items-center justify-between gap-2 rounded-lg py-[7px] pl-3 pr-2 no-underline transition-colors duration-150 hover:bg-white/[0.05]"
      style={active ? { background: "rgba(94,234,212,0.08)" } : undefined}
    >
      {/* Sits on the section's guide line: mint for the current page. */}
      <span
        className="absolute -left-[13px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full transition-colors"
        style={{ background: active ? "#5eead4" : "transparent" }}
        aria-hidden
      />
      <span className="flex min-w-0 items-center gap-2.5">
        {Icon ? (
          <Icon className="h-[15px] w-[15px] shrink-0" style={{ color: active ? "#5eead4" : "rgba(255,255,255,0.4)" }} aria-hidden />
        ) : null}
        <span className="truncate text-[12.5px]" style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.62)", fontWeight: active ? 600 : 500 }}>
          {label}
        </span>
      </span>
      {count !== undefined && count > 0 ? (
        <span
          className="shrink-0 rounded-full px-[7px] py-px text-[10px] font-bold leading-[1.4] tabular-nums"
          style={tone === "alert"
            ? { background: "rgba(251,191,36,0.22)", color: "#fde68a" }
            : { background: "rgba(94,234,212,0.16)", color: "#5eead4" }}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

/* 
   SECTION HEADER (collapsible)
 */
function Section({
  label, Icon, isOpen, active, onClick, children,
}: {
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  isOpen: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={isOpen}
        className="w-full group flex appearance-none items-center gap-3 rounded-2xl border-0 bg-transparent px-2 py-2.5 transition-colors duration-200 hover:bg-white/[0.05]"
      >
        <span
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
          style={active
            ? { background: "rgba(94,234,212,0.16)" }
            : { background: "rgba(255,255,255,0.07)" }
          }
        >
          <Icon className="w-[17px] h-[17px]" style={{ color: active ? "#5eead4" : "rgba(255,255,255,0.6)" }} aria-hidden />
        </span>
        <span className="flex-1 text-left text-[13.5px] font-bold tracking-[-0.01em]"
          style={{ color: isOpen || active ? "#ffffff" : "rgba(255,255,255,0.82)" }}>
          {label}
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-300"
          style={{ color: "rgba(255,255,255,0.35)", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
          aria-hidden
        />
      </button>
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="mb-2 ml-[24px] mt-0.5 space-y-px border-0 border-l border-solid pl-3 pr-1" style={{ borderColor: "rgba(255,255,255,0.10)" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/* 
   DASHBOARD DIRECT LINK
 */
function TopItem({
  href, label, Icon,
}: { href: string; label: string; Icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }) {
  const path = usePathname();
  const active = path === href || (href !== "/owner" && path.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className="group no-underline flex items-center gap-3 px-2 py-2.5 rounded-2xl transition-colors duration-200 hover:bg-white/[0.05]"
      aria-current={active ? "page" : undefined}
      style={active ? { background: "rgba(255,255,255,0.10)" } : { background: "transparent" }}
    >
      <span
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
        style={active ? { background: "rgba(94,234,212,0.16)" } : { background: "rgba(255,255,255,0.07)" }}
      >
        <Icon className="w-[17px] h-[17px]" style={{ color: active ? "#5eead4" : "rgba(255,255,255,0.6)" }} aria-hidden />
      </span>
      <span className="text-[13.5px] font-bold tracking-[-0.01em]"
        style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.82)" }}>
        {label}
      </span>
    </Link>
  );
}

function Divider() {
  return <div className="h-px mx-2 my-1" style={{ background: "rgba(255,255,255,0.07)" }} />;
}

/* 
   MAIN EXPORT
 */
/** Room availability (and its floor plan) is daily front-desk work, not property setup. */
function isFrontDeskPath(path: string) {
  return (
    path === "/owner/bookings" ||
    path.startsWith("/owner/bookings/") ||
    path === "/owner/properties/availability" ||
    /^\/owner\/properties\/[^/]+\/(availability|layout)(\/|$)/.test(path)
  );
}

export default function OwnerSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const initialPath = usePathname() || "";
  const startIn = isFrontDeskPath(initialPath)
    ? "frontDesk"
    : initialPath.startsWith("/owner/properties")
      ? "properties"
      : initialPath.startsWith("/owner/group-stays")
        ? "groupStays"
        : initialPath.startsWith("/owner/payouts") || initialPath.startsWith("/owner/revenue") || initialPath.startsWith("/owner/reports")
          ? "revenue"
          : "frontDesk";
  const [propOpen, setPropOpen] = useState(startIn === "properties");
  const [bookOpen, setBookOpen] = useState(startIn === "frontDesk");
  const [revenueOpen, setRevenueOpen] = useState(startIn === "revenue");
  const [groupStaysOpen, setGroupStaysOpen] = useState(startIn === "groupStays");
  const [checkedInCount, setCheckedInCount] = useState<number>(0);
  const [checkoutDueCount, setCheckoutDueCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    const abortController = new AbortController();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let authFailed = false;

    const fetchCounts = async () => {
      if (!mounted || authFailed) return;
      try {
        const response = await api.get("/api/owner/bookings/sidebar-counts", {
          signal: abortController.signal,
          timeout: 10000,
        });
        if (!mounted) return;
        const data = response.data ?? {};
        setCheckedInCount(Number(data.checkedIn ?? 0));
        setCheckoutDueCount(Number(data.checkoutDue ?? 0));
      } catch (err: any) {
        if (!mounted) return;
        if (err.code === "ECONNABORTED" || err.name === "AbortError" || err.message === "Request aborted") return;
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          authFailed = true;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
          return;
        }
      }
    };

    fetchCounts();
    intervalId = setInterval(() => {
      if (mounted && document.visibilityState === "visible") fetchCounts();
    }, 60_000);
    const onChanged = () => { if (mounted) fetchCounts(); };
    window.addEventListener("nols:checkedin-changed", onChanged);
    window.addEventListener("nols:checkout-changed", onChanged);
    return () => {
      mounted = false;
      abortController.abort();
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener("nols:checkedin-changed", onChanged);
      window.removeEventListener("nols:checkout-changed", onChanged);
    };
  }, []);

  const path = usePathname() || "";
  const frontDesk = isFrontDeskPath(path);
  const sectionActive = {
    properties: !frontDesk && (path === "/owner/properties" || path.startsWith("/owner/properties/")),
    bookings: frontDesk,
    groupStays: path === "/owner/group-stays" || path.startsWith("/owner/group-stays/"),
    revenue: path === "/owner/payouts" || path.startsWith("/owner/payouts/") || path.startsWith("/owner/revenue") || path === "/owner/reports" || path.startsWith("/owner/reports/"),
  };

  /*  COLLAPSED  */
  if (collapsed) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center gap-1.5 rounded-2xl p-2"
        style={{
          background: "#012a26",
          boxShadow: "0 8px 30px -12px rgba(1,42,38,0.6), inset 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        <CollapseBtn href="/owner" label="Dashboard" Icon={LayoutDashboard} active={path === "/owner"} />
        <CollapseBtn href="/owner/nrms" label="NRMS WORKSPACE" Icon={BedDouble} active={path === "/owner/nrms" || path.startsWith("/owner/nrms/")} />
        <div className="w-6 h-px my-0.5" style={{ background: "rgba(255,255,255,0.09)" }} />
        <CollapseBtn href="/owner/bookings/checked-in" label="Front desk" Icon={Calendar} active={sectionActive.bookings} count={checkoutDueCount || undefined} />
        <CollapseBtn href="/owner/properties/approved" label="Properties" Icon={Building2} active={sectionActive.properties} />
        <CollapseBtn href="/owner/group-stays" label="Group stays" Icon={Users} active={sectionActive.groupStays} />
        <CollapseBtn href="/owner/payouts" label="My Payouts" Icon={Wallet} active={sectionActive.revenue} />
        <div className="mt-auto w-full border-0 border-t border-solid border-white/10 pt-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("toggle-owner-sidebar"))}
            className="flex min-h-9 w-full appearance-none items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.05] text-emerald-100/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Expand owner sidebar"
            title="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  /*  EXPANDED  */
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl select-none"
      style={{
        background: "radial-gradient(120% 40% at 0% 0%, rgba(94,234,212,0.08) 0%, rgba(94,234,212,0) 60%), #012a26",
        boxShadow: "0 8px 30px -12px rgba(1,42,38,0.6), inset 0 0 0 1px rgba(255,255,255,0.05)",
      }}
    >
      {/* Logo strip */}
      <div className="flex shrink-0 items-center gap-2.5 border-0 border-b border-solid px-4 pb-3.5 pt-4" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/NoLS2025-04.png" alt="NoLSAF" className="w-7 h-7 rounded-xl object-contain flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-black tracking-wide text-white leading-none">NoLSAF</p>
          <p className="text-[9.5px] font-medium mt-[3px] leading-none" style={{ color: "rgba(255,255,255,0.38)" }}>Owner Portal</p>
        </div>
      </div>

      {/* Nav */}
      <div className="sidebar-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-3">

        <TopItem href="/owner" label="Dashboard" Icon={LayoutDashboard} />
        <TopItem href="/owner/nrms" label="NRMS WORKSPACE" Icon={BedDouble} />
        <Divider />

        <Section label="Front desk" Icon={Calendar} isOpen={bookOpen} active={sectionActive.bookings} onClick={() => setBookOpen(v => !v)}>
          <SubItem href="/owner/bookings/validate" label="Check in a guest" Icon={LogIn} />
          <SubItem href="/owner/bookings/checked-in" label="Guests in house" Icon={CheckCircle2} count={checkedInCount} />
          <SubItem href="/owner/bookings/check-out" label="Departures" Icon={LogOut} count={checkoutDueCount} tone="alert" />
          <SubItem href="/owner/properties/availability" label="Room availability" Icon={CalendarDays} match={(p) => /^\/owner\/properties\/[^/]+\/(availability|layout)(\/|$)/.test(p)} />
          <SubItem href="/owner/bookings" label="All bookings" Icon={BadgeCheck} exact />
          <SubItem href="/owner/bookings/checked-out" label="Check-out history" Icon={Archive} />
        </Section>

        <Section label="Properties" Icon={Building2} isOpen={propOpen} active={sectionActive.properties} onClick={() => setPropOpen(v => !v)}>
          <SubItem href="/owner/properties/approved" label="My properties" Icon={Building2} />
          <SubItem href="/owner/properties/pending" label="Awaiting approval" Icon={FileText} />
          <SubItem href="/owner/properties/add" label="Add a property" Icon={PlusSquare} />
        </Section>

        <Section label="Group stays" Icon={Users} isOpen={groupStaysOpen} active={sectionActive.groupStays} onClick={() => setGroupStaysOpen(v => !v)}>
          <SubItem href="/owner/group-stays" label="Assigned to me" Icon={Users} exact />
          <SubItem href="/owner/group-stays/claims" label="Open to claim" Icon={HandHeart} exact />
          <SubItem href="/owner/group-stays/claims/my-claims" label="My claims" Icon={FileText} />
        </Section>

        <Section label="My Payouts" Icon={Wallet} isOpen={revenueOpen} active={sectionActive.revenue} onClick={() => setRevenueOpen(v => !v)}>
          <SubItem href="/owner/payouts" label="Overview" Icon={LayoutGrid} exact />
          <SubItem href="/owner/payouts/in-progress" label="In progress" Icon={Clock} />
          <SubItem href="/owner/payouts/history" label="History" Icon={Receipt} />
          <SubItem href="/owner/payouts/account" label="Payout account" Icon={Wallet} />
          <SubItem href="/owner/payouts/older-claims" label="Older claims" Icon={Archive} />
          <SubItem href="/owner/reports/overview" label="Reports" Icon={BarChart3} also={["/owner/reports/"]} />
        </Section>

      </div>

      <div className="shrink-0 border-0 border-t border-solid border-white/10 bg-black/5 p-2.5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("toggle-owner-sidebar"))}
          className="flex min-h-8 w-full appearance-none items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.05] px-2.5 text-[11px] font-semibold text-emerald-100/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Collapse owner sidebar"
        >
          Collapse sidebar
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

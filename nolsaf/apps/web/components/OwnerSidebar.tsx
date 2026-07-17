"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Calendar, Wallet, FileText, PlusSquare, LayoutDashboard,
  ChevronDown, ChevronRight, Users, HandHeart, CalendarDays,
  CheckCircle2, Building2, BadgeCheck, TrendingUp, LogIn, LogOut, BarChart3, BedDouble,
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
  href, label, Icon, count,
}: { href: string; label: string; Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>; count?: number }) {
  const path = usePathname();
  const active = path === href || (href !== "/owner" && path?.startsWith(href + "/"));

  return (
    <Link
      href={href}
      className="group no-underline flex items-center justify-between rounded-xl px-3 py-[9px] transition-all duration-200"
      style={active
        ? { background: "rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)" }
        : { background: "transparent" }
      }
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <span className="flex-shrink-0 w-[22px] h-[22px] rounded-lg flex items-center justify-center transition-all duration-200"
            style={active
              ? { background: "rgba(255,255,255,0.18)" }
              : { background: "rgba(255,255,255,0.08)" }
            }>
            <Icon className="w-3 h-3" style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.55)" }} aria-hidden />
          </span>
        )}
        <span className="text-[12.5px] font-medium truncate"
          style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.65)" }}>
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span className="ml-1 px-[7px] py-px rounded-full text-[9.5px] font-black leading-none flex-shrink-0"
            style={active
              ? { background: "rgba(255,255,255,0.22)", color: "#ffffff" }
              : { background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)" }
            }>
            {count}
          </span>
        )}
      </div>
      <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-50 transition-opacity duration-200"
        style={{ color: "#ffffff" }} aria-hidden />
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
        onClick={onClick}
        aria-expanded={isOpen}
        className="w-full group flex items-center gap-3 px-2 py-2.5 rounded-2xl transition-all duration-200"
        style={isOpen
          ? { background: "rgba(255,255,255,0.06)" }
          : active
          ? { background: "rgba(255,255,255,0.08)" }
          : { background: "transparent" }
        }
      >
        <span
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
          style={isOpen || active
            ? { background: "rgba(255,255,255,0.18)", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }
            : { background: "rgba(255,255,255,0.07)" }
          }
        >
          <Icon className="w-[17px] h-[17px]" style={{ color: isOpen || active ? "#ffffff" : "rgba(255,255,255,0.55)" }} aria-hidden />
        </span>
        <span className="flex-1 text-left text-[13px] font-semibold tracking-[-0.01em]"
          style={{ color: isOpen || active ? "#ffffff" : "rgba(255,255,255,0.75)" }}>
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
          <div className="pl-2 pr-1 pt-0.5 pb-1 space-y-0.5">
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
      className="group no-underline flex items-center gap-3 px-2 py-2.5 rounded-2xl transition-all duration-200"
      style={active
        ? { background: "rgba(255,255,255,0.16)", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }
        : { background: "transparent" }
      }
    >
      <span
        className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
        style={active
          ? { background: "rgba(255,255,255,0.22)", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }
          : { background: "rgba(255,255,255,0.07)" }
        }
      >
        <Icon className="w-[17px] h-[17px]" style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.55)" }} aria-hidden />
      </span>
      <span className="text-[13px] font-semibold tracking-[-0.01em]"
        style={{ color: active ? "#ffffff" : "rgba(255,255,255,0.75)" }}>
        {label}
      </span>
      {active && <span className="ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.60)" }} />}
    </Link>
  );
}

function Divider() {
  return <div className="h-px mx-2 my-1" style={{ background: "rgba(255,255,255,0.07)" }} />;
}

/* 
   MAIN EXPORT
 */
export default function OwnerSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const [propOpen, setPropOpen] = useState(true);
  const [bookOpen, setBookOpen] = useState(true);
  const [revenueOpen, setRevenueOpen] = useState(true);
  const [groupStaysOpen, setGroupStaysOpen] = useState(true);
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
    intervalId = setInterval(() => { if (mounted) fetchCounts(); }, 30000);
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

  const path = usePathname();
  const sectionActive = {
    properties: path === "/owner/properties" || path.startsWith("/owner/properties/"),
    bookings: path === "/owner/bookings" || path.startsWith("/owner/bookings/"),
    groupStays: path === "/owner/group-stays" || path.startsWith("/owner/group-stays/"),
    revenue: path === "/owner/revenue" || path.startsWith("/owner/revenue/") || path === "/owner/reports" || path.startsWith("/owner/reports/"),
  };

  /*  COLLAPSED  */
  if (collapsed) {
    return (
      <div
        className="flex flex-col items-center gap-1.5 p-2 rounded-2xl"
        style={{
          background: "linear-gradient(180deg,#022a26 0%,#024d47 60%,#02584f 100%)",
          boxShadow: "0 4px 24px rgba(2,60,54,0.40)",
        }}
      >
        <CollapseBtn href="/owner" label="Dashboard" Icon={LayoutDashboard} active={path === "/owner"} />
        <CollapseBtn href="/owner/nrms" label="Rooms Management" Icon={BedDouble} active={path === "/owner/nrms" || path.startsWith("/owner/nrms/")} />
        <div className="w-6 h-px my-0.5" style={{ background: "rgba(255,255,255,0.09)" }} />
        <CollapseBtn href="/owner/properties/approved" label="My Properties" Icon={Building2} active={sectionActive.properties} />
        <CollapseBtn href="/owner/bookings" label="Bookings" Icon={Calendar} active={sectionActive.bookings} count={checkedInCount + checkoutDueCount || undefined} />
        <CollapseBtn href="/owner/group-stays" label="Group Stays" Icon={Users} active={sectionActive.groupStays} />
        <CollapseBtn href="/owner/revenue/requested" label="My Revenue" Icon={Wallet} active={sectionActive.revenue} />
      </div>
    );
  }

  /*  EXPANDED  */
  return (
    <div
      className="rounded-3xl overflow-hidden select-none"
      style={{
        background: "linear-gradient(175deg,#021e1b 0%,#023530 30%,#024d47 65%,#025248 100%)",
        boxShadow: "0 8px 40px rgba(2,40,36,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo strip */}
      <div className="px-4 pt-4 pb-3.5 flex items-center gap-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/NoLS2025-04.png" alt="NoLSAF" className="w-7 h-7 rounded-xl object-contain flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-black tracking-wide text-white leading-none">NoLSAF</p>
          <p className="text-[9.5px] font-medium mt-[3px] leading-none" style={{ color: "rgba(255,255,255,0.38)" }}>Owner Portal</p>
        </div>
      </div>

      {/* Nav */}
      <div className="px-2.5 py-2.5 space-y-0.5">

        <TopItem href="/owner" label="Dashboard" Icon={LayoutDashboard} />
        <TopItem href="/owner/nrms" label="Rooms Management" Icon={BedDouble} />
        <Divider />

        <Section label="My Properties" Icon={Building2} isOpen={propOpen} active={sectionActive.properties} onClick={() => setPropOpen(v => !v)}>
          <SubItem href="/owner/properties/approved" label="Approved" Icon={BadgeCheck} />
          <SubItem href="/owner/properties/pending" label="Pending" Icon={FileText} />
          <SubItem href="/owner/properties/availability" label="Room Availability" Icon={CalendarDays} />
          <SubItem href="/owner/properties/add" label="Add New" Icon={PlusSquare} />
        </Section>

        <Section label="Bookings" Icon={Calendar} isOpen={bookOpen} active={sectionActive.bookings} onClick={() => setBookOpen(v => !v)}>
          <SubItem href="/owner/bookings/validate" label="Check-in" Icon={LogIn} />
          <SubItem href="/owner/bookings/checked-in" label="Checked-In" Icon={CheckCircle2} count={checkedInCount} />
          <SubItem href="/owner/bookings/check-out" label="Check-out" Icon={LogOut} count={checkoutDueCount} />
          <SubItem href="/owner/bookings/checked-out" label="Checked-Out" Icon={CheckCircle2} />
        </Section>

        <Section label="Group Stays" Icon={Users} isOpen={groupStaysOpen} active={sectionActive.groupStays} onClick={() => setGroupStaysOpen(v => !v)}>
          <SubItem href="/owner/group-stays" label="Assigned to Me" Icon={Users} />
          <SubItem href="/owner/group-stays/claims" label="Available to Claim" Icon={HandHeart} />
          <SubItem href="/owner/group-stays/claims/my-claims" label="My Claims" Icon={FileText} />
        </Section>

        <Section label="My Revenue" Icon={Wallet} isOpen={revenueOpen} active={sectionActive.revenue} onClick={() => setRevenueOpen(v => !v)}>
          <SubItem href="/owner/revenue/requested" label="Requested" Icon={TrendingUp} />
          <SubItem href="/owner/revenue/paid" label="Paid Invoices" Icon={BadgeCheck} />
          <SubItem href="/owner/revenue/rejected" label="Rejected" Icon={FileText} />
          <SubItem href="/owner/reports/overview" label="Reports" Icon={BarChart3} />
        </Section>

      </div>

      {/* Bottom shimmer */}
      <div className="h-[3px]" style={{ background: "linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)" }} />
    </div>
  );
}

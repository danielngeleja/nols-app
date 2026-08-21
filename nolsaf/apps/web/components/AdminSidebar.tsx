"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { Home, LayoutDashboard, Users, Truck, LineChart, Building2, Calendar, FileText, Wallet, Settings, ChevronDown, ChevronLeft, ChevronRight, ShieldCheck, Receipt, ListFilter, Award, Megaphone, UserPlus, Trophy, Bell, BarChart3, Activity, Eye, Briefcase, MessageSquare, Ban, Bot, Gift, KeyRound, Play, Calculator, AlertTriangle, TrendingUp, Coins, MapPin, Hotel, Send, Handshake } from "lucide-react";
import { useEffect, useState } from "react";

type Item = {
  href: string;
  label: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

type SidebarVariant = "light" | "dark";

function Item({
  href,
  label,
  Icon,
  isSubItem = false,
  collapsed = false,
  path,
  variant,
}: {
  href: string;
  label: string;
  Icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  isSubItem?: boolean;
  collapsed?: boolean;
  path: string | null;
  variant: SidebarVariant;
}) {
  const active = path === href || path?.startsWith(href + "/");
  const dark = variant === "dark";

  // Dark variant mirrors the NRMS workspace sidebar exactly (see
  // app/(owner)/owner/nrms/layout.tsx): no icon border, tile tints only, and the
  // glyph inherits the row's text colour instead of a fixed teal.
  const iconWrapClass = dark
    ? active
      ? "bg-emerald-950/10"
      : "bg-white/[0.04] group-hover:bg-white/[0.08]"
    : active
      ? "bg-[#02665e]/10 border border-[#02665e]/15"
      : "bg-[#02665e]/5 border border-[#02665e]/10";

  const iconClass = dark ? "" : "text-[#02665e]";
  
  if (collapsed) {
    return (
      <Link
        href={href}
        title={label}
        className={dark
          ? `group relative no-underline hover:no-underline flex min-h-9 items-center justify-center rounded-lg border px-2 text-[13px] font-semibold transition
            ${active
              ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm"
              // bg-transparent is required, not redundant: Tailwind preflight is
              // disabled, so a <button> with no background falls back to the UA
              // default (light grey) and hides the label.
              : "border-transparent bg-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20`
          : `group relative no-underline flex items-center justify-center rounded-2xl p-3 text-sm font-medium transition-colors duration-200
            bg-white/70 border shadow-sm backdrop-blur-[2px]
            ${active
              ? "text-[#02665e] border-[#02665e]/20 bg-[#02665e]/5"
              : "text-[#02665e] border-[#02665e]/10 hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/25`}
      >
        {Icon ? (
          dark ? (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${iconWrapClass}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : (
            <span className={`grid place-items-center rounded-xl h-12 w-12 ${iconWrapClass}`}>
              <Icon className={`h-6 w-6 ${iconClass}`} aria-hidden />
            </span>
          )
        ) : null}
        {/* Tooltip for collapsed state */}
        <span className={`absolute left-full ml-2 px-2 py-1 text-xs font-medium rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-200 ${dark ? "text-white bg-black/70 border border-white/10" : "text-white bg-gray-900"}`}>
          {label}
        </span>
      </Link>
    );
  }
  
  return (
    <Link
      href={href}
      title={label}
      className={dark
        ? `group relative no-underline hover:no-underline flex min-h-9 items-center gap-2.5 rounded-lg border px-2.5 text-[13px] font-semibold transition
          ${active
            ? isSubItem
              ? "border-transparent bg-white/10 text-white"
              : "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm"
            : "border-transparent bg-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20
          ${isSubItem ? "min-h-8 font-medium" : ""}`
        : `group no-underline flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-medium
          transition-colors duration-200 border bg-white/90 shadow-sm
          ${active
            ? "text-[#02665e] border-[#02665e]/20 bg-[#02665e]/5"
            : "text-[#02665e] border-[#02665e]/10 hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/25
          ${isSubItem ? "ml-3 pl-3" : ""}`}
    >
      {dark ? (
        <>
          {Icon && !isSubItem ? (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${iconWrapClass}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 min-w-0">
            {Icon ? (
              <span className={`grid place-items-center rounded-xl h-9 w-9 ${iconWrapClass}`}>
                <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden />
              </span>
            ) : null}
            <span className={`${isSubItem ? "text-[13px]" : ""} truncate whitespace-nowrap`}>{label}</span>
          </div>
          <ChevronRight
            className={`h-4 w-4 opacity-60 flex-shrink-0 transition-opacity text-[#02665e] ${active ? "opacity-85" : "group-hover:opacity-85"}`}
            aria-hidden
          />
        </>
      )}
    </Link>
  );
}

const adminDetails: Item[] = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/owners", label: "Owners", Icon: Building2 },
  { href: "/admin/bookings", label: "Bookings", Icon: Calendar },
  { href: "/admin/properties/previews", label: "Previews", Icon: Eye },
  { href: "/admin/payments", label: "Payments", Icon: Wallet },
];

const driverDetails: Item[] = [
  { href: "/admin/drivers", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/drivers/vetting", label: "Driver Vetting", Icon: ShieldCheck },
  { href: "/admin/drivers/all", label: "All Drivers", Icon: Truck },
  { href: "/admin/drivers/trips", label: "Trips", Icon: Calendar },
  { href: "/admin/drivers/trips/scheduled", label: "Scheduled Trips", Icon: Calendar },
  { href: "/admin/drivers/invoices", label: "Invoices", Icon: FileText },
  { href: "/admin/drivers/paid", label: "Paid", Icon: Wallet },
  { href: "/admin/drivers/revenues", label: "Revenues", Icon: LineChart },
  { href: "/admin/drivers/referrals", label: "Referrals", Icon: UserPlus },
  { href: "/admin/drivers/bonuses", label: "Bonuses", Icon: Award },
  { href: "/admin/drivers/levels", label: "Levels", Icon: Trophy },
  { href: "/admin/drivers/reminders", label: "Reminders", Icon: Bell },
  { href: "/admin/drivers/stats", label: "Stats", Icon: BarChart3 },
  { href: "/admin/drivers/activities", label: "All Activities", Icon: Activity },
];

const groupStayDetails: Item[] = [
  { href: "/admin/group-stays", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/group-stays/revenue", label: "Revenue", Icon: TrendingUp },
  { href: "/admin/group-stays/bookings", label: "Bookings", Icon: Calendar },
  { href: "/admin/group-stays/requests", label: "Requests", Icon: FileText },
  { href: "/admin/group-stays/claims", label: "Submitted Claims", Icon: Gift },
  { href: "/admin/group-stays/payouts", label: "Owner Earnings", Icon: Wallet },
  { href: "/admin/group-stays/assignments", label: "Assignments", Icon: Users },
  { href: "/admin/group-stays/passengers", label: "Passengers", Icon: Users },
  { href: "/admin/group-stays/arrangements", label: "Arrangements", Icon: Settings },
];

const agentsDetails: Item[] = [
  { href: "/admin/agents/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/agents/tour-operators", label: "Tour Operator", Icon: Building2 },
  { href: "/admin/agents/tour-bookings", label: "Tour Booking", Icon: Calendar },
  { href: "/admin/agents/tour-experience", label: "Tour Experience", Icon: BarChart3 },
  { href: "/admin/agents/tour-revenue", label: "Tour Revenue", Icon: TrendingUp },
  { href: "/admin/agents", label: "All Agents", Icon: Users },
  { href: "/admin/agents/ai", label: "Twiga", Icon: MessageSquare },
];

const cancellationsDetails: Item[] = [
  { href: "/admin/cancellations", label: "Dashboard", Icon: LayoutDashboard },
];

const nrmsDetails: Item[] = [
  { href: "/admin/nrms", label: "Directory", Icon: LayoutDashboard },
  { href: "/admin/nrms/agents", label: "Agency verification", Icon: Users },
  { href: "/admin/nrms/partnerships", label: "Partnership oversight", Icon: Handshake },
  { href: "/admin/nrms/channels", label: "OTA Control", Icon: KeyRound },
  { href: "/admin/nrms/billing", label: "PAYG Billing", Icon: Wallet },
  { href: "/admin/nrms/pricing", label: "Pricing & Levers", Icon: Coins },
  { href: "/admin/nrms/reconciliation", label: "Reconciliation", Icon: Receipt },
  { href: "/admin/nrms/integrity", label: "Integrity Signals", Icon: Activity },
  { href: "/admin/nrms/support", label: "Support Snapshot", Icon: Eye },
  { href: "/admin/nrms/health", label: "System Health", Icon: Activity },
];

const salesDetails: Item[] = [
  { href: "/admin/sales/partners", label: "Sales partners", Icon: Users },
  { href: "/admin/sales", label: "Conversion review", Icon: ShieldCheck },
  { href: "/admin/sales/finance", label: "Finance", Icon: Wallet },
  { href: "/admin/sales/materials", label: "Learning materials", Icon: FileText },
];

const userDetails: Item[] = [
  { href: "/admin/users", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/users/list", label: "All Users", Icon: Users },
  { href: "/admin/users/transport-bookings", label: "Transport Bookings", Icon: Truck },
  { href: "/admin/users/bookings", label: "Bookings", Icon: Calendar },
];

const managementDetails: Item[] = [
  { href: "/admin/management", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/lifecycle-health", label: "Lifecycle Health", Icon: Activity },
  { href: "/admin/observability", label: "Observability", Icon: Activity },
  { href: "/admin/impact-center", label: "Technical Impact", Icon: AlertTriangle },
  { href: "/admin/management/reports", label: "Reports", Icon: FileText },
  { href: "/admin/management/audit-log", label: "Audit Log", Icon: ShieldCheck },
  { href: "/admin/management/no4p-otp", label: "No4P OTP", Icon: KeyRound },
  { href: "/admin/management/bookings", label: "Bookings", Icon: Calendar },
  { href: "/admin/management/careers", label: "Careers", Icon: Briefcase },
  { href: "/admin/management/invoices", label: "Invoices", Icon: Receipt },
  { href: "/admin/management/ip-allowlist", label: "IP Allowlist", Icon: ListFilter },
  { href: "/admin/management/owners", label: "Owners", Icon: Building2 },
  { href: "/admin/management/pickup-points", label: "Pickup Points", Icon: MapPin },
  { href: "/admin/management/podcasts", label: "Podcasts", Icon: Play },
  { href: "/admin/management/trust-partners", label: "Trust Partners", Icon: Award },
  { href: "/admin/management/nolscope", label: "NoLScope Rates", Icon: Calculator },
  { href: "/admin/management/currency", label: "Currency Rates", Icon: Coins },
  { href: "/admin/management/service-availability", label: "Service Availability", Icon: MapPin },
  { href: "/admin/management/settings", label: "Settings", Icon: Settings },
  { href: "/admin/management/updates", label: "Updates", Icon: Megaphone },
  { href: "/admin/management/users", label: "Users", Icon: Users },
];

// Detailed admin links (analytics, owners, bookings, properties, etc.) remain reachable from the Admin dashboard page.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function AdminNav({ variant = "light", collapsed = false }: { variant?: "light" | "dark"; collapsed?: boolean }) {
  const path = usePathname();
  const dark = variant === "dark";
  const [adminOpen, setAdminOpen] = useState(false);
  const [driverOpen, setDriverOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [groupStayOpen, setGroupStayOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [cancellationsOpen, setCancellationsOpen] = useState(false);
  const [nrmsOpen, setNrmsOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);

  const activeSection = (() => {
    if (!path) return null;
    if (path === "/admin/home") return "Home";
    if (path.startsWith("/admin/action-center")) return "Action Center";
    if (path.startsWith("/admin/nrms")) return "NRMS";
    if (path.startsWith("/admin/sales")) return "Sales";
    if (path.startsWith("/admin/drivers")) return "Drivers";
    if (path.startsWith("/admin/users")) return "Users";
    if (path.startsWith("/admin/group-stays")) return "Group Stay";
    if (path.startsWith("/admin/agents")) return "No4P Agents";
    if (path.startsWith("/admin/cancellations")) return "Cancellations";
    if (path.startsWith("/admin/observability")) return "Management";
    if (path.startsWith("/admin/lifecycle-health")) return "Management";
    if (path.startsWith("/admin/impact-center")) return "Management";
    if (path.startsWith("/admin/management")) return "Management";
    if (
      path === "/admin" ||
      path === "/admin/owners" ||
      path.startsWith("/admin/owners/") ||
      path === "/admin/bookings" ||
      path.startsWith("/admin/bookings/") ||
      path === "/admin/properties" ||
      path.startsWith("/admin/properties/") ||
      path === "/admin/payments" ||
      path.startsWith("/admin/payments/") ||
      path === "/admin/revenue" ||
      path.startsWith("/admin/revenue/")
    ) {
      return "Owners";
    }
    return null;
  })();

  // Dark variant uses the NRMS group label: plain uppercase text, no leading dot
  // and no hairline rule.
  const SectionHeader = ({ title, active }: { title: string; active: boolean }) => {
    if (dark) {
      return (
        <p className="mb-1.5 mt-0 px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/45">
          {title}
        </p>
      );
    }
    return (
      <div className="px-1">
        <div className="flex items-center gap-3 px-3">
          <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#02665e]" : "bg-[#02665e]/35"}`} />
          <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-[#02665e]/55">
            {title}
          </div>
          <div className="h-px flex-1 bg-[#02665e]/10" />
        </div>
      </div>
    );
  };

  const GroupHeader = ({ title }: { title: string }) => {
    if (collapsed) return null;
    if (dark) {
      return (
        <p className="mb-1.5 mt-2 px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/45">
          {title}
        </p>
      );
    }
    return (
      <div className="pt-2">
        <div className="px-3 text-[10px] font-semibold tracking-[0.26em] uppercase text-[#02665e]/45">
          {title}
        </div>
      </div>
    );
  };

  useEffect(() => {
    // Auto-open sections only when navigating to routes within that section
    // Default: all sections closed, /admin/home is the default landing page
    if (!path) return;
    const isAdminHome = path === "/admin/home";
    const isDrivers = path.startsWith("/admin/drivers");
    const isManagement = path.startsWith("/admin/management");
    const isObservability = path.startsWith("/admin/observability");
    const isImpactCenter = path.startsWith("/admin/impact-center");
    const isUsers = path.startsWith("/admin/users");
    const isGroupStay = path.startsWith("/admin/group-stays");
    const isAgents = path.startsWith("/admin/agents");
    const isCancellations = path.startsWith("/admin/cancellations");
    const isNrms = path.startsWith("/admin/nrms");
    const isSales = path.startsWith("/admin/sales");
    // Owner (admin) mini-sidebar: open when on /admin (owners dashboard) or admin child routes
    // but NOT on /admin/home (which is the admin , not owners)
    const isAdminChildRoute = (path === "/admin" ||
                                path === "/admin/owners" || path.startsWith("/admin/owners/") ||
                                path === "/admin/bookings" || path.startsWith("/admin/bookings/") ||
                                path === "/admin/properties" || path.startsWith("/admin/properties/") ||
                                path === "/admin/payments" || path.startsWith("/admin/payments/") ||
                                path === "/admin/revenue" || path.startsWith("/admin/revenue/")) &&
                                !isAdminHome && !isDrivers && !isUsers && !isGroupStay && !isAgents && !isCancellations && !isManagement;
    setAdminOpen(isAdminChildRoute);
    // Driver mini-sidebar: open when on driver-related routes
    if (isDrivers) setDriverOpen(true);
    else setDriverOpen(false);
    // Management mini-sidebar: open when on management routes
    if (isManagement || isObservability || isImpactCenter) setManagementOpen(true);
    else setManagementOpen(false);
    // Group Stay mini-sidebar: open when on group stay routes
    if (isGroupStay) setGroupStayOpen(true);
    else setGroupStayOpen(false);
    // Agents mini-sidebar: open when on agents routes
    if (isAgents) setAgentsOpen(true);
    else setAgentsOpen(false);
    // Cancellations mini-sidebar
    if (isCancellations) setCancellationsOpen(true);
    else setCancellationsOpen(false);
    // NRMS mini-sidebar
    if (isNrms) setNrmsOpen(true);
    else setNrmsOpen(false);
    setSalesOpen(isSales);
    // Visual chevrons for Users
    setUsersOpen(isUsers);
  }, [path]);

  // Collapsible section button component
  const CollapsibleButton = ({ 
    label, 
    Icon, 
    isOpen, 
    onClick, 
    collapsed,
    active,
  }: { 
    label: string; 
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; 
    isOpen: boolean; 
    onClick: () => void;
    collapsed: boolean;
    active: boolean;
  }) => {
    if (collapsed) {
      return (
        <button
          onClick={onClick}
          title={label}
          className={dark
            ? `group relative w-full appearance-none flex min-h-9 items-center justify-center rounded-lg border px-2 text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20
              ${active
                ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm"
                // bg-transparent is required, not redundant: Tailwind preflight is
              // disabled, so a <button> with no background falls back to the UA
              // default (light grey) and hides the label.
              : "border-transparent bg-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}`
            : `group relative w-full flex items-center justify-center rounded-2xl p-3 text-sm font-medium border transition-colors duration-200 focus:outline-none focus-visible:ring-2
              text-[#02665e] bg-white/70 border-[#02665e]/10
              ${active
                ? "bg-[#02665e]/6 border-[#02665e]/25"
                : "hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
              focus-visible:ring-[#02665e]/25`}
        >
          {dark ? (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : (
            <span className={`grid place-items-center rounded-xl h-12 w-12 border ${active ? "bg-[#02665e]/10 border-[#02665e]/20" : "bg-[#02665e]/5 border-[#02665e]/10"}`}>
              <Icon className="h-6 w-6 text-[#02665e]" aria-hidden />
            </span>
          )}
          {/* Tooltip for collapsed state */}
          <span className={`absolute left-full ml-2 px-2 py-1 text-xs font-medium rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity duration-200 ${dark ? "text-white bg-black/70 border border-white/10" : "text-white bg-gray-900"}`}>
            {label}
          </span>
        </button>
      );
    }
    
    return (
      <button
        onClick={onClick}
        title={label}
        className={dark
          ? `group w-full appearance-none flex min-h-9 items-center justify-between gap-2.5 rounded-lg border px-2.5 text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20
            ${active
              ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm"
              // bg-transparent is required, not redundant: Tailwind preflight is
              // disabled, so a <button> with no background falls back to the UA
              // default (light grey) and hides the label.
              : "border-transparent bg-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}`
          : `group w-full flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold border transition-colors duration-200 focus:outline-none focus-visible:ring-2
            text-[#02665e] bg-white/90 border-[#02665e]/10 shadow-sm
            ${active
              ? "bg-[#02665e]/6 border-[#02665e]/25"
              : "hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
            focus-visible:ring-[#02665e]/25`}
      >
        <span className={`flex min-w-0 items-center ${dark ? "gap-2.5" : "gap-3"}`}>
          {dark ? (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
          ) : (
            <span className={`grid place-items-center rounded-xl h-9 w-9 border ${active ? "bg-[#02665e]/10 border-[#02665e]/20" : "bg-[#02665e]/5 border-[#02665e]/10"}`}>
              <Icon className="h-4 w-4 text-[#02665e]" aria-hidden />
            </span>
          )}
          <span className="truncate whitespace-nowrap">{label}</span>
        </span>
        {isOpen ? (
          <ChevronDown className={dark ? "h-3.5 w-3.5 shrink-0" : `h-4 w-4 text-[#02665e] ${active ? "opacity-90" : "opacity-70"}`} aria-hidden />
        ) : (
          <ChevronRight className={dark ? "h-3.5 w-3.5 shrink-0" : `h-4 w-4 text-[#02665e] ${active ? "opacity-90" : "opacity-70"}`} aria-hidden />
        )}
      </button>
    );
  };

  // Expanded children of a collapsible section. Dark variant renders them
  // Cloudflare-style: no repeated section header, children indented under a
  // single vertical guide-line rail, animated open/close. Light variant keeps
  // its existing header + spaced tiles so other surfaces are unaffected.
  const NestedGroup = ({
    open,
    title,
    active,
    items,
  }: {
    open: boolean;
    title: string;
    active: boolean;
    items: Item[];
  }) => {
    if (collapsed) return null;

    if (!dark) {
      if (!open) return null;
      return (
        <div className="mt-2">
          <SectionHeader title={title} active={active} />
          <div className="mt-2 space-y-2">
            {items.map(({ href, label, Icon }) => (
              <Item key={href} href={href} label={label} Icon={Icon} isSubItem collapsed={collapsed} path={path} variant={variant} />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div
        aria-hidden={!open}
        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[1.35rem] mt-0.5 space-y-0.5 border-0 border-l border-solid border-white/10 pl-2.5">
            {items.map(({ href, label, Icon }) => (
              <Item key={href} href={href} label={label} Icon={Icon} isSubItem collapsed={collapsed} path={path} variant={variant} />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={
        dark
          // The NRMS sidebar panel is the <aside> itself. This wrapper must stay
          // transparent or it paints a second panel inside the green rail.
          // h-full lets the nav scroll internally while the footer stays pinned.
          ? "flex h-full min-h-0 flex-col"
          : `rounded-3xl border border-[#02665e]/10 shadow-[0_12px_30px_rgba(2,102,94,0.08)] ${collapsed ? "p-2 bg-gradient-to-b from-white via-white to-[#02665e]/[0.09]" : "p-3 bg-white"}`
      }
    >
      <div className={dark ? "sidebar-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto" : `space-y-2 ${collapsed ? "space-y-1" : ""}`}>
        <GroupHeader title="PAGES" />

        {/* Home */}
        <Item href="/admin/home" label="Home" Icon={Home} collapsed={collapsed} path={path} variant={variant} />

        {/* Platform-wide revenue across every stream; not owner-specific, so it stands at the top. */}
        <Item href="/admin/finance" label="All Revenue" Icon={TrendingUp} collapsed={collapsed} path={path} variant={variant} />

        {/* Unified business operations queue; specialist workflows remain in their existing sections. */}
        <Item href="/admin/action-center" label="Action Center" Icon={AlertTriangle} collapsed={collapsed} path={path} variant={variant} />

        {/* Cross-flow AzamPay payout queue (owner/tour/driver/sales). Self-contained
            workspace (own sidebar, own chrome) — this is just the entry point,
            same pattern as the owner-side NRMS Workspace link. */}
        <Item href="/admin/disbursements" label="Disbursements" Icon={Send} collapsed={collapsed} path={path} variant={variant} />

        {/* Admin/Owners */}
        {collapsed ? (
          <Item href="/admin" label="Owners" Icon={Building2} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="Owners" 
              Icon={Building2} 
              isOpen={adminOpen} 
              onClick={() => setAdminOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "Owners"}
            />
            <NestedGroup open={adminOpen} title="Owners" active={activeSection === "Owners"} items={adminDetails} />
          </div>
        )}

        {/* Drivers */}
        {collapsed ? (
          <Item href="/admin/drivers" label="Drivers" Icon={Truck} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="Drivers" 
              Icon={Truck} 
              isOpen={driverOpen} 
              onClick={() => setDriverOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "Drivers"}
            />
            <NestedGroup open={driverOpen} title="Drivers" active={activeSection === "Drivers"} items={driverDetails} />
          </div>
        )}

        {/* Users */}
        {collapsed ? (
          <Item href="/admin/users" label="Users" Icon={Users} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="Users" 
              Icon={Users} 
              isOpen={usersOpen} 
              onClick={() => setUsersOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "Users"}
            />
            <NestedGroup open={usersOpen} title="Users" active={activeSection === "Users"} items={userDetails} />
          </div>
        )}

        <GroupHeader title="PROGRAMS" />

        {/* Group Stay */}
        {collapsed ? (
          <Item href="/admin/group-stays" label="Group Stay" Icon={Users} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="Group Stay" 
              Icon={Users} 
              isOpen={groupStayOpen} 
              onClick={() => setGroupStayOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "Group Stay"}
            />
            <NestedGroup open={groupStayOpen} title="Group Stay" active={activeSection === "Group Stay"} items={groupStayDetails} />
          </div>
        )}

        {/* Agents */}
        {collapsed ? (
          <Item href="/admin/agents/dashboard" label="No4P Agents" Icon={Bot} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="No4P Agents" 
              Icon={Bot} 
              isOpen={agentsOpen} 
              onClick={() => setAgentsOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "No4P Agents"}
            />
            <NestedGroup open={agentsOpen} title="No4P Agents" active={activeSection === "No4P Agents"} items={agentsDetails} />
          </div>
        )}

        {/* NRMS */}
        {collapsed ? (
          <Item href="/admin/nrms" label="NRMS" Icon={Hotel} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton
              label="NRMS"
              Icon={Hotel}
              isOpen={nrmsOpen}
              onClick={() => setNrmsOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "NRMS"}
            />
            <NestedGroup open={nrmsOpen} title="NRMS" active={activeSection === "NRMS"} items={nrmsDetails} />
          </div>
        )}

        {/* Sales partners */}
        {collapsed ? (
          <Item href="/admin/sales" label="Sales partners" Icon={Briefcase} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton
              label="Sales partners"
              Icon={Briefcase}
              isOpen={salesOpen}
              onClick={() => setSalesOpen((value) => !value)}
              collapsed={collapsed}
              active={activeSection === "Sales"}
            />
            <NestedGroup open={salesOpen} title="Sales partners" active={activeSection === "Sales"} items={salesDetails} />
          </div>
        )}

        <GroupHeader title="ADMIN" />

        {/* Cancellations */}
        {collapsed ? (
          <Item href="/admin/cancellations" label="Cancellations" Icon={Ban} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="Cancellations" 
              Icon={Ban} 
              isOpen={cancellationsOpen} 
              onClick={() => setCancellationsOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "Cancellations"}
            />
            <NestedGroup open={cancellationsOpen} title="Cancellations" active={activeSection === "Cancellations"} items={cancellationsDetails} />
          </div>
        )}

        {/* Management */}
        {collapsed ? (
          <Item href="/admin/management" label="Management" Icon={Settings} collapsed={collapsed} path={path} variant={variant} />
        ) : (
          <div>
            <CollapsibleButton 
              label="Management" 
              Icon={Settings} 
              isOpen={managementOpen} 
              onClick={() => setManagementOpen(v => !v)}
              collapsed={collapsed}
              active={activeSection === "Management"}
            />
            <NestedGroup open={managementOpen} title="Management" active={activeSection === "Management"} items={managementDetails} />
          </div>
        )}

      </div>

      {/* Collapse control, mirroring the NRMS sidebar footer. The admin layout owns
          the open/closed state and already listens for this event, so no prop
          plumbing is needed. Hidden below md because the rail itself is md-and-up. */}
      {dark && (
        <div className="mt-3 shrink-0 border-0 border-t border-solid border-white/10 bg-black/5 p-2.5">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("toggle-admin-sidebar"))}
            className={`hidden min-h-8 w-full appearance-none items-center rounded-lg border border-white/[0.06] bg-white/[0.05] text-[11px] font-semibold text-emerald-100/60 transition hover:bg-white/10 hover:text-white md:flex ${collapsed ? "justify-center" : "justify-between px-2.5"}`}
            aria-label={collapsed ? "Expand admin sidebar" : "Collapse admin sidebar"}
          >
            {!collapsed && "Collapse sidebar"}
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

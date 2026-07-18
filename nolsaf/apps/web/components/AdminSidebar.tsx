"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { Home, LayoutDashboard, Users, Truck, LineChart, Building2, Calendar, FileText, Wallet, Settings, ChevronDown, ChevronRight, ShieldCheck, Receipt, ListFilter, Award, Megaphone, UserPlus, Trophy, Bell, BarChart3, Activity, Eye, Briefcase, MessageSquare, Ban, Bot, Gift, KeyRound, Play, Calculator, AlertTriangle, TrendingUp, Coins, MapPin, Hotel } from "lucide-react";
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

  const iconWrapClass = dark
    ? active
      ? "bg-white/10 border-white/15"
      : "bg-white/5 border-white/10"
    : active
      ? "bg-[#02665e]/10 border-[#02665e]/15"
      : "bg-[#02665e]/5 border-[#02665e]/10";

  const iconClass = dark
    ? "text-teal-200"
    : "text-[#02665e]";
  
  if (collapsed) {
    return (
      <Link
        href={href}
        title={label}
        className={`group relative no-underline flex items-center justify-center rounded-2xl p-3 text-sm font-medium transition-colors duration-200
          ${dark ? "bg-white/5 border border-white/10" : "bg-white/70 border shadow-sm backdrop-blur-[2px]"}
          ${dark
            ? active
              ? "text-slate-100 bg-white/10 border-white/15"
              : "text-slate-200 hover:bg-white/10 hover:border-white/15"
            : active
              ? "text-[#02665e] border-[#02665e]/20 bg-[#02665e]/5"
              : "text-[#02665e] border-[#02665e]/10 hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
          focus:outline-none focus-visible:ring-2 ${dark ? "focus-visible:ring-white/20" : "focus-visible:ring-[#02665e]/25"}`}
      >
        {Icon ? (
          <span className={`grid place-items-center rounded-xl h-12 w-12 border ${iconWrapClass}`}>
            <Icon className={`h-6 w-6 ${iconClass}`} aria-hidden />
          </span>
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
      className={`group no-underline flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-medium
        transition-colors duration-200 border
        ${dark ? "bg-white/5 border-white/10" : "bg-white/90 shadow-sm border-[#02665e]/10"}
        ${dark
          ? active
            ? "text-slate-100 bg-white/10 border-white/15"
            : "text-slate-200 hover:bg-white/10 hover:border-white/15"
          : active
            ? "text-[#02665e] border-[#02665e]/20 bg-[#02665e]/5"
            : "text-[#02665e] border-[#02665e]/10 hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
        focus:outline-none focus-visible:ring-2 ${dark ? "focus-visible:ring-white/20" : "focus-visible:ring-[#02665e]/25"}
        ${isSubItem ? "ml-3 pl-3" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon ? (
          <span className={`grid place-items-center rounded-xl h-9 w-9 border ${iconWrapClass}`}>
            <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden />
          </span>
        ) : null}
        <span className={`${isSubItem ? "text-[13px]" : ""} truncate whitespace-nowrap`}>{label}</span>
      </div>
      <ChevronRight
        className={`h-4 w-4 opacity-60 flex-shrink-0 transition-opacity ${dark ? "text-slate-200" : "text-[#02665e]"} ${active ? "opacity-85" : "group-hover:opacity-85"}`}
        aria-hidden
      />
    </Link>
  );
}

const adminDetails: Item[] = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/admin/finance", label: "All Revenue", Icon: TrendingUp },
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
  { href: "/admin/nrms/billing", label: "PAYG Billing", Icon: Wallet },
  { href: "/admin/nrms/pricing", label: "Pricing & Levers", Icon: Coins },
  { href: "/admin/nrms/reconciliation", label: "Reconciliation", Icon: Receipt },
  { href: "/admin/nrms/integrity", label: "Integrity Signals", Icon: Activity },
  { href: "/admin/nrms/support", label: "Support Snapshot", Icon: Eye },
  { href: "/admin/nrms/health", label: "System Health", Icon: Activity },
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
  { href: "/admin/impact-center", label: "Impact Center", Icon: AlertTriangle },
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

  const activeSection = (() => {
    if (!path) return null;
    if (path === "/admin/home") return "Home";
    if (path.startsWith("/admin/nrms")) return "NRMS";
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

  const SectionHeader = ({ title, active }: { title: string; active: boolean }) => (
    <div className="px-1">
      <div className="flex items-center gap-3 px-3">
        <span className={`h-1.5 w-1.5 rounded-full ${dark ? (active ? "bg-teal-200" : "bg-white/25") : (active ? "bg-[#02665e]" : "bg-[#02665e]/35")}`} />
        <div className={`text-[10px] font-semibold tracking-[0.22em] uppercase ${dark ? "text-white/45" : "text-[#02665e]/55"}`}>
          {title}
        </div>
        <div className={`h-px flex-1 ${dark ? "bg-white/10" : "bg-[#02665e]/10"}`} />
      </div>
    </div>
  );

  const GroupHeader = ({ title }: { title: string }) => {
    if (collapsed) return null;
    return (
      <div className="pt-2">
        <div className={`px-3 text-[10px] font-semibold tracking-[0.26em] uppercase ${dark ? "text-white/35" : "text-[#02665e]/45"}`}>
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
          className={`group relative w-full flex items-center justify-center rounded-2xl p-3 text-sm font-medium border transition-colors duration-200 focus:outline-none focus-visible:ring-2
            ${dark ? "text-slate-200 bg-white/5 border-white/10" : "text-[#02665e] bg-white/70 border-[#02665e]/10"}
            ${dark
              ? active
                ? "bg-white/10 border-white/15"
                : "hover:bg-white/10 hover:border-white/15"
              : active
                ? "bg-[#02665e]/6 border-[#02665e]/25"
                : "hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
            ${dark ? "focus-visible:ring-white/20" : "focus-visible:ring-[#02665e]/25"}`}
        >
          <span
            className={`grid place-items-center rounded-xl h-12 w-12 border ${dark ? (active ? "bg-white/10 border-white/15" : "bg-white/5 border-white/10") : (active ? "bg-[#02665e]/10 border-[#02665e]/20" : "bg-[#02665e]/5 border-[#02665e]/10")}`}
          >
            <Icon className={`h-6 w-6 ${dark ? "text-teal-200" : "text-[#02665e]"}`} aria-hidden />
          </span>
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
        className={`group w-full flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold border transition-colors duration-200 focus:outline-none focus-visible:ring-2
          ${dark ? "text-slate-200 bg-white/5 border-white/10" : "text-[#02665e] bg-white/90 border-[#02665e]/10 shadow-sm"}
          ${dark
            ? active
              ? "bg-white/10 border-white/15"
              : "hover:bg-white/10 hover:border-white/15"
            : active
              ? "bg-[#02665e]/6 border-[#02665e]/25"
              : "hover:bg-[#02665e]/5 hover:border-[#02665e]/20"}
          ${dark ? "focus-visible:ring-white/20" : "focus-visible:ring-[#02665e]/25"}`}
      >
        <span className="flex items-center gap-3 min-w-0">
          <span className={`grid place-items-center rounded-xl h-9 w-9 border ${dark ? (active ? "bg-white/10 border-white/15" : "bg-white/5 border-white/10") : (active ? "bg-[#02665e]/10 border-[#02665e]/20" : "bg-[#02665e]/5 border-[#02665e]/10")}`}>
            <Icon className={`h-4 w-4 ${dark ? "text-teal-200" : "text-[#02665e]"}`} aria-hidden />
          </span>
          <span className={`${dark ? "text-slate-100" : ""} truncate whitespace-nowrap`}>{label}</span>
        </span>
        {isOpen ? (
          <ChevronDown className={`h-4 w-4 ${dark ? "text-slate-200" : "text-[#02665e]"} ${active ? "opacity-90" : "opacity-70"}`} aria-hidden />
        ) : (
          <ChevronRight className={`h-4 w-4 ${dark ? "text-slate-200" : "text-[#02665e]"} ${active ? "opacity-90" : "opacity-70"}`} aria-hidden />
        )}
      </button>
    );
  };

  return (
    <div
      className={
        dark
          ? `rounded-3xl border border-white/10 bg-gradient-to-b from-[#0b1220] via-[#0a1624] to-[#070f1a] shadow-[0_20px_60px_rgba(0,0,0,0.35)] ${collapsed ? "p-2" : "p-3"}`
          : `rounded-3xl border border-[#02665e]/10 shadow-[0_12px_30px_rgba(2,102,94,0.08)] ${collapsed ? "p-2 bg-gradient-to-b from-white via-white to-[#02665e]/[0.09]" : "p-3 bg-white"}`
      }
    >
      <div className={`space-y-2 ${collapsed ? "space-y-1" : ""}`}>
        <GroupHeader title="PAGES" />

        {/* Home */}
        <Item href="/admin/home" label="Home" Icon={Home} collapsed={collapsed} path={path} variant={variant} />

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
            {adminOpen && (
              <div className="mt-2">
                <SectionHeader title="Owners" active={activeSection === "Owners"} />
                <div className="mt-2 space-y-2">
                  {adminDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
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
            {driverOpen && (
              <div className="mt-2">
                <SectionHeader title="Drivers" active={activeSection === "Drivers"} />
                <div className="mt-2 space-y-2">
                  {driverDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
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
            {usersOpen && (
              <div className="mt-2">
                <SectionHeader title="Users" active={activeSection === "Users"} />
                <div className="mt-2 space-y-2">
                  {userDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
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
            {groupStayOpen && (
              <div className="mt-2">
                <SectionHeader title="Group Stay" active={activeSection === "Group Stay"} />
                <div className="mt-2 space-y-2">
                  {groupStayDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
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
            {agentsOpen && (
              <div className="mt-2">
                <SectionHeader title="No4P Agents" active={activeSection === "No4P Agents"} />
                <div className="mt-2 space-y-2">
                  {agentsDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
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
            <div
              aria-hidden={!nrmsOpen}
              className={`grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${
                nrmsOpen
                  ? "grid-rows-[1fr] translate-y-0 opacity-100"
                  : "pointer-events-none grid-rows-[0fr] -translate-y-1 opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="mt-2">
                  <SectionHeader title="NRMS" active={activeSection === "NRMS"} />
                  <div className="mt-2 space-y-2">
                    {nrmsDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                      <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
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
            {cancellationsOpen && (
              <div className="mt-2">
                <SectionHeader title="Cancellations" active={activeSection === "Cancellations"} />
                <div className="mt-2 space-y-2">
                  {cancellationsDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
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
            {managementOpen && (
              <div className="mt-2">
                <SectionHeader title="Management" active={activeSection === "Management"} />
                <div className="mt-2 space-y-2">
                  {managementDetails.map(({ href: dHref, label: dLabel, Icon: DIcon }) => (
                    <Item key={dHref} href={dHref} label={dLabel} Icon={DIcon} isSubItem collapsed={collapsed} path={path} variant={variant} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

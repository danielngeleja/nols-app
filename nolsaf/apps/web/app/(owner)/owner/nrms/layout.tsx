"use client";

import { type ReactNode, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BedDouble,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  FileText,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Menu,
  QrCode,
  ReceiptText,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Store,
  Users,
  UsersRound,
  UtensilsCrossed,
  WalletCards,
  Wine,
  X,
} from "lucide-react";
import { NrmsProvider, useNrms, propertyTrialDaysLeft } from "./_components/NrmsProvider";
import NrmsActivationScreen from "./_components/NrmsActivationScreen";
import NrmsFrozenNotice from "./_components/NrmsFrozenNotice";
import NrmsPropertyGate from "./_components/NrmsPropertyGate";
import NrmsOperationalFooter from "./_components/NrmsOperationalFooter";

const PRIMARY_TABS = [
  { href: "/owner/nrms", label: "Front desk", icon: DoorOpen, exact: true },
  { href: "/owner/nrms/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/owner/nrms/orders", label: "Orders", icon: ShoppingBasket },
  { href: "/owner/nrms/analytics", label: "Revenue", icon: BarChart3 },
  { href: "/owner/nrms/reports", label: "Reports", icon: FileText },
];

const NAV_GROUPS = [
  {
    label: "Operations",
    items: [
      { href: "/owner/nrms", label: "Front desk", icon: LayoutDashboard, exact: true },
      { href: "/owner/nrms/reservations", label: "Reservations", icon: ClipboardList },
      { href: "/owner/nrms/orders", label: "Restaurant & bar", icon: ShoppingBasket },
      { href: "/owner/nrms/housekeeping", label: "Housekeeping", icon: Sparkles },
      { href: "/owner/nrms/calendar", label: "Room calendar", icon: CalendarDays },
      { href: "/owner/nrms/guests", label: "Guests", icon: Users },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/owner/nrms/outlets", label: "Outlets & menus", icon: Store },
      { href: "/owner/nrms/qr-codes", label: "QR order points", icon: QrCode },
      { href: "/owner/nrms/staff", label: "Staff & roles", icon: UsersRound },
      { href: "/owner/nrms/rooms", label: "Rooms", icon: BedDouble },
      { href: "/owner/nrms/channels", label: "OTA channels", icon: Link2 },
      { href: "/owner/nrms/controls", label: "Hotel controls", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/owner/nrms/finance", label: "Finance & Night Audit", icon: WalletCards },
      { href: "/owner/nrms/analytics", label: "Revenue & analytics", icon: BarChart3 },
      { href: "/owner/nrms/reports", label: "Reports", icon: FileText },
      { href: "/owner/nrms/billing", label: "NRMS billing", icon: ReceiptText },
    ],
  },
];

function isActive(pathname: string, item: { href: string; exact?: boolean }) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

// Outlet staff serve one side only, so the shared "Restaurant & bar" entry is
// renamed and re-iconed to match the assigned role.
function ordersNavPresentation(role: string): { label: string; icon: typeof ShoppingBasket } | null {
  if (role === "BAR") return { label: "Bar orders", icon: Wine };
  if (role === "RESTAURANT") return { label: "Restaurant orders", icon: UtensilsCrossed };
  if (role === "OUTLET_SUPERVISOR") return { label: "Outlet orders", icon: Store };
  return null;
}

function roleCanSee(href: string, role: string) {
  if (role === "OWNER") return true;
  if (role === "MANAGER") return ["/owner/nrms/orders", "/owner/nrms/housekeeping", "/owner/nrms/outlets", "/owner/nrms/qr-codes", "/owner/nrms/staff", "/owner/nrms/finance"].includes(href);
  if (role === "OUTLET_SUPERVISOR") return ["/owner/nrms/orders", "/owner/nrms/outlets"].includes(href);
  if (role === "FRONT_DESK") return ["/owner/nrms/orders", "/owner/nrms/housekeeping", "/owner/nrms/finance"].includes(href);
  if (role === "HOUSEKEEPER") return href === "/owner/nrms/housekeeping";
  return href === "/owner/nrms/orders";
}

function PropertyActivationGate() {
  const { selectedProperty, activateProperty } = useNrms();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!selectedProperty) return null;

  const activate = async () => {
    setBusy(true);
    setMessage(null);
    const result = await activateProperty(selectedProperty.id);
    if (!result.ok) setMessage(result.message || "Property activation failed");
    setBusy(false);
  };

  return (
    <section className="mx-auto mt-10 max-w-3xl rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Building2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lg font-bold text-neutral-950">Activate NRMS for {selectedProperty.title}</h2>
          <p className="mb-0 mt-1 text-sm text-neutral-500">Operational tools are isolated per property and require activation.</p>
        </div>
        <button type="button" onClick={activate} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {busy ? "Activating…" : "Activate property"}
        </button>
      </div>
      {message && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>}
    </section>
  );
}

function NrmsShell({ children }: { children: ReactNode }) {
  const { loading, error, entitled, restriction, properties, selectedPropertyId, selectedProperty, setSelectedPropertyId, refresh } = useNrms();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalFreeze, setGlobalFreeze] = useState<{ referenceCode?: string | null; reason?: string | null } | null>(null);
  const daysLeft = propertyTrialDaysLeft(selectedProperty);
  const accessRole = selectedProperty?.nrmsAccessRole ?? "OWNER";
  const exitHref = accessRole === "OWNER" ? "/owner" : "/account";

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("nrms-sidebar-collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  // Any NRMS request on any page can 423 once a property is frozen mid-session
  // (reservations, orders, analytics, reports, ...). apiClient dispatches this
  // event on every such response so the shell can show one consistent notice
  // instead of each page rendering its own raw error text.
  useEffect(() => {
    const handleFrozen = (event: Event) => {
      const detail = (event as CustomEvent<{ referenceCode?: string | null; reason?: string | null }>).detail;
      setGlobalFreeze({ referenceCode: detail?.referenceCode ?? null, reason: detail?.reason ?? null });
    };
    window.addEventListener("nrms-property-frozen", handleFrozen);
    return () => window.removeEventListener("nrms-property-frozen", handleFrozen);
  }, []);
  // Switching to a different property (via the sidebar/topbar switcher) should
  // drop the frozen overlay so that property's own pages get a fresh chance to load.
  useEffect(() => { setGlobalFreeze(null); }, [selectedPropertyId]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("nrms-sidebar-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) {
    const frozen = error.includes("temporarily frozen by an administrator");
    if (frozen) {
      return (
        <div className="min-h-screen bg-neutral-50">
          <NrmsFrozenNotice propertyTitle={selectedProperty?.title} referenceCode={globalFreeze?.referenceCode ?? selectedProperty?.restriction?.referenceCode} reason={globalFreeze?.reason ?? selectedProperty?.restriction?.reason} loading={loading} onRefresh={() => void refresh()} />
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-neutral-50">
        <NrmsFrozenNotice variant="error" loading={loading} onRefresh={() => void refresh()} />
      </div>
    );
  }
  if (!entitled && restriction) {
    return <NrmsFrozenNotice scope="enrollment" referenceCode={restriction.referenceCode} reason={restriction.reason} loading={loading} onRefresh={() => void refresh()} />;
  }
  // NRMS is part and parcel of the Marketplace. Nothing below this point should
  // be reachable without an admin-approved listing, regardless of enrollment state.
  // This is specifically an ownership gate: assigned staff inherit access from
  // the approved property behind their active membership and must not be asked
  // to own a separate approved property themselves. The API still validates the
  // assigned property's approval and operational state on every request.
  const showPropertyGate = accessRole === "OWNER" && !properties.some((p) => p.status === "APPROVED");

  if (!showPropertyGate && !entitled) return <NrmsActivationScreen />;

  const selectedPropertyFrozen = selectedProperty?.nrmsPaygAccount?.status === "FROZEN";
  if (!showPropertyGate && (globalFreeze || selectedPropertyFrozen)) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <NrmsFrozenNotice
          propertyTitle={selectedProperty?.title}
          referenceCode={globalFreeze?.referenceCode ?? selectedProperty?.restriction?.referenceCode}
          reason={globalFreeze?.reason ?? selectedProperty?.restriction?.reason}
          loading={loading}
          onRefresh={() => void refresh()}
        />
      </div>
    );
  }

  const propertyNeedsActivation = Boolean(accessRole === "OWNER" && selectedProperty && !selectedProperty.nrmsActivatedAt && !pathname.startsWith("/owner/nrms/rooms") && !pathname.startsWith("/owner/nrms/help") && !pathname.startsWith("/owner/nrms/policy"));

  const sidebar = (
    <aside className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-emerald-950/70 bg-[#082f2a] text-white shadow-[0_14px_34px_rgba(8,47,42,0.18)] transition-[width] duration-200 ${collapsed ? "w-[4.5rem]" : "w-[17rem]"}`}>
      <div className={`flex min-h-[5rem] items-center border-b border-white/10 ${collapsed ? "justify-center px-2" : "gap-3 px-4"}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-white shadow-sm"><Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority /></span>
        {!collapsed && <><span className="h-8 w-px shrink-0 bg-white/10" aria-hidden /><div className="min-w-0"><h1 className="m-0 truncate text-base font-bold tracking-[-0.01em]">NRMS Workspace</h1><p className="mb-0 mt-1 text-[10px] text-emerald-100/50">Property management system</p></div></>}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="NRMS workspace navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3.5 last:mb-0">
            {!collapsed && <p className="mb-1.5 px-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-100/45">{group.label}</p>}
            <div className="space-y-0.5">
              {group.items.filter((item) => roleCanSee(item.href, accessRole)).map((item) => {
                const override = item.href === "/owner/nrms/orders" ? ordersNavPresentation(accessRole) : null;
                const Icon = override?.icon ?? item.icon;
                const label = override?.label ?? item.label;
                const active = isActive(pathname, item);
                return (
                  <Link key={item.href} href={item.href} title={collapsed ? label : undefined} aria-current={active ? "page" : undefined} className={`group flex min-h-9 items-center rounded-lg border text-[13px] font-semibold no-underline transition hover:no-underline ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm" : "border-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}><Icon className="h-3.5 w-3.5" /></span>
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 bg-black/5 p-2.5">
        <Link href={exitHref} title={collapsed ? "Exit NRMS" : undefined} className={`flex min-h-9 items-center rounded-lg border border-amber-200/10 bg-amber-100/[0.04] text-[12px] font-semibold text-amber-100 no-underline transition hover:border-amber-200/20 hover:bg-amber-300/10 hover:text-amber-50 hover:no-underline ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}>
          <LogOut className="h-3.5 w-3.5 shrink-0" />{!collapsed && (accessRole === "OWNER" ? "Exit to marketplace" : "Exit NRMS")}
        </Link>
        <button type="button" onClick={toggleCollapsed} className={`mt-1.5 hidden min-h-8 w-full appearance-none items-center rounded-lg border border-white/[0.06] bg-white/[0.05] text-[11px] font-semibold text-emerald-100/60 hover:bg-white/10 hover:text-white lg:flex ${collapsed ? "justify-center" : "justify-between px-2.5"}`} aria-label={collapsed ? "Expand NRMS sidebar" : "Collapse NRMS sidebar"}>
          {!collapsed && "Collapse sidebar"}{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen min-h-[36rem] min-w-0 overflow-hidden bg-neutral-100">
      <div className="hidden shrink-0 p-3 lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[10000] lg:hidden">
          <button type="button" aria-label="Close NRMS navigation" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[17.5rem] p-3">{sidebar}<button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-white"><X className="h-4 w-4" /></button></div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="mx-3 mt-3 shrink-0 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex min-h-[4.75rem] items-center gap-3 px-3 sm:px-5">
            <button type="button" onClick={() => setMobileOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 lg:hidden" aria-label="Open NRMS navigation"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><p className="m-0 truncate text-sm font-bold text-neutral-950">{selectedProperty?.title ?? "NRMS property"}</p>{daysLeft != null && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">{daysLeft} days trial</span>}</div>
              <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Live property operations</p>
            </div>
            {/* Only an owner with more than one property may switch. Staff are
                scoped to the property behind their assignment and must never be
                offered a way to change or see another one, so they get a static
                label, not a select. The API enforces this too; this is the UI half. */}
            {accessRole === "OWNER" && properties.length > 1 ? (
              <label className="hidden min-w-0 items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 sm:flex">
                <Building2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <select value={selectedPropertyId ?? ""} onChange={(event) => setSelectedPropertyId(Number(event.target.value))} className="max-w-52 border-0 bg-transparent p-0 text-xs font-bold text-neutral-800 outline-none" aria-label="Select NRMS property">
                  {properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}
                </select>
              </label>
            ) : selectedProperty ? (
              <span className="hidden min-w-0 items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 sm:flex">
                <Building2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <span className="max-w-52 truncate text-xs font-bold text-neutral-800">{selectedProperty.title}</span>
              </span>
            ) : null}
            <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700 md:inline">{accessRole.replaceAll("_", " ")}</span>
            <Link href={exitHref} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline hover:bg-neutral-50 hover:text-neutral-900 hover:no-underline">
              <LogOut className="h-4 w-4" /><span className="hidden sm:inline">{accessRole === "OWNER" ? "Marketplace" : "Exit NRMS"}</span>
            </Link>
          </div>

          <nav className="overflow-x-auto border-t border-neutral-100 px-3 sm:px-5" aria-label="Primary NRMS operations">
            <div className="flex w-max min-w-full gap-1">
              {PRIMARY_TABS.filter((tab) => roleCanSee(tab.href, accessRole)).map((tab) => {
                const override = tab.href === "/owner/nrms/orders" ? ordersNavPresentation(accessRole) : null;
                const Icon = override?.icon ?? tab.icon;
                const active = isActive(pathname, tab);
                return <Link key={tab.href} href={tab.href} className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-xs font-bold no-underline transition hover:no-underline ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-400 hover:text-neutral-700"}`}><Icon className="h-4 w-4" />{override?.label ?? tab.label}</Link>;
              })}
            </div>
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">
          {showPropertyGate ? null : propertyNeedsActivation ? <PropertyActivationGate /> : children}
        </main>
        <NrmsOperationalFooter />
      </div>

      {showPropertyGate && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-sm">
          <NrmsPropertyGate loading={loading} onRefresh={() => void refresh()} />
        </div>
      )}
    </div>
  );
}

export default function NrmsLayout({ children }: { children: ReactNode }) {
  return <NrmsProvider><NrmsShell>{children}</NrmsShell></NrmsProvider>;
}

"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BedDouble,
  BookOpen,
  Building2,
  CalendarDays,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ClipboardCheck,
  Coffee,
  DoorOpen,
  FileText,
  Handshake,
  Gauge,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Layers3,
  Link2,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  QrCode,
  Radar,
  ReceiptText,
  Scale,
  ShoppingBasket,
  TrendingUp,
  SlidersHorizontal,
  Sparkles,
  Store,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  WalletCards,
  Wine,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { NrmsProvider, useNrms, propertyTrialDaysLeft } from "./_components/NrmsProvider";
import NrmsActivationScreen from "./_components/NrmsActivationScreen";
import NrmsBootScreen from "./_components/NrmsBootScreen";
import NrmsFrozenNotice from "./_components/NrmsFrozenNotice";
import NrmsPropertyGate from "./_components/NrmsPropertyGate";
import NrmsOperationalFooter from "./_components/NrmsOperationalFooter";

const PRIMARY_TABS = [
  { href: "/owner/nrms", label: "Front desk", icon: DoorOpen, exact: true },
  { href: "/owner/nrms/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/owner/nrms/orders", label: "Orders", icon: ShoppingBasket },
  { href: "/owner/nrms/sales-channels", label: "Sales channels", icon: Radar },
  { href: "/owner/nrms/performance", label: "Performance", icon: TrendingUp },
  { href: "/owner/nrms/analytics", label: "Revenue", icon: BarChart3 },
  { href: "/owner/nrms/reports", label: "Reports", icon: FileText },
];

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; children?: NavItem[]; roles?: string[] };
type NavSection = { label?: string; items: NavItem[] };
type NavGroup = { label: string; sections: NavSection[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    sections: [
      {
        label: "Stay management",
        items: [
          { href: "/owner/nrms", label: "Front desk", icon: LayoutDashboard, exact: true },
          { href: "/owner/nrms/inquiries", label: "Reception inquiries", icon: MessageSquareText },
          { href: "/owner/nrms/calendar", label: "Room calendar", icon: CalendarDays },
          // Not the Owner workspace "Group Stays" (the NoLSAF-brokered marketplace
          // product). These are NRMS reservations worked as one travelling party.
          { href: "/owner/nrms/groups", label: "Group reservations", icon: UsersRound },
          { href: "/owner/nrms/guests", label: "Guests", icon: Users },
        ],
      },
      {
        label: "Housekeeping",
        items: [
          { href: "/owner/nrms/housekeeping", label: "Housekeeping", icon: Sparkles },
        ],
      },
      {
        label: "Food & drink",
        items: [
          {
            href: "/owner/nrms/orders",
            label: "Restaurant & bar",
            icon: ShoppingBasket,
            children: [
              { href: "/owner/nrms/orders", label: "Live room orders", icon: ShoppingBasket, exact: true },
              { href: "/owner/nrms/orders?view=history", label: "Room order history", icon: ReceiptText },
            ],
          },
          { href: "/owner/nrms/tables", label: "Tables & tabs", icon: LayoutGrid },
          { href: "/owner/nrms/breakfast", label: "Breakfast list", icon: Coffee },
        ],
      },
    ],
  },
  {
    label: "Management",
    sections: [
      {
        label: "Food service setup",
        items: [
          {
            href: "/owner/nrms/outlets",
            label: "Outlets & menus",
            icon: Store,
            children: [
              { href: "/owner/nrms/outlets?outlet=setup", label: "Outlet setup", icon: Store },
            ],
          },
          { href: "/owner/nrms/qr-codes", label: "QR order points", icon: QrCode },
          { href: "/owner/nrms/stock", label: "Stock", icon: Package },
        ],
      },
      {
        label: "Property & distribution",
        items: [
          { href: "/owner/nrms/rooms", label: "Rooms", icon: BedDouble },
          {
            href: "/owner/nrms/controls",
            label: "Hotel controls",
            icon: SlidersHorizontal,
            children: [
              { href: "/owner/nrms/controls?section=rates", label: "Rates", icon: SlidersHorizontal },
              { href: "/owner/nrms/controls?section=readiness", label: "Readiness", icon: ClipboardCheck },
              { href: "/owner/nrms/controls?section=service", label: "Service desk", icon: Wrench },
              { href: "/owner/nrms/controls?section=guest", label: "Guest journey", icon: MessageSquareText },
              { href: "/owner/nrms/controls?section=portfolio", label: "Portfolio", icon: Layers3 },
              { href: "/owner/nrms/controls?section=growth", label: "Growth", icon: Gauge },
            ],
          },
          // Performance across every selling route. Sits directly above the two
          // setup screens it reports on, so tuning a channel is one click away.
          { href: "/owner/nrms/sales-channels", label: "Sales channels", icon: Radar },
          {
            href: "/owner/nrms/channels",
            label: "OTA channels",
            icon: Link2,
            children: [
              { href: "/owner/nrms/channels?provider=EXPEDIA", label: "Expedia Group", icon: Link2 },
              { href: "/owner/nrms/channels?provider=BOOKING_COM", label: "Booking.com", icon: Link2 },
              { href: "/owner/nrms/channels?provider=AIRBNB", label: "Airbnb", icon: Link2 },
            ],
          },
          {
            href: "/owner/nrms/agents",
            label: "Travel agents",
            icon: Handshake,
            children: [
              { href: "/owner/nrms/agents", label: "All travel agents", icon: UsersRound, exact: true },
              { href: "/owner/nrms/agents/partnerships", label: "Partnership requests", icon: Handshake },
              { href: "/owner/nrms/agents/requests", label: "Booking requests", icon: Inbox },
            ],
          },
        ],
      },
      {
        label: "Team access",
        items: [
          { href: "/owner/nrms/staff", label: "Staff & roles", icon: UsersRound },
        ],
      },
    ],
  },
  {
    label: "Shift & cash",
    sections: [
      { items: [{ href: "/owner/nrms/shift", label: "Shift & cash", icon: Wallet }] },
    ],
  },
  {
    label: "Finance",
    sections: [
      {
        items: [
          {
            href: "/owner/nrms/finance",
            label: "Finance & Night Audit",
            icon: WalletCards,
            children: [
              { href: "/owner/nrms/finance?view=audit", label: "Night Audit", icon: ClipboardCheck, roles: ["OWNER", "MANAGER", "FRONT_DESK"] },
              { href: "/owner/nrms/finance?view=cashiers", label: "Cashier variance", icon: WalletCards, roles: ["OWNER", "MANAGER", "FRONT_DESK"] },
              { href: "/owner/nrms/finance?view=expenses", label: "Expenses", icon: ReceiptText, roles: ["OWNER", "MANAGER"] },
              { href: "/owner/nrms/finance?view=ledger", label: "Accounting ledger", icon: BookOpen, roles: ["OWNER", "MANAGER"] },
              { href: "/owner/nrms/finance?view=tax", label: "Tax register", icon: Calculator, roles: ["OWNER", "MANAGER"] },
              { href: "/owner/nrms/finance?view=nbs", label: "NBS statistics", icon: Scale, roles: ["OWNER", "MANAGER"] },
            ],
          },
          { href: "/owner/nrms/analytics", label: "Revenue & analytics", icon: BarChart3 },
          { href: "/owner/nrms/reports", label: "Reports", icon: FileText },
          { href: "/owner/nrms/billing", label: "NRMS billing", icon: ReceiptText },
        ],
      },
    ],
  },
];

function isActive(pathname: string, item: { href: string; exact?: boolean }) {
  const path = item.href.split("?")[0]!;
  return item.exact ? pathname === path : pathname.startsWith(path);
}

function isNestedActive(pathname: string, searchParams: { get: (name: string) => string | null; toString: () => string }, item: NavItem) {
  const [path, query] = item.href.split("?");
  if (pathname !== path) return false;
  if (!query) return item.exact ? searchParams.toString().length === 0 : true;
  const expected = new URLSearchParams(query);
  return Array.from(expected.entries()).every(([key, value]) => {
    const fallback = key === "provider" ? "EXPEDIA" : key === "section" ? "rates" : key === "view" ? "audit" : key === "outlet" ? "setup" : null;
    return (searchParams.get(key) ?? fallback) === value;
  });
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
  // Shift & cash is scoped to the outlet staff who actually run a drawer at
  // their assigned bar or restaurant, not owner, manager, front desk or a
  // supervisor covering multiple outlets.
  if (href === "/owner/nrms/shift") return role === "BAR" || role === "RESTAURANT";
  // The breakfast list is a front office to restaurant handover, so both sides
  // of that handover can open it, plus the manager who covers for either.
  if (href === "/owner/nrms/breakfast") return ["OWNER", "MANAGER", "FRONT_DESK", "RESTAURANT"].includes(role);
  if (role === "OWNER") return true;
  // Sales channels stays owner-only, like Revenue and Reports: its API is
  // requireRole("OWNER") and it exposes commission and net payout figures.
  if (role === "MANAGER") return ["/owner/nrms/inquiries", "/owner/nrms/groups", "/owner/nrms/orders", "/owner/nrms/tables", "/owner/nrms/performance", "/owner/nrms/housekeeping", "/owner/nrms/outlets", "/owner/nrms/stock", "/owner/nrms/qr-codes", "/owner/nrms/staff", "/owner/nrms/finance"].includes(href);
  if (role === "OUTLET_SUPERVISOR") return ["/owner/nrms/orders", "/owner/nrms/tables", "/owner/nrms/performance", "/owner/nrms/outlets", "/owner/nrms/stock"].includes(href);
  if (role === "FRONT_DESK") return ["/owner/nrms/inquiries", "/owner/nrms/groups", "/owner/nrms/orders", "/owner/nrms/housekeeping", "/owner/nrms/finance"].includes(href);
  if (role === "HOUSEKEEPER") return href === "/owner/nrms/housekeeping";
  // Bar and restaurant staff: their floor, their outlet's stock, performance and shift.
  return ["/owner/nrms/orders", "/owner/nrms/tables", "/owner/nrms/performance", "/owner/nrms/stock", "/owner/nrms/shift"].includes(href);
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
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [travelAgentsOpen, setTravelAgentsOpen] = useState(() => pathname.startsWith("/owner/nrms/agents"));
  const [otaChannelsOpen, setOtaChannelsOpen] = useState(() => pathname.startsWith("/owner/nrms/channels"));
  const [hotelControlsOpen, setHotelControlsOpen] = useState(() => pathname.startsWith("/owner/nrms/controls"));
  const [financeOpen, setFinanceOpen] = useState(() => pathname.startsWith("/owner/nrms/finance"));
  const [outletsOpen, setOutletsOpen] = useState(() => pathname.startsWith("/owner/nrms/outlets"));
  const [ordersOpen, setOrdersOpen] = useState(() => pathname.startsWith("/owner/nrms/orders"));
  const [sidebarOutlets, setSidebarOutlets] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [booting, setBooting] = useState(true);
  const [globalFreeze, setGlobalFreeze] = useState<{ referenceCode?: string | null; reason?: string | null } | null>(null);
  const [liveOrders, setLiveOrders] = useState<{ openRoom: number; openTable: number; placedRoom: number; placedTable: number; byOutlet: Array<{ outletId: number; openRoom: number; placedRoom: number }> } | null>(null);
  const [agentWorkload, setAgentWorkload] = useState<{ partnershipRequests: number; acceptedInvites: number; bookingRequests: number; guestManifests: number; total: number } | null>(null);
  const [inquiryWorkload, setInquiryWorkload] = useState<{ new: number; open: number; overdue: number; total: number } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const prevPlacedRef = useRef<number | null>(null);
  const prevAgentWorkloadRef = useRef<number | null>(null);
  const prevInquiryWorkloadRef = useRef<number | null>(null);
  const daysLeft = propertyTrialDaysLeft(selectedProperty);
  const accessRole = selectedProperty?.nrmsAccessRole ?? "OWNER";
  const exitHref = accessRole === "OWNER" ? "/owner" : "/account";

  const handleBooted = useCallback(() => setBooting(false), []);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("nrms-sidebar-collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (pathname.startsWith("/owner/nrms/agents")) setTravelAgentsOpen(true);
    if (pathname.startsWith("/owner/nrms/channels")) setOtaChannelsOpen(true);
    if (pathname.startsWith("/owner/nrms/controls")) setHotelControlsOpen(true);
    if (pathname.startsWith("/owner/nrms/finance")) setFinanceOpen(true);
    if (pathname.startsWith("/owner/nrms/outlets")) setOutletsOpen(true);
    if (pathname.startsWith("/owner/nrms/orders")) setOrdersOpen(true);
  }, [pathname]);

  useEffect(() => {
    const canSeeOutletNavigation = roleCanSee("/owner/nrms/orders", accessRole) || roleCanSee("/owner/nrms/outlets", accessRole);
    if (!selectedPropertyId || !canSeeOutletNavigation) { setSidebarOutlets([]); return; }
    let active = true;
    void apiClient.get<any>(`/api/nrms/operations/property/${selectedPropertyId}/outlets`)
      .then((response) => {
        if (!active) return;
        setSidebarOutlets((response.data?.outlets ?? []).map((outlet: any) => ({ id: Number(outlet.id), name: String(outlet.name), type: String(outlet.type) })));
      })
      .catch(() => { if (active) setSidebarOutlets([]); });
    return () => { active = false; };
  }, [accessRole, selectedPropertyId]);

  useEffect(() => {
    const syncOutlets = (event: Event) => {
      const detail = (event as CustomEvent<{ propertyId: number; outlets: Array<{ id: number; name: string; type: string }> }>).detail;
      if (detail?.propertyId === selectedPropertyId) setSidebarOutlets(detail.outlets);
    };
    window.addEventListener("nrms-outlets-updated", syncOutlets);
    return () => window.removeEventListener("nrms-outlets-updated", syncOutlets);
  }, [selectedPropertyId]);

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

  // Browsers block audio until the user interacts, so build/resume the context on
  // the first pointer gesture. Until then arrivals still pulse the badge silently.
  useEffect(() => {
    const unlock = () => {
      try {
        if (!audioRef.current) audioRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        void audioRef.current?.resume?.();
      } catch { /* audio unavailable; the visual badge still rings */ }
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const chime = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const at = now + i * 0.16;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(at); osc.stop(at + 0.16);
      });
    } catch { /* ignore playback errors */ }
  }, []);

  // Split live-order badges: room arrivals badge "Bar orders", table arrivals
  // badge "Tables & tabs". A rise in total new orders rings the arrival chime.
  useEffect(() => {
    const canSee = roleCanSee("/owner/nrms/tables", accessRole) || roleCanSee("/owner/nrms/orders", accessRole);
    if (!selectedPropertyId || !canSee) { setLiveOrders(null); prevPlacedRef.current = null; return; }
    let active = true;
    const fetchCount = async () => {
      try {
        const res = await apiClient.get<{ openRoom: number; openTable: number; placedRoom: number; placedTable: number; byOutlet: Array<{ outletId: number; openRoom: number; placedRoom: number }> }>(`/api/nrms/operations/property/${selectedPropertyId}/orders/live-count`);
        if (!active) return;
        setLiveOrders(res.data);
        const totalPlaced = res.data.placedRoom + res.data.placedTable;
        if (prevPlacedRef.current !== null && totalPlaced > prevPlacedRef.current) chime();
        prevPlacedRef.current = totalPlaced;
      } catch { /* transient; keep the last known count */ }
    };
    void fetchCount();
    const id = setInterval(fetchCount, 20000);
    return () => { active = false; clearInterval(id); };
  }, [selectedPropertyId, accessRole, chime]);

  // Travel-agent work can arrive while the hotel is busy elsewhere in NRMS.
  // Poll the same way as Restaurant & bar and ring only when the actionable
  // queue grows; handled or expired items disappear from the marker.
  useEffect(() => {
    const canSee = roleCanSee("/owner/nrms/agents", accessRole);
    if (!selectedPropertyId || !canSee) { setAgentWorkload(null); prevAgentWorkloadRef.current = null; return; }
    let active = true;
    const fetchCount = async () => {
      try {
        const res = await apiClient.get<{ partnershipRequests: number; acceptedInvites: number; bookingRequests: number; guestManifests: number; total: number }>(`/api/owner/nrms/agents/property/${selectedPropertyId}/live-count`);
        if (!active) return;
        setAgentWorkload(res.data);
        if (prevAgentWorkloadRef.current !== null && res.data.total > prevAgentWorkloadRef.current) chime();
        prevAgentWorkloadRef.current = res.data.total;
      } catch { /* transient; keep the last known count */ }
    };
    void fetchCount();
    const id = setInterval(fetchCount, 20000);
    return () => { active = false; clearInterval(id); };
  }, [selectedPropertyId, accessRole, chime]);

  // Reception inquiries are property-scoped and remain visible until the team
  // resolves, converts or closes them. Ring when a new actionable inquiry lands.
  useEffect(() => {
    const canSee = roleCanSee("/owner/nrms/inquiries", accessRole);
    if (!selectedPropertyId || !canSee) { setInquiryWorkload(null); prevInquiryWorkloadRef.current = null; return; }
    let active = true;
    const fetchCount = async () => {
      try {
        const res = await apiClient.get<{ new: number; open: number; overdue: number; total: number }>(`/api/owner/nrms/inquiries/property/${selectedPropertyId}/live-count`);
        if (!active) return;
        setInquiryWorkload(res.data);
        if (prevInquiryWorkloadRef.current !== null && res.data.total > prevInquiryWorkloadRef.current) chime();
        prevInquiryWorkloadRef.current = res.data.total;
      } catch { /* transient; keep the last known count */ }
    };
    void fetchCount();
    const id = setInterval(fetchCount, 20000);
    return () => { active = false; clearInterval(id); };
  }, [selectedPropertyId, accessRole, chime]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { localStorage.setItem("nrms-sidebar-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // The boot screen owns the entrance only. A later refresh() flips loading
  // back on without re-showing it, so switching property or retrying never
  // throws the whole workspace behind a splash again.
  if (booting && !error) {
    return <NrmsBootScreen ready={!loading} propertyTitle={selectedProperty?.title} onDone={handleBooted} />;
  }
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

  // The workspace introduces itself by what the person does, not by the product.
  const roleSubtitle = accessRole === "BAR" ? "Bar service"
    : accessRole === "RESTAURANT" ? "Restaurant service"
    : accessRole === "HOUSEKEEPER" ? "Housekeeping"
    : accessRole === "FRONT_DESK" ? "Front desk"
    : accessRole === "OUTLET_SUPERVISOR" ? "Outlet operations"
    : accessRole === "MANAGER" ? "Hotel management"
    : "Room management system";

  const sidebar = (
    <aside className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-emerald-950/70 bg-[#082f2a] text-white shadow-[0_14px_34px_rgba(8,47,42,0.18)] transition-[width] duration-200 ${collapsed ? "w-[4.5rem]" : "w-[17rem]"}`}>
      <div className={`flex min-h-[5rem] items-center border-b border-white/10 ${collapsed ? "justify-center px-2" : "gap-3 px-4"}`}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-white shadow-sm"><Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={40} height={40} className="h-9 w-9 scale-[1.9] object-contain" priority /></span>
        {!collapsed && <><span className="h-8 w-px shrink-0 bg-white/10" aria-hidden /><div className="min-w-0"><h1 className="m-0 truncate text-base font-bold tracking-[0.02em]">NRMS WORKSPACE</h1><p className="mb-0 mt-1 text-[10px] text-emerald-100/50">{roleSubtitle}</p></div></>}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3" aria-label="NRMS workspace navigation">
        {NAV_GROUPS.map((group) => {
          // A role that can see nothing in a group must not see the group label
          // either: bar staff were getting empty MANAGEMENT and FINANCE headers.
          const visibleSections = group.sections
            .map((section) => ({ ...section, items: section.items.filter((item) => roleCanSee(item.href, accessRole)) }))
            .filter((section) => section.items.length > 0);
          if (!visibleSections.length) return null;
          return (
          <div key={group.label} className="mb-3.5 last:mb-0">
            {!collapsed && <p className="mb-2 px-2.5 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-100/50">{group.label}</p>}
            <div className="space-y-2.5">
              {visibleSections.map((section, sectionIndex) => (
                <div key={section.label ?? `${group.label}-${sectionIndex}`} className={sectionIndex > 0 && !collapsed ? "border-t border-white/[0.06] pt-2.5" : ""}>
                  {!collapsed && section.label && (
                    <div className="mb-1 flex items-center gap-2 px-2.5">
                      <span className="shrink-0 text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-100/30">{section.label}</span>
                      <span className="h-px flex-1 bg-white/[0.05]" aria-hidden />
                    </div>
                  )}
                  <div className="space-y-0.5">
                  {section.items.map((item) => {
                const override = item.href === "/owner/nrms/orders" ? ordersNavPresentation(accessRole) : null;
                const Icon = override?.icon ?? item.icon;
                const label = override?.label ?? item.label;
                const active = isActive(pathname, item);
                const nestedChildren: NavItem[] = item.href === "/owner/nrms/orders"
                  ? [
                      ...(item.children ?? []),
                      ...sidebarOutlets.map((outlet) => ({ href: `/owner/nrms/orders?outlet=${outlet.id}`, label: outlet.name, icon: outlet.type === "BAR" ? Wine : UtensilsCrossed } satisfies NavItem)),
                    ]
                  : item.href === "/owner/nrms/outlets"
                  ? [...(item.children ?? []), ...sidebarOutlets.map((outlet) => ({ href: `/owner/nrms/outlets?outlet=${outlet.id}`, label: outlet.name, icon: outlet.type === "BAR" ? Wine : UtensilsCrossed } satisfies NavItem))]
                  : item.children ?? [];
                const isNestedGroup = nestedChildren.length > 0;
                const nestedOpen = item.href === "/owner/nrms/orders" ? ordersOpen : item.href === "/owner/nrms/agents" ? travelAgentsOpen : item.href === "/owner/nrms/channels" ? otaChannelsOpen : item.href === "/owner/nrms/controls" ? hotelControlsOpen : item.href === "/owner/nrms/finance" ? financeOpen : item.href === "/owner/nrms/outlets" ? outletsOpen : false;
                const toggleNested = item.href === "/owner/nrms/orders" ? setOrdersOpen : item.href === "/owner/nrms/agents" ? setTravelAgentsOpen : item.href === "/owner/nrms/channels" ? setOtaChannelsOpen : item.href === "/owner/nrms/controls" ? setHotelControlsOpen : item.href === "/owner/nrms/finance" ? setFinanceOpen : setOutletsOpen;
                const nestedId = item.href === "/owner/nrms/orders" ? "nrms-orders-navigation" : item.href === "/owner/nrms/agents" ? "nrms-travel-agent-navigation" : item.href === "/owner/nrms/channels" ? "nrms-ota-navigation" : item.href === "/owner/nrms/controls" ? "nrms-hotel-controls-navigation" : item.href === "/owner/nrms/finance" ? "nrms-finance-navigation" : "nrms-outlet-navigation";
                // Tables & tabs is an operational workload count, not only an
                // unread notification: keep it visible while the page is open
                // until every table/walk-in order has been completed.
                const badge = item.href === "/owner/nrms/tables"
                  ? (liveOrders?.openTable ? liveOrders.openTable : null)
                  : item.href === "/owner/nrms/inquiries"
                  ? (inquiryWorkload?.total ? inquiryWorkload.total : null)
                  : item.href === "/owner/nrms/orders"
                  ? (!active && liveOrders?.placedRoom ? liveOrders.placedRoom : null)
                  : item.href === "/owner/nrms/agents"
                  ? (agentWorkload?.total ? agentWorkload.total : null)
                  : null;
                if (isNestedGroup && !collapsed) {
                  return (
                    <div key={item.href}>
                      <button
                        type="button"
                        onClick={() => toggleNested((current) => !current)}
                        aria-expanded={nestedOpen}
                        aria-controls={nestedId}
                        className={`group flex min-h-9 w-full appearance-none items-center gap-2.5 rounded-lg border px-2.5 text-left text-[13px] font-semibold transition ${active ? "border-emerald-300/70 !bg-emerald-300 text-emerald-950 shadow-sm" : "border-transparent !bg-transparent text-emerald-50/65 hover:border-white/5 hover:!bg-white/[0.07] hover:text-white"}`}
                      >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}><Icon className="h-3.5 w-3.5" /></span>
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {badge != null && <span className={`shrink-0 min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[18px] ${active ? "bg-emerald-950 text-white" : "animate-pulse bg-violet-500 text-white"}`} aria-label={item.href === "/owner/nrms/orders" ? `${badge} active orders` : `${badge} travel agent items need attention`}>{badge > 99 ? "99+" : badge}</span>}
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${nestedOpen ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                      {nestedOpen && (
                        <div id={nestedId} className="relative ml-5 mt-1 space-y-0.5 border-0 border-l border-solid border-white/10 pl-2">
                          {nestedChildren.filter((child) => !child.roles || child.roles.includes(accessRole)).map((child) => {
                            const ChildIcon = child.icon;
                            const childActive = isNestedActive(pathname, searchParams, child);
                            const childOutletId = child.href.startsWith("/owner/nrms/orders?outlet=") ? Number(child.href.split("outlet=")[1]) : null;
                            const childBadge = childOutletId
                              ? (liveOrders?.byOutlet?.find((row) => row.outletId === childOutletId)?.placedRoom || null)
                              : child.href === "/owner/nrms/agents"
                              ? (agentWorkload?.acceptedInvites ? agentWorkload.acceptedInvites : null)
                              : child.href === "/owner/nrms/agents/partnerships"
                              ? (agentWorkload?.partnershipRequests ? agentWorkload.partnershipRequests : null)
                              : child.href === "/owner/nrms/agents/requests"
                              ? ((agentWorkload?.bookingRequests || agentWorkload?.guestManifests) ? (agentWorkload.bookingRequests + agentWorkload.guestManifests) : null)
                              : null;
                            return (
                              <Link key={child.href} href={child.href} aria-current={childActive ? "page" : undefined} className={`group flex min-h-8 items-center gap-2 rounded-lg border px-2 text-[12px] font-medium no-underline transition hover:no-underline ${childActive ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100" : "border-transparent text-emerald-50/50 hover:bg-white/[0.06] hover:text-white"}`}>
                                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{child.label}</span>
                                {childBadge != null && <span className="min-w-[16px] shrink-0 animate-pulse rounded-full bg-violet-500 px-1 text-center text-[9px] font-bold leading-4 text-white" aria-label={childOutletId ? `${childBadge} new orders for ${child.label}` : `${childBadge} items need attention`}>{childBadge > 99 ? "99+" : childBadge}</span>}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <Link key={item.href} href={item.href} title={collapsed ? label : undefined} aria-current={active ? "page" : undefined} className={`group relative flex min-h-9 items-center rounded-lg border text-[13px] font-semibold no-underline transition hover:no-underline ${collapsed ? "justify-center px-2" : "gap-2.5 px-2.5"} ${active ? "border-emerald-300/70 bg-emerald-300 text-emerald-950 shadow-sm" : "border-transparent text-emerald-50/65 hover:border-white/5 hover:bg-white/[0.07] hover:text-white"}`}>
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${active ? "bg-emerald-950/10" : "bg-white/[0.04] group-hover:bg-white/[0.08]"}`}><Icon className="h-3.5 w-3.5" /></span>
                    {!collapsed && <span className="flex-1 truncate">{label}</span>}
                    {!collapsed && badge != null && <span className={`shrink-0 min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[18px] ${active ? "bg-emerald-950 text-white" : "animate-pulse bg-violet-500 text-white"}`} aria-label={item.href === "/owner/nrms/inquiries" ? `${badge} reception inquiries need attention` : `${badge} active orders`}>{badge > 99 ? "99+" : badge}</span>}
                    {collapsed && badge != null && <span className={`absolute right-0.5 top-0.5 min-w-[16px] rounded-full px-1 text-center text-[8px] font-bold leading-4 text-white ${active ? "bg-emerald-950" : "animate-pulse bg-violet-500"}`} aria-label={item.href === "/owner/nrms/inquiries" ? `${badge} reception inquiries need attention` : `${badge} active orders`}>{badge > 9 ? "9+" : badge}</span>}
                  </Link>
                );
                  })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })}
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

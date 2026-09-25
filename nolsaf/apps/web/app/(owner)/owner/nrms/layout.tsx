"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  CircleDollarSign,
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
  Truck,
  ShoppingCart,
  HandCoins,
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
import { useSocket } from "@/hooks/useSocket";
import { NrmsProvider, useNrms, propertyTrialDaysLeft } from "./_components/NrmsProvider";
import { NrmsAccessRoleProvider } from "./_components/NrmsAccessRole";
import NrmsActivationScreen from "./_components/NrmsActivationScreen";
import NrmsBootScreen from "./_components/NrmsBootScreen";
import NrmsFrozenNotice from "./_components/NrmsFrozenNotice";
import NrmsPropertyGate from "./_components/NrmsPropertyGate";
import FiscalAlertBanner from "./_components/FiscalAlertBanner";
import NrmsOperationalFooter from "./_components/NrmsOperationalFooter";
import NrmsBillingAttention from "./_components/NrmsBillingAttention";
import ModalFrame from "./_components/NrmsModalFrame";

const PRIMARY_TABS = [
  { href: "/owner/nrms", label: "Front desk", icon: DoorOpen, exact: true },
  { href: "/owner/nrms/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/owner/nrms/orders", label: "Orders", icon: ShoppingBasket },
  { href: "/owner/nrms/sales-channels", label: "Sales channels", icon: Radar },
  { href: "/owner/nrms/performance", label: "Performance", icon: TrendingUp },
  { href: "/owner/nrms/analytics", label: "Revenue", icon: BarChart3 },
  { href: "/owner/nrms/reports", label: "Reports", icon: FileText },
];

/**
 * The tab row is the workspace's own top level, so it has to name the screens
 * the reader actually works in. Filtering the owner's operations spine down to
 * what a sales executive may open left exactly one tab sitting alone, which is
 * why their home page had grown a strip of shortcuts of its own. These are
 * those shortcuts, in the place a top level destination belongs.
 */
const SALES_TABS = [
  { href: "/owner/nrms", label: "Sales desk", icon: TrendingUp, exact: true },
  { href: "/owner/nrms/inquiries", label: "Inquiries", icon: MessageSquareText },
  { href: "/owner/nrms/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/owner/nrms/groups", label: "Group blocks", icon: UsersRound },
  { href: "/owner/nrms/agents", label: "Travel agents", icon: Handshake },
  { href: "/owner/nrms/calendar", label: "Availability", icon: CalendarDays },
  { href: "/owner/nrms/sales-rates", label: "Rate proposals", icon: SlidersHorizontal },
  { href: "/owner/nrms/controls?section=guest", label: "Messaging", icon: MessageSquareText },
  { href: "/owner/nrms/sales-performance", label: "My production", icon: BarChart3 },
];

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; children?: NavItem[]; roles?: string[] };
type NavSection = { label?: string; items: NavItem[] };
type NavGroup = { label: string; sections: NavSection[] };

type NrmsAttentionSnapshot = {
  generatedAt: string;
  refreshAfterSeconds: number;
  frontDesk: { arrivals: number; departures: number; total: number };
  inquiries: { new: number; open: number; overdue: number; total: number };
  groups: { dueStays: number; blockReviews: number; total: number };
  housekeeping: { tasks: number; untrackedRooms: number; total: number };
  orders: { openRoom: number; openTable: number; placedRoom: number; placedTable: number; total: number; byOutlet: Array<{ outletId: number; openRoom: number; placedRoom: number }> };
  stock: { low: number; out: number; total: number };
  agents: { partnershipRequests: number; acceptedInvites: number; bookingRequests: number; guestManifests: number; total: number };
  rateProposals: { pending: number; total: number };
  channels: { connections: number; alerts: number; issues: number; total: number; byProvider: Array<{ provider: string; total: number }> };
  finance: {
    unclassifiedTenders: number;
    overdueBusinessDays: number;
    unreconciledShifts: number;
    total: number;
    unclassifiedBusinessDate: string | null;
    overdueBusinessDate: string | null;
    unreconciledBusinessDate: string | null;
    targetBusinessDate: string | null;
  };
  payments: { actionRequired: number; total: number };
};

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
          {
            href: "/owner/nrms/stock",
            label: "Stock",
            icon: Package,
            children: [
              { href: "/owner/nrms/stock", label: "Goods on hand", icon: Package, exact: true },
              // Where the Stock badge points: menu items switched off or below
              // their low-stock number. The storekeeper handles goods only.
              { href: "/owner/nrms/stock?view=menu", label: "Menu availability", icon: UtensilsCrossed, roles: ["OWNER", "MANAGER", "OUTLET_SUPERVISOR", "RESTAURANT", "BAR"] },
              { href: "/owner/nrms/stock/operations", label: "Store operations", icon: Truck },
              { href: "/owner/nrms/stock/purchasing", label: "Purchasing", icon: ShoppingCart },
              { href: "/owner/nrms/stock/counts", label: "Counts & variance", icon: Scale },
              // Supplier money is owner and manager only (stock.payables.manage).
              { href: "/owner/nrms/stock/payables", label: "Supplier payables", icon: HandCoins, roles: ["OWNER", "MANAGER"] },
              { href: "/owner/nrms/stock/insights", label: "Stock insights", icon: TrendingUp, roles: ["OWNER", "MANAGER"] },
              // Setup is owner and manager only (stock.catalog.manage).
              { href: "/owner/nrms/stock/items", label: "Stock items & recipes", icon: BookOpen, roles: ["OWNER", "MANAGER"] },
            ],
          },
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
          // The people, where sales-channels is the routes. Beside it because
          // the two answer the same question from opposite ends.
          { href: "/owner/nrms/sales-performance", label: "Sales production", icon: TrendingUp },
          { href: "/owner/nrms/sales-rates", label: "Rate proposals", icon: SlidersHorizontal },
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
    label: "Payments",
    sections: [
      {
        items: [
          { href: "/owner/nrms/payments", label: "NoLSAF Payments", icon: CircleDollarSign },
        ],
      },
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

function badgeLabel(href: string, count: number): string {
  if (href === "/owner/nrms") return `${count} front desk tasks need attention`;
  if (href === "/owner/nrms/inquiries") return `${count} reception inquiries need attention`;
  if (href === "/owner/nrms/groups") return `${count} group reservation tasks need attention`;
  if (href === "/owner/nrms/housekeeping") return `${count} housekeeping tasks need attention`;
  if (href === "/owner/nrms/agents") return `${count} travel agent items need attention`;
  if (href === "/owner/nrms/sales-rates") return `${count} rate proposals await owner decision`;
  if (href === "/owner/nrms/channels") return `${count} OTA channel issues need attention`;
  if (href === "/owner/nrms/finance") return `${count} finance or night audit blockers need attention`;
  if (href === "/owner/nrms/stock") return `${count} stock items need attention`;
  if (href === "/owner/nrms/payments") return "Your payment application needs your attention";
  if (href === "/owner/nrms/tables") return `${count} open table orders`;
  return `${count} active orders`;
}

function badgeClass(href: string, active: boolean): string {
  if (active) return "bg-emerald-950 text-white";
  if (["/owner/nrms/channels", "/owner/nrms/finance", "/owner/nrms/payments"].includes(href)) return "bg-rose-500 text-white";
  if (["/owner/nrms", "/owner/nrms/groups", "/owner/nrms/housekeeping", "/owner/nrms/tables", "/owner/nrms/stock"].includes(href)) return "bg-amber-400 text-amber-950";
  return "bg-violet-500 text-white";
}

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

/**
 * The NRMS home is composed per role (see the home page itself), so the link
 * to it has to be named for what the role will actually find there. Calling a
 * sales executive's pipeline "Front desk" was the visible half of the same
 * mistake as sending them to arrivals and departures.
 */
function homeNavPresentation(role: string): { label: string; icon: typeof ShoppingBasket } | null {
  if (role === "SALES_EXECUTIVE") return { label: "Sales desk", icon: TrendingUp };
  return null;
}

const NAV_CAPABILITY: Record<string, string> = {
  "/owner/nrms": "property.overview.read",
  "/owner/nrms/reservations": "reservation.read",
  "/owner/nrms/inquiries": "sales.inquiry.read",
  "/owner/nrms/calendar": "availability.read",
  "/owner/nrms/groups": "reservation.read",
  "/owner/nrms/guests": "guest.read",
  "/owner/nrms/housekeeping": "room_status.read",
  "/owner/nrms/orders": "outlet.read",
  "/owner/nrms/tables": "outlet.read",
  "/owner/nrms/breakfast": "outlet.read",
  "/owner/nrms/performance": "finance.revenue.read",
  "/owner/nrms/outlets": "outlet.read",
  "/owner/nrms/stock": "stock.read",
  "/owner/nrms/stock/items": "stock.catalog.manage",
  "/owner/nrms/qr-codes": "property.settings.read",
  "/owner/nrms/staff": "staff.directory.read",
  "/owner/nrms/shift": "finance.shift.read_own",
  "/owner/nrms/payments": "merchant.provider.activate",
  "/owner/nrms/finance": "finance.night_audit.read",
  "/owner/nrms/analytics": "finance.revenue.read",
  "/owner/nrms/reports": "finance.revenue.read",
  "/owner/nrms/billing": "nrms.subscription.manage",
  "/owner/nrms/rooms": "room_status.read",
  "/owner/nrms/controls": "property.settings.read",
  "/owner/nrms/sales-performance": "sales.analytics.read",
  "/owner/nrms/sales-rates": "rates.read",
  "/owner/nrms/controls?section=guest": "sales.inquiry.read",
  "/owner/nrms/sales-channels": "distribution.read",
  "/owner/nrms/channels": "distribution.manage",
  "/owner/nrms/agents": "sales.agent.read",
};

function roleCanSee(href: string, role: string, capabilities: readonly string[] | undefined) {
  const capability = NAV_CAPABILITY[href];
  // The manifest narrows the role rules below, it does not replace them. An API
  // that has not shipped effectiveAccess yet sends no capabilities, and treating
  // that as "denied" would leave the owner staring at an empty sidebar.
  if (capability && capabilities?.length && !capabilities.includes(capability)) return false;
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
  if (role === "MANAGER") return ["/owner/nrms", "/owner/nrms/sales-performance", "/owner/nrms/inquiries", "/owner/nrms/groups", "/owner/nrms/orders", "/owner/nrms/tables", "/owner/nrms/performance", "/owner/nrms/housekeeping", "/owner/nrms/outlets", "/owner/nrms/stock", "/owner/nrms/stock/items", "/owner/nrms/qr-codes", "/owner/nrms/staff", "/owner/nrms/agents", "/owner/nrms/calendar", "/owner/nrms/finance"].includes(href);
  if (role === "OUTLET_SUPERVISOR") return ["/owner/nrms/orders", "/owner/nrms/tables", "/owner/nrms/performance", "/owner/nrms/outlets", "/owner/nrms/stock"].includes(href);
  // The storekeeper owns the goods, not the floor or the till.
  if (role === "STOREKEEPER") return href === "/owner/nrms/stock";
  // Group business is the sales role's own work: they hold sales.group.manage
  // and reservation.read. Reading a block list and shaping a group are both
  // open to them server side; the group master folio money operations are
  // guarded separately and stay closed.
  // "/owner/nrms" is the workspace home, and it is composed per role: a front
  // desk for the roles that work arrivals, a sales pipeline for this one. Every
  // role listed here holds property.overview.read, and each landed on that URL
  // on entering NRMS already; until now none of them had a link back to it.
  if (role === "SALES_EXECUTIVE") return ["/owner/nrms", "/owner/nrms/sales-performance", "/owner/nrms/sales-rates", "/owner/nrms/controls?section=guest", "/owner/nrms/inquiries", "/owner/nrms/reservations", "/owner/nrms/groups", "/owner/nrms/agents", "/owner/nrms/calendar"].includes(href);
  if (role === "FRONT_DESK") return ["/owner/nrms", "/owner/nrms/inquiries", "/owner/nrms/groups", "/owner/nrms/orders", "/owner/nrms/housekeeping", "/owner/nrms/calendar", "/owner/nrms/finance"].includes(href);
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
  const { loading, error, entitled, restriction, properties, selectedPropertyId, selectedProperty, usagePolicy, setSelectedPropertyId, refresh } = useNrms();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentsHome = pathname === "/owner/nrms/payments" && !searchParams.has("property");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [travelAgentsOpen, setTravelAgentsOpen] = useState(() => pathname.startsWith("/owner/nrms/agents"));
  const [otaChannelsOpen, setOtaChannelsOpen] = useState(() => pathname.startsWith("/owner/nrms/channels"));
  const [hotelControlsOpen, setHotelControlsOpen] = useState(() => pathname.startsWith("/owner/nrms/controls"));
  const [financeOpen, setFinanceOpen] = useState(() => pathname.startsWith("/owner/nrms/finance"));
  const [outletsOpen, setOutletsOpen] = useState(() => pathname.startsWith("/owner/nrms/outlets"));
  const [ordersOpen, setOrdersOpen] = useState(() => pathname.startsWith("/owner/nrms/orders"));
  const [stockOpen, setStockOpen] = useState(() => pathname.startsWith("/owner/nrms/stock"));
  const [pendingWorkspaceChange, setPendingWorkspaceChange] = useState<{ kind: "PROPERTY"; propertyId: number; propertyTitle: string } | { kind: "EXIT" } | null>(null);
  const [sidebarOutlets, setSidebarOutlets] = useState<Array<{ id: number; name: string; type: string }>>([]);
  const [booting, setBooting] = useState(true);
  const [globalFreeze, setGlobalFreeze] = useState<{ referenceCode?: string | null; reason?: string | null } | null>(null);
  const [attention, setAttention] = useState<NrmsAttentionSnapshot | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const prevAttentionTotalRef = useRef<number | null>(null);
  const { socket: attentionSocket } = useSocket(undefined, { enabled: Boolean(selectedPropertyId), joinDriverRoom: false });
  const daysLeft = propertyTrialDaysLeft(selectedProperty);
  const realAccessRole = selectedProperty?.nrmsAccessRole ?? "OWNER";

  /**
   * Development-only sidebar preview: /owner/nrms?previewRole=SALES_EXECUTIVE
   *
   * Seeing a staff workspace otherwise means holding a real membership, because
   * nrmsAccessRole is resolved server side from NrmsStaffMembership. That is the
   * right default, but it makes checking a role's navigation slow.
   *
   * This changes NOTHING but which links this sidebar draws. Every page still
   * calls the API as the signed-in account, and the API still resolves the real
   * role, so a preview cannot reach data the account is not entitled to. It is
   * compiled out of a production build, and the banner below makes sure nobody
   * mistakes it for a real permission check.
   */
  // Two locks, not one. NODE_ENV alone would arm this in any non-production
  // build, including a staging deploy; the explicit opt-in means it exists only
  // where someone has written it into their own .env.local:
  //
  //   NEXT_PUBLIC_NRMS_ROLE_PREVIEW=true
  //
  // NEXT_PUBLIC_ values are inlined at build time, so a build made without it
  // has no branch to reach.
  const rolePreviewEnabled =
    process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_NRMS_ROLE_PREVIEW === "true";
  const previewRole = rolePreviewEnabled
    ? searchParams?.get("previewRole")?.toUpperCase() ?? null
    : null;
  const accessRole = previewRole ?? realAccessRole;
  const showPropertySelector = !paymentsHome && accessRole === "OWNER" && properties.length > 1;
  // Capabilities stay the real account's: faking them would make the sidebar
  // claim an authority the server would refuse, which is the opposite of useful.
  const accessCapabilities = previewRole ? undefined : selectedProperty?.effectiveAccess?.capabilities;
  const exitHref = accessRole === "OWNER" ? "/owner" : "/account";
  // Published to the pages below so a screen that is composed differently per
  // role (the NRMS home, which is a front desk for one role and a pipeline for
  // another) reads the same answer this sidebar drew itself from.
  const accessRoleValue = useMemo(
    () => ({ accessRole, realAccessRole, previewRole }),
    [accessRole, realAccessRole, previewRole],
  );

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
    if (pathname.startsWith("/owner/nrms/stock")) setStockOpen(true);
  }, [pathname]);

  useEffect(() => {
    const canSeeOutletNavigation = roleCanSee("/owner/nrms/orders", accessRole, accessCapabilities) || roleCanSee("/owner/nrms/outlets", accessRole, accessCapabilities);
    if (!selectedPropertyId || !canSeeOutletNavigation) { setSidebarOutlets([]); return; }
    let active = true;
    void apiClient.get<any>(`/api/nrms/operations/property/${selectedPropertyId}/outlets`)
      .then((response) => {
        if (!active) return;
        setSidebarOutlets((response.data?.outlets ?? []).map((outlet: any) => ({ id: Number(outlet.id), name: String(outlet.name), type: String(outlet.type) })));
      })
      .catch(() => { if (active) setSidebarOutlets([]); });
    return () => { active = false; };
  }, [accessCapabilities, accessRole, selectedPropertyId]);

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

  // One request carries every active queue the caller is allowed to see. Page
  // mutations and live inquiry events refresh it immediately; one visible-tab
  // request per minute is the fallback for work arriving through other systems.
  useEffect(() => {
    if (!selectedPropertyId) {
      setAttention(null);
      prevAttentionTotalRef.current = null;
      return;
    }
    let active = true;
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const fetchAttention = async (fresh = false) => {
      if (document.visibilityState === "hidden" && !fresh) return;
      try {
        const response = await apiClient.get<NrmsAttentionSnapshot>(`/api/nrms/operations/property/${selectedPropertyId}/attention`, {
          params: fresh ? { fresh: 1 } : undefined,
        });
        if (!active) return;
        const next = response.data;
        setAttention(next);
        const activeTotal = next.frontDesk.total + next.inquiries.total + next.groups.total + next.housekeeping.total
          + next.orders.placedRoom + next.orders.openTable + next.stock.total + next.agents.total
          + next.rateProposals.total + next.channels.total + next.finance.total + next.payments.total;
        if (prevAttentionTotalRef.current !== null && activeTotal > prevAttentionTotalRef.current) chime();
        prevAttentionTotalRef.current = activeTotal;
      } catch { /* transient; keep the last known snapshot */ }
    };
    const queueFreshFetch = () => {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => void fetchAttention(true), 350);
    };
    const handleVisibility = () => { if (document.visibilityState === "visible") void fetchAttention(); };
    const handleInboxUpdate = (payload?: { propertyId?: number }) => {
      if (!payload?.propertyId || Number(payload.propertyId) === selectedPropertyId) queueFreshFetch();
    };

    void fetchAttention();
    const intervalId = setInterval(() => void fetchAttention(), 60_000);
    window.addEventListener("nrms-attention-refresh", queueFreshFetch);
    document.addEventListener("visibilitychange", handleVisibility);
    attentionSocket?.on("nrms:inbox:update", handleInboxUpdate);
    return () => {
      active = false;
      clearInterval(intervalId);
      if (debounceId) clearTimeout(debounceId);
      window.removeEventListener("nrms-attention-refresh", queueFreshFetch);
      document.removeEventListener("visibilitychange", handleVisibility);
      attentionSocket?.off("nrms:inbox:update", handleInboxUpdate);
    };
  }, [attentionSocket, selectedPropertyId, accessRole, chime]);

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

  const propertyNeedsActivation = Boolean(accessRole === "OWNER" && selectedProperty && !selectedProperty.nrmsActivatedAt && !pathname.startsWith("/owner/nrms/rooms") && !pathname.startsWith("/owner/nrms/help") && !pathname.startsWith("/owner/nrms/policy") && !pathname.startsWith("/owner/nrms/payments"));

  // The workspace introduces itself by what the person does, not by the product.
  const roleSubtitle = accessRole === "BAR" ? "Bar service"
    : accessRole === "RESTAURANT" ? "Restaurant service"
    : accessRole === "SALES_EXECUTIVE" ? "Sales workspace"
    : accessRole === "FRONT_DESK" ? "Front desk"
    : accessRole === "OUTLET_SUPERVISOR" ? "Outlet operations"
    : accessRole === "STOREKEEPER" ? "Store and stock"
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
            .map((section) => ({ ...section, items: section.items.filter((item) => roleCanSee(item.href, accessRole, accessCapabilities)) }))
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
                const override = item.href === "/owner/nrms/orders" ? ordersNavPresentation(accessRole)
                  : item.href === "/owner/nrms" ? homeNavPresentation(accessRole)
                  : null;
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
                const nestedOpen = item.href === "/owner/nrms/orders" ? ordersOpen : item.href === "/owner/nrms/agents" ? travelAgentsOpen : item.href === "/owner/nrms/channels" ? otaChannelsOpen : item.href === "/owner/nrms/controls" ? hotelControlsOpen : item.href === "/owner/nrms/finance" ? financeOpen : item.href === "/owner/nrms/outlets" ? outletsOpen : item.href === "/owner/nrms/stock" ? stockOpen : false;
                const toggleNested = item.href === "/owner/nrms/orders" ? setOrdersOpen : item.href === "/owner/nrms/agents" ? setTravelAgentsOpen : item.href === "/owner/nrms/channels" ? setOtaChannelsOpen : item.href === "/owner/nrms/controls" ? setHotelControlsOpen : item.href === "/owner/nrms/finance" ? setFinanceOpen : item.href === "/owner/nrms/stock" ? setStockOpen : setOutletsOpen;
                const nestedId = item.href === "/owner/nrms/orders" ? "nrms-orders-navigation" : item.href === "/owner/nrms/agents" ? "nrms-travel-agent-navigation" : item.href === "/owner/nrms/channels" ? "nrms-ota-navigation" : item.href === "/owner/nrms/controls" ? "nrms-hotel-controls-navigation" : item.href === "/owner/nrms/finance" ? "nrms-finance-navigation" : item.href === "/owner/nrms/stock" ? "nrms-stock-navigation" : "nrms-outlet-navigation";
                // Tables & tabs is an operational workload count, not only an
                // unread notification: keep it visible while the page is open
                // until every table/walk-in order has been completed.
                const badge = item.href === "/owner/nrms"
                  ? (attention?.frontDesk.total ? attention.frontDesk.total : null)
                  : item.href === "/owner/nrms/tables"
                  ? (attention?.orders.openTable ? attention.orders.openTable : null)
                  : item.href === "/owner/nrms/inquiries"
                  ? (attention?.inquiries.total ? attention.inquiries.total : null)
                  : item.href === "/owner/nrms/groups"
                  ? (attention?.groups.total ? attention.groups.total : null)
                  : item.href === "/owner/nrms/housekeeping"
                  ? (attention?.housekeeping.total ? attention.housekeeping.total : null)
                  : item.href === "/owner/nrms/orders"
                  ? (attention?.orders.placedRoom ? attention.orders.placedRoom : null)
                  : item.href === "/owner/nrms/stock"
                  ? (attention?.stock.total ? attention.stock.total : null)
                  : item.href === "/owner/nrms/agents"
                  ? (attention?.agents.total ? attention.agents.total : null)
                  : item.href === "/owner/nrms/sales-rates"
                  ? (attention?.rateProposals.pending ? attention.rateProposals.pending : null)
                  : item.href === "/owner/nrms/channels"
                  ? (attention?.channels.total ? attention.channels.total : null)
                  : item.href === "/owner/nrms/finance"
                  ? (attention?.finance.total ? attention.finance.total : null)
                  : item.href === "/owner/nrms/payments"
                  ? (attention?.payments.actionRequired ? attention.payments.actionRequired : null)
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
                        {badge != null && <span className={`shrink-0 min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[18px] ${badgeClass(item.href, active)}`} aria-label={badgeLabel(item.href, badge)}>{badge > 99 ? "99+" : badge}</span>}
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${nestedOpen ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                      {nestedOpen && (
                        <div id={nestedId} className="relative ml-5 mt-1 space-y-0.5 border-0 border-l border-solid border-white/10 pl-2">
                          {nestedChildren.filter((child) => !child.roles || child.roles.includes(accessRole)).map((child) => {
                            const ChildIcon = child.icon;
                            const financeTargetDate = attention?.finance.targetBusinessDate;
                            const cashierTargetDate = attention?.finance.unreconciledBusinessDate;
                            const childHref = child.href === "/owner/nrms/finance?view=audit" && financeTargetDate
                              ? `${child.href}&businessDate=${encodeURIComponent(financeTargetDate)}`
                              : child.href === "/owner/nrms/finance?view=cashiers" && cashierTargetDate
                              ? `${child.href}&businessDate=${encodeURIComponent(cashierTargetDate)}`
                              : child.href === "/owner/nrms/stock?view=menu" && attention?.stock.total
                              ? `${child.href}&attention=1`
                              : child.href;
                            const childActive = isNestedActive(pathname, searchParams, child);
                            const childOutletId = child.href.startsWith("/owner/nrms/orders?outlet=") ? Number(child.href.split("outlet=")[1]) : null;
                            const childProvider = child.href.startsWith("/owner/nrms/channels?provider=") ? child.href.split("provider=")[1]?.toUpperCase() : null;
                            const childBadge = childOutletId
                              ? (attention?.orders.byOutlet?.find((row) => row.outletId === childOutletId)?.placedRoom || null)
                              : child.href === "/owner/nrms/orders"
                              ? (attention?.orders.placedRoom ? attention.orders.placedRoom : null)
                              : child.href === "/owner/nrms/agents"
                              ? (attention?.agents.acceptedInvites ? attention.agents.acceptedInvites : null)
                              : child.href === "/owner/nrms/agents/partnerships"
                              ? (attention?.agents.partnershipRequests ? attention.agents.partnershipRequests : null)
                              : child.href === "/owner/nrms/agents/requests"
                              ? ((attention?.agents.bookingRequests || attention?.agents.guestManifests) ? ((attention?.agents.bookingRequests ?? 0) + (attention?.agents.guestManifests ?? 0)) : null)
                              : childProvider
                              ? (attention?.channels.byProvider?.find((row) => row.provider === childProvider)?.total || null)
                              : child.href === "/owner/nrms/finance?view=audit"
                              ? ((attention?.finance.unclassifiedTenders || attention?.finance.overdueBusinessDays) ? ((attention?.finance.unclassifiedTenders ?? 0) + (attention?.finance.overdueBusinessDays ?? 0)) : null)
                              : child.href === "/owner/nrms/finance?view=cashiers"
                              ? (attention?.finance.unreconciledShifts ? attention.finance.unreconciledShifts : null)
                              : child.href === "/owner/nrms/stock?view=menu"
                              ? (attention?.stock.total ? attention.stock.total : null)
                              : null;
                            return (
                              <Link key={child.href} href={childHref} aria-current={childActive ? "page" : undefined} className={`group flex min-h-8 items-center gap-2 rounded-lg border px-2 text-[12px] font-medium no-underline transition hover:no-underline ${childActive ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100" : "border-transparent text-emerald-50/50 hover:bg-white/[0.06] hover:text-white"}`}>
                                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{child.label}</span>
                                {childBadge != null && <span className={`min-w-[16px] shrink-0 rounded-full px-1 text-center text-[9px] font-bold leading-4 ${child.href === "/owner/nrms/stock?view=menu" ? "bg-amber-400 text-amber-950" : (childProvider || child.href.startsWith("/owner/nrms/finance?view=")) ? "bg-rose-500 text-white" : "bg-violet-500 text-white"}`} aria-label={childOutletId ? `${childBadge} new orders for ${child.label}` : `${childBadge} items need attention in ${child.label}`}>{childBadge > 99 ? "99+" : childBadge}</span>}
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
                    {!collapsed && badge != null && <span className={`shrink-0 min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[18px] ${badgeClass(item.href, active)}`} aria-label={badgeLabel(item.href, badge)}>{item.href === "/owner/nrms/payments" ? "!" : badge > 99 ? "99+" : badge}</span>}
                    {collapsed && badge != null && <span className={`absolute right-0.5 top-0.5 min-w-[16px] rounded-full px-1 text-center text-[8px] font-bold leading-4 ${badgeClass(item.href, active)}`} aria-label={badgeLabel(item.href, badge)}>{item.href === "/owner/nrms/payments" ? "!" : badge > 9 ? "9+" : badge}</span>}
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
        <button type="button" onClick={() => setPendingWorkspaceChange({ kind: "EXIT" })} title={collapsed ? "Exit NRMS" : undefined} className={`flex min-h-9 w-full items-center rounded-lg border border-amber-200/10 bg-amber-100/[0.04] text-[12px] font-semibold text-amber-100 transition hover:border-amber-200/20 hover:bg-amber-300/10 hover:text-amber-50 ${collapsed ? "justify-center" : "gap-2.5 px-2.5"}`}>
          <LogOut className="h-3.5 w-3.5 shrink-0" />{!collapsed && (accessRole === "OWNER" ? "Exit to marketplace" : "Exit NRMS")}
        </button>
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
              <div className="flex items-center gap-2"><p className="m-0 truncate text-sm font-bold text-neutral-950">{paymentsHome ? "NoLSAF Payments" : selectedProperty?.title ?? "NRMS property"}</p>{!paymentsHome && daysLeft != null && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700">{daysLeft} days trial</span>}</div>
              {/* The subtitle names the workspace the reader is actually in.
                  "Live property operations" was written for the owner and read
                  as boilerplate to everyone else, including a sales executive
                  who runs no operations at all. */}
              <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{paymentsHome ? "Payment onboarding across your properties" : accessRole === "OWNER" ? "Live property operations" : roleSubtitle}</p>
            </div>
            {/* Only an owner with more than one property may switch. Staff are
                scoped to the property behind their assignment and must never be
                offered a way to change or see another one, so they get a static
                label, not a select. The API enforces this too; this is the UI half. */}
            {showPropertySelector ? (
              <label className="group relative hidden h-10 min-w-0 items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-2.5 text-neutral-600 transition hover:border-neutral-300 hover:bg-white hover:text-neutral-900 sm:flex">
                <Building2 className="h-4 w-4 shrink-0 text-emerald-700" />
                  <select
                    value=""
                    onChange={(event) => {
                      const propertyId = Number(event.target.value);
                      const property = properties.find((candidate) => candidate.id === propertyId);
                      if (property && property.id !== selectedPropertyId) setPendingWorkspaceChange({ kind: "PROPERTY", propertyId: property.id, propertyTitle: property.title });
                    }}
                    className="block max-w-40 cursor-pointer border-0 bg-transparent p-0 text-xs font-medium text-current outline-none"
                    aria-label="Select NRMS property"
                  >
                    <option value="">Switch property</option>
                    {properties.filter((property) => property.id !== selectedPropertyId).map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}
                  </select>
              </label>
            ) : null}
            {!paymentsHome && accessRole === "OWNER" && <NrmsBillingAttention property={selectedProperty} policy={usagePolicy} variant="indicator" />}
            {/* Nothing stands here for a single property or for staff. The
                switcher above earns its space because it does something; a
                static chip would only print the property name a second time,
                a few centimetres from the heading that already carries it. */}
            {/* The role badge lived here while the subtitle was generic. Now
                that the subtitle names the workspace, a chip reading
                "SALES EXECUTIVE" beside "Sales workspace" says the same thing
                twice. The owner keeps no badge either: the sidebar's exit to
                the marketplace already tells them whose account this is. */}
            <button type="button" onClick={() => setPendingWorkspaceChange({ kind: "EXIT" })} title={accessRole === "OWNER" ? "Return to Marketplace" : "Exit NRMS"} aria-label={accessRole === "OWNER" ? "Return to Marketplace" : "Exit NRMS"} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900">
              <LogOut className="h-4 w-4" />
            </button>
          </div>

          <nav className="overflow-x-auto border-t border-neutral-100 px-3 sm:px-5" aria-label="Primary NRMS operations">
            <div className="flex w-max min-w-full gap-1">
              {(accessRole === "SALES_EXECUTIVE" ? SALES_TABS : PRIMARY_TABS).filter((tab) => roleCanSee(tab.href, accessRole, accessCapabilities)).map((tab) => {
                const override = tab.href === "/owner/nrms/orders" ? ordersNavPresentation(accessRole)
                  : tab.href === "/owner/nrms" ? homeNavPresentation(accessRole)
                  : null;
                const Icon = override?.icon ?? tab.icon;
                const active = isActive(pathname, tab);
                return <Link key={tab.href} href={tab.href} className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-xs font-bold no-underline transition hover:no-underline ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-400 hover:text-neutral-700"}`}><Icon className="h-4 w-4" />{override?.label ?? tab.label}</Link>;
              })}
            </div>
          </nav>
        </header>

        <FiscalAlertBanner />

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-5">
          {/* Impossible to miss on purpose: the workspace is drawn for another
              role, but every request below is still made as the signed-in
              account, so this proves layout only, never permissions. */}
          {previewRole ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 ring-1 ring-amber-300">
              <span className="font-bold">Previewing the {roleSubtitle}</span>
              <span className="text-amber-800">
                Layout only: which links the sidebar draws and how a role aware page arranges itself. Every request is still
                made as {realAccessRole.replace(/_/g, " ").toLowerCase()}, so the data shown and the actions allowed are
                unchanged. Development builds only.
              </span>
              <a href={pathname} className="ml-auto font-bold text-amber-900 underline">Exit preview</a>
            </div>
          ) : null}
          <NrmsAccessRoleProvider value={accessRoleValue}>
            {showPropertyGate ? null : propertyNeedsActivation ? <PropertyActivationGate /> : <>{accessRole === "OWNER" && pathname === "/owner/nrms" && <NrmsBillingAttention property={selectedProperty} policy={usagePolicy} variant="dashboard" />}{children}</>}
          </NrmsAccessRoleProvider>
        </main>
        <NrmsOperationalFooter />
      </div>

      {showPropertyGate && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-neutral-950/45 p-4 backdrop-blur-sm">
          <NrmsPropertyGate loading={loading} onRefresh={() => void refresh()} />
        </div>
      )}

      {pendingWorkspaceChange && (
        <ModalFrame
          title={pendingWorkspaceChange.kind === "PROPERTY" ? "Switch property" : accessRole === "OWNER" ? "Leave NRMS" : "Exit NRMS"}
          elevated
          compact
          compactFooter
          small
          onClose={() => setPendingWorkspaceChange(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setPendingWorkspaceChange(null)} className="inline-flex h-8 items-center justify-center rounded-lg border border-neutral-200 bg-white px-3 text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  if (pendingWorkspaceChange.kind === "PROPERTY") {
                    setSelectedPropertyId(pendingWorkspaceChange.propertyId);
                    if (pathname === "/owner/nrms/payments" && searchParams.has("property")) router.replace(`/owner/nrms/payments?property=${pendingWorkspaceChange.propertyId}`);
                    setPendingWorkspaceChange(null);
                    return;
                  }
                  router.push(exitHref);
                }}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-800"
              >
                {pendingWorkspaceChange.kind === "PROPERTY" ? "Switch" : accessRole === "OWNER" ? "Marketplace" : "Exit"}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          }
        >
          <p className="m-0 px-1 text-xs leading-5 text-neutral-600">
            {pendingWorkspaceChange.kind === "PROPERTY"
              ? <>Open <span className="font-medium text-neutral-900">{pendingWorkspaceChange.propertyTitle}</span>? Unsaved work in {selectedProperty?.title ?? "this property"} will be lost.</>
              : accessRole === "OWNER"
                ? <>Return to Marketplace? Unsaved work in {selectedProperty?.title ?? "this property"} will be lost.</>
                : <>Exit NRMS? Any unsaved work will be lost.</>}
          </p>
        </ModalFrame>
      )}
    </div>
  );
}

export default function NrmsLayout({ children }: { children: ReactNode }) {
  return <NrmsProvider><NrmsShell>{children}</NrmsShell></NrmsProvider>;
}

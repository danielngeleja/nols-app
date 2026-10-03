"use client";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Users, Search, X, Mail, Phone, Lock, Eye, MoreVertical, XCircle, Loader2, Filter, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, RefreshCw, UserCheck, BadgeCheck, CalendarCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import TablePagination from "@/components/TablePagination";
import { adminPath, adminRecordRef, useAdminHref } from "@/lib/adminRecordRefs";

const api = apiClient;

type CustomerRow = {
  id: number;
  name: string | null;
  displayName?: string;
  bookingGuestName?: string | null;
  identityNameSource?: "ACCOUNT" | "BOOKING" | "MISSING";
  email: string | null;
  phone: string | null;
  registrationStatus?: "COMPLETE" | "INCOMPLETE";
  registrationSource?: "WEB" | "TRAVELLER_APP" | "DRIVER_APP" | "PARTNERS_APP" | "LEGACY" | "UNKNOWN";
  profileCompletedAt?: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  suspendedAt?: string | null;
  isDisabled?: boolean | null;
  bookingCount?: number;
  totalSpent?: number;
  lastBookingDate?: string | null;
  /** Roles beyond the account role: bar attendant, front desk, sales partner
   *  and so on. Active roles are listed first. */
  extraRoles?: { label: string; active: boolean }[];
};

type CustomersSummary = {
  totalCustomers: number;
  activeCustomers: number;
  totalBookings: number;
  totalRevenue: number;
  verifiedEmailCount?: number;
  verifiedPhoneCount?: number;
  verifiedCustomerCount?: number;
  incompleteRegistrationCount?: number;
  /** Already returned by /admin/users/summary; declared here so the funnel can
   *  use whole-population figures instead of the loaded page. */
  customersWithBookings?: number;
  totalAccommodationBookings?: number;
  totalTourBookings?: number;
  totalTransportBookings?: number;
  totalGroupBookings?: number;
};

type CustomerSortKey = "customer" | "profile" | "accountId" | "contact" | "verification" | "status" | "bookings" | "totalSpent" | "lastBooking" | "joined";

/** Filter chip offered by the API. The vocabulary lives server side in
 *  nrmsStaffRoles.ts, so adding an NRMS sub-role adds its chip here with no
 *  change to this file. `count` is -1 when the server could not count. */
type HoldsRoleFilter = {
  value: string; label: string; hint: string;
  /** Grouping is decided server side too, so this file stays free of role
   *  vocabulary and a new group needs no change here. */
  group: string; groupLabel: string;
  count: number;
};

export default function AdminUsersListPage(){
  const recordHref = useAdminHref();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [registrationStatus, setRegistrationStatus] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<CustomerSortKey>("joined");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState({
    totalCustomers: 0,
    activeCustomers: 0,
    totalBookings: 0,
    totalRevenue: 0,
    verifiedCustomers: 0,
    incompleteRegistrations: 0,
    customersWithBookings: 0,
    bookingsByService: { stays: 0, tours: 0, transport: 0, groups: 0 },
  });
  const pageSize = 30;
  const role = "CUSTOMER";
  // Which additional role to narrow to. "" means no filter.
  const [holdsRole, setHoldsRole] = useState<string>("");
  const [holdsRoleFilters, setHoldsRoleFilters] = useState<HoldsRoleFilter[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const router = useRouter();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [suggestions, setSuggestions] = useState<CustomerRow[]>([]);
  const [showActionsMenu, setShowActionsMenu] = useState<number | null>(null);
  const [actionsMenuPos, setActionsMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  /**
   * The row actions menu is rendered into a portal on document.body, not inside
   * the table cell. The table lives in `overflow-x-auto` inside a card with
   * `overflow-hidden`, and an absolutely positioned menu is clipped by both
   * (overflow-x: auto also forces overflow-y to compute as auto), so the last
   * rows and the right edge of the menu were being cut off.
   */
  const ACTIONS_MENU_WIDTH = 208; // matches w-52
  const ACTIONS_MENU_HEIGHT = 150; // three rows, used only to decide whether to flip upward

  const closeActionsMenu = useCallback(() => {
    setShowActionsMenu(null);
    setActionsMenuPos(null);
  }, []);

  const openActionsMenu = useCallback((customerId: number, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const flipUp = rect.bottom + ACTIONS_MENU_HEIGHT + 16 > window.innerHeight;
    setActionsMenuPos({
      top: flipUp ? Math.max(8, rect.top - ACTIONS_MENU_HEIGHT - 8) : rect.bottom + 8,
      left: Math.max(
        8,
        Math.min(rect.right - ACTIONS_MENU_WIDTH, window.innerWidth - ACTIONS_MENU_WIDTH - 8),
      ),
    });
    setShowActionsMenu(customerId);
  }, []);

  // A fixed menu cannot follow its trigger, so close it whenever the page or
  // the table's own scroll container moves under it.
  useEffect(() => {
    if (showActionsMenu === null) return;
    const onScrollOrResize = () => closeActionsMenu();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeActionsMenu();
    };
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showActionsMenu, closeActionsMenu]);

  const isCustomerSuspended = useCallback((c: CustomerRow) => {
    const disabled = (c.isDisabled as any) === true || (c.isDisabled as any) === 1;
    return Boolean(c.suspendedAt) || disabled;
  }, []);

  /** The chip currently applied, so the closed panel can name it. */
  const activeHoldsRole = useMemo(
    () => holdsRoleFilters.find((f) => f.value === holdsRole) ?? null,
    [holdsRoleFilters, holdsRole],
  );

  /** Groups in the order the server sent them. A chip that matches nothing is
   *  dropped as noise, but one whose count failed (-1) is kept: "we could not
   *  count" is not the same as "nobody holds this". */
  const holdsRoleGroups = useMemo(() => {
    const groups: { key: string; label: string; options: HoldsRoleFilter[] }[] = [];
    for (const option of holdsRoleFilters) {
      if (option.count === 0 && option.value !== holdsRole) continue;
      const existing = groups.find((g) => g.key === option.group);
      if (existing) existing.options.push(option);
      else groups.push({ key: option.group, label: option.groupLabel, options: [option] });
    }
    return groups;
  }, [holdsRoleFilters, holdsRole]);

  const load = useCallback(async ()=>{
    setLoading(true);
    try {
      // IMPORTANT: Use /api/* to avoid colliding with Next pages under /admin/users/*
      // (e.g. /admin/users is a page route, not an API route).
      const [listRes, summaryRes] = await Promise.all([
        api.get<{ data: CustomerRow[]; meta: { total: number; holdsRoleFilters?: HoldsRoleFilter[] } }>("/api/admin/users", {
          params: { q, status, registrationStatus, page, perPage: pageSize, role, ...(holdsRole ? { holdsRole } : {}) },
        }),
        api.get<CustomersSummary>("/api/admin/users/summary"),
      ]);

      setItems(listRes.data.data || []);
      setTotal(listRes.data.meta?.total || 0);
      setHoldsRoleFilters(listRes.data.meta?.holdsRoleFilters || []);

      const summary = summaryRes.data;
      const verified = Number(summary.verifiedCustomerCount || 0);
      setStats({
        totalCustomers: Number(summary.totalCustomers || 0),
        activeCustomers: Number(summary.activeCustomers || 0),
        totalBookings: Number(summary.totalBookings || 0),
        totalRevenue: Number(summary.totalRevenue || 0),
        verifiedCustomers: verified,
        incompleteRegistrations: Number(summary.incompleteRegistrationCount || 0),
        customersWithBookings: Number(summary.customersWithBookings || 0),
        bookingsByService: {
          stays: Number(summary.totalAccommodationBookings || 0),
          tours: Number(summary.totalTourBookings || 0),
          transport: Number(summary.totalTransportBookings || 0),
          groups: Number(summary.totalGroupBookings || 0),
        },
      });
    } catch (err) {
      console.error("Failed to load customers", err);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, status, registrationStatus, page, role, holdsRole]);

  useEffect(()=>{ load(); }, [load]);

  // Ask for every visible row's us_ reference as soon as the rows land, so a
  // click is never left with only the numeric fallback.
  useEffect(() => {
    items.forEach((customer) => adminRecordRef("user", customer.id));
  }, [items]);

  /**
   * Opens a customer at its opaque reference. Waiting for the reference keeps
   * the row id out of the address bar; navigating to the numeric fallback made
   * the profile load, then reload when the gate swapped in the reference.
   */
  const openCustomer = useCallback(async (customerId: number) => {
    closeActionsMenu();
    router.push(await adminPath("user", customerId));
  }, [closeActionsMenu, router]);

  useEffect(()=>{
    const term = q; 
    if(!term || term.trim()===""){ 
      setSuggestions([]); 
      return; 
    }
    const t = setTimeout(()=>{ 
      (async ()=>{
        try{ 
          const r = await api.get<{ data: CustomerRow[] }>("/api/admin/users", { params: { status, registrationStatus, q: term, page:1, perPage:5, role } });
          setSuggestions(r.data.data ?? []); 
        } catch(e){ 
          setSuggestions([]); 
        }
      })(); 
    }, 400);
    return ()=> clearTimeout(t);
  }, [q, status, registrationStatus, role]);

  useEffect(()=>{ 
    const url = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
      : (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "");
    const s: Socket = io(url, { transports:['websocket'] }); 
    s.on("admin:user:updated", load); 
    return ()=>{ s.off("admin:user:updated", load); s.disconnect(); }; 
  }, [load]);

  const sortedItems = useMemo(() => {
    const next = [...items];
    const verificationScore = (c: CustomerRow) =>
      (c.emailVerifiedAt ? 1 : 0) + (c.phoneVerifiedAt ? 1 : 0) + (c.twoFactorEnabled ? 1 : 0);

    const readValue = (c: CustomerRow): string | number => {
      switch (sortBy) {
        case "customer":
          return `${c.displayName || c.name || ""} ${c.email || ""}`.toLowerCase();
        case "accountId":
          return c.id;
        case "profile":
          return `${c.registrationStatus || "INCOMPLETE"} ${c.registrationSource || "UNKNOWN"}`.toLowerCase();
        case "contact":
          return `${c.phone || ""}`.toLowerCase();
        case "verification":
          return verificationScore(c);
        case "status":
          return isCustomerSuspended(c) ? "suspended" : "active";
        case "bookings":
          return Number(c.bookingCount || 0);
        case "totalSpent":
          return Number(c.totalSpent || 0);
        case "lastBooking":
          return c.lastBookingDate ? new Date(c.lastBookingDate).getTime() : 0;
        case "joined":
          return c.createdAt ? new Date(c.createdAt).getTime() : 0;
        default:
          return "";
      }
    };

    next.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return next;
  }, [items, sortBy, sortDir, isCustomerSuspended]);

  function handleSort(field: CustomerSortKey) {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "accountId" || field === "bookings" || field === "totalSpent" || field === "lastBooking" || field === "joined" || field === "verification" ? "desc" : "asc");
  }

  function renderSortIcon(field: CustomerSortKey) {
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-emerald-600" />
      : <ChevronDown className="h-3.5 w-3.5 text-emerald-600" />;
  }


  // Customer lifecycle, from whole-population figures (the summary endpoint),
  // not the loaded page. Each step is a subset of the one above it, so the drop
  // between steps is the thing worth looking at.
  const lifecycle = useMemo(() => {
    const registered = stats.totalCustomers;
    const share = (n: number) => (registered > 0 ? Math.round((n / registered) * 100) : 0);
    const complete = Math.max(0, registered - stats.incompleteRegistrations);
    return [
      { key: "registered", label: "Registered", icon: Users, value: registered, share: 100, hint: "Every traveller account", dot: "bg-neutral-400", bar: "bg-neutral-400", text: "text-neutral-600", soft: "bg-neutral-50", filter: "" },
      { key: "complete", label: "Profile complete", icon: UserCheck, value: complete, share: share(complete), hint: `${stats.incompleteRegistrations.toLocaleString()} still incomplete`, dot: "bg-emerald-400", bar: "bg-emerald-400", text: "text-emerald-700", soft: "bg-emerald-50/70", filter: "COMPLETE" },
      { key: "verified", label: "Verified", icon: BadgeCheck, value: stats.verifiedCustomers, share: share(stats.verifiedCustomers), hint: "Email or phone confirmed", dot: "bg-sky-500", bar: "bg-sky-500", text: "text-sky-700", soft: "bg-sky-50/70", filter: null },
      { key: "booked", label: "Booked at least once", icon: CalendarCheck, value: stats.customersWithBookings, share: share(stats.customersWithBookings), hint: "Turned into a paying traveller", dot: "bg-[#02665e]", bar: "bg-[#02665e]", text: "text-[#02665e]", soft: "bg-emerald-50/70", filter: null },
    ];
  }, [stats]);

  const handleReset2FA = async (customerId: number) => {
    if (!confirm("Are you sure you want to reset 2FA for this customer?")) return;
    setActionLoading(customerId);
    try {
      await api.patch(`/api/admin/users/${customerId}`, { reset2FA: true });
      await load();
      setShowActionsMenu(null);
    } catch (err) {
      console.error("Failed to reset 2FA", err);
      alert("Failed to reset 2FA");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSuspend = async (customerId: number) => {
    if (!confirm("Are you sure you want to suspend this customer?")) return;
    setActionLoading(customerId);
    try {
      // Using disable endpoint if suspend endpoint doesn't exist
      await api.patch(`/api/admin/users/${customerId}`, { disable: true });
      await load();
      setShowActionsMenu(null);
    } catch (err: any) {
      console.error("Failed to suspend customer", err);
      alert(err.response?.data?.error || "Failed to suspend customer. Note: This feature may require database migration.");
    } finally {
      setActionLoading(null);
    }
  };

  const filtersOn = Boolean(status || registrationStatus || activeHoldsRole || q.trim());
  const directoryTitle = registrationStatus === "COMPLETE"
    ? "Complete profiles"
    : registrationStatus === "INCOMPLETE"
      ? "Incomplete profiles"
      : status === "SUSPENDED"
        ? "Suspended customers"
        : "All customers";

  const verificationBadges = (customer: CustomerRow) => (
    <span className="inline-flex items-center gap-1">
      {[
        { on: Boolean(customer.emailVerifiedAt), Icon: Mail, label: "Email verified", tone: "bg-violet-50 text-violet-700 ring-violet-200" },
        { on: Boolean(customer.phoneVerifiedAt), Icon: Phone, label: "Phone verified", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
        { on: customer.twoFactorEnabled, Icon: Lock, label: "2FA on", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
      ].map(({ on, Icon, label, tone }) => (
        <span
          key={label}
          title={on ? label : `${label.replace(/ (verified|on)$/, "")} not confirmed`}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md ring-1 ${on ? tone : "bg-white text-neutral-300 ring-neutral-200"}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      ))}
    </span>
  );

  const statusPill = (customer: CustomerRow) =>
    isCustomerSuspended(customer) ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-rose-700">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Suspended
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
      </span>
    );

  const actionsMenu = (customer: CustomerRow) => (
    <>
      <button
        type="button"
        aria-label="Customer actions"
        aria-expanded={showActionsMenu === customer.id}
        onClick={(event) => {
          event.stopPropagation();
          if (showActionsMenu === customer.id) {
            closeActionsMenu();
            return;
          }
          openActionsMenu(customer.id, event.currentTarget);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
      >
        {actionLoading === customer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>
      {showActionsMenu === customer.id && actionsMenuPos && typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={closeActionsMenu} />
            {/* ring-1 instead of `border`, and gap-px over a tinted background
                instead of `border-b`: Tailwind preflight is disabled in this
                app, so bare border utilities set no border-style. */}
            <div
              className="fixed z-[80] w-52 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-neutral-200"
              style={{ top: actionsMenuPos.top, left: actionsMenuPos.left }}
            >
              <div className="flex flex-col gap-px bg-neutral-100">
                <a
                  href={recordHref("user", customer.id)}
                  onClick={(event) => {
                    // Wait for the reference so the address bar never shows the row id.
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    void openCustomer(customer.id);
                  }}
                  className="flex w-full items-center gap-2 bg-white px-4 py-2.5 text-sm text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline"
                >
                  <Eye className="h-4 w-4 text-[#02665e]" />
                  Open customer
                </a>
                <button
                  type="button"
                  onClick={() => handleReset2FA(customer.id)}
                  className="flex w-full items-center gap-2 border-0 bg-white px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  <Lock className="h-4 w-4 text-amber-500" />
                  Reset 2FA
                </button>
                <button
                  type="button"
                  onClick={() => handleSuspend(customer.id)}
                  className="flex w-full items-center gap-2 border-0 bg-white px-4 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50"
                >
                  <XCircle className="h-4 w-4 text-rose-500" />
                  Suspend
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );

  const sortHeader = (field: CustomerSortKey, label: string, align: "left" | "right" = "left") => (
    <th className={`whitespace-nowrap px-4 py-2.5 font-semibold ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => handleSort(field)}
        className={`m-0 inline-flex appearance-none items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-semibold transition-colors hover:text-neutral-700 ${sortBy === field ? "text-neutral-800" : "text-neutral-400"}`}
      >
        {label} {renderSortIcon(field)}
      </button>
    </th>
  );

  return (
    // The admin layout owns the gutter and the border-box rule, so the page adds neither.
    <div id="admin-customers-page" className="w-full min-w-0 space-y-5">
      {/* Header: dark brand band with the headline numbers */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Customers</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">All customers</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Travellers who book stays, tours, group stays and rides, and how far each has come.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh customers" title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{stats.totalCustomers.toLocaleString()}</p>
              <p className="m-0 mt-1 text-xs text-white/55">{stats.totalCustomers === 1 ? "Customer" : "Customers"} registered</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{stats.activeCustomers.toLocaleString()}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Active customers</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{stats.totalBookings.toLocaleString()}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Bookings across services</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">
                {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(stats.totalRevenue)}
                <span className="ml-1 text-sm font-semibold text-white/55">TZS</span>
              </p>
              <p className="m-0 mt-1 text-xs text-white/55">Money of record</p>
            </div>
          </div>
        </div>
      </section>

      {/* Lifecycle track: where every customer sits; the profile steps double as filters */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {lifecycle.map((stage, idx) => {
            const Icon = stage.icon;
            const selectable = stage.filter !== null;
            const selected = selectable && registrationStatus === stage.filter && (stage.filter !== "" || !filtersOn);
            const body = (
              <>
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}>
                    <Icon className="h-3.5 w-3.5" /> {stage.label}
                  </span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{idx === 0 ? "All" : `${stage.share}%`}</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{loading && !stats.totalCustomers ? "…" : stage.value.toLocaleString()}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{stage.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${stage.value > 0 ? Math.max(stage.share, 4) : 0}%` }} />
                </span>
              </>
            );
            const base = "relative min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all";
            return selectable ? (
              <button
                key={stage.key}
                type="button"
                aria-pressed={selected}
                onClick={() => { setRegistrationStatus(stage.filter as string); setPage(1); }}
                className={`${base} ${selected ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
              >
                {body}
              </button>
            ) : (
              <div key={stage.key} className={`${base} border-transparent bg-neutral-50/70`}>{body}</div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-2 pb-1 text-xs">
          <span className="text-[11px] font-semibold text-neutral-400">Bookings by service</span>
          {[
            { key: "stays", label: "Accommodation", value: stats.bookingsByService.stays, dot: "bg-blue-500" },
            { key: "tours", label: "Tours", value: stats.bookingsByService.tours, dot: "bg-violet-500" },
            { key: "transport", label: "Transport", value: stats.bookingsByService.transport, dot: "bg-orange-500" },
            { key: "groups", label: "Group stays", value: stats.bookingsByService.groups, dot: "bg-teal-500" },
          ].map((service) => (
            <span key={service.key} className="inline-flex items-center gap-1.5 font-medium text-neutral-600">
              <span className={`h-2 w-2 rounded-sm ${service.dot}`} aria-hidden />
              {service.label}
              <span className="font-bold tabular-nums text-neutral-900">{service.value.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Directory */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{directoryTitle}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "result" : "results"}`}</p>
          </div>
          {filtersOn && (
            <button
              type="button"
              onClick={() => { setQ(""); setStatus(""); setRegistrationStatus(""); setHoldsRole(""); setPage(1); }}
              className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200"
            >
              <X className="h-3 w-3" /> Show all
            </button>
          )}
          <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                ref={searchRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setSuggestions([]);
                    setPage(1);
                    load();
                  }
                }}
                className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                placeholder="Search name, email or phone"
                aria-label="Search customers"
              />
              {q && (
                <button type="button" onClick={() => { setQ(""); setPage(1); }} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {suggestions.length > 0 && (
                <div className="absolute left-0 right-0 z-20 mt-1.5 max-h-60 overflow-auto rounded-xl bg-white py-1 shadow-xl ring-1 ring-neutral-200">
                  {suggestions.map((s) => {
                    const name = s.displayName ?? s.name ?? s.email ?? "Customer";
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { setSuggestions([]); void openCustomer(s.id); }}
                        className="flex w-full items-center gap-3 border-0 bg-transparent px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white">{initials(name)}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-neutral-900">{name}</span>
                          <span className="block truncate text-xs text-neutral-400">{s.email || s.phone || "No contact details"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              aria-label="Account status"
              className="h-9 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            >
              <option value="">Any status</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
            <select
              value={registrationStatus}
              onChange={(e) => { setRegistrationStatus(e.target.value); setPage(1); }}
              aria-label="Profile"
              className="h-9 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            >
              <option value="">Any profile</option>
              <option value="COMPLETE">Complete profiles</option>
              <option value="INCOMPLETE">Incomplete profiles</option>
            </select>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid px-3 text-sm font-semibold transition-colors ${
                showAdvanced || activeHoldsRole ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              <Filter className="h-4 w-4" />
              Roles
              {activeHoldsRole ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">1</span> : null}
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Closed-state summary: what is applied, and one click to undo. */}
        {activeHoldsRole && !showAdvanced ? (
          <div className="px-4 pb-3 sm:px-5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              <span className="truncate">Also holds: {activeHoldsRole.label}</span>
              <button
                type="button"
                onClick={() => { setHoldsRole(""); setPage(1); }}
                aria-label="Clear the role filter"
                className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-0 bg-emerald-100 p-0 text-emerald-800 transition hover:bg-emerald-200"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          </div>
        ) : null}

        {showAdvanced ? (
          <div className="mx-4 mb-3 rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200 sm:mx-5 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="m-0 min-w-0 text-xs text-neutral-500">
                <span className="font-bold text-neutral-800">Also holds a role</span>
                <span className="mx-1.5 text-neutral-300">·</span>
                Travellers who also work on a property or sell for NoLSAF. Counts cover the whole table.
              </p>
              <button
                type="button"
                onClick={() => { setHoldsRole(""); setPage(1); }}
                disabled={!activeHoldsRole}
                className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-[11px] font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
            {holdsRoleFilters.length === 0 ? (
              <p className="m-0 text-xs text-neutral-500">No additional roles are recorded for these customers.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {holdsRoleGroups.map((group, groupIndex) => (
                  <div key={group.key} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                    {groupIndex > 0 ? <span className="mr-1 hidden h-5 w-px bg-neutral-300 sm:inline-block" aria-hidden /> : null}
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{group.label}</span>
                    {group.options.map((chip) => {
                      const active = holdsRole === chip.value;
                      return (
                        <button
                          key={chip.value}
                          type="button"
                          title={chip.hint}
                          aria-pressed={active}
                          onClick={() => { setHoldsRole(active ? "" : chip.value); setPage(1); }}
                          className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-xs font-medium transition-all ${
                            active ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                          }`}
                        >
                          {chip.label}
                          {chip.count >= 0 ? (
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-700"}`}>
                              {chip.count}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading customers
          </div>
        ) : items.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
              <Users className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No matching customers</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{filtersOn ? "Try another search or clear the filters." : "Travellers appear here as soon as they register."}</p>
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            <div className="hidden overflow-x-auto border-0 border-t border-solid border-neutral-100 md:block">
              <table className="table w-full min-w-[1040px] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold text-neutral-400">
                    <th className="w-12 px-4 py-2.5 font-semibold sm:pl-5">#</th>
                    {sortHeader("customer", "Customer")}
                    {sortHeader("profile", "Profile")}
                    {sortHeader("accountId", "Account")}
                    {sortHeader("contact", "Phone")}
                    {sortHeader("verification", "Verification")}
                    {sortHeader("status", "Status")}
                    {sortHeader("bookings", "Bookings", "right")}
                    {sortHeader("totalSpent", "Total spent", "right")}
                    {sortHeader("lastBooking", "Last booking")}
                    {sortHeader("joined", "Joined")}
                    <th className="px-4 py-2.5 sm:pr-5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((customer, index) => {
                    const name = customer.displayName || customer.name || "Incomplete profile";
                    return (
                      <tr
                        key={customer.id}
                        onClick={() => void openCustomer(customer.id)}
                        title="Open this customer"
                        className="cursor-pointer border-0 border-t border-solid border-neutral-100 align-middle transition-colors hover:bg-neutral-50/70"
                      >
                        <td className="px-4 py-3 text-xs tabular-nums text-neutral-400 sm:pl-5">{(page - 1) * pageSize + index + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-offset-2 ${isCustomerSuspended(customer) ? "bg-rose-700 ring-rose-200" : "bg-neutral-900 ring-emerald-200"}`}>{initials(name)}</span>
                            <div className="min-w-0">
                              <div className={`max-w-[15rem] truncate font-medium ${customer.displayName || customer.name ? "text-neutral-900" : "italic text-neutral-500"}`}>{name}</div>
                              <div className="max-w-[15rem] truncate text-xs text-neutral-400">{customer.email || "No email"}</div>
                              {/* One person is often several things at once: show the extra roles. */}
                              {customer.extraRoles && customer.extraRoles.length > 0 ? (
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  {customer.extraRoles.slice(0, 3).map((r, i) => (
                                    <span
                                      key={`${customer.id}-${r.label}-${i}`}
                                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${r.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-neutral-50 text-neutral-500 ring-neutral-200"}`}
                                      title={r.active ? `${r.label} (active)` : `${r.label} (on record, not active)`}
                                    >
                                      <span className={`h-1 w-1 rounded-full ${r.active ? "bg-emerald-500" : "bg-neutral-300"}`} aria-hidden />
                                      {r.label}
                                    </span>
                                  ))}
                                  {customer.extraRoles.length > 3 ? <span className="text-[10px] font-medium text-neutral-400">+{customer.extraRoles.length - 3}</span> : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${customer.registrationStatus === "COMPLETE" ? "text-emerald-700" : "text-orange-700"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${customer.registrationStatus === "COMPLETE" ? "bg-emerald-500" : "bg-orange-500"}`} />
                            {customer.registrationStatus === "COMPLETE" ? "Complete" : "Incomplete"}
                          </span>
                          <div className="mt-0.5 text-[10px] font-medium text-neutral-400">{sourceLabel(customer.registrationSource)}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-500">#{customer.id}</td>
                        <td className={`whitespace-nowrap px-4 py-3 ${customer.phone ? "text-neutral-700" : "text-neutral-400"}`}>{customer.phone || "Not set"}</td>
                        <td className="px-4 py-3">{verificationBadges(customer)}</td>
                        <td className="px-4 py-3">{statusPill(customer)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{(customer.bookingCount || 0).toLocaleString()}</td>
                        <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${customer.totalSpent ? "font-semibold text-neutral-900" : "text-neutral-400"}`}>
                          {customer.totalSpent ? `${customer.totalSpent.toLocaleString()} TZS` : "None"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{customer.lastBookingDate ? shortDate(customer.lastBookingDate) : "Never"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{shortDate(customer.createdAt)}</td>
                        <td className="px-4 py-3 text-right sm:pr-5" onClick={(event) => event.stopPropagation()}>
                          <span className="inline-flex items-center gap-1">
                            {actionsMenu(customer)}
                            <ChevronRight className="h-4 w-4 text-neutral-300" aria-hidden />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards on phones, where a twelve-column table cannot fit */}
            <div className="grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 p-3 sm:grid-cols-2 md:hidden">
              {sortedItems.map((customer) => {
                const name = customer.displayName || customer.name || "Incomplete profile";
                return (
                  <div
                    key={customer.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openCustomer(customer.id)}
                    onKeyDown={(event) => { if (event.key === "Enter") void openCustomer(customer.id); }}
                    className="flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white text-left transition-all hover:border-neutral-300"
                  >
                    <span className="flex items-start gap-3 px-4 pt-4">
                      <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white">{initials(name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-neutral-900">{name}</span>
                        <span className="block truncate text-xs text-neutral-400">{customer.email || customer.phone || "No contact details"}</span>
                      </span>
                      <span onClick={(event) => event.stopPropagation()}>{actionsMenu(customer)}</span>
                    </span>
                    <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4">
                      {statusPill(customer)}
                      {verificationBadges(customer)}
                    </span>
                    <span className="mt-3 grid grid-cols-3 gap-px bg-neutral-100">
                      {[
                        ["Bookings", (customer.bookingCount || 0).toLocaleString()],
                        ["Spent", customer.totalSpent ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(customer.totalSpent) : "None"],
                        ["Joined", shortDate(customer.createdAt)],
                      ].map(([label, value]) => (
                        <span key={label} className="min-w-0 bg-white px-3 py-2.5">
                          <span className="block text-[10px] text-neutral-400">{label}</span>
                          <span className="block truncate text-sm font-semibold tabular-nums text-neutral-900">{value}</span>
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>

            <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}

const heroButton = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

function initials(name: string | null | undefined) {
  const parts = String(name || "").trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function shortDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "Not set";
}

function sourceLabel(source: CustomerRow["registrationSource"]) {
  switch (source) {
    case "WEB": return "Web";
    case "TRAVELLER_APP": return "Traveller app";
    case "DRIVER_APP": return "Driver app";
    case "PARTNERS_APP": return "Partners app";
    case "LEGACY": return "Legacy";
    default: return "Unknown source";
  }
}

"use client";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Users, Search, X, Mail, Phone, Lock, ShoppingCart, DollarSign, Eye, MoreVertical, CheckCircle, XCircle, Loader2, Filter, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import Link from "next/link";
import Chart from "@/components/Chart";
import TableRow from "@/components/TableRow";
import type { ChartData } from "chart.js";

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
};

type CustomerSortKey = "customer" | "profile" | "accountId" | "contact" | "verification" | "status" | "bookings" | "totalSpent" | "lastBooking" | "joined";

export default function AdminUsersListPage(){
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
  });
  const pageSize = 30;
  const role = "CUSTOMER";

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

  const load = useCallback(async ()=>{
    setLoading(true);
    try {
      // IMPORTANT: Use /api/* to avoid colliding with Next pages under /admin/users/*
      // (e.g. /admin/users is a page route, not an API route).
      const [listRes, summaryRes] = await Promise.all([
        api.get<{ data: CustomerRow[]; meta: { total: number } }>("/api/admin/users", {
          params: { q, status, registrationStatus, page, perPage: pageSize, role },
        }),
        api.get<CustomersSummary>("/api/admin/users/summary"),
      ]);

      setItems(listRes.data.data || []);
      setTotal(listRes.data.meta?.total || 0);

      const summary = summaryRes.data;
      const verified = Number(summary.verifiedCustomerCount || 0);
      setStats({
        totalCustomers: Number(summary.totalCustomers || 0),
        activeCustomers: Number(summary.activeCustomers || 0),
        totalBookings: Number(summary.totalBookings || 0),
        totalRevenue: Number(summary.totalRevenue || 0),
        verifiedCustomers: verified,
        incompleteRegistrations: Number(summary.incompleteRegistrationCount || 0),
      });
    } catch (err) {
      console.error("Failed to load customers", err);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, status, registrationStatus, page, role]);

  useEffect(()=>{ load(); }, [load]);

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

  const pages = useMemo(()=> Math.max(1, Math.ceil(total / pageSize)), [total]);

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

  // Chart data for customer engagement
  const engagementChartData = useMemo<ChartData<"doughnut">>(() => {
    const withBookings = items.filter(c => (c.bookingCount || 0) > 0).length;
    const withoutBookings = items.filter(c => (c.bookingCount || 0) === 0).length;
    
    return {
      labels: ["With Bookings", "No Bookings Yet"],
      datasets: [
        {
          label: "Customer Engagement",
          data: [withBookings, withoutBookings],
          backgroundColor: [
            "rgba(16, 185, 129, 0.8)", // Green
            "rgba(156, 163, 175, 0.8)", // Gray
          ],
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    };
  }, [items]);

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

  return (
    // Full width rather than a centred max-w-7xl column. The admin layout
    // already supplies the workspace frame, so capping at 1280px left a wide
    // empty gutter on large screens and squeezed the table for no reason.
    //
    <div id="admin-customers-page" className="box-border w-full min-w-0 space-y-4 px-3 py-3 sm:space-y-6 sm:px-4 lg:px-5 xl:px-6">
      {/* Tailwind preflight is disabled app-wide, so nothing sets border-box.
          Without this, any `w-full` element that also has padding renders wider
          than its parent and pushes the page sideways. Scoped to this page
          rather than global, because enabling it everywhere would shift layouts
          that were built around its absence. */}
      <style>{`#admin-customers-page, #admin-customers-page * { box-sizing: border-box; }`}</style>
      {/* Premium Banner */}
      <div style={{ position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)", padding: "clamp(1rem, 3vw, 2rem) clamp(1rem, 3vw, 2rem) clamp(0.9rem, 2.5vw, 1.75rem)" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.13, pointerEvents: "none" }} viewBox="0 0 900 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="820" cy="30" r="90" fill="none" stroke="white" strokeWidth="1.2" />
          <circle cx="820" cy="30" r="55" fill="none" stroke="white" strokeWidth="0.7" />
          <circle cx="60" cy="140" r="70" fill="none" stroke="white" strokeWidth="1.0" />
          <line x1="0" y1="40" x2="900" y2="40" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="72" x2="900" y2="72" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="104" x2="900" y2="104" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="136" x2="900" y2="136" stroke="white" strokeWidth="0.4" />
          <polyline points="0,130 90,112 180,96 270,80 360,65 450,88 540,52 630,68 720,36 810,50 900,32" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,130 90,112 180,96 270,80 360,65 450,88 540,52 630,68 720,36 810,50 900,32 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,145 90,133 180,119 270,130 360,112 450,125 540,100 630,115 720,92 810,105 900,82" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="52" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="36" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="32" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="custListGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="90" rx="200" ry="70" fill="url(#custListGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Users style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "clamp(1.1rem, 2.2vw, 1.35rem)", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>All Customers</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Manage customers who book, review, pay, and add transportation</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "white", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : stats.totalCustomers.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(110,231,183,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Active</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#6ee7b7", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : stats.activeCustomers.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(147,51,234,0.18)", border: "1px solid rgba(196,181,253,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(216,180,254,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Bookings</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#c4b5fd", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : stats.totalBookings.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 130 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,211,77,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Revenue</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#fcd34d", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {loading ? "…" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(stats.totalRevenue)} <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>TZS</span>
            </div>
          </div>
          <div style={{ background: "rgba(14,165,233,0.16)", border: "1px solid rgba(14,165,233,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(125,211,252,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Verified</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#7dd3fc", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : stats.verifiedCustomers.toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(249,115,22,0.16)", border: "1px solid rgba(251,146,60,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 105 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(253,186,116,0.9)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Incomplete</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fdba74", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : stats.incompleteRegistrations.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-full">
          {/* Search */}
          <div className="relative flex-1 min-w-0 w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-white text-gray-900 placeholder-gray-400 outline-none box-border max-w-full"
              placeholder="Search by name, email, or phone..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPage(1);
                  load();
                }
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => { setQ(""); setPage(1); load(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-2 z-10 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                {suggestions.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setQ(s.displayName ?? s.name ?? s.email ?? ''); setSuggestions([]); setPage(1); load(); }}
                    className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 hover:bg-gray-50 last:border-b-0"
                  >
                    <div className="font-medium text-gray-900">{s.displayName ?? s.name ?? s.email ?? `Account #${s.id}`}</div>
                    <div className="text-xs text-gray-500">{s.email || s.phone || 'Missing contact details'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0">
            <Filter className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-white text-gray-700 outline-none box-border min-w-[140px]"
            >
              <option value="">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-shrink-0">
            <select
              value={registrationStatus}
              onChange={(e) => { setRegistrationStatus(e.target.value); setPage(1); }}
              aria-label="Registration status"
              className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-white text-gray-700 outline-none box-border min-w-[180px]"
            >
              <option value="">All Registrations</option>
              <option value="COMPLETE">Complete Profiles</option>
              <option value="INCOMPLETE">Incomplete Profiles</option>
            </select>
          </div>
        </div>
      </div>

      {/* Chart */}
      {items.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Customer Engagement</h2>
          <div className="h-64">
            <Chart type="doughnut" data={engagementChartData} />
          </div>
        </div>
      )}

      {/* Customers Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200">
                  <tr>
                    {["S/N","Customer","Profile","Account ID","Contact","Verification","Status","Bookings","Total Spent","Last Booking","Joined","Actions"].map(h => (
                      <th key={h} className={`px-6 py-3 ${h==="Actions"?"text-right":"text-left"} text-xs font-semibold text-gray-500 uppercase tracking-wider`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                    {[...Array(5)].map((_, i) => (
                      <TableRow key={i} hover={false} className="animate-pulse">
                      <td className="px-4 py-4 whitespace-nowrap"><div className="h-7 w-7 rounded-md bg-gray-200"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-32 mb-2"></div><div className="h-3 bg-gray-100 rounded w-40"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-5 bg-gray-200 rounded w-28"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-6 bg-gray-200 rounded w-16"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-6 bg-gray-200 rounded w-20"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-12"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                      <td className="px-6 py-4 whitespace-nowrap text-right"><div className="h-8 bg-gray-200 rounded w-8 ml-auto"></div></td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No customers found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="w-16 whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">S/N</th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("customer")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Customer {renderSortIcon("customer")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <button type="button" onClick={() => handleSort("profile")} className="m-0 inline-flex appearance-none items-center gap-1 border-0 bg-transparent p-0 hover:text-gray-700">
                        Profile {renderSortIcon("profile")}
                      </button>
                    </th>
                    <th className="min-w-[110px] whitespace-nowrap px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <button type="button" onClick={() => handleSort("accountId")} className="m-0 inline-flex whitespace-nowrap appearance-none items-center gap-1 border-0 bg-transparent p-0 hover:text-gray-700">
                        Account ID {renderSortIcon("accountId")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("contact")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Contact {renderSortIcon("contact")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("verification")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Verification {renderSortIcon("verification")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("status")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Status {renderSortIcon("status")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("bookings")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Bookings {renderSortIcon("bookings")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("totalSpent")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Total Spent {renderSortIcon("totalSpent")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("lastBooking")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Last Booking {renderSortIcon("lastBooking")}
                      </button>
                    </th>
                    <th className="whitespace-nowrap px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <button type="button" onClick={() => handleSort("joined")} className="inline-flex whitespace-nowrap items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                        Joined {renderSortIcon("joined")}
                      </button>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {sortedItems.map((customer, index) => (
                    <TableRow
                      key={customer.id}
                      // Double click anywhere on the row is a shortcut to the
                      // customer profile, same destination as View Details.
                      onDoubleClick={() => {
                        closeActionsMenu();
                        router.push(`/admin/users/${customer.id}`);
                      }}
                      title="Double click to open this customer"
                      className="align-middle cursor-pointer select-none hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-slate-100 px-1.5 text-xs font-bold tabular-nums text-slate-700 ring-1 ring-slate-200">
                          {(page - 1) * pageSize + index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-semibold text-gray-900">{customer.displayName || customer.name || "Incomplete profile"}</div>
                        <div className="text-sm text-gray-500">{customer.email || 'Email missing'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${customer.registrationStatus === 'COMPLETE' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                            {customer.registrationStatus === 'COMPLETE' ? 'Profile complete' : 'Profile incomplete'}
                          </span>
                          <span className="text-[10px] font-medium text-gray-400">{(customer.registrationSource || 'UNKNOWN').replaceAll('_', ' ')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold tabular-nums text-gray-600">{customer.id}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {customer.phone || "N/A"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {customer.emailVerifiedAt && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 border border-violet-200" title="Email Verified">
                              <Mail className="h-3 w-3" />
                            </span>
                          )}
                          {customer.phoneVerifiedAt && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200" title="Phone Verified">
                              <Phone className="h-3 w-3" />
                            </span>
                          )}
                          {customer.twoFactorEnabled && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200" title="2FA Enabled">
                              <Lock className="h-3 w-3" />
                            </span>
                          )}
                          {!customer.emailVerifiedAt && !customer.phoneVerifiedAt && !customer.twoFactorEnabled && (
                            <span className="text-xs text-gray-400">None</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isCustomerSuspended(customer) ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                            <XCircle className="h-3.5 w-3.5" />
                            Suspended
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            <CheckCircle className="h-3.5 w-3.5" />
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <ShoppingCart className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-700">{customer.bookingCount || 0}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-emerald-700">
                          {customer.totalSpent ? `TZS ${customer.totalSpent.toLocaleString()}` : "TZS 0"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {customer.lastBookingDate ? new Date(customer.lastBookingDate).toLocaleDateString() : "Never"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(customer.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="relative">
                          <button
                            aria-label="Customer actions"
                            aria-expanded={showActionsMenu === customer.id}
                            onClick={(event) => {
                              if (showActionsMenu === customer.id) {
                                closeActionsMenu();
                                return;
                              }
                              openActionsMenu(customer.id, event.currentTarget);
                            }}
                            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                          >
                            {actionLoading === customer.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreVertical className="h-4 w-4" />
                            )}
                          </button>
                          {showActionsMenu === customer.id && actionsMenuPos && typeof document !== "undefined" &&
                            createPortal(
                              <>
                                <div className="fixed inset-0 z-[70]" onClick={closeActionsMenu} />
                                {/* ring-1 instead of `border`, and gap-px over a tinted
                                    background instead of `border-b`: Tailwind preflight is
                                    disabled in this app, so bare border utilities set no
                                    border-style and render nothing. */}
                                <div
                                  className="fixed z-[80] w-52 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-gray-200"
                                  style={{ top: actionsMenuPos.top, left: actionsMenuPos.left }}
                                >
                                  <div className="flex flex-col gap-px bg-gray-100">
                                    <Link
                                      href={`/admin/users/${customer.id}`}
                                      className="w-full bg-white px-4 py-2.5 text-sm flex items-center gap-2 no-underline text-gray-700 hover:bg-gray-50"
                                      onClick={closeActionsMenu}
                                    >
                                      <Eye className="h-4 w-4 text-blue-500" />
                                      View Details
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={() => handleReset2FA(customer.id)}
                                      className="w-full bg-white text-left px-4 py-2.5 text-sm flex items-center gap-2 text-gray-700 hover:bg-gray-50"
                                    >
                                      <Lock className="h-4 w-4 text-amber-500" />
                                      Reset 2FA
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSuspend(customer.id)}
                                      className="w-full bg-white text-left px-4 py-2.5 text-sm flex items-center gap-2 text-red-600 hover:bg-red-50"
                                    >
                                      <XCircle className="h-4 w-4 text-red-500" />
                                      Suspend
                                    </button>
                                  </div>
                                </div>
                              </>,
                              document.body,
                            )}
                        </div>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Pagination */}
      {items.length > 0 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="text-sm text-gray-500">
            Showing {((page - 1) * pageSize) + 1} to {Math.min(page * pageSize, total)} of {total} customers
          </div>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <div className="px-4 py-2 text-sm font-medium text-gray-700">
              Page {page} of {pages}
            </div>
            <button
              disabled={page >= pages}
              onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

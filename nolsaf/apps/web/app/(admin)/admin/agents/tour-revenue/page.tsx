"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  CheckCircle2,
  Eye,
  Clock,
  DollarSign,
  FileText,
  Filter,
  RefreshCw,
  TrendingUp,
  Wallet,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

type RevenueStatus = "DRAFT" | "NEW" | "CLAIMED" | "VERIFIED" | "APPROVED" | "DISBURSED" | "REJECTED";

interface TourRevenueRecord {
  id: number;
  bookingId: number;
  bookingCode: string;
  operatorAgentId: number;
  operatorName: string;
  tourTitle: string;
  destination: string;
  numberOfPeople: number;
  grossAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  taxPercent: number;
  taxAmount: number;
  netAmount: number;
  currency: string;
  status: RevenueStatus;
  paymentAccess?: {
    status?: "ACTIVE" | "EXPIRED" | string;
    issuedAt?: string | null;
    expiresAt?: string | null;
    tokenHours?: number;
    source?: string | null;
  } | null;
  paymentRef: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RevenueSummary {
  total: number;
  draft: number;
  new: number;
  claimed: number;
  verified: number;
  approved: number;
  disbursed: number;
  rejected: number;
  totalAmount: number;
  disbursedAmount: number;
}

type RevenueSortKey =
  | "bookingCode"
  | "operatorName"
  | "createdAt"
  | "tourTitle"
  | "numberOfPeople"
  | "grossAmount"
  | "commissionAmount"
  | "taxAmount"
  | "status"
  | "netAmount";

type StatusMeta = { label: string; color: string; bgColor: string; icon: LucideIcon };

const fallbackStatus: StatusMeta = {
  label: "Pending",
  color: "text-slate-700",
  bgColor: "bg-slate-50 border-slate-200",
  icon: Clock,
};

const statusConfig: Record<RevenueStatus, StatusMeta> = {
  DRAFT: { label: "Draft", color: "text-slate-700", bgColor: "bg-slate-50 border-slate-200", icon: FileText },
  NEW: { label: "New", color: "text-blue-700", bgColor: "bg-blue-50 border-blue-200", icon: Clock },
  CLAIMED: { label: "Claimed", color: "text-sky-700", bgColor: "bg-sky-50 border-sky-200", icon: FileText },
  VERIFIED: { label: "Verified", color: "text-yellow-700", bgColor: "bg-yellow-50 border-yellow-200", icon: AlertCircle },
  APPROVED: { label: "Approved", color: "text-emerald-700", bgColor: "bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  DISBURSED: { label: "Disbursed", color: "text-green-700", bgColor: "bg-green-50 border-green-200", icon: TrendingUp },
  REJECTED: { label: "Rejected", color: "text-rose-700", bgColor: "bg-rose-50 border-rose-200", icon: XCircle },
};

function authify() {}

function money(value: number, currency = "TZS") {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
      currencyDisplay: "narrowSymbol",
    }).format(Math.round(Number(value || 0)));
  } catch {
    return `${currency} ${Math.round(Number(value || 0)).toLocaleString()}`;
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTokenRemaining(expiresAt: string | null | undefined, nowMs: number) {
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : 0;
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return "Expired";
  const totalSeconds = Math.floor((expiresMs - nowMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export default function AdminTourRevenueOverview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RevenueStatus | "ALL">("ALL");
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [revenues, setRevenues] = useState<TourRevenueRecord[]>([]);
  const [agentCommissionCurrency, setAgentCommissionCurrency] = useState<string>("TZS");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [operatorFilter, setOperatorFilter] = useState("");
  const [destinationFilter, setDestinationFilter] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [sortBy, setSortBy] = useState<RevenueSortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement | null>(null);
  const pageSize = 10;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      authify();
      const res = await api.get<{
        ok: boolean;
        summary: RevenueSummary;
        revenues: TourRevenueRecord[];
        agentCommissionCurrency?: string;
      }>("/api/admin/tour-revenue/overview");
      if (res.data.ok) {
        setSummary(res.data.summary);
        setRevenues(res.data.revenues);
        setAgentCommissionCurrency(res.data.agentCommissionCurrency ?? "TZS");
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to load tour revenue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    try {
      searchRef.current?.focus();
    } catch {
      // ignore
    }
  }, [load]);

  const filteredRevenues = useMemo(() => {
    let filtered = revenues;
    if (activeTab !== "ALL") filtered = filtered.filter((r) => r.status === activeTab);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          (r.bookingCode || "").toLowerCase().includes(q) ||
          (r.operatorName || "").toLowerCase().includes(q) ||
          (r.tourTitle || "").toLowerCase().includes(q) ||
          (r.destination || "").toLowerCase().includes(q)
      );
    }
    if (operatorFilter) filtered = filtered.filter((r) => String(r.operatorAgentId) === operatorFilter);
    if (destinationFilter) {
      const target = destinationFilter.toLowerCase();
      filtered = filtered.filter((r) => `${r.destination || ""} ${r.tourTitle || ""}`.toLowerCase().includes(target));
    }
    if (amountMin) {
      const min = Number(amountMin);
      if (!Number.isNaN(min)) filtered = filtered.filter((r) => Number(r.grossAmount || 0) >= min);
    }
    if (amountMax) {
      const max = Number(amountMax);
      if (!Number.isNaN(max)) filtered = filtered.filter((r) => Number(r.grossAmount || 0) <= max);
    }
    return filtered;
  }, [revenues, activeTab, searchQuery, operatorFilter, destinationFilter, amountMin, amountMax]);

  const sortedRevenues = useMemo(() => {
    const rows = [...filteredRevenues];
    const readValue = (row: TourRevenueRecord): number | string => {
      switch (sortBy) {
        case "bookingCode":
          return String(row.bookingCode || "").toLowerCase();
        case "operatorName":
          return String(row.operatorName || "").toLowerCase();
        case "createdAt":
          return new Date(row.createdAt || "").getTime() || 0;
        case "tourTitle":
          return String(row.tourTitle || "").toLowerCase();
        case "numberOfPeople":
          return Number(row.numberOfPeople || 0);
        case "grossAmount":
          return Number(row.grossAmount || 0);
        case "commissionAmount":
          return Number(row.commissionAmount || 0);
        case "taxAmount":
          return Number(row.taxAmount || 0);
        case "status":
          return String(row.status || "").toLowerCase();
        case "netAmount":
          return Number(row.netAmount || 0);
        default:
          return 0;
      }
    };

    rows.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [filteredRevenues, sortBy, sortDir]);

  const totalRows = sortedRevenues.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, operatorFilter, destinationFilter, amountMin, amountMax]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (activeTab !== "DRAFT") return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeTab]);

  const paginatedRevenues = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRevenues.slice(start, start + pageSize);
  }, [sortedRevenues, currentPage]);

  const onSort = (field: RevenueSortKey) => {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "createdAt" ? "desc" : "asc");
  };

  const sortIcon = (field: RevenueSortKey) => {
    if (sortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#02665e]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#02665e]" />;
  };

  const sortHeaderBtnClass = "inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none cursor-pointer hover:text-slate-900";

  const tabs = [
    { key: "ALL", label: "All", count: summary?.total ?? 0 },
    { key: "DRAFT", label: "Draft", count: summary?.draft ?? 0 },
    { key: "NEW", label: "New", count: summary?.new ?? 0 },
    { key: "CLAIMED", label: "Claimed", count: summary?.claimed ?? 0 },
    { key: "VERIFIED", label: "Verified", count: summary?.verified ?? 0 },
    { key: "APPROVED", label: "Approved", count: summary?.approved ?? 0 },
    { key: "DISBURSED", label: "Paid / Disbursed", count: summary?.disbursed ?? 0 },
    { key: "REJECTED", label: "Rejected", count: summary?.rejected ?? 0 },
  ];

  const showingDraftOnly = activeTab === "DRAFT";
  const payableRevenues = filteredRevenues.filter((item) => item.status !== "DRAFT");
  const shownGross = (showingDraftOnly ? filteredRevenues : payableRevenues).reduce((sum, item) => sum + Number(item.grossAmount || 0), 0);
  const shownCommission = payableRevenues.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0);
  const shownPayout = payableRevenues.reduce((sum, item) => sum + Number(item.netAmount || 0), 0);
  const summaryDisplayCurrency = agentCommissionCurrency || filteredRevenues[0]?.currency || "TZS";
  const operators = useMemo(() => {
    const map = new Map<number, string>();
    revenues.forEach((item) => {
      if (item.operatorAgentId) map.set(item.operatorAgentId, item.operatorName || `Operator ${item.operatorAgentId}`);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [revenues]);
  const destinations = useMemo(() => {
    const set = new Set<string>();
    revenues.forEach((item) => {
      if (item.destination) set.add(item.destination);
      if (item.tourTitle) set.add(item.tourTitle);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [revenues]);

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 w-full">
      <div
        className="relative overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
          boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)",
        }}
      >
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full select-none" preserveAspectRatio="xMidYMid slice" viewBox="0 0 900 220" xmlns="http://www.w3.org/2000/svg">
          <circle cx="860" cy="45" r="200" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
          <circle cx="860" cy="45" r="155" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
          <circle cx="28" cy="208" r="130" stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
          {[44, 88, 132, 176].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.030)" strokeWidth="1" />
          ))}
          <polyline points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78" fill="none" stroke="white" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78 900,220 0,220" fill="white" fillOpacity="0.026" />
          {([[720, 90], [560, 108], [880, 78], [240, 145]] as [number, number][]).map(([px, py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3" fill="white" fillOpacity="0.22" />
          ))}
        </svg>

        <div className="relative z-10 flex flex-col items-center px-6 py-10 text-center sm:py-14">
          <div
            className="mb-5 inline-flex items-center justify-center rounded-full"
            style={{
              width: 64,
              height: 64,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Wallet className="h-7 w-7 text-white/90" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}>
            Tour Revenue Pipeline
          </h1>
          <p className="mt-2 text-sm text-white/55 sm:text-base">All tour packages bookings and disbursement tracking</p>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <div className="overflow-hidden rounded-xl" style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
        <div className="px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="w-full min-w-0 max-w-full">
              <div className="relative w-full min-w-0 max-w-full">
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search # / booking / operator"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="box-border w-full min-w-0 max-w-full rounded-lg py-2 pl-9 pr-3 text-xs outline-none transition-all sm:py-2.5 sm:pl-10 sm:pr-4 sm:text-sm"
                    style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.90)" }}
                  />
                  <FileText className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 sm:left-3 sm:h-5 sm:w-5" style={{ color: "rgba(255,255,255,0.40)" }} />
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
              {tabs.map((tab) => {
                const key = String(tab.key);
                const isActive = activeTab === tab.key;
                type PillColors = { activeBg: string; activeBorder: string; activeText: string; inactiveBg: string; inactiveBorder: string; badgeBg: string; badgeText: string };
                const colorMap: Record<string, PillColors> = {
                  ALL: { activeBg: "rgba(255,255,255,0.18)", activeBorder: "rgba(255,255,255,0.38)", activeText: "#ffffff", inactiveBg: "rgba(255,255,255,0.06)", inactiveBorder: "rgba(255,255,255,0.12)", badgeBg: "rgba(255,255,255,0.15)", badgeText: "#e2e8f0" },
                  DRAFT: { activeBg: "rgba(148,163,184,0.25)", activeBorder: "rgba(148,163,184,0.55)", activeText: "#cbd5e1", inactiveBg: "rgba(148,163,184,0.08)", inactiveBorder: "rgba(148,163,184,0.20)", badgeBg: "rgba(148,163,184,0.20)", badgeText: "#cbd5e1" },
                  NEW: { activeBg: "rgba(59,130,246,0.25)", activeBorder: "rgba(59,130,246,0.55)", activeText: "#93c5fd", inactiveBg: "rgba(59,130,246,0.08)", inactiveBorder: "rgba(59,130,246,0.20)", badgeBg: "rgba(59,130,246,0.20)", badgeText: "#93c5fd" },
                  CLAIMED: { activeBg: "rgba(14,165,233,0.25)", activeBorder: "rgba(14,165,233,0.55)", activeText: "#7dd3fc", inactiveBg: "rgba(14,165,233,0.08)", inactiveBorder: "rgba(14,165,233,0.20)", badgeBg: "rgba(14,165,233,0.20)", badgeText: "#7dd3fc" },
                  VERIFIED: { activeBg: "rgba(245,158,11,0.25)", activeBorder: "rgba(245,158,11,0.55)", activeText: "#fcd34d", inactiveBg: "rgba(245,158,11,0.08)", inactiveBorder: "rgba(245,158,11,0.20)", badgeBg: "rgba(245,158,11,0.20)", badgeText: "#fcd34d" },
                  APPROVED: { activeBg: "rgba(16,185,129,0.25)", activeBorder: "rgba(16,185,129,0.55)", activeText: "#6ee7b7", inactiveBg: "rgba(16,185,129,0.08)", inactiveBorder: "rgba(16,185,129,0.20)", badgeBg: "rgba(16,185,129,0.20)", badgeText: "#6ee7b7" },
                  DISBURSED: { activeBg: "rgba(20,184,166,0.25)", activeBorder: "rgba(20,184,166,0.55)", activeText: "#5eead4", inactiveBg: "rgba(20,184,166,0.08)", inactiveBorder: "rgba(20,184,166,0.20)", badgeBg: "rgba(20,184,166,0.20)", badgeText: "#5eead4" },
                  REJECTED: { activeBg: "rgba(239,68,68,0.25)", activeBorder: "rgba(239,68,68,0.55)", activeText: "#fca5a5", inactiveBg: "rgba(239,68,68,0.08)", inactiveBorder: "rgba(239,68,68,0.20)", badgeBg: "rgba(239,68,68,0.20)", badgeText: "#fca5a5" },
                };
                const col = colorMap[key] ?? colorMap.ALL;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs transition-all duration-200 sm:gap-1.5 sm:px-2.5 sm:py-1.5"
                    style={isActive ? { background: col.activeBg, border: `1.5px solid ${col.activeBorder}`, color: col.activeText } : { background: col.inactiveBg, border: `1.5px solid ${col.inactiveBorder}`, color: "rgba(255,255,255,0.65)" }}
                  >
                    <span className="whitespace-nowrap">{tab.label}</span>
                    <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-xs" style={{ background: col.badgeBg, color: col.badgeText }}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}

              <div className="ml-auto flex items-center gap-2 whitespace-nowrap">
                <button
                  onClick={() => void load()}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs transition-all sm:h-9 sm:w-9"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.75)" }}
                  title="Refresh"
                  aria-label="Refresh revenue"
                >
                  <RefreshCw className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex flex-shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-1 text-xs transition-all sm:px-2.5 sm:py-1.5"
                  style={showFilters ? { background: "rgba(2,102,94,0.30)", border: "1.5px solid rgba(2,102,94,0.65)", color: "#5eead4" } : { background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.75)" }}
                >
                  <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  Filters
                </button>
              </div>
            </div>

            <div className="text-[11px] sm:text-xs" style={{ color: "rgba(255,255,255,0.38)" }}>
              List shows one row per booking. Use search to filter by booking code, operator name, tour title, or destination.
            </div>

            {showFilters ? (
              <div className="space-y-3 pt-3 sm:space-y-4 sm:pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.85)" }}>Advanced Filters</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setOperatorFilter("");
                      setDestinationFilter("");
                      setAmountMin("");
                      setAmountMax("");
                      setShowFilters(false);
                    }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors duration-200"
                    style={{ color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.06)" }}
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                  <div className="min-w-0">
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Tour Operator</label>
                    <select
                      value={operatorFilter}
                      onChange={(e) => setOperatorFilter(e.target.value)}
                      className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                      style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.85)" }}
                    >
                      <option value="" style={{ background: "#0d2320" }}>All Operators</option>
                      {operators.map((operator) => (
                        <option key={operator.id} value={operator.id} style={{ background: "#0d2320" }}>
                          {operator.name} ({operator.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Destination / Package</label>
                    <select
                      value={destinationFilter}
                      onChange={(e) => setDestinationFilter(e.target.value)}
                      className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                      style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.85)" }}
                    >
                      <option value="" style={{ background: "#0d2320" }}>All Destinations</option>
                      {destinations.map((destination) => (
                        <option key={destination} value={destination} style={{ background: "#0d2320" }}>
                          {destination}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Min Amount (TZS)</label>
                    <input
                      type="number"
                      value={amountMin}
                      onChange={(e) => setAmountMin(e.target.value)}
                      placeholder="0"
                      className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                      style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.85)" }}
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1.5 block text-xs font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>Max Amount (TZS)</label>
                    <input
                      type="number"
                      value={amountMax}
                      onChange={(e) => setAmountMax(e.target.value)}
                      placeholder="No limit"
                      className="box-border w-full rounded-lg px-3 py-2 text-xs outline-none transition-all sm:text-sm"
                      style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.13)", color: "rgba(255,255,255,0.85)" }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#02665e]/20 bg-gradient-to-r from-[#02665e]/10 to-emerald-50 p-4 shadow-sm sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#02665e]/20">
              <DollarSign className="h-5 w-5 text-[#02665e]" />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-600 sm:text-sm">{showingDraftOnly ? "Draft Value" : "Total Paid (shown)"}</div>
              <div className="text-lg font-bold text-[#02665e] sm:text-xl">{money(shownGross, summaryDisplayCurrency)}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <TrendingUp className="h-5 w-5 text-blue-700" />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-600 sm:text-sm">Commission</div>
              <div className="text-lg font-bold text-blue-700 sm:text-xl">{money(shownCommission, agentCommissionCurrency)}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-600 sm:text-sm">Tour Payout</div>
              <div className="text-lg font-bold text-emerald-700 sm:text-xl">{money(shownPayout, summaryDisplayCurrency)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="w-full max-w-full overflow-x-auto overflow-y-visible overscroll-x-contain [scrollbar-gutter:stable]">
          <table className="w-full min-w-[1120px] text-xs">
            <thead>
              <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50">
                <th className="min-w-max px-2 py-3 text-center font-semibold text-slate-600">SN</th>
                <th className="min-w-max px-2 py-3 text-left font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("bookingCode")} className={sortHeaderBtnClass}>
                    INVOICE {sortIcon("bookingCode")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-left font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("operatorName")} className={sortHeaderBtnClass}>
                    TOUR OPERATOR {sortIcon("operatorName")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-left font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("createdAt")} className={sortHeaderBtnClass}>
                    TIME {sortIcon("createdAt")}
                  </button>
                </th>
                {activeTab === "DRAFT" ? (
                  <th className="min-w-max px-2 py-3 text-left font-semibold text-slate-600">
                    TOKEN STATUS
                  </th>
                ) : null}
                <th className="min-w-max px-2 py-3 text-left font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("tourTitle")} className={sortHeaderBtnClass}>
                    PACKAGE NAME {sortIcon("tourTitle")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-center font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("numberOfPeople")} className={sortHeaderBtnClass}>
                    NO OF PEOPLE {sortIcon("numberOfPeople")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-right font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("grossAmount")} className={sortHeaderBtnClass}>
                    {showingDraftOnly ? "DRAFT VALUE" : "TOTAL PAID"} {sortIcon("grossAmount")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-right font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("commissionAmount")} className={sortHeaderBtnClass}>
                    COMMISSION {sortIcon("commissionAmount")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-right font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("taxAmount")} className={sortHeaderBtnClass}>
                    TAX {sortIcon("taxAmount")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-center font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("status")} className={sortHeaderBtnClass}>
                    STATUS {sortIcon("status")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-right font-semibold text-slate-600">
                  <button type="button" onClick={() => onSort("netAmount")} className={sortHeaderBtnClass}>
                    TOUR PAYOUT {sortIcon("netAmount")}
                  </button>
                </th>
                <th className="min-w-max px-2 py-3 text-center font-semibold text-slate-600">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={activeTab === "DRAFT" ? 13 : 12} className="px-4 py-8 text-center text-slate-500">Loading...</td>
                </tr>
              ) : paginatedRevenues.length === 0 ? (
                <tr>
                  <td colSpan={activeTab === "DRAFT" ? 13 : 12} className="px-4 py-8 text-center text-slate-500">No records found</td>
                </tr>
              ) : (
                paginatedRevenues.map((revenue, index) => {
                  const status = statusConfig[revenue.status] ?? fallbackStatus;
                  const StatusIcon = status.icon;
                  const rowReceipt = String(revenue.paymentRef || "").trim();
                  return (
                    <tr key={revenue.id} className="border-slate-100 text-xs transition-colors hover:bg-slate-50">
                      <td className="px-2 py-2 text-center font-medium text-slate-500">{(currentPage - 1) * pageSize + index + 1}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <div className="text-xs font-semibold text-slate-900">{revenue.bookingCode}</div>
                        {rowReceipt ? (
                          <div className="text-xs font-semibold text-[#02665e]">Receipt: {rowReceipt}</div>
                        ) : null}
                        <div className="text-xs text-slate-500">{new Date(revenue.createdAt).toLocaleDateString()}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-700">{revenue.operatorName}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-slate-500">{formatTime(revenue.createdAt)}</td>
                      {activeTab === "DRAFT" ? (
                        <td className="whitespace-nowrap px-2 py-2">
                          {(() => {
                            const expiresAt = revenue.paymentAccess?.expiresAt || null;
                            const active = revenue.paymentAccess?.status === "ACTIVE" && new Date(expiresAt || "").getTime() > nowMs;
                            return (
                              <div className="space-y-1">
                                <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                  active
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-rose-200 bg-rose-50 text-rose-700"
                                }`}>
                                  {active ? "Active" : "Expired"}
                                </span>
                                <div className="text-[11px] font-semibold text-slate-500">
                                  {formatTokenRemaining(expiresAt, nowMs)}
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      ) : null}
                      <td className="whitespace-nowrap px-2 py-2">
                        <div className="text-xs font-semibold text-slate-900">{revenue.tourTitle}</div>
                        <div className="text-xs text-slate-500">{revenue.destination}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-center text-xs font-semibold text-slate-900">{revenue.numberOfPeople || 0}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-slate-900">
                        {revenue.status === "DRAFT" && activeTab !== "DRAFT" ? (
                          <div>
                            <div className="text-slate-500">{money(revenue.grossAmount, revenue.currency)}</div>
                            <div className="text-[10px] font-semibold text-slate-400">Draft value</div>
                          </div>
                        ) : money(revenue.grossAmount, revenue.currency)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {revenue.status === "DRAFT" ? (
                          <div className="text-xs font-semibold text-slate-400">Not eligible</div>
                        ) : (
                          <>
                            <div className="text-xs font-semibold text-orange-700">{Number(revenue.commissionPercent || 0)}%</div>
                            <div className="text-xs font-semibold text-purple-700">{money(revenue.commissionAmount, revenue.currency)}</div>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {revenue.status === "DRAFT" ? (
                          <div className="text-xs font-semibold text-slate-400">Not eligible</div>
                        ) : (
                          <>
                            <div className="text-xs font-semibold text-orange-700">{Number(revenue.taxPercent || 0)}%</div>
                            <div className="text-xs font-semibold text-rose-600">{money(revenue.taxAmount, revenue.currency)}</div>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-center">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${status.bgColor} ${status.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right text-xs font-semibold text-emerald-700">
                        {revenue.status === "DRAFT" ? <span className="text-slate-400">Not eligible</span> : money(revenue.netAmount, revenue.currency)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-center">
                        <Link
                          href={`/admin/agents/tour-revenue/${revenue.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#02665e] hover:text-emerald-700"
                          aria-label={`View ${revenue.bookingCode}`}
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && totalRows > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-600 sm:px-4 sm:py-3">
            <span>
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalRows)} of {totalRows}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs font-medium text-slate-700">Page {currentPage} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

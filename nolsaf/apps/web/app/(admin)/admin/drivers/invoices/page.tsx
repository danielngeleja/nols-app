"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Eye,
  FileText,
  Search,
  X,
  Calendar,
  DollarSign,
  Clock,
  BarChart3,
  Percent,
  Route,
} from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

function isTripCodeLike(input: string) {
  const s = String(input ?? "").trim().toUpperCase();
  if (!s) return false;
  if (s.startsWith("TRP")) return true;
  return /^TRP[_\-: ]?[0-9A-Z]{5}[- ]?[0-9A-Z]{5}[- ]?[0-9A-Z]{5}[- ]?[0-9A-Z]{5}[- ]?[0-9A-Z]{6}$/.test(s);
}

type InvoiceRow = {
  id: number;
  payoutId?: number;
  invoiceId: number | null;
  invoiceNumber: string;
  receiptNumber: string | null;
  trip: {
    id: number;
    code: string;
    status: string;
    scheduledAt: string | null;
    pickup: string;
    dropoff: string;
    pickupCoordinate?: string | null;
    dropoffCoordinate?: string | null;
    vehicleType: string | null;
  } | null;
  driver: { id: number; name: string; email: string; phone: string | null } | null;
  amount: number;
  currency?: string;
  gross: number;
  commissionPercent: number;
  commissionAmount: number;
  status: string;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  adminNotes?: string | null;
  requestedAt: string;
  issuedAt: string;
  createdAt: string;
};

type SortKey = "trip" | "invoiceNumber" | "driver" | "route" | "amount" | "gross" | "commissionPercent" | "requestedAt" | "issuedAt" | "status";
type SortDirection = "asc" | "desc";

function badgeClasses(v: string) {
  switch (v) {
    case "PENDING":
      return "bg-gray-100 text-gray-700";
    case "VERIFIED":
      return "bg-teal-100 text-teal-700";
    case "APPROVED":
      return "bg-blue-100 text-blue-700";
    case "PROCESSING":
      return "bg-yellow-100 text-yellow-700";
    case "PAID":
      return "bg-emerald-100 text-emerald-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function payoutStatusLabel(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING":
      return "Requested";
    case "VERIFIED":
      return "Verified";
    case "APPROVED":
    case "PROCESSING":
      return "Approved";
    case "PAID":
      return "Disbursed";
    default:
      return "Requested";
  }
}

type InvoiceStats = {
  date: string;
  count: number;
  paid: number;
  amount: number;
};

type InvoiceStatsResponse = {
  stats: InvoiceStats[];
  period: string;
  startDate: string;
  endDate: string;
};

type TripLookupBooking = {
  id: number;
  tripCode: string | null;
  scheduledAt: string;
  vehicleType: string | null;
  amount: number;
  currency: string;
  status: string | null;
  paymentStatus: string | null;
  paymentRef: string | null;
  pickup: string | null;
  dropoff: string | null;
  driver: { id: number; name: string; email: string; phone: string | null } | null;
};

type TripLookupResponse = { booking: TripLookupBooking };

export default function AdminDriversInvoicesPage() {
  const [status, setStatus] = useState<string>("PENDING");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "requestedAt", direction: "desc" });

  const [tripLookupLoading, setTripLookupLoading] = useState(false);
  const [tripLookupError, setTripLookupError] = useState<string | null>(null);
  const [tripLookupResult, setTripLookupResult] = useState<TripLookupBooking | null>(null);
  const lastLookupTermRef = useRef<string>("");
  
  // Histogram state
  const [histogramPeriod, setHistogramPeriod] = useState<string>("30d");
  const [histogramData, setHistogramData] = useState<InvoiceStatsResponse | null>(null);
  const [histogramLoading, setHistogramLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      if (status) params.status = status;
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      if (q) params.q = q;

      const r = await api.get<{ items: InvoiceRow[]; total: number }>("/api/admin/drivers/invoices", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err) {
      console.error("Failed to load invoices", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, date, q]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  const lookupTripCode = useCallback(
    async (code: string) => {
      const term = String(code ?? "").trim();
      if (!isTripCodeLike(term)) {
        setTripLookupError(null);
        setTripLookupResult(null);
        return;
      }

      const key = term.replace(/\s+/g, " ").trim().toUpperCase();
      if (lastLookupTermRef.current === key) return;
      lastLookupTermRef.current = key;

      setTripLookupLoading(true);
      setTripLookupError(null);
      try {
        const r = await api.get<TripLookupResponse>("/api/admin/drivers/trips/lookup-by-code", {
          params: { tripCode: term },
        });
        setTripLookupResult(r.data?.booking ?? null);
        if (!r.data?.booking) setTripLookupError("Not found");
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404) {
          setTripLookupResult(null);
          setTripLookupError("Not found");
        } else if (status === 400) {
          setTripLookupResult(null);
          setTripLookupError("Invalid trip code");
        } else if (status === 429) {
          setTripLookupResult(null);
          setTripLookupError("Too many lookups. Please wait and try again.");
        } else {
          console.error("Trip code lookup failed", err);
          setTripLookupResult(null);
          setTripLookupError("Lookup failed");
        }
      } finally {
        setTripLookupLoading(false);
      }
    },
    []
  );

  // Auto-detect: when a valid TRP code is typed/pasted, lookup automatically (debounced)
  useEffect(() => {
    const term = String(q ?? "").trim();
    if (!isTripCodeLike(term)) {
      lastLookupTermRef.current = "";
      setTripLookupLoading(false);
      setTripLookupError(null);
      setTripLookupResult(null);
      return;
    }

    const t = window.setTimeout(() => {
      void lookupTripCode(term);
    }, 350);

    return () => window.clearTimeout(t);
  }, [q, lookupTripCode]);

  const loadHistogram = useCallback(async () => {
    setHistogramLoading(true);
    try {
      const r = await api.get<InvoiceStatsResponse>("/api/admin/drivers/invoices/stats", {
        params: { period: histogramPeriod },
      });
      setHistogramData(r.data);
    } catch (err) {
      console.error("Failed to load invoice statistics", err);
      setHistogramData(null);
    } finally {
      setHistogramLoading(false);
    }
  }, [histogramPeriod]);

  useEffect(() => {
    authify();
    load();
  }, [load]);

  useEffect(() => {
    authify();
    loadHistogram();
  }, [loadHistogram]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const sortedList = useMemo(() => {
    const valueFor = (invoice: InvoiceRow) => {
      switch (sort.key) {
        case "trip":
          return invoice.trip?.code || invoice.trip?.id || "";
        case "invoiceNumber":
          return invoice.invoiceNumber || `INV-${invoice.id}`;
        case "driver":
          return invoice.driver?.name || invoice.driver?.email || "";
        case "route":
          return `${invoice.trip?.pickup || ""} ${invoice.trip?.dropoff || ""}`;
        case "amount":
          return Number(invoice.amount ?? 0);
        case "gross":
          return Number(invoice.gross ?? 0);
        case "commissionPercent":
          return Number(invoice.commissionPercent ?? 0);
        case "requestedAt":
          return new Date(invoice.requestedAt).getTime() || 0;
        case "issuedAt":
          return new Date(invoice.issuedAt).getTime() || 0;
        case "status":
          return invoice.status || "";
        default:
          return "";
      }
    };

    return [...list].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (typeof av === "number" && typeof bv === "number") {
        return sort.direction === "asc" ? av - bv : bv - av;
      }
      return sort.direction === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [list, sort]);

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sort.key !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return sort.direction === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
    );
  };

  const SortHeader = ({ column, label }: { column: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(column)}
      className="inline-flex appearance-none items-center gap-1.5 whitespace-nowrap border-0 bg-transparent p-0 text-left text-xs font-medium uppercase tracking-wider text-gray-500 shadow-none outline-none transition-colors hover:text-gray-800 focus:text-gray-800 focus:ring-0"
    >
      <span>{label}</span>
      <SortIcon column={column} />
    </button>
  );

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "N/A";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "N/A";
    return d.toLocaleDateString("en-GB");
  };

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return "N/A";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "N/A";
    return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  };

  const formatMoney = (value: number | null | undefined, currency = "TZS") =>
    `${Number(value ?? 0).toLocaleString()} ${currency || "TZS"}`;

  const tripLabel = (invoice: InvoiceRow) => invoice.trip?.code || `TRIP-${invoice.trip?.id || invoice.id}`;

  const routeLine = (label: string, address?: string | null, coordinate?: string | null) => {
    const primary = address && address !== "N/A" ? address : coordinate || "N/A";
    return (
      <div className="flex min-w-0 items-start gap-1.5">
        <span className="mt-px flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
        <span className="min-w-0 truncate text-gray-700">{primary}</span>
      </div>
    );
  };

  const showingPendingReview = status === "PENDING" || status === "VERIFIED";

  // Prepare histogram chart data
  const histogramChartData = useMemo<ChartData<"bar">>(() => {
    if (!histogramData || histogramData.stats.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const labels = histogramData.stats.map((s) => {
      const d = new Date(s.date);
      return histogramPeriod === "year" 
        ? d.toLocaleDateString("en-US", { month: "short" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });
    
    return {
      labels,
      datasets: [
        {
          label: "Total Invoices",
          data: histogramData.stats.map((s) => s.count),
          backgroundColor: "rgba(59, 130, 246, 0.6)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 1,
        },
        {
          label: "Disbursed",
          data: histogramData.stats.map((s) => s.paid),
          backgroundColor: "rgba(16, 185, 129, 0.6)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [histogramData, histogramPeriod]);

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Premium Header Banner */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
          boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)",
        }}
      >
        {/* Sparkline SVG */}
        <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none select-none" viewBox="0 0 900 220" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <circle cx="860" cy="-20" r="130" fill="none" stroke="rgba(255,255,255,0.055)" strokeWidth="1.2" />
          <circle cx="860" cy="-20" r="195" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
          <circle cx="40" cy="240" r="110" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          <line x1="0" y1="55" x2="900" y2="55" stroke="rgba(255,255,255,0.045)" strokeWidth="0.8" />
          <line x1="0" y1="110" x2="900" y2="110" stroke="rgba(255,255,255,0.045)" strokeWidth="0.8" />
          <line x1="0" y1="165" x2="900" y2="165" stroke="rgba(255,255,255,0.03)" strokeWidth="0.8" />
          <polyline points="0,170 80,155 160,140 240,145 320,120 400,105 480,118 560,92 640,75 720,88 800,60 900,48" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          <polygon points="0,170 80,155 160,140 240,145 320,120 400,105 480,118 560,92 640,75 720,88 800,60 900,48 900,220 0,220" fill="rgba(255,255,255,0.04)" />
          <polyline points="0,190 100,178 200,168 300,175 400,155 500,142 600,150 700,128 800,115 900,100" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.4" strokeDasharray="5 4" strokeLinejoin="round" />
          <circle cx="320" cy="120" r="4.5" fill="rgba(245,158,11,0.80)" />
          <circle cx="320" cy="120" r="9" fill="rgba(245,158,11,0.15)" />
          <circle cx="560" cy="92" r="4.5" fill="rgba(16,185,129,0.80)" />
          <circle cx="560" cy="92" r="9" fill="rgba(16,185,129,0.15)" />
          <circle cx="800" cy="60" r="4.5" fill="rgba(56,189,248,0.80)" />
          <circle cx="800" cy="60" r="9" fill="rgba(56,189,248,0.15)" />
          <ellipse cx="450" cy="110" rx="260" ry="70" fill="url(#drvInvGlow)" />
          <defs>
            <radialGradient id="drvInvGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(2,102,94,0.18)" />
              <stop offset="100%" stopColor="rgba(2,102,94,0)" />
            </radialGradient>
          </defs>
        </svg>

        <div className="relative z-10 px-6 pt-8 pb-7 sm:px-8 sm:pt-10">
          {/* Icon + title */}
          <div className="flex items-center gap-4 mb-6">
            <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 46, height: 46, background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)" }}>
              <FileText className="h-5 w-5" style={{ color: "rgba(255,255,255,0.92)" }} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight" style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.40)" }}>Driver Payout Invoices</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.58)" }}>Driver-submitted payout requests after trip completion · review, approve &amp; process payments</p>
            </div>
          </div>

          {/* KPI chips — status counts */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2.5">
            {([
              { label: "All",        val: "",           color: "#e2e8f0", bg: "rgba(255,255,255,0.14)",  border: "rgba(255,255,255,0.24)"  },
              { label: "Requested",  val: "PENDING",    color: "#94a3b8", bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.28)" },
              { label: "Verified",   val: "VERIFIED",   color: "#5eead4", bg: "rgba(20,184,166,0.18)",  border: "rgba(20,184,166,0.32)"  },
              { label: "Approved",   val: "APPROVED",   color: "#93c5fd", bg: "rgba(59,130,246,0.18)",  border: "rgba(59,130,246,0.32)"  },
              { label: "Disbursed",  val: "PAID",       color: "#6ee7b7", bg: "rgba(16,185,129,0.18)",  border: "rgba(16,185,129,0.32)"  },
            ] as const).map((chip) => {
              const count = list.filter((r) => chip.val === "" || r.status === chip.val).length;
              return (
                <button
                  key={chip.val}
                  type="button"
                  onClick={() => { setStatus(chip.val); setPage(1); }}
                  className="rounded-xl px-3 py-2.5 text-left transition-all duration-200"
                  style={{
                    background: status === chip.val ? chip.bg.replace(/0\.1[0-9]/, "0.30") : chip.bg,
                    border: `1px solid ${status === chip.val ? chip.border.replace(/0\.2[0-9]/, "0.55") : chip.border}`,
                    backdropFilter: "blur(8px)",
                    outline: status === chip.val ? `1.5px solid ${chip.color}44` : "none",
                    outlineOffset: "2px",
                  }}
                >
                  <div className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.50)" }}>{chip.label}</div>
                  <div className="text-lg font-black tabular-nums" style={{ color: chip.color }}>{loading ? "—" : count}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="rounded-xl overflow-hidden" style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
        <div className="px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-5">
          <div className="flex flex-col gap-4 w-full box-border">

            {/* Search + Date row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
              <div className="relative w-full sm:flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none z-10" style={{ color: 'rgba(255,255,255,0.38)' }} />
                <input
                  ref={searchRef}
                  type="text"
                  className="w-full box-border pl-10 pr-10 py-2.5 rounded-lg outline-none text-sm transition-all"
                  placeholder="Search invoices or trip code..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setPage(1);
                      if (isTripCodeLike(q)) { void lookupTripCode(q); }
                      load();
                    }
                  }}
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.90)', width: '100%', maxWidth: '100%' }}
                />
                {q && (
                  <button type="button" onClick={() => { setQ(""); setPage(1); load(); }} className="absolute right-3 top-1/2 -translate-y-1/2 z-10" aria-label="Clear search" style={{ color: 'rgba(255,255,255,0.40)' }}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Date Picker */}
              <div className="relative w-full sm:w-auto sm:flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { setPickerAnim(true); setTimeout(() => setPickerAnim(false), 350); setPickerOpen((v) => !v); }}
                  className="w-full box-border px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all"
                  style={pickerAnim ? { background: 'rgba(2,102,94,0.30)', border: '1.5px solid rgba(2,102,94,0.65)', color: '#5eead4' } : { background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.75)' }}
                >
                  <Calendar className="h-4 w-4" />
                  <span>Date</span>
                </button>
                {pickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                    <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                      <DatePicker selected={date || undefined} onSelectAction={(s) => { setDate(s as string | string[]); setPage(1); }} onCloseAction={() => setPickerOpen(false)} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Status filter pills — dark tinted */}
            <div className="flex gap-2 items-center flex-wrap">
              {([
                { label: "All",        value: "",           activeBg: "rgba(255,255,255,0.18)",  activeBorder: "rgba(255,255,255,0.38)",  activeColor: "#ffffff",  inBg: "rgba(255,255,255,0.06)",  inBorder: "rgba(255,255,255,0.12)" },
                { label: "Requested",  value: "PENDING",    activeBg: "rgba(148,163,184,0.25)",  activeBorder: "rgba(148,163,184,0.55)",  activeColor: "#e2e8f0",  inBg: "rgba(148,163,184,0.07)",  inBorder: "rgba(148,163,184,0.18)" },
                { label: "Verified",   value: "VERIFIED",   activeBg: "rgba(20,184,166,0.25)",   activeBorder: "rgba(20,184,166,0.55)",   activeColor: "#5eead4",  inBg: "rgba(20,184,166,0.08)",   inBorder: "rgba(20,184,166,0.20)"  },
                { label: "Approved",   value: "APPROVED",   activeBg: "rgba(59,130,246,0.25)",   activeBorder: "rgba(59,130,246,0.55)",   activeColor: "#93c5fd",  inBg: "rgba(59,130,246,0.08)",   inBorder: "rgba(59,130,246,0.20)"  },
                { label: "Disbursed",  value: "PAID",       activeBg: "rgba(16,185,129,0.25)",   activeBorder: "rgba(16,185,129,0.55)",   activeColor: "#6ee7b7",  inBg: "rgba(16,185,129,0.08)",   inBorder: "rgba(16,185,129,0.20)"  },
              ] as const).map((s) => {
                const isActive = status === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => { setStatus(s.value); setPage(1); }}
                    className="px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap flex-shrink-0"
                    style={isActive ? { background: s.activeBg, border: `1.5px solid ${s.activeBorder}`, color: s.activeColor } : { background: s.inBg, border: `1.5px solid ${s.inBorder}`, color: 'rgba(255,255,255,0.60)' }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>

          </div>
        </div>
      </div>

          {/* Trip Code Lookup (inline; no new page/mode) */}
          {isTripCodeLike(q) && (
            <div className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-300 hover:-translate-y-0.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-800 tracking-wide">Trip code detected</div>
                  <div className="text-xs text-gray-500 truncate">Use lookup to verify trip authenticity for reconciliation.</div>
                </div>

                <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void lookupTripCode(q)}
                  disabled={tripLookupLoading}
                  className="px-3 py-1.5 rounded-xl border text-sm font-medium whitespace-nowrap bg-white border-gray-300 text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {tripLookupLoading ? "Looking up..." : "Lookup"}
                </button>
                {(tripLookupResult || tripLookupError) && (
                  <button
                    type="button"
                    onClick={() => {
                      setTripLookupResult(null);
                      setTripLookupError(null);
                    }}
                    className="px-3 py-1.5 rounded-xl border text-sm font-medium whitespace-nowrap bg-white border-gray-300 text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-50 hover:-translate-y-0.5 active:translate-y-0"
                  >
                    Clear
                  </button>
                )}
                </div>
              </div>
            </div>
          )}

          {(tripLookupResult || tripLookupError) && (
            <div className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition-all duration-300 hover:shadow-md hover:border-gray-300">
              {tripLookupResult ? (
                <div className="flex flex-col gap-1">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate font-mono">
                        {tripLookupResult.tripCode || q}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        Trip #{tripLookupResult.id} • {new Date(tripLookupResult.scheduledAt).toLocaleString()} • {Number(tripLookupResult.amount ?? 0).toLocaleString()} {tripLookupResult.currency || "TZS"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${badgeClasses(String(tripLookupResult.paymentStatus ?? ""))}`}>
                        {tripLookupResult.paymentStatus || "N/A"}
                      </span>
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${badgeClasses(String(tripLookupResult.status ?? ""))}`}>
                        {tripLookupResult.status || "N/A"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 gap-1.5">
                    <div className="text-xs text-gray-600">
                      <span className="font-medium text-gray-700">Pickup:</span> {tripLookupResult.pickup || "N/A"}
                    </div>
                    <div className="text-xs text-gray-600">
                      <span className="font-medium text-gray-700">Dropoff:</span> {tripLookupResult.dropoff || "N/A"}
                    </div>
                    <div className="text-xs text-gray-600">
                      <span className="font-medium text-gray-700">Driver:</span> {tripLookupResult.driver?.name || "Unassigned"}
                      {tripLookupResult.driver?.phone ? ` • ${tripLookupResult.driver.phone}` : ""}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-red-600">{tripLookupError}</div>
              )}
            </div>
          )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
            <p className="mt-3 text-sm text-gray-500">Loading invoices...</p>
          </div>
        ) : list.length === 0 ? (
          <>
            <div className="px-6 py-12 text-center">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No invoices found.</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
            </div>
            
            {/* Invoice Statistics Histogram */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-blue-600 transition-colors duration-300">
                    <BarChart3 className="h-5 w-5 text-blue-600 group-hover:scale-110 transition-transform duration-300" />
                    Invoice Statistics
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Visualize invoice data over time</p>
                </div>
                
                {/* Period Filter */}
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: "7 Days", value: "7d" },
                    { label: "30 Days", value: "30d" },
                    { label: "This Month", value: "month" },
                    { label: "This Year", value: "year" },
                  ].map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setHistogramPeriod(p.value)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                    histogramPeriod === p.value
                      ? "bg-blue-50 border-blue-300 text-blue-700 scale-105 shadow-md"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:scale-105 hover:shadow-sm"
                  }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {histogramLoading ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
                </div>
              ) : histogramData && histogramData.stats.length > 0 ? (
                <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
                  <Chart
                    type="bar"
                    data={histogramChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          display: true,
                          position: "top",
                          labels: {
                            padding: 15,
                            font: {
                              size: 12,
                            },
                            usePointStyle: true,
                          },
                        },
                        tooltip: {
                          callbacks: {
                            label: (context: any) => {
                              const label = context.dataset.label || "";
                              const value = context.parsed.y || 0;
                              const index = context.dataIndex;
                              const amount = histogramData.stats[index]?.amount || 0;
                              if (label === "Total Invoices") {
                                return `${label}: ${value} invoices (${amount.toLocaleString()} TZS)`;
                              }
                              return `${label}: ${value} invoices`;
                            },
                          },
                        },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            stepSize: 1,
                            font: {
                              size: 11,
                            },
                          },
                          grid: {
                            color: "rgba(0, 0, 0, 0.1)",
                          },
                          title: {
                            display: true,
                            text: "Number of Invoices",
                            font: {
                              size: 12,
                            },
                          },
                        },
                        x: {
                          grid: {
                            display: false,
                          },
                          ticks: {
                            font: {
                              size: 11,
                            },
                            maxRotation: 45,
                            minRotation: 45,
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="h-64 w-full flex flex-col justify-end p-4">
                  {/* Skeleton Histogram */}
                  <div className="relative h-full w-full">
                    {/* Y-axis skeleton */}
                    <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between">
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                      <div className="h-4 bg-gray-200 rounded animate-pulse"></div>
                    </div>

                    {/* Chart area skeleton */}
                    <div className="ml-10 h-full relative">
                      {/* Grid lines */}
                      <div className="absolute inset-0 flex flex-col justify-between">
                        {[...Array(5)].map((_, i) => (
                          <div key={i} className="h-px bg-gray-200"></div>
                        ))}
                      </div>

                      {/* Skeleton bars */}
                      <div className="absolute bottom-0 left-0 right-0 h-full flex items-end justify-between gap-2 px-2">
                        {[...Array(7)].map((_, i) => {
                          const height = Math.random() * 60 + 20; // Random height between 20% and 80%
                          return (
                            <div
                              key={i}
                              className="flex-1 flex flex-col items-center justify-end gap-1"
                            >
                              <div
                                className="w-full bg-gray-200 rounded-t animate-pulse"
                                style={{ height: `${height}%` }}
                              ></div>
                              <div className="h-3 w-12 bg-gray-200 rounded animate-pulse"></div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  {showingPendingReview ? (
                    <tr>
                      <th className="px-6 py-3 text-left"><SortHeader column="trip" label="Trip ID" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="invoiceNumber" label="Invoice No" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="driver" label="Driver Name" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="route" label="Route" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="amount" label="Amount" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="commissionPercent" label="NoLSAF %" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="gross" label="Trip Rate" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="requestedAt" label="Requested At" /></th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-6 py-3 text-left"><SortHeader column="invoiceNumber" label="Invoice #" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="trip" label="Trip" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="driver" label="Driver" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="amount" label="Amount" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="issuedAt" label="Issued At" /></th>
                      <th className="px-6 py-3 text-left"><SortHeader column="status" label="Status" /></th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    </tr>
                  )}
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedList.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
                      {showingPendingReview ? (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 min-w-[220px]">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-sky-100 bg-sky-50 text-sky-700">
                                <Route className="h-4 w-4" />
                              </span>
                              <span
                                title={tripLabel(invoice)}
                                className="inline-block max-w-[165px] truncate rounded-md bg-slate-50 px-2.5 py-1 font-mono text-xs font-semibold tracking-tight text-slate-800 ring-1 ring-slate-200"
                              >
                                {tripLabel(invoice)}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{invoice.invoiceNumber || `DP-${invoice.id}`}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="font-medium">{invoice.driver?.name || "Unassigned"}</div>
                            <div className="text-xs text-gray-500">{invoice.driver?.email || "No driver email"}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 min-w-[280px] max-w-[360px]">
                            <div className="space-y-1">
                              {routeLine("PU", invoice.trip?.pickup, invoice.trip?.pickupCoordinate)}
                              {routeLine("DO", invoice.trip?.dropoff, invoice.trip?.dropoffCoordinate)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-emerald-700">{formatMoney(invoice.amount, invoice.currency)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span className="inline-flex items-center gap-1">
                              <Percent className="h-3.5 w-3.5 text-gray-400" />
                              {Number(invoice.commissionPercent ?? 0).toLocaleString()}%
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatMoney(invoice.gross, invoice.currency)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatDateTime(invoice.requestedAt)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <Link
                              href={`/admin/drivers/invoices/review?id=${invoice.id}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-400"
                              aria-label={`Open ${invoice.invoiceNumber || `DP-${invoice.id}`}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{invoice.invoiceNumber || `DP-${invoice.id}`}</td>
                          <td className="px-6 py-4 text-sm text-gray-900 min-w-[180px]">
                            <div className="font-mono text-xs font-semibold text-gray-900">{tripLabel(invoice)}</div>
                            <div className="text-xs text-gray-500">{invoice.trip?.vehicleType || "Transport trip"}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="font-medium">{invoice.driver?.name || "Unassigned"}</div>
                            <div className="text-xs text-gray-500">{invoice.driver?.email || "No driver email"}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-gray-400 flex-shrink-0" />
                              <span>{formatMoney(invoice.amount, invoice.currency)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />
                              <span>{formatDate(invoice.issuedAt)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${badgeClasses(invoice.status)}`}>
                              {payoutStatusLabel(invoice.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <Link
                              href={`/admin/drivers/invoices/review?id=${invoice.id}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-400"
                              aria-label={`Open ${invoice.invoiceNumber || `DP-${invoice.id}`}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-2 p-4">
              {sortedList.map((invoice) => (
                <div key={invoice.id} className="border rounded-lg p-3 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{invoice.invoiceNumber || `INV-${invoice.id}`}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {tripLabel(invoice)} / {invoice.driver?.name || "Unassigned"}
                      </div>
                      {showingPendingReview && (
                        <div className="mt-2 text-xs text-gray-500">
                          <div>PU: {invoice.trip?.pickup && invoice.trip.pickup !== "N/A" ? invoice.trip.pickup : invoice.trip?.pickupCoordinate || "N/A"}</div>
                          <div>DO: {invoice.trip?.dropoff && invoice.trip.dropoff !== "N/A" ? invoice.trip.dropoff : invoice.trip?.dropoffCoordinate || "N/A"}</div>
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-1">
                        {showingPendingReview ? formatDateTime(invoice.requestedAt) : formatDate(invoice.issuedAt)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${badgeClasses(invoice.status)}`}>
                        {payoutStatusLabel(invoice.status)}
                      </span>
                      <div className="text-sm font-semibold text-gray-900 mt-1">
                        {formatMoney(invoice.amount, invoice.currency)}
                      </div>
                      {showingPendingReview && (
                        <div className="mt-1 text-xs text-gray-500">
                          {Number(invoice.commissionPercent ?? 0).toLocaleString()}% / {formatMoney(invoice.gross, invoice.currency)}
                        </div>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/admin/drivers/invoices/review?id=${invoice.id}`}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 active:scale-[0.99]"
                    aria-label={`Open ${invoice.invoiceNumber || `DP-${invoice.id}`}`}
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-sm text-gray-500 text-center sm:text-left">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} invoices
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pages, p + 1))}
                    disabled={page === pages}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  );
}


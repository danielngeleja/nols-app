"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Search, X, Eye, Download, ArrowUpDown, ArrowUp, ArrowDown, User, Mail, Phone, Calendar, FileText, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import { io, Socket } from "socket.io-client";
import TableRow from "@/components/TableRow";
import Link from "next/link";

// Use same-origin calls (Next rewrites proxy to API in dev). Use secure cookie session.
const api = apiClient;

type Row = {
  id:number; name:string|null; email:string; phone:string|null;
  createdAt:string; suspendedAt:string|null; kycStatus:string;
  _count: { properties:number };
};

export default function AdminOwnersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({
    "": 0,
    ACTIVE: 0,
    SUSPENDED: 0,
    PENDING_KYC: 0,
    APPROVED_KYC: 0,
    REJECTED_KYC: 0,
  });

  // Sorting
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  
  // Advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [dateFromPicker, setDateFromPicker] = useState<string | string[]>("");
  const [dateToPicker, setDateToPicker] = useState<string | string[]>("");
  const [pickerFromOpen, setPickerFromOpen] = useState(false);
  const [pickerToOpen, setPickerToOpen] = useState(false);
  const [pickerFromAnim, setPickerFromAnim] = useState(false);
  const [pickerToAnim, setPickerToAnim] = useState(false);
  const [propertiesMin, setPropertiesMin] = useState<string>("");
  const [propertiesMax, setPropertiesMax] = useState<string>("");
  
  // Sync date picker selections with dateFrom/dateTo
  useEffect(() => {
    if (!dateFromPicker) {
      setDateFrom("");
    } else if (Array.isArray(dateFromPicker)) {
      setDateFrom(dateFromPicker[0] || "");
    } else {
      setDateFrom(dateFromPicker as string);
    }
  }, [dateFromPicker]);
  
  useEffect(() => {
    if (!dateToPicker) {
      setDateTo("");
    } else if (Array.isArray(dateToPicker)) {
      setDateTo(dateToPicker[0] || "");
    } else {
      setDateTo(dateToPicker as string);
    }
  }, [dateToPicker]);

  const [suggestions, setSuggestions] = useState<Row[]>([]);
  const itemsCount = items?.length ?? 0;

  type OwnersResponse = {
    items: Row[];
    total: number;
    page: number;
    pageSize: number;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { q, status, page, pageSize };
      if (sortBy) {
        params.sortBy = sortBy;
        params.sortDir = sortDir;
      }
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      if (propertiesMin) params.propertiesMin = propertiesMin;
      if (propertiesMax) params.propertiesMax = propertiesMax;
      const r = await api.get<OwnersResponse>("/api/admin/owners", { params });
      let sortedItems = r.data.items ?? [];
      
      // Client-side sorting if API doesn't support it
      if (sortBy && sortedItems.length > 0) {
        sortedItems = [...sortedItems].sort((a, b) => {
          let aVal: any, bVal: any;
          switch (sortBy) {
            case "name":
              aVal = (a.name || a.email || "").toLowerCase();
              bVal = (b.name || b.email || "").toLowerCase();
              break;
            case "createdAt":
              aVal = new Date(a.createdAt).getTime();
              bVal = new Date(b.createdAt).getTime();
              break;
            case "properties":
              aVal = a._count.properties;
              bVal = b._count.properties;
              break;
            default:
              return 0;
          }
          if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
          if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
          return 0;
        });
      }
      
      setItems(sortedItems);
      setTotal(r.data.total ?? 0);
    } catch (err: any) {
      // network or server errors shouldn't break the page — log and show empty list
      // eslint-disable-next-line no-console
      console.error('Failed to load owners list', err);
      console.error('Error details:', {
        message: err?.message,
        response: err?.response?.data,
        status: err?.response?.status,
        url: err?.config?.url,
      });
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, status, page, sortBy, sortDir, dateFrom, dateTo, propertiesMin, propertiesMax]);
  
  // Sort handler
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  };

  useEffect(() => { void load(); }, [load]);

  // optional counts fetch; keep zeros if endpoint missing
  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<Record<string, number>>('/api/admin/owners/counts', {
          validateStatus: (status) => status < 500 // Don't throw on 4xx errors
        });
        
        // Check if response is actually JSON
        const contentType = String(r.headers['content-type'] ?? '');
        if (contentType && contentType.includes('application/json') && r?.data && typeof r.data === 'object') {
          setCounts((p) => ({ ...p, ...r.data }));
        }
      } catch (e: any) {
        // Silently ignore - counts are optional
        // Only log if it's not a 401/403 (auth errors are expected if not logged in)
        if (e?.response?.status !== 401 && e?.response?.status !== 403) {
          console.warn('Failed to fetch owner counts:', e?.message || e);
        }
      }
    })();
  }, []);

  const handleSearch = useCallback(async () => {
    try {
      await load();
    } catch (e) {
      // swallow network errors for UX
    }
    // analytics/logging (fire-and-forget)
    try {
      console.log("[analytics] owners search", { query: q, ts: new Date().toISOString() });
      api.post("/admin/analytics/search", { query: q, timestamp: new Date().toISOString() }).catch(() => {});
    } catch (e) { /* swallow */ }
  }, [load, q]);

  // Debounce automatic search when typing (suggestions)
  useEffect(() => {
    const term = q;
    if (!term || term.trim() === "") {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      (async () => {
        try {
          const r = await api.get<{ items: Row[] }>("/api/admin/owners", {
            params: { status, q: term, page: 1, pageSize: 5 },
          });
          setSuggestions(r.data.items ?? []);
        } catch (e) {
          setSuggestions([]);
        }
        // also perform the full search to update the main list
        handleSearch().catch(() => {});
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [q, status, handleSearch]);

  // live refresh when KYC/suspend changes
  useEffect(()=>{
    // Use direct API URL for Socket.IO in browser to ensure WebSocket works in dev
    const url = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
      : (process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "");
    // Socket auth is optional; API auth is cookie-based for HTTP calls.
    const s: Socket = io(url, { transports: ['websocket'] });
    s.on("admin:owner:updated", load);
    s.on("admin:kyc:updated", load);
    return ()=>{ s.off("admin:owner:updated", load); s.off("admin:kyc:updated", load); s.disconnect(); };
  },[load]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 min-w-0">
      {/* Header */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-xl"
        style={{ background: "linear-gradient(135deg, #01312e 0%, #02504a 40%, #02665e 70%, #014d47 100%)" }}
      >
        {/* ── Decorative background graph ── */}
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 800 220"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Horizontal grid lines */}
          {[44, 88, 132, 176].map((y) => (
            <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
          ))}
          {/* Bar chart silhouette */}
          {[
            { x: 30,  h: 90  },
            { x: 80,  h: 130 },
            { x: 130, h: 75  },
            { x: 180, h: 155 },
            { x: 230, h: 110 },
            { x: 280, h: 170 },
            { x: 330, h: 95  },
            { x: 380, h: 145 },
            { x: 430, h: 60  },
            { x: 480, h: 180 },
            { x: 530, h: 125 },
            { x: 580, h: 100 },
            { x: 630, h: 160 },
            { x: 680, h: 115 },
            { x: 730, h: 85  },
            { x: 780, h: 140 },
          ].map(({ x, h }) => (
            <rect key={x} x={x} y={220 - h} width="32" height={h} rx="4" fill="rgba(255,255,255,0.055)" />
          ))}
          {/* Trend line overlay */}
          <polyline
            points="46,140 96,105 146,155 196,70 246,115 296,55 346,125 396,80 446,170 496,45 546,100 596,120 646,65 696,110 746,145 796,88"
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Glow dots on trend line */}
          {[
            [296, 55], [496, 45], [196, 70], [646, 65],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" fill="rgba(255,255,255,0.18)" />
          ))}
          {/* Radial glow behind icon area */}
          <radialGradient id="ownerHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(2,102,94,0.6)" />
            <stop offset="100%" stopColor="rgba(2,102,94,0)" />
          </radialGradient>
          <ellipse cx="400" cy="110" rx="260" ry="130" fill="url(#ownerHeaderGlow)" />
        </svg>

        {/* ── Content ── */}
        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 sm:py-14">
          {/* Icon orb */}
          <div
            className="mb-5 inline-flex items-center justify-center rounded-full"
            style={{
              width: 64, height: 64,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Building2 className="h-7 w-7" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>

          {/* Title */}
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            Owners
          </h1>

          {/* Subtitle */}
          <p className="mt-2 text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.58)" }}>
            Manage platform owners and KYC status
          </p>

          {/* KPI chips */}
          <div className="mt-5 flex items-center gap-3 flex-wrap justify-center">
            {[
              { label: "Total", value: counts[""] || 0, color: "rgba(255,255,255,0.15)" },
              { label: "Active", value: counts["ACTIVE"] || 0, color: "rgba(16,185,129,0.22)" },
              { label: "Pending KYC", value: counts["PENDING_KYC"] || 0, color: "rgba(245,158,11,0.22)" },
              { label: "Approved KYC", value: counts["APPROVED_KYC"] || 0, color: "rgba(59,130,246,0.22)" },
              { label: "Suspended", value: counts["SUSPENDED"] || 0, color: "rgba(239,68,68,0.20)" },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="flex flex-col items-center rounded-xl px-4 py-2"
                style={{ background: color, border: "1px solid rgba(255,255,255,0.10)" }}
              >
                <span className="text-lg font-bold leading-none" style={{ color: "#fff" }}>{value}</span>
                <span className="text-[10px] mt-0.5 font-medium uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.55)" }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Export button */}
          <div className="mt-6">
            <button
              className="inline-flex items-center gap-2 rounded-xl font-semibold text-sm transition-all duration-200"
              style={{
                padding: "10px 22px",
                background: "rgba(255,255,255,0.12)",
                border: "1.5px solid rgba(255,255,255,0.22)",
                color: "rgba(255,255,255,0.92)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.20)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.38)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.22)";
              }}
              onClick={async () => {
                try {
                  const params = new URLSearchParams();
                  if (status) params.set("status", status);
                  if (q) params.set("q", q);
                  if (dateFrom) params.set("from", dateFrom);
                  if (dateTo) params.set("to", dateTo);
                  if (propertiesMin) params.set("propertiesMin", propertiesMin);
                  if (propertiesMax) params.set("propertiesMax", propertiesMax);

                  const response = await fetch(`/api/admin/owners/export.csv?${params.toString()}`, {
                    credentials: "include",
                  });

                  if (!response.ok) {
                    throw new Error("Export failed");
                  }

                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `owners_export_${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (err) {
                  console.error("Failed to export owners:", err);
                  alert("Failed to export owners. Please try again.");
                }
              }}
            >
              <Download className="h-4 w-4 flex-shrink-0" />
              <span>Export owners</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 lg:p-6 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 sm:gap-4">
          {/* Search Box */}
          <div className="w-full min-w-0 max-w-full">
            <div className="relative w-full min-w-0 max-w-full">
              <input
                type="text"
                className="w-full min-w-0 max-w-full pl-9 sm:pl-10 pr-10 py-2 sm:py-2.5 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] outline-none text-xs sm:text-sm transition-all box-border"
                placeholder="Search name, email, or phone"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); setPage(1); load(); }
                }}
                aria-label="Search owners"
              />
              <Search className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-gray-400 flex-shrink-0 pointer-events-none" />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    setPage(1);
                    load();
                  }}
                  className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-100 rounded"
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Suggestions dropdown */}
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-2 z-10">
                <div className="bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setQ(s.name ?? s.email);
                        setSuggestions([]);
                        setPage(1);
                        handleSearch().catch(() => {});
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm transition-colors"
                    >
                      <div className="font-medium">{s.name ?? s.email}</div>
                      <div className="text-xs text-gray-500">{s.email}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Status Filters */}
          <div className="flex items-center justify-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
              {[
                { label: "All", value: "" },
                { label: "Active", value: "ACTIVE" },
                { label: "Pending KYC", value: "PENDING_KYC" },
                { label: "Approved KYC", value: "APPROVED_KYC" },
                { label: "Rejected KYC", value: "REJECTED_KYC" },
                { label: "Suspended", value: "SUSPENDED" },
            ].map((s) => {
              const isActive = status === s.value || (s.value === "" && status === "");
              const colorMap: Record<string, { active: string; inactive: string; badge: string }> = {
                '': { active: 'bg-gray-100 border-gray-300 text-gray-800', inactive: 'bg-white hover:bg-gray-50', badge: 'bg-gray-100 text-gray-800' },
                ACTIVE: { active: 'bg-emerald-50 border-emerald-300 text-emerald-700', inactive: 'bg-white hover:bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800' },
                PENDING_KYC: { active: 'bg-amber-50 border-amber-300 text-amber-700', inactive: 'bg-white hover:bg-amber-50', badge: 'bg-amber-100 text-amber-800' },
                APPROVED_KYC: { active: 'bg-emerald-50 border-emerald-300 text-emerald-700', inactive: 'bg-white hover:bg-emerald-50', badge: 'bg-emerald-100 text-emerald-800' },
                REJECTED_KYC: { active: 'bg-red-50 border-red-300 text-red-700', inactive: 'bg-white hover:bg-red-50', badge: 'bg-red-100 text-red-800' },
                SUSPENDED: { active: 'bg-indigo-50 border-indigo-300 text-indigo-700', inactive: 'bg-white hover:bg-indigo-50', badge: 'bg-indigo-100 text-indigo-800' },
              } as const;

              const colors = colorMap[s.value as keyof typeof colorMap] ?? colorMap[''];
              const btnClass = `px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full border text-xs flex items-center gap-1 sm:gap-1.5 transition-all duration-200 flex-shrink-0 whitespace-nowrap ${isActive ? colors.active : colors.inactive}`;
              const badgeClass = `text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full ${colors.badge} flex-shrink-0`;

              return (
                <button
                  key={s.value || "all"}
                  type="button"
                  onClick={() => { setStatus(s.value); setPage(1); }}
                  className={btnClass}
                >
                  <span className="whitespace-nowrap">{s.label}</span>
                  <span className={badgeClass}>{counts[s.value ?? ''] ?? 0}</span>
                </button>
              );
            })}

            {/* Advanced Filters Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full border text-xs flex items-center gap-1.5 justify-center text-gray-700 bg-white transition-all flex-shrink-0 whitespace-nowrap ${
                showAdvancedFilters ? 'bg-[#02665e]/10 border-[#02665e] text-[#02665e]' : 'hover:bg-gray-50'
              }`}
            >
              <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Advanced Filters</span>
            </button>
            </div>

          {/* Advanced Filters Panel */}
          {showAdvancedFilters && (
            <div className="border-t border-gray-200 pt-3 sm:pt-4 space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Advanced Filters</h3>
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                    setDateFromPicker("");
                    setDateToPicker("");
                    setPropertiesMin("");
                    setPropertiesMax("");
                    setShowAdvancedFilters(false);
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors duration-200"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* Date From */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Joined From</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerFromAnim(true);
                        window.setTimeout(() => setPickerFromAnim(false), 350);
                        setPickerFromOpen((v) => !v);
                      }}
                      className={`w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-left text-xs sm:text-sm transition-all flex items-center justify-between bg-white ${
                        pickerFromAnim ? 'ring-2 ring-blue-100' : 'hover:bg-gray-50 focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e]'
                      }`}
                    >
                      <span className={dateFrom ? "text-gray-900" : "text-gray-400"}>
                        {dateFrom ? new Date(dateFrom).toLocaleDateString() : "Select date"}
                      </span>
                      <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    </button>
                    {pickerFromOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPickerFromOpen(false)} />
                        <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                          <DatePicker
                            selected={dateFromPicker || undefined}
                            onSelectAction={(s) => {
                              setDateFromPicker(s as string | string[]);
                            }}
                            onCloseAction={() => setPickerFromOpen(false)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Date To */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Joined To</label>
                  <div className="relative">
                <button
                  type="button"
                      onClick={() => {
                        setPickerToAnim(true);
                        window.setTimeout(() => setPickerToAnim(false), 350);
                        setPickerToOpen((v) => !v);
                      }}
                      className={`w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-left text-xs sm:text-sm transition-all flex items-center justify-between bg-white ${
                        pickerToAnim ? 'ring-2 ring-blue-100' : 'hover:bg-gray-50 focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e]'
                      }`}
                    >
                      <span className={dateTo ? "text-gray-900" : "text-gray-400"}>
                        {dateTo ? new Date(dateTo).toLocaleDateString() : "Select date"}
                      </span>
                      <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </button>
                    {pickerToOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPickerToOpen(false)} />
                        <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                          <DatePicker
                            selected={dateToPicker || undefined}
                            onSelectAction={(s) => {
                              setDateToPicker(s as string | string[]);
                            }}
                            onCloseAction={() => setPickerToOpen(false)}
                          />
                        </div>
              </>
            )}
          </div>
                </div>

                {/* Properties Min */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Min Properties</label>
                  <input
                    type="number"
                    value={propertiesMin}
                    onChange={(e) => setPropertiesMin(e.target.value)}
                    placeholder="0"
                    min="0"
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] outline-none text-xs sm:text-sm transition-all box-border"
                  />
                </div>

                {/* Properties Max */}
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Max Properties</label>
                  <input
                    type="number"
                    value={propertiesMax}
                    onChange={(e) => setPropertiesMax(e.target.value)}
                    placeholder="No limit"
                    min="0"
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] outline-none text-xs sm:text-sm transition-all box-border"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Card Layout */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 shadow-sm">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-emerald-600"></div>
          </div>
        </div>
      ) : itemsCount === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 shadow-sm text-center">
          <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No owners found.</p>
          <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
        </div>
      ) : (
        <>
          {/* Mobile Cards - Hidden on md and up */}
          <div className="md:hidden space-y-3">
            {items.map((o) => (
              <div
                key={o.id}
                className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <div className="text-sm font-semibold text-gray-900 truncate">
                        {o.name ?? o.email}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 ml-6">{o.email}</div>
                  </div>
                  <Link
                    href={`/admin/owners/${o.id}`}
                    className="p-2 rounded-lg text-[#02665e] hover:bg-[#02665e]/10 transition-all flex-shrink-0"
                    title="View owner details"
                  >
                    <Eye className="h-5 w-5" />
                  </Link>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-900 truncate">{o.email}</span>
                  </div>
                  {o.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="text-gray-700">{o.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-900">{o._count.properties} propert{o._count.properties !== 1 ? 'ies' : 'y'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <span className="text-gray-700">
                      {new Date(o.createdAt).toLocaleDateString()} at {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                    <div>
                      <div className="text-xs text-gray-500">KYC Status</div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${badge(o.kycStatus)}`}>
                        {kycLabel(o.kycStatus)}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Account Status</div>
                      {o.suspendedAt ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 mt-1">
                          Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 mt-1">
                          Active
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table - Hidden on mobile */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                    <th 
                      className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort("name")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Owner</span>
                        {sortBy === "name" ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Contact
                    </th>
                    <th 
                      className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort("properties")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Properties</span>
                        {sortBy === "properties" ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      KYC
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th 
                      className="px-3 sm:px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => handleSort("createdAt")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Joined</span>
                        {sortBy === "createdAt" ? (
                          sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <th className="px-3 sm:px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((o) => (
                  <TableRow key={o.id}>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">{o.name ?? o.email}</div>
                            {o.name && (
                              <div className="text-xs text-gray-500 truncate">{o.email}</div>
                            )}
                          </div>
                      </div>
                    </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{o.email}</div>
                      <div className="text-sm text-gray-500">{o.phone ?? "-"}</div>
                    </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">{o._count.properties}</span>
                        </div>
                    </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge(o.kycStatus)}`} aria-label={`KYC: ${kycLabel(o.kycStatus)}`}>
                        {kycLabel(o.kycStatus)}
                      </span>
                    </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                      {o.suspendedAt ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                          Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active
                        </span>
                      )}
                    </td>
                      <td className="px-3 sm:px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {new Date(o.createdAt).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </div>
                        <div className="text-xs text-gray-500">
                          {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                    </td>
                    <td className="px-3 sm:px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                      <Link 
                        href={`/admin/owners/${o.id}`}
                        className="inline-flex items-center justify-center w-9 h-9 text-[#02665e] border border-[#02665e] rounded-lg hover:bg-[#02665e] hover:text-white transition-all duration-200"
                        title="View owner details"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </td>
                  </TableRow>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {/* Pagination */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Showing <span className="font-semibold text-gray-900">{(page - 1) * pageSize + 1}</span> to{" "}
              <span className="font-semibold text-gray-900">{Math.min(page * pageSize, total)}</span> of{" "}
              <span className="font-semibold text-gray-900">{total}</span> owners
        </div>
        <div className="flex items-center gap-2">
          <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="p-2 border border-gray-300 rounded-lg hover:border-[#02665e] hover:text-[#02665e] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            aria-label="Previous page"
          >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: pages }, (_, i) => i + 1).map((pageNum) => {
                  const totalPages = pages;
                  const showEllipsisBefore = page > 3 && pageNum === 2;
                  const showEllipsisAfter = page < totalPages - 2 && pageNum === totalPages - 1;

                  if (totalPages <= 5 || pageNum === 1 || pageNum === totalPages || (pageNum >= page - 1 && pageNum <= page + 1)) {
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum)}
                        disabled={loading}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          page === pageNum
                            ? "bg-[#02665e] text-white"
                            : "bg-white text-gray-700 hover:bg-gray-50 border border-gray-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {pageNum}
          </button>
                    );
                  } else if (showEllipsisBefore || showEllipsisAfter) {
                    return <span key={pageNum} className="px-2 text-gray-400">...</span>;
                  }
                  return null;
                })}
          </div>
          <button 
                onClick={() => setPage(p => Math.min(Math.ceil(total / pageSize), p + 1))}
                disabled={page >= Math.ceil(total / pageSize) || loading}
                className="p-2 border border-gray-300 rounded-lg hover:border-[#02665e] hover:text-[#02665e] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            aria-label="Next page"
          >
                <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
        </div>
    </div>
  );
}

function badge(status:string){
  // Use similar semantic colors as the status buttons (slightly stronger bg)
  if (status === "APPROVED_KYC") return "bg-emerald-50 border border-emerald-200 text-emerald-700";
  if (status === "REJECTED_KYC") return "bg-red-50 border border-red-200 text-red-700";
  if (status === "PENDING_KYC") return "bg-amber-50 border border-amber-200 text-amber-800";
  return "bg-gray-50 border border-gray-200 text-gray-700";
}

function kycLabel(status: string) {
  switch (status) {
    case "APPROVED_KYC":
      return "Approved";
    case "REJECTED_KYC":
      return "Rejected";
    case "PENDING_KYC":
      return "Pending";
    default:
      // fallback: prettify unknown codes
      return status ? status.replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase()) : "Unknown";
  }
}

// apps/api/src/routes/admin.owners.ts

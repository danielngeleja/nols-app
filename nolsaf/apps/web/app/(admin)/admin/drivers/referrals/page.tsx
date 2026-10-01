"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { UserPlus, Truck, Search, ExternalLink, X, MapPin, Eye, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { useAdminQueryId } from "@/lib/adminRecordRefs";
import TableRow from "@/components/TableRow";
import { useSearchParams } from "next/navigation";

const api = apiClient;

function authify() {}

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

// Validate driver ID
function isValidDriverId(id: number | null): boolean {
  return id !== null && Number.isInteger(id) && id > 0;
}

type Driver = {
  id: number;
  name: string;
  email: string;
  phone?: string;
  suspendedAt?: string | null;
  createdAt?: string;
};

type ReferralData = {
  driver: Driver & {
    region?: string | null;
    district?: string | null;
  };
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  activeReferrals: number;
  totalCredits: number;
  pendingCredits: number;
  referrals: Array<{
    id: string;
    name: string;
    email: string;
    phone?: string;
    registeredAs?: "OWNER" | "DRIVER" | "CUSTOMER" | "USER" | "TRAVELLER";
    status: "active" | "completed";
    joinedAt: string;
    registeredAt: string;
    linkSharedAt: string;
    region?: string | null;
    district?: string | null;
    spend?: number;
    creditsEarned: number;
  }>;
};

type FilterType = "all" | "active" | "suspended" | "recent" | "high_rated";
type SortType = "name_asc" | "name_desc" | "newest" | "oldest";

export default function AdminDriversReferralsPage() {
  const searchParams = useSearchParams();
  const queryDriverId = useAdminQueryId("driver", searchParams?.get("driverId"), "driverId");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("name_asc");
  const [viewingReferral, setViewingReferral] = useState<ReferralData["referrals"][0] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [referralsError, setReferralsError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [search]);

  useEffect(() => {
    authify();
    loadDrivers();
  }, []);

  useEffect(() => {
    const id = queryDriverId ?? 0;
    if (!Number.isFinite(id) || id <= 0) return;
    if (!drivers.length) return;
    if (selectedDriver === id) return;
    const exists = drivers.some((d) => d.id === id);
    if (!exists) return;
    void loadDriverReferrals(id);
  }, [queryDriverId, drivers, selectedDriver]);

  async function loadDrivers() {
    setLoading(true);
    setError(null);
    try {
        const r = await api.get<{ items: Driver[]; total: number }>("/api/admin/drivers", { 
          params: { page: 1, pageSize: 500 }
      });
      const driversList = r.data?.items ?? [];
      setDrivers(driversList);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load drivers";
      setError(errorMessage);
      console.error("Failed to load drivers", err);
      setDrivers([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadDriverReferrals(driverId: number) {
    if (!isValidDriverId(driverId)) {
      setReferralsError("Invalid driver ID");
      return;
    }

    setLoadingReferrals(true);
    setReferralsError(null);
    try {
      const r = await api.get<ReferralData>(`/api/admin/drivers/${driverId}/referrals`);
      setReferralData(r.data);
      setSelectedDriver(driverId);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load driver referrals";
      setReferralsError(errorMessage);
      console.error("Failed to load driver referrals", err);
      setReferralData(null);
    } finally {
      setLoadingReferrals(false);
    }
  }

  const handleSearchChange = useCallback((value: string) => {
    const sanitized = sanitizeInput(value);
    setSearch(sanitized);
  }, []);

  const filteredDrivers = drivers
    .filter((d) => {
      // Search filter (using debounced search)
      const matchesSearch = 
        !debouncedSearch ||
        d.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        d.email.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (d.phone && d.phone.toLowerCase().includes(debouncedSearch.toLowerCase()));
      
      if (!matchesSearch) return false;

      // Status filter
      switch (filter) {
        case "active":
          return !d.suspendedAt;
        case "suspended":
          return !!d.suspendedAt;
        case "recent":
          if (!d.createdAt) return false;
          const createdDate = new Date(d.createdAt);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return createdDate >= weekAgo;
        case "high_rated":
          // For now, show all if we don't have rating data
          return true;
        default:
          return true;
      }
    })
    .sort((a, b) => {
      switch (sort) {
        case "name_asc":
          return a.name.localeCompare(b.name);
        case "name_desc":
          return b.name.localeCompare(a.name);
        case "newest":
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        case "oldest":
          const dateA2 = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB2 = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateA2 - dateB2;
        default:
          return 0;
      }
    });

  return (
    <div className="space-y-4 lg:space-y-6 w-full overflow-x-hidden" style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
      {/* Premium Banner */}
      <div style={{ position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)", padding: "2rem 2rem 1.75rem", maxWidth: "100%", boxSizing: "border-box" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.13, pointerEvents: "none" }} viewBox="0 0 900 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="820" cy="30" r="90" fill="none" stroke="white" strokeWidth="1.2" />
          <circle cx="820" cy="30" r="55" fill="none" stroke="white" strokeWidth="0.7" />
          <circle cx="60" cy="140" r="70" fill="none" stroke="white" strokeWidth="1.0" />
          <line x1="0" y1="40" x2="900" y2="40" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="80" x2="900" y2="80" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="120" x2="900" y2="120" stroke="white" strokeWidth="0.4" />
          <polyline points="0,135 100,115 200,100 320,88 440,72 540,90 640,62 740,46 840,55 900,42" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,135 100,115 200,100 320,88 440,72 540,90 640,62 740,46 840,55 900,42 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,148 100,138 200,128 320,135 440,118 540,130 640,108 740,118 840,100 900,88" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="90" r="5" fill="white" opacity={0.75} />
          <circle cx="740" cy="46" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="42" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="refBannerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="95" rx="200" ry="70" fill="url(#refBannerGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <UserPlus style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Driver Referrals</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Referral programs · credit earnings · driver network growth tracking</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 100 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total Drivers</div>
            {loading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 60 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "white", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{drivers.length.toLocaleString()}</div>
            )}
          </div>
          <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 100 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(110,231,183,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Active</div>
            {loading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 60 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#6ee7b7", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{drivers.filter(d => !d.suspendedAt).length.toLocaleString()}</div>
            )}
          </div>
          <div style={{ background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.32)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 110 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,165,165,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Suspended</div>
            {loading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 60 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fca5a5", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{drivers.filter(d => !!d.suspendedAt).length.toLocaleString()}</div>
            )}
          </div>
          <div style={{ background: "rgba(14,165,233,0.14)", border: "1px solid rgba(14,165,233,0.32)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 120 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(125,211,252,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Showing Results</div>
            {loading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 60 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#7dd3fc", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{filteredDrivers.length.toLocaleString()}</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 w-full" style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
        <div className="lg:col-span-1 w-full" style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
          <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", overflow: "hidden" }} className="flex flex-col h-full max-h-[calc(100vh-200px)] w-full">
            {/* Search & Filters Section */}
            <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0, padding: "1rem", boxSizing: "border-box", overflow: "hidden" }} className="w-full">
              {/* Search Bar */}
              <div className="relative w-full mb-4 group" style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none z-10">
                  <Search className="h-4 w-4 transition-colors duration-200" style={{ color: 'rgba(255,255,255,0.38)' }} />
                </div>
                <input
                  type="text"
                  placeholder="Search by name, email, or phone..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  maxLength={100}
                  className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl outline-none transition-all duration-200 placeholder:text-white/30"
                  style={{ 
                    boxSizing: 'border-box',
                    maxWidth: '100%',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.88)',
                  }}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="absolute inset-y-0 right-0 flex items-center pr-3 active:scale-95 transition-all duration-200"
                    style={{ color: 'rgba(255,255,255,0.40)' }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filter Chips */}
              <div className="flex flex-wrap gap-2 mb-4">
                {(["all", "active", "suspended", "recent"] as FilterType[]).map((filterType) => (
                  <button
                    key={filterType}
                    onClick={() => setFilter(filterType)}
                    style={filter === filterType ? { background: 'rgba(16,185,129,0.28)', border: '1px solid rgba(16,185,129,0.55)', color: '#6ee7b7', borderRadius: '9999px', padding: '0.4rem 0.9rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' } : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.60)', borderRadius: '9999px', padding: '0.4rem 0.9rem', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    {filterType === "all" && "All"}
                    {filterType === "active" && "Active"}
                    {filterType === "suspended" && "Suspended"}
                    {filterType === "recent" && "Recent"}
                  </button>
                ))}
              </div>

              {/* Sort Dropdown */}
              <div className="relative group mb-3">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortType)}
                  aria-label="Sort drivers"
                  className="w-full px-3 py-2 text-xs font-medium rounded-xl outline-none cursor-pointer"
                  style={{ 
                    boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.80)',
                  }}
                >
                  <option value="name_asc">Name (A-Z)</option>
                  <option value="name_desc">Name (Z-A)</option>
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
              </div>

              {/* Results Count */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', borderRadius: '0.5rem', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>
                  <span style={{ color: '#6ee7b7', fontWeight: 700 }}>{filteredDrivers.length}</span>{" "}
                  driver{filteredDrivers.length !== 1 ? 's' : ''} found
                </span>
                {(search || filter !== "all" || sort !== "name_asc") && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                      setSort("name_asc");
                    }}
                    style={{ fontSize: '0.72rem', color: '#6ee7b7', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 w-full max-w-full scrollbar-thin" style={{ scrollbarColor: 'rgba(255,255,255,0.15) transparent' }}>
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mb-4" />
                  <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>Loading drivers...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
                  <p className="text-sm font-medium mb-2" style={{ color: 'rgba(255,255,255,0.80)' }}>Failed to load drivers</p>
                  <p className="text-xs text-center mb-4" style={{ color: 'rgba(255,255,255,0.45)' }}>{error}</p>
                  <button
                    onClick={loadDrivers}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </button>
                </div>
              ) : filteredDrivers.length > 0 ? (
                filteredDrivers.map((driver, index) => (
                  <div
                    key={driver.id}
                    onClick={() => {
                      if (isValidDriverId(driver.id)) {
                        loadDriverReferrals(driver.id);
                      }
                    }}
                    className="group p-3 sm:p-4 cursor-pointer transition-all duration-300 w-full max-w-full box-border"
                    style={{ borderLeft: selectedDriver === driver.id ? '4px solid #059669' : '4px solid transparent', background: selectedDriver === driver.id ? 'rgba(16,185,129,0.15)' : undefined, borderBottom: '1px solid rgba(255,255,255,0.05)', animationDelay: `${index * 20}ms` }}
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div className={`h-10 w-10 sm:h-12 sm:w-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                        selectedDriver === driver.id
                          ? "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/30 scale-110"
                          : ""
                      }`} style={selectedDriver !== driver.id ? { background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.25)' } : {}}>
                        <Truck className={`h-5 w-5 sm:h-6 sm:w-6 transition-colors duration-300 ${
                          selectedDriver === driver.id ? "text-white" : "text-emerald-400"
                        }`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm sm:text-base truncate" style={{ color: 'rgba(255,255,255,0.90)' }}>
                            {driver.name}
                          </p>
                          {driver.suspendedAt && (
                            <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full animate-pulse">
                              Suspended
                            </span>
                          )}
                        </div>
                        <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{driver.email}</p>
                      </div>
                      {selectedDriver === driver.id && (
                        <div className="flex-shrink-0">
                          <div className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse"></div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <div className="h-16 w-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <Search className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.35)' }} />
                  </div>
                  <p className="text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.65)' }}>No drivers found</p>
                  <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.38)' }}>Try adjusting your search or filters</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 w-full max-w-full min-w-0">
          {loadingReferrals ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 lg:p-6">
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 text-emerald-600 animate-spin mb-4" />
                <p className="text-sm font-medium text-gray-700">Loading referral data...</p>
              </div>
            </div>
          ) : referralsError ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 lg:p-6">
              <div className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
                <p className="text-sm font-medium text-gray-700 mb-2">Failed to load referral data</p>
                <p className="text-xs text-gray-500 text-center mb-4">{referralsError}</p>
                {selectedDriver && (
                  <button
                    onClick={() => loadDriverReferrals(selectedDriver)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          ) : referralData ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 lg:p-6 overflow-hidden w-full max-w-full min-w-0 box-border">
              <div className="mb-4 lg:mb-6">
                <h2 className="text-lg lg:text-xl font-bold text-gray-900 mb-2 break-words">{referralData.driver.name}</h2>
                <p className="text-xs lg:text-sm text-gray-500 break-words">{referralData.driver.email}</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 lg:gap-3.5 mb-4 lg:mb-6">
                <div className="bg-blue-50 rounded-lg p-3 md:p-3.5 border border-blue-100">
                  <p className="text-xl font-bold text-blue-600 leading-tight">{referralData.totalReferrals}</p>
                  <p className="text-xs md:text-sm text-gray-600 mt-1">Total Referrals</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 md:p-3.5 border border-emerald-100">
                  <p className="text-xl font-bold text-emerald-600 leading-tight">{referralData.activeReferrals}</p>
                  <p className="text-xs md:text-sm text-gray-600 mt-1">Active</p>
                </div>
                {referralData.totalCredits > 0 ? (
                  <Link
                    href={`/admin/driver/referral${selectedDriver ? `?driverId=${selectedDriver}` : ""}`}
                    className="bg-amber-50 rounded-lg p-3 md:p-3.5 border border-amber-100 hover:border-amber-200 hover:shadow-md transition-all duration-200 transform hover:-translate-y-0.5 block no-underline"
                  >
                    <p className="text-xl font-bold text-amber-600 leading-tight">{referralData.totalCredits}</p>
                    <p className="text-xs md:text-sm text-gray-600 mt-1">Total Credits</p>
                    <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1 mt-2">
                      Manage credits <ExternalLink className="h-3 w-3" />
                    </span>
                  </Link>
                ) : (
                  <div className="bg-amber-50 rounded-lg p-3 md:p-3.5 border border-amber-100 text-gray-400">
                    <p className="text-xl font-bold leading-tight text-amber-400">0</p>
                    <p className="text-xs md:text-sm text-gray-500 mt-1">Total Credits</p>
                    <span className="text-[11px] font-semibold text-gray-400 inline-flex items-center gap-1 mt-2">
                      Manage credits
                    </span>
                  </div>
                )}
                <div className="bg-purple-50 rounded-lg p-3 md:p-3.5 border border-purple-100">
                  <p className="text-xl font-bold text-purple-600 leading-tight">{referralData.totalReferrals - referralData.activeReferrals}</p>
                  <p className="text-xs md:text-sm text-gray-600 mt-1">Inactive</p>
                </div>
              </div>

              <div className="mb-4 lg:mb-6 p-3 lg:p-4 bg-gray-50 rounded-lg overflow-hidden">
                <p className="text-xs lg:text-sm font-medium text-gray-700 mb-2">Referral Code</p>
                <p className="text-base lg:text-lg font-mono text-gray-900 break-all">{referralData.referralCode}</p>
                <a
                  href={referralData.referralLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs lg:text-sm text-emerald-600 hover:underline flex items-center gap-1 mt-2 break-all"
                >
                  <span className="truncate">{referralData.referralLink}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              </div>

              <div className="overflow-hidden">
                <h3 className="text-base lg:text-lg font-semibold text-gray-900 mb-3 lg:mb-4">Referred Users</h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[400px] lg:max-h-[500px] overflow-y-auto">
                    <table className="w-full min-w-[800px]">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10 border-b border-gray-200">
                        <tr>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Location</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Link Shared</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Registered</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Registered As</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Spend</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Credits</th>
                          <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {referralData.referrals.length > 0 ? (
                          referralData.referrals.map((ref) => (
                            <TableRow key={ref.id} className="transition-all duration-150">
                              <td className="px-3 py-3">
                                <div className="min-w-[150px]">
                                  <p className="text-sm font-medium text-gray-900">{ref.name}</p>
                                  <p className="text-xs text-gray-500 truncate">{ref.email}</p>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {(ref.region || ref.district) ? (
                                  <div className="flex items-center gap-1 text-xs text-gray-600 min-w-[120px]">
                                    <MapPin className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{ref.district && ref.region ? `${ref.district}, ${ref.region}` : ref.region || ref.district || "N/A"}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400">N/A</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                                <div>
                                  <p className="font-medium">{new Date(ref.linkSharedAt).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}</p>
                                  <p className="text-gray-500">{new Date(ref.linkSharedAt).toLocaleTimeString("en-US", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}</p>
                                </div>
                              </td>
                              <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">
                                <div>
                                  <p className="font-medium">{new Date(ref.registeredAt).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}</p>
                                  <p className="text-gray-500">{new Date(ref.registeredAt).toLocaleTimeString("en-US", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}</p>
                                </div>
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                                    ref.registeredAs === "OWNER"
                                      ? "bg-purple-100 text-purple-700"
                                      : ref.registeredAs === "DRIVER"
                                      ? "bg-blue-100 text-blue-700"
                                      : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {ref.registeredAs === "OWNER" ? "Owner" : ref.registeredAs === "DRIVER" ? "Driver" : "Traveller"}
                                </span>
                              </td>
                              <td className="px-3 py-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                                    ref.status === "completed"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-blue-100 text-blue-700"
                                  }`}
                                >
                                  {ref.status}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right text-sm font-medium text-gray-900 whitespace-nowrap">
                                {(ref.spend ?? 0).toLocaleString()} TZS
                              </td>
                              <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900 whitespace-nowrap">
                                {ref.creditsEarned.toLocaleString()} TZS
                              </td>
                              <td className="px-3 py-3 text-center whitespace-nowrap">
                                <button
                                  onClick={() => setViewingReferral(ref)}
                                  className="inline-flex items-center justify-center p-1.5 text-emerald-600 hover:text-emerald-700 transition-all duration-200 hover:scale-110 active:scale-95"
                                  title="View details"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                              </td>
                            </TableRow>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                              No referrals yet
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 lg:p-6">
              {/* Skeleton Preview */}
              <div className="mb-4 lg:mb-6">
                <div className="h-7 w-48 bg-gray-200 rounded-lg mb-2 animate-pulse"></div>
                <div className="h-4 w-64 bg-gray-200 rounded-lg animate-pulse"></div>
              </div>

              {/* Stats Cards Skeleton */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4 mb-4 lg:mb-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200">
                    <div className="h-8 w-16 bg-gray-300 rounded-lg mb-2 animate-pulse"></div>
                    <div className="h-4 w-24 bg-gray-300 rounded-lg animate-pulse"></div>
                  </div>
                ))}
              </div>

              {/* Referral Code Skeleton */}
              <div className="mb-4 lg:mb-6 p-3 lg:p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="h-4 w-28 bg-gray-300 rounded-lg mb-2 animate-pulse"></div>
                <div className="h-6 w-48 bg-gray-300 rounded-lg mb-3 animate-pulse"></div>
                <div className="h-4 w-64 bg-gray-300 rounded-lg animate-pulse"></div>
              </div>

              {/* Referred Users Skeleton */}
              <div>
                <div className="h-6 w-32 bg-gray-300 rounded-lg mb-3 lg:mb-4 animate-pulse"></div>
                <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                  <div className="overflow-x-auto max-h-[400px] lg:max-h-[500px] overflow-y-auto">
                    <table className="w-full min-w-[800px]">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10 border-b border-gray-200">
                        <tr>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Location</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Link Shared</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Registered</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Registered As</th>
                          <th className="px-3 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Spend</th>
                          <th className="px-3 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Credits</th>
                          <th className="px-3 py-3 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {[1, 2, 3].map((i) => (
                          <tr key={i} className="animate-pulse">
                            <td className="px-3 py-3">
                              <div className="h-4 w-32 bg-gray-300 rounded mb-1"></div>
                              <div className="h-3 w-48 bg-gray-200 rounded"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-24 bg-gray-300 rounded"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-28 bg-gray-300 rounded mb-1"></div>
                              <div className="h-2 w-20 bg-gray-200 rounded"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-3 w-28 bg-gray-300 rounded mb-1"></div>
                              <div className="h-2 w-20 bg-gray-200 rounded"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-6 w-20 bg-gray-300 rounded-full"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-6 w-16 bg-gray-300 rounded-full"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-4 w-24 bg-gray-300 rounded ml-auto"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-4 w-20 bg-gray-300 rounded ml-auto"></div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="h-8 w-8 bg-gray-300 rounded-lg mx-auto"></div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Helper Text */}
              <div className="mt-6 pt-6 border-t border-gray-200 text-center">
                <UserPlus className="h-10 w-10 text-gray-300 mx-auto mb-3 animate-pulse" />
                <p className="text-sm text-gray-400 font-medium">Select a driver to view their referrals</p>
                <p className="text-xs text-gray-400 mt-1">This preview shows how the data will be displayed</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Referral Details Modal */}
      {viewingReferral && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewingReferral(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div
              className="sticky top-0 z-10 px-6 py-5 flex items-center justify-between rounded-t-2xl"
              style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #02665e 100%)" }}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <span className="text-white font-bold text-sm">
                    {(viewingReferral.name || "?").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white leading-tight">Referral Details</h2>
                  <p className="text-xs text-white/70 leading-tight">{viewingReferral.name}</p>
                </div>
              </div>
              <button
                onClick={() => setViewingReferral(null)}
                aria-label="Close modal"
                className="p-2 text-white/70 hover:text-white hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              {/* Personal Information */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Personal Information</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Full Name</p>
                    <p className="text-sm font-semibold text-gray-900">{viewingReferral.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Phone Number</p>
                    <p className="text-sm font-semibold text-gray-900">{viewingReferral.phone || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Email</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{viewingReferral.email || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Registered As</p>
                    <span
                      className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ${
                        viewingReferral.registeredAs === "OWNER"
                          ? "bg-purple-50 text-purple-700 ring-purple-200"
                          : viewingReferral.registeredAs === "DRIVER"
                          ? "bg-blue-50 text-blue-700 ring-blue-200"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      }`}
                    >
                      {viewingReferral.registeredAs === "OWNER" ? "Owner" : viewingReferral.registeredAs === "DRIVER" ? "Driver" : "Traveller"}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Region</p>
                    <p className="text-sm font-semibold text-gray-900">{viewingReferral.region || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">District</p>
                    <p className="text-sm font-semibold text-gray-900">{viewingReferral.district || "N/A"}</p>
                  </div>
                </div>
              </div>

              {/* Referral Timeline */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Referral Timeline</p>
                <div className="relative pl-5">
                  <div className="absolute left-[7px] top-3 bottom-3 w-px bg-gradient-to-b from-blue-400 to-emerald-400" />
                  <div className="space-y-5">
                    <div className="flex items-start gap-3">
                      <div className="relative z-10 h-3.5 w-3.5 rounded-full bg-blue-500 ring-2 ring-white shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-blue-700 mb-0.5">Link Shared</p>
                        <p className="text-sm font-medium text-gray-800">
                          {new Date(viewingReferral.linkSharedAt).toLocaleString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="relative z-10 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-emerald-700 mb-0.5">Registration Completed</p>
                        <p className="text-sm font-medium text-gray-800">
                          {new Date(viewingReferral.registeredAt).toLocaleString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status, Spend & Credits */}
              <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-xl p-4 flex flex-col gap-1 ${viewingReferral.status === "completed" ? "bg-emerald-50 ring-1 ring-emerald-100" : "bg-blue-50 ring-1 ring-blue-100"}`}>
                  <p className="text-xs text-gray-500">Status</p>
                  <span
                    className={`inline-flex w-fit px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      viewingReferral.status === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {viewingReferral.status}
                  </span>
                </div>
                <div className="bg-indigo-50 ring-1 ring-indigo-100 rounded-xl p-4 flex flex-col gap-1">
                  <p className="text-xs text-gray-500">Total Spend</p>
                  <p className="text-base font-bold text-indigo-700">{(viewingReferral.spend ?? 0).toLocaleString()}<span className="text-xs font-normal ml-1">TZS</span></p>
                </div>
                <div className="bg-amber-50 ring-1 ring-amber-100 rounded-xl p-4 flex flex-col gap-1">
                  <p className="text-xs text-gray-500">Credits Earned</p>
                  <p className="text-base font-bold text-amber-700">{viewingReferral.creditsEarned.toLocaleString()}<span className="text-xs font-normal ml-1">TZS</span></p>
                </div>
              </div>

              {/* Admin actions */}
              {viewingReferral.creditsEarned > 0 && (
                <div className="pt-1">
                  <Link
                    href={`/admin/driver/referral${selectedDriver ? `?driverId=${selectedDriver}` : ""}`}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-[#0e2a7a] to-[#02665e] rounded-xl hover:opacity-90 transition"
                  >
                    Manage Credits
                    <ExternalLink className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


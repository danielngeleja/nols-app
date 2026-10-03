"use client";
import { useEffect, useState, useCallback } from "react";
import { BarChart3, Truck, Search, Calendar, DollarSign, Star, Loader2, Receipt, ShieldCheck, Wallet, MapPin } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminQueryId } from "@/lib/adminRecordRefs";
import { useSearchParams } from "next/navigation";
import DatePicker from "@/components/ui/DatePicker";

const api = apiClient;
function authify() {}

type Driver = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  todaysRides?: number;
  earnings?: number;
  grossRevenue?: number;
  nolsafRevenue?: number;
  paidEarnings?: number;
  paidPayouts?: number;
  pendingPayouts?: number;
  verifiedPayouts?: number;
  approvedPayouts?: number;
  invoiceCount?: number;
  rating?: number;
  totalReviews?: number;
};

type StatsData = {
  driver: Driver;
  date: string;
  todaysRides: number;
  earnings: number;
  grossRevenue: number;
  nolsafRevenue: number;
  paidEarnings: number;
  paidPayouts: number;
  pendingPayouts: number;
  verifiedPayouts: number;
  approvedPayouts: number;
  invoiceCount: number;
  rating: number;
  totalReviews: number;
  trips: Array<{
    id: number;
    tripCode: string;
    route: { pickup: string; dropoff: string };
    vehicleType: string | null;
    status: string | null;
    payoutStatus: string;
    grossAmount: number;
    commissionAmount: number;
    driverNet: number;
    rating: number | null;
    completedAt: string | null;
  }>;
};

const formatMoney = (value: number | null | undefined) => `${Math.round(Number(value ?? 0)).toLocaleString()} TZS`;

function formatDisplayDate(iso: string) {
  if (!iso) return "Date";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "Date";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminDriversStatsPage() {
  const searchParams = useSearchParams();
  const queryDriverId = useAdminQueryId("driver", searchParams?.get("driverId"), "driverId");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnim, setPickerAnim] = useState(false);

  useEffect(() => {
    authify();
    loadDrivers();
  }, [selectedDate]);

  useEffect(() => {
    const id = queryDriverId ?? 0;
    if (!Number.isFinite(id) || id <= 0) return;
    if (!drivers.length) return;
    if (selectedDriver === id) return;
    const exists = drivers.some((d) => d.id === id);
    if (!exists) return;
    setSelectedDriver(id);
  }, [queryDriverId, drivers, selectedDriver]);

  const loadDriverStats = useCallback(async (driverId: number) => {
    try {
      const r = await api.get<StatsData>(`/api/admin/drivers/${driverId}/stats`, { params: { date: selectedDate } });
      setStatsData(r.data);
    } catch (err) {
      console.error("Failed to load driver stats", err);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (selectedDriver) {
      loadDriverStats(selectedDriver);
    }
  }, [selectedDriver, loadDriverStats]);

  async function loadDrivers() {
    setLoading(true);
    try {
      const r = await api.get<{ items: Driver[]; total: number }>("/api/admin/drivers/stats/daily", { params: { date: selectedDate } });
      const items = r.data?.items ?? [];
      setDrivers(items);
      setSelectedDriver((current) => {
        if (current && items.some((driver) => driver.id === current)) return current;
        return items.find((driver) => Number(driver.todaysRides || 0) > 0)?.id ?? items[0]?.id ?? null;
      });
    } catch (err) {
      console.error("Failed to load drivers", err);
    } finally {
      setLoading(false);
    }
  }

  const filteredDrivers = drivers.filter(
    (d) => d.name.toLowerCase().includes(search.toLowerCase()) || d.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Premium Banner */}
      <div style={{ position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)", padding: "2rem 2rem 1.75rem" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.13, pointerEvents: "none" }} viewBox="0 0 900 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="820" cy="30" r="90" fill="none" stroke="white" strokeWidth="1.2" />
          <circle cx="820" cy="30" r="55" fill="none" stroke="white" strokeWidth="0.7" />
          <circle cx="60" cy="140" r="70" fill="none" stroke="white" strokeWidth="1.0" />
          <line x1="0" y1="40" x2="900" y2="40" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="72" x2="900" y2="72" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="104" x2="900" y2="104" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="136" x2="900" y2="136" stroke="white" strokeWidth="0.4" />
          <polyline points="0,130 90,110 180,95 270,80 360,65 450,90 540,55 630,70 720,40 810,52 900,35" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,130 90,110 180,95 270,80 360,65 450,90 540,55 630,70 720,40 810,52 900,35 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,145 90,132 180,118 270,128 360,108 450,122 540,98 630,112 720,88 810,102 900,78" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="55" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="40" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="35" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="statsBannerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="90" rx="200" ry="70" fill="url(#statsBannerGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BarChart3 style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Driver Statistics</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Connected daily performance: accomplished rides, payouts, revenue &amp; ratings</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Drivers</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "white", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : drivers.length}</div>
          </div>
          {statsData && (
            <>
              <div style={{ background: "rgba(14,165,233,0.16)", border: "1px solid rgba(14,165,233,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
                <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(125,211,252,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Rides</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#7dd3fc", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{statsData.todaysRides}</div>
              </div>
              <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 120 }}>
                <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(110,231,183,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Driver Net</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#6ee7b7", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                  {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(statsData.earnings)} <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>TZS</span>
                </div>
              </div>
              <div style={{ background: "rgba(249,115,22,0.14)", border: "1px solid rgba(249,115,22,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 120 }}>
                <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(253,186,116,0.88)", letterSpacing: "0.08em", textTransform: "uppercase" }}>NoLSAF</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fdba74", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                  {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(statsData.nolsafRevenue)} <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>TZS</span>
                </div>
              </div>
              <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
                <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,211,77,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Rating</div>
                <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fcd34d", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{statsData.rating.toFixed(1)}</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
        <div className="lg:col-span-1 w-full min-w-0 max-w-full">
          <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", overflow: "hidden" }} className="w-full">
            <div style={{ padding: "0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)", boxSizing: "border-box", maxWidth: "100%", overflow: "hidden" }} className="w-full">
              <div className="relative w-full" style={{ maxWidth: "100%", boxSizing: "border-box" }}>
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 pointer-events-none z-10" style={{ color: "rgba(255,255,255,0.35)" }} />
                <input
                  type="text"
                  placeholder="Search drivers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                  style={{ boxSizing: "border-box", maxWidth: "100%", width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.88)" }}
                />
              </div>
            </div>
            <div className="max-h-[600px] overflow-y-auto" style={{ scrollbarColor: "rgba(255,255,255,0.15) transparent" }}>
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mb-4" />
                  <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.65)" }}>Loading drivers...</p>
                </div>
              ) : filteredDrivers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Search className="h-8 w-8 mb-4" style={{ color: "rgba(255,255,255,0.25)" }} />
                  <p className="text-sm font-medium mb-1" style={{ color: "rgba(255,255,255,0.65)" }}>No drivers found</p>
                  <p className="text-xs text-center" style={{ color: "rgba(255,255,255,0.38)" }}>Try adjusting your search</p>
                </div>
              ) : (
                filteredDrivers.map((driver) => (
                <div
                  key={driver.id}
                  onClick={() => setSelectedDriver(driver.id)}
                  className="p-4 cursor-pointer transition-colors"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", borderLeft: selectedDriver === driver.id ? "4px solid #059669" : "4px solid transparent", background: selectedDriver === driver.id ? "rgba(16,185,129,0.15)" : undefined }}
                >
                  <div className="flex items-center gap-3">
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: selectedDriver === driver.id ? "linear-gradient(135deg,#059669,#047857)" : "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Truck className="h-5 w-5" style={{ color: selectedDriver === driver.id ? "white" : "#6ee7b7" }} />
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: "rgba(255,255,255,0.90)" }}>{driver.name}</p>
                      <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{driver.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(14,165,233,0.14)", border: "1px solid rgba(14,165,233,0.20)", color: "#7dd3fc" }}>
                          {driver.todaysRides ?? 0} rides
                        </span>
                        <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(16,185,129,0.14)", border: "1px solid rgba(16,185,129,0.20)", color: "#6ee7b7" }}>
                          {formatMoney(driver.earnings || 0)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.18)", color: "#fcd34d" }}>
                          {(driver.rating || 0).toFixed(1)}/5
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          {statsData ? (
            <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1.5rem" }}>
              <div className="mb-6">
                <h2 className="text-xl font-bold mb-1" style={{ color: "rgba(255,255,255,0.92)" }}>{statsData.driver.name}</h2>
                <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.50)" }}>{statsData.driver.email}</p>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerAnim(true);
                        setTimeout(() => setPickerAnim(false), 350);
                        setPickerOpen((v) => !v);
                      }}
                      className={`w-full box-border px-3 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-all ${
                        pickerAnim ? "ring-2 ring-emerald-400/30" : ""
                      }`}
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)", color: "rgba(255,255,255,0.80)" }}
                      aria-label="Open date picker"
                      title="Select date for statistics"
                    >
                      <Calendar className="h-4 w-4" style={{ color: "rgba(255,255,255,0.55)" }} aria-hidden="true" />
                      <span className="tabular-nums">{formatDisplayDate(selectedDate)}</span>
                    </button>

                    {pickerOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                        <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                          <DatePicker
                            selected={selectedDate}
                            allowRange={false}
                            allowPast={true}
                            onSelectAction={(s) => {
                              const iso = Array.isArray(s) ? (s[0] as string) : (s as string);
                              if (iso) setSelectedDate(iso);
                              setPickerOpen(false);
                            }}
                            onCloseAction={() => setPickerOpen(false)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div style={{ background: "rgba(14,165,233,0.16)", border: "1px solid rgba(14,165,233,0.30)", borderRadius: "0.85rem", padding: "1.5rem" }}>
                  <div className="flex items-center gap-3 mb-2">
                    <Calendar className="h-6 w-6" style={{ color: "#7dd3fc" }} />
                    <p className="text-sm" style={{ color: "rgba(125,211,252,0.80)" }}>Accomplished Rides</p>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#7dd3fc" }}>{statsData.todaysRides}</p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.40)" }}>{statsData.invoiceCount} payout records</p>
                </div>

                <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.30)", borderRadius: "0.85rem", padding: "1.5rem" }}>
                  <div className="flex items-center gap-3 mb-2">
                    <Wallet className="h-6 w-6" style={{ color: "#6ee7b7" }} />
                    <p className="text-sm" style={{ color: "rgba(110,231,183,0.80)" }}>Driver Net</p>
                  </div>
                  <p className="text-2xl font-bold" style={{ color: "#6ee7b7" }}>{formatMoney(statsData.earnings)}</p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.40)" }}>{formatMoney(statsData.paidEarnings)} paid</p>
                </div>

                <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.30)", borderRadius: "0.85rem", padding: "1.5rem" }}>
                  <div className="flex items-center gap-3 mb-2">
                    <Star className="h-6 w-6 fill-amber-400" style={{ color: "#fcd34d" }} />
                    <p className="text-sm" style={{ color: "rgba(252,211,77,0.80)" }}>Rating</p>
                  </div>
                  <p className="text-3xl font-bold" style={{ color: "#fcd34d" }}>{statsData.rating.toFixed(1)}</p>
                  <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.40)" }}>{statsData.totalReviews} trip reviews</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "0.85rem", padding: "1rem" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-5 w-5" style={{ color: "rgba(255,255,255,0.55)" }} />
                    <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "rgba(255,255,255,0.52)" }}>Gross Revenue</p>
                  </div>
                  <p className="text-lg font-bold" style={{ color: "rgba(255,255,255,0.92)" }}>{formatMoney(statsData.grossRevenue)}</p>
                </div>
                <div style={{ background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.26)", borderRadius: "0.85rem", padding: "1rem" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="h-5 w-5" style={{ color: "#fdba74" }} />
                    <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "rgba(253,186,116,0.82)" }}>NoLSAF Revenue</p>
                  </div>
                  <p className="text-lg font-bold" style={{ color: "#fdba74" }}>{formatMoney(statsData.nolsafRevenue)}</p>
                </div>
                <div style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.26)", borderRadius: "0.85rem", padding: "1rem" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Receipt className="h-5 w-5" style={{ color: "#6ee7b7" }} />
                    <p className="text-xs uppercase tracking-[0.12em]" style={{ color: "rgba(110,231,183,0.82)" }}>Payout Status</p>
                  </div>
                  <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.90)" }}>{statsData.paidPayouts} paid · {statsData.approvedPayouts} approved · {statsData.pendingPayouts + statsData.verifiedPayouts} in review</p>
                </div>
              </div>

              <div className="mt-4 overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.10)", borderRadius: "0.85rem", background: "rgba(255,255,255,0.04)" }}>
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" style={{ color: "#7dd3fc" }} />
                    <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.86)" }}>Daily accomplished trips</p>
                  </div>
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{statsData.trips.length} records</span>
                </div>
                {statsData.trips.length === 0 ? (
                  <div className="p-5 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>No completed payout trips found for this date.</div>
                ) : (
                  <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                    {statsData.trips.slice(0, 8).map((trip) => (
                      <div key={`${trip.id}-${trip.payoutStatus}`} className="p-4 grid grid-cols-1 md:grid-cols-[1.4fr_1fr_auto] gap-3 items-center">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: "rgba(255,255,255,0.92)" }}>{trip.tripCode}</p>
                          <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.50)" }}>{trip.route.pickup} to {trip.route.dropoff}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className="px-2 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.15)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.24)" }}>{trip.payoutStatus}</span>
                          <span className="px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.68)", border: "1px solid rgba(255,255,255,0.10)" }}>{trip.vehicleType || "Vehicle"}</span>
                          {trip.rating != null && <span className="px-2 py-1 rounded-full" style={{ background: "rgba(245,158,11,0.14)", color: "#fcd34d", border: "1px solid rgba(245,158,11,0.24)" }}>{trip.rating.toFixed(1)}/5</span>}
                        </div>
                        <div className="text-left md:text-right">
                          <p className="text-sm font-bold" style={{ color: "#6ee7b7" }}>{formatMoney(trip.driverNet)}</p>
                          <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>NoLSAF {formatMoney(trip.commissionAmount)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "1rem", boxShadow: "0 8px 32px rgba(0,0,0,0.45)", padding: "3rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
                <BarChart3 style={{ width: 26, height: 26, color: "rgba(255,255,255,0.35)" }} />
              </div>
              <p style={{ color: "rgba(255,255,255,0.50)", fontSize: "0.9rem" }}>Select a driver to view their statistics</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


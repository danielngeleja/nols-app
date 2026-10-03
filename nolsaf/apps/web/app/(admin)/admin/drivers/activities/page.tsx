"use client";
import { useEffect, useState } from "react";
import { Activity, Truck, UserPlus, Award, Trophy, Calendar, FileText,  ArrowRight } from "lucide-react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { useAdminQueryId } from "@/lib/adminRecordRefs";
import { useSearchParams } from "next/navigation";

const api = apiClient;
function authify() {}

type Driver = {
  id: number;
  name: string;
  email: string;
  createdAt: string;
};

type DriverActivities = {
  driver: Driver;
  activities: {
    referrals: number;
    bonuses: number;
    trips: number;
    unreadReminders: number;
    todayTrips: number;
    totalTrips: number;
    totalInvoices: number;
  };
  lastUpdated: string;
};

export default function AdminDriversActivitiesPage() {
  const searchParams = useSearchParams();
  const queryDriverId = useAdminQueryId("driver", searchParams?.get("driverId"), "driverId");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [activities, setActivities] = useState<Map<number, DriverActivities["activities"]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [driverActivity, setDriverActivity] = useState<DriverActivities | null>(null);

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
    void loadDriverActivity(id);
  }, [queryDriverId, drivers, selectedDriver]);

  async function loadDrivers() {
    setLoading(true);
    try {
      const r = await api.get<{ items: Driver[]; total: number }>("/api/admin/drivers", { params: { page: 1, pageSize: 100 } });
      setDrivers(r.data?.items ?? []);
      
      // Load activities for all drivers
      const activitiesMap = new Map<number, DriverActivities["activities"]>();
      for (const driver of r.data?.items ?? []) {
        try {
          const act = await api.get<DriverActivities>(`/api/admin/drivers/${driver.id}/activities`);
          if (act.data?.activities) {
            activitiesMap.set(driver.id, act.data.activities);
          }
        } catch (e) {
          console.warn(`Failed to load activities for driver ${driver.id}`, e);
        }
      }
      setActivities(activitiesMap);
    } catch (err) {
      console.error("Failed to load drivers", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadDriverActivity(driverId: number) {
    try {
      const r = await api.get<DriverActivities>(`/api/admin/drivers/${driverId}/activities`);
      setDriverActivity(r.data);
      setSelectedDriver(driverId);
    } catch (err) {
      console.error("Failed to load driver activity", err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading driver activities...</p>
        </div>
      </div>
    );
  }

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
          <polyline points="0,130 90,112 180,98 270,82 360,68 450,88 540,52 630,68 720,38 810,50 900,33" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,130 90,112 180,98 270,82 360,68 450,88 540,52 630,68 720,38 810,50 900,33 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,145 90,134 180,120 270,130 360,110 450,124 540,100 630,114 720,90 810,104 900,80" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="52" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="38" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="33" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="actBannerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="90" rx="200" ry="70" fill="url(#actBannerGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Activity style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Driver Activities</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Trips · referrals · bonuses · reminders per driver</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Drivers</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "white", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : drivers.length}</div>
          </div>
          <div style={{ background: "rgba(14,165,233,0.16)", border: "1px solid rgba(14,165,233,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(125,211,252,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total Trips</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#7dd3fc", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {Array.from(activities.values()).reduce((s, a) => s + (a.totalTrips ?? 0), 0)}
            </div>
          </div>
          <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(110,231,183,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Referrals</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#6ee7b7", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {Array.from(activities.values()).reduce((s, a) => s + (a.referrals ?? 0), 0)}
            </div>
          </div>
          <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,211,77,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Bonuses</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fcd34d", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {Array.from(activities.values()).reduce((s, a) => s + (a.bonuses ?? 0), 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Drivers List */}
        <div className="lg:col-span-2">
          <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", overflow: "hidden" }}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>All Drivers ({drivers.length})</h2>
            </div>
            <div>
              {drivers.map((driver) => {
                const act = activities.get(driver.id);
                const isActive = selectedDriver === driver.id;
                return (
                  <div
                    key={driver.id}
                    onClick={() => loadDriverActivity(driver.id)}
                    className="cursor-pointer transition-colors p-4"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", borderLeft: isActive ? "4px solid #059669" : "4px solid transparent", background: isActive ? "rgba(16,185,129,0.15)" : undefined }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div style={{ width: 40, height: 40, borderRadius: "50%", background: isActive ? "linear-gradient(135deg,#059669,#047857)" : "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Truck className="h-5 w-5" style={{ color: isActive ? "white" : "#6ee7b7" }} />
                        </div>
                        <div>
                          <p className="font-medium" style={{ color: "rgba(255,255,255,0.90)" }}>{driver.name}</p>
                          <p className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>{driver.email}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5" style={{ color: "rgba(255,255,255,0.30)" }} />
                    </div>
                    {act && (
                      <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                        <div className="text-center">
                          <p className="font-semibold" style={{ color: "#7dd3fc" }}>{act.totalTrips}</p>
                          <p style={{ color: "rgba(255,255,255,0.40)" }}>Trips</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold" style={{ color: "#6ee7b7" }}>{act.referrals}</p>
                          <p style={{ color: "rgba(255,255,255,0.40)" }}>Referrals</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold" style={{ color: "#fcd34d" }}>{act.bonuses}</p>
                          <p style={{ color: "rgba(255,255,255,0.40)" }}>Bonuses</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold" style={{ color: "#fca5a5" }}>{act.unreadReminders}</p>
                          <p style={{ color: "rgba(255,255,255,0.40)" }}>Reminders</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Quick Links & Selected Driver */}
        <div className="space-y-4">
          <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1rem 1.25rem" }}>
            <h3 style={{ fontSize: "0.8rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Quick Access</h3>
            <div className="space-y-1">
              {([
                { href: "/admin/drivers/trips", icon: Calendar, label: "All Trips", color: "#7dd3fc" },
                { href: "/admin/drivers/invoices", icon: FileText, label: "All Invoices", color: "#5eead4" },
                { href: "/admin/drivers/referrals", icon: UserPlus, label: "All Referrals", color: "#6ee7b7" },
                { href: "/admin/drivers/bonuses", icon: Award, label: "All Bonuses", color: "#fcd34d" },
                { href: "/admin/drivers/levels", icon: Trophy, label: "All Levels", color: "#c4b5fd" },
              ] as const).map(({ href, icon: Icon, label, color }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 p-2 rounded-lg no-underline transition-all duration-200"
                  style={{ color: "rgba(255,255,255,0.78)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.07)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = ""; }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: "0.5rem", background: `${color}22`, border: `1px solid ${color}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon style={{ width: 14, height: 14, color }} />
                  </div>
                  <span style={{ fontSize: "0.875rem" }}>{label}</span>
                </Link>
              ))}
            </div>
          </div>

          {driverActivity && (
            <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1rem 1.25rem" }}>
              <h3 style={{ fontSize: "0.8rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.75rem" }}>Selected Driver</h3>
              <div className="space-y-3">
                <div style={{ paddingBottom: "0.75rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="font-medium" style={{ color: "rgba(255,255,255,0.90)" }}>{driverActivity.driver.name}</p>
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>{driverActivity.driver.email}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", borderRadius: "0.6rem", padding: "0.5rem 0.75rem" }}>
                    <p className="font-bold" style={{ color: "#7dd3fc", fontSize: "1.1rem" }}>{driverActivity.activities.totalTrips}</p>
                    <p style={{ color: "rgba(255,255,255,0.45)" }}>Total Trips</p>
                  </div>
                  <div style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", borderRadius: "0.6rem", padding: "0.5rem 0.75rem" }}>
                    <p className="font-bold" style={{ color: "#7dd3fc", fontSize: "1.1rem" }}>{driverActivity.activities.todayTrips}</p>
                    <p style={{ color: "rgba(255,255,255,0.45)" }}>Today Trips</p>
                  </div>
                  <div style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "0.6rem", padding: "0.5rem 0.75rem" }}>
                    <p className="font-bold" style={{ color: "#6ee7b7", fontSize: "1.1rem" }}>{driverActivity.activities.referrals}</p>
                    <p style={{ color: "rgba(255,255,255,0.45)" }}>Referrals</p>
                  </div>
                  <div style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "0.6rem", padding: "0.5rem 0.75rem" }}>
                    <p className="font-bold" style={{ color: "#fcd34d", fontSize: "1.1rem" }}>{driverActivity.activities.bonuses}</p>
                    <p style={{ color: "rgba(255,255,255,0.45)" }}>Bonuses</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


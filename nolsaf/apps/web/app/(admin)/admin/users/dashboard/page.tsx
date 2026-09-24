"use client";

import { useEffect, useState, useMemo } from "react";
import { Users, UserCheck, Mail, Phone, Lock, TrendingUp, DollarSign, ShoppingCart, Car, CheckCircle, Clock, Eye } from "lucide-react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";

const api = apiClient;
function authify() {}

type SummaryData = {
  totalCustomers?: number;
  verifiedEmailCount?: number;
  verifiedPhoneCount?: number;
  twoFactorEnabledCount?: number;
  newCustomersLast7Days?: number;
  newCustomersLast30Days?: number;
  recentCustomers?: Array<{
    id: number;
    name: string | null;
    email: string;
    phone: string | null;
    createdAt: string;
    emailVerifiedAt: string | null;
    phoneVerifiedAt: string | null;
    twoFactorEnabled: boolean;
  }>;
  totalBookings?: number;
  confirmedBookings?: number;
  checkedInBookings?: number;
  completedBookings?: number;
  totalRevenue?: number;
  customersWithBookings?: number;
  activeCustomers?: number;
  totalGroupBookings?: number;
  transportationRequests?: number;
  avgBookingsPerCustomer?: number;
};

export default function UsersDashboardPage() {
  const [summary, setSummary] = useState<SummaryData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authify();
    (async () => {
      try {
        const r = await api.get<SummaryData>("/admin/users/summary");
        if (r?.data) setSummary(r.data);
      } catch (e) {
        console.error("Failed to load users summary:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Prepare chart data for Booking Status Distribution
  const bookingStatusChartData = useMemo<ChartData<"doughnut">>(() => {
    return {
      labels: ["Confirmed", "Checked In", "Completed", "Other"],
      datasets: [
        {
          label: "Bookings by Status",
          data: [
            summary.confirmedBookings || 0,
            summary.checkedInBookings || 0,
            summary.completedBookings || 0,
            (summary.totalBookings || 0) - (summary.confirmedBookings || 0) - (summary.checkedInBookings || 0) - (summary.completedBookings || 0),
          ],
          backgroundColor: [
            "rgba(59, 130, 246, 0.8)", // Blue - Confirmed
            "rgba(16, 185, 129, 0.8)", // Green - Checked In
            "rgba(139, 92, 246, 0.8)", // Purple - Completed
            "rgba(156, 163, 175, 0.8)", // Gray - Other
          ],
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    };
  }, [summary]);

  // Prepare chart data for Verification Status
  const verificationChartData = useMemo<ChartData<"bar">>(() => {
    const emailVerified = summary.verifiedEmailCount || 0;
    const phoneVerified = summary.verifiedPhoneCount || 0;
    const twoFactorEnabled = summary.twoFactorEnabledCount || 0;

    return {
      labels: ["Email Verified", "Phone Verified", "2FA Enabled"],
      datasets: [
        {
          label: "Customer Verification Status",
          data: [emailVerified, phoneVerified, twoFactorEnabled],
          backgroundColor: [
            "rgba(59, 130, 246, 0.8)", // Blue
            "rgba(16, 185, 129, 0.8)", // Green
            "rgba(139, 92, 246, 0.8)", // Purple
          ],
          borderColor: [
            "rgba(59, 130, 246, 1)",
            "rgba(16, 185, 129, 1)",
            "rgba(139, 92, 246, 1)",
          ],
          borderWidth: 1,
        },
      ],
    };
  }, [summary]);

  return (
    <div className="space-y-6 w-full min-w-0">
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
          <polyline points="0,130 90,112 180,96 270,80 360,65 450,88 540,52 630,68 720,36 810,50 900,32" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,130 90,112 180,96 270,80 360,65 450,88 540,52 630,68 720,36 810,50 900,32 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,145 90,133 180,119 270,130 360,112 450,125 540,100 630,115 720,92 810,105 900,82" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="52" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="36" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="32" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="custBannerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="90" rx="200" ry="70" fill="url(#custBannerGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Users style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Customers Dashboard</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Bookings · revenue · verification · transportation</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(255,255,255,0.70)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Customers</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "white", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : (summary.totalCustomers || 0).toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(110,231,183,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Bookings</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#6ee7b7", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : ((summary.totalBookings || 0) + (summary.totalGroupBookings || 0)).toLocaleString()}</div>
          </div>
          <div style={{ background: "rgba(147,51,234,0.18)", border: "1px solid rgba(196,181,253,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 130 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(216,180,254,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Revenue</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 900, color: "#c4b5fd", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {loading ? "…" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(summary.totalRevenue || 0)} <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>TZS</span>
            </div>
          </div>
          <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 90 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,211,77,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Active</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fcd34d", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{loading ? "…" : (summary.activeCustomers || 0).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { icon: Users, label: "Total Customers", value: (summary.totalCustomers || 0).toLocaleString(), color: "#7dd3fc", bg: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.35)" },
          { icon: ShoppingCart, label: "Total Bookings", value: ((summary.totalBookings || 0) + (summary.totalGroupBookings || 0)).toLocaleString(), color: "#6ee7b7", bg: "rgba(16,185,129,0.16)", border: "rgba(16,185,129,0.35)" },
          { icon: DollarSign, label: "Total Revenue", value: `${new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(summary.totalRevenue||0)} TZS`, color: "#c4b5fd", bg: "rgba(147,51,234,0.16)", border: "rgba(196,181,253,0.35)" },
          { icon: UserCheck, label: "Active Customers", value: (summary.activeCustomers || 0).toLocaleString(), color: "#fcd34d", bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.35)" },
        ] as const).map(({ icon: Icon, label, value, color, bg, border }) => (
          <div key={label} className="transition-all hover:scale-[1.02]" style={{ borderRadius: "1rem", border: `1px solid ${border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1.25rem" }}>
            <div className="flex items-center gap-3">
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon style={{ width: 18, height: 18, color }} />
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.50)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: "1.35rem", fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
                  {loading ? "…" : value}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Booking & Activity Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { icon: CheckCircle, label: "Confirmed", value: (summary.confirmedBookings || 0).toLocaleString(), color: "#7dd3fc", bg: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.35)" },
          { icon: Clock, label: "Checked In", value: (summary.checkedInBookings || 0).toLocaleString(), color: "#6ee7b7", bg: "rgba(16,185,129,0.16)", border: "rgba(16,185,129,0.35)" },
          { icon: Car, label: "Transport Requests", value: (summary.transportationRequests || 0).toLocaleString(), color: "#c4b5fd", bg: "rgba(147,51,234,0.16)", border: "rgba(196,181,253,0.35)" },
          { icon: TrendingUp, label: "Avg Bookings/Customer", value: (summary.avgBookingsPerCustomer || 0).toLocaleString(), color: "#fcd34d", bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.35)" },
        ] as const).map(({ icon: Icon, label, value, color, bg, border }) => (
          <div key={label} className="transition-all hover:scale-[1.02]" style={{ borderRadius: "1rem", border: `1px solid ${border}`, boxShadow: "0 8px 32px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1.25rem" }}>
            <div className="flex items-center gap-3">
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon style={{ width: 18, height: 18, color }} />
              </div>
              <div>
                <div style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.50)", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: "1.35rem", fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
                  {loading ? "…" : value}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1.5rem" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "rgba(255,255,255,0.85)", marginBottom: "1rem" }}>Booking Status Distribution</h2>
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "#7dd3fc" }}></div>
            </div>
          ) : (
            <Chart type="doughnut" data={bookingStatusChartData} />
          )}
        </div>

        <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", padding: "1.5rem" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "rgba(255,255,255,0.85)", marginBottom: "1rem" }}>Customer Verification Status</h2>
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "#7dd3fc" }}></div>
            </div>
          ) : (
            <Chart type="bar" data={verificationChartData} />
          )}
        </div>
      </div>

      {/* Recent Customers */}
      <div style={{ borderRadius: "1rem", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)", background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>Recent Customers</h2>
          <Link
            href="/admin/users/list"
            className="inline-flex items-center transition-colors no-underline"
            style={{ color: "#6ee7b7" }}
            title="View All"
          >
            <Eye className="h-5 w-5" />
          </Link>
        </div>
        {loading ? (
          <div className="px-6 py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2" style={{ borderColor: "rgba(255,255,255,0.12)", borderTopColor: "#6ee7b7" }}></div>
            <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>Loading customers...</p>
          </div>
        ) : summary.recentCustomers && summary.recentCustomers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th className="px-6 py-3 text-left" style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Customer</th>
                  <th className="px-6 py-3 text-left" style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Contact</th>
                  <th className="px-6 py-3 text-left" style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Verification</th>
                  <th className="px-6 py-3 text-left" style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Joined</th>
                  <th className="px-6 py-3 text-right" style={{ fontSize: "0.68rem", fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(summary.recentCustomers ?? []).slice(0, 5).map((customer) => (
                  <tr key={customer.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium" style={{ color: "rgba(255,255,255,0.88)" }}>{customer.name || "N/A"}</div>
                      <div className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>{customer.email}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                      {customer.phone || "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {customer.emailVerifiedAt && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: "rgba(147,51,234,0.20)", border: "1px solid rgba(196,181,253,0.35)", color: "#c4b5fd" }}>
                            <Mail className="h-3 w-3" />
                            Email
                          </span>
                        )}
                        {customer.phoneVerifiedAt && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.35)", color: "#6ee7b7" }}>
                            <Phone className="h-3 w-3" />
                            Phone
                          </span>
                        )}
                        {customer.twoFactorEnabled && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium" style={{ background: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.35)", color: "#fcd34d" }}>
                            <Lock className="h-3 w-3" />
                            2FA
                          </span>
                        )}
                        {!customer.emailVerifiedAt && !customer.phoneVerifiedAt && !customer.twoFactorEnabled && (
                          <span className="text-xs" style={{ color: "rgba(255,255,255,0.30)" }}>None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>{new Date(customer.createdAt).toLocaleDateString()}</div>
                      <div className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {new Date(customer.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <Link
                        href={`/admin/users/${customer.id}`}
                        className="inline-flex items-center justify-center transition-colors no-underline"
                        style={{ color: "#6ee7b7" }}
                        title="View user details"
                      >
                        <Eye className="h-5 w-5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 0.75rem" }}>
              <Users style={{ width: 22, height: 22, color: "rgba(255,255,255,0.30)" }} />
            </div>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.40)" }}>No recent customers found.</p>
          </div>
        )}
      </div>
    </div>
  );
}


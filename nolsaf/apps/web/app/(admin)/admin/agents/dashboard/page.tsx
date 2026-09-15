"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  CreditCard,
  Info,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

const api = apiClient;

type AgentLite = {
  id: number;
  status: string;
  isAvailable: boolean;
  currentActiveRequests: number;
  maxActiveRequests: number;
  user?: {
    name?: string | null;
    email?: string | null;
  };
};

function authify() {}

export default function AdminAgentsDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [totalAgents, setTotalAgents] = useState(0);
  const [activeAgents, setActiveAgents] = useState(0);
  const [suspendedAgents, setSuspendedAgents] = useState(0);
  const [availableAgents, setAvailableAgents] = useState(0);
  const [recentAgents, setRecentAgents] = useState<AgentLite[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      authify();

      const [allRes, activeRes, suspendedRes, availableRes, recentRes] =
        await Promise.all([
          api.get("/api/admin/agents", { params: { page: 1, pageSize: 1 } }),
          api.get("/api/admin/agents", { params: { page: 1, pageSize: 1, status: "ACTIVE" } }),
          api.get("/api/admin/agents", { params: { page: 1, pageSize: 1, status: "SUSPENDED" } }),
          api.get("/api/admin/agents", { params: { page: 1, pageSize: 1, available: "true" } }),
          api.get("/api/admin/agents", { params: { page: 1, pageSize: 8 } }),
        ]);

      const unwrap = (d: any) => (d && typeof d === "object" && "data" in d ? d.data : d);

      const allData = unwrap(allRes.data);
      const activeData = unwrap(activeRes.data);
      const suspendedData = unwrap(suspendedRes.data);
      const availableData = unwrap(availableRes.data);
      const recentData = unwrap(recentRes.data);

      const recentItems = Array.isArray(recentData?.items) ? (recentData.items as AgentLite[]) : [];

      setTotalAgents(Number(allData?.total || 0));
      setActiveAgents(Number(activeData?.total || 0));
      setSuspendedAgents(Number(suspendedData?.total || 0));
      setAvailableAgents(Number(availableData?.total || 0));
      setRecentAgents(recentItems);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to load agent dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const heroStats = [
    { label: "Agents", value: totalAgents, icon: Users, color: "from-blue-500 to-blue-600" },
    { label: "Active", value: activeAgents, icon: Building2, color: "from-emerald-500 to-emerald-600" },
    { label: "Available", value: availableAgents, icon: Bot, color: "from-cyan-500 to-cyan-600" },
    { label: "Suspended", value: suspendedAgents, icon: Info, color: "from-amber-500 to-amber-600" },
  ];

  const quickShortcuts = [
    {
      label: "Tour Operator",
      hint: "Approved operator list and actions",
      href: "/admin/agents/tour-operators",
      icon: Building2,
      tone: "from-emerald-600 to-teal-500",
      featured: true,
    },
    {
      label: "Tour Booking",
      hint: "Trips that include tour activity",
      href: "/admin/agents/tour-bookings",
      icon: CalendarDays,
      tone: "from-cyan-600 to-sky-500",
    },
    {
      label: "Payments",
      hint: "Payouts, settlements and invoices",
      href: "/admin/payments",
      icon: CreditCard,
      tone: "from-orange-500 to-amber-500",
    },
    {
      label: "Revenue",
      hint: "NoLSAF commissions from bookings",
      href: "/admin/revenue",
      icon: BarChart3,
      tone: "from-indigo-600 to-violet-500",
    },
    {
      label: "Twiga Assistant",
      hint: "Agent support and AI operations",
      href: "/admin/agents/ai",
      icon: Sparkles,
      tone: "from-[#02665e] to-[#0a7e74]",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 w-full">
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)" }}
      >
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 220"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="860" cy="45" r="200" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
          <circle cx="860" cy="45" r="155" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
          <circle cx="820" cy="15" r="115" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          <circle cx="28" cy="208" r="130" stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
          {[44, 88, 132, 176].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.030)" strokeWidth="1" />
          ))}
          <polyline
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78"
            fill="none"
            stroke="white"
            strokeOpacity="0.16"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78 900,220 0,220"
            fill="white"
            fillOpacity="0.026"
          />
          <polyline
            points="0,200 100,186 200,194 300,172 400,180 500,160 600,168 700,148 800,156 900,136"
            fill="none"
            stroke="white"
            strokeOpacity="0.07"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {([[720, 90], [560, 108], [880, 78], [240, 145]] as [number, number][]).map(([px, py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3" fill="white" fillOpacity="0.22" />
          ))}
          <radialGradient id="agentsDashboardHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(10,92,130,0.45)" />
            <stop offset="100%" stopColor="rgba(10,92,130,0)" />
          </radialGradient>
          <ellipse cx="450" cy="110" rx="300" ry="140" fill="url(#agentsDashboardHeaderGlow)" />
        </svg>

        <button
          type="button"
          onClick={() => void load()}
          className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-all duration-150 hover:bg-white/15 focus:outline-none"
          style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }}
          title="Refresh No4P agents dashboard"
          aria-label="Refresh No4P agents dashboard"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>

        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 sm:py-14">
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
            <Bot className="h-7 w-7" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>

          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            No4P Agents Dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.60)" }}>
            Bookings, workload, verification and assistant operations.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <div className="relative group/tooltip inline-flex">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-150 focus:outline-none"
                style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.70)" }}
                aria-label="Agent dashboard info"
                onClick={(e) => {
                  e.preventDefault();
                  try {
                    (e.currentTarget as HTMLButtonElement).focus();
                  } catch {
                    // ignore
                  }
                }}
              >
                <Info className="h-3.5 w-3.5" aria-hidden />
                <span>Control hub</span>
              </button>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 w-72 max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-xl px-3 py-2.5 text-left text-xs opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
                style={{ background: "#0b2a38", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.85)" }}
              >
                <div className="font-semibold mb-1" style={{ color: "#fff" }}>No4P control hub</div>
                <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                  Monitor agent capacity, active records, assistant operations and tour-commerce workflows.
                </div>
              </div>
            </div>

            <Link
              href="/admin/agents"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-white no-underline transition-all duration-150 hover:bg-white/15"
              style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }}
            >
              <Users className="h-3.5 w-3.5" />
              Open All Agents
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {heroStats.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="group relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-5 transition-opacity duration-200`} />
              <div className="relative z-10">
                <div className={`inline-flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-br ${item.color} text-white shadow-sm`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-3 text-xl font-black text-gray-900">{item.value}</div>
                <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">{item.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-black text-slate-900">No4P Action Shortcuts</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Control Hub</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {quickShortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`group rounded-xl border p-3 no-underline transition hover:-translate-y-0.5 hover:shadow-md ${
                  item.featured
                    ? "border-emerald-300 bg-emerald-50/70"
                    : "border-slate-200 bg-slate-50/80 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow ${item.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{item.label}</div>
                    <div className="truncate text-xs text-slate-500">{item.hint}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Operations Control</h2>
          <p className="mt-1 text-sm text-slate-500">Use this as the major control dashboard for your tour-agent operations.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link href="/admin/agents" className="rounded-lg border border-slate-200 bg-slate-50 p-4 no-underline hover:bg-slate-100">
              <div className="text-sm font-bold text-slate-900">All Agents</div>
              <div className="mt-1 text-xs text-slate-500">Manage profiles, workload, documents, suspension, restore.</div>
            </Link>
            <Link href="/admin/agents/ai" className="rounded-lg border border-slate-200 bg-slate-50 p-4 no-underline hover:bg-slate-100">
              <div className="text-sm font-bold text-slate-900">Twiga</div>
              <div className="mt-1 text-xs text-slate-500">Assistant operations, conversations, and support automation.</div>
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Recent Agents</h2>
          <p className="mt-1 text-sm text-slate-500">Snapshot from latest loaded records.</p>
          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="text-sm text-slate-500">Loading...</div>
            ) : recentAgents.length === 0 ? (
              <div className="text-sm text-slate-500">No agents found.</div>
            ) : (
              recentAgents.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-800">{a.user?.name || "N/A"}</div>
                    <div className="truncate text-xs text-slate-500">{a.user?.email || "-"}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                    String(a.status).toUpperCase() === "ACTIVE"
                      ? "bg-emerald-50 text-emerald-700"
                      : String(a.status).toUpperCase() === "SUSPENDED"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700"
                  }`}>
                    {a.status || "UNKNOWN"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

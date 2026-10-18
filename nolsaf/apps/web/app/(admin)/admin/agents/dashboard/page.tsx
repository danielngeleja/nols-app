"use client";

// No4P agents home, built around a "dispatch floor": every agent is a seat that
// fills with their live request load, beside a gauge of team capacity. Status
// cards dim the floor and filter the roster. Totals come from per-status counts
// on /api/admin/agents; the floor is one pageSize=100 read of the roster.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CreditCard,
  Loader2,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type AgentLite = {
  id: number;
  status: string;
  isAvailable: boolean;
  currentActiveRequests: number;
  maxActiveRequests: number;
  level?: string | null;
  user?: {
    name?: string | null;
    fullName?: string | null;
    email?: string | null;
    region?: string | null;
  };
};

type StatusKey = "" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
type SeatState = "open" | "busy" | "full" | "off" | "suspended";

const FLOOR_SIZE = 100;

const heroButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";

const STATUS_STYLE: Record<string, { label: string; pill: string }> = {
  ACTIVE: { label: "Active", pill: "bg-emerald-50 text-emerald-700" },
  INACTIVE: { label: "Inactive", pill: "bg-slate-100 text-slate-600" },
  SUSPENDED: { label: "Suspended", pill: "bg-rose-50 text-rose-700" },
};
const statusOf = (s?: string) => STATUS_STYLE[String(s || "").toUpperCase()] ?? { label: s || "Unknown", pill: "bg-amber-50 text-amber-700" };

// Seat colours on the dark floor: fill shows load, edge shows state.
const SEAT: Record<SeatState, { label: string; fill: string; edge: string; text: string }> = {
  open: { label: "Open for work", fill: "#34d399", edge: "rgba(52,211,153,0.55)", text: "text-emerald-100" },
  busy: { label: "Working", fill: "#2dd4bf", edge: "rgba(45,212,191,0.55)", text: "text-teal-50" },
  full: { label: "At capacity", fill: "#fbbf24", edge: "rgba(251,191,36,0.7)", text: "text-amber-50" },
  off: { label: "Off the floor", fill: "transparent", edge: "rgba(255,255,255,0.12)", text: "text-white/35" },
  suspended: { label: "Suspended", fill: "transparent", edge: "rgba(251,113,133,0.6)", text: "text-rose-300" },
};

const TOOLS = [
  { title: "Tour operators", subtitle: "Approved operators and actions", href: "/admin/agents/tour-operators", icon: Building2 },
  { title: "Tour bookings", subtitle: "Trips that include tour activity", href: "/admin/agents/tour-bookings", icon: CalendarDays },
  { title: "All agents", subtitle: "Profiles, workload, documents", href: "/admin/agents", icon: Users },
  { title: "Payments", subtitle: "Payouts, settlements and invoices", href: "/admin/payments", icon: CreditCard },
  { title: "Revenue", subtitle: "NoLSAF commissions from bookings", href: "/admin/revenue", icon: BarChart3 },
  { title: "Twiga assistant", subtitle: "Conversations and support automation", href: "/admin/agents/ai", icon: Sparkles },
];

const unwrap = (d: any) => (d && typeof d === "object" && "data" in d ? d.data : d);
const nameOf = (a: AgentLite) => a.user?.fullName || a.user?.name || a.user?.email || "Unnamed agent";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function loadOf(a: AgentLite) {
  const max = Math.max(1, Number(a.maxActiveRequests || 0));
  return Math.min(1, Number(a.currentActiveRequests || 0) / max);
}

function seatOf(a: AgentLite): SeatState {
  const status = String(a.status || "").toUpperCase();
  if (status === "SUSPENDED") return "suspended";
  if (status !== "ACTIVE") return "off";
  const load = loadOf(a);
  if (load >= 1) return "full";
  if (!a.isAvailable) return "off";
  return load > 0 ? "busy" : "open";
}

// Half-ring gauge of request slots in use across active agents.
function CapacityGauge({ used, slots, loading }: { used: number; slots: number; loading: boolean }) {
  const share = slots > 0 ? Math.min(1, used / slots) : 0;
  const r = 70;
  const arc = Math.PI * r;
  const tone = share >= 0.85 ? "#fbbf24" : "#34d399";
  return (
    <div className="relative mx-auto w-[11.5rem]">
      <svg viewBox="0 0 180 100" className="block w-full" aria-hidden>
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" strokeLinecap="round" />
        <path
          d="M 20 90 A 70 70 0 0 1 160 90"
          fill="none"
          stroke={tone}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${arc * share} ${arc}`}
          style={{ transition: "stroke-dasharray 700ms ease" }}
        />
        {[0.25, 0.5, 0.75].map((t) => {
          const ang = Math.PI * (1 - t);
          return <line key={t} x1={90 + 54 * Math.cos(ang)} y1={90 - 54 * Math.sin(ang)} x2={90 + 59 * Math.cos(ang)} y2={90 - 59 * Math.sin(ang)} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />;
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{loading ? "..." : `${Math.round(share * 100)}%`}</p>
        <p className="m-0 mt-1 text-[11px] text-white/55">{loading ? "Reading the floor" : `${used} of ${slots} request slots in use`}</p>
      </div>
    </div>
  );
}

export default function AdminAgentsDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ total: 0, active: 0, inactive: 0, suspended: 0, available: 0 });
  const [floor, setFloor] = useState<AgentLite[]>([]);
  const [filter, setFilter] = useState<StatusKey>("");
  const [hovered, setHovered] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const count = (params: Record<string, string>) =>
        apiClient.get("/api/admin/agents", { params: { page: 1, pageSize: 1, ...params } }).then((r) => Number(unwrap(r.data)?.total || 0));
      const [total, active, inactive, suspended, available, floorRes] = await Promise.all([
        count({}),
        count({ status: "ACTIVE" }),
        count({ status: "INACTIVE" }),
        count({ status: "SUSPENDED" }),
        count({ available: "true" }),
        apiClient.get("/api/admin/agents", { params: { page: 1, pageSize: FLOOR_SIZE } }),
      ]);
      setCounts({ total, active, inactive, suspended, available });
      const items = unwrap(floorRes.data)?.items;
      setFloor(Array.isArray(items) ? (items as AgentLite[]) : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to load agent dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const capacity = useMemo(() => {
    const active = floor.filter((a) => String(a.status).toUpperCase() === "ACTIVE");
    const tally: Record<SeatState, number> = { open: 0, busy: 0, full: 0, off: 0, suspended: 0 };
    floor.forEach((a) => { tally[seatOf(a)] += 1; });
    return {
      used: active.reduce((s, a) => s + Number(a.currentActiveRequests || 0), 0),
      slots: active.reduce((s, a) => s + Number(a.maxActiveRequests || 0), 0),
      tally,
    };
  }, [floor]);

  const matches = (a: AgentLite) => !filter || String(a.status).toUpperCase() === filter;
  // Busiest first, so the people closest to capacity are what you see.
  const roster = useMemo(
    () => floor.filter(matches).sort((x, y) => loadOf(y) - loadOf(x) || nameOf(x).localeCompare(nameOf(y))).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [floor, filter],
  );
  const hoveredAgent = hovered != null ? floor.find((a) => a.id === hovered) : null;
  const show = (n: number) => (loading ? "..." : n.toLocaleString());

  const track: Array<{ key: StatusKey; label: string; value: number; hint: string; icon: typeof Users }> = [
    { key: "", label: "All agents", value: counts.total, hint: "Every No4P agent on record", icon: Users },
    { key: "ACTIVE", label: "Active", value: counts.active, hint: `${counts.available} taking new requests`, icon: CircleCheck },
    { key: "INACTIVE", label: "Inactive", value: counts.inactive, hint: "Not assigned work right now", icon: PauseCircle },
    { key: "SUSPENDED", label: "Suspended", value: counts.suspended, hint: counts.suspended ? "Review before restoring" : "No one suspended", icon: ShieldAlert },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Dispatch floor */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
          aria-hidden
        />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                <Bot className="h-3.5 w-3.5" /> No4P agents
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70">
                  <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span>
                  Live floor
                </span>
              </p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Dispatch floor</h1>
              <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Every seat is an agent. It fills as their request load climbs.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/agents" className={heroButton}><Users className="h-3.5 w-3.5" /> All agents</Link>
              <Link href="/admin/agents/tour-operators" className={heroButton}><Building2 className="h-3.5 w-3.5" /> Tour operators</Link>
              <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 px-0`} aria-label="Refresh dispatch floor" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-center">
            <div className="lg:border-0 lg:border-r lg:border-solid lg:border-white/10 lg:pr-6">
              <CapacityGauge used={capacity.used} slots={capacity.slots} loading={loading} />
              <p className="m-0 mt-3 text-center text-[11px] text-white/45">
                {loading ? " " : `${counts.available} of ${counts.active} active agents available`}
              </p>
            </div>

            <div className="min-w-0">
              {loading && floor.length === 0 ? (
                <div className="flex h-24 items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Seating the team</div>
              ) : floor.length === 0 ? (
                <p className="m-0 text-sm text-white/50">No agents on the floor yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0" onMouseLeave={() => setHovered(null)}>
                  {floor.map((a) => {
                    const state = seatOf(a);
                    const seat = SEAT[state];
                    const pct = Math.round(loadOf(a) * 100);
                    const dim = !matches(a);
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onMouseEnter={() => setHovered(a.id)}
                          onFocus={() => setHovered(a.id)}
                          onClick={() => setFilter(String(a.status).toUpperCase() as StatusKey)}
                          aria-label={`${nameOf(a)}, ${seat.label}, ${a.currentActiveRequests} of ${a.maxActiveRequests} requests`}
                          className={`relative grid h-11 w-11 place-items-center overflow-hidden rounded-xl border-0 bg-white/[0.04] p-0 transition-all duration-200 hover:-translate-y-0.5 ${dim ? "opacity-20" : ""} ${hovered === a.id ? "scale-110" : ""}`}
                          style={{ boxShadow: `inset 0 0 0 1.5px ${seat.edge}` }}
                        >
                          <span className="absolute inset-x-0 bottom-0 transition-all duration-700" style={{ height: `${state === "off" || state === "suspended" ? 0 : Math.max(pct, 8)}%`, background: seat.fill, opacity: 0.35 }} aria-hidden />
                          {state === "suspended" && <span className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(251,113,133,0.18)_0_4px,transparent_4px_8px)]" aria-hidden />}
                          <span className={`relative text-[11px] font-bold ${seat.text}`}>{initials(nameOf(a))}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Readout: hovered seat, else the legend */}
              <div className="mt-4 flex min-h-[1.75rem] flex-wrap items-center gap-x-4 gap-y-1.5 border-0 border-t border-solid border-white/10 pt-3 text-[11px]">
                {hoveredAgent ? (
                  <>
                    <span className="font-semibold text-white">{nameOf(hoveredAgent)}</span>
                    <span className="text-white/55">{SEAT[seatOf(hoveredAgent)].label}</span>
                    <span className="tabular-nums text-white/55">{hoveredAgent.currentActiveRequests}/{hoveredAgent.maxActiveRequests} requests</span>
                    {hoveredAgent.user?.region ? <span className="text-white/55">{hoveredAgent.user.region}</span> : null}
                    {hoveredAgent.level ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/75">{hoveredAgent.level}</span> : null}
                  </>
                ) : (
                  (Object.keys(SEAT) as SeatState[]).map((k) => (
                    <span key={k} className="inline-flex items-center gap-1.5 text-white/55">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SEAT[k].fill === "transparent" ? "transparent" : SEAT[k].fill, boxShadow: `inset 0 0 0 1.5px ${SEAT[k].edge}` }} />
                      {SEAT[k].label}
                      <span className="tabular-nums text-white/80">{capacity.tally[k]}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
          {counts.total > FLOOR_SIZE && (
            <p className="m-0 mt-3 text-[11px] text-white/40">Showing the newest {FLOOR_SIZE} of {counts.total} agents on the floor.</p>
          )}
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Status track: dims the floor and filters the roster */}
      <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {track.map((step) => {
            const Icon = step.icon;
            const active = filter === step.key;
            return (
              <button
                key={step.key || "all"}
                type="button"
                onClick={() => setFilter(step.key)}
                aria-pressed={active}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${active ? "border-neutral-900 bg-emerald-50/50" : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-800">{step.label}</span>
                  <Icon className="h-4 w-4 text-neutral-400" />
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{show(step.value)}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{step.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Roster, busiest first */}
        <section className="min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
              {filter ? `${statusOf(filter).label} agents, busiest first` : "Busiest agents"}
            </p>
            <Link href="/admin/agents" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">
              Open roster <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {loading && floor.length === 0 ? (
            <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-14 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading agents
            </div>
          ) : roster.length === 0 ? (
            <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                <Users className="h-5 w-5" />
              </span>
              <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">{filter ? `No ${statusOf(filter).label.toLowerCase()} agents` : "No agents yet"}</p>
              <p className="m-0 mt-1 text-xs text-neutral-500">Agents appear here once a hired application is provisioned.</p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {roster.map((a) => {
                const name = nameOf(a);
                const st = statusOf(a.status);
                const state = seatOf(a);
                const pct = Math.round(loadOf(a) * 100);
                return (
                  <li
                    key={a.id}
                    onMouseEnter={() => setHovered(a.id)}
                    onMouseLeave={() => setHovered(null)}
                    className={`flex items-center gap-3 border-0 border-t border-solid border-neutral-100 px-5 py-3 transition-colors ${hovered === a.id ? "bg-emerald-50/40" : ""}`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0b2420] text-xs font-bold text-emerald-200">{initials(name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{name}</span>
                      <span className="block truncate text-[11px] text-neutral-500">
                        {[a.user?.email, a.user?.region].filter(Boolean).join(" · ") || "No contact on file"}
                      </span>
                    </span>
                    <span className="hidden w-28 shrink-0 sm:block" title={`${a.currentActiveRequests} of ${a.maxActiveRequests} active requests`}>
                      <span className="flex items-center justify-between text-[10px] font-semibold text-neutral-500">
                        <span>Load</span>
                        <span className="tabular-nums">{a.currentActiveRequests}/{a.maxActiveRequests}</span>
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
                        <span className={`block h-full rounded-full ${state === "full" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${st.pill}`}>{st.label}</span>
                      <span className={`text-[10px] font-semibold ${a.isAvailable ? "text-emerald-600" : "text-neutral-400"}`}>{a.isAvailable ? "Available" : "Unavailable"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Tools */}
        <section className="min-w-0 self-start rounded-2xl border border-solid border-neutral-200 bg-white">
          <p className="m-0 px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Tools</p>
          <div className="grid grid-cols-1 gap-px px-2 pb-2">
            {TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="group flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5 no-underline transition hover:bg-neutral-50 hover:no-underline">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#02665e]/[0.08] text-[#02665e] transition group-hover:bg-[#02665e] group-hover:text-white"><t.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-neutral-900">{t.title}</span>
                  <span className="block truncate text-[11px] text-neutral-500">{t.subtitle}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-500" />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

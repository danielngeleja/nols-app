"use client";
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import ReportsFilter, { ReportsFilters } from "@/components/ReportsFilter";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, BarChart3, BedDouble, CalendarDays, Coins, TrendingUp } from "lucide-react";

// Use same-origin requests to leverage Next.js rewrites and avoid CORS
const api = apiClient;

export default function Overview() {
  const [filters, setFilters] = useState<ReportsFilters | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filters) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    api
      .get("/api/owner/reports/overview", { params: filters })
      .then((r) => {
        if (!mounted) return;
        setData(r.data);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setData(null);
        setError(e?.response?.data?.error ?? e?.message ?? "Failed to load reports overview");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [filters]);

  const series = useMemo(() => {
    const s = Array.isArray(data?.series) ? data.series : [];
    return s.map((p: any) => ({
      key: String(p.key ?? ""),
      gross: Number(p.gross ?? 0),
      net: Number(p.net ?? 0),
      bookings: Number(p.bookings ?? 0),
    }));
  }, [data]);

  const status = useMemo(() => {
    const s = Array.isArray(data?.status) ? data.status : [];
    return s
      .map((p: any) => ({ status: String(p.status ?? ""), count: Number(p.count ?? 0) }))
      .sort((a: any, b: any) => b.count - a.count);
  }, [data]);

  const topProperties = useMemo(() => {
    const s = Array.isArray(data?.topProperties) ? data.topProperties : [];
    return s.map((p: any) => ({
      propertyId: Number(p.propertyId ?? 0),
      title: String(p.title ?? ""),
      net: Number(p.net ?? 0),
    }));
  }, [data]);

  const maxTopNet = useMemo(() => {
    return topProperties.reduce((m: number, p: any) => Math.max(m, Number(p.net ?? 0)), 0) || 1;
  }, [topProperties]);

  return (
    <div className="space-y-6">
      <ReportsFilter onChangeAction={setFilters} />

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold">Reports could not be loaded</div>
            <div className="text-amber-800/90 break-words">{error}</div>
          </div>
        </div>
      ) : null}

      {/* KPI strip: one card, six figures, no accent stripes */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)] sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Coins} title="Gross revenue" value={data ? `TZS ${fmt(data.kpis.gross)}` : "Not available"} hint="Before commission" loading={loading} lead />
        <Kpi icon={TrendingUp} title="Net revenue" value={data ? `TZS ${fmt(data.kpis.net)}` : "Not available"} hint="Your share" loading={loading} lead />
        <Kpi icon={BarChart3} title="Bookings" value={data ? String(data.kpis.bookings) : "Not available"} hint="In this period" loading={loading} />
        <Kpi icon={BedDouble} title="Nights" value={data ? String(data.kpis.nights) : "Not available"} hint="Nights sold" loading={loading} />
        <Kpi icon={CalendarDays} title="Average rate" value={data ? `TZS ${fmt(data.kpis.adr)}` : "Not available"} hint="Per night (ADR)" loading={loading} />
        <Kpi icon={BarChart3} title="Occupancy" value="Not tracked yet" hint="Not calculated yet" loading={false} muted />
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 px-5 py-4">
            <div>
              <div className="text-sm font-bold text-slate-900">Revenue trend</div>
              <div className="mt-0.5 text-xs text-slate-500">Gross and net over the selected period</div>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#9fd8cc]" aria-hidden />Gross</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#02665e]" aria-hidden />Net</span>
            </div>
          </div>
          <div className="p-4">
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={series} margin={{ left: 8, right: 16, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grossFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#9fd8cc" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#9fd8cc" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#02665e" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#02665e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eef2f1" vertical={false} />
                  <XAxis dataKey="key" tickFormatter={shortDay} minTickGap={16} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={fmtCompact}
                  />
                  <Tooltip content={<MoneyTooltip />} />
                  <Area type="monotone" dataKey="gross" name="Gross" stroke="#5eb8a8" strokeWidth={2} fill="url(#grossFill)" />
                  <Area type="monotone" dataKey="net" name="Net" stroke="#02665e" strokeWidth={2.25} fill="url(#netFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white">
          <div className="border-0 border-b border-solid border-slate-200 px-5 py-4">
            <div className="text-sm font-bold text-slate-900">Bookings by status</div>
            <div className="mt-0.5 text-xs text-slate-500">How the bookings in this period ended</div>
          </div>
          <div className="p-4">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={status} margin={{ left: 8, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#eef2f1" vertical={false} />
                  <XAxis dataKey="status" tickFormatter={statusLabel} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CountTooltip />} />
                  <Bar dataKey="count" name="Count" radius={[8, 8, 0, 0]}>
                    {status.map((entry: any, idx: number) => (
                      <Cell
                        key={`cell-${entry.status ?? idx}`}
                        fill={getStatusColor(String(entry.status ?? ""))}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Top properties */}
      <div className="overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white">
        <div className="border-0 border-b border-solid border-slate-200 px-5 py-4">
          <div className="text-sm font-bold text-slate-900">Top properties</div>
          <div className="mt-0.5 text-xs text-slate-500">Highest net revenue in this period</div>
        </div>
        <div className="p-4">
          {topProperties.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">No revenue for these filters. Try a longer range or another property.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topProperties.map((p: any) => {
                const pct = Math.max(0, Math.min(100, (p.net / maxTopNet) * 100));
                return (
                  <div key={p.propertyId} className="rounded-xl border border-solid border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{p.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">Net revenue</div>
                      </div>
                      <div className="text-sm font-bold tabular-nums text-[#02665e] whitespace-nowrap">TZS {fmt(p.net)}</div>
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-[#02665e] rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  // Brand-aligned palette (teal/green/amber/red/purple) to avoid a "uniform" look.
  switch (status) {
    case "NEW":
      return "#02665e"; // brand
    case "CONFIRMED":
      return "#0d9488"; // teal
    case "CHECKED_IN":
      return "#16a34a"; // green
    case "CHECKED_OUT":
      return "#f59e0b"; // amber
    case "CANCELED":
      return "#ef4444"; // red
    default:
      return "#64748b"; // slate
  }
}

function Kpi({
  icon: Icon,
  title,
  value,
  hint,
  loading,
  lead,
  muted,
}: {
  icon: any;
  title: string;
  value: string;
  hint?: string;
  loading: boolean;
  lead?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white px-4 py-4">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${lead ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</span>
      </div>
      <div className={`mt-2 truncate font-bold tabular-nums leading-tight ${muted ? "text-sm text-slate-400" : lead ? "text-xl text-slate-900" : "text-xl text-slate-900"}`}>
        {loading ? <Skeleton widthClass="w-20" /> : value}
      </div>
      {hint ? <div className="mt-1 truncate text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

/** "2026-10-07" -> "07 Oct"; weeks and months pass through unchanged. */
function shortDay(key: any): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!m) return String(key);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${m[3]} ${months[Number(m[2]) - 1] ?? ""}`;
}

function statusLabel(s: any): string {
  const v = String(s ?? "").toUpperCase();
  if (v === "CANCELED" || v === "CANCELLED") return "Cancelled";
  if (v === "CHECKED_IN") return "Checked in";
  if (v === "CHECKED_OUT") return "Checked out";
  if (v === "CONFIRMED") return "Confirmed";
  if (v === "NEW") return "Unpaid";
  return v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ");
}

function Skeleton({ widthClass }: { widthClass: string }) {
  return <div className={"h-6 rounded-md bg-slate-200/70 animate-pulse " + widthClass} />;
}

function fmt(n: number) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  return Math.round(num).toLocaleString();
}

function fmtCompact(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const items = payload
    .filter((p: any) => p?.dataKey === "gross" || p?.dataKey === "net")
    .map((p: any) => ({
      name: p.name,
      value: p.value,
      color: p.color,
    }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-lg px-3 py-2">
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div className="mt-1 space-y-1">
        {items.map((it: any) => (
          <div key={it.name} className="flex items-center justify-between gap-6 text-xs">
            <span className="inline-flex items-center gap-2 text-gray-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: it.color }} />
              {it.name}
            </span>
            <span className="font-semibold text-gray-900">TZS {fmt(it.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CountTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const v = payload?.[0]?.value;
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-lg px-3 py-2">
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div className="mt-1 text-xs text-gray-600">
        Count: <span className="font-semibold text-gray-900">{Number(v ?? 0)}</span>
      </div>
    </div>
  );
}

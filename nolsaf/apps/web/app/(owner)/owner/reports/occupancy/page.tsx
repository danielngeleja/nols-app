"use client";
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import ReportsFilter, { ReportsFilters } from "@/components/ReportsFilter";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Building2, Percent, TrendingUp } from "lucide-react";
// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function Occupancy() {
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
      .get("/api/owner/reports/occupancy", { params: filters })
      .then((r) => {
        if (!mounted) return;
        setData(r.data);
      })
      .catch((e: any) => {
        if (!mounted) return;
        setData(null);
        setError(e?.response?.data?.error ?? e?.message ?? "Failed to load occupancy report");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [filters]);

  const heat = useMemo(() => {
    const h = Array.isArray(data?.heat) ? data.heat : [];
    return h.map((p: any) => ({ date: String(p.date ?? ""), occupancy: Number(p.occupancy ?? 0) }));
  }, [data]);

  const byProperty = useMemo(() => {
    const b = Array.isArray(data?.byProperty) ? data.byProperty : [];
    return b
      .map((p: any) => ({ title: String(p.title ?? ""), net: Number(p.net ?? 0) }))
      .sort((a: any, b: any) => b.net - a.net);
  }, [data]);

  const propertyBarColors = useMemo(
    () => ["#16a34a", "#eab308", "#3b82f6", "#f97316", "#14b8a6", "#a855f7"],
    []
  );

  const kpis = useMemo(() => {
    if (!heat.length) return { avg: 0, peak: 0, days: 0 };
    const days = heat.length;
    const peak = heat.reduce((m: number, p: any) => Math.max(m, Number(p.occupancy ?? 0)), 0);
    const avg = heat.reduce((s: number, p: any) => s + Number(p.occupancy ?? 0), 0) / days;
    return { avg, peak, days };
  }, [heat]);

  return (
    <div className="space-y-6">
      <ReportsFilter onChangeAction={setFilters} />

      {error ? (
        <div className="rounded-lg border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold">Couldn’t load occupancy</div>
            <div className="text-amber-800/90 break-words">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Kpi icon={Percent} title="Avg occupancy" value={`${kpis.avg.toFixed(0)}%`} loading={loading} />
        <Kpi icon={TrendingUp} title="Peak occupancy" value={`${kpis.peak.toFixed(0)}%`} loading={loading} />
        <Kpi icon={Building2} title="Days" value={String(kpis.days)} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-lg border border-solid border-gray-200 shadow-sm overflow-hidden">
          <div className="border-0 px-5 py-4 border-b border-solid border-gray-200">
            <div className="text-sm font-semibold text-gray-900">Occupancy trend</div>
            <div className="text-xs text-gray-500 mt-0.5">Estimated occupancy percentage over time</div>
          </div>
          <div className="p-4">
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={heat} margin={{ left: 8, right: 16, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="occFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 12 }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
                  <YAxis
                    unit="%"
                    domain={[0, 100]}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    axisLine={{ stroke: "#e5e7eb" }}
                    tickLine={false}
                  />
                  <Tooltip content={<OccTooltip />} />
                  <Area type="monotone" dataKey="occupancy" name="Occupancy" stroke="#0ea5e9" strokeWidth={2} fill="url(#occFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-solid border-gray-200 shadow-sm overflow-hidden">
          <div className="border-0 px-5 py-4 border-b border-solid border-gray-200">
            <div className="text-sm font-semibold text-gray-900">Net revenue by property</div>
            <div className="text-xs text-gray-500 mt-0.5">Net totals for the selected window</div>
          </div>
          <div className="p-4">
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={byProperty} margin={{ left: 8, right: 10, top: 10, bottom: 10 }}>
                  <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                  <XAxis dataKey="title" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} axisLine={{ stroke: "#e5e7eb" }} tickLine={false} tickFormatter={fmtCompact} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Bar dataKey="net" name="Net" radius={[8, 8, 0, 0]}>
                    {byProperty.map((_: any, i: number) => (
                      <Cell key={i} fill={propertyBarColors[i % propertyBarColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, title, value, loading }: { icon: any; title: string; value: string; loading: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-solid border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-gray-50 border border-solid border-gray-200">
          <Icon className="h-4 w-4 text-gray-600" aria-hidden />
        </span>
        {title}
      </div>
      <div className="mt-2 text-xl font-bold text-gray-900">{loading ? <Skeleton widthClass="w-20" /> : value}</div>
    </div>
  );
}

function Skeleton({ widthClass }: { widthClass: string }) {
  return <div className={"h-6 rounded-md bg-gray-200/70 animate-pulse " + widthClass} />;
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

function OccTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const v = payload?.[0]?.value;
  return (
    <div className="rounded-lg border border-solid border-gray-200 bg-white shadow-lg px-3 py-2">
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div className="mt-1 text-xs text-gray-600">
        Occupancy: <span className="font-semibold text-gray-900">{Number(v ?? 0).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const v = payload?.[0]?.value;
  return (
    <div className="rounded-lg border border-solid border-gray-200 bg-white shadow-lg px-3 py-2">
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div className="mt-1 text-xs text-gray-600">
        Net: <span className="font-semibold text-gray-900">TZS {fmt(v ?? 0)}</span>
      </div>
    </div>
  );
}

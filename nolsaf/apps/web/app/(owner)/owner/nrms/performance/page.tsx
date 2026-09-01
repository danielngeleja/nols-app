"use client";

// Tailwind preflight is disabled in this app (corePlugins.preflight = false),
// so a bare `border-*` utility sets a width against border-style: none and
// renders nothing. Hairlines here are ring-* utilities for that reason.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BarChart3,
  Calculator,
  CalendarRange,
  Clock,
  Coins,
  Flame,
  Loader2,
  Receipt,
  RefreshCw,
  Store,
  Timer,
  TrendingUp,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ShiftPanel, { serviceLabelForRole } from "../_components/ShiftPanel";
import { useNrms } from "../_components/NrmsProvider";

type Period = "day" | "week" | "month" | "year";

type PerformanceBreakdownRow = {
  id: number;
  name: string;
  orders: number;
  sales: number;
  avgTicket: number;
  serving: { onTimeRate: number | null; servedCount: number };
};
type Performance = {
  period: Period | "custom";
  granularity: "hour" | "day" | "month";
  range: { from: string; to: string } | null;
  currency: string;
  outletId: number | null;
  outlets: Array<{ id: number; name: string; type: string }>;
  canFilterOutlet: boolean;
  attendantId: number | null;
  staff: Array<{ id: number; name: string; role: string; outletId: number | null }>;
  canFilterAttendant: boolean;
  breakdown: { byOutlet: PerformanceBreakdownRow[] | null; byStaff: PerformanceBreakdownRow[] | null };
  canManageShift: boolean;
  summary: {
    orders: number;
    sales: number;
    avgTicket: number;
    serving: { accept: number | null; prepare: number | null; serve: number | null; total: number | null; onTimeRate: number | null; servedCount: number };
  };
  series: Array<{ label: string; value: number }>;
  shift: { id: number; openedAt: string; openingFloat: number; expectedCash: number; currency: string; takenOverFrom: string | null } | null;
  handover: { shiftId: number; attendeeName: string; amount: number; closedAt: string; currency: string } | null;
};

const PERIODS: Array<{ id: Period; label: string; caption: string }> = [
  { id: "day", label: "Day", caption: "by hour" },
  { id: "week", label: "Week", caption: "by day" },
  { id: "month", label: "Month", caption: "by day" },
  { id: "year", label: "Year", caption: "by month" },
];

const STAGES: Array<{ key: "accept" | "prepare" | "serve"; label: string; target: number; hint: string }> = [
  { key: "accept", label: "Accepted", target: 4, hint: "Order reaches the outlet and is acknowledged" },
  { key: "prepare", label: "Prepared", target: 10, hint: "Kitchen or bar finishes the order" },
  { key: "serve", label: "Served", target: 6, hint: "Order leaves the pass and reaches the guest" },
];

const ON_TIME_MINUTES = 15;
const EMPTY = "n/a";

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Axis ticks: 60000000 must read as 60M, never as 60000k. */
function axisNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B`;
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${Number((value / 1_000).toFixed(0))}k`;
  return String(Math.round(value));
}

const BUCKET_NOUN = { hour: "hour", day: "day", month: "month" } as const;

export default function NrmsPerformancePage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [period, setPeriod] = useState<Period>("day");
  const [rangeMode, setRangeMode] = useState(false);
  const [rangeFrom, setRangeFrom] = useState(todayKey());
  const [rangeTo, setRangeTo] = useState(todayKey());
  const [outletId, setOutletId] = useState<number | "">("");
  const [attendantId, setAttendantId] = useState<number | "">("");
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const money = useCallback((value: number) => `${Math.round(value).toLocaleString()} ${data?.currency ?? selectedProperty?.currency ?? "TZS"}`, [data, selectedProperty]);

  const rangeValid = rangeFrom <= rangeTo;

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    if (rangeMode && !rangeValid) { setError("The start date must be on or before the end date."); return; }
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (rangeMode) { params.set("from", rangeFrom); params.set("to", rangeTo); }
      else params.set("period", period);
      if (outletId !== "") params.set("outletId", String(outletId));
      if (attendantId !== "") params.set("attendantId", String(attendantId));
      const res = await apiClient.get<Performance>(`/api/nrms/operations/property/${selectedPropertyId}/performance?${params.toString()}`);
      setData(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load performance");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, period, outletId, attendantId, rangeMode, rangeFrom, rangeTo, rangeValid]);

  useEffect(() => { void load(); }, [load]);

  // Memoised so the `?? []` fallback does not mint a new array every render
  // and invalidate everything derived from it.
  const series = useMemo(() => data?.series ?? [], [data]);
  const peak = useMemo(() => Math.max(0, ...series.map((point) => point.value)), [series]);
  // The series is gap-filled with zeros, so `length === 0` is never true on a
  // quiet day. Emptiness has to be judged on the values, otherwise the chart
  // draws a row of two-pixel stubs under an empty frame.
  const hasSales = peak > 0;
  const busiest = useMemo(
    () => (hasSales ? series.find((point) => point.value === peak) ?? null : null),
    [series, peak, hasSales],
  );

  const granularityCaption = { hour: "by hour", day: "by day", month: "by month" } as const;
  const activeCaption = rangeMode ? (data ? granularityCaption[data.granularity] : "") : (PERIODS.find((item) => item.id === period)?.caption ?? "");
  const bucketNoun = data ? BUCKET_NOUN[data.granularity] : "hour";

  const outletName = data?.outlets.find((outlet) => outlet.id === outletId)?.name ?? null;
  const staffName = data?.staff.find((member) => member.id === attendantId)?.name ?? null;
  const filtered = outletId !== "" || attendantId !== "";

  const breakdowns = [
    data?.breakdown.byOutlet ? { key: "outlet", title: "Outlet performance", icon: Store, rows: data.breakdown.byOutlet, onSelect: (id: number) => setOutletId(id) } : null,
    data?.breakdown.byStaff ? { key: "staff", title: "Staff performance", icon: UsersRound, rows: data.breakdown.byStaff, onSelect: (id: number) => setAttendantId(id) } : null,
  ].filter(Boolean) as Array<{ key: string; title: string; icon: typeof Store; rows: PerformanceBreakdownRow[]; onSelect: (id: number) => void }>;

  const servingKnown = data?.summary.serving.total != null || STAGES.some((stage) => data?.summary.serving[stage.key] != null);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 pb-10">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Outlet performance</p>
          <h1 className="mb-0 mt-1 truncate text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">{selectedProperty?.title ?? "Performance"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Sales, order flow and serving times for your bar and restaurant.</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          {(data?.canFilterOutlet && data.outlets.length > 1) || (data?.canFilterAttendant && data.staff.length > 0) ? (
            <div className="flex flex-wrap items-center gap-2">
              {data?.canFilterOutlet && data.outlets.length > 1 && (
                <label className="inline-flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 text-xs font-bold text-neutral-700 ring-1 ring-neutral-200 sm:flex-none">
                  <Store className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <span className="sr-only">Outlet</span>
                  <select value={outletId} onChange={(event) => setOutletId(event.target.value === "" ? "" : Number(event.target.value))} className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-2 text-xs font-bold outline-none">
                    <option value="">All outlets</option>
                    {data.outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                  </select>
                </label>
              )}
              {data?.canFilterAttendant && data.staff.length > 0 && (
                <label className="inline-flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 text-xs font-bold text-neutral-700 ring-1 ring-neutral-200 sm:flex-none">
                  <UsersRound className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  <span className="sr-only">Staff member</span>
                  <select value={attendantId} onChange={(event) => setAttendantId(event.target.value === "" ? "" : Number(event.target.value))} className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-2 text-xs font-bold outline-none">
                    <option value="">All staff</option>
                    {data.staff.filter((member) => outletId === "" || member.outletId == null || member.outletId === outletId).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            {/* Scrolls instead of wrapping, so the switcher stays one control on a phone. */}
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-xl bg-white p-1 ring-1 ring-neutral-200 sm:flex-none">
              {PERIODS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setPeriod(item.id); setRangeMode(false); }}
                  aria-pressed={!rangeMode && period === item.id}
                  className={`min-h-9 shrink-0 appearance-none rounded-lg border-0 px-3 text-xs font-bold transition ${!rangeMode && period === item.id ? "bg-emerald-800 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"}`}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setRangeMode(true)}
                aria-pressed={rangeMode}
                className={`inline-flex min-h-9 shrink-0 appearance-none items-center gap-1 rounded-lg border-0 px-3 text-xs font-bold transition ${rangeMode ? "bg-emerald-800 text-white shadow-sm" : "bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"}`}
              >
                <CalendarRange className="h-3.5 w-3.5" />Range
              </button>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh performance"
              className="inline-flex h-10 w-10 shrink-0 appearance-none items-center justify-center rounded-xl bg-white text-neutral-500 ring-1 ring-neutral-200 transition hover:text-emerald-700 hover:ring-emerald-200 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      {rangeMode && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-neutral-200">
          <div className="w-full sm:w-[150px]"><DatePickerField label="From" value={rangeFrom} onChangeAction={(next) => setRangeFrom(next.slice(0, 10))} max={rangeTo} allowPast widthClassName="!w-full" size="sm" twoMonths={false} /></div>
          <div className="w-full sm:w-[150px]"><DatePickerField label="To" value={rangeTo} onChangeAction={(next) => setRangeTo(next.slice(0, 10))} min={rangeFrom} max={todayKey()} allowPast widthClassName="!w-full" size="sm" twoMonths={false} /></div>
          <p className="mb-1.5 text-[11px] leading-4 text-neutral-400">Pick any period. The trend groups by hour, day or month to fit the span.</p>
        </div>
      )}

      {filtered && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-50/60 px-4 py-2.5 ring-1 ring-emerald-100">
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-800">Filtered</span>
          {outletName && <FilterChip label={outletName} onClear={() => setOutletId("")} />}
          {staffName && <FilterChip label={staffName} onClear={() => setAttendantId("")} />}
          <button
            type="button"
            onClick={() => { setOutletId(""); setAttendantId(""); }}
            className="ml-auto appearance-none border-0 bg-transparent p-0 text-[11px] font-bold text-emerald-800 underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {error && <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</div>}

      {loading && !data ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-3xl bg-white text-neutral-400 ring-1 ring-neutral-200">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading performance…
        </div>
      ) : data && (
        <div className={loading ? "space-y-4 opacity-60 transition" : "space-y-4 transition"}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Coins} label="Total sales" value={money(data.summary.sales)} hint={`${activeCaption} · ${data.summary.orders} order${data.summary.orders === 1 ? "" : "s"}`} tone="emerald" />
            <StatCard icon={Receipt} label="Orders" value={data.summary.orders.toLocaleString()} hint="Completed in this period" tone="blue" />
            <StatCard icon={Calculator} label="Avg ticket" value={data.summary.orders > 0 ? money(data.summary.avgTicket) : EMPTY} hint="Per completed order" tone="violet" />
            <StatCard
              icon={Timer}
              label="Avg serving time"
              value={data.summary.serving.total != null ? `${data.summary.serving.total} min` : EMPTY}
              hint={data.summary.serving.servedCount > 0 ? `Order to served, ${data.summary.serving.servedCount} measured` : "Nothing served yet"}
              tone={data.summary.serving.total != null && data.summary.serving.total > ON_TIME_MINUTES ? "amber" : "emerald"}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.6fr_1fr]">
            <section className="rounded-2xl bg-white p-4 ring-1 ring-neutral-200 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><BarChart3 className="h-4 w-4 text-emerald-700" />Sales trend</p>
                  <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-400">
                    {busiest
                      ? <>Busiest {bucketNoun}: <span className="font-bold text-neutral-600">{busiest.label}</span> at {money(busiest.value)}</>
                      : `Grouped ${activeCaption}`}
                  </p>
                </div>
                {hasSales && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                    <Flame className="h-3 w-3" />Peak {money(peak)}
                  </span>
                )}
              </div>

              {hasSales ? (
                <div className="mt-4 h-56 w-full sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="16%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={48} tickFormatter={axisNumber} />
                      <Tooltip
                        cursor={{ fill: "rgba(15,23,42,0.04)" }}
                        formatter={(value: number) => [money(Number(value)), "Sales"]}
                        contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }}
                      />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={46}>
                        {series.map((point, index) => (
                          <Cell key={index} fill={point.value === peak ? "#047857" : "#a7f3d0"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyBlock
                  icon={TrendingUp}
                  title="No sales in this period yet"
                  body={filtered
                    ? "Nothing was sold under the current filters. Clear them, or widen the period."
                    : `Completed and settled orders appear here, grouped ${activeCaption}.`}
                />
              )}
            </section>

            <section className="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-neutral-200 sm:p-5">
              <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><Clock className="h-4 w-4 text-emerald-700" />Serving time breakdown</p>
              <p className="mb-0 mt-1 text-[11px] text-neutral-400">Average minutes at each stage, against target</p>

              {servingKnown ? (
                <>
                  <div className="mt-4 space-y-3">
                    {STAGES.map((stage) => {
                      const mins = data.summary.serving[stage.key];
                      const over = mins != null && mins > stage.target;
                      const width = mins != null ? Math.min(100, (mins / stage.target) * 100) : 0;
                      return (
                        <div key={stage.key} title={stage.hint}>
                          <div className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span className="truncate text-neutral-600">{stage.label}</span>
                            <span className="shrink-0 tabular-nums">
                              <span className={`font-bold ${over ? "text-amber-600" : mins != null ? "text-neutral-900" : "text-neutral-300"}`}>{mins != null ? `${mins} min` : EMPTY}</span>
                              <span className="ml-1 text-neutral-300">/ {stage.target}</span>
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                            <div className={`h-full rounded-full transition-[width] duration-500 ${over ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="text-[11px] leading-4 text-neutral-500">On-time rate <span className="text-neutral-400">(under {ON_TIME_MINUTES} min)</span></span>
                    <span className={`text-lg font-bold tabular-nums ${data.summary.serving.onTimeRate == null ? "text-neutral-300" : data.summary.serving.onTimeRate >= 80 ? "text-emerald-700" : data.summary.serving.onTimeRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                      {data.summary.serving.onTimeRate != null ? `${data.summary.serving.onTimeRate}%` : EMPTY}
                    </span>
                  </div>
                </>
              ) : (
                <EmptyBlock icon={Clock} title="Nothing served yet" body="Serving times are measured from the moment an order is placed until it reaches the guest." compact />
              )}
            </section>
          </div>

          {breakdowns.length > 0 && (
            // One breakdown spans the full width rather than leaving a hole
            // where the other would have been.
            <div className={`grid gap-3 ${breakdowns.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {breakdowns.map((breakdown) => (
                <BreakdownTable
                  key={breakdown.key}
                  title={breakdown.title}
                  icon={breakdown.icon}
                  rows={breakdown.rows}
                  money={money}
                  onSelect={breakdown.onSelect}
                />
              ))}
            </div>
          )}

          {data.canManageShift && <ShiftPanel shift={data.shift} handover={data.handover} canManageShift={data.canManageShift} propertyId={selectedPropertyId!} money={money} serviceLabel={serviceLabelForRole(selectedProperty?.nrmsAccessRole)} onChanged={load} />}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-200">
      {label}
      <button type="button" onClick={onClear} aria-label={`Clear ${label}`} className="appearance-none border-0 bg-transparent p-0 text-emerald-500 transition hover:text-emerald-800">
        &times;
      </button>
    </span>
  );
}

function EmptyBlock({ icon: Icon, title, body, compact = false }: {
  icon: typeof TrendingUp; title: string; body: string; compact?: boolean;
}) {
  return (
    <div className={`mt-4 flex flex-col items-center justify-center rounded-xl bg-neutral-50/70 px-6 text-center outline outline-1 outline-dashed outline-neutral-200 ${compact ? "flex-1 py-10" : "h-56 sm:h-64"}`}>
      <Icon className="h-8 w-8 text-neutral-300" />
      <p className="mb-0 mt-3 text-sm font-bold text-neutral-700">{title}</p>
      <p className="mb-0 mt-1 max-w-xs text-xs leading-4 text-neutral-400">{body}</p>
    </div>
  );
}

function BreakdownTable({ title, icon: Icon, rows, money, onSelect }: {
  title: string; icon: typeof Store; rows: PerformanceBreakdownRow[];
  money: (value: number) => string; onSelect: (id: number) => void;
}) {
  const peak = Math.max(1, ...rows.map((row) => row.sales));
  const total = rows.reduce((sum, row) => sum + row.sales, 0);

  return (
    <section className="flex flex-col rounded-2xl bg-white p-4 ring-1 ring-neutral-200 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><Icon className="h-4 w-4 text-emerald-700" />{title}</p>
        {total > 0 && <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold tabular-nums text-neutral-600">{money(total)}</span>}
      </div>
      <p className="mb-0 mt-1 text-[11px] text-neutral-400">Ranked by sales for the selected period. Select a row to filter.</p>

      {rows.length === 0 ? (
        <EmptyBlock icon={UtensilsCrossed} title="No sales in this period yet" body="Once orders are settled, the ranking builds itself." compact />
      ) : (
        <ul className="m-0 mt-4 flex list-none flex-col gap-1 p-0">
          {rows.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                className="block w-full min-w-0 appearance-none rounded-xl border-0 bg-transparent p-2.5 text-left transition hover:bg-neutral-50"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums ${index === 0 ? "bg-emerald-700 text-white" : "bg-neutral-100 text-neutral-500"}`}>
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-neutral-800">{row.name}</span>
                  <span className="shrink-0 text-[13px] font-bold tabular-nums text-neutral-900">{money(row.sales)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                  <div className={`h-full rounded-full ${index === 0 ? "bg-emerald-600" : "bg-emerald-300"}`} style={{ width: `${Math.max(2, (row.sales / peak) * 100)}%` }} />
                </div>
                <p className="mb-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-400">
                  <span>{row.orders} order{row.orders === 1 ? "" : "s"}</span>
                  <span className="text-neutral-200">·</span>
                  <span>avg {money(row.avgTicket)}</span>
                  {row.serving.onTimeRate != null && (
                    <>
                      <span className="text-neutral-200">·</span>
                      <span className={row.serving.onTimeRate >= 80 ? "text-emerald-600" : row.serving.onTimeRate >= 60 ? "text-amber-600" : "text-red-500"}>
                        {row.serving.onTimeRate}% on time
                      </span>
                    </>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatCard({ icon: Icon, label, value, hint, tone }: {
  icon: typeof Coins; label: string; value: string; hint: string;
  tone: "emerald" | "blue" | "violet" | "amber";
}) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="flex min-w-0 flex-col rounded-2xl bg-white p-4 ring-1 ring-neutral-200">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-neutral-500">{label}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-3.5 w-3.5" /></span>
      </div>
      <p className="mb-0 mt-2 truncate text-xl font-bold tabular-nums tracking-tight text-neutral-950">{value}</p>
      <p className="mb-0 mt-auto truncate pt-1.5 text-[11px] text-neutral-400" title={hint}>{hint}</p>
    </div>
  );
}

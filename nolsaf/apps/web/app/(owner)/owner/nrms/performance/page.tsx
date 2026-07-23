"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, BarChart3, Calculator, Clock, Coins, Loader2, Receipt, Timer } from "lucide-react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type Period = "day" | "week" | "month" | "year";

type Performance = {
  period: Period;
  currency: string;
  outletId: number | null;
  outlets: Array<{ id: number; name: string; type: string }>;
  canFilterOutlet: boolean;
  canManageShift: boolean;
  summary: {
    orders: number;
    sales: number;
    avgTicket: number;
    serving: { accept: number | null; prepare: number | null; serve: number | null; total: number | null; onTimeRate: number | null; servedCount: number };
  };
  series: Array<{ label: string; value: number }>;
  shift: { id: number; openedAt: string; openingFloat: number; expectedCash: number; currency: string } | null;
};

const PERIODS: Array<{ id: Period; label: string; caption: string }> = [
  { id: "day", label: "Day", caption: "by hour" },
  { id: "week", label: "Week", caption: "by day" },
  { id: "month", label: "Month", caption: "by day" },
  { id: "year", label: "Year", caption: "by month" },
];

const STAGES: Array<{ key: "accept" | "prepare" | "serve"; label: string; target: number }> = [
  { key: "accept", label: "Accepted", target: 4 },
  { key: "prepare", label: "Prepared", target: 10 },
  { key: "serve", label: "Served", target: 6 },
];

export default function NrmsPerformancePage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [period, setPeriod] = useState<Period>("day");
  const [outletId, setOutletId] = useState<number | "">("");
  const [data, setData] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const money = useCallback((value: number) => `${Math.round(value).toLocaleString()} ${data?.currency ?? selectedProperty?.currency ?? "TZS"}`, [data, selectedProperty]);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (outletId !== "") params.set("outletId", String(outletId));
      const res = await apiClient.get<Performance>(`/api/nrms/operations/property/${selectedPropertyId}/performance?${params.toString()}`);
      setData(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load performance");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId, period, outletId]);

  useEffect(() => { void load(); }, [load]);

  const peak = useMemo(() => Math.max(1, ...(data?.series ?? []).map((point) => point.value)), [data]);
  const activeCaption = PERIODS.find((item) => item.id === period)?.caption ?? "";

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Outlet performance</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Performance"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Sales, order flow and serving times for your bar and restaurant.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.canFilterOutlet && data.outlets.length > 1 && (
            <select value={outletId} onChange={(event) => setOutletId(event.target.value === "" ? "" : Number(event.target.value))} className="h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 outline-none">
              <option value="">All outlets</option>
              {data.outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
            </select>
          )}
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
            {PERIODS.map((item) => (
              <button key={item.id} type="button" onClick={() => setPeriod(item.id)} className={`min-h-8 rounded-md px-3 text-xs font-bold transition ${period === item.id ? "bg-emerald-800 text-white" : "text-neutral-500 hover:text-neutral-800"}`}>{item.label}</button>
            ))}
          </div>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="flex min-h-[40vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data && (
        <div className={loading ? "space-y-4 opacity-60 transition" : "space-y-4 transition"}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Coins} label="Total sales" value={money(data.summary.sales)} hint={`${activeCaption} · ${data.summary.orders} orders`} />
            <StatCard icon={Receipt} label="Orders" value={String(data.summary.orders)} hint="completed this period" />
            <StatCard icon={Calculator} label="Avg ticket" value={money(data.summary.avgTicket)} hint="per order" />
            <StatCard icon={Timer} label="Avg serving time" value={data.summary.serving.total != null ? `${data.summary.serving.total} min` : "—"} hint="order to served" />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
            <section className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-baseline justify-between">
                <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><BarChart3 className="h-4 w-4 text-emerald-700" />Sales trend</p>
                <p className="m-0 text-[10px] text-neutral-400">{activeCaption}</p>
              </div>
              <div className="mt-3 flex h-44 items-end gap-1">
                {data.series.length === 0 ? (
                  <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">No sales in this period yet.</div>
                ) : data.series.map((point, index) => {
                  const isPeak = point.value === peak && point.value > 0;
                  return (
                    <div key={index} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${point.label}: ${money(point.value)}`}>
                      <div className={`w-full rounded-t ${isPeak ? "bg-emerald-600" : "bg-emerald-200"} transition group-hover:bg-emerald-500`} style={{ height: `${Math.max(2, (point.value / peak) * 100)}%` }} />
                      {(data.series.length <= 16 || index % 3 === 0) && <span className="truncate text-[9px] text-neutral-400">{point.label}</span>}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-200 bg-white p-4">
              <p className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><Clock className="h-4 w-4 text-emerald-700" />Serving time breakdown</p>
              <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Average minutes at each stage</p>
              <div className="mt-3 space-y-2.5">
                {STAGES.map((stage) => {
                  const mins = data.summary.serving[stage.key];
                  const over = mins != null && mins > stage.target;
                  const pct = mins != null ? Math.min(100, (mins / stage.target) * 100) : 0;
                  return (
                    <div key={stage.key}>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-neutral-600">{stage.label}</span>
                        <span className={`font-bold ${over ? "text-amber-600" : "text-neutral-900"}`}>{mins != null ? `${mins} min` : "—"}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                        <div className={`h-1.5 rounded-full ${over ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2.5">
                <span className="text-[11px] text-neutral-500">On-time rate <span className="text-neutral-400">(under {15} min)</span></span>
                <span className={`text-sm font-bold ${data.summary.serving.onTimeRate == null ? "text-neutral-400" : data.summary.serving.onTimeRate >= 80 ? "text-emerald-700" : data.summary.serving.onTimeRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                  {data.summary.serving.onTimeRate != null ? `${data.summary.serving.onTimeRate}%` : "—"}
                </span>
              </div>
            </section>
          </div>

          <ShiftPanel shift={data.shift} canManageShift={data.canManageShift} propertyId={selectedPropertyId!} currency={data.currency} money={money} onChanged={load} />
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Coins; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
      <span className="flex items-center gap-1.5 text-[10px] text-neutral-500"><Icon className="h-3.5 w-3.5" />{label}</span>
      <p className="mb-0 mt-1.5 truncate text-xl font-bold text-neutral-950">{value}</p>
      <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{hint}</p>
    </div>
  );
}

function ShiftPanel({ shift, canManageShift, propertyId, currency, money, onChanged }: { shift: Performance["shift"]; canManageShift: boolean; propertyId: number; currency: string; money: (value: number) => string; onChanged: () => void | Promise<void>; }) {
  const [openFloat, setOpenFloat] = useState("");
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elapsed = useMemo(() => {
    if (!shift) return "";
    const mins = Math.max(0, Math.floor((Date.now() - new Date(shift.openedAt).getTime()) / 60000));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, [shift]);

  const variance = shift && counted !== "" ? Math.round((Number(counted) - shift.expectedCash) * 100) / 100 : null;

  const openShift = async () => {
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${propertyId}/shifts/open`, { openingFloat: Number(openFloat) || 0 });
      setOpenFloat("");
      await onChanged();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not open the shift"); }
    finally { setBusy(false); }
  };

  const closeShift = async () => {
    if (!shift) return;
    if (variance !== 0 && !note.trim()) { setError("Explain the difference before closing."); return; }
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${propertyId}/shifts/${shift.id}/close`, { declaredCash: Number(counted) || 0, closeNote: note.trim() || null });
      setClosing(false); setCounted(""); setNote("");
      await onChanged();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not close the shift"); }
    finally { setBusy(false); }
  };

  if (!shift) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-200 text-neutral-500"><Clock className="h-5 w-5" /></span>
          <div>
            <p className="m-0 text-[13px] font-bold text-neutral-800">No shift open</p>
            <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">{canManageShift ? "Enter your opening cash float to start recording sales." : "Ask a cashier or manager to open a shift."}</p>
            {error && <p className="mb-0 mt-1 text-[11px] text-red-600">{error}</p>}
          </div>
        </div>
        {canManageShift && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <input inputMode="numeric" value={openFloat} onChange={(event) => setOpenFloat(event.target.value.replace(/[^\d.]/g, ""))} placeholder="Opening float" className="h-10 w-36 rounded-lg border border-neutral-300 bg-white pl-3 pr-12 text-sm outline-none focus:border-emerald-600" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-400">{currency}</span>
            </div>
            <button type="button" disabled={busy} onClick={() => void openShift()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Open shift
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white"><Clock className="h-5 w-5" /></span>
          <div>
            <p className="m-0 text-[13px] font-bold text-emerald-950">Shift open</p>
            <p className="mb-0 mt-0.5 text-[11px] text-emerald-800/80">Since {new Date(shift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {elapsed} · float {money(shift.openingFloat)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="m-0 text-[10px] text-emerald-800/70">Cash expected</p>
            <p className="mb-0 mt-0.5 text-[15px] font-bold text-emerald-950">{money(shift.expectedCash)}</p>
          </div>
          {canManageShift && !closing && (
            <button type="button" onClick={() => { setClosing(true); setError(null); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white hover:bg-emerald-900">
              <ArrowLeftRight className="h-4 w-4" />Close &amp; hand over
            </button>
          )}
        </div>
      </div>

      {closing && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3.5">
          <p className="m-0 text-xs font-bold text-neutral-900">Count your drawer to close</p>
          <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">The system expects {money(shift.expectedCash)}. Enter the cash you physically counted.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-bold text-neutral-600">Cash counted
              <div className="relative">
                <input inputMode="numeric" value={counted} onChange={(event) => setCounted(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className="h-10 w-full rounded-lg border border-neutral-300 pl-3 pr-12 text-sm outline-none focus:border-emerald-600" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-neutral-400">{currency}</span>
              </div>
            </label>
            <div className="grid gap-1 text-[11px] font-bold text-neutral-600">Difference
              <div className={`flex h-10 items-center rounded-lg border px-3 text-sm font-bold ${variance == null ? "border-neutral-200 text-neutral-400" : variance === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : variance > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                {variance == null ? "—" : `${variance > 0 ? "+" : ""}${money(variance)}${variance > 0 ? " over" : variance < 0 ? " short" : " exact"}`}
              </div>
            </div>
          </div>
          {variance != null && variance !== 0 && (
            <label className="mt-2 grid gap-1 text-[11px] font-bold text-neutral-600">Reason for the difference
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="e.g. change given without a sale recorded" className="h-10 rounded-lg border border-neutral-300 px-3 text-sm font-normal outline-none focus:border-emerald-600" />
            </label>
          )}
          {variance != null && variance !== 0 && <p className="mb-0 mt-2 text-[10px] text-amber-700">A difference is flagged for a manager to review. Your shift still closes.</p>}
          {error && <p className="mb-0 mt-2 text-[11px] text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setClosing(false); setError(null); }} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Cancel</button>
            <button type="button" disabled={busy || counted === ""} onClick={() => void closeShift()} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Close shift
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

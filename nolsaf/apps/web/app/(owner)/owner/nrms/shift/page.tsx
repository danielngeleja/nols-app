"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Banknote, History, Loader2, RefreshCw, UserCheck, WalletCards } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ShiftPanel, { type HandoverShift, type PendingHandover } from "../_components/ShiftPanel";
import { useNrms } from "../_components/NrmsProvider";

type ShiftHistoryRow = {
  id: number;
  openedAt: string;
  closedAt: string | null;
  expectedCash: number;
  currency: string;
  closeNote: string | null;
  takenOverFrom: string | null;
  handedTo: string | null;
};

type ShiftState = {
  currency: string;
  canManageShift: boolean;
  shift: HandoverShift | null;
  handover: PendingHandover | null;
  history: ShiftHistoryRow[];
};

const STEPS = [
  { icon: UserCheck, title: "Start under your name", text: "Open your shift, or confirm the drawer handed over to you. Your login is the signature." },
  { icon: Banknote, title: "Sales record themselves", text: "Every order and payment you settle is stamped to your account. Nothing is counted or typed." },
  { icon: ArrowLeftRight, title: "Close and hand over", text: "Review your figures, seal them, and the next attendee confirms the takeover on their account." },
];

function dayLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
}
function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function duration(openedAt: string, closedAt: string | null) {
  if (!closedAt) return "";
  const mins = Math.max(0, Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function NrmsShiftPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [data, setData] = useState<ShiftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currency = data?.currency ?? selectedProperty?.currency ?? "TZS";
  const money = useCallback((value: number) => `${Math.round(value).toLocaleString()} ${currency}`, [currency]);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get<ShiftState>(`/api/nrms/operations/property/${selectedPropertyId}/shift`);
      setData(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load your shift");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-[900px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Shift &amp; cash</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Shift"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Your drawer, your handover, your record. All figures come from the sales the system tracked under your name.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <div className={loading ? "space-y-4 opacity-60 transition" : "space-y-4 transition"}>
          {data.canManageShift ? (
            <ShiftPanel shift={data.shift} handover={data.handover} canManageShift={data.canManageShift} propertyId={selectedPropertyId!} money={money} onChanged={load} />
          ) : (
            <section className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-200 text-neutral-500"><WalletCards className="h-5 w-5" /></span>
              <div>
                <p className="m-0 text-[13px] font-bold text-neutral-800">Your role does not run a cash shift</p>
                <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Shifts and drawers are held by serving and front-desk staff.</p>
              </div>
            </section>
          )}

          {data.canManageShift && !data.shift && (
            <section className="grid gap-3 sm:grid-cols-3">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4" /></span>
                      <span className="text-[10px] font-bold text-neutral-300">0{index + 1}</span>
                    </div>
                    <p className="mb-0 mt-2.5 text-[13px] font-bold text-neutral-900">{step.title}</p>
                    <p className="mb-0 mt-1 text-[11px] leading-relaxed text-neutral-500">{step.text}</p>
                  </div>
                );
              })}
            </section>
          )}

          {data.canManageShift && (
            <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
                <History className="h-4 w-4 text-emerald-700" />
                <p className="m-0 text-[13px] font-bold text-neutral-900">My recent shifts</p>
              </div>
              {data.history.length === 0 ? (
                <p className="m-0 px-4 py-8 text-center text-xs text-neutral-400">Your closed shifts will appear here with the drawer figure each one sealed.</p>
              ) : (
                <div className="divide-y divide-neutral-100">
                  {data.history.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-bold text-neutral-900">{row.closedAt ? dayLabel(row.closedAt) : dayLabel(row.openedAt)}<span className="ml-2 text-[10px] font-normal text-neutral-400">{timeLabel(row.openedAt)}{row.closedAt ? ` to ${timeLabel(row.closedAt)} · ${duration(row.openedAt, row.closedAt)}` : ""}</span></p>
                        <p className="mb-0 mt-0.5 truncate text-[11px] text-neutral-500">
                          {row.takenOverFrom ? `Took over from ${row.takenOverFrom}` : "Started fresh"}
                          {row.handedTo ? <> · handed to {row.handedTo} <span className="text-emerald-700">✓ confirmed</span></> : " · drawer not taken over"}
                          {row.closeNote ? ` · "${row.closeNote}"` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="m-0 text-[13px] font-bold text-neutral-900">{money(row.expectedCash)}</p>
                        <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">cash sealed at close</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}

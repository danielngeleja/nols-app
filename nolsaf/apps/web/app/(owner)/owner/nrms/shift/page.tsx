"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, WalletCards } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ShiftPanel, { type HandoverShift, type PendingHandover } from "../_components/ShiftPanel";
import { useNrms } from "../_components/NrmsProvider";

type ShiftState = {
  currency: string;
  canManageShift: boolean;
  shift: HandoverShift | null;
  handover: PendingHandover | null;
};

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
    <div className="mx-auto max-w-[820px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Shift &amp; cash</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Shift"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Start your shift, take over a drawer, and close with a handover. Every sale is tracked by the system, so nothing is counted or typed.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <div className={loading ? "opacity-60 transition" : "transition"}>
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
        </div>
      ) : null}
    </div>
  );
}

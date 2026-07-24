"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, ArrowRight, Banknote, BedDouble, Clock, Loader2, Lock, Store } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type HandoverShift = { id: number; openedAt: string; openingFloat: number; expectedCash: number; currency: string; takenOverFrom: string | null };
export type PendingHandover = { shiftId: number; attendeeName: string; amount: number; closedAt: string; currency: string };

type MethodRow = { method: string; count: number; amount: number };
type HandoverSummary = {
  computedAt: string;
  currency: string;
  mySales: { count: number; amount: number; byMethod: MethodRow[] };
  myFolioPayments: { count: number; amount: number; byMethod: MethodRow[] };
  folioPosted: { count: number; amount: number };
  unpaid: { count: number; amount: number; orders: Array<{ id: number; orderNumber: string; customerLabel: string; outletName: string; status: string; amount: number; createdAt: string }> };
  daySales: { settled: { count: number; amount: number }; postedToFolio: { count: number; amount: number }; amount: number };
};

const METHOD_LABELS: Record<string, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", CARD: "Card", BANK: "Bank", OTHER: "Other", UNCLASSIFIED: "Unclassified" };
const methodLabel = (method: string) => METHOD_LABELS[method] ?? method;

export default function ShiftPanel({ shift, handover, canManageShift, propertyId, money, onChanged }: { shift: HandoverShift | null; handover: PendingHandover | null; canManageShift: boolean; propertyId: number; money: (value: number) => string; onChanged: () => void | Promise<void>; }) {
  const [closing, setClosing] = useState(false);
  const [summary, setSummary] = useState<HandoverSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the close panel first fetches the classified review, so the attendee
  // sees every figure the manager will see before anything is sealed.
  const beginClose = async () => {
    setClosing(true); setError(null); setSummary(null); setSummaryLoading(true);
    try {
      const res = await apiClient.get<{ summary: HandoverSummary }>(`/api/nrms/operations/property/${propertyId}/shifts/current/summary`);
      setSummary(res.data.summary);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not load your shift review"); }
    finally { setSummaryLoading(false); }
  };

  const elapsed = useMemo(() => {
    if (!shift) return "";
    const mins = Math.max(0, Math.floor((Date.now() - new Date(shift.openedAt).getTime()) / 60000));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }, [shift]);

  const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // No amounts are ever typed. A fresh shift starts at zero; a takeover inherits
  // the outgoing attendee's system figure, sealed by this attendee's own account.
  const openShift = async (handoverFromShiftId?: number) => {
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${propertyId}/shifts/open`, handoverFromShiftId ? { handoverFromShiftId } : {});
      await onChanged();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not open the shift"); }
    finally { setBusy(false); }
  };

  const closeShift = async () => {
    if (!shift) return;
    if (summary && summary.unpaid.count > 0 && !note.trim()) { setError("Note what is outstanding before closing."); return; }
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${propertyId}/shifts/${shift.id}/close`, { closeNote: note.trim() || null });
      setClosing(false); setNote("");
      await onChanged();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not close the shift"); }
    finally { setBusy(false); }
  };

  if (!shift) {
    if (handover && canManageShift) {
      return (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white"><ArrowLeftRight className="h-5 w-5" /></span>
              <div>
                <p className="m-0 text-[13px] font-bold text-amber-950">Drawer handover awaiting confirmation</p>
                <p className="mb-0 mt-0.5 text-[11px] text-amber-800/90">{handover.attendeeName} closed at {time(handover.closedAt)} with {money(handover.amount)} recorded in the system.</p>
                <p className="mb-0 mt-0.5 text-[11px] text-amber-800/90">Confirming records, under your account, that you received this drawer at this amount.</p>
                {error && <p className="mb-0 mt-1 text-[11px] text-red-600">{error}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => void openShift()} className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 disabled:opacity-50">Start fresh instead</button>
              <button type="button" disabled={busy} onClick={() => void openShift(handover.shiftId)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white hover:bg-emerald-900 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}Confirm takeover
              </button>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-200 text-neutral-500"><Clock className="h-5 w-5" /></span>
          <div>
            <p className="m-0 text-[13px] font-bold text-neutral-800">No shift open</p>
            <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">{canManageShift ? "Start your shift to record sales under your name. Every sale is tracked by the system, so there is nothing to count or type." : "Ask a cashier or manager to open a shift."}</p>
            {error && <p className="mb-0 mt-1 text-[11px] text-red-600">{error}</p>}
          </div>
        </div>
        {canManageShift && (
          <button type="button" disabled={busy} onClick={() => void openShift()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Start shift
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="border-b border-neutral-100 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white"><Clock className="h-4 w-4" /></span>
            <div>
              <p className="m-0 text-[13px] font-bold text-neutral-900">Your shift</p>
              <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Bar &amp; restaurant · since {time(shift.openedAt)} · {elapsed}{shift.takenOverFrom ? ` · took over from ${shift.takenOverFrom}` : ""}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Open</span>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[11px] text-neutral-500">Cash drawer to hand over</p>
            <p className="mb-0 mt-1 break-words text-[30px] font-bold leading-none tracking-tight text-neutral-950">{money(shift.expectedCash)}</p>
            <p className="mb-0 mt-1.5 text-[10px] text-neutral-400">Physical cash only, counted by the system. Mobile money, card and room folio settle to their own records, not the drawer.</p>
          </div>
          {canManageShift && !closing && (
            <button type="button" onClick={() => void beginClose()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white hover:bg-emerald-900">
              <ArrowLeftRight className="h-4 w-4" />Close &amp; hand over
            </button>
          )}
        </div>
      </div>

      {closing && (
        <div>
          {summaryLoading && <div className="flex items-center gap-2 p-5 text-[11px] text-neutral-400"><Loader2 className="h-4 w-4 animate-spin" />Preparing your shift review…</div>}

          {summary && (
            <>
              <div className="px-5">
                <SummaryRow icon={Banknote} tone="emerald" title="My sales this shift" detail={summary.mySales.byMethod.length > 0 ? summary.mySales.byMethod.map((row) => `${methodLabel(row.method)} ${money(row.amount)}`).join(" · ") : "No sales recorded yet"} amount={money(summary.mySales.amount)} meta={`${summary.mySales.count} order${summary.mySales.count === 1 ? "" : "s"}`} />
                <SummaryRow icon={BedDouble} title="Charged to room folio" detail="Collected at guest checkout" amount={money(summary.folioPosted.amount)} meta={`${summary.folioPosted.count} order${summary.folioPosted.count === 1 ? "" : "s"}`} />
                <SummaryRow icon={Store} title="Whole property today" detail={`${money(summary.daySales.settled.amount)} paid · ${money(summary.daySales.postedToFolio.amount)} on folios`} amount={money(summary.daySales.amount)} last />
              </div>

              {summary.myFolioPayments.count > 0 && (
                <p className="mb-0 mt-1 px-5 text-[10px] text-neutral-500">Guest payments I recorded at the desk: {money(summary.myFolioPayments.amount)} ({summary.myFolioPayments.byMethod.map((row) => `${methodLabel(row.method)} ${money(row.amount)}`).join(" · ")})</p>
              )}

              <div className="px-5 pt-3">
                {summary.unpaid.count > 0 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-[12px] font-bold text-amber-900"><AlertTriangle className="h-4 w-4 text-amber-700" />{summary.unpaid.count} order{summary.unpaid.count === 1 ? " is" : "s are"} still unpaid</span>
                      <span className="text-[12px] font-bold text-amber-900">{money(summary.unpaid.amount)}</span>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {summary.unpaid.orders.map((order) => (
                        <div key={order.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[11px]">
                          <span className="min-w-0 truncate font-bold text-neutral-800">{order.orderNumber} · {order.outletName} · {order.customerLabel}</span>
                          <span className="shrink-0 text-neutral-500">{order.status.toLowerCase()} · <strong className="font-bold text-neutral-800">{money(order.amount)}</strong></span>
                        </div>
                      ))}
                      {summary.unpaid.count > summary.unpaid.orders.length && <p className="mb-0 text-[10px] text-amber-800/90">and {summary.unpaid.count - summary.unpaid.orders.length} more in the orders workspace.</p>}
                    </div>
                    <p className="mb-0 mt-2.5 text-[10px] leading-relaxed text-amber-800">Note what is outstanding below so the next attendee and the manager know. It blocks the night audit until resolved.</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-[11px] font-bold text-emerald-800"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[11px]">✓</span>Every order is paid or on a room folio. Nothing is outstanding.</div>
                )}
              </div>
            </>
          )}

          <div className="p-5 pt-4">
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={summary && summary.unpaid.count > 0 ? "Note what is outstanding, e.g. table 4 will pay by mobile money" : "Add a note for the next attendee or manager (optional)"} className="box-border h-10 w-full rounded-lg border border-neutral-300 px-3 text-sm outline-none focus:border-emerald-600" />
            {error && <p className="mb-0 mt-2 text-[11px] text-red-600">{error}</p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 flex items-center gap-1.5 text-[10px] text-neutral-400"><Lock className="h-3.5 w-3.5" />Sealed under your name at close</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setClosing(false); setError(null); }} className="min-h-10 rounded-lg border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 hover:bg-neutral-50">Cancel</button>
                <button type="button" disabled={busy || summaryLoading} onClick={() => void closeShift()} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-800 px-5 text-xs font-bold text-white hover:bg-emerald-900 disabled:opacity-50">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}Submit and close<ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryRow({ icon: Icon, title, detail, amount, meta, tone, last }: { icon: typeof Banknote; title: string; detail: string; amount: string; meta?: string; tone?: "emerald"; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-3.5 ${last ? "" : "border-b border-neutral-100"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-bold text-neutral-900">{title}</p>
          <p className="mb-0 mt-0.5 truncate text-[11px] text-neutral-500">{detail}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="m-0 text-[14px] font-bold text-neutral-900">{amount}</p>
        {meta && <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{meta}</p>}
      </div>
    </div>
  );
}

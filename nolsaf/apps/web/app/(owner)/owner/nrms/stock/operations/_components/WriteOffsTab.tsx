"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileImage, Gift, Loader2, Trash, UtensilsCrossed, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatStockQuantity } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass, fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { type AmountDraft, AmountInput, PhotoField, WASTAGE_REASON_LABELS, WRITE_OFF_STATUS, WRITE_OFF_TYPE_LABELS, amountPayload, amountToBase, defaultAmount, formatWhen } from "./shared";

export type WriteOff = {
  id: number;
  type: string;
  reasonCode: string;
  status: string;
  stockItemName: string | null;
  baseUnit: string | null;
  locationName: string | null;
  quantity: number;
  value: number;
  note: string | null;
  photoUrl: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
};

const FILTERS: Array<[string, string]> = [["", "All"], ["PENDING", "Waiting approval"], ["APPROVED", "Written off"], ["REJECTED", "Rejected"]];

export default function WriteOffsTab({ propertyId, overview, refreshKey, onChanged, onlyPending = false, bare = false }: { propertyId: number; overview: StockOverview; refreshKey: number; onChanged: () => void; onlyPending?: boolean; bare?: boolean }) {
  const [status, setStatus] = useState(onlyPending ? "PENDING" : "");
  const [rows, setRows] = useState<WriteOff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ writeOffs: WriteOff[] }>(`/api/nrms/stock/property/${propertyId}/write-offs`, { params: { status: status || undefined } });
      setRows(res.data.writeOffs);
    } catch (cause) {
      setError(apiError(cause, "Unable to load write-offs"));
    }
  }, [propertyId, status]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const total = (rows ?? []).filter((row) => row.status === "APPROVED").reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="space-y-3">
      {!onlyPending && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setStatus(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${status === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
            ))}
          </div>
          {overview.canWriteOff && <button type="button" onClick={() => setRecording(true)} className={primaryButton}><Trash className="h-4 w-4" />Record a write-off</button>}
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className={bare ? "" : `${cardClass} overflow-hidden`}>
        {!rows ? (
          <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Trash} title={onlyPending ? "No write-offs waiting" : "Nothing written off"} body={onlyPending ? "Write-offs above the owner's limit appear here for a manager." : "Broken bottles, spoiled fish, staff meals and drinks on the house. Each one leaves the books with a reason, so it never hides inside a count."} action={!onlyPending && overview.canWriteOff ? <button type="button" onClick={() => setRecording(true)} className={primaryButton}><Trash className="h-4 w-4" />Record a write-off</button> : undefined} />
        ) : (
          <>
            {rows.map((row) => <WriteOffRow key={row.id} row={row} canApprove={overview.canApprove} currency={overview.currency} onChanged={() => { void load(); onChanged(); }} />)}
            {!onlyPending && total > 0 && <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 text-right text-sm text-neutral-600">Written off in this list: <strong className="text-neutral-900">{formatMoney(total, overview.currency)}</strong> at cost</p>}
          </>
        )}
      </div>

      {recording && <WriteOffModal propertyId={propertyId} overview={overview} onClose={() => setRecording(false)} onSaved={() => { setRecording(false); void load(); onChanged(); }} />}
    </div>
  );
}

export function WriteOffRow({ row, canApprove, currency, onChanged }: { row: WriteOff; canApprove: boolean; currency: string; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = WRITE_OFF_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };

  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/write-offs/${row.id}/${action}`, action === "reject" ? { reason: reason.trim() } : {});
      onChanged();
    } catch (cause) {
      setError(apiError(cause, "The action failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-bold text-neutral-900">
            {formatStockQuantity(row.quantity, row.baseUnit ?? "PIECE")} {row.stockItemName}
            <span className="ml-2 text-[13px] font-semibold text-neutral-500">{row.locationName}</span>
          </p>
          <p className="m-0 mt-0.5 text-[13px] text-neutral-600">
            {WRITE_OFF_TYPE_LABELS[row.type] ?? row.type}{row.type === "WASTAGE" ? `: ${WASTAGE_REASON_LABELS[row.reasonCode] ?? row.reasonCode}` : ""}
            {row.note ? ` · ${row.note}` : ""}
          </p>
          <p className="m-0 mt-0.5 text-xs text-neutral-400">
            {formatWhen(row.createdAt)}{row.requestedBy ? ` · ${row.requestedBy}` : ""}
            {row.decidedBy && row.decidedBy !== row.requestedBy ? ` · ${row.status === "REJECTED" ? "rejected" : "approved"} by ${row.decidedBy}` : ""}
            {row.decisionNote ? ` · ${row.decisionNote}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {row.photoUrl && <a href={row.photoUrl} target="_blank" rel="noreferrer" aria-label="Open photo" className="text-neutral-400 hover:text-brand"><FileImage className="h-4 w-4" /></a>}
          <span className="text-sm font-bold tabular-nums text-neutral-900">{formatMoney(row.value, currency)}</span>
          <Pill tone={state.tone}>{state.label}</Pill>
        </div>
      </div>
      {canApprove && row.status === "PENDING" && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {rejecting ? (
            <>
              <input autoFocus value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} placeholder="Why is it rejected?" className={`${smallFieldClass} min-w-[220px] flex-1`} />
              <button type="button" onClick={() => setRejecting(false)} className={quietButton}>Keep</button>
              <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void decide("reject")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-red-600 px-3 text-sm font-bold text-white [font-family:inherit] disabled:bg-neutral-200 disabled:text-neutral-400">Reject</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setRejecting(true)} className={quietButton}><XCircle className="h-4 w-4" />Reject</button>
              <button type="button" disabled={busy} onClick={() => void decide("approve")} className={primaryButton}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve</button>
            </>
          )}
        </div>
      )}
      {error && <p className="m-0 mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function WriteOffModal({ propertyId, overview, initial, onClose, onSaved }: {
  propertyId: number;
  overview: StockOverview;
  initial?: { locationId?: number; stockItemId?: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const goods = useMemo(() => overview.items.filter((item) => item.status === "ACTIVE"), [overview.items]);
  const goodById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  const [locationId, setLocationId] = useState<number | "">(initial?.locationId ?? (overview.locations.length === 1 ? overview.locations[0].id : ""));
  const [stockItemId, setStockItemId] = useState<number | "">(initial?.stockItemId ?? "");
  const good = stockItemId ? goodById.get(stockItemId) ?? null : null;
  const [type, setType] = useState("WASTAGE");
  const [reasonCode, setReasonCode] = useState("BROKEN");
  const [amount, setAmount] = useState<AmountDraft>(() => ({ ...defaultAmount(initial?.stockItemId ? goodById.get(initial.stockItemId) : null), packUnitId: "units" }));
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantity = amountToBase(good, amount);
  const value = (good?.averageCost ?? 0) * quantity;
  const needsApproval = !overview.canApprove && value > overview.settings.writeOffLimit;
  const onHand = good && locationId ? good.balances.find((row) => row.locationId === locationId)?.quantity ?? 0 : null;
  const valid = Boolean(locationId && good && quantity > 0 && (type !== "WASTAGE" || reasonCode) && (reasonCode !== "OTHER" || type !== "WASTAGE" || note.trim()));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/property/${propertyId}/write-offs`, {
        locationId,
        stockItemId: good!.id,
        ...amountPayload(good, amount),
        type,
        reasonCode: type === "WASTAGE" ? reasonCode : null,
        note: note.trim() || null,
        photoUrl,
      });
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not record the write-off"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Record a write-off"
      subtitle="Goods leaving the books for a reason other than a sale"
      icon={<Trash className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-neutral-500">{!overview.showCost && needsApproval ? "A manager approves this before it leaves the books." : ""}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{needsApproval ? "Send for approval" : "Write off"}</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ["WASTAGE", Trash, "Broken, spoiled, spilled or expired"],
            ["STAFF_MEAL", UtensilsCrossed, "Food or drink given to staff"],
            ["COMPLIMENTARY", Gift, "Given free to a guest"],
          ] as const).map(([value, Icon, hint]) => {
            const on = type === value;
            return (
              <button key={value} type="button" onClick={() => setType(value)} className={`flex items-start gap-2.5 rounded-xl border border-solid p-3 text-left [font-family:inherit] transition ${on ? "border-brand bg-brand/[0.06] shadow-[inset_0_0_0_1px_#02665e]" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${on ? "bg-brand text-white" : "bg-neutral-100 text-neutral-500"}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0">
                  <span className={`block text-sm font-bold ${on ? "text-brand" : "text-neutral-900"}`}>{WRITE_OFF_TYPE_LABELS[value]}</span>
                  <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        <section className="rounded-xl border border-solid border-neutral-200 bg-neutral-50/70 p-4">
          <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-wide text-neutral-500">The goods</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Where
              <select value={locationId} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
                <option value="">Choose a location</option>
                {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              What
              <select value={stockItemId} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : ""; setStockItemId(id); setAmount({ ...defaultAmount(id ? goodById.get(id) : null), packUnitId: "units" }); }} className={fieldClass}>
                <option value="">Choose goods</option>
                {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <p className={`${labelClass} m-0`}>How much</p>
              <div className="mt-1.5 flex flex-wrap items-start gap-3">
                <div className="w-full max-w-[320px]"><AmountInput good={good} value={amount} onChange={setAmount} ariaLabel="Quantity written off" /></div>
                {good && onHand != null && (
                  <span className={`mt-1 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${quantity > onHand && good.countStyle === "WHOLE" ? "bg-red-50 text-red-700" : "bg-white text-neutral-600 shadow-[inset_0_0_0_1px_#e5e5e5]"}`}>
                    {formatStockQuantity(onHand, good.baseUnit)} on hand here{quantity > onHand && good.countStyle === "WHOLE" ? ", not enough" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {type === "WASTAGE" && (
          <div>
            <p className={`${labelClass} m-0`}>Why</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(WASTAGE_REASON_LABELS).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setReasonCode(value)} className={`h-10 rounded-lg border border-solid px-3 text-sm font-bold [font-family:inherit] transition ${reasonCode === value ? "border-red-400 bg-red-50 text-red-800" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <label className={labelClass}>
            {type === "WASTAGE" && reasonCode === "OTHER" ? "What happened" : "Note (optional)"}
            <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder={type === "COMPLIMENTARY" ? "For whom, approved by whom" : type === "STAFF_MEAL" ? "Which shift" : "What happened"} className={fieldClass} />
          </label>
          <PhotoField value={photoUrl} onChange={setPhotoUrl} label="Photo (optional)" />
        </div>

        {good && quantity > 0 && overview.showCost && (
          <div className={`flex items-center justify-between gap-3 rounded-xl border border-solid px-4 py-3 text-sm ${needsApproval ? "border-amber-300 bg-amber-50 text-amber-900" : "border-neutral-200 bg-white text-neutral-700"}`}>
            <span>{needsApproval ? "Above your write-off limit: a manager approves it before it leaves the books." : "Leaves the books as soon as you save."}</span>
            <span className="whitespace-nowrap font-bold tabular-nums">{formatMoney(value, overview.currency)} at cost</span>
          </div>
        )}
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

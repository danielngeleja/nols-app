"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowRightLeft, CheckCircle2, Loader2, Plus, Trash2, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatStockQuantity } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass, fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { type AmountDraft, AmountInput, TRANSFER_STATUS, amountPayload, amountToBase, defaultAmount, formatWhen } from "./shared";

type TransferLine = { id: number; stockItemName: string | null; baseUnit: string | null; quantitySent: number; quantityReceived: number | null };
type Transfer = {
  id: number;
  transferNumber: string;
  status: string;
  fromLocationId: number;
  fromLocationName: string | null;
  toLocationId: number;
  toLocationName: string | null;
  note: string | null;
  sentAt: string;
  sentBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  lines: TransferLine[];
};
type TransfersResponse = { canSend: boolean; canReceive: boolean; myLocationIds: number[]; transfers: Transfer[] };

export default function TransfersTab({ propertyId, overview, refreshKey, onChanged }: { propertyId: number; overview: StockOverview; refreshKey: number; onChanged: () => void }) {
  const [data, setData] = useState<TransfersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<TransfersResponse>(`/api/nrms/stock/property/${propertyId}/transfers`);
      setData(res.data);
    } catch (cause) {
      setError(apiError(cause, "Unable to load transfers"));
    }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const mine = new Set(data?.myLocationIds ?? []);
  const incoming = (data?.transfers ?? []).filter((row) => row.status === "IN_TRANSIT" && mine.has(row.toLocationId));
  const others = (data?.transfers ?? []).filter((row) => !incoming.includes(row));

  const cancel = async (transfer: Transfer) => {
    setBusyId(transfer.id);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/transfers/${transfer.id}/cancel`);
      await load();
      onChanged();
    } catch (cause) {
      setError(apiError(cause, "Could not cancel the transfer"));
    } finally {
      setBusyId(null);
    }
  };

  const canSendAnywhere = Boolean(data?.canSend) && overview.locations.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-sky-200 bg-sky-50/70 px-4 py-3">
        <p className="m-0 flex min-w-0 items-start gap-2 text-sm text-sky-900"><ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />Goods leave the sending shelf when sent, and reach the other shelf only when someone there confirms what arrived.</p>
        {canSendAnywhere && <button type="button" onClick={() => setSending(true)} className={`${primaryButton} shrink-0`}><ArrowRightLeft className="h-4 w-4" />Send goods</button>}
      </div>
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {incoming.length > 0 && (
        <section className={`${cardClass} overflow-hidden border-sky-300`}>
          <header className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><ArrowRightLeft className="h-4 w-4" /></span>
            <h3 className="m-0 text-[15px] font-bold text-neutral-900">{incoming.length} on the way to you</h3>
          </header>
          {incoming.map((transfer) => (
            <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
              <TransferSummary transfer={transfer} />
              <button type="button" onClick={() => setReceiving(transfer)} className={primaryButton}><CheckCircle2 className="h-4 w-4" />Confirm arrival</button>
            </div>
          ))}
        </section>
      )}

      <div className={`${cardClass} overflow-hidden`}>
        {!data ? (
          <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : others.length === 0 && incoming.length === 0 ? (
          <EmptyState icon={ArrowRightLeft} title="No transfers yet" body="Move goods from the store to the bar, or from the bar to the kitchen. The receiving side confirms what actually arrived." action={canSendAnywhere ? <button type="button" onClick={() => setSending(true)} className={primaryButton}><ArrowRightLeft className="h-4 w-4" />Send goods</button> : undefined} />
        ) : others.map((transfer) => {
          const state = TRANSFER_STATUS[transfer.status] ?? { label: transfer.status, tone: "muted" as const };
          const canCancel = transfer.status === "IN_TRANSIT" && data.canSend && mine.has(transfer.fromLocationId);
          return (
            <div key={transfer.id} className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
              <TransferSummary transfer={transfer} />
              <div className="flex items-center gap-2">
                <Pill tone={state.tone}>{state.label}</Pill>
                {canCancel && <button type="button" disabled={busyId === transfer.id} onClick={() => void cancel(transfer)} className={quietButton}>{busyId === transfer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}Take back</button>}
              </div>
            </div>
          );
        })}
      </div>

      {sending && <SendTransferModal propertyId={propertyId} overview={overview} onClose={() => setSending(false)} onSaved={() => { setSending(false); void load(); onChanged(); }} />}
      {receiving && <ReceiveTransferModal transfer={receiving} onClose={() => setReceiving(null)} onSaved={() => { setReceiving(null); void load(); onChanged(); }} />}
    </div>
  );
}

function TransferSummary({ transfer }: { transfer: Transfer }) {
  const lost = transfer.lines.reduce((sum, line) => sum + (line.quantityReceived != null && line.quantityReceived < line.quantitySent ? 1 : 0), 0);
  return (
    <div className="min-w-0">
      <p className="m-0 flex flex-wrap items-center gap-1.5 text-[15px] font-bold text-neutral-900">
        {transfer.fromLocationName}<ArrowRight className="h-4 w-4 text-neutral-400" />{transfer.toLocationName}
        <span className="text-[13px] font-semibold text-neutral-400">{transfer.transferNumber}</span>
      </p>
      <p className="m-0 mt-0.5 text-[13px] text-neutral-500">
        {transfer.lines.map((line) => `${formatStockQuantity(line.quantitySent, line.baseUnit ?? "PIECE")} ${line.stockItemName}`).join(", ")}
      </p>
      <p className="m-0 mt-0.5 text-xs text-neutral-400">
        Sent {formatWhen(transfer.sentAt)}{transfer.sentBy ? ` by ${transfer.sentBy}` : ""}
        {transfer.receivedAt ? ` · received ${formatWhen(transfer.receivedAt)}${transfer.receivedBy ? ` by ${transfer.receivedBy}` : ""}` : ""}
        {lost > 0 ? ` · ${lost} ${lost === 1 ? "line" : "lines"} arrived short` : ""}
      </p>
    </div>
  );
}

type SendLine = { key: number; stockItemId: number | ""; amount: AmountDraft };
let sendKey = 0;

function SendTransferModal({ propertyId, overview, onClose, onSaved }: { propertyId: number; overview: StockOverview; onClose: () => void; onSaved: () => void }) {
  const goods = useMemo(() => overview.items.filter((item) => item.status === "ACTIVE"), [overview.items]);
  const goodById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  const store = overview.locations.find((row) => row.kind === "STORE");
  const [fromId, setFromId] = useState<number | "">(store?.id ?? overview.locations[0]?.id ?? "");
  const [toId, setToId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<SendLine[]>(() => { sendKey += 1; return [{ key: sendKey, stockItemId: "", amount: { packUnitId: "units", amount: "" } }]; });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onHand = (stockItemId: number) => goodById.get(stockItemId)?.balances.find((row) => row.locationId === fromId)?.quantity ?? 0;
  const valid = Boolean(fromId && toId && fromId !== toId) && lines.every((line) => line.stockItemId && amountToBase(goodById.get(line.stockItemId), line.amount) > 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/property/${propertyId}/transfers`, {
        fromLocationId: fromId,
        toLocationId: toId,
        note: note.trim() || null,
        lines: lines.map((line) => ({ stockItemId: line.stockItemId, ...amountPayload(goodById.get(line.stockItemId as number), line.amount) })),
      });
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not send the transfer"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Send goods"
      subtitle="The receiving side confirms what actually arrives"
      icon={<ArrowRightLeft className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
          <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send</button>
        </div>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          From
          <select value={fromId} onChange={(event) => setFromId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
            {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          To
          <select value={toId} onChange={(event) => setToId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
            <option value="">Choose where it goes</option>
            {overview.locations.filter((row) => row.id !== fromId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((line) => {
          const good = line.stockItemId ? goodById.get(line.stockItemId) : null;
          const sending = amountToBase(good, line.amount);
          const available = line.stockItemId ? onHand(line.stockItemId) : 0;
          return (
            <div key={line.key} className="grid gap-2 rounded-xl border border-solid border-neutral-300 p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_36px] sm:items-start">
              <div>
                <select value={line.stockItemId} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : ""; setLines((rows) => rows.map((row) => (row.key === line.key ? { ...row, stockItemId: id, amount: defaultAmount(id ? goodById.get(id) : null) } : row))); }} className={`${smallFieldClass} w-full`}>
                  <option value="">Choose goods</option>
                  {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                {good && <p className={`m-0 mt-1 text-xs ${sending > available && good.countStyle === "WHOLE" ? "font-bold text-red-700" : "text-neutral-500"}`}>{formatStockQuantity(available, good.baseUnit)} on hand here</p>}
              </div>
              <AmountInput good={good} value={line.amount} onChange={(next) => setLines((rows) => rows.map((row) => (row.key === line.key ? { ...row, amount: next } : row)))} ariaLabel="Quantity to send" />
              <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => { sendKey += 1; setLines((rows) => [...rows, { key: sendKey, stockItemId: "", amount: { packUnitId: "units", amount: "" } }]); }} className={quietButton}><Plus className="h-3.5 w-3.5" />Add another good</button>
      </div>
      <label className={`${labelClass} mt-4`}>
        Note (optional)
        <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Who is carrying it, for which service" className={fieldClass} />
      </label>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

function ReceiveTransferModal({ transfer, onClose, onSaved }: { transfer: Transfer; onClose: () => void; onSaved: () => void }) {
  const [received, setReceived] = useState<Record<number, string>>(() => Object.fromEntries(transfer.lines.map((line) => [line.id, String(line.quantitySent)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = transfer.lines.filter((line) => Number(received[line.id]) < line.quantitySent).length;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/transfers/${transfer.id}/receive`, { lines: transfer.lines.map((line) => ({ lineId: line.id, quantityReceived: Number(received[line.id]) || 0 })) });
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not confirm the transfer"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Confirm arrival"
      subtitle={`${transfer.fromLocationName} to ${transfer.toLocationName} · ${transfer.transferNumber}`}
      icon={<CheckCircle2 className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`text-sm ${short ? "font-bold text-red-700" : "text-neutral-500"}`}>{short ? `${short} ${short === 1 ? "line" : "lines"} short: the difference is recorded as lost in transit.` : "Count what is in front of you."}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Confirm</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-2">
        {transfer.lines.map((line) => (
          <div key={line.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-neutral-300 px-3 py-2.5">
            <div>
              <p className="m-0 text-[15px] font-bold text-neutral-900">{line.stockItemName}</p>
              <p className="m-0 text-[13px] text-neutral-500">Sent {formatStockQuantity(line.quantitySent, line.baseUnit ?? "PIECE")}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              Arrived
              <input inputMode="decimal" value={received[line.id] ?? ""} onChange={(event) => setReceived((current) => ({ ...current, [line.id]: event.target.value.replace(/[^\d.]/g, "") }))} className={`${smallFieldClass} w-24 text-right font-bold tabular-nums`} />
            </label>
          </div>
        ))}
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

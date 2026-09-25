"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileImage, Loader2, Truck, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatStockQuantity, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { PAYMENT_METHOD_LABELS, RECEIPT_STATUS, REJECT_REASON_LABELS, formatDay, formatWhen } from "./shared";

export type ReceiptLine = {
  id: number;
  stockItemName: string | null;
  baseUnit: string | null;
  packUnitName: string | null;
  packCount: number | null;
  quantity: number;
  claimedQuantity: number | null;
  rejectedQuantity: number;
  rejectReason: string | null;
  unitCost: number;
  lineTotal: number;
  previousUnitCost: number | null;
  priceFlag: string;
  expiresAt: string | null;
};

export type Receipt = {
  id: number;
  receiptNumber: string;
  status: string;
  supplierName: string | null;
  purchaseOrderId?: number | null;
  orderNumber?: string | null;
  locationName: string | null;
  paymentMode: string;
  paymentMethod: string | null;
  paymentReference: string | null;
  supplierDocumentNumber: string | null;
  photoUrl: string | null;
  note: string | null;
  totalCost: number;
  rejectedValue: number;
  flaggedLines: number;
  receivedAt: string;
  receivedBy: string | null;
  receivedById: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  lineCount: number;
  lines?: ReceiptLine[];
};

const FILTERS: Array<[string, string]> = [["", "All"], ["PENDING_APPROVAL", "Waiting approval"], ["POSTED", "In stock"], ["REJECTED", "Rejected"], ["VOIDED", "Voided"]];

export default function DeliveriesTab({ propertyId, overview, onNew, refreshKey, onChanged }: {
  propertyId: number;
  overview: StockOverview;
  onNew: () => void;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ receipts: Receipt[] }>(`/api/nrms/stock/property/${propertyId}/goods-receipts`, { params: { status: status || undefined } });
      setRows(res.data.receipts);
    } catch (cause) {
      setError(apiError(cause, "Unable to load deliveries"));
    }
  }, [propertyId, status]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const currency = overview.currency;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setStatus(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${status === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
          ))}
        </div>
        {overview.canReceive && <button type="button" onClick={onNew} className={primaryButton}><Truck className="h-4 w-4" />New delivery</button>}
      </div>

      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className={`${cardClass} overflow-hidden`}>
        {!rows ? (
          <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Truck} title="No deliveries yet" body="Every crate, sack and market run goes here: what arrived, what was rejected, and what was really paid." action={overview.canReceive ? <button type="button" onClick={onNew} className={primaryButton}><Truck className="h-4 w-4" />Record the first delivery</button> : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5">Delivery</th>
                  <th className="px-2 py-2.5">Supplier</th>
                  <th className="px-2 py-2.5">Into</th>
                  <th className="px-2 py-2.5 text-right">Total</th>
                  <th className="px-2 py-2.5">Payment</th>
                  <th className="px-2 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = RECEIPT_STATUS[row.status] ?? { label: row.status, tone: "muted" as const };
                  return (
                    <tr key={row.id} className="cursor-pointer border-0 border-t border-solid border-neutral-100 transition hover:bg-neutral-50/70" onClick={() => setOpenId(row.id)}>
                      <td className="px-4 py-3">
                        <p className="m-0 text-[15px] font-bold text-neutral-900">{row.receiptNumber}</p>
                        <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{formatWhen(row.receivedAt)} · {row.lineCount} {row.lineCount === 1 ? "good" : "goods"}{row.receivedBy ? ` · ${row.receivedBy}` : ""}</p>
                      </td>
                      <td className="px-2 py-3 text-sm text-neutral-700">
                        {row.supplierName ?? <span className="text-neutral-400">Market purchase</span>}
                        {row.orderNumber && <span className="mt-0.5 block text-xs text-neutral-500">On {row.orderNumber}</span>}
                      </td>
                      <td className="px-2 py-3 text-sm text-neutral-700">{row.locationName}</td>
                      <td className="px-2 py-3 text-right text-sm font-bold tabular-nums text-neutral-900">{formatMoney(row.totalCost, currency)}</td>
                      <td className="px-2 py-3 text-sm text-neutral-700">{row.paymentMode === "CREDIT" ? <Pill tone="info">On credit</Pill> : PAYMENT_METHOD_LABELS[row.paymentMethod ?? ""] ?? "Paid"}</td>
                      <td className="px-2 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Pill tone={state.tone}>{state.label}</Pill>
                          {row.flaggedLines > 0 && <Pill tone="low">{row.flaggedLines} price {row.flaggedLines === 1 ? "jump" : "jumps"}</Pill>}
                          {row.rejectedValue > 0 && <Pill tone="out">Rejections</Pill>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{row.photoUrl && <FileImage className="inline h-4 w-4 text-neutral-400" aria-label="Photo attached" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId != null && <ReceiptDetailModal receiptId={openId} currency={currency} onClose={() => setOpenId(null)} onChanged={() => { void load(); onChanged(); }} />}
    </div>
  );
}

export function ReceiptDetailModal({ receiptId, currency, onClose, onChanged }: { receiptId: number; currency: string; onClose: () => void; onChanged: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"reject" | "void" | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ receipt: Receipt; canApprove: boolean }>(`/api/nrms/stock/goods-receipts/${receiptId}`);
      setReceipt(res.data.receipt);
      setCanApprove(res.data.canApprove);
    } catch (cause) {
      setError(apiError(cause, "Unable to load the delivery"));
    }
  }, [receiptId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: "approve" | "reject" | "void") => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ selfApproved?: boolean }>(`/api/nrms/stock/goods-receipts/${receiptId}/${action}`, action === "approve" ? {} : { reason: reason.trim() });
      if (action === "approve" && res.data.selfApproved) setNotice("Approved. You also received this delivery; the record shows the same person on both.");
      setMode(null);
      setReason("");
      await load();
      onChanged();
    } catch (cause) {
      setError(apiError(cause, "The action failed"));
    } finally {
      setBusy(false);
    }
  };

  const state = receipt ? RECEIPT_STATUS[receipt.status] ?? { label: receipt.status, tone: "muted" as const } : null;

  return (
    <ModalFrame title={receipt?.receiptNumber ?? "Delivery"} subtitle={receipt ? `${receipt.supplierName ?? "Market purchase"} · into ${receipt.locationName}${receipt.orderNumber ? ` · on ${receipt.orderNumber}` : ""}` : undefined} icon={<ClipboardCheck className="h-5 w-5" />} onClose={onClose} extraWide>
      {!receipt ? (
        <div className="flex min-h-[20vh] items-center justify-center text-neutral-300">{error ? <p className="text-sm text-red-700">{error}</p> : <Loader2 className="h-6 w-6 animate-spin" />}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {state && <Pill tone={state.tone}>{state.label}</Pill>}
            <span className="text-sm text-neutral-600">Received {formatWhen(receipt.receivedAt)}{receipt.receivedBy ? ` by ${receipt.receivedBy}` : ""}</span>
            {receipt.decidedBy && <span className="text-sm text-neutral-600">· {receipt.status === "REJECTED" ? "rejected" : "approved"} by {receipt.decidedBy}</span>}
            {receipt.voidedBy && <span className="text-sm text-neutral-600">· voided by {receipt.voidedBy}</span>}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Fact label="Total paid" value={formatMoney(receipt.totalCost, currency)} />
            <Fact label="Payment" value={receipt.paymentMode === "CREDIT" ? "On credit" : `${PAYMENT_METHOD_LABELS[receipt.paymentMethod ?? ""] ?? "Paid"}${receipt.paymentReference ? ` · ${receipt.paymentReference}` : ""}`} />
            <Fact label="Supplier's document" value={receipt.supplierDocumentNumber ?? "-"} />
            <Fact label="Rejected value" value={receipt.rejectedValue > 0 ? formatMoney(receipt.rejectedValue, currency) : "None"} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-solid border-neutral-200">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Good</th>
                  <th className="px-2 py-2 text-right">Accepted</th>
                  <th className="px-2 py-2 text-right">Paper said</th>
                  <th className="px-2 py-2">Rejected</th>
                  <th className="px-2 py-2 text-right">Unit price</th>
                  <th className="px-3 py-2 text-right">Line total</th>
                </tr>
              </thead>
              <tbody>
                {(receipt.lines ?? []).map((line) => {
                  const unit = line.baseUnit ?? "PIECE";
                  const gap = line.claimedQuantity != null && line.claimedQuantity > line.quantity ? line.claimedQuantity - line.quantity : 0;
                  return (
                    <tr key={line.id} className="border-0 border-t border-solid border-neutral-100 align-top">
                      <td className="px-3 py-2.5">
                        <p className="m-0 text-sm font-bold text-neutral-900">{line.stockItemName}</p>
                        {line.expiresAt && <p className="m-0 mt-0.5 text-xs text-neutral-500">Use by {formatDay(line.expiresAt)}</p>}
                      </td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">{formatStockQuantity(line.quantity, unit)}{line.packUnitName && line.packCount ? <span className="block text-xs text-neutral-500">{line.packCount} {line.packUnitName}</span> : null}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">{line.claimedQuantity != null ? formatStockQuantity(line.claimedQuantity, unit) : "-"}{gap > 0 && <span className="block text-xs font-bold text-red-700">{formatStockQuantity(gap, unit)} short</span>}</td>
                      <td className="px-2 py-2.5 text-sm">{line.rejectedQuantity > 0 ? <span className="text-red-700">{formatStockQuantity(line.rejectedQuantity, unit)} · {REJECT_REASON_LABELS[line.rejectReason ?? ""] ?? line.rejectReason}</span> : <span className="text-neutral-400">-</span>}</td>
                      <td className="px-2 py-2.5 text-right text-sm tabular-nums">
                        {line.quantity > 0 ? `${formatUnitCost(line.unitCost, currency)}/${unitShort(unit)}` : "-"}
                        {line.priceFlag !== "NONE" && line.previousUnitCost != null && (
                          <span className="mt-0.5 flex items-center justify-end gap-1 text-xs font-bold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{line.priceFlag === "ABOVE_AGREED" ? "agreed" : line.priceFlag === "ABOVE_ORDER" ? "ordered at" : "was"} {formatUnitCost(line.previousUnitCost, currency)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums">{formatMoney(line.lineTotal, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(receipt.photoUrl || receipt.note || receipt.decisionNote || receipt.voidReason) && (
            <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              {receipt.photoUrl && (
                <a href={receipt.photoUrl} target="_blank" rel="noreferrer" className="block h-28 w-28 overflow-hidden rounded-xl border border-solid border-neutral-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={receipt.photoUrl} alt="Delivery note" className="h-full w-full object-cover" />
                </a>
              )}
              <div className="space-y-1 text-sm text-neutral-700">
                {receipt.note && <p className="m-0"><strong>Note:</strong> {receipt.note}</p>}
                {receipt.decisionNote && <p className="m-0"><strong>Decision:</strong> {receipt.decisionNote}</p>}
                {receipt.voidReason && <p className="m-0"><strong>Voided:</strong> {receipt.voidReason}</p>}
              </div>
            </div>
          )}

          {notice && <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}
          {error && <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {canApprove && (receipt.status === "PENDING_APPROVAL" || receipt.status === "POSTED") && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
              {mode ? (
                <>
                  <input autoFocus value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} placeholder={mode === "void" ? "Why is this delivery being voided?" : "Why is it rejected?"} className={`${smallFieldClass} min-w-[240px] flex-1`} />
                  <button type="button" onClick={() => setMode(null)} className={quietButton}>Keep</button>
                  <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void act(mode)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-red-600 px-3 text-sm font-bold text-white [font-family:inherit] disabled:bg-neutral-200 disabled:text-neutral-400">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "void" ? "Void delivery" : "Reject"}</button>
                </>
              ) : receipt.status === "PENDING_APPROVAL" ? (
                <>
                  <button type="button" onClick={() => setMode("reject")} className={quietButton}><XCircle className="h-4 w-4" />Reject</button>
                  <button type="button" disabled={busy} onClick={() => void act("approve")} className={primaryButton}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve into stock</button>
                </>
              ) : (
                <button type="button" onClick={() => setMode("void")} className={quietButton}><XCircle className="h-4 w-4" />Void delivery</button>
              )}
            </div>
          )}
        </div>
      )}
    </ModalFrame>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
      <p className="m-0 text-xs text-neutral-500">{label}</p>
      <p className="m-0 mt-0.5 truncate text-[15px] font-bold text-neutral-900">{value}</p>
    </div>
  );
}

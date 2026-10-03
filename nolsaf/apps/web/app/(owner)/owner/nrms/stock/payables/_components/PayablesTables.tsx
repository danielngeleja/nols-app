"use client";

// Invoice and payment tables, shared by Supplier payables and a supplier's
// statement page. Voiding needs a reason and is recorded.

import { Fragment, useState } from "react";
import { Banknote, Building2, CreditCard, Smartphone, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { apiError, formatMoney } from "../../../_components/stockFormat";
import { Pill, quietButton, smallFieldClass } from "../../items/_components/ui";
import { PAYMENT_METHOD_LABELS } from "../../operations/_components/shared";
import { type Invoice, MATCH_LABELS, type Payment, dateLabel } from "./payablesShared";

const METHOD_ICON: Record<string, typeof Banknote> = { CASH: Banknote, MOBILE_MONEY: Smartphone, BANK: Building2, CARD: CreditCard, OTHER: Wallet };

export function InvoiceTable({ rows, currency, showSupplier, onChanged }: { rows: Invoice[]; currency: string; showSupplier?: boolean; onChanged: () => void }) {
  const [voiding, setVoiding] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const voidInvoice = async (id: number) => {
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/supplier-invoices/${id}/void`, { reason: reason.trim() });
      setVoiding(null);
      setReason("");
      onChanged();
    } catch (cause) { setError(apiError(cause, "Could not void the invoice")); }
  };
  return (
    <div className="overflow-x-auto">
      {error && <p className="m-0 px-4 py-2 text-sm text-red-700">{error}</p>}
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead>
          <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
            <th className="px-4 py-2.5">Invoice</th>
            {showSupplier && <th className="px-2 py-2.5">Supplier</th>}
            <th className="px-2 py-2.5">Due</th>
            <th className="px-2 py-2.5 text-right">Billed</th>
            <th className="px-2 py-2.5 text-right">Accepted</th>
            <th className="px-2 py-2.5">Check</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const match = MATCH_LABELS[row.matchStatus];
            return (
              <tr key={row.id} className={`border-0 border-t border-solid border-neutral-100 align-top ${row.voidedAt ? "opacity-60" : ""}`}>
                <td className="px-4 py-3">
                  <p className="m-0 text-[15px] font-bold text-neutral-900">{row.invoiceNumber}</p>
                  <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{dateLabel(row.invoiceDate)} · {row.deliveries} {row.deliveries === 1 ? "delivery" : "deliveries"}{row.vatAmount > 0 ? ` · VAT ${formatMoney(row.vatAmount, currency)}` : ""}</p>
                  {row.photoUrl && <a href={row.photoUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand no-underline hover:underline">Photo</a>}
                  {row.voidedAt && <p className="m-0 mt-0.5 text-xs font-bold text-red-600">Voided: {row.voidReason}</p>}
                </td>
                {showSupplier && <td className="px-2 py-3 text-sm text-neutral-700">{row.supplierName}</td>}
                <td className="px-2 py-3 text-sm text-neutral-700">{dateLabel(row.dueDate)}</td>
                <td className="px-2 py-3 text-right text-sm font-bold tabular-nums">{formatMoney(row.amount, currency)}</td>
                <td className="px-2 py-3 text-right text-sm tabular-nums text-neutral-700">{formatMoney(row.receivedValue, currency)}</td>
                <td className="px-2 py-3">
                  <Pill tone={match.tone}>{match.label}</Pill>
                  {row.matchStatus !== "MATCHED" && <p className="m-0 mt-1 text-xs text-neutral-500">{row.difference > 0 ? "+" : ""}{formatMoney(row.difference, currency)}</p>}
                </td>
                <td className="px-4 py-3 text-right">
                  {!row.voidedAt && (voiding === row.id ? (
                    <div className="flex min-w-[260px] items-center gap-1.5">
                      <input value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} placeholder="Why void it?" className={`${smallFieldClass} min-w-0 flex-1`} autoFocus />
                      <button type="button" disabled={reason.trim().length < 3} onClick={() => void voidInvoice(row.id)} className={`${quietButton} text-red-700`}>Void</button>
                      <button type="button" onClick={() => setVoiding(null)} className={quietButton}>Back</button>
                    </div>
                  ) : <button type="button" onClick={() => { setVoiding(row.id); setReason(""); }} className={quietButton}>Void</button>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PaymentTable({ rows, currency, showSupplier, onChanged }: { rows: Payment[]; currency: string; showSupplier?: boolean; onChanged: () => void }) {
  const [voiding, setVoiding] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const voidPayment = async (id: number) => {
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/supplier-payments/${id}/void`, { reason: reason.trim() });
      setVoiding(null);
      setReason("");
      onChanged();
    } catch (cause) { setError(apiError(cause, "Could not void the payment")); }
  };
  const total = rows.filter((row) => !row.voidedAt).reduce((sum, row) => sum + row.amount, 0);
  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
  const head = "border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      {error && <p className="m-0 px-4 py-2 text-sm text-red-700">{error}</p>}
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${head} pl-4`}>Date paid</th>
            {showSupplier && <th className={head}>Supplier</th>}
            <th className={head}>Method</th>
            <th className={head}>Reference</th>
            <th className={head}>Payment no.</th>
            <th className={head}>Invoice</th>
            <th className={head}>Recorded by</th>
            <th className={`${head} text-right`}>Amount</th>
            <th className={`${head} w-24 pr-4 text-right`}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const Icon = METHOD_ICON[row.method] ?? Banknote;
            const voided = Boolean(row.voidedAt);
            return (
              <Fragment key={row.id}>
                <tr className={`${index % 2 ? "bg-neutral-50/60" : "bg-white"} transition hover:bg-brand/[0.04] ${voided ? "text-neutral-400" : "text-neutral-800"}`}>
                  <td className={`${cell} whitespace-nowrap pl-4 font-bold`}>{dateLabel(row.paidAt)}</td>
                  {showSupplier && <td className={`${cell} max-w-[200px] truncate whitespace-nowrap font-bold`} title={row.supplierName ?? ""}>{row.supplierName}</td>}
                  <td className={cell}>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${voided ? "bg-neutral-100" : "bg-emerald-50 text-emerald-700"}`}><Icon className="h-3.5 w-3.5" /></span>
                      {PAYMENT_METHOD_LABELS[row.method] ?? row.method}
                    </span>
                  </td>
                  <td className={`${cell} whitespace-nowrap font-mono text-[13px]`}>{row.reference ?? <span className="text-neutral-300">-</span>}</td>
                  <td className={`${cell} whitespace-nowrap font-mono text-[13px] text-neutral-500`}>{row.paymentNumber}</td>
                  <td className={`${cell} text-[13px]`}>{row.invoiceNumber ?? <span className="text-neutral-300">-</span>}</td>
                  <td className={`${cell} max-w-[180px] truncate whitespace-nowrap text-[13px]`} title={row.recordedBy ?? ""}>{row.recordedBy ?? "-"}</td>
                  <td className={`${cell} whitespace-nowrap text-right text-[15px] font-bold tabular-nums ${voided ? "line-through" : "text-emerald-700"}`}>{formatMoney(row.amount, currency)}</td>
                  <td className={`${cell} pr-4 text-right`}>
                    {voided
                      ? <Pill tone="out">Voided</Pill>
                      : voiding !== row.id && <button type="button" onClick={() => { setVoiding(row.id); setReason(""); }} className={`${quietButton} hover:border-red-300 hover:text-red-700`}>Void</button>}
                  </td>
                </tr>
                {(voiding === row.id || (voided && row.voidReason) || row.note) && (
                  <tr className="bg-neutral-50/60">
                    <td colSpan={showSupplier ? 9 : 8} className={`${cell} py-2 pl-4`}>
                      {voiding === row.id ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} placeholder="Why void this payment?" className={`${smallFieldClass} min-w-[220px] flex-1`} autoFocus />
                          <button type="button" disabled={reason.trim().length < 3} onClick={() => void voidPayment(row.id)} className={`${quietButton} text-red-700`}>Void payment</button>
                          <button type="button" onClick={() => setVoiding(null)} className={quietButton}>Back</button>
                        </div>
                      ) : (
                        <p className="m-0 text-xs">
                          {row.note && <span className="text-neutral-600">Note: {row.note}</span>}
                          {voided && row.voidReason && <span className="ml-3 font-bold text-red-600">Voided: {row.voidReason}</span>}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-neutral-100">
            <td colSpan={showSupplier ? 7 : 6} className="px-3 py-2.5 pl-4 text-right text-[11px] font-bold uppercase tracking-wide text-neutral-600">Total paid{rows.some((row) => row.voidedAt) ? " (voided left out)" : ""}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right text-[15px] font-bold tabular-nums text-neutral-950">{formatMoney(total, currency)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

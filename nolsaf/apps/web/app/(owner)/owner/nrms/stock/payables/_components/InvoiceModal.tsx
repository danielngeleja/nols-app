"use client";

// Record a supplier's invoice against the deliveries it bills. The total is
// compared with what was accepted at the door as you type; a bill above it is
// saved and flagged, and the debt stays what actually arrived.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ModalFrame from "../../../_components/NrmsModalFrame";
import { apiError, formatMoney } from "../../../_components/stockFormat";
import { checkboxClass, fieldClass, labelClass, primaryButton } from "../../items/_components/ui";
import { PhotoField } from "../../operations/_components/shared";
import { type Statement, type UninvoicedDelivery, dateLabel, todayEat } from "./payablesShared";

export default function InvoiceModal({ propertyId, currency, suppliers, supplierId: fixedSupplierId, onClose, onSaved }: {
  propertyId: number;
  currency: string;
  suppliers: Array<{ id: number; name: string }>;
  supplierId?: number | null;
  onClose: () => void;
  onSaved: (result: { matchStatus: string; difference: number }) => void;
}) {
  const [supplierId, setSupplierId] = useState<number | "">(fixedSupplierId ?? "");
  const [deliveries, setDeliveries] = useState<UninvoicedDelivery[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayEat());
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [vat, setVat] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supplierId) { setDeliveries(null); return; }
    let cancelled = false;
    setDeliveries(null);
    apiClient.get<Statement>(`/api/nrms/stock/suppliers/${supplierId}/statement`)
      .then((res) => {
        if (cancelled) return;
        setDeliveries(res.data.uninvoiced);
        setChosen(new Set());
      })
      .catch((cause) => { if (!cancelled) { setDeliveries([]); setError(apiError(cause, "Could not load the deliveries")); } });
    return () => { cancelled = true; };
  }, [supplierId]);

  const received = (deliveries ?? []).filter((row) => chosen.has(row.id)).reduce((sum, row) => sum + row.totalCost, 0);
  const billed = Number(amount) || 0;
  const difference = Math.round((billed - received) * 100) / 100;
  const valid = Boolean(supplierId) && chosen.size > 0 && invoiceNumber.trim() && billed > 0 && (Number(vat) || 0) <= billed;

  const toggle = (id: number, on: boolean) => setChosen((current) => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ matchStatus: string; difference: number }>(`/api/nrms/stock/property/${propertyId}/supplier-invoices`, {
        supplierId,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        dueDate: dueDate || null,
        amount: billed,
        vatAmount: Number(vat) || 0,
        receiptIds: [...chosen],
        photoUrl,
        note: note.trim() || null,
      });
      onSaved(res.data);
    } catch (cause) {
      setError(apiError(cause, "Could not record the invoice"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Record a supplier invoice"
      subtitle="Tick the deliveries it bills. The total is checked against what was accepted."
      icon={<FileText className="h-5 w-5" />}
      onClose={onClose}
      extraWide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {chosen.size > 0 && billed > 0 && (
              Math.abs(difference) <= 1
                ? <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Matches the goods received</span>
                : difference > 0
                  ? <span className="inline-flex items-center gap-1.5 font-bold text-amber-800"><AlertTriangle className="h-4 w-4" />Billed {formatMoney(difference, currency)} more than was accepted. It will be flagged.</span>
                  : <span className="text-neutral-600">Billed {formatMoney(-difference, currency)} less than was accepted.</span>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save invoice</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className={labelClass}>
            Supplier
            <select value={supplierId} disabled={Boolean(fixedSupplierId)} onChange={(event) => setSupplierId(event.target.value ? Number(event.target.value) : "")} className={`${fieldClass} disabled:bg-neutral-50`}>
              <option value="">Choose the supplier</option>
              {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Supplier&apos;s invoice number
            <input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value.slice(0, 80))} placeholder="As printed on the invoice" className={fieldClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className={`${labelClass} m-0`}>Invoice date</p>
              <div className="mt-1.5"><DatePickerField label="Invoice date" value={invoiceDate} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setInvoiceDate(next.slice(0, 10))} /></div>
            </div>
            <div>
              <p className={`${labelClass} m-0`}>Due date</p>
              <div className="mt-1.5"><DatePickerField label="Due date" value={dueDate} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setDueDate(next.slice(0, 10))} /></div>
            </div>
          </div>
        </div>

        <div>
          <p className={`${labelClass} m-0`}>Deliveries on this invoice</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-solid border-neutral-300">
            {!supplierId ? (
              <p className="m-0 px-4 py-5 text-center text-sm text-neutral-500">Choose the supplier to see their deliveries.</p>
            ) : !deliveries ? (
              <div className="flex justify-center py-6 text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : deliveries.length === 0 ? (
              <p className="m-0 px-4 py-5 text-center text-sm text-neutral-500">Every delivery from this supplier is already on an invoice.</p>
            ) : deliveries.map((row) => (
              <label key={row.id} className="flex cursor-pointer items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 first:border-t-0 hover:bg-neutral-50">
                <span className="flex min-w-0 items-center gap-3">
                  <input type="checkbox" checked={chosen.has(row.id)} onChange={(event) => toggle(row.id, event.target.checked)} className={checkboxClass} />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-neutral-900">{row.receiptNumber}</span>
                    <span className="block text-xs text-neutral-500">{dateLabel(row.receivedAt)} · {row.locationName} · {row.paymentMode === "CREDIT" ? "on credit" : "paid on delivery"}</span>
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums text-neutral-900">{formatMoney(row.totalCost, currency)}</span>
              </label>
            ))}
          </div>
          {chosen.size > 0 && <p className="m-0 mt-2 text-sm text-neutral-600">Accepted at the door: <span className="font-bold text-neutral-900">{formatMoney(received, currency)}</span></p>}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className={labelClass}>
            Invoice total, VAT included ({currency})
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={`${fieldClass} font-bold tabular-nums`} />
          </label>
          <label className={labelClass}>
            VAT on the invoice ({currency})
            <input inputMode="decimal" value={vat} onChange={(event) => setVat(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0 if none" className={`${fieldClass} tabular-nums`} />
          </label>
          <label className={labelClass}>
            Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Anything to remember about this bill" className={fieldClass} />
          </label>
        </div>
        <PhotoField value={photoUrl} onChange={setPhotoUrl} label="Photo of the invoice" />
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

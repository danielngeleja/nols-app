"use client";

// Record money paid to a supplier. NRMS records it; it never sends it. The
// payment posts to the ledger at that business date's Night Audit.

import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ModalFrame from "../../../_components/NrmsModalFrame";
import { apiError, formatMoney } from "../../../_components/stockFormat";
import { fieldClass, labelClass, primaryButton } from "../../items/_components/ui";
import { PAYMENT_METHOD_LABELS } from "../../operations/_components/shared";
import { type Statement, dateLabel, todayEat } from "./payablesShared";

export default function PaymentModal({ propertyId, currency, suppliers, supplierId: fixedSupplierId, onClose, onSaved }: {
  propertyId: number;
  currency: string;
  suppliers: Array<{ id: number; name: string }>;
  supplierId?: number | null;
  onClose: () => void;
  onSaved: (result: { paymentNumber: string; overpaid: number }) => void;
}) {
  const [supplierId, setSupplierId] = useState<number | "">(fixedSupplierId ?? "");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("MOBILE_MONEY");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(todayEat());
  const [invoiceId, setInvoiceId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supplierId) { setStatement(null); return; }
    let cancelled = false;
    apiClient.get<Statement>(`/api/nrms/stock/suppliers/${supplierId}/statement`)
      .then((res) => {
        if (cancelled) return;
        setStatement(res.data);
        setAmount((current) => current || (res.data.ageing.outstanding > 0 ? String(res.data.ageing.outstanding) : ""));
      })
      .catch((cause) => { if (!cancelled) setError(apiError(cause, "Could not load what is owed")); });
    return () => { cancelled = true; };
  }, [supplierId]);

  const owed = statement?.ageing.outstanding ?? 0;
  const value = Number(amount) || 0;
  const over = statement && value > owed + 0.5 ? value - owed : 0;
  const needsReference = method !== "CASH";
  const valid = Boolean(supplierId) && value > 0 && Boolean(paidAt) && (!needsReference || reference.trim().length > 0);
  const openInvoices = (statement?.invoices ?? []).filter((row) => !row.voidedAt);
  const channels = statement?.supplier.payChannels ?? [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ paymentNumber: string; overpaid: number }>(`/api/nrms/stock/property/${propertyId}/supplier-payments`, {
        supplierId,
        amount: value,
        method,
        reference: reference.trim() || null,
        paidAt,
        invoiceId: invoiceId || null,
        note: note.trim() || null,
      });
      onSaved(res.data);
    } catch (cause) {
      setError(apiError(cause, "Could not record the payment"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title="Record a payment to a supplier"
      subtitle="The money has already gone. This records it against what you owe."
      icon={<Banknote className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-neutral-600">
            {statement && <span>Owed now <span className="font-bold text-neutral-900">{formatMoney(owed, currency)}</span></span>}
            {over > 0 && <span className="ml-3 inline-flex items-center gap-1 font-bold text-amber-800"><AlertTriangle className="h-4 w-4" />{formatMoney(over, currency)} more than owed stays as credit with them</span>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Record payment</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className={labelClass}>
            Supplier
            <select value={supplierId} disabled={Boolean(fixedSupplierId)} onChange={(event) => { setSupplierId(event.target.value ? Number(event.target.value) : ""); setAmount(""); setInvoiceId(""); }} className={`${fieldClass} disabled:bg-neutral-50`}>
              <option value="">Choose the supplier</option>
              {suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Amount paid ({currency})
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className={`${fieldClass} font-bold tabular-nums`} />
          </label>
        </div>
        {channels.length > 0 && (
          <div className="rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2 text-[13px] text-neutral-600">
            <span className="font-bold text-neutral-800">Pay to: </span>{channels.map((row) => `${row.label} ${row.value}`).join(" · ")}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <label className={labelClass}>
            Paid with
            <select value={method} onChange={(event) => setMethod(event.target.value)} className={fieldClass}>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Reference{needsReference ? "" : " (optional)"}
            <input value={reference} onChange={(event) => setReference(event.target.value.slice(0, 80))} placeholder={method === "MOBILE_MONEY" ? "M-Pesa or Airtel code" : method === "BANK" ? "Bank reference" : "Receipt number"} className={fieldClass} />
          </label>
          <div>
            <p className={`${labelClass} m-0`}>Date paid</p>
            <div className="mt-1.5"><DatePickerField label="Date paid" value={paidAt} max={todayEat()} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setPaidAt(next.slice(0, 10))} /></div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className={labelClass}>
            Against invoice (optional)
            <select value={invoiceId} onChange={(event) => setInvoiceId(event.target.value ? Number(event.target.value) : "")} className={fieldClass} disabled={openInvoices.length === 0}>
              <option value="">{openInvoices.length ? "Not linked to an invoice" : "No invoices recorded"}</option>
              {openInvoices.map((row) => <option key={row.id} value={row.id}>{row.invoiceNumber} · {dateLabel(row.invoiceDate)} · {formatMoney(row.amount, currency)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Part payment, paid by the owner" className={fieldClass} />
          </label>
        </div>
        <p className="m-0 text-xs text-neutral-500">Payments clear the oldest delivery first. The date must be a business day that is still open.</p>
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

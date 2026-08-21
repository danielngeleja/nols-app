"use client";
// The agency declares how it paid the property directly. This dialog collects
// the method, the paying account and the reference, which together are all the
// property has to find the credit in its own account.
//
// Nothing here settles anything. The property confirms receipt separately, so
// the copy has to keep saying so.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Banknote, Check, CreditCard, Landmark, Loader2, ReceiptText, Smartphone, X } from "lucide-react";

export type PaymentDeclaration = { method: string; accountName: string; reference: string };

// Cash is the only method with no paying account to name.
const METHODS = [
  { value: "BANK", label: "Bank transfer", Icon: Landmark, accountLabel: "Name on the bank account" },
  { value: "CARD", label: "Card", Icon: CreditCard, accountLabel: "Name on the card" },
  { value: "MOBILE", label: "Mobile money", Icon: Smartphone, accountLabel: "Name registered on the number" },
  { value: "CASH", label: "Cash", Icon: Banknote, accountLabel: "" },
] as const;

const inputClass = "box-border h-11 w-full rounded-xl border border-solid border-neutral-200 bg-white px-3.5 text-sm font-semibold text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-neutral-900 focus:ring-4 focus:ring-neutral-900/5";
const labelClass = "mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.1em] text-neutral-500";

function Req() {
  return <span className="text-rose-600" aria-label="required" title="Required"> *</span>;
}

export default function PaymentDeclarationModal({
  invoiceNumber,
  currency,
  amount,
  dueLabel,
  busy,
  onClose,
  onSubmit,
}: {
  invoiceNumber: string;
  currency: string;
  amount: string;
  dueLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (declaration: PaymentDeclaration) => void;
}) {
  const [method, setMethod] = useState("");
  const [accountName, setAccountName] = useState("");
  const [reference, setReference] = useState("");

  const active = useMemo(() => METHODS.find((entry) => entry.value === method) ?? null, [method]);
  const needsAccount = Boolean(active) && active!.value !== "CASH";
  const ready = Boolean(active) && reference.trim().length >= 3 && (!needsAccount || accountName.trim().length >= 2);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
      <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="absolute inset-0 border-0 bg-neutral-950/50 p-0 backdrop-blur-[2px]" />

      <div role="dialog" aria-modal="true" aria-label="Declare your payment" className="relative flex max-h-[calc(100dvh-1rem)] w-full min-w-0 max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-neutral-950 text-white"><ReceiptText className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[9px] font-extrabold uppercase tracking-[0.16em] text-neutral-400">Property invoice</p>
              <h3 className="m-0 mt-0.5 text-base font-extrabold tracking-tight text-neutral-950">Declare your payment</h3>
              <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">{invoiceNumber}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid h-8 w-8 flex-none place-items-center rounded-full border-0 bg-transparent text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <div className="flex items-end justify-between gap-3 rounded-xl bg-neutral-50 p-3.5">
            <div className="min-w-0">
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.1em] text-neutral-400">Amount you paid</span>
              <b className="mt-0.5 block break-words text-xl font-extrabold tabular-nums tracking-tight text-neutral-950">{currency} {amount}</b>
            </div>
            <span className="flex-none text-[11px] font-semibold text-neutral-500">{dueLabel}</span>
          </div>

          <fieldset className="mt-4 border-0 p-0">
            <legend className={labelClass}>Paid by<Req /></legend>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map(({ value, label, Icon }) => {
                const selected = method === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setMethod(value); setAccountName(""); }}
                    aria-pressed={selected}
                    className={`box-border flex h-11 min-w-0 items-center gap-2 rounded-xl border border-solid px-3 text-left transition ${selected ? "border-neutral-900 bg-neutral-950 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50"}`}
                  >
                    <Icon className={`h-4 w-4 flex-none ${selected ? "text-white" : "text-neutral-400"}`} />
                    <span className="min-w-0 truncate text-xs font-bold">{label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {needsAccount ? (
            <label className="mt-4 block">
              <span className={labelClass}>{active!.accountLabel}<Req /></span>
              <input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Exactly as it appears on the account" maxLength={160} className={inputClass} />
            </label>
          ) : null}

          {active ? (
            <label className="mt-4 block">
              <span className={labelClass}>{active.value === "CASH" ? "Receipt number" : "Transfer reference"}<Req /></span>
              <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={active.value === "CASH" ? "Number on the receipt the hotel gave you" : "Example: FT26234QK7LM"} maxLength={120} className={inputClass} />
              <span className="mt-1.5 block text-[11px] leading-4 text-neutral-400">{active.value === "CASH" ? "The hotel matches this against the receipt it issued." : "The hotel searches its account for this reference."}</span>
            </label>
          ) : (
            <p className="m-0 mt-4 text-center text-[11px] leading-4 text-neutral-400">Choose how you paid to continue.</p>
          )}

          <p className="m-0 mt-4 rounded-xl bg-amber-50 p-3 text-[11px] leading-4 text-amber-900">
            <b className="font-extrabold">This does not confirm the payment.</b> The hotel checks its own account first. Your booking voucher and traveller entry open only once it confirms receipt.
          </p>
        </div>

        <div className="flex shrink-0 gap-2 border-0 border-t border-solid border-neutral-100 bg-white p-4 sm:p-5">
          <button type="button" onClick={onClose} disabled={busy} className="box-border h-11 flex-none rounded-xl border border-solid border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40">Cancel</button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => onSubmit({ method, accountName: accountName.trim(), reference: reference.trim() })}
            className="box-border inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border-0 bg-neutral-950 px-4 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirm and send to hotel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

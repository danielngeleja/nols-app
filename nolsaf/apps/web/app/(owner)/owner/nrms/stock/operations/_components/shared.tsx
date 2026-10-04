"use client";

// Shared pieces for Store operations: deliveries, transfers, write-offs,
// suppliers (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 2).

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import type { StockGood } from "../../../_components/StockGoodsPanel";
import { formatStockQuantity, unitShort } from "../../../_components/stockFormat";
import { smallFieldClass } from "../../items/_components/ui";

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  BANK: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};

export const PAYMENT_TERM_LABELS: Record<string, string> = {
  CASH_ON_DELIVERY: "Cash on delivery",
  CREDIT_7: "Credit, 7 days",
  CREDIT_14: "Credit, 14 days",
  CREDIT_30: "Credit, 30 days",
};

export const REJECT_REASON_LABELS: Record<string, string> = {
  DAMAGED: "Damaged",
  SPOILED: "Spoiled",
  WRONG_ITEM: "Wrong item",
  SHORT_DATED: "Too close to expiry",
  OTHER: "Other",
};

export const WASTAGE_REASON_LABELS: Record<string, string> = {
  BROKEN: "Broken",
  SPOILED: "Spoiled",
  EXPIRED: "Expired",
  SPILLED: "Spilled",
  GUEST_RETURN: "Returned by guest",
  OTHER: "Other",
};

export const WRITE_OFF_TYPE_LABELS: Record<string, string> = {
  WASTAGE: "Wastage",
  STAFF_MEAL: "Staff meal",
  COMPLIMENTARY: "Complimentary",
};

export const RECEIPT_STATUS: Record<string, { label: string; tone: "ok" | "low" | "out" | "muted" | "info" }> = {
  POSTED: { label: "In stock", tone: "ok" },
  PENDING_APPROVAL: { label: "Waiting approval", tone: "low" },
  REJECTED: { label: "Rejected", tone: "out" },
  VOIDED: { label: "Voided", tone: "muted" },
};

export const TRANSFER_STATUS: Record<string, { label: string; tone: "ok" | "low" | "out" | "muted" | "info" }> = {
  IN_TRANSIT: { label: "In transit", tone: "info" },
  RECEIVED: { label: "Received", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export const WRITE_OFF_STATUS: Record<string, { label: string; tone: "ok" | "low" | "out" | "muted" | "info" }> = {
  APPROVED: { label: "Written off", tone: "ok" },
  PENDING: { label: "Waiting approval", tone: "low" },
  REJECTED: { label: "Rejected", tone: "out" },
};

export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** A quantity entered as packs of a named unit or as base units. */
export type AmountDraft = { packUnitId: number | "units"; amount: string };

export function defaultAmount(good: StockGood | null | undefined): AmountDraft {
  const packs = good?.packUnits ?? [];
  return { packUnitId: packs.length ? packs[packs.length - 1].id : "units", amount: "" };
}

export function amountToBase(good: StockGood | null | undefined, draft: AmountDraft): number {
  const value = Number(draft.amount);
  if (!good || !(value > 0)) return 0;
  const pack = good.packUnits.find((row) => row.id === draft.packUnitId);
  return pack ? value * pack.baseQuantity : value;
}

export function amountPayload(good: StockGood | null | undefined, draft: AmountDraft): { quantity?: number; packUnitId?: number; packCount?: number } {
  const value = Number(draft.amount) || 0;
  const pack = good?.packUnits.find((row) => row.id === draft.packUnitId);
  return pack ? { packUnitId: pack.id, packCount: value } : { quantity: value };
}

/** Number box plus a pack picker ("3 Crate" or "750 ml"). */
export function AmountInput({ good, value, onChange, placeholder = "0", ariaLabel }: {
  good: StockGood | null | undefined;
  value: AmountDraft;
  onChange: (next: AmountDraft) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const base = amountToBase(good, value);
  const pack = good?.packUnits.find((row) => row.id === value.packUnitId);
  return (
    <div>
      <div className="flex gap-1.5">
        <input inputMode="decimal" aria-label={ariaLabel} value={value.amount} onChange={(event) => onChange({ ...value, amount: event.target.value.replace(/[^\d.]/g, "") })} placeholder={placeholder} className={`${smallFieldClass} w-20 text-sm font-bold tabular-nums`} />
        <select value={value.packUnitId} onChange={(event) => onChange({ ...value, packUnitId: event.target.value === "units" ? "units" : Number(event.target.value) })} disabled={!good} className={`${smallFieldClass} min-w-0 flex-1 text-sm`}>
          {(good?.packUnits ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          <option value="units">{good ? (good.baseUnit === "G" ? "grams" : good.baseUnit === "ML" ? "ml" : `${unitShort(good.baseUnit)}s`) : "units"}</option>
        </select>
      </div>
      {good && pack && base > 0 && <p className="m-0 mt-1 text-xs text-neutral-500">= {formatStockQuantity(base, good.baseUnit)}</p>}
    </div>
  );
}

/** Upload a delivery note, receipt or wastage photo to the stock evidence folder. */
export async function uploadStockPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPG, PNG or WEBP photo.");
  if (file.size > 10 * 1024 * 1024) throw new Error("The photo is larger than 10MB. Take it again at a lower size.");
  const form = new FormData();
  form.append("folder", "nrms-stock");
  form.append("file", file);
  const response = await apiClient.post("/api/uploads/cloudinary/upload?folder=nrms-stock", form);
  const url = String(response.data?.secure_url || "");
  if (!url) throw new Error("The upload did not return a photo address.");
  return url;
}

export function PhotoField({ value, onChange, label = "Photo of the receipt or delivery note" }: { value: string | null; onChange: (url: string | null) => void; label?: string }) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadStockPhoto(file));
    } catch (cause: any) {
      setError(cause?.response?.data?.message || cause?.response?.data?.error || cause?.message || "Photo upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {value ? (
          <span className="relative inline-flex">
            <a href={value} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-solid border-neutral-300 bg-neutral-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt="Attached evidence" className="h-full w-full object-cover" />
            </a>
            <button type="button" aria-label="Remove photo" onClick={() => onChange(null)} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-solid border-neutral-300 bg-white text-neutral-600 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : null}
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-neutral-400 bg-white px-3 text-sm font-bold text-neutral-700 [font-family:inherit] hover:border-brand hover:text-brand disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{value ? "Replace photo" : "Add photo"}
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => void pick(event.target.files?.[0])} />
      </div>
      {error && <p className="m-0 mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

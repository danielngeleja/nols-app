"use client";

// Purchase order editor: one supplier, one delivery shelf, goods at the
// prices the supplier is expected to honour. Saves a draft; "Save and
// approve" also submits it, which waits for the owner only when a manager's
// order is above the owner's limit.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, ShoppingCart, Trash2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockGood, StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import { fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import type { SupplierLite } from "../../operations/_components/GoodsReceiptModal";
import { type AmountDraft, AmountInput, PAYMENT_TERM_LABELS, amountPayload, amountToBase } from "../../operations/_components/shared";
import type { OrderDraft } from "./purchasingShared";

type SupplierPrice = { stockItemId: number; lastUnitCost: number | null; agreedUnitCost: number | null };
type Line = { key: number; stockItemId: number | ""; amount: AmountDraft; price: string };

let lineKey = 0;
const nextKey = () => (lineKey += 1);

function packSize(good: StockGood | null | undefined, amount: AmountDraft): number {
  const pack = good?.packUnits.find((row) => row.id === amount.packUnitId);
  return pack ? pack.baseQuantity : 1;
}

function priceText(unitCost: number | null | undefined, size: number): string {
  if (!unitCost || unitCost <= 0) return "";
  return String(Math.round(unitCost * size * 100) / 100);
}

export default function OrderEditorModal({ propertyId, overview, suppliers, initial, orderLimit, isOwner, onClose, onSaved }: {
  propertyId: number;
  overview: StockOverview;
  suppliers: SupplierLite[];
  initial: OrderDraft;
  orderLimit: number;
  isOwner: boolean;
  onClose: () => void;
  onSaved: (result: { orderId: number; submitted: boolean; status?: string }) => void;
}) {
  const goods = useMemo(() => overview.items.filter((item) => item.status === "ACTIVE"), [overview.items]);
  const goodById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "ACTIVE");

  const [supplierId, setSupplierId] = useState<number | "">(initial.supplierId ?? "");
  const [locationId, setLocationId] = useState<number | "">(initial.locationId ?? overview.locations.find((row) => row.kind === "STORE")?.id ?? (overview.locations.length === 1 ? overview.locations[0].id : ""));
  const [expectedDate, setExpectedDate] = useState(initial.expectedDate);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<Line[]>(() => {
    const rows = initial.lines.map((line) => {
      const good = goodById.get(line.stockItemId);
      const amount: AmountDraft = { packUnitId: line.packUnitId ?? "units", amount: line.amount > 0 ? String(line.amount) : "" };
      return { key: nextKey(), stockItemId: line.stockItemId, amount, price: priceText(line.unitCost ?? good?.averageCost, packSize(good, amount)) };
    });
    return rows.length ? rows : [{ key: nextKey(), stockItemId: "", amount: { packUnitId: "units", amount: "" }, price: "" }];
  });
  const [prices, setPrices] = useState<Map<number, SupplierPrice>>(new Map());
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The supplier's agreed and last prices fill any price not yet typed.
    if (!supplierId) { setPrices(new Map()); return; }
    let cancelled = false;
    apiClient.get<{ prices: SupplierPrice[] }>(`/api/nrms/stock/suppliers/${supplierId}`)
      .then((res) => {
        if (cancelled) return;
        const map = new Map(res.data.prices.map((row) => [row.stockItemId, row]));
        setPrices(map);
        setLines((rows) => rows.map((row) => {
          if (row.price || !row.stockItemId) return row;
          const known = map.get(row.stockItemId);
          const unit = known?.agreedUnitCost ?? known?.lastUnitCost ?? null;
          return unit ? { ...row, price: priceText(unit, packSize(goodById.get(row.stockItemId), row.amount)) } : row;
        }));
      })
      .catch(() => { if (!cancelled) setPrices(new Map()); });
    return () => { cancelled = true; };
  }, [supplierId, goodById]);

  const update = (key: number, patch: Partial<Line>) => setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const choose = (key: number, id: number | "") => {
    const good = id ? goodById.get(id) : null;
    const packs = good?.packUnits ?? [];
    const amount: AmountDraft = { packUnitId: packs.length ? packs[packs.length - 1].id : "units", amount: "" };
    const known = id ? prices.get(id) : undefined;
    const unit = known?.agreedUnitCost ?? known?.lastUnitCost ?? good?.averageCost ?? null;
    update(key, { stockItemId: id, amount, price: priceText(unit, packSize(good, amount)) });
  };

  /** Changing the pack keeps the price per base unit the same. */
  const changeAmount = (line: Line, next: AmountDraft) => {
    const good = line.stockItemId ? goodById.get(line.stockItemId) : null;
    if (next.packUnitId !== line.amount.packUnitId && Number(line.price) > 0) {
      const perBase = Number(line.price) / packSize(good, line.amount);
      update(line.key, { amount: next, price: priceText(perBase, packSize(good, next)) });
    } else {
      update(line.key, { amount: next });
    }
  };

  const computed = lines.map((line) => {
    const good = line.stockItemId ? goodById.get(line.stockItemId) ?? null : null;
    const base = amountToBase(good, line.amount);
    const size = packSize(good, line.amount);
    const unitCost = Number(line.price) > 0 ? Number(line.price) / size : 0;
    const known = good ? prices.get(good.id) : undefined;
    const usual = known?.agreedUnitCost ?? known?.lastUnitCost ?? null;
    const aboveUsual = Boolean(usual && unitCost > usual * (1 + overview.settings.priceAlertPercent / 100));
    const pack = good?.packUnits.find((row) => row.id === line.amount.packUnitId);
    const unitLabel = pack ? pack.name : good ? unitShort(good.baseUnit) : "unit";
    return { line, good, base, unitCost, total: Math.round(base * unitCost), usual, aboveUsual, unitLabel };
  });
  const total = computed.reduce((sum, row) => sum + row.total, 0);
  const duplicate = new Set<number>();
  const seen = new Set<number>();
  for (const row of computed) if (row.good) { if (seen.has(row.good.id)) duplicate.add(row.good.id); seen.add(row.good.id); }
  const valid = Boolean(supplierId && locationId) && computed.length > 0 && duplicate.size === 0 && computed.every((row) => row.good && row.base > 0);
  const pricesComplete = computed.every((row) => row.unitCost > 0);
  const waitsForOwner = !isOwner && total > orderLimit;
  const supplier = activeSuppliers.find((row) => row.id === supplierId);

  const save = async (submit: boolean) => {
    setBusy(submit ? "submit" : "draft");
    setError(null);
    const payload = {
      supplierId,
      locationId,
      expectedDate: expectedDate || null,
      note: note.trim() || null,
      lines: computed.map((row) => ({ stockItemId: row.good!.id, ...amountPayload(row.good, row.line.amount), unitCost: Math.round(row.unitCost * 10000) / 10000 })),
      requisitionLineIds: initial.requisitionLineIds,
    };
    let orderId = initial.orderId ?? null;
    try {
      if (orderId) await apiClient.put(`/api/nrms/stock/purchase-orders/${orderId}`, payload);
      else orderId = (await apiClient.post<{ orderId: number }>(`/api/nrms/stock/property/${propertyId}/purchase-orders`, payload)).data.orderId;
    } catch (cause) {
      setError(apiError(cause, "Could not save the order"));
      setBusy(null);
      return;
    }
    if (!submit) { onSaved({ orderId: orderId!, submitted: false }); return; }
    try {
      const res = await apiClient.post<{ status: string }>(`/api/nrms/stock/purchase-orders/${orderId}/submit`);
      onSaved({ orderId: orderId!, submitted: true, status: res.data.status });
    } catch (cause) {
      // The draft is saved; say why it could not go further.
      setError(`Draft saved. ${apiError(cause, "It could not be submitted yet.")}`);
      setBusy(null);
    }
  };

  return (
    <ModalFrame
      title={initial.orderId ? "Edit draft order" : "New purchase order"}
      subtitle="One supplier, one delivery place, the prices you expect to pay"
      icon={<ShoppingCart className="h-5 w-5" />}
      onClose={onClose}
      extraWide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-neutral-600">
            <span className="font-bold text-neutral-900">Order total {formatMoney(total, overview.currency)}</span>
            {waitsForOwner && <span className="ml-3 text-amber-800">Above {formatMoney(orderLimit, overview.currency)}: the owner approves before it goes out.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={!valid || busy != null} onClick={() => void save(false)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-solid border-brand/50 bg-white px-4 text-sm font-bold text-brand [font-family:inherit] hover:bg-brand/5 disabled:opacity-50">{busy === "draft" && <Loader2 className="h-4 w-4 animate-spin" />}Save draft</button>
            <button type="button" disabled={!valid || !pricesComplete || busy != null} onClick={() => void save(true)} className={`${primaryButton} !h-10 px-4`}>{busy === "submit" && <Loader2 className="h-4 w-4 animate-spin" />}{waitsForOwner ? "Save and send to owner" : "Save and approve"}</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-solid border-neutral-200 bg-neutral-50/70 p-4">
          <p className="m-0 mb-3 text-[11px] font-bold uppercase tracking-wide text-neutral-500">Order details</p>
          <div className="grid gap-4 md:grid-cols-3">
            <label className={labelClass}>
              Supplier
              <select value={supplierId} onChange={(event) => setSupplierId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
                <option value="">Choose the supplier</option>
                {activeSuppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              {supplier && <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-neutral-500">{PAYMENT_TERM_LABELS[supplier.paymentTerms] ?? supplier.paymentTerms}{supplier.phone ? ` · ${supplier.phone}` : " · no phone saved"}</span>}
            </label>
            <label className={labelClass}>
              Deliver to
              <select value={locationId} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
                <option value="">Choose where it goes</option>
                {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <div>
              <p className={`${labelClass} m-0`}>Needed by</p>
              <div className="mt-1.5"><DatePickerField label="Needed by" value={expectedDate} min={new Date().toISOString().slice(0, 10)} twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setExpectedDate(next.slice(0, 10))} /></div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-solid border-neutral-300">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr>
                  {[["#", "w-10 pl-4 text-center"], ["Good", ""], ["Quantity", ""], ["Price per unit", ""], ["Line total", "text-right"], ["", "w-12 pr-4"]].map(([label, extra]) => (
                    <th key={label || "remove"} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {computed.map(({ line, good, total: lineTotal, usual, aboveUsual, unitLabel }, index) => {
                  const warn = aboveUsual || (good && duplicate.has(good.id));
                  const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-2.5 align-top";
                  return (
                    <tr key={line.key} className={warn ? "bg-amber-50/60" : index % 2 ? "bg-neutral-50/50" : "bg-white"}>
                      <td className={`${cell} pl-4 pt-4 text-center text-xs font-bold text-neutral-400`}>{index + 1}</td>
                      <td className={`${cell} min-w-[220px]`}>
                        <select value={line.stockItemId} onChange={(event) => choose(line.key, event.target.value ? Number(event.target.value) : "")} className={`${smallFieldClass} w-full`} aria-label={`Good ${index + 1}`}>
                          <option value="">Choose goods</option>
                          {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                        </select>
                        {good && duplicate.has(good.id) && <span className="mt-1 block text-xs font-bold text-amber-800">Already on the order. Use one line.</span>}
                      </td>
                      <td className={`${cell} w-[240px]`}><AmountInput good={good} value={line.amount} onChange={(next) => changeAmount(line, next)} ariaLabel="Quantity ordered" /></td>
                      <td className={`${cell} w-[190px]`}>
                        <div className="relative">
                          <input inputMode="decimal" value={line.price} onChange={(event) => update(line.key, { price: event.target.value.replace(/[^\d.]/g, "") })} placeholder="0" className={`${smallFieldClass} w-full pr-12 font-bold tabular-nums`} aria-label={`Price per ${unitLabel}`} />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{overview.currency}</span>
                        </div>
                        <span className="mt-1 block text-xs text-neutral-500">per {unitLabel}</span>
                        {good && usual ? (
                          <span className={`block text-xs ${aboveUsual ? "font-bold text-amber-800" : "text-neutral-400"}`}>
                            {aboveUsual && <AlertTriangle className="mr-1 inline h-3 w-3" />}Usually {formatUnitCost(usual, overview.currency)}/{unitShort(good.baseUnit)}
                          </span>
                        ) : null}
                      </td>
                      <td className={`${cell} whitespace-nowrap pt-4 text-right font-bold tabular-nums ${lineTotal > 0 ? "text-neutral-950" : "text-neutral-300"}`}>{formatMoney(lineTotal, overview.currency)}</td>
                      <td className={`${cell} pr-4 pt-2.5 text-right`}>
                        <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:border-red-300 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-neutral-100">
                  <td colSpan={4} className="px-3 py-2.5 pl-4">
                    <button type="button" onClick={() => setLines((rows) => [...rows, { key: nextKey(), stockItemId: "", amount: { packUnitId: "units", amount: "" }, price: "" }])} className={`${quietButton} bg-white`}><Plus className="h-3.5 w-3.5" />Add another good</button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-neutral-500">Order total</span>
                    <span className="text-[15px] font-bold tabular-nums text-neutral-950">{formatMoney(total, overview.currency)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        {!pricesComplete && valid && <p className="m-0 -mt-2 text-xs text-neutral-500">Enter a price for every good before approving. The delivery is checked against it.</p>}

        <label className={labelClass}>
          Note to the supplier (optional)
          <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} placeholder="Delivery time, gate, brand preferences" className={fieldClass} />
        </label>
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

"use client";

// Goods received note: what actually arrived, counted at the door. Accepted
// quantity enters stock; rejected quantity never does. Weighed goods carry the
// supplier's paper weight next to the scale weight so the gap is on record.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockGood, StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatStockQuantity, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import { checkboxClass, fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";
import { type AmountDraft, AmountInput, PAYMENT_METHOD_LABELS, PhotoField, REJECT_REASON_LABELS, amountPayload, amountToBase, defaultAmount } from "./shared";

export type SupplierLite = { id: number; name: string; phone: string | null; paymentTerms: string; status: string };
type SupplierPrice = { stockItemId: number; lastUnitCost: number | null; agreedUnitCost: number | null };

/** A purchase order being received: its supplier and shelf are fixed, its lines pre-fill the note. */
export type OrderForReceipt = {
  id: number;
  orderNumber: string;
  supplierId: number;
  supplierName: string;
  paymentTerms: string;
  locationId: number;
  overDeliveryPercent: number;
  lines: Array<{ id: number; stockItemId: number; packUnitId: number | null; quantity: number; receivedQuantity: number; outstanding: number; unitCost: number; countStyle: string }>;
};

type Line = {
  key: number;
  orderLineId: number | null;
  stockItemId: number | "";
  accepted: AmountDraft;
  claimed: string;
  rejected: string;
  rejectReason: string;
  totalPaid: string;
  expiresAt: string;
  showExtras: boolean;
};

let lineKey = 0;
function newLine(): Line {
  lineKey += 1;
  return { key: lineKey, orderLineId: null, stockItemId: "", accepted: { packUnitId: "units", amount: "" }, claimed: "", rejected: "", rejectReason: "", totalPaid: "", expiresAt: "", showExtras: false };
}

/** What is still to come on each order line, entered in the order's own pack when it divides evenly. */
function linesFromOrder(order: OrderForReceipt, goodById: Map<number, StockGood>): Line[] {
  const rows = order.lines.filter((line) => line.outstanding > 0).map((line) => {
    const good = goodById.get(line.stockItemId);
    const pack = good?.packUnits.find((row) => row.id === line.packUnitId);
    const packs = pack ? line.outstanding / pack.baseQuantity : 0;
    const accepted: AmountDraft = pack && Number.isInteger(Math.round(packs * 1000) / 1000)
      ? { packUnitId: pack.id, amount: String(Math.round(packs * 1000) / 1000) }
      : { packUnitId: "units", amount: String(line.outstanding) };
    lineKey += 1;
    return { ...newLine(), key: lineKey, orderLineId: line.id, stockItemId: line.stockItemId, accepted, totalPaid: String(Math.round(line.outstanding * line.unitCost)) };
  });
  return rows.length ? rows : [newLine()];
}

export default function GoodsReceiptModal({ propertyId, overview, suppliers, onSupplierAdded, onClose, onSaved, purchaseOrder }: {
  propertyId: number;
  overview: StockOverview;
  suppliers: SupplierLite[];
  onSupplierAdded: (supplier: SupplierLite) => void;
  onClose: () => void;
  onSaved: (result: { receiptNumber: string; status: string; flaggedLines: number; overDelivered?: string[] }) => void;
  /** Receive against this order instead of recording a free delivery. */
  purchaseOrder?: OrderForReceipt | null;
}) {
  const goods = useMemo(() => overview.items.filter((item) => item.status === "ACTIVE"), [overview.items]);
  const goodById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "ACTIVE" || supplier.id === purchaseOrder?.supplierId);
  const orderLineById = useMemo(() => new Map((purchaseOrder?.lines ?? []).map((line) => [line.id, line])), [purchaseOrder]);

  const [supplierId, setSupplierId] = useState<number | "">(purchaseOrder?.supplierId ?? "");
  const [locationId, setLocationId] = useState<number | "">(purchaseOrder?.locationId ?? overview.locations.find((row) => row.kind === "STORE")?.id ?? (overview.locations.length === 1 ? overview.locations[0].id : ""));
  const [documentNumber, setDocumentNumber] = useState("");
  const [paymentMode, setPaymentMode] = useState<"PAID" | "CREDIT">(purchaseOrder && purchaseOrder.paymentTerms !== "CASH_ON_DELIVERY" ? "CREDIT" : "PAID");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentReference, setPaymentReference] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>(() => (purchaseOrder ? linesFromOrder(purchaseOrder, goodById) : [newLine()]));
  const [prices, setPrices] = useState<Map<number, SupplierPrice>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");

  useEffect(() => {
    // The supplier's own price history decides what counts as a price jump.
    if (!supplierId) { setPrices(new Map()); return; }
    let cancelled = false;
    apiClient.get<{ prices: SupplierPrice[] }>(`/api/nrms/stock/suppliers/${supplierId}`)
      .then((res) => { if (!cancelled) setPrices(new Map(res.data.prices.map((row) => [row.stockItemId, row]))); })
      .catch(() => { if (!cancelled) setPrices(new Map()); });
    return () => { cancelled = true; };
  }, [supplierId]);

  const updateLine = (key: number, patch: Partial<Line>) => setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const computed = lines.map((line) => {
    const good = line.stockItemId ? goodById.get(line.stockItemId) ?? null : null;
    const accepted = amountToBase(good, line.accepted);
    const paid = Number(line.totalPaid) || 0;
    const unitCost = accepted > 0 && paid > 0 ? paid / accepted : 0;
    const price = good ? prices.get(good.id) : undefined;
    const orderLine = line.orderLineId ? orderLineById.get(line.orderLineId) ?? null : null;
    // On an order, the agreed order price is what the delivery is checked against.
    const expected = orderLine ? orderLine.unitCost : price?.agreedUnitCost ?? price?.lastUnitCost ?? good?.averageCost ?? null;
    const flagged = Boolean(unitCost > 0 && expected && unitCost > expected * (1 + overview.settings.priceAlertPercent / 100));
    const claimed = Number(line.claimed) || 0;
    const shortOnScale = good && claimed > 0 && accepted > 0 && claimed > accepted ? claimed - accepted : 0;
    return { line, good, accepted, paid, unitCost, expected, flagged, shortOnScale, rejected: Number(line.rejected) || 0, orderLine };
  });
  const total = computed.reduce((sum, row) => sum + row.paid, 0);
  const flaggedCount = computed.filter((row) => row.flagged).length;
  // Mirrors the server: only goods off the order count against the delivery
  // limit, and more than the order allows waits for a manager.
  const offOrderTotal = computed.filter((row) => !row.orderLine).reduce((sum, row) => sum + row.paid, 0);
  const acceptedByOrderLine = new Map<number, number>();
  for (const row of computed) if (row.orderLine) acceptedByOrderLine.set(row.orderLine.id, (acceptedByOrderLine.get(row.orderLine.id) ?? 0) + row.accepted);
  const overOrdered = purchaseOrder ? purchaseOrder.lines.filter((line) => {
    const allowance = (line.quantity * purchaseOrder.overDeliveryPercent) / 100;
    const ceiling = line.quantity + (line.countStyle === "WHOLE" ? Math.floor(allowance + 1e-9) : allowance);
    return line.receivedQuantity + (acceptedByOrderLine.get(line.id) ?? 0) > ceiling + 1e-9;
  }).map((line) => line.id) : [];
  const needsApproval = !overview.canApprove && (overOrdered.length > 0 || (purchaseOrder ? offOrderTotal : total) > overview.settings.directPurchaseLimit);
  const location = overview.locations.find((row) => row.id === locationId);

  const valid = Boolean(locationId)
    && (paymentMode === "PAID" ? Boolean(paymentMethod) : Boolean(supplierId))
    && computed.length > 0
    && computed.every((row) => row.good && (row.accepted > 0 || row.rejected > 0) && (row.accepted === 0 || row.paid > 0) && (row.rejected === 0 || row.line.rejectReason));

  const addSupplier = async () => {
    if (!newSupplierName.trim()) return;
    setError(null);
    try {
      const res = await apiClient.post<{ supplier: SupplierLite }>(`/api/nrms/stock/property/${propertyId}/suppliers`, { name: newSupplierName.trim(), phone: newSupplierPhone.trim() || null });
      onSupplierAdded(res.data.supplier);
      setSupplierId(res.data.supplier.id);
      setAddingSupplier(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
    } catch (cause) {
      setError(apiError(cause, "Could not add the supplier"));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ receiptNumber: string; status: string; flaggedLines: number; overDelivered?: string[] }>(`/api/nrms/stock/property/${propertyId}/goods-receipts`, {
        supplierId: supplierId || null,
        purchaseOrderId: purchaseOrder?.id ?? null,
        locationId,
        paymentMode,
        paymentMethod: paymentMode === "PAID" ? paymentMethod : null,
        paymentReference: paymentReference.trim() || null,
        supplierDocumentNumber: documentNumber.trim() || null,
        photoUrl,
        note: note.trim() || null,
        lines: computed.map((row) => ({
          stockItemId: row.good!.id,
          ...amountPayload(row.good, row.line.accepted),
          ...(row.accepted > 0 ? { totalCost: row.paid } : {}),
          claimedQuantity: Number(row.line.claimed) > 0 ? Number(row.line.claimed) : null,
          rejectedQuantity: row.rejected > 0 ? row.rejected : null,
          rejectReason: row.rejected > 0 ? row.line.rejectReason : null,
          expiresAt: row.line.expiresAt || null,
          purchaseOrderLineId: row.orderLine?.id ?? null,
        })),
      });
      onSaved(res.data);
    } catch (cause) {
      setError(apiError(cause, "Could not record the delivery"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title={purchaseOrder ? `Receive ${purchaseOrder.orderNumber}` : "New delivery"}
      subtitle={purchaseOrder ? `${purchaseOrder.supplierName}. Correct each line to what actually arrived.` : "Count what is in front of you, not what the paper says"}
      icon={<ClipboardCheck className="h-5 w-5" />}
      onClose={onClose}
      extraWide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-neutral-600">
            <span className="font-bold text-neutral-900">Total {formatMoney(total, overview.currency)}</span>
            {flaggedCount > 0 && <span className="ml-3 inline-flex items-center gap-1 font-bold text-amber-700"><AlertTriangle className="h-4 w-4" />{flaggedCount} price {flaggedCount === 1 ? "jump" : "jumps"}</span>}
            {needsApproval && (overOrdered.length > 0
              ? <span className="ml-3 text-amber-800">More than ordered: a manager accepts the extra before it enters stock.</span>
              : <span className="ml-3 text-amber-800">Above {formatMoney(overview.settings.directPurchaseLimit, overview.currency)}: a manager approves before it enters stock.</span>)}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={!valid || busy} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{needsApproval ? "Send for approval" : "Receive into stock"}</button>
          </div>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className={labelClass}>
              Supplier
              <select value={supplierId} disabled={Boolean(purchaseOrder)} onChange={(event) => setSupplierId(event.target.value ? Number(event.target.value) : "")} className={`${fieldClass} disabled:bg-neutral-50`}>
                {purchaseOrder
                  ? <option value={purchaseOrder.supplierId}>{purchaseOrder.supplierName}</option>
                  : <option value="">No supplier (market purchase)</option>}
                {!purchaseOrder && activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
            {purchaseOrder ? null : !addingSupplier ? (
              <button type="button" onClick={() => setAddingSupplier(true)} className="mt-1.5 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-bold text-brand [font-family:inherit] hover:underline"><UserPlus className="h-3.5 w-3.5" />New supplier</button>
            ) : (
              <div className="mt-2 space-y-2 rounded-lg border border-solid border-neutral-300 p-2.5">
                <input value={newSupplierName} onChange={(event) => setNewSupplierName(event.target.value.slice(0, 160))} placeholder="Supplier name" className={`${smallFieldClass} w-full`} />
                <input value={newSupplierPhone} onChange={(event) => setNewSupplierPhone(event.target.value.slice(0, 30))} placeholder="Phone (optional)" className={`${smallFieldClass} w-full`} />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setAddingSupplier(false)} className={quietButton}>Cancel</button>
                  <button type="button" disabled={!newSupplierName.trim()} onClick={() => void addSupplier()} className={`${primaryButton} h-8`}>Add</button>
                </div>
              </div>
            )}
          </div>
          <label className={labelClass}>
            Received at
            <select value={locationId} disabled={Boolean(purchaseOrder)} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")} className={`${fieldClass} disabled:bg-neutral-50`}>
              <option value="">Choose where it goes</option>
              {overview.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Supplier&apos;s delivery note or invoice number
            <input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value.slice(0, 80))} placeholder="Optional" className={fieldClass} />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className={`${labelClass} m-0`}>Payment</p>
            <div className="mt-1.5 inline-flex rounded-lg border border-solid border-neutral-300 bg-white p-0.5">
              {([["PAID", "Paid on delivery"], ["CREDIT", "On credit"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setPaymentMode(value)} className={`h-9 rounded-md border-0 px-3 text-sm font-bold [font-family:inherit] ${paymentMode === value ? "bg-brand text-white" : "bg-transparent text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
              ))}
            </div>
            {paymentMode === "CREDIT" && !supplierId && <p className="m-0 mt-1 text-xs text-amber-800">Credit needs a supplier, so the debt has a name.</p>}
          </div>
          {paymentMode === "PAID" ? (
            <>
              <label className={labelClass}>
                Paid with
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className={fieldClass}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Reference
                <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value.slice(0, 80))} placeholder="M-Pesa code, bank ref (optional)" className={fieldClass} />
              </label>
            </>
          ) : <div className="md:col-span-2" />}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <p className={`${labelClass} m-0`}>What arrived</p>
            {location && <span className="text-xs text-neutral-500">Into {location.name}</span>}
          </div>
          <div className="mt-2 space-y-2">
            {computed.map(({ line, good, accepted, unitCost, expected, flagged, shortOnScale, orderLine }, index) => {
              const weighed = good && (good.baseUnit === "G" || good.baseUnit === "ML");
              const over = orderLine ? overOrdered.includes(orderLine.id) : false;
              return (
                <div key={line.key} className={`rounded-xl border border-solid p-3 ${flagged || over ? "border-amber-300 bg-amber-50/40" : "border-neutral-300 bg-white"}`}>
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_36px] md:items-start">
                    <label className="block">
                      <span className="text-xs font-bold text-neutral-500">{orderLine ? "On the order" : purchaseOrder ? "Not on the order" : `Good ${index + 1}`}</span>
                      <select value={line.stockItemId} disabled={Boolean(orderLine)} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : ""; updateLine(line.key, { stockItemId: id, accepted: defaultAmount(id ? goodById.get(id) : null) }); }} className={`${smallFieldClass} mt-1 w-full disabled:bg-neutral-50 disabled:font-bold disabled:text-neutral-900`}>
                        <option value="">Choose goods</option>
                        {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                      {orderLine && good && (
                        <span className={`mt-1 block text-xs ${over ? "font-bold text-amber-800" : "text-neutral-500"}`}>
                          Ordered {formatStockQuantity(orderLine.quantity, good.baseUnit)}
                          {orderLine.receivedQuantity > 0 ? `, ${formatStockQuantity(orderLine.receivedQuantity, good.baseUnit)} already in` : ""}
                          {over ? ". More than the order allows." : ""}
                        </span>
                      )}
                    </label>
                    <div>
                      <span className="text-xs font-bold text-neutral-500">{weighed ? "On the scale (accepted)" : "Accepted"}</span>
                      <div className="mt-1"><AmountInput good={good} value={line.accepted} onChange={(next) => updateLine(line.key, { accepted: next })} ariaLabel="Accepted quantity" /></div>
                    </div>
                    <label className="block">
                      <span className="text-xs font-bold text-neutral-500">Total paid</span>
                      <input inputMode="decimal" value={line.totalPaid} onChange={(event) => updateLine(line.key, { totalPaid: event.target.value.replace(/[^\d.]/g, "") })} placeholder={overview.currency} className={`${smallFieldClass} mt-1 w-full font-bold tabular-nums`} />
                      {good && unitCost > 0 && (
                        <span className={`mt-1 block text-xs ${flagged ? "font-bold text-amber-800" : "text-neutral-500"}`}>
                          {formatUnitCost(unitCost, overview.currency)} per {unitShort(good.baseUnit)}
                          {expected ? ` · ${orderLine ? "ordered at" : "usually"} ${formatUnitCost(expected, overview.currency)}` : ""}
                        </span>
                      )}
                    </label>
                    <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))} className="mt-5 flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:text-red-600 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
                  </div>

                  {good && (
                    <div className="mt-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-600">
                        <input type="checkbox" checked={line.showExtras} onChange={(event) => updateLine(line.key, { showExtras: event.target.checked })} className={checkboxClass} />
                        Rejected goods, paper weight{good.perishable ? " or expiry" : ""}
                      </label>
                      {line.showExtras && (
                        <div className="mt-2 grid gap-2 md:grid-cols-4">
                          <label className="block">
                            <span className="text-xs font-bold text-neutral-500">Rejected ({unitShort(good.baseUnit)})</span>
                            <input inputMode="decimal" value={line.rejected} onChange={(event) => updateLine(line.key, { rejected: event.target.value.replace(/[^\d.]/g, "") })} placeholder="0" className={`${smallFieldClass} mt-1 w-full tabular-nums`} />
                          </label>
                          <label className="block">
                            <span className="text-xs font-bold text-neutral-500">Why rejected</span>
                            <select value={line.rejectReason} onChange={(event) => updateLine(line.key, { rejectReason: event.target.value })} className={`${smallFieldClass} mt-1 w-full`}>
                              <option value="">Choose</option>
                              {Object.entries(REJECT_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-xs font-bold text-neutral-500">Paper says ({unitShort(good.baseUnit)})</span>
                            <input inputMode="decimal" value={line.claimed} onChange={(event) => updateLine(line.key, { claimed: event.target.value.replace(/[^\d.]/g, "") })} placeholder="Supplier's figure" className={`${smallFieldClass} mt-1 w-full tabular-nums`} />
                            {shortOnScale > 0 && <span className="mt-1 block text-xs font-bold text-red-700">{formatStockQuantity(shortOnScale, good.baseUnit)} short of the paper</span>}
                          </label>
                          {good.perishable && (
                            <label className="block">
                              <span className="text-xs font-bold text-neutral-500">Use by</span>
                              <div className="mt-1"><DatePickerField label="Use by" value={line.expiresAt} min={new Date().toISOString().slice(0, 10)} twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => updateLine(line.key, { expiresAt: next.slice(0, 10) })} /></div>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {accepted === 0 && Number(line.rejected) > 0 && <p className="m-0 mt-2 text-xs text-neutral-500">Whole line rejected: nothing enters stock.</p>}
                </div>
              );
            })}
            <button type="button" onClick={() => setLines((rows) => [...rows, newLine()])} className={quietButton}><Plus className="h-3.5 w-3.5" />Add another good</button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PhotoField value={photoUrl} onChange={setPhotoUrl} />
          <label className={labelClass}>
            Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Delivered by, vehicle, anything unusual" className={fieldClass} />
          </label>
        </div>
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

export type { StockGood };

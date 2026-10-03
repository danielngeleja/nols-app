"use client";

// The reorder list: every good at or below its reorder point, what is already
// coming, and a suggested quantity in whole packs. Managers turn a selection
// into one draft order per supplier; the shelf turns it into a request.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Loader2, PackageSearch, ShoppingCart } from "lucide-react";
import apiClient from "@/lib/apiClient";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { STOCK_CATEGORY_LABELS, apiError, categoryTone, formatMoney, formatStockQuantity } from "../../../_components/stockFormat";
import { EmptyState, cardClass, checkboxClass, primaryButton, smallFieldClass } from "../../items/_components/ui";
import type { SupplierLite } from "../../operations/_components/GoodsReceiptModal";
import type { RequestPrefill } from "./RequestModal";
import type { OrderDraft, PurchasingSummary, ReorderRow } from "./purchasingShared";

const rowKey = (row: ReorderRow) => `${row.locationId}:${row.stockItemId}`;

/** "bottles", "g", "ml": the word after a bare base-unit quantity. */
function unitWord(baseUnit: string): string {
  return formatStockQuantity(2, baseUnit).replace(/^2 /, "");
}

export default function ReorderTab({ propertyId, overview, summary, suppliers, refreshKey, onOrder, onDraftsCreated, onAsk }: {
  propertyId: number;
  overview: StockOverview;
  summary: PurchasingSummary;
  suppliers: SupplierLite[];
  refreshKey: number;
  /** Open the editor for one supplier's order. */
  onOrder: (draft: OrderDraft) => void;
  /** Several suppliers: drafts were created directly. */
  onDraftsCreated: (count: number) => void;
  onAsk: (prefill: RequestPrefill) => void;
}) {
  const [rows, setRows] = useState<ReorderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<number | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Map<string, string>>(new Map());
  const [supplierFor, setSupplierFor] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === "ACTIVE");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<{ rows: ReorderRow[] }>(`/api/nrms/stock/property/${propertyId}/reorder`);
      setRows(res.data.rows);
      // Everything that needs buying and is not already coming starts ticked.
      setSelected(new Set(res.data.rows.filter((row) => row.suggestedQuantity > 0).map(rowKey)));
      setAmounts(new Map());
      setSupplierFor(new Map());
    } catch (cause) {
      setError(apiError(cause, "Unable to load the reorder list"));
    }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const visible = useMemo(() => (rows ?? []).filter((row) => locationFilter === "all" || row.locationId === locationFilter), [rows, locationFilter]);
  const groups = useMemo(() => {
    const map = new Map<number, { name: string; rows: ReorderRow[] }>();
    for (const row of visible) {
      const group = map.get(row.locationId) ?? { name: row.locationName, rows: [] };
      group.rows.push(row);
      map.set(row.locationId, group);
    }
    return [...map.entries()];
  }, [visible]);
  const locations = useMemo(() => [...new Map((rows ?? []).map((row) => [row.locationId, row.locationName])).entries()], [rows]);

  const amountOf = (row: ReorderRow) => {
    const typed = amounts.get(rowKey(row));
    if (typed != null) return Number(typed) || 0;
    return row.suggestedPackCount ?? row.suggestedQuantity;
  };
  const baseOf = (row: ReorderRow) => {
    const good = overview.items.find((item) => item.id === row.stockItemId);
    const pack = good?.packUnits.find((unit) => unit.id === row.suggestedPackUnitId);
    return pack ? amountOf(row) * pack.baseQuantity : amountOf(row);
  };
  const supplierOf = (row: ReorderRow) => supplierFor.get(rowKey(row)) ?? row.supplierId ?? null;

  const chosen = visible.filter((row) => selected.has(rowKey(row)) && amountOf(row) > 0);
  const missingSupplier = chosen.filter((row) => !supplierOf(row));
  // One order per supplier and delivery shelf.
  const groupMap = new Map<string, { supplierId: number; locationId: number; rows: ReorderRow[] }>();
  for (const row of chosen) {
    const supplierId = supplierOf(row);
    if (!supplierId) continue;
    const key = `${supplierId}:${row.locationId}`;
    const group = groupMap.get(key) ?? { supplierId, locationId: row.locationId, rows: [] };
    group.rows.push(row);
    groupMap.set(key, group);
  }
  const orderGroups = [...groupMap.values()];
  const estimate = chosen.reduce((sum, row) => sum + baseOf(row) * (row.unitCost ?? 0), 0);
  const chosenLocations = new Set(chosen.map((row) => row.locationId));

  const draftFor = (group: { supplierId: number; locationId: number; rows: ReorderRow[] }): OrderDraft => ({
    supplierId: group.supplierId,
    locationId: group.locationId,
    expectedDate: "",
    note: "",
    lines: group.rows.map((row) => ({ stockItemId: row.stockItemId, packUnitId: row.suggestedPackUnitId, amount: amountOf(row), unitCost: supplierFor.has(rowKey(row)) && supplierFor.get(rowKey(row)) !== row.supplierId ? null : row.unitCost })),
    requisitionLineIds: [],
  });

  const buildOrders = async () => {
    if (orderGroups.length === 1) { onOrder(draftFor(orderGroups[0])); return; }
    setBusy(true);
    setError(null);
    let created = 0;
    try {
      for (const group of orderGroups) {
        const draft = draftFor(group);
        await apiClient.post(`/api/nrms/stock/property/${propertyId}/purchase-orders`, {
          supplierId: draft.supplierId,
          locationId: draft.locationId,
          lines: draft.lines.map((line) => ({ stockItemId: line.stockItemId, ...(line.packUnitId ? { packUnitId: line.packUnitId, packCount: line.amount } : { quantity: line.amount }), unitCost: line.unitCost ?? 0 })),
        });
        created += 1;
      }
      onDraftsCreated(created);
    } catch (cause) {
      setError(`${created ? `${created} draft ${created === 1 ? "order was" : "orders were"} created. ` : ""}${apiError(cause, "Could not create the orders")}`);
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    const [locationId] = [...chosenLocations];
    onAsk({ locationId: locationId ?? null, lines: chosen.map((row) => ({ stockItemId: row.stockItemId, packUnitId: row.suggestedPackUnitId, amount: amountOf(row) })) });
  };

  const toggle = (key: string, on: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  if (error && !rows) return <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!rows) return <div className={`${cardClass} flex min-h-[24vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (rows.length === 0) {
    return (
      <div className={cardClass}>
        <EmptyState icon={CheckCircle2} title="Nothing needs buying" body="No good is at or below its reorder point. Set reorder points and par levels on Stock items so this list can tell you what to buy and how much." />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      {locations.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {([["all", "All shelves"], ...locations] as Array<[number | "all", string]>).map(([value, label]) => (
            <button key={String(value)} type="button" onClick={() => setLocationFilter(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${locationFilter === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
          ))}
        </div>
      )}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {groups.map(([locationId, group]) => (
        <section key={locationId} className={`${cardClass} overflow-hidden`}>
          <header className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-brand" />
              <h2 className="m-0 text-[15px] font-bold text-neutral-950">{group.name}</h2>
              <span className="rounded-full bg-amber-100 px-2 text-xs font-bold text-amber-800">{group.rows.length} low</span>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500">
                  <th className="w-10 px-4 py-2.5" />
                  <th className="px-2 py-2.5">Good</th>
                  <th className="px-2 py-2.5 text-right">On shelf</th>
                  <th className="px-2 py-2.5 text-right">Coming</th>
                  <th className="px-2 py-2.5">Order</th>
                  {summary.canManage && <th className="px-2 py-2.5">Supplier</th>}
                  {summary.canManage && <th className="px-4 py-2.5 text-right">Estimate</th>}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => {
                  const key = rowKey(row);
                  const tone = categoryTone(row.category);
                  const on = selected.has(key);
                  const base = baseOf(row);
                  return (
                    <tr key={key} className={`border-0 border-t border-solid border-neutral-100 ${on ? "bg-brand/[0.03]" : ""}`}>
                      <td className="px-4 py-3 align-top"><input type="checkbox" checked={on} onChange={(event) => toggle(key, event.target.checked)} className={checkboxClass} aria-label={`Include ${row.name}`} /></td>
                      <td className="px-2 py-3 align-top">
                        <p className="m-0 text-[15px] font-bold text-neutral-900">{row.name}</p>
                        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${tone.chip}`}>{STOCK_CATEGORY_LABELS[row.category] ?? row.category}</span>
                      </td>
                      <td className="px-2 py-3 text-right align-top">
                        <p className={`m-0 text-sm font-bold tabular-nums ${row.onHand <= 0 ? "text-red-700" : "text-amber-700"}`}>{formatStockQuantity(row.onHand, row.baseUnit)}</p>
                        <p className="m-0 mt-0.5 text-xs text-neutral-500">{row.parLevel != null ? `par ${formatStockQuantity(row.parLevel, row.baseUnit)}` : `reorder at ${formatStockQuantity(row.reorderPoint ?? 0, row.baseUnit)}`}</p>
                      </td>
                      <td className="px-2 py-3 text-right align-top text-sm tabular-nums text-neutral-700">
                        {row.onOrder > 0 ? <span className="font-bold text-sky-700">{formatStockQuantity(row.onOrder, row.baseUnit)} ordered</span> : <span className="text-neutral-400">-</span>}
                        {row.requested > 0 && <p className="m-0 mt-0.5 text-xs text-neutral-500">{formatStockQuantity(row.requested, row.baseUnit)} asked for</p>}
                      </td>
                      <td className="px-2 py-3 align-top">
                        <div className="flex items-center gap-1.5">
                          <input inputMode="decimal" value={amounts.get(key) ?? String(row.suggestedPackCount ?? row.suggestedQuantity)} onChange={(event) => setAmounts((current) => new Map(current).set(key, event.target.value.replace(/[^\d.]/g, "")))} className={`${smallFieldClass} w-20 font-bold tabular-nums`} aria-label={`Quantity of ${row.name}`} />
                          <span className="text-sm text-neutral-600">{row.suggestedPackName ?? unitWord(row.baseUnit)}</span>
                        </div>
                        {row.suggestedPackName && base > 0 && <p className="m-0 mt-1 text-xs text-neutral-500">= {formatStockQuantity(base, row.baseUnit)}</p>}
                        {row.suggestedQuantity === 0 && <p className="m-0 mt-1 text-xs text-sky-700">Already covered by orders</p>}
                      </td>
                      {summary.canManage && (
                        <td className="px-2 py-3 align-top">
                          <select value={supplierOf(row) ?? ""} onChange={(event) => setSupplierFor((current) => new Map(current).set(key, Number(event.target.value)))} className={`${smallFieldClass} w-full max-w-[220px] ${!supplierOf(row) && on ? "border-amber-400" : ""}`} aria-label={`Supplier for ${row.name}`}>
                            <option value="">Choose supplier</option>
                            {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                          </select>
                          {row.supplierName && supplierOf(row) === row.supplierId && <p className="m-0 mt-1 text-xs text-neutral-500">Delivered it last</p>}
                        </td>
                      )}
                      {summary.canManage && (
                        <td className="px-4 py-3 text-right align-top text-sm font-bold tabular-nums text-neutral-900">
                          {row.unitCost ? formatMoney(base * row.unitCost, overview.currency) : <span className="font-normal text-neutral-400">No price yet</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="sticky bottom-3 z-10">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-solid border-neutral-200 bg-white px-4 py-3 shadow-card">
          <div className="min-w-0 text-sm text-neutral-600">
            <span className="font-bold text-neutral-900">{chosen.length} {chosen.length === 1 ? "good" : "goods"} selected</span>
            {summary.canManage && chosen.length > 0 && <span className="ml-2">· about {formatMoney(estimate, overview.currency)} · {orderGroups.length} {orderGroups.length === 1 ? "order" : "orders"}</span>}
            {summary.canManage && missingSupplier.length > 0 && <span className="ml-2 inline-flex items-center gap-1 font-bold text-amber-800"><AlertTriangle className="h-4 w-4" />Choose a supplier for {missingSupplier.length}</span>}
            {!summary.canManage && chosenLocations.size > 1 && <span className="ml-2 font-bold text-amber-800">Ask for one shelf at a time</span>}
          </div>
          {summary.canManage ? (
            <button type="button" disabled={busy || chosen.length === 0 || missingSupplier.length > 0} onClick={() => void buildOrders()} className={`${primaryButton} !h-10 px-4`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}{orderGroups.length > 1 ? `Create ${orderGroups.length} draft orders` : "Build the order"}
            </button>
          ) : summary.canRequest ? (
            <button type="button" disabled={chosen.length === 0 || chosenLocations.size > 1} onClick={ask} className={`${primaryButton} !h-10 px-4`}><ClipboardList className="h-4 w-4" />Ask for these</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

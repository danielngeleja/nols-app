"use client";

// Goods on hand: the physical stock behind the menu, per outlet
// (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 1). Every number here is the
// sum of ledger rows; the only way to change one is to record what happened.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowRightLeft, History, Loader2, Package, PackageX, RotateCcw, Search, Store, Trash, TriangleAlert, Truck, UtensilsCrossed, Wallet, Warehouse, Wine } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "./NrmsModalFrame";
import {
  MOVEMENT_LABELS,
  STOCK_CATEGORY_LABELS,
  apiError,
  categoryTone,
  formatMoney,
  formatStockQuantity,
  formatUnitCost,
  unitShort,
} from "./stockFormat";
import { EmptyState, Pill, cardClass, outlineButton, primaryButton, quietButton, smallFieldClass } from "../stock/items/_components/ui";
import { WriteOffModal } from "../stock/operations/_components/WriteOffsTab";

export type StockPack = { id: number; name: string; baseQuantity: number };
export type StockBalance = { outletId: number | null; locationId: number; quantity: number; parLevel: number | null; reorderPoint: number | null };
export type StockGood = {
  id: number;
  name: string;
  category: string;
  baseUnit: string;
  countStyle: "WHOLE" | "PARTIAL";
  perishable: boolean;
  shelfLifeDays: number | null;
  status: string;
  packUnits: StockPack[];
  menuItemCount: number;
  balances: StockBalance[];
  totalQuantity: number;
  averageCost: number | null;
  stockValue: number | null;
};
/** A place stock sits: an outlet, or the main store when the owner has one. */
export type StockLocationRef = { id: number; kind: "STORE" | "OUTLET"; name: string; outletId: number | null; outletType: string | null };
export type StockSettings = { storeEnabled: boolean; directPurchaseLimit: number; writeOffLimit: number; priceAlertPercent: number; purchaseOrderLimit: number; overDeliveryPercent: number };
export type LegacyCounter = { menuItemId: number; name: string; category: string | null; stockQuantity: number; outletId: number; outletName: string; outletType: string };
export type StockOverview = {
  currency: string;
  canManageCatalog: boolean;
  canReceive: boolean;
  showCost: boolean;
  canTransfer: boolean;
  canWriteOff: boolean;
  canApprove: boolean;
  canManageSuppliers: boolean;
  settings: StockSettings;
  locations: StockLocationRef[];
  items: StockGood[];
  legacy: LegacyCounter[];
};

type Tone = "ok" | "low" | "out" | "negative";
function balanceTone(balance: StockBalance): Tone {
  if (balance.quantity < 0) return "negative";
  if (balance.quantity === 0) return "out";
  if (balance.reorderPoint != null && balance.quantity <= balance.reorderPoint) return "low";
  return "ok";
}
const TONE: Record<Tone, { pill: string; dot: string; label: string }> = {
  ok: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "In stock" },
  low: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Reorder" },
  out: { pill: "bg-red-50 text-red-700", dot: "bg-red-500", label: "Out" },
  negative: { pill: "bg-red-100 text-red-800", dot: "bg-red-600", label: "Below zero, count needed" },
};

export function useStockOverview(propertyId: number | null | undefined) {
  const [data, setData] = useState<StockOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!propertyId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<StockOverview>(`/api/nrms/stock/property/${propertyId}/overview`);
      setData(res.data);
    } catch (cause) {
      setError(apiError(cause, "Unable to load stock"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, load };
}

export default function StockGoodsPanel({ propertyId }: { propertyId: number }) {
  const { data, loading, error, load } = useStockOverview(propertyId);
  const [query, setQuery] = useState("");
  const [outletFilter, setOutletFilter] = useState<number | "all">("all");
  const [historyFor, setHistoryFor] = useState<{ good: StockGood; locationId: number } | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<{ locationId: number; stockItemId: number } | null>(null);

  useEffect(() => {
    // Sales move these numbers all day; keep the board current while visible.
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const currency = data?.currency ?? "TZS";
  const activeGoods = useMemo(() => (data?.items ?? []).filter((item) => item.status === "ACTIVE"), [data]);

  const sections = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.locations
      .filter((outlet) => outletFilter === "all" || outlet.id === outletFilter)
      .map((outlet) => {
        const rows = data.items
          .map((good) => ({ good, balance: good.balances.find((row) => row.locationId === outlet.id) }))
          .filter((row): row is { good: StockGood; balance: StockBalance } => Boolean(row.balance))
          .filter(({ good }) => !q || good.name.toLowerCase().includes(q) || (STOCK_CATEGORY_LABELS[good.category] ?? "").toLowerCase().includes(q));
        return { outlet, rows };
      });
  }, [data, query, outletFilter]);

  const allBalances = useMemo(() => (data?.items ?? []).flatMap((good) => good.balances), [data]);
  const lowCount = allBalances.filter((row) => balanceTone(row) === "low").length;
  const outCount = allBalances.filter((row) => balanceTone(row) === "out" || balanceTone(row) === "negative").length;
  const totalValue = (data?.items ?? []).reduce((sum, good) => sum + (good.stockValue ?? 0), 0);

  if (loading && !data) return <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data) return error ? <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-700">{error}</div> : null;

  const stats = [
    { icon: Package, label: "Goods tracked", value: String(activeGoods.length), tone: "text-brand" },
    { icon: TriangleAlert, label: "At reorder point", value: String(lowCount), tone: "text-amber-600" },
    { icon: PackageX, label: "Out or below zero", value: String(outCount), tone: "text-red-600" },
    ...(data.showCost ? [{ icon: Wallet, label: "Stock value at cost", value: formatMoney(totalValue, currency), tone: "text-sky-600" }] : []),
  ];
  // Spare width is shared in proportion across every column, so the item name
  // cannot swallow it and leave the figures squeezed against the edge. Status
  // sits beside the item it describes; the three figures stay together.
  const cols = data.showCost
    ? "grid-cols-[minmax(200px,2.2fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(150px,1.2fr)_minmax(120px,1fr)_minmax(196px,auto)]"
    : "grid-cols-[minmax(200px,2.2fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(196px,auto)]";

  return (
    <div className="space-y-4">
      <div className={`${cardClass} grid grid-cols-2 gap-px overflow-hidden bg-neutral-100 ${data.showCost ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
            <stat.icon className={`h-4 w-4 shrink-0 ${stat.tone}`} />
            <div className="min-w-0">
              <p className="m-0 truncate text-xl font-bold leading-tight tabular-nums text-neutral-950">{stat.value}</p>
              <p className="m-0 truncate text-[13px] text-neutral-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-700">{error}</div>}

      {data.canManageCatalog && data.legacy.length > 0 && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><TriangleAlert className="h-4 w-4" /></span>
            <p className="m-0 text-sm text-neutral-600"><strong className="text-neutral-900">{data.legacy.length} menu {data.legacy.length === 1 ? "item still counts" : "items still count"} stock on the menu.</strong> Move them to stock items so every bottle has a history.</p>
          </div>
          <Link href="/owner/nrms/stock/items?tab=convert" className={`${outlineButton} no-underline hover:no-underline`}>Move counters</Link>
        </div>
      )}

      {activeGoods.length === 0 ? (
        <div className={cardClass}>
          <EmptyState
            icon={Package}
            title="No stock items yet"
            body="Stock items are the goods you buy: a crate of beer, a bottle of gin, a kilo of fish. Add them, link them to your menu, and every sale takes them off the shelf."
            action={data.canManageCatalog ? <Link href="/owner/nrms/stock/items" className={`${primaryButton} no-underline hover:no-underline`}>Set up stock items</Link> : undefined}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search goods or category" className={`${smallFieldClass} w-full pl-9 text-sm`} />
            </div>
            {data.locations.length > 1 && (
              <select value={outletFilter} onChange={(event) => setOutletFilter(event.target.value === "all" ? "all" : Number(event.target.value))} className={`${smallFieldClass} text-sm font-semibold`}>
                <option value="all">All locations</option>
                {data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            )}
            {data.canTransfer && (
              <Link href="/owner/nrms/stock/operations?tab=transfers" className={`${outlineButton} no-underline hover:no-underline`}><ArrowRightLeft className="h-4 w-4" />Send goods</Link>
            )}
            {data.canReceive && (
              <Link href="/owner/nrms/stock/operations?tab=deliveries" className={`${primaryButton} no-underline hover:no-underline`}><Truck className="h-4 w-4" />New delivery</Link>
            )}
          </div>

          {sections.map(({ outlet, rows }) => {
            const low = rows.filter(({ balance }) => balanceTone(balance) === "low").length;
            const out = rows.filter(({ balance }) => balanceTone(balance) === "out" || balanceTone(balance) === "negative").length;
            return (
              <section key={outlet.id} className={`${cardClass} overflow-hidden`}>
                <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">{outlet.kind === "STORE" ? <Warehouse className="h-4 w-4" /> : outlet.outletType === "BAR" ? <Wine className="h-4 w-4" /> : outlet.outletType === "RESTAURANT" ? <UtensilsCrossed className="h-4 w-4" /> : <Store className="h-4 w-4" />}</span>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-[15px] font-bold text-neutral-950">{outlet.name}</p>
                      <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{outlet.kind === "STORE" ? "Main store" : outlet.outletType === "BAR" ? "Bar shelf" : outlet.outletType === "RESTAURANT" ? "Kitchen shelf" : "Outlet shelf"} · {rows.length} {rows.length === 1 ? "good" : "goods"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {low > 0 && <Pill tone="low">{low} to reorder</Pill>}
                    {out > 0 && <Pill tone="out">{out} out</Pill>}
                    {rows.length > 0 && low === 0 && out === 0 && <Pill tone="ok">Shelf healthy</Pill>}
                  </div>
                </header>
                {rows.length === 0 ? (
                  <p className="m-0 px-4 py-8 text-center text-sm text-neutral-400">{query ? "No goods match." : "Nothing stocked here yet. Record a delivery or an opening count to start."}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className={data.showCost ? "min-w-[940px]" : "min-w-[680px]"}>
                      <div className={`grid ${cols} items-center gap-x-6 bg-neutral-50/80 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-neutral-500 sm:px-5`}>
                        <span>Item</span><span>Status</span><span className="text-right">On hand</span>
                        {data.showCost && <><span className="text-right">Avg cost</span><span className="text-right">Value</span></>}
                        <span className="text-right">Actions</span>
                      </div>
                      {rows.map(({ good, balance }) => {
                        const tone = balanceTone(balance);
                        const catTone = categoryTone(good.category);
                        return (
                          <div key={good.id} className={`grid ${cols} items-center gap-x-6 border-0 border-t border-solid border-neutral-100 px-4 py-3 transition hover:bg-neutral-50/70 sm:px-5`}>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${catTone.dot}`} aria-hidden />
                              <div className="min-w-0">
                                <p className="m-0 truncate text-[15px] font-bold text-neutral-900">{good.name}</p>
                                <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{STOCK_CATEGORY_LABELS[good.category] ?? good.category}{good.menuItemCount > 0 ? ` · on ${good.menuItemCount} menu ${good.menuItemCount === 1 ? "item" : "items"}` : " · not on the menu yet"}</p>
                              </div>
                            </div>
                            <span><Pill tone={tone}>{TONE[tone].label}</Pill></span>
                            <span className={`whitespace-nowrap text-right text-sm font-bold tabular-nums ${balance.quantity < 0 ? "text-red-700" : "text-neutral-900"}`}>{formatStockQuantity(balance.quantity, good.baseUnit)}</span>
                            {data.showCost && (
                              <>
                                <span className={`whitespace-nowrap text-right text-sm tabular-nums ${good.averageCost ? "text-neutral-600" : "text-neutral-400"}`}>{good.averageCost ? `${formatUnitCost(good.averageCost, currency)} / ${unitShort(good.baseUnit)}` : "No cost yet"}</span>
                                <span className={`whitespace-nowrap text-right text-sm font-semibold tabular-nums ${good.averageCost ? "text-neutral-900" : "text-neutral-400"}`}>{good.averageCost ? formatMoney(Math.max(0, balance.quantity) * good.averageCost, currency) : "Not valued"}</span>
                              </>
                            )}
                            <div className="flex justify-end gap-1.5">
                              {data.canWriteOff && good.status === "ACTIVE" && (
                                <button type="button" onClick={() => setWriteOffFor({ locationId: outlet.id, stockItemId: good.id })} className={`${quietButton} whitespace-nowrap`}><Trash className="h-3.5 w-3.5 shrink-0" />Write off</button>
                              )}
                              <button type="button" onClick={() => setHistoryFor({ good, locationId: outlet.id })} className={`${quietButton} whitespace-nowrap`}><History className="h-3.5 w-3.5 shrink-0" />History</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {writeOffFor && (
        <WriteOffModal propertyId={propertyId} overview={data} initial={writeOffFor} onClose={() => setWriteOffFor(null)} onSaved={() => { setWriteOffFor(null); void load(true); }} />
      )}
      {historyFor && (
        <HistoryModal
          propertyId={propertyId}
          good={historyFor.good}
          outlet={data.locations.find((location) => location.id === historyFor.locationId)!}
          currency={currency}
          canReverse={data.canManageCatalog}
          onClose={() => setHistoryFor(null)}
          onChanged={() => void load(true)}
        />
      )}
    </div>
  );
}


const fieldClass = "mt-1.5 [font-family:inherit] box-border h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[15px] text-neutral-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10";
const labelClass = "block text-xs font-bold uppercase tracking-[0.12em] text-neutral-500";

/**
 * Record goods arriving at an outlet. Entered the way the delivery reads
 * (3 crates, TZS 127,500 paid) and stored in base units with a unit cost.
 */
export function ReceiveModal({ propertyId, data, initial, onClose, onSaved }: {
  propertyId: number;
  data: StockOverview;
  initial: { locationId?: number; stockItemId?: number; opening?: boolean };
  onClose: () => void;
  onSaved: () => void;
}) {
  const goods = data.items.filter((item) => item.status === "ACTIVE");
  const [outletId, setOutletId] = useState<number | "">(initial.locationId ?? (data.locations.length === 1 ? data.locations[0].id : ""));
  const [stockItemId, setStockItemId] = useState<number | "">(initial.stockItemId ?? "");
  const good = goods.find((item) => item.id === stockItemId) ?? null;
  const [packId, setPackId] = useState<number | "units">("units");
  const [amount, setAmount] = useState("");
  const [totalPaid, setTotalPaid] = useState("");
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState(Boolean(initial.opening));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Default to the biggest pack: deliveries are counted in crates, not bottles.
    const packs = good?.packUnits ?? [];
    setPackId(packs.length ? packs[packs.length - 1].id : "units");
  }, [good?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pack = good?.packUnits.find((row) => row.id === packId) ?? null;
  const amountNumber = Number(amount);
  const baseQuantity = amountNumber > 0 ? (pack ? amountNumber * pack.baseQuantity : amountNumber) : 0;
  const paidNumber = Number(totalPaid);
  const unitCost = baseQuantity > 0 && paidNumber > 0 ? paidNumber / baseQuantity : 0;
  const hasHistoryHere = Boolean(good && outletId && good.balances.some((row) => row.locationId === outletId));

  const submit = async () => {
    if (!good || !outletId || baseQuantity <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/property/${propertyId}/receipts`, {
        locationId: outletId,
        stockItemId: good.id,
        ...(pack ? { packUnitId: pack.id, packCount: amountNumber } : { quantity: amountNumber }),
        ...(paidNumber > 0 ? { totalCost: paidNumber } : {}),
        note: note.trim() || null,
        opening,
      });
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not record the stock"));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = Boolean(good && outletId && baseQuantity > 0 && (opening || paidNumber > 0)) && !busy;

  return (
    <ModalFrame
      title={opening ? "Opening count" : "Record a delivery"}
      subtitle={opening ? "What is on the shelf today, before NRMS starts counting" : "What actually arrived, and what was paid"}
      icon={<ArrowDownToLine className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-[15px] font-bold [font-family:inherit] text-neutral-700 hover:bg-neutral-50">Cancel</button>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#073c35] [font-family:inherit] px-4 text-[15px] font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{opening ? "Save opening count" : "Record delivery"}
          </button>
        </div>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Outlet
          <select value={outletId} onChange={(event) => setOutletId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
            <option value="">Choose where it goes</option>
            {data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Stock item
          <select value={stockItemId} onChange={(event) => setStockItemId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
            <option value="">Choose the goods</option>
            {goods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        {good && (
          <>
            <div>
              <p className={`${labelClass} m-0`}>Quantity</p>
              <div className="mt-1.5 flex gap-2">
                <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className="[font-family:inherit] box-border h-10 w-32 min-w-0 shrink-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[15px] font-bold tabular-nums outline-none focus:border-emerald-500" />
                <select value={packId} onChange={(event) => setPackId(event.target.value === "units" ? "units" : Number(event.target.value))} className="[font-family:inherit] box-border h-10 min-w-0 flex-1 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-[15px] outline-none focus:border-emerald-500">
                  {good.packUnits.map((row) => <option key={row.id} value={row.id}>{row.name} ({formatStockQuantity(row.baseQuantity, good.baseUnit)})</option>)}
                  <option value="units">{good.baseUnit === "G" ? "grams" : good.baseUnit === "ML" ? "millilitres" : formatStockQuantity(2, good.baseUnit).replace(/^2 /, "")}</option>
                </select>
              </div>
              {pack && baseQuantity > 0 && <p className="m-0 mt-1 text-[13px] text-neutral-500">= {formatStockQuantity(baseQuantity, good.baseUnit)}</p>}
            </div>
            <label className={labelClass}>
              {opening ? "Value (optional)" : "Total paid"}
              <input inputMode="decimal" value={totalPaid} onChange={(event) => setTotalPaid(event.target.value.replace(/[^\d.]/g, ""))} placeholder={data.currency} className={`${fieldClass} font-bold tabular-nums`} />
              {unitCost > 0 && <span className="mt-1 block text-[13px] font-normal normal-case tracking-normal text-neutral-500">{formatUnitCost(unitCost, data.currency)} per {unitShort(good.baseUnit)}</span>}
            </label>
          </>
        )}

        <label className={`${labelClass} sm:col-span-2`}>
          Note (optional)
          <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 300))} placeholder="Supplier, delivery note number" className={fieldClass} />
        </label>

        {data.canManageCatalog && (
          <label className="flex items-start gap-2 text-sm text-neutral-600 sm:col-span-2">
            <input type="checkbox" checked={opening} disabled={hasHistoryHere} onChange={(event) => setOpening(event.target.checked)} className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[5px] border-2 border-solid border-neutral-400 bg-white text-brand focus:ring-2 focus:ring-brand/25 focus:ring-offset-0 checked:border-brand disabled:cursor-not-allowed disabled:opacity-50" />
            <span>This is the opening count at go-live, not a delivery.{hasHistoryHere ? " This item already has history at this outlet, so it can only be a delivery." : ""}</span>
          </label>
        )}
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

type Movement = {
  id: number;
  type: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number | null;
  sourceType: string | null;
  sourceId: number | null;
  note: string | null;
  actorName: string | null;
  occurredAt: string;
  reversed: boolean;
};

function HistoryModal({ propertyId, good, outlet, currency, canReverse, onClose, onChanged }: {
  propertyId: number;
  good: StockGood;
  outlet: StockLocationRef;
  currency: string;
  canReverse: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ movements: Movement[] }>(`/api/nrms/stock/property/${propertyId}/movements`, { params: { stockItemId: good.id, locationId: outlet.id, limit: 100 } });
      setRows(res.data.movements);
    } catch (cause) {
      setError(apiError(cause, "Unable to load the history"));
    }
  }, [propertyId, good.id, outlet.id]);
  useEffect(() => { void load(); }, [load]);

  const reverse = async (movementId: number) => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/movements/${movementId}/reverse`, { reason: reason.trim() });
      setReversing(null);
      setReason("");
      await load();
      onChanged();
    } catch (cause) {
      setError(apiError(cause, "Could not reverse the entry"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame title={good.name} subtitle={`Stock history at ${outlet.name}`} icon={<History className="h-5 w-5" />} onClose={onClose} wide>
      {error && <p className="mb-3 mt-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!rows ? (
        <div className="flex min-h-[20vh] items-center justify-center text-neutral-300"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="m-0 py-8 text-center text-sm text-neutral-400">Nothing has moved yet.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
          {rows.map((row) => (
            <li key={row.id} className="py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-[15px] font-bold text-neutral-900">
                    {MOVEMENT_LABELS[row.type] ?? row.type}
                    {row.reversed && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-500">Reversed</span>}
                  </p>
                  <p className="m-0 mt-0.5 text-[13px] text-neutral-500">
                    {new Date(row.occurredAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    {row.actorName ? ` · ${row.actorName}` : ""}
                    {row.sourceType === "OUTLET_ORDER" && row.sourceId ? ` · order #${row.sourceId}` : ""}
                  </p>
                  {row.note && <p className="m-0 mt-0.5 text-[13px] text-neutral-600">{row.note}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className={`m-0 text-[15px] font-bold tabular-nums ${row.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>{row.quantity > 0 ? "+" : ""}{formatStockQuantity(row.quantity, good.baseUnit)}</p>
                  {row.totalCost != null && <p className="m-0 mt-0.5 text-[13px] tabular-nums text-neutral-500">{formatMoney(Math.abs(row.totalCost), currency)}</p>}
                  {canReverse && (row.type === "RECEIPT" || row.type === "OPENING_BALANCE") && !row.reversed && reversing !== row.id && (
                    <button type="button" onClick={() => { setReversing(row.id); setReason(""); }} className="mt-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-bold text-red-700 hover:underline"><RotateCcw className="h-3 w-3" />Reverse</button>
                  )}
                </div>
              </div>
              {reversing === row.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50/60 p-2">
                  <input autoFocus value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} placeholder="Why is this being reversed?" className="box-border h-9 min-w-[200px] flex-1 rounded-lg border border-solid border-red-200 bg-white px-3 text-sm outline-none focus:border-red-400" />
                  <button type="button" onClick={() => setReversing(null)} className="h-9 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-600">Keep</button>
                  <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void reverse(row.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-red-600 px-3 text-sm font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Reverse receipt</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </ModalFrame>
  );
}

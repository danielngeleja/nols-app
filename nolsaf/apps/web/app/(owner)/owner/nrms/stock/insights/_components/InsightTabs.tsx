"use client";

// The report tabs of Stock insights (docs/NRMS_STOCK_AND_PURCHASING.md
// section 7.5, milestone 6). Each loads its own report for the chosen range.

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { STOCK_CATEGORY_LABELS, apiError, formatMoney, formatStockQuantity, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import { EmptyState, Pill, cardClass } from "../../items/_components/ui";
import { WASTAGE_REASON_LABELS, WRITE_OFF_TYPE_LABELS } from "../../operations/_components/shared";

type Range = { from: string; to: string };

function useReport<T>(url: string, params: Record<string, string | number | undefined>, refreshKey: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(params);
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient.get<T>(url, { params: JSON.parse(key) });
      setData(res.data);
    } catch (cause) {
      setError(apiError(cause, "Unable to load this report"));
    }
  }, [url, key]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return { data, error };
}

function Frame({ data, error, empty, children }: { data: unknown; error: string | null; empty?: ReactNode; children: ReactNode }) {
  if (error) return <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className={`${cardClass} flex min-h-[24vh] items-center justify-center text-neutral-300`}><Loader2 className="h-6 w-6 animate-spin" /></div>;
  return <>{empty ?? children}</>;
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  return (
    <div className="bg-white px-4 py-3.5 sm:px-5">
      <p className={`m-0 truncate text-lg font-bold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-emerald-700" : "text-neutral-950"}`}>{value}</p>
      <p className="m-0 truncate text-[13px] text-neutral-500">{label}</p>
    </div>
  );
}

const th = "px-2 py-2.5";
const headRow = "bg-neutral-50/80 text-xs font-bold uppercase tracking-wide text-neutral-500";
const bodyRow = "border-0 border-t border-solid border-neutral-100";

// ================================================================= menu profit

type MenuRow = {
  menuItemId: number; name: string; category: string | null; outletName: string; price: number; cost: number; profit: number; margin: number | null;
  belowCost: boolean; lowMargin: boolean; uncosted: string[]; unitsSold: number; revenue: number; costOfSales: number; grossProfit: number;
  ingredients: Array<{ name: string; baseUnit: string; quantity: number; yieldPercent: number; unitCost: number }>;
};
type MenuReport = { currency: string; targetMargin: number; unlinkedItems: number; outlets: Array<{ outletId: number; outletName: string; revenue: number; costOfSales: number; grossProfit: number; margin: number | null }>; items: MenuRow[] };

export function MenuProfitTab({ propertyId, range, refreshKey }: { propertyId: number; range: Range; refreshKey: number }) {
  const [target, setTarget] = useState(60);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error } = useReport<MenuReport>(`/api/nrms/stock/property/${propertyId}/insights/menu-profit`, { ...range, target }, refreshKey);
  const currency = data?.currency ?? "TZS";
  const costed = (row: MenuRow) => row.uncosted.length === 0;
  const below = data?.items.filter((row) => costed(row) && row.belowCost).length ?? 0;
  const thin = data?.items.filter((row) => costed(row) && !row.belowCost && row.lowMargin).length ?? 0;
  const notCosted = data?.items.filter((row) => !costed(row)).length ?? 0;
  return (
    <Frame data={data} error={error} empty={data && data.items.length === 0 ? <div className={cardClass}><EmptyState icon={CheckCircle2} title="No costed menu items yet" body="Link menu items to the goods they use under Stock items & recipes. Each linked item then shows what it costs to make and what it earns." /></div> : undefined}>
      {data && (
        <div className="space-y-4">
          <div className={`${cardClass} grid grid-cols-2 gap-px overflow-hidden bg-neutral-100 lg:grid-cols-4`}>
            <Stat label="Sold below cost" value={String(below)} tone={below ? "bad" : "good"} />
            <Stat label={`Under ${data.targetMargin}% margin`} value={String(thin)} tone={thin ? "bad" : "neutral"} />
            <Stat label="Gross profit on linked items" value={formatMoney(data.outlets.reduce((sum, row) => sum + row.grossProfit, 0), currency)} />
            <Stat label="Not costed yet" value={String(notCosted + data.unlinkedItems)} tone={notCosted + data.unlinkedItems ? "bad" : "neutral"} />
          </div>
          {data.outlets.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.outlets.map((row) => (
                <div key={row.outletId} className={`${cardClass} p-4`}>
                  <p className="m-0 text-[15px] font-bold text-neutral-900">{row.outletName}</p>
                  <p className="m-0 mt-1 text-sm text-neutral-600">Sales {formatMoney(row.revenue, currency)} · cost {formatMoney(row.costOfSales, currency)}</p>
                  <p className="m-0 mt-1 text-lg font-bold tabular-nums text-neutral-950">{formatMoney(row.grossProfit, currency)} <span className="text-sm font-bold text-emerald-700">{row.margin != null ? `${row.margin}%` : ""}</span></p>
                </div>
              ))}
            </div>
          )}
          <div className={`${cardClass} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
              <p className="m-0 text-[13px] text-neutral-500">Cost is today&apos;s average cost of each ingredient. Sales are orders in the range, cancelled and voided left out.</p>
              <label className="flex items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-neutral-50 py-1 pl-3 pr-1 text-xs font-bold uppercase tracking-wide text-neutral-500">Target margin
                <select value={target} onChange={(event) => setTarget(Number(event.target.value))} className="h-8 rounded-md border border-solid border-neutral-300 bg-white px-2 text-sm font-bold normal-case tracking-normal text-neutral-900 [font-family:inherit]">
                  {[40, 50, 60, 65, 70, 75].map((value) => <option key={value} value={value}>{value}%</option>)}
                </select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr>
                    {[["Menu item", "pl-4"], ["Made from", ""], ["Price", "text-right"], ["Cost to make", "text-right"], ["Margin", "text-right"], ["Sold", "text-right"], ["Gross profit", "pr-4 text-right"]].map(([label, extra]) => (
                      <th key={label} className={`whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 ${extra}`}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row, index) => {
                    const isCosted = costed(row);
                    const cell = "border-0 border-b border-solid border-neutral-200 px-3 py-3 align-middle";
                    const shade = row.belowCost && isCosted ? "bg-red-50/60" : !isCosted ? "bg-amber-50/40" : index % 2 ? "bg-neutral-50/60" : "bg-white";
                    return (
                      <Fragment key={row.menuItemId}>
                        <tr className={`${shade} hover:bg-brand/[0.04]`}>
                          <td className={`${cell} pl-4`}>
                            <button type="button" onClick={() => setOpen(open === row.menuItemId ? null : row.menuItemId)} className="flex items-center gap-1.5 border-0 bg-transparent p-0 text-left font-bold text-neutral-900 [font-family:inherit] hover:text-brand">
                              {open === row.menuItemId ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}{row.name}
                            </button>
                            <p className="m-0 mt-0.5 pl-5 text-xs text-neutral-500">{row.outletName}{row.category ? ` · ${row.category}` : ""}</p>
                          </td>
                          <td className={`${cell} max-w-[240px]`}>
                            <p className="m-0 truncate text-[13px] text-neutral-700" title={row.ingredients.map((item) => item.name).join(", ")}>{row.ingredients.map((item) => item.name).join(", ")}</p>
                            {!isCosted && <p className="m-0 mt-0.5 text-xs font-bold text-amber-700">No price yet: receive a delivery of {row.uncosted.join(", ")}</p>}
                          </td>
                          <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{formatMoney(row.price, currency)}</td>
                          <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{isCosted ? formatMoney(row.cost, currency) : <span className="text-neutral-300">-</span>}</td>
                          <td className={`${cell} whitespace-nowrap text-right`}>
                            {!isCosted ? <Pill tone="low">Not costed</Pill>
                              : row.belowCost ? <Pill tone="out">Below cost</Pill>
                              : <span className={`font-bold tabular-nums ${row.lowMargin ? "text-amber-700" : "text-emerald-700"}`}>{row.margin != null ? `${row.margin}%` : "-"}</span>}
                          </td>
                          <td className={`${cell} whitespace-nowrap text-right tabular-nums ${row.unitsSold ? "text-neutral-800" : "text-neutral-300"}`}>{row.unitsSold || "-"}</td>
                          <td className={`${cell} whitespace-nowrap pr-4 text-right font-bold tabular-nums ${!isCosted || !row.unitsSold ? "font-normal text-neutral-300" : row.grossProfit < 0 ? "text-red-700" : "text-neutral-950"}`}>{isCosted && row.unitsSold ? formatMoney(row.grossProfit, currency) : "-"}</td>
                        </tr>
                        {open === row.menuItemId && (
                          <tr className="bg-neutral-50/60">
                            <td colSpan={7} className="border-0 border-b border-solid border-neutral-200 px-4 py-3 pl-9">
                              <table className="w-full max-w-[640px] border-collapse overflow-hidden rounded-lg text-[13px]">
                                <thead>
                                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                                    <th className="pb-1.5">Ingredient</th><th className="pb-1.5">Per serving</th><th className="pb-1.5 text-right">Cost per unit</th><th className="pb-1.5 text-right">Cost per serving</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.ingredients.map((ingredient, i) => {
                                    const used = ingredient.quantity / (Math.max(1, ingredient.yieldPercent) / 100);
                                    return (
                                      <tr key={i} className="border-0 border-t border-solid border-neutral-200">
                                        <td className="py-1.5 font-bold text-neutral-800">{ingredient.name}</td>
                                        <td className="py-1.5 text-neutral-600">{formatStockQuantity(ingredient.quantity, ingredient.baseUnit)}{ingredient.yieldPercent < 100 ? ` at ${ingredient.yieldPercent}% yield` : ""}</td>
                                        <td className="py-1.5 text-right tabular-nums text-neutral-600">{ingredient.unitCost > 0 ? `${formatUnitCost(ingredient.unitCost, currency)}/${unitShort(ingredient.baseUnit)}` : <span className="font-bold text-amber-700">No price yet</span>}</td>
                                        <td className="py-1.5 text-right font-bold tabular-nums text-neutral-900">{ingredient.unitCost > 0 ? formatMoney(used * ingredient.unitCost, currency) : "-"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
}

// ================================================================== price watch

type PriceRow = { supplierId: number | null; supplierName: string | null; stockItemId: number; name: string; baseUnit: string; latest: number; previous: number | null; first: number; changePercent: number | null; windowChangePercent: number | null; receipts: number; flagged: number; agreedUnitCost: number | null; aboveAgreedPercent: number | null };

export function PriceWatchTab({ propertyId, range, refreshKey }: { propertyId: number; range: Range; refreshKey: number }) {
  const [risingOnly, setRisingOnly] = useState(true);
  const { data, error } = useReport<{ currency: string; rows: PriceRow[] }>(`/api/nrms/stock/property/${propertyId}/insights/price-watch`, range, refreshKey);
  const currency = data?.currency ?? "TZS";
  const rows = (data?.rows ?? []).filter((row) => !risingOnly || (row.changePercent ?? 0) > 0 || (row.windowChangePercent ?? 0) > 0 || (row.aboveAgreedPercent ?? 0) > 0);
  return (
    <Frame data={data} error={error}>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {([[true, "Rising or above agreed"], [false, "Every good bought"]] as const).map(([value, label]) => (
            <button key={String(value)} type="button" onClick={() => setRisingOnly(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] ${risingOnly === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
          ))}
        </div>
        <div className={`${cardClass} overflow-hidden`}>
          {rows.length === 0 ? <EmptyState icon={CheckCircle2} title="No price rises in this range" body="Prices come from what was paid on each delivery, per supplier. A rise shows here with the price it rose from." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-left">
                <thead><tr className={headRow}><th className="px-4 py-2.5">Good</th><th className={th}>Supplier</th><th className={`${th} text-right`}>Now</th><th className={`${th} text-right`}>Last time</th><th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>Since start of range</th><th className="px-4 py-2.5 text-right">Agreed</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.supplierId}-${row.stockItemId}`} className={bodyRow}>
                      <td className="px-4 py-3"><p className="m-0 text-[15px] font-bold text-neutral-900">{row.name}</p><p className="m-0 mt-0.5 text-[13px] text-neutral-500">{row.receipts} {row.receipts === 1 ? "delivery" : "deliveries"}{row.flagged ? ` · ${row.flagged} flagged` : ""}</p></td>
                      <td className={`${th} text-sm text-neutral-700`}>{row.supplierName ?? "Market purchase"}</td>
                      <td className={`${th} text-right text-sm font-bold tabular-nums`}>{formatUnitCost(row.latest, currency)} <span className="text-xs font-normal text-neutral-400">/ {unitShort(row.baseUnit)}</span></td>
                      <td className={`${th} text-right text-sm tabular-nums text-neutral-600`}>{row.previous != null ? formatUnitCost(row.previous, currency) : "-"}</td>
                      <td className={`${th} text-right text-sm font-bold tabular-nums ${(row.changePercent ?? 0) > 0 ? "text-red-700" : (row.changePercent ?? 0) < 0 ? "text-emerald-700" : "text-neutral-500"}`}>{row.changePercent != null ? `${row.changePercent > 0 ? "+" : ""}${row.changePercent}%` : "-"}</td>
                      <td className={`${th} text-right text-sm tabular-nums ${(row.windowChangePercent ?? 0) > 0 ? "text-amber-700" : "text-neutral-500"}`}>{row.windowChangePercent != null ? `${row.windowChangePercent > 0 ? "+" : ""}${row.windowChangePercent}%` : "-"}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">{row.agreedUnitCost != null ? <span className={(row.aboveAgreedPercent ?? 0) > 0 ? "font-bold text-red-700" : "text-neutral-600"}>{formatUnitCost(row.agreedUnitCost, currency)}{(row.aboveAgreedPercent ?? 0) > 0 ? ` (+${row.aboveAgreedPercent}%)` : ""}</span> : <span className="text-neutral-400">None set</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
}

// ========================================================= supplier performance

type SupplierRow = { supplierId: number; supplierName: string; deliveries: number; value: number; rejectedValue: number; rejectedPercent: number; flaggedLines: number; shortOnScaleLines: number; shortOnScaleValue: number; onTime: number; late: number; onTimePercent: number | null; closedShort: number; invoicesBilledMore: number };

export function SuppliersTab({ propertyId, range, refreshKey }: { propertyId: number; range: Range; refreshKey: number }) {
  const { data, error } = useReport<{ currency: string; rows: SupplierRow[] }>(`/api/nrms/stock/property/${propertyId}/insights/suppliers`, range, refreshKey);
  const currency = data?.currency ?? "TZS";
  return (
    <Frame data={data} error={error} empty={data && data.rows.length === 0 ? <div className={cardClass}><EmptyState icon={CheckCircle2} title="No supplier deliveries in this range" body="Every delivery from a named supplier feeds this: what was rejected at the door, short weights, price jumps, late orders and bills above the goods." /></div> : undefined}>
      {data && (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left">
              <thead><tr className={headRow}><th className="px-4 py-2.5">Supplier</th><th className={`${th} text-right`}>Bought</th><th className={`${th} text-right`}>Rejected</th><th className={`${th} text-right`}>Short on the scale</th><th className={`${th} text-right`}>Price jumps</th><th className={`${th} text-right`}>On time</th><th className={`${th} text-right`}>Closed short</th><th className="px-4 py-2.5 text-right">Billed more</th></tr></thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.supplierId} className={bodyRow}>
                    <td className="px-4 py-3"><p className="m-0 text-[15px] font-bold text-neutral-900">{row.supplierName}</p><p className="m-0 mt-0.5 text-[13px] text-neutral-500">{row.deliveries} {row.deliveries === 1 ? "delivery" : "deliveries"}</p></td>
                    <td className={`${th} text-right text-sm font-bold tabular-nums`}>{formatMoney(row.value, currency)}</td>
                    <td className={`${th} text-right text-sm tabular-nums ${row.rejectedValue > 0 ? "text-amber-700" : "text-neutral-400"}`}>{row.rejectedValue > 0 ? `${formatMoney(row.rejectedValue, currency)} (${row.rejectedPercent}%)` : "-"}</td>
                    <td className={`${th} text-right text-sm tabular-nums ${row.shortOnScaleValue > 0 ? "text-red-700" : "text-neutral-400"}`}>{row.shortOnScaleLines > 0 ? `${formatMoney(row.shortOnScaleValue, currency)} on ${row.shortOnScaleLines}` : "-"}</td>
                    <td className={`${th} text-right text-sm tabular-nums ${row.flaggedLines > 0 ? "font-bold text-amber-700" : "text-neutral-400"}`}>{row.flaggedLines || "-"}</td>
                    <td className={`${th} text-right text-sm tabular-nums`}>{row.onTimePercent != null ? <span className={row.onTimePercent < 80 ? "font-bold text-amber-700" : "text-emerald-700"}>{row.onTimePercent}% of {row.onTime + row.late}</span> : <span className="text-neutral-400">No orders</span>}</td>
                    <td className={`${th} text-right text-sm tabular-nums ${row.closedShort ? "text-amber-700" : "text-neutral-400"}`}>{row.closedShort || "-"}</td>
                    <td className={`px-4 py-3 text-right text-sm tabular-nums ${row.invoicesBilledMore ? "font-bold text-red-700" : "text-neutral-400"}`}>{row.invoicesBilledMore || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 text-xs text-neutral-500">Short on the scale: the supplier&apos;s paper said more than was weighed and accepted. On time: first delivery on each order against the date the supplier confirmed, else the date asked for.</p>
        </div>
      )}
    </Frame>
  );
}

// ====================================================================== wastage

type Group = { key: string; value: number; count: number };
type WastageReport = { currency: string; total: number; byType: Group[]; byReason: Group[]; byLocation: Group[]; byPerson: Group[]; byItem: Array<{ name: string; baseUnit: string; quantity: number; value: number; count: number }> };

function GroupCard({ title, rows, currency, label }: { title: string; rows: Group[]; currency: string; label?: (key: string) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className={`${cardClass} p-4`}>
      <p className="m-0 text-sm font-bold text-neutral-900">{title}</p>
      <div className="mt-3 space-y-2.5">
        {rows.length === 0 ? <p className="m-0 text-sm text-neutral-500">Nothing recorded.</p> : rows.slice(0, 8).map((row) => (
          <div key={row.key}>
            <div className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-neutral-700">{label ? label(row.key) : row.key} <span className="text-neutral-400">· {row.count}</span></span><span className="font-bold tabular-nums">{formatMoney(row.value, currency)}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(row.value / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WastageTab({ propertyId, range, refreshKey }: { propertyId: number; range: Range; refreshKey: number }) {
  const { data, error } = useReport<WastageReport>(`/api/nrms/stock/property/${propertyId}/insights/wastage`, range, refreshKey);
  const currency = data?.currency ?? "TZS";
  const reasonLabel = (key: string) => WASTAGE_REASON_LABELS[key] ?? WRITE_OFF_TYPE_LABELS[key] ?? key;
  return (
    <Frame data={data} error={error}>
      {data && (
        <div className="space-y-4">
          <div className={`${cardClass} grid grid-cols-2 gap-px overflow-hidden bg-neutral-100 lg:grid-cols-4`}>
            <Stat label="Written off in the range" value={formatMoney(data.total, currency)} tone={data.total > 0 ? "bad" : "neutral"} />
            {data.byType.map((row) => <Stat key={row.key} label={WRITE_OFF_TYPE_LABELS[row.key] ?? row.key} value={formatMoney(row.value, currency)} />)}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <GroupCard title="By reason" rows={data.byReason} currency={currency} label={reasonLabel} />
            <GroupCard title="By location" rows={data.byLocation} currency={currency} />
            <GroupCard title="Recorded by" rows={data.byPerson} currency={currency} />
          </div>
          <div className={`${cardClass} overflow-hidden`}>
            <p className="m-0 border-0 border-b border-solid border-neutral-100 px-4 py-3 text-sm font-bold text-neutral-900">Goods written off most</p>
            {data.byItem.length === 0 ? <p className="m-0 px-4 py-5 text-center text-sm text-neutral-500">Nothing written off in this range.</p> : data.byItem.map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 first:border-t-0">
                <span className="text-sm text-neutral-800">{row.name} <span className="text-neutral-500">· {formatStockQuantity(row.quantity, row.baseUnit)} in {row.count}</span></span>
                <span className="text-sm font-bold tabular-nums">{formatMoney(row.value, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Frame>
  );
}

// ==================================================================== dead stock

type DeadRow = { locationId: number; locationName: string; stockItemId: number; name: string; category: string; baseUnit: string; perishable: boolean; quantity: number; value: number; lastMovedAt: string | null; idleDays: number | null };

export function DeadStockTab({ propertyId, refreshKey }: { propertyId: number; refreshKey: number }) {
  const [days, setDays] = useState<number | undefined>(undefined);
  const { data, error } = useReport<{ currency: string; days: number; total: number; rows: DeadRow[] }>(`/api/nrms/stock/property/${propertyId}/insights/dead-stock`, { days }, refreshKey);
  const currency = data?.currency ?? "TZS";
  return (
    <Frame data={data} error={error}>
      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-sm text-neutral-600"><span className="font-bold text-neutral-900">{formatMoney(data.total, currency)}</span> sitting in goods with no sale, transfer or use for {data.days} days or more.</p>
            <div className="flex gap-1.5">
              {[14, 30, 60, 90].map((value) => (
                <button key={value} type="button" onClick={() => setDays(value)} className={`h-8 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] ${data.days === value ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{value} days</button>
              ))}
            </div>
          </div>
          <div className={`${cardClass} overflow-hidden`}>
            {data.rows.length === 0 ? <EmptyState icon={CheckCircle2} title="Nothing idle" body="Every good on the shelves has moved within the period. A count alone does not count as movement." /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead><tr className={headRow}><th className="px-4 py-2.5">Good</th><th className={th}>Where</th><th className={`${th} text-right`}>On the shelf</th><th className={`${th} text-right`}>Idle for</th><th className="px-4 py-2.5 text-right">Money tied up</th></tr></thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={`${row.locationId}-${row.stockItemId}`} className={bodyRow}>
                        <td className="px-4 py-3"><p className="m-0 text-[15px] font-bold text-neutral-900">{row.name}</p><p className="m-0 mt-0.5 text-[13px] text-neutral-500">{STOCK_CATEGORY_LABELS[row.category] ?? row.category}{row.perishable ? " · perishable" : ""}</p></td>
                        <td className={`${th} text-sm text-neutral-700`}>{row.locationName}</td>
                        <td className={`${th} text-right text-sm tabular-nums`}>{formatStockQuantity(row.quantity, row.baseUnit)}</td>
                        <td className={`${th} text-right text-sm tabular-nums ${row.perishable ? "font-bold text-red-700" : "text-amber-700"}`}>{row.idleDays != null ? `${row.idleDays} days` : "Never moved"}</td>
                        <td className="px-4 py-3 text-right text-sm font-bold tabular-nums">{formatMoney(row.value, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Frame>
  );
}

// ===================================================================== valuation

type Valuation = { currency: string; asOf: string; total: number; byLocation: Array<{ locationId: number; name: string; kind: string; value: number; goods: number }>; byCategory: Array<{ category: string; value: number }>; belowZero: number };

export function ValuationTab({ propertyId, refreshKey }: { propertyId: number; refreshKey: number }) {
  const { data, error } = useReport<Valuation>(`/api/nrms/stock/property/${propertyId}/insights/valuation`, {}, refreshKey);
  const currency = data?.currency ?? "TZS";
  const max = Math.max(1, ...(data?.byCategory ?? []).map((row) => row.value));
  return (
    <Frame data={data} error={error}>
      {data && (
        <div className="space-y-4">
          <div className={`${cardClass} p-4 sm:p-5`}>
            <p className="m-0 text-sm text-neutral-500">Stock on the shelves now, at average cost</p>
            <p className="m-0 mt-1 text-3xl font-bold tabular-nums text-neutral-950">{formatMoney(data.total, currency)}</p>
            {data.belowZero > 0 && <p className="m-0 mt-2 flex items-center gap-1.5 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" />{data.belowZero} {data.belowZero === 1 ? "good is" : "goods are"} below zero on the books and left out. Count them.</p>}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={`${cardClass} overflow-hidden`}>
              <p className="m-0 border-0 border-b border-solid border-neutral-100 px-4 py-3 text-sm font-bold text-neutral-900">By location</p>
              {data.byLocation.map((row) => (
                <div key={row.locationId} className="flex items-center justify-between gap-3 border-0 border-t border-solid border-neutral-100 px-4 py-3 first:border-t-0">
                  <span className="text-sm text-neutral-800">{row.name} <span className="text-neutral-500">· {row.goods} goods</span></span>
                  <span className="text-sm font-bold tabular-nums">{formatMoney(row.value, currency)}</span>
                </div>
              ))}
            </div>
            <div className={`${cardClass} p-4`}>
              <p className="m-0 text-sm font-bold text-neutral-900">By category</p>
              <div className="mt-3 space-y-2.5">
                {data.byCategory.map((row) => (
                  <div key={row.category}>
                    <div className="flex items-center justify-between gap-3 text-sm"><span className="text-neutral-700">{STOCK_CATEGORY_LABELS[row.category] ?? row.category}</span><span className="font-bold tabular-nums">{formatMoney(row.value, currency)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-brand" style={{ width: `${(row.value / max) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
}

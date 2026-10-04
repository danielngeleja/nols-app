"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDownToLine, Boxes, ChevronDown, ChevronRight, Library, PackagePlus, Pencil, Search } from "lucide-react";
import type { StockBalance, StockGood } from "../../../_components/StockGoodsPanel";
import { STOCK_CATEGORY_LABELS, categoryTone, formatMoney, formatStockQuantity, formatUnitCost, unitShort } from "../../../_components/stockFormat";
import type { StockWorkspace } from "./useStockWorkspace";
import { EmptyState, Pill, cardClass, outlineButton, primaryButton, quietButton } from "./ui";

type Filter = "all" | "attention" | "uncounted" | "unlinked" | "perishable" | "retired";
const FILTERS: Array<[Filter, string]> = [
  ["all", "All"],
  ["attention", "Needs attention"],
  ["uncounted", "No count yet"],
  ["unlinked", "Not on the menu"],
  ["perishable", "Perishable"],
  ["retired", "Retired"],
];

function balanceTone(balance: StockBalance): "ok" | "low" | "out" | "negative" {
  if (balance.quantity < 0) return "negative";
  if (balance.quantity === 0) return "out";
  if (balance.reorderPoint != null && balance.quantity <= balance.reorderPoint) return "low";
  return "ok";
}
const TONE_LABEL = { ok: "In stock", low: "Reorder", out: "Out", negative: "Below zero" } as const;

function worstTone(good: StockGood): "ok" | "low" | "out" | "negative" | null {
  if (good.balances.length === 0) return null;
  const rank = { negative: 0, out: 1, low: 2, ok: 3 } as const;
  return good.balances.map(balanceTone).sort((a, b) => rank[a] - rank[b])[0];
}

export default function ItemsTab({ workspace, onAdd, onCatalogue, onEdit, onReceive, onOpening }: {
  workspace: StockWorkspace;
  onAdd: () => void;
  onCatalogue: () => void;
  onEdit: (good: StockGood) => void;
  onReceive: (good: StockGood, locationId?: number) => void;
  onOpening: (good: StockGood, locationId?: number) => void;
}) {
  const overview = workspace.overview!;
  const currency = overview.currency;
  const [category, setCategory] = useState<string>("ALL");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const matchesFilter = (good: StockGood) => {
    if (filter === "retired") return good.status !== "ACTIVE";
    if (good.status !== "ACTIVE") return false;
    if (filter === "attention") { const tone = worstTone(good); return tone != null && tone !== "ok"; }
    if (filter === "uncounted") return good.balances.length === 0;
    if (filter === "unlinked") return (workspace.usedBy.get(good.id)?.length ?? 0) === 0;
    if (filter === "perishable") return good.perishable;
    return true;
  };

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const good of overview.items) if (good.status === "ACTIVE") map.set(good.category, (map.get(good.category) ?? 0) + 1);
    return map;
  }, [overview.items]);

  const q = query.trim().toLowerCase();
  const rows = overview.items.filter((good) => (category === "ALL" || good.category === category) && matchesFilter(good) && (!q || good.name.toLowerCase().includes(q)));

  const toggle = (id: number) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (overview.items.length === 0) {
    return (
      <div className={cardClass}>
        <EmptyState
          icon={Boxes}
          title="Start with the goods you lose the most"
          body="Beer, spirits and wine first. Pick them from the starter catalogue in one go, or add your own. Then record today's count as the opening balance."
          action={<><button type="button" onClick={onCatalogue} className={primaryButton}><Library className="h-4 w-4" />Starter catalogue</button><button type="button" onClick={onAdd} className={outlineButton}><PackagePlus className="h-4 w-4" />Add stock item</button></>}
        />
      </div>
    );
  }

  const activeTotal = [...categoryCounts.values()].reduce((sum, count) => sum + count, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className={`${cardClass} h-max p-2`}>
        <p className="m-0 px-2 pb-1.5 pt-1 text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">Categories</p>
        {[["ALL", "All goods", activeTotal] as const, ...[...categoryCounts.entries()].sort((a, b) => (STOCK_CATEGORY_LABELS[a[0]] ?? a[0]).localeCompare(STOCK_CATEGORY_LABELS[b[0]] ?? b[0])).map(([key, count]) => [key, STOCK_CATEGORY_LABELS[key] ?? key, count] as const)].map(([key, label, count]) => (
          <button key={key} type="button" onClick={() => setCategory(key)} className={`flex w-full items-center justify-between gap-2 rounded-lg border-0 px-2.5 py-2 text-left text-sm font-bold transition ${category === key ? "bg-brand/10 text-brand" : "bg-transparent text-neutral-600 hover:bg-neutral-50"}`}>
            <span className="flex min-w-0 items-center gap-2 truncate">{key !== "ALL" && <span className={`h-2 w-2 shrink-0 rounded-full ${categoryTone(key).dot}`} />}{label}</span>
            <span className={`rounded-full px-1.5 text-xs ${category === key ? "bg-brand text-white" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
          </button>
        ))}
      </aside>

      <div className={`${cardClass} min-w-0 overflow-hidden`}>
        <div className="space-y-2.5 border-0 border-b border-solid border-neutral-200 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search goods" className="[font-family:inherit] box-border h-9 w-full rounded-lg border border-solid border-neutral-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)} className={`h-8 shrink-0 whitespace-nowrap rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${filter === key ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 w-10 pl-4" />
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Item</th>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Bought as</th>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 text-right">On hand</th>
                  {overview.showCost && <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 text-right">Avg cost</th>}
                  {overview.showCost && <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 text-right">Value</th>}
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Status</th>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-neutral-400">No goods match this view.</td></tr>
                )}
                {rows.map((good, index) => {
                  const open = expanded.has(good.id);
                  const tone = worstTone(good);
                  const usedBy = workspace.usedBy.get(good.id) ?? [];
                  return (
                    <Fragment key={good.id}>
                      <tr className={`${open ? "bg-brand/[0.04]" : index % 2 ? "bg-neutral-50/60" : "bg-white"} transition hover:bg-brand/[0.04] ${good.status !== "ACTIVE" ? "opacity-55" : ""} [&>td]:border-0 [&>td]:border-b [&>td]:border-solid [&>td]:border-neutral-200`}>
                        <td className="px-3 py-2.5 pl-4 align-middle">
                          <button type="button" aria-label={open ? "Collapse" : "Expand"} onClick={() => toggle(good.id)} className="flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>
                        </td>
                        <td className="max-w-[280px] px-2 py-2.5">
                          <button type="button" onClick={() => toggle(good.id)} className="block w-full border-0 bg-transparent p-0 text-left">
                            <span className="block truncate text-[15px] font-bold text-neutral-900">{good.name}</span>
                            <span className="mt-0.5 block truncate text-xs text-neutral-500">
                              {STOCK_CATEGORY_LABELS[good.category] ?? good.category} · in {unitShort(good.baseUnit)}{good.perishable ? " · perishable" : ""} · {usedBy.length ? `${usedBy.length} menu ${usedBy.length === 1 ? "item" : "items"}` : "not on the menu"}
                            </span>
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-sm text-neutral-600">{good.packUnits.length ? good.packUnits.map((pack) => pack.name).join(", ") : "Single units"}</td>
                        <td className={`whitespace-nowrap px-3 py-2.5 text-right text-sm font-bold tabular-nums ${good.totalQuantity < 0 ? "text-red-700" : "text-neutral-900"}`}>{good.balances.length ? formatStockQuantity(good.totalQuantity, good.baseUnit) : "-"}</td>
                        {overview.showCost && <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-neutral-600">{good.averageCost ? `${formatUnitCost(good.averageCost, currency)}/${unitShort(good.baseUnit)}` : "-"}</td>}
                        {overview.showCost && <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-neutral-700">{good.stockValue ? formatMoney(good.stockValue, currency) : "-"}</td>}
                        <td className="whitespace-nowrap px-3 py-2.5">{good.status !== "ACTIVE" ? <Pill tone="muted">Retired</Pill> : tone == null ? <Pill tone="info">Needs a count</Pill> : <Pill tone={tone}>{TONE_LABEL[tone]}</Pill>}</td>
                        <td className="w-px whitespace-nowrap px-3 py-2.5 pr-4">
                          <div className="flex flex-nowrap justify-end gap-1.5">
                            {good.status === "ACTIVE" && (good.balances.length === 0
                              ? <button type="button" onClick={() => onOpening(good)} className={quietButton}><ArrowDownToLine className="h-3.5 w-3.5" />Opening count</button>
                              : overview.canReceive && <button type="button" onClick={() => onReceive(good)} className={quietButton}><ArrowDownToLine className="h-3.5 w-3.5" />Receive</button>)}
                            <button type="button" onClick={() => onEdit(good)} className={quietButton}><Pencil className="h-3.5 w-3.5" />Edit</button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-neutral-50/70 [&>td]:border-0 [&>td]:border-b [&>td]:border-solid [&>td]:border-neutral-200">
                          <td />
                          <td colSpan={7} className="px-2 pb-4 pt-1">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                              <div className="rounded-xl border border-solid border-neutral-200 bg-white">
                                <p className="m-0 border-0 border-b border-solid border-neutral-100 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">By outlet</p>
                                {overview.locations.map((outlet) => {
                                  const balance = good.balances.find((row) => row.locationId === outlet.id);
                                  const balanceToneValue = balance ? balanceTone(balance) : null;
                                  return (
                                    <div key={outlet.id} className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2 last:border-b-0">
                                      <div className="min-w-0">
                                        <p className="m-0 truncate text-sm font-bold text-neutral-800">{outlet.name}</p>
                                        <p className="m-0 mt-0.5 text-xs text-neutral-500">
                                          {balance ? `${formatStockQuantity(balance.quantity, good.baseUnit)} on hand` : "Not stocked here"}
                                          {balance?.reorderPoint != null ? ` · reorder at ${formatStockQuantity(balance.reorderPoint, good.baseUnit)}` : ""}
                                          {balance?.parLevel != null ? ` · par ${formatStockQuantity(balance.parLevel, good.baseUnit)}` : ""}
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        {balanceToneValue && <Pill tone={balanceToneValue}>{TONE_LABEL[balanceToneValue]}</Pill>}
                                        {good.status === "ACTIVE" && (balance
                                          ? overview.canReceive && <button type="button" onClick={() => onReceive(good, outlet.id)} className={quietButton}>Receive</button>
                                          : <button type="button" onClick={() => onOpening(good, outlet.id)} className={quietButton}>Opening count</button>)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="space-y-3">
                                <div className="rounded-xl border border-solid border-neutral-200 bg-white px-3 py-2.5">
                                  <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">Packs</p>
                                  <p className="m-0 mt-1 text-sm text-neutral-700">{good.packUnits.length ? good.packUnits.map((pack) => `${pack.name} = ${formatStockQuantity(pack.baseQuantity, good.baseUnit)}`).join(" · ") : "Bought as single units"}</p>
                                </div>
                                <div className="rounded-xl border border-solid border-neutral-200 bg-white px-3 py-2.5">
                                  <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">Used by</p>
                                  {usedBy.length ? (
                                    <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
                                      {usedBy.map((row) => <li key={row.menuItemId} className="truncate text-sm text-neutral-700">{row.name}<span className="text-neutral-400"> · {row.outletName}</span></li>)}
                                    </ul>
                                  ) : <p className="m-0 mt-1 text-sm text-neutral-500">No menu item uses it yet. Link it under Recipes.</p>}
                                </div>
                              </div>
                            </div>
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
        <p className="m-0 bg-neutral-100 px-4 py-2.5 text-xs font-bold text-neutral-500">{rows.length} of {overview.items.length} goods shown</p>
      </div>
    </div>
  );
}

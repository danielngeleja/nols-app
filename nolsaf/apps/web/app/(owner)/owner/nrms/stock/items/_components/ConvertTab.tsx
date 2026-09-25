"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Replace } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { STOCK_BASE_UNIT_LABELS, STOCK_CATEGORY_LABELS, apiError } from "../../../_components/stockFormat";
import type { StockWorkspace } from "./useStockWorkspace";
import { EmptyState, SectionCard, cardClass, checkboxClass, primaryButton, smallFieldClass } from "./ui";

function guessCategory(menuCategory: string | null, outletType: string): string {
  const key = (menuCategory ?? "").toLowerCase();
  if (/beer|cider|lager/.test(key)) return "BEER";
  if (/wine|sparkling|ros/.test(key)) return "WINE";
  if (/whisk|gin|vodka|rum|tequila|brandy|cognac|liqueur|spirit/.test(key)) return "SPIRITS";
  if (/water/.test(key)) return "WATER";
  if (/soft|mixer|energy|juice|soda/.test(key)) return "SOFT_DRINKS";
  if (/seafood|fish/.test(key)) return "FISH_SEAFOOD";
  if (/chicken|poultry/.test(key)) return "POULTRY";
  if (/meat|grill|barbecue/.test(key)) return "MEAT";
  return outletType === "BAR" ? "SOFT_DRINKS" : "OTHER";
}

type Row = { selected: boolean; category: string; baseUnit: string; unitCost: string };

export default function ConvertTab({ workspace, propertyId }: { workspace: StockWorkspace; propertyId: number }) {
  const overview = workspace.overview!;
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows((current) => Object.fromEntries(overview.legacy.map((item) => [item.menuItemId, current[item.menuItemId] ?? {
      selected: true,
      category: guessCategory(item.category, item.outletType),
      baseUnit: item.outletType === "BAR" ? "BOTTLE" : "PIECE",
      unitCost: "",
    }])));
  }, [overview.legacy]);

  const chosen = overview.legacy.filter((item) => rows[item.menuItemId]?.selected);
  const allSelected = overview.legacy.length > 0 && chosen.length === overview.legacy.length;

  const convert = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiClient.post<{ converted: number[]; skipped: Array<{ menuItemId: number; reason: string }> }>(`/api/nrms/stock/property/${propertyId}/convert-legacy`, {
        items: chosen.map((item) => {
          const row = rows[item.menuItemId];
          return { menuItemId: item.menuItemId, category: row.category, baseUnit: row.baseUnit, unitCost: Number(row.unitCost) > 0 ? Number(row.unitCost) : null };
        }),
      });
      setMessage(`${res.data.converted.length} moved to stock items${res.data.skipped.length ? `, ${res.data.skipped.length} skipped` : ""}.`);
      await workspace.reload();
    } catch (cause) {
      setError(apiError(cause, "Could not move the counters"));
    } finally {
      setBusy(false);
    }
  };

  if (overview.legacy.length === 0) {
    return (
      <div className={cardClass}>
        <EmptyState icon={message ? CheckCircle2 : Replace} title={message ? "Counters moved" : "Nothing to move"} body={message ?? "No menu item keeps its own count. Every counted item now draws from stock items."} />
      </div>
    );
  }

  return (
    <SectionCard
      icon={Replace}
      tone="amber"
      title={`${overview.legacy.length} menu ${overview.legacy.length === 1 ? "item keeps" : "items keep"} their own count`}
      subtitle="Move them so each count has a history. Today's number becomes the opening count."
      bodyClass="p-0"
      action={<button type="button" disabled={busy || chosen.length === 0} onClick={() => void convert()} className={primaryButton}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Move {chosen.length} to stock items</button>}
    >
      <p className="m-0 border-0 border-b border-solid border-neutral-100 px-4 py-3 text-sm text-neutral-600 sm:px-5">
        Each one becomes a stock item with the same name (a drink sold at two outlets becomes one good), linked one to one. Add a cost per unit if you know it, otherwise the next delivery sets it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 w-10 pl-4"><input type="checkbox" aria-label="Select all" className={checkboxClass} checked={allSelected} onChange={(event) => setRows((current) => Object.fromEntries(Object.entries(current).map(([key, row]) => [key, { ...row, selected: event.target.checked }])))} /></th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Menu item</th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 text-right">Count today</th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Becomes a good in</th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Counted in</th>
              <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 pr-4">Cost per unit</th>
            </tr>
          </thead>
          <tbody>
            {overview.legacy.map((item, index) => {
              const row = rows[item.menuItemId];
              if (!row) return null;
              const update = (patch: Partial<Row>) => setRows((current) => ({ ...current, [item.menuItemId]: { ...current[item.menuItemId], ...patch } }));
              return (
                <tr key={item.menuItemId} className={`${index % 2 ? "bg-neutral-50/60" : "bg-white"} ${row.selected ? "" : "opacity-50"} [&>td]:border-0 [&>td]:border-b [&>td]:border-solid [&>td]:border-neutral-200`}>
                  <td className="px-3 py-2.5 pl-4"><input type="checkbox" className={checkboxClass} checked={row.selected} onChange={(event) => update({ selected: event.target.checked })} aria-label={`Move ${item.name}`} /></td>
                  <td className="px-3 py-2.5">
                    <p className="m-0 font-bold text-neutral-900">{item.name}</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-500">{item.outletName}{item.category ? ` · ${item.category}` : ""}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-[15px] font-bold tabular-nums">{item.stockQuantity}</td>
                  <td className="px-3 py-2.5">
                    <select value={row.category} onChange={(event) => update({ category: event.target.value })} className={`${smallFieldClass} h-8 w-full min-w-[150px] text-sm`} aria-label={`Category for ${item.name}`}>
                      {Object.entries(STOCK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    <select value={row.baseUnit} onChange={(event) => update({ baseUnit: event.target.value })} className={`${smallFieldClass} h-8 w-full min-w-[110px] text-sm`} aria-label={`Unit for ${item.name}`}>
                      {(["BOTTLE", "CAN", "PIECE"] as const).map((value) => <option key={value} value={value}>{STOCK_BASE_UNIT_LABELS[value]}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 pr-4">
                    <div className="relative max-w-[180px]">
                      <input inputMode="decimal" value={row.unitCost} onChange={(event) => update({ unitCost: event.target.value.replace(/[^\d.]/g, "") })} placeholder="Optional" aria-label={`Cost per unit for ${item.name}`} className={`${smallFieldClass} h-8 w-full pr-12 text-sm tabular-nums`} />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{overview.currency}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 bg-neutral-100 px-4 py-2.5 text-xs font-bold text-neutral-500 sm:px-5">{chosen.length} of {overview.legacy.length} selected to move</p>
      {(error || message) && <p className={`m-0 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-sm sm:px-5 ${error ? "text-red-700" : "text-emerald-800"}`}>{error ?? message}</p>}
    </SectionCard>
  );
}

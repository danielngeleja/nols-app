"use client";

// Breakfast consumption (docs/NRMS_STOCK_AND_PURCHASING.md section 6,
// milestone 6). Breakfast has no per-guest orders, so each morning the kitchen
// posts covers served times what one cover uses. Once per morning; any
// difference is corrected by the next count.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Coffee, Loader2, Plus, Trash2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import type { StockOverview } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatStockQuantity, unitShort } from "../../../_components/stockFormat";
import { SectionCard, fieldClass, labelClass, primaryButton, quietButton, smallFieldClass } from "../../items/_components/ui";

type Breakfast = {
  date: string;
  covers: number;
  locationId: number | null;
  locations: Array<{ id: number; name: string }>;
  recipe: Array<{ stockItemId: number; quantity: number; name: string; baseUnit: string }>;
  usage: Array<{ stockItemId: number; quantity: number; name: string; baseUnit: string; cost: number }>;
  posted: { at: string; by: string | null; cost: number; lines: number } | null;
  canEditRecipe: boolean;
  canPost: boolean;
};

function eatToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function BreakfastTab({ propertyId, overview, onChanged }: { propertyId: number; overview: StockOverview; onChanged: () => void }) {
  const [date, setDate] = useState(eatToday());
  const [data, setData] = useState<Breakfast | null>(null);
  const [covers, setCovers] = useState("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [editing, setEditing] = useState(false);
  const [recipe, setRecipe] = useState<Array<{ key: number; stockItemId: number | ""; quantity: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const goods = useMemo(() => overview.items.filter((item) => item.status === "ACTIVE"), [overview.items]);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<Breakfast>(`/api/nrms/stock/property/${propertyId}/breakfast`, { params: { date } });
      setData(res.data);
      setCovers(String(res.data.covers || ""));
      setLocationId(res.data.locationId ?? (res.data.locations.length === 1 ? res.data.locations[0].id : ""));
      setError(null);
    } catch (cause) {
      setError(apiError(cause, "Unable to load breakfast"));
    }
  }, [propertyId, date]);
  useEffect(() => { void load(); }, [load]);

  const startEditing = () => {
    setRecipe((data?.recipe ?? []).map((row, index) => ({ key: index + 1, stockItemId: row.stockItemId, quantity: String(row.quantity) })));
    setEditing(true);
  };

  const saveRecipe = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(`/api/nrms/stock/property/${propertyId}/breakfast/recipe`, {
        locationId: locationId || null,
        lines: recipe.filter((row) => row.stockItemId && Number(row.quantity) > 0).map((row) => ({ stockItemId: row.stockItemId, quantity: Number(row.quantity) })),
      });
      setEditing(false);
      setNotice("Breakfast recipe saved.");
      await load();
    } catch (cause) {
      setError(apiError(cause, "Could not save the recipe"));
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/api/nrms/stock/property/${propertyId}/breakfast/post`, { date, covers: Number(covers), locationId });
      setNotice("Breakfast posted. The goods are off the shelf and in today's cost of sales.");
      onChanged();
      await load();
    } catch (cause) {
      setError(apiError(cause, "Could not post breakfast"));
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="flex min-h-[24vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  // What the typed covers use; whole goods round up, the same rule the server posts with.
  const typed = Number(covers) || 0;
  const scaled = data.recipe.map((row) => {
    const raw = Math.round(row.quantity * typed * 1000) / 1000;
    const whole = goods.find((item) => item.id === row.stockItemId)?.countStyle !== "PARTIAL";
    return { ...row, quantity: whole ? Math.ceil(raw) : raw };
  });

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <SectionCard icon={Coffee} title="Post a morning's breakfast" subtitle="Covers served times what one cover uses, once per morning">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className={`${labelClass} m-0`}>Morning</p>
            <div className="mt-1.5"><DatePickerField label="Breakfast morning" value={date} allowPast max={eatToday()} twoMonths={false} size="sm" widthClassName="!w-full" onChangeAction={(next) => setDate(next.slice(0, 10))} /></div>
          </div>
          <label className={labelClass}>
            Covers served
            <input inputMode="numeric" value={covers} onChange={(event) => setCovers(event.target.value.replace(/[^\d]/g, "").slice(0, 5))} className={`${fieldClass} font-bold tabular-nums`} />
            <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-neutral-500">{data.covers} on the breakfast list{typed !== data.covers && data.covers > 0 ? <button type="button" onClick={() => setCovers(String(data.covers))} className="ml-1.5 border-0 bg-transparent p-0 text-xs font-bold text-brand [font-family:inherit] hover:underline">Use {data.covers}</button> : null}</span>
          </label>
          <label className={labelClass}>
            Taken from
            <select value={locationId} onChange={(event) => setLocationId(event.target.value ? Number(event.target.value) : "")} className={fieldClass}>
              <option value="">Choose the shelf</option>
              {data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-solid border-neutral-300">
          {data.recipe.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50/60 px-4 py-4">
              <p className="m-0 text-sm text-amber-900">No breakfast recipe yet. Set what one cover uses, then post each morning here.</p>
              {data.canEditRecipe && !editing && <button type="button" onClick={startEditing} className={`${primaryButton} h-8`}><Plus className="h-3.5 w-3.5" />Set up the recipe</button>}
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 pl-4">Good</th>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 text-right">Per cover</th>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 pr-4 text-right">For {typed || 0} {typed === 1 ? "cover" : "covers"}</th>
                </tr>
              </thead>
              <tbody>
                {scaled.map((row, index) => {
                  const perCover = data.recipe.find((item) => item.stockItemId === row.stockItemId)?.quantity ?? 0;
                  return (
                    <tr key={row.stockItemId} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                      <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 pl-4 font-bold text-neutral-900">{row.name}</td>
                      <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 whitespace-nowrap text-right tabular-nums text-neutral-500">{perCover} {unitShort(row.baseUnit)}</td>
                      <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 whitespace-nowrap pr-4 text-right font-bold tabular-nums text-neutral-950">{formatStockQuantity(row.quantity, row.baseUnit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {data.posted ? (
          <p className="m-0 mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />Posted{data.posted.by ? ` by ${data.posted.by}` : ""}: {formatMoney(data.posted.cost, overview.currency)} of goods. Correct any difference with a count.</p>
        ) : data.canPost ? (
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={busy || !locationId || typed <= 0 || data.recipe.length === 0} onClick={() => void post()} className={`${primaryButton} !h-10 px-4`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Take {typed || 0} {typed === 1 ? "cover" : "covers"} off the shelf</button>
          </div>
        ) : null}
        {notice && <p className="m-0 mt-3 text-sm font-bold text-emerald-700">{notice}</p>}
        {error && <p className="m-0 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </SectionCard>

      <SectionCard icon={Coffee} title="What one cover uses" subtitle="Eggs, bread, milk, juice, coffee: per guest" action={data.canEditRecipe && !editing && data.recipe.length > 0 ? <button type="button" onClick={startEditing} className={quietButton}>Edit</button> : undefined}>
        {!editing ? (
          data.recipe.length === 0 ? (
            <div className="space-y-3">
              <p className="m-0 text-sm text-neutral-600">List what one guest&apos;s breakfast takes off the shelf. For example:</p>
              <ul className="m-0 list-none space-y-1.5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 text-[13px] text-neutral-600">
                {[["Eggs", "2 pieces"], ["Bread", "2 slices"], ["Milk", "150 ml"], ["Juice", "200 ml"], ["Coffee", "10 g"]].map(([name, amount]) => (
                  <li key={name} className="flex justify-between gap-3"><span>{name}</span><span className="tabular-nums text-neutral-500">{amount}</span></li>
                ))}
              </ul>
              {data.canEditRecipe ? <button type="button" onClick={startEditing} className={`${primaryButton} h-9`}><Plus className="h-4 w-4" />Set up the recipe</button> : <p className="m-0 text-xs text-neutral-500">The owner or a manager sets this.</p>}
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600">Good</th>
                  <th className="whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 text-right">Per cover</th>
                </tr>
              </thead>
              <tbody>
                {data.recipe.map((row, index) => (
                  <tr key={row.stockItemId} className={index % 2 ? "bg-neutral-50/60" : "bg-white"}>
                    <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 font-bold text-neutral-800">{row.name}</td>
                    <td className="border-0 border-b border-solid border-neutral-200 px-3 py-2.5 whitespace-nowrap text-right font-bold tabular-nums">{row.quantity} {unitShort(row.baseUnit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <div className="space-y-2">
            {recipe.map((row) => {
              const good = row.stockItemId ? goods.find((item) => item.id === row.stockItemId) : null;
              return (
                <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_96px_36px] items-center gap-2">
                  <select value={row.stockItemId} onChange={(event) => setRecipe((rows) => rows.map((item) => (item.key === row.key ? { ...item, stockItemId: event.target.value ? Number(event.target.value) : "" } : item)))} className={`${smallFieldClass} w-full`} aria-label="Good">
                    <option value="">Choose goods</option>
                    {goods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <input inputMode="decimal" value={row.quantity} onChange={(event) => setRecipe((rows) => rows.map((item) => (item.key === row.key ? { ...item, quantity: event.target.value.replace(/[^\d.]/g, "") } : item)))} className={`${smallFieldClass} w-16 tabular-nums`} aria-label="Quantity per cover" />
                    <span className="text-xs text-neutral-500">{good ? unitShort(good.baseUnit) : ""}</span>
                  </div>
                  <button type="button" aria-label="Remove" onClick={() => setRecipe((rows) => rows.filter((item) => item.key !== row.key))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}
            <button type="button" onClick={() => setRecipe((rows) => [...rows, { key: Math.max(0, ...rows.map((item) => item.key)) + 1, stockItemId: "", quantity: "" }])} className={quietButton}><Plus className="h-3.5 w-3.5" />Add a good</button>
            <p className="m-0 text-xs text-neutral-500">The shelf chosen on the left is saved with the recipe as the usual breakfast shelf.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className={quietButton}>Cancel</button>
              <button type="button" disabled={busy} onClick={() => void saveRecipe()} className={`${primaryButton} h-8`}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save recipe</button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

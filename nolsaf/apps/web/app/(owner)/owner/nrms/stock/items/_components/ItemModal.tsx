"use client";

import { useState } from "react";
import { Loader2, PackagePlus, Plus, Trash2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "../../../_components/NrmsModalFrame";
import type { StockGood, StockOverview } from "../../../_components/StockGoodsPanel";
import { STOCK_BASE_UNIT_LABELS, STOCK_CATEGORY_LABELS, apiError, unitShort } from "../../../_components/stockFormat";
import { checkboxClass, fieldClass, labelClass, primaryButton, quietButton, radioClass, smallFieldClass } from "./ui";

/** How goods in each category are usually counted, and whether they spoil. */
const CATEGORY_DEFAULTS: Record<string, { baseUnit: string; perishable: boolean }> = {
  BEER: { baseUnit: "BOTTLE", perishable: false },
  SPIRITS: { baseUnit: "ML", perishable: false },
  WINE: { baseUnit: "ML", perishable: false },
  SOFT_DRINKS: { baseUnit: "BOTTLE", perishable: false },
  WATER: { baseUnit: "BOTTLE", perishable: false },
  MEAT: { baseUnit: "G", perishable: true },
  POULTRY: { baseUnit: "G", perishable: true },
  FISH_SEAFOOD: { baseUnit: "G", perishable: true },
  PRODUCE: { baseUnit: "G", perishable: true },
  DAIRY_EGGS: { baseUnit: "PIECE", perishable: true },
  DRY_GOODS: { baseUnit: "G", perishable: false },
  OTHER: { baseUnit: "PIECE", perishable: false },
};

type PackDraft = { name: string; baseQuantity: string };
type LevelDraft = { parLevel: string; reorderPoint: string };

export default function ItemModal({ propertyId, data, item, onClose, onSaved }: { propertyId: number; data: StockOverview; item: StockGood | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "BEER");
  const [baseUnit, setBaseUnit] = useState(item?.baseUnit ?? "BOTTLE");
  const [countStyle, setCountStyle] = useState<"WHOLE" | "PARTIAL">(item?.countStyle ?? "WHOLE");
  const [perishable, setPerishable] = useState(item?.perishable ?? false);
  const [shelfLife, setShelfLife] = useState(item?.shelfLifeDays ? String(item.shelfLifeDays) : "");
  const [packs, setPacks] = useState<PackDraft[]>(item?.packUnits.map((pack) => ({ name: pack.name, baseQuantity: String(pack.baseQuantity) })) ?? []);
  const [levels, setLevels] = useState<Record<number, LevelDraft>>(() => Object.fromEntries(data.locations.map((outlet) => {
    const balance = item?.balances.find((row) => row.locationId === outlet.id);
    return [outlet.id, { parLevel: balance?.parLevel != null ? String(balance.parLevel) : "", reorderPoint: balance?.reorderPoint != null ? String(balance.reorderPoint) : "" }];
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new item takes the usual unit and perishability of its category, so
  // choosing "Fish and seafood" fills in grams and ticks perishable. An existing
  // item keeps its unit: history is stored in it and the server locks it.
  const chooseCategory = (next: string) => {
    setCategory(next);
    if (item) return;
    const defaults = CATEGORY_DEFAULTS[next];
    if (!defaults) return;
    setBaseUnit(defaults.baseUnit);
    setPerishable(defaults.perishable);
  };

  // Grams and millilitres are always counted in parts.
  const unitIsMeasure = baseUnit === "G" || baseUnit === "ML";
  const effectiveCountStyle = unitIsMeasure ? "PARTIAL" : countStyle;
  const unitWord = unitIsMeasure ? unitShort(baseUnit) : `${unitShort(baseUnit)}s`;

  const packPayload = packs
    .filter((pack) => pack.name.trim() && Number(pack.baseQuantity) > 0)
    .map((pack) => ({ name: pack.name.trim(), baseQuantity: Number(pack.baseQuantity) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const shelfLifeDays = perishable && Number(shelfLife) > 0 ? Math.round(Number(shelfLife)) : null;
      if (!item) {
        await apiClient.post(`/api/nrms/stock/property/${propertyId}/items`, { name: name.trim(), category, baseUnit, countStyle: effectiveCountStyle, perishable, shelfLifeDays, packUnits: packPayload });
      } else {
        await apiClient.patch(`/api/nrms/stock/items/${item.id}`, { name: name.trim(), category, baseUnit, countStyle: effectiveCountStyle, perishable, shelfLifeDays });
        await apiClient.put(`/api/nrms/stock/items/${item.id}/packs`, { packUnits: packPayload });
        for (const outlet of data.locations) {
          const draft = levels[outlet.id];
          const balance = item.balances.find((row) => row.locationId === outlet.id);
          const par = draft.parLevel.trim() === "" ? null : Number(draft.parLevel);
          const reorder = draft.reorderPoint.trim() === "" ? null : Number(draft.reorderPoint);
          if (par === (balance?.parLevel ?? null) && reorder === (balance?.reorderPoint ?? null)) continue;
          await apiClient.patch(`/api/nrms/stock/items/${item.id}/levels`, { locationId: outlet.id, parLevel: par, reorderPoint: reorder });
        }
      }
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not save the stock item"));
    } finally {
      setBusy(false);
    }
  };

  const toggleRetired = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(`/api/nrms/stock/items/${item.id}`, { status: item.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not update the stock item"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalFrame
      title={item ? `Edit ${item.name}` : "Add stock item"}
      subtitle="A good the property buys and holds"
      icon={<PackagePlus className="h-5 w-5" />}
      onClose={onClose}
      wide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          {item ? <button type="button" disabled={busy} onClick={() => void toggleRetired()} className="h-10 rounded-lg border border-solid [font-family:inherit] border-neutral-300 bg-white px-4 text-[15px] font-bold text-neutral-600 hover:bg-neutral-50">{item.status === "ACTIVE" ? "Retire item" : "Restore item"}</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid [font-family:inherit] border-neutral-300 bg-white px-4 text-[15px] font-bold text-neutral-700 hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className={`${primaryButton} !h-10 px-4 text-[15px]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button>
          </div>
        </div>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Name
          <input value={name} onChange={(event) => setName(event.target.value.slice(0, 160))} placeholder="Kilimanjaro Premium Lager 500 ml" className={fieldClass} />
        </label>
        <label className={labelClass}>
          Category
          <select value={category} onChange={(event) => chooseCategory(event.target.value)} className={fieldClass}>
            {Object.entries(STOCK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Counted in
          <select value={baseUnit} onChange={(event) => setBaseUnit(event.target.value)} className={fieldClass}>
            {Object.entries(STOCK_BASE_UNIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="mt-1 block text-[13px] font-normal normal-case tracking-normal text-neutral-400">{item ? "Locked once stock has moved." : "Filled in from the category. Change it if this good is bought differently."}</span>
        </label>

        {!unitIsMeasure && (
          <fieldset className="m-0 border-0 p-0 sm:col-span-2">
            <legend className={labelClass}>How it is sold</legend>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {([
                ["WHOLE", "Whole units only", "A beer, a can, a piece. A sale can never go below what is on the shelf."],
                ["PARTIAL", "In parts too", "Half a piece, a share of a loaf. For spirits, count in millilitres instead."],
              ] as const).map(([value, title, hint]) => (
                <label key={value} className={`flex cursor-pointer gap-2 rounded-xl border border-solid p-3 ${countStyle === value ? "border-brand bg-brand/5" : "border-neutral-300 bg-white"}`}>
                  <input type="radio" name="countStyle" checked={countStyle === value} onChange={() => setCountStyle(value)} className={`${radioClass} mt-0.5`} />
                  <span><span className="block text-sm font-bold text-neutral-900">{title}</span><span className="mt-0.5 block text-[13px] text-neutral-500">{hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-neutral-700">
          <input type="checkbox" checked={perishable} onChange={(event) => setPerishable(event.target.checked)} className={checkboxClass} />
          Perishable (fish, meat, dairy, produce)
        </label>
        {perishable && (
          <label className={labelClass}>
            Shelf life in days (optional)
            <input inputMode="numeric" value={shelfLife} onChange={(event) => setShelfLife(event.target.value.replace(/[^\d]/g, ""))} className={fieldClass} />
          </label>
        )}

        <div className="sm:col-span-2">
          <p className={`${labelClass} m-0`}>Bought as (packs)</p>
          <p className="m-0 mt-1 text-[13px] text-neutral-500">How suppliers deliver it, so a delivery can be entered as &quot;3 crates&quot;.</p>
          <div className="mt-2 space-y-2">
            {packs.map((pack, index) => (
              <div key={index} className="flex items-center gap-2">
                <input value={pack.name} onChange={(event) => setPacks((rows) => rows.map((row, i) => (i === index ? { ...row, name: event.target.value.slice(0, 40) } : row)))} placeholder="Crate" className={`${smallFieldClass} flex-1`} />
                <span className="text-sm text-neutral-400">=</span>
                <input inputMode="decimal" value={pack.baseQuantity} onChange={(event) => setPacks((rows) => rows.map((row, i) => (i === index ? { ...row, baseQuantity: event.target.value.replace(/[^\d.]/g, "") } : row)))} placeholder="25" className={`${smallFieldClass} w-24 tabular-nums`} />
                <span className="w-14 text-sm text-neutral-500">{unitWord}</span>
                <button type="button" aria-label="Remove pack" onClick={() => setPacks((rows) => rows.filter((_, i) => i !== index))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            {packs.length < 8 && <button type="button" onClick={() => setPacks((rows) => [...rows, { name: "", baseQuantity: "" }])} className={quietButton}><Plus className="h-3.5 w-3.5" />Add pack</button>}
          </div>
        </div>

        {item && data.locations.length > 0 && (
          <div className="sm:col-span-2">
            <p className={`${labelClass} m-0`}>Levels per outlet (optional, in {unitWord})</p>
            <p className="m-0 mt-1 text-[13px] text-neutral-500">Reorder point flags it when stock falls this low. Par is what a full shelf holds.</p>
            <div className="mt-2 space-y-2">
              {data.locations.map((outlet) => (
                <div key={outlet.id} className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-2">
                  <span className="truncate text-sm font-semibold text-neutral-700">{outlet.name}</span>
                  <input inputMode="decimal" value={levels[outlet.id]?.reorderPoint ?? ""} onChange={(event) => setLevels((rows) => ({ ...rows, [outlet.id]: { ...rows[outlet.id], reorderPoint: event.target.value.replace(/[^\d.]/g, "") } }))} placeholder="Reorder at" className={`${smallFieldClass} w-full text-sm tabular-nums`} />
                  <input inputMode="decimal" value={levels[outlet.id]?.parLevel ?? ""} onChange={(event) => setLevels((rows) => ({ ...rows, [outlet.id]: { ...rows[outlet.id], parLevel: event.target.value.replace(/[^\d.]/g, "") } }))} placeholder="Par" className={`${smallFieldClass} w-full text-sm tabular-nums`} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Check, Library, Loader2, Search, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import ModalFrame from "../../../_components/NrmsModalFrame";
import { STOCK_CATEGORY_LABELS, apiError, categoryTone, formatStockQuantity, unitShort } from "../../../_components/stockFormat";
import { CATALOGUE_CATEGORY_ORDER, STARTER_CATALOGUE, type CatalogueGood } from "./stockCatalogue";
import { primaryButton, quietButton } from "./ui";

type Scope = "ALL" | string;

/**
 * Pick many common goods at once. Already-added names show as added and
 * cannot be picked again; the API skips duplicates as well.
 */
export default function StarterCatalogueModal({ propertyId, existingNames, onClose, onAdded }: {
  propertyId: number;
  existingNames: Set<string>;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdded = (good: CatalogueGood) => existingNames.has(good.name.toLowerCase());
  const q = query.trim().toLowerCase();

  const categories = useMemo(() => {
    const present = [...new Set(STARTER_CATALOGUE.map((good) => good.category))];
    return present.sort((a, b) => {
      const ai = CATALOGUE_CATEGORY_ORDER.indexOf(a);
      const bi = CATALOGUE_CATEGORY_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, []);

  /** category -> group -> goods, filtered by search and the category chip. */
  const sections = useMemo(() => categories
    .filter((category) => scope === "ALL" || category === scope)
    .map((category) => {
      const groups = new Map<string, CatalogueGood[]>();
      for (const good of STARTER_CATALOGUE) {
        if (good.category !== category) continue;
        if (q && !good.name.toLowerCase().includes(q) && !good.group.toLowerCase().includes(q)) continue;
        const list = groups.get(good.group) ?? [];
        list.push(good);
        groups.set(good.group, list);
      }
      return { category, groups: [...groups.entries()] };
    })
    .filter((section) => section.groups.length > 0), [categories, scope, q]);

  const visibleGoods = sections.flatMap((section) => section.groups.flatMap(([, goods]) => goods));
  const pickableVisible = visibleGoods.filter((good) => !isAdded(good));

  const toggle = (name: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const setMany = (goods: CatalogueGood[], on: boolean) => setSelected((current) => {
    const next = new Set(current);
    for (const good of goods) {
      if (isAdded(good)) continue;
      if (on) next.add(good.name); else next.delete(good.name);
    }
    return next;
  });
  const allOn = (goods: CatalogueGood[]) => {
    const pickable = goods.filter((good) => !isAdded(good));
    return pickable.length > 0 && pickable.every((good) => selected.has(good.name));
  };

  const categoryStats = (category: string) => {
    const goods = STARTER_CATALOGUE.filter((good) => good.category === category);
    return { total: goods.length, picked: goods.filter((good) => selected.has(good.name)).length };
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const items = STARTER_CATALOGUE.filter((good) => selected.has(good.name)).map((good) => ({
        name: good.name,
        category: good.category,
        baseUnit: good.baseUnit,
        countStyle: good.countStyle ?? (good.baseUnit === "G" || good.baseUnit === "ML" ? "PARTIAL" : "WHOLE"),
        perishable: Boolean(good.perishable),
        shelfLifeDays: good.shelfLifeDays ?? null,
        packUnits: good.packUnits,
      }));
      const res = await apiClient.post<{ created: number[]; skipped: string[] }>(`/api/nrms/stock/property/${propertyId}/items/bulk`, { items });
      onAdded(res.data.created.length);
    } catch (cause) {
      setError(apiError(cause, "Could not add the goods"));
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) => `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${active ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700 hover:border-brand/50"}`;

  return (
    <ModalFrame
      title="Starter catalogue"
      subtitle={`${STARTER_CATALOGUE.length} common goods for Tanzanian hotels, restaurants and bars, with the packs they come in`}
      icon={<Library className="h-5 w-5" />}
      onClose={onClose}
      extraWide
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm text-neutral-500">
            <strong className="text-neutral-800">{selected.size} selected.</strong> Names and packs can be edited after adding.
            {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="border-0 bg-transparent p-0 text-sm font-bold text-red-700 [font-family:inherit] hover:underline">Clear selection</button>}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-10 rounded-lg border border-solid border-neutral-300 bg-white px-4 text-[15px] font-bold text-neutral-700 [font-family:inherit] hover:bg-neutral-50">Cancel</button>
            <button type="button" disabled={busy || selected.size === 0} onClick={() => void submit()} className={`${primaryButton} !h-10 px-4 text-[15px]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add {selected.size || ""} goods</button>
          </div>
        </div>
      )}
    >
      <div className="sticky -top-1 z-10 -mx-1 space-y-3 bg-white px-1 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by brand, size or type: Jack Daniel's, 1 L, gin, tilapia" className="[font-family:inherit] box-border h-10 w-full rounded-lg border border-solid border-neutral-300 bg-white pl-9 pr-9 text-[15px] outline-none focus:border-brand" />
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:text-neutral-700"><X className="h-4 w-4" /></button>}
          </div>
          <button type="button" disabled={pickableVisible.length === 0} onClick={() => setMany(pickableVisible, !allOn(pickableVisible))} className={quietButton}>
            {allOn(pickableVisible) ? "Clear all shown" : `Select all shown (${pickableVisible.length})`}
          </button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button type="button" onClick={() => setScope("ALL")} className={chip(scope === "ALL")}>All <span className={scope === "ALL" ? "text-white/80" : "text-neutral-400"}>{STARTER_CATALOGUE.length}</span></button>
          {categories.map((category) => {
            const stats = categoryStats(category);
            return (
              <button key={category} type="button" onClick={() => setScope(category)} className={scope === category ? `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-solid px-3 text-[13px] font-bold [font-family:inherit] transition ${categoryTone(category).chip}` : chip(false)}>
                {scope !== category && <span className={`h-2 w-2 rounded-full ${categoryTone(category).dot}`} aria-hidden />}
                {STOCK_CATEGORY_LABELS[category] ?? category}
                <span className={scope === category ? "text-white/80" : "text-neutral-400"}>{stats.total}</span>
                {stats.picked > 0 && <span className={`rounded-full px-1.5 text-xs ${scope === category ? "bg-white text-neutral-900" : `${categoryTone(category).dot} text-white`}`}>{stats.picked}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {sections.map(({ category, groups }) => {
          const categoryGoods = groups.flatMap(([, goods]) => goods);
          const tone = categoryTone(category);
          const picked = categoryGoods.filter((good) => selected.has(good.name)).length;
          return (
            <section key={category} className={`overflow-hidden rounded-2xl border border-solid bg-white ${tone.border}`}>
              <div className={`flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid px-4 py-3 ${tone.border}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone.tile}`}><span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} /></span>
                  <p className={`m-0 text-[15px] font-bold ${tone.text}`}>{STOCK_CATEGORY_LABELS[category] ?? category}</p>
                  <span className="text-sm font-semibold text-neutral-400">{categoryGoods.length}</span>
                  {picked > 0 && <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${tone.dot}`}>{picked} selected</span>}
                </div>
                {categoryGoods.some((good) => !isAdded(good)) && <button type="button" onClick={() => setMany(categoryGoods, !allOn(categoryGoods))} className={quietButton}>{allOn(categoryGoods) ? "Clear category" : "Select category"}</button>}
              </div>
              <div className="space-y-4 p-4">
                {groups.map(([group, goods]) => (
                  <div key={group}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="m-0 text-[13px] font-bold text-neutral-500">{group}</p>
                      {goods.some((good) => !isAdded(good)) && (
                        <button type="button" onClick={() => setMany(goods, !allOn(goods))} className={`border-0 bg-transparent p-0 text-[13px] font-bold [font-family:inherit] hover:underline ${tone.text}`}>{allOn(goods) ? "Clear" : "Select all"}</button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {goods.map((good) => {
                        const added = isAdded(good);
                        const on = selected.has(good.name);
                        return (
                          <button
                            key={good.name}
                            type="button"
                            disabled={added}
                            onClick={() => toggle(good.name)}
                            className={`flex items-start gap-2.5 rounded-xl border border-solid p-3 text-left [font-family:inherit] transition ${added ? "cursor-default border-neutral-200 bg-neutral-50" : on ? tone.picked : "border-neutral-300 bg-white hover:border-neutral-400"}`}
                          >
                            <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 border-solid ${added ? "border-neutral-300 bg-neutral-300 text-white" : on ? `${tone.check} text-white` : "border-neutral-400 bg-white"}`}>{(on || added) && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                            <span className="min-w-0">
                              <span className={`block truncate text-sm font-bold ${added ? "text-neutral-400" : "text-neutral-900"}`}>{good.name}</span>
                              <span className="mt-0.5 block truncate text-xs text-neutral-500">
                                {added ? "Already in your stock items" : `Counted in ${unitShort(good.baseUnit)}${good.packUnits.length ? ` · ${good.packUnits.map((pack) => `${pack.name} (${formatStockQuantity(pack.baseQuantity, good.baseUnit)})`).join(", ")}` : ""}${good.perishable ? " · perishable" : ""}`}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {sections.length === 0 && <p className="m-0 py-10 text-center text-sm text-neutral-500">Nothing matches &quot;{query}&quot;. Close this and use Add stock item to create it yourself.</p>}
      </div>
      {error && <p className="mb-0 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </ModalFrame>
  );
}

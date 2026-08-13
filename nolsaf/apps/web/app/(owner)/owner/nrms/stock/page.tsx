"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Package, PackageX, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type StockItem = { id: number; name: string; category: string | null; price: number; inStock: boolean; stockQuantity: number | null; lowStockThreshold: number };
type StockOutlet = { id: number; name: string; type: string; items: StockItem[]; outCount: number; lowCount: number };
type StockState = { canManageStock: boolean; outlets: StockOutlet[] };

type Tone = "ok" | "low" | "out";
function itemTone(item: StockItem): Tone {
  if (!item.inStock) return "out";
  if (item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold) return "low";
  return "ok";
}
const TONE_STYLE: Record<Tone, { pill: string; dot: string; label: (item: StockItem) => string }> = {
  ok: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: (item) => (item.stockQuantity != null ? `In stock · ${item.stockQuantity} left` : "In stock") },
  low: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500", label: (item) => `Running low · ${item.stockQuantity} left` },
  out: { pill: "bg-red-50 text-red-700", dot: "bg-red-500", label: () => "Out of stock" },
};

// The left rail identifies the category so a screen of in-stock items is still
// readable at a glance (status lives in the pill, not the rail). Common drink
// groups get a fixed colour; anything else is hashed to a stable one.
const CATEGORY_PALETTE = ["bg-violet-500", "bg-teal-500", "bg-rose-500", "bg-sky-500", "bg-lime-500", "bg-fuchsia-500", "bg-indigo-500", "bg-orange-500"];
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/alco|spirit|liquor|whisk|vodka|gin|\brum\b|brandy|tequila|cocktail/, "bg-blue-500"],
  [/wine|champagne/, "bg-rose-500"],
  [/beer|lager|cider|ale/, "bg-amber-500"],
  [/water/, "bg-cyan-500"],
  [/soft|soda|juice|drink|mineral|mocktail|smoothie/, "bg-emerald-500"],
  [/coffee|tea|\bhot\b/, "bg-orange-500"],
  [/food|snack|kitchen|meal|grill|bite|starter|main|dessert/, "bg-red-500"],
];
function categoryColor(name: string | null): string {
  const key = (name || "uncategorised").toLowerCase();
  for (const [pattern, cls] of CATEGORY_KEYWORDS) if (pattern.test(key)) return cls;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

export default function NrmsStockPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [data, setData] = useState<StockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});

  const currency = selectedProperty?.currency ?? "TZS";
  const money = (value: number) => `${Math.round(value).toLocaleString()} ${currency}`;

  const load = useCallback(async (silent = false) => {
    if (!selectedPropertyId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<StockState>(`/api/nrms/operations/property/${selectedPropertyId}/stock`);
      setData(res.data);
      // A background refresh must not clobber an item someone is mid-typing.
      if (!silent) setQtyDrafts({});
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load stock");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    void load();
    // Stock and its status are shared across every attendant and the owner;
    // poll so a change made elsewhere shows up here without a manual refresh.
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const applyItemPatch = (itemId: number, patch: Partial<StockItem>) => {
    setData((current) => current && ({
      ...current,
      outlets: current.outlets.map((outlet) => {
        const items = outlet.items.map((row) => (row.id === itemId ? { ...row, ...patch } : row));
        return {
          ...outlet,
          items,
          outCount: items.filter((row) => !row.inStock).length,
          lowCount: items.filter((row) => row.inStock && row.stockQuantity != null && row.stockQuantity <= row.lowStockThreshold).length,
        };
      }),
    }));
  };

  const saveStock = async (item: StockItem, body: { inStock?: boolean; stockQuantity?: number | null }) => {
    if (!data?.canManageStock) return;
    setBusyId(item.id); setError(null);
    try {
      const res = await apiClient.patch<{ item: { id: number; inStock: boolean; stockQuantity: number | null; lowStockThreshold: number } }>(`/api/nrms/operations/menu-items/${item.id}/stock`, body);
      applyItemPatch(item.id, res.data.item);
      setQtyDrafts((current) => { const next = { ...current }; delete next[item.id]; return next; });
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not update stock");
    } finally {
      setBusyId(null);
    }
  };

  const commitQuantity = (item: StockItem) => {
    const draft = qtyDrafts[item.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : Math.max(0, Math.floor(Number(trimmed)));
    if (next === item.stockQuantity) { setQtyDrafts((current) => { const copy = { ...current }; delete copy[item.id]; return copy; }); return; }
    void saveStock(item, { stockQuantity: next });
  };

  const adjust = (item: StockItem, delta: number) => {
    const base = item.stockQuantity ?? 0;
    void saveStock(item, { stockQuantity: Math.max(0, base + delta) });
  };

  const outlets = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.outlets.map((outlet) => {
      const items = outlet.items.filter((item) => {
        const attention = itemTone(item) !== "ok";
        return (!attentionOnly || attention) && (!q || item.name.toLowerCase().includes(q) || (item.category ?? "").toLowerCase().includes(q));
      });
      const groups = new Map<string, StockItem[]>();
      for (const item of items) {
        const key = item.category || "Uncategorised";
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
      }
      return { ...outlet, groups: [...groups.entries()] };
    });
  }, [data, query, attentionOnly]);

  const totalOut = useMemo(() => (data?.outlets ?? []).reduce((sum, outlet) => sum + outlet.outCount, 0), [data]);
  const totalLow = useMemo(() => (data?.outlets ?? []).reduce((sum, outlet) => sum + outlet.lowCount, 0), [data]);

  return (
    <div className="mx-auto max-w-[1080px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Stock</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Stock"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Set the quantity you hold and every sale counts it down. At zero the item goes out of stock on its own until you restock it. Leave quantity empty for items you do not count.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryTile icon={Package} label="Items in stock" value={(data?.outlets ?? []).reduce((sum, o) => sum + o.items.filter((i) => i.inStock && itemTone(i) === "ok").length, 0)} tone="ok" />
        <SummaryTile icon={TriangleAlert} label="Running low" value={totalLow} tone="low" />
        <SummaryTile icon={PackageX} label="Out of stock" value={totalOut} tone="out" />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an item or category" className="box-border h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-emerald-600" />
        </div>
        <button type="button" onClick={() => setAttentionOnly((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${attentionOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>
          <TriangleAlert className="h-4 w-4" />Needs attention only
        </button>
      </div>

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <div className={loading ? "space-y-4 opacity-60 transition" : "space-y-4 transition"}>
          {outlets.map((outlet) => (
            <section key={outlet.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50/60 px-4 py-3">
                <p className="m-0 flex items-center gap-2 text-[13px] font-bold text-neutral-900"><Package className="h-4 w-4 text-emerald-700" />{outlet.name}<span className="text-[10px] font-normal uppercase tracking-wide text-neutral-400">{outlet.type.toLowerCase()}</span></p>
                <span className="flex items-center gap-1.5">
                  {outlet.lowCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{outlet.lowCount} low</span>}
                  {outlet.outCount > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{outlet.outCount} out</span>}
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_120px_150px_150px_60px] items-center gap-3 border-b border-neutral-100 px-4 py-2 text-[9px] font-bold uppercase tracking-wide text-neutral-400">
                    <span>Item</span><span className="text-right">Price</span><span className="text-center">Quantity</span><span>Status</span><span className="text-right">On</span>
                  </div>

                  {outlet.groups.length === 0 ? (
                    <p className="m-0 px-4 py-8 text-center text-xs text-neutral-400">No items match.</p>
                  ) : outlet.groups.map(([category, items]) => (
                    <div key={category}>
                      <p className="m-0 flex items-center gap-1.5 bg-neutral-50/50 px-4 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400"><span className={`h-1.5 w-1.5 rounded-full ${categoryColor(category)}`} aria-hidden />{category}</p>
                      {items.map((item) => {
                        const tone = itemTone(item);
                        const style = TONE_STYLE[tone];
                        const tracked = item.stockQuantity != null || qtyDrafts[item.id] !== undefined;
                        const disabled = !data.canManageStock || busyId === item.id;
                        return (
                          <div key={item.id} className="group grid grid-cols-[minmax(0,1fr)_120px_150px_150px_60px] items-center gap-3 border-b border-neutral-100 px-4 py-2.5 transition last:border-b-0 hover:bg-neutral-50/70">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={`h-7 w-1 shrink-0 rounded-full ${categoryColor(item.category)}`} aria-hidden />
                              <span className={`truncate text-[13px] font-bold ${item.inStock ? "text-neutral-900" : "text-neutral-400 line-through"}`}>{item.name}</span>
                            </div>
                            <span className="text-right text-xs tabular-nums text-neutral-600">{money(item.price)}</span>
                            <div className="flex items-center justify-center gap-1">
                              <button type="button" aria-label="Reduce quantity" disabled={disabled || (item.stockQuantity ?? 0) <= 0} onClick={() => adjust(item, -1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                              <input
                                inputMode="numeric"
                                value={qtyDrafts[item.id] ?? (item.stockQuantity == null ? "" : String(item.stockQuantity))}
                                onChange={(event) => setQtyDrafts((current) => ({ ...current, [item.id]: event.target.value.replace(/[^\d]/g, "") }))}
                                onBlur={() => commitQuantity(item)}
                                onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                                placeholder="—"
                                disabled={disabled}
                                aria-label={`Quantity of ${item.name}`}
                                className="box-border h-7 w-14 rounded-md border border-neutral-200 bg-white px-1 text-center text-xs font-bold tabular-nums text-neutral-800 outline-none focus:border-emerald-500 disabled:bg-neutral-50"
                              />
                              <button type="button" aria-label="Add quantity" disabled={disabled} onClick={() => adjust(item, 1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                            </div>
                            <div>
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${style.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />{tracked ? style.label(item) : (item.inStock ? "In stock" : "Out of stock")}</span>
                            </div>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={item.inStock}
                                aria-label={`${item.name} ${item.inStock ? "in stock" : "out of stock"}`}
                                disabled={disabled}
                                onClick={() => void saveStock(item, { inStock: !item.inStock })}
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${item.inStock ? "bg-emerald-600" : "bg-neutral-300"}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${item.inStock ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}
          {!data.canManageStock && <p className="text-center text-[11px] text-neutral-400">You can view availability but only serving staff and managers can change it.</p>}
          {outlets.length === 0 && <p className="text-center text-xs text-neutral-400">No outlets to show.</p>}
        </div>
      ) : null}
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value, tone }: { icon: typeof Package; label: string; value: number; tone: Tone }) {
  const color = tone === "ok" ? "text-emerald-700 bg-emerald-50" : tone === "low" ? "text-amber-700 bg-amber-50" : "text-red-700 bg-red-50";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0">
        <p className="m-0 text-xl font-bold leading-none text-neutral-950">{value}</p>
        <p className="mb-0 mt-1 truncate text-[10px] text-neutral-500">{label}</p>
      </div>
    </div>
  );
}

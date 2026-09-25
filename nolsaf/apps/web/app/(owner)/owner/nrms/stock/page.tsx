"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Boxes, CheckCircle2, Link2, Loader2, Minus, Package, PackageX, Plus, RefreshCw, Search, Store, TriangleAlert, UtensilsCrossed, Wine } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";
import StockGoodsPanel from "../_components/StockGoodsPanel";
import { useNrmsAccessRole } from "../_components/NrmsAccessRole";
import { Pill, cardClass, outlineButton, quietButton, smallFieldClass } from "./items/_components/ui";

type StockItem = { id: number; name: string; category: string | null; price: number; inStock: boolean; stockQuantity: number | null; lowStockThreshold: number; linked?: boolean };
type StockOutlet = { id: number; name: string; type: string; items: StockItem[]; outCount: number; lowCount: number };
type StockState = { canManageStock: boolean; outlets: StockOutlet[] };

type Tone = "ok" | "low" | "out";
function itemTone(item: StockItem): Tone {
  if (!item.inStock) return "out";
  if (item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold) return "low";
  return "ok";
}
function toneLabel(item: StockItem, tracked: boolean): string {
  const tone = itemTone(item);
  if (tone === "out") return "Out of stock";
  if (tone === "low") return `Running low · ${item.stockQuantity} left`;
  return tracked && item.stockQuantity != null ? `In stock · ${item.stockQuantity} left` : "In stock";
}

// A dot per menu category so a long list stays readable. Common drink groups
// get a fixed colour; anything else is hashed to a stable one.
const CATEGORY_PALETTE = ["bg-violet-500", "bg-teal-500", "bg-rose-500", "bg-sky-500", "bg-lime-500", "bg-fuchsia-500", "bg-indigo-500", "bg-orange-500"];
const CATEGORY_KEYWORDS: Array<[RegExp, string]> = [
  [/alco|spirit|liquor|whisk|vodka|gin|\brum\b|brandy|tequila|cocktail/, "bg-violet-500"],
  [/wine|champagne/, "bg-rose-500"],
  [/beer|lager|cider|ale/, "bg-amber-500"],
  [/water/, "bg-sky-500"],
  [/soft|soda|juice|drink|mineral|mocktail|smoothie/, "bg-orange-500"],
  [/coffee|tea|\bhot\b/, "bg-stone-500"],
  [/food|snack|kitchen|meal|grill|bite|starter|main|dessert/, "bg-red-500"],
];
function categoryColor(name: string | null): string {
  const key = (name || "uncategorised").toLowerCase();
  for (const [pattern, cls] of CATEGORY_KEYWORDS) if (pattern.test(key)) return cls;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}

type StockView = "goods" | "menu";
const VIEW_KEY = "nolsaf:nrms-stock-view";

/**
 * Two views of one question. "Goods on hand" is the physical stock (bottles,
 * kilos) with its ledger; "Menu availability" is what guests can order right
 * now, which serving staff switch on and off mid-service.
 */
export default function NrmsStockPage() {
  const { selectedPropertyId } = useNrms();
  const { accessRole } = useNrmsAccessRole();
  // The storekeeper handles goods only; the menu board is the serving floor's.
  const menuAllowed = accessRole !== "STOREKEEPER";
  const canSetUp = accessRole === "OWNER" || accessRole === "MANAGER";
  const [view, setView] = useState<StockView>("goods");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "menu" || saved === "goods") setView(saved);
    } catch { /* storage unavailable: keep the default */ }
  }, []);
  const choose = (next: StockView) => {
    setView(next);
    try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* ignore */ }
  };
  const activeView: StockView = menuAllowed ? view : "goods";

  const tabs: Array<[StockView, string, typeof Boxes, string]> = [
    ["goods", "Goods on hand", Boxes, "The goods on each outlet's shelf. Deliveries add to it, every sale takes from it, and each change keeps who and when."],
    ["menu", "Menu availability", UtensilsCrossed, "What guests can order right now. Switch an item off when it runs out; items linked to stock switch themselves."],
  ];
  const visibleTabs = tabs.filter(([key]) => key === "goods" || menuAllowed);
  const description = tabs.find(([key]) => key === activeView)?.[3] ?? "";

  return (
    <div className="w-full min-w-0 space-y-4 pb-10">
      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"><Package className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-2xl font-bold tracking-tight text-neutral-950">Stock</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-neutral-500">{description}</p>
            </div>
          </div>
          {canSetUp && (
            <Link href="/owner/nrms/stock/items" className={`${outlineButton} no-underline hover:no-underline`}><BookOpen className="h-4 w-4" />Stock items & recipes</Link>
          )}
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto border-0 border-t border-solid border-neutral-100 px-2 sm:px-4" role="tablist" aria-label="Stock view">
          {visibleTabs.map(([key, label, Icon]) => {
            const active = activeView === key;
            return (
              <button key={key} type="button" role="tab" aria-selected={active} onClick={() => choose(key)} className={`-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-bold [font-family:inherit] transition ${active ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            );
          })}
        </nav>
      </section>

      {selectedPropertyId && activeView === "goods" && <StockGoodsPanel propertyId={selectedPropertyId} />}
      {activeView === "menu" && <MenuAvailabilityBoard onOpenGoods={() => choose("goods")} />}
    </div>
  );
}

function MenuAvailabilityBoard({ onOpenGoods }: { onOpenGoods: () => void }) {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [data, setData] = useState<StockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [outletFilter, setOutletFilter] = useState<number | "all">("all");
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
    // Order and stock mutations refresh immediately through the shared event.
    // The minute timer is only a fallback for changes from another device.
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const refreshTimer = window.setInterval(refresh, 60_000);
    window.addEventListener("nrms-attention-refresh", refresh);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("nrms-attention-refresh", refresh);
    };
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
    return data.outlets
      .filter((outlet) => outletFilter === "all" || outlet.id === outletFilter)
      .map((outlet) => {
        const items = outlet.items.filter((item) => {
          const attention = itemTone(item) !== "ok";
          return (!attentionOnly || attention) && (!q || item.name.toLowerCase().includes(q) || (item.category ?? "").toLowerCase().includes(q));
        });
        const groups = new Map<string, StockItem[]>();
        for (const item of items) {
          const key = item.category || "Uncategorised";
          (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
        }
        return { ...outlet, groups: [...groups.entries()], shown: items.length };
      });
  }, [data, query, attentionOnly, outletFilter]);

  const allItems = useMemo(() => (data?.outlets ?? []).flatMap((outlet) => outlet.items), [data]);
  const totalOut = allItems.filter((item) => itemTone(item) === "out").length;
  const totalLow = allItems.filter((item) => itemTone(item) === "low").length;
  const totalIn = allItems.length - totalOut - totalLow;
  const totalLinked = allItems.filter((item) => item.linked).length;

  const stats = [
    { icon: CheckCircle2, label: "On sale now", value: totalIn, tone: "text-brand" },
    { icon: TriangleAlert, label: "Running low", value: totalLow, tone: "text-amber-600" },
    { icon: PackageX, label: "Out of stock", value: totalOut, tone: "text-red-600" },
    { icon: Link2, label: "Linked to goods", value: totalLinked, tone: "text-sky-600" },
  ];

  const gridCols = "grid-cols-[minmax(0,1fr)_110px_160px_190px_64px]";

  return (
    <div className="space-y-4">
      <div className={`${cardClass} grid grid-cols-2 gap-px overflow-hidden bg-neutral-100 lg:grid-cols-4`}>
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
            <stat.icon className={`h-4 w-4 shrink-0 ${stat.tone}`} />
            <div className="min-w-0">
              <p className="m-0 text-xl font-bold leading-tight tabular-nums text-neutral-950">{stat.value}</p>
              <p className="m-0 truncate text-[13px] text-neutral-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an item or category" className={`${smallFieldClass} w-full pl-9 text-sm`} />
        </div>
        {(data?.outlets.length ?? 0) > 1 && (
          <select value={outletFilter} onChange={(event) => setOutletFilter(event.target.value === "all" ? "all" : Number(event.target.value))} className={`${smallFieldClass} text-sm font-semibold`}>
            <option value="all">All outlets</option>
            {data!.outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
          </select>
        )}
        <button type="button" onClick={() => setAttentionOnly((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border border-solid px-3 text-sm font-bold [font-family:inherit] transition ${attentionOnly ? "border-amber-400 bg-amber-50 text-amber-800" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}>
          <TriangleAlert className="h-4 w-4" />Needs attention
        </button>
        <button type="button" onClick={() => void load()} className={`${quietButton} h-9 px-3 text-sm`}><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-[15px] text-red-700">{error}</div>}

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <div className={loading ? "space-y-4 opacity-60 transition" : "space-y-4 transition"}>
          {outlets.map((outlet) => (
            <section key={outlet.id} className={`${cardClass} overflow-hidden`}>
              <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">{outlet.type === "BAR" ? <Wine className="h-4 w-4" /> : outlet.type === "RESTAURANT" ? <UtensilsCrossed className="h-4 w-4" /> : <Store className="h-4 w-4" />}</span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-[15px] font-bold text-neutral-950">{outlet.name}</p>
                    <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{outlet.type === "BAR" ? "Bar" : outlet.type === "RESTAURANT" ? "Restaurant" : "Outlet"} · {outlet.items.length} menu {outlet.items.length === 1 ? "item" : "items"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {outlet.lowCount > 0 && <Pill tone="low">{outlet.lowCount} low</Pill>}
                  {outlet.outCount > 0 && <Pill tone="out">{outlet.outCount} out</Pill>}
                  {outlet.lowCount === 0 && outlet.outCount === 0 && <Pill tone="ok">All on sale</Pill>}
                </div>
              </header>

              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className={`grid ${gridCols} items-center gap-3 bg-neutral-50/80 px-4 py-2 text-xs font-bold uppercase tracking-wide text-neutral-500 sm:px-5`}>
                    <span>Item</span><span className="text-right">Price</span><span className="text-center">Quantity</span><span>Status</span><span className="text-right">On sale</span>
                  </div>

                  {outlet.groups.length === 0 ? (
                    <p className="m-0 px-4 py-8 text-center text-sm text-neutral-400">{query || attentionOnly ? "No items match." : "No menu items at this outlet yet."}</p>
                  ) : outlet.groups.map(([category, items]) => (
                    <div key={category}>
                      <p className="m-0 flex items-center gap-2 border-0 border-t border-solid border-neutral-100 px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.14em] text-neutral-500 sm:px-5">
                        <span className={`h-2 w-2 rounded-full ${categoryColor(category)}`} aria-hidden />{category}<span className="font-semibold normal-case tracking-normal text-neutral-400">{items.length}</span>
                      </p>
                      {items.map((item) => {
                        const tone = itemTone(item);
                        const tracked = item.stockQuantity != null || qtyDrafts[item.id] !== undefined;
                        const disabled = !data.canManageStock || busyId === item.id;
                        return (
                          <div key={item.id} className={`grid ${gridCols} items-center gap-3 px-4 py-2 transition hover:bg-neutral-50/70 sm:px-5`}>
                            <div className="flex min-w-0 items-center gap-2">
                              <span className={`truncate text-[15px] font-bold ${item.inStock ? "text-neutral-900" : "text-neutral-400 line-through"}`}>{item.name}</span>
                              {busyId === item.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />}
                            </div>
                            <span className="text-right text-sm tabular-nums text-neutral-600">{money(item.price)}</span>
                            {item.linked ? (
                              // Quantity lives on the goods behind this item (Goods on hand).
                              <div className="flex justify-center">
                                <button type="button" onClick={onOpenGoods} title="This item draws from stock items. Record deliveries under Goods on hand." className="inline-flex items-center gap-1 rounded-full border-0 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-700 [font-family:inherit] hover:bg-sky-100"><Link2 className="h-3 w-3" />From stock</button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <button type="button" aria-label="Reduce quantity" disabled={disabled || (item.stockQuantity ?? 0) <= 0} onClick={() => adjust(item, -1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                                <input
                                  inputMode="numeric"
                                  value={qtyDrafts[item.id] ?? (item.stockQuantity == null ? "" : String(item.stockQuantity))}
                                  onChange={(event) => setQtyDrafts((current) => ({ ...current, [item.id]: event.target.value.replace(/[^\d]/g, "") }))}
                                  onBlur={() => commitQuantity(item)}
                                  onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                                  placeholder="-"
                                  disabled={disabled}
                                  aria-label={`Quantity of ${item.name}`}
                                  className="box-border h-7 w-14 rounded-md border border-solid border-neutral-300 bg-white px-1 text-center text-sm font-bold tabular-nums text-neutral-800 outline-none [font-family:inherit] focus:border-brand disabled:bg-neutral-50"
                                />
                                <button type="button" aria-label="Add quantity" disabled={disabled} onClick={() => adjust(item, 1)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                              </div>
                            )}
                            <div><Pill tone={tone}>{toneLabel(item, tracked)}</Pill></div>
                            <div className="flex justify-end">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={item.inStock}
                                aria-label={`${item.name} ${item.inStock ? "on sale" : "off sale"}`}
                                disabled={disabled}
                                onClick={() => void saveStock(item, { inStock: !item.inStock })}
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-0 transition disabled:opacity-50 ${item.inStock ? "bg-brand" : "bg-neutral-300"}`}
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
          {!data.canManageStock && <p className="m-0 text-center text-[13px] text-neutral-400">You can view availability but only serving staff and managers can change it.</p>}
          {outlets.length === 0 && <p className="m-0 text-center text-sm text-neutral-400">No outlets to show.</p>}
        </div>
      ) : null}
    </div>
  );
}

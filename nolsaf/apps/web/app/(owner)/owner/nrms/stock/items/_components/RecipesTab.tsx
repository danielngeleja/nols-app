"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Library, Link2, Loader2, PackagePlus, Plus, Search, Sparkles, Trash2, Unlink } from "lucide-react";
import apiClient from "@/lib/apiClient";
import type { StockGood } from "../../../_components/StockGoodsPanel";
import { apiError, formatMoney, formatStockQuantity, unitShort } from "../../../_components/stockFormat";
import type { RecipeMenuItem, StockWorkspace } from "./useStockWorkspace";
import { EmptyState, Pill, cardClass, outlineButton, primaryButton, quietButton, smallFieldClass } from "./ui";

type ListFilter = "all" | "unlinked" | "linked" | "low";

function normalise(value: string): string {
  return value.toLowerCase().replace(/\b\d+(\.\d+)?\s?(ml|l|cl|g|kg)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A menu item and a good that are obviously the same product: equal names once
 * sizes and punctuation are ignored, or the good's name starts with the menu
 * name ("Kilimanjaro" on the menu, "Kilimanjaro Premium Lager 500 ml" in stock).
 * Only WHOLE goods qualify, since a one-to-one link means one unit per sale.
 */
function findMatch(menuName: string, goods: StockGood[]): StockGood | null {
  const menu = normalise(menuName);
  if (menu.length < 3) return null;
  const whole = goods.filter((good) => good.status === "ACTIVE" && good.countStyle === "WHOLE" && good.baseUnit !== "G" && good.baseUnit !== "ML");
  const exact = whole.filter((good) => normalise(good.name) === menu);
  if (exact.length === 1) return exact[0];
  const prefix = whole.filter((good) => normalise(good.name).startsWith(`${menu} `) || normalise(good.name) === menu);
  return prefix.length === 1 ? prefix[0] : null;
}

type LineDraft = { stockItemId: number | ""; quantity: string; yieldPercent: string };

export default function RecipesTab({ workspace, onAddItem, onCatalogue }: { workspace: StockWorkspace; onAddItem?: () => void; onCatalogue?: () => void }) {
  const overview = workspace.overview!;
  const outlets = useMemo(() => workspace.recipes ?? [], [workspace.recipes]);
  const goods = useMemo(() => overview.items.filter((good) => good.status === "ACTIVE"), [overview.items]);
  const goodById = useMemo(() => new Map(goods.map((good) => [good.id, good])), [goods]);
  const [outletId, setOutletId] = useState<number | null>(outlets[0]?.id ?? null);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [quickFor, setQuickFor] = useState<number | null>(null);
  const [quickGood, setQuickGood] = useState<number | "">("");
  const [quickQty, setQuickQty] = useState("1");
  const [quickBusy, setQuickBusy] = useState<number | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  useEffect(() => { if (outletId == null && outlets[0]) setOutletId(outlets[0].id); }, [outlets, outletId]);

  const outlet = outlets.find((row) => row.id === outletId) ?? null;
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (outlet?.menuItems ?? []).filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false;
      if (filter === "unlinked") return item.lines.length === 0;
      if (filter === "linked") return item.lines.length > 0;
      if (filter === "low") return item.marginPercent != null && item.marginPercent < 50;
      return true;
    });
  }, [outlet, filter, query]);
  const selected = outlet?.menuItems.find((item) => item.id === selectedId) ?? null;

  const suggestions = useMemo(() => outlets.flatMap((row) => row.menuItems
    .filter((item) => item.lines.length === 0)
    .map((item) => ({ item, outletName: row.name, good: findMatch(item.name, goods) }))
    .filter((row): row is { item: RecipeMenuItem; outletName: string; good: StockGood } => row.good != null)), [outlets, goods]);

  const suggestionByItem = useMemo(() => new Map(suggestions.map((row) => [row.item.id, row.good])), [suggestions]);

  const openQuick = (item: RecipeMenuItem) => {
    const suggestion = suggestionByItem.get(item.id);
    setQuickFor(item.id);
    setQuickGood(suggestion?.id ?? "");
    setQuickQty("1");
    setQuickError(null);
  };

  /** Link a menu item to one good in a single step, without the full editor. */
  const quickLink = async (item: RecipeMenuItem, stockItemId: number, quantity: number) => {
    setQuickBusy(item.id);
    setQuickError(null);
    try {
      await apiClient.put(`/api/nrms/stock/menu-items/${item.id}/recipe`, { lines: [{ stockItemId, quantity, yieldPercent: 100 }] });
      setQuickFor(null);
      await workspace.reload();
    } catch (cause) {
      setQuickError(apiError(cause, "Could not link this item"));
    } finally {
      setQuickBusy(null);
    }
  };

  const linkSuggestions = async () => {
    setMatching(true);
    setMatchMessage(null);
    let done = 0;
    for (const { item, good } of suggestions) {
      try {
        await apiClient.put(`/api/nrms/stock/menu-items/${item.id}/recipe`, { lines: [{ stockItemId: good.id, quantity: 1, yieldPercent: 100 }] });
        done += 1;
      } catch { /* one failure must not stop the rest; the count below says how many landed */ }
    }
    setMatchMessage(`${done} of ${suggestions.length} menu items linked.`);
    setMatching(false);
    await workspace.reload();
  };

  if (outlets.length === 0) {
    return <div className={cardClass}><EmptyState icon={BookOpen} title="No menu yet" body="Add an outlet and its menu under Outlets & menus, then link each item to the goods it uses." /></div>;
  }

  return (
    <div className="space-y-4">
      {goods.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="m-0 text-sm text-amber-900">Add stock items first, then come back to say what each menu item uses.</p>
          <div className="flex flex-wrap gap-2">
            {onCatalogue && <button type="button" onClick={onCatalogue} className={outlineButton}><Library className="h-4 w-4" />Starter catalogue</button>}
            {onAddItem && <button type="button" onClick={onAddItem} className={primaryButton}><PackagePlus className="h-4 w-4" />Add stock item</button>}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className={`${cardClass} flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5`}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[15px] font-bold text-neutral-900">{suggestions.length} menu {suggestions.length === 1 ? "item matches" : "items match"} a stock item by name</p>
              <p className="m-0 mt-0.5 truncate text-[13px] text-neutral-500">{suggestions.slice(0, 3).map((row) => `${row.item.name} → ${row.good.name}`).join(" · ")}{suggestions.length > 3 ? " …" : ""}</p>
            </div>
          </div>
          <button type="button" disabled={matching} onClick={() => void linkSuggestions()} className={primaryButton}>{matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Link all one to one</button>
        </div>
      )}
      {matchMessage && <p className="m-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{matchMessage}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className={`${cardClass} flex h-max max-h-[720px] flex-col overflow-hidden`}>
          <div className="space-y-2.5 border-0 border-b border-solid border-neutral-200 p-4">
            {outlet && (() => {
              const linkedCount = outlet.menuItems.filter((row) => row.lines.length).length;
              const share = outlet.menuItems.length ? linkedCount / outlet.menuItems.length : 0;
              return (
                <div className="pb-1">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="font-bold text-neutral-800">{linkedCount} of {outlet.menuItems.length} linked to stock</span>
                    <span className="tabular-nums text-neutral-500">{Math.round(share * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100" aria-hidden>
                    <div className={`h-full rounded-full transition-all ${share === 1 ? "bg-brand" : "bg-amber-500"}`} style={{ width: `${share * 100}%` }} />
                  </div>
                </div>
              );
            })()}
            <div className="flex gap-2">
              <select value={outletId ?? ""} onChange={(event) => { setOutletId(Number(event.target.value)); setSelectedId(null); }} className={`${smallFieldClass} max-w-[200px] text-sm font-semibold`} aria-label="Outlet">
                {outlets.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search menu" className={`${smallFieldClass} w-full pl-9 text-sm`} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([["all", "All"], ["unlinked", "Not linked"], ["linked", "Linked"], ["low", "Margin under 50%"]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={`h-7 shrink-0 whitespace-nowrap rounded-full border border-solid px-2.5 text-[13px] font-bold [font-family:inherit] ${filter === key ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 whitespace-nowrap border-0 border-b border-solid border-neutral-300 bg-neutral-100 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-600 pl-4 pr-4">
            <span>Menu item and what it uses</span><span className="text-right">Price and margin</span>
          </div>
          <ul className="m-0 flex-1 list-none overflow-y-auto p-0">
            {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-neutral-400">No menu items in this view.</li>}
            {items.map((item) => {
              const linked = item.lines.length > 0;
              const suggestion = suggestionByItem.get(item.id);
              const quickOpen = quickFor === item.id;
              const quickUnit = quickGood ? goodById.get(quickGood)?.baseUnit : undefined;
              return (
                <li key={item.id} className={`border-0 border-b border-solid border-neutral-200 transition ${selectedId === item.id ? "bg-brand/[0.07] shadow-[inset_3px_0_0_0_#02665e]" : "bg-white hover:bg-neutral-50/70"}`}>
                  <div className="flex items-start gap-3 px-4 py-2.5">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${linked ? "bg-brand/10 text-brand" : "bg-neutral-100 text-neutral-400"}`}>{linked ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}</span>
                    <button type="button" onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left [font-family:inherit]">
                      <span className="block truncate text-[15px] font-bold text-neutral-900">{item.name}</span>
                      {linked ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {item.lines.map((line) => (
                            <span key={line.stockItemId} className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-sky-50 px-1.5 py-0.5 text-xs font-semibold text-sky-800">{formatStockQuantity(line.quantity, line.baseUnit)} {line.stockItemName}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="mt-0.5 block truncate text-xs text-neutral-500">{item.legacyTracked ? "Counts stock on the menu (old counter)" : "Not linked to stock yet"}</span>
                      )}
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[13px] tabular-nums text-neutral-600">{formatMoney(item.price, overview.currency)}</span>
                      {linked
                        ? (item.marginPercent == null ? <Pill tone="info">No cost yet</Pill> : <Pill tone={item.marginPercent < 0 ? "out" : item.marginPercent < 50 ? "low" : "ok"}>{item.marginPercent}% margin</Pill>)
                        : !quickOpen && <button type="button" disabled={goods.length === 0} onClick={() => openQuick(item)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-solid border-brand/40 bg-white px-2.5 text-[13px] font-bold text-brand [font-family:inherit] transition hover:bg-brand/5 disabled:opacity-50"><Link2 className="h-3.5 w-3.5" />Link</button>}
                      {linked && <button type="button" onClick={() => setSelectedId(item.id)} className="border-0 bg-transparent p-0 text-[13px] font-bold text-brand [font-family:inherit] hover:underline">Edit</button>}
                    </div>
                  </div>

                  {!linked && suggestion && !quickOpen && (
                    <div className="mx-4 mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-solid border-brand/20 bg-brand/5 px-2.5 py-1.5">
                      <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-neutral-700"><Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" /><span className="truncate">Matches <strong>{suggestion.name}</strong>, 1 per serving</span></span>
                      <button type="button" disabled={quickBusy === item.id} onClick={() => void quickLink(item, suggestion.id, 1)} className={`${primaryButton} h-7 px-2.5 text-[13px]`}>{quickBusy === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}Link</button>
                    </div>
                  )}

                  {quickOpen && (
                    <div className="mx-4 mb-3 space-y-2 rounded-xl border border-solid border-neutral-300 bg-white p-2.5 shadow-sm">
                      <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-500">One serving uses</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={quickGood} onChange={(event) => { const next = event.target.value ? Number(event.target.value) : ""; setQuickGood(next); const unit = next ? goodById.get(next)?.baseUnit : undefined; setQuickQty(unit === "ML" ? "25" : unit === "G" ? "250" : "1"); }} className={`${smallFieldClass} min-w-[180px] flex-1 text-sm`}>
                          <option value="">Choose goods</option>
                          {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                        </select>
                        <div className="relative w-28">
                          <input inputMode="decimal" value={quickQty} onChange={(event) => setQuickQty(event.target.value.replace(/[^\d.]/g, ""))} aria-label="Quantity per serving" className={`${smallFieldClass} w-full pr-10 text-sm tabular-nums`} />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">{quickUnit ? unitShort(quickUnit) : ""}</span>
                        </div>
                      </div>
                      {item.legacyTracked && <p className="m-0 text-xs text-amber-800">Linking replaces this item&apos;s old menu counter.</p>}
                      {quickError && <p className="m-0 text-[13px] text-red-700">{quickError}</p>}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button type="button" onClick={() => { setQuickFor(null); setSelectedId(item.id); }} className="border-0 bg-transparent p-0 text-[13px] font-bold text-neutral-600 [font-family:inherit] hover:underline">Several ingredients? Open full recipe</button>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => setQuickFor(null)} className={quietButton}>Cancel</button>
                          <button type="button" disabled={!quickGood || !(Number(quickQty) > 0) || quickBusy === item.id} onClick={() => quickGood && void quickLink(item, quickGood, Number(quickQty))} className={`${primaryButton} h-8 px-3 text-[13px]`}>{quickBusy === item.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Link</button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {selected ? (
          <RecipeEditor key={selected.id} item={selected} goods={goods} goodById={goodById} currency={overview.currency} onSaved={() => void workspace.reload()} />
        ) : (
          <section className={`${cardClass} h-max overflow-hidden`}>
            <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand"><BookOpen className="h-5 w-5" /></span>
              <div>
                <p className="m-0 text-[15px] font-bold text-neutral-900">Choose a menu item on the left</p>
                <p className="m-0 mt-0.5 text-[13px] text-neutral-500">Its recipe opens here, with cost and margin as you type.</p>
              </div>
            </div>
            <ol className="m-0 list-none space-y-0 p-0">
              {[
                ["Pick the good it uses", "A Kilimanjaro sells one bottle of Kilimanjaro. A cocktail can use several goods."],
                ["Say how much one serving takes", "1 bottle, 25 ml of Konyagi, 300 g of fish. Add a yield if meat or fish loses weight when trimmed."],
                ["Check the margin", "Cost comes from what you paid on deliveries. Under 50% is flagged so you can review the price."],
              ].map(([title, body], index) => (
                <li key={title} className="flex items-start gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-3.5 last:border-b-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-600">{index + 1}</span>
                  <div>
                    <p className="m-0 text-sm font-bold text-neutral-800">{title}</p>
                    <p className="m-0 mt-0.5 text-[13px] text-neutral-500">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="m-0 bg-neutral-50 px-5 py-3 text-xs text-neutral-500">Tip: items marked <span className="font-bold text-brand">Matches</span> can be linked with one tap.</p>
          </section>
        )}
      </div>
      <p className="m-0 text-[13px] text-neutral-400">Cost uses each good&apos;s average purchase price today; margin is the share of the menu price left after it. Recipes are owner and manager only, because a generous recipe can hide losses.</p>
    </div>
  );
}

function RecipeEditor({ item, goods, goodById, currency, onSaved }: {
  item: RecipeMenuItem;
  goods: StockGood[];
  goodById: Map<number, StockGood>;
  currency: string;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<LineDraft[]>(item.lines.length
    ? item.lines.map((line) => ({ stockItemId: line.stockItemId, quantity: String(line.quantity), yieldPercent: String(line.yieldPercent) }))
    : [{ stockItemId: "", quantity: "1", yieldPercent: "100" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lineCost = (line: LineDraft) => {
    const good = line.stockItemId ? goodById.get(line.stockItemId) : null;
    const qty = Number(line.quantity) || 0;
    const yieldPercent = Math.min(100, Math.max(1, Number(line.yieldPercent) || 100));
    return (good?.averageCost ?? 0) * (qty * 100) / yieldPercent;
  };
  const cost = lines.reduce((sum, line) => sum + lineCost(line), 0);
  const margin = cost > 0 && item.price > 0 ? Math.round(((item.price - cost) / item.price) * 1000) / 10 : null;

  const save = async (clear = false) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const payload = clear ? [] : lines
        .filter((line) => line.stockItemId && Number(line.quantity) > 0)
        .map((line) => ({ stockItemId: Number(line.stockItemId), quantity: Number(line.quantity), yieldPercent: Math.min(100, Math.max(1, Math.round(Number(line.yieldPercent) || 100))) }));
      await apiClient.put(`/api/nrms/stock/menu-items/${item.id}/recipe`, { lines: payload });
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(apiError(cause, "Could not save the recipe"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} flex flex-col`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">Recipe</p>
          <h3 className="m-0 mt-0.5 truncate text-lg font-bold text-neutral-950">{item.name}</h3>
          <p className="m-0 mt-0.5 text-[13px] text-neutral-500">Sells at {formatMoney(item.price, currency)}{item.category ? ` · ${item.category}` : ""}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right">
          <div className="rounded-lg bg-neutral-50 px-3 py-1.5">
            <p className="m-0 text-xs text-neutral-500">Cost per serving</p>
            <p className="m-0 text-[15px] font-bold tabular-nums text-neutral-900">{cost > 0 ? formatMoney(cost, currency) : "-"}</p>
          </div>
          <div className="rounded-lg bg-neutral-50 px-3 py-1.5">
            <p className="m-0 text-xs text-neutral-500">Margin</p>
            <p className={`m-0 text-[15px] font-bold tabular-nums ${margin == null ? "text-neutral-400" : margin < 0 ? "text-red-700" : margin < 50 ? "text-amber-700" : "text-brand"}`}>{margin == null ? "-" : `${margin}%`}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-2 p-4 sm:p-5">
        {item.legacyTracked && <p className="m-0 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This item counts stock on the menu today. Saving a recipe replaces that counter. Use &quot;Move menu counters&quot; instead to carry today&apos;s count over.</p>}
        <div className="hidden grid-cols-[minmax(0,1fr)_120px_80px_96px_36px] gap-2 px-0.5 text-xs font-bold uppercase tracking-[0.1em] text-neutral-400 sm:grid">
          <span>Goods</span><span>Per serving</span><span>Yield %</span><span className="text-right">Cost</span><span />
        </div>
        {lines.map((line, index) => {
          const good = line.stockItemId ? goodById.get(line.stockItemId) : null;
          return (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_120px_80px_96px_36px] items-center gap-2">
              <select aria-label="Goods" value={line.stockItemId} onChange={(event) => setLines((rows) => rows.map((row, i) => (i === index ? { ...row, stockItemId: event.target.value ? Number(event.target.value) : "" } : row)))} className={`${smallFieldClass} w-full text-sm`}>
                <option value="">Choose goods</option>
                {goods.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <div className="relative">
                <input aria-label="Per serving" inputMode="decimal" value={line.quantity} onChange={(event) => setLines((rows) => rows.map((row, i) => (i === index ? { ...row, quantity: event.target.value.replace(/[^\d.]/g, "") } : row)))} className={`${smallFieldClass} w-full pr-12 text-sm tabular-nums`} />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-neutral-400">{good ? unitShort(good.baseUnit) : ""}</span>
              </div>
              <input aria-label="Yield percent" inputMode="numeric" value={line.yieldPercent} onChange={(event) => setLines((rows) => rows.map((row, i) => (i === index ? { ...row, yieldPercent: event.target.value.replace(/[^\d]/g, "") } : row)))} className={`${smallFieldClass} w-full text-sm tabular-nums`} />
              <span className="text-right text-sm tabular-nums text-neutral-600">{lineCost(line) > 0 ? formatMoney(lineCost(line), currency) : "-"}</span>
              <button type="button" aria-label="Remove ingredient" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
        {lines.length < 12 && <button type="button" onClick={() => setLines((rows) => [...rows, { stockItemId: "", quantity: "", yieldPercent: "100" }])} className={quietButton}><Plus className="h-3.5 w-3.5" />Add ingredient</button>}
        <p className="m-0 pt-2 text-[13px] text-neutral-500">Yield is the usable share after trimming or cooking: 85 means 1 kg bought gives 850 g served.</p>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
        {item.lines.length > 0 ? <button type="button" disabled={busy} onClick={() => void save(true)} className={outlineButton}><Unlink className="h-4 w-4" />Unlink</button> : <span />}
        <div className="flex items-center gap-2">
          {saved && <span className="inline-flex items-center gap-1 text-sm font-bold text-brand"><CheckCircle2 className="h-4 w-4" />Saved</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
          <button type="button" disabled={busy || !lines.some((line) => line.stockItemId && Number(line.quantity) > 0)} onClick={() => void save()} className={primaryButton}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save recipe</button>
        </div>
      </footer>
    </section>
  );
}

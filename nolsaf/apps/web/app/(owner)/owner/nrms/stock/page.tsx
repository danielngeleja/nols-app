"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Package, RefreshCw, Search } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type StockItem = { id: number; name: string; category: string | null; price: number; inStock: boolean };
type StockOutlet = { id: number; name: string; type: string; items: StockItem[]; outCount: number };
type StockState = { canManageStock: boolean; outlets: StockOutlet[] };

export default function NrmsStockPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [data, setData] = useState<StockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [outOnly, setOutOnly] = useState(false);

  const currency = selectedProperty?.currency ?? "TZS";
  const money = (value: number) => `${Math.round(value).toLocaleString()} ${currency}`;

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get<StockState>(`/api/nrms/operations/property/${selectedPropertyId}/stock`);
      setData(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load stock");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (item: StockItem) => {
    if (!data?.canManageStock) return;
    const next = !item.inStock;
    setBusyId(item.id); setError(null);
    // Optimistic: flip locally, then confirm with the server.
    setData((current) => current && ({ ...current, outlets: current.outlets.map((outlet) => ({ ...outlet, items: outlet.items.map((row) => row.id === item.id ? { ...row, inStock: next } : row), outCount: outlet.items.filter((row) => (row.id === item.id ? !next : !row.inStock)).length })) }));
    try {
      await apiClient.patch(`/api/nrms/operations/menu-items/${item.id}/stock`, { inStock: next });
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not update stock");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const outlets = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.outlets.map((outlet) => ({
      ...outlet,
      items: outlet.items.filter((item) => (!outOnly || !item.inStock) && (!q || item.name.toLowerCase().includes(q) || (item.category ?? "").toLowerCase().includes(q))),
    }));
  }, [data, query, outOnly]);

  const totalOut = useMemo(() => (data?.outlets ?? []).reduce((sum, outlet) => sum + outlet.outCount, 0), [data]);

  return (
    <div className="mx-auto max-w-[1000px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Stock</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Stock"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Mark an item out of stock when it runs out. It leaves every menu instantly and cannot be ordered until you bring it back.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an item or category" className="box-border h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-emerald-600" />
        </div>
        <button type="button" onClick={() => setOutOnly((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${outOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-600"}`}>
          <Package className="h-4 w-4" />{totalOut} out of stock
        </button>
      </div>

      {loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center text-neutral-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : data ? (
        <div className={loading ? "space-y-4 opacity-60 transition" : "space-y-4 transition"}>
          {outlets.map((outlet) => (
            <section key={outlet.id} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                <p className="m-0 text-[13px] font-bold text-neutral-900">{outlet.name}<span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-neutral-400">{outlet.type.toLowerCase()}</span></p>
                {outlet.outCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{outlet.outCount} out</span>}
              </div>
              <div className="divide-y divide-neutral-100">
                {outlet.items.length === 0 ? (
                  <p className="m-0 px-4 py-6 text-center text-xs text-neutral-400">No items match.</p>
                ) : outlet.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className={`m-0 truncate text-[13px] font-bold ${item.inStock ? "text-neutral-900" : "text-neutral-400 line-through"}`}>{item.name}</p>
                      <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{item.category || "Uncategorised"} · {money(item.price)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`text-[10px] font-bold ${item.inStock ? "text-emerald-700" : "text-amber-700"}`}>{item.inStock ? "In stock" : "Out"}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.inStock}
                        aria-label={`${item.name} ${item.inStock ? "in stock" : "out of stock"}`}
                        disabled={!data.canManageStock || busyId === item.id}
                        onClick={() => void toggle(item)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${item.inStock ? "bg-emerald-600" : "bg-neutral-300"}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${item.inStock ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  </div>
                ))}
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

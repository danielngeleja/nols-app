"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Package, RefreshCw, Search } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../_components/NrmsProvider";

type StockItem = { id: number; name: string; category: string | null; price: number; inStock: boolean; stockQuantity: number | null; lowStockThreshold: number };
type StockOutlet = { id: number; name: string; type: string; items: StockItem[]; outCount: number; lowCount: number };
type StockState = { canManageStock: boolean; outlets: StockOutlet[] };

function itemStatus(item: StockItem): { label: string; className: string } {
  if (!item.inStock) return { label: "Out of stock", className: "bg-red-50 text-red-700" };
  if (item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold) return { label: `Running low · ${item.stockQuantity} left`, className: "bg-amber-50 text-amber-700" };
  if (item.stockQuantity != null) return { label: `In stock · ${item.stockQuantity} left`, className: "bg-emerald-50 text-emerald-700" };
  return { label: "In stock", className: "bg-emerald-50 text-emerald-700" };
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

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get<StockState>(`/api/nrms/operations/property/${selectedPropertyId}/stock`);
      setData(res.data);
      setQtyDrafts({});
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Unable to load stock");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

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
    if (trimmed !== "" && !Number.isFinite(next)) { setError("Enter a whole number for the quantity."); return; }
    if (next === item.stockQuantity) { setQtyDrafts((current) => { const copy = { ...current }; delete copy[item.id]; return copy; }); return; }
    void saveStock(item, { stockQuantity: next });
  };

  const outlets = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.outlets.map((outlet) => ({
      ...outlet,
      items: outlet.items.filter((item) => {
        const needsAttention = !item.inStock || (item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold);
        return (!attentionOnly || needsAttention) && (!q || item.name.toLowerCase().includes(q) || (item.category ?? "").toLowerCase().includes(q));
      }),
    }));
  }, [data, query, attentionOnly]);

  const totalOut = useMemo(() => (data?.outlets ?? []).reduce((sum, outlet) => sum + outlet.outCount, 0), [data]);
  const totalLow = useMemo(() => (data?.outlets ?? []).reduce((sum, outlet) => sum + outlet.lowCount, 0), [data]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Stock</p>
          <h1 className="mb-0 mt-1 text-xl font-bold tracking-tight text-neutral-950">{selectedProperty?.title ?? "Stock"}</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Set the quantity you hold and every sale counts it down. At zero the item goes out of stock on its own until you restock it. Leave quantity empty for items you do not count.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an item or category" className="box-border h-9 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-emerald-600" />
        </div>
        <button type="button" onClick={() => setAttentionOnly((value) => !value)} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${attentionOnly ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-600"}`}>
          <Package className="h-4 w-4" />{totalOut} out · {totalLow} running low
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
                <span className="flex items-center gap-1.5">
                  {outlet.lowCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">{outlet.lowCount} low</span>}
                  {outlet.outCount > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{outlet.outCount} out</span>}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead>
                    <tr className="bg-neutral-50 text-[9px] uppercase tracking-wide text-neutral-500">
                      <th className="p-2.5 pl-4">Item</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5 text-right">Price</th>
                      <th className="p-2.5 text-right">Quantity</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5 pr-4 text-right">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outlet.items.length === 0 ? (
                      <tr><td colSpan={6} className="border-t border-neutral-100 px-4 py-6 text-center text-xs text-neutral-400">No items match.</td></tr>
                    ) : outlet.items.map((item) => {
                      const status = itemStatus(item);
                      return (
                        <tr key={item.id} className="border-t border-neutral-100 text-xs">
                          <td className={`p-2.5 pl-4 font-bold ${item.inStock ? "text-neutral-900" : "text-neutral-400"}`}>{item.name}</td>
                          <td className="p-2.5 text-neutral-500">{item.category || "Uncategorised"}</td>
                          <td className="p-2.5 text-right tabular-nums text-neutral-700">{money(item.price)}</td>
                          <td className="p-2.5 text-right">
                            <input
                              inputMode="numeric"
                              value={qtyDrafts[item.id] ?? (item.stockQuantity == null ? "" : String(item.stockQuantity))}
                              onChange={(event) => setQtyDrafts((current) => ({ ...current, [item.id]: event.target.value.replace(/[^\d]/g, "") }))}
                              onBlur={() => commitQuantity(item)}
                              onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                              placeholder="Not counted"
                              disabled={!data.canManageStock || busyId === item.id}
                              aria-label={`Quantity of ${item.name}`}
                              className="box-border h-8 w-28 rounded-md border border-neutral-200 bg-white px-2 text-right text-xs tabular-nums outline-none focus:border-emerald-500 disabled:bg-neutral-50"
                            />
                          </td>
                          <td className="p-2.5"><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span></td>
                          <td className="p-2.5 pr-4 text-right">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={item.inStock}
                              aria-label={`${item.name} ${item.inStock ? "in stock" : "out of stock"}`}
                              disabled={!data.canManageStock || busyId === item.id}
                              onClick={() => void saveStock(item, { inStock: !item.inStock })}
                              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${item.inStock ? "bg-emerald-600" : "bg-neutral-300"}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${item.inStock ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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

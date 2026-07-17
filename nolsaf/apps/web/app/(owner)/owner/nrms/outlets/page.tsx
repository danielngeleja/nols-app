"use client";

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Loader2, Plus, Store, UtensilsCrossed, Wine } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type MenuItem = { id: number; name: string; category: string | null; sku: string | null; price: number; status: string };
type Outlet = { id: number; name: string; code: string; type: string; currency: string; status: string; menuItems: MenuItem[]; _count?: { orders: number; memberships: number } };

export default function NrmsOutletsPage() {
  const { selectedPropertyId } = useNrms();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outletForm, setOutletForm] = useState({ name: "", code: "", type: "RESTAURANT" });
  const [itemForm, setItemForm] = useState({ name: "", category: "", sku: "", price: "" });

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const response = await apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/outlets`);
      const next: Outlet[] = response.data?.outlets ?? [];
      setOutlets(next);
      setSelectedId((current) => current && next.some((outlet) => outlet.id === current) ? current : next[0]?.id ?? null);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to load outlets"); }
    finally { setLoading(false); }
  }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load]);

  const selected = outlets.find((outlet) => outlet.id === selectedId) ?? null;

  const createOutlet = async () => {
    if (!selectedPropertyId || !outletForm.name.trim() || !outletForm.code.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/outlets`, outletForm);
      setOutletForm({ name: "", code: "", type: "RESTAURANT" }); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to create outlet"); }
    finally { setBusy(false); }
  };

  const createItem = async () => {
    if (!selected || !itemForm.name.trim() || !Number(itemForm.price)) return;
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/outlets/${selected.id}/menu-items`, { name: itemForm.name, category: itemForm.category || undefined, sku: itemForm.sku || undefined, price: Number(itemForm.price) });
      setItemForm({ name: "", category: "", sku: "", price: "" }); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to add menu item"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading outlets…</div>;

  return <div className="mx-auto max-w-7xl space-y-4 pb-8">
    <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Management</p><h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Outlets and menus</h2><p className="mb-0 mt-1 text-xs text-neutral-500">Configure the operational sources that can create itemised guest orders.</p></div>
    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_18px_45px_-36px_rgba(15,23,42,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50/70 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><Store className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold text-neutral-950">Add an outlet</h3>
            <p className="mb-0 mt-0.5 text-[10px] text-neutral-500">Create a restaurant, bar, or guest-service point.</p>
          </div>
        </div>
        <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Property setup</span>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void createOutlet(); }} className="grid min-w-0 grid-cols-1 gap-3 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-12 xl:items-end">
        <label className="min-w-0 md:col-span-2 xl:col-span-5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
          Outlet name
          <input value={outletForm.name} onChange={(event) => setOutletForm({ ...outletForm, name: event.target.value })} placeholder="Main restaurant" autoComplete="off" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
        </label>
        <label className="min-w-0 xl:col-span-2 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
          Short code
          <input value={outletForm.code} onChange={(event) => setOutletForm({ ...outletForm, code: event.target.value.toUpperCase() })} placeholder="REST01" autoComplete="off" maxLength={24} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-bold uppercase tracking-[0.08em] text-neutral-900 outline-none transition placeholder:font-normal placeholder:tracking-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
        </label>
        <label className="min-w-0 xl:col-span-3 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
          Outlet type
          <select value={outletForm.type} onChange={(event) => setOutletForm({ ...outletForm, type: event.target.value })} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"><option value="RESTAURANT">Restaurant</option><option value="BAR">Bar</option><option value="OTHER">Other service</option></select>
        </label>
        <button type="submit" disabled={busy || !outletForm.name.trim() || !outletForm.code.trim()} className="box-border inline-flex !h-10 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#073c35] px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none md:col-span-2 xl:col-span-2"><Plus className="h-4 w-4" />{busy ? "Adding..." : "Add outlet"}</button>
      </form>
    </section>

    <div className="grid min-w-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"><p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Property outlets</p><div className="space-y-1">{outlets.map((outlet) => { const Icon = outlet.type === "BAR" ? Wine : UtensilsCrossed; return <button key={outlet.id} type="button" onClick={() => setSelectedId(outlet.id)} className={`flex w-full min-w-0 items-center gap-3 rounded-xl border-0 px-3 py-3 text-left ${selectedId === outlet.id ? "bg-emerald-50 text-emerald-900" : "bg-transparent text-neutral-600 hover:bg-neutral-50"}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm"><Icon className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-xs font-bold">{outlet.name}</span><span className="mt-0.5 block text-[10px] opacity-60">{outlet.code} · {outlet.menuItems.length} items</span></span></button>; })}</div>{outlets.length === 0 && <div className="py-10 text-center text-xs text-neutral-400"><Store className="mx-auto mb-2 h-5 w-5" />No outlets</div>}</aside>

      <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        {!selected ? <div className="py-14 text-center text-sm text-neutral-400">Create an outlet to manage its menu.</div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="m-0 text-base font-bold text-neutral-950">{selected.name}</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{selected.type.toLowerCase()} · {selected.code} · {selected.currency}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{selected.status}</span></div>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 border-y border-neutral-100 py-4 sm:grid-cols-2 xl:grid-cols-12">
            <input value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Item name" aria-label="Menu item name" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 sm:col-span-2 xl:col-span-4" />
            <input value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })} placeholder="Category" aria-label="Menu category" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 xl:col-span-2" />
            <input value={itemForm.sku} onChange={(event) => setItemForm({ ...itemForm, sku: event.target.value })} placeholder="Item code (optional)" aria-label="Optional internal item code" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 xl:col-span-2" />
            <input type="number" min={1} value={itemForm.price} onChange={(event) => setItemForm({ ...itemForm, price: event.target.value })} placeholder="Price" aria-label="Menu item price" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 xl:col-span-2" />
            <button type="button" onClick={() => void createItem()} disabled={busy || !itemForm.name.trim() || !Number(itemForm.price)} className="box-border inline-flex !h-10 w-full items-center justify-center gap-1 rounded-lg border-0 bg-neutral-900 px-3 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:col-span-2 xl:col-span-2"><Plus className="h-3.5 w-3.5" />Menu item</button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{selected.menuItems.map((item) => <article key={item.id} className="rounded-xl border border-neutral-200 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{item.name}</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">{item.category || "Uncategorised"}{item.sku ? ` · ${item.sku}` : ""}</p></div><span className="shrink-0 text-xs font-bold text-emerald-700">{selected.currency} {Number(item.price).toLocaleString()}</span></div></article>)}</div>
          {selected.menuItems.length === 0 && <div className="py-12 text-center text-sm text-neutral-400">No menu items yet.</div>}
        </>}
      </section>
    </div>
  </div>;
}

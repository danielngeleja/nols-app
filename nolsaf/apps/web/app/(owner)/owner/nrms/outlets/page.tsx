"use client";

// Outlets and menu management. Menu items carry guest-facing content
// (description, photo, category, stock state) because the same records feed
// the staff order screen today and the QR guest menu (doc NRMS_QR_ORDERING.md).

import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Camera,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Store,
  UtensilsCrossed,
  Wine,
  X,
} from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type MenuItem = {
  id: number;
  name: string;
  category: string | null;
  sku: string | null;
  price: number;
  status: string;
  description: string | null;
  imageUrl: string | null;
  inStock: boolean;
  sortOrder: number;
};
type Outlet = {
  id: number; name: string; code: string; type: string; currency: string; status: string;
  autoAcceptQrOrders?: boolean;
  categoryOrder: string[] | null;
  menuItems: MenuItem[];
  _count?: { orders: number; memberships: number };
};

const UNCATEGORISED = "Uncategorised";

function categoriesInOrder(outlet: Outlet, items: MenuItem[]): string[] {
  const present = [...new Set(items.map((item) => item.category || UNCATEGORISED))];
  const preferred = (outlet.categoryOrder ?? []).filter((name) => present.includes(name));
  const leftovers = present.filter((name) => !preferred.includes(name)).sort((a, b) => a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b));
  return [...preferred, ...leftovers];
}

export default function NrmsOutletsPage() {
  const { selectedPropertyId } = useNrms();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outletForm, setOutletForm] = useState({ name: "", code: "", type: "RESTAURANT" });
  const [itemForm, setItemForm] = useState({ name: "", category: "", sku: "", price: "" });
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", category: "", sku: "", price: "", description: "", imageUrl: "" });
  const [uploading, setUploading] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

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
  const activeItems = (selected?.menuItems ?? []).filter((item) => item.status === "ACTIVE");
  const retiredItems = (selected?.menuItems ?? []).filter((item) => item.status !== "ACTIVE");
  const categories = selected ? categoriesInOrder(selected, activeItems) : [];

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

  const toggleAutoAccept = async (outlet: Outlet) => {
    setBusy(true); setError(null);
    try { await apiClient.patch(`/api/nrms/operations/outlets/${outlet.id}/qr-settings`, { autoAcceptQrOrders: !outlet.autoAcceptQrOrders }); await load(); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Failed to update QR order settings"); }
    finally { setBusy(false); }
  };

  const patchItem = async (itemId: number, data: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await apiClient.patch(`/api/nrms/operations/menu-items/${itemId}`, data); await load(); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Failed to update menu item"); }
    finally { setBusy(false); }
  };

  const openEdit = (item: MenuItem) => {
    setEditing(item);
    setEditForm({
      name: item.name,
      category: item.category ?? "",
      sku: item.sku ?? "",
      price: String(item.price),
      description: item.description ?? "",
      imageUrl: item.imageUrl ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editing || !editForm.name.trim() || !Number(editForm.price)) return;
    await patchItem(editing.id, {
      name: editForm.name.trim(),
      category: editForm.category.trim() || null,
      sku: editForm.sku.trim() || null,
      price: Number(editForm.price),
      description: editForm.description.trim() || null,
      imageUrl: editForm.imageUrl || null,
    });
    setEditing(null);
  };

  const uploadPhoto = async (file: File) => {
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) { setError("Menu photos must be JPG, PNG, or WEBP."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Menu photos must be 5MB or smaller."); return; }
    setUploading(true); setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "nrms-menu");
      const response = await apiClient.post("/api/uploads/cloudinary/upload", form);
      const url = String(response.data?.secure_url || "");
      if (!url) throw new Error("Upload did not return a file URL");
      setEditForm((current) => ({ ...current, imageUrl: url }));
    } catch (cause: any) { setError(cause?.response?.data?.error || cause?.message || "Photo upload failed"); }
    finally { setUploading(false); }
  };

  /** Persist a full re-index of one category after an up/down move. */
  const moveItem = async (category: string, item: MenuItem, direction: -1 | 1) => {
    const list = activeItems.filter((entry) => (entry.category || UNCATEGORISED) === category);
    const index = list.findIndex((entry) => entry.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true); setError(null);
    try {
      await Promise.all(next.map((entry, position) => entry.sortOrder === position
        ? Promise.resolve()
        : apiClient.patch(`/api/nrms/operations/menu-items/${entry.id}`, { sortOrder: position })));
      await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to reorder items"); }
    finally { setBusy(false); }
  };

  const moveCategory = async (category: string, direction: -1 | 1) => {
    if (!selected) return;
    const index = categories.indexOf(category);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true); setError(null);
    try {
      await apiClient.patch(`/api/nrms/operations/outlets/${selected.id}/category-order`, { categoryOrder: next });
      await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to reorder categories"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading outlets…</div>;

  return <div className="mx-auto max-w-7xl space-y-4 pb-8">
    <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Management</p><h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Outlets and menus</h2><p className="mb-0 mt-1 text-xs text-neutral-500">Menu content here is what staff sell from and what guests will see on the QR menu: photo, description, price, and live stock state.</p></div>
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
      <aside className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"><p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Property outlets</p><div className="space-y-1">{outlets.map((outlet) => { const Icon = outlet.type === "BAR" ? Wine : UtensilsCrossed; return <button key={outlet.id} type="button" onClick={() => setSelectedId(outlet.id)} className={`flex w-full min-w-0 items-center gap-3 rounded-xl border-0 px-3 py-3 text-left ${selectedId === outlet.id ? "bg-emerald-50 text-emerald-900" : "bg-transparent text-neutral-600 hover:bg-neutral-50"}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm"><Icon className="h-4 w-4" /></span><span className="min-w-0"><span className="block truncate text-xs font-bold">{outlet.name}</span><span className="mt-0.5 block text-[10px] opacity-60">{outlet.code} · {outlet.menuItems.filter((item) => item.status === "ACTIVE").length} items</span></span></button>; })}</div>{outlets.length === 0 && <div className="py-10 text-center text-xs text-neutral-400"><Store className="mx-auto mb-2 h-5 w-5" />No outlets</div>}</aside>

      <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        {!selected ? <div className="py-14 text-center text-sm text-neutral-400">Create an outlet to manage its menu.</div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="m-0 text-base font-bold text-neutral-950">{selected.name}</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{selected.type.toLowerCase()} · {selected.code} · {selected.currency}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void toggleAutoAccept(selected)} disabled={busy} title="When on, guest QR orders skip the accept step and enter the queue as confirmed" className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold transition disabled:opacity-50 ${selected.autoAcceptQrOrders ? "border-violet-200 bg-violet-50 text-violet-700" : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"}`}><span className={`h-2 w-2 rounded-full ${selected.autoAcceptQrOrders ? "bg-violet-600" : "bg-neutral-300"}`} />QR auto-accept {selected.autoAcceptQrOrders ? "on" : "off"}</button><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{selected.status}</span></div></div>

          <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 border-y border-neutral-100 py-4 sm:grid-cols-2 xl:grid-cols-12">
            <input value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Item name" aria-label="Menu item name" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 sm:col-span-2 xl:col-span-4" />
            <input value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })} placeholder="Category" aria-label="Menu category" list="nrms-menu-categories" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 xl:col-span-2" />
            <datalist id="nrms-menu-categories">{categories.filter((name) => name !== UNCATEGORISED).map((name) => <option key={name} value={name} />)}</datalist>
            <input value={itemForm.sku} onChange={(event) => setItemForm({ ...itemForm, sku: event.target.value })} placeholder="Item code (optional)" aria-label="Optional internal item code" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 xl:col-span-2" />
            <input type="number" min={1} value={itemForm.price} onChange={(event) => setItemForm({ ...itemForm, price: event.target.value })} placeholder="Price" aria-label="Menu item price" className="box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-xs outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 xl:col-span-2" />
            <button type="button" onClick={() => void createItem()} disabled={busy || !itemForm.name.trim() || !Number(itemForm.price)} className="box-border inline-flex !h-10 w-full items-center justify-center gap-1 rounded-lg border-0 bg-neutral-900 px-3 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:col-span-2 xl:col-span-2"><Plus className="h-3.5 w-3.5" />Menu item</button>
          </div>

          {activeItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-neutral-400">No menu items yet. Add the first dish or drink above.</div>
          ) : (
            <div className="mt-4 space-y-5">
              {categories.map((category, categoryIndex) => {
                const items = activeItems.filter((item) => (item.category || UNCATEGORISED) === category);
                return (
                  <div key={category}>
                    <div className="mb-2 flex items-center gap-2 border-b border-neutral-100 pb-1.5">
                      <h4 className="m-0 text-[12px] font-bold text-neutral-900">{category}</h4>
                      <span className="text-[10px] font-semibold text-neutral-400">{items.length}</span>
                      <span className="ml-auto flex gap-1">
                        <button type="button" disabled={busy || categoryIndex === 0} onClick={() => void moveCategory(category, -1)} aria-label={`Move ${category} up`} className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                        <button type="button" disabled={busy || categoryIndex === categories.length - 1} onClick={() => void moveCategory(category, 1)} aria-label={`Move ${category} down`} className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map((item, itemIndex) => (
                        <article key={item.id} className={`flex min-w-0 gap-3 rounded-xl border p-2.5 transition ${item.inStock ? "border-neutral-200 bg-white" : "border-neutral-200 bg-neutral-50 opacity-75"}`}>
                          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 text-neutral-300">
                            {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="m-0 truncate text-xs font-bold text-neutral-900">{item.name}</p>
                              <strong className="shrink-0 text-[11px] tabular-nums text-emerald-700">{selected.currency} {Number(item.price).toLocaleString()}</strong>
                            </div>
                            <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{item.description || "No description yet"}</p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <button type="button" disabled={busy} onClick={() => void patchItem(item.id, { inStock: !item.inStock })} className={`appearance-none rounded-md border px-1.5 py-0.5 text-[9px] font-bold transition disabled:opacity-50 ${item.inStock ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"}`}>{item.inStock ? "In stock" : "Out of stock"}</button>
                              <button type="button" disabled={busy} onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`} className="inline-flex appearance-none items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"><Pencil className="h-2.5 w-2.5" />Edit</button>
                              <span className="ml-auto flex gap-1">
                                <button type="button" disabled={busy || itemIndex === 0} onClick={() => void moveItem(category, item, -1)} aria-label={`Move ${item.name} up`} className="flex h-5 w-5 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700 disabled:opacity-30"><ArrowUp className="h-2.5 w-2.5" /></button>
                                <button type="button" disabled={busy || itemIndex === items.length - 1} onClick={() => void moveItem(category, item, 1)} aria-label={`Move ${item.name} down`} className="flex h-5 w-5 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700 disabled:opacity-30"><ArrowDown className="h-2.5 w-2.5" /></button>
                              </span>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {retiredItems.length > 0 && (
            <div className="mt-5 border-t border-neutral-100 pt-3">
              <button type="button" onClick={() => setShowRetired((value) => !value)} className="appearance-none rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[10px] font-bold text-neutral-500 hover:bg-neutral-100">{showRetired ? "Hide" : "Show"} retired items ({retiredItems.length})</button>
              {showRetired && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {retiredItems.map((item) => (
                    <article key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-2.5">
                      <div className="min-w-0"><p className="m-0 truncate text-xs font-semibold text-neutral-500">{item.name}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{selected.currency} {Number(item.price).toLocaleString()}</p></div>
                      <button type="button" disabled={busy} onClick={() => void patchItem(item.id, { status: "ACTIVE" })} className="shrink-0 appearance-none rounded-md border border-emerald-200 bg-white px-2 py-1 text-[9px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Restore</button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </>}
      </section>
    </div>

    {editing && selected && (
      <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto p-3 sm:p-4">
        <button type="button" aria-label="Close" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => setEditing(null)} />
        <section className="relative box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 text-sm font-bold text-neutral-950">Edit menu item</h3>
            <button type="button" onClick={() => setEditing(null)} aria-label="Close editor" className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 text-neutral-300">
              {editForm.imageUrl ? <img src={editForm.imageUrl} alt={editForm.name} className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6" />}
            </span>
            <div className="min-w-0 space-y-1.5">
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); event.target.value = ""; }} />
              <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} className="inline-flex appearance-none items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">{uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}{editForm.imageUrl ? "Replace photo" : "Add photo"}</button>
              {editForm.imageUrl && <button type="button" onClick={() => setEditForm((current) => ({ ...current, imageUrl: "" }))} className="block appearance-none border-0 bg-transparent p-0 text-[10px] font-semibold text-red-500 hover:text-red-700">Remove photo</button>}
              <p className="m-0 text-[9px] text-neutral-400">JPG, PNG, or WEBP up to 5MB. Shown to guests on the QR menu.</p>
            </div>
          </div>

          <label className="mt-4 block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Name
            <input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} maxLength={160} className="mt-1.5 box-border !h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white" />
          </label>
          <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Description shown to guests
            <textarea value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} maxLength={500} rows={3} placeholder="e.g. Grilled chicken with coconut rice and kachumbari" className="mt-1.5 box-border w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Category
              <input value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} maxLength={80} list="nrms-menu-categories" className="mt-1.5 box-border !h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white" />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Price ({selected.currency})
              <input type="number" min={1} value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })} className="mt-1.5 box-border !h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white" />
            </label>
          </div>
          <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-neutral-500">Item code (optional)
            <input value={editForm.sku} onChange={(event) => setEditForm({ ...editForm, sku: event.target.value })} maxLength={50} className="mt-1.5 box-border !h-10 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold uppercase tracking-[0.06em] text-neutral-900 outline-none focus:border-emerald-500 focus:bg-white" />
          </label>

          <div className="mt-5 flex items-center justify-between gap-2 border-t border-neutral-100 pt-4">
            <button type="button" disabled={busy} onClick={() => { void patchItem(editing.id, { status: "INACTIVE" }); setEditing(null); }} className="appearance-none rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Retire item</button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(null)} className="appearance-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-600 hover:bg-neutral-50">Cancel</button>
              <button type="button" disabled={busy || uploading || !editForm.name.trim() || !Number(editForm.price)} onClick={() => void saveEdit()} className="appearance-none rounded-lg border-0 bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">Save changes</button>
            </div>
          </div>
        </section>
      </div>
    )}
  </div>;
}

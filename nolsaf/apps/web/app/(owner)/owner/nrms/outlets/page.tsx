"use client";

// Outlets and menu management. Menu items carry guest-facing content
// (description, photo, category, stock state) because the same records feed
// the staff order screen today and the QR guest menu (doc NRMS_QR_ORDERING.md).

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import apiClient from "@/lib/apiClient";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Loader2,
  Package,
  Pencil,
  Plus,
  SlidersHorizontal,
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
  stockQuantity: number | null;
  lowStockThreshold: number;
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
const CATEGORY_PAGE_SIZE = 6;
const CATEGORY_TONES = [
  { icon: "bg-emerald-100 text-emerald-800", header: "bg-emerald-50/70" },
  { icon: "bg-sky-100 text-sky-800", header: "bg-sky-50/70" },
  { icon: "bg-violet-100 text-violet-800", header: "bg-violet-50/70" },
  { icon: "bg-amber-100 text-amber-800", header: "bg-amber-50/70" },
  { icon: "bg-rose-100 text-rose-800", header: "bg-rose-50/70" },
] as const;

const RESTAURANT_MENU_CATEGORIES = [
  "Breakfast", "Starters", "Soups", "Salads", "Local specialities", "Main courses",
  "Grills and barbecue", "Seafood", "Chicken dishes", "Meat dishes", "Vegetarian and vegan",
  "Rice dishes", "Pasta and noodles", "Pizza", "Burgers and sandwiches", "Sides", "Kids menu",
  "Desserts", "Tea and coffee", "Fresh juices", "Soft drinks", "Water",
] as const;

const BAR_MENU_CATEGORIES = [
  "Beer", "Cider", "Red wine", "White wine", "Rosé wine", "Sparkling wine", "Whisky", "Gin",
  "Vodka", "Rum", "Tequila", "Brandy and cognac", "Liqueurs", "Cocktails", "Mocktails",
  "Soft drinks and mixers", "Energy drinks", "Water", "Bar snacks",
] as const;

function menuCategoriesForOutlet(type?: string): string[] {
  if (type === "RESTAURANT") return [...RESTAURANT_MENU_CATEGORIES];
  if (type === "BAR") return [...BAR_MENU_CATEGORIES];
  return [...new Set([...RESTAURANT_MENU_CATEGORIES, ...BAR_MENU_CATEGORIES])];
}

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
  const [creatingItem, setCreatingItem] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", category: "", sku: "", price: "", description: "", imageUrl: "" });
  const [itemEditorError, setItemEditorError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [stockEditingId, setStockEditingId] = useState<number | null>(null);
  const [stockForm, setStockForm] = useState({ quantity: "", lowStockThreshold: "5" });
  const [stockError, setStockError] = useState<string | null>(null);
  const [categoryItemLimits, setCategoryItemLimits] = useState<Record<string, number>>({});
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
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
  const allowedMenuCategories = menuCategoriesForOutlet(selected?.type);

  const createOutlet = async () => {
    if (!selectedPropertyId || !outletForm.name.trim() || !outletForm.code.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/outlets`, outletForm);
      setOutletForm({ name: "", code: "", type: "RESTAURANT" }); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to create outlet"); }
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
    setCreatingItem(false);
    setEditing(item);
    setItemEditorError(null);
    setEditForm({
      name: item.name,
      category: menuCategoriesForOutlet(selected?.type).includes(item.category ?? "") ? item.category ?? "" : "",
      sku: item.sku ?? "",
      price: String(item.price),
      description: item.description ?? "",
      imageUrl: item.imageUrl ?? "",
    });
  };

  const openStockEditor = (item: MenuItem) => {
    if (stockEditingId === item.id) {
      setStockEditingId(null);
      setStockError(null);
      return;
    }
    setStockEditingId(item.id);
    setStockForm({ quantity: item.stockQuantity == null ? "" : String(item.stockQuantity), lowStockThreshold: String(item.lowStockThreshold ?? 5) });
    setStockError(null);
  };

  const saveStock = async (item: MenuItem, data?: Record<string, unknown>) => {
    const quantity = stockForm.quantity.trim() === "" ? null : Number(stockForm.quantity);
    const lowStockThreshold = Number(stockForm.lowStockThreshold);
    if (!data && (quantity != null && (!Number.isInteger(quantity) || quantity < 0))) return setStockError("Enter a whole stock quantity of zero or more.");
    if (!data && (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0)) return setStockError("Enter a valid low-stock alert level.");
    setBusy(true);
    setStockError(null);
    try {
      await apiClient.patch(`/api/nrms/operations/menu-items/${item.id}/stock`, data ?? { stockQuantity: quantity, lowStockThreshold });
      await load();
      if (!data) setStockEditingId(null);
    } catch (cause: any) {
      setStockError(cause?.response?.data?.error || "Failed to update stock");
    } finally {
      setBusy(false);
    }
  };

  const openCreateItem = () => {
    setEditing(null);
    setCreatingItem(true);
    setItemEditorError(null);
    setEditForm({ name: "", category: "", sku: "", price: "", description: "", imageUrl: "" });
  };

  const closeItemEditor = () => {
    if (busy || uploading) return;
    setEditing(null);
    setCreatingItem(false);
    setItemEditorError(null);
  };

  const saveItemEditor = async () => {
    if (!selected) return;
    if (editForm.name.trim().length < 2) return setItemEditorError("Enter a clear menu item name.");
    if (!allowedMenuCategories.includes(editForm.category)) return setItemEditorError(`Choose a category for this ${selected.type === "BAR" ? "bar" : selected.type === "RESTAURANT" ? "restaurant" : "outlet"} item.`);
    const price = Number(editForm.price);
    if (!Number.isFinite(price) || price <= 0) return setItemEditorError("Enter a valid selling price.");
    const payload = {
      name: editForm.name.trim(),
      category: editForm.category.trim() || null,
      sku: editForm.sku.trim() || null,
      price,
      description: editForm.description.trim() || null,
      imageUrl: editForm.imageUrl || null,
    };
    setBusy(true);
    setItemEditorError(null);
    try {
      if (editing) await apiClient.patch(`/api/nrms/operations/menu-items/${editing.id}`, payload);
      else await apiClient.post(`/api/nrms/operations/outlets/${selected.id}/menu-items`, payload);
      await load();
      setEditing(null);
      setCreatingItem(false);
    } catch (cause: any) {
      setItemEditorError(cause?.response?.data?.error || (editing ? "Failed to save this menu item" : "Failed to add this menu item"));
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type)) { setItemEditorError("Use a JPG, PNG, or WEBP photo."); return; }
    if (file.size > 2 * 1024 * 1024) { setItemEditorError("Photo exceeds the 2MB upload limit. Choose a smaller image."); return; }
    setUploading(true); setItemEditorError(null);
    try {
      const form = new FormData();
      form.append("folder", "nrms-menu");
      form.append("file", file);
      const response = await apiClient.post("/api/uploads/cloudinary/upload?folder=nrms-menu", form);
      const url = String(response.data?.secure_url || "");
      if (!url) throw new Error("Upload did not return a file URL");
      setEditForm((current) => ({ ...current, imageUrl: url }));
    } catch (cause: any) {
      const uploadCode = cause?.response?.data?.code;
      const status = cause?.response?.status;
      setItemEditorError(uploadCode === "UPLOAD_SIZE_LIMIT_EXCEEDED" || status === 413
        ? "Photo exceeds the 2MB upload limit. Choose a smaller image."
        : cause?.response?.data?.message || cause?.response?.data?.error || cause?.message || "Photo upload failed");
    }
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
      <aside className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Property outlets</p>
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {outlets.map((outlet) => {
            const Icon = outlet.type === "BAR" ? Wine : UtensilsCrossed;
            const active = selectedId === outlet.id;
            const itemCount = outlet.menuItems.filter((item) => item.status === "ACTIVE").length;
            return (
              <button key={outlet.id} type="button" onClick={() => setSelectedId(outlet.id)} aria-current={active ? "true" : undefined} className={`flex w-full min-w-0 items-center gap-3 border-0 border-b border-solid border-neutral-100 px-3 py-3 text-left transition last:border-b-0 ${active ? "bg-emerald-50 text-emerald-950" : "bg-white text-neutral-700 hover:bg-neutral-50"}`}>
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? "border-emerald-200 bg-white text-emerald-700 shadow-sm" : outlet.type === "BAR" ? "border-sky-100 bg-sky-50 text-sky-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">{outlet.name}</span>
                  <span className="mt-0.5 block text-[10px] font-medium text-neutral-400">{outlet.code} · {itemCount} {itemCount === 1 ? "item" : "items"}</span>
                </span>
                {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Selected outlet" />}
              </button>
            );
          })}
        </div>
        {outlets.length === 0 && <div className="py-10 text-center text-xs text-neutral-400"><Store className="mx-auto mb-2 h-5 w-5" />No outlets</div>}
      </aside>

      <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        {!selected ? <div className="py-14 text-center text-sm text-neutral-400">Create an outlet to manage its menu.</div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="m-0 text-base font-bold text-neutral-950">{selected.name}</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{selected.type.toLowerCase()} · {selected.code} · {selected.currency}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void toggleAutoAccept(selected)} disabled={busy} title="When on, guest QR orders skip the accept step and enter the queue as confirmed" className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold transition disabled:opacity-50 ${selected.autoAcceptQrOrders ? "border-violet-200 bg-violet-50 text-violet-700" : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"}`}><span className={`h-2 w-2 rounded-full ${selected.autoAcceptQrOrders ? "bg-violet-600" : "bg-neutral-300"}`} />QR auto-accept {selected.autoAcceptQrOrders ? "on" : "off"}</button><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{selected.status}</span></div></div>

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm"><UtensilsCrossed className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="m-0 text-xs font-bold text-neutral-900">Build the guest menu</p>
                <p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">Add the complete item, including its photo, guest description, category, and price.</p>
              </div>
            </div>
            <button type="button" onClick={openCreateItem} disabled={busy} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border-0 bg-neutral-900 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-neutral-800 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add menu item</button>
          </div>

          {activeItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-neutral-400">No menu items yet. Add the first dish or drink above.</div>
          ) : (
            <div className="mt-4 space-y-5">
              {categories.map((category, categoryIndex) => {
                const items = activeItems.filter((item) => (item.category || UNCATEGORISED) === category);
                const categoryStateKey = `${selected.id}:${category}`;
                const visibleLimit = categoryItemLimits[categoryStateKey] ?? CATEGORY_PAGE_SIZE;
                const visibleItems = items.slice(0, visibleLimit);
                const collapsed = collapsedCategories[categoryStateKey] ?? true;
                const tone = CATEGORY_TONES[categoryIndex % CATEGORY_TONES.length];
                return (
                  <section key={category} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_4px_14px_-10px_rgba(15,23,42,0.35)]">
                    <div className={`flex items-center gap-3 border-b border-neutral-200/80 px-3.5 py-3 sm:px-4 ${tone.header}`}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}><UtensilsCrossed className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0">
                        <h4 className="m-0 truncate text-[13px] font-bold text-neutral-950">{category}</h4>
                        <p className="mb-0 mt-0.5 text-[9px] text-neutral-400">{items.length} {items.length === 1 ? "menu item" : "menu items"}{items.length > CATEGORY_PAGE_SIZE && !collapsed ? ` · showing ${visibleItems.length}` : ""}</p>
                      </div>
                      <span className="ml-auto flex items-center gap-1">
                        <button type="button" title="Move category up" disabled={busy || categoryIndex === 0} onClick={() => void moveCategory(category, -1)} aria-label={`Move ${category} up`} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none"><ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} /></button>
                        <button type="button" title="Move category down" disabled={busy || categoryIndex === categories.length - 1} onClick={() => void moveCategory(category, 1)} aria-label={`Move ${category} down`} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none"><ArrowDown className="h-3.5 w-3.5" strokeWidth={2.5} /></button>
                        <button type="button" onClick={() => setCollapsedCategories((current) => ({ ...current, [categoryStateKey]: !collapsed }))} aria-label={`${collapsed ? "Expand" : "Collapse"} ${category}`} className="ml-1 flex h-7 items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 text-[9px] font-bold text-neutral-700 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50">{collapsed ? "Open" : "Hide"}{collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}</button>
                      </span>
                    </div>
                    {!collapsed && <>
                    <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
                      {visibleItems.map((item) => {
                        const itemIndex = items.findIndex((entry) => entry.id === item.id);
                        return (
                        <article key={item.id} className={`group min-w-0 overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:-translate-y-px hover:border-neutral-300 hover:shadow-[0_10px_24px_-18px_rgba(15,23,42,0.45)] ${item.inStock ? "border-neutral-200 bg-white" : "border-neutral-200 bg-neutral-50"}`}>
                          <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-3 p-3.5">
                            <span className={`relative flex h-[5.5rem] w-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-100 bg-gradient-to-br from-neutral-50 to-neutral-100 text-neutral-300 ${item.inStock ? "" : "grayscale opacity-60"}`}>
                              {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill sizes="88px" className="object-cover" /> : <UtensilsCrossed className="h-5 w-5" />}
                            </span>
                            <div className="flex min-w-0 flex-col">
                              <div className="flex min-h-6 items-start justify-between gap-2">
                                <p className="m-0 min-w-0 truncate pt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">{item.sku || "Menu item"}</p>
                                <strong className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold tabular-nums text-emerald-800 ring-1 ring-emerald-100">{selected.currency} {Number(item.price).toLocaleString()}</strong>
                              </div>
                              <p className="mb-0 mt-1 line-clamp-2 text-sm font-bold leading-5 text-neutral-950">{item.name}</p>
                              <p className="mb-0 mt-1 line-clamp-2 text-[10px] leading-4 text-neutral-500">{item.description || "Add a guest-facing description"}</p>
                            </div>
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5 border-t border-neutral-100 bg-neutral-50/70 px-3 py-2.5">
                            <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold ${!item.inStock ? "bg-red-50 text-red-700" : item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${!item.inStock ? "bg-red-500" : item.stockQuantity != null && item.stockQuantity <= item.lowStockThreshold ? "bg-amber-500" : "bg-emerald-500"}`} /><span className="truncate">{!item.inStock ? "Out of stock" : item.stockQuantity == null ? "Available" : `${item.stockQuantity.toLocaleString()} left`}</span></span>
                            <button type="button" disabled={busy} onClick={() => openStockEditor(item)} className={`inline-flex h-7 shrink-0 appearance-none items-center gap-1 rounded-lg border px-2 text-[9px] font-bold transition disabled:opacity-50 ${stockEditingId === item.id ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"}`}><Package className="h-2.5 w-2.5" />Stock</button>
                            <button type="button" disabled={busy} onClick={() => openEdit(item)} aria-label={`Edit ${item.name}`} className="inline-flex h-7 shrink-0 appearance-none items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 text-[9px] font-bold text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"><Pencil className="h-2.5 w-2.5" />Edit</button>
                            <span className="ml-auto flex shrink-0 gap-1 border-l border-neutral-200 pl-1.5">
                              <button type="button" title="Move item up" disabled={busy || itemIndex === 0} onClick={() => void moveItem(category, item, -1)} aria-label={`Move ${item.name} up`} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none"><ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} /></button>
                              <button type="button" title="Move item down" disabled={busy || itemIndex === items.length - 1} onClick={() => void moveItem(category, item, 1)} aria-label={`Move ${item.name} down`} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-400 hover:text-neutral-900 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-300 disabled:shadow-none"><ArrowDown className="h-3.5 w-3.5" strokeWidth={2.5} /></button>
                            </span>
                          </div>
                          {stockEditingId === item.id && (
                            <div className="border-t border-neutral-100 bg-neutral-50/80 p-3.5">
                              <div className="mb-3 flex items-start justify-between gap-3">
                                <div><p className="m-0 flex items-center gap-1.5 text-[11px] font-bold text-neutral-900"><SlidersHorizontal className="h-3.5 w-3.5 text-emerald-700" />Stock control</p><p className="mb-0 mt-0.5 text-[9px] leading-4 text-neutral-500">Enter a quantity to track every sale, or leave it blank for availability-only control.</p></div>
                                <button type="button" role="switch" aria-checked={item.inStock} disabled={busy || (item.stockQuantity != null && item.stockQuantity <= 0)} onClick={() => void saveStock(item, { inStock: !item.inStock })} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${item.inStock ? "bg-emerald-600" : "bg-neutral-300"}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition ${item.inStock ? "translate-x-5" : "translate-x-0.5"}`} /></button>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                                <label className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Quantity on hand
                                  <input inputMode="numeric" value={stockForm.quantity} onChange={(event) => { setStockForm((current) => ({ ...current, quantity: event.target.value.replace(/[^\d]/g, "") })); setStockError(null); }} placeholder="Not tracked" className="mt-1 box-border h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold tabular-nums text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" />
                                </label>
                                <label className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Low-stock alert at
                                  <input inputMode="numeric" value={stockForm.lowStockThreshold} onChange={(event) => { setStockForm((current) => ({ ...current, lowStockThreshold: event.target.value.replace(/[^\d]/g, "") })); setStockError(null); }} className="mt-1 box-border h-9 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold tabular-nums text-neutral-900 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" />
                                </label>
                                <button type="button" disabled={busy} onClick={() => void saveStock(item)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-[10px] font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50">{busy && <Loader2 className="h-3 w-3 animate-spin" />}Save stock</button>
                              </div>
                              {stockError && <p className="mb-0 mt-2 text-[10px] font-semibold text-red-700">{stockError}</p>}
                            </div>
                          )}
                        </article>
                        );
                      })}
                    </div>
                    {items.length > CATEGORY_PAGE_SIZE && (
                      <div className="flex items-center justify-center gap-2 border-t border-neutral-200/70 bg-white px-3 py-2.5">
                        {visibleItems.length < items.length && <button type="button" onClick={() => setCategoryItemLimits((current) => ({ ...current, [categoryStateKey]: Math.min(items.length, visibleLimit + CATEGORY_PAGE_SIZE) }))} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-700 shadow-sm hover:border-neutral-300 hover:bg-neutral-50">Show {Math.min(CATEGORY_PAGE_SIZE, items.length - visibleItems.length)} more <ChevronDown className="h-3 w-3" /></button>}
                        {visibleLimit > CATEGORY_PAGE_SIZE && <button type="button" onClick={() => setCategoryItemLimits((current) => ({ ...current, [categoryStateKey]: CATEGORY_PAGE_SIZE }))} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-neutral-50 px-3 text-[10px] font-bold text-neutral-500 hover:bg-neutral-100">Show first {CATEGORY_PAGE_SIZE} <ChevronUp className="h-3 w-3" /></button>}
                      </div>
                    )}
                    </>}
                  </section>
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

    {(editing || creatingItem) && selected && (
      <div className="fixed inset-0 z-[11000] flex items-center justify-center p-3 sm:p-6">
        <button type="button" aria-label="Close" className="absolute inset-0 border-0 bg-neutral-950/50 backdrop-blur-sm" onClick={closeItemEditor} />
        <section className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white bg-white shadow-[0_30px_80px_-24px_rgba(0,0,0,0.5)] ring-1 ring-black/5 sm:max-h-[calc(100dvh-3rem)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-100 bg-white px-5 py-4 sm:px-6 sm:py-5">
            <div>
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">{editing ? "Menu item" : "New menu item"}</p>
              <h3 className="mb-0 mt-1 text-base font-bold text-neutral-950">{editing ? `Edit ${editing.name}` : "Add a complete menu item"}</h3>
              <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">This information appears on the staff order screen and the guest QR menu.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Guest visible</span>
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-[9px] font-bold text-neutral-600">Photo optional</span>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700">Name and price required</span>
              </div>
            </div>
            <button type="button" onClick={closeItemEditor} disabled={busy || uploading} aria-label="Close editor" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50"><X className="h-4 w-4" /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[12rem_minmax(0,1fr)]">
            <aside className="min-w-0">
              <p className="mb-2 mt-0 text-xs font-bold text-neutral-900">Item photo</p>
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-neutral-100 text-neutral-300 shadow-inner">
                {editForm.imageUrl ? <Image src={editForm.imageUrl} alt={editForm.name || "Menu item preview"} fill sizes="224px" className="object-cover" /> : <div className="text-center"><ImageIcon className="mx-auto h-8 w-8" /><span className="mt-2 block text-[10px] font-semibold text-neutral-400">Photo preview</span></div>}
              </div>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); event.target.value = ""; }} />
              <button type="button" disabled={uploading || busy} onClick={() => fileInput.current?.click()} className="mt-3 inline-flex min-h-10 w-full appearance-none items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50">{uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}{uploading ? "Uploading photo" : editForm.imageUrl ? "Replace item photo" : "Upload item photo"}</button>
              {editForm.imageUrl && <button type="button" disabled={busy || uploading} onClick={() => setEditForm((current) => ({ ...current, imageUrl: "" }))} className="mt-2 w-full appearance-none border-0 bg-transparent p-1 text-[10px] font-bold text-red-600 hover:text-red-700 disabled:opacity-50">Remove photo</button>}
              <p className="mb-0 mt-2 text-[9px] leading-4 text-neutral-500">Use a clear dish or product photo. QR codes are managed separately under QR order points. JPG, PNG, or WEBP up to 2MB.</p>
            </aside>

            <div className="min-w-0">
              <div className="mb-4">
                <h4 className="m-0 text-sm font-bold text-neutral-950">Menu details</h4>
                <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Write this as guests should read it, with a clear name and useful description.</p>
              </div>
              <label className="block text-[11px] font-bold text-neutral-700">Item name <span className="text-red-500">*</span>
                <input value={editForm.name} onChange={(event) => { setEditForm({ ...editForm, name: event.target.value }); setItemEditorError(null); }} maxLength={160} autoFocus placeholder={selected.type === "BAR" ? "For example: Jack Daniel’s, Safari Lager" : selected.type === "RESTAURANT" ? "For example: Grilled chicken, Beef burger" : "For example: Grilled chicken, Safari Lager"} className="mt-1.5 box-border !h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-0 text-sm font-semibold text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
              </label>
              <label className="mt-4 block text-[11px] font-bold text-neutral-700">Guest description
                <textarea value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} maxLength={500} rows={3} placeholder="For example: Grilled chicken served with coconut rice and fresh kachumbari." className="mt-1.5 box-border w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-sm leading-5 text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
                <span className="mt-1 block text-right text-[9px] font-medium text-neutral-400">{editForm.description.length}/500</span>
              </label>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-[11px] font-bold text-neutral-700">Category <span className="text-red-500">*</span>
                  <select value={editForm.category} onChange={(event) => { setEditForm({ ...editForm, category: event.target.value }); setItemEditorError(null); }} className="mt-1.5 box-border !h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-0 text-sm font-semibold text-neutral-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10">
                    <option value="">Select {selected.type === "BAR" ? "bar" : selected.type === "RESTAURANT" ? "restaurant" : "menu"} category</option>
                    {allowedMenuCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
                <label className="block text-[11px] font-bold text-neutral-700">Selling price ({selected.currency}) <span className="text-red-500">*</span>
                  <input type="number" min={1} value={editForm.price} onChange={(event) => { setEditForm({ ...editForm, price: event.target.value }); setItemEditorError(null); }} placeholder="0" className="mt-1.5 box-border !h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-0 text-sm font-bold tabular-nums text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
                </label>
              </div>
              <label className="mt-4 block text-[11px] font-bold text-neutral-700">Internal item code <span className="font-medium text-neutral-400">(optional)</span>
                <input value={editForm.sku} onChange={(event) => setEditForm({ ...editForm, sku: event.target.value })} maxLength={50} placeholder="For example: JACK-21" className="mt-1.5 box-border !h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-0 text-sm font-semibold uppercase tracking-[0.04em] text-neutral-900 outline-none transition placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
              </label>
              {itemEditorError && <p className="mb-0 mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold leading-5 text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{itemEditorError}</p>}
            </div>
          </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-t border-neutral-100 bg-neutral-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {editing ? <button type="button" disabled={busy || uploading} onClick={() => { void patchItem(editing.id, { status: "INACTIVE" }); setEditing(null); }} className="inline-flex min-h-10 appearance-none items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-3.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"><Archive className="h-3.5 w-3.5" />Retire item</button> : <span />}
            <div className="flex gap-2 sm:justify-end">
              <button type="button" disabled={busy || uploading} onClick={closeItemEditor} className="min-h-10 flex-1 appearance-none rounded-xl border border-neutral-300 bg-white px-4 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 sm:flex-none">Cancel</button>
              <button type="button" disabled={busy || uploading} onClick={() => void saveItemEditor()} className="inline-flex min-h-10 flex-1 appearance-none items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50 sm:flex-none">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{editing ? "Save changes" : "Add to menu"}</button>
            </div>
          </div>
        </section>
      </div>
    )}
  </div>;
}

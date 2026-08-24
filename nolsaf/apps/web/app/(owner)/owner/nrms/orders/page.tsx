"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Check, ChefHat, Loader2, MessageSquareText, Minus, Plus, ReceiptText, RefreshCw, ShoppingBasket, Trash2, UtensilsCrossed, Wine } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";
import OrderHistoryPanel from "../_components/OrderHistoryPanel";
import { tallyRoomLabels } from "@/lib/roomLabels";

type MenuItem = { id: number; name: string; category: string | null; price: number; status: string; inStock?: boolean; description?: string | null };
type Outlet = { id: number; name: string; code: string; type: string; currency: string; menuItems: MenuItem[] };
type InHouse = { id: number; currency: string; guestProfile: { fullName: string } | null; allocations: Array<{ roomUnit: { code: string } | null; roomType: { name: string } | null }> };
type TablePoint = { id: number; type: "ROOM" | "TABLE"; label: string; active: boolean };
type Order = {
  id: number; orderNumber: string; status: string; settlementMode: string; currency: string; total: number; createdAt: string;
  note?: string | null; settlementMethod?: string | null; guestPaymentMethod?: string | null;
  outlet: { id: number; name: string; type: string };
  reservation: InHouse | null;
  customerLabel?: string | null;
  orderPoint?: { id: number; type: string; label: string } | null;
  items: Array<{ id: number; nameSnapshot: string; quantity: number; lineTotal: number }>;
};

const WALK_IN = "walk-in" as const;

const STATUS_STYLE: Record<string, string> = {
  PLACED: "bg-violet-50 text-violet-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  PREPARING: "bg-amber-50 text-amber-700",
  SERVING: "bg-cyan-50 text-cyan-700",
};

function money(value: number, currency: string) { return `${currency} ${value.toLocaleString()}`; }
function roomLabel(reservation: InHouse) { return tallyRoomLabels(reservation.allocations.map((row) => row.roomUnit?.code ?? row.roomType?.name), "No room"); }
function orderGuestLabel(order: Order) { return order.reservation ? (order.reservation.guestProfile?.fullName ?? "Guest") : (order.customerLabel || "Walk-in"); }
function orderRoomLabel(order: Order) { return order.reservation ? roomLabel(order.reservation) : "Walk-in"; }
function tenderLabel(value?: string | null) { return value ? value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()) : "Method not classified"; }

export default function NrmsOrdersPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "history" ? "history" : "live";
  const requestedOutletValue = Number(searchParams.get("outlet"));
  const requestedOutletId = Number.isInteger(requestedOutletValue) && requestedOutletValue > 0 ? requestedOutletValue : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("OWNER");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [guests, setGuests] = useState<InHouse[]>([]);
  const [tablePoints, setTablePoints] = useState<TablePoint[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [outletId, setOutletId] = useState<number | "">("");
  // Single dropdown, three kinds of value: "walk-in", "res-{reservationId}", "table-{orderPointId}".
  const [selection, setSelection] = useState<string>("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [settlementMode, setSettlementMode] = useState("ROOM_FOLIO");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [menuCategory, setMenuCategory] = useState("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<{ orderId: number } | null>(null);
  const [reason, setReason] = useState("");
  const [settlementTender, setSettlementTender] = useState<Record<number, string>>({});

  const load = useCallback(async (silent = false) => {
    if (!selectedPropertyId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [contextResponse, guestResponse, orderResponse, pointsResponse] = await Promise.all([
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/context`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/in-house`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/orders`, { params: { view: "live", scope: "room", ...(requestedOutletId ? { outletId: requestedOutletId } : {}) } }),
        apiClient.get<{ orderPoints: TablePoint[] }>(`/api/nrms/operations/property/${selectedPropertyId}/order-points`),
      ]);
      const nextOutlets: Outlet[] = contextResponse.data?.outlets ?? [];
      setRole(contextResponse.data?.access?.role ?? "OWNER");
      setOutlets(nextOutlets);
      setGuests(guestResponse.data?.reservations ?? []);
      setTablePoints((pointsResponse.data.orderPoints ?? []).filter((point) => point.type === "TABLE" && point.active));
      const nextOrders: Order[] = orderResponse.data?.orders ?? [];
      setOrders(nextOrders);
      setSettlementTender((current) => {
        const next = { ...current };
        for (const order of nextOrders) {
          if (!next[order.id] && order.settlementMode === "OUTLET_PAYMENT" && order.guestPaymentMethod) next[order.id] = order.guestPaymentMethod;
        }
        return next;
      });
      setOutletId((current) => requestedOutletId && nextOutlets.some((outlet) => outlet.id === requestedOutletId)
        ? requestedOutletId
        : current && nextOutlets.some((outlet) => outlet.id === current)
        ? current
        : nextOutlets[0]?.id ?? "");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load outlet operations");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [requestedOutletId, selectedPropertyId]);

  useEffect(() => {
    if (view === "history") {
      setLoading(false);
      return;
    }
    void load();
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [load, view]);

  useEffect(() => {
    setCart({});
  }, [requestedOutletId]);

  const outlet = outlets.find((item) => item.id === outletId);
  const outletScoped = requestedOutletId != null && outlet?.id === requestedOutletId;
  const visibleOutlets = outletScoped ? outlets.filter((item) => item.id === requestedOutletId) : outlets;
  const canCreate = role !== "FRONT_DESK";
  const serviceRole = selectedProperty?.nrmsAccessRole ?? role;
  const serviceLabel = serviceRole === "BAR" ? "Bar service" : serviceRole === "RESTAURANT" ? "Restaurant service" : serviceRole === "OUTLET_SUPERVISOR" ? "Outlet service" : "Restaurant & bar";
  const selectedLines = useMemo(() => (outlet?.menuItems ?? []).filter((item) => (cart[item.id] ?? 0) > 0).map((item) => ({ item, quantity: cart[item.id] })), [cart, outlet]);
  const menuCategories = useMemo(() => Array.from(new Set((outlet?.menuItems ?? []).map((item) => item.category || "Uncategorised"))), [outlet]);
  const visibleMenuItems = useMemo(() => (outlet?.menuItems ?? []).filter((item) => menuCategory === "ALL" || (item.category || "Uncategorised") === menuCategory), [menuCategory, outlet]);
  const isBarMenu = outlet?.type === "BAR";
  const MenuItemIcon = isBarMenu ? Wine : UtensilsCrossed;
  const menuTone = isBarMenu
    ? {
        header: "border-sky-100 bg-gradient-to-r from-sky-50 via-cyan-50/60 to-white",
        eyebrow: "text-sky-700",
        filterActive: "border-sky-700 bg-sky-700 text-white shadow-sm shadow-sky-200",
        filterIdle: "border-neutral-200 bg-white text-neutral-600 hover:border-sky-200 hover:text-sky-800",
        cardActive: "border-sky-300 bg-gradient-to-br from-sky-50 to-cyan-50/60 shadow-sm shadow-sky-100",
        cardIdle: "border-neutral-200 bg-gradient-to-br from-white to-sky-50/30 hover:border-sky-200 hover:shadow-sm",
        icon: "bg-sky-100 text-sky-700 ring-sky-200",
        price: "text-sky-800",
        add: "border-sky-200 bg-white text-sky-700 group-hover:bg-sky-700 group-hover:text-white",
        quantity: "bg-sky-700 text-white",
      }
    : {
        header: "border-emerald-100 bg-gradient-to-r from-emerald-50 via-lime-50/45 to-white",
        eyebrow: "text-emerald-700",
        filterActive: "border-emerald-700 bg-emerald-700 text-white shadow-sm shadow-emerald-200",
        filterIdle: "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200 hover:text-emerald-800",
        cardActive: "border-emerald-300 bg-gradient-to-br from-emerald-50 to-lime-50/50 shadow-sm shadow-emerald-100",
        cardIdle: "border-neutral-200 bg-gradient-to-br from-white to-emerald-50/25 hover:border-emerald-200 hover:shadow-sm",
        icon: "bg-emerald-100 text-emerald-700 ring-emerald-200",
        price: "text-emerald-800",
        add: "border-emerald-200 bg-white text-emerald-700 group-hover:bg-emerald-700 group-hover:text-white",
        quantity: "bg-emerald-700 text-white",
      };
  const cartTotal = selectedLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);

  useEffect(() => {
    setMenuCategory("ALL");
  }, [outletId]);

  const changeQuantity = (id: number, delta: number) => setCart((current) => {
    const quantity = Math.max(0, (current[id] ?? 0) + delta);
    const next = { ...current };
    if (quantity === 0) delete next[id]; else next[id] = quantity;
    return next;
  });

  const isWalkIn = selection === WALK_IN;
  const selectedReservationId = selection.startsWith("res-") ? Number(selection.slice(4)) : null;
  const selectedTableId = selection.startsWith("table-") ? Number(selection.slice(6)) : null;
  const isGenericWalkIn = isWalkIn && !selectedTableId;

  const createOrder = async () => {
    if (!selectedPropertyId || !outletId || !selection || selectedLines.length === 0) return;
    setBusy("create"); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/orders`, {
        outletId,
        reservationId: selectedReservationId,
        orderPointId: selectedTableId,
        customerLabel: isGenericWalkIn ? (customerLabel.trim() || undefined) : undefined,
        settlementMode: selectedReservationId ? settlementMode : "OUTLET_PAYMENT",
        note: note.trim() || undefined,
        items: selectedLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
      });
      setCart({}); setNote(""); setSelection(""); setCustomerLabel("");
      await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to confirm order"); }
    finally { setBusy(null); }
  };

  const advance = async (order: Order) => {
    const orderId = order.id;
    setBusy(`advance-${orderId}`); setError(null);
    const settlementMethod = order.status === "SERVING" && order.settlementMode === "OUTLET_PAYMENT" ? settlementTender[order.id] : undefined;
    if (order.status === "SERVING" && order.settlementMode === "OUTLET_PAYMENT" && !settlementMethod) {
      setBusy(null); setError("Select how the outlet payment was received before settling the order."); return;
    }
    try { await apiClient.post(`/api/nrms/operations/orders/${orderId}/advance`, { settlementMethod }); await load(); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Failed to advance order"); }
    finally { setBusy(null); }
  };

  const submitReason = async () => {
    if (!reasonAction || reason.trim().length < 3) return;
    setBusy(`cancel-${reasonAction.orderId}`); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${reasonAction.orderId}/cancel`, { reason: reason.trim() });
      setReasonAction(null); setReason(""); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to cancel order"); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading orders…</div>;

  if (view === "history") {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
        <div>
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">{serviceLabel}</p>
          <h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Room order history</h2>
          <p className="mb-0 mt-1 text-xs text-neutral-500">Completed, cancelled and voided room orders, kept separate from live outlet operations.</p>
        </div>
        {selectedPropertyId && <OrderHistoryPanel propertyId={selectedPropertyId} scope="room" />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">{serviceLabel}</p><h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">{outletScoped ? `${outlet?.name} order control` : "Outlet order control"}</h2><p className="mb-0 mt-1 text-xs text-neutral-500">{outletScoped ? `Create and manage orders for ${outlet?.name} only.` : "Itemised service orders for room guests and walk-in customers."}</p></div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      {outlets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center"><StoreIcon /><h3 className="mt-3 text-base font-bold text-neutral-900">No outlet configured</h3><p className="mt-1 text-sm text-neutral-500">Create a restaurant or bar under Outlets & menus before recording orders.</p></div>
      ) : (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(23rem,0.8fr)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 bg-neutral-50/70 p-4">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm"><ReceiptText className="h-4 w-4" /></span>
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-bold text-neutral-950">Build an order</p>
                    <p className="mb-0 mt-0.5 text-[10px] leading-4 text-neutral-500">Choose who is being served, then browse an outlet menu.</p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-700">Step 1 · Destination</span>
              </div>
              <label className="mt-4 block min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Serve order to<span className="text-red-500"> *</span><select value={selection} onChange={(event) => setSelection(event.target.value)} className={`mt-1.5 box-border !h-11 w-full min-w-0 rounded-lg border px-3 py-0 text-sm font-semibold normal-case tracking-normal outline-none transition focus:bg-white focus:ring-2 ${selection ? "border-emerald-300 bg-emerald-50/50 text-emerald-900 focus:border-emerald-500 focus:ring-emerald-500/10" : "border-neutral-300 bg-white text-neutral-600 focus:border-emerald-500 focus:ring-emerald-500/10"}`}>
                <option value="">Select room guest, table or walk-in</option>
                <option value={WALK_IN}>Walk-in customer</option>
                {tablePoints.length > 0 && <optgroup label="Tables">{tablePoints.map((point) => <option key={point.id} value={`table-${point.id}`}>{point.label}</option>)}</optgroup>}
                {guests.length > 0 && <optgroup label="Checked-in room guests">{guests.map((guest) => <option key={guest.id} value={`res-${guest.id}`}>{roomLabel(guest)} · {guest.guestProfile?.fullName ?? "Guest"}</option>)}</optgroup>}
              </select></label>
            </div>
            {isGenericWalkIn && (
              <label className="mx-4 mt-4 block min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Customer name or reference <span className="font-medium normal-case tracking-normal text-neutral-400">(optional)</span><input value={customerLabel} onChange={(event) => setCustomerLabel(event.target.value)} maxLength={120} placeholder="For example, Asha or counter guest" autoComplete="off" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" /></label>
            )}

            <div className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-500">{outletScoped ? "Outlet workspace" : "Step 2 · Choose outlet"}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{outletScoped ? `Showing only ${outlet?.name} and its menu.` : "Switching outlets clears the current item selection."}</p></div>
                {outlet && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700">{outlet.menuItems.length} menu {outlet.menuItems.length === 1 ? "item" : "items"}</span>}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
                {visibleOutlets.map((item) => {
                  const selected = item.id === outletId;
                  const OutletIcon = item.type === "BAR" ? Wine : UtensilsCrossed;
                  return (
                    <button key={item.id} type="button" aria-pressed={selected} disabled={outletScoped} onClick={() => { if (!selected) { setOutletId(item.id); setCart({}); } }} className={`box-border flex min-h-16 min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-default ${selected ? "border-emerald-300 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-100" : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50"}`}>
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${selected ? "border-emerald-200 bg-white text-emerald-700" : item.type === "BAR" ? "border-sky-100 bg-sky-50 text-sky-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}><OutletIcon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-neutral-950">{item.name}</span><span className="mt-0.5 block truncate text-[9px] font-medium uppercase tracking-[0.08em] text-neutral-400">{item.code} · {item.menuItems.length} {item.menuItems.length === 1 ? "item" : "items"}</span></span>
                      {selected && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Check className="h-3 w-3" /></span>}
                    </button>
                  );
                })}
              </div>

              <div className={`mt-4 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 ${menuTone.header}`}>
                <div className="flex min-w-0 items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ${menuTone.eyebrow} ${isBarMenu ? "ring-sky-100" : "ring-emerald-100"}`}><MenuItemIcon className="h-4 w-4" /></span><div className="min-w-0"><p className={`m-0 text-[9px] font-bold uppercase tracking-[0.14em] ${menuTone.eyebrow}`}>Menu</p><h3 className="mb-0 mt-0.5 truncate text-sm font-bold text-neutral-950">{outlet?.name ?? "Select an outlet"}</h3></div></div>
                {selectedLines.length > 0 && <span className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-[9px] font-bold text-white">{selectedLines.reduce((sum, line) => sum + line.quantity, 0)} in order</span>}
              </div>
              {menuCategories.length > 1 && (
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" aria-label="Menu categories">
                  <button type="button" onClick={() => setMenuCategory("ALL")} aria-pressed={menuCategory === "ALL"} className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[10px] font-bold transition ${menuCategory === "ALL" ? menuTone.filterActive : menuTone.filterIdle}`}>All <span className="ml-1.5 opacity-70">{outlet?.menuItems.length ?? 0}</span></button>
                  {menuCategories.map((category) => {
                    const count = (outlet?.menuItems ?? []).filter((item) => (item.category || "Uncategorised") === category).length;
                    return <button key={category} type="button" onClick={() => setMenuCategory(category)} aria-pressed={menuCategory === category} className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[10px] font-bold transition ${menuCategory === category ? menuTone.filterActive : menuTone.filterIdle}`}>{category}<span className="ml-1.5 opacity-70">{count}</span></button>;
                  })}
                </div>
              )}
              <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2.5">
                {visibleMenuItems.map((menuItem) => {
                  const outOfStock = menuItem.inStock === false;
                  const quantity = cart[menuItem.id] ?? 0;
                  return (
                    <button key={menuItem.id} type="button" onClick={() => changeQuantity(menuItem.id, 1)} disabled={!canCreate || outOfStock} title={outOfStock ? "Out of stock today" : `Add ${menuItem.name} to the order`} className={`group relative box-border flex min-h-[5.25rem] min-w-0 items-center gap-3 overflow-hidden rounded-xl border p-3 text-left transition duration-200 disabled:cursor-not-allowed ${outOfStock ? "border-neutral-200 bg-neutral-50 opacity-60" : quantity > 0 ? menuTone.cardActive : `${menuTone.cardIdle} disabled:opacity-50`}`}>
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${menuTone.icon}`}><MenuItemIcon className="h-[18px] w-[18px]" /></span>
                      <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-bold text-neutral-950">{menuItem.name}</span>{quantity > 0 && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold ${menuTone.quantity}`}>×{quantity}</span>}</span><span className="mt-1 block truncate text-[9px] font-medium text-neutral-400">{menuItem.category || "Uncategorised"}</span><strong className={`mt-2 block text-xs tabular-nums ${menuTone.price}`}>{money(menuItem.price, outlet?.currency ?? "Currency not set")}</strong></span>
                      {outOfStock ? <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-600">Out</span> : <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm transition ${menuTone.add}`}><Plus className="h-4 w-4" /></span>}
                    </button>
                  );
                })}
              </div>
              {visibleMenuItems.length === 0 && <div className="mt-3 rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-xs text-neutral-400">{(outlet?.menuItems.length ?? 0) === 0 ? "No active items entered for this outlet." : "No active items in this category."}</div>}
            </div>
          </section>

          <section className="min-w-0 self-start rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm xl:sticky xl:top-4">
            <div className="flex items-center justify-between gap-3"><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700">Step 3 · Review &amp; confirm</p><h3 className="mb-0 mt-0.5 text-sm font-bold text-neutral-900">Current order</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Confirmed orders enter the outlet queue immediately.</p></div><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShoppingBasket className="h-5 w-5" /></span></div>
            <div className={`mt-3 space-y-2 ${selectedLines.length === 0 ? "min-h-28" : ""}`}>
              {selectedLines.length === 0 ? <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-7 text-center"><ShoppingBasket className="h-5 w-5 text-neutral-300" /><p className="mb-0 mt-2 text-xs font-bold text-neutral-500">Your order is empty</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">Choose an item from the menu to add it here.</p></div> : selectedLines.map(({ item, quantity }) => (
                <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-bold text-neutral-800">{item.name}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{money(item.price, outlet?.currency ?? "Currency not set")} each</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => changeQuantity(item.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white"><Minus className="h-3 w-3" /></button><span className="w-6 text-center text-xs font-bold">{quantity}</span><button type="button" onClick={() => changeQuantity(item.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white"><Plus className="h-3 w-3" /></button></div><strong className="w-24 shrink-0 text-right text-xs tabular-nums">{money(item.price * quantity, outlet?.currency ?? "Currency not set")}</strong></div>
              ))}
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Payment handling<span className="text-red-500"> *</span><select value={!selectedReservationId ? "OUTLET_PAYMENT" : settlementMode} disabled={!selectedReservationId} onChange={(event) => setSettlementMode(event.target.value)} className={`mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border px-3 py-0 text-sm font-medium normal-case tracking-normal outline-none focus:bg-white focus:ring-2 disabled:cursor-not-allowed disabled:opacity-80 ${(!selectedReservationId ? "OUTLET_PAYMENT" : settlementMode) === "OUTLET_PAYMENT" ? "border-emerald-300 bg-emerald-50/40 text-emerald-800 focus:border-emerald-500 focus:ring-emerald-500/10" : "border-blue-300 bg-blue-50/40 text-blue-800 focus:border-blue-500 focus:ring-blue-500/10"}`}>{Boolean(selectedReservationId) && <option value="ROOM_FOLIO">Charge to room folio</option>}<option value="OUTLET_PAYMENT">Collect at outlet</option></select></label>
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Order note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Optional" autoComplete="off" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" /></label>
            </div>
            <div className={`mt-2 rounded-lg border px-3 py-2 text-[10px] leading-4 ${(!selectedReservationId || settlementMode === "OUTLET_PAYMENT") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
              {isGenericWalkIn
                ? <><strong>Walk-in sale:</strong> non-resident customers always pay at the outlet. The order becomes paid revenue after outlet staff select Serve &amp; settle.</>
                : selectedTableId
                ? <><strong>Table order:</strong> pays at the outlet, attributed to this table. The order becomes paid revenue after outlet staff select Serve &amp; settle.</>
                : settlementMode === "OUTLET_PAYMENT"
                ? <><strong>Collect at outlet:</strong> confirming records the order as awaiting service. It becomes paid revenue only after outlet staff select Serve &amp; settle.</>
                : <><strong>Charge to room:</strong> confirming records the order as awaiting service. It is added to the guest folio only after outlet staff select Serve &amp; post.</>}
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Order total</p><p className="mb-0 mt-0.5 text-lg font-bold tabular-nums text-neutral-950">{money(cartTotal, outlet?.currency ?? "Currency not set")}</p></div><button type="button" onClick={() => void createOrder()} disabled={!canCreate || busy === "create" || !selection || selectedLines.length === 0} className="box-border inline-flex !h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none sm:w-auto">{busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirm order</button></div>
          </section>
        </div>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Live order queue · {outletScoped ? outlet?.name : "in-room"}</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{outletScoped ? `Only active room and in-house guest orders from ${outlet?.name}.` : "Room and in-house guest orders. Table and walk-in orders live in Tables & tabs."}</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-500">{orders.length} orders</span></div>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.map((order) => {
            const tenderRequired = order.status === "SERVING" && order.settlementMode === "OUTLET_PAYMENT";
            const tenderSelected = Boolean(settlementTender[order.id]);
            const advanceDisabled = busy === `advance-${order.id}` || (tenderRequired && !tenderSelected);
            return (
              <article key={order.id} className="min-w-0 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{order.orderNumber} · {order.outlet.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">{order.reservation ? `${orderRoomLabel(order)} · ${orderGuestLabel(order)}` : order.orderPoint ? `${order.orderPoint.type === "ROOM" ? "Room" : "Table"} ${order.orderPoint.label} · Guest QR order` : `${orderRoomLabel(order)} · ${orderGuestLabel(order)}`}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${STATUS_STYLE[order.status] ?? "bg-neutral-100 text-neutral-600"}`}>{order.status === "PLACED" ? "NEW · QR" : order.status.replaceAll("_", " ")}</span>
                </div>
                <div className="mt-3 space-y-1">{order.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-[11px] text-neutral-600"><span className="truncate">{item.quantity}× {item.nameSnapshot}</span><span className="shrink-0 tabular-nums">{money(item.lineTotal, order.currency)}</span></div>)}</div>
                {order.note && (
                  <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-900"><MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /><span><strong className="font-bold">Guest note:</strong> {order.note}</span></div>
                )}
                {order.settlementMode === "OUTLET_PAYMENT" && order.guestPaymentMethod && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-[10px] text-blue-800"><span><strong>Guest selected:</strong> {tenderLabel(order.guestPaymentMethod)}</span><span className="shrink-0 font-semibold text-blue-600">Not yet confirmed</span></div>
                )}
                {tenderRequired && (
                  <label className="mt-3 block text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                    Confirm payment received by <span className="text-red-500">*</span>
                    <select required value={settlementTender[order.id] ?? ""} onChange={(event) => setSettlementTender((current) => ({ ...current, [order.id]: event.target.value }))} className={`mt-1 h-9 w-full rounded-lg border bg-white px-2 text-[11px] font-semibold normal-case outline-none ${tenderSelected ? "border-emerald-300 text-neutral-800 focus:border-emerald-500" : "border-amber-300 text-neutral-500 focus:border-amber-500"}`}>
                      <option value="">Select payment method</option><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option>
                    </select>
                    {!tenderSelected ? <span className="mt-1 block text-[9px] font-medium normal-case tracking-normal text-amber-700">Required before this order can be settled.</span> : <span className="mt-1 block text-[9px] font-medium normal-case tracking-normal text-neutral-500">Guest choice is prefilled. Change it only when the payment actually received is different.</span>}
                  </label>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
                  <strong className="text-sm tabular-nums">{money(order.total, order.currency)}</strong>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setReasonAction({ orderId: order.id })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-[10px] font-bold text-red-600"><Trash2 className="h-3 w-3" />{order.status === "PLACED" ? "Decline" : "Cancel"}</button>
                    {role !== "FRONT_DESK" && <button type="button" onClick={() => void advance(order)} disabled={advanceDisabled} title={tenderRequired && !tenderSelected ? "Confirm the payment method actually received before completing service" : order.status === "PREPARING" ? "Start delivery without recording payment" : undefined} className={`inline-flex h-8 items-center gap-1 rounded-lg border-0 px-2.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 ${order.status === "PLACED" ? "bg-violet-700 hover:bg-violet-800" : order.status === "PREPARING" ? "bg-cyan-700 hover:bg-cyan-800" : "bg-neutral-900"}`}>{busy === `advance-${order.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : order.status === "PLACED" ? <Check className="h-3 w-3" /> : order.status === "CONFIRMED" ? <ChefHat className="h-3 w-3" /> : <ReceiptText className="h-3 w-3" />}{order.status === "PLACED" ? "Accept" : order.status === "CONFIRMED" ? "Prepare" : order.status === "PREPARING" ? "Take to guest" : order.settlementMode === "ROOM_FOLIO" ? "Complete & post" : "Confirm served & paid"}</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {orders.length === 0 && <div className="rounded-xl border border-dashed border-neutral-200 py-10 text-center"><Check className="mx-auto h-5 w-5 text-emerald-600" /><p className="mb-0 mt-2 text-xs font-bold text-neutral-600">No active outlet orders</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">Completed orders are available under Room order history.</p></div>}
      </section>

      {reasonAction && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-neutral-950/45 p-3 sm:p-4">
          <section className="box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5">
            <div className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-red-600" /><h3 className="m-0 min-w-0 truncate text-base font-bold text-neutral-950">Cancel order</h3></div>
            <p className="mb-0 mt-2 text-xs leading-5 text-neutral-500">This action is permanently recorded with your account and timestamp.</p>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="Reason required" className="mt-4 box-border h-24 w-full max-w-full resize-none rounded-lg border border-neutral-300 p-3 text-sm outline-none focus:border-red-400" />
            <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
              <button type="button" onClick={() => { setReasonAction(null); setReason(""); }} className="box-border min-h-10 min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Keep order</button>
              <button type="button" onClick={() => void submitReason()} disabled={reason.trim().length < 3 || busy != null} className="box-border min-h-10 min-w-0 rounded-lg border-0 bg-red-600 px-3 text-xs font-bold text-white disabled:bg-red-200 disabled:text-red-500">Record cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StoreIcon() { return <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500"><UtensilsCrossed className="h-5 w-5" /></span>; }

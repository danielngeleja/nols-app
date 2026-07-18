"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, Coins, History, Loader2, Minus, Plus, ReceiptText, RefreshCw, ShoppingBasket, Trash2, UtensilsCrossed, Wine } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type MenuItem = { id: number; name: string; category: string | null; price: number; status: string; inStock?: boolean; description?: string | null };
type Outlet = { id: number; name: string; code: string; type: string; currency: string; menuItems: MenuItem[] };
type Attendant = { id: number; fullName?: string | null; name?: string | null; role: string; outletId: number | null };
type InHouse = { id: number; currency: string; guestProfile: { fullName: string } | null; allocations: Array<{ roomUnit: { code: string } | null; roomType: { name: string } | null }> };
type Order = {
  id: number; orderNumber: string; status: string; settlementMode: string; currency: string; total: number; createdAt: string;
  note?: string | null; settlementMethod?: string | null; guestPaymentMethod?: string | null; postedAt?: string | null; settledAt?: string | null; cancelledAt?: string | null; voidedAt?: string | null;
  guestRating?: number | null; guestFeedback?: string | null; tipIntent?: string | null; tipSuggestedAmount?: number | null; feedbackAt?: string | null;
  paymentAmountReceived?: number | null; tipAmount?: number | null; tipMethod?: string | null; tipConfirmedAt?: string | null;
  settledBy?: { id: number; fullName?: string | null; name?: string | null } | null;
  tipRecipient?: { id: number; fullName?: string | null; name?: string | null } | null;
  outlet: { id: number; name: string; type: string };
  reservation: InHouse | null;
  customerLabel?: string | null;
  orderPoint?: { id: number; type: string; label: string } | null;
  items: Array<{ id: number; nameSnapshot: string; quantity: number; lineTotal: number }>;
};

const WALK_IN = "walk-in" as const;

const HISTORY_PAGE_SIZE = 12;
const HISTORY_FILTERS = [
  { value: "", label: "All completed orders" },
  { value: "SETTLED", label: "Paid at outlet" },
  { value: "POSTED_TO_FOLIO", label: "Posted to folio" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "VOIDED", label: "Voided" },
];

const STATUS_STYLE: Record<string, string> = {
  PLACED: "bg-violet-50 text-violet-700",
  CONFIRMED: "bg-blue-50 text-blue-700",
  PREPARING: "bg-amber-50 text-amber-700",
  SERVING: "bg-cyan-50 text-cyan-700",
  POSTED_TO_FOLIO: "bg-emerald-50 text-emerald-700",
  SETTLED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
  VOIDED: "bg-red-50 text-red-600",
};

function money(value: number, currency: string) { return `${currency} ${value.toLocaleString()}`; }
function roomLabel(reservation: InHouse) { return reservation.allocations.map((row) => row.roomUnit?.code ?? row.roomType?.name).filter(Boolean).join(", ") || "No room"; }
function orderGuestLabel(order: Order) { return order.reservation ? (order.reservation.guestProfile?.fullName ?? "Guest") : (order.customerLabel || "Walk-in"); }
function orderRoomLabel(order: Order) { return order.reservation ? roomLabel(order.reservation) : "Walk-in"; }
function orderRecordedAt(order: Order) { return order.settledAt || order.postedAt || order.cancelledAt || order.voidedAt || order.createdAt; }
function shortDateTime(value: string) { return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function tenderLabel(value?: string | null) { return value ? value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()) : "Method not classified"; }
function attendantName(value?: { fullName?: string | null; name?: string | null } | null) { return value?.fullName || value?.name || "Team member"; }

export default function NrmsOrdersPage() {
  const { selectedPropertyId } = useNrms();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("OWNER");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [guests, setGuests] = useState<InHouse[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyStatus, setHistoryStatus] = useState("");
  const [outletId, setOutletId] = useState<number | "">("");
  const [reservationId, setReservationId] = useState<number | "" | typeof WALK_IN>("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [settlementMode, setSettlementMode] = useState("ROOM_FOLIO");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<{ orderId: number; action: "cancel" | "void" } | null>(null);
  const [reason, setReason] = useState("");
  const [settlementTender, setSettlementTender] = useState<Record<number, string>>({});
  const [tipAction, setTipAction] = useState<{ order: Order; amountReceived: string; tipAmount: string; recipientId: string; method: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!selectedPropertyId) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const historyQuery = new URLSearchParams({ view: "history", limit: String(HISTORY_PAGE_SIZE), offset: String(historyPage * HISTORY_PAGE_SIZE) });
      if (historyStatus) historyQuery.set("status", historyStatus);
      const [contextResponse, guestResponse, orderResponse, historyResponse] = await Promise.all([
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/context`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/in-house`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/orders?view=live`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/orders?${historyQuery.toString()}`),
      ]);
      const nextOutlets: Outlet[] = contextResponse.data?.outlets ?? [];
      setRole(contextResponse.data?.access?.role ?? "OWNER");
      setCurrentUserId(Number(contextResponse.data?.access?.userId) || null);
      setOutlets(nextOutlets);
      setAttendants(contextResponse.data?.attendants ?? []);
      setGuests(guestResponse.data?.reservations ?? []);
      const nextOrders: Order[] = orderResponse.data?.orders ?? [];
      setOrders(nextOrders);
      setSettlementTender((current) => {
        const next = { ...current };
        for (const order of nextOrders) {
          if (!next[order.id] && order.settlementMode === "OUTLET_PAYMENT" && order.guestPaymentMethod) next[order.id] = order.guestPaymentMethod;
        }
        return next;
      });
      setHistoryOrders(historyResponse.data?.orders ?? []);
      setHistoryTotal(historyResponse.data?.total ?? 0);
      setOutletId((current) => current && nextOutlets.some((outlet) => outlet.id === current) ? current : nextOutlets[0]?.id ?? "");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load outlet operations");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [historyPage, historyStatus, selectedPropertyId]);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const outlet = outlets.find((item) => item.id === outletId);
  const canCreate = role !== "FRONT_DESK";
  const selectedLines = useMemo(() => (outlet?.menuItems ?? []).filter((item) => (cart[item.id] ?? 0) > 0).map((item) => ({ item, quantity: cart[item.id] })), [cart, outlet]);
  const cartTotal = selectedLines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const historyPageCount = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));
  const tipEligibleAttendants = useMemo(() => {
    if (!tipAction) return [];
    const canAssignOthers = ["OWNER", "MANAGER", "OUTLET_SUPERVISOR"].includes(role);
    return attendants.filter((attendant) => (attendant.outletId == null || attendant.outletId === tipAction.order.outlet.id) && (canAssignOthers || attendant.id === currentUserId));
  }, [attendants, currentUserId, role, tipAction]);
  const tipDraftAmount = Number(tipAction?.tipAmount || 0);
  const tipDraftReceived = Number(tipAction?.amountReceived || 0);
  const tipOverpayment = tipAction?.order.settlementMode === "OUTLET_PAYMENT" && Number.isFinite(tipDraftReceived) ? Math.max(0, tipDraftReceived - tipAction.order.total) : 0;
  const tipChangeDue = tipAction?.order.settlementMode === "OUTLET_PAYMENT" ? Math.max(0, tipOverpayment - (Number.isFinite(tipDraftAmount) ? tipDraftAmount : 0)) : 0;

  const changeQuantity = (id: number, delta: number) => setCart((current) => {
    const quantity = Math.max(0, (current[id] ?? 0) + delta);
    const next = { ...current };
    if (quantity === 0) delete next[id]; else next[id] = quantity;
    return next;
  });

  const isWalkIn = reservationId === WALK_IN;

  const createOrder = async () => {
    if (!selectedPropertyId || !outletId || !reservationId || selectedLines.length === 0) return;
    setBusy("create"); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/orders`, {
        outletId,
        reservationId: isWalkIn ? null : reservationId,
        customerLabel: isWalkIn ? (customerLabel.trim() || undefined) : undefined,
        settlementMode: isWalkIn ? "OUTLET_PAYMENT" : settlementMode,
        note: note.trim() || undefined,
        items: selectedLines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
      });
      setCart({}); setNote(""); setReservationId(""); setCustomerLabel("");
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

  const openTipFlow = (order: Order) => {
    setError(null);
    const canAssignOthers = ["OWNER", "MANAGER", "OUTLET_SUPERVISOR"].includes(role);
    const preferredRecipient = order.tipRecipient?.id ?? (canAssignOthers ? order.settledBy?.id : currentUserId) ?? currentUserId;
    setTipAction({
      order,
      amountReceived: String(order.paymentAmountReceived ?? order.total),
      tipAmount: order.tipAmount != null ? String(order.tipAmount) : "0",
      recipientId: preferredRecipient ? String(preferredRecipient) : "",
      method: order.tipMethod || order.settlementMethod || "CASH",
    });
  };

  const saveTipFlow = async () => {
    if (!tipAction) return;
    const tipAmount = Number(tipAction.tipAmount || 0);
    const amountReceived = Number(tipAction.amountReceived);
    if (!Number.isFinite(tipAmount) || tipAmount < 0) { setError("Enter a valid tip amount."); return; }
    if (tipAction.order.settlementMode === "OUTLET_PAYMENT" && (!Number.isFinite(amountReceived) || amountReceived < tipAction.order.total)) { setError("Amount received must cover the order bill."); return; }
    if (tipAmount > 0 && (!tipAction.recipientId || !tipAction.method)) { setError("Select the team member who served the order and how the tip was received."); return; }
    setBusy(`tip-${tipAction.order.id}`); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${tipAction.order.id}/tip`, {
        paymentAmountReceived: tipAction.order.settlementMode === "OUTLET_PAYMENT" ? amountReceived : null,
        tipAmount,
        tipRecipientId: tipAmount > 0 ? Number(tipAction.recipientId) : null,
        tipMethod: tipAmount > 0 ? tipAction.method : null,
      });
      setTipAction(null);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save the payment and tip breakdown.");
    } finally {
      setBusy(null);
    }
  };

  const submitReason = async () => {
    if (!reasonAction || reason.trim().length < 3) return;
    setBusy(`${reasonAction.action}-${reasonAction.orderId}`); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${reasonAction.orderId}/${reasonAction.action}`, { reason: reason.trim() });
      setReasonAction(null); setReason(""); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || `Failed to ${reasonAction.action} order`); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading orders…</div>;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">{role === "BAR" ? "Bar service" : role === "RESTAURANT" ? "Restaurant service" : role === "OUTLET_SUPERVISOR" ? "Outlet service" : "Restaurant & bar"}</p><h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Outlet order control</h2><p className="mb-0 mt-1 text-xs text-neutral-500">Itemised service orders for room guests and walk-in customers.</p></div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      {outlets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center"><StoreIcon /><h3 className="mt-3 text-base font-bold text-neutral-900">No outlet configured</h3><p className="mt-1 text-sm text-neutral-500">Create a restaurant or bar under Outlets & menus before recording orders.</p></div>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(25rem,1.1fr)]">
          <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.9fr)] sm:items-end">
              <div className="min-w-0">
                <p className="m-0 text-sm font-bold text-neutral-900">Outlet ledger</p>
                <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Open an outlet to view and select its entered items.</p>
              </div>
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Customer<span className="text-red-500"> *</span><select value={reservationId} onChange={(event) => setReservationId(event.target.value === WALK_IN ? WALK_IN : event.target.value ? Number(event.target.value) : "")} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-blue-300 bg-blue-50/40 px-3 py-0 text-sm font-medium normal-case tracking-normal text-blue-800 outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10"><option value="">Room guest or walk-in?</option><option value={WALK_IN}>Walk-in customer (not staying here)</option>{guests.map((guest) => <option key={guest.id} value={guest.id}>{roomLabel(guest)} · {guest.guestProfile?.fullName ?? "Guest"}</option>)}</select></label>
            </div>
            {isWalkIn && (
              <label className="mt-3 block min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Customer label<input value={customerLabel} onChange={(event) => setCustomerLabel(event.target.value)} maxLength={120} placeholder="e.g. Table 4, a name (optional)" autoComplete="off" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" /></label>
            )}

            <div className="mt-4 space-y-2">
              {outlets.map((item) => {
                const expanded = item.id === outletId;
                const OutletIcon = item.type === "BAR" ? Wine : UtensilsCrossed;
                return (
                  <div key={item.id} className={`overflow-hidden rounded-lg border transition ${expanded ? "border-emerald-400 bg-white shadow-sm" : "border-neutral-300 bg-neutral-50"}`}>
                    <button type="button" aria-expanded={expanded} onClick={() => { setOutletId(expanded ? "" : item.id); setCart({}); }} className={`box-border flex !min-h-12 w-full min-w-0 items-center gap-3 border-0 px-3 py-2 text-left hover:bg-emerald-50/60 ${expanded ? "bg-emerald-50/70" : "bg-transparent"}`}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${expanded ? "bg-emerald-100 text-emerald-800" : "bg-white text-neutral-500"}`}><OutletIcon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-neutral-900">{item.name}</span><span className="mt-0.5 block text-[9px] uppercase tracking-wide text-neutral-400">{item.type.toLowerCase()} · {item.menuItems.length} {item.menuItems.length === 1 ? "item" : "items"}</span></span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>

                    {expanded && (
                      <div className="border-t border-emerald-200 bg-white">
                        {item.menuItems.map((menuItem) => {
                          const outOfStock = menuItem.inStock === false;
                          return (
                            <button key={menuItem.id} type="button" onClick={() => changeQuantity(menuItem.id, 1)} disabled={!canCreate || outOfStock} title={outOfStock ? "Out of stock today" : undefined} className={`box-border flex min-h-12 w-full min-w-0 items-center gap-3 border-0 border-b border-neutral-100 px-3 py-2 text-left transition last:border-b-0 disabled:cursor-not-allowed ${outOfStock ? "bg-neutral-50 opacity-60" : "bg-white hover:bg-emerald-50 disabled:opacity-50"}`}>
                              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-neutral-800">{menuItem.name}</span><span className="mt-0.5 block truncate text-[10px] text-neutral-400">{menuItem.category || "Uncategorised"}</span></span>
                              {outOfStock && <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-600">Out of stock</span>}
                              <strong className="shrink-0 text-xs tabular-nums text-emerald-700">{money(menuItem.price, item.currency)}</strong>
                              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${outOfStock ? "bg-neutral-100 text-neutral-400" : "bg-emerald-100 text-emerald-800"}`}><Plus className="h-3.5 w-3.5" /></span>
                            </button>
                          );
                        })}
                        {item.menuItems.length === 0 && <div className="px-4 py-6 text-center text-xs text-neutral-400">No active items entered for this outlet.</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Current order</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Confirmed orders enter the outlet queue immediately.</p></div><ShoppingBasket className="h-5 w-5 text-emerald-700" /></div>
            <div className={`mt-3 space-y-2 ${selectedLines.length === 0 ? "min-h-28" : ""}`}>
              {selectedLines.length === 0 ? <div className="rounded-xl border border-dashed border-neutral-200 py-9 text-center text-xs text-neutral-400">Select menu items to begin.</div> : selectedLines.map(({ item, quantity }) => (
                <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-neutral-50 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="m-0 truncate text-xs font-bold text-neutral-800">{item.name}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{money(item.price, outlet?.currency ?? "Currency not set")} each</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => changeQuantity(item.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white"><Minus className="h-3 w-3" /></button><span className="w-6 text-center text-xs font-bold">{quantity}</span><button type="button" onClick={() => changeQuantity(item.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white"><Plus className="h-3 w-3" /></button></div><strong className="w-24 shrink-0 text-right text-xs tabular-nums">{money(item.price * quantity, outlet?.currency ?? "Currency not set")}</strong></div>
              ))}
            </div>
            <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Payment handling<span className="text-red-500"> *</span><select value={isWalkIn ? "OUTLET_PAYMENT" : settlementMode} disabled={isWalkIn} onChange={(event) => setSettlementMode(event.target.value)} className={`mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border px-3 py-0 text-sm font-medium normal-case tracking-normal outline-none focus:bg-white focus:ring-2 disabled:cursor-not-allowed disabled:opacity-80 ${(isWalkIn ? "OUTLET_PAYMENT" : settlementMode) === "OUTLET_PAYMENT" ? "border-emerald-300 bg-emerald-50/40 text-emerald-800 focus:border-emerald-500 focus:ring-emerald-500/10" : "border-blue-300 bg-blue-50/40 text-blue-800 focus:border-blue-500 focus:ring-blue-500/10"}`}>{!isWalkIn && <option value="ROOM_FOLIO">Charge to room folio</option>}<option value="OUTLET_PAYMENT">Collect at outlet</option></select></label>
              <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Order note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Optional" autoComplete="off" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" /></label>
            </div>
            <div className={`mt-2 rounded-lg border px-3 py-2 text-[10px] leading-4 ${(isWalkIn || settlementMode === "OUTLET_PAYMENT") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
              {isWalkIn
                ? <><strong>Walk-in sale:</strong> non-resident customers always pay at the outlet. The order becomes paid revenue after outlet staff select Serve &amp; settle.</>
                : settlementMode === "OUTLET_PAYMENT"
                ? <><strong>Collect at outlet:</strong> confirming records the order as awaiting service. It becomes paid revenue only after outlet staff select Serve &amp; settle.</>
                : <><strong>Charge to room:</strong> confirming records the order as awaiting service. It is added to the guest folio only after outlet staff select Serve &amp; post.</>}
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Order total</p><p className="mb-0 mt-0.5 text-lg font-bold tabular-nums text-neutral-950">{money(cartTotal, outlet?.currency ?? "Currency not set")}</p></div><button type="button" onClick={() => void createOrder()} disabled={!canCreate || busy === "create" || !reservationId || selectedLines.length === 0} className="box-border inline-flex !h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none sm:w-auto">{busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Confirm order</button></div>
          </section>
        </div>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Live order queue</h3><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Serve &amp; post adds a folio charge. Serve &amp; settle records outlet-paid revenue.</p></div><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-500">{orders.length} orders</span></div>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.map((order) => {
            const tenderRequired = order.status === "SERVING" && order.settlementMode === "OUTLET_PAYMENT";
            const tenderSelected = Boolean(settlementTender[order.id]);
            const advanceDisabled = busy === `advance-${order.id}` || (tenderRequired && !tenderSelected);
            return (
              <article key={order.id} className="min-w-0 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{order.orderNumber} · {order.outlet.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">{order.orderPoint ? `${order.orderPoint.type === "ROOM" ? "Room" : "Table"} ${order.orderPoint.label} · Guest QR order` : `${orderRoomLabel(order)} · ${orderGuestLabel(order)}`}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${STATUS_STYLE[order.status] ?? "bg-neutral-100 text-neutral-600"}`}>{order.status === "PLACED" ? "NEW · QR" : order.status.replaceAll("_", " ")}</span>
                </div>
                <div className="mt-3 space-y-1">{order.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-[11px] text-neutral-600"><span className="truncate">{item.quantity}× {item.nameSnapshot}</span><span className="shrink-0 tabular-nums">{money(item.lineTotal, order.currency)}</span></div>)}</div>
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
                    <button type="button" onClick={() => setReasonAction({ orderId: order.id, action: "cancel" })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 text-[10px] font-bold text-red-600"><Trash2 className="h-3 w-3" />{order.status === "PLACED" ? "Decline" : "Cancel"}</button>
                    {role !== "FRONT_DESK" && <button type="button" onClick={() => void advance(order)} disabled={advanceDisabled} title={tenderRequired && !tenderSelected ? "Confirm the payment method actually received before completing service" : order.status === "PREPARING" ? "Start delivery without recording payment" : undefined} className={`inline-flex h-8 items-center gap-1 rounded-lg border-0 px-2.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 ${order.status === "PLACED" ? "bg-violet-700 hover:bg-violet-800" : order.status === "PREPARING" ? "bg-cyan-700 hover:bg-cyan-800" : "bg-neutral-900"}`}>{busy === `advance-${order.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : order.status === "PLACED" ? <Check className="h-3 w-3" /> : order.status === "CONFIRMED" ? <ChefHat className="h-3 w-3" /> : <ReceiptText className="h-3 w-3" />}{order.status === "PLACED" ? "Accept" : order.status === "CONFIRMED" ? "Prepare" : order.status === "PREPARING" ? "Take to guest" : order.settlementMode === "ROOM_FOLIO" ? "Complete & post" : "Confirm served & paid"}</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {orders.length === 0 && <div className="rounded-xl border border-dashed border-neutral-200 py-10 text-center"><Check className="mx-auto h-5 w-5 text-emerald-600" /><p className="mb-0 mt-2 text-xs font-bold text-neutral-600">No active outlet orders</p><p className="mb-0 mt-1 text-[10px] text-neutral-400">Completed orders are stored in the history below.</p></div>}
      </section>

      <section id="order-history" className="scroll-mt-24 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white"><History className="h-[18px] w-[18px]" /></span><div><h3 className="m-0 text-base font-bold text-neutral-900">Order history</h3><p className="mb-0 mt-0.5 text-xs leading-5 text-neutral-500">Saved outlet orders remain available for audit and review.</p></div></div>
          <div className="flex items-center gap-2"><select value={historyStatus} onChange={(event) => { setHistoryStatus(event.target.value); setHistoryPage(0); }} className="box-border !h-10 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-xs font-bold text-neutral-600 outline-none focus:border-emerald-500">{HISTORY_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-neutral-500">{historyTotal} saved</span></div>
        </div>
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <div className="lg:min-w-[1360px]">
        <div className="hidden min-w-0 grid-cols-[minmax(10rem,1.2fr)_minmax(8rem,0.9fr)_minmax(10rem,1.05fr)_minmax(11rem,1.15fr)_8rem_7rem_9rem] items-center gap-3 border-b border-neutral-200 px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-neutral-500 lg:grid"><span>Order and outlet</span><span>Guest and room</span><span>Settlement and items</span><span>Service, tip and server</span><span>Completed</span><span className="text-right">Amount</span><span className="text-right">Status and control</span></div>
        <div className="divide-y divide-neutral-200">
          {historyOrders.map((order) => (
            <div key={`history-${order.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 px-4 py-4 lg:grid-cols-[minmax(10rem,1.2fr)_minmax(8rem,0.9fr)_minmax(10rem,1.05fr)_minmax(11rem,1.15fr)_8rem_7rem_9rem] lg:items-center lg:gap-3">
              <div className="min-w-0"><p className="m-0 truncate text-sm font-bold text-neutral-800">{order.orderNumber}</p><p className="mb-0 mt-1 truncate text-xs text-neutral-500">{order.outlet.name}</p></div>
              <div className="col-start-1 min-w-0 lg:col-auto"><p className="m-0 truncate text-[13px] font-semibold text-neutral-700">{orderGuestLabel(order)}</p><p className="mb-0 mt-1 truncate text-[11px] text-neutral-500">{orderRoomLabel(order)}</p></div>
              <div className="col-start-1 min-w-0 lg:col-auto"><p className="m-0 text-xs font-bold text-neutral-700">{order.settlementMode === "OUTLET_PAYMENT" ? `Paid at outlet · ${tenderLabel(order.settlementMethod)}` : "Room folio"}</p><p className="mb-0 mt-1 truncate text-[11px] text-neutral-500">{order.items.map((item) => `${item.quantity}× ${item.nameSnapshot}`).join(", ")}</p>{order.paymentAmountReceived != null && <p className="mb-0 mt-1.5 text-[11px] font-semibold text-neutral-600">Received {money(order.paymentAmountReceived, order.currency)}{order.paymentAmountReceived > order.total + (order.tipAmount ?? 0) ? ` · Change ${money(order.paymentAmountReceived - order.total - (order.tipAmount ?? 0), order.currency)}` : ""}</p>}</div>
              <div className="col-start-1 min-w-0 lg:col-auto"><p className={`m-0 text-xs font-bold ${order.guestRating ? "text-amber-600" : "text-neutral-500"}`}>{order.guestRating ? `Guest rating ${order.guestRating}/5` : "No guest rating yet"}</p>{order.tipIntent === "INTERESTED" && order.tipSuggestedAmount ? <p className="mb-0 mt-1 text-[11px] font-semibold text-emerald-700">Guest suggested {money(order.tipSuggestedAmount, order.currency)}</p> : null}{order.tipAmount ? <p className="mb-0 mt-1 text-xs font-bold text-emerald-800">Tip {money(order.tipAmount, order.currency)} · {attendantName(order.tipRecipient)}</p> : <p className="mb-0 mt-1 text-[11px] text-neutral-500">No collected tip recorded</p>}{["SETTLED", "POSTED_TO_FOLIO"].includes(order.status) && role !== "FRONT_DESK" && <button type="button" onClick={() => openTipFlow(order)} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"><Coins className="h-3.5 w-3.5" />{order.tipAmount || order.paymentAmountReceived != null ? "Edit breakdown" : "Record payment / tip"}</button>}</div>
              <time className="col-start-1 whitespace-nowrap text-[11px] tabular-nums text-neutral-500 lg:col-auto" dateTime={orderRecordedAt(order)}>{shortDateTime(orderRecordedAt(order))}</time>
              <strong className="col-start-2 row-start-2 whitespace-nowrap text-right text-sm tabular-nums text-neutral-800 lg:col-auto lg:row-auto">{money(order.total, order.currency)}</strong>
              <div className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 lg:col-auto lg:row-auto"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_STYLE[order.status] ?? "bg-neutral-100 text-neutral-600"}`}>{order.status.replaceAll("_", " ")}</span>{order.status === "POSTED_TO_FOLIO" && role !== "FRONT_DESK" && <button type="button" onClick={() => setReasonAction({ orderId: order.id, action: "void" })} className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50">Void</button>}</div>
            </div>
          ))}
          {historyOrders.length === 0 && <div className="px-4 py-12 text-center text-xs text-neutral-400">No saved orders match this history filter.</div>}
        </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-4 py-3"><span className="text-xs font-medium text-neutral-500">Page {historyPage + 1} of {historyPageCount}</span><div className="flex gap-1.5"><button type="button" onClick={() => setHistoryPage((page) => Math.max(0, page - 1))} disabled={historyPage === 0} className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => setHistoryPage((page) => Math.min(historyPageCount - 1, page + 1))} disabled={historyPage + 1 >= historyPageCount} className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>

      {tipAction && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-neutral-950/50 p-3 sm:p-4">
          <section className="box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-[520px] overflow-y-auto rounded-[16px] bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5" aria-label="Payment and tip breakdown">
            <div className="flex items-start gap-3 border-b border-neutral-100 pb-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"><Coins className="h-[18px] w-[18px]" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">Payment reconciliation</p><h3 className="mb-0 mt-0.5 truncate text-lg font-bold text-neutral-950">Record payment and tip</h3><p className="mb-0 mt-1 text-xs text-neutral-500">{tipAction.order.orderNumber} · Bill {money(tipAction.order.total, tipAction.order.currency)}</p></div></div>

            {tipAction.order.tipIntent === "INTERESTED" && tipAction.order.tipSuggestedAmount ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5"><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700">Guest tip preference</p><p className="mb-0 mt-0.5 text-sm font-bold text-emerald-900">{money(tipAction.order.tipSuggestedAmount, tipAction.order.currency)}</p></div><button type="button" onClick={() => setTipAction((current) => current ? { ...current, tipAmount: String(current.order.tipSuggestedAmount), amountReceived: current.order.settlementMode === "OUTLET_PAYMENT" ? String(current.order.total + (current.order.tipSuggestedAmount ?? 0)) : current.amountReceived } : current)} className="min-h-9 rounded-lg border border-emerald-300 bg-white px-3 text-[10px] font-bold text-emerald-800">Use suggestion</button></div>
            ) : null}

            <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-neutral-50 px-3 py-2.5"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Order bill</p><p className="mb-0 mt-1 text-base font-bold text-neutral-950">{money(tipAction.order.total, tipAction.order.currency)}</p></div>
              {tipAction.order.settlementMode === "OUTLET_PAYMENT" ? <label className="min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Amount received<input type="number" min={tipAction.order.total} step="0.01" value={tipAction.amountReceived} onChange={(event) => setTipAction((current) => current ? { ...current, amountReceived: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500" /></label> : <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800"><strong>Room folio:</strong> record only a separately received tip below.</div>}
            </div>

            {tipAction.order.settlementMode === "OUTLET_PAYMENT" && (
              <div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-amber-700">Above bill</p><p className="mb-0 mt-0.5 text-sm font-bold text-amber-900">{money(tipOverpayment, tipAction.order.currency)}</p></div><div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Change due</p><p className="mb-0 mt-0.5 text-sm font-bold text-neutral-800">{money(tipChangeDue, tipAction.order.currency)}</p></div></div>
            )}

            <label className="mt-4 block min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Confirmed tip amount<input type="number" min="0" max={tipAction.order.settlementMode === "OUTLET_PAYMENT" ? tipOverpayment : undefined} step="0.01" value={tipAction.tipAmount} onChange={(event) => setTipAction((current) => current ? { ...current, tipAmount: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500" /><span className="mt-1.5 block text-[10px] font-normal normal-case tracking-normal text-neutral-400">Excess payment remains change unless the guest explicitly confirms it as a tip.</span></label>

            {tipDraftAmount > 0 && (
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Serving team member<select value={tipAction.recipientId} onChange={(event) => setTipAction((current) => current ? { ...current, recipientId: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500"><option value="">Select the person who served</option>{tipEligibleAttendants.map((attendant) => <option key={attendant.id} value={attendant.id}>{attendantName(attendant)} · {attendant.role.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>
                <label className="min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Tip received by<select value={tipAction.method} onChange={(event) => setTipAction((current) => current ? { ...current, method: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500"><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select></label>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-[10px] leading-4 text-neutral-500"><strong className="text-neutral-700">Audit rule:</strong> the recorded tip belongs to the selected serving team member. The account saving this breakdown and the confirmation time are stored separately.</div>
            {error && <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setTipAction(null); setError(null); }} className="min-h-10 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Cancel</button><button type="button" onClick={() => void saveTipFlow()} disabled={busy === `tip-${tipAction.order.id}` || (tipDraftAmount > 0 && (!tipAction.recipientId || !tipAction.method))} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-0 bg-[#073f35] px-3 text-xs font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">{busy === `tip-${tipAction.order.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save breakdown</button></div>
          </section>
        </div>
      )}

      {reasonAction && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-neutral-950/45 p-3 sm:p-4">
          <section className="box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5">
            <div className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-red-600" /><h3 className="m-0 min-w-0 truncate text-base font-bold text-neutral-950">{reasonAction.action === "void" ? "Void posted order" : "Cancel order"}</h3></div>
            <p className="mb-0 mt-2 text-xs leading-5 text-neutral-500">This action is permanently recorded with your account and timestamp.</p>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="Reason required" className="mt-4 box-border h-24 w-full max-w-full resize-none rounded-lg border border-neutral-300 p-3 text-sm outline-none focus:border-red-400" />
            <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
              <button type="button" onClick={() => { setReasonAction(null); setReason(""); }} className="box-border min-h-10 min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Keep order</button>
              <button type="button" onClick={() => void submitReason()} disabled={reason.trim().length < 3 || busy != null} className="box-border min-h-10 min-w-0 rounded-lg border-0 bg-red-600 px-3 text-xs font-bold text-white disabled:bg-red-200 disabled:text-red-500">Record {reasonAction.action}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StoreIcon() { return <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500"><UtensilsCrossed className="h-5 w-5" /></span>; }

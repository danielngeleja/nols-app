"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Coins, History, Loader2, Star } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Attendant = { id: number; fullName?: string | null; name?: string | null; role: string; outletId: number | null };
type InHouse = { guestProfile: { fullName: string } | null; allocations: Array<{ roomUnit: { code: string } | null; roomType: { name: string } | null }> };
type Order = {
  id: number; orderNumber: string; status: string; settlementMode: string; currency: string; total: number; createdAt: string;
  settlementMethod?: string | null; postedAt?: string | null; settledAt?: string | null; cancelledAt?: string | null; voidedAt?: string | null;
  guestRating?: number | null; tipIntent?: string | null; tipSuggestedAmount?: number | null;
  paymentAmountReceived?: number | null; tipAmount?: number | null; tipMethod?: string | null;
  // Room-folio orders never collect their own cash; this is true once the
  // reservation carrying the charge has been paid off in full at checkout.
  reservationSettled?: boolean;
  settledBy?: { id: number; fullName?: string | null; name?: string | null } | null;
  tipRecipient?: { id: number; fullName?: string | null; name?: string | null } | null;
  outlet: { id: number; name: string; type: string };
  reservation: InHouse | null;
  customerLabel?: string | null;
  orderPoint?: { id: number; type: string; label: string } | null;
  items: Array<{ id: number; nameSnapshot: string; quantity: number; lineTotal: number }>;
};

const PAGE_SIZE = 12;
const FILTERS = [
  { value: "", label: "All completed orders" },
  { value: "SETTLED", label: "Paid at outlet" },
  { value: "POSTED_TO_FOLIO", label: "Posted to folio" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "VOIDED", label: "Voided" },
];
const STATUS_STYLE: Record<string, string> = {
  POSTED_TO_FOLIO: "bg-emerald-50 text-emerald-700",
  SETTLED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
  VOIDED: "bg-red-50 text-red-600",
};

function money(value: number, currency: string) { return `${currency} ${value.toLocaleString()}`; }
function roomLabel(reservation: InHouse) { return reservation.allocations.map((row) => row.roomUnit?.code ?? row.roomType?.name).filter(Boolean).join(", ") || "No room"; }
function orderGuestLabel(order: Order) { return order.reservation ? (order.reservation.guestProfile?.fullName ?? "Guest") : (order.customerLabel || "Walk-in"); }
function orderRoomLabel(order: Order) { return order.reservation ? roomLabel(order.reservation) : "Walk-in"; }
// Table orders identify by which table, not a guest/room pairing that never applies to them.
function orderTablePrimary(order: Order) { return order.orderPoint?.label ?? order.customerLabel ?? "Walk-in"; }
function orderTableSecondary() { return "Table"; }
function orderRecordedAt(order: Order) { return order.settledAt || order.postedAt || order.cancelledAt || order.voidedAt || order.createdAt; }
function shortDateTime(value: string) { return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function tenderLabel(value?: string | null) { return value ? value.replaceAll("_", " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()) : "Method not classified"; }
function attendantName(value?: { fullName?: string | null; name?: string | null } | null) { return value?.fullName || value?.name || "Team member"; }

const SCOPE_COPY: Record<"room" | "table", { title: string; description: string }> = {
  room: { title: "Room order history", description: "Saved room and in-house guest orders remain available for audit and review." },
  table: { title: "Table and walk-in order history", description: "Saved table and walk-in orders remain available for audit and review." },
};

/** Self-contained order-history table: fetches its own data, scoped to one
 * order type, so each dashboard (room orders, tables & tabs) shows only its
 * own history instead of everything on the property mixed together. */
export default function OrderHistoryPanel({ propertyId, scope }: { propertyId: number; scope: "room" | "table" }) {
  const [role, setRole] = useState("OWNER");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [attendants, setAttendants] = useState<Attendant[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonOrderId, setReasonOrderId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [tipAction, setTipAction] = useState<{ order: Order; amountReceived: string; tipAmount: string; recipientId: string; method: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = new URLSearchParams({ view: "history", scope, limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (status) query.set("status", status);
      const [contextResponse, historyResponse] = await Promise.all([
        apiClient.get(`/api/nrms/operations/property/${propertyId}/context`),
        apiClient.get(`/api/nrms/operations/property/${propertyId}/orders?${query.toString()}`),
      ]);
      setRole(contextResponse.data?.access?.role ?? "OWNER");
      setCurrentUserId(Number(contextResponse.data?.access?.userId) || null);
      setAttendants(contextResponse.data?.attendants ?? []);
      setOrders(historyResponse.data?.orders ?? []);
      setTotal(historyResponse.data?.total ?? 0);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load order history");
    }
  }, [page, propertyId, scope, status]);

  useEffect(() => { void load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canAssignOthers = ["OWNER", "MANAGER", "OUTLET_SUPERVISOR"].includes(role);
  const tipEligibleAttendants = tipAction
    ? attendants.filter((attendant) => (attendant.outletId == null || attendant.outletId === tipAction.order.outlet.id) && (canAssignOthers || attendant.id === currentUserId))
    : [];
  const tipDraftAmount = Number(tipAction?.tipAmount || 0);
  const tipDraftReceived = Number(tipAction?.amountReceived || 0);
  const tipOverpayment = tipAction?.order.settlementMode === "OUTLET_PAYMENT" && Number.isFinite(tipDraftReceived) ? Math.max(0, tipDraftReceived - tipAction.order.total) : 0;
  const tipChangeDue = tipAction?.order.settlementMode === "OUTLET_PAYMENT" ? Math.max(0, tipOverpayment - (Number.isFinite(tipDraftAmount) ? tipDraftAmount : 0)) : 0;

  const openTipFlow = (order: Order) => {
    setError(null);
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

  const submitVoid = async () => {
    if (!reasonOrderId || reason.trim().length < 3) return;
    setBusy(`void-${reasonOrderId}`); setError(null);
    try {
      await apiClient.post(`/api/nrms/operations/orders/${reasonOrderId}/void`, { reason: reason.trim() });
      setReasonOrderId(null); setReason(""); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to void order"); }
    finally { setBusy(null); }
  };

  const copy = SCOPE_COPY[scope];

  return (
    <section id="order-history" className="scroll-mt-24 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white"><History className="h-[18px] w-[18px]" /></span><div><h3 className="m-0 text-base font-bold text-neutral-900">{copy.title}</h3><p className="mb-0 mt-0.5 text-xs leading-5 text-neutral-500">{copy.description}</p></div></div>
        <div className="flex items-center gap-2"><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} className="box-border !h-10 rounded-lg border border-neutral-200 bg-white px-3 py-0 text-xs font-bold text-neutral-600 outline-none focus:border-emerald-500">{FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-neutral-500">{total} saved</span></div>
      </div>

      {error && <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}

      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <div className="lg:min-w-[1500px]">
          <div className="hidden min-w-0 grid-cols-[minmax(10rem,1fr)_minmax(9rem,.85fr)_minmax(12rem,1.2fr)_minmax(10rem,.9fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_8rem_9rem] items-center gap-4 border-b border-neutral-200 bg-white px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500 lg:grid">
            <span>Order</span>
            <span>{scope === "table" ? "Location" : "Guest and room"}</span>
            <span>Items ordered</span>
            <span>Payment</span>
            <span>Guest feedback</span>
            <span>Tip record</span>
            <span>Completed</span>
            <span className="text-right">Status and actions</span>
          </div>
          <div className="divide-y divide-neutral-200">
            {orders.map((order) => {
              const tipRecorded = Boolean(order.tipAmount);
              const tipSuggested = order.tipIntent === "INTERESTED" && Boolean(order.tipSuggestedAmount);
              const canManageTip = ["SETTLED", "POSTED_TO_FOLIO"].includes(order.status)
                && role !== "FRONT_DESK"
                && !(order.reservationSettled && !tipRecorded);
              const tipButtonLabel = tipRecorded || order.paymentAmountReceived != null
                ? "Review payment & tip"
                : order.settlementMode === "OUTLET_PAYMENT" ? "Record payment details" : "Record tip";

              return (
                <article key={order.id} className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 transition-colors hover:bg-neutral-50/70 lg:grid-cols-[minmax(10rem,1fr)_minmax(9rem,.85fr)_minmax(12rem,1.2fr)_minmax(10rem,.9fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_8rem_9rem] lg:items-start lg:gap-4">
                  <div className="col-span-2 min-w-0 lg:col-span-1">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Order</span>
                    <p className="m-0 truncate text-sm font-bold text-neutral-900">{order.orderNumber}</p>
                    <p className="mb-0 mt-1 truncate text-xs text-neutral-500">{order.outlet.name}</p>
                  </div>

                  <div className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">{scope === "table" ? "Location" : "Guest and room"}</span>
                    <p className="m-0 truncate text-[13px] font-semibold text-neutral-800">{scope === "table" ? orderTablePrimary(order) : orderGuestLabel(order)}</p>
                    <p className="mb-0 mt-1 truncate text-[11px] text-neutral-500">{scope === "table" ? orderTableSecondary() : orderRoomLabel(order)}</p>
                  </div>

                  <div className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Items ordered</span>
                    <p className="m-0 text-[11px] leading-5 text-neutral-600">{order.items.map((item) => `${item.quantity}× ${item.nameSnapshot}`).join(", ")}</p>
                  </div>

                  <div className="min-w-0 rounded-lg bg-neutral-50 px-2.5 py-2 lg:bg-transparent lg:p-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Payment</span>
                    <p className="m-0 whitespace-nowrap text-sm font-bold tabular-nums text-neutral-900">{money(order.total, order.currency)}</p>
                    <p className="mb-0 mt-1 text-[11px] font-semibold text-neutral-600">{order.settlementMode === "OUTLET_PAYMENT" ? `Paid at outlet · ${tenderLabel(order.settlementMethod)}` : "Posted to room folio"}</p>
                    {order.paymentAmountReceived != null && <p className="mb-0 mt-1 text-[10px] text-neutral-500">Received {money(order.paymentAmountReceived, order.currency)}{order.paymentAmountReceived > order.total + (order.tipAmount ?? 0) ? ` · Change ${money(order.paymentAmountReceived - order.total - (order.tipAmount ?? 0), order.currency)}` : ""}</p>}
                    {order.settledBy && <p className="mb-0 mt-1 text-[10px] text-neutral-400">Recorded by {attendantName(order.settledBy)}</p>}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Guest feedback</span>
                    {order.guestRating ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700"><Star className="h-3 w-3 fill-current" />{order.guestRating}/5 rating</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-500">Awaiting rating</span>
                    )}
                    <p className={`mb-0 mt-1.5 text-[10px] leading-4 ${tipSuggested ? "font-semibold text-emerald-700" : "text-neutral-400"}`}>{tipSuggested ? `Suggested tip ${money(order.tipSuggestedAmount!, order.currency)}` : "No tip suggestion"}</p>
                  </div>

                  <div className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Tip record</span>
                    {tipRecorded ? (
                      <>
                        <p className="m-0 text-xs font-bold text-emerald-800">Collected {money(order.tipAmount!, order.currency)}</p>
                        <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">For {attendantName(order.tipRecipient)}{order.tipMethod ? ` · ${tenderLabel(order.tipMethod)}` : ""}</p>
                      </>
                    ) : order.reservationSettled ? (
                      <p className="m-0 inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500"><Check className="h-3.5 w-3.5 text-emerald-600" />Finalized without tip</p>
                    ) : (
                      <p className="m-0 text-[11px] font-medium text-neutral-500">No tip collected</p>
                    )}
                    {canManageTip && <button type="button" onClick={() => openTipFlow(order)} className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 text-[10px] font-bold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50"><Coins className="h-3.5 w-3.5" />{tipButtonLabel}</button>}
                  </div>

                  <div className="min-w-0">
                    <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Completed</span>
                    <time className="block text-[11px] leading-5 tabular-nums text-neutral-500" dateTime={orderRecordedAt(order)}>{shortDateTime(orderRecordedAt(order))}</time>
                  </div>

                  <div className="flex min-w-0 flex-col items-end gap-2">
                    <span className="mb-[-2px] block text-[9px] font-bold uppercase tracking-wider text-neutral-400 lg:hidden">Status and actions</span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${STATUS_STYLE[order.status] ?? "bg-neutral-100 text-neutral-600"}`}>{order.status.replaceAll("_", " ")}</span>
                    {(order.status === "POSTED_TO_FOLIO" || order.status === "SETTLED") && role !== "FRONT_DESK" && <button type="button" onClick={() => setReasonOrderId(order.id)} className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[10px] font-bold text-red-600 transition hover:bg-red-50">Void order</button>}
                  </div>
                </article>
              );
            })}
            {orders.length === 0 && <div className="px-4 py-12 text-center text-xs text-neutral-400">No saved orders match this history filter.</div>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-neutral-200 bg-neutral-50 px-4 py-3"><span className="text-xs font-medium text-neutral-500">Page {page + 1} of {pageCount}</span><div className="flex gap-1.5"><button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page + 1 >= pageCount} className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>

      {tipAction && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-neutral-950/50 p-3 sm:p-4">
          <section className="box-border flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[590px] flex-col overflow-hidden rounded-[22px] border border-neutral-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]" aria-label="Payment and tip breakdown">
            <header className="shrink-0 border-b border-neutral-100 bg-white px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"><Coins className="h-[18px] w-[18px]" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700">Payment reconciliation</p><h3 className="mb-0 mt-0.5 truncate text-lg font-bold text-neutral-950">Record payment and tip</h3><p className="mb-0 mt-1 text-xs text-neutral-500">{tipAction.order.orderNumber} · Bill {money(tipAction.order.total, tipAction.order.currency)}</p></div></div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">

            {tipAction.order.tipIntent === "INTERESTED" && tipAction.order.tipSuggestedAmount ? (
              <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700">Guest tip preference</p><p className="mb-0 mt-0.5 text-sm font-bold text-emerald-900">{money(tipAction.order.tipSuggestedAmount, tipAction.order.currency)}</p></div><button type="button" onClick={() => setTipAction((current) => current ? { ...current, tipAmount: String(current.order.tipSuggestedAmount), amountReceived: current.order.settlementMode === "OUTLET_PAYMENT" ? String(current.order.total + (current.order.tipSuggestedAmount ?? 0)) : current.amountReceived } : current)} className="min-h-10 rounded-xl border border-emerald-300 bg-white px-4 text-[10px] font-bold text-emerald-800">Use suggestion</button></div>
            ) : null}

            <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-neutral-50 px-4 py-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Order bill</p><p className="mb-0 mt-1 text-base font-bold text-neutral-950">{money(tipAction.order.total, tipAction.order.currency)}</p></div>
              {tipAction.order.settlementMode === "OUTLET_PAYMENT" ? <label className="min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Amount received<input type="number" min={tipAction.order.total} step="0.01" value={tipAction.amountReceived} onChange={(event) => setTipAction((current) => current ? { ...current, amountReceived: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500" /></label> : <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800"><strong>Room folio:</strong> record only a separately received tip below.</div>}
            </div>

            {tipAction.order.settlementMode === "OUTLET_PAYMENT" && (
              <div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-amber-700">Above bill</p><p className="mb-0 mt-0.5 text-sm font-bold text-amber-900">{money(tipOverpayment, tipAction.order.currency)}</p></div><div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Change due</p><p className="mb-0 mt-0.5 text-sm font-bold text-neutral-800">{money(tipChangeDue, tipAction.order.currency)}</p></div></div>
            )}

            <label className="mt-4 block min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Confirmed tip amount<input type="number" min="0" max={tipAction.order.settlementMode === "OUTLET_PAYMENT" ? tipOverpayment : undefined} step="0.01" value={tipAction.tipAmount} onChange={(event) => setTipAction((current) => current ? { ...current, tipAmount: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-neutral-900 outline-none focus:border-emerald-500" /><span className="mt-1.5 block text-[10px] font-normal normal-case tracking-normal text-neutral-400">Excess payment remains change unless the guest explicitly confirms it as a tip.</span></label>

            {tipDraftAmount > 0 && (
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Serving team member<select value={tipAction.recipientId} onChange={(event) => setTipAction((current) => current ? { ...current, recipientId: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500"><option value="">Select the person who served</option>{tipEligibleAttendants.map((attendant) => <option key={attendant.id} value={attendant.id}>{attendantName(attendant)} · {attendant.role.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>
                <label className="min-w-0 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Tip received by<select value={tipAction.method} onChange={(event) => setTipAction((current) => current ? { ...current, method: event.target.value } : current)} className="mt-1.5 box-border h-11 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-semibold normal-case tracking-normal text-neutral-800 outline-none focus:border-emerald-500"><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select></label>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[10px] leading-4 text-neutral-500"><strong className="text-neutral-700">Audit rule:</strong> the recorded tip belongs to the selected serving team member. The account saving this breakdown and the confirmation time are stored separately.</div>
              {error && <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
            </div>

            <footer className="shrink-0 border-t border-neutral-200 bg-white px-5 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.05)] sm:px-6">
              <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => { setTipAction(null); setError(null); }} className="min-h-11 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50">Cancel</button><button type="button" onClick={() => void saveTipFlow()} disabled={busy === `tip-${tipAction.order.id}` || (tipDraftAmount > 0 && (!tipAction.recipientId || !tipAction.method))} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-0 bg-[#073f35] px-4 text-xs font-bold text-white transition hover:bg-[#0a5144] disabled:bg-neutral-200 disabled:text-neutral-400">{busy === `tip-${tipAction.order.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save breakdown</button></div>
            </footer>
          </section>
        </div>
      )}

      {reasonOrderId != null && (
        <div className="fixed inset-0 z-[11000] flex items-center justify-center overflow-y-auto bg-neutral-950/45 p-3 sm:p-4">
          <section className="box-border max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-5">
            <div className="flex min-w-0 items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-red-600" /><h3 className="m-0 min-w-0 truncate text-base font-bold text-neutral-950">Void posted order</h3></div>
            <p className="mb-0 mt-2 text-xs leading-5 text-neutral-500">This action is permanently recorded with your account and timestamp.</p>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="Reason required" className="mt-4 box-border h-24 w-full max-w-full resize-none rounded-lg border border-neutral-300 p-3 text-sm outline-none focus:border-red-400" />
            <div className="mt-4 grid min-w-0 grid-cols-2 gap-2">
              <button type="button" onClick={() => { setReasonOrderId(null); setReason(""); }} className="box-border min-h-10 min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600">Keep order</button>
              <button type="button" onClick={() => void submitVoid()} disabled={reason.trim().length < 3 || busy != null} className="box-border min-h-10 min-w-0 rounded-lg border-0 bg-red-600 px-3 text-xs font-bold text-white disabled:bg-red-200 disabled:text-red-500">Record void</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
